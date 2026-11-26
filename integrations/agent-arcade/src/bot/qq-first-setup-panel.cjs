'use strict';

// Owns a single visible setup drawer. Executable paths and package operations
// stay in its main-process coordinator, never in the global UI snapshot.
const fail=code=>{throw Object.assign(Error('QQ setup panel is unavailable.'),{code});};
const ID=/^[a-zA-Z0-9-]{1,64}$/;
function request(value,{close=false}={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||!ID.test(value.accountId||'')||!ID.test(value.panelId||'')||typeof value.accountId!=='string'||typeof value.panelId!=='string')fail('invalid_request');
  if(close&&Object.keys(value).some(key=>!['accountId','panelId'].includes(key)))fail('invalid_request');
  if(!close&&typeof value.action!=='string')fail('invalid_request');
  return value;
}
class QQFirstSetupPanel{
  constructor({capture,create}){this.capture=capture;this.create=create;this.panel=null;this.closing=null;}
  binding(panel){
    if(this.panel!==panel)fail('changed');
    const current=this.capture({accountId:panel.accountId,panelId:panel.panelId});
    if(typeof current!=='string'||!current||current!==panel.binding)fail('changed');
    return current;
  }
  async execute(value){
    request(value);if(this.closing)fail('operation_in_progress');
    let panel=this.panel;
    if(panel&&(panel.accountId!==value.accountId||panel.panelId!==value.panelId))fail('changed');
    if(!panel){
      if(value.action!=='status')fail('preview_required');
      const binding=this.capture(value);if(typeof binding!=='string'||!binding)fail('changed');
      panel={accountId:value.accountId,panelId:value.panelId,binding};this.panel=panel;
      try{panel.coordinator=this.create({capture:()=>this.binding(panel)});}catch(error){this.panel=null;throw error;}
    }
    this.binding(panel);
    const {accountId,panelId,...operation}=value;
    const result=await panel.coordinator.execute(operation);
    // Switching the installation changes its epoch. A committed mutation must
    // remain a committed result even if the view closes or changes afterwards.
    if(result?.committed!==true)this.binding(panel);
    return result;
  }
  close(){
    const panel=this.panel;this.panel=null;
    if(!panel)return this.closing||Promise.resolve({closed:true});
    const operation=Promise.resolve().then(()=>panel.coordinator.close()).then(()=>({closed:true}));
    this.closing=operation;
    void operation.finally(()=>{if(this.closing===operation)this.closing=null;}).catch(()=>{});
    return operation;
  }
  closeOwned(value){request(value,{close:true});const panel=this.panel;if(!panel||panel.accountId!==value.accountId||panel.panelId!==value.panelId)return Promise.resolve({closed:true});return this.close();}
  observe(){if(this.panel){try{this.binding(this.panel);}catch{void this.close().catch(()=>{});}}}
}
module.exports={QQFirstSetupPanel};
