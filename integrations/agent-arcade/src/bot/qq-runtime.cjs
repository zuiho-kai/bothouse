'use strict';

// Original local orchestration. NapCat and QQ are separately installed programs;
// this module neither redistributes them nor rewrites their profiles/configuration.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const {spawn, execFile} = require('node:child_process');
const {randomUUID, createHash} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {atomicJSON}=require('../core/files.cjs');
const {QQRuntimeEndpointStore}=require('./qq-runtime-endpoint.cjs');
const {createConfigurationMarker}=require('./qq-component-lock-recovery.cjs');
const {QQManagedLayout}=require('./qq-managed-layout.cjs');
const ShellOwner=require('./qq-shell-owner-proof.cjs');
const QCE=require('./qq-qce-managed-process.cjs');
const QCEStartup=require('./qq-qce-startup.cjs');

const MAX_LOG_BYTES = 128 * 1024;
const MAX_ACCOUNTS = 32;
// Node has its own v2 lease contract; a version number alone is not an engine.
const isShellLease = value => value?.version===2&&value.engine==='managed-shell';
const MESSAGES = {
  qce_process_unverified: 'QCE runtime identity could not be verified. Keep it stopped and inspect its fixed installation.',
  qce_version_unsupported: 'This QCE release is not supported by this managed runtime.',
  qce_port_unavailable: 'A required QCE port is already in use. No existing process was changed.',
  qce_startup_unverified: 'QCE startup data could not be verified. No files were migrated.',
  qce_startup_migration_required: 'This QCE upgrade could migrate existing exports. A separate migration is required before startup.',
  qce_startup_changed: 'QCE startup data changed during verification. Inspect before starting again.',
  shell_repair_busy: 'Another operation is using the shared Shell code. Wait for it to finish.',
  shell_repair_changed: 'The shared Shell component changed. Inspect its current state.',
  shell_repair_unavailable: 'The managed Shell metadata could not be verified for recovery.',
  shell_repair_recovery_required: 'An interrupted Shell code repair needs explicit recovery before startup.',
  shell_repair_cleanup_unconfirmed: 'Shell code cleanup is unconfirmed. Inspect recovery before retrying.',

  node_repair_busy: 'Another operation is using the shared Node component. Wait for it to finish.',
  node_repair_changed: 'The shared Node component changed during the operation. Inspect its current state.',
  node_repair_unavailable: 'The managed Node component metadata could not be verified for recovery.',
  node_repair_recovery_required: 'An interrupted Node code repair needs explicit recovery before startup.',
  node_repair_cleanup_unconfirmed: 'Node component cleanup is unconfirmed. Inspect recovery before retrying.',
  unsupported_platform: 'Local QQ process management currently requires Windows.',
  invalid_account: 'Select an account discovered in the installed NapCat configuration.',
  missing_components: 'The installed NapCat or QQ component is incomplete. Check its installation.',
  qq_component_changed: 'The fixed QQ executable is missing or has changed. Restore the verified QQ installation before starting it.',
  selection_invalid: 'The saved QQ component selection could not be verified. Check the local version record before starting QQ.',
  invalid_installation: 'The component location is not a supported local installation.',
  desktop_running: 'Close NapCat Desktop before managing this account here. Its running QQ processes must also be stopped in their original manager.',
  external_process: 'This QQ account is already running outside Agent Arcade. Stop it in its original manager before starting it here.',
  external_qq_unknown: 'An existing QQ process from this component cannot be assigned safely. It will not be taken over.',
  runtime_locked: 'Another Agent Arcade instance owns this account, or its previous ownership needs inspection.',
  process_check_failed: 'Windows process ownership could not be verified. No process was changed.',
  ownership_lost: 'The running process no longer matches the process started by this app. It will not be stopped.',
  not_owned: 'This app does not own this account’s running process.',
  start_failed: 'The installed QQ runtime could not be started. Check component availability and Windows permissions.',
  start_unverified: 'A launcher was started but its identity could not be verified. Automatic control is disabled.',
  start_cancelled: 'QQ startup was cancelled before the launcher was started.',
  start_context_changed: 'The selected companion changed before QQ startup. Inspect its current state.',
  start_guard_invalid: 'QQ startup requires a synchronous current-context check.',
  stop_failed: 'Windows could not stop all verified account processes. Ownership is retained; inspect the runtime before retrying.',
  unsafe_lock: 'The shared runtime ownership directory is unavailable or unsafe.',
  operation_in_progress: 'An operation for this account is already in progress.',
  cleanup_unconfirmed: 'The process ownership guard could not be confirmed closed. Retry cleanup before continuing.',
  webui_unavailable: 'This account’s current WebUI address could not be verified. Wait for its runtime to become ready.',
  webui_config_not_local: 'The Node management configuration or listener is not verified as local-only. Existing settings were preserved; stopping and recovery remain available.',
  recovery_required: 'A previous app instance left ownership metadata. Inspect and explicitly recover this account before managing it.',
  owner_alive: 'The previous app instance is still running. It retains ownership of this account.',
  orphaned_children: 'The launcher exited but QQ descendants may still be running. Their ownership is incomplete; no process was taken over or stopped.',
  orphan_cleanup_changed: 'The verified residual processes changed. Inspect them again before confirming cleanup.',
  orphan_cleanup_unverified: 'The residual process identities or parent chain cannot be fully verified. Nothing was stopped.',
  orphan_cleanup_unavailable: 'Residual cleanup is unavailable. Use Recover management to inspect the current runtime.',
  orphan_cleanup_incomplete: 'Some residual processes could not be confirmed stopped. The ownership record was retained; inspect again before any restart.',
  manager_closing: 'The app is closing its owned QQ runtimes. Wait until shutdown finishes.',
  runtime_running: 'Stop this account before editing its local connection configuration.',
  deployment_recovery_required: 'An interrupted plugin file change needs review in Plugin files and installation before this QQ runtime can start.',
};
class QQRuntimeError extends Error {
  constructor(code) { super(MESSAGES[code] || 'The QQ runtime operation failed.'); this.name='QQRuntimeError'; this.code=code; }
}
const fail = code => { throw new QQRuntimeError(code); };
function checkStartGuard(assertion){
  if(assertion===undefined)return;if(typeof assertion!=='function')fail('start_guard_invalid');
  const value=assertion();if(value&&typeof value.then==='function'){if(value instanceof Promise)value.catch(()=>{});fail('start_guard_invalid');}
}
function startGuard(options){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['signal','assertCurrent'].includes(key)))fail('start_guard_invalid');
  const {signal,assertCurrent}=options;if(signal!==undefined&&(!signal||typeof signal.aborted!=='boolean'||typeof signal.addEventListener!=='function'))fail('start_guard_invalid');
  if(assertCurrent!==undefined&&typeof assertCurrent!=='function')fail('start_guard_invalid');
  return ()=>{if(signal?.aborted)fail('start_cancelled');try{checkStartGuard(assertCurrent);}catch(error){if(error instanceof QQRuntimeError&&error.code==='start_guard_invalid')throw error;fail('start_context_changed');}if(signal?.aborted)fail('start_cancelled');};
}
const samePath = (a,b) => typeof a==='string' && typeof b==='string' && path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const account = value => typeof value==='string' && /^[1-9]\d{4,11}$/.test(value);
function safeFile(file, max=2*1024*1024) {
  try { const st=fs.lstatSync(file); return st.isFile()&&!st.isSymbolicLink()&&st.size<=max; } catch { return false; }
}
function readSmall(file,max=32768) { if(!safeFile(file,max))return null;try{return fs.readFileSync(file,'utf8');}catch{return null;} }
function readObject(file,max=32768) { try { const v=JSON.parse(readSmall(file,max));return v&&typeof v==='object'&&!Array.isArray(v)?v:null; } catch{return null;} }
function boundedTail(file,bytes=MAX_LOG_BYTES) {
  let fd;
  try { const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())return '';fd=fs.openSync(file,'r');const size=fs.fstatSync(fd).size;const start=Math.max(0,size-bytes),buffer=Buffer.alloc(Math.min(size,bytes));fs.readSync(fd,buffer,0,buffer.length,start);const text=buffer.toString('utf8');return start?text.slice(text.indexOf('\n')+1):text; }
  catch{return '';}finally{if(fd!==undefined)fs.closeSync(fd);}
}
function identity(proc) { return proc&&{pid:proc.pid,createdAt:proc.createdAt,executable:proc.executable}; }
function matches(proc,proof) { return !!proc&&!!proof&&proc.pid===proof.pid&&proc.createdAt===proof.createdAt&&samePath(proc.executable,proof.executable); }
function stopTraceRows(rows){return rows.slice(0,128).map(row=>({pid:row.pid,...(Number.isSafeInteger(row.parentPid)?{parentPid:row.parentPid}:{}),createdAt:row.createdAt,executablePathSha256:createHash('sha256').update(String(row.executable||'').toLowerCase()).digest('hex')}));}
function validProof(proof){return !!proof&&Number.isSafeInteger(proof.pid)&&proof.pid>0&&typeof proof.createdAt==='string'&&Number.isFinite(Date.parse(proof.createdAt))&&typeof proof.executable==='string'&&path.isAbsolute(proof.executable);}
function validProcesses(rows) {
  if(!Array.isArray(rows)||rows.length>4096)fail('process_check_failed');
  return rows.map(p=>{if(!p||!Number.isSafeInteger(p.pid)||p.pid<1||!Number.isSafeInteger(p.parentPid)||typeof p.createdAt!=='string'||(p.createdAt&&!Number.isFinite(Date.parse(p.createdAt)))||typeof p.name!=='string'||typeof p.executable!=='string')fail('process_check_failed');return {...p,accountId:account(p.accountId)?p.accountId:null};});
}
function descendants(rows,proof) {
  if(!proof)fail('ownership_lost');
  const root=rows.find(p=>p.pid===proof.pid);if(!matches(root,proof))fail('ownership_lost');
  const found=[root],ids=new Set([root.pid]);let changed=true;
  while(changed){changed=false;for(const p of rows){if(!ids.has(p.pid)&&ids.has(p.parentPid)){const parent=found.find(v=>v.pid===p.parentPid);if(!validProof(identity(p)))fail('ownership_lost');if(Date.parse(p.createdAt)<Date.parse(parent.createdAt))continue;ids.add(p.pid);found.push(p);changed=true;if(found.length>64)fail('process_check_failed');}}}
  return found;
}
function possibleDescendantIds(rows,proofs){
  const parents=new Map(proofs.map(proof=>[proof.pid,proof])),ids=new Set(parents.keys());let changed=true;
  // ParentProcessId can identify a later process that reused an exited PID.
  // Exclude only a fully identified row definitely older than its recorded
  // parent. Missing metadata and all possible late descendants remain blocking.
  // https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process
  while(changed){changed=false;for(const row of rows)if(ids.has(row.parentPid)&&!ids.has(row.pid)){
    const parent=parents.get(row.parentPid),child=identity(row);
    if(validProof(parent)&&validProof(child)&&Date.parse(child.createdAt)<Date.parse(parent.createdAt))continue;
    ids.add(row.pid);parents.set(row.pid,child);changed=true;
  }}
  return ids;
}
function classifyLogLine(line) {
  if(typeof line!=='string'||line.length>8192||/\[(?:收|发)\]|(?:receive|send)[ _-]?(?:private|group)?[ _-]?message/i.test(line))return null;
  let type;
  if(/KickedOffLine/.test(line)&&/账号当前登录已失效/.test(line))type='session_expired';
  else if(/KickedOffLine/.test(line))type='account_kicked';
  else if(/(?:restartWorker|worker.{0,30}restart|重启.{0,20}worker|worker.{0,20}重启)/i.test(line))type='worker_restart';
  else if(/(?:二维码已过期|QR.?code.{0,20}expired)/i.test(line))type='qr_expired';
  else if(/(?:请.{0,8}扫码|请重新登录|二维码登录)/.test(line))type='login_required';
  else if(/(?:NapCat.{0,20}(?:Version|版本))/.test(line))type='runtime_started';
  else if(/(?:WebSocket.{0,30}(?:监听|listening)|WebSocket.*server.*started)/i.test(line))type='bridge_listening';
  if(!type)return null;
  const stamp=line.match(/(?:\d{4}[-/])?\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,7})?/);
  return {type,time:stamp?.[0]||null};
}
function privateEndpoint(line){
  if(typeof line!=='string'||line.length>8192||/\[(?:收|发)\]/.test(line))return null;
  const match=line.match(/\[WebUi\]\s+WebUi User Panel Url:\s*(https?:\/\/[^\s\x1b]+)/i);if(!match)return null;
  try{const url=new URL(match[1]);const token=url.searchParams.get('token'),port=Number(url.port|| (url.protocol==='https:'?443:80));
    if(!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/webui'||!Number.isInteger(port)||port<1||port>65535||typeof token!=='string'||token.length<1||token.length>256||/[\x00-\x20\x7f]/.test(token))return null;
    return {baseUrl:`${url.protocol}//127.0.0.1:${port}`,port,token};
  }catch{return null;}
}
function availableLoopbackPort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(new QQRuntimeError('start_failed')));server.listen({host:'127.0.0.1',port:0,exclusive:true},()=>{const port=server.address().port;server.close(error=>error?reject(new QQRuntimeError('start_failed')):resolve(port));});});}

