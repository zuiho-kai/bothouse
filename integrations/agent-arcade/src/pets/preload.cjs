'use strict';

const {contextBridge, ipcRenderer} = require('electron');

function listen(name, handler) {
  ipcRenderer.on('arcade-pet:' + name, (_event, value) => handler(value));
}

contextBridge.exposeInMainWorld('pet', {
  init: () => ipcRenderer.invoke('arcade-pet:init'),
  close: () => ipcRenderer.invoke('arcade-pet:close'),
  onState: handler => listen('state', handler),
  onReply: handler => listen('reply', handler),
});
