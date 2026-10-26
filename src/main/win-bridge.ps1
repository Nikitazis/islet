# Cstorka Windows bridge.
# Reads what PowerShell reaches easily and Node doesn't, and streams JSON lines to stdout:
#   {"type":"state", ...}   - media sessions (Global System Media Transport Controls,
#                             the source of the Windows volume flyout) when they change
#   {"type":"thumb", ...}   - album art / video thumbnail as a data URL, once per track
#   {"type":"volume", ...}  - master volume and mute when they change
#   {"type":"ack", ...}     - a command with an "id" has finished
#   {"type":"error", ...}
# Commands arrive as JSON lines on stdin:
#   {"cmd":"toggle|play|pause|next|prev|seek","app":"<AUMID>","index":0,"position":12345}
#   {"cmd":"volume","value":0.5}  {"cmd":"volume","delta":0.04}  {"cmd":"mute","muted":true}
#   {"cmd":"copyFiles","paths":["C:\\a.txt"],"id":7}
# The script exits when stdin is closed, so it never outlives the app.

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Windows.Forms
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Await($operation, [Type]$resultType, [int]$timeoutMs = 3000) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
    if (-not $task.Wait($timeoutMs)) { return $null }
    return $task.Result
}

function Send($obj) {
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 5))
    [Console]::Out.Flush()
}

# --- Master volume (Core Audio) ----------------------------------------------
# The unnamed methods only hold the vtable slots of methods we don't call.

$audioSupported = $true
try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ICstorkaEndpointVolume {
    int f(); int g(); int h(); int i();
    int SetMasterVolumeLevelScalar(float level, Guid context);
    int j();
    int GetMasterVolumeLevelScalar(out float level);
    int k(); int l(); int m(); int n();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid context);
    int GetMute(out bool mute);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ICstorkaDevice {
    int Activate(ref Guid id, int clsCtx, int activationParams, out ICstorkaEndpointVolume volume);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ICstorkaDeviceEnumerator {
    int f();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out ICstorkaDevice device);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class CstorkaDeviceEnumerator { }

public static class CstorkaAudio {
    static ICstorkaEndpointVolume endpoint;
    static DateTime acquired;

    // Re-acquired every few seconds so a new default device (headphones) is picked up.
    static ICstorkaEndpointVolume Endpoint() {
        if (endpoint == null || (DateTime.UtcNow - acquired).TotalSeconds > 5) {
            var enumerator = new CstorkaDeviceEnumerator() as ICstorkaDeviceEnumerator;
            ICstorkaDevice device;
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
            Guid id = typeof(ICstorkaEndpointVolume).GUID;
            ICstorkaEndpointVolume volume;
            Marshal.ThrowExceptionForHR(device.Activate(ref id, 23, 0, out volume));
            endpoint = volume;
            acquired = DateTime.UtcNow;
        }
        return endpoint;
    }

    public static float Level {
        get { float v; Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out v)); return v; }
        set { Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, value)), Guid.Empty)); }
    }

    public static bool Muted {
        get { bool m; Marshal.ThrowExceptionForHR(Endpoint().GetMute(out m)); return m; }
        set { Marshal.ThrowExceptionForHR(Endpoint().SetMute(value, Guid.Empty)); }
    }
}
'@
} catch {
    $audioSupported = $false
    Send @{ type = 'volume'; supported = $false }
}

$lastVolume = ''

function Emit-Volume {
    if (-not $audioSupported) { return }
    $level = [math]::Round([CstorkaAudio]::Level, 3)
    $muted = [CstorkaAudio]::Muted
    $key = "$level|$muted"
    if ($key -ne $script:lastVolume) {
        $script:lastVolume = $key
        Send ([ordered]@{ type = 'volume'; supported = $true; level = $level; muted = $muted })
    }
}

# --- Friendly app names ------------------------------------------------------

$appNames = @{}
$startApps = $null

