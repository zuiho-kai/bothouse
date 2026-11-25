'use strict';
// Main-only lifecycle and projection for the code-repair drawer. Its recovery
// capture deliberately does not depend on constructing a healthy QQ runtime.
const {createHash}=require('node:crypto');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,HEX=/^[a-f0-9]{64}$/;
const MARKER='qq-components',VERSION='4.18.42',VERSION_ID='napcat-node-4.18.42-77397ac38d66f463';
const decisions=['abandon-prepared','complete-prepared','restore-original','acknowledge-complete'];
const actions={
  'node-repair-inspect':['inspect','nodeRepair',[]],
  'node-repair-preview':['preview','nodeRepairPreview',['observationId']],
  'node-repair-confirm':['confirm','nodeRepairResult',['ticketId','expectedDigest']],
  'node-repair-reconcile-preview':['reconcilePreview','nodeRepairPreview',['operationId','decision']],
  'node-repair-reconcile-confirm':['reconcileConfirm','nodeRepairResult',['ticketId','expectedDigest']],
  'node-repair-retire-preview':['retirePreview','nodeRepairRetirePreview',['operationId']],
  'node-repair-retire-confirm':['retireConfirm','nodeRepairRetireResult',['ticketId','expectedDigest']],
  'node-repair-dismiss':['dismiss',null,[]],
};
const codes=new Set(['invalid_request','invalid_response','changed','cancelled','manager_closing','operation_in_progress','preview_required','preview_expired',
  'node_repair_unavailable','node_repair_not_needed','node_repair_scope_unverified','node_repair_source_unavailable','node_repair_changed','node_repair_busy','node_repair_history_full','node_repair_failed','node_repair_readback_failed','node_repair_unconfirmed','node_repair_recovery_required','node_repair_cleanup_unconfirmed','node_repair_retirement_unavailable','node_repair_retirement_unconfirmed',
  'metadata_invalid','digest_required','transport_rejected','network_failed','size_mismatch','digest_mismatch','unsafe_directory','artifact_conflict','staging_failed','staging_busy','package_not_staged','archive_invalid','archive_unsafe','archive_limit','artifact_changed','unsafe_path','prepared_invalid','prepared_changed','process_check_failed','runtime_running','program_running','desktop_running','runtime_locked','component_locked','unsafe_lock','owner_alive','recovery_in_progress','recovery_gate_unsupported','recovery_gate_unavailable','recovery_gate_lost','recovery_gate_close_failed','pending_upstream_update','managed_installation_changed']);
