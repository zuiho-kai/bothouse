'use strict';
const {randomUUID}=require('node:crypto'),{performance}=require('node:perf_hooks');
const P=require('./policy.cjs'),Q=require('./orphan-policy.cjs');
class SupervisorOrphanCleanup{
 constructor(config,{runtime,now=Date.now,monotonic=()=>performance.now()}={}){Object.assign(this,{config,runtime,now,monotonic});this.manager=runtime?.manager;this.inspection=null;this.ticket=null;this.closed=false;this.generation=0;}
 capability(){return Q.capability({supported:true,enabled:this.config.recovery?.orphanCleanup===true,component:'napcat-shell',version:P.VERSION,scope:'declared-account',accountId:this.config.expectedQQ,limits:Q.LIMITS});}
 _check(options={}){if(this.closed)Q.fail('closed');if(!this.capability().enabled)Q.fail('orphan_cleanup_disabled',403);if(options.signal?.aborted)Q.fail('cancelled');const result=options.assertCurrent?.();if(result&&typeof result.then==='function')Q.fail('invalid_request');if(this.runtime?.manager!==this.manager||!this.manager||['discover','hasOrphanInspectionResources','previewOrphanCleanup','cleanupOrphans','discardOrphanPreview'].some(k=>typeof this.manager[k]!=='function'))Q.fail('orphan_cleanup_unavailable');}
 _discard(){const t=this.ticket;if(t){t.valid=false;try{this.manager.discardOrphanPreview(this.config.expectedQQ,{expectedDigest:t.expectedDigest});}catch{/* The private scope is revoked even if runtime retirement fails. */}if(!t.consumed)this.ticket=null;}}
 async _state(options){this._check(options);if(this.manager.hasOrphanInspectionResources(this.config.expectedQQ))return {state:'resources',healthy:false};const next=await this.manager.discover();this._check(options);const row=next?.instances?.find(v=>v.accountId===this.config.expectedQQ);if(row?.canSettleOrphanInspection===true)return {state:'resources',healthy:false};
  if(row?.canInspectOrphanCleanup===true)return {state:'available',healthy:false};
  // Eligibility only offers a preview. The existing local plan must still prove
  // the dead manager/root, every recorded child and absence of foreign writers.
  const healthy=typeof this.manager.cleanupHealthyOrphans==='function'&&next.configured===true&&next.installationKind==='managed-shell'&&next.issue===null&&next.desktopRunning===false&&row?.management==='recoverable'&&row.recoveryRequired===true&&row.canRecover===true&&row.reason==='recovery_required';
  return {state:healthy?'available':'unavailable',healthy};}
 async inspect(options={}){this._check(options);this._discard();this.inspection=null;const generation=++this.generation,observed=await this._state(options),state=observed.state;this._check(options);if(generation!==this.generation)Q.fail('changed');const id=randomUUID();this.inspection={id,state,healthy:observed.healthy,generation,deadline:this.monotonic()+Q.LIMITS.inspectionTtlMs};return Q.inspection({inspectionId:id,expiresAt:this.now()+Q.LIMITS.inspectionTtlMs,accountId:this.config.expectedQQ,state,issue:state==='unavailable'?'orphan_cleanup_unavailable':null,automaticStart:false});}
 async preview(input,options={}){
  Q.previewRequest(input);this._check(options);const seen=this.inspection;if(!seen||seen.id!==input.inspectionId||this.monotonic()>=seen.deadline)Q.fail('observation_expired');if(seen.state==='unavailable')Q.fail('orphan_cleanup_unavailable');this._discard();this.inspection=null;const generation=++this.generation;
  const current=()=>{this._check(options);if(this.generation!==generation)Q.fail('changed');};let raw;
  try{raw=await this.manager.previewOrphanCleanup(this.config.expectedQQ,{assertCurrent:current});current();const value=seen.healthy?Q.healthyLocalPreview(raw,this.config.expectedQQ,this.now()+Q.LIMITS.previewTtlMs):Q.localPreview(raw,this.config.expectedQQ);if((value.action==='settle-resources')!==(seen.state==='resources'))Q.fail('orphan_cleanup_changed');const ttl=Math.min(Q.LIMITS.previewTtlMs,Date.parse(value.expiresAt)-this.now());if(ttl<=0)Q.fail('orphan_preview_expired');const ticketId=randomUUID();this.ticket={ticketId,expectedDigest:value.expectedDigest,action:value.action,healthy:seen.healthy,count:value.count,generation,deadline:this.monotonic()+ttl,valid:true,consumed:false};return Q.preview({ticketId,...value},this.config.expectedQQ);}
  catch(error){if(Q.hex(raw?.expectedDigest))try{this.manager.discardOrphanPreview(this.config.expectedQQ,{expectedDigest:raw.expectedDigest});}catch{}throw error;}
 }
 take(input,options={}){Q.request(input);this._check(options);const t=this.ticket;if(!t||t.consumed||t.ticketId!==input.ticketId||t.expectedDigest!==input.expectedDigest)Q.fail('orphan_preview_required');if(t.action!==input.action)Q.fail('orphan_cleanup_changed');if(this.monotonic()>=t.deadline){this._discard();Q.fail('orphan_preview_expired');}if(!t.valid||t.generation!==this.generation)Q.fail('changed');t.consumed=true;return t;}
 async confirm(input,options={}){
  Q.request(input);const t=this.ticket;if(!t||!t.consumed||t.ticketId!==input.ticketId||t.expectedDigest!==input.expectedDigest||t.action!==input.action)Q.fail('orphan_preview_required');
  const current=()=>{this._check(options);if(!t.valid||this.ticket!==t||this.generation!==t.generation)Q.fail('changed');if(this.monotonic()>=t.deadline)Q.fail('orphan_preview_expired');};
  try{current();const options={expectedDigest:t.expectedDigest,assertCurrent:current,beforeStop:async()=>current()},value=t.healthy?await this.manager.cleanupHealthyOrphans(this.config.expectedQQ,{...options,selectedCount:t.count}):await this.manager.cleanupOrphans(this.config.expectedQQ,options);if(t.healthy&&(value?.cleanup?.kind!=='healthy-shell-orphan-cleanup'||value.cleanup.selectedCount!==t.count))Q.fail('invalid_response');return {code:null,result:Q.success(value,this.config.expectedQQ,t.action)};}
  catch(error){if(error?.cleanupAttempted===true&&error.cleanup){const detail=Q.cleanup(error.cleanup,this.config.expectedQQ,t.action);if(t.healthy&&(detail.kind!=='healthy-shell-orphan-cleanup'||detail.selectedCount!==t.count))Q.fail('invalid_response');if(Q.isComplete(detail))Q.fail('invalid_response');return {code:Q.safeCode(error),result:{completed:false,cleanup:detail}};}throw error;}
  finally{t.valid=false;if(this.ticket===t)this.ticket=null;}
 }
 discard(input){Q.discardRequest(input);const t=this.ticket;if(!t||t.ticketId!==input.ticketId||t.expectedDigest!==input.expectedDigest)return {discarded:false};this._discard();return {discarded:true};}
 async close(){this.closed=true;this.generation++;this.inspection=null;this._discard();return {closed:true};}
}
module.exports={SupervisorOrphanCleanup};
