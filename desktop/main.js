// Learn with Kiko for Windows: the same app in its own window, fully offline (voice, pictures and progress
// are all on this computer). The kid lock switches the window to kiosk mode, so it fills the screen and
// can't be closed until a grown-up unlocks it with the PIN.
const { app, BrowserWindow, protocol, session, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

protocol.registerSchemesAsPrivileged([{ scheme: 'kiko', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const ROOT = path.join(__dirname, 'app');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.css': 'text/css',
};
let win = null;
let locked = false;
// Kiko's voice engine (see tts.mjs): the model sits next to the app, outside the app archive
const TTS_DIR = app.isPackaged ? path.join(process.resourcesPath, 'tts') : path.join(__dirname, 'tts');
let ttsMod = null;
async function voiceEngine() {
  if (ttsMod === null) {
    try { const m = require('./tts.js'); ttsMod = m.available(TTS_DIR) ? m : false; } catch (err) { console.error('voice engine:', err?.message || err); ttsMod = false; }
  }
  return ttsMod || null;
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600, title: 'Learn with Kiko', backgroundColor: '#D9F1FF',
    icon: path.join(ROOT, 'icons', 'icon-512.png'), autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false },
  });
  win.removeMenu();
  win.once('ready-to-show', () => {
    win.show();
    setTimeout(() => { voiceEngine().then((t) => t && t.synth(TTS_DIR, 'Hi.')).catch(() => {}); }, 3000);
  });
  win.loadURL('kiko://app/index.html');
  // while the kid lock is on, the window can't be closed
  win.on('close', (e) => { if (locked) e.preventDefault(); });
  // links to websites open in the normal browser, never inside Kiko
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url) && !locked) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('kiko://')) { e.preventDefault(); if (/^https?:/.test(url) && !locked) shell.openExternal(url); } });
}

app.whenReady().then(() => {
  protocol.handle('kiko', (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname || '/');
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) return new Response('Not allowed', { status: 403 });
    try {
      return new Response(fs.readFileSync(file), { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'fullscreen', 'clipboard-sanitized-write'].includes(perm)));
  // Kiko's natural voice for anything that wasn't recorded ahead of time (made here, no internet needed)
  ipcMain.handle('kiko:tts', async (e, text, speed) => {
    if (typeof text !== 'string' || !text.trim() || text.length > 6000) return null;
    try {
      const tts = await voiceEngine();
      if (!tts) return null;
      return await tts.synth(TTS_DIR, text, { speed: Number(speed) > 0 ? Number(speed) : undefined });
    } catch (err) { console.error('voice:', err?.message || err); return null; }
  });
  ipcMain.handle('kiko:kiosk', (e, on) => {
    locked = !!on;
    if (win) { win.setKiosk(locked); win.setAlwaysOnTop(locked, 'screen-saver'); if (locked) win.focus(); }
    return locked;
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());
