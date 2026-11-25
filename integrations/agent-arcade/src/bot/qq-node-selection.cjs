'use strict';

// Fixed managed Node component. This adapter shares the existing installation
// lock format, but never invents an original QQ program or a rollback target.
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {QQComponentPackages}=require('./qq-component-package.cjs');
const {QQComponentPrepared}=require('./qq-component-prepared.cjs');
const {QQComponentLockRecovery,observeOwnProcess}=require('./qq-component-lock-recovery.cjs');
const {withNodeCodeGate}=require('./qq-node-code-gate.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const fail=code=>{throw Object.assign(new Error(`Managed Node component failed (${code}).`),{code});};
const present=file=>{try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
function directory(file,create=false){
  if(typeof file!=='string'||!path.isAbsolute(file)||/^[/\\]{2}/.test(file))fail('unsafe_path');
  const target=path.resolve(file),base=path.parse(target).root;let cursor=base;
  for(const part of target.slice(base.length).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);try{const st=fs.lstatSync(cursor);if(!st.isDirectory()||st.isSymbolicLink())fail('unsafe_path');}catch(error){if(error.code!=='ENOENT'||!create)throw error;fs.mkdirSync(cursor,{mode:0o700});}
    if(!same(fs.realpathSync(cursor),cursor))fail('unsafe_path');
  }
  return target;
}
function bytes(file,max=4096){
  directory(path.dirname(file));const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>max)fail('unsafe_lock');
  const fd=fs.openSync(file,'r');try{const opened=fs.fstatSync(fd);if(opened.dev!==st.dev||opened.ino!==st.ino||opened.size!==st.size)fail('component_changed');const value=Buffer.alloc(opened.size);let offset=0;while(offset<value.length){const count=fs.readSync(fd,value,offset,value.length-offset,offset);if(!count)fail('component_changed');offset+=count;}const after=fs.fstatSync(fd),current=fs.lstatSync(file);if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||current.dev!==opened.dev||current.ino!==opened.ino||current.size!==opened.size||current.mtimeMs!==opened.mtimeMs||current.isSymbolicLink()||current.nlink!==1)fail('component_changed');return {value,stat:current};}finally{fs.closeSync(fd);}
}
class QQNodeSelection{
  constructor({root,read,lockRoot,processHost,prepared}={}){
    if(typeof read!=='function'||typeof processHost?.snapshot!=='function')fail('invalid_installation');
    this.reader=read;this.initial=read();this.fingerprint=JSON.stringify(this.initial);this.root=path.resolve(root);this.lockRoot=path.resolve(lockRoot);this.host=processHost;
    this.installationId=this.initial.installationId;this.componentsRoot=this.initial.installationRoot;this.workDir=this.initial.instancesRoot;
    this.lockFile=path.join(this.lockRoot,`installation-${this.installationId}.lock`);this.configLock=path.join(this.lockRoot,'configuration.edit');
    this.prepared=prepared||new QQComponentPrepared({root:this.root,component:'napcat-node',lockRoot:this.lockRoot,packages:new QQComponentPackages({root:this.root,component:'napcat-node'})});this.queue=Promise.resolve();this.pending=0;
  }
  read(){const value=this.reader();if(value&&typeof value.then==='function'||JSON.stringify(value)!==this.fingerprint)fail('managed_installation_changed');return value;}
  _stableDirectories(){const value=this.read();directory(value.installationRoot);directory(value.instancesRoot);const names=[];const stream=fs.opendirSync(value.instancesRoot);try{for(let row;(row=stream.readSync());){if(names.length>=32)fail('invalid_installation');names.push(row.name);}}finally{stream.closeSync();}const configDirs=[];for(const name of names.sort()){if(!/^[a-f0-9]{64}$/.test(name))fail('invalid_installation');const dir=path.join(value.instancesRoot,name);directory(dir);const config=path.join(dir,'work','config');if(present(config)){directory(config);configDirs.push(config);}}return {value,configDirs};}
  _stable(){require('./qq-managed-node-repair-metadata.cjs').assertManagedNodeRepairReady({root:this.root});const {value,configDirs}=this._stableDirectories();for(const dir of configDirs)require('./qq-native-passkey-maintenance.cjs').assertPasskeyMaintenanceReady(dir);require('./qq-pending-update-recovery.cjs').assertPendingUpdateRecoveryReady(configDirs);for(const dir of configDirs)if(present(path.join(dir,'napcat-update.json')))fail('pending_upstream_update');return value;}
  layout(){const value=this._stable();return {kind:'prepared',installationKind:'managed-node',codeRoot:value.codeRoot,workDir:value.instancesRoot,version:'4.18.42',selectionDigest:value.descriptorSha256};}
  status(){const value=this._stable();return {current:{kind:'prepared',version:'4.18.42',versionId:value.current.versionId,verification:'not-checked'},previous:null,canRollback:false,digest:value.descriptorSha256,scope:'qq-node-runtime',automaticStart:false};}
  async resolve({signal}={}){
    const before=this._stable(),record=before.current,result=await this.prepared.resolvePrepared(record.versionId,{signal});
    const current=this._stable();if(current.descriptorSha256!==before.descriptorSha256||result.versionId!==record.versionId||result.manifestSha256!==record.manifestSha256||!same(result.codeRoot,before.codeRoot))fail('component_changed');
    const node=result.files.find(row=>row.path==='node.exe'),entry=result.files.find(row=>row.path==='index.js');if(!node||!entry||node.sha256!==before.node.sha256||entry.sha256!==before.entry.sha256)fail('component_changed');
    return {...this.layout(),files:result.files};
  }
  _leases({assertConfiguration}={}){if(!fs.existsSync(this.lockRoot))return;directory(this.lockRoot);const names=fs.readdirSync(this.lockRoot);if(names.length>4096)fail('unsafe_lock');if(names.some(name=>/^[a-f0-9]{64}\.json(?:\.recover)?$/.test(name)))fail('runtime_locked');if(names.includes('configuration.edit')&&typeof assertConfiguration!=='function')fail('operation_in_progress');assertConfiguration?.();}
  async _stopped(options){return this._stoppedProcesses(this._stable(),options);}
  async _stoppedProcesses(value,options){this._leases(options);const rows=await this.host.snapshot();if(!Array.isArray(rows)||rows.length>4096)fail('process_check_failed');for(const row of rows){if(!row||typeof row.name!=='string'||typeof row.executable!=='string')fail('process_check_failed');if(row.name.toLowerCase()==='napcatqq-desktop.exe')fail('desktop_running');if(row.name.toLowerCase()==='node.exe'&&!path.isAbsolute(row.executable))fail('process_check_failed');if(same(row.executable,path.join(value.codeRoot,'node.exe')))fail('runtime_running');}this._leases(options);}
  lockRecovery(){return this.recovery||(this.recovery=new QQComponentLockRecovery({selection:this,processHost:this.host}));}
  _lock(operation){return this._installationGate(operation,()=>this._stable());}
  async _installationGate(operation,assertStructure){
    return withNodeCodeGate({root:this.root},async gate=>{
      const checked=()=>{gate();require('./qq-managed-node-repair-metadata.cjs').assertManagedNodeRepairReady({root:this.root});assertStructure();};
      checked();return this._ownedInstallationGate(operation,checked);
    });
  }
  async _ownedInstallationGate(operation,assertStructure){
    directory(this.lockRoot,true);if(fs.existsSync(`${this.lockFile}.recover`))fail('recovery_in_progress');const owner=await observeOwnProcess(this.host),token=randomUUID();let fd,stat,result,failure,issue;
    try{
      try{fd=fs.openSync(this.lockFile,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({schema:'qq_component_lock_v2',installationId:this.installationId,owner,token,at:new Date().toISOString()}));fs.fsyncSync(fd);stat=fs.fstatSync(fd);}catch(error){if(error.code==='EEXIST')fail('component_locked');throw error;}
      const assertOwned=()=>{assertStructure();const saved=bytes(this.lockFile);if(saved.stat.ino!==stat.ino||saved.stat.dev!==stat.dev||JSON.parse(saved.value).token!==token)fail('component_lock_changed');if(fs.existsSync(`${this.lockFile}.recover`))fail('recovery_in_progress');};
      assertOwned();result=await operation(assertOwned);
    }catch(error){failure=error;}
    finally{try{if(fd!==undefined)fs.closeSync(fd);}catch{issue='component_lock_handle_close_failed';}if(stat)try{const saved=bytes(this.lockFile);if(saved.stat.ino===stat.ino&&saved.stat.dev===stat.dev&&JSON.parse(saved.value).token===token)fs.unlinkSync(this.lockFile);else issue='component_lock_retained';}catch{try{if(present(this.lockFile))issue='component_lock_retained';}catch{issue='component_lock_state_unverified';}}}
    if(failure)throw failure;return issue&&result&&typeof result==='object'?{...result,lockRecoveryIssue:issue}:result;
  }
  pendingUpdateRecoveryContext(){
    const {value,configDirs}=this._stableDirectories();
    if(value.current?.kind!=='prepared'||value.current.version!=='4.18.42'||!/^napcat-node-4\.18\.42-[a-f0-9]{16}$/.test(value.current.versionId))fail('pending_update_unsupported');
    directory(value.codeRoot);return {component:'napcat-node',installationId:this.installationId,version:'4.18.42',selectionDigest:value.descriptorSha256,current:value.current,configDirs};
  }
  withPendingUpdateRecovery(operation){
    if(typeof operation!=='function')return Promise.reject(Object.assign(new Error('Invalid recovery operation.'),{code:'invalid_request'}));
    return this._installationGate(async assertOwned=>{
      const context=this.pendingUpdateRecoveryContext(),fingerprint=JSON.stringify(context);
      const assertContext=()=>{assertOwned();if(JSON.stringify(this.pendingUpdateRecoveryContext())!==fingerprint)fail('managed_installation_changed');};
      const assertStopped=async()=>{assertContext();await this._stoppedProcesses(this.read());assertContext();};
      const verify=async signal=>{assertContext();const value=this.read(),record=value.current,result=await this.prepared.resolvePrepared(record.versionId,{signal});assertContext();if(result.versionId!==record.versionId||result.version!=='4.18.42'||result.manifestSha256!==record.manifestSha256||!same(result.codeRoot,value.codeRoot)||!same(result.manifestPath,value.manifestPath))fail('component_changed');const node=result.files.find(row=>row.path==='node.exe'),entry=result.files.find(row=>row.path==='index.js');if(!node||!entry||node.sha256!==value.node.sha256||entry.sha256!==value.entry.sha256)fail('component_changed');};
      return operation({context,assertOwned:assertContext,assertStopped,verify});
    },()=>this.pendingUpdateRecoveryContext());
  }
  withStartLock(operation){if(typeof operation!=='function'||this.pending>=32)return Promise.reject(Object.assign(new Error('Node component busy.'),{code:'operation_in_progress'}));this.pending++;const task=this.queue.then(()=>this._lock(async assertOwned=>{if(fs.existsSync(this.configLock))fail('operation_in_progress');const plan=await this.resolve();assertOwned();return operation(plan,assertOwned);}));this.queue=task.catch(()=>{});return task.finally(()=>this.pending--);}
  preview({versionId,rollback=false,operation}={}){if(rollback||operation==='rollback')fail('rollback_unavailable');fail(versionId===this.read().current.versionId?'already_selected':'invalid_version');}
  activate({versionId}={}){fail(versionId===this.read().current.versionId?'already_selected':'invalid_version');}
  rollback(){fail('rollback_unavailable');}
}
module.exports={QQNodeSelection,directory,bytes,same,hash};