const codeOf=e=>codes.has(e?.code)?e.code:'node_repair_failed';
const error=code=>Object.assign(new Error(`QQ Node repair: ${codes.has(code)?code:'node_repair_failed'}`),{code:codes.has(code)?code:'node_repair_failed'});
const fail=code=>{throw error(code);};
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const clone=v=>JSON.parse(JSON.stringify(v));
const check=(v,predicate)=>{if(!predicate(v))fail('invalid_response');return v;};
const text=v=>check(v,x=>typeof x==='string'&&x.length>0&&x.length<=120&&!/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(x));
const uuid=v=>check(v,x=>typeof x==='string'&&UUID.test(x));
const hex=v=>check(v,x=>typeof x==='string'&&HEX.test(x));
const bool=v=>check(v,x=>typeof x==='boolean');
const tri=v=>check(v,x=>x===null||typeof x==='boolean');
const num=(v,max=8589934592)=>check(v,x=>Number.isSafeInteger(x)&&x>=0&&x<=max);
const exact=(v,w)=>check(v,x=>x===w);
const choice=(v,allowed)=>check(v,x=>allowed.includes(x));
const code=v=>v===null?null:check(v,x=>codes.has(x));
function object(v,fields){if(!plain(v))fail('invalid_response');return Object.fromEntries(Object.entries(fields).map(([k,fn])=>[k,fn(v[k])]));}
function list(v,max,fn){if(!Array.isArray(v)||v.length>max)fail('invalid_response');return v.map(fn);}
function scope(v){return object(v,{
  installations:a=>list(a,32,r=>object(r,{installationId:hex,setupId:uuid,instanceDirectoryCount:n=>num(n,32)})),
  knownRegisteredProfiles:a=>list(a,32,r=>object(r,{profileId:x=>check(x,y=>typeof y==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(y)),label:text})),
  enumeration:x=>exact(x,'component-store'),allWithinStoreVerified:bool,outsideStoreMetadataEnumerated:x=>exact(x,false),
});}
const componentFields={component:x=>exact(x,'napcat-node'),version:x=>exact(x,VERSION),versionId:x=>exact(x,VERSION_ID)};
const ticketFields={operationId:uuid,ticketId:uuid,expectedDigest:hex,expiresAt:x=>num(x,Number.MAX_SAFE_INTEGER)};
function inspection(v){return object(v,{
  observationId:uuid,...componentFields,state:x=>choice(x,['healthy','damaged','missing','unsupported','recovery_required','unverified']),
  source:x=>object(x,{state:y=>choice(y,['verified-cache','not-staged','unverified']),archiveBytes:y=>exact(y,124162399)}),scope,
  stopped:x=>choice(x,['verified','running','unverified']),metadata:x=>object(x,{descriptorVerified:bool,manifestVerified:bool}),canPrepare:bool,reason:code,
  pending:a=>list(a,16,r=>object(r,{operationId:uuid,state:x=>choice(x,['prepared_only','interrupted','blocked']),decisions:x=>list(x,4,y=>choice(y,decisions))})),
  history:a=>list(a,16,r=>object(r,{operationId:uuid,endedAt:x=>num(x,Number.MAX_SAFE_INTEGER),retainedBytes:num,state:x=>choice(x,['completed','restored','abandoned','retiring','blocked']),canRetire:bool,canResumeRetirement:bool,reason:code})),
  retention:x=>object(x,{records:y=>num(y,16),bytes:num,maxRecords:y=>exact(y,16),maxBytes:y=>exact(y,8589934592)}),
  limits:x=>object(x,{maxInstallations:y=>exact(y,32),maxInstancesPerInstallation:y=>exact(y,32),maxProcesses:y=>exact(y,4096),maxEntries:y=>exact(y,10000),maxDepth:y=>exact(y,16),maxFileBytes:y=>exact(y,134217728),maxTreeBytes:y=>exact(y,536870912),maxManifestBytes:y=>exact(y,2097152),maxHistoryRecords:y=>exact(y,16),maxHistoryBytes:y=>exact(y,8589934592),previewTTL:y=>exact(y,300000)}),
});}
function preview(v){
  if(v?.operation==='node-code-reconcile')return object(v,{...ticketFields,operation:x=>exact(x,'node-code-reconcile'),decision:x=>choice(x,decisions),...componentFields,scope,
    before:x=>object(x,{live:y=>choice(y,['original','absent','prepared']),original:y=>choice(y,['live','retained','absent']),staged:y=>choice(y,['verified','absent'])}),
    effects:x=>object(x,{publishesPreparedCode:y=>exact(y,v.decision==='complete-prepared'),restoresOriginalCode:y=>exact(y,v.decision==='restore-original'),removesOwnedDisposableStage:y=>exact(y,false),settlesExistingPublication:y=>exact(y,v.decision==='acknowledge-complete'),changesDescriptors:y=>exact(y,false),changesPreparedManifest:y=>exact(y,false),writesAccountData:y=>exact(y,false),changesWorkPaths:y=>exact(y,false),automaticStart:y=>exact(y,false),automaticStop:y=>exact(y,false),versionChange:y=>exact(y,false)})});
  return object(v,{...ticketFields,operation:x=>exact(x,'node-code-repair'),...componentFields,scope,damage:x=>choice(x,['code_integrity_mismatch','code_missing']),
    source:x=>object(x,{verification:y=>exact(y,'full-pinned-archive-and-manifest'),archiveBytes:y=>exact(y,124162399),fileCount:y=>num(y,10000),totalBytes:y=>num(y,536870912)}),previousTree:x=>choice(x,['present','absent']),
    effects:x=>object(x,{replacesCode:y=>exact(y,true),retainsOriginalTreeIfPresent:y=>exact(y,true),changesDescriptors:y=>exact(y,false),changesPreparedManifest:y=>exact(y,false),writesAccountData:y=>exact(y,false),changesWorkPaths:y=>exact(y,false),versionChange:y=>exact(y,false),automaticStop:y=>exact(y,false),automaticStart:y=>exact(y,false)})});
}
function result(v){return object(v,{operationId:uuid,operation:x=>choice(x,['node-code-repair','node-code-reconcile']),committed:tri,liveCode:x=>choice(x,['same-version-verified','original-restored','unchanged','unverified']),oldTreeRetained:tri,readback:x=>choice(x,['full-manifest','original-proof','unavailable']),recoveryRequired:bool,cleanupVerified:bool,descriptorBytesUnchanged:tri,manifestBytesUnchanged:tri,dataPathsUnchanged:tri,accountDataVerification:x=>exact(x,'not-read'),automaticStart:x=>exact(x,false),automaticStop:x=>exact(x,false),versionChange:x=>exact(x,false),code});}
const noRetireEffects={currentCodeTouched:x=>exact(x,false),originalManifestTouched:x=>exact(x,false),descriptorsTouched:x=>exact(x,false),accountDataTouched:x=>exact(x,false),automaticStart:x=>exact(x,false)};
function retirePreview(v){return object(v,{...ticketFields,operation:x=>exact(x,'node-code-history-retirement'),resume:bool,retainedBytes:num,retainedFileCount:x=>num(x,20000),removesRetainedCode:x=>exact(x,true),reversible:x=>exact(x,false),...noRetireEffects});}
function retireResult(v){return object(v,{operationId:uuid,operation:x=>exact(x,'node-code-history-retirement'),committed:tri,retired:tri,cleanupRequired:bool,cleanupVerified:bool,...noRetireEffects,code});}
const project={nodeRepair:inspection,nodeRepairPreview:preview,nodeRepairResult:result,nodeRepairRetirePreview:retirePreview,nodeRepairRetireResult:retireResult};
function request(v){
  if(!plain(v)||!Object.hasOwn(actions,v.action)||typeof v.panelId!=='string'||!UUID.test(v.panelId))fail('invalid_request');
  const fields=actions[v.action][2],allowed=['action','panelId',...fields];if(Object.keys(v).some(k=>!allowed.includes(k)))fail('invalid_request');
  for(const k of fields)if(k==='decision'?!decisions.includes(v[k]):typeof v[k]!=='string'||!(k==='expectedDigest'?HEX:UUID).test(v[k]))fail('invalid_request');
  return {...v};
}
function unknownResult(key,preview,committed,code){
  const base={operationId:preview.operationId,committed,cleanupVerified:false,code};
  return key==='nodeRepairRetireResult'?{...base,operation:'node-code-history-retirement',retired:null,cleanupRequired:true,currentCodeTouched:false,originalManifestTouched:false,descriptorsTouched:false,accountDataTouched:false,automaticStart:false}:{...base,operation:preview.operation==='node-code-reconcile'?'node-code-reconcile':'node-code-repair',liveCode:'unverified',oldTreeRetained:null,readback:'unavailable',recoveryRequired:true,descriptorBytesUnchanged:null,manifestBytesUnchanged:null,dataPathsUnchanged:null,accountDataVerification:'not-read',automaticStart:false,automaticStop:false,versionChange:false};
}
class QQNodeRepairPanel{
  constructor({console:qqConsole,captureUI=()=>({key:'standalone',profiles:[]}),create=options=>new (require('./qq-managed-node-code-repair.cjs').QQManagedNodeCodeRepair)(options),onChange=()=>{}}={}){
    this.console=qqConsole;this.captureUI=captureUI;this.create=create;this.onChange=onChange;this.session=null;this.active=null;this.closed=false;this.lastResult=null;
  }
  busy(){return !!this.active;}
  snapshot(){return this.lastResult?clone(this.lastResult):null;}
  observe(){const session=this.session;if(!session||session.revoked)return;try{this._current(session);}catch{void this._dismiss(session).catch(()=>{});}}
  _notify(){try{this.onChange();}catch{/* Rendering cannot change filesystem outcomes. */}}
  _capture(panelId){
    const ui=this.captureUI();if(!plain(ui)||typeof ui.key!=='string'||ui.key.length>2048||!Array.isArray(ui.profiles))fail('changed');
    const contextKey=createHash('sha256').update(JSON.stringify([panelId,ui.key,this.console.epoch,this.console.selectionDigest])).digest('hex');
    return this.console.captureNodeRepairSelection({contextKey,knownRegisteredProfiles:ui.profiles});
  }
  _current(session,signal){
    if(this.closed||this.console.closed)fail('manager_closing');if(this.session!==session||session.revoked||signal?.aborted)fail('cancelled');
    if(JSON.stringify(this._capture(session.panelId))!==JSON.stringify(session.capture))fail('changed');
  }
  async _dismiss(session){
    if(!session)return {closed:true};session.revoked=true;if(this.active?.session===session)this.active.controller.abort();
    if(session.closing)return session.closing;
    session.closing=(async()=>{
      await (this.active?.session===session?this.active.promise.catch(()=>{}):undefined);
      const value=await session.helper.close();if(value?.closed!==true)fail('node_repair_cleanup_unconfirmed');
      if(this.session===session)this.session=null;return {closed:true};
    })();
    try{return await session.closing;}finally{session.closing=null;}
  }
  async dismissOwned(panelId){if(this.session?.panelId!==panelId)return {closed:true,matched:false};return {...await this._dismiss(this.session),matched:true};}
  async dismissCurrent(){return this._dismiss(this.session);}
  async execute(value){
    const v=request(value);if(v.action==='node-repair-dismiss'){try{return await this.dismissOwned(v.panelId);}catch(e){throw error(codeOf(e));}}
    if(this.closed||this.console.closed)fail('manager_closing');if(this.active||this.console.busy.size)fail('operation_in_progress');
    if(v.action==='node-repair-inspect'){
      if(this.session&&(this.session.panelId!==v.panelId||this.session.revoked))fail('operation_in_progress');
      if(!this.session){
        const capture=this._capture(v.panelId),session={panelId:v.panelId,capture,revoked:false,helper:null,preview:null};this.session=session;
        try{session.helper=this.create({root:this.console.componentStoreRoot,lockRoot:this.console.lockRoot,captureSelection:()=>{this._current(session);return clone(capture);},processHost:this.console.runtime?.host||require('./qq-node-host.cjs').createWindowsNodeProcessHost()});}
        catch(e){this.session=null;throw error(codeOf(e));}
      }
    }
    const session=this.session;if(!session||session.panelId!==v.panelId||session.revoked)fail('preview_required');this._current(session);
    const [method,key,fields]=actions[v.action],controller=new AbortController(),mutating=method.endsWith('Confirm')||method==='confirm',ownedPreview=session.preview,operation={session,controller,promise:null};
    if(mutating&&(!ownedPreview||ownedPreview.ticketId!==v.ticketId||ownedPreview.expectedDigest!==v.expectedDigest||ownedPreview.operation!==({confirm:'node-code-repair',reconcileConfirm:'node-code-reconcile',retireConfirm:'node-code-history-retirement'}[method])))fail('preview_required');
    if(mutating||key.endsWith('Preview')||method==='inspect')session.preview=null;
    this.active=operation;this.console.busy.add(MARKER);this.console.abortDirectory?.();
    operation.promise=Promise.resolve().then(async()=>{
      this._current(session,controller.signal);
      const input=Object.fromEntries(fields.map(k=>[k,v[k]]));input.signal=controller.signal;input.assertCurrent=()=>this._current(session,controller.signal);
      let raw;
      try{raw=await session.helper[method](input);}catch(e){
        if(mutating&&(e?.committed===true||e?.committed===null)){
          raw=unknownResult(key,ownedPreview,e.committed,codeOf(e));
        }else throw e;
      }
      // Confirm results may already describe a filesystem change. A close or
      // selection change cannot retroactively turn that result into no change.
      if(!mutating)this._current(session,controller.signal);
      let output;try{output=project[key](raw);if(mutating&&output.operationId!==ownedPreview.operationId)fail('invalid_response');}catch(e){if(!mutating)throw e;output=unknownResult(key,ownedPreview,raw?.committed===true?true:null,'invalid_response');}
      if(key.endsWith('Preview'))session.preview=output;
      if(mutating){
        session.preview=null;this.lastResult={[key]:output};
        if(key==='nodeRepairResult'&&output.committed===true&&output.liveCode==='same-version-verified'&&!output.recoveryRequired){
          try{this._current(session,controller.signal);await this.console.refreshAfterNodeRepair?.(session.capture);}catch(e){output.refreshCode=codeOf(e);}
        }
      }
      return {[key]:output};
    }).catch(e=>{throw error(codeOf(e));}).finally(()=>{if(this.active===operation){this.active=null;this.console.busy.delete(MARKER);}this._notify();});
    this._notify();return operation.promise;
  }
  async close(){this.closed=true;return this._dismiss(this.session);}
}
module.exports={QQNodeRepairPanel,validateNodeRepairRequest:request,projectNodeRepair:project,nodeRepairErrorCode:codeOf};
