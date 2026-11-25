'use strict';
// Local-only pending Shell cleanup. No runtime adoption, startup or remote API.
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const S=require('./qq-shell-owner-proof.cjs');
const {possibleDescendantIds}=require('./qq-runtime.cjs').runtimeSupport;
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=code=>{throw new S.QQShellOwnerError(code);};
const exists=file=>{try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const hasResources=p=>p.handles.size+p.guards.size+p.gates.size>0;

class QQShellOrphanCleanup{
  constructor(runtime){this.runtime=runtime;this.tickets=new Map();this.inspections=new Map();this.owners=new Map();this.generation=0;this.ownerGeneration=0;this.now=()=>performance.now();}
  owns(accountId){return this.owners.has(accountId)||this.tickets.has(accountId);}
  hasSettlement(accountId){return this.owners.has(accountId);}
  _newOwner(accountId){const r=this.runtime,selector=r.componentSelection();return {id:randomUUID(),generation:++this.ownerGeneration,accountId,proof:new S.QQShellOwnerProof(),origin:{runtime:r,id:r.id,root:r.root,componentsRoot:r.componentsRoot,lockRoot:r.lockRoot,managed:r.managed,selector}};}
  _resourceOwner(accountId){const o=this.owners.get(accountId),r=this.runtime,s=o?.origin;return o&&!o.selected?.length&&hasResources(o.proof)&&s?.runtime===r&&s.id===r.id&&s.root===r.root&&s.componentsRoot===r.componentsRoot&&s.lockRoot===r.lockRoot&&s.managed===r.managed&&s.selector===r._componentSelection?o:null;}
  hasInspectionResources(accountId){return !!this._resourceOwner(accountId);}
  inspectionResourceAccounts(){return [...this.owners.keys()].filter(id=>this.hasInspectionResources(id));}
  observedRunning(accountId){return this.owners.get(accountId)?.observed?.processes==='remaining';}
  _current(assertCurrent){if(this.runtime.closing)fail('manager_closing');S.check(assertCurrent);}
  _retire(accountId){const t=this.tickets.get(accountId);if(t)t.valid=false;this.tickets.delete(accountId);this.inspections.delete(accountId);}
  retire(){for(const t of this.tickets.values())t.valid=false;this.tickets.clear();this.inspections.clear();}
  discard(accountId,digest){const t=this.tickets.get(accountId);if(!t||t.digest!==digest)return {discarded:false};t.valid=false;if(!t.consumed)this.tickets.delete(accountId);return {discarded:true};}
  _ticket(t,assertCurrent){this._current(assertCurrent);if(!t.valid||this.tickets.get(t.accountId)!==t||this.now()>=t.deadline)fail('orphan_cleanup_changed');}
  async _serial(accountId,write,operation){
    const r=this.runtime;if(r.platform!=='win32')fail('unsupported_platform');if(r.closing)fail('manager_closing');
    const prior=write&&r.operations.get(accountId)?.kind==='reconcile'?r.operations.get(accountId):null;
    const token=r._begin(accountId,write,write?'stop':'reconcile',prior);
    try{if(prior)await prior.promise;return await operation();}finally{r._end(accountId,write,token);}
  }
  _capture(owner,ctx){Object.assign(owner,{lease:ctx.lease,context:ctx.context,blockers:ctx.blockers,controls:ctx.controls,install:ctx.install,issue:ctx.issue});if(ctx.run)fail('runtime_locked');}
  _base(owner){
    const r=this.runtime,current=r.instance(owner.accountId);if(!r._ownerBlocker(current)||current.componentIssue!==owner.issue)fail('orphan_cleanup_changed');
    const context=r.componentSelection().shellOwnerContext();owner.proof.assertBinding(owner.lease,context);owner.proof.assertBlockers(owner.blockers);return context;
  }
  _controls(owner){for(const v of owner.controls){if(v.proof){if(!eq(owner.proof.read(v.file,4096).proof,v.proof))fail('orphan_cleanup_changed');}else if(exists(v.file)&&![...owner.proof.guards].some(g=>g.file===v.file))fail('orphan_cleanup_changed');}}
  _lease(owner){
    try{this._base(owner);if(owner.cleared)return exists(owner.lease.file)?'unverified':'cleared';owner.proof.assertLease(owner.lease);return 'retained';}catch{return 'unverified';}
  }
  async _plan(owner,ctx,{allowEmpty=false}={}){
    const readLease=()=>{owner.proof.assertLease(ctx.lease);return {lease:ctx.lease,fingerprint:S.hash(JSON.stringify(ctx.lease.ownerFile))};};
    ctx.check();const p=await this.runtime._orphanPlan(owner.accountId,ctx.install,ctx.lease.file,{allowEmpty,readLease});ctx.check();
    const managers=await this.runtime._inspect([ctx.lease.manager.pid]);ctx.check();if(managers.length)fail(S.matches(managers[0],ctx.lease.manager)?'owner_alive':'ownership_lost');
    return p;
  }
  _binding(owner,plan){return S.hash(JSON.stringify({lease:owner.lease.ownerFile,blockers:owner.blockers,controls:owner.controls,plan:plan.digest}));}
  async _guarded(owner,assertCurrent,mutating,operation){
    try{return await this.runtime._withShellOwner(owner.accountId,assertCurrent,mutating,async ctx=>{this._capture(owner,ctx);return operation(ctx);},owner.proof);}
    finally{if(hasResources(owner.proof))this.owners.set(owner.accountId,owner);}
  }
  async inspect(accountId){
    return this._serial(accountId,false,async()=>{
      const saved=this.owners.get(accountId);if(saved){if(!saved.selected?.length)return false;this._base(saved);this._controls(saved);return true;}
      const owner=this._newOwner(accountId);return this._guarded(owner,()=>this._current(),false,async ctx=>{const a=await this._plan(owner,ctx),b=await this._plan(owner,ctx);if(a.digest!==b.digest)fail('orphan_cleanup_changed');ctx.check();return true;});
    });
  }
  async preview(accountId,assertCurrent){
    this._current(assertCurrent);if(this.runtime.pending.has(accountId))fail('operation_in_progress');this._retire(accountId);const generation=++this.generation;this.inspections.set(accountId,generation);
    const current=()=>{this._current(assertCurrent);if(this.inspections.get(accountId)!==generation)fail('orphan_cleanup_changed');};
    try{return await this._serial(accountId,false,async()=>{
      current();let owner=this.owners.get(accountId),action,plan,binding,resources;
      if(owner&&!owner.selected?.length){if(this._resourceOwner(accountId)!==owner)fail('cleanup_unconfirmed');resources=owner.proof.captureResources();action='settle-resources';binding=S.hash(JSON.stringify({id:owner.id,generation:owner.generation,revision:resources.revision}));}
      else if(owner){this._base(owner);this._controls(owner);action='settle';binding=S.hash(JSON.stringify({id:owner.id,lease:owner.lease.ownerFile,blockers:owner.blockers,controls:owner.controls}));}
      else{owner=this._newOwner(accountId);action='terminate';await this._guarded(owner,current,false,async ctx=>{const a=await this._plan(owner,ctx),b=await this._plan(owner,ctx);if(a.digest!==b.digest)fail('orphan_cleanup_changed');ctx.check();plan=b;binding=this._binding(owner,b);});}
      current();const digest=S.hash(JSON.stringify({nonce:randomUUID(),generation,binding,action})),ticket={accountId,generation,digest,action,valid:true,consumed:false,deadline:this.now()+60000,binding,owner,plan,resources};
      this.tickets.set(accountId,ticket);while(this.tickets.size>32){const first=this.tickets.keys().next().value;this._retire(first);}
      if(action==='settle-resources')return {kind:'pending-shell-inspection-resources',action,accountId,expectedDigest:digest,expiresAt:new Date(Date.now()+60000).toISOString(),automaticStart:false};
      return {kind:'verified-orphan-cleanup',accountId,action,count:action==='terminate'?plan.candidates.length:0,expectedDigest:digest,expiresAt:new Date(Date.now()+60000).toISOString(),automaticStart:false};
    });}finally{if(this.inspections.get(accountId)===generation)this.inspections.delete(accountId);}
  }
  async _observe(owner){
    const r=this.runtime,lease=owner.lease,proofs=lease.runtimeTree,selected=new Set(owner.selected.map(p=>p.pid));
    const round=async()=>{
      this._base(owner);const rows=await r._processes();if(r._desktop(rows))fail('desktop_running');const direct=await r._inspect([lease.manager.pid,...proofs.map(p=>p.pid)]);this._base(owner);
      if(rows.some(p=>p.pid===lease.manager.pid)||direct.some(p=>p.pid===lease.manager.pid))fail('ownership_lost');
      const alive=[];for(const p of proofs){const a=rows.find(v=>v.pid===p.pid),b=direct.find(v=>v.pid===p.pid);if(!!a!==!!b||a&&(!S.matches(a,p)||!S.matches(b,p)||a.parentPid!==p.parentPid||b.parentPid!==p.parentPid))fail('ownership_lost');if(a){if(p.pid===lease.runtime.pid||!selected.has(p.pid))fail('ownership_lost');alive.push(S.treeIdentity(a));}}
      const ids=possibleDescendantIds(rows,proofs);
      if(rows.some(p=>ids.has(p.pid)&&!proofs.some(v=>v.pid===p.pid))||r._external(rows.filter(p=>!ids.has(p.pid)),owner.install,owner.accountId))fail('orphan_cleanup_unverified');return alive.sort((a,b)=>a.pid-b.pid);
    };
    const a=await round(),b=await round();if(!eq(a,b))fail('orphan_cleanup_changed');owner.observed={processes:b.length?'remaining':'confirmed-absent',confirmedAbsentCount:owner.selected.length-b.length};if(!b.length)owner.confirmedAllAbsent=true;return owner.observed;
  }
  _release(owner){try{owner.proof.releaseLease(owner.lease);owner.cleared=true;}catch(e){if(e.leaseCleared===true)owner.cleared=true;throw e;}}
  _detail(owner,attempted){const observed=owner.cleared&&owner.confirmedAllAbsent?{processes:'confirmed-absent',confirmedAbsentCount:owner.selected.length}:owner.observed;return {kind:'pending-shell-orphan-cleanup',accountId:owner.accountId,selectedCount:owner.selected.length,confirmedAbsentCount:observed?.confirmedAbsentCount??null,terminationAttempted:attempted,processes:observed?.processes||'unverified',lease:this._lease(owner),resources:hasResources(owner.proof)?'unconfirmed':'closed',automaticStart:false,pendingUpdateRecoveryRequired:true};}
  _finished(owner,attempted,failure){
    const cleanup=this._detail(owner,attempted),complete=cleanup.processes==='confirmed-absent'&&cleanup.lease==='cleared'&&cleanup.resources==='closed';
    if(complete){this.owners.delete(owner.accountId);this.runtime.endpoints.delete(owner.accountId);this.runtime.outputOwners.delete(owner.accountId);this.runtime.endpointIssues.delete(owner.accountId);this.runtime._event(owner.accountId,{type:'ownership_orphans_cleared',time:new Date().toISOString()});return {recovery:'orphans-cleared',accountId:owner.accountId,terminatedCount:attempted?owner.selected.length:0,automaticStart:false,cleanup};}
    // A further termination always needs a new inspection. Keep only a precise
    // owner that still needs resource or already-stopped lease settlement.
    if(cleanup.resources==='closed'&&cleanup.lease==='retained'&&cleanup.processes!=='confirmed-absent')this.owners.delete(owner.accountId);else this.owners.set(owner.accountId,owner);
    const error=new S.QQShellOwnerError(failure?.code==='cleanup_unconfirmed'?'cleanup_unconfirmed':'orphan_cleanup_incomplete');error.cleanupAttempted=true;error.cleanup=cleanup;throw error;
  }
  async _terminate(t,current,beforeStop){
    const owner=this._newOwner(t.accountId),selected=t.plan.candidates.map(S.treeIdentity);let attempted=false,failure;
    try{await this._guarded(owner,current,true,async ctx=>{
      const a=await this._plan(owner,ctx);if(this._binding(owner,a)!==t.binding)fail('orphan_cleanup_changed');
      await beforeStop();current();const b=await this._plan(owner,ctx);if(this._binding(owner,b)!==t.binding)fail('orphan_cleanup_changed');ctx.check();current();
      owner.selected=selected;this.owners.set(owner.accountId,owner);attempted=true;let stopFailure;try{await this.runtime.host.stop(b.candidates.map(S.processIdentity));}catch(e){stopFailure=e;}
      // Cancellation after the native call cannot retract its effects. Only
      // immutable ownership and current process evidence govern final cleanup.
      ctx.fixed();try{await this._observe(owner);}catch(e){owner.observed=null;throw e;}
      if(owner.observed.processes!=='confirmed-absent')throw stopFailure||new S.QQShellOwnerError('orphan_cleanup_incomplete');
      ctx.fixed();owner.proof.assertLease(owner.lease);this._release(owner);
    });}catch(e){failure=e;}
    if(!attempted){if(!hasResources(owner.proof))this.owners.delete(owner.accountId);throw failure||new S.QQShellOwnerError('orphan_cleanup_changed');}
    return this._finished(owner,true,failure);
  }
  async _settle(t,current){
    const owner=this.owners.get(t.accountId);if(owner!==t.owner)fail('orphan_cleanup_changed');let failure;
    try{
      current();this._base(owner);this._controls(owner);await owner.proof.close();current();const context=this._base(owner);this._controls(owner);
      await owner.proof.withGuard({context,accountId:owner.accountId,lease:owner.lease,host:this.runtime.host,assertCurrent:current,mutating:true},async(check,fixed,controls)=>{
        if(!eq(controls,owner.controls))fail('orphan_cleanup_changed');check();try{await this._observe(owner);}catch(e){owner.observed=null;throw e;}check();
        if(owner.observed.processes!=='confirmed-absent')fail('orphan_cleanup_incomplete');
        if(!owner.cleared){current();fixed();this._release(owner);}else if(exists(owner.lease.file))fail('ownership_lost');
      });
    }catch(e){failure=e;}
    return this._finished(owner,false,failure);
  }
  async _settleResources(t,current){
    current();const owner=this._resourceOwner(t.accountId);if(owner!==t.owner||S.hash(JSON.stringify({id:owner.id,generation:owner.generation,revision:t.resources?.revision}))!==t.binding)fail('orphan_cleanup_changed');owner.proof.assertCapturedResources(t.resources);current();
    // From this point onward report actual closure, even if the panel closes.
    // This branch never disconnects services, observes/stops QQ or edits leases.
    let closed=false;try{closed=(await owner.proof.closeCaptured(t.resources))?.closed===true;}catch{/* Preserve the exact remaining resources for another explicit retry. */}
    const cleanup={kind:'pending-shell-inspection-resources',accountId:t.accountId,resources:closed?'closed':'unconfirmed',processControlAttempted:false,leaseMutationAttempted:false,pendingUpdateRecordsModified:false,automaticStart:false};
    if(closed){if(this.owners.get(t.accountId)===owner)this.owners.delete(t.accountId);return {recovery:'inspection-resources-settled',accountId:t.accountId,automaticStart:false,cleanup};}
    const error=new S.QQShellOwnerError('cleanup_unconfirmed');error.cleanupAttempted=true;error.cleanup=cleanup;throw error;
  }
  async confirm(accountId,{expectedDigest,assertCurrent,beforeStop}){
    const t=this.tickets.get(accountId);if(!t||t.digest!==expectedDigest||t.consumed)fail('orphan_cleanup_changed');t.consumed=true;
    const current=()=>this._ticket(t,assertCurrent);
    try{current();return await this._serial(accountId,true,async()=>{current();return t.action==='settle-resources'?this._settleResources(t,current):t.action==='settle'?this._settle(t,current):this._terminate(t,current,beforeStop);});}
    finally{t.valid=false;if(this.tickets.get(accountId)===t)this.tickets.delete(accountId);}
  }
  async close(){this.retire();let failure;for(const [id,o]of this.owners)try{await o.proof.close();if(!hasResources(o.proof))this.owners.delete(id);}catch(e){failure=e;}if(failure)throw failure;return {closed:true};}
}
module.exports={QQShellOrphanCleanup};
