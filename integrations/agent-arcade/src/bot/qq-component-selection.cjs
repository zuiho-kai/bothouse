'use strict';

// Original management layer. It never launches a process, reads a QQ
// login database, copies account configuration, or removes an unknown lock.
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {observeOwnProcess,QQComponentLockRecovery}=require('./qq-component-lock-recovery.cjs');
const {QQManagedLayout}=require('./qq-managed-layout.cjs');
const {withShellCodeGate,shellCodeRoot}=require('./qq-shell-code-gate.cjs');
const SHELL_RELEASE_ID='napcat-shell-4.18.42-02e5ff0f79916c1e';
const recoveryGuardPresent=file=>{try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const REQUIRED=['NapCatWinBootMain.exe','NapCatWinBootHook.dll','napcat.mjs','qqnt.json'];
const MAX_FILE=512*1024*1024,MAX_TOTAL=2*1024*1024*1024,MAX_FILES=10000,MAX_META=4*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const version=value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value);
const versionId=value=>typeof value==='string'&&/^napcat-shell-\d+\.\d+\.\d+-[a-f0-9]{16}$/.test(value);
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const inside=(root,file)=>{const rel=path.relative(root,file);return rel!==''&&!rel.startsWith(`..${path.sep}`)&&rel!=='..'&&!path.isAbsolute(rel);};
class QQComponentSelectionError extends Error{constructor(code){super(`QQ component selection failed (${code}).`);this.code=code;}}
const fail=code=>{throw new QQComponentSelectionError(code);};
function publicError(error){if(error instanceof QQComponentSelectionError)return error;const code=error?.code==='ENOENT'?'component_missing':typeof error?.code==='string'&&/^[a-z_]{1,48}$/.test(error.code)?error.code:'component_io_failed';const result=new QQComponentSelectionError(code);if(error?.committed===true)result.committed=true;if(['configuration_marker_retained','configuration_handle_close_failed'].includes(error?.configurationRecoveryIssue))result.configurationRecoveryIssue=error.configurationRecoveryIssue;return result;}
function local(value){if(typeof value!=='string'||!path.isAbsolute(value)||/^(?:\\\\|\/\/)/.test(value))fail('invalid_installation');return path.resolve(value);}
function safePath(file,{directory=false,max=MAX_FILE}={}){
  const resolved=local(file);let cursor=resolved;
  for(;;){const st=fs.lstatSync(cursor);if(st.isSymbolicLink())fail('unsafe_path');if(cursor===resolved){if(directory?!st.isDirectory():(!st.isFile()||st.nlink!==1||st.size>max))fail('unsafe_path');}else if(!st.isDirectory())fail('unsafe_path');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
  if(!same(fs.realpathSync(resolved),resolved))fail('unsafe_path');return fs.lstatSync(resolved);
}
function safeDir(dir){let existing=local(dir);while(!fs.existsSync(existing)){const parent=path.dirname(existing);if(parent===existing)fail('unsafe_path');existing=parent;}safePath(existing,{directory:true});fs.mkdirSync(dir,{recursive:true,mode:0o700});safePath(dir,{directory:true});}
function fileBytes(file,max=MAX_META){
  const before=safePath(file,{max});const fd=fs.openSync(file,'r');try{const opened=fs.fstatSync(fd);if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)fail('component_changed');const bytes=Buffer.alloc(opened.size);let offset=0;while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)fail('component_changed');offset+=n;}const after=fs.fstatSync(fd),current=safePath(file,{max});if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||current.dev!==opened.dev||current.ino!==opened.ino||current.size!==opened.size||current.mtimeMs!==opened.mtimeMs)fail('component_changed');return bytes;}finally{fs.closeSync(fd);}
}
function fileHash(file,size){
  const before=safePath(file);if(size!==undefined&&before.size!==size)fail('component_changed');let fd;try{fd=fs.openSync(file,'r');const opened=fs.fstatSync(fd);if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)fail('component_changed');const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let pos=0;while(pos<opened.size){const n=fs.readSync(fd,buffer,0,Math.min(buffer.length,opened.size-pos),pos);if(!n)fail('component_changed');hash.update(buffer.subarray(0,n));pos+=n;}const after=fs.fstatSync(fd),current=safePath(file);if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||current.dev!==opened.dev||current.ino!==opened.ino||current.size!==opened.size||current.mtimeMs!==opened.mtimeMs)fail('component_changed');return {size:opened.size,sha256:hash.digest('hex')};}finally{if(fd!==undefined)fs.closeSync(fd);}
}
function relative(value){
  if(typeof value!=='string'||!value||value.length>240||value.includes('\\')||value.includes(':')||value.startsWith('/')||value.split('/').some(part=>!part||part==='.'||part==='..'||/[\x00-\x1f<>"|?*]/.test(part)||/[ .]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))fail('manifest_invalid');return value;
}
function manifestFiles(files){
  if(!Array.isArray(files)||!files.length||files.length>MAX_FILES)fail('manifest_invalid');let total=0;const seen=new Set();
  for(const row of files){if(!row||typeof row!=='object'||!hex(row.sha256)||!Number.isSafeInteger(row.size)||row.size<0||row.size>MAX_FILE)fail('manifest_invalid');relative(row.path);const key=row.path.toLowerCase();if(seen.has(key))fail('manifest_invalid');seen.add(key);total+=row.size;if(total>MAX_TOTAL)fail('manifest_invalid');}
  if(REQUIRED.some(name=>!files.some(row=>row.path===name))||!files.some(row=>row.path.startsWith('static/')))fail('manifest_invalid');return files;
}
function inspectTree(root,files){
  safePath(root,{directory:true});const expected=new Map(manifestFiles(files).map(row=>[row.path,row]));let count=0;
  const walk=(dir,prefix='')=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(++count>MAX_FILES*2)fail('manifest_invalid');const rel=prefix+item.name;relative(rel);const file=path.join(dir,item.name);if(item.isSymbolicLink())fail('unsafe_path');if(item.isDirectory()){safePath(file,{directory:true});walk(file,`${rel}/`);}else{const row=expected.get(rel);if(!row)fail('component_changed');const actual=fileHash(file,row.size);if(actual.sha256!==row.sha256)fail('component_changed');expected.delete(rel);}}};
  walk(root);if(expected.size)fail('component_changed');
}
function descriptor(value){
  if(!value||typeof value!=='object'||!['original','prepared'].includes(value.kind)||(value.kind==='prepared'?!version(value.version):value.version!==null&&!version(value.version)))fail('selection_invalid');
  if(value.kind==='prepared'){if(!versionId(value.versionId)||!hex(value.manifestSha256))fail('selection_invalid');return {kind:'prepared',version:value.version,versionId:value.versionId,manifestSha256:value.manifestSha256};}
  if(!Array.isArray(value.files)||value.files.length!==REQUIRED.length||REQUIRED.some(name=>!value.files.some(row=>row.path===name&&hex(row.sha256)&&Number.isSafeInteger(row.size)&&row.size>=0&&row.size<=MAX_FILE)))fail('selection_invalid');
  return {kind:'original',version:value.version,files:value.files.map(row=>({path:row.path,size:row.size,sha256:row.sha256}))};
}
function brief(value){return {kind:value.kind,version:value.version,...(value.kind==='prepared'?{versionId:value.versionId}:{verification:'mandatory-files-only'})};}

function readLegacyQQPin(componentsRoot,lockRoot){
  const installationId=sha(componentsRoot.toLowerCase());
  const pinFile=path.join(lockRoot,'component-selections',`${installationId}.qq-pin.json`);
  let bytes;
  try{bytes=fileBytes(pinFile,4096);}catch(error){if(error.code==='ENOENT')return null;fail('selection_invalid');}
  let pin;
  try{pin=JSON.parse(bytes);}catch{fail('selection_invalid');}
  if(!pin||pin.schema!=='qq_legacy_executable_v1'||pin.installationId!==installationId||
    typeof pin.version!=='string'||!/^\d+\.\d+\.\d+(?:[-.]\d+)?$/.test(pin.version)||
    !Number.isSafeInteger(pin.size)||pin.size<1||pin.size>MAX_FILE||!hex(pin.sha256))fail('selection_invalid');
  const {version,size,sha256}=pin;
  return {version,size,sha256,file:path.join(componentsRoot,'QQ','versions',version,'QQ.exe')};
}

class QQComponentSelection{
  constructor({componentsRoot,lockRoot,preparedRoot,prepared,processHost,qqExe,installedVersion='4.18.42',managedInstallation}={}){
    this.componentsRoot=local(componentsRoot);this.lockRoot=local(lockRoot);this.preparedRoot=local(preparedRoot);this.workDir=path.join(this.componentsRoot,'NapCatQQ');this.qqExe=local(qqExe);this.managed=managedInstallation?new QQManagedLayout({read:managedInstallation}):null;
    if(this.managed){const managed=this.managed.read();if(!same(this.componentsRoot,managed.installationRoot)||!same(this.qqExe,managed.qq.file))fail('invalid_installation');this.workDir=managed.workDir;}
    if((!this.managed&&!inside(path.join(this.componentsRoot,'QQ'),this.qqExe))||(installedVersion!==null&&!version(installedVersion))||typeof prepared?.resolvePrepared!=='function'||typeof processHost?.snapshot!=='function')fail('invalid_installation');
    this.prepared=prepared;this.host=processHost;this.installedVersion=installedVersion;this.installationId=sha(this.componentsRoot.toLowerCase());this.startQueue=Promise.resolve();this.startPending=0;
    this.stateDir=path.join(this.lockRoot,'component-selections');this.stateFile=path.join(this.stateDir,`${this.installationId}.json`);this.historyDir=path.join(this.stateDir,this.installationId);
    this.lockFile=path.join(this.lockRoot,`installation-${this.installationId}.lock`);this.configLock=path.join(this.lockRoot,'configuration.edit');
  }
  lockRecovery(){return this.recovery||(this.recovery=new QQComponentLockRecovery({selection:this,processHost:this.host}));}
  _stablePaths(){this.managed?.read();safePath(this.componentsRoot,{directory:true});safePath(this.workDir,{directory:true});safePath(path.join(this.workDir,'config'),{directory:true});safePath(this.qqExe);}
  _stable(){this._stablePaths();require('./qq-native-passkey-maintenance.cjs').assertPasskeyMaintenanceReady(path.join(this.workDir,'config'));require('./qq-pending-update-recovery.cjs').assertPendingUpdateRecoveryReady([path.join(this.workDir,'config')]);if(recoveryGuardPresent(path.join(this.workDir,'config','napcat-update.json')))fail('pending_upstream_update');}
  _original(){if(this.managed)fail('original_unavailable');return {kind:'original',version:this.installedVersion,files:REQUIRED.map(name=>({path:name,...fileHash(path.join(this.workDir,name))}))};}
  _qqPath(){return this.managed?this.qqExe:path.relative(this.componentsRoot,this.qqExe).replaceAll('\\','/');}
  _shellRoot(){const root=path.dirname(path.dirname(this.preparedRoot));if(!same(path.join(this.preparedRoot,SHELL_RELEASE_ID,'code'),shellCodeRoot(root)))fail('invalid_installation');return root;}
  _assertShellReady(record){if(record?.kind==='prepared'&&record.versionId===SHELL_RELEASE_ID)require('./qq-managed-shell-repair-metadata.cjs').assertManagedShellRepairReady({root:this._shellRoot()});}
  _state(){this._stable();const state=this._readState();this._assertShellReady(state.value.current);return state;}
  _withShellCodeGate({id,rollback=false,signal}={},operation){
    const state=this._readState(),fixed=record=>record?.kind==='prepared'&&record.versionId===SHELL_RELEASE_ID;
    if(!fixed(state.value.current)&&id!==SHELL_RELEASE_ID&&!(rollback&&fixed(state.value.previous)))return operation(()=>{});
    const root=this._shellRoot();return withShellCodeGate({root,signal},held=>{const checked=()=>{held();require('./qq-managed-shell-repair-metadata.cjs').assertManagedShellRepairReady({root});};checked();return operation(checked);});
  }
  _readState(){
    const pin=this.managed?null:readLegacyQQPin(this.componentsRoot,this.lockRoot);
    if(pin&&!same(pin.file,this.qqExe))fail('qq_component_changed');
    let bytes=null;try{bytes=fileBytes(this.stateFile,32768);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!bytes){const managed=this.managed?.read(),current=managed?managed.prepared:this._original(),identity=managed?.qq||pin||fileHash(this.qqExe);const qq={path:this._qqPath(),size:identity.size,sha256:identity.sha256};const value={schema:'qq_component_selection_v1',installationId:this.installationId,current,previous:null,qq};return {value,bytes:null,digest:sha(Buffer.from(JSON.stringify(value)))};}
    let value;try{value=JSON.parse(bytes);}catch{fail('selection_invalid');}
    if(value?.schema!=='qq_component_selection_v1'||value.installationId!==this.installationId||!value.qq||!hex(value.qq.sha256)||!Number.isSafeInteger(value.qq.size)||value.qq.size<0||value.qq.path!==this._qqPath())fail('selection_invalid');
    if(pin&&(value.qq.size!==pin.size||value.qq.sha256!==pin.sha256))fail('qq_component_changed');
    value={...value,current:descriptor(value.current),previous:value.previous===null?null:descriptor(value.previous)};if(this.managed){const managed=this.managed.read();if(value.current.kind!=='prepared'||(value.previous&&value.previous.kind!=='prepared')||value.qq.size!==managed.qq.size||value.qq.sha256!==managed.qq.sha256)fail('selection_invalid');}return {value,bytes,digest:sha(bytes)};
  }
  _summary(state){return {current:brief(state.value.current),digest:state.digest,canRollback:state.value.previous!==null,previous:state.value.previous?brief(state.value.previous):null,scope:'napcat-only',automaticStart:false};}
  _guardDigest(state,expected){if(!hex(expected)||state.digest!==expected)fail('selection_changed');}
  _qq(state){const actual=fileHash(this.qqExe,state.value.qq.size);if(actual.sha256!==state.value.qq.sha256)fail('qq_component_changed');}
  assertLegacyQQPin(expected){
    if(this.managed)return;
    const pin=readLegacyQQPin(this.componentsRoot,this.lockRoot);
    if(pin?.sha256!==expected?.sha256||pin?.file!==expected?.file||pin?.size!==expected?.size)fail('qq_component_changed');
    if(!pin)return;
    if(!same(pin.file,this.qqExe)||fileHash(this.qqExe,pin.size).sha256!==pin.sha256)fail('qq_component_changed');
  }
  _layout(record,digest){return {kind:record.kind,codeRoot:record.kind==='original'?this.workDir:path.join(this.preparedRoot,record.versionId,'code'),workDir:this.workDir,configDir:path.join(this.workDir,'config'),qqExe:this.qqExe,...(this.managed?{qqDataDir:this.managed.read().qqDataDir,installationKind:'managed-shell'}:{}),version:record.version,selectionDigest:digest};}
  _currentLayout(){
    // Discovery does not hash the original executables on every UI poll.
    if(!this.managed&&!fs.existsSync(this.stateFile)){safePath(this.workDir,{directory:true});return this._layout({kind:'original',version:this.installedVersion},null);}
    const state=this._state(),plan=this._layout(state.value.current,state.digest);safePath(plan.codeRoot,{directory:true});if(state.value.current.kind==='prepared'){const file=path.join(this.preparedRoot,state.value.current.versionId,'prepared.json');if(sha(fileBytes(file))!==state.value.current.manifestSha256)fail('component_changed');}return plan;
  }
  layout(){try{return this._currentLayout();}catch(error){throw publicError(error);}}
  status(){try{if(!this.managed&&!fs.existsSync(this.stateFile))return {current:{kind:'original',version:this.installedVersion,verification:'not-checked'},digest:null,canRollback:false,previous:null,scope:'napcat-only',automaticStart:false};const value=this._summary(this._state());value.current.verification='not-checked';if(value.previous)value.previous.verification='not-checked';return value;}catch(error){throw publicError(error);}}
  shellOwnerContext(){
    // Main-only metadata for a previously captured owner. This does not resolve
    // executable code or authorize startup/component changes under a pending plan.
    try{if(!this.managed)fail('ownership_lost');this._stablePaths();const managed=this.managed.read(),state=this._readState(),current=state.value.current;
      if(current.kind!=='prepared'||current.version!=='4.18.42'||current.versionId!=='napcat-shell-4.18.42-02e5ff0f79916c1e')fail('ownership_lost');
      return {managed,current,layout:this._layout(current,state.digest),selectionFile:this.stateFile,selectionPresent:state.bytes!==null,lockRoot:this.lockRoot,lockFile:this.lockFile,descriptor:path.join(this.componentsRoot,'installation.json'),manifest:path.join(this.preparedRoot,current.versionId,'prepared.json')};
    }catch(error){throw publicError(error);}
  }
  async _public(operation){try{return await operation();}catch(error){throw publicError(error);}}
  async _prepared(id,signal){
    if(!versionId(id))fail('invalid_version');const result=await this.prepared.resolvePrepared(id,{signal});
    if(result?.versionId!==id||!version(result.version)||!hex(result.manifestSha256)||typeof result.codeRoot!=='string'||typeof result.manifestPath!=='string'||!same(result.codeRoot,path.join(this.preparedRoot,id,'code'))||!same(result.manifestPath,path.join(this.preparedRoot,id,'prepared.json')))fail('manifest_invalid');
    const bytes=fileBytes(result.manifestPath);if(sha(bytes)!==result.manifestSha256)fail('component_changed');let manifest;try{manifest=JSON.parse(bytes);}catch{fail('manifest_invalid');}
    if(manifest?.schema!=='qq_component_prepared_v1'||manifest.component!=='napcat-shell'||manifest.versionId!==id||manifest.version!==result.version||JSON.stringify(manifest.files)!==JSON.stringify(result.files))fail('manifest_invalid');
    inspectTree(result.codeRoot,result.files);return {kind:'prepared',version:result.version,versionId:id,manifestSha256:result.manifestSha256};
  }
  async _verify(record,signal){
    if(record.kind==='prepared'){const checked=await this._prepared(record.versionId,signal);if(checked.version!==record.version||checked.manifestSha256!==record.manifestSha256)fail('component_changed');}
    else for(const row of record.files){if(fileHash(path.join(this.workDir,row.path),row.size).sha256!==row.sha256)fail('component_changed');}
  }
  resolve(){return this._public(async()=>{const before=this._state();this._qq(before);await this._verify(before.value.current);this._guardDigest(this._state(),before.digest);return this._layout(before.value.current,before.digest);});}
  preview({versionId:id,operation='activate',signal}={}){return this._public(async()=>{
    if(signal?.aborted)fail('cancelled');if(!['activate','rollback'].includes(operation)||(operation==='rollback'&&id!==undefined))fail('invalid_request');const state=this._state();this._qq(state);await this._verify(state.value.current,signal);const result={...this._summary(state),operation};let candidate;
    if(operation==='rollback'){candidate=state.value.previous;if(!candidate)fail('rollback_unavailable');await this._verify(candidate,signal);}else if(id!==undefined)candidate=await this._prepared(id,signal);
    if(candidate){if(!state.value.current.version)fail('installed_version_unverified');if(candidate.version!==state.value.current.version)fail('version_change_not_supported');result.candidate=brief(candidate);}this._guardDigest(this._state(),state.digest);return result;
  });}
  _leases({assertConfiguration}={}){
    if(!fs.existsSync(this.lockRoot))return;safePath(this.lockRoot,{directory:true});const names=fs.readdirSync(this.lockRoot);if(names.length>4096)fail('unsafe_lock');
    // Existing account locks are global across Arcade profiles. Conservatively
    // refuse any account lease, including a stale/partial lease or recovery.
    if(names.some(name=>/^[a-f0-9]{64}\.json(?:\.recover)?$/.test(name)))fail('runtime_locked');if(names.includes('configuration.edit')&&typeof assertConfiguration!=='function')fail('operation_in_progress');if(assertConfiguration)assertConfiguration();
  }
  async _stopped(options){
    this._stable();return this._stoppedProcesses(options);
  }
  async _stoppedProcesses(options){
    this._leases(options);let rows;try{rows=await this.host.snapshot();}catch{fail('process_check_failed');}
    if(!Array.isArray(rows)||rows.length>4096)fail('process_check_failed');
    for(const row of rows){if(!row||!Number.isSafeInteger(row.pid)||row.pid<1||typeof row.name!=='string'||typeof row.executable!=='string')fail('process_check_failed');const name=row.name.toLowerCase();if(name==='napcatqq-desktop.exe')fail('desktop_running');if(['qq.exe','napcatwinbootmain.exe'].includes(name)&&!path.isAbsolute(row.executable))fail('process_check_failed');if(row.executable&&(inside(this.componentsRoot,row.executable)||inside(this.preparedRoot,row.executable)||(this.managed&&same(row.executable,this.qqExe))))fail('runtime_running');}
    this._leases(options);
  }
  pendingUpdateRecoveryContext(){
    this._stablePaths();const state=this._readState();
    if(state.value.current.kind!=='prepared'||state.value.current.version!=='4.18.42')fail('pending_update_unsupported');
    this._qq(state);return {component:'napcat-shell',installationId:this.installationId,version:'4.18.42',selectionDigest:state.digest,current:state.value.current,configDirs:[path.join(this.workDir,'config')]};
  }
  withPendingUpdateRecovery(operation){
    if(typeof operation!=='function')return Promise.reject(new QQComponentSelectionError('invalid_request'));
    return this._public(()=>this._lock(async assertOwned=>{
      const context=this.pendingUpdateRecoveryContext(),fingerprint=JSON.stringify(context);
      const assertContext=()=>{assertOwned();if(JSON.stringify(this.pendingUpdateRecoveryContext())!==fingerprint)fail('selection_changed');};
      const assertStopped=async()=>{assertContext();await this._stoppedProcesses();assertContext();};
      const verify=async signal=>{assertContext();await this._verify(context.current,signal);assertContext();};
      return operation({context,assertOwned:assertContext,assertStopped,verify});
    }));
  }
  withPendingUpdateLockRecoveryProof(operation,{signal}={}){
    if(typeof operation!=='function')return Promise.reject(new QQComponentSelectionError('invalid_request'));
    return this._public(async()=>{
      if(!this.managed)fail('pending_lock_unsupported');
      const managed=this.managed.read(),context=this.pendingUpdateRecoveryContext();
      if(context.current.versionId!=='napcat-shell-4.18.42-02e5ff0f79916c1e')fail('pending_lock_unsupported');
      const fingerprint=JSON.stringify({managed,context});
      const assertContext=()=>{if(signal?.aborted)fail('cancelled');if(JSON.stringify({managed:this.managed.read(),context:this.pendingUpdateRecoveryContext()})!==fingerprint)fail('selection_changed');};
      const paths={installationRoot:this.componentsRoot,workDir:this.workDir,configDir:path.join(this.workDir,'config'),lockRoot:this.lockRoot,codeRoot:path.join(this.preparedRoot,context.current.versionId,'code'),manifest:path.join(this.preparedRoot,context.current.versionId,'prepared.json'),descriptor:path.join(this.componentsRoot,'installation.json'),selection:this.stateFile,qqExe:this.qqExe};
      const assertStopped=async()=>{assertContext();await this._stoppedProcesses();assertContext();};
      const verify=async()=>{assertContext();await this._verify(context.current,signal);assertContext();};
      assertContext();return operation({context,managed,paths,assertContext,assertStopped,verify});
    });
  }
  async _lock(operation){
    safeDir(this.lockRoot);if(recoveryGuardPresent(`${this.lockFile}.recover`))fail('recovery_in_progress');const owner=await observeOwnProcess(this.host);let fd,identity,result,failure,cleanupIssue;const token=randomUUID();
    try{try{fd=fs.openSync(this.lockFile,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({schema:'qq_component_lock_v2',installationId:this.installationId,owner,token,at:new Date().toISOString()}));fs.fsyncSync(fd);identity=fs.fstatSync(fd);}catch(error){if(error.code==='EEXIST')fail('component_locked');throw error;}
      const assertOwned=()=>{const st=safePath(this.lockFile,{max:4096});if(st.ino!==identity.ino||st.dev!==identity.dev)fail('component_lock_changed');let value;try{value=JSON.parse(fileBytes(this.lockFile,4096));}catch{fail('component_lock_changed');}if(value.token!==token)fail('component_lock_changed');};
      assertOwned();if(recoveryGuardPresent(`${this.lockFile}.recover`))fail('recovery_in_progress');result=await operation(assertOwned);
    }catch(error){failure=error;}
    finally{
      try{if(fd!==undefined)fs.closeSync(fd);}catch{cleanupIssue='component_lock_handle_close_failed';}
      if(identity){try{const st=safePath(this.lockFile,{max:4096});const value=JSON.parse(fileBytes(this.lockFile,4096));if(st.ino===identity.ino&&st.dev===identity.dev&&value.token===token)fs.unlinkSync(this.lockFile);else cleanupIssue='component_lock_retained';}catch{try{if(recoveryGuardPresent(this.lockFile))cleanupIssue='component_lock_retained';}catch{cleanupIssue='component_lock_state_unverified';}}}
    }
    if(failure)throw failure;
    if(cleanupIssue&&result?.committed===true){const error=new QQComponentSelectionError(cleanupIssue);error.committed=true;throw error;}
    return cleanupIssue&&result&&typeof result==='object'?{...result,lockRecoveryIssue:cleanupIssue}:result;
  }
  withStartLock(operation){
    if(typeof operation!=='function')return Promise.reject(new QQComponentSelectionError('invalid_request'));if(this.startPending>=32)return Promise.reject(new QQComponentSelectionError('operation_in_progress'));this.startPending++;
    const task=this.startQueue.then(()=>this._lock(assertOwned=>this._withShellCodeGate({},async gate=>{const checked=()=>{assertOwned();gate();};if(fs.existsSync(this.configLock))fail('operation_in_progress');const plan=await this.resolve();checked();return operation(plan,checked);})));
    this.startQueue=task.catch(()=>{});return this._public(()=>task).finally(()=>{this.startPending--;});
  }
  async _switch({id,expectedDigest,rollback=false,assertCurrent,signal}){
    if(!hex(expectedDigest))fail('selection_changed');if(assertCurrent!==undefined&&typeof assertCurrent!=='function')fail('invalid_request');
    const current=()=>{if(signal?.aborted)fail('cancelled');const value=assertCurrent?.();if(value&&typeof value.then==='function')fail('invalid_request');};current();
    return this._lock(assertOwned=>this._withShellCodeGate({id,rollback,signal},async gate=>{
      const checked=()=>{gate();current();};
      checked();await this._stopped();checked();const state=this._state();this._guardDigest(state,expectedDigest);this._qq(state);await this._verify(state.value.current,signal);checked();
      const target=rollback?state.value.previous:await this._prepared(id,signal);checked();if(!target)fail('rollback_unavailable');if(!state.value.current.version)fail('installed_version_unverified');if(target.version!==state.value.current.version)fail('version_change_not_supported');await this._verify(target,signal);checked();
      if(JSON.stringify(target)===JSON.stringify(state.value.current))fail('already_selected');
      safeDir(this.stateDir);safeDir(this.historyDir);if(fs.readdirSync(this.historyDir).length>=64)fail('selection_history_full');
      const value={schema:'qq_component_selection_v1',installationId:this.installationId,current:target,previous:state.value.current,qq:state.value.qq,changedAt:new Date().toISOString()};const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),tmp=path.join(this.stateDir,`${this.installationId}.${randomUUID()}.tmp`),history=path.join(this.historyDir,`${randomUUID()}.json`);let tempCreated=false,committed=false;
      try{
        const historyBytes=state.bytes||Buffer.from(JSON.stringify(state.value,null,2)+'\n');const hf=fs.openSync(history,'wx',0o600);try{fs.writeFileSync(hf,historyBytes);fs.fsyncSync(hf);}finally{fs.closeSync(hf);}
        const tf=fs.openSync(tmp,'wx',0o600);tempCreated=true;try{fs.writeFileSync(tf,bytes);fs.fsyncSync(tf);}finally{fs.closeSync(tf);}
        // Recheck after durable temp/history writes, immediately before rename.
        await this._stopped();checked();await this._verify(state.value.current,signal);checked();await this._verify(target,signal);checked();await this._stopped();checked();this._qq(state);assertOwned();this._guardDigest(this._state(),expectedDigest);safePath(tmp,{max:32768});if(sha(fileBytes(tmp,32768))!==sha(bytes))fail('component_changed');checked();fs.renameSync(tmp,this.stateFile);committed=true;tempCreated=false;
        const after=this._state();if(after.digest!==sha(bytes))fail('selection_changed');return {committed:true,...this._summary(after)};
      }catch(error){
        // A failed read-back or unusual rename error must not be reported as
        // an unchanged selection. Recheck only the exact intended bytes.
        if(!committed&&tempCreated){try{committed=sha(fileBytes(this.stateFile,32768))===sha(bytes);}catch{/* A missing or unreadable target is not proof of commit. */}}
        const result=publicError(error);if(committed)result.committed=true;throw result;
      }finally{if(tempCreated){try{if(sha(fileBytes(tmp,32768))===sha(bytes))fs.unlinkSync(tmp);}catch{/* Preserve a replaced file. */}}}
    }));
  }
  activate({versionId:id,expectedDigest,assertCurrent,signal}={}){return this._public(()=>this._switch({id,expectedDigest,assertCurrent,signal}));}
  rollback({expectedDigest,assertCurrent,signal}={}){return this._public(()=>this._switch({expectedDigest,rollback:true,assertCurrent,signal}));}
}
module.exports={QQComponentSelection,QQComponentSelectionError,REQUIRED,readLegacyQQPin};
