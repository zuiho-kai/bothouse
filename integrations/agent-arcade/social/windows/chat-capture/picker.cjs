'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { BrowserWindow, desktopCapturer, session } = require('electron');

// Only this packaged local document gets a display source. The networked chat
// page receives the approved PNG and never receives a title list or a stream.
async function pickChatCrop(parent, signal) {
  if (signal.aborted || parent.isDestroyed()) return null;
  const file = path.join(__dirname, 'picker.html');
  const url = pathToFileURL(file).href;
  const captureSession = session.fromPartition('arcade-local-crop', { cache: false });
  const win = new BrowserWindow({ parent, modal: true, width: 840, height: 660,
    minWidth: 380, minHeight: 320, title: '应用内截图', autoHideMenuBar: true, show: false,
    webPreferences: { session: captureSession, preload: path.join(__dirname, 'capture.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.removeMenu();
  const contents = win.webContents;
  const current = frame => !signal.aborted && !win.isDestroyed() &&
    frame === contents.mainFrame && frame.url === url;
  const close = () => { if (!win.isDestroyed()) win.destroy(); };
  signal.addEventListener('abort', close, { once: true });
  const closed = new Promise(resolve => win.once('closed', resolve));
  let sources = [], result = null, capturing = false;
  try {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => event.preventDefault());
    contents.once('render-process-gone', close);
    contents.ipc.handle('crop:choices', async event => {
      if (!current(event.senderFrame)) return [];
      // Electron skips thumbnail and app-icon capture at this size.
      sources = await desktopCapturer.getSources({ types: ['window','screen'],
        thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
      if (!current(event.senderFrame)) return [];
      sources = sources.filter(source => source.id !== win.getMediaSourceId());
      return sources.map(source => ({ name: source.name, screen: source.id.startsWith('screen:') }));
    });
    captureSession.setDisplayMediaRequestHandler(async (request, answer) => {
      let grant = null;
      try {
        if (current(request.frame) && request.userGesture && request.videoRequested &&
            !request.audioRequested && !capturing) {
          const index = await contents.executeJavaScript("document.getElementById('target').selectedIndex - 1");
          if (current(request.frame) && sources[index]) {
            capturing = true;
            win.hide();
            grant = { video: sources[index] };
          }
        }
      } catch { /* The picker may close while its selected source is being read. */ }
      finally { answer(grant); }
    });
    contents.ipc.on('crop:cancel', event => { if (current(event.senderFrame)) close(); });
    contents.ipc.on('crop:framed', event => {
      if (current(event.senderFrame)) { capturing = false; win.show(); }
    });
    contents.ipc.on('crop:accept', (event, bytes) => {
      if (!current(event.senderFrame) || !(bytes instanceof Uint8Array) ||
          !bytes.byteLength || bytes.byteLength > 4*1024*1024) return;
      result = bytes;
      close();
    });
    await win.loadFile(file);
    if (!signal.aborted && !win.isDestroyed()) win.show();
    await closed;
    return signal.aborted ? null : result;
  } finally {
    signal.removeEventListener('abort', close);
    captureSession.setDisplayMediaRequestHandler(null);
    close();
  }
}
module.exports = { pickChatCrop };
