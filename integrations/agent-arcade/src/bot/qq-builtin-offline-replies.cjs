'use strict';
// Fixed, offline builtin reply switch. Never imports a plugin or starts QQ.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {scopeProjection,uuid}=require('./qq-plugin-admin.cjs');
const {tree,digest,assertPluginDeploymentReady,offlineIO:I}=require('./qq-plugin-deployment.cjs');
const PLUGIN='napcat-plugin-builtin',VERSION='1.0.0',MAX_CONFIG=65536,MAX_BACKUPS=64;
const FILES=Object.freeze({
 'index.mjs':{size:10368,sha256:'59b183352d3cf18f20162b1b5a8dcaeb91cd3aaa9e2dbd0f92bd80499daa4e55'},
 'package.json':{size:367,sha256:'c8d3e2b5abcb1168f8d035615a14b392565f6976037560e61824bdf21b7579b0'},
 'webui/dashboard.html':{size:12936,sha256:'69176d8e664d87de701be819469417d798a10552c50c442a7835dce86cc7e52b'},
 'webui/test.txt':{size:186,sha256:'f3ad0462c8878ca84e9f1264d9e6c7755b482643ca4a4de0fc4f9383464b7d7c'}
});
const CODES=Object.freeze(['invalid_request','changed','closed','cancelled','operation_in_progress','builtin_not_supported','plugin_not_disabled','config_invalid','config_changed','no_changes','backup_failed','write_unknown','history_full','unsafe_path','stale_observation','stale_ticket','expired_ticket','runtime_running','process_check_failed','runtime_locked','component_locked','component_changed','component_unavailable','desktop_running','component_lock_changed','configuration_changed','unsafe_lock','manager_closing','recovery_in_progress','deployment_recovery_required','configuration_marker_retained']);
class QQBuiltinOfflineRepliesError extends Error{constructor(code){code=CODES.includes(code)?code:'write_unknown';super(`Builtin reply preparation failed (${code}).`);this.code=code;}}
const fail=code=>{throw new QQBuiltinOfflineRepliesError(code);};
const mappedCodes=Object.freeze({deployment_changed:'config_changed',preferences_invalid:'config_invalid',preferences_unreadable:'config_invalid',package_too_large:'config_invalid'});
const safeCode=e=>CODES.includes(e?.code)?e.code:Object.hasOwn(mappedCodes,e?.code)?mappedCodes[e.code]:'write_unknown';
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==keys.slice().sort().join('|'))fail('invalid_request');};
const same=(a,b)=>digest(a)===digest(b);
const metadata=d=>({present:Object.hasOwn(d.value,'enableReply'),value:Object.hasOwn(d.value,'enableReply')?d.value.enableReply:null,effective:d.value.enableReply!==false});
class QQBuiltinOfflineReplies{
 constructor({workDir,configDir,scope,assertCurrent=()=>{},withDeploymentLock,now=Date.now,monotonic=()=>performance.now()}={}){
  this.workDir=I.local(workDir);this.configDir=I.local(configDir);
  if(!I.pathSame(this.configDir,path.join(this.workDir,'config'))||typeof withDeploymentLock!=='function'||typeof assertCurrent!=='function')fail('invalid_request');
  Object.assign(this,{scope:scopeProjection(scope),assertCurrent,withDeploymentLock,now,monotonic});
  this.pluginRoot=path.join(this.workDir,'plugins',PLUGIN);this.configRoot=path.join(this.configDir,'plugins',PLUGIN);this.configFile=path.join(this.configRoot,'config.json');
  this.backupRoot=path.join(this.workDir,'.agent-arcade-builtin-reply-backups');this.baseline=null;this.ticket=null;this.operation=null;this.closed=false;
 }
 _check(signal,ticket){if(this.closed)fail('closed');if(signal?.aborted)fail('cancelled');const result=this.assertCurrent();if(result?.then){result.catch?.(()=>{});fail('invalid_request');}if(ticket&&this.monotonic()>=ticket.deadline)fail('expired_ticket');}
 _state(){
  assertPluginDeploymentReady(this.workDir);
  const parents=[this.workDir,path.join(this.workDir,'plugins'),this.configDir,path.join(this.configDir,'plugins'),this.configRoot].map(file=>I.exists(file)?I.identity(I.safe(file,true)):null);
  if(!parents[0]||!parents[1]||!parents[2])fail('unsafe_path');
  const code=tree(this.pluginRoot);
  if(!code||code.rows.length!==6||code.files!==4||code.rows.some(row=>row.kind==='directory'?!['','webui'].includes(row.path):!FILES[row.path]||row.size!==FILES[row.path].size||row.sha256!==FILES[row.path].sha256))fail('builtin_not_supported');
  const preferences=I.jsonDocument(path.join(this.configDir,'plugins.json'));
  if(preferences.value[PLUGIN]!==false||!Object.hasOwn(preferences.value,PLUGIN))fail('plugin_not_disabled');
  const document=I.jsonDocument(this.configFile,MAX_CONFIG);
  if(Object.hasOwn(document.value,'enableReply')&&typeof document.value.enableReply!=='boolean')fail('config_invalid');
  return {parents,code,preferences:preferences.proof,config:document.proof,document};
 }
 _proof(s){return {parents:s.parents,code:s.code,preferences:s.preferences,config:s.config};}
 _public(){return {pluginId:PLUGIN,version:VERSION,enabled:false,scope:this.scope,requiresStopped:true,pluginStarted:false};}
 read({signal}={}){
  if(this.operation)fail('operation_in_progress');this._check(signal);this.dismiss();
  try{const state=this._state(),id=randomUUID();this.baseline={id,proof:this._proof(state),deadline:this.monotonic()+300000};return {kind:'builtin-offline-replies',observationId:id,fetchedAt:new Date(this.now()).toISOString(),...this._public(),before:metadata(state.document),unchanged:state.document.value.enableReply===false};}catch(e){throw new QQBuiltinOfflineRepliesError(safeCode(e));}
 }
 preview(value,{signal}={}){
  exact(value,['observationId']);if(!uuid(value.observationId))fail('invalid_request');if(this.operation)fail('operation_in_progress');this.discardPreview();this._check(signal);
  const baseline=this.baseline;if(!baseline||baseline.id!==value.observationId)fail('stale_observation');if(this.monotonic()>=baseline.deadline)fail('expired_ticket');
  try{
   const state=this._state();if(!same(baseline.proof,this._proof(state)))fail('config_changed');const d=state.document;if(d.value.enableReply===false)fail('no_changes');
   const range=d.ranges.enableReply,text=range?d.text.slice(0,range.start)+'false'+d.text.slice(range.end):d.text.slice(0,d.end)+(Object.keys(d.value).length?',':'')+'"enableReply":false'+d.text.slice(d.end),bytes=Buffer.from(text);
   if(bytes.length>MAX_CONFIG)fail('config_invalid');const ticketId=randomUUID();
   this.ticket={id:ticketId,proof:baseline.proof,bytes,hash:I.sha(bytes),beforeBytes:d.bytes,deadline:this.monotonic()+300000};
   return {kind:'builtin-offline-replies-preview',ticketId,observationId:baseline.id,expiresAt:this.now()+300000,...this._public(),before:metadata(d),after:{present:true,value:false,effective:false},backup:{willPreserve:true,originalPresent:!!d.proof},automaticRetry:false};
  }catch(e){throw new QQBuiltinOfflineRepliesError(safeCode(e));}
 }
 async confirm(value,{signal}={}){
  exact(value,['ticketId']);if(!uuid(value.ticketId))fail('invalid_request');if(this.operation)fail('operation_in_progress');
  const ticket=this.ticket;if(!ticket||ticket.id!==value.ticketId)fail('stale_ticket');this.ticket=null;this.baseline=null;
  const abort=new AbortController(),combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal;
  const op={abort,promise:null};this.operation=op;
  op.promise=this._confirm(ticket,combined).finally(()=>{ticket.bytes.fill(0);ticket.beforeBytes?.fill(0);if(this.operation===op)this.operation=null;});return op.promise;
 }
 async _confirm(ticket,signal){
  let attempted=false,backupId=null,preserved=false,receipt=null;
  const result=(outcome,code)=>({kind:'builtin-offline-replies-change',ticketId:ticket.id,...this._public(),outcome,committed:outcome==='committed'?true:outcome==='not_committed'?false:null,readbackVerified:outcome==='committed',backupId,originalPreserved:preserved,otherFieldsPreserved:outcome==='committed',replyDisabledVerified:outcome==='committed',automaticRetry:false,...(code?{code}:{})});
  try{
   this._check(signal,ticket);
   const locked=await this.withDeploymentLock({signal,assertCurrent:()=>this._check(signal,ticket)},async({assertStopped})=>{
    if(typeof assertStopped!=='function')fail('invalid_request');
    const check=async expected=>{this._check(signal,ticket);await assertStopped();this._check(signal,ticket);const fresh=this._state();if(!same(expected,this._proof(fresh)))fail('config_changed');};
    await check(ticket.proof);if(I.sha(ticket.bytes)!==ticket.hash)fail('config_changed');
    I.mkdir(this.backupRoot);if(I.boundedNames(this.backupRoot,MAX_BACKUPS+1).length>=MAX_BACKUPS)fail('history_full');
    backupId=randomUUID();const dir=path.join(this.backupRoot,backupId);I.mkdir(dir);const dirId=I.identity(I.safe(dir,true));
    const beforeFile=path.join(dir,'before.json'),nextFile=path.join(dir,'next.json'),recordFile=path.join(dir,'record.json');
    const beforeProof=ticket.beforeBytes?I.writePreferenceStage(beforeFile,ticket.beforeBytes):null;
    const record=Buffer.from(JSON.stringify({schema:'qq_builtin_reply_backup_v1',id:backupId,pluginId:PLUGIN,createdAt:new Date(this.now()).toISOString(),originalPresent:!!ticket.proof.config,originalSha256:ticket.proof.config?.sha256||null,nextSha256:ticket.hash})+'\n');
    const recordProof=I.writePreferenceStage(recordFile,record);preserved=true;
    const nextProof=I.writePreferenceStage(nextFile,ticket.bytes);
    await check(ticket.proof);
    const expected={...ticket.proof,parents:ticket.proof.parents.slice()};
    for(const [index,dirPath]of [[3,path.join(this.configDir,'plugins')],[4,this.configRoot]])if(!expected.parents[index]){if(I.exists(dirPath))fail('config_changed');I.mkdir(dirPath);expected.parents[index]=I.identity(I.safe(dirPath,true));}
    await check(expected);
    preserved=false;
    if(!same(dirId,I.identity(I.safe(dir,true)))||!same(nextProof,I.readFile(nextFile,MAX_CONFIG))||!same(recordProof,I.readFile(recordFile,MAX_CONFIG))||beforeProof&&!same(beforeProof,I.readFile(beforeFile,MAX_CONFIG))||!beforeProof&&I.exists(beforeFile)||I.sha(ticket.bytes)!==ticket.hash)fail('config_changed');
    preserved=true;
    this._check(signal,ticket);attempted=true;fs.renameSync(nextFile,this.configFile);
    const actual=I.readFile(this.configFile,MAX_CONFIG),after=this._state();
    if(!I.movedFileSame(nextProof,actual)||!same({...expected,config:actual},this._proof(after))||after.document.value.enableReply!==false)fail('write_unknown');
    receipt=result('committed');return receipt;
   });
   if(!receipt)fail('write_unknown');
   return locked?.configurationRecoveryIssue||locked?.lockRecoveryIssue?{...receipt,configurationRecoveryIssue:'configuration_marker_retained'}:receipt;
  }catch(e){
   if(receipt)return {...receipt,code:safeCode(e),configurationRecoveryIssue:'configuration_marker_retained'};
   return {...result(attempted?'unknown':'not_committed',safeCode(e)),...(e?.configurationRecoveryIssue||e?.lockRecoveryIssue?{configurationRecoveryIssue:'configuration_marker_retained'}:{})};
  }
 }
 discardPreview(){this.ticket?.bytes.fill(0);this.ticket?.beforeBytes?.fill(0);this.ticket=null;}
 dismiss(){this.discardPreview();this.baseline=null;}
 async close(){this.closed=true;this.dismiss();const op=this.operation;if(op){op.abort.abort();await op.promise.catch(()=>{});}return {closed:true};}
}
module.exports={QQBuiltinOfflineReplies,QQBuiltinOfflineRepliesError,CODES,PLUGIN,VERSION,FILES,MAX_CONFIG,MAX_BACKUPS};
