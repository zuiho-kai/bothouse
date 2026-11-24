'use strict';
const {randomUUID}=require('node:crypto'),{performance}=require('node:perf_hooks');
const P=require('./policy.cjs'),L=require('./pending-lock-policy.cjs');
const {QQPendingUpdateLockRecovery}=require('../bot/qq-pending-update-lock-recovery.cjs');
class SupervisorPendingLock{
 constructor(config,{runtime,now=Date.now,monotonic=()=>performance.now(),helperFactory=options=>new QQPendingUpdateLockRecovery(options)}={}){Object.assign(this,{config,runtime,now,monotonic,helperFactory});this.helper=null;this.inspection=null;this.ticket=null;this.closed=false;this.cleanupIssue=null;}
 capability(){return {supported:true,enabled:this.config.recovery?.pendingUpdateLocks===true,component:'napcat-shell',version:P.VERSION,scope:'declared-installation',limits:L.LIMITS};}
 _check(options={}){if(this.closed)L.fail('closed');if(!this.capability().enabled)L.fail('lock_recovery_disabled',403);if(this.cleanupIssue)L.fail('cleanup_unconfirmed',503);if(options.signal?.aborted)L.fail('cancelled');const result=options.assertCurrent?.();if(result&&typeof result.then==='function')L.fail('invalid_request',400);}
 _retain(error){const code=L.safeCode(error);if(['pending_lock_cleanup_unconfirmed','pending_update_cleanup_unconfirmed'].includes(code))this.cleanupIssue=code;}
 _helper(){if(!this.helper){const selection=this.runtime.manager?.componentSelection();if(!selection)L.fail('pending_lock_unsupported');this.helper=this.helperFactory({selection,processHost:this.runtime.manager.host,now:this.now,monotonic:this.monotonic});}return this.helper;}
 async list(options={}){this._check(options);try{const value=L.inspection(await this._helper().inspect(options));this._check(options);this.ticket=null;this.helper.discardPreview();if(!value.supported){this.inspection=null;return {inspectionId:null,expiresAt:null,...value};}const id=randomUUID();this.inspection={id,digest:P.hash(JSON.stringify(value)),deadline:this.monotonic()+L.LIMITS.inspectionTtlMs};return {inspectionId:id,expiresAt:this.now()+L.LIMITS.inspectionTtlMs,...value};}catch(e){this._retain(e);throw e;}}
 async preview(input,options={}){
  L.previewRequest(input);this._check(options);const seen=this.inspection;if(!seen||seen.id!==input.inspectionId||this.monotonic()>=seen.deadline)L.fail('observation_expired');
  const helper=this._helper();this.ticket=null;try{const current=L.inspection(await helper.inspect(options));this._check(options);if(P.hash(JSON.stringify(current))!==seen.digest)L.fail('pending_lock_changed');const row=current.records.find(r=>r.recordId===input.recordId);if(!row||row.state!=='present')L.fail(row?.code||'pending_lock_missing');const value=L.preview(await helper.preview({recordId:input.recordId,...options}),input);this._check(options);if(value.target!==row.kind)L.fail('pending_lock_changed');this.ticket={action:value.action,recordId:value.recordId,ticketId:value.ticketId,expectedDigest:value.expectedDigest,deadline:this.monotonic()+L.LIMITS.previewTtlMs};return value;}catch(e){this._retain(e);helper.discardPreview();throw e;}
 }
 take(input,options={}){L.request(input);this._check(options);const t=this.ticket;if(!t||t.ticketId!==input.ticketId)L.fail('pending_lock_preview_required');if(t.recordId!==input.recordId||t.action!==input.action||t.expectedDigest!==input.expectedDigest)L.fail('pending_lock_changed');this.ticket=null;if(this.monotonic()>=t.deadline)L.fail('pending_lock_expired');return t;}
 async confirm(input,options={}){try{const answer=L.receipt(await this._helper().confirm({ticketId:input.ticketId,expectedDigest:input.expectedDigest,...options}),input);this._retain({code:answer.code});if(!answer.result.cleanupVerified)this.cleanupIssue='pending_lock_cleanup_unconfirmed';return answer;}catch(e){this._retain(e);throw e;}}
 discard(){this.ticket=null;this.helper?.discardPreview();}
 async close(){this.closed=true;this.inspection=null;this.ticket=null;if(this.helper){if((await this.helper.close())?.closed!==true)L.fail('cleanup_unconfirmed',503);this.helper=null;}this.cleanupIssue=null;return {closed:true};}
}
module.exports={SupervisorPendingLock};