function powershell(script,{timeout=15000,maxBuffer=2*1024*1024}={}) {
  const exe=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  return new Promise((resolve,reject)=>execFile(exe,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout,maxBuffer},(error,stdout)=>{if(error)return reject(new QQRuntimeError('process_check_failed'));try{resolve(JSON.parse(stdout.replace(/^\uFEFF/,'')));}catch{reject(new QQRuntimeError('process_check_failed'));}}));
}
function nodeObservationRequest(value){
  const pid=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['roots','retainedPids'].includes(k))||!Array.isArray(value.roots)||!value.roots.length||value.roots.length>32||!Array.isArray(value.retainedPids)||value.retainedPids.length>2048||[value.roots,value.retainedPids].some(rows=>rows.some(n=>!pid(n))||new Set(rows).size!==rows.length))fail('process_check_failed');
  return {roots:[...value.roots],retainedPids:[...value.retainedPids]};
}
function nodeObservationPids(request,before,after){
  const ids=new Set([...request.roots,...request.retainedPids]),descendants=new Set(request.roots);let changed=true;
  while(changed){changed=false;for(const row of [...before,...after])if(descendants.has(row.parentPid)&&!descendants.has(row.pid)){descendants.add(row.pid);changed=true;if(descendants.size>2048)fail('process_check_failed');}}
  for(const pid of descendants)ids.add(pid);if(ids.size>2048)fail('process_check_failed');return [...ids];
}
function validNodeObservation(value,options){
  const request=nodeObservationRequest(options);
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!=='after|before|inspected|listeners')fail('process_check_failed');
  const result={};for(const key of ['before','after','inspected']){result[key]=validProcesses(value[key]);if(new Set(result[key].map(p=>p.pid)).size!==result[key].length)fail('process_check_failed');}
  const expected=new Set(nodeObservationPids(request,result.before,result.after));if(result.inspected.length>2048||result.inspected.some(row=>!expected.has(row.pid)))fail('process_check_failed');
  if(!Array.isArray(value.listeners)||value.listeners.length>4096||value.listeners.some(row=>!row||!Number.isSafeInteger(row.pid)||row.pid<1||!Number.isInteger(row.port)||row.port<1||row.port>65535||typeof row.address!=='string'||row.address.length>128))fail('process_check_failed');
  result.listeners=value.listeners.map(({pid,port,address})=>({pid,port,address}));return result;
}
function nodeObservationScript(options){
  const encoded=Buffer.from(JSON.stringify(nodeObservationRequest(options))).toString('base64');
  // Collection only: parent links select candidate PIDs, never authorize them.
  // JS still validates each account's exact root/tree/listener independently.
  return `$ErrorActionPreference='Stop'
$request=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))
function Read-Processes($filter) {
  $rows=@(Get-CimInstance Win32_Process @filter | Where-Object {$_.ProcessId -gt 0} | ForEach-Object {
    $created=if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{''}
    [pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;name=$_.Name;executable=[string]$_.ExecutablePath;createdAt=$created;accountId=$null}
  });if($rows.Count -gt 4096){throw 'observation bounds'};return ,$rows
}
$before=Read-Processes @{};$after=Read-Processes @{}
$descendants=New-Object 'System.Collections.Generic.HashSet[int]';$ids=New-Object 'System.Collections.Generic.HashSet[int]'
foreach($id in $request.roots){$null=$descendants.Add([int]$id);$null=$ids.Add([int]$id)}
foreach($id in $request.retainedPids){$null=$ids.Add([int]$id)}
$changed=$true;while($changed){$changed=$false;foreach($row in @($before)+@($after)){if($descendants.Contains([int]$row.parentPid) -and $descendants.Add([int]$row.pid)){$changed=$true;if($descendants.Count -gt 2048){throw 'observation bounds'}}}}
foreach($id in $descendants){$null=$ids.Add($id)};if($ids.Count -gt 2048){throw 'observation bounds'}
$list=@($ids);$exact=New-Object 'System.Collections.Generic.List[object]'
for($offset=0;$offset -lt $list.Count;$offset+=128){$last=[Math]::Min($offset+127,$list.Count-1);$filter=(@($list[$offset..$last] | ForEach-Object {'ProcessId='+[string]$_}) -join ' OR ');foreach($row in (Read-Processes @{Filter=$filter})){$exact.Add($row)}}
$listeners=@(Get-NetTCPConnection -State Listen | Where-Object {$_.LocalAddress -in @('127.0.0.1','::1','0.0.0.0','::')} | ForEach-Object {[pscustomobject]@{pid=[int]$_.OwningProcess;port=[int]$_.LocalPort;address=$_.LocalAddress}})
if($listeners.Count -gt 4096){throw 'observation bounds'}
ConvertTo-Json -InputObject @{before=$before;after=$after;inspected=$exact.ToArray();listeners=$listeners} -Depth 4 -Compress`;
}
function createWindowsProcessHost() {
  const readProcesses=filter=>powershell(`$ErrorActionPreference='Stop';$rows=@(Get-CimInstance Win32_Process ${filter?`-Filter "${filter}"`:''} | Where-Object {$_.ProcessId -gt 0} | ForEach-Object {$aid=$null;if($_.Name -eq 'NapCatWinBootMain.exe' -and $_.CommandLine -match '(?:^|\\s)"?([1-9]\\d{4,11})"?\\s*$'){$aid=$Matches[1]};$created=if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{''};[pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;name=$_.Name;executable=[string]$_.ExecutablePath;createdAt=$created;accountId=$aid}});ConvertTo-Json -InputObject $rows -Depth 3 -Compress`);
  return {
    allocatePort:availableLoopbackPort,
    async listeners(){return powershell(`$ErrorActionPreference='Stop';$rows=@(Get-NetTCPConnection -State Listen | Where-Object {$_.LocalAddress -in @('127.0.0.1','::1','0.0.0.0','::')} | ForEach-Object {[pscustomobject]@{pid=[int]$_.OwningProcess;port=[int]$_.LocalPort;address=$_.LocalAddress}});ConvertTo-Json -InputObject $rows -Depth 3 -Compress`);},
    async observeNode(options){const request=nodeObservationRequest(options);return validNodeObservation(await powershell(nodeObservationScript(request),{maxBuffer:8*1024*1024}),request);},
    // Full process metadata includes former managers and all descendants. No
    // unrelated command lines are returned; account arguments are parsed inside PS.
    async snapshot(){return readProcesses('');},
    async inspect(pids){if(!Array.isArray(pids)||!pids.length||pids.length>128||pids.some(pid=>!Number.isSafeInteger(pid)||pid<1))fail('process_check_failed');return readProcesses([...new Set(pids)].map(pid=>`ProcessId=${pid}`).join(' OR '));},
    async start(plan){
      return new Promise((resolve,reject)=>{
        checkStartGuard(plan.beforeSpawn);
        const child=spawn(plan.file,plan.args,{cwd:plan.cwd,env:plan.env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
        let pending='';
        const data=chunk=>{pending+=chunk.toString('utf8');if(pending.length>16384)pending=pending.slice(-8192);let index;while((index=pending.indexOf('\n'))>=0){const line=pending.slice(0,index);pending=pending.slice(index+1);plan.onOutput?.(line);}};
        child.stdout.on('data',data);child.stderr.on('data',data);child.once('error',()=>reject(new QQRuntimeError('start_failed')));
        child.once('spawn',()=>resolve({pid:child.pid}));child.once('exit',()=>plan.onExit?.());
      });
    },
    async stop(proofs,{onTrace}={}){
      // Open and retain each exact process handle before changing any process.
      // A recycled PID or inaccessible identity aborts the whole operation.
      // The checked tree is parent-first. Stop its supervisor before workers:
      // killing workers first lets QQ spawn replacements during shutdown.
      const encoded=Buffer.from(JSON.stringify(proofs)).toString('base64');
      // WMI/CIM timestamps have microsecond precision; Get-Process retains
      // 100ns ticks. Normalize exactly to CIM precision, not a time tolerance.
      const tracing=typeof onTrace==='function',emit=value=>{if(tracing)try{onTrace(value);}catch{/* Diagnostics do not participate in termination. */}};
      const script=`$ErrorActionPreference='Stop';$proofs=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')));$opened=New-Object System.Collections.Generic.List[System.Diagnostics.Process];${tracing?"$events=New-Object System.Collections.Generic.List[object];$success=$false;":''}try{foreach($proof in $proofs){$p=Get-Process -Id $proof.pid -ErrorAction SilentlyContinue;if(!$p){continue};$null=$p.Handle;$ticks=$p.StartTime.ToUniversalTime().Ticks;$microTicks=$ticks-($ticks%10);if($microTicks -ne ([DateTimeOffset]::Parse($proof.createdAt)).UtcDateTime.Ticks -or ![string]::Equals($p.MainModule.FileName,$proof.executable,[StringComparison]::OrdinalIgnoreCase)){throw 'identity mismatch'};$opened.Add($p)${tracing?";$events.Add([pscustomobject]@{step='opened';pid=$p.Id;hostAt=[DateTime]::UtcNow.ToString('o')})":''}};for($i=0;$i -lt $opened.Count;$i++){if(!$opened[$i].HasExited){${tracing?"$events.Add([pscustomobject]@{step='terminate';pid=$opened[$i].Id;hostAt=[DateTime]::UtcNow.ToString('o')});":''}$opened[$i].Kill();if(!$opened[$i].WaitForExit(5000) -or !$opened[$i].HasExited){throw 'process still running'}${tracing?";$events.Add([pscustomobject]@{step='wait_complete';pid=$opened[$i].Id;exited=$opened[$i].HasExited;hostAt=[DateTime]::UtcNow.ToString('o')})":''}}};${tracing?"$success=$true":"'{\"stopped\":true}'"}}${tracing?"catch{$events.Add([pscustomobject]@{step='failed';hostAt=[DateTime]::UtcNow.ToString('o')})}":''}finally{foreach($p in $opened){$p.Dispose()}}${tracing?';ConvertTo-Json -InputObject ([pscustomobject]@{stopped=$success;trace=$events.ToArray()}) -Depth 4 -Compress':''}`;
      try{const result=await powershell(script,{timeout:20000});if(tracing){for(const row of Array.isArray(result?.trace)?result.trace.slice(0,192):[])emit(row);if(result?.stopped!==true)fail('stop_failed');return{stopped:true};}return result;}catch{emit({step:'failed'});fail('stop_failed');}
    },
  };
}

class QQRuntimeManager {
  constructor({root,desktopDataRoot,componentsRoot,lockRoot,platform=process.platform,processHost,vault,profileRoot,componentStoreRoot,componentSelectionFactory,managedInstallation,managedNodeInstallation,onChange=()=>{},onStopTrace,traceHostStop=false}={}) {
    if(managedNodeInstallation){if(managedInstallation)fail('invalid_installation');const {QQNodeRuntimeManager}=require('./qq-node-runtime.cjs');return new QQNodeRuntimeManager({root,desktopDataRoot,componentsRoot,lockRoot,platform,processHost,vault,profileRoot,componentStoreRoot,componentSelectionFactory,managedNodeInstallation,onChange,onStopTrace,traceHostStop});}
    if(typeof root!=='string'||!path.isAbsolute(root))fail('invalid_installation');
    this.root=path.resolve(root);this.desktopDataRoot=path.resolve(desktopDataRoot||path.join(process.env.ProgramData||'C:\\ProgramData','NapCatQQ Desktop'));
    this.managed=managedInstallation?new QQManagedLayout({read:managedInstallation}):null;
    this.componentsRoot=this.managed?this.managed.read().installationRoot:path.resolve(componentsRoot||path.join(this.desktopDataRoot,'components'));
    if(this.managed&&componentsRoot&&!samePath(componentsRoot,this.componentsRoot))fail('invalid_installation');
    this.lockRoot=path.resolve(lockRoot||path.join(process.env.LOCALAPPDATA||os.homedir(),'AgentArcade','qq-runtime-locks'));
    this.platform=platform;this.host=processHost||createWindowsProcessHost();this.onChange=onChange;this.runs=new Map();this.pending=new Set();this.operations=new Map();this.events=new Map();this.endpoints=new Map();this.id=randomUUID();this.closing=false;
    this.componentStoreRoot=path.resolve(componentStoreRoot||path.join(path.dirname(this.lockRoot),'qq-components'));this.componentSelectionFactory=componentSelectionFactory;this._componentSelection=null;
    this.vault=vault;this.profileRoot=profileRoot;this.endpointIssues=new Map();this.outputOwners=new Map();
    this.onStopTrace=typeof onStopTrace==='function'?onStopTrace:null;this.traceHostStop=traceHostStop===true;this.stopTraceContexts=new Map();
  }
  _endpointStore(){return new QQRuntimeEndpointStore({root:this.root,profileRoot:this.profileRoot,componentsRoot:this.componentsRoot,...(this.managed?{installationId:this.managed.read().installationId}:{}),vault:this.vault});}
  _endpointIssue(accountId){this.endpointIssues.set(accountId,'endpoint_recovery_unavailable');}
  _changed(){try{this.onChange();}catch{/* UI observers cannot change lifecycle outcomes. */}}
  _begin(accountId,notify=true,kind='lifecycle',predecessor=null){
    if(this.pending.has(accountId)&&(!predecessor||predecessor!==this.operations.get(accountId)||predecessor.kind!=='reconcile'||kind!=='stop'))fail('operation_in_progress');
    this.pending.add(accountId);let resolve;const promise=new Promise(r=>{resolve=r;}),operation={kind,promise,resolve};this.operations.set(accountId,operation);if(notify)this._changed();return operation;
  }
  _end(accountId,notify=true,operation=this.operations.get(accountId)){
    // A completed read must not release an explicit stop reserved behind it.
    if(this.operations.get(accountId)===operation){this.pending.delete(accountId);this.operations.delete(accountId);}operation?.resolve();if(notify)this._changed();
  }
  _legacyInstallation(){
    const runtimeDir=path.join(this.componentsRoot,'NapCatQQ'),configDir=path.join(runtimeDir,'config');
    let pin,componentIssue;
    try{pin=require('./qq-component-selection.cjs').readLegacyQQPin(this.componentsRoot,this.lockRoot);}catch(error){componentIssue=error.code||'selection_invalid';}
    const version=pin?.version||(componentIssue?'':(readSmall(path.join(this.componentsRoot,'QQ','current.txt'),256)||'').trim());
    const qqVersion=/^\d+\.\d+\.\d+(?:[-.]\d+)?$/.test(version)?version:null;
    const candidates=componentIssue?[]:pin?[pin.file]:[qqVersion&&path.join(this.componentsRoot,'QQ','versions',qqVersion,'QQ.exe'),path.join(this.componentsRoot,'QQ','QQ.exe')].filter(Boolean);
    const qqExe=candidates.find(p=>safeFile(p,512*1024*1024))||null;
    if(pin&&!qqExe)componentIssue='qq_component_changed';
    const launcher=path.join(runtimeDir,'NapCatWinBootMain.exe'),hook=path.join(runtimeDir,'NapCatWinBootHook.dll'),core=path.join(runtimeDir,'napcat.mjs'),patch=path.join(runtimeDir,'qqnt.json');
    const available=!!qqExe&&[launcher,hook,core,patch].every(p=>safeFile(p,512*1024*1024));
    let accounts=[];try{if(!fs.lstatSync(configDir).isSymbolicLink())accounts=fs.readdirSync(configDir).map(n=>/^onebot11_([1-9]\d{4,11})\.json$/.exec(n)?.[1]).filter(Boolean).filter(id=>safeFile(path.join(configDir,`onebot11_${id}.json`))).sort().slice(0,MAX_ACCOUNTS);}catch{/* Missing installation is a normal discovery state. */}
    // The bundle package.json is often 0.0.1, not the NapCat release version.
    // Only report an observed explicit release marker, never infer it from that field.
    let napcatVersion=null;
    for(const id of accounts){const text=boundedTail(path.join(this.desktopDataRoot,'logs','bots','bots',`${id}.log`));const found=[...text.matchAll(/NapCat(?:\.Core)?\s+(?:Version|版本)\s*[:：]?\s*v?(\d+\.\d+\.\d+)/gi)];if(found.length)napcatVersion=found.at(-1)[1];}
    return {runtimeDir,configDir,qqExe,launcher,hook,core,patch,available,qqVersion,napcatVersion,accounts,...(pin?{legacyQQPin:pin}:{}),...(componentIssue?{componentIssue}:{})};
  }
  _managedInstallation(){
    const managed=this.managed.read(),runtimeDir=managed.workDir,configDir=managed.configDir;
    const names=fs.readdirSync(configDir);if(names.length>4096)fail('invalid_installation');
    const accounts=names.map(name=>/^onebot11_([1-9]\d{4,11})\.json$/.exec(name)?.[1]).filter(Boolean).filter(id=>safeFile(path.join(configDir,`onebot11_${id}.json`))).sort().slice(0,MAX_ACCOUNTS);
    return {runtimeDir,workDir:managed.workDir,configDir,qqDataDir:managed.qqDataDir,installationKind:'managed-shell',qqExe:managed.qq.file,qqVersion:managed.qq.version,qqVersionSource:'verified-setup-metadata',napcatVersion:null,accounts,available:false};
  }
  componentSelection(){
    if(this._componentSelection)return this._componentSelection;
    const install=this.managed?this._managedInstallation():this._legacyInstallation();if(!install.qqExe)fail('missing_components');
    const options={componentsRoot:this.componentsRoot,lockRoot:this.lockRoot,preparedRoot:path.join(this.componentStoreRoot,'qq-component-versions','napcat-shell'),processHost:this.host,qqExe:install.qqExe,installedVersion:install.napcatVersion,...(this.managed?{managedInstallation:()=>this.managed.read()}: {})};
    if(this.componentSelectionFactory)this._componentSelection=this.componentSelectionFactory({...options,root:this.componentStoreRoot});
    else{
      const {QQComponentSelection}=require('./qq-component-selection.cjs');
      const {QQComponentPackages}=require('./qq-component-package.cjs');
      const {QQComponentPrepared}=require('./qq-component-prepared.cjs');
      const packages=new QQComponentPackages({root:this.componentStoreRoot});
      this._componentSelection=new QQComponentSelection({...options,prepared:new QQComponentPrepared({root:this.componentStoreRoot,packages,lockRoot:this.lockRoot})});
    }
    return this._componentSelection;
  }
  _installation(){
    let original;try{original=this.managed?this._managedInstallation():this._legacyInstallation();}catch(error){return {runtimeDir:null,workDir:null,configDir:null,qqExe:null,accounts:[],available:false,installationKind:'managed-shell',componentIssue:error.code||'invalid_installation'};}if(!this.managed&&!original.available)return {...original,workDir:original.runtimeDir};
    try{
      const selected=this.componentSelection().layout(),runtimeDir=selected.codeRoot,workDir=selected.workDir;
      const launcher=path.join(runtimeDir,'NapCatWinBootMain.exe'),hook=path.join(runtimeDir,'NapCatWinBootHook.dll'),core=path.join(runtimeDir,'napcat.mjs'),patch=path.join(runtimeDir,'qqnt.json');
      return {...original,runtimeDir,workDir,configDir:path.join(workDir,'config'),launcher,hook,core,patch,available:[launcher,hook,core,patch].every(p=>safeFile(p,512*1024*1024)),selectedNapcatVersion:selected.kind==='prepared'?selected.version:null,componentSelectionKind:selected.kind};
    }catch(error){return {...original,workDir:original.runtimeDir,available:false,componentIssue:typeof error?.code==='string'&&/^[a-z_]{1,48}$/.test(error.code)?error.code:'component_unavailable'};}
  }
  instance(accountId){
    if(!account(accountId))fail('invalid_account');const install=this._installation();if(!install.accounts.includes(accountId))fail('invalid_account');
    return {...install,accountId,onebotConfigPath:path.join(install.configDir,`onebot11_${accountId}.json`),webuiConfigPath:path.join(install.configDir,'webui.json'),logPath:this.managed?null:path.join(this.desktopDataRoot,'logs','bots','bots',`${accountId}.log`)};
  }
  _stopTrace(context,kind,details={}){if(context&&this.onStopTrace)try{this.onStopTrace({kind,phase:context.phase,operationId:context.id,...details});}catch{/* Debug output cannot change a lifecycle result. */}}
  _stopObservation(kind,rows,origin,requestedPids){try{for(const context of this.stopTraceContexts.values()){
    const ids=new Set((context.proofs||[]).map(p=>p.pid));let changed=true;while(changed){changed=false;for(const row of rows)if(ids.has(row.parentPid)&&!ids.has(row.pid)){ids.add(row.pid);changed=true;}}
    const selected=rows.filter(row=>ids.has(row.pid)||requestedPids?.includes(row.pid)||context.qqExe&&samePath(row.executable,context.qqExe)||context.launcher&&samePath(row.executable,context.launcher));
    this._stopTrace(context,kind,{origin,observedCount:rows.length,selectedCount:selected.length,truncated:selected.length>128,processes:stopTraceRows(selected),...(requestedPids?{requestedPids:requestedPids.slice(0,128)}:{})});
  }}catch{/* Projection failure must not turn a process check into a failure. */}}
  async _processes(origin='background'){try{const rows=validProcesses(await this.host.snapshot());this._stopObservation('snapshot',rows,origin);return rows;}catch(error){for(const context of this.stopTraceContexts.values())this._stopTrace(context,'snapshot',{origin,code:'process_check_failed'});if(error instanceof QQRuntimeError)throw error;fail('process_check_failed');}}
  async _inspect(pids,origin='background'){try{if(typeof this.host.inspect!=='function')fail('process_check_failed');const rows=validProcesses(await this.host.inspect([...new Set(pids)]));if(rows.some(p=>!pids.includes(p.pid)))fail('process_check_failed');this._stopObservation('inspect',rows,origin,pids);return rows;}catch(error){for(const context of this.stopTraceContexts.values())this._stopTrace(context,'inspect',{origin,code:'process_check_failed',requestedPids:pids.slice(0,128)});if(error instanceof QQRuntimeError)throw error;fail('process_check_failed');}}
  _shellProof(){return this.shellOwnerProof||(this.shellOwnerProof=new ShellOwner.QQShellOwnerProof());}
  _validLease(value,accountId){if(isShellLease(value)){try{ShellOwner.validateLease(value,accountId);return true;}catch{return false;}}return !!value&&value.version===1&&typeof value.instance==='string'&&typeof value.token==='string'&&validProof(value.manager)&&(!value.accountId||value.accountId===accountId)&&(!value.runtime||validProof(value.runtime))&&(!value.runtimeTree||Array.isArray(value.runtimeTree)&&value.runtimeTree.length<=64&&value.runtimeTree.every(validProof));}
  _tree(rows,proof,install,lease){
    if(!samePath(proof?.executable,install.launcher))fail('ownership_lost');
    const tree=descendants(rows,proof),consoleHost=path.join(process.env.SystemRoot||'C:\\Windows','System32','conhost.exe');
    // Windows may create a console host directly for the verified launcher.
    // A matching name elsewhere, or a host parented by QQ, is not owned here.
    const isLauncherConsole=p=>p.parentPid===proof.pid&&p.name.toLowerCase()==='conhost.exe'&&samePath(p.executable,consoleHost);
    if(lease?.binding?.qce&&tree.filter(p=>samePath(p.executable,QCE.binaryPath(install))).length>1)fail('ownership_lost');
    if(tree.some(p=>!validProof(identity(p))||(!samePath(p.executable,install.launcher)&&!samePath(p.executable,install.qqExe)&&!isLauncherConsole(p)&&!QCE.isChild(p,tree,lease,install))))fail('ownership_lost');
    return tree;
  }
  _rememberTree(run,tree){const proofs=tree.map(isShellLease(run.lease)?ShellOwner.treeIdentity:identity).sort((a,b)=>a.pid-b.pid);if(JSON.stringify(run.lease.runtimeTree||[])!==JSON.stringify(proofs)){run.lease.runtimeTree=proofs;this._writeLease(run.lease);}}
  async _checkedTree(lease,install,rows,origin='background'){
    const tree=this._tree(rows,lease.runtime,install,lease),recorded=[lease.runtime,...(lease.runtimeTree||[])];
    const checked=await this._inspect(recorded.map(p=>p.pid),origin);
    for(const proof of recorded){const current=checked.find(p=>p.pid===proof.pid);if(!current)continue;if(!matches(current,proof)||isShellLease(lease)&&current.parentPid!==proof.parentPid)fail('ownership_lost');if(!tree.some(p=>matches(p,proof)))fail('orphaned_children');}
    if(!checked.some(p=>matches(p,lease.runtime)))fail('ownership_lost');
    return tree;
  }
  async _treeDead(lease,install,rows,origin='background',allowReusedForeignProcess=false){
    if(!validProof(lease.runtime))fail('ownership_lost');
    const proofs=[lease.runtime,...(lease.runtimeTree||[])];const checked=await this._inspect(proofs.map(p=>p.pid),origin);
    const replacements=[];
    for(const proof of proofs){const current=checked.find(p=>p.pid===proof.pid);if(current){if(!matches(current,proof)){
      // Explicit dead-launcher recovery may clear metadata after Windows reuses
      // an old child's PID for a different, later executable. No process is
      // stopped. Only a leaf or its one precisely identified system console is
      // excluded; unknown descendants and same-program/root PID reuse still block.
      const observed=rows.find(row=>row.pid===current.pid);
      if(allowReusedForeignProcess&&proof.pid!==lease.runtime.pid&&validProof(identity(current))&&
          Date.parse(current.createdAt)>Date.parse(proof.createdAt)&&!samePath(current.executable,proof.executable)&&
          !samePath(current.executable,install.launcher)&&!samePath(current.executable,install.qqExe)&&
          matches(observed,identity(current))&&observed.parentPid===current.parentPid){
        const children=rows.filter(row=>row.parentPid===current.pid),console=children[0];
        const isConsole=children.length===1&&validProof(identity(console))&&console.name.toLowerCase()==='conhost.exe'&&
          samePath(console.executable,path.join(process.env.SystemRoot||'C:\\Windows','System32','conhost.exe'))&&
          Date.parse(console.createdAt)>Date.parse(current.createdAt)&&!rows.some(row=>row.parentPid===console.pid);
        if(!children.length){replacements.push(identity(current));continue;}
        if(isConsole){
          const fresh=await this._inspect([current.pid,console.pid],'recovery-foreign-console');
          if([current,console].every(expected=>{const actual=fresh.find(row=>row.pid===expected.pid);return matches(actual,identity(expected))&&actual.parentPid===expected.parentPid;})){
            replacements.push(identity(current),identity(console));continue;
          }
        }
      }
      fail('ownership_lost');
    }if(proof.pid===lease.runtime.pid)return false;fail('orphaned_children');}}
    // A missing parent is not permission to kill/forget surviving grandchildren.
    // Windows preserves parent IDs after exit, including unobserved late children.
    const remaining=rows.filter(row=>!replacements.some(proof=>matches(row,proof)));
    const ids=possibleDescendantIds(remaining,proofs);
    if(remaining.some(p=>ids.has(p.pid)))fail('orphaned_children');
    if(this._external(remaining,install,lease.accountId||install.accountId))fail('orphaned_children');
    return true;
  }
  async _confirmStopped(lease,install){
    const rows=await this._processes('stop-confirm');
    try{return await this._treeDead(lease,install,rows,'stop-final-lookup');}
    catch(error){
      if(error.code!=='orphaned_children')throw error;
      // CIM can include a just-exited process while the later exact PID lookup
      // is already empty. Reobserve once, only for recorded identities. Never
      // retry termination or discard an unknown descendant seen in that frame.
      const proofs=[lease.runtime,...(lease.runtimeTree||[])],ids=possibleDescendantIds(rows,proofs);
      if(rows.some(row=>ids.has(row.pid)&&!proofs.some(p=>matches(row,p)))||this._external(rows.filter(row=>!ids.has(row.pid)),install,lease.accountId||install.accountId))throw error;
      const checked=await this._inspect([...ids],'stop-retry-lookup');
      if(checked.some(row=>!proofs.some(p=>matches(row,p))))fail('ownership_lost');
      if(checked.length)throw error;
      return this._treeDead(lease,install,await this._processes('stop-confirm-recheck'),'stop-final-lookup');
    }
  }
  async _reconcile(accountId,install,rows){
    const run=this.runs.get(accountId);if(!run)return false;if(!run.proof)fail('ownership_lost');
    const current=rows.find(p=>p.pid===run.proof.pid);
    if(current){if(!matches(current,run.proof))fail('ownership_lost');this._rememberTree(run,await this._checkedTree(run.lease,install,rows));run.reason=null;return false;}
    if(!await this._treeDead(run.lease,install,rows))fail('process_check_failed');
    this._release(run.lease);this.runs.delete(accountId);this.endpoints.delete(accountId);this.outputOwners.delete(accountId);this.endpointIssues.delete(accountId);this._event(accountId,{type:'runtime_exited',time:new Date().toISOString()});return true;
  }
  async getConnections(accountIds){
    // Main-process-only secret results. A shared observation still verifies each
    // account independently; global webui.json is never an account-port lookup.
    if(!Array.isArray(accountIds)||accountIds.length>MAX_ACCOUNTS)fail('invalid_account');
    const installs=new Map([...new Set(accountIds)].map(id=>[id,this.instance(id)])),result=new Map();if(!installs.size)return result;
    const error=stage=>({error:{code:'webui_unavailable',message:MESSAGES.webui_unavailable,stage}});
    let rows,listeners,after,afterListeners,stage='observation-first';
    try{
      const observed=await Promise.allSettled([this._processes(),this.host.listeners()]);
      if(observed.some(v=>v.status!=='fulfilled'))fail('webui_unavailable');rows=observed[0].value;listeners=observed[1].value;
      stage='observation-second';const verified=await Promise.allSettled([this._processes(),this.host.listeners()]);
      if(verified.some(v=>v.status!=='fulfilled'))fail('webui_unavailable');after=verified[0].value;afterListeners=verified[1].value;
      stage='observation-shape';if([listeners,afterListeners].some(value=>!Array.isArray(value)||value.length>4096))fail('webui_unavailable');
    }catch{for(const id of installs.keys())result.set(id,error(stage));return result;}
    for(const [accountId,install]of installs){
      try{
        stage='launcher';
        const launchers=rows.filter(p=>p.name.toLowerCase()==='napcatwinbootmain.exe'&&samePath(p.executable,install.launcher)&&p.accountId===accountId);
        if(launchers.length!==1)fail('webui_unavailable');const launcher=launchers[0];
        const run=this.runs.get(accountId);let owned=false;
        if(run){
          stage='lease';const lease=readObject(run.lease.file,ShellOwner.MAX_LEASE);
          if(!matches(launcher,run.proof)||lease?.token!==run.lease.token||lease?.instance!==this.id)fail('webui_unavailable');
          stage='owned-tree';const beforeTree=this._tree(rows,run.proof,install,run.lease),afterTree=this._tree(after,run.proof,install,run.lease);
          stage='tree-stability';
          if(beforeTree.length!==afterTree.length||beforeTree.some(p=>!afterTree.some(q=>matches(q,identity(p))&&p.parentPid===q.parentPid)))fail('webui_unavailable');
          stage='retained-tree';for(const proof of run.lease.runtimeTree||[]){const live=after.find(p=>p.pid===proof.pid);if(live&&(!matches(live,proof)||!afterTree.some(p=>matches(p,proof))))fail('webui_unavailable');}
          owned=true;
        }
        stage='endpoint';let endpoint=this.endpoints.get(accountId),source='owned-runtime-output',saved;
        if(!endpoint&&owned&&this.vault){
          try{saved=this._endpointStore().load(accountId,run.proof);endpoint=saved.endpoint;source='encrypted-runtime-record';}
          catch{this._endpointIssue(accountId);}
        }
        // An adopted Arcade runtime must not reuse an unrelated old Desktop URL.
        if(!endpoint&&!owned&&!this.managed){const lines=boundedTail(install.logPath).split(/\r?\n/);for(let i=lines.length-1;i>=0;i--){endpoint=privateEndpoint(lines[i]);if(endpoint)break;}source='account-runtime-log';}
        if(!endpoint)fail('webui_unavailable');
        stage='listener';const tree=descendants(rows,identity(launcher)),ids=new Set(tree.filter(p=>samePath(p.executable,install.qqExe)||samePath(p.executable,install.launcher)).map(p=>p.pid));
        const bound=listeners.filter(p=>Number.isInteger(p.pid)&&ids.has(p.pid)&&p.port===endpoint.port&&['127.0.0.1','::1','0.0.0.0','::'].includes(p.address));
        if(bound.length!==1)fail('webui_unavailable');const listener=bound[0],proof=identity(rows.find(p=>p.pid===listener.pid));
        stage='identity-recheck';const current=after.find(p=>p.pid===launcher.pid);if(!matches(current,identity(launcher))||current.accountId!==accountId||!matches(after.find(p=>p.pid===listener.pid),proof))fail('webui_unavailable');
        stage='listener-recheck';
        const rebound=afterListeners.filter(p=>ids.has(p.pid)&&p.port===endpoint.port&&['127.0.0.1','::1','0.0.0.0','::'].includes(p.address));
        if(rebound.length!==1||rebound[0].pid!==listener.pid||rebound[0].address!==listener.address||(saved&&!matches(proof,saved.listener)))fail('webui_unavailable');
        if(owned&&this.vault){
          try{this._endpointStore().save(accountId,{runtime:run.proof,listener:proof,endpoint});this.endpointIssues.delete(accountId);}
          catch{this._endpointIssue(accountId);}
        }
        result.set(accountId,{connection:{...endpoint,endpointId:createHash('sha256').update(JSON.stringify([proof,endpoint.port,endpoint.token])).digest('hex'),ownershipVerified:true,listenAddress:listener.address,loopbackOnly:['127.0.0.1','::1'].includes(listener.address),source,endpointRecoveryIssue:this.endpointIssues.get(accountId)||null}});
      }catch{if(this.runs.has(accountId)&&!this.endpoints.has(accountId))this._endpointIssue(accountId);result.set(accountId,{...error(stage),endpointRecoveryIssue:this.endpointIssues.get(accountId)||null});}
    }
    return result;
  }
  async getConnection(accountId){const result=(await this.getConnections([accountId])).get(accountId);if(result.error)fail(result.error.code);return result.connection;}
  _desktop(rows){return rows.some(p=>p.name.toLowerCase()==='napcatqq-desktop.exe');}
  _external(rows,install,accountId,proof=this.runs.get(accountId)?.proof){
    const launchers=rows.filter(p=>p.name.toLowerCase()==='napcatwinbootmain.exe'&&samePath(p.executable,install.launcher));
    const specific=launchers.some(p=>p.accountId===accountId&&!matches(p,proof));
    const mapped=new Set(launchers.map(p=>p.pid));let change=true;while(change){change=false;for(const p of rows)if(mapped.has(p.parentPid)&&!mapped.has(p.pid)){mapped.add(p.pid);change=true;}}
    const unknown=launchers.some(p=>!p.accountId)||rows.some(p=>p.name.toLowerCase()==='qq.exe'&&install.qqExe&&samePath(p.executable,install.qqExe)&&!mapped.has(p.pid));
    const foreignQCE=this.managed&&rows.some(p=>samePath(p.executable,QCE.binaryPath(install))&&!mapped.has(p.pid));
    return specific?'external_process':unknown||foreignQCE?'external_qq_unknown':null;
  }
  _ownerBlocker(install){return !!this.managed&&install?.installationKind==='managed-shell'&&['pending_upstream_update','pending_update_recovery_required'].includes(install?.componentIssue);}
  _ownerRow(accountId,issue,{owned=false,stopped=false}={}){return {accountId,configured:false,management:owned?'owned':stopped?'stopped':'recoverable',processRunning:owned,canStart:false,canStop:owned,canRecover:!owned&&!stopped,recoveryRequired:!owned&&!stopped,reason:issue,endpointRecoveryIssue:null};}
  async _withShellOwner(accountId,assertCurrent,mutating,operation,proof=this._shellProof()){
    const initial=this.instance(accountId);if(!this._ownerBlocker(initial))fail('ownership_lost');const issue=initial.componentIssue,selector=this.componentSelection(),context=selector.shellOwnerContext();
    let lease;try{lease=proof.readLease(this._lockPath(accountId),accountId);}catch(e){if(e.code==='ENOENT')fail(issue);throw e;}if(!lease.runtime)fail('ownership_lost');proof.assertBinding(lease,context);
    const run=this.runs.get(accountId);if(run){if(!run.lease.ownerFile||!isShellLease(run.lease)||run.lease.instance!==this.id||!matches(run.proof,lease.runtime)||run.lease.token!==lease.token||JSON.stringify(run.lease.ownerFile)!==JSON.stringify(lease.ownerFile))fail('ownership_lost');lease=run.lease;}
    const blockers=proof.blockers(context);if(!blockers.some(r=>r.proof))fail('ownership_lost');
    const bindingCheck=()=>{if(this.instance(accountId).componentIssue!==issue)fail('ownership_lost');proof.assertBinding(lease,selector.shellOwnerContext());proof.assertBlockers(blockers);};
    return proof.withGuard({context,accountId,lease,host:this.host,assertCurrent,mutating},async(checkGuard,fixedGuard,controls)=>{
      const fixed=()=>{fixedGuard();bindingCheck();},check=()=>{checkGuard();bindingCheck();proof.assertLease(lease);};
      const l=context.layout,install={...initial,...l,accountId,runtimeDir:l.codeRoot,launcher:path.join(l.codeRoot,'NapCatWinBootMain.exe'),hook:path.join(l.codeRoot,'NapCatWinBootHook.dll'),core:path.join(l.codeRoot,'napcat.mjs'),patch:path.join(l.codeRoot,'qqnt.json'),available:false};
      check();return operation({lease,run,issue,context,install,check,fixed,blockers,controls});
    });
  }
  async _ownerObservation(ctx){
    const {lease,run,install}=ctx;
    const round=async()=>{
      ctx.check();const rows=await this._processes();ctx.check();if(this._desktop(rows))fail('desktop_running');
      const owners=await this._inspect([lease.manager.pid]);ctx.check();const owner=owners.find(p=>p.pid===lease.manager.pid),listed=rows.find(p=>p.pid===lease.manager.pid);
      if(!!owner!==!!listed||owner&&(!matches(owner,identity(listed))||owner.parentPid!==listed.parentPid))fail('process_check_failed');
      if(run){if(lease.instance!==this.id||lease.manager.pid!==process.pid||!matches(owner,lease.manager))fail('ownership_lost');}
      else if(owner)fail(matches(owner,lease.manager)?'owner_alive':'ownership_lost');
      const root=(await this._inspect([lease.runtime.pid])).find(p=>p.pid===lease.runtime.pid);ctx.check();
      if(!root){if(rows.some(p=>p.pid===lease.runtime.pid)||!await this._treeDead(lease,install,rows,'owner-dead-tree'))fail('ownership_lost');ctx.check();return [];}
      if(!matches(root,lease.runtime)||root.parentPid!==lease.runtime.parentPid||root.parentPid!==lease.spawnManager.pid||root.accountId!==lease.accountId)fail('ownership_lost');
      const tree=await this._checkedTree(lease,install,rows,'owner-control');ctx.check();const conflict=this._external(rows,install,lease.accountId,lease.runtime);if(conflict)fail(conflict);return tree;
    };
    const first=await round(),second=await round(),view=tree=>tree.map(ShellOwner.treeIdentity).sort((a,b)=>a.pid-b.pid);if(JSON.stringify(view(first))!==JSON.stringify(view(second)))fail('ownership_lost');ctx.check();return {tree:second,owned:!!run};
  }
  async inspectOwnerControl(accountId,options={}){
    if(this.platform!=='win32')fail('unsupported_platform');if(this.closing)fail('manager_closing');if(!account(accountId))fail('invalid_account');if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='assertCurrent'))fail('start_guard_invalid');if(this.pending.has(accountId))fail('operation_in_progress');
    const operation=this._begin(accountId,false,'reconcile');try{return await this._withShellOwner(accountId,()=>ShellOwner.check(options.assertCurrent),false,async ctx=>{const state=await this._ownerObservation(ctx);ctx.check();const row=this._ownerRow(accountId,ctx.issue,{owned:state.owned});row.processRunning=state.tree.length>0;return {row,binding:ShellOwner.hash(JSON.stringify({lease:ctx.lease.ownerFile,processes:state.tree.map(ShellOwner.treeIdentity),owned:state.owned,issue:ctx.issue})),componentIssue:ctx.issue,configured:false};});}finally{this._end(accountId,false,operation);}
  }
  async discover({settledAccount=null}={}){
    const install=this._installation();let rows=[],issue=install.componentIssue||null;
    if(this.platform!=='win32')issue='unsupported_platform';else try{rows=await this._processes();}catch{issue='process_check_failed';}
    const desktopRunning=this._desktop(rows);
    const instances=[];
    for(const accountId of new Set([...install.accounts,...(this.shellOrphanCleanup?.inspectionResourceAccounts()||[])])){
      if(!this.pending.has(accountId)&&!this.closing&&this.hasOrphanInspectionResources(accountId)){
        instances.push({accountId,configured:false,management:'unknown',processRunning:null,canStart:false,canStop:false,canRecover:false,recoveryRequired:true,reason:install.componentIssue||'cleanup_unconfirmed',endpointRecoveryIssue:null,canSettleOrphanInspection:true});continue;
      }
      if(this._ownerBlocker(install)&&!this.pending.has(accountId)&&!this.closing&&this.shellOrphanCleanup?.hasSettlement(accountId)){try{if(await this.shellOrphanCleanup.inspect(accountId)){instances.push({...this._ownerRow(accountId,install.componentIssue),management:'recoverable',processRunning:this.shellOrphanCleanup.observedRunning(accountId),canStop:false,canRecover:false,canInspectOrphanCleanup:true});continue;}}catch{/* Unproved retained resources never grant process authority. */}}
      if(this._ownerBlocker(install)&&!this.pending.has(accountId)&&!this.closing){try{instances.push((await this.inspectOwnerControl(accountId)).row);continue;}catch{/* Discovery never converts an unverifiable lease into process authority. */}try{if(await this._pendingOrphans().inspect(accountId)){instances.push({...this._ownerRow(accountId,install.componentIssue),management:'recoverable',processRunning:true,canStop:false,canRecover:false,canInspectOrphanCleanup:true});continue;}}catch{/* A capability requires its own complete residual proof. */}}
      if(!issue&&!this.closing&&!this.pending.has(accountId)&&this.runs.has(accountId)){
        // Reconciliation may release a dead lease; serialize it with lifecycle
        // requests without turning every periodic read into a UI change event.
        const operation=this._begin(accountId,false,'reconcile');try{await this._reconcile(accountId,{...install,accountId},rows);}catch(error){const run=this.runs.get(accountId);if(run)run.reason=error.code||'process_check_failed';}finally{this._end(accountId,false,operation);}
      }
      const run=this.runs.get(accountId),live=run&&rows.find(p=>p.pid===run.proof?.pid),isOwned=!!run&&matches(live,run.proof),external=this._external(rows,install,accountId);
      const locked=fs.existsSync(this._lockPath(accountId)),recoveryRequired=locked&&!run;
      let pluginIssue=null;if(!run&&install.available)try{this._assertPluginDeploymentReady(this.instance(accountId));}catch{pluginIssue='deployment_recovery_required';}
      let reason=issue||(!install.available?'missing_components':null)||(desktopRunning?'desktop_running':null)||run?.reason||(run&&!isOwned?'ownership_lost':null)||(recoveryRequired?'recovery_required':null)||external||pluginIssue;
      if(this.pending.has(accountId)&&settledAccount!==accountId)reason='operation_in_progress';
      // Display continuity only; never authorizes an endpoint or an operation.
      const processGeneration=isOwned&&!reason?createHash('sha256').update(JSON.stringify([this.id,accountId,run.proof.pid,run.proof.createdAt,run.proof.executable])).digest('hex'):null;
      instances.push({accountId,...(processGeneration?{processGeneration}:{}),management:isOwned?'owned':run?'unknown':recoveryRequired?'recoverable':external?'external':'stopped',processRunning:!!(isOwned||external),canStart:!reason&&!run&&!this.closing,canStop:isOwned&&!reason,canRecover:recoveryRequired&&!issue&&install.available&&!desktopRunning&&!this.pending.has(accountId)&&!this.closing,recoveryRequired,reason,endpointRecoveryIssue:this.endpointIssues.get(accountId)||null});
    }
    const managedSelectedVersion=this.managed&&install.componentSelectionKind==='prepared'?install.selectedNapcatVersion:null;
    return {platform:this.platform,configured:install.available,desktopDataRoot:this.managed?null:this.desktopDataRoot,componentsRoot:this.componentsRoot,installationKind:this.managed?'managed-shell':'legacy',components:{available:install.available,selectionKind:install.componentSelectionKind||'original',selectedNapcatVersion:install.selectedNapcatVersion||null,qqVersion:install.qqVersion,qqVersionSource:install.qqVersionSource||'installed-version-pointer',napcatVersion:managedSelectedVersion||install.napcatVersion,napcatVersionSource:managedSelectedVersion?'prepared-selection-metadata':install.napcatVersion?'runtime-log':null},desktopRunning,issue,instances};
  }
  _lockPath(accountId){return path.join(this.lockRoot,`${createHash('sha256').update(accountId).digest('hex')}.json`);}
  _configurationLockPath(){return path.join(this.lockRoot,'configuration.edit');}
  _secureDirectory(dir){
    fs.mkdirSync(dir,{recursive:true,mode:0o700});const st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||!samePath(fs.realpathSync(dir),dir))fail('unsafe_lock');
  }
  _acquire(accountId,rows,binding){
    this._secureDirectory(this.lockRoot);const file=this._lockPath(accountId);const manager=rows.find(p=>p.pid===process.pid);if(!validProof(identity(manager)))fail('process_check_failed');
    if(fs.existsSync(`${file}.recover`)||fs.existsSync(this._configurationLockPath()))fail('operation_in_progress');
    const lease=binding?{version:2,engine:'managed-shell',instance:this.id,token:randomUUID(),accountId,...binding,manager:identity(manager),spawnManager:identity(manager),runtime:null,runtimeTree:[]}:{version:1,instance:this.id,token:randomUUID(),accountId,manager:identity(manager),runtime:null,runtimeTree:[]};
    if(binding)return this._shellProof().createLease(file,lease);
    // Unknown/partial/stale locks are not removed automatically. The app must not
    // race another profile or claim a detached process after a crash.
    let fd;try{fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(lease));fs.fsyncSync(fd);}catch(error){if(error instanceof QQRuntimeError)throw error;fail(error.code==='EEXIST'?'runtime_locked':'unsafe_lock');}finally{if(fd!==undefined)fs.closeSync(fd);}
    return {file,...lease};
  }
  _writeLease(lease){
    if(isShellLease(lease)){if(lease.instance!==this.id)fail('runtime_locked');return this._shellProof().writeLease(lease);}
    const current=readObject(lease.file);if(!current||current.token!==lease.token||current.instance!==this.id)fail('runtime_locked');
    const {file,...content}=lease;atomicJSON(file,content);
  }
  _release(lease){if(isShellLease(lease)){if(lease.instance!==this.id)fail('runtime_locked');return this._shellProof().releaseLease(lease);}const current=readObject(lease.file);if(current?.token!==lease.token||current.instance!==this.id)fail('runtime_locked');fs.unlinkSync(lease.file);}
  _event(accountId,event){const list=this.events.get(accountId)||[];list.push(event);if(list.length>160)list.splice(0,list.length-160);this.events.set(accountId,list);this._changed();}
  _guard(rows,install,accountId){if(this._desktop(rows))fail('desktop_running');const external=this._external(rows,install,accountId);if(external)fail(external);}
  _assertPluginDeploymentReady(install){
    try{require('./qq-plugin-deployment.cjs').assertPluginDeploymentReady(install.workDir);}
    catch{fail('deployment_recovery_required');}
  }
  async withConfigurationLock(accountId,options={},operation){
    if(this.pending.has(accountId)||fs.existsSync(this._configurationLockPath()))fail('operation_in_progress');
    return this.componentSelection().withStartLock((plan,assertOwned)=>this._withConfigurationLock(accountId,options,operation,assertOwned));
  }
  async withPluginDeploymentLock(accountId,operation){
    if(typeof operation!=='function')fail('invalid_account');
    return this.withConfigurationLock(accountId,{},async install=>{
      const work=install.workDir;
      const assertStopped=async()=>{
        await install.assertStopped();
        const rows=await this._processes();if(this._desktop(rows))fail('desktop_running');
        const current=this.instance(accountId);if(!samePath(current.workDir,work)||!samePath(current.configDir,install.configDir))fail('component_changed');
        for(const id of current.accounts){
          const other=this.instance(id);if(!samePath(other.workDir,work))continue;
          if(this.runs.has(id)||id!==accountId&&this.pending.has(id))fail('runtime_running');
          if(fs.existsSync(this._lockPath(id)))fail('runtime_locked');
          if(fs.existsSync(`${this._lockPath(id)}.recover`))fail('operation_in_progress');
          this._guard(rows,other,id);
        }
        await install.assertStopped();
      };
      await assertStopped();return operation({...install,assertStopped});
    });
  }
  async _withConfigurationLock(accountId,{create=false}={},operation,assertComponentOwned){
    // Main-process-only callback: callers receive a verified fixed config path,
    // not permission to supply arbitrary filesystem paths from the renderer.
    if(this.platform!=='win32')fail('unsupported_platform');if(this.closing)fail('manager_closing');if(!account(accountId)||typeof operation!=='function')fail('invalid_account');
    const install=this._installation();if(!install.available)fail('missing_components');if(!install.accounts.includes(accountId)&&(!create||install.accounts.length>=MAX_ACCOUNTS))fail('invalid_account');
    try{if(!fs.lstatSync(install.configDir).isDirectory()||!samePath(fs.realpathSync(install.configDir),install.configDir))fail('invalid_installation');}catch{fail('invalid_installation');}
    this._begin(accountId);let marker,result,failure,configurationRecoveryIssue;
    try{
      const assertStopped=async()=>{assertComponentOwned();marker?.assertOwned();const rows=await this._processes();if(this._desktop(rows))fail('desktop_running');if(this.runs.has(accountId))fail('runtime_running');this._guard(rows,install,accountId);if(fs.existsSync(this._lockPath(accountId)))fail('runtime_locked');if(fs.existsSync(`${this._lockPath(accountId)}.recover`))fail('operation_in_progress');assertComponentOwned();marker?.assertOwned();};
      await assertStopped();this._secureDirectory(this.lockRoot);marker=await createConfigurationMarker({selection:this.componentSelection(),processHost:this.host});
      await assertStopped();result=await operation({...install,accountId,onebotConfigPath:path.join(install.configDir,`onebot11_${accountId}.json`),assertStopped});
      // The callback may already have committed configuration bytes. A later
      // ownership/cleanup problem must preserve its actual receipt.
      try{assertComponentOwned();marker.assertOwned();}catch{configurationRecoveryIssue='configuration_marker_retained';}
      this._changed();
    }catch(error){failure=error;}
    finally{if(marker){const cleanup=marker.close();if(cleanup.issue)configurationRecoveryIssue=cleanup.issue;}this._end(accountId);}
    if(failure){if(configurationRecoveryIssue)failure.configurationRecoveryIssue=configurationRecoveryIssue;throw failure;}
    return configurationRecoveryIssue?{...(result&&typeof result==='object'?result:{}),configurationRecoveryIssue}:result;
  }
  async start(accountId,options={}){
    const assertCurrent=startGuard(options);assertCurrent();
    if(this.platform!=='win32')fail('unsupported_platform');if(this.closing)fail('manager_closing');
    const initial=this.instance(accountId);if(!initial.available)fail(initial.componentIssue||'missing_components');
    this._begin(accountId);
    try{const rows=await this._processes();assertCurrent();if(this._desktop(rows))fail('desktop_running');if(fs.existsSync(this._configurationLockPath()))fail('operation_in_progress');return await this.componentSelection().withStartLock((plan,assertOwned)=>{const beforeStart=()=>{checkStartGuard(assertOwned);assertCurrent();};beforeStart();return this._startWithComponentLock(accountId,plan,assertOwned,beforeStart);});}
    finally{this._end(accountId);}
  }
  async _startWithComponentLock(accountId,plan,assertOwned,beforeStart=assertOwned){
    beforeStart();
    if(this.platform!=='win32')fail('unsupported_platform');if(this.closing)fail('manager_closing');
    const install=this.instance(accountId);if(!install.available)fail(install.componentIssue||'missing_components');
    this._assertPluginDeploymentReady(install);
    if(!samePath(install.runtimeDir,plan.codeRoot)||!samePath(install.workDir,plan.workDir)||!samePath(install.qqExe,plan.qqExe)||(this.managed&&(!samePath(install.qqDataDir,plan.qqDataDir)||plan.installationKind!=='managed-shell')))fail('component_changed');assertOwned();
    let lease,started=false;const binding=this.managed?this._shellProof().capture(this.componentSelection().shellOwnerContext()):null;
    let qceStartup=null;
    if(QCE.installedVersion(install)===QCE.VERSION){
      if(!binding)fail('qce_version_unsupported');
      try{qceStartup=QCEStartup.captureQCEStartup({userProfile:process.env.USERPROFILE});}catch(error){fail(MESSAGES[error.code]?error.code:'qce_startup_unverified');}
      const bridgePort=await (this.host.allocatePort?this.host.allocatePort():availableLoopbackPort());beforeStart();
      try{binding.binding.version=2;binding.binding.qce=QCE.captureLaunch(install,bridgePort,{userProfile:qceStartup.userProfile});}catch(error){fail(error.code==='qce_version_unsupported'?error.code:'qce_process_unverified');}
    }
    const startupCheck=beforeStart;beforeStart=()=>{startupCheck();if(qceStartup)try{QCEStartup.assertQCEStartup(qceStartup);}catch(error){fail(MESSAGES[error.code]?error.code:'qce_startup_unverified');}if(binding)this._shellProof().assertBinding(binding,this.componentSelection().shellOwnerContext(),{programs:true});};
    const beforeSpawn=()=>{beforeStart();if(!this.managed)try{this.componentSelection().assertLegacyQQPin(install.legacyQQPin);}catch(error){fail(error.code==='selection_invalid'?'selection_invalid':'qq_component_changed');}};
    try{
      let rows=await this._processes();beforeStart();if(this._desktop(rows))fail('desktop_running');await this._reconcile(accountId,install,rows);beforeStart();if(this.runs.has(accountId))fail('runtime_locked');this._guard(rows,install,accountId);lease=this._acquire(accountId,rows,binding);
      rows=await this._processes();beforeStart();this._guard(rows,install,accountId);if(fs.existsSync(this._configurationLockPath()))fail('operation_in_progress');
      const ownDir=path.join(this.root,'qq-runtime',createHash('sha256').update(accountId).digest('hex'));this._secureDirectory(ownDir);
      const loader=path.join(ownDir,'load.cjs');
      // A private, original loader avoids changing Desktop's shared load script.
      fs.writeFileSync(loader,`'use strict';\nimport(${JSON.stringify(pathToFileURL(install.core).href)}).catch(()=>{console.error('Agent Arcade: QQ runtime load failed.');process.exitCode=1;});\n`,{mode:0o600});
      // Give QQ Windows' ordinary runtime paths, not model keys or app tokens.
      const env={};const allowed=/^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|APPDATA|LOCALAPPDATA|PROGRAMDATA|USERPROFILE|HOMEDRIVE|HOMEPATH|USERNAME|USERDOMAIN|USERDNSDOMAIN|SESSIONNAME|OS|PROCESSOR_ARCHITECTURE|PROCESSOR_IDENTIFIER|NUMBER_OF_PROCESSORS|PROGRAMFILES(?:\(X86\))?|COMMONPROGRAMFILES(?:\(X86\))?)$/i;
      for(const [key,value]of Object.entries(process.env))if(allowed.test(key))env[key]=value;
      Object.assign(env,{NAPCAT_PATCH_PACKAGE:install.patch,NAPCAT_LOAD_PATH:loader,NAPCAT_INJECT_PATH:install.hook,NAPCAT_LAUNCHER_PATH:install.launcher,NAPCAT_MAIN_PATH:install.core,NAPCAT_WORKDIR:install.workDir});
      if(this.managed)env.NAPCAT_QQ_DATA_DIR=this.managed.read().qqDataDir;
      if(binding?.binding.qce)Object.assign(env,QCE.launchEnvironment(binding.binding.qce,install));
      const preferred=await (this.host.allocatePort?this.host.allocatePort():availableLoopbackPort());beforeStart();if(!Number.isInteger(preferred)||preferred<1||preferred>65535)fail('start_failed');if(binding?.binding.qce?.bridgePort===preferred)fail('qce_port_unavailable');env.NAPCAT_WEBUI_PREFERRED_PORT=String(preferred);
      this.endpoints.delete(accountId);
      this.endpointIssues.delete(accountId);this.outputOwners.set(accountId,lease.token);
      beforeStart();if(binding?.binding.qce){const listeners=await this.host.listeners();beforeStart();if(!Array.isArray(listeners)||listeners.length>4096||listeners.some(p=>!Number.isSafeInteger(p.pid)||!Number.isInteger(p.port)||typeof p.address!=='string')||listeners.some(p=>p.port===binding.binding.qce.bridgePort||p.port===QCE.API_PORT))fail('qce_port_unavailable');}
      beforeStart();if(this.managed){const current=this.managed.read();if(!samePath(current.workDir,install.workDir)||!samePath(current.configDir,install.configDir)||!samePath(current.qqDataDir,plan.qqDataDir)||!samePath(current.qqDataDir,env.NAPCAT_QQ_DATA_DIR)||!samePath(current.qq.file,install.qqExe))fail('managed_installation_changed');}this._assertPluginDeploymentReady(install);beforeStart();const child=await this.host.start({file:install.launcher,args:[install.qqExe,install.hook,accountId],cwd:install.workDir,env,beforeSpawn,onOutput:line=>{if(this.outputOwners.get(accountId)!==lease.token)return;const endpoint=privateEndpoint(line);if(endpoint){this.endpoints.set(accountId,endpoint);this._changed();}const event=classifyLogLine(line);if(event)this._event(accountId,event);},onExit:()=>{if(this.outputOwners.get(accountId)!==lease.token)return;this.endpoints.delete(accountId);this._changed();}});
      started=true;
      // Once spawned, retain and verify ownership even if the caller cancelled.
      // The caller must recheck its context before connecting another service.
      rows=await this._processes();const proc=rows.find(p=>p.pid===child.pid);
      if(!validProof(identity(proc))||proc.parentPid!==process.pid||!samePath(proc.executable,install.launcher)||proc.accountId!==accountId){this.runs.set(accountId,{lease,proof:null});fail('start_unverified');}
      assertOwned();const proof=isShellLease(lease)?ShellOwner.treeIdentity(proc):identity(proc);lease.runtime=proof;lease.runtimeTree=[proof];this.runs.set(accountId,{lease,proof});this._writeLease(lease);this._rememberTree(this.runs.get(accountId),this._tree(rows,proof,install,lease));
      this._event(accountId,{type:'launcher_started',time:new Date().toISOString()});return (await this.discover({settledAccount:accountId})).instances.find(p=>p.accountId===accountId);
    }catch(error){if(lease&&!started)this._release(lease);if(error instanceof QQRuntimeError)throw error;fail('start_failed');}
  }
  async assertWritable(accountId){
    const install=this.instance(accountId),rows=await this._processes();this._guard(rows,install,accountId);
    const run=this.runs.get(accountId);if(!run)fail('not_owned');if(!matches(rows.find(p=>p.pid===run.proof?.pid),run.proof))fail('ownership_lost');
    const lease=readObject(run.lease.file,ShellOwner.MAX_LEASE);if(lease?.token!==run.lease.token||lease?.instance!==this.id)fail('runtime_locked');if(isShellLease(run.lease))this._shellProof().assertLease(run.lease);return install;
  }
  async stop(accountId,options={}){
    const assertCurrent=()=>ShellOwner.check(options?.assertCurrent);if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='assertCurrent'))fail('start_guard_invalid');assertCurrent();
    if(this.platform!=='win32')fail('unsupported_platform');if(!account(accountId))fail('invalid_account');
    const current=this.operations.get(accountId),predecessor=current?.kind==='reconcile'?current:null;
    // Reserve the stop synchronously: repeated lifecycle requests still fail.
    const operation=this._begin(accountId,true,'stop',predecessor);
    let trace=null;if(this.onStopTrace)try{trace={id:randomUUID(),phase:'begin',proofs:[...(this.runs.get(accountId)?.lease.runtimeTree||[])]};this.stopTraceContexts.set(trace.id,trace);this._stopTrace(trace,'begin');}catch{/* Debug setup is not a lifecycle precondition. */}
    const stage=phase=>{if(trace)try{trace.phase=phase;this._stopTrace(trace,'stage',{processes:stopTraceRows(trace.proofs||[])});}catch{/* Projection is diagnostic only. */}};
    try{
      if(predecessor){stage('waiting_reconcile');await predecessor.promise;}
      stage('layout');
      const install=this.instance(accountId),run=this.runs.get(accountId);if(!run)fail('not_owned');
      if(this._ownerBlocker(install))return await this._withShellOwner(accountId,assertCurrent,true,async ctx=>{
        const state=await this._ownerObservation(ctx);ctx.check();if(!state.owned)fail('not_owned');
        if(state.tree.length){this._rememberTree(run,state.tree);ctx.check();await this.host.stop(state.tree.map(identity));if(!await this._confirmStopped(run.lease,ctx.install))fail('stop_failed');}
        ctx.fixed();this._shellProof().assertLease(run.lease);this._release(run.lease);this.runs.delete(accountId);this.endpoints.delete(accountId);this.outputOwners.delete(accountId);this.endpointIssues.delete(accountId);this._event(accountId,{type:'launcher_stopped',time:new Date().toISOString()});return this._ownerRow(accountId,ctx.issue,{stopped:true});
      });
      if(trace){trace.qqExe=install.qqExe;trace.launcher=install.launcher;trace.proofs=[run.lease.runtime,...(run.lease.runtimeTree||[])].filter(Boolean);}
      stage('before_snapshot');const rows=await this._processes('stop-before');if(this._desktop(rows))fail('desktop_running');
      stage('lease');
      const lease=readObject(run.lease.file,ShellOwner.MAX_LEASE);if(lease?.token!==run.lease.token||lease?.instance!==this.id)fail('runtime_locked');if(isShellLease(run.lease))this._shellProof().assertLease(run.lease);assertCurrent();
      if(isShellLease(run.lease))this._shellProof().assertBinding(run.lease,this.componentSelection().shellOwnerContext());
      if(!rows.some(p=>p.pid===run.proof?.pid)){
        stage('reconcile');if(!await this._reconcile(accountId,install,rows))fail('ownership_lost');stage('discover');const result={...(await this.discover({settledAccount:accountId})).instances.find(p=>p.accountId===accountId),alreadyStopped:true};stage('done');this._stopTrace(trace,'success');return result;
      }
      stage('checked_tree');const tree=await this._checkedTree(run.lease,install,rows,'stop-proof');this._rememberTree(run,tree);if(trace)trace.proofs=tree.map(identity);
      // Manager diagnostics keep the ordinary native stop script by default.
      // Detailed native tracing is a separate explicit main-process option.
      stage('host_stop');assertCurrent();await this.host.stop(tree.map(identity),trace&&this.traceHostStop?{onTrace:row=>this._stopTrace(trace,'host_step',{step:row?.step,pid:row?.pid,exited:row?.exited,hostAt:row?.hostAt})}:undefined);this._stopTrace(trace,'host_result');
      stage('confirm_stopped');if(!await this._confirmStopped(run.lease,install))fail('stop_failed');
      stage('release');this._release(run.lease);this.runs.delete(accountId);this.endpoints.delete(accountId);this.outputOwners.delete(accountId);this.endpointIssues.delete(accountId);this._event(accountId,{type:'launcher_stopped',time:new Date().toISOString()});stage('discover');const result=(await this.discover({settledAccount:accountId})).instances.find(p=>p.accountId===accountId);stage('done');this._stopTrace(trace,'success');return result;
    }catch(error){this._stopTrace(trace,'failure',{code:MESSAGES[error?.code]?error.code:'stop_failed'});if(error instanceof QQRuntimeError||error instanceof ShellOwner.QQShellOwnerError)throw error;fail('stop_failed');}
    finally{if(trace)this.stopTraceContexts.delete(trace.id);this._end(accountId,true,operation);}
  }
  async recover(accountId,options={}){
    const assertCurrent=()=>ShellOwner.check(options?.assertCurrent);if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='assertCurrent'))fail('start_guard_invalid');assertCurrent();
    if(this.managed&&this._ownerBlocker(this.instance(accountId))){if(this.platform!=='win32')fail('unsupported_platform');if(this.closing)fail('manager_closing');this._begin(accountId);try{return await this._withShellOwner(accountId,assertCurrent,true,async ctx=>{
      if(this.runs.has(accountId))fail('runtime_locked');const state=await this._ownerObservation(ctx);ctx.check();let recovery;
      if(!state.tree.length){this._shellProof().releaseLease(ctx.lease);recovery='cleared';}
      else{const manager=(await this._inspect([process.pid])).find(p=>p.pid===process.pid);if(!validProof(identity(manager)))fail('process_check_failed');ctx.check();Object.assign(ctx.lease,{instance:this.id,token:randomUUID(),manager:identity(manager),runtimeTree:state.tree.map(ShellOwner.treeIdentity).sort((a,b)=>a.pid-b.pid)});this._shellProof().writeLease(ctx.lease);this.runs.set(accountId,{lease:ctx.lease,proof:ctx.lease.runtime});recovery='adopted';}
      this.endpoints.delete(accountId);this._event(accountId,{type:`ownership_${recovery}`,time:new Date().toISOString()});return {...this._ownerRow(accountId,ctx.issue,{stopped:recovery==='cleared',owned:recovery==='adopted'}),recovery};
    });}finally{this._end(accountId);}}
    if(this.platform!=='win32')fail('unsupported_platform');if(this.closing)fail('manager_closing');const install=this.instance(accountId);if(!install.available)fail('missing_components');
    this._begin(accountId);let guard,guardFile;
    try{
      let rows=await this._processes();if(this._desktop(rows))fail('desktop_running');if(this.runs.has(accountId))fail('runtime_locked');
      this._secureDirectory(this.lockRoot);const file=this._lockPath(accountId);guardFile=`${file}.recover`;
      if(fs.existsSync(this._configurationLockPath()))fail('operation_in_progress');
      try{guard=fs.openSync(guardFile,'wx',0o600);}catch{fail('operation_in_progress');}
      let lease=readObject(file,ShellOwner.MAX_LEASE);if(!this._validLease(lease,accountId)||!validProof(lease.runtime))fail('ownership_lost');if(isShellLease(lease)){lease=this._shellProof().readLease(file,accountId);this._shellProof().assertBinding(lease,this.componentSelection().shellOwnerContext());}
      const checkOldOwner=async()=>{
        const current=(await this._inspect([lease.manager.pid])).find(p=>p.pid===lease.manager.pid);
        if(current&&!validProof(identity(current)))fail('process_check_failed');
        if(matches(current,lease.manager))fail('owner_alive');
        // A PID reused by a different executable/creation time is never stopped.
        const currentLease=readObject(file,ShellOwner.MAX_LEASE);if(currentLease?.token!==lease.token||currentLease?.instance!==lease.instance)fail('runtime_locked');if(isShellLease(lease)){this._shellProof().assertLease(lease);this._shellProof().assertBinding(lease,this.componentSelection().shellOwnerContext());}assertCurrent();
      };
      await checkOldOwner();rows=await this._processes();if(this._desktop(rows))fail('desktop_running');
      const runtime=(await this._inspect([lease.runtime.pid])).find(p=>p.pid===lease.runtime.pid);
      let recovery;
      if(!runtime){
        if(!await this._treeDead({...lease,accountId},install,rows,'recovery-dead-tree',!isShellLease(lease)))fail('process_check_failed');await checkOldOwner();assertCurrent();
        if(isShellLease(lease))this._shellProof().releaseLease(lease);else fs.unlinkSync(file);recovery='cleared';
      }else{
        if(!matches(runtime,lease.runtime)||runtime.accountId!==accountId||!samePath(runtime.executable,install.launcher))fail('ownership_lost');
        const tree=await this._checkedTree(lease,install,rows);
        // Another matching launcher or unassigned QQ process makes ownership ambiguous.
        const external=this._external(rows,install,accountId,lease.runtime);if(external)fail(external);
        const manager=(await this._inspect([process.pid])).find(p=>p.pid===process.pid);if(!validProof(identity(manager)))fail('process_check_failed');
        await checkOldOwner();const currentRows=await this._processes();if(this._desktop(currentRows))fail('desktop_running');
        const conflict=this._external(currentRows,install,accountId,lease.runtime);if(conflict)fail(conflict);
        const currentTree=await this._checkedTree(lease,install,currentRows);
        if(tree.length!==currentTree.length||tree.some(p=>!currentTree.some(q=>matches(q,identity(p)))))fail('ownership_lost');
        assertCurrent();if(isShellLease(lease)){Object.assign(lease,{instance:this.id,token:randomUUID(),manager:identity(manager),runtimeTree:currentTree.map(ShellOwner.treeIdentity).sort((a,b)=>a.pid-b.pid)});this._shellProof().writeLease(lease);this.runs.set(accountId,{lease,proof:lease.runtime});}
        else{const next={version:1,instance:this.id,token:randomUUID(),accountId,manager:identity(manager),runtime:lease.runtime,runtimeTree:currentTree.map(identity)};atomicJSON(file,next);this.runs.set(accountId,{lease:{file,...next},proof:next.runtime});}this.endpoints.delete(accountId);recovery='adopted';
      }
      this._event(accountId,{type:`ownership_${recovery}`,time:new Date().toISOString()});return {...(await this.discover({settledAccount:accountId})).instances.find(p=>p.accountId===accountId),recovery};
    }catch(error){if(error instanceof QQRuntimeError||error instanceof ShellOwner.QQShellOwnerError)throw error;fail('process_check_failed');}
    finally{if(guard!==undefined){fs.closeSync(guard);fs.unlinkSync(guardFile);}this._end(accountId);}
  }
  _orphanLease(file,accountId){
    let fd;
    try{
      const before=fs.lstatSync(file,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size<1n||before.size>BigInt(ShellOwner.MAX_LEASE))fail('ownership_lost');
      fd=fs.openSync(file,'r');const opened=fs.fstatSync(fd,{bigint:true});
      const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&b.nlink===1n&&b.isFile()&&!b.isSymbolicLink();
      if(!same(before,opened))fail('orphan_cleanup_changed');const bytes=Buffer.alloc(Number(opened.size));let offset=0;
      while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!count)fail('orphan_cleanup_changed');offset+=count;}
      if(!same(opened,fs.fstatSync(fd,{bigint:true}))||!same(opened,fs.lstatSync(file,{bigint:true})))fail('orphan_cleanup_changed');
      const lease=JSON.parse(bytes.toString('utf8'));if(!this._validLease(lease,accountId)||!validProof(lease.runtime)||!Array.isArray(lease.runtimeTree)||lease.runtimeTree.length<2)fail('ownership_lost');if(isShellLease(lease))this._shellProof().assertBinding(lease,this.componentSelection().shellOwnerContext());
      const fingerprint=createHash('sha256').update(bytes).update(`:${opened.dev}:${opened.ino}`).digest('hex');return {lease,fingerprint};
    }catch(error){if(error instanceof QQRuntimeError)throw error;fail('ownership_lost');}finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  async _orphanPlan(accountId,install,file,{allowEmpty=false,readLease=()=>this._orphanLease(file,accountId)}={}){
    const saved=readLease(),lease=saved.lease,proofs=lease.runtimeTree;
    if(!samePath(lease.runtime.executable,install.launcher)||new Set(proofs.map(p=>p.pid)).size!==proofs.length||proofs.filter(p=>matches(p,lease.runtime)).length!==1)fail('orphan_cleanup_unverified');
    const consoleHost=path.join(process.env.SystemRoot||'C:\\Windows','System32','conhost.exe');
    if(proofs.some(p=>p.pid!==lease.runtime.pid&&!samePath(p.executable,install.qqExe)&&!samePath(p.executable,consoleHost)&&!QCE.isChild(p,proofs,lease,install)))fail('orphan_cleanup_unverified');
    const rows=await this._processes();if(this._desktop(rows))fail('desktop_running');
    const direct=await this._inspect([lease.manager.pid,...proofs.map(p=>p.pid)]),owner=direct.find(p=>p.pid===lease.manager.pid),observedOwner=rows.find(p=>p.pid===lease.manager.pid);
    if([owner,observedOwner].some(p=>p&&!validProof(identity(p))))fail('process_check_failed');
    if(matches(owner,lease.manager)||matches(observedOwner,lease.manager))fail('owner_alive');
    if(!!owner!==!!observedOwner||owner&&!matches(owner,identity(observedOwner)))fail('orphan_cleanup_changed');
    const candidates=[];
    for(const proof of proofs){
      const current=direct.find(p=>p.pid===proof.pid),snapshot=rows.find(p=>p.pid===proof.pid);
      if(current&&!validProof(identity(current)))fail('process_check_failed');
      if(current&&!matches(current,proof)||snapshot&&!matches(snapshot,proof)||isShellLease(lease)&&current&&current.parentPid!==proof.parentPid)fail('ownership_lost');
      if(!!current!==!!snapshot||current&&current.parentPid!==snapshot.parentPid)fail('orphan_cleanup_changed');
      if(current&&proof.pid===lease.runtime.pid)fail('orphan_cleanup_unavailable');if(current)candidates.push(current);
    }
    const ids=possibleDescendantIds(rows,proofs);
    if(rows.some(p=>ids.has(p.pid)&&!proofs.some(proof=>proof.pid===p.pid)))fail('orphan_cleanup_unverified');
    const conflict=this._external(rows.filter(p=>!ids.has(p.pid)),install,accountId);if(conflict)fail('orphan_cleanup_unverified');
    const depths=new Map();
    for(const child of candidates){
      if(samePath(child.executable,consoleHost)&&child.parentPid!==lease.runtime.pid)fail('orphan_cleanup_unverified');
      let current=child,depth=1;const visited=new Set([child.pid]);
      while(current.parentPid!==lease.runtime.pid){
        const parent=candidates.find(p=>p.pid===current.parentPid);
        if(!parent||visited.has(parent.pid)||Date.parse(current.createdAt)<Date.parse(parent.createdAt))fail('orphan_cleanup_unverified');
        visited.add(parent.pid);current=parent;depth++;
      }
      if(Date.parse(current.createdAt)<Date.parse(lease.runtime.createdAt))fail('orphan_cleanup_unverified');depths.set(child.pid,depth);
    }
    if(!candidates.length&&!allowEmpty)fail('orphan_cleanup_unavailable');
    candidates.sort((a,b)=>depths.get(a.pid)-depths.get(b.pid)||a.pid-b.pid);
    if(readLease().fingerprint!==saved.fingerprint)fail('orphan_cleanup_changed');
    const digest=createHash('sha256').update(JSON.stringify({lease:saved.fingerprint,processes:candidates.map(p=>({...identity(p),parentPid:p.parentPid}))})).digest('hex');
    return {lease,fingerprint:saved.fingerprint,candidates,digest};
  }
  async _withOrphanGuard(accountId,operation){
    if(this.platform!=='win32')fail('unsupported_platform');if(this.closing)fail('manager_closing');
    const install=this.instance(accountId);if(!install.available)fail('missing_components');this._begin(accountId);
    let guard,guardFile,guardIdentity;const marker=randomUUID();
    try{
      if(this.runs.has(accountId))fail('runtime_locked');this._secureDirectory(this.lockRoot);
      if(fs.existsSync(this._configurationLockPath()))fail('operation_in_progress');
      const file=this._lockPath(accountId);guardFile=`${file}.recover`;
      try{guard=fs.openSync(guardFile,'wx',0o600);fs.writeFileSync(guard,marker);fs.fsyncSync(guard);guardIdentity=fs.fstatSync(guard);}catch{fail('operation_in_progress');}
      const assertGuard=()=>{
        const current=this.instance(accountId);if(!samePath(current.launcher,install.launcher)||!samePath(current.qqExe,install.qqExe)||!samePath(current.workDir,install.workDir))fail('orphan_cleanup_changed');
        if(fs.existsSync(this._configurationLockPath()))fail('operation_in_progress');
        try{const st=fs.lstatSync(guardFile);if(st.isSymbolicLink()||st.ino!==guardIdentity.ino||st.dev!==guardIdentity.dev||readSmall(guardFile,128)!==marker)fail('runtime_locked');}catch(error){if(error instanceof QQRuntimeError)throw error;fail('runtime_locked');}
      };
      assertGuard();return await operation({install,file,assertGuard});
    }catch(error){if(error instanceof QQRuntimeError)throw error;fail('process_check_failed');}
    finally{
      if(guard!==undefined){fs.closeSync(guard);try{const st=fs.lstatSync(guardFile);if(guardIdentity&&st.ino===guardIdentity.ino&&st.dev===guardIdentity.dev&&!st.isSymbolicLink()&&readSmall(guardFile,128)===marker)fs.unlinkSync(guardFile);}catch{/* Unknown/replaced guards stay blocked. */}}
      this._end(accountId);
    }
  }
  _pendingOrphans(){if(!this.shellOrphanCleanup){const {QQShellOrphanCleanup}=require('./qq-shell-orphan-cleanup.cjs');this.shellOrphanCleanup=new QQShellOrphanCleanup(this);}return this.shellOrphanCleanup;}
  hasOrphanInspectionResources(accountId){return !this.closing&&account(accountId)&&this.shellOrphanCleanup?.hasInspectionResources(accountId)===true;}
  discardOrphanPreview(accountId,{expectedDigest}={}){if(!account(accountId)||typeof expectedDigest!=='string'||!/^[a-f0-9]{64}$/.test(expectedDigest))fail('orphan_cleanup_changed');return this.shellOrphanCleanup?.discard(accountId,expectedDigest)||{discarded:false};}
  async previewOrphanCleanup(accountId,{assertCurrent=()=>{}}={}){
    if(this.shellOrphanCleanup?.owns(accountId)||this._ownerBlocker(this.instance(accountId)))return this._pendingOrphans().preview(accountId,assertCurrent);
    return this._withOrphanGuard(accountId,async({install,file,assertGuard})=>{
      const first=await this._orphanPlan(accountId,install,file),second=await this._orphanPlan(accountId,install,file);assertGuard();
      if(first.digest!==second.digest)fail('orphan_cleanup_changed');
      return {kind:'verified-orphan-cleanup',accountId,count:second.candidates.length,expectedDigest:second.digest,automaticStart:false};
    });
  }
  async cleanupHealthyOrphans(accountId,options){
    return require('./qq-healthy-orphan-receipt.cjs').cleanup(this,accountId,options);
  }
  async cleanupOrphans(accountId,{expectedDigest,assertCurrent=()=>{},beforeStop=async()=>{}}={}){
    if(typeof expectedDigest!=='string'||!/^[a-f0-9]{64}$/.test(expectedDigest)||typeof assertCurrent!=='function'||typeof beforeStop!=='function')fail('orphan_cleanup_changed');
    if(this.shellOrphanCleanup?.owns(accountId)||this._ownerBlocker(this.instance(accountId)))return this._pendingOrphans().confirm(accountId,{expectedDigest,assertCurrent,beforeStop});
    return this._withOrphanGuard(accountId,async({install,file,assertGuard})=>{
      assertCurrent();const first=await this._orphanPlan(accountId,install,file);if(first.digest!==expectedDigest)fail('orphan_cleanup_changed');
      assertGuard();assertCurrent();await beforeStop();
      const checked=await this._orphanPlan(accountId,install,file);if(checked.digest!==expectedDigest)fail('orphan_cleanup_changed');
      assertGuard();assertCurrent();
      try{
        await this.host.stop(checked.candidates.map(identity));
        const remaining=await this._orphanPlan(accountId,install,file,{allowEmpty:true});
        if(remaining.candidates.length||remaining.fingerprint!==checked.fingerprint)fail('orphan_cleanup_incomplete');
        assertGuard();assertCurrent();if(this._orphanLease(file,accountId).fingerprint!==checked.fingerprint)fail('orphan_cleanup_changed');
        fs.unlinkSync(file);
      }catch{const error=new QQRuntimeError('orphan_cleanup_incomplete');error.cleanupAttempted=true;throw error;}
      this.endpoints.delete(accountId);this.outputOwners.delete(accountId);this.endpointIssues.delete(accountId);
      this._event(accountId,{type:'ownership_orphans_cleared',time:new Date().toISOString()});
      return {recovery:'orphans-cleared',accountId,terminatedCount:checked.candidates.length,automaticStart:false};
    });
  }
  async close(){
    if(this.closePromise)return this.closePromise;this.closing=true;this.shellOrphanCleanup?.retire();
    this.closePromise=(async()=>{while(this.operations.size)await Promise.all([...this.operations.values()].map(v=>v.promise));const stopped=[],failures=[];
      for(const accountId of [...this.runs.keys()])try{await this.stop(accountId);stopped.push(accountId);}catch(error){failures.push({accountId,code:error.code||'stop_failed'});}
      try{await this.shellOwnerProof?.close();}catch(error){failures.push({accountId:null,code:error.code||'cleanup_unconfirmed'});}try{await this.shellOrphanCleanup?.close();}catch(error){failures.push({accountId:null,code:error.code||'cleanup_unconfirmed'});}this._changed();return {closed:failures.length===0,stopped,failures};})();const attempt=this.closePromise;try{const result=await attempt;if(!result.closed&&this.closePromise===attempt)this.closePromise=null;return result;}catch(e){if(this.closePromise===attempt)this.closePromise=null;throw e;}
  }
  logs(accountId,{limit=60}={}){
    const instance=this.instance(accountId);limit=Number.isInteger(limit)?Math.max(1,Math.min(160,limit)):60;
    const imported=this.managed?[]:boundedTail(instance.logPath).split(/\r?\n/).map(classifyLogLine).filter(Boolean);
    return {accountId,events:[...imported,...(this.events.get(accountId)||[])].slice(-limit),bounded:true,source:'diagnostic-events',rawMessagesIncluded:false};
  }
}
module.exports={QQRuntimeManager,QQRuntimeError,createWindowsProcessHost,classifyLogLine,MAX_LOG_BYTES,
  // Main-only helpers shared by the explicit Node engine; never exposed by IPC.
  runtimeSupport:{identity,matches,validProof,readObject,privateEndpoint,possibleDescendantIds,validProcesses,nodeObservationRequest,nodeObservationPids,validNodeObservation,nodeObservationScript}};

