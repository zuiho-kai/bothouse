'use strict';
// Bridge for the desk robot page. The companion's state comes in; a touch on
// the robot goes out. Nothing else is reachable from the page.
const {contextBridge, ipcRenderer} = require('electron');

const listen = channel => callback => { ipcRenderer.on(channel, (_event, value) => callback(value)); };
contextBridge.exposeInMainWorld('robotHost', {
  ready: () => ipcRenderer.send('robot:ready'),
  probe: token => ipcRenderer.send('robot:probe', token),
  touched: (token, kind) => ipcRenderer.send('robot:touch', {token, kind}),
  onCheck: listen('robot:check'),
  onPresence: listen('robot:presence'),
  onPulse: listen('robot:pulse'),
  onReaction: listen('robot:reaction'),
});
