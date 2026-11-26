'use strict';

// Main-process first-setup coordinator. Paths, descriptors and package objects
// remain here; renderer actions only carry current-page opaque capabilities.
const fs=require('node:fs'),path=require('node:path');
const {QQManagedShellSetup,readManagedShellInstallation,RELEASE_ID,VERSION}=require('./qq-managed-setup.cjs');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,HEX=/^[a-f0-9]{64}$/;
const MARKER='qq-setup';
const ENGINES=Object.freeze({
  'managed-shell':Object.freeze({engine:'managed-shell',component:'napcat-shell',directory:'qq-installations',version:VERSION,versionId:RELEASE_ID,available:true}),
  'managed-node':Object.freeze({engine:'managed-node',component:'napcat-node',directory:'qq-node-installations',version:VERSION,versionId:'napcat-node-4.18.42-77397ac38d66f463',available:true})
});
const CODES=new Set(('invalid_request invalid_response changed cancelled manager_closing operation_in_progress setup_failed setup_busy setup_conflict setup_write_failed setup_readback_failed setup_cleanup_incomplete unsafe_path invalid_program unsupported_architecture program_changed program_unverified program_running process_check_failed stale_ticket expired_ticket prepared_invalid prepared_changed prepared_required list_limit recovery_unavailable recovery_changed recovery_failed recovery_unconfirmed preview_required setup_unavailable metadata_invalid digest_required transport_rejected network_failed size_mismatch digest_mismatch unsafe_directory artifact_conflict staging_failed staging_busy package_not_staged archive_invalid archive_unsafe archive_limit artifact_changed version_exists prepare_busy prepare_failed invalid_installation installation_changed missing_components runtime_locked desktop_running external_process external_qq_unknown previous_unavailable previous_installation_unavailable already_selected installation_selection_invalid installation_selection_changed installation_save_failed selection_invalid invalid_config component_changed').split(' '));
CODES.add('managed_installation_changed');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const id=v=>typeof v==='string'&&UUID.test(v),hex=v=>typeof v==='string'&&HEX.test(v);
const clone=v=>JSON.parse(JSON.stringify(v));
class QQFirstSetupError extends Error{constructor(code){const safe=CODES.has(code)?code:'setup_failed';super(`QQ first setup failed (${safe}).`);this.code=safe;this.name=safe==='cancelled'?'AbortError':'QQFirstSetupError';}}
const fail=code=>{throw new QQFirstSetupError(code);};
const codeOf=e=>CODES.has(e?.code)?e.code:'setup_failed';
function validate(request){
  if(!plain(request)||typeof request.action!=='string')fail('invalid_request');
  const keys={status:[],list:[],'set-engine':[],'choose-program':[],prepare:[],create:['ticketId'],use:['setupId'],'return-previous':[],'recovery-preview':['setupId'],'recovery-confirm':['setupId','expectedDigest'],cancel:[]}[request.action];
  if(!keys||Object.keys(request).some(k=>!['action','engine'].includes(k)&&!keys.includes(k))||(request.engine!==undefined&&!Object.hasOwn(ENGINES,request.engine))||(request.action==='set-engine'&&request.engine===undefined))fail('invalid_request');
  if(request.action==='create'&&(request.engine==='managed-node'?request.ticketId!==undefined:!id(request.ticketId))||keys.includes('setupId')&&!id(request.setupId)||keys.includes('expectedDigest')&&!hex(request.expectedDigest))fail('invalid_request');
  return {...request};
}
function safeRoot(value){
  if(typeof value!=='string'||!path.isAbsolute(value)||value.length>1500||/^[/\\]{2}/.test(value)||/[\0\r\n]/.test(value)||value.slice(2).includes(':'))fail('invalid_request');return path.resolve(value);
}
function directory(file){
  let cursor=file;for(;;){const stat=fs.lstatSync(cursor);if(!stat.isDirectory()||stat.isSymbolicLink())fail('unsafe_path');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
  if(fs.realpathSync(file).toLowerCase()!==path.resolve(file).toLowerCase())fail('unsafe_path');
}
function installation(value){
  const item=v=>{if(!plain(v)||!['legacy',...Object.keys(ENGINES)].includes(v.kind)||(v.kind!=='legacy'&&!id(v.setupId)))fail('invalid_response');return {kind:v.kind,...(v.kind!=='legacy'?{engine:v.kind,setupId:v.setupId}:{})};};
  if(!plain(value)||typeof value.canReturn!=='boolean')fail('invalid_response');
  if(value.current===null&&value.previous===null&&value.canReturn===false&&value.issue==='installation_selection_invalid')return {current:null,previous:null,canReturn:false,issue:value.issue};
  return {current:item(value.current),previous:value.previous===null?null:item(value.previous),canReturn:value.canReturn};
}
function program(value){
  const q=value?.qq,s=q?.signature;
  if(!plain(value)||!id(value.ticketId)||!Number.isFinite(value.expiresAt)||typeof value.canInitialize!=='boolean'||value.compatibility!=='not-tested'||!plain(q)||q.architecture!=='x64'||typeof q.version!=='string'||!/^\d{1,3}(?:[.-]\d{1,8}){2,3}$/.test(q.version)||!Number.isSafeInteger(q.size)||q.size<256||q.size>512*1024*1024||!hex(q.sha256)||!plain(s)||!['Valid','NotSigned','HashMismatch','NotTrusted','UnknownError','NotSupportedFileFormat','Incompatible'].includes(s.status))fail('invalid_response');
  // Do not forward certificate text or source executable paths to renderer.
  return {ticketId:value.ticketId,expiresAt:value.expiresAt,canInitialize:value.canInitialize,compatibility:'not-tested',qq:{version:q.version,architecture:'x64',size:q.size,sha256:q.sha256,signature:{status:s.status}}};
}
class QQFirstSetup{
  constructor({componentStoreRoot,console:qqConsole,capture,programPicker,packages,prepared,setup,readSetup=readManagedShellInstallation,nodePackages,nodePrepared,nodeSetup,readNodeSetup,onChange=()=>{}}={}){
    this.root=safeRoot(componentStoreRoot);
    if(!qqConsole||!(qqConsole.busy instanceof Set)||typeof qqConsole.check!=='function'||typeof capture!=='function'||typeof programPicker!=='function'||typeof readSetup!=='function'||typeof onChange!=='function')fail('invalid_request');
    this.console=qqConsole;this.capture=capture;this.programPicker=programPicker;this.readSetup=readSetup;this.onChange=onChange;
    this.packages=packages||new (require('./qq-component-package.cjs').QQComponentPackages)({root:this.root});
    this.prepared=prepared||new (require('./qq-component-prepared.cjs').QQComponentPrepared)({root:this.root,packages:this.packages});
    this.setup=setup||new QQManagedShellSetup({root:this.root,prepared:this.prepared,processHost:{snapshot:()=>this.console.runtime.host.snapshot()}});
    for(const [object,methods] of [[this.packages,['stage']],[this.prepared,['prepare','listPrepared','resolvePrepared']],[this.setup,['inspect','initialize','inspectRecovery','confirmRecovery','discardTickets']]])if(!object||methods.some(k=>typeof object[k]!=='function'))fail('invalid_request');
    for(const obj of [this.packages,this.prepared,this.setup])if(obj.root!==undefined&&path.resolve(obj.root)!==this.root)fail('invalid_request');
    this.routes=new Map([['managed-shell',{...ENGINES['managed-shell'],packages:this.packages,prepared:this.prepared,setup:this.setup,readSetup}]]);
    this.nodeOptions={packages:nodePackages,prepared:nodePrepared,setup:nodeSetup,readSetup:readNodeSetup};this.routeRevision=0;
    this.closed=false;this.context=null;this.active=null;this.listing=new Map();this.preview=null;
    this.state={busy:false,phase:'idle',engine:'managed-shell',capabilities:Object.values(ENGINES).map(({engine,version,versionId,available})=>({engine,version,versionId,available})),version:VERSION,program:null,preparedVersionId:null,setups:[],installation:null,lastCode:null,lastCommitted:null};
  }
  _route(engine=this.state.engine){
    if(!Object.hasOwn(ENGINES,engine))fail('invalid_request');if(this.routes.has(engine))return this.routes.get(engine);
    const options=this.nodeOptions,packages=options.packages||new (require('./qq-component-package.cjs').QQComponentPackages)({root:this.root,component:'napcat-node'}),prepared=options.prepared||new (require('./qq-component-prepared.cjs').QQComponentPrepared)({root:this.root,packages,component:'napcat-node'});
    const setup=options.setup||new (require('./qq-managed-node-setup.cjs').QQManagedNodeSetup)({root:this.root,prepared,processHost:{snapshot:()=>this.console.runtime.host.snapshot()}}),readSetup=options.readSetup||require('./qq-managed-node-setup.cjs').readManagedNodeInstallation;
    for(const [object,methods] of [[packages,['stage']],[prepared,['prepare','listPrepared','resolvePrepared']],[setup,['initialize','inspectRecovery','confirmRecovery']]])if(!object||methods.some(k=>typeof object[k]!=='function')||(object.root!==undefined&&path.resolve(object.root)!==this.root))fail('invalid_request');
    if(typeof readSetup!=='function')fail('invalid_request');const route={...ENGINES[engine],packages,prepared,setup,readSetup};this.routes.set(engine,route);return route;
  }
  _discard(){for(const route of this.routes.values())route.setup.discardTickets?.();}
  _notify(){try{this.onChange();}catch{/* An observer cannot alter a committed result. */}}
  _clear(){this.listing.clear();this.preview=null;this._discard();Object.assign(this.state,{program:null,preparedVersionId:null,setups:[],lastCode:null,installation:null});}
  _binding(){const binding=this.capture();if(typeof binding!=='string'||!binding||binding.length>2048)fail('changed');return binding;}
  _same(c){try{return !this.closed&&!this.console.closed&&this.routeRevision===c.routeRevision&&this.console.runtime===c.runtime&&this.console.epoch===c.epoch&&this._binding()===c.binding;}catch{return false;}}
  _context(){
    if(this.closed||this.console.closed)fail('manager_closing');const binding=this._binding(),runtime=this.console.runtime,epoch=this.console.epoch;this.console.check(runtime,epoch);
    if(!this.context||!this._same(this.context)){this._clear();this.context={runtime,epoch,binding,routeRevision:this.routeRevision};this.state.lastCommitted=null;}return this.context;
  }
  _assert(op){if(!this._same(op.context))fail(this.closed?'manager_closing':'changed');this.console.check(op.context.runtime,op.context.epoch);if(op.controller.signal.aborted)fail(op.abortCode||'cancelled');}
  snapshot(){if(this.context&&!this._same(this.context)){this._clear();if(this.active&&!this.active.committed){this.active.abortCode='changed';this.active.controller.abort();}}return clone(this.state);}
  _selection(){return typeof this.console.installationSelection==='function'?installation(this.console.installationSelection()):null;}
  async _list(op){
    const rows=[],map=new Map();let issue=null,count=0;
    for(const descriptor of Object.values(ENGINES)){
      const root=path.join(this.root,descriptor.directory);let listing;
      try{
        if(fs.existsSync(root)){directory(root);const route=this._route(descriptor.engine);listing=fs.opendirSync(root);let entry;while((entry=listing.readSync())){
          this._assert(op);if(++count>32){issue='list_limit';break;}if(!id(entry.name)){issue='setup_unavailable';continue;}const setupId=entry.name;let row,proof;
          try{proof=route.readSetup({root:this.root,setupId});if(proof.setupId!==setupId||!hex(proof.descriptorSha256)||proof.current?.versionId!==route.versionId||(proof.engine!==undefined&&proof.engine!==route.engine)||typeof proof.qq?.version!=='string'||!/^\d{1,3}(?:[.-]\d{1,8}){2,3}$/.test(proof.qq.version))fail('invalid_response');row={setupId,engine:route.engine,state:'ready',version:VERSION,qqVersion:proof.qq.version,verification:'metadata-only'};}
          catch{try{const preview=await route.setup.inspectRecovery({setupId,signal:op.controller.signal});this._assert(op);if(preview.setupId!==setupId||!hex(preview.expectedDigest)||preview.temporaryLinksToRemove!==1||preview.descriptorPreserved!==true||preview.automaticStart!==false)fail('invalid_response');row={setupId,engine:route.engine,state:'recoverable',version:VERSION,verification:'not-ready'};}catch{this._assert(op);row={setupId,engine:route.engine,state:'unavailable',version:VERSION,verification:'not-ready'};}}
          // A duplicated opaque ID in two namespaces is ambiguous. Neither
          // record is eligible for a mutation until the conflict is resolved.
          if(map.has(setupId)){map.get(setupId).row.state='unavailable';map.delete(setupId);issue='setup_unavailable';}else{map.set(setupId,{row,descriptorSha256:proof?.descriptorSha256});rows.push(row);}
        }}
      }catch(error){this._assert(op);issue=codeOf(error);}finally{listing?.closeSync();}
      if(count>32)break;
    }
    const route=this._route(),prepared=await route.prepared.listPrepared();this._assert(op);if(!plain(prepared)||!Array.isArray(prepared.items)||prepared.items.length>32||!Array.isArray(prepared.issues))fail('invalid_response');
    const found=prepared.items.find(row=>row?.versionId===route.versionId&&row.version===VERSION&&hex(row.manifestSha256));
    this.listing=map;this.state.setups=rows;this.state.preparedVersionId=found?route.versionId:null;this.state.installation=this._selection();this.state.lastCode=issue||(prepared.issues.length?'prepared_invalid':null);return {state:this.snapshot()};
  }
  _committed(op,value){op.committed=true;this._discard();this.preview=null;this.state.program=null;if(this._same(op.context)||this._bindingSafe(op.context.binding))this.state.lastCommitted=clone(value);return value;}
  _bindingSafe(binding){try{return !this.closed&&this._binding()===binding;}catch{return false;}}
  async _run(op,request){
    const signal=op.controller.signal,assertCurrent=()=>this._assert(op);assertCurrent();const route=this._route();
    if(['status','list','set-engine'].includes(request.action))return this._list(op);
    if(request.action==='choose-program'){
      if(route.engine!=='managed-shell')fail('invalid_request');
      this.state.program=null;this.setup.discardTickets();const file=await this.programPicker({signal});assertCurrent();if(file===null)return {cancelled:true};if(typeof file!=='string')fail('invalid_response');
      const view=await this.setup.inspect({qqExe:file,signal});try{assertCurrent();this.state.program=program(view);return {program:clone(this.state.program)};}catch(error){this.setup.discardTickets();throw error;}
    }
    if(request.action==='prepare'){
      const staged=await route.packages.stage({version:VERSION,signal});assertCurrent();if(staged?.version!==VERSION||!hex(staged.sha256)||`${route.component}-${VERSION}-${staged.sha256.slice(0,16)}`!==route.versionId)fail('invalid_response');this.state.phase='preparing';this._notify();
      let prepared;try{prepared=await route.prepared.prepare({version:VERSION,signal});}catch(error){assertCurrent();if(error?.code!=='version_exists')throw error;prepared=await route.prepared.resolvePrepared(route.versionId,{signal});}
      assertCurrent();if(prepared?.versionId!==route.versionId||prepared.version!==VERSION||!hex(prepared.manifestSha256))fail('invalid_response');this.state.preparedVersionId=route.versionId;return {prepared:{engine:route.engine,version:VERSION,versionId:route.versionId,verified:true,automaticStart:false}};
    }
    if(request.action==='create'){
      if(route.engine==='managed-shell'){const ticket=this.state.program;if(!ticket||ticket.ticketId!==request.ticketId||!ticket.canInitialize)fail('stale_ticket');}if(this.state.preparedVersionId!==route.versionId)fail('prepared_required');this.state.program=null;if(route.engine==='managed-node')this.state.preparedVersionId=null;
      try{const value=await route.setup.initialize({...(route.engine==='managed-shell'?{ticketId:request.ticketId}:{}),versionId:route.versionId,signal,assertCurrent});if(value?.committed!==true)fail('invalid_response');if(!id(value.setupId)||value.automaticStart!==false||value.current?.versionId!==route.versionId)return this._committed(op,{action:'create',engine:route.engine,committed:true,...(id(value.setupId)?{setupId:value.setupId}:{}),automaticStart:false,refreshIssue:'invalid_response'});return this._committed(op,{action:'create',engine:route.engine,committed:true,setupId:value.setupId,version:VERSION,automaticStart:false,compatibility:'not-tested'});}
      catch(error){if(error?.committed===true)return this._committed(op,{action:'create',committed:true,...(id(error.setupId)?{setupId:error.setupId}:{}),automaticStart:false,refreshIssue:codeOf(error)});throw error;}
    }
    if(request.action==='use'||request.action==='return-previous'){
      const opts={signal,assertCurrent,operationMarker:MARKER};let value;
      try{if(request.action==='use'){const row=this.listing.get(request.setupId);if(row?.row.state!=='ready'||!hex(row.descriptorSha256))fail('setup_unavailable');value=await this.console.setManagedSetup({...(row.row.engine==='managed-node'?{engine:'managed-node'}:{}),setupId:request.setupId,descriptorSha256:row.descriptorSha256},opts);}else value=await this.console.setPreviousInstallation(opts);}
      catch(error){if(error?.committed===true)return this._committed(op,{action:request.action,committed:true,automaticStart:false,refreshIssue:codeOf(error)});throw error;}
      if(value?.committed!==true)fail('invalid_response');let chosen,issue=value.refreshIssue?codeOf({code:value.refreshIssue}):null;try{if(value.automaticStart!==false)fail('invalid_response');chosen=installation(value.installation);}catch{issue='invalid_response';}
      return this._committed(op,{action:request.action,committed:true,automaticStart:false,...(chosen?{installation:chosen}:{}),...(issue?{refreshIssue:issue}:{})});
    }
    if(request.action==='recovery-preview'){
      const row=this.listing.get(request.setupId)?.row;if(row?.state!=='recoverable')fail('recovery_unavailable');const recoveryRoute=this._route(row.engine),value=await recoveryRoute.setup.inspectRecovery({setupId:request.setupId,signal});assertCurrent();
      if(value?.setupId!==request.setupId||!hex(value.expectedDigest)||value.temporaryLinksToRemove!==1||value.descriptorPreserved!==true||value.automaticStart!==false)fail('invalid_response');
      this.preview={engine:row.engine,setupId:request.setupId,expectedDigest:value.expectedDigest,context:op.context};return {preview:{kind:'descriptor-publication',engine:row.engine,setupId:request.setupId,expectedDigest:value.expectedDigest,temporaryLinksToRemove:1,descriptorPreserved:true,automaticStart:false}};
    }
    if(request.action==='recovery-confirm'){
      const preview=this.preview;this.preview=null;if(!preview||preview.context!==op.context||preview.setupId!==request.setupId||preview.expectedDigest!==request.expectedDigest)fail('preview_required');
      try{const value=await this._route(preview.engine).setup.confirmRecovery({setupId:request.setupId,expectedDigest:request.expectedDigest,signal,assertCurrent});if(value?.committed!==true)fail('invalid_response');if(value.recovered!==true||value.setupId!==request.setupId||value.automaticStart!==false)return this._committed(op,{action:'recovery-confirm',committed:true,setupId:request.setupId,automaticStart:false,refreshIssue:'invalid_response'});return this._committed(op,{action:'recovery-confirm',committed:true,recovered:true,setupId:request.setupId,automaticStart:false,...(value.recoveryIssue?{recoveryIssue:codeOf({code:value.recoveryIssue})}:{})});}
      catch(error){if(error?.committed===true)return this._committed(op,{action:'recovery-confirm',committed:true,setupId:request.setupId,automaticStart:false,refreshIssue:codeOf(error)});throw error;}
    }
    fail('invalid_request');
  }
  async execute(input){
    const request=validate(input);
    if(request.action!=='set-engine'&&(request.engine!==undefined&&request.engine!==this.state.engine||this.state.engine==='managed-node'&&request.engine===undefined&&!['status','list'].includes(request.action)))fail('changed');
    if(request.action==='cancel')return this.cancel();let context=this._context();if(this.active||this.console.busy.size)fail('operation_in_progress');
    if(request.action==='set-engine'){this._clear();this.routeRevision++;this.state.engine=request.engine;this.state.lastCommitted=null;context=this._context();}
    const op={context,controller:new AbortController(),committed:false,promise:null};this.active=op;this.console.busy.add(MARKER);this.state.busy=true;this.state.phase=request.action;this.state.lastCode=null;
    // Observers may close the panel immediately; publish only once close can
    // await the actual owned operation instead of a missing promise.
    op.watch=setInterval(()=>{if(!op.committed&&!op.controller.signal.aborted&&!this._same(context)){this._clear();op.abortCode=this.closed?'manager_closing':'changed';op.controller.abort();this.state.phase='cancelling';this._notify();}},100);
    op.promise=Promise.resolve().then(()=>this._run(op,request));this._notify();
    let result,failure;
    try{result=await op.promise;}catch(error){failure=new QQFirstSetupError(op.controller.signal.aborted?op.abortCode||'cancelled':codeOf(error));if(error?.recoveryAttempted===true)failure.recoveryAttempted=true;this.state.lastCode=failure.code;}
    finally{clearInterval(op.watch);if(this.active===op)this.active=null;this.console.busy.delete(MARKER);this.state.busy=false;this.state.phase='idle';this._notify();}
    if(failure)throw failure;if(result?.state)result.state=this.snapshot();return result;
  }
  async cancel(){this.preview=null;this.state.program=null;this._discard();const op=this.active;if(op&&!op.committed){op.abortCode=this.closed?'manager_closing':'cancelled';op.controller.abort();this.state.phase='cancelling';this._notify();}if(op)await op.promise.catch(()=>{});this._discard();return {cancelled:!op?.committed,settled:true};}
  async close(){if(this.closed)return;this.closed=true;await this.cancel();this._clear();}
}
module.exports={QQFirstSetup,QQFirstSetupError,validateFirstSetupRequest:validate,firstSetupErrorCode:codeOf,QQ_SETUP_MARKER:MARKER};
