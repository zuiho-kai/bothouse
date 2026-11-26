'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('deviceHost', {
  probe: token => ipcRenderer.invoke('robot-device:probe', token),
  read: () => ipcRenderer.invoke('robot-device:read'),
  write: (generation, bytes) => ipcRenderer.invoke('robot-device:write', generation, bytes),
  delivery: value => ipcRenderer.invoke('robot-device:delivery', value),
  touched: (generation, token, kind) => ipcRenderer.invoke('robot-device:touch', generation, token, kind),
  fault: code => ipcRenderer.invoke('robot-device:fault', code),
  onCheck: callback => { ipcRenderer.on('robot-device:check', () => callback()); },
});
