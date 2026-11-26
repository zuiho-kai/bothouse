'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const {QQRuntimeManager}=require('./qq-runtime.cjs');
const {NapCatWebUI}=require('./napcat-webui.cjs');
const {QQProfileConfig}=require('./qq-profile-config.cjs');
const {QQProfileBackups}=require('./qq-profile-backups.cjs');
const {projectStatusIssue}=require('./qq-diagnostic-report.cjs');
const {validateQQOwner}=require('./qq.cjs');
const {installation,readInstallationSettings,writeInstallationSettings,installationSummary}=require('./qq-installation-settings.cjs');
const INSTALLATION_MARKER='qq-installation-switch';
const installationError=code=>Object.assign(new Error(`QQ installation: ${code}`),{code});
const installationCode=error=>new Set(['installation_selection_invalid','installation_selection_changed','installation_save_failed','managed_installation_changed','setup_readback_failed','unsafe_path','invalid_installation','missing_components','operation_in_progress','changed','cancelled','desktop_running','process_check_failed','manager_closing']).has(error?.code)?error.code:'installation_selection_invalid';

const directoryError=code=>Object.assign(Error(`QQ directory: ${code}`),{code});
function validateDirectoryRequest(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['accountId','kind','groupId','serverName','fresh'].includes(key))||typeof value.accountId!=='string'||!['friends','groups','members'].includes(value.kind)||(value.fresh!==undefined&&typeof value.fresh!=='boolean')||(value.serverName!==undefined&&(typeof value.serverName!=='string'||!value.serverName.trim()||value.serverName!==value.serverName.trim()||value.serverName.length>64||/[\x00-\x1f\x7f]/.test(value.serverName))))throw directoryError('invalid_config');
  try{validateQQOwner(value.accountId);}catch{throw directoryError('invalid_config');}
  if(value.kind==='members'){try{if(typeof value.groupId!=='string'||validateQQOwner(value.groupId)!==value.groupId)throw Error();}catch{throw directoryError('invalid_config');}}
  else if(Object.hasOwn(value,'groupId'))throw directoryError('invalid_config');
  return {accountId:value.accountId,kind:value.kind,...(value.kind==='members'?{groupId:value.groupId}:{}),...(value.serverName!==undefined?{serverName:value.serverName}:{}),fresh:value.fresh??false};
}
const directoryFingerprint=connection=>createHash('sha256').update(JSON.stringify([connection.accountId,connection.serverName,connection.url,connection.token])).digest('hex');
function projectMemberDirectory(result,request){
  if(result.groupId!==request.groupId)throw directoryError('group_changed');
  if(result.items.length>10000)throw directoryError('response_too_large');
  const text=value=>{if(typeof value!=='string'||value.length>500||/[\p{Cc}\p{Cf}\u2028\u2029\ud800-\udfff]/u.test(value))throw directoryError('invalid_response');return value;};
  const seen=new Set(),items=result.items.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||!['owner','admin','member'].includes(row.role))throw directoryError('invalid_response');
    let id;try{if(typeof row.id!=='string')throw Error();id=validateQQOwner(row.id);if(id!==row.id)throw Error();}catch{throw directoryError('invalid_response');}
    if(seen.has(id))throw directoryError('invalid_response');seen.add(id);
    return {id,nickname:text(row.nickname),card:text(row.card),role:row.role};
  });
  return {kind:'members',accountId:request.accountId,groupId:request.groupId,items,fetchedAt:result.fetchedAt,source:'bridge-cache'};
}
const ORPHAN_MARKER='qq-orphan-cleanup';
const ORPHAN_CODES=new Set(['invalid_config','invalid_account','invalid_response','operation_failed','operation_in_progress','changed','preview_required','manager_closing','unsupported_platform','missing_components','invalid_installation','desktop_running','external_process','external_qq_unknown','runtime_locked','process_check_failed','ownership_lost','not_owned','stop_failed','unsafe_lock','recovery_required','owner_alive','orphaned_children','runtime_running','orphan_cleanup_unavailable','orphan_cleanup_changed','orphan_cleanup_unverified','orphan_cleanup_incomplete','account_connected']);
const orphanErrorCode=error=>ORPHAN_CODES.has(error?.code)?error.code:'operation_failed';
const orphanError=code=>Object.assign(Error(`QQ orphan cleanup: ${ORPHAN_CODES.has(code)?code:'operation_failed'}`),{code:ORPHAN_CODES.has(code)?code:'operation_failed'});
ORPHAN_CODES.add('cleanup_unconfirmed');
function orphanCleanupReceipt(value,accountId){
  if(value?.kind==='pending-shell-inspection-resources'){
    const keys=['kind','accountId','resources','processControlAttempted','leaseMutationAttempted','pendingUpdateRecordsModified','automaticStart'];
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key))||typeof value.accountId!=='string'||accountId!==undefined&&value.accountId!==accountId)return null;
    try{validateQQOwner(value.accountId);}catch{return null;}
    if(!['closed','unconfirmed'].includes(value.resources)||keys.slice(3).some(key=>value[key]!==false))return null;
    return Object.fromEntries(keys.map(key=>[key,value[key]]));
  }
  const keys=['kind','accountId','selectedCount','confirmedAbsentCount','terminationAttempted','processes','lease','resources','automaticStart','pendingUpdateRecoveryRequired'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key))||value.kind!=='pending-shell-orphan-cleanup'||typeof value.accountId!=='string'||accountId!==undefined&&value.accountId!==accountId)return null;
  try{validateQQOwner(value.accountId);}catch{return null;}
  if(!Number.isSafeInteger(value.selectedCount)||value.selectedCount<1||value.selectedCount>64||typeof value.terminationAttempted!=='boolean'||value.automaticStart!==false||value.pendingUpdateRecoveryRequired!==true||!['confirmed-absent','remaining','unverified'].includes(value.processes)||!['cleared','retained','unverified'].includes(value.lease)||!['closed','unconfirmed'].includes(value.resources))return null;
  const n=value.confirmedAbsentCount;
  if(value.processes==='unverified'?n!==null:!Number.isSafeInteger(n)||n<0||n>value.selectedCount||value.processes==='confirmed-absent'&&n!==value.selectedCount||value.processes==='remaining'&&n>=value.selectedCount)return null;
  if(value.lease==='cleared'&&value.processes!=='confirmed-absent')return null;
  return Object.fromEntries(keys.map(key=>[key,value[key]]));
}
const CONFIG_RECOVERY_CODES=new Set(['configuration_handle_close_failed','configuration_marker_retained']);
const COMPONENT_RECOVERY_CODES=new Set(['component_lock_handle_close_failed','component_lock_retained','component_lock_state_unverified']);
function recoveryWarnings(value){
  const warnings={};
  if(value?.configurationRecoveryIssue!==undefined)warnings.configurationRecoveryIssue=CONFIG_RECOVERY_CODES.has(value.configurationRecoveryIssue)?value.configurationRecoveryIssue:'configuration_cleanup_unverified';
  if(value?.lockRecoveryIssue!==undefined)warnings.lockRecoveryIssue=COMPONENT_RECOVERY_CODES.has(value.lockRecoveryIssue)?value.lockRecoveryIssue:'component_lock_state_unverified';
  return warnings;
}
function validateOrphanRequest(kind,value){
  if(!['preview','cleanup','discard'].includes(kind)||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!(kind==='preview'?['accountId']:['accountId','expectedDigest']).includes(key))||typeof value.accountId!=='string'||(kind!=='preview'&&(typeof value.expectedDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.expectedDigest))))throw orphanError('invalid_config');
  try{validateQQOwner(value.accountId);}catch{throw orphanError('invalid_config');}
  return {accountId:value.accountId,...(kind!=='preview'?{expectedDigest:value.expectedDigest}:{})};
}
function orphanBinding(runtime,accountId){
  const value=runtime.instance(accountId);if(value?.accountId!==accountId)throw orphanError('invalid_account');
  const keys=['accountId','componentsRoot','runtimeDir','workDir','configDir','qqExe','launcher','onebotConfigPath'];
  const fields=keys.map(key=>{const field=value[key];if(field!==undefined&&(typeof field!=='string'||field.length>4096))throw orphanError('invalid_response');return field||null;});
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

// The renderer receives only status, local QR images and classified diagnostics.
// Local WebUI tokens and authentication credentials never cross this boundary.
class QQConsole {
  constructor({root,vault,profileRoot,componentStoreRoot,lockRoot,managedSetupReader=options=>require('./qq-managed-setup.cjs').readManagedShellInstallation(options),managedNodeSetupReader=options=>require('./qq-managed-node-setup.cjs').readManagedNodeInstallation(options),onChange=()=>{},qrEncoder,runtimeFactory=options=>new QQRuntimeManager(options),clientFactory=options=>new NapCatWebUI(options),profileFactory=options=>new QQProfileConfig(options),backupFactory=options=>new QQProfileBackups(options),directoryFactory=()=>new (require('./qq-directory.cjs').QQDirectoryReader)(),groupMembersFactory=()=>new (require('./qq-group-members.cjs').QQGroupMembersReader)()}){
    this.root=root;this.file=path.join(root,'qq-runtime-settings.json');this.onChange=onChange;this.qrEncoder=qrEncoder;this.runtimeFactory=runtimeFactory;this.clientFactory=clientFactory;this.profileFactory=profileFactory;this.clients=new Map();this.epoch=0;this.refreshRevision=0;this.closed=false;this.refreshing=null;this.busy=new Set();this.state=null;
    this.vault=vault;this.profileRoot=profileRoot;this.directoryFactory=directoryFactory;this.groupMembersFactory=groupMembersFactory;this.directoryRequests=new Map();this.orphanPreviews=new Map();this.orphanOperation=null;this.statusIssues=new Map();
    this.lockRoot=path.resolve(lockRoot||path.join(process.env.LOCALAPPDATA||os.homedir(),'AgentArcade','qq-runtime-locks'));this.componentStoreRoot=path.resolve(componentStoreRoot||path.join(path.dirname(this.lockRoot),'qq-components'));this.managedSetupReader=managedSetupReader;this.managedNodeSetupReader=managedNodeSetupReader;this.installationOperation=null;this.selectionIssue=null;this.installationSettings=null;this.selectionDigest=null;this.runtime=null;
    try{const saved=readInstallationSettings(this.file);this.installationSettings=saved.value;this.selectionDigest=saved.digest;this.runtime=this.makeRuntime(saved.value.current);if(saved.value.current.kind==='legacy'&&saved.value.current.desktopDataRoot===null&&typeof this.runtime.desktopDataRoot==='string')this.installationSettings.current={kind:'legacy',desktopDataRoot:this.runtime.desktopDataRoot};}
    catch(error){this.selectionIssue=installationCode(error);this.state=this.installationFailure();}
    this.backupFactory=backupFactory;
  }
  readManaged(descriptor){const reader=descriptor.kind==='managed-node'?this.managedNodeSetupReader:this.managedSetupReader,value=reader({root:this.componentStoreRoot,setupId:descriptor.setupId});if(value&&typeof value.then==='function'||value?.setupId!==descriptor.setupId||value?.descriptorSha256!==descriptor.descriptorSha256||(descriptor.kind==='managed-node'&&value.engine!=='managed-node'))throw installationError('managed_installation_changed');return value;}
  makeRuntime(descriptor){descriptor=installation(descriptor);const options={root:this.root,lockRoot:this.lockRoot,componentStoreRoot:this.componentStoreRoot,vault:this.vault,profileRoot:this.profileRoot,onChange:()=>this.onChange()};if(['managed-shell','managed-node'].includes(descriptor.kind)){this.readManaged(descriptor);options[descriptor.kind==='managed-node'?'managedNodeInstallation':'managedInstallation']=()=>this.readManaged(descriptor);}else options.desktopDataRoot=descriptor.desktopDataRoot||undefined;return this.runtimeFactory(options);}
  installationSelection(){return this.installationSettings?{...installationSummary(this.installationSettings),...(this.selectionIssue?{issue:this.selectionIssue}:{})}:{current:null,previous:null,canReturn:false,issue:this.selectionIssue||'installation_selection_invalid'};}
  captureNodeRepairSelection({contextKey,knownRegisteredProfiles=[]}={}){
    if(this.closed)throw installationError('manager_closing');
    if(typeof contextKey!=='string'||!/^[a-f0-9]{64}$/.test(contextKey)||!Array.isArray(knownRegisteredProfiles)||knownRegisteredProfiles.length>32)throw installationError('node_repair_unavailable');
    const saved=readInstallationSettings(this.file),selected=saved.value.current;
    if(selected.kind!=='managed-node'||saved.digest!==this.selectionDigest||JSON.stringify(selected)!==JSON.stringify(this.installationSettings?.current))throw installationError('node_repair_unavailable');
    // This separate reader validates immutable metadata but permits code damage.
    // Normal runtime construction and start keep their stricter reader.
    const metadata=require('./qq-managed-node-repair-metadata.cjs').readManagedNodeRepairMetadata({root:this.componentStoreRoot,setupId:selected.setupId,descriptorSha256:selected.descriptorSha256});
    if(metadata?.setupId!==selected.setupId||metadata.descriptorSha256!==selected.descriptorSha256)throw installationError('managed_installation_changed');
    const profiles=knownRegisteredProfiles.map(row=>{
      if(!row||typeof row.profileId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(row.profileId)||typeof row.label!=='string'||!row.label||row.label.length>120||/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(row.label))throw installationError('node_repair_unavailable');
      return {profileId:row.profileId,label:row.label};
    });
    return {setupId:selected.setupId,descriptorSha256:selected.descriptorSha256,selectionDigest:saved.digest,epoch:this.epoch,contextKey,knownRegisteredProfiles:profiles};
  }
  canInspectNodeRepair(){
    if(this.installationSettings?.current?.kind!=='managed-node')return false;
    try{this.captureNodeRepairSelection({contextKey:'0'.repeat(64)});return true;}catch{return false;}
  }
  async refreshAfterNodeRepair(captured){
    const current=this.captureNodeRepairSelection(captured);
    if(JSON.stringify(current)!==JSON.stringify(captured))throw installationError('changed');
    if(!this.runtime){
      // Reconstruct only after successful code proof. This does not start QQ,
      // change selection bytes, or weaken the ordinary installation reader.
      const runtime=this.makeRuntime(this.installationSettings.current);
      this.runtime=runtime;this.selectionIssue=null;this.epoch++;
    }
    this.refreshRevision++;this.refreshing=null;return this.refresh();
  }
  installationFailure(){return {configured:false,components:{available:false},instances:[],issue:this.selectionIssue||'installation_selection_invalid',installation:this.installationSelection(),canInspectNodeRepair:this.canInspectNodeRepair()};}
  snapshot(){return this.state;}
  check(runtime,epoch){if(this.closed||runtime!==this.runtime||epoch!==this.epoch)throw Object.assign(Error('QQ manager changed'),{code:'changed'});if(this.selectionIssue||!runtime)throw installationError(this.selectionIssue||'installation_selection_invalid');}
  abortDirectory(accountId){
    for(const [id,request]of this.directoryRequests){if(accountId!==undefined&&id!==accountId)continue;request.controller.abort();this.directoryRequests.delete(id);}
  }
  retireOrphanPreviews(accountId){
    for(const [id,preview] of this.orphanPreviews){if(accountId!==undefined&&id!==accountId)continue;preview.valid=false;this.orphanPreviews.delete(id);
      // Scope invalidation is synchronous even if a stale runtime cannot retire
      // its own ticket. Every pending effect also receives the same scope check.
      if(preview.expectedDigest)try{preview.runtime.discardOrphanPreview?.(id,{expectedDigest:preview.expectedDigest});}catch{/* The caller's scope is already revoked. */}
    }
  }
  discardOrphanPreview(accountId,options){
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>key!=='expectedDigest'))throw orphanError('invalid_config');
    const request=validateOrphanRequest('discard',{accountId,...options});const preview=this.orphanPreviews.get(accountId);
    if(!preview||preview.expectedDigest!==request.expectedDigest)return {discarded:false};
    this.retireOrphanPreviews(accountId);return {discarded:true};
  }
  orphanCleanupChangesRuntime(value){
    // Read only: the IPC wrapper must not retire another account's foreground
    // launch for a resource-only ticket or an invalid cleanup request.
    let request;try{request=validateOrphanRequest('cleanup',value);}catch{return false;}
    const ticket=this.orphanPreviews.get(request.accountId);
    if(!ticket||this.closed||this.selectionIssue||!ticket.valid||ticket.consumed||ticket.runtime!==this.runtime||ticket.epoch!==this.epoch||ticket.expectedDigest!==request.expectedDigest||ticket.resourceOnly)return false;
    try{return orphanBinding(this.runtime,request.accountId)===ticket.binding;}catch{return false;}
  }
  async previewOrphanCleanup(accountId){
    validateOrphanRequest('preview',{accountId});const runtime=this.runtime,epoch=this.epoch;this.check(runtime,epoch);
    if(this.busy.size)throw orphanError('operation_in_progress');const resourceOnly=runtime.hasOrphanInspectionResources?.(accountId)===true,binding=resourceOnly?null:orphanBinding(runtime,accountId);if(typeof runtime.previewOrphanCleanup!=='function')throw orphanError('orphan_cleanup_unavailable');
    this.retireOrphanPreviews(accountId);const ticket={runtime,epoch,binding,resourceOnly,valid:true,consumed:false,expectedDigest:null};this.orphanPreviews.set(accountId,ticket);this.busy.add(ORPHAN_MARKER);
    const current=()=>{this.check(runtime,epoch);if(!ticket.valid||this.orphanPreviews.get(accountId)!==ticket||!resourceOnly&&orphanBinding(runtime,accountId)!==binding)throw orphanError('changed');};let value;
    try{
      value=await runtime.previewOrphanCleanup(accountId,{assertCurrent:current});current();
      if(resourceOnly){
        const keys=['kind','action','accountId','expectedDigest','expiresAt','automaticStart'];
        if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||value.kind!=='pending-shell-inspection-resources'||value.action!=='settle-resources'||value.accountId!==accountId||typeof value.expectedDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.expectedDigest)||typeof value.expiresAt!=='string'||value.expiresAt.length>40||!Number.isFinite(Date.parse(value.expiresAt))||value.automaticStart!==false)throw orphanError('invalid_response');
        ticket.expectedDigest=value.expectedDigest;while(this.orphanPreviews.size>32)this.retireOrphanPreviews(this.orphanPreviews.keys().next().value);return Object.fromEntries(keys.map(key=>[key,value[key]]));
      }
      const extended=value?.action!==undefined;
      if(value?.accountId!==accountId||!Number.isInteger(value.count)||value.count<(extended&&value.action==='settle'?0:1)||value.count>64||typeof value.expectedDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.expectedDigest)||value.automaticStart!==false||extended&&(value.kind!=='verified-orphan-cleanup'||!['terminate','settle'].includes(value.action)||value.action==='settle'&&value.count!==0||typeof value.expiresAt!=='string'||value.expiresAt.length>40||!Number.isFinite(Date.parse(value.expiresAt))))throw orphanError('invalid_response');
      const preview={accountId,count:value.count,expectedDigest:value.expectedDigest,automaticStart:false,...(extended?{kind:value.kind,action:value.action,expiresAt:value.expiresAt}:{})};ticket.expectedDigest=preview.expectedDigest;while(this.orphanPreviews.size>32)this.retireOrphanPreviews(this.orphanPreviews.keys().next().value);return preview;
    }catch(error){if(typeof value?.expectedDigest==='string'&&/^[a-f0-9]{64}$/.test(value.expectedDigest))try{runtime.discardOrphanPreview?.(accountId,{expectedDigest:value.expectedDigest});}catch{/* Retained scope checks still reject any effect. */}if(this.orphanPreviews.get(accountId)===ticket)this.retireOrphanPreviews(accountId);throw orphanError(orphanErrorCode(error));}finally{this.busy.delete(ORPHAN_MARKER);}
  }
  async cleanupOrphans(accountId,options,beforeStop=async()=>{}){
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>key!=='expectedDigest'))throw orphanError('invalid_config');
    const request=validateOrphanRequest('cleanup',{accountId,...options});if(typeof beforeStop!=='function')throw orphanError('invalid_config');
    const runtime=this.runtime,epoch=this.epoch;this.check(runtime,epoch);if(this.busy.size)throw orphanError('operation_in_progress');
    const preview=this.orphanPreviews.get(accountId);if(!preview||preview.consumed||preview.expectedDigest!==request.expectedDigest)throw orphanError('preview_required');
    if(!preview.valid||preview.runtime!==runtime||preview.epoch!==epoch||!preview.resourceOnly&&orphanBinding(runtime,accountId)!==preview.binding){this.retireOrphanPreviews(accountId);throw orphanError('changed');}
    if(typeof runtime.cleanupOrphans!=='function')throw orphanError('orphan_cleanup_unavailable');
    preview.consumed=true;if(!preview.resourceOnly)this.abortDirectory();this.busy.add(ORPHAN_MARKER);
    const current=()=>{this.check(runtime,epoch);if(!preview.valid||this.orphanPreviews.get(accountId)!==preview||!preview.resourceOnly&&orphanBinding(runtime,accountId)!==preview.binding)throw orphanError('changed');};
    const operation=Promise.resolve().then(async()=>{
      const value=await runtime.cleanupOrphans(accountId,{expectedDigest:request.expectedDigest,assertCurrent:current,beforeStop:async()=>{current();if(preview.resourceOnly)throw orphanError('changed');await beforeStop();current();}});
      if(preview.resourceOnly){
        const keys=['recovery','accountId','automaticStart','cleanup'],detail=orphanCleanupReceipt(value?.cleanup,accountId);
        if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||value.accountId!==accountId||value.recovery!=='inspection-resources-settled'||value.automaticStart!==false||detail?.kind!=='pending-shell-inspection-resources'||detail.resources!=='closed')throw Object.assign(orphanError('invalid_response'),{cleanupAttempted:true});
        // The exact inspection resources are closed. Do not disconnect a
        // client, query a bridge or refresh process state as a side effect.
        // Retire a read already in flight so an explicit later refresh cannot
        // reuse a snapshot captured before this known resource closure.
        if(this.runtime===runtime&&this.epoch===epoch){this.refreshRevision++;this.refreshing=null;}
        return {recovery:value.recovery,accountId,automaticStart:false,cleanup:detail};
      }
      if(value?.accountId!==accountId||value?.recovery!=='orphans-cleared'||!Number.isInteger(value.terminatedCount)||value.terminatedCount<0||value.terminatedCount>64||value.automaticStart!==false)throw Object.assign(orphanError('invalid_response'),{cleanupAttempted:true});
      const detail=value.cleanup===undefined?null:orphanCleanupReceipt(value.cleanup,accountId);if(value.cleanup!==undefined&&(!detail||detail.processes!=='confirmed-absent'||detail.lease!=='cleared'||detail.resources!=='closed'))throw Object.assign(orphanError('invalid_response'),{cleanupAttempted:true});
      const receipt={recovery:'orphans-cleared',terminatedCount:value.terminatedCount,automaticStart:false,...(detail?{cleanup:detail}:{})};
      // Runtime cleanup is already confirmed. A later endpoint/status problem
      // cannot turn that result into a claim that nothing was changed.
      try{current();this.clients.get(accountId)?.client.close();this.clients.delete(accountId);this.refreshRevision++;this.refreshing=null;const state=await this.refresh();current();return {...receipt,state};}
      catch(error){return {...receipt,refreshIssue:orphanErrorCode(error)};}
    });this.orphanOperation=operation;
    try{return await operation;}catch(error){let detail=error?.cleanupAttempted===true?orphanCleanupReceipt(error.cleanup,accountId):null;if(detail&&(detail.kind==='pending-shell-inspection-resources')!==preview.resourceOnly)detail=null;throw Object.assign(orphanError(orphanErrorCode(error)),error?.cleanupAttempted===true?{cleanupAttempted:true,...(detail?{cleanup:detail}:{})}:{});}finally{if(this.orphanPreviews.get(accountId)===preview)this.retireOrphanPreviews(accountId);if(this.orphanOperation===operation)this.orphanOperation=null;this.busy.delete(ORPHAN_MARKER);}
  }
  async directory(accountId,options={}){
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.hasOwn(options,'accountId'))throw directoryError('invalid_config');
    const request=validateDirectoryRequest({...options,accountId}),runtime=this.runtime,epoch=this.epoch;
    this.check(runtime,epoch);runtime.instance(accountId);
    if(this.busy.size)throw directoryError('operation_in_progress');
    this.abortDirectory(accountId);const ticket={controller:new AbortController()};this.directoryRequests.set(accountId,ticket);
    const current=()=>{this.check(runtime,epoch);if(ticket.controller.signal.aborted||this.directoryRequests.get(accountId)!==ticket)throw directoryError('cancelled');};
    try{
      const profiles=this.profiles(runtime),connection=profiles.connection(accountId,request.serverName),fingerprint=directoryFingerprint(connection);
      if(connection.accountId!==accountId)throw directoryError('account_mismatch');
      const endpoint=await runtime.getConnection(accountId);current();
      if(!endpoint.ownershipVerified||typeof endpoint.endpointId!=='string'||!endpoint.endpointId)throw directoryError('endpoint_unverified');
      if(directoryFingerprint(profiles.connection(accountId,request.serverName))!==fingerprint)throw directoryError('changed');
      const reader=request.kind==='members'?this.groupMembersFactory():this.directoryFactory();
      const result=await reader.read({...(request.kind==='members'?{groupId:request.groupId}:{kind:request.kind}),url:connection.url,token:connection.token,expectedAccountId:accountId,signal:ticket.controller.signal,fresh:request.fresh});current();
      const after=await runtime.getConnection(accountId);current();
      if(!after.ownershipVerified||after.endpointId!==endpoint.endpointId||directoryFingerprint(profiles.connection(accountId,request.serverName))!==fingerprint)throw directoryError('changed');
      if(result?.accountId!==accountId||result?.kind!==request.kind)throw directoryError('account_changed');
      if(!Array.isArray(result.items)||result.source!=='bridge-cache'||typeof result.fetchedAt!=='string'||!Number.isFinite(Date.parse(result.fetchedAt)))throw directoryError('invalid_response');
      // This result is intentionally returned only to the requesting page. It
      // never enters the global snapshot, logs, AI context or retained memory.
      if(request.kind==='members')return projectMemberDirectory(result,request);
      return {kind:result.kind,accountId:result.accountId,items:result.items,fetchedAt:result.fetchedAt,source:'bridge-cache'};
    }finally{if(this.directoryRequests.get(accountId)===ticket)this.directoryRequests.delete(accountId);ticket.controller.abort();}
  }
  async setDirectory(directory){
    if(typeof directory!=='string'||!path.isAbsolute(directory)||!fs.statSync(directory).isDirectory())throw Object.assign(Error('Invalid component folder'),{code:'invalid_config'});
    const receipt=await this.switchInstallation({kind:'legacy',desktopDataRoot:fs.realpathSync(directory)});return {...(receipt.state||this.state),installationCommitted:true,...(receipt.refreshIssue?{refreshIssue:receipt.refreshIssue}:{})};
  }
  async setManagedSetup(value,options={}){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['engine','setupId','descriptorSha256'].includes(key))||(value.engine!==undefined&&!['managed-shell','managed-node'].includes(value.engine)))throw installationError('installation_selection_invalid');const {engine='managed-shell',...record}=value;return this.switchInstallation(installation({kind:engine,...record}),options);}
  setPreviousInstallation(options={}){if(!this.installationSettings?.previous)return Promise.reject(installationError('previous_installation_unavailable'));return this.switchInstallation(this.installationSettings.previous,options);}
  async switchInstallation(value,options={}){
    const target=installation(value),original=this.runtime,epoch=this.epoch;
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['assertCurrent','signal','operationMarker'].includes(key))||(options.assertCurrent!==undefined&&typeof options.assertCurrent!=='function')||(options.operationMarker!==undefined&&(options.operationMarker!=='qq-setup'||typeof options.assertCurrent!=='function')))throw installationError('installation_selection_invalid');
    const current=()=>{this.check(original,epoch);if(options.signal?.aborted)throw installationError('cancelled');const result=options.assertCurrent?.();if(result&&typeof result.then==='function')throw installationError('installation_selection_invalid');if([...this.busy].some(key=>key!==INSTALLATION_MARKER&&key!==options.operationMarker))throw installationError('operation_in_progress');};
    current();if(this.installationOperation||this.busy.has(INSTALLATION_MARKER))throw installationError('operation_in_progress');if(JSON.stringify(target)===JSON.stringify(this.installationSettings.current))throw installationError('already_selected');this.busy.add(INSTALLATION_MARKER);this.abortDirectory();this.retireOrphanPreviews();
    const stopped=(view,runtime=original)=>{if(!view||!Array.isArray(view.instances)||view.issue)throw installationError('process_check_failed');if(view.desktopRunning)throw installationError('desktop_running');if(runtime.runs?.size||runtime.pending?.size||view.instances.some(row=>row.processRunning||row.recoveryRequired||['owned','unknown','recoverable','external'].includes(row.management)))throw installationError('operation_in_progress');};
    const operation=Promise.resolve().then(async()=>{
      stopped(await original.discover());current();const candidate=this.makeRuntime(target),discovered=await candidate.discover();current();if(!discovered?.configured||discovered.issue||!Array.isArray(discovered.instances))throw installationError('missing_components');stopped(discovered,candidate);
      stopped(await original.discover());current();
      // The candidate may change while the old installation is observed.
      // This bounded recheck does not claim an atomic OS-wide process lock.
      const candidateNow=await candidate.discover();current();if(!candidateNow?.configured||candidateNow.issue||!Array.isArray(candidateNow.instances))throw installationError('missing_components');stopped(candidateNow,candidate);
      if(['managed-shell','managed-node'].includes(target.kind))this.readManaged(target);
      const next={version:2,current:target,previous:this.installationSettings.current};let saved,saveIssue;
      try{saved=writeInstallationSettings(this.file,next,{expectedDigest:this.selectionDigest,assertCurrent:current});}catch(error){if(!error.committed)throw error;saved=error;saveIssue=installationCode(error);}
      this.installationSettings=saved.value;this.selectionDigest=saved.digest;this.epoch++;this.refreshRevision++;this.retireOrphanPreviews();for(const item of this.clients.values()){try{item.client.close();}catch{/* A committed selection is not undone by client cleanup. */}}this.clients.clear();this.runtime=candidate;this.state={...discovered,installation:this.installationSelection()};this.refreshing=null;
      const receipt={committed:true,installation:this.installationSelection(),automaticStart:false};if(saveIssue){this.selectionIssue=saveIssue;this.state=this.installationFailure();return {...receipt,refreshIssue:saveIssue,state:this.state};}
      try{this.onChange();return {...receipt,state:await this.refresh()};}catch(error){return {...receipt,refreshIssue:installationCode(error),state:this.state};}
    });this.installationOperation=operation;
    try{return await operation;}finally{if(this.installationOperation===operation)this.installationOperation=null;this.busy.delete(INSTALLATION_MARKER);}
  }
  profiles(runtime=this.runtime){return this.profileFactory({runtime,backupRoot:path.join(this.root,'qq-profile-backups')});}
  backups(runtime=this.runtime,epoch=this.epoch){return this.backupFactory({profiles:this.profiles(runtime),assertCurrent:()=>this.check(runtime,epoch)});}
  listBackups(accountId,options){this.check(this.runtime,this.epoch);if(this.busy.size)throw Object.assign(Error('QQ operation in progress'),{code:'operation_in_progress'});return this.backups().list(accountId,options);}
  previewBackup(accountId,options){this.check(this.runtime,this.epoch);if(this.busy.size)throw Object.assign(Error('QQ operation in progress'),{code:'operation_in_progress'});return this.backups().preview(accountId,options);}
  async restoreBackup(accountId,options){
    const runtime=this.runtime,epoch=this.epoch;this.check(runtime,epoch);
    if(this.busy.size)throw Object.assign(Error('QQ operation in progress'),{code:'operation_in_progress'});
    this.abortDirectory(accountId);this.busy.add(accountId);
    try{
      const result=await this.backups(runtime,epoch).restore(accountId,options);
      const {configurationRecoveryIssue,lockRecoveryIssue,...saved}=result,receipt={...saved,...recoveryWarnings(result)};
      this.clients.get(accountId)?.client.close();this.clients.delete(accountId);
      this.refreshRevision++;this.refreshing=null;
      // Restoration is already committed. Never turn a later refresh failure
      // into an invitation to retry the write or a claim that nothing changed.
      try{this.check(runtime,epoch);return {...receipt,state:await this.refresh()};}
      catch(error){return {...receipt,refreshIssue:error.code||'connection_failed'};}
    }finally{this.busy.delete(accountId);}
  }
  async client(accountId,runtime=this.runtime,epoch=this.epoch,observedEndpoint){
    const endpoint=observedEndpoint||await runtime.getConnection(accountId);this.check(runtime,epoch);
    if(!endpoint.ownershipVerified)throw Object.assign(Error('QQ endpoint unverified'),{code:'endpoint_unverified'});
    let entry=this.clients.get(accountId);
    if(entry?.endpointId!==endpoint.endpointId){entry?.client.close();entry={endpointId:endpoint.endpointId,publicId:randomUUID(),client:this.clientFactory({port:endpoint.port,token:endpoint.token,accountId})};this.clients.set(accountId,entry);}
    return entry;
  }
  async currentEndpoint(accountId,entry,runtime,epoch){
    this.check(runtime,epoch);const fresh=await runtime.getConnection(accountId);this.check(runtime,epoch);
    if(!fresh.ownershipVerified||fresh.endpointId!==entry.endpointId){entry.client.close();if(this.clients.get(accountId)===entry)this.clients.delete(accountId);throw Object.assign(Error('QQ endpoint changed'),{code:'changed'});}
  }
  statusIssueBinding(runtime,epoch,accountId){
    const run=runtime.runs?.get(accountId),proof=run?.proof;
    // Private lifetime correlation only, never an authority check or a public
    // PID/path projection. A replacement run cannot inherit an earlier issue.
    return proof?{runtime,epoch,run,proof:JSON.stringify([proof.pid,proof.createdAt,proof.executable,proof.parentPid])}:null;
  }
  sameStatusIssueBinding(a,b){return !!a&&!!b&&a.runtime===b.runtime&&a.epoch===b.epoch&&a.run===b.run&&a.proof===b.proof;}
  async refresh(){
    if(this.closed)return this.state;
    if(this.selectionIssue||!this.runtime){this.state=this.installationFailure();return this.state;}
    if(this.refreshing)return this.refreshing;
    const runtime=this.runtime,epoch=this.epoch,revision=this.refreshRevision;
    const operation=(async()=>{
      const next=await runtime.discover();this.check(runtime,epoch);
      const bindings=new Map(next.instances.map(row=>[row.accountId,this.statusIssueBinding(runtime,epoch,row.accountId)]));
      let profiles,profilesUnavailable=false;
      try{profiles=await this.profiles(runtime).list();}catch(error){if(!next.instances.some(row=>row.canSettleOrphanInspection===true))throw error;profiles=[];profilesUnavailable=true;}
      this.check(runtime,epoch);
      const ids=next.instances.filter(row=>row.processRunning&&!row.canSettleOrphanInspection&&!profilesUnavailable).map(row=>row.accountId);
      const endpoints=async()=>{try{return ids.length?await runtime.getConnections(ids):new Map();}catch(error){return new Map(ids.map(id=>[id,{error:{code:error.code||'process_check_failed'}}]));}};
      const before=await endpoints();this.check(runtime,epoch);const entries=new Map(),failures=new Map();
      const note=(accountId,code,phase,stage)=>{const at=new Date().toISOString(),value=projectStatusIssue({code,phase:stage?phase+':'+stage:phase,at})||projectStatusIssue({code,phase,at});if(value)failures.set(accountId,value);};
      next.instances=await Promise.all(next.instances.map(async row=>{
        const profile=profiles.find(item=>item.accountId===row.accountId);
        row={...row,bridges:profile?.servers||[],...(profile?.issue?{configurationIssue:profile.issue}:{})};
        if(profilesUnavailable)row.configurationIssue='configuration_unavailable';
        if(row.canSettleOrphanInspection===true)return {...row,login:{state:'unknown',online:null}};
        if(profilesUnavailable)return {...row,canStart:false,canStop:false,canRecover:false,login:{state:'unknown',online:null,issue:'configuration_unavailable'}};
        if(!row.processRunning)return {...row,login:{state:'stopped',online:false}};
        row.endpointRecoveryIssue=before.get(row.accountId)?.connection?.endpointRecoveryIssue||before.get(row.accountId)?.endpointRecoveryIssue||row.endpointRecoveryIssue||null;
        let phase='endpoint-before';
        try {const observed=before.get(row.accountId);if(!observed?.connection)throw Object.assign(Error('QQ endpoint unavailable'),{code:observed?.error?.code||'endpoint_unverified'});const entry=await this.client(row.accountId,runtime,epoch,observed.connection);entries.set(row.accountId,entry);phase='webui-status';const login=await entry.client.status();return {...row,login,runtimeRevision:entry.publicId};}
        catch(error){const code=typeof error.code==='string'?error.code:'connection_failed';note(row.accountId,code,phase,phase==='endpoint-before'?before.get(row.accountId)?.error?.stage:null);return {...row,login:{state:'unknown',online:false,issue:code}};}
      }));
      const after=await endpoints();this.check(runtime,epoch);
      next.instances=next.instances.map(row=>{
        const entry=entries.get(row.accountId);if(!entry)return row;
        const fresh=after.get(row.accountId)?.connection;
        if(!fresh?.ownershipVerified||fresh.endpointId!==entry.endpointId){
          entry.client.close();if(this.clients.get(row.accountId)===entry)this.clients.delete(row.accountId);
          const {runtimeRevision,...rest}=row;
          // A missing second observation revokes the old identity just like a
          // mismatch, but does not prove that the account or folder changed.
          const issue=fresh?.ownershipVerified?'changed':after.get(row.accountId)?.error?.code==='webui_config_not_local'?'webui_config_not_local':'endpoint_recheck_unavailable';
          note(row.accountId,issue,'endpoint-after',after.get(row.accountId)?.error?.stage);
          return {...rest,login:{state:'unknown',online:false,issue}};
        }
        return row;
      });
      this.check(runtime,epoch);if(revision!==this.refreshRevision)throw Object.assign(Error('QQ state changed'),{code:'changed'});next.installation=this.installationSelection();next.canInspectNodeRepair=this.canInspectNodeRepair();
      const remembered=new Map();next.instances=next.instances.map(row=>{
        const binding=bindings.get(row.accountId),current=this.statusIssueBinding(runtime,epoch,row.accountId);
        if(!this.sameStatusIssueBinding(binding,current))return row;
        const old=this.statusIssues.get(row.accountId),value=failures.get(row.accountId)||(this.sameStatusIssueBinding(old?.binding,binding)?old.value:null);
        if(!value)return row;remembered.set(row.accountId,{binding,value});return {...row,lastStatusIssue:{...value}};
      });this.statusIssues=remembered;this.state=next;this.onChange();return next;
    })();this.refreshing=operation;
    try{return await operation;}finally{if(this.refreshing===operation)this.refreshing=null;}
  }
  async configure(accountId,options){
    const runtime=this.runtime,epoch=this.epoch;this.check(runtime,epoch);
    if(this.busy.size)throw Object.assign(Error('QQ operation in progress'),{code:'operation_in_progress'});
    this.abortDirectory(accountId);this.busy.add(accountId);
    try{
      const result=await this.profiles(runtime).configure(accountId,options),warnings=recoveryWarnings(result);
      this.refreshRevision++;this.refreshing=null;
      // The configuration is already committed. A later read failure must not
      // encourage an accidental repeat of the write or claim it never happened.
      try{this.check(runtime,epoch);return {configured:true,created:result.created,backupCreated:result.backupCreated,...warnings,state:await this.refresh()};}
      catch(error){return {configured:true,created:result.created,backupCreated:result.backupCreated,...warnings,refreshIssue:error.code||'connection_failed'};}
    }finally{this.busy.delete(accountId);}
  }
  link(accountId,{serverName,ownerId},service){
    const runtime=this.runtime,epoch=this.epoch;this.check(runtime,epoch);
    if(this.busy.size)throw Object.assign(Error('QQ operation in progress'),{code:'operation_in_progress'});
    if(!service||service.status!=='disconnected')throw Object.assign(Error('Disconnect the companion first'),{code:'account_connected'});
    const owner=validateQQOwner(ownerId);if(owner===accountId)throw Object.assign(Error('The owner and AI need separate QQ accounts'),{code:'owner_is_agent_account'});
    try{service.assertCredentialsAvailable();}catch{throw Object.assign(Error('The encrypted vault is locked'),{code:'credentials_locked'});}
    const connection=this.profiles(runtime).connection(accountId,serverName);
    service.configure({channel:'qq',qqAccountId:accountId,qqOwnerId:owner,qqUrl:connection.url,qqToken:connection.token});
    this.onChange();return {linked:true};
  }
  async perform(kind,{accountId,refresh=false}={},beforeStop,startOptions){
    if(!['start','stop','recover','qr','quick','logs'].includes(kind))throw Object.assign(Error('Unknown QQ action'),{code:'invalid_config'});
    if(startOptions!==undefined&&(kind!=='start'||!startOptions||typeof startOptions!=='object'||Array.isArray(startOptions)||Object.keys(startOptions).some(key=>!['signal','assertCurrent'].includes(key))||(startOptions.assertCurrent!==undefined&&typeof startOptions.assertCurrent!=='function')||(startOptions.signal!==undefined&&!(startOptions.signal instanceof AbortSignal))))throw Object.assign(Error('Invalid start guard'),{code:'invalid_config'});
    const runtime=this.runtime,epoch=this.epoch;this.check(runtime,epoch);runtime.instance(accountId);
    if(this.busy.has(accountId)||this.busy.has('qq-components')||this.busy.has('qq-plugin-deployment')||this.busy.has(ORPHAN_MARKER)||this.busy.has(INSTALLATION_MARKER)||this.busy.has('qq-setup'))throw Object.assign(Error('QQ operation in progress'),{code:'operation_in_progress'});
    if(['start','stop','recover','quick'].includes(kind)||(kind==='qr'&&refresh))this.abortDirectory(accountId);
    this.busy.add(accountId);
    try{
      if(kind==='logs')return runtime.logs(accountId);
      if(['start','stop','recover'].includes(kind)){
        if(kind==='stop'&&beforeStop){await runtime.assertWritable(accountId);this.check(runtime,epoch);await beforeStop();this.check(runtime,epoch);}
        const result=kind==='start'?await runtime.start(accountId,startOptions):await runtime[kind](accountId);this.check(runtime,epoch);
        this.clients.get(accountId)?.client.close();this.clients.delete(accountId);
        this.refreshRevision++;this.refreshing=null;
        return {state:await this.refresh(),...(result?.recovery?{recovery:result.recovery}:{}),...(kind==='start'?recoveryWarnings(result):{})};
      }
      if(kind==='quick'||refresh)await runtime.assertWritable(accountId);
      const entry=await this.client(accountId,runtime,epoch);
      if(kind==='quick'){const result=await entry.client.quickLogin();await this.currentEndpoint(accountId,entry,runtime,epoch);return result;}
      const result=await entry.client.qr({refresh});this.check(runtime,epoch);
      // Neither the URL nor its locally encoded image is exposed before the
      // final endpoint check. It spans both HTTP and the awaited encoder.
      const image=result.url?await this.qrEncoder(result.url):null;await this.currentEndpoint(accountId,entry,runtime,epoch);
      return {image,phase:result.state,accountId,runtimeRevision:entry.publicId};
    }finally{this.busy.delete(accountId);}
  }
  async close(){
    this.abortDirectory();this.closed=true;this.epoch++;this.statusIssues.clear();this.retireOrphanPreviews();for(const entry of this.clients.values())entry.client.close();this.clients.clear();await this.orphanOperation?.catch(()=>{});await this.installationOperation?.catch(()=>{});
    // Only this manager's own children are considered. External QQ stays alive.
    return this.runtime?this.runtime.close():{closed:true,failures:[]};
  }
}
module.exports={QQConsole,validateDirectoryRequest,validateOrphanRequest,orphanErrorCode,orphanCleanupReceipt};
