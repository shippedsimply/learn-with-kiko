// What the app can ask of Windows: switch the kid lock (kiosk mode) on or off, and say a line in Kiko's
// natural voice (made on this computer, for lines that weren't recorded ahead of time).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('kikoDesktop', {
  isDesktop: true,
  setKiosk: (on) => ipcRenderer.invoke('kiko:kiosk', !!on),
  tts: (text, speed) => ipcRenderer.invoke('kiko:tts', String(text), Number(speed) || 0),
});
