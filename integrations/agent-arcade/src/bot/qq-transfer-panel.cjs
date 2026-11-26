'use strict';
// Main-owned optional-helper settings and Session handoff; no arbitrary request IPC.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash,X509Certificate}=require('node:crypto');
const {transferRequest,transferResult}=require('./qq-transfer-session.cjs');
const clone=v=>structuredClone(v);
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>plain(v)&&Object.keys(v).every(k=>keys.includes(k));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const fail=code=>{throw Object.assign(Error(`Transfer panel: ${code}`),{code});};
const SESSION_METHODS=Object.freeze({Open:'open',List:'list',PickUpload:'pickUpload',Preview:'preview',Confirm:'confirm',Resume:'resume',Reconcile:'reconcile',Finish:'finish',Pause:'pause',Dismiss:'dismiss'});
const SAFE_CODES=new Set(('invalid_request invalid_config invalid_registration invalid_origin invalid_trust invalid_ca invalid_pin helper_registered registration_limit helper_not_found remote_not_found registration_changed operation_in_progress operation_closed credentials_locked encryption_unavailable storage_limit storage_write_unknown unsafe_storage changed closed scope_unavailable ca_selection_expired file_invalid file_too_large picker_unavailable rotation_unresolved account_unverified account_changed unsupported_version stale_observation files_unavailable cancelled unauthorized unavailable address_rejected tls_failed response_invalid invalid_response expired busy limit quota unsupported source_changed target_exists scope_changed integrity_failed offset_conflict job_exists not_complete already_finalized recovery_required cleanup_unconfirmed storage_failed range_invalid validator_mismatch instance_mismatch not_found').split(' '));
for(const code of require('./qq-transfer-client.cjs').CODES)SAFE_CODES.add(code);
function readCA(file){
 if(typeof file!=='string'||!path.isAbsolute(file))fail('file_invalid');let fd;
 try{
  const before=fs.lstatSync(file,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n)fail('file_invalid');if(before.size>65536n)fail('file_too_large');
  fd=fs.openSync(file,'r');const own=fs.fstatSync(fd,{bigint:true});if(!own.isFile()||own.dev!==before.dev||own.ino!==before.ino||own.size!==before.size||own.nlink!==1n)fail('file_invalid');
  const bytes=Buffer.alloc(Number(own.size)+1);let n=0;while(n<bytes.length){const count=fs.readSync(fd,bytes,n,bytes.length-n,null);if(!count)break;n+=count;}
  const end=fs.fstatSync(fd,{bigint:true}),after=fs.lstatSync(file,{bigint:true});if(n!==Number(own.size)||[end,after].some(s=>!s.isFile()||s.isSymbolicLink()||s.dev!==own.dev||s.ino!==own.ino||s.nlink!==1n||s.size!==own.size||s.mtimeNs!==own.mtimeNs))fail('file_invalid');
  const value=bytes.subarray(0,n);if(value.includes(0)||!Buffer.from(value.toString('utf8')).equals(value))fail('file_invalid');return value;
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
class QQTransferPanel {
 constructor({links,jobs,captureParent,verifyParent,pickCA,validateTrust,sessionFactory,now=Date.now,monotonic=()=>performance.now()}={}){
  if(!links||!jobs||typeof captureParent!=='function'||typeof verifyParent!=='function'||typeof validateTrust!=='function'||typeof sessionFactory!=='function')fail('invalid_config');
  Object.assign(this,{links,jobs,captureParent,verifyParent,pickCA,validateTrust,now,monotonic,panel:null,generation:0,pending:null,ca:null,closed:false,retiring:Promise.resolve(),retiringOwner:null});
  this.session=sessionFactory({links,jobs,captureContext:()=>this._context(),verifyScope:(captured,options)=>this._verify(captured,options)});
 }
 _request(input,extra=[]){if(!exact(input,['remoteId','panelId',...extra])||!uuid(input.remoteId)||!uuid(input.panelId))fail('invalid_request');}
 _parent(input){const raw=this.captureParent({remoteId:input.remoteId,panelId:input.panelId});if(raw?.then){raw.catch?.(()=>{});fail('invalid_config');}if(!plain(raw)||raw.remoteId!==input.remoteId||raw.panelId!==input.panelId||!plain(raw.entry)||raw.entry.remoteId!==input.remoteId||!uuid(raw.entry.revision))fail('changed');return raw;}
 _assert(input){
  if(this.closed)fail('closed');const p=this.panel;if(!p||p.remoteId!==input.remoteId||p.panelId!==input.panelId||p.generation!==this.generation)fail('changed');
  const parent=this._parent(input);if(digest(parent)!==p.parentDigest)fail('changed');return {panel:p,parent};
 }
 _context(){if(!this.panel)fail('scope_unavailable');const {panel,parent}=this._assert(this.panel);return {remoteId:panel.remoteId,panelId:panel.panelId,generation:panel.generation,parentDigest:panel.parentDigest,remoteRevision:parent.entry.revision};}
 async _verify(captured,options){
  const context=this._context();if(!plain(captured)||!plain(captured.entry)||digest(captured.context)!==digest(context))fail('changed');
  const entry=this.links.capture(captured.entry.helperId);if(digest(entry)!==digest(captured.entry)||entry.remoteId!==context.remoteId||entry.remoteRevision!==context.remoteRevision)fail('registration_changed');
  const check=()=>{if(digest(this._context())!==digest(context))fail('changed');options.assertCurrent();};check();
  const result=await this.verifyParent({remoteId:context.remoteId,panelId:context.panelId,remoteRevision:entry.remoteRevision},{signal:options.signal,assertCurrent:check});check();
  if(result?.verified!==true)fail('account_unverified');return {verified:true};
 }
 async result(input,operation){
  const base={panelId:uuid(input?.panelId)?input.panelId:null,remoteId:uuid(input?.remoteId)?input.remoteId:null};
  try{return {ok:true,...base,...await operation()};}catch(e){return {ok:false,...base,code:SAFE_CODES.has(e?.code)?e.code:'transfer_failed'};}
 }
 async settings(input){
  this._request(input);if(this.closed)fail('closed');if(this.pending)fail('operation_in_progress');const parent=this._parent(input),parentDigest=digest(parent);
  if(!this.panel||this.panel.remoteId!==input.remoteId||this.panel.panelId!==input.panelId||this.panel.parentDigest!==parentDigest){
   const closing=this.closeCurrent(),generation=this.generation;await closing;if(this.closed)fail('closed');if(this.generation!==generation)fail('changed');
   const fresh=this._parent(input);if(digest(fresh)!==parentDigest)fail('changed');this.panel={...input,parentDigest,generation:++this.generation};
  }
  this._assert(input);const registry=this.links.snapshot();let jobs;
  try{const items=await this.jobs.list();if(!Array.isArray(items))fail('invalid_response');jobs={state:'ready',items:items.filter(v=>v.remoteId===input.remoteId).map(v=>{
   const scope=this.jobs.get(v.jobId).scope,link=registry.items.find(e=>e.helperId===v.helperId);
   const current=link&&link.remoteId===input.remoteId&&link.remoteRevision===parent.entry.revision&&scope.remoteRevision===link.remoteRevision&&
    scope.helperRevision===link.revision&&['origin','instanceId','trustRevision','credentialRevision'].every(k=>scope[k]===link[k])&&v.expiresAt>this.now();
   return current?v:{...v,canResume:false,canReconcile:false,canFinish:false};
  })};}catch(e){if(e?.code!=='transfer_locked')throw e;jobs={state:'locked',items:[]};}
  this._assert(input);
  return {links:{state:registry.state,items:registry.items.filter(v=>v.remoteId===input.remoteId).map(v=>({...v,parentChanged:v.remoteRevision!==parent.entry.revision}))},jobs};
 }
 _busy(input,operation){
  const {panel}=this._assert(input);if(this.pending)fail('operation_in_progress');const check=()=>{if(this._assert(input).panel!==panel)fail('changed');};
  const work=Promise.resolve().then(()=>operation(check));this.pending=work;return work.finally(()=>{if(this.pending===work)this.pending=null;});
 }
 _trust(value,input){
  if(!exact(value,['caSelectionId','spkiSha256']))fail('invalid_request');const trust={};
  if(value.caSelectionId!==undefined){const c=this.ca;if(!uuid(value.caSelectionId)||!c||c.selectionId!==value.caSelectionId||c.remoteId!==input.remoteId||c.panelId!==input.panelId||c.generation!==this.generation||this.monotonic()>=c.deadline)fail('ca_selection_expired');trust.caPem=c.pem;}
  if(value.spkiSha256!==undefined)trust.spkiSha256=value.spkiSha256;return this.validateTrust(trust);
 }
 create(input){
  this._request(input,['value']);if(!exact(input.value,['label','origin','instanceId','token','trust']))fail('invalid_request');
  return this._busy(input,async check=>{await this.session.closeCurrent();check();const parent=this._parent(input);const link=this.links.create({...input.value,remoteId:input.remoteId,remoteRevision:parent.entry.revision,trust:this._trust(input.value.trust??{},input)});this.ca=null;return {link};});
 }
 update(input){
  this._request(input,['helperId','revision','patch']);if(!uuid(input.helperId)||!uuid(input.revision)||!exact(input.patch,['label','origin','instanceId','token','trust']))fail('invalid_request');
  return this._busy(input,async check=>{const old=this.links.capture(input.helperId);if(old.remoteId!==input.remoteId)fail('changed');await this.session.closeCurrent();check();const patch={...input.patch,remoteRevision:this._parent(input).entry.revision};if('trust'in patch)patch.trust=this._trust(patch.trust,input);const link=this.links.update({helperId:input.helperId,revision:input.revision,patch});this.ca=null;return {link};});
 }
 forget(input){
  this._request(input,['helperId','revision']);if(!uuid(input.helperId)||!uuid(input.revision))fail('invalid_request');
  return this._busy(input,async check=>{if(this.links.capture(input.helperId).remoteId!==input.remoteId)fail('changed');await this.session.closeCurrent();check();const result=this.links.forget({helperId:input.helperId,revision:input.revision});this.ca=null;return {...result,jobsRetained:true};});
 }
 forgetJob(input){
  this._request(input,['jobId']);if(!uuid(input.jobId))fail('invalid_request');
  return this._busy(input,async check=>{check();const job=this.jobs.get(input.jobId);if(job.scope.remoteId!==input.remoteId)fail('changed');const result=await this.jobs.forgetCompleted(input.jobId,{assertCurrent:check});if(result?.forgotten!==true)fail('transfer_storage_unknown');return {forgotten:true,jobId:input.jobId};});
 }
 pickCAFile(input){
  this._request(input);return this._busy(input,async check=>{this.ca=null;check();if(typeof this.pickCA!=='function')fail('picker_unavailable');const file=await this.pickCA({assertCurrent:check});check();if(file===null)return {cancelled:true};const bytes=readCA(file),pem=bytes.toString('utf8');this.validateTrust({caPem:pem});const cert=new X509Certificate(pem),selectionId=randomUUID(),expiresAt=this.now()+300000;check();this.ca={selectionId,remoteId:input.remoteId,panelId:input.panelId,generation:this.generation,pem,deadline:this.monotonic()+300000};return {ca:{selectionId,sha256:createHash('sha256').update(bytes).digest('hex'),subject:cert.subject.slice(0,512),expiresAt}};});
 }
 call(method,input){
  return this.result(input,async()=>{if(!Object.values(SESSION_METHODS).includes(method))fail('invalid_request');transferRequest(input,method);this._assert(input);if(this.pending)fail('operation_in_progress');if(this.links.capture(input.helperId).remoteId!==input.remoteId)fail('changed');return transferResult(input,method,await this.session[method](input));});
 }
 closeOwned(input){this._request(input);const owner=this.panel??this.retiringOwner;if(!owner||owner.remoteId!==input.remoteId||owner.panelId!==input.panelId)return Promise.resolve({closed:true});return this.closeCurrent();}
 closeCurrent(){
  this.retiringOwner=this.panel??this.retiringOwner;this.panel=null;this.ca=null;const generation=++this.generation,closing=this.session.closeCurrent();
  const work=Promise.allSettled([this.retiring,this.pending,closing]).then(results=>{if(results[2].status==='rejected')throw results[2].reason;if(this.generation===generation)this.retiringOwner=null;return {closed:true};});work.catch(()=>{});this.retiring=work;return work;
 }
 observe(){if(this.panel)try{this._assert(this.panel);}catch{void this.closeCurrent();}}
 async close(){this.closed=true;const results=await Promise.allSettled([this.closeCurrent(),this.session.close()]);const failed=results.find(v=>v.status==='rejected');if(failed)throw failed.reason;return {closed:true};}
}
module.exports={QQTransferPanel,SESSION_METHODS};
