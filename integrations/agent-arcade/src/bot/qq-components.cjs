'use strict';

// Main-process coordinator. The renderer chooses an action/version, never a
// package path, URL, executable, archive manifest or filesystem hash to trust.
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {QQNodeRepairPanel}=require('./qq-node-repair-panel.cjs');
const VERSION='4.18.42',MARKER='qq-components';
const ID=/^napcat-(?:shell|node)-4\.18\.42-[a-f0-9]{16}$/,HEX=/^[a-f0-9]{64}$/,TICKET=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const LOCK_METHODS={component:['preview','recover'],recovery:['previewGuardRecovery','recoverGuard'],configuration:['previewConfigurationRecovery','recoverConfiguration']};
const CODES=new Set(['invalid_request','invalid_response','operation_in_progress','changed','cancelled','timeout','manager_closing','components_failed',
  'metadata_invalid','digest_required','transport_rejected','network_failed','size_mismatch','digest_mismatch','unsafe_directory','artifact_conflict','staging_failed','staging_busy','package_not_staged',
  'archive_invalid','archive_unsafe','archive_limit','artifact_changed','version_exists','prepare_busy','prepare_failed','prepared_invalid','list_limit',
  'component_missing','component_io_failed','invalid_installation','unsafe_path','component_changed','invalid_version','selection_changed','selection_invalid','manifest_invalid','pending_upstream_update','qq_component_changed','runtime_locked','operation_in_progress','process_check_failed','desktop_running','runtime_running','component_locked','component_lock_changed','rollback_unavailable','installed_version_unverified','version_change_not_supported','already_selected','selection_history_full','unsafe_lock',
  'preview_required','component_lock_missing','recovery_guard_missing','configuration_lock_missing','lock_proof_unavailable','recovery_guard_proof_unavailable','configuration_proof_unavailable','configuration_link_changed','owner_alive','owner_identity_changed','recovery_in_progress','recovery_gate_unsupported','recovery_gate_unavailable','recovery_gate_lost','recovery_gate_close_failed','lock_recovery_failed','recovery_readback_failed','recovery_handle_close_failed','recovery_guard_retained','recovery_guard_state_unverified','component_lock_handle_close_failed','component_lock_retained','component_lock_state_unverified','configuration_handle_close_failed','configuration_marker_retained']);
