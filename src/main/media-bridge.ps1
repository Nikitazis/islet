# Cstorka media bridge.
# Reads the Windows Global System Media Transport Controls (the same source the
# Windows volume flyout uses) and streams JSON lines to stdout:
#   {"type":"state", ...}   - when anything about the sessions changes
#   {"type":"thumb", ...}   - album art / video thumbnail as a data URL, once per track
#   {"type":"error", ...}
# Commands arrive as JSON lines on stdin:
#   {"cmd":"toggle|play|pause|next|prev|seek","app":"<AUMID>","index":0,"position":12345}
# The script exits when stdin is closed, so it never outlives the app.

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
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

# --- State -------------------------------------------------------------------

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

function Invoke-MediaCommand([string]$line) {
    $command = $line | ConvertFrom-Json
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
            try { Invoke-MediaCommand $line } catch { Send @{ type = 'error'; message = "$_" } }
            $forceRefresh = $true
        }
        $pending = $stdin.ReadLineAsync()
    }

    if ($forceRefresh) { Start-Sleep -Milliseconds 120 }
    if ($forceRefresh -or $tick % 8 -eq 0) {
        try { Emit-State } catch { Send @{ type = 'error'; message = "$_" } }
    }
    $tick++
    Start-Sleep -Milliseconds 100
}