function Resolve-AppName([string]$aumid) {
    if ($appNames.ContainsKey($aumid)) { return $appNames[$aumid] }
    $name = $null
    try {
        if ($null -eq $script:startApps) { $script:startApps = @(Get-StartApps) }
        $match = $script:startApps | Where-Object { $_.AppID -eq $aumid } | Select-Object -First 1
        if ($match) { $name = $match.Name }
    } catch { }
    if (-not $name) {
        try {
            $procName = [IO.Path]::GetFileNameWithoutExtension(($aumid -split '!')[0])
            $proc = Get-Process -Name $procName -ErrorAction Stop | Select-Object -First 1
            $name = $proc.MainModule.FileVersionInfo.FileDescription
        } catch { }
    }
    if (-not $name) { $name = $aumid }
    $appNames[$aumid] = $name
    return $name
}

# --- Thumbnails --------------------------------------------------------------

$thumbsSent = @{}     # key -> $true once delivered
$thumbTries = @{}     # key -> attempts, artwork often arrives a moment after the title

# The stream comes back as a bare COM object, so PowerShell can't see its
# interfaces; going through reflection lets the runtime do the cast.
$sizeProperty = [Windows.Storage.Streams.IRandomAccessStream].GetProperty('Size')
$contentTypeProperty = [Windows.Storage.Streams.IContentTypeProvider].GetProperty('ContentType')
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))

function Read-Thumbnail($reference) {
    if ($null -eq $reference) { return $null }
    $stream = Await ($reference.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    if ($null -eq $stream) { return $null }
    try {
        $size = $sizeProperty.GetValue($stream)
        if ($size -eq 0 -or $size -gt 4MB) { return $null }
        $netStream = $asStreamForRead.Invoke($null, @($stream))
        $buffer = New-Object System.IO.MemoryStream
        $netStream.CopyTo($buffer)
        if ($buffer.Length -eq 0) { return $null }
        $type = $contentTypeProperty.GetValue($stream)
        if (-not $type) { $type = 'image/png' }
        return "data:$type;base64," + [Convert]::ToBase64String($buffer.ToArray())
    } finally {
        try { $null = [System.IDisposable].GetMethod('Dispose').Invoke($stream, $null) } catch { }
    }
}

# --- Media sessions ----------------------------------------------------------

$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]) 10000
if ($null -eq $manager) {
    Send @{ type = 'error'; message = 'GSMTC manager unavailable' }
    exit 2
}

$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$lastState = ''

function Get-Sessions { return @($manager.GetSessions()) }

function Emit-State {
    $sessions = Get-Sessions
    $current = $manager.GetCurrentSession()
    $currentApp = if ($current) { $current.SourceAppUserModelId } else { $null }
    $list = @()
    $currentIndex = -1

    for ($i = 0; $i -lt $sessions.Count; $i++) {
        $s = $sessions[$i]
        $props = Await ($s.TryGetMediaPropertiesAsync()) $propsType
        if ($null -eq $props) { continue }
        $playback = $s.GetPlaybackInfo()
        $timeline = $s.GetTimelineProperties()
        $aumid = $s.SourceAppUserModelId

        $key = '{0}|{1}|{2}|{3}' -f $aumid, $props.Title, $props.Artist, $props.AlbumTitle
        if ($props.Thumbnail -and -not $thumbsSent.ContainsKey($key) -and $thumbTries[$key] -lt 5) {
            $thumbTries[$key] = 1 + [int]$thumbTries[$key]
            try {
                $data = Read-Thumbnail $props.Thumbnail
                if ($data) {
                    Send @{ type = 'thumb'; key = $key; data = $data }
                    $thumbsSent[$key] = $true
                }
            } catch { }
        }

        $kind = 'Unknown'
        if ($null -ne $playback.PlaybackType) { $kind = [string]$playback.PlaybackType }
        elseif ($null -ne $props.PlaybackType) { $kind = [string]$props.PlaybackType }

        $duration = ($timeline.EndTime - $timeline.StartTime).TotalMilliseconds
        $position = ($timeline.Position - $timeline.StartTime).TotalMilliseconds

        if ($aumid -eq $currentApp -and $currentIndex -lt 0) { $currentIndex = $list.Count }

        $list += [ordered]@{
            index     = $i
            app       = $aumid
            appName   = Resolve-AppName $aumid
            title     = [string]$props.Title
            artist    = [string]$props.Artist
            album     = [string]$props.AlbumTitle
            kind      = $kind
            status    = [string]$playback.PlaybackStatus
            duration  = [math]::Round([math]::Max(0, $duration))
            position  = [math]::Round([math]::Max(0, $position))
            updatedAt = $timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
            canToggle = [bool]$playback.Controls.IsPlayPauseToggleEnabled
            canNext   = [bool]$playback.Controls.IsNextEnabled
            canPrev   = [bool]$playback.Controls.IsPreviousEnabled
            canSeek   = [bool]$playback.Controls.IsPlaybackPositionEnabled
            thumbKey  = if ($thumbsSent.ContainsKey($key)) { $key } else { $null }
        }
    }

    $state = [ordered]@{ type = 'state'; current = $currentIndex; sessions = $list }
    $json = $state | ConvertTo-Json -Compress -Depth 5
    if ($json -ne $script:lastState) {
        $script:lastState = $json
        [Console]::Out.WriteLine($json)
        [Console]::Out.Flush()
    }
}