class QQComponentsError extends Error{constructor(code){const safe=CODES.has(code)?code:'components_failed';super(`QQ component operation failed (${safe}).`);this.name=safe==='cancelled'?'AbortError':'QQComponentsError';this.code=safe;}}
const fail=code=>{throw new QQComponentsError(code);};
const codeOf=error=>CODES.has(error?.code)?error.code:'components_failed';
for(const code of ['repair_unavailable','repair_not_needed','repair_changed','preview_expired','repair_busy','repair_failed','repair_readback_failed','repair_commit_unconfirmed','managed_installation_changed'])CODES.add(code);
for(const code of ['preparation_recovery_unavailable','preparation_commit_unconfirmed','preparation_changed','preparation_busy','preparation_invalid','preparation_owner_alive','preparation_owner_unverified','preparation_selected','preparation_published','preparation_recovery_failed','preparation_record_missing','preparation_proof_unavailable','preparation_publishing','preparation_complete','preparation_limit','preparation_unsafe','preparation_readback_failed','preparation_already_quarantined','reference_unverified'])CODES.add(code);
for(const code of ['pending_update_unsupported','pending_update_missing','pending_update_changed','pending_update_busy','pending_update_unsafe','pending_update_history_full','pending_update_recovery_required','pending_update_preview_required','pending_update_expired','pending_update_failed','pending_update_unconfirmed','pending_update_readback_failed','pending_update_cleanup_unconfirmed'])CODES.add(code);
for(const code of ['node_repair_unavailable','node_repair_busy','node_repair_changed','node_repair_cleanup_unconfirmed','node_repair_recovery_required'])CODES.add(code);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const hex=value=>typeof value==='string'&&HEX.test(value);
const versionId=(value,component)=>typeof value==='string'&&ID.test(value)&&(!component||value.startsWith(`${component}-`));
const clone=value=>JSON.parse(JSON.stringify(value));
function validate(value){
  try{
    if(!plain(value)||!['status','inspect','prepare','preview','activate','rollback','cancel','lock-preview','lock-recover','repair-preview','repair','repair-dismiss','preparation-list','preparation-preview','preparation-recover','preparation-dismiss','pending-list','pending-preview','pending-confirm','pending-dismiss'].includes(value.action))fail('invalid_request');
    const keys={status:['action'],cancel:['action'],inspect:['action','version'],prepare:['action','version'],preview:['action','operation','versionId'],activate:['action','versionId','expectedDigest'],rollback:['action','expectedDigest'],'lock-preview':['action','target'],'lock-recover':['action','target','expectedDigest'],'repair-preview':['action'],repair:['action','ticketId','expectedDigest'],'repair-dismiss':['action'],'preparation-list':['action'],'preparation-preview':['action','preparationId'],'preparation-recover':['action','ticketId','expectedDigest'],'preparation-dismiss':['action'],'pending-list':['action'],'pending-preview':['action','recordId'],'pending-confirm':['action','ticketId','expectedDigest'],'pending-dismiss':['action']}[value.action];
    if(Object.keys(value).some(key=>!keys.includes(key)))fail('invalid_request');
    if(['inspect','prepare'].includes(value.action)&&value.version!==undefined&&value.version!==VERSION)fail('invalid_request');
    if(value.action==='preview'){
      const operation=value.operation??'activate';if(!['activate','rollback'].includes(operation)||(operation==='activate'?!versionId(value.versionId):value.versionId!==undefined))fail('invalid_request');
      return {action:value.action,operation,...(operation==='activate'?{versionId:value.versionId}:{})};
    }
    if(value.action==='activate'&&!versionId(value.versionId))fail('invalid_request');
    if(['activate','rollback'].includes(value.action)&&!hex(value.expectedDigest))fail('invalid_request');
    if(value.action==='preparation-preview'&&(typeof value.preparationId!=='string'||!TICKET.test(value.preparationId)))fail('invalid_request');
    if(value.action==='pending-preview'&&!hex(value.recordId))fail('invalid_request');
    if(['repair','preparation-recover','pending-confirm'].includes(value.action)&&(!hex(value.expectedDigest)||typeof value.ticketId!=='string'||!TICKET.test(value.ticketId)))fail('invalid_request');
    if(['lock-preview','lock-recover'].includes(value.action)&&(typeof value.target!=='string'||!Object.hasOwn(LOCK_METHODS,value.target)||(value.action==='lock-recover'&&!hex(value.expectedDigest))))fail('invalid_request');
    return {...value,...(['inspect','prepare'].includes(value.action)?{version:VERSION}:{})};
  }catch{fail('invalid_request');}
}
function brief(value,component='napcat-shell'){
  if(!plain(value)||!['original','prepared'].includes(value.kind)||(value.version!==null&&(typeof value.version!=='string'||!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value.version))))fail('invalid_response');
  if(value.kind==='prepared'&&(value.version!==VERSION||!versionId(value.versionId,component))||component==='napcat-node'&&value.kind!=='prepared')fail('invalid_response');
  return {kind:value.kind,version:value.version,...(value.kind==='prepared'?{versionId:value.versionId}:{}),...(value.verification==='not-checked'?{verification:'not-checked'}:{})};
}
function selection(value,{preview=false,operation,component='napcat-shell'}={}){
  const scope=component==='napcat-node'?'qq-node-runtime':'napcat-only';
  if(!plain(value)||value.scope!==scope||value.automaticStart!==false||(value.digest!==null&&!hex(value.digest))||typeof value.canRollback!=='boolean')fail('invalid_response');
  const result={current:brief(value.current,component),previous:value.previous===null?null:brief(value.previous,component),digest:value.digest,canRollback:value.canRollback,scope,automaticStart:false};
  if(preview){if(!hex(result.digest))fail('invalid_response');result.candidate=brief(value.candidate,component);result.operation=operation;}
  return result;
}
function preparedSummary(value,verified,component='napcat-shell'){
  if(!plain(value)||value.version!==VERSION||!versionId(value.versionId,component)||!plain(value.source)||!hex(value.source.sha256)||value.versionId!==`${component}-${VERSION}-${value.source.sha256.slice(0,16)}`)fail('invalid_response');
  const fileCount=value.fileCount??(Array.isArray(value.files)?value.files.length:undefined),totalBytes=value.totalBytes??(Array.isArray(value.files)?value.files.reduce((n,row)=>n+(Number.isSafeInteger(row?.size)?row.size:NaN),0):undefined);
  if(!Number.isSafeInteger(fileCount)||fileCount<1||fileCount>10000||!Number.isSafeInteger(totalBytes)||totalBytes<1||totalBytes>512*1024*1024)fail('invalid_response');
  return {versionId:value.versionId,version:VERSION,sha256:value.source.sha256,fileCount,totalBytes,verified};
}
function releaseSummary(value,component='napcat-shell'){
  const name=component==='napcat-node'?'NapCat.Shell.Windows.Node.zip':'NapCat.Shell.zip';
  if(!plain(value)||value.version!==VERSION||value.tag!==`v${VERSION}`||value.name!==name||!hex(value.sha256)||!Number.isSafeInteger(value.size)||value.size<1||value.size>128*1024*1024||!Number.isSafeInteger(value.assetId)||value.assetId<1||typeof value.publishedAt!=='string'||value.publishedAt.length>64||!Number.isFinite(Date.parse(value.publishedAt)))fail('invalid_response');
  return {version:value.version,tag:value.tag,name:value.name,size:value.size,sha256:value.sha256,assetId:value.assetId,publishedAt:value.publishedAt};
}
function lockSummary(target,value,{preview=false}={}){
  const labels={component:['eligible',undefined],recovery:['guard-eligible','guard-cleared'],configuration:['configuration-eligible','configuration-cleared']};
  if(!plain(value)||value.automaticStart!==false||value.selectionChanged!==false||(preview?!hex(value.digest):value.recovered!==true)||value.recovery!==labels[target][preview?0:1])fail('invalid_response');
  if(target!=='component'&&typeof value.componentLockRemaining!=='boolean')fail('invalid_response');
  if(target==='configuration'&&(value.configurationRestored!==false||typeof value.recoveryGuardRemaining!=='boolean'))fail('invalid_response');
  if(!preview&&target==='component'&&value.guardRemaining!==null&&typeof value.guardRemaining!=='boolean')fail('invalid_response');
  return {target,...(preview?{expectedDigest:value.digest}:{recovered:true}),automaticStart:false,selectionChanged:false,configurationRestored:false,
    componentLockRemaining:target==='component'?preview:value.componentLockRemaining,
    recoveryGuardRemaining:target==='configuration'?value.recoveryGuardRemaining:target==='component'&&!preview?value.guardRemaining:target==='recovery'&&preview};
}
function repairSummary(value){
  if(!plain(value)||value.operation!=='repair'||typeof value.ticketId!=='string'||!TICKET.test(value.ticketId)||!hex(value.expectedDigest)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now()||value.expiresAt>Date.now()+300000||value.damage!=='code_integrity_mismatch'||value.preservesDamagedDirectory!==true||value.clearsRollback!==true||value.automaticStart!==false)fail('invalid_response');
  const current=brief(value.current),target=brief(value.target);
  if(current.kind!=='prepared'||current.version!==VERSION||target.version!==current.version||(target.kind==='prepared'&&target.versionId===current.versionId))fail('invalid_response');
  const verification=target.kind==='original'?'mandatory-files-only':'full-manifest';if(value.target.verification!==verification)fail('invalid_response');target.verification=verification;
  return {operation:'repair',ticketId:value.ticketId,expectedDigest:value.expectedDigest,expiresAt:value.expiresAt,current,target,damage:'code_integrity_mismatch',preservesDamagedDirectory:true,clearsRollback:true,automaticStart:false};
}
function preparationEntry(value,component){
  if(!plain(value)||typeof value.preparationId!=='string'||!TICKET.test(value.preparationId)||value.component!==component||value.version!==VERSION||!versionId(value.versionId,component)||value.state!=='recorded-incomplete'||value.verification!=='not-checked')fail('invalid_response');
  return {preparationId:value.preparationId,component,versionId:value.versionId,version:VERSION,state:'recorded-incomplete',verification:'not-checked'};
}
function preparationPreview(value,entry){
  if(!plain(value)||value.operation!=='preparation-recovery'||typeof value.ticketId!=='string'||!TICKET.test(value.ticketId)||!hex(value.expectedDigest)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now()||value.expiresAt>Date.now()+300000||value.preparationId!==entry.preparationId||value.component!==entry.component||value.versionId!==entry.versionId||value.version!==VERSION||value.preservesDirectory!==true||value.automaticRetry!==false||value.automaticStart!==false)fail('invalid_response');
  if(!Number.isSafeInteger(value.fileCount)||value.fileCount<0||value.fileCount>10000||!Number.isSafeInteger(value.directoryCount)||value.directoryCount<0||value.directoryCount>10000||!Number.isSafeInteger(value.totalBytes)||value.totalBytes<0||value.totalBytes>512*1024*1024)fail('invalid_response');
  return {operation:'preparation-recovery',ticketId:value.ticketId,expectedDigest:value.expectedDigest,expiresAt:value.expiresAt,preparationId:entry.preparationId,component:entry.component,versionId:entry.versionId,version:VERSION,fileCount:value.fileCount,directoryCount:value.directoryCount,totalBytes:value.totalBytes,preservesDirectory:true,automaticRetry:false,automaticStart:false};
}
class QQComponents {
  constructor({console:qqConsole,onChange=()=>{},packagesFactory=options=>new (require('./qq-component-package.cjs').QQComponentPackages)(options),preparedFactory=options=>new (require('./qq-component-prepared.cjs').QQComponentPrepared)(options),lockRecoveryFactory=options=>new (require('./qq-component-lock-recovery.cjs').QQComponentLockRecovery)(options),repairFactory=options=>new (require('./qq-component-repair.cjs').QQComponentRepair)(options),pendingUpdateFactory=options=>new (require('./qq-pending-update-recovery.cjs').QQPendingUpdateRecovery)(options),nodeRepairFactory,captureNodeRepairUI}={}){
    if(!qqConsole||typeof qqConsole.check!=='function'||!(qqConsole.busy instanceof Set)||typeof onChange!=='function'||typeof packagesFactory!=='function'||typeof preparedFactory!=='function')fail('invalid_request');
    if(typeof lockRecoveryFactory!=='function'||typeof repairFactory!=='function'||typeof pendingUpdateFactory!=='function')fail('invalid_request');
    this.console=qqConsole;this.onChange=onChange;this.packagesFactory=packagesFactory;this.preparedFactory=preparedFactory;this.lockRecoveryFactory=lockRecoveryFactory;this.context=null;this.active=null;this.closed=false;this.lockPreview=null;
    this.repairFactory=repairFactory;this.repairPreview=null;this.preparationPreview=null;this.pendingUpdateFactory=pendingUpdateFactory;this.pendingUpdatePreview=null;
    this.state={busy:false,phase:'idle',operationId:null,version:VERSION,component:'napcat-shell',candidate:null,current:null,previous:null,canRollback:false,prepared:[],lastCode:null,lastRecovery:null,lastRepair:null,preparationEntries:[],preparationIssues:[],lastPreparationRecovery:null,pendingUpdates:null,lastPendingUpdate:null};
    this.nodeRepair=new QQNodeRepairPanel({console:qqConsole,onChange,captureUI:captureNodeRepairUI,create:nodeRepairFactory});
  }
  _notify(){try{this.onChange();}catch{/* Observers cannot change storage outcomes. */}}
  _same(context){return !this.closed&&!this.console.closed&&this.console.runtime===context.runtime&&this.console.epoch===context.epoch&&context.runtime.componentStoreRoot===context.root&&context.runtime.lockRoot===context.lockRoot;}
  _discardRepair(){this.repairPreview=null;this.context?.repair?.discardPreview();}
  _discardPreparation(){this.preparationPreview=null;this.context?.preparationRecovery?.discardPreview();}
  _discardPendingUpdate(){this.pendingUpdatePreview=null;this.context?.pendingUpdate?.discardPreview();}
  _reset(){this.lockPreview=null;this._discardRepair();this._discardPreparation();this._discardPendingUpdate();Object.assign(this.state,{candidate:null,current:null,previous:null,canRollback:false,prepared:[],lastCode:null,lastRecovery:null,lastRepair:null,preparationEntries:[],preparationIssues:[],lastPreparationRecovery:null,pendingUpdates:null,lastPendingUpdate:null});}
  _abort(operation,code,notify=true){if(operation.committed||operation.controller.signal.aborted)return false;operation.abortCode=code;operation.controller.abort();this.state.phase='cancelling';if(notify)this._notify();return true;}
  snapshot(){
    if(this.context&&!this._same(this.context)){this._reset();if(this.active)this._abort(this.active,this.closed?'manager_closing':'changed',false);}
    return {...clone(this.state),...(this.nodeRepair.busy()?{busy:true,phase:'node-repair'}:{}),...(this.nodeRepair.snapshot()?{lastNodeRepair:this.nodeRepair.snapshot()}:{})};
  }
  _context(){
    if(this.closed||this.console.closed)fail('manager_closing');const runtime=this.console.runtime,epoch=this.console.epoch;this.console.check(runtime,epoch);
    const root=runtime?.componentStoreRoot;if(typeof root!=='string'||!path.isAbsolute(root)||root.includes('\0')||/^[/\\]{2}/.test(root)||typeof runtime.componentSelection!=='function')fail('invalid_request');
    if(this.context&&this._same(this.context))return this.context;
    this._reset();const selector=runtime.componentSelection();if(!selector||['status','preview','activate','rollback'].some(method=>typeof selector[method]!=='function'))fail('invalid_response');
    const packages=selector.prepared?.packages||this.packagesFactory({root}),prepared=selector.prepared||this.preparedFactory({root,packages,lockRoot:runtime.lockRoot});
    if(!packages||['inspect','stage'].some(method=>typeof packages[method]!=='function')||!prepared||['prepare','listPrepared','resolvePrepared'].some(method=>typeof prepared[method]!=='function'))fail('invalid_response');
    if((prepared.root!==undefined&&path.resolve(prepared.root)!==path.resolve(root))||(packages.root!==undefined&&path.resolve(packages.root)!==path.resolve(root)))fail('invalid_response');
    const component=prepared.component??'napcat-shell';if(!['napcat-shell','napcat-node'].includes(component)||(packages.component!==undefined&&packages.component!==component))fail('invalid_response');this.state.component=component;
    this.context={runtime,epoch,root,lockRoot:runtime.lockRoot,selector,packages,prepared,component};return this.context;
  }
  _assert(operation){
    if(!this._same(operation.context)){this._abort(operation,this.closed?'manager_closing':'changed');fail(operation.abortCode||'changed');}
    this.console.check(operation.context.runtime,operation.context.epoch);if(operation.controller.signal.aborted)fail(operation.abortCode||'cancelled');
  }
  _phase(operation,phase){this._assert(operation);this.state.phase=phase;this._notify();}
  _remember(value){this.state.current=value.current;this.state.previous=value.previous;this.state.canRollback=value.canRollback;}
  async _status(operation){
    const value=selection(await operation.context.selector.status(),{component:operation.context.component});this._assert(operation);
    const listing=await operation.context.prepared.listPrepared();this._assert(operation);
    if(!plain(listing)||!Array.isArray(listing.items)||listing.items.length>32||!Array.isArray(listing.issues)||listing.issues.length>32)fail('invalid_response');
    const items=listing.items.map(row=>preparedSummary(row,false,operation.context.component));if(new Set(items.map(row=>row.versionId)).size!==items.length)fail('invalid_response');
    this._remember(value);this.state.prepared=items;this.state.lastCode=listing.issues.length?codeOf({code:listing.issues[0]}):null;
    return {state:this.snapshot()};
  }
  async _committed(operation,raw,initialIssue=null){
    operation.committed=true;let value=null,refreshIssue=initialIssue;
    const lockRecoveryIssue=raw?.lockRecoveryIssue!==undefined?codeOf({code:raw.lockRecoveryIssue}):null;
    try{if(raw)value=selection(raw,{component:operation.context.component});}catch{refreshIssue=refreshIssue||'invalid_response';}
    if(this._same(operation.context)){if(value)this._remember(value);else Object.assign(this.state,{current:null,previous:null,canRollback:false});this.state.candidate=null;}
    try{
      if(!this._same(operation.context))fail(this.closed?'manager_closing':'changed');this.console.check(operation.context.runtime,operation.context.epoch);
      // Invalidate a refresh that began before the selection was committed.
      if(Number.isSafeInteger(this.console.refreshRevision))this.console.refreshRevision++;this.console.refreshing=null;
      await this.console.refresh();if(!this._same(operation.context))fail(this.closed?'manager_closing':'changed');this.console.check(operation.context.runtime,operation.context.epoch);
    }catch(error){refreshIssue=refreshIssue||codeOf(error);}
    if(this._same(operation.context))this.state.lastCode=refreshIssue||lockRecoveryIssue;
    return {committed:true,selection:value,...(refreshIssue?{refreshIssue}:{}),...(lockRecoveryIssue?{lockRecoveryIssue}:{})};
  }
  _lockBinding(context){
    if(context.runtime.componentSelection()!==context.selector)fail('changed');
    return JSON.stringify([context.selector.installationId,context.selector.lockFile,context.selector.configLock]);
  }
  _lockRecovery(context){
    if(!context.lockRecovery){
      const value=this.lockRecoveryFactory({selection:context.selector,processHost:context.runtime.host});
      if(!value||Object.values(LOCK_METHODS).flat().some(method=>typeof value[method]!=='function'))fail('invalid_response');
      context.lockRecovery=value;
    }
    return context.lockRecovery;
  }
  async _lockCommitted(operation,target,raw,initialIssue=null){
    operation.committed=true;let recovery=null,refreshIssue=initialIssue,recoveryIssue=null;
    if(raw?.recoveryIssue!==undefined)recoveryIssue=codeOf({code:raw.recoveryIssue});
    try{if(raw)recovery=lockSummary(target,raw);}catch{refreshIssue=refreshIssue||'invalid_response';}
    const result={target,committed:true,recovery,...(recoveryIssue?{recoveryIssue}:{}),...(refreshIssue?{refreshIssue}:{})};
    // Remember the bounded outcome before refreshing. Closing the drawer must
    // not hide a completed deletion or invite a second use of its old preview.
    if(this._same(operation.context))this.state.lastRecovery=clone(result);
    try{
      if(!this._same(operation.context))fail(this.closed?'manager_closing':'changed');
      this.console.check(operation.context.runtime,operation.context.epoch);
      if(Number.isSafeInteger(this.console.refreshRevision))this.console.refreshRevision++;this.console.refreshing=null;
      await this.console.refresh();if(!this._same(operation.context))fail(this.closed?'manager_closing':'changed');
      this.console.check(operation.context.runtime,operation.context.epoch);
    }catch(error){refreshIssue=refreshIssue||codeOf(error);}
    if(refreshIssue)result.refreshIssue=refreshIssue;
    if(this._same(operation.context)){this.state.lastRecovery=clone(result);this.state.lastCode=refreshIssue||recoveryIssue;}
    return result;
  }
  async _lockRun(operation,request){
    const {context}=operation,binding=this._lockBinding(context),recovery=this._lockRecovery(context);
    const current=()=>{this._assert(operation);if(this._lockBinding(context)!==binding)fail('changed');};
    if(request.action==='lock-preview'){
      const raw=await recovery[LOCK_METHODS[request.target][0]]();current();
      const lockPreview=lockSummary(request.target,raw,{preview:true});
      this.lockPreview={context,binding,target:request.target,expectedDigest:lockPreview.expectedDigest};
      return {lockPreview};
    }
    const preview=operation.lockPreview;
    if(!preview||preview.context!==context||preview.binding!==binding||preview.target!==request.target||preview.expectedDigest!==request.expectedDigest)fail('preview_required');
    current();let raw;
    try{raw=await recovery[LOCK_METHODS[request.target][1]]({expectedDigest:request.expectedDigest,assertCurrent:current,signal:operation.controller.signal});}
    catch(error){if(error?.committed===true)return this._lockCommitted(operation,request.target,null,codeOf(error));throw error;}
    return this._lockCommitted(operation,request.target,raw);
  }
  _repair(context){
    if(context.component!=='napcat-shell')fail('repair_unavailable');
    if(!context.repair){const value=this.repairFactory({selection:context.selector});if(!value||['preview','repair','discardPreview'].some(name=>typeof value[name]!=='function'))fail('invalid_response');context.repair=value;}
    return context.repair;
  }
  async _repairCommitted(operation,raw,initialIssue=null){
    operation.committed=true;
    const receipt={committed:true,repaired:false,selection:null,damagedDirectoryPreserved:true,automaticStart:false};
    if(this._same(operation.context))this.state.lastRepair=clone(receipt);
    let checked=null,issue=initialIssue||(raw?.refreshIssue?codeOf({code:raw.refreshIssue}):null);
    try{
      if(raw?.committed!==true||raw.repaired!==true||raw.damagedDirectoryPreserved!==true||raw.automaticStart!==false)fail('invalid_response');
      checked=selection(raw.selection);const target=operation.repairPreview?.target;if(checked.previous!==null||checked.canRollback!==false||!target||checked.current.kind!==target.kind||checked.current.version!==target.version||checked.current.versionId!==target.versionId)fail('invalid_response');
    }catch{checked=null;issue ||= 'invalid_response';}
    const result=await this._committed(operation,checked?{...checked,...(raw.lockRecoveryIssue?{lockRecoveryIssue:raw.lockRecoveryIssue}:{})}:null,issue);
    Object.assign(receipt,result,{repaired:!!checked});
    if(raw?.lockRecoveryIssue)receipt.lockRecoveryIssue=codeOf({code:raw.lockRecoveryIssue});
    if(this._same(operation.context))this.state.lastRepair=clone(receipt);
    return receipt;
  }
  _repairUnknown(operation,code){
    // An attempted replacement with unreadable readback cannot be retried as
    // if no write happened. Consume the preview and keep the bounded outcome.
    operation.committed=true;
    const result={committed:null,changeAttempted:true,repaired:false,selection:null,damagedDirectoryPreserved:true,automaticStart:false,issue:codeOf({code})};
    if(this._same(operation.context)){this.state.lastRepair=clone(result);this.state.lastCode=result.issue;Object.assign(this.state,{candidate:null,current:null,previous:null,canRollback:false});}
    return result;
  }
  async _repairRun(operation,request){
    const {context}=operation,binding=this._lockBinding(context),repair=this._repair(context);
    const current=()=>{this._assert(operation);if(this._lockBinding(context)!==binding)fail('changed');};
    if(request.action==='repair-preview'){
      try{const raw=await repair.preview({signal:operation.controller.signal,assertCurrent:current});current();const repairPreview=repairSummary(raw);this.repairPreview={context,binding,ticketId:repairPreview.ticketId,expectedDigest:repairPreview.expectedDigest,expiresAt:repairPreview.expiresAt,target:repairPreview.target};return {repairPreview};}
      catch(error){repair.discardPreview();throw error;}
    }
    const preview=operation.repairPreview;
    if(!preview||preview.context!==context||preview.binding!==binding||preview.ticketId!==request.ticketId||preview.expectedDigest!==request.expectedDigest||preview.expiresAt<=Date.now()){repair.discardPreview();fail('preview_required');}
    current();let raw;
    try{raw=await repair.repair({ticketId:request.ticketId,expectedDigest:request.expectedDigest,signal:operation.controller.signal,assertCurrent:current});}
    catch(error){if(error?.committed===true)return await this._repairCommitted(operation,null,codeOf(error));if(error?.committed===null&&error.changeAttempted===true)return this._repairUnknown(operation,codeOf(error));throw error;}
    if(raw?.committed===null&&raw.changeAttempted===true)return this._repairUnknown(operation,raw.code||'repair_commit_unconfirmed');
    if(raw?.committed!==true)return this._repairUnknown(operation,'invalid_response');
    return await this._repairCommitted(operation,raw);
  }
  _preparation(context){
    const value=context.prepared.preparationRecovery;
    if(!value||['list','preview','recover','discardPreview'].some(name=>typeof value[name]!=='function'))fail('preparation_recovery_unavailable');
    if(value.root!==undefined&&path.resolve(value.root)!==path.resolve(context.root)||value.component!==undefined&&value.component!==context.component||context.lockRoot!==undefined&&(typeof value.lockRoot!=='string'||path.resolve(value.lockRoot)!==path.resolve(context.lockRoot)))fail('invalid_response');
    if(context.preparationRecovery&&context.preparationRecovery!==value)fail('changed');
    context.preparationRecovery=value;return value;
  }
  async _preparationList(operation){
    const raw=await this._preparation(operation.context).list();this._assert(operation);
    if(!plain(raw)||!Array.isArray(raw.entries)||raw.entries.length>256||!Array.isArray(raw.issues)||raw.issues.length>32)fail('invalid_response');
    const entries=raw.entries.map(row=>preparationEntry(row,operation.context.component));if(new Set(entries.map(row=>row.preparationId)).size!==entries.length)fail('invalid_response');
    const issues=raw.issues.map(code=>codeOf({code}));this.state.preparationEntries=entries;this.state.preparationIssues=issues;
    return {preparationEntries:entries,preparationIssues:issues};
  }
  async _preparationOutcome(operation,raw,{committed=true,issue=null}={}){
    operation.committed=true;const preview=operation.preparationPreview;
    const result={committed,recovered:false,component:preview.component,versionId:preview.versionId,preserved:true,automaticRetry:false,automaticStart:false,selectionChanged:false};
    if(committed===null){result.changeAttempted=true;result.issue=issue||'preparation_commit_unconfirmed';}
    else{
      try{
        if(!plain(raw)||raw.committed!==true||typeof raw.recovered!=='boolean'||raw.component!==preview.component||raw.versionId!==preview.versionId||typeof raw.quarantineId!=='string'||!TICKET.test(raw.quarantineId)||raw.quarantineId!==preview.preparationId||raw.preserved!==true||raw.automaticRetry!==false||raw.automaticStart!==false||raw.selectionChanged!==false)fail('invalid_response');
        result.recovered=raw.recovered;result.quarantineId=raw.quarantineId;if(raw.recoveryIssue!==undefined)result.recoveryIssue=codeOf({code:raw.recoveryIssue});
      }catch{result.recoveryIssue=issue||'invalid_response';}
      if(issue)result.recoveryIssue=issue;
    }
    // Persist a safe in-memory receipt before any optional follow-up reading.
    if(this._same(operation.context)){this.state.lastPreparationRecovery=clone(result);this.state.preparationEntries=this.state.preparationEntries.filter(row=>row.preparationId!==preview.preparationId);}
    if(committed===true){try{await this._preparationList(operation);}catch(error){result.refreshIssue=codeOf(error);}}
    if(this._same(operation.context)){this.state.lastPreparationRecovery=clone(result);this.state.lastCode=result.issue||result.recoveryIssue||result.refreshIssue||null;}
    return result;
  }
  async _preparationRun(operation,request){
    const {context}=operation,recovery=this._preparation(context),binding=this._lockBinding(context);
    const current=()=>{this._assert(operation);if(this._lockBinding(context)!==binding||context.prepared.preparationRecovery!==recovery)fail('changed');};
    if(request.action==='preparation-list')return this._preparationList(operation);
    if(request.action==='preparation-preview'){
      const entry=this.state.preparationEntries.find(row=>row.preparationId===request.preparationId);if(!entry)fail('preview_required');
      try{const raw=await recovery.preview({preparationId:entry.preparationId,signal:operation.controller.signal,assertCurrent:current});current();const value=preparationPreview(raw,entry);this.preparationPreview={...value,context,binding};return {preparationPreview:value};}
      catch(error){recovery.discardPreview();throw error;}
    }
    const preview=operation.preparationPreview;
    if(!preview||preview.context!==context||preview.binding!==binding||preview.ticketId!==request.ticketId||preview.expectedDigest!==request.expectedDigest||preview.expiresAt<=Date.now()){recovery.discardPreview();fail('preview_required');}
    current();let raw;
    try{raw=await recovery.recover({ticketId:request.ticketId,expectedDigest:request.expectedDigest,signal:operation.controller.signal,assertCurrent:current});}
    catch(error){if(error?.committed===true)return this._preparationOutcome(operation,null,{issue:codeOf(error)});if(error?.committed===null&&error.changeAttempted===true)return this._preparationOutcome(operation,null,{committed:null,issue:codeOf(error)});throw error;}
    if(raw?.committed===true)return this._preparationOutcome(operation,raw);
    return this._preparationOutcome(operation,null,{committed:null,issue:'preparation_commit_unconfirmed'});
  }
  async _preparedPublished(operation,staged,error){
    operation.committed=true;
    const result={preparationCommitted:true,prepared:null,preparationIssue:codeOf(error)};
    try{this._assert(operation);const raw=await operation.context.prepared.resolvePrepared(`${operation.context.component}-${VERSION}-${staged.sha256.slice(0,16)}`,{signal:operation.controller.signal});this._assert(operation);const prepared=preparedSummary(raw,true,operation.context.component);if(prepared.sha256!==staged.sha256)fail('invalid_response');result.prepared=prepared;this.state.prepared=[...this.state.prepared.filter(row=>row.versionId!==prepared.versionId),{...prepared,verified:false}].slice(-32);}
    catch(failure){result.verificationIssue=codeOf(failure);}
    if(this._same(operation.context))this.state.lastCode=result.preparationIssue;
    return result;
  }
  _pendingUpdate(context){
    if(!context.pendingUpdate){const helper=this.pendingUpdateFactory({selection:context.selector});if(!helper||['list','preview','confirm','discardPreview','close'].some(name=>typeof helper[name]!=='function'))fail('invalid_response');context.pendingUpdate=helper;}
    return context.pendingUpdate;
  }
  _pendingUpdateList(raw,component){
    if(!plain(raw)||typeof raw.supported!=='boolean'||raw.component!==component||raw.verification!=='not-checked'||!Array.isArray(raw.records)||raw.records.length>32||raw.issue!==null&&!CODES.has(raw.issue))fail('invalid_response');
    const records=raw.records.map(row=>{
      if(!plain(row)||!hex(row.recordId)||!['pending-update','review-required'].includes(row.state)||row.bytes!==null&&(!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>2*1024*1024))fail('invalid_response');
      return {recordId:row.recordId,state:row.state,bytes:row.bytes};
    });if(new Set(records.map(row=>row.recordId)).size!==records.length)fail('invalid_response');
    return {supported:raw.supported,component,verification:'not-checked',records,issue:raw.issue};
  }
  async _pendingUpdateOutcome(operation,raw,{unknown=false,issue=null,committed=null}={}){
    // A malformed receipt after invocation cannot prove that nothing changed.
    // Keep the old operation's known identity; never copy raw paths or errors.
    operation.committed=true;const preview=operation.pendingUpdatePreview;
    const result={committed,disabled:null,retained:null,recordId:preview.recordId,automaticStart:false,rollsBackCode:false,code:issue||'pending_update_unconfirmed'};
    if(!unknown){
      try{
        if(!plain(raw)||![true,false,null].includes(raw.committed)||![true,false,null].includes(raw.disabled)||![true,false,null].includes(raw.retained)||raw.recordId!==preview.recordId||typeof raw.operationId!=='string'||!TICKET.test(raw.operationId)||raw.automaticStart!==false||raw.rollsBackCode!==false||raw.code!==undefined&&!CODES.has(raw.code))fail('invalid_response');
        if(raw.disabled===true&&(raw.committed!==true||raw.retained!==true)||raw.committed===false&&(raw.disabled!==false||raw.retained!==false)||raw.committed===null&&raw.disabled!==null||preview.operation==='disable-pending-update'&&raw.committed===true&&raw.disabled===false)fail('invalid_response');
        Object.assign(result,{committed:raw.committed,disabled:raw.disabled,retained:raw.retained,operationId:raw.operationId});delete result.code;if(raw.code)result.code=raw.code;
      }catch{result.code='invalid_response';}
    }
    if(this._same(operation.context))this.state.lastPendingUpdate=clone(result);
    try{
      this._assert(operation);const rawList=await this._pendingUpdate(operation.context).list({signal:operation.controller.signal,assertCurrent:()=>this._assert(operation)});this._assert(operation);
      this.state.pendingUpdates=this._pendingUpdateList(rawList,operation.context.component);
      if(Number.isSafeInteger(this.console.refreshRevision))this.console.refreshRevision++;this.console.refreshing=null;
    }catch(error){result.refreshIssue=codeOf(error);}
    if(this._same(operation.context)){this.state.lastPendingUpdate=clone(result);this.state.lastCode=result.code||result.refreshIssue||null;}
    return {pendingUpdateResult:result};
  }
  async _pendingUpdateRun(operation,request){
    const {context}=operation,helper=this._pendingUpdate(context),binding=this._lockBinding(context),current=()=>{this._assert(operation);if(this._lockBinding(context)!==binding)fail('changed');};
    if(request.action==='pending-list'){
      const raw=await helper.list({signal:operation.controller.signal,assertCurrent:current});current();const pendingUpdates=this._pendingUpdateList(raw,context.component);this.state.pendingUpdates=pendingUpdates;return {pendingUpdates};
    }
    if(request.action==='pending-preview'){
      const listed=this.state.pendingUpdates,entry=listed?.records.find(row=>row.recordId===request.recordId);if(!listed?.supported||!entry)fail('pending_update_preview_required');
      try{
        const raw=await helper.preview({recordId:request.recordId,signal:operation.controller.signal,assertCurrent:current});current();const expectedOperation=entry.state==='pending-update'?'disable-pending-update':'reconcile-pending-update';
        if(!plain(raw)||raw.operation!==expectedOperation||raw.recordId!==entry.recordId||typeof raw.ticketId!=='string'||!TICKET.test(raw.ticketId)||!hex(raw.expectedDigest)||!Number.isSafeInteger(raw.expiresAt)||raw.expiresAt<=Date.now()||raw.expiresAt>Date.now()+300000||raw.component!==context.component||raw.version!==VERSION||raw.verification!=='full-manifest'||!Number.isSafeInteger(raw.bytes)||raw.bytes<0||raw.bytes>2*1024*1024||raw.disablesPlan!==(expectedOperation==='disable-pending-update')||raw.preservesOriginal!==true||raw.rollsBackCode!==false||raw.automaticStart!==false)fail('invalid_response');
        const pendingUpdatePreview={operation:raw.operation,recordId:raw.recordId,ticketId:raw.ticketId,expectedDigest:raw.expectedDigest,expiresAt:raw.expiresAt,component:raw.component,version:VERSION,verification:'full-manifest',bytes:raw.bytes,disablesPlan:raw.disablesPlan,preservesOriginal:true,rollsBackCode:false,automaticStart:false};
        this.pendingUpdatePreview={...pendingUpdatePreview,context,binding};return {pendingUpdatePreview};
      }catch(error){helper.discardPreview();throw error;}
    }
    const preview=operation.pendingUpdatePreview;
    if(!preview||preview.context!==context||preview.binding!==binding||preview.ticketId!==request.ticketId||preview.expectedDigest!==request.expectedDigest||preview.expiresAt<=Date.now()){helper.discardPreview();fail('pending_update_preview_required');}
    current();let raw;
    try{raw=await helper.confirm({ticketId:request.ticketId,expectedDigest:request.expectedDigest,signal:operation.controller.signal,assertCurrent:current});}
    catch(error){if(error?.committed===true||error?.committed===null&&error.changeAttempted===true)return this._pendingUpdateOutcome(operation,null,{unknown:true,committed:error.committed,issue:codeOf(error)});throw error;}
    return this._pendingUpdateOutcome(operation,raw);
  }
  async _run(operation,request){
    try{
      const {context}=operation,signal=operation.controller.signal;this._assert(operation);
      if(request.versionId&&!versionId(request.versionId,context.component))fail('invalid_version');
      if(request.action==='status')return await this._status(operation);
      if(['pending-list','pending-preview','pending-confirm'].includes(request.action))return await this._pendingUpdateRun(operation,request);
      if(['preparation-list','preparation-preview','preparation-recover'].includes(request.action))return await this._preparationRun(operation,request);
      if(['repair-preview','repair'].includes(request.action))return await this._repairRun(operation,request);
      if(['lock-preview','lock-recover'].includes(request.action))return await this._lockRun(operation,request);
      if(request.action==='inspect'){const raw=await context.packages.inspect({version:VERSION,signal});this._assert(operation);return {release:releaseSummary(raw,context.component)};}
      if(request.action==='prepare'){
        const staged=await context.packages.stage({version:VERSION,signal});this._assert(operation);if(!staged||staged.version!==VERSION||!hex(staged.sha256))fail('invalid_response');this._phase(operation,'preparing');
        let raw;try{raw=await context.prepared.prepare({version:VERSION,signal});}catch(error){if(error?.committed===true)return await this._preparedPublished(operation,staged,error);this._assert(operation);if(error?.code!=='version_exists')throw error;raw=await context.prepared.resolvePrepared(`${context.component}-${VERSION}-${staged.sha256.slice(0,16)}`,{signal});}
        this._assert(operation);const prepared=preparedSummary(raw,true,context.component);if(prepared.sha256!==staged.sha256)fail('invalid_response');this.state.prepared=[...this.state.prepared.filter(row=>row.versionId!==prepared.versionId),{...prepared,verified:false}].slice(-32);return {prepared};
      }
      if(request.action==='preview'){
        const raw=await context.selector.preview({operation:request.operation,...(request.versionId?{versionId:request.versionId}:{}),signal});this._assert(operation);
        const preview=selection(raw,{preview:true,operation:request.operation,component:context.component});this._remember(preview);this.state.candidate=preview.candidate;return {preview};
      }
      const options={expectedDigest:request.expectedDigest,assertCurrent:()=>this._assert(operation),signal,...(request.action==='activate'?{versionId:request.versionId}:{})};
      let raw;try{raw=await context.selector[request.action](options);}catch(error){if(error?.committed===true)return await this._committed(operation,null,codeOf(error));throw error;}
      return await this._committed(operation,raw);
    }catch(error){const code=operation.controller.signal.aborted?operation.abortCode||'cancelled':codeOf(error);if(this._same(operation.context))this.state.lastCode=code;throw new QQComponentsError(code);}
    finally{clearInterval(operation.watch);if(operation.guarded)this.console.busy.delete(MARKER);if(this.active===operation){this.active=null;this.state.busy=false;this.state.phase='idle';this.state.operationId=null;}this._notify();}
  }
  async execute(value){
    if(typeof value?.action==='string'&&value.action.startsWith('node-repair-')){if(this.active&&value.action!=='node-repair-dismiss')fail('operation_in_progress');return this.nodeRepair.execute(value);}
    const request=validate(value);
    if(this.nodeRepair.busy()){
      if(request.action==='status')return {state:this.snapshot()};
      if(request.action==='cancel'){await this.nodeRepair.dismissCurrent();return {cancelRequested:true};}
      if(!['repair-dismiss','preparation-dismiss','pending-dismiss'].includes(request.action))fail('operation_in_progress');
    }
    if(request.action==='cancel'){this.lockPreview=null;this._discardRepair();this._discardPreparation();this._discardPendingUpdate();return {cancelRequested:!!this.active&&this._abort(this.active,'cancelled')};}
    if(request.action==='repair-dismiss'){this._discardRepair();return {cancelRequested:!!this.active&&['repair-preview','repair'].includes(this.active.action)&&this._abort(this.active,'cancelled')};}
    if(request.action==='preparation-dismiss'){this._discardPreparation();return {cancelRequested:!!this.active&&['preparation-preview','preparation-recover'].includes(this.active.action)&&this._abort(this.active,'cancelled')};}
    if(request.action==='pending-dismiss'){this._discardPendingUpdate();return {cancelRequested:!!this.active&&['pending-list','pending-preview','pending-confirm'].includes(this.active.action)&&this._abort(this.active,'cancelled')};}
    if(this.closed||this.console.closed)fail('manager_closing');
    if(request.action==='status'&&!this.console.runtime&&this.console.canInspectNodeRepair?.())return {state:{...this.snapshot(),component:'napcat-node',nodeRepairAvailable:true}};
    if(this.active){if(request.action==='status')return {state:this.snapshot()};fail('operation_in_progress');}
    if(this.console.busy.has('qq-setup')&&request.action!=='status')fail('operation_in_progress');
    let context;try{context=this._context();}catch(error){throw new QQComponentsError(codeOf(error));}
    const guarded=['prepare','activate','rollback','lock-preview','lock-recover','repair-preview','repair','preparation-preview','preparation-recover','pending-preview','pending-confirm'].includes(request.action);if(guarded&&this.console.busy.size)fail('operation_in_progress');
    const operation={context,controller:new AbortController(),abortCode:null,committed:false,guarded,id:randomUUID(),action:request.action,lockPreview:request.action==='lock-recover'?this.lockPreview:null,repairPreview:request.action==='repair'?this.repairPreview:null,preparationPreview:request.action==='preparation-recover'?this.preparationPreview:null,pendingUpdatePreview:request.action==='pending-confirm'?this.pendingUpdatePreview:null};if(request.action!=='status')this.lockPreview=null;
    if(request.action==='repair')this.repairPreview=null;else if(request.action!=='status')this._discardRepair();
    if(request.action==='preparation-recover')this.preparationPreview=null;else this._discardPreparation();
    if(request.action==='pending-confirm')this.pendingUpdatePreview=null;else this._discardPendingUpdate();
    if(guarded){this.console.busy.add(MARKER);if(request.action!=='prepare')this.console.abortDirectory?.();}
    this.active=operation;Object.assign(this.state,{busy:true,phase:{status:'checking',inspect:'inspecting',prepare:'downloading',preview:'previewing',activate:'activating',rollback:'rolling_back','lock-preview':'checking_lock','lock-recover':'recovering_lock','repair-preview':'checking_repair',repair:'repairing','preparation-list':'listing_preparations','preparation-preview':'checking_preparation','preparation-recover':'recovering_preparation','pending-list':'listing_pending_updates','pending-preview':'checking_pending_update','pending-confirm':'disabling_pending_update'}[request.action],operationId:operation.id,lastCode:null});
    operation.watch=setInterval(()=>{if(!operation.committed&&!this._same(context)){this._reset();this._abort(operation,this.closed?'manager_closing':'changed');}},100);
    // Publish only after the owned promise exists: an observer may close the
    // manager immediately, and shutdown must still wait for this operation.
    operation.promise=Promise.resolve().then(()=>this._run(operation,request));this._notify();const result=await operation.promise;
    // Status is a lightweight snapshot after its owned operation has settled.
    return request.action==='status'?{state:this.snapshot()}:result;
  }
  async close(){
    this.closed=true;this.lockPreview=null;this._discardRepair();this._discardPreparation();this._discardPendingUpdate();
    const operation=this.active;if(operation)this._abort(operation,'manager_closing');
    const outcomes=await Promise.allSettled([this.nodeRepair.close(),operation?.promise]);this.context?.pendingUpdate?.close();
    if(outcomes[0].status==='rejected')throw outcomes[0].reason;
    if(outcomes[0].value?.closed!==true)throw new QQComponentsError('node_repair_cleanup_unconfirmed');return {closed:true};
  }
}
module.exports={QQComponents,QQComponentsError};
