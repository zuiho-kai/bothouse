'use strict';
// Main-process identity and exit checks. No QQ leases, account data, process-name
// termination, model loading or microphone access. Native calls are injectable.
const fs=require('node:fs'),path=require('node:path'),{execFile}=require('node:child_process');
const STAMP=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/;
const MAX_ROWS=16384,MAX_TREE=4;
const validPid=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const failure=()=>Object.assign(new Error('The owned speech process exit could not be confirmed.'),{code:'asr_exit_unconfirmed'});
function localPath(value){if(typeof value!=='string'||value.length>1500||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||/[\p{Cc}\p{Cf}]/u.test(value)||value.slice(2).includes(':'))throw failure();return path.resolve(value);}
const samePath=(a,b)=>a.toLowerCase()===b.toLowerCase();
function checkedFile(file){
  file=localPath(file);const parsed=path.parse(file);let cursor=parsed.root;
  for(const part of file.slice(parsed.root.length).split(path.sep)){cursor=path.join(cursor,part);const stat=fs.lstatSync(cursor);if(stat.isSymbolicLink()||(cursor===file?!stat.isFile():!stat.isDirectory()))throw failure();}
  if(!samePath(fs.realpathSync.native(file),file))throw failure();return file;
}
function configText(file,stat){
  if(stat.size>8192||stat.nlink!==1)throw failure();let fd;
  const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.nlink===1&&!b.isSymbolicLink();
  const buffer=Buffer.alloc(8193);
  try{fd=fs.openSync(file,'r');const opened=fs.fstatSync(fd);if(!opened.isFile()||!same(stat,opened))throw failure();const bytes=fs.readSync(fd,buffer,0,buffer.length,0);if(bytes!==stat.size||!same(opened,fs.fstatSync(fd))||!same(opened,fs.lstatSync(file)))throw failure();return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,bytes));}
  finally{buffer.fill(0);if(fd!==undefined)fs.closeSync(fd);}
}
function configuredPaths(pythonPath,systemRoot){
  try{
    const python=checkedFile(pythonPath);if(path.basename(python).toLowerCase()!=='python.exe')throw failure();
    const conhost=checkedFile(path.join(localPath(systemRoot),'System32','conhost.exe'));let base=python;
    if(path.basename(path.dirname(python)).toLowerCase()==='scripts'){
      const cfg=path.join(path.dirname(path.dirname(python)),'pyvenv.cfg');let stat;
      try{stat=fs.lstatSync(cfg);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(stat){checkedFile(cfg);const text=configText(cfg,stat),fields=new Map();
        for(const line of text.split(/\r?\n/)){const m=/^\s*(home|executable)\s*=\s*(.*?)\s*$/.exec(line);if(m){if(fields.has(m[1])||!m[2])throw failure();fields.set(m[1],m[2]);}}
        const home=fields.get('home'),exe=fields.get('executable');if(!home&&!exe)throw failure();
        const homeExe=home?checkedFile(path.join(localPath(home),'python.exe')):null;base=exe?checkedFile(exe):homeExe;
        if(path.basename(base).toLowerCase()!=='python.exe'||homeExe&&!samePath(homeExe,base))throw failure();
      }
    }
    return Object.freeze({python,base,conhost});
  }catch{throw failure();}
}
function row(value){
  if(!value||!validPid(value.pid)||!validPid(value.parentPid)||typeof value.createdAt!=='string'||!STAMP.test(value.createdAt)||!Number.isFinite(Date.parse(value.createdAt)))throw failure();
  return Object.freeze({pid:value.pid,parentPid:value.parentPid,createdAt:value.createdAt,executable:localPath(value.executable)});
}
const equal=(a,b)=>!!a&&!!b&&a.pid===b.pid&&a.parentPid===b.parentPid&&a.createdAt===b.createdAt&&samePath(a.executable,b.executable);
function snapshotRows(values){
  if(!Array.isArray(values)||values.length>MAX_ROWS)throw failure();const map=new Map();
  // Unrelated inaccessible system processes may have no path/date. Those fields
  // become mandatory only for the exact root and its candidate descendants.
  for(const value of values){if(!value||!validPid(value.pid)||!Number.isSafeInteger(value.parentPid)||value.parentPid<0||map.has(value.pid))throw failure();map.set(value.pid,value);}
  return map;
}
function descendants(map,rootPid){const found=[],pending=[rootPid],seen=new Set(pending);while(pending.length){const parent=pending.shift();for(const value of map.values())if(value.parentPid===parent){if(seen.has(value.pid))throw failure();seen.add(value.pid);found.push(value);pending.push(value.pid);if(found.length>=MAX_TREE)throw failure();}}return found;}

class PythonProcessProof{
  #paths;#host;#parent;#now;#bound=null;#proofs=[];#worker=null;#closed=false;#closing=null;#proving=false;
  constructor({pythonPath,processHost,parentPid=process.pid,systemRoot=process.env.SystemRoot||'C:\\Windows',now=Date.now}={}){
    if(!validPid(parentPid)||typeof now!=='function')throw failure();this.#paths=configuredPaths(pythonPath,systemRoot);this.#host=processHost||createWindowsPythonProcessHost();
    if(!['snapshot','inspect','stop'].every(method=>typeof this.#host[method]==='function'))throw failure();this.#parent=parentPid;this.#now=now;
  }
  bind({pid,startedAt}={}){
    if(this.#bound||this.#closed||!validPid(pid)||pid===this.#parent||!Number.isSafeInteger(startedAt)||startedAt>this.#now()||this.#now()-startedAt>10000)throw failure();
    this.#bound=Object.freeze({pid,startedAt});return {bound:true};
  }
  async #read(){try{return snapshotRows(await this.#host.snapshot());}catch{throw failure();}}
  async #inspect(proofs){
    if(!proofs.length)return [];
    let values;try{values=await this.#host.inspect(proofs.map(value=>value.pid));}catch{throw failure();}
    if(!Array.isArray(values)||values.length>proofs.length)throw failure();const seen=new Set();
    return values.map(value=>{const checked=row(value),expected=proofs.find(item=>item.pid===checked.pid);if(!expected||seen.has(checked.pid)||!equal(checked,expected))throw failure();seen.add(checked.pid);return checked;});
  }
  #capture(map){
    const raw=map.get(this.#bound.pid);if(!raw)throw failure();const root=row(raw);
    if(root.parentPid!==this.#parent||!samePath(root.executable,this.#paths.python)||Date.parse(root.createdAt)<this.#bound.startedAt||Date.parse(root.createdAt)>this.#now()+1000)throw failure();
    const children=descendants(map,root.pid).map(row);let worker=null;const consoles=[];
    for(const child of children){
      if(child.parentPid===root.pid&&samePath(child.executable,this.#paths.base)&&!samePath(this.#paths.python,this.#paths.base)){if(worker)throw failure();worker=child;}
      else if(samePath(child.executable,this.#paths.conhost))consoles.push(child);else throw failure();
    }
    for(const child of children){const parent=child.parentPid===root.pid?root:worker;if(!parent||child.parentPid!==parent.pid||Date.parse(child.createdAt)<Date.parse(parent.createdAt))throw failure();}
    if(consoles.length>1)throw failure();
    return [root,...(worker?[worker]:[]),...consoles];
  }
  async #checkKnown(map){
    const present=[];for(const proof of this.#proofs){const value=map.get(proof.pid);if(value){const current=row(value);if(!equal(current,proof))throw failure();present.push(current);}}
    // An exact recorded orphan remains owned. An unrecorded child is never
    // adopted after its original parent disappeared.
    for(const proof of this.#proofs)for(const child of descendants(map,proof.pid))if(!this.#proofs.some(known=>equal(known,row(child))))throw failure();
    const direct=await this.#inspect(this.#proofs);
    if(direct.length!==present.length||direct.some(value=>!present.some(item=>equal(item,value))))throw failure();return present;
  }
  async proveReady({pid,parentPid}={}){
    if(this.#closed||this.#closing||this.#proving||!this.#bound||!validPid(pid)||!validPid(parentPid))throw failure();this.#proving=true;
    try{
      const initial=this.#capture(await this.#read()),root=initial[0],worker=initial.find(value=>value.pid===pid);
      const redirected=!samePath(this.#paths.python,this.#paths.base);
      if(!worker||worker.parentPid!==parentPid||!(redirected?pid!==root.pid&&parentPid===root.pid&&samePath(worker.executable,this.#paths.base):pid===root.pid&&parentPid===this.#parent))throw failure();
      const direct=await this.#inspect(initial);if(direct.length!==initial.length||this.#closing||this.#closed)throw failure();
      const final=this.#capture(await this.#read());if(final.length!==initial.length||final.some(value=>!initial.some(item=>equal(item,value)))||this.#closing||this.#closed)throw failure();
      this.#proofs=initial;this.#worker=worker;return {verified:true};
    }catch{throw failure();}finally{this.#proving=false;}
  }
  async #close(){
    if(!this.#bound){this.#closed=true;return {closed:true};}
    let first=await this.#read();
    if(!this.#proofs.length){const captured=this.#capture(first),direct=await this.#inspect(captured);if(direct.length!==captured.length)throw failure();this.#proofs=captured;}
    let present=await this.#checkKnown(first),second=await this.#read();
    const checked=await this.#checkKnown(second);if(present.length!==checked.length||present.some(value=>!checked.some(item=>equal(item,value))))throw failure();
    if(checked.length){try{const result=await this.#host.stop(checked);if(result?.stopped!==true)throw failure();}catch{throw failure();}}
    // Never infer process exit from child.killed, redirector close, a stop RPC,
    // a model reply, or a graceful-shutdown acknowledgement alone.
    const after=await this.#read(),remaining=await this.#checkKnown(after);if(remaining.length)throw failure();
    this.#closed=true;return {closed:true};
  }
  close(){if(this.#closed)return Promise.resolve({closed:true});if(this.#closing)return this.#closing;const task=this.#close().catch(()=>{throw failure();}).finally(()=>{if(this.#closing===task)this.#closing=null;});this.#closing=task;return task;}
}

function nativeScript(proofs){
  if(!Array.isArray(proofs)||!proofs.length||proofs.length>MAX_TREE)throw failure();const rows=proofs.map(row);if(new Set(rows.map(value=>value.pid)).size!==rows.length)throw failure();
  const encoded=Buffer.from(JSON.stringify(rows)).toString('base64');
  return `$ErrorActionPreference='Stop'
$proofs=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))
$opened=New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$ok=$false;$watch=[Diagnostics.Stopwatch]::StartNew()
try {
 foreach($proof in $proofs){
  if($watch.ElapsedMilliseconds -ge 5000){throw 'deadline'}
  $p=Get-Process -Id $proof.pid -ErrorAction SilentlyContinue
  if(!$p){continue};$opened.Add($p);$null=$p.Handle
  if($p.HasExited){continue}
  $ticks=$p.StartTime.ToUniversalTime().Ticks;$microTicks=$ticks-($ticks%10)
  if($microTicks -ne ([DateTimeOffset]::Parse($proof.createdAt,[Globalization.CultureInfo]::InvariantCulture)).UtcDateTime.Ticks -or ![string]::Equals($p.MainModule.FileName,$proof.executable,[StringComparison]::OrdinalIgnoreCase)){throw 'identity'}
  $cim=Get-CimInstance Win32_Process -Filter ("ProcessId="+$proof.pid)
  if(!$cim -or $cim.ParentProcessId -ne $proof.parentPid -or $cim.CreationDate.ToUniversalTime().Ticks -ne $microTicks){throw 'parent identity'}
 }
 foreach($p in $opened){if(!$p.HasExited){$left=5000-[int]$watch.ElapsedMilliseconds;if($left -le 0){throw 'deadline'};$p.Kill();$done=$p.WaitForExit($left);if(!$done -or !$p.HasExited){throw 'still alive'}}}
 $ok=$true
}catch{}finally{foreach($p in $opened){try{$p.Dispose()}catch{}}}
ConvertTo-Json -InputObject ([pscustomobject]@{stopped=$ok}) -Compress`;
}
function createWindowsPythonProcessHost({run=execFile,systemRoot=process.env.SystemRoot||'C:\\Windows'}={}){
  const executable=path.join(localPath(systemRoot),'System32','WindowsPowerShell','v1.0','powershell.exe');
  const invoke=(script,timeout=10000)=>new Promise((resolve,reject)=>{try{run(executable,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout,maxBuffer:4*1024*1024},(error,stdout)=>{try{if(error||typeof stdout!=='string'||Buffer.byteLength(stdout)>4*1024*1024)throw failure();resolve(JSON.parse(stdout.replace(/^\uFEFF/,'')));}catch{reject(failure());}});}catch{reject(failure());}});
  const projection=`[pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;createdAt=if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{''};executable=[string]$_.ExecutablePath}`;
  return {
    snapshot:()=>invoke(`$ErrorActionPreference='Stop';$rows=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -gt 0} | ForEach-Object {${projection}});ConvertTo-Json -InputObject $rows -Depth 3 -Compress`),
    inspect:pids=>{if(!Array.isArray(pids)||!pids.length||pids.length>MAX_TREE||pids.some(pid=>!validPid(pid)))return Promise.reject(failure());return invoke(`$ErrorActionPreference='Stop';$rows=@(Get-CimInstance Win32_Process -Filter "${[...new Set(pids)].map(pid=>`ProcessId=${pid}`).join(' OR ')}" | ForEach-Object {${projection}});ConvertTo-Json -InputObject $rows -Depth 3 -Compress`);},
    stop:async proofs=>{const result=await invoke(nativeScript(proofs),8000);if(result?.stopped!==true)throw failure();return {stopped:true};}
  };
}
module.exports={PythonProcessProof,createWindowsPythonProcessHost,nativeScript};