function Find-Session($command) {
    $sessions = Get-Sessions
    $index = [int]$command.index
    if ($index -ge 0 -and $index -lt $sessions.Count -and $sessions[$index].SourceAppUserModelId -eq $command.app) {
        return $sessions[$index]
    }
    $byApp = $sessions | Where-Object { $_.SourceAppUserModelId -eq $command.app } | Select-Object -First 1
    if ($byApp) { return $byApp }
    return $manager.GetCurrentSession()
}

# --- Commands ----------------------------------------------------------------

function Invoke-MediaCommand($command) {
    $session = Find-Session $command
    if ($null -eq $session) { return }
    $op = switch ($command.cmd) {
        'toggle' { $session.TryTogglePlayPauseAsync() }
        'play'   { $session.TryPlayAsync() }
        'pause'  { $session.TryPauseAsync() }
        'next'   { $session.TrySkipNextAsync() }
        'prev'   { $session.TrySkipPreviousAsync() }
        'seek'   { $session.TryChangePlaybackPositionAsync([long]([double]$command.position * 10000)) }
    }
    if ($op) { $null = Await $op ([bool]) }
}

function Invoke-BridgeCommand([string]$line) {
    $command = $line | ConvertFrom-Json
    $ok = $true
    switch ($command.cmd) {
        'volume' {
            if (-not $audioSupported) { $ok = $false; break }
            if ($null -ne $command.delta) {
                [CstorkaAudio]::Level = [CstorkaAudio]::Level + [double]$command.delta
                if ([double]$command.delta -gt 0) { [CstorkaAudio]::Muted = $false }
            } else {
                [CstorkaAudio]::Level = [double]$command.value
            }
        }
        'mute' {
            if (-not $audioSupported) { $ok = $false; break }
            $muted = if ($null -eq $command.muted) { -not [CstorkaAudio]::Muted } else { [bool]$command.muted }
            [CstorkaAudio]::Muted = $muted
        }
        'copyFiles' {
            # SetFileDropList needs an STA thread, which powershell.exe uses by default.
            $list = New-Object System.Collections.Specialized.StringCollection
            foreach ($path in @($command.paths)) {
                if (Test-Path -LiteralPath $path) { [void]$list.Add($path) }
            }
            if ($list.Count -gt 0) { [System.Windows.Forms.Clipboard]::SetFileDropList($list) } else { $ok = $false }
        }
        default { Invoke-MediaCommand $command }
    }
    if ($null -ne $command.id) { Send @{ type = 'ack'; id = $command.id; ok = $ok } }
}

# --- Main loop ---------------------------------------------------------------

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$pending = $stdin.ReadLineAsync()
$tick = 0

while ($true) {
    $forceRefresh = $false
    while ($pending.IsCompleted) {
        $line = $pending.Result
        if ($null -eq $line) { exit 0 }
        if ($line.Trim()) {
            try { Invoke-BridgeCommand $line } catch { Send @{ type = 'error'; message = "$_" } }
            $forceRefresh = $true
        }
        $pending = $stdin.ReadLineAsync()
    }

    if ($forceRefresh -or $tick % 2 -eq 0) {
        try { Emit-Volume } catch { }
    }
    if ($forceRefresh) { Start-Sleep -Milliseconds 120 }
    if ($forceRefresh -or $tick % 8 -eq 0) {
        try { Emit-State } catch { Send @{ type = 'error'; message = "$_" } }
    }
    $tick++
    Start-Sleep -Milliseconds 100
}
