'use strict';
// Bridge for the desktop pet page. It carries pointer positions, window moves
// and the companion's activity in, and a handful of intents out. No file,
// credential, conversation or network access is exposed here.
const {contextBridge, ipcRenderer} = require('electron');

const listen = channel => callback => { ipcRenderer.on(channel, (_event, value) => callback(value)); };
contextBridge.exposeInMainWorld('petHost', {
  ready: () => ipcRenderer.send('pet:ready'),
  failed: message => ipcRenderer.send('pet:failed', String(message).slice(0, 200)),
  setInteractive: value => ipcRenderer.send('pet:interactive', value === true),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  open: () => ipcRenderer.send('pet:open'),
  menu: () => ipcRenderer.send('pet:menu'),
  touched: kind => ipcRenderer.send('pet:touch', String(kind).slice(0, 16)),
  onPointer: listen('pet:pointer'),
  onMoved: listen('pet:moved'),
  onActivity: listen('pet:activity'),
  onGesture: listen('pet:gesture'),
});
