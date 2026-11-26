'use strict';
// No process is terminated or started. Recovery requires
// an explicit digest and a v2 lock with an originally observed owner identity.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {createHash,randomUUID}=require('node:crypto');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
class QQComponentRecoveryError extends Error{constructor(code){super(`QQ component lock recovery failed (${code}).`);this.code=code;}}
const fail=code=>{throw new QQComponentRecoveryError(code);};
const proof=value=>value&&Number.isSafeInteger(value.pid)&&value.pid>0&&typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt))&&typeof value.executable==='string'&&path.isAbsolute(value.executable)&&!/^[/\\]{2}/.test(value.executable);
const identity=value=>({pid:value.pid,createdAt:value.createdAt,executable:value.executable});
const matches=(a,b)=>proof(a)&&proof(b)&&a.pid===b.pid&&a.createdAt===b.createdAt&&same(a.executable,b.executable);
function present(file){try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;fail('unsafe_lock');}}
function cleanupPresence(file){try{return present(file);}catch{return null;}}
function safe(file){let current=path.resolve(file);for(;;){const st=fs.lstatSync(current);if(st.isSymbolicLink())fail('unsafe_lock');if(current===path.resolve(file)){if(!st.isFile()||st.nlink!==1||st.size>4096)fail('unsafe_lock');}else if(!st.isDirectory())fail('unsafe_lock');const parent=path.dirname(current);if(parent===current)break;current=parent;}if(!same(fs.realpathSync(file),file))fail('unsafe_lock');return fs.lstatSync(file);}
function read(file){const before=safe(file),fd=fs.openSync(file,'r');try{const opened=fs.fstatSync(fd);const sameStat=(a,b)=>a.ino===b.ino&&a.dev===b.dev&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.nlink===1;if(!sameStat(before,opened))fail('component_lock_changed');const bytes=Buffer.alloc(opened.size);let offset=0;while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!count)fail('component_lock_changed');offset+=count;}const after=safe(file);if(!sameStat(opened,fs.fstatSync(fd))||!sameStat(opened,after))fail('component_lock_changed');return {bytes,stat:after,digest:sha(Buffer.from(JSON.stringify({bytes:sha(bytes),ino:String(after.ino),dev:String(after.dev)})))};}finally{fs.closeSync(fd);}}
async function observe(host,pid){
  if(typeof host?.snapshot!=='function'||typeof host?.inspect!=='function')fail('process_check_failed');let rows,direct;
  try{rows=await host.snapshot();direct=await host.inspect([pid]);}catch{fail('process_check_failed');}
  if(!Array.isArray(rows)||rows.length>4096||!Array.isArray(direct)||direct.length>1||direct.some(row=>!proof(row)||row.pid!==pid))fail('process_check_failed');
  const full=rows.filter(row=>row?.pid===pid);if(full.length>1||full.some(row=>!proof(row)))fail('process_check_failed');if(full.length!==direct.length||(full.length&&!matches(full[0],direct[0])))fail('process_check_failed');return direct[0]||null;
}
async function observeOwnProcess(host){const owner=await observe(host,process.pid);if(!owner||!same(owner.executable,process.execPath))fail('process_check_failed');return identity(owner);}
function gateEndpoint(installationId,platform=process.platform){
  if(!hex(installationId))fail('invalid_request');const name=`agent-arcade-component-recovery-${installationId}`;
  if(platform==='win32')return `\\\\.\\pipe\\${name}`;if(platform==='linux')return `\0${name}`;fail('recovery_gate_unsupported');
}
async function withRecoveryGate(installationId,operation){
  // An OS-owned IPC endpoint closes with the process. There is no third disk
  // lock whose own crash recovery would require a fourth recovery lock.
  const endpoint=gateEndpoint(installationId),server=net.createServer(socket=>socket.destroy());let lost=false,closing=false;
  server.maxConnections=1;
  await new Promise((resolve,reject)=>{const failed=error=>{server.removeListener('listening',ready);reject(new QQComponentRecoveryError(['EADDRINUSE','EACCES','EPERM'].includes(error.code)?'recovery_in_progress':'recovery_gate_unavailable'));};const ready=()=>{server.removeListener('error',failed);resolve();};server.once('error',failed);server.once('listening',ready);server.listen(endpoint);});
  server.on('error',()=>{lost=true;});server.on('close',()=>{if(!closing)lost=true;});
  let result,failure,cleanupFailure;
  try{result=await operation(()=>{if(lost||!server.listening)fail('recovery_gate_lost');});}catch(error){failure=error;}
  finally{closing=true;try{if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}catch{cleanupFailure=true;}}
  if(failure)throw failure;
  if(cleanupFailure){const error=new QQComponentRecoveryError('recovery_gate_close_failed');if(result?.recovered===true||result?.committed===true)error.committed=true;throw error;}
  return result;
}
class QQComponentLockRecovery{
  constructor({selection,processHost}={}){if(!selection||!path.isAbsolute(selection.lockFile)||!hex(selection.installationId)||typeof selection._stopped!=='function')fail('invalid_request');this.selection=selection;this.host=processHost;this.file=selection.lockFile;this.guard=`${this.file}.recover`;}
  _read(){if(!present(this.file))fail('component_lock_missing');const current=read(this.file);let value;try{value=JSON.parse(current.bytes);}catch{fail('lock_proof_unavailable');}if(value?.schema!=='qq_component_lock_v2'||value.installationId!==this.selection.installationId||!proof(value.owner)||typeof value.token!=='string'||!/^[a-f0-9-]{36}$/.test(value.token))fail('lock_proof_unavailable');return {...current,value};}
  _same(expected){const now=this._read();if(now.digest!==expected.digest||now.stat.ino!==expected.stat.ino||now.stat.dev!==expected.stat.dev)fail('component_lock_changed');return now;}
  _readGuard(){if(!present(this.guard))fail('recovery_guard_missing');const current=read(this.guard);let value;try{value=JSON.parse(current.bytes);}catch{fail('recovery_guard_proof_unavailable');}if(value?.schema!=='qq_component_recovery_guard_v1'||value.installationId!==this.selection.installationId||!proof(value.owner)||typeof value.token!=='string'||!/^[a-f0-9-]{36}$/.test(value.token))fail('recovery_guard_proof_unavailable');return {...current,value};}
  _sameGuard(expected){const current=this._readGuard();if(current.digest!==expected.digest||current.stat.ino!==expected.stat.ino||current.stat.dev!==expected.stat.dev)fail('component_lock_changed');return current;}
  _primary(){return present(this.file)?this._read():null;}
  _samePrimary(expected){if(expected)this._same(expected);else if(present(this.file))fail('component_lock_changed');}
  _readConfiguration(){
    if(!present(this.selection.configLock))fail('configuration_lock_missing');const current=read(this.selection.configLock);let value;
    try{value=JSON.parse(current.bytes);}catch{fail('configuration_proof_unavailable');}
    if(value?.schema!=='qq_configuration_lock_v2'||value.installationId!==this.selection.installationId||!proof(value.owner)||!hex(value.componentLockDigest)||typeof value.componentToken!=='string'||!/^[a-f0-9-]{36}$/.test(value.componentToken)||typeof value.token!=='string'||!/^[a-f0-9-]{36}$/.test(value.token))fail('configuration_proof_unavailable');
    return {...current,value};
  }
  _sameConfiguration(expected){const current=this._readConfiguration();if(current.digest!==expected.digest)fail('component_lock_changed');return current;}
  _configurationContext(){
    const marker=this._readConfiguration(),primary=this._primary(),guard=present(this.guard)?this._readGuard():null;
    if(primary&&(primary.digest!==marker.value.componentLockDigest||primary.value.token!==marker.value.componentToken||!matches(primary.value.owner,marker.value.owner)))fail('configuration_link_changed');
    const digest=sha(Buffer.from(JSON.stringify({marker:marker.digest,primary:primary?.digest||null,guard:guard?.digest||null})));return {marker,primary,guard,digest};
  }
  _sameConfigurationContext(expected){this._sameConfiguration(expected.marker);this._samePrimary(expected.primary);if(expected.guard)this._sameGuard(expected.guard);else if(present(this.guard))fail('component_lock_changed');}
  async _configurationEligible(expected){
    const options={assertConfiguration:()=>this._sameConfiguration(expected.marker)};
    for(let pass=0;pass<2;pass++){await this.selection._stopped(options);await this._dead(expected.marker.value);if(expected.primary)await this._dead(expected.primary.value);if(expected.guard)await this._dead(expected.guard.value);}
    this._sameConfigurationContext(expected);
  }
  async _dead(value){const current=await observe(this.host,value.owner.pid);if(current){if(matches(current,value.owner))fail('owner_alive');fail('owner_identity_changed');}}
  async _eligible(expected){await this.selection._stopped();await this._dead(expected.value);await this.selection._stopped();await this._dead(expected.value);this._same(expected);}
  async _guardEligible(expected,primary){
    for(let pass=0;pass<2;pass++){await this.selection._stopped();await this._dead(expected.value);if(primary)await this._dead(primary.value);}
    this._sameGuard(expected);this._samePrimary(primary);
  }
  async _public(run){try{return await run();}catch(error){if(error instanceof QQComponentRecoveryError)throw error;const code=typeof error?.code==='string'&&/^[a-z_]{1,48}$/.test(error.code)?error.code:'lock_recovery_failed';const out=new QQComponentRecoveryError(code);if(error?.committed===true)out.committed=true;throw out;}}
  status(){return this._public(async()=>{
    const targets=[['configuration',this.selection.configLock,()=>this._readConfiguration()],['guard',this.guard,()=>this._readGuard()],['installation',this.file,()=>this._read()]].map(([kind,file,check])=>{
      try{if(!present(file))return {kind,state:'absent',verification:'not-checked'};check();return {kind,state:'recorded',verification:'not-checked'};}
      catch(error){return {kind,state:'unverified',verification:'not-checked',code:error instanceof QQComponentRecoveryError?error.code:'unsafe_lock'};}
    });
    return {targets,nextTarget:targets.find(row=>row.state!=='absent')?.kind||null,automaticStart:false};
  });}
  preview(){return this._public(async()=>{if(present(this.guard))fail('recovery_in_progress');const expected=this._read();await this._eligible(expected);return {digest:expected.digest,recovery:'eligible',owner:{pid:expected.value.owner.pid,createdAt:expected.value.owner.createdAt,executableName:path.basename(expected.value.owner.executable)},automaticStart:false,selectionChanged:false};});}
  previewGuardRecovery(){return this._public(()=>withRecoveryGate(this.selection.installationId,async assertGate=>{
    const expected=this._readGuard(),primary=this._primary();await this._guardEligible(expected,primary);assertGate();
    const digest=sha(Buffer.from(JSON.stringify({guard:expected.digest,primary:primary?.digest||null})));
    return {digest,recovery:'guard-eligible',componentLockRemaining:!!primary,automaticStart:false,selectionChanged:false};
  }));}
  recoverGuard({expectedDigest,assertCurrent,signal}={}){return this._public(()=>withRecoveryGate(this.selection.installationId,async assertGate=>{
    if(!hex(expectedDigest)||(assertCurrent!==undefined&&typeof assertCurrent!=='function'))fail('invalid_request');
    const check=()=>{assertGate();if(signal?.aborted)fail('cancelled');const value=assertCurrent?.();if(value&&typeof value.then==='function')fail('invalid_request');};
    check();await observeOwnProcess(this.host);check();const expected=this._readGuard(),primary=this._primary();
    if(sha(Buffer.from(JSON.stringify({guard:expected.digest,primary:primary?.digest||null})))!==expectedDigest)fail('component_lock_changed');
    await this._guardEligible(expected,primary);check();await this._dead(expected.value);if(primary)await this._dead(primary.value);await this.selection._stopped();check();this.selection._leases();this._sameGuard(expected);this._samePrimary(primary);check();
    try{fs.unlinkSync(this.guard);}catch(error){if(!present(this.guard)){const out=new QQComponentRecoveryError('recovery_readback_failed');out.committed=true;throw out;}throw error;}
    return {recovered:true,recovery:'guard-cleared',componentLockRemaining:!!primary,automaticStart:false,selectionChanged:false,previousDigest:expectedDigest};
  }));}
  previewConfigurationRecovery(){return this._public(()=>withRecoveryGate(this.selection.installationId,async assertGate=>{
    const expected=this._configurationContext();await this._configurationEligible(expected);assertGate();
    return {digest:expected.digest,recovery:'configuration-eligible',componentLockRemaining:!!expected.primary,recoveryGuardRemaining:!!expected.guard,configurationRestored:false,automaticStart:false,selectionChanged:false};
  }));}
  recoverConfiguration({expectedDigest,assertCurrent,signal}={}){return this._public(()=>withRecoveryGate(this.selection.installationId,async assertGate=>{
    if(!hex(expectedDigest)||(assertCurrent!==undefined&&typeof assertCurrent!=='function'))fail('invalid_request');
    const check=()=>{assertGate();if(signal?.aborted)fail('cancelled');const value=assertCurrent?.();if(value&&typeof value.then==='function')fail('invalid_request');};
    check();await observeOwnProcess(this.host);check();const expected=this._configurationContext();if(expected.digest!==expectedDigest)fail('component_lock_changed');
    await this._configurationEligible(expected);check();await this._dead(expected.marker.value);if(expected.primary)await this._dead(expected.primary.value);if(expected.guard)await this._dead(expected.guard.value);
    const options={assertConfiguration:()=>this._sameConfiguration(expected.marker)};await this.selection._stopped(options);check();this.selection._leases(options);this._sameConfigurationContext(expected);check();
    try{fs.unlinkSync(this.selection.configLock);}catch(error){if(!present(this.selection.configLock)){const out=new QQComponentRecoveryError('recovery_readback_failed');out.committed=true;throw out;}throw error;}
    return {recovered:true,recovery:'configuration-cleared',componentLockRemaining:!!expected.primary,recoveryGuardRemaining:!!expected.guard,configurationRestored:false,automaticStart:false,selectionChanged:false,previousDigest:expectedDigest};
  }));}
  recover({expectedDigest,assertCurrent,signal}={}){return this._public(()=>withRecoveryGate(this.selection.installationId,async assertGate=>{
    if(!hex(expectedDigest)||(assertCurrent!==undefined&&typeof assertCurrent!=='function'))fail('invalid_request');const check=()=>{assertGate();if(signal?.aborted)fail('cancelled');const value=assertCurrent?.();if(value&&typeof value.then==='function')fail('invalid_request');};check();const expected=this._read();if(expected.digest!==expectedDigest)fail('component_lock_changed');
    const owner=await observeOwnProcess(this.host);check();let fd,guardStat;const token=randomUUID(),guardBytes=Buffer.from(JSON.stringify({schema:'qq_component_recovery_guard_v1',installationId:this.selection.installationId,owner,token,at:new Date().toISOString()}));
    let committed=false,result,failure,recoveryIssue=null;
    try{
      try{fd=fs.openSync(this.guard,'wx',0o600);fs.writeFileSync(fd,guardBytes);fs.fsyncSync(fd);guardStat=fs.fstatSync(fd);}catch(error){if(error.code==='EEXIST')fail('recovery_in_progress');throw error;}
      const assertGuard=()=>{const current=read(this.guard);if(current.stat.ino!==guardStat.ino||current.stat.dev!==guardStat.dev||!current.bytes.equals(guardBytes))fail('component_lock_changed');};
      assertGuard();await this._eligible(expected);check();await this._dead(expected.value);check();await this.selection._stopped();check();this.selection._leases();assertGuard();this._same(expected);check();
      try{fs.unlinkSync(this.file);committed=true;}catch(error){if(!present(this.file)){committed=true;const out=new QQComponentRecoveryError('recovery_readback_failed');out.committed=true;throw out;}throw error;}
      result={recovered:true,automaticStart:false,selectionChanged:false,previousDigest:expectedDigest};
    }catch(error){failure=error;}
    finally{
      try{if(fd!==undefined)fs.closeSync(fd);}catch{recoveryIssue='recovery_handle_close_failed';}
      if(guardStat){try{const current=read(this.guard);if(current.stat.ino===guardStat.ino&&current.stat.dev===guardStat.dev&&current.bytes.equals(guardBytes))fs.unlinkSync(this.guard);else recoveryIssue='recovery_guard_retained';}catch{if(cleanupPresence(this.guard)!==false)recoveryIssue='recovery_guard_retained';}}
    }
    if(failure){if(committed)failure.committed=true;throw failure;}
    const guardRemaining=cleanupPresence(this.guard);if(guardRemaining===null)recoveryIssue='recovery_guard_state_unverified';
    return {...result,...(recoveryIssue?{recoveryIssue}:{}),guardRemaining};
  }));}
}
async function createConfigurationMarker({selection,processHost}={}){
  const recovery=new QQComponentLockRecovery({selection,processHost}),primary=recovery._read(),owner=await observeOwnProcess(processHost);
  if(!matches(primary.value.owner,owner))fail('owner_identity_changed');if(present(recovery.guard))fail('recovery_in_progress');recovery._same(primary);
  const bytes=Buffer.from(JSON.stringify({schema:'qq_configuration_lock_v2',installationId:selection.installationId,owner,componentToken:primary.value.token,componentLockDigest:primary.digest,token:randomUUID(),at:new Date().toISOString()}));let fd,stat;
  try{fd=fs.openSync(selection.configLock,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);stat=fs.fstatSync(fd);}catch(error){if(fd!==undefined)try{fs.closeSync(fd);}catch{}if(error.code==='EEXIST')fail('operation_in_progress');throw error;}
  const assertOwned=()=>{recovery._same(primary);if(present(recovery.guard))fail('recovery_in_progress');const current=read(selection.configLock);if(current.stat.ino!==stat.ino||current.stat.dev!==stat.dev||!current.bytes.equals(bytes))fail('component_lock_changed');};
  let closed=false;
  return {assertOwned,close(){if(closed)return {released:false};closed=true;let issue=null;try{fs.closeSync(fd);}catch{issue='configuration_handle_close_failed';}try{const current=read(selection.configLock);if(current.stat.ino===stat.ino&&current.stat.dev===stat.dev&&current.bytes.equals(bytes))fs.unlinkSync(selection.configLock);else issue='configuration_marker_retained';}catch{if(cleanupPresence(selection.configLock)!==false)issue='configuration_marker_retained';}const remaining=cleanupPresence(selection.configLock);if(remaining===null)issue='configuration_marker_retained';return {released:remaining===false,...(issue?{issue}:{})};}};
}
module.exports={QQComponentLockRecovery,QQComponentRecoveryError,observeOwnProcess,withRecoveryGate,gateEndpoint,createConfigurationMarker};
