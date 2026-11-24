'use strict';
// Original preparation only. No installed QQ data, component selection or
// executable is touched. The archive parser is the pinned upstream yauzl.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path');
const {createHash}=require('node:crypto');
const {QQPreparationRecovery}=require('./qq-component-preparation-recovery.cjs');
const {withNodeCodeGate}=require('./qq-node-code-gate.cjs');
const {withShellCodeGate}=require('./qq-shell-code-gate.cjs');
const {crc32}=require('node:zlib');
const {promisify}=require('node:util');
const yauzl=require('yauzl');
const read=promisify(fs.read),fstat=promisify(fs.fstat);
const MAX_ENTRIES=10000,MAX_TOTAL=512*1024*1024,MAX_FILE=128*1024*1024,MAX_RATIO=250,MAX_MANIFEST=2*1024*1024,MAX_DEPTH=16,MAX_METADATA=8*1024*1024;
const LAYOUTS=Object.freeze({
  'napcat-shell':Object.freeze({schema:'qq_component_prepared_v1',required:Object.freeze(['NapCatWinBootHook.dll','NapCatWinBootMain.exe','napcat.mjs','qqnt.json']),staticPrefix:'static/'}),
  'napcat-node':Object.freeze({schema:'qq_node_component_prepared_v1',required:Object.freeze(['node.exe','index.js','wrapper.node','package.json','config.json','QQNT.dll','napcat/napcat.mjs']),staticPrefix:'napcat/static/'}),
});
function layout(component){if(typeof component!=='string'||!Object.hasOwn(LAYOUTS,component))fail('invalid_request');return LAYOUTS[component];}
const messages={invalid_request:'Choose a supported staged component version.',archive_invalid:'The verified archive has an unsupported or corrupt layout.',archive_unsafe:'The archive contains an unsafe path, link or conflicting entry.',archive_limit:'The archive exceeds preparation limits.',artifact_changed:'The staged archive changed during preparation.',unsafe_directory:'The private version directory is unavailable or contains links.',version_exists:'This version directory already exists and was kept unchanged. Inspect it before reuse.',prepare_busy:'Another component preparation is running.',prepare_failed:'Component preparation failed; no installed component was changed.',cancelled:'Component preparation was cancelled; no installed component was changed.',timeout:'Component preparation exceeded its time limit.',prepared_invalid:'The prepared version or manifest is missing, changed or invalid.'};
class QQComponentPrepareError extends Error{constructor(code){super(messages[code]||messages.prepare_failed);this.name=code==='cancelled'?'AbortError':'QQComponentPrepareError';this.code=code;}}
const fail=code=>{throw new QQComponentPrepareError(code);};
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
const sameFile=(a,b)=>a&&b&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs;
function localPath(value){if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0')||/^[/\\]{2}/.test(value))fail('unsafe_directory');return path.resolve(value);}
function directory(dir,create=false,created){
  const absolute=localPath(dir),base=path.parse(absolute).root;let current=base;
  for(const part of absolute.slice(base.length).split(path.sep).filter(Boolean)){
    current=path.join(current,part);
    try{const st=fs.lstatSync(current);if(!st.isDirectory()||st.isSymbolicLink())fail('unsafe_directory');}
    catch(error){if(error.code!=='ENOENT'||!create)throw error instanceof QQComponentPrepareError?error:new QQComponentPrepareError('unsafe_directory');fs.mkdirSync(current,{mode:0o700});created?.push({path:current,stat:fs.lstatSync(current)});}
    if(!samePath(fs.realpathSync(current),current))fail('unsafe_directory');
  }
}
function regular(file,max){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>max||!samePath(fs.realpathSync(file),file))fail('unsafe_directory');return st;}
function emptyNodeRuntimeLog(component,version,relative,file){
  // The pinned native QQ bundle creates this empty diagnostic file beside its
  // binary on first execution. It is not executable package content. Only this
  // observed empty, regular, unlinked sidecar is tolerated; nonempty logs, links,
  // new paths and all modified manifest files still fail the integrity check.
  if(component!=='napcat-node'||version!=='4.18.42'||relative!=='beacon_report.log')return false;
  const before=regular(file,0);let fd;
  try{fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));return sameFile(before,fs.fstatSync(fd))&&sameFile(before,regular(file,0));}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}
