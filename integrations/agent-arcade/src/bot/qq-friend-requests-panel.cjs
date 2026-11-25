'use strict';
// Main-only panel capability. The connection owns its inbox; closing a drawer
// aborts only this panel's decision and never discards connection collection.
const {QQFriendRequestsError,codeOf}=require('./qq-friend-requests.cjs');
const fail=code=>{throw new QQFriendRequestsError(code);};
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const qq=value=>typeof value==='string'&&/^[1-9]\d{4,14}$/.test(value)&&Number.isSafeInteger(Number(value));
const stamp=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const safeText=value=>typeof value==='string'&&value.length<=500&&!/[\p{Cc}\p{Cf}\p{Surrogate}\u2028\u2029]/u.test(value);
const identityKeys=['service','generation','scopeId','client','clientGeneration','socket','qqAccountId','ownerId','console','runtime','epoch','inbox'];
const same=(a,b)=>identityKeys.every(key=>a[key]===b[key]);
const correlation=panel=>({accountId:panel.accountId,panelId:panel.panelId});
function request(value,decide=false){
  const keys=['accountId','panelId',...(decide?['requestId','approve']:[])];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||!id(value.accountId)||!uuid(value.panelId)||(decide&&(!uuid(value.requestId)||typeof value.approve!=='boolean')))fail('invalid_request');
  return value;
}
function normalizeCapture(value){
  if(!value||!qq(value.qqAccountId)||!qq(value.ownerId)||value.qqAccountId===value.ownerId||typeof value.inbox?.list!=='function'||typeof value.inbox?.decide!=='function')fail('disconnected');
  return {...value,socket:value.client?.socket};
}
function readResult(value,panel){
  if(!value||value.source!=='current-connection-events'||value.complete!==false||typeof value.available!=='boolean'||typeof value.overflow!=='boolean'||!Array.isArray(value.items)||value.items.length>100)fail('invalid_response');
  const inbox={source:'current-connection-events',complete:false,available:value.available,overflow:value.overflow,items:[]};
  if(!value.available){if(value.items.length)fail('invalid_response');return {...correlation(panel),kind:'friend-requests',inbox};}
  if(value.accountId!==panel.qqAccountId||!stamp(value.connectedAt)||typeof value.busy!=='boolean'||new Set(value.items.map(row=>row?.requestId)).size!==value.items.length)fail('invalid_response');
  inbox.accountId=panel.qqAccountId;inbox.connectedAt=value.connectedAt;inbox.busy=value.busy;
  for(const row of value.items){
    if(!row||!uuid(row.requestId)||!qq(row.applicantId)||row.applicantId===panel.qqAccountId||!safeText(row.comment)||!stamp(row.receivedAt)||!stamp(row.expiresAt)||Date.parse(row.expiresAt)<=Date.parse(row.receivedAt)||Date.parse(row.expiresAt)-Date.parse(row.receivedAt)>300000)fail('invalid_response');
    inbox.items.push({requestId:row.requestId,applicantId:row.applicantId,comment:row.comment,receivedAt:row.receivedAt,expiresAt:row.expiresAt});
  }
  return {...correlation(panel),kind:'friend-requests',inbox};
}
function decisionResult(value,panel,input){
  const base={...correlation(panel),kind:'friend-request',qqAccountId:panel.qqAccountId,requestId:input.requestId,approve:input.approve};
  if(value?.kind!=='friend-request'||value.accountId!==panel.qqAccountId||value.requestId!==input.requestId||value.approve!==input.approve||!['accepted','unknown','not_submitted'].includes(value.outcome))return {...base,outcome:'unknown',code:'unknown'};
  return {...base,outcome:value.outcome,...(value.outcome==='accepted'?{}:{code:value.outcome==='unknown'?'unknown':codeOf(value)})};
}
class QQFriendRequestsPanel {
  constructor({capture}={}){if(typeof capture!=='function')fail('invalid_request');this.capture=capture;this.panel=null;this.retiring=Promise.resolve();}
  _capture(value){return normalizeCapture(this.capture(value));}
  _assert(panel){if(this.panel!==panel||panel.abort.signal.aborted)fail('changed');const current=this._capture(correlation(panel));if(!same(current,panel))fail('changed');return current;}
  async read(value){
    request(value);const captured=this._capture(value);let panel=this.panel;
    if(!panel||panel.accountId!==value.accountId||panel.panelId!==value.panelId||!same(panel,captured)){
      const closing=this.close();panel={...captured,...correlation(value),abort:new AbortController(),operations:new Set()};this.panel=panel;
      await closing;this._assert(panel);
    }
    this._assert(panel);const result=await panel.inbox.list();this._assert(panel);return readResult(result,panel);
  }
  async decide(value){
    request(value,true);const panel=this.panel;if(!panel||panel.accountId!==value.accountId||panel.panelId!==value.panelId)fail('stale_request');this._assert(panel);
    const input={requestId:value.requestId,approve:value.approve};
    const operation=Promise.resolve().then(async()=>{
      this._assert(panel);
      // The inbox consumes its request before its first await. Once invoked, a
      // thrown result cannot establish that no external action happened.
      try{return decisionResult(await panel.inbox.decide(input,{signal:panel.abort.signal,assertCurrent:()=>this._assert(panel)}),panel,input);}
      catch{return decisionResult(null,panel,input);}
    });
    panel.operations.add(operation);try{return await operation;}finally{panel.operations.delete(operation);}
  }
  closeOwned(value){request(value);if(this.panel?.accountId!==value.accountId||this.panel?.panelId!==value.panelId)return Promise.resolve({closed:true});return this.close();}
  close(){
    const panel=this.panel;this.panel=null;panel?.abort.abort();
    if(!panel)return this.retiring.then(()=>({closed:true}));
    const operation=Promise.allSettled([this.retiring,...panel.operations]).then(()=>({closed:true}));this.retiring=operation;return operation;
  }
  observe(){if(this.panel){try{this._assert(this.panel);}catch{void this.close();}}}
}
const friendRequestsResult=async operation=>{try{return {ok:true,...await operation()};}catch(error){return {ok:false,code:codeOf(error)};}};
module.exports={QQFriendRequestsPanel,friendRequestsResult};
