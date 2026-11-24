'use strict';

// Original, main-process-only first setup. No QQ execution, account-data copy,
// downloader, registry write, credential access, or automatic start.
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {withShellCodeGate}=require('./qq-shell-code-gate.cjs');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile),MAX_EXE=512*1024*1024,MAX_DESCRIPTOR=12288,TTL=5*60*1000;
const VERSION='4.18.42',ID=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hex=value=>typeof value==='string'&&ID.test(value);
const RELEASE_ID='napcat-shell-4.18.42-02e5ff0f79916c1e';
const hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
class QQManagedSetupError extends Error{constructor(code,{committed=false,setupId}={}){super(`QQ setup failed (${code}).`);this.code=code;if(committed)this.committed=true;if(setupId)this.setupId=setupId;}}
const fail=code=>{throw new QQManagedSetupError(code);};
function local(value){if(typeof value!=='string'||value.length>1500||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||/[\0\r\n]/.test(value)||value.slice(2).includes(':'))fail('unsafe_path');return path.resolve(value);}
function safe(file,{directory=false,max=MAX_EXE,io=fs,links=1}={}){
  const resolved=local(file);let cur=resolved,leaf;
  for(;;){const st=io.lstatSync(cur);if(st.isSymbolicLink())fail('unsafe_path');if(cur===resolved){leaf=st;if(directory?!st.isDirectory():!st.isFile()||st.nlink!==links||st.size>max)fail('unsafe_path');}else if(!st.isDirectory())fail('unsafe_path');const next=path.dirname(cur);if(next===cur)break;cur=next;}
  if(!same(io.realpathSync(resolved),resolved))fail('unsafe_path');return leaf;
}
function identity(st){return {dev:st.dev,ino:st.ino,size:st.size,mtimeMs:st.mtimeMs};}
const identical=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs;
function current(signal,assertCurrent){if(signal?.aborted)fail('cancelled');if(assertCurrent){const result=assertCurrent();if(result&&typeof result.then==='function')fail('invalid_request');}if(signal?.aborted)fail('cancelled');}
function bytes(file,max,io=fs,links=1){const before=safe(file,{max,io,links});let fd;try{fd=io.openSync(file,'r');const open=io.fstatSync(fd);if(!identical(before,open)||open.nlink!==links)fail('program_changed');const value=Buffer.alloc(open.size);let pos=0;while(pos<value.length){const n=io.readSync(fd,value,pos,value.length-pos,pos);if(!n)fail('program_changed');pos+=n;}if(!identical(open,io.fstatSync(fd))||!identical(open,safe(file,{max,io,links})))fail('program_changed');return value;}finally{if(fd!==undefined)io.closeSync(fd);}}
function programHash(file,{signal,io=fs}={}){
  const before=safe(file,{io});if(before.size<256||path.basename(file).toLowerCase()!=='qq.exe')fail('invalid_program');let fd;
  try{fd=io.openSync(file,'r');const opened=io.fstatSync(fd);if(!identical(before,opened))fail('program_changed');const header=Buffer.alloc(64);if(io.readSync(fd,header,0,64,0)!==64||header.toString('ascii',0,2)!=='MZ')fail('invalid_program');const pe=header.readUInt32LE(60);if(pe<64||pe>Math.min(before.size-26,1024*1024))fail('invalid_program');const signature=Buffer.alloc(26);if(io.readSync(fd,signature,0,26,pe)!==26||signature.readUInt32LE(0)!==0x4550||signature.readUInt16LE(4)!==0x8664||signature.readUInt16LE(24)!==0x20b)fail('unsupported_architecture');const h=createHash('sha256'),block=Buffer.alloc(1024*1024);let pos=0;while(pos<opened.size){current(signal);const n=io.readSync(fd,block,0,Math.min(block.length,opened.size-pos),pos);if(!n)fail('program_changed');h.update(block.subarray(0,n));pos+=n;}if(!identical(opened,io.fstatSync(fd))||!identical(opened,safe(file,{io})))fail('program_changed');return {...identity(opened),size:opened.size,sha256:h.digest('hex'),architecture:'x64'};}finally{if(fd!==undefined)io.closeSync(fd);}
}
function observed(value){
  const signature=value?.signature;
  if(!value||!['QQ','腾讯QQ'].includes(value.productName)||typeof value.companyName!=='string'||value.companyName.length>128||!/\bTencent\b/i.test(value.companyName)||/[\x00-\x1f\x7f]/.test(value.companyName)||typeof value.version!=='string'||!/^\d{1,3}(?:[.-]\d{1,8}){2,3}$/.test(value.version)||!signature||!['Valid','NotSigned','HashMismatch','NotTrusted','UnknownError','NotSupportedFileFormat','Incompatible'].includes(signature.status))fail('program_unverified');
  const subject=signature.subject??null,thumbprint=signature.thumbprint??null;
  if(subject!==null&&(typeof subject!=='string'||subject.length>512||/[\x00-\x1f\x7f]/.test(subject)))fail('program_unverified');
  if(thumbprint!==null&&(typeof thumbprint!=='string'||!/^[a-fA-F0-9]{40,64}$/.test(thumbprint)))fail('program_unverified');
  return {version:value.version,productName:value.productName,companyName:value.companyName,signature:{status:signature.status,subject,thumbprint:thumbprint?.toLowerCase()??null}};
}
function signatureTrusted(value){return value.status==='Valid'&&typeof value.subject==='string'&&/\bTencent\b/i.test(value.subject)&&typeof value.thumbprint==='string';}
function sanitizedError(error,{committed=false,setupId}={}){const allowed=new Set(['invalid_request','unsafe_path','invalid_program','unsupported_architecture','program_changed','program_unverified','program_running','process_check_failed','cancelled','changed','stale_ticket','expired_ticket','setup_busy','setup_conflict','prepared_invalid','prepared_changed','setup_write_failed','setup_readback_failed','setup_cleanup_incomplete','recovery_unavailable','recovery_changed','recovery_failed','recovery_unconfirmed','shell_repair_recovery_required','shell_repair_changed','shell_repair_unavailable','shell_repair_busy','shell_repair_cleanup_unconfirmed']);return new QQManagedSetupError(allowed.has(error?.code)?error.code:'setup_failed',{committed,setupId});}
function createWindowsProgramObserver({runImpl=run,env=process.env,platform=process.platform}={}){
  return async(file,{signal}={})=>{
    if(platform!=='win32')fail('program_unverified');const system=local(env.SystemRoot||env.WINDIR||'C:\\Windows'),shell=path.join(system,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const file64=Buffer.from(local(file),'utf8').toString('base64');
    const script=`$ErrorActionPreference='Stop';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${file64}'));$i=Get-Item -LiteralPath $p;$s=Get-AuthenticodeSignature -LiteralPath $p;[Console]::Out.Write((@{version=$i.VersionInfo.FileVersion;productName=$i.VersionInfo.ProductName;companyName=$i.VersionInfo.CompanyName;signature=@{status=$s.Status.ToString();subject=if($s.SignerCertificate){$s.SignerCertificate.Subject}else{$null};thumbprint=if($s.SignerCertificate){$s.SignerCertificate.Thumbprint}else{$null}}}|ConvertTo-Json -Depth 4 -Compress))`;
    const clean={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'])if(typeof env[key]==='string')clean[key]=env[key];
    try{const result=await runImpl(shell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,shell:false,env:clean,timeout:15000,maxBuffer:8192,encoding:'utf8',signal});current(signal);return observed(JSON.parse(result.stdout));}catch(error){if(signal?.aborted)fail('cancelled');if(error instanceof QQManagedSetupError)throw error;fail('program_unverified');}
  };
}
function fixedPaths(root,setupId){if(typeof setupId!=='string'||!UUID.test(setupId))fail('invalid_request');const base=path.join(local(root),'qq-installations'),installationRoot=path.join(base,setupId);return {base,installationRoot,descriptor:path.join(installationRoot,'installation.json'),workDir:path.join(installationRoot,'work'),configDir:path.join(installationRoot,'work','config'),qqDataDir:path.join(installationRoot,'qq-data')};}
function descriptorValue(value,{root,setupId}){
  const p=fixedPaths(root,setupId),qq=value?.qq,selected=value?.current;
  if(value?.schema!=='qq_managed_shell_v1'||value.setupId!==setupId||value.installationId!==hash(Buffer.from(p.installationRoot.toLowerCase()))||value.engine!=='managed-shell'||value.dataPolicy!=='isolated-new'||value.previous!==null||!Number.isFinite(Date.parse(value.createdAt))||value.publication?.method!=='exclusive-link-v1'||typeof value.publication.temporaryFile!=='string'||!/^installation\.[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.part$/.test(value.publication.temporaryFile))fail('setup_readback_failed');
  if(!qq||typeof qq.file!=='string'||!same(local(qq.file),qq.file)||path.basename(qq.file).toLowerCase()!=='qq.exe'||qq.architecture!=='x64'||!Number.isSafeInteger(qq.size)||qq.size<256||qq.size>MAX_EXE||!hex(qq.sha256)||!Number.isFinite(Date.parse(qq.observedAt))||!qq.identity||!['dev','ino','size','mtimeMs'].every(k=>Number.isFinite(qq.identity[k])))fail('setup_readback_failed');
  const obs=observed(qq);if(!signatureTrusted(obs.signature)||qq.identity.size!==qq.size)fail('setup_readback_failed');
  if(selected?.kind!=='prepared'||selected.version!==VERSION||selected.versionId!==RELEASE_ID||!hex(selected.manifestSha256))fail('setup_readback_failed');
  return {schema:value.schema,setupId,installationId:value.installationId,engine:'managed-shell',dataPolicy:'isolated-new',createdAt:value.createdAt,publication:{method:'exclusive-link-v1',temporaryFile:value.publication.temporaryFile},qq:{file:qq.file,architecture:qq.architecture,size:qq.size,sha256:qq.sha256,identity:{...qq.identity},...obs,observedAt:qq.observedAt},current:{kind:'prepared',version:VERSION,versionId:RELEASE_ID,manifestSha256:selected.manifestSha256},previous:null};
}
function readManagedShellInstallation({root,setupId,io=fs}={}){
  const p=fixedPaths(root,setupId);try{const raw=bytes(p.descriptor,MAX_DESCRIPTOR,io),value=descriptorValue(JSON.parse(raw),{root,setupId});for(const dir of [p.installationRoot,p.workDir,p.configDir,p.qqDataDir])safe(dir,{directory:true,io});return {...value,...p,prepared:{...value.current},descriptorSha256:hash(raw),verification:'metadata-only'};}catch(error){throw sanitizedError(error);}
}

class QQManagedShellSetup{
  constructor({root,prepared,programObserver=createWindowsProgramObserver(),processHost,io=fs,now=Date.now}={}){
    this.root=local(root);if(typeof prepared?.resolvePrepared!=='function'||typeof programObserver!=='function'||typeof processHost?.snapshot!=='function')fail('invalid_request');this.prepared=prepared;this.programObserver=programObserver;this.processHost=processHost;this.io=io;this.now=now;this.tickets=new Map();this.busy=false;
  }
  discardTickets(){this.tickets.clear();}
  async inspect({qqExe,signal}={}){
    try{const file=local(qqExe);current(signal);const before=programHash(file,{signal,io:this.io}),obs=observed(await this.programObserver(file,{signal}));current(signal);const after=programHash(file,{signal,io:this.io});if(!identical(before,after)||before.sha256!==after.sha256)fail('program_changed');
      for(const [id,t]of this.tickets)if(t.expiresAt<=this.now())this.tickets.delete(id);if(this.tickets.size>=8)fail('setup_busy');const ticketId=randomUUID(),expiresAt=this.now()+TTL;this.tickets.set(ticketId,{file,program:before,obs,expiresAt});return {ticketId,expiresAt,qq:{version:obs.version,architecture:'x64',size:before.size,sha256:before.sha256,signature:structuredClone(obs.signature)},canInitialize:signatureTrusted(obs.signature),compatibility:'not-tested'};
    }catch(error){throw sanitizedError(error);}
  }
  async _stopped(file){let rows;try{rows=await this.processHost.snapshot();}catch{fail('process_check_failed');}if(!Array.isArray(rows)||rows.length>4096)fail('process_check_failed');for(const r of rows){if(!r||!Number.isSafeInteger(r.pid)||r.pid<1||typeof r.name!=='string'||typeof r.executable!=='string')fail('process_check_failed');if(r.name.toLowerCase()==='napcatqq-desktop.exe')fail('program_running');if(r.name.toLowerCase()==='qq.exe'&&(!path.isAbsolute(r.executable)||same(r.executable,file)))fail('program_running');}}
  async _prepared(versionId,signal){const item=await this.prepared.resolvePrepared(versionId,{signal});current(signal);const base=path.join(this.root,'qq-component-versions','napcat-shell',RELEASE_ID);if(item?.versionId!==RELEASE_ID||item.version!==VERSION||!hex(item.manifestSha256)||!same(item.codeRoot,path.join(base,'code'))||!same(item.manifestPath,path.join(base,'prepared.json')))fail('prepared_invalid');safe(item.codeRoot,{directory:true,io:this.io});if(hash(bytes(item.manifestPath,2*1024*1024,this.io))!==item.manifestSha256)fail('prepared_changed');return {kind:'prepared',version:VERSION,versionId:RELEASE_ID,manifestSha256:item.manifestSha256};}
  _recoveryPlan(setupId){
    const p=fixedPaths(this.root,setupId),directory=safe(p.installationRoot,{directory:true,io:this.io});
    const raw=bytes(p.descriptor,MAX_DESCRIPTOR,this.io,2),value=descriptorValue(JSON.parse(raw),{root:this.root,setupId}),temp=path.join(p.installationRoot,value.publication.temporaryFile);
    const first=safe(p.descriptor,{max:MAX_DESCRIPTOR,io:this.io,links:2}),second=safe(temp,{max:MAX_DESCRIPTOR,io:this.io,links:2});
    if(!identical(first,second)||!bytes(temp,MAX_DESCRIPTOR,this.io,2).equals(raw))fail('recovery_unavailable');
    // This recovery knows exactly one recorded temporary name. Any additional
    // top-level file/link is retained for inspection rather than guessed at.
    const names=this.io.readdirSync(p.installationRoot);if(names.length!==4||JSON.stringify(names.sort())!==JSON.stringify(['installation.json','qq-data','work',value.publication.temporaryFile].sort()))fail('recovery_unavailable');
    for(const dir of [p.workDir,p.configDir,p.qqDataDir])safe(dir,{directory:true,io:this.io});
    const end=safe(p.installationRoot,{directory:true,io:this.io}),a=safe(p.descriptor,{max:MAX_DESCRIPTOR,io:this.io,links:2}),b=safe(temp,{max:MAX_DESCRIPTOR,io:this.io,links:2});
    const proof=st=>({...identity(st),nlink:st.nlink,ctimeMs:st.ctimeMs,birthtimeMs:st.birthtimeMs});
    if(!identical(directory,end)||JSON.stringify(proof(first))!==JSON.stringify(proof(a))||JSON.stringify(proof(second))!==JSON.stringify(proof(b)))fail('recovery_changed');
    const descriptorSha256=hash(raw),binding={setupId,installationId:value.installationId,root:p.installationRoot.toLowerCase(),temporaryFile:value.publication.temporaryFile,directory:proof(end),descriptor:proof(a),temporary:proof(b),descriptorSha256};
    return {...p,temp,setupId,descriptorSha256,descriptorIdentity:identity(a),directoryIdentity:identity(end),expectedDigest:hash(Buffer.from(JSON.stringify(binding)))};
  }
  async inspectRecovery({setupId,signal}={}){
    if(this.busy)fail('setup_busy');current(signal);try{const plan=this._recoveryPlan(setupId);current(signal);return {kind:'descriptor-publication',setupId,expectedDigest:plan.expectedDigest,temporaryLinksToRemove:1,descriptorPreserved:true,automaticStart:false};}catch(error){if(error?.code==='cancelled')throw error;throw new QQManagedSetupError(error?.code==='invalid_request'?'invalid_request':'recovery_unavailable');}
  }
  _recovered(plan){
    try{this.io.lstatSync(plan.temp);return false;}catch(error){if(error.code!=='ENOENT')throw error;}
    const directory=safe(plan.installationRoot,{directory:true,io:this.io}),st=safe(plan.descriptor,{max:MAX_DESCRIPTOR,io:this.io});
    if(directory.dev!==plan.directoryIdentity.dev||directory.ino!==plan.directoryIdentity.ino||!identical(st,plan.descriptorIdentity)||hash(bytes(plan.descriptor,MAX_DESCRIPTOR,this.io))!==plan.descriptorSha256)return false;
    return true;
  }
  async confirmRecovery({setupId,expectedDigest,signal,assertCurrent}={}){
    if(this.busy)fail('setup_busy');if(!hex(expectedDigest)||assertCurrent!==undefined&&typeof assertCurrent!=='function')fail('invalid_request');current(signal,assertCurrent);this.busy=true;let committed=false,attempted=false,plan;
    try{
      plan=this._recoveryPlan(setupId);if(plan.expectedDigest!==expectedDigest)fail('recovery_changed');current(signal,assertCurrent);
      // No await/callback between this final full identity+byte check and unlink.
      const final=this._recoveryPlan(setupId);if(final.expectedDigest!==expectedDigest)fail('recovery_changed');
      attempted=true;try{this.io.unlinkSync(final.temp);committed=true;}catch{
        try{committed=this._recovered(final);}catch{}
        if(!committed){let unchanged=false;try{unchanged=this._recoveryPlan(setupId).expectedDigest===expectedDigest;}catch{}const error=new QQManagedSetupError(unchanged?'recovery_failed':'recovery_unconfirmed');if(!unchanged)error.recoveryAttempted=true;throw error;}
      }
      try{if(!this._recovered(final))fail('recovery_unconfirmed');const read=readManagedShellInstallation({root:this.root,setupId,io:this.io});if(read.descriptorSha256!==final.descriptorSha256)fail('recovery_unconfirmed');return {kind:'descriptor-publication',setupId,committed:true,recovered:true,descriptorSha256:final.descriptorSha256,verification:'metadata-only',automaticStart:false};}
      catch{return {kind:'descriptor-publication',setupId,committed:true,recovered:true,recoveryIssue:'recovery_unconfirmed',verification:'unconfirmed',automaticStart:false};}
    }catch(error){if(error?.code==='recovery_unconfirmed'&&error.recoveryAttempted===true)throw error;const fixed=sanitizedError(error,{committed,setupId:committed?setupId:undefined});if(attempted&&!committed&&error?.code!=='recovery_failed')fixed.recoveryAttempted=true;throw fixed;}
    finally{this.busy=false;}
  }
  async initialize({ticketId,versionId=RELEASE_ID,signal,assertCurrent}={}){
    if(this.busy)fail('setup_busy');if(typeof ticketId!=='string'||!UUID.test(ticketId)||versionId!==RELEASE_ID||assertCurrent!==undefined&&typeof assertCurrent!=='function')fail('invalid_request');const ticket=this.tickets.get(ticketId);if(!ticket)fail('stale_ticket');this.tickets.delete(ticketId);if(ticket.expiresAt<=this.now())fail('expired_ticket');if(!signatureTrusted(ticket.obs.signature))fail('program_unverified');this.busy=true;
    try{return await withShellCodeGate({root:this.root,signal},gate=>this._initialize({ticket,versionId,signal,assertCurrent},gate));}
    finally{this.busy=false;}
  }
  async _initialize({ticket,versionId,signal,assertCurrent},gate){
    const setupId=randomUUID(),p=fixedPaths(this.root,setupId),made=[],ownedFiles=[];let descriptor,raw,committed=false,failure,receipt;
    const check=()=>{gate();require('./qq-managed-shell-repair-metadata.cjs').assertManagedShellRepairReady({root:this.root});current(signal,assertCurrent);};
    const mkdir=dir=>{safe(path.dirname(dir),{directory:true,io:this.io});try{this.io.mkdirSync(dir,{mode:0o700});}catch(error){if(error.code==='EEXIST')fail('setup_conflict');throw error;}made.push({dir,stat:identity(this.io.lstatSync(dir))});safe(dir,{directory:true,io:this.io});};
    const owned=()=>{for(const item of made){const st=safe(item.dir,{directory:true,io:this.io});if(st.dev!==item.stat.dev||st.ino!==item.stat.ino)fail('setup_conflict');}};
    const verifyProgram=async()=>{const a=programHash(ticket.file,{signal,io:this.io});if(!identical(a,ticket.program)||a.sha256!==ticket.program.sha256)fail('program_changed');const obs=observed(await this.programObserver(ticket.file,{signal}));check();const b=programHash(ticket.file,{signal,io:this.io});if(!identical(a,b)||a.sha256!==b.sha256||JSON.stringify(obs)!==JSON.stringify(ticket.obs))fail('program_changed');};
    try{
      check();safe(this.root,{directory:true,io:this.io});await this._stopped(ticket.file);check();await verifyProgram();check();const selected=await this._prepared(versionId,signal);check();
      try{safe(p.base,{directory:true,io:this.io});}catch(error){if(error.code!=='ENOENT')throw error;mkdir(p.base);}mkdir(p.installationRoot);mkdir(p.workDir);mkdir(p.configDir);mkdir(p.qqDataDir);owned();
      const temporaryFile=`installation.${randomUUID()}.part`,temp=path.join(p.installationRoot,temporaryFile);
      descriptor={schema:'qq_managed_shell_v1',setupId,installationId:hash(Buffer.from(p.installationRoot.toLowerCase())),engine:'managed-shell',dataPolicy:'isolated-new',createdAt:new Date(this.now()).toISOString(),publication:{method:'exclusive-link-v1',temporaryFile},qq:{file:ticket.file,architecture:'x64',size:ticket.program.size,sha256:ticket.program.sha256,identity:identity(ticket.program),...ticket.obs,observedAt:new Date(this.now()).toISOString()},current:selected,previous:null};raw=Buffer.from(JSON.stringify(descriptor,null,2)+'\n');if(raw.length>MAX_DESCRIPTOR)fail('setup_write_failed');
      let fd;try{fd=this.io.openSync(temp,'wx',0o600);ownedFiles.push({file:temp,stat:identity(this.io.fstatSync(fd)),expected:hash(raw)});this.io.writeFileSync(fd,raw);this.io.fsyncSync(fd);}finally{if(fd!==undefined)this.io.closeSync(fd);}owned();check();await verifyProgram();check();await this._stopped(ticket.file);check();const finalPrepared=await this._prepared(versionId,signal);check();if(JSON.stringify(finalPrepared)!==JSON.stringify(selected))fail('prepared_changed');owned();if(!bytes(temp,MAX_DESCRIPTOR,this.io).equals(raw))fail('setup_write_failed');
      if(this.io.readdirSync(p.configDir).length||this.io.readdirSync(p.qqDataDir).length||JSON.stringify(this.io.readdirSync(p.workDir).sort())!==JSON.stringify(['config'])||JSON.stringify(this.io.readdirSync(p.installationRoot).sort())!==JSON.stringify([path.basename(temp),'qq-data','work'].sort()))fail('setup_conflict');check();
      // An exclusive hard-link publishes complete durable bytes without ever
      // replacing an unknown target. The private temporary link is then removed.
      try{this.io.linkSync(temp,p.descriptor);committed=true;}catch(error){try{const a=this.io.lstatSync(temp),b=this.io.lstatSync(p.descriptor);if(a.dev===b.dev&&a.ino===b.ino&&!b.isSymbolicLink())committed=true;}catch{}if(!committed)throw error;}
      try{this.io.unlinkSync(temp);}catch{fail('setup_cleanup_incomplete');}ownedFiles.length=0;
      const read=readManagedShellInstallation({root:this.root,setupId,io:this.io});if(read.descriptorSha256!==hash(raw))fail('setup_readback_failed');receipt={committed:true,setupId,installationId:descriptor.installationId,installationRoot:p.installationRoot,descriptorSha256:hash(raw),current:structuredClone(selected),previous:null,automaticStart:false,compatibility:'not-tested'};
    }catch(error){failure=sanitizedError(error,{committed,setupId:committed?setupId:undefined});}
    finally{
      if(!committed){for(const item of ownedFiles.reverse()){try{const st=this.io.lstatSync(item.file);if(st.dev===item.stat.dev&&st.ino===item.stat.ino&&!st.isSymbolicLink()&&st.nlink===1&&hash(bytes(item.file,MAX_DESCRIPTOR,this.io))===item.expected)this.io.unlinkSync(item.file);}catch{}}for(const item of made.reverse()){try{const st=this.io.lstatSync(item.dir);if(st.dev===item.stat.dev&&st.ino===item.stat.ino&&!st.isSymbolicLink())this.io.rmdirSync(item.dir);}catch{/* Unknown children or replacements are retained. */}}}
      this.busy=false;
    }
    if(failure)throw failure;return receipt;
  }
}
module.exports={QQManagedShellSetup,QQManagedSetupError,readManagedShellInstallation,createWindowsProgramObserver,RELEASE_ID,VERSION,programHash};
