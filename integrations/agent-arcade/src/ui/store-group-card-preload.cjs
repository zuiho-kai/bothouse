'use strict';
const {contextBridge,ipcRenderer}=require('electron');
if(process.isMainFrame&&location.protocol==='file:'){
  contextBridge.exposeInMainWorld('cardReview',{
    list:()=>ipcRenderer.invoke('arcade:reviewGroupCard',{action:'list'}),
    preview:id=>ipcRenderer.invoke('arcade:reviewGroupCard',{action:'preview',id}),
    accept:(id,indexes,sharePortrait)=>ipcRenderer.invoke('arcade:reviewGroupCard',{action:'accept',id,indexes,sharePortrait}),
    cancel:()=>ipcRenderer.invoke('arcade:reviewGroupCard',{action:'cancel'}),
  });
}
