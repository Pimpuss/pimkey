// Copie de texte exclue de l'historique du presse-papiers de Windows (Win + V) et de sa synchronisation entre
// appareils : le texte est posé avec les formats que Windows consulte (ExcludeClipboardContentFromMonitorProcessing,
// CanIncludeInClipboardHistory = 0, CanUploadToCloudClipboard = 0). Electron ne sait pas poser ces formats en même
// temps que le texte : on passe par l'API Windows (user32 / kernel32) avec koffi.
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const OpenClipboard = user32.func('bool __stdcall OpenClipboard(uintptr_t hWndNewOwner)');
const EmptyClipboard = user32.func('bool __stdcall EmptyClipboard()');
const CloseClipboard = user32.func('bool __stdcall CloseClipboard()');
const SetClipboardData = user32.func('void * __stdcall SetClipboardData(uint32_t uFormat, void *hMem)');
const RegisterClipboardFormatW = user32.func('uint32_t __stdcall RegisterClipboardFormatW(const char16_t *lpszFormat)');
const GlobalAlloc = kernel32.func('void * __stdcall GlobalAlloc(uint32_t uFlags, uintptr_t dwBytes)');
const GlobalLock = kernel32.func('void * __stdcall GlobalLock(void *hMem)');
const GlobalUnlock = kernel32.func('bool __stdcall GlobalUnlock(void *hMem)');
const GlobalFree = kernel32.func('void * __stdcall GlobalFree(void *hMem)');
const RtlMoveMemory = kernel32.func('void __stdcall RtlMoveMemory(void *dest, const void *src, uintptr_t length)');

const CF_UNICODETEXT = 13;
const GMEM_MOVEABLE = 0x0002;
const PRIVATE_FORMATS = ['ExcludeClipboardContentFromMonitorProcessing', 'CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard'];

// Bloc mémoire global contenant buf ; Windows en devient propriétaire une fois remis au presse-papiers
function toGlobal(buf) {
  const h = GlobalAlloc(GMEM_MOVEABLE, buf.length);
  if (!h) throw new Error('GlobalAlloc');
  RtlMoveMemory(GlobalLock(h), buf, buf.length);
  GlobalUnlock(h);
  return h;
}

function put(format, buf) {
  const h = toGlobal(buf);
  if (!SetClipboardData(format, h)) {
    GlobalFree(h);
    throw new Error('SetClipboardData');
  }
}

// Le presse-papiers peut être occupé un court instant par un autre programme : quelques essais
function open(hwnd) {
  for (let i = 0; i < 10; i++) {
    if (OpenClipboard(hwnd)) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
  }
  throw new Error('Presse-papiers occupé');
}

// hwnd : fenêtre propriétaire (BrowserWindow.getNativeWindowHandle()), nécessaire pour que Windows accepte les données
function writePrivateText(text, hwnd) {
  const handle = Buffer.isBuffer(hwnd) ? (hwnd.length >= 8 ? Number(hwnd.readBigUInt64LE(0)) : hwnd.readUInt32LE(0)) : hwnd || 0;
  const data = Buffer.from(`${text}\0`, 'utf16le');
  open(handle);
  try {
    EmptyClipboard();
    put(CF_UNICODETEXT, data);
    for (const name of PRIVATE_FORMATS) put(RegisterClipboardFormatW(name), Buffer.alloc(4)); // DWORD 0 : « non »
  } finally {
    CloseClipboard();
    data.fill(0);
  }
}

module.exports = { writePrivateText };
