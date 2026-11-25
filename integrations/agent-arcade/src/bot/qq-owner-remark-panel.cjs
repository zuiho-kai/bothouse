'use strict';
// Main-only panel ownership. No contact contents enter application snapshots.
const {QQOwnerRemark,QQOwnerRemarkError,validateRemark}=require('./qq-owner-remark.cjs');
const fail=code=>{throw new QQOwnerRemarkError(code);};
const codeOf=error=>new QQOwnerRemarkError(error?.code).code;
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(value);
const ticket=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const date=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
function request(value,mode='read'){
  const keys=['accountId','panelId',...(['set','restore'].includes(mode)?['ticketId']:[]),...(mode==='set'?['remark']:[])];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||!id(value.accountId)||!id(value.panelId))fail('invalid_request');
  if(['set','restore'].includes(mode)&&!ticket(value.ticketId))fail('invalid_request');
  if(mode==='set')validateRemark(value.remark);
  return value;
}
const identityKeys=['service','generation','scopeId','client','clientGeneration','qqAccountId','ownerId','role','console','runtime','epoch'];
const same=(a,b)=>identityKeys.every(key=>a[key]===b[key]);
const correlation=panel=>({accountId:panel.accountId,panelId:panel.panelId});
const recipient=panel=>({accountId:panel.qqAccountId,ownerId:panel.ownerId,role:panel.role});
function readResult(value,panel){
  if(!value||value.kind!=='owner-remark'||typeof value.editable!=='boolean'||value.recipient?.accountId!==panel.qqAccountId||value.recipient?.ownerId!==panel.ownerId||value.recipient?.role!==panel.role)fail('invalid_response');
  const observed=value.observed;
  if(!observed||observed.source!=='bridge-cache'||typeof observed.nickname!=='string'||observed.nickname.length>128||/[\p{Cc}\p{Cf}\uD800-\uDFFF]/u.test(observed.nickname)||!date(observed.fetchedAt))fail('invalid_response');
  const result={...correlation(panel),kind:'owner-remark',recipient:recipient(panel),editable:value.editable,
    observed:{nickname:observed.nickname,fetchedAt:observed.fetchedAt,source:'bridge-cache'},restore:{available:false}};
  if(value.editable){
    if(!ticket(value.ticketId)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now())fail('invalid_response');
    result.observed.remark=validateRemark(observed.remark);result.ticketId=value.ticketId;result.expiresAt=value.expiresAt;
    if(value.restore?.available===true)result.restore={available:true,value:validateRemark(value.restore.value)};
  }else{
    if(observed.withheld!==true||value.reason!=='original_unsupported')fail('invalid_response');
    result.observed.withheld=true;result.reason='original_unsupported';
  }
  return result;
}
function writeResult(value,panel,ticketId){
  const base={...correlation(panel),kind:'owner-remark',ticketId,observation:{state:'unavailable',source:'bridge-cache'}};
  if(value?.kind!=='owner-remark'||value.ticketId!==ticketId||!['accepted','unknown','not_submitted'].includes(value.outcome))return {...base,outcome:'unknown',code:'change_unknown'};
  if(value.outcome!=='accepted')return {...base,outcome:value.outcome,code:value.outcome==='unknown'?'change_unknown':codeOf(value)};
  // Acceptance belongs to the captured operation even after closing/switching.
  // A malformed cache observation cannot rewrite that acceptance as failure.
  const observation=value.observation;
  if(['observed_match','observed_different'].includes(observation?.state)&&observation.source==='bridge-cache'&&date(observation.fetchedAt)){
    try{base.observation={state:observation.state,remark:validateRemark(observation.remark),fetchedAt:observation.fetchedAt,source:'bridge-cache'};}catch{}
  }
  return {...base,outcome:'accepted'};
}
class QQOwnerRemarkPanel {
  constructor({capture,onChange=()=>{},controllerFactory=options=>new QQOwnerRemark(options)}={}){
    if(typeof capture!=='function'||typeof onChange!=='function'||typeof controllerFactory!=='function')fail('invalid_request');
    Object.assign(this,{capture,onChange,controllerFactory});this.panel=null;this.retiring=Promise.resolve();
  }
  _notify(){try{this.onChange();}catch{}}
  _assert(panel){
    if(this.panel!==panel||panel.abort.signal.aborted)fail('changed');
    const current=this.capture(correlation(panel));if(!same(current,panel))fail('changed');return current;
  }
  availability(value){
    request(value);try{const captured=this.capture(value);return {...correlation(value),available:true,recipient:recipient(captured)};}
    catch(error){return {...correlation(value),available:false,reason:codeOf(error)};}
  }
  async read(value){
    request(value);const captured=this.capture(value);let panel=this.panel;
    if(!panel||panel.accountId!==value.accountId||panel.panelId!==value.panelId||!same(panel,captured)){
      const closing=this.close();panel={...captured,...correlation(value),abort:new AbortController(),controller:null};this.panel=panel;
      await closing;this._assert(panel);
      panel.controller=this.controllerFactory({getBinding:()=>this._assert(panel).binding,onChange:()=>{if(this.panel===panel)this._notify();}});
    }
    this._assert(panel);if(!panel.controller)fail('operation_in_progress');
    const result=await panel.controller.read({signal:panel.abort.signal});this._assert(panel);return readResult(result,panel);
  }
  async _write(value,restore){
    request(value,restore?'restore':'set');const panel=this.panel;
    if(!panel||panel.accountId!==value.accountId||panel.panelId!==value.panelId||!panel.controller)fail('stale_ticket');this._assert(panel);
    const args={ticketId:value.ticketId,...(restore?{}:{remark:value.remark})};
    const result=await panel.controller[restore?'restore':'set'](args,{signal:panel.abort.signal});return writeResult(result,panel,value.ticketId);
  }
  set(value){return this._write(value,false);}
  restore(value){return this._write(value,true);}
  closeOwned(value){request(value);if(this.panel?.accountId!==value.accountId||this.panel?.panelId!==value.panelId)return Promise.resolve({closed:true});return this.close();}
  close(){
    const panel=this.panel;this.panel=null;panel?.abort.abort();
    if(!panel)return this.retiring.then(()=>({closed:true}));
    const operation=Promise.all([this.retiring,panel.controller?.close()]).then(()=>({closed:true}));this.retiring=operation;
    return operation.finally(()=>this._notify());
  }
  observe(){if(this.panel){try{this._assert(this.panel);}catch{void this.close().catch(()=>{});}}}
}
const ownerRemarkResult=async operation=>{try{return {ok:true,...await operation()};}catch(error){return {ok:false,code:codeOf(error)};}};
module.exports={QQOwnerRemarkPanel,ownerRemarkResult};