function entryPath(value){
  if(typeof value!=='string'||!value||value.length>240||value.includes('\\')||/[:\p{Cc}\p{Cf}\u2028\u2029\ufffd]/u.test(value)||value!==value.normalize('NFC')||value.startsWith('/'))fail('archive_unsafe');
  const isDir=value.endsWith('/'),name=isDir?value.slice(0,-1):value,parts=name.split('/');
  if(parts.length>MAX_DEPTH||parts.some(v=>!v||v==='.'||v==='..'||/[. ]$/.test(v)||/[<>"|?*]/.test(v)||/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(v)))fail('archive_unsafe');
  return {name,isDir,parts};
}
function inside(root,relative){const target=path.resolve(root,...relative.split('/')),rel=path.relative(root,target);if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))fail('unsafe_directory');return target;}
function context(signal,timeoutMs){
  if(signal!=null&&(typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean'))fail('invalid_request');
  const controller=new AbortController(),abort=()=>controller.abort(new QQComponentPrepareError('cancelled'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(()=>controller.abort(new QQComponentPrepareError('timeout')),timeoutMs);
  return {signal:controller.signal,check(){if(controller.signal.aborted)throw controller.signal.reason;},close(){clearTimeout(timer);signal?.removeEventListener('abort',abort);}};
}
async function hashFd(fd,size,ctx){const hash=createHash('sha256'),buffer=Buffer.alloc(65536);for(let pos=0;pos<size;){ctx.check();const {bytesRead}=await read(fd,buffer,0,Math.min(buffer.length,size-pos),pos);if(!bytesRead)fail('artifact_changed');hash.update(buffer.subarray(0,bytesRead));pos+=bytesRead;}ctx.check();return hash.digest('hex');}
function pinResult(value,version,component){if(!plain(value)||value.component!==component||value.version!==version||value.state!=='verified-staged'||typeof value.file!=='string'||!Number.isSafeInteger(value.size)||value.size<1||value.size>128*1024*1024||!Number.isSafeInteger(value.assetId)||value.assetId<1||!/^[a-f0-9]{64}$/.test(value.sha256))fail('invalid_request');localPath(value.file);return {tag:`v${version}`,assetId:value.assetId,sha256:value.sha256,size:value.size};}
const versionName=(version,sha,component)=>`${component}-${version}-${sha.slice(0,16)}`;
function parseVersionId(value,component){const match=typeof value==='string'&&/^(napcat-shell|napcat-node)-(\d+\.\d+\.\d+)-([a-f0-9]{16})$/.exec(value);if(!match||match[1]!==component)fail('invalid_request');return match[2];}
async function scan(zip,ctx,definition){
  if(!Number.isInteger(zip.entryCount)||zip.entryCount<1||zip.entryCount>MAX_ENTRIES)fail('archive_limit');
  const entries=[],names=new Map();let total=0,metadata=0;
  for await(const entry of zip.eachEntry()){
    ctx.check();if(entries.length>=MAX_ENTRIES)fail('archive_limit');const p=entryPath(entry.fileName),mode=(entry.externalFileAttributes>>>16)&0xffff,type=mode&0xf000,dos=entry.externalFileAttributes&0xffff;
    if(entry.isEncrypted()||![0,8].includes(entry.compressionMethod)||![0,0x8000,0x4000].includes(type)||Boolean(type===0x4000||dos&0x10)!==p.isDir||(dos&0x448)||entry.extraFields.some(v=>[0x756e,0x000d].includes(v.id)))fail('archive_unsafe');
    if(!Number.isSafeInteger(entry.uncompressedSize)||!Number.isSafeInteger(entry.compressedSize)||entry.uncompressedSize<0||entry.compressedSize<0||entry.uncompressedSize>MAX_FILE||entry.uncompressedSize>Math.max(1,entry.compressedSize)*MAX_RATIO)fail('archive_limit');
    if(p.isDir&&(entry.uncompressedSize!==0||entry.compressedSize!==0))fail('archive_invalid');
    total+=entry.uncompressedSize;metadata+=Buffer.byteLength(entry.fileName)+Buffer.byteLength(entry.fileComment||'')+entry.extraFields.reduce((sum,row)=>sum+row.data.length,0);if(total>MAX_TOTAL||metadata>MAX_METADATA)fail('archive_limit');
    for(let i=1;i<=p.parts.length;i++){
      const name=p.parts.slice(0,i).join('/'),key=name.toLowerCase(),isDir=i<p.parts.length||p.isDir,existing=names.get(key),explicit=i===p.parts.length;
      if(existing&&(existing.name!==name||existing.isDir!==isDir||(!isDir)||explicit&&existing.explicit))fail('archive_unsafe');
      names.set(key,{name,isDir,explicit:explicit||existing?.explicit||false});
    }
    entries.push({entry,...p});
  }
  const files=entries.filter(e=>!e.isDir);if(definition.required.some(name=>!files.some(e=>e.name===name&&e.entry.uncompressedSize>0))||!files.some(e=>e.name.startsWith(definition.staticPrefix)))fail('archive_invalid');
  return {entries,files,total,directories:[...names.values()].filter(v=>v.isDir).map(v=>v.name).sort(cmp)};
}
function cleanup(createdFiles,createdDirs,versionDir,versionBase){
  // Only our exact new tree is eligible. No recursive delete, shared component
  // directory or unknown replacement is removed after cancellation/failure.
  try{directory(versionBase);if(path.dirname(versionDir)!==versionBase)return;}catch{return;}
  for(const item of [...createdFiles].reverse())try{directory(path.dirname(item.path));const current=regular(item.path,MAX_TOTAL);if(sameFile(current,item.stat))fs.unlinkSync(item.path);}catch{/* Preserve unknown replacements. */}
  for(const item of [...createdDirs].reverse())try{const relative=path.relative(versionDir,item.path);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))continue;const current=fs.lstatSync(item.path);if(current.isDirectory()&&!current.isSymbolicLink()&&current.dev===item.stat.dev&&current.ino===item.stat.ino&&samePath(fs.realpathSync(item.path),item.path))fs.rmdirSync(item.path);}catch{/* Nonempty or changed directories are retained. */}
}
function checkNewTree(codeRoot,inventory,createdFiles){
  const files=new Map(createdFiles.map(row=>[row.path,row])),dirs=new Set(inventory.directories),queue=[{path:codeRoot,relative:''}];let found=0,foundDirs=0;
  while(queue.length){const current=queue.pop();directory(current.path);for(const entry of fs.readdirSync(current.path,{withFileTypes:true})){
    const relative=current.relative?`${current.relative}/${entry.name}`:entry.name,target=inside(codeRoot,relative),stat=fs.lstatSync(target);
    if(stat.isDirectory()&&!stat.isSymbolicLink()){if(!dirs.has(relative)||++foundDirs>dirs.size)fail('unsafe_directory');queue.push({path:target,relative});}
    else{const expected=files.get(target);if(!expected||!sameFile(expected.stat,regular(target,MAX_FILE))||++found>files.size)fail('unsafe_directory');}
  }}
  if(found!==files.size||foundDirs!==dirs.size)fail('unsafe_directory');
}
class QQComponentPrepared{
  constructor({root,packages,component='napcat-shell',timeoutMs=120000,lockRoot,processHost}={}){layout(component);Object.defineProperty(this,'component',{value:component,enumerable:true});this.root=localPath(root);this.base=path.join(this.root,'qq-component-versions',component);if(!packages||typeof packages.verify!=='function'||packages.component!==undefined&&packages.component!==component||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)fail('invalid_request');this.packages=packages;this.timeoutMs=timeoutMs;this.busy=false;this.preparationRecovery=new QQPreparationRecovery({root:this.root,packages,component,lockRoot,processHost});}
  async prepare({version='4.18.42',signal,gate}={}){
    if(this.busy)fail('prepare_busy');if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))fail('invalid_request');const ctx=context(signal,this.timeoutMs);this.busy=true;
    try{const run=async held=>{ctx.check();held?.();if(this.component==='napcat-node')require('./qq-managed-node-repair-metadata.cjs').assertManagedNodeRepairReady({root:this.root});else require('./qq-managed-shell-repair-metadata.cjs').assertManagedShellRepairReady({root:this.root});const artifact=await this.packages.verify({version,signal:ctx.signal}),source=pinResult(artifact,version,this.component),versionId=versionName(version,source.sha256,this.component);ctx.check();held?.();
      return this.preparationRecovery.runWriter({version,source,versionId,signal:ctx.signal,gate:held},writer=>this._extract({artifact,source,versionId,version,ctx,writer}));
      };
      return await (this.component==='napcat-node'?withNodeCodeGate({root:this.root,signal:ctx.signal,gate},run):withShellCodeGate({root:this.root,signal:ctx.signal,gate},run));
    }finally{ctx.close();this.busy=false;}
  }
  async _extract({artifact,source,versionId,version,ctx,writer}){
    let fd,zip,versionDir,created=false,committed=false;const createdFiles=[],createdDirs=[];
    try{
      ctx.check();directory(path.dirname(artifact.file));const before=regular(artifact.file,128*1024*1024);if(before.size!==source.size)fail('artifact_changed');
      fd=fs.openSync(artifact.file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));if(!sameFile(before,await fstat(fd))||await hashFd(fd,source.size,ctx)!==source.sha256)fail('artifact_changed');
      zip=await yauzl.fromFdPromise(fd,{autoClose:false,lazyEntries:true,decodeStrings:true,strictFileNames:true,validateEntrySizes:true});zip.on('error',()=>{});
      const inventory=await scan(zip,ctx,layout(this.component));ctx.check();directory(this.base,true);versionDir=path.join(this.base,versionId);
      try{fs.mkdirSync(versionDir,{mode:0o700});created=true;createdDirs.push({path:versionDir,stat:fs.lstatSync(versionDir)});}catch(error){if(error.code==='EEXIST')fail('version_exists');throw error;}
      writer.allocated(versionDir,{files:inventory.files.map(row=>({path:row.name,size:row.entry.uncompressedSize})),directories:inventory.directories});
      const codeRoot=path.join(versionDir,'code');directory(codeRoot,true,createdDirs);const files=[];
      for(const item of inventory.entries){
        ctx.check();const target=inside(codeRoot,item.name);if(item.isDir){directory(target,true,createdDirs);continue;}directory(path.dirname(target),true,createdDirs);let output,stream,record;
        try{
          output=await fsp.open(target,'wx',0o600);record={path:target,stat:await output.stat()};createdFiles.push(record);const hash=createHash('sha256');let size=0,crc=0;
          stream=await zip.openReadStreamPromise(item.entry);const abort=()=>stream.destroy(ctx.signal.reason);ctx.signal.addEventListener('abort',abort,{once:true});
          try{ctx.check();for await(const chunk of stream){ctx.check();size+=chunk.length;if(size>item.entry.uncompressedSize||size>MAX_FILE)fail('archive_limit');hash.update(chunk);crc=crc32(chunk,crc);let offset=0;while(offset<chunk.length){ctx.check();const {bytesWritten}=await output.write(chunk,offset,chunk.length-offset);if(!bytesWritten)fail('prepare_failed');offset+=bytesWritten;}}}
          finally{ctx.signal.removeEventListener('abort',abort);stream.destroy();}
          if(size!==item.entry.uncompressedSize||crc!==item.entry.crc32)fail('archive_invalid');await output.sync();record.stat=await output.stat();if(!sameFile(record.stat,regular(target,MAX_FILE)))fail('unsafe_directory');files.push({path:item.name,size,sha256:hash.digest('hex')});
        }finally{if(output){record.stat=await output.stat().catch(()=>record.stat);await output.close();}stream?.destroy();}
      }
      ctx.check();if(!sameFile(before,await fstat(fd))||!sameFile(before,regular(artifact.file,source.size))||await hashFd(fd,source.size,ctx)!==source.sha256)fail('artifact_changed');
      files.sort((a,b)=>cmp(a.path,b.path));const manifest={schema:layout(this.component).schema,component:this.component,versionId,version,source,preparedAt:new Date().toISOString(),requiredFiles:layout(this.component).required,directories:inventory.directories,files};
      const bytes=Buffer.from(JSON.stringify(manifest)+'\n');if(bytes.length>MAX_MANIFEST)fail('archive_limit');directory(versionDir);checkNewTree(codeRoot,inventory,createdFiles);if(fs.readdirSync(versionDir).join('|')!=='code')fail('unsafe_directory');ctx.check();writer.publishing();writer.assertOwned();const manifestPath=path.join(versionDir,'prepared.json');let handle,manifestRecord;
      try{handle=await fsp.open(manifestPath,'wx',0o600);manifestRecord={path:manifestPath,stat:await handle.stat()};createdFiles.push(manifestRecord);await handle.writeFile(bytes);await handle.sync();manifestRecord.stat=await handle.stat();}
      finally{if(handle){manifestRecord.stat=await handle.stat().catch(()=>manifestRecord.stat);await handle.close();}}
      ctx.check();if(!sameFile(manifestRecord.stat,regular(manifestPath,MAX_MANIFEST)))fail('unsafe_directory');
      committed=true;return {state:'prepared',component:this.component,versionId,version,manifestSha256:createHash('sha256').update(bytes).digest('hex'),manifestBytes:bytes.length,fileCount:files.length,totalBytes:inventory.total,source,installed:false,executed:false};
    }catch(error){if(ctx.signal.aborted)throw ctx.signal.reason;if(error instanceof QQComponentPrepareError||error?.name==='QQPreparationRecoveryError'||error?.code?.startsWith('preparation_'))throw error;if(error?.code&&['artifact_conflict','invalid_request','unsafe_directory','package_not_staged'].includes(error.code))throw error;if(['ENOSPC','EACCES','EPERM','EIO','ENOTDIR','EISDIR','ENOENT','EEXIST','EBUSY','EMFILE','ENFILE','EROFS','EBADF'].includes(error?.code))fail('prepare_failed');throw new QQComponentPrepareError(fd!==undefined?'archive_invalid':'prepare_failed');}
    finally{
      if(zip)await new Promise(resolve=>{zip.once('close',resolve);zip.close();});else if(fd!==undefined)fs.closeSync(fd);
      if(created&&!committed)cleanup(createdFiles,createdDirs,versionDir,this.base);
    }
  }
  async listPrepared(){
    // Discovery only: no ZIP/code hashing, network access or trusted readiness
    // claim. Selection must still use resolvePrepared and bind its digest.
    const items=[],issues=new Set();let listing;
    try{if(!fs.existsSync(this.base))return {items,issues:[]};directory(this.base);listing=fs.opendirSync(this.base);let entry,count=0;
      while((entry=listing.readSync())){if(++count>32){issues.add('list_limit');break;}let fd;
        try{const version=parseVersionId(entry.name,this.component),dir=path.join(this.base,entry.name);directory(dir);const file=path.join(dir,'prepared.json'),before=regular(file,MAX_MANIFEST);fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));if(!sameFile(before,fs.fstatSync(fd)))fail('prepared_invalid');const bytes=Buffer.alloc(before.size);let offset=0;while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)fail('prepared_invalid');offset+=n;}if(!sameFile(before,fs.fstatSync(fd))||!sameFile(before,regular(file,MAX_MANIFEST)))fail('prepared_invalid');const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),source=value.source;
          if(!plain(value)||value.schema!==layout(this.component).schema||value.component!==this.component||value.versionId!==entry.name||value.version!==version||!plain(source)||source.tag!==`v${version}`||!Number.isSafeInteger(source.assetId)||source.assetId<1||!Number.isSafeInteger(source.size)||source.size<1||source.size>128*1024*1024||!/^[a-f0-9]{64}$/.test(source.sha256)||versionName(version,source.sha256,this.component)!==entry.name||!Array.isArray(value.files)||!value.files.length||value.files.length>MAX_ENTRIES)fail('prepared_invalid');
          let total=0,last='';for(const row of value.files){if(!plain(row)||typeof row.path!=='string'||entryPath(row.path).isDir||row.path<=last||!Number.isSafeInteger(row.size)||row.size<0||row.size>MAX_FILE||!/^[a-f0-9]{64}$/.test(row.sha256))fail('prepared_invalid');last=row.path;total+=row.size;if(total>MAX_TOTAL)fail('prepared_invalid');}
          items.push({state:'prepared-metadata',component:this.component,versionId:entry.name,version,manifestSha256:createHash('sha256').update(bytes).digest('hex'),manifestBytes:bytes.length,fileCount:value.files.length,totalBytes:total,source:{tag:source.tag,assetId:source.assetId,sha256:source.sha256,size:source.size},verified:false});
        }catch{issues.add('prepared_invalid');}finally{if(fd!==undefined)fs.closeSync(fd);}
      }
    }catch{issues.add('unsafe_directory');}finally{listing?.closeSync();}
    return {items:items.sort((a,b)=>cmp(a.versionId,b.versionId)),issues:[...issues]};
  }
  async resolvePrepared(versionId,{signal}={}){
    const version=parseVersionId(versionId,this.component),ctx=context(signal,this.timeoutMs);
    try{
      ctx.check();const artifact=await this.packages.verify({version,signal:ctx.signal}),source=pinResult(artifact,version,this.component);if(versionName(version,source.sha256,this.component)!==versionId)fail('prepared_invalid');
      const versionDir=path.join(this.base,versionId),codeRoot=path.join(versionDir,'code'),manifestPath=path.join(versionDir,'prepared.json');directory(versionDir);directory(codeRoot);const before=regular(manifestPath,MAX_MANIFEST);let fd,bytes;
      try{fd=fs.openSync(manifestPath,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));if(!sameFile(before,await fstat(fd)))fail('prepared_invalid');bytes=Buffer.alloc(before.size);let pos=0;while(pos<bytes.length){ctx.check();const {bytesRead}=await read(fd,bytes,pos,bytes.length-pos,pos);if(!bytesRead)fail('prepared_invalid');pos+=bytesRead;}if(!sameFile(before,await fstat(fd))||!sameFile(before,regular(manifestPath,MAX_MANIFEST)))fail('prepared_invalid');}finally{if(fd!==undefined)fs.closeSync(fd);}
      let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('prepared_invalid');}
      if(!plain(value)||value.schema!==layout(this.component).schema||value.component!==this.component||value.versionId!==versionId||value.version!==version||JSON.stringify(value.source)!==JSON.stringify(source)||typeof value.preparedAt!=='string'||!Number.isFinite(Date.parse(value.preparedAt))||JSON.stringify(value.requiredFiles)!==JSON.stringify(layout(this.component).required)||!Array.isArray(value.files)||!value.files.length||value.files.length>MAX_ENTRIES||!Array.isArray(value.directories)||value.directories.length>MAX_ENTRIES*MAX_DEPTH)fail('prepared_invalid');
      const expected=new Map(),expectedDirs=new Set();let total=0,last='';
      for(const item of value.files){if(!plain(item)||typeof item.path!=='string'||entryPath(item.path).isDir||item.path<=last||!Number.isSafeInteger(item.size)||item.size<0||item.size>MAX_FILE||!/^[a-f0-9]{64}$/.test(item.sha256))fail('prepared_invalid');last=item.path;total+=item.size;if(total>MAX_TOTAL)fail('prepared_invalid');expected.set(item.path,item);}
      last='';for(const name of value.directories){if(typeof name!=='string'||entryPath(name).isDir||name<=last)fail('prepared_invalid');last=name;expectedDirs.add(name);}
      if(layout(this.component).required.some(name=>!expected.has(name)||!expected.get(name).size)||![...expected.keys()].some(name=>name.startsWith(layout(this.component).staticPrefix)))fail('prepared_invalid');
      const found=[],foundDirs=[],queue=[{dir:codeRoot,rel:''}];
      while(queue.length){ctx.check();const current=queue.pop();directory(current.dir);for(const entry of fs.readdirSync(current.dir,{withFileTypes:true})){const rel=current.rel?`${current.rel}/${entry.name}`:entry.name,target=inside(codeRoot,rel);entryPath(rel);const stat=fs.lstatSync(target);if(stat.isSymbolicLink())fail('prepared_invalid');if(stat.isDirectory()){if(!expectedDirs.has(rel)||foundDirs.length>MAX_ENTRIES*MAX_DEPTH)fail('prepared_invalid');foundDirs.push(rel);queue.push({dir:target,rel});}else{const item=expected.get(rel);if(!item&&emptyNodeRuntimeLog(this.component,version,rel,target))continue;if(!item||found.length>=MAX_ENTRIES)fail('prepared_invalid');let fd;try{const before=regular(target,MAX_FILE);if(before.size!==item.size)fail('prepared_invalid');fd=fs.openSync(target,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));if(!sameFile(before,await fstat(fd))||await hashFd(fd,item.size,ctx)!==item.sha256||!sameFile(before,await fstat(fd))||!sameFile(before,regular(target,MAX_FILE)))fail('prepared_invalid');}finally{if(fd!==undefined)fs.closeSync(fd);}found.push(rel);}}}
      if(found.length!==expected.size||foundDirs.length!==expectedDirs.size||!sameFile(before,regular(manifestPath,MAX_MANIFEST))||fs.readdirSync(versionDir).sort().join('|')!=='code|prepared.json')fail('prepared_invalid');ctx.check();
      return {versionId,version,codeRoot,manifestPath,manifestSha256:createHash('sha256').update(bytes).digest('hex'),manifestBytes:bytes.length,files:value.files,source};
    }catch(error){if(ctx.signal.aborted)throw ctx.signal.reason;throw new QQComponentPrepareError('prepared_invalid');}finally{ctx.close();}
  }
}
module.exports={QQComponentPrepared,QQComponentPrepareError};
