'use strict';

// Original, main-only Node installation metadata. No execution, account-data
// import, downloader or selection change. Shell publication remains unchanged.
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {withNodeCodeGate}=require('./qq-node-code-gate.cjs');
const MAX_DESCRIPTOR=12288,MAX_MANIFEST=2*1024*1024;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const VERSION='4.18.42',RELEASE_ID='napcat-node-4.18.42-77397ac38d66f463';
const SOURCE=Object.freeze({tag:'v4.18.42',assetId:691263447,sha256:'77397ac38d66f46383e48f08f35d5f9d37ec575c22069f62d6c600e73b4521ed',size:124162399});
// Fixed official asset inventory. Node's version comes from the release recipe;
// QQ's version comes from the root package/config, never napcat/qqnt.json.
const FILES=Object.freeze(Object.fromEntries(Object.entries({
  'node.exe':{size:80511640,sha256:'7447c4ece014aa41fb2ff866c993c708e5a8213a00913cc2ac5049ea3ffc230d'},
  'index.js':{size:639,sha256:'5de31bef6cc1b48cef0229a8b22b32b3211e41253c3e75a9547e996becf9b388'},
  'wrapper.node':{size:104663600,sha256:'a1e59891e743c271d641ee011f47aa887d9f7dfae6b3bb9292a03af759dec203'},
  'package.json':{size:486,sha256:'56387b6ec1b4d129d3790c09fb5c5949a6e92f01cae162d7def4a49d9ed402e3'},
  'config.json':{size:159,sha256:'0b4e7719005a7065be522c943b351a20f5d30182f719f7e2db9925d5a71273e8'},
  'QQNT.dll':{size:481280,sha256:'2f9ae01c30fa624535439cab9ccc2ba56d95e5f2ec85e6182789cb3c9089f3b7'},
  'napcat/napcat.mjs':{size:3344922,sha256:'7967149b1c4f3d30e0506c842f84b7b925c2d361e3c9c75ebf0d4ff24dbdedaa'},
}).map(([key,value])=>[key,Object.freeze(value)])));
const hash=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const keys=(value,names)=>plain(value)&&Object.keys(value).sort().join('|')===[...names].sort().join('|');
const CODES=new Set(['invalid_request','unsafe_path','program_running','process_check_failed','cancelled','changed','setup_busy','setup_conflict','prepared_invalid','prepared_changed','setup_write_failed','setup_readback_failed','setup_cleanup_incomplete','recovery_unavailable','recovery_changed','recovery_failed','recovery_unconfirmed','node_repair_recovery_required','node_repair_changed','node_repair_unavailable','node_repair_busy','node_repair_cleanup_unconfirmed']);
class QQManagedNodeSetupError extends Error{
  constructor(code,{committed=false,setupId}={}){const safe=CODES.has(code)?code:'setup_failed';super(`QQ Node setup failed (${safe}).`);this.code=safe;if(committed)this.committed=true;if(typeof setupId==='string'&&UUID.test(setupId))this.setupId=setupId;}
}
const fail=code=>{throw new QQManagedNodeSetupError(code);};
const sanitized=(error,options)=>new QQManagedNodeSetupError(error?.code,options);
function local(value){if(typeof value!=='string'||value.length>1500||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||/[\0\r\n]/.test(value)||value.slice(2).includes(':'))fail('unsafe_path');return path.resolve(value);}
function safe(file,{directory=false,max=MAX_MANIFEST,io=fs,links=1}={}){
  const resolved=local(file);let cursor=resolved,leaf;
  for(;;){const st=io.lstatSync(cursor);if(st.isSymbolicLink())fail('unsafe_path');if(cursor===resolved){leaf=st;if(directory?!st.isDirectory():!st.isFile()||st.nlink!==links||st.size>max)fail('unsafe_path');}else if(!st.isDirectory())fail('unsafe_path');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
  if(!same(io.realpathSync(resolved),resolved))fail('unsafe_path');return leaf;
}
const identity=st=>({dev:st.dev,ino:st.ino,size:st.size,mtimeMs:st.mtimeMs});
const identical=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs;
function bytes(file,max,io=fs,links=1){
  const before=safe(file,{max,io,links});let fd;
  try{fd=io.openSync(file,'r');const opened=io.fstatSync(fd);if(!identical(before,opened)||opened.nlink!==links)fail('setup_readback_failed');const value=Buffer.alloc(opened.size);let pos=0;while(pos<value.length){const n=io.readSync(fd,value,pos,value.length-pos,pos);if(!n)fail('setup_readback_failed');pos+=n;}if(!identical(opened,io.fstatSync(fd))||!identical(opened,safe(file,{max,io,links})))fail('setup_readback_failed');return value;}finally{if(fd!==undefined)io.closeSync(fd);}
}
function current(signal,assertCurrent){
  if(signal!==undefined&&(!signal||typeof signal.aborted!=='boolean'||typeof signal.addEventListener!=='function'))fail('invalid_request');
  if(assertCurrent!==undefined&&typeof assertCurrent!=='function')fail('invalid_request');
  if(signal?.aborted)fail('cancelled');if(assertCurrent){const result=assertCurrent();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});fail('invalid_request');}}if(signal?.aborted)fail('cancelled');
}
function fixedPaths(root,setupId){
  if(typeof setupId!=='string'||!UUID.test(setupId))fail('invalid_request');
  const base=path.join(local(root),'qq-node-installations'),installationRoot=path.join(base,setupId);
  const versionRoot=path.join(local(root),'qq-component-versions','napcat-node',RELEASE_ID);
  return {base,installationRoot,descriptor:path.join(installationRoot,'installation.json'),instancesRoot:path.join(installationRoot,'instances'),codeRoot:path.join(versionRoot,'code'),manifestPath:path.join(versionRoot,'prepared.json')};
}
const fileValue=file=>({file,...FILES[file]});
function staticMetadata(){return {node:{version:'22.11.0',architecture:'x64',...fileValue('node.exe'),versionSource:'official-release-recipe'},qq:{version:'9.9.31-49738',versionSource:'root-package-and-config'},entry:fileValue('index.js'),native:{wrapper:fileValue('wrapper.node'),package:fileValue('package.json'),config:fileValue('config.json'),qqnt:fileValue('QQNT.dll'),napcat:fileValue('napcat/napcat.mjs')}};}
function descriptorValue(value,{root,setupId}){
  const p=fixedPaths(root,setupId),selected=value?.current,metadata=staticMetadata();
  if(!keys(value,['schema','setupId','installationId','engine','dataPolicy','createdAt','publication','node','qq','entry','native','current','previous'])||value.schema!=='qq_managed_node_v1'||value.setupId!==setupId||value.installationId!==hash(p.installationRoot.toLowerCase())||value.engine!=='managed-node'||value.dataPolicy!=='isolated-new'||value.previous!==null||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt)))fail('setup_readback_failed');
  if(!keys(value.publication,['method','temporaryFile'])||value.publication.method!=='exclusive-link-v1'||typeof value.publication.temporaryFile!=='string'||!/^installation\.[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.part$/.test(value.publication.temporaryFile))fail('setup_readback_failed');
  if(!keys(selected,['kind','version','versionId','manifestSha256'])||selected.kind!=='prepared'||selected.version!==VERSION||selected.versionId!==RELEASE_ID||!hex(selected.manifestSha256))fail('setup_readback_failed');
  for(const name of Object.keys(metadata))if(!equal(value[name],metadata[name]))fail('setup_readback_failed');
  return {...value,...metadata,current:{...selected},publication:{...value.publication}};
}
function readManagedNodeInstallation({root,setupId,io=fs}={}){
  const p=fixedPaths(root,setupId);
  try{const raw=bytes(p.descriptor,MAX_DESCRIPTOR,io),value=descriptorValue(JSON.parse(raw),{root,setupId});for(const dir of [p.installationRoot,p.instancesRoot,p.codeRoot])safe(dir,{directory:true,io});if(hash(bytes(p.manifestPath,MAX_MANIFEST,io))!==value.current.manifestSha256)fail('prepared_changed');return {...value,...p,prepared:{...value.current},descriptorSha256:hash(raw),verification:'metadata-only'};}catch(error){throw sanitized(error);}
}
class QQManagedNodeSetup{
  constructor({root,prepared,processHost,io=fs,now=Date.now}={}){
    this.root=local(root);if(typeof prepared?.resolvePrepared!=='function'||prepared.component!==undefined&&prepared.component!=='napcat-node'||typeof processHost?.snapshot!=='function'||typeof now!=='function')fail('invalid_request');
    this.prepared=prepared;this.processHost=processHost;this.io=io;this.now=now;this.busy=false;
  }
  async _stopped(codeRoot){
    let rows;try{rows=await this.processHost.snapshot();}catch{fail('process_check_failed');}
    if(!Array.isArray(rows)||rows.length>4096)fail('process_check_failed');
    const executable=path.join(codeRoot,'node.exe');
    for(const row of rows){if(!row||!Number.isSafeInteger(row.pid)||row.pid<1||typeof row.name!=='string'||typeof row.executable!=='string')fail('process_check_failed');if(same(row.executable,executable)||row.name.toLowerCase()==='node.exe'&&(!path.isAbsolute(row.executable)||/^[/\\]{2}/.test(row.executable)))fail('program_running');}
  }
  async _prepared(versionId,signal){
    const item=await this.prepared.resolvePrepared(versionId,{signal});current(signal);
    const base=path.join(this.root,'qq-component-versions','napcat-node',RELEASE_ID),codeRoot=path.join(base,'code'),manifestPath=path.join(base,'prepared.json');
    if(item?.versionId!==RELEASE_ID||item.version!==VERSION||!hex(item.manifestSha256)||!same(item.codeRoot,codeRoot)||!same(item.manifestPath,manifestPath)||!equal(item.source,SOURCE)||!Array.isArray(item.files))fail('prepared_invalid');
    safe(codeRoot,{directory:true,io:this.io});const raw=bytes(manifestPath,MAX_MANIFEST,this.io);if(hash(raw)!==item.manifestSha256)fail('prepared_changed');let manifest;try{manifest=JSON.parse(raw);}catch{fail('prepared_invalid');}
    if(manifest.schema!=='qq_node_component_prepared_v1'||manifest.component!=='napcat-node'||manifest.versionId!==RELEASE_ID||manifest.version!==VERSION||!equal(manifest.source,SOURCE)||!equal(manifest.files,item.files)||item.files.length>10000)fail('prepared_invalid');
    for(const [file,pin]of Object.entries(FILES)){const matches=item.files.filter(row=>row.path===file);if(matches.length!==1||matches[0].size!==pin.size||matches[0].sha256!==pin.sha256)fail('prepared_invalid');}
    return {kind:'prepared',version:VERSION,versionId:RELEASE_ID,manifestSha256:item.manifestSha256};
  }
  async initialize({versionId=RELEASE_ID,signal,assertCurrent}={}){
    if(this.busy)fail('setup_busy');if(versionId!==RELEASE_ID)fail('invalid_request');current(signal,assertCurrent);this.busy=true;
    try{return await withNodeCodeGate({root:this.root,signal},gate=>this._initialize({versionId,signal,assertCurrent},gate));}
    finally{this.busy=false;}
  }
  async _initialize({versionId,signal,assertCurrent},gate){
    const setupId=randomUUID(),p=fixedPaths(this.root,setupId),made=[],ownedFiles=[];let raw,committed=false,failure,receipt;
    const check=()=>{gate();require('./qq-managed-node-repair-metadata.cjs').assertManagedNodeRepairReady({root:this.root});current(signal,assertCurrent);};
    const mkdir=dir=>{safe(path.dirname(dir),{directory:true,io:this.io});try{this.io.mkdirSync(dir,{mode:0o700});}catch(error){if(error.code==='EEXIST')fail('setup_conflict');throw error;}made.push({dir,stat:identity(this.io.lstatSync(dir))});safe(dir,{directory:true,io:this.io});};
    const owned=()=>{for(const item of made){const st=safe(item.dir,{directory:true,io:this.io});if(st.dev!==item.stat.dev||st.ino!==item.stat.ino)fail('setup_conflict');}};
    try{
      check();safe(this.root,{directory:true,io:this.io});const selected=await this._prepared(versionId,signal);check();await this._stopped(p.codeRoot);check();
      try{safe(p.base,{directory:true,io:this.io});}catch(error){if(error.code!=='ENOENT')throw error;mkdir(p.base);}mkdir(p.installationRoot);mkdir(p.instancesRoot);owned();
      const temporaryFile=`installation.${randomUUID()}.part`,temp=path.join(p.installationRoot,temporaryFile);
      const descriptor={schema:'qq_managed_node_v1',setupId,installationId:hash(p.installationRoot.toLowerCase()),engine:'managed-node',dataPolicy:'isolated-new',createdAt:new Date(this.now()).toISOString(),publication:{method:'exclusive-link-v1',temporaryFile},...staticMetadata(),current:selected,previous:null};
      descriptorValue(descriptor,{root:this.root,setupId});raw=Buffer.from(JSON.stringify(descriptor,null,2)+'\n');if(raw.length>MAX_DESCRIPTOR)fail('setup_write_failed');
      let fd;try{fd=this.io.openSync(temp,'wx',0o600);ownedFiles.push({file:temp,stat:identity(this.io.fstatSync(fd)),expected:hash(raw)});this.io.writeFileSync(fd,raw);this.io.fsyncSync(fd);}finally{if(fd!==undefined)this.io.closeSync(fd);}
      owned();check();await this._stopped(p.codeRoot);check();const finalPrepared=await this._prepared(versionId,signal);check();if(!equal(finalPrepared,selected))fail('prepared_changed');owned();
      if(!bytes(temp,MAX_DESCRIPTOR,this.io).equals(raw))fail('setup_write_failed');
      if(this.io.readdirSync(p.instancesRoot).length||!equal(this.io.readdirSync(p.installationRoot).sort(),[temporaryFile,'instances'].sort()))fail('setup_conflict');
      // Complete durable bytes become visible by exclusive link. Never rename
      // over an existing descriptor, and never claim rollback after publication.
      try{this.io.linkSync(temp,p.descriptor);committed=true;}catch(error){try{const a=this.io.lstatSync(temp),b=this.io.lstatSync(p.descriptor);if(a.dev===b.dev&&a.ino===b.ino&&!b.isSymbolicLink())committed=true;}catch{}if(!committed)throw error;}
      try{this.io.unlinkSync(temp);}catch{fail('setup_cleanup_incomplete');}ownedFiles.length=0;
      const read=readManagedNodeInstallation({root:this.root,setupId,io:this.io});if(read.descriptorSha256!==hash(raw))fail('setup_readback_failed');
      receipt={committed:true,setupId,installationId:descriptor.installationId,installationRoot:p.installationRoot,descriptorSha256:hash(raw),current:{...selected},previous:null,automaticStart:false,compatibility:'not-tested'};
    }catch(error){failure=sanitized(error,{committed,setupId:committed?setupId:undefined});}
    finally{
      if(!committed){for(const item of ownedFiles.reverse())try{const st=this.io.lstatSync(item.file);if(st.dev===item.stat.dev&&st.ino===item.stat.ino&&!st.isSymbolicLink()&&st.nlink===1&&hash(bytes(item.file,MAX_DESCRIPTOR,this.io))===item.expected)this.io.unlinkSync(item.file);}catch{}
        for(const item of made.reverse())try{const st=this.io.lstatSync(item.dir);if(st.dev===item.stat.dev&&st.ino===item.stat.ino&&!st.isSymbolicLink())this.io.rmdirSync(item.dir);}catch{/* Preserve unknown children/replacements. */}}
    }
    if(failure)throw failure;return receipt;
  }
  _recoveryPlan(setupId){
    const p=fixedPaths(this.root,setupId),directory=safe(p.installationRoot,{directory:true,io:this.io});
    const raw=bytes(p.descriptor,MAX_DESCRIPTOR,this.io,2),value=descriptorValue(JSON.parse(raw),{root:this.root,setupId}),temp=path.join(p.installationRoot,value.publication.temporaryFile);
    const first=safe(p.descriptor,{max:MAX_DESCRIPTOR,io:this.io,links:2}),second=safe(temp,{max:MAX_DESCRIPTOR,io:this.io,links:2});
    if(!identical(first,second)||!bytes(temp,MAX_DESCRIPTOR,this.io,2).equals(raw))fail('recovery_unavailable');
    if(!equal(this.io.readdirSync(p.installationRoot).sort(),['installation.json','instances',value.publication.temporaryFile].sort()))fail('recovery_unavailable');
    safe(p.instancesRoot,{directory:true,io:this.io});
    const proof=st=>({...identity(st),nlink:st.nlink,ctimeMs:st.ctimeMs,birthtimeMs:st.birthtimeMs});
    const end=safe(p.installationRoot,{directory:true,io:this.io}),a=safe(p.descriptor,{max:MAX_DESCRIPTOR,io:this.io,links:2}),b=safe(temp,{max:MAX_DESCRIPTOR,io:this.io,links:2});
    if(!identical(directory,end)||!equal(proof(first),proof(a))||!equal(proof(second),proof(b)))fail('recovery_changed');
    const descriptorSha256=hash(raw),binding={setupId,installationId:value.installationId,root:p.installationRoot.toLowerCase(),temporaryFile:value.publication.temporaryFile,directory:proof(end),descriptor:proof(a),temporary:proof(b),descriptorSha256};
    return {...p,temp,setupId,descriptorSha256,descriptorIdentity:identity(a),directoryIdentity:identity(end),expectedDigest:hash(JSON.stringify(binding))};
  }
  async inspectRecovery({setupId,signal}={}){
    if(this.busy)fail('setup_busy');current(signal);try{const plan=this._recoveryPlan(setupId);current(signal);return {kind:'descriptor-publication',setupId,expectedDigest:plan.expectedDigest,temporaryLinksToRemove:1,descriptorPreserved:true,automaticStart:false};}catch(error){if(error?.code==='cancelled')throw error;throw new QQManagedNodeSetupError(error?.code==='invalid_request'?'invalid_request':'recovery_unavailable');}
  }
  _recovered(plan){
    try{this.io.lstatSync(plan.temp);return false;}catch(error){if(error.code!=='ENOENT')throw error;}
    const directory=safe(plan.installationRoot,{directory:true,io:this.io}),st=safe(plan.descriptor,{max:MAX_DESCRIPTOR,io:this.io});
    return directory.dev===plan.directoryIdentity.dev&&directory.ino===plan.directoryIdentity.ino&&identical(st,plan.descriptorIdentity)&&hash(bytes(plan.descriptor,MAX_DESCRIPTOR,this.io))===plan.descriptorSha256;
  }
  async confirmRecovery({setupId,expectedDigest,signal,assertCurrent}={}){
    if(this.busy)fail('setup_busy');if(!hex(expectedDigest))fail('invalid_request');current(signal,assertCurrent);this.busy=true;
    try{return await withNodeCodeGate({root:this.root,signal},gate=>this._confirmRecovery({setupId,expectedDigest,signal,assertCurrent},gate));}
    finally{this.busy=false;}
  }
  async _confirmRecovery({setupId,expectedDigest,signal,assertCurrent},gate){
    let committed=false,attempted=false;
    const check=()=>{gate();require('./qq-managed-node-repair-metadata.cjs').assertManagedNodeRepairReady({root:this.root});current(signal,assertCurrent);};
    try{
      check();
      const readPlan=()=>{try{return this._recoveryPlan(setupId);}catch(error){if(error?.code==='invalid_request')throw error;fail('recovery_changed');}};
      const plan=readPlan();if(plan.expectedDigest!==expectedDigest)fail('recovery_changed');check();
      const final=readPlan();if(final.expectedDigest!==expectedDigest)fail('recovery_changed');
      check();
      attempted=true;try{this.io.unlinkSync(final.temp);committed=true;}catch{
        try{committed=this._recovered(final);}catch{}
        if(!committed){let unchanged=false;try{unchanged=this._recoveryPlan(setupId).expectedDigest===expectedDigest;}catch{}const error=new QQManagedNodeSetupError(unchanged?'recovery_failed':'recovery_unconfirmed');if(!unchanged)error.recoveryAttempted=true;throw error;}
      }
      try{if(!this._recovered(final))fail('recovery_unconfirmed');const read=readManagedNodeInstallation({root:this.root,setupId,io:this.io});if(read.descriptorSha256!==final.descriptorSha256)fail('recovery_unconfirmed');return {kind:'descriptor-publication',setupId,committed:true,recovered:true,descriptorSha256:final.descriptorSha256,verification:'metadata-only',automaticStart:false};}
      catch{return {kind:'descriptor-publication',setupId,committed:true,recovered:true,recoveryIssue:'recovery_unconfirmed',verification:'unconfirmed',automaticStart:false};}
    }catch(error){if(error?.code==='recovery_unconfirmed'&&error.recoveryAttempted===true)throw error;const fixed=sanitized(error,{committed,setupId:committed?setupId:undefined});if(attempted&&!committed&&error?.code!=='recovery_failed')fixed.recoveryAttempted=true;throw fixed;}
  }
}
module.exports={QQManagedNodeSetup,QQManagedNodeSetupError,readManagedNodeInstallation,RELEASE_ID,VERSION,NODE_FILES:FILES};
