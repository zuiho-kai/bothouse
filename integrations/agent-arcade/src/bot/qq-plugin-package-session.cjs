'use strict';
const {QQPluginDeployment,IDS,fail,safeCode,plain,exact,digest,version}=require('./qq-plugin-deployment.cjs');
const {QQBuiltinOfflineReplies}=require('./qq-builtin-offline-replies.cjs');
const {uuid,profileId,text,scopeProjection}=require('./qq-plugin-admin.cjs');
const {performance}=require('node:perf_hooks');
const EXTRA_CODES=new Set(['catalog_expired','catalog_invalid','unsupported_plugin','release_invalid','release_changed','package_mismatch','publication_unconfirmed','digest_required','digest_mismatch','size_mismatch','transport_rejected','network_failed','timeout','archive_invalid','archive_unsafe','archive_limit','prepare_busy','prepare_failed','artifact_changed','list_limit','unsafe_directory','builtin_not_supported','plugin_not_disabled','config_invalid','config_changed','no_changes','backup_failed','write_unknown','configuration_marker_retained']);
const errorCode=error=>EXTRA_CODES.has(error?.code)?error.code:safeCode(error);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const correlation=value=>({accountId:value.accountId,panelId:value.panelId});
function pluginPackageRequest(value,action='read') {
  if(!['read','catalog','prepareLocal','prepareCatalog','preview','confirm','dismiss','close','builtinRead','builtinPreview','builtinConfirm','builtinDismiss'].includes(action))fail('invalid_request');
  const fields=['accountId','panelId',...(action==='prepareCatalog'?['catalogId','pluginId']:['confirm','builtinConfirm'].includes(action)?['ticketId']:action==='builtinPreview'?['observationId']:action==='preview'?['observationId','operation','pluginId',...(value?.operation==='install'?['preparedId',...(Object.hasOwn(value,'initialDisabled')?['initialDisabled']:[])]:value?.operation==='restore'?['backupId']:[])]:[])];
  exact(value,fields);if(!profileId(value.accountId)||!uuid(value.panelId))fail('invalid_request');
  if(action==='prepareCatalog'&&(!hex(value.catalogId)||!IDS.includes(value.pluginId)))fail('invalid_request');
  if(['confirm','builtinConfirm'].includes(action)&&!uuid(value.ticketId)||action==='builtinPreview'&&!uuid(value.observationId))fail('invalid_request');
  if(action==='preview'&&(!uuid(value.observationId)||!IDS.includes(value.pluginId)||!['install','remove','restore'].includes(value.operation)||value.operation==='install'&&!uuid(value.preparedId)||value.operation==='restore'&&!uuid(value.backupId)))fail('invalid_request');
  if(action==='preview'&&Object.hasOwn(value,'initialDisabled')&&value.initialDisabled!==true)fail('invalid_request');
  return value;
}
const KEYS=['profileId','panelId','profile','generation','characterId','runtime','installation','runtimeEpoch','qqAccountId','channel','status','componentVersion','workScope','workScopeKind','workDir','configDir'];
function captured(value,input) {
  if(!plain(value)||value.profileId!==input.accountId||value.panelId!==input.panelId||!value.profile||!value.runtime||!value.installation||value.channel!=='qq'||value.componentVersion!=='4.18.42'||typeof value.qqAccountId!=='string'||!/^[1-9]\d{4,14}$/.test(value.qqAccountId)||!Number.isSafeInteger(Number(value.qqAccountId))||!Number.isSafeInteger(value.generation)||value.generation<0||!hex(value.workScope)||!Number.isSafeInteger(value.runtimeEpoch)||!['connected','disconnected','connecting','disconnecting'].includes(value.status))fail('changed');
  const scope=scopeProjection({kind:value.workScopeKind,affectedProfiles:value.affectedProfiles});if(!scope.affectedProfiles.some(row=>row.accountId===input.accountId))fail('changed');return Object.freeze({...Object.fromEntries(KEYS.map(key=>[key,value[key]])),affectedProfiles:Object.freeze(scope.affectedProfiles.map(row=>Object.freeze(row)))});
}
const same=(a,b)=>KEYS.every(key=>a[key]===b[key])&&digest(a.affectedProfiles)===digest(b.affectedProfiles);
const owns=(s,v)=>s?.accountId===v.accountId&&s?.panelId===v.panelId;
const scope=s=>({kind:s.binding.workScopeKind,affectedProfiles:s.binding.affectedProfiles.map(row=>({...row}))});
function preparedProjection(raw) {
  if(!plain(raw)||!uuid(raw.preparedId)||!IDS.includes(raw.id)||!version(raw.version)||!hex(raw.archiveSha256)||!hex(raw.manifestSha256)||typeof raw.containsData!=='boolean'||raw.authorAuthenticated!==false)fail('invalid_response');
  const files=Array.isArray(raw.files)?raw.files.length:raw.files,bytes=Array.isArray(raw.files)?raw.files.reduce((sum,row)=>sum+row.size,0):raw.bytes;
  if(!Number.isSafeInteger(files)||files<2||files>4096||!Number.isSafeInteger(bytes)||bytes<1||bytes>256*1024*1024)fail('invalid_response');
  return {preparedId:raw.preparedId,id:raw.id,version:raw.version,archiveSha256:raw.archiveSha256,manifestSha256:raw.manifestSha256,files,bytes,containsData:raw.containsData,authorAuthenticated:false};
}
function catalogProjection(raw) {
  if(!plain(raw)||!hex(raw.catalogId)||raw.source!=='https://github.com/NapNeko/napcat-plugin-index'||typeof raw.archived!=='boolean'||raw.indexLicense!=='readme-mit-declaration'||raw.authorAuthenticated!==false||!Array.isArray(raw.items)||raw.items.length>256)fail('invalid_response');const seen=new Set();
  const items=raw.items.map(row=>{if(!plain(row)||!text(row.id,100,false)||!/^napcat-plugin-[a-z0-9-]+$/.test(row.id)||seen.has(row.id)||!text(row.name,120,false)||!text(row.version,80,false)||!text(row.description,2048,false)||typeof row.supported!=='boolean'||row.supported&&!IDS.includes(row.id)||!row.supported&&!['loader_unsupported','component_version_unsupported'].includes(row.reason))fail('invalid_response');seen.add(row.id);return {id:row.id,name:row.name,version:row.version,description:row.description,supported:row.supported,...(!row.supported?{reason:row.reason}:{})};});
  return {catalogId:raw.catalogId,source:raw.source,archived:raw.archived,indexLicense:'readme-mit-declaration',authorAuthenticated:false,items};
}
function publicScope(raw,s){const value=scopeProjection(raw);if(digest(value)!==digest(scope(s)))fail('invalid_response');return value;}
function briefProjection(raw){if(raw===null)return null;if(!plain(raw)||!version(raw.version)||!hex(raw.sha256)||!Number.isSafeInteger(raw.files)||raw.files<2||raw.files>4096||!Number.isSafeInteger(raw.bytes)||raw.bytes<1||raw.bytes>256*1024*1024)fail('invalid_response');return {version:raw.version,sha256:raw.sha256,files:raw.files,bytes:raw.bytes};}
function initialDisableOptions(raw){
 // Older controllers expose no pre-install preference action. Missing metadata
 // must never make a new setting available merely from a renderer checkbox.
 if(raw===undefined)return undefined;
 if(!Array.isArray(raw)||raw.length!==IDS.length)fail('invalid_response');
 const seen=new Set(),reasons=['already_installed','preference_present','preferences_unreadable','preferences_invalid'];
 return raw.map(row=>{if(!plain(row)||!IDS.includes(row.pluginId)||seen.has(row.pluginId)||typeof row.available!=='boolean'||(row.available?row.reason!==null:!reasons.includes(row.reason)))fail('invalid_response');seen.add(row.pluginId);return {pluginId:row.pluginId,available:row.available,reason:row.reason};});
}
function preferenceEffect(raw,{initialDisabled=false,pendingRecovery=false,operation,mode}={}){
 const effect=raw===undefined?'preserve':raw;
 if(!['preserve','set_initial_disabled','restore_initial_preference'].includes(effect))fail('invalid_response');
 if(initialDisabled!==(effect==='set_initial_disabled'))fail('invalid_response');
 if(effect==='set_initial_disabled'&&(operation!=='install'||mode!=='install'||pendingRecovery))fail('invalid_response');
 if(effect==='restore_initial_preference'&&(operation!=='restore'||mode!=='restore'||!pendingRecovery))fail('invalid_response');
 return effect;
}
function profileProjection(raw,s){
 if(!plain(raw)||raw.kind!=='plugin-files'||!uuid(raw.observationId)||!text(raw.fetchedAt,40,false)||!Number.isFinite(Date.parse(raw.fetchedAt))||raw.requiresStopped!==true||raw.pluginCodeAuthenticated!==false||!Array.isArray(raw.plugins)||raw.plugins.length>4||!Array.isArray(raw.backups)||raw.backups.length>64)fail('invalid_response');
 const seen=new Set(),plugins=raw.plugins.map(row=>{if(!IDS.includes(row.id)||seen.has(row.id)||typeof row.dataPresent!=='boolean')fail('invalid_response');seen.add(row.id);return {id:row.id,...briefProjection(row),dataPresent:row.dataPresent};});
 const backups=raw.backups.map(row=>{if(!plain(row)||!uuid(row.backupId)||!IDS.includes(row.pluginId)||row.version!==null&&!version(row.version)||!['install','remove','restore'].includes(row.operation)||!text(row.createdAt,40,false)||!Number.isFinite(Date.parse(row.createdAt))||!['present','absent'].includes(row.restores)||typeof row.pending!=='boolean')fail('invalid_response');return {backupId:row.backupId,pluginId:row.pluginId,version:row.version,operation:row.operation,createdAt:row.createdAt,restores:row.restores,pending:row.pending};});
 if(!plain(raw.recovery)||typeof raw.recovery.required!=='boolean'||raw.recovery.required&&(!uuid(raw.recovery.backupId)||!IDS.includes(raw.recovery.pluginId))||!raw.recovery.required&&(raw.recovery.backupId!==null||raw.recovery.pluginId!==null))fail('invalid_response');
 const options=initialDisableOptions(raw.initialDisableOptions);
 if(options?.some(row=>row.available&&plugins.some(plugin=>plugin.id===row.pluginId)))fail('invalid_response');
 return {kind:'plugin-files',observationId:raw.observationId,fetchedAt:raw.fetchedAt,scope:publicScope(raw.scope,s),plugins,backups,recovery:{required:raw.recovery.required,backupId:raw.recovery.backupId,pluginId:raw.recovery.pluginId},requiresStopped:true,pluginCodeAuthenticated:false,...(options?{initialDisableOptions:options}:{})};
}
function previewProjection(raw,s,input){
 if(!plain(raw))fail('invalid_response');
 if(Object.hasOwn(raw,'initialDisabled')!==Object.hasOwn(raw,'enablePreferenceEffect')||Object.hasOwn(raw,'initialDisabled')&&typeof raw.initialDisabled!=='boolean')fail('invalid_response');
 const initialDisabled=raw.initialDisabled??false;
 if(typeof initialDisabled!=='boolean'||initialDisabled!==(input.initialDisabled===true))fail('invalid_response');
 const effect=preferenceEffect(raw.enablePreferenceEffect,{initialDisabled,pendingRecovery:raw.pendingRecovery,operation:raw.operation,mode:raw.mode});
 const flags={preservesConfiguration:true,preservesOldTree:true,preservesData:true,existingEnableStatePreserved:effect==='preserve',laterStartMayLoad:effect!=='set_initial_disabled',automaticStart:false,executesPlugin:false};
 if(!plain(raw)||raw.kind!=='plugin-package-preview'||!uuid(raw.ticketId)||!Number.isSafeInteger(raw.expiresAt)||raw.expiresAt<1||raw.operation!==input.operation||raw.pluginId!==input.pluginId||raw.preparedId!==(input.preparedId||null)||raw.backupId!==(input.backupId||null)||!['install','update','remove','restore'].includes(raw.mode)||input.operation!=='install'&&raw.mode!==input.operation||input.operation==='install'&&!['install','update'].includes(raw.mode)||typeof raw.pendingRecovery!=='boolean'||Object.entries(flags).some(([k,v])=>raw[k]!==v))fail('invalid_response');
 if(initialDisabled&&raw.before!==null)fail('invalid_response');
 return {kind:'plugin-package-preview',ticketId:raw.ticketId,expiresAt:raw.expiresAt,operation:raw.operation,mode:raw.mode,pluginId:raw.pluginId,preparedId:raw.preparedId,backupId:raw.backupId,before:briefProjection(raw.before),after:briefProjection(raw.after),scope:publicScope(raw.scope,s),...flags,pendingRecovery:raw.pendingRecovery,initialDisabled,enablePreferenceEffect:effect};
}
function changeProjection(raw,ticket){
 const initialDisabled=ticket.initialDisabled??false,effect=ticket.enablePreferenceEffect??'preserve';
 if(!plain(raw))fail('invalid_response');
 const metadata=['initialDisabled','enablePreferenceEffect','enablePreferenceChanged','initialDisableVerified'];
 if(metadata.some(key=>Object.hasOwn(raw,key))&&(!metadata.every(key=>Object.hasOwn(raw,key))||typeof raw.initialDisabled!=='boolean'||typeof raw.initialDisableVerified!=='boolean'||!['preserve','set_initial_disabled','restore_initial_preference'].includes(raw.enablePreferenceEffect)))fail('invalid_response');
 if(!plain(raw)||raw.kind!=='plugin-package-change'||raw.ticketId!==ticket.ticketId||raw.operation!==ticket.operation||raw.mode!==ticket.mode||raw.pluginId!==ticket.pluginId||!['committed','not_committed','unknown'].includes(raw.outcome)||raw.committed!==(raw.outcome==='committed'?true:raw.outcome==='not_committed'?false:null)||raw.backupId!==null&&!uuid(raw.backupId)||['readbackVerified','configurationPreserved','requiresRecovery'].some(k=>typeof raw[k]!=='boolean')||raw.automaticRetry!==false||raw.automaticStart!==false||raw.pluginExecuted!==false||raw.laterStartMayLoad!==(effect!=='set_initial_disabled')||(raw.initialDisabled??false)!==initialDisabled||(raw.enablePreferenceEffect??'preserve')!==effect)fail('invalid_response');
 const changed=Object.hasOwn(raw,'enablePreferenceChanged')?raw.enablePreferenceChanged:(effect==='preserve'?false:null),verified=raw.initialDisableVerified??false;
 if(changed!==null&&typeof changed!=='boolean'||typeof verified!=='boolean'||effect==='preserve'&&(changed!==false||verified)||verified&&(!initialDisabled||raw.outcome!=='committed'||changed!==true||raw.readbackVerified!==true)||initialDisabled&&raw.outcome==='committed'&&(!verified||raw.configurationPreserved))fail('invalid_response');
 if(effect!=='preserve'&&raw.outcome==='not_committed'&&changed!==false)fail('invalid_response');
 if(effect!=='preserve'&&raw.outcome==='committed'&&typeof changed!=='boolean')fail('invalid_response');
 return {kind:'plugin-package-change',ticketId:raw.ticketId,operation:raw.operation,mode:raw.mode,pluginId:raw.pluginId,outcome:raw.outcome,committed:raw.committed,...(raw.code?{code:errorCode(raw)}:{}),backupId:raw.backupId,readbackVerified:raw.readbackVerified,configurationPreserved:raw.configurationPreserved,requiresRecovery:raw.requiresRecovery,automaticRetry:false,automaticStart:false,pluginExecuted:false,laterStartMayLoad:effect!=='set_initial_disabled',initialDisabled,enablePreferenceEffect:effect,enablePreferenceChanged:changed,initialDisableVerified:verified};
}
const BUILTIN_ID='napcat-plugin-builtin';
function replyBefore(raw){
  if(!plain(raw)||typeof raw.present!=='boolean'||(raw.present?typeof raw.value!=='boolean':raw.value!==null)||raw.effective!==(raw.present?raw.value:true))fail('invalid_response');
  return {present:raw.present,value:raw.value,effective:raw.effective};
}
function replyBase(raw,s,kind){
  if(!plain(raw)||raw.kind!==kind||raw.pluginId!==BUILTIN_ID||raw.version!=='1.0.0'||raw.pluginStarted!==false)fail('invalid_response');
  return {kind,pluginId:BUILTIN_ID,version:'1.0.0',scope:publicScope(raw.scope,s),pluginStarted:false};
}
function replySettingsProjection(raw,s){
  const base=replyBase(raw,s,'builtin-offline-replies'),before=replyBefore(raw.before);
  if(!uuid(raw.observationId)||!text(raw.fetchedAt,40,false)||!Number.isFinite(Date.parse(raw.fetchedAt))||raw.enabled!==false||raw.requiresStopped!==true||raw.unchanged!==(before.present&&before.value===false))fail('invalid_response');
  return {...base,observationId:raw.observationId,fetchedAt:raw.fetchedAt,enabled:false,before,unchanged:raw.unchanged,requiresStopped:true};
}
function replyPreviewProjection(raw,s,input){
  const base=replyBase(raw,s,'builtin-offline-replies-preview'),before=replyBefore(raw.before);
  if(!uuid(raw.ticketId)||raw.observationId!==input.observationId||!Number.isSafeInteger(raw.expiresAt)||raw.expiresAt<1||raw.enabled!==false||raw.requiresStopped!==true||raw.automaticRetry!==false||!plain(raw.after)||raw.after.present!==true||raw.after.value!==false||raw.after.effective!==false||!plain(raw.backup)||raw.backup.willPreserve!==true||typeof raw.backup.originalPresent!=='boolean')fail('invalid_response');
  return {...base,ticketId:raw.ticketId,observationId:raw.observationId,expiresAt:raw.expiresAt,enabled:false,before,after:{present:true,value:false,effective:false},requiresStopped:true,backup:{willPreserve:true,originalPresent:raw.backup.originalPresent},automaticRetry:false};
}
function replyChangeProjection(raw,s,ticket){
  const base=replyBase(raw,s,'builtin-offline-replies-change');
  if(raw.ticketId!==ticket.ticketId||!['committed','not_committed','unknown'].includes(raw.outcome)||raw.committed!==(raw.outcome==='committed'?true:raw.outcome==='not_committed'?false:null)||raw.backupId!==null&&!uuid(raw.backupId)||['readbackVerified','originalPreserved','otherFieldsPreserved','replyDisabledVerified'].some(k=>typeof raw[k]!=='boolean')||raw.automaticRetry!==false||raw.replyDisabledVerified&&(raw.outcome!=='committed'||!raw.readbackVerified)||raw.outcome==='committed'&&(!raw.readbackVerified||!raw.originalPreserved||!raw.otherFieldsPreserved||!raw.replyDisabledVerified))fail('invalid_response');
  if(raw.outcome==='committed'&&!uuid(raw.backupId)||raw.outcome!=='committed'&&(raw.readbackVerified||raw.otherFieldsPreserved||raw.replyDisabledVerified)||Object.hasOwn(raw,'configurationRecoveryIssue')&&raw.configurationRecoveryIssue!=='configuration_marker_retained'||Object.hasOwn(raw,'code')&&typeof raw.code!=='string')fail('invalid_response');
  return {...base,ticketId:raw.ticketId,outcome:raw.outcome,committed:raw.committed,readbackVerified:raw.readbackVerified,backupId:raw.backupId,originalPreserved:raw.originalPreserved,otherFieldsPreserved:raw.otherFieldsPreserved,replyDisabledVerified:raw.replyDisabledVerified,automaticRetry:false,...(Object.hasOwn(raw,'code')?{code:errorCode(raw)}:{}),...(Object.hasOwn(raw,'configurationRecoveryIssue')?{configurationRecoveryIssue:errorCode({code:raw.configurationRecoveryIssue})}:{})};
}
class QQPluginPackageSession {
  constructor({capture,withDeploymentLock,picker,artifacts,catalog,now=Date.now,monotonic=()=>performance.now(),deploymentFactory=options=>new QQPluginDeployment(options),replyFactory=options=>new QQBuiltinOfflineReplies(options)}={}) {
    if([capture,withDeploymentLock,picker,now,monotonic,deploymentFactory,replyFactory].some(fn=>typeof fn!=='function')||!artifacts||!catalog)fail('invalid_request');
    Object.assign(this,{capture,withDeploymentLock,picker,artifacts,catalogClient:catalog,now,monotonic,deploymentFactory,replyFactory});this.session=null;this.retiring=Promise.resolve();this.retiringSession=null;this.closed=false;
  }
  get accountId(){return this.session?.accountId||null;}
  _capture(input){if(this.closed)fail('closed');const value=this.capture(correlation(input));if(value?.then){value.catch?.(()=>{});fail('invalid_request');}return captured(value,input);}
  _assert(s){if(this.closed||this.session!==s||s.abort.signal.aborted||!same(s.binding,this._capture(s)))fail('changed');}
  _get(input){const s=this.session;if(!owns(s,input))fail('changed');if(s.pending)fail('operation_in_progress');this._assert(s);return s;}
  _envelope(s){return {...correlation(s),qqAccountId:s.binding.qqAccountId};}
  _clearReplies(s,retire=false){s.replyPreview=null;if(retire){s.replyController?.close();s.replyController=null;}else s.replyController?.discardPreview();}
  _discard(s,retireReply=false){s.preview=null;s.controller?.discardPreview();this._clearReplies(s,retireReply);}
  _reply(s){
    if(!s.controller)fail('changed');
    if(!s.replyController)s.replyController=this.replyFactory({workDir:s.binding.workDir,configDir:s.binding.configDir,scope:scope(s),assertCurrent:()=>this._assert(s),withDeploymentLock:(options,fn)=>this.withDeploymentLock(s.binding,options,fn),now:this.now,monotonic:this.monotonic});
    return s.replyController;
  }
  async _run(s,fn){if(s.pending)fail('operation_in_progress');const op=Promise.resolve().then(fn);s.pending=op;try{return await op;}finally{if(s.pending===op)s.pending=null;}}
  async read(input){pluginPackageRequest(input);const binding=this._capture(input);if(this.session?.pending)fail('operation_in_progress');let s=this.session,retiring=Promise.resolve();if(!owns(s,input)||!same(s.binding,binding)){retiring=this._retire();s={...correlation(input),binding,abort:new AbortController(),controller:null,replyController:null,replyPreview:null,pending:null,timer:null};this.session=s;}
    return this._run(s,async()=>{try{await retiring;this._assert(s);if(!s.controller){s.controller=this.deploymentFactory({workDir:binding.workDir,configDir:binding.configDir,artifacts:this.artifacts,scope:scope(s),assertCurrent:()=>this._assert(s),withDeploymentLock:(options,fn)=>this.withDeploymentLock(binding,options,fn),now:this.now,monotonic:this.monotonic});s.timer=setInterval(()=>this.observe(),250);s.timer.unref?.();}
      this._discard(s,true);const profile=profileProjection(s.controller.read({signal:s.abort.signal}),s),listed=this.artifacts.list();this._assert(s);if(!plain(listed)||!Array.isArray(listed.items)||listed.items.length>64||!Array.isArray(listed.issues)||listed.issues.length>32)fail('invalid_response');return {...this._envelope(s),profile:{...profile,prepared:listed.items.map(preparedProjection),preparationIssues:[...new Set(listed.issues.map(code=>errorCode({code})))]}};
    }catch(error){if(this.session===s)void this._retire();throw error;}});
  }
  catalog(input){pluginPackageRequest(input,'catalog');const s=this._get(input);this._discard(s,true);return this._run(s,async()=>{this._assert(s);const value=await this.catalogClient.list({signal:s.abort.signal});this._assert(s);return {...this._envelope(s),catalog:catalogProjection(value)};});}
  prepareLocal(input){pluginPackageRequest(input,'prepareLocal');const s=this._get(input);this._discard(s,true);return this._run(s,async()=>{this._assert(s);const file=await this.picker({capture:s.binding,signal:s.abort.signal,assertCurrent:()=>this._assert(s)});this._assert(s);if(file===null)return {...this._envelope(s),cancelled:true};if(typeof file!=='string')fail('invalid_response');const result=await this.artifacts.prepareLocal(file,{signal:s.abort.signal});this._assert(s);return {...this._envelope(s),prepared:preparedProjection(result)};});}
  prepareCatalog(input){pluginPackageRequest(input,'prepareCatalog');const s=this._get(input);this._discard(s,true);return this._run(s,async()=>{this._assert(s);const result=await this.artifacts.prepareCatalog({catalogId:input.catalogId,id:input.pluginId},{signal:s.abort.signal});this._assert(s);if(result.id!==input.pluginId)fail('invalid_response');return {...this._envelope(s),prepared:preparedProjection(result)};});}
  preview(input){pluginPackageRequest(input,'preview');const s=this._get(input);this._discard(s,true);return this._run(s,async()=>{this._assert(s);const {accountId,panelId,...value}=input,result=await s.controller.preview(value,{signal:s.abort.signal});this._assert(s);const preview=previewProjection(result,s,input);s.preview=preview;return {...this._envelope(s),preview};});}
  confirm(input){pluginPackageRequest(input,'confirm');const s=this._get(input),ticket=s.preview;if(ticket?.ticketId!==input.ticketId)fail('stale_ticket');s.preview=null;this._clearReplies(s,true);return this._run(s,async()=>{this._assert(s);const result=await s.controller.confirm({ticketId:input.ticketId},{signal:s.abort.signal});return {...this._envelope(s),change:changeProjection(result,ticket)};});}
  builtinRead(input){pluginPackageRequest(input,'builtinRead');const s=this._get(input);this._discard(s,true);return this._run(s,async()=>{this._assert(s);const raw=await this._reply(s).read({signal:s.abort.signal});this._assert(s);return {...this._envelope(s),replySettings:replySettingsProjection(raw,s)};});}
  builtinPreview(input){pluginPackageRequest(input,'builtinPreview');const s=this._get(input);this._discard(s);return this._run(s,async()=>{this._assert(s);const raw=await this._reply(s).preview({observationId:input.observationId},{signal:s.abort.signal});this._assert(s);const replyPreview=replyPreviewProjection(raw,s,input);s.replyPreview=replyPreview;return {...this._envelope(s),replyPreview};});}
  builtinConfirm(input){pluginPackageRequest(input,'builtinConfirm');const s=this._get(input),ticket=s.replyPreview;if(ticket?.ticketId!==input.ticketId)fail('stale_ticket');s.replyPreview=null;s.preview=null;s.controller.discardPreview();return this._run(s,async()=>{this._assert(s);const raw=await s.replyController.confirm({ticketId:input.ticketId},{signal:s.abort.signal});return {...this._envelope(s),replyChange:replyChangeProjection(raw,s,ticket)};});}
  builtinDismiss(input){pluginPackageRequest(input,'builtinDismiss');if(owns(this.session,input)){const s=this._get(input);this._discard(s,true);}return {...correlation(input),dismissed:true};}
  dismiss(input){pluginPackageRequest(input,'dismiss');if(owns(this.session,input)){const s=this._get(input);this._discard(s,true);}return {...correlation(input),dismissed:true};}
  _retire(){const s=this.session;this.session=null;if(!s)return this.retiring;clearInterval(s.timer);s.abort.abort();s.controller?.close();const replyClosed=s.replyController?.close();this.retiringSession=s;const op=Promise.allSettled([this.retiring,s.pending,replyClosed]).then(()=>({closed:true})).finally(()=>{if(this.retiringSession===s)this.retiringSession=null;});this.retiring=op;return op;}
  closeOwned(input){pluginPackageRequest(input,'close');if(!owns(this.session,input))return (owns(this.retiringSession,input)?this.retiring:Promise.resolve()).then(()=>({...correlation(input),closed:true}));return this._retire().then(()=>({...correlation(input),closed:true}));}
  closeCurrent(){return this._retire();}
  observe(){if(this.session)try{this._assert(this.session);}catch{void this._retire();}}
  close(){this.closed=true;return this._retire();}
}
async function pluginPackageResult(input,fn){try{return {ok:true,...await fn()};}catch(error){return {ok:false,...(profileId(input?.accountId)?{accountId:input.accountId}:{}),...(uuid(input?.panelId)?{panelId:input.panelId}:{}),code:errorCode(error)};}}
module.exports={QQPluginPackageSession,pluginPackageRequest,pluginPackageResult,preparedProjection,catalogProjection,captured,profileProjection,previewProjection,changeProjection};
