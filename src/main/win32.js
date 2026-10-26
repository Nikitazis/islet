'use strict';

// The few user32 calls Electron doesn't expose: who is in front, is it
// covering the whole monitor, give focus back, press Ctrl+V.

const koffi = require('koffi');

const user32 = koffi.load('user32.dll');

const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const MONITORINFO = koffi.struct('MONITORINFO', {
  cbSize: 'uint32_t',
  rcMonitor: RECT,
  rcWork: RECT,
  dwFlags: 'uint32_t',
});

const GetForegroundWindow = user32.func('uintptr_t __stdcall GetForegroundWindow()');
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(uintptr_t hWnd)');
const IsWindow = user32.func('bool __stdcall IsWindow(uintptr_t hWnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(uintptr_t hWnd)');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(uintptr_t hWnd, _Out_ RECT *rect)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(uintptr_t hWnd, _Out_ void *name, int maxCount)');
const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hWnd, int index)');
const SetWindowLongPtrW = user32.func('intptr_t __stdcall SetWindowLongPtrW(uintptr_t hWnd, int index, intptr_t value)');
const MonitorFromWindow = user32.func('uintptr_t __stdcall MonitorFromWindow(uintptr_t hWnd, uint32_t flags)');
const GetMonitorInfoW = user32.func('bool __stdcall GetMonitorInfoW(uintptr_t monitor, _Inout_ MONITORINFO *info)');
const keybd_event = user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)');

const MONITOR_DEFAULTTONEAREST = 2;
const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CAPTION = 0x00c00000;
const WS_THICKFRAME = 0x00040000;
const WS_EX_NOACTIVATE = 0x08000000;
const KEYEVENTF_KEYUP = 0x2;
const VK_CONTROL = 0x11;
const VK_V = 0x56;

// The desktop and the taskbar cover the screen too, but they aren't "fullscreen apps".
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

const toHandle = (value) => Number(value);

/** Native handle of an Electron BrowserWindow as a number. */
function handleOf(browserWindow) {
  const buf = browserWindow.getNativeWindowHandle();
  return Number(buf.length >= 8 ? buf.readBigUInt64LE(0) : buf.readUInt32LE(0));
}

function foregroundWindow() {
  return toHandle(GetForegroundWindow());
}

function className(hwnd) {
  const buf = Buffer.alloc(512);
  const length = GetClassNameW(hwnd, buf, 256);
  return buf.toString('utf16le', 0, Math.max(0, length) * 2);
}

/**
 * True when the window in front covers the whole monitor the island lives on:
 * games, videos and browsers in F11, presentations.
 */
function isForegroundFullscreen(islandHwnd) {
  const hwnd = foregroundWindow();
  if (!hwnd || hwnd === islandHwnd || IsIconic(hwnd)) return false;
  if (SHELL_CLASSES.has(className(hwnd))) return false;
  // A maximized window with an auto-hidden taskbar also covers the monitor,
  // but it keeps its frame; fullscreen windows drop the caption and borders.
  const style = Number(GetWindowLongPtrW(hwnd, GWL_STYLE));
  if ((style & WS_CAPTION) === WS_CAPTION || (style & WS_THICKFRAME)) return false;

  const monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  if (toHandle(monitor) !== toHandle(MonitorFromWindow(islandHwnd, MONITOR_DEFAULTTONEAREST))) return false;

  const rect = {};
  const info = { cbSize: koffi.sizeof(MONITORINFO) };
  if (!GetWindowRect(hwnd, rect) || !GetMonitorInfoW(monitor, info)) return false;
  const screen = info.rcMonitor;
  return rect.left <= screen.left && rect.top <= screen.top
    && rect.right >= screen.right && rect.bottom >= screen.bottom;
}

/**
 * Whether clicks activate the window. Electron's setFocusable(false) also
 * deactivates the window, which hands focus to some other window; flipping
 * the style bit directly has no such side effect.
 */
function setNoActivate(hwnd, noActivate) {
  const style = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  SetWindowLongPtrW(hwnd, GWL_EXSTYLE, noActivate ? style | WS_EX_NOACTIVATE : style & ~WS_EX_NOACTIVATE);
}

/** Brings a window to the front; only works while our process may set the foreground. */
function focusWindow(hwnd) {
  if (!hwnd || !IsWindow(hwnd)) return false;
  SetForegroundWindow(hwnd);
  return foregroundWindow() === hwnd;
}

function sendPaste() {
  keybd_event(VK_CONTROL, 0, 0, 0);
  keybd_event(VK_V, 0, 0, 0);
  keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0);
  keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
}

module.exports = { handleOf, foregroundWindow, isForegroundFullscreen, setNoActivate, focusWindow, sendPaste, className };
