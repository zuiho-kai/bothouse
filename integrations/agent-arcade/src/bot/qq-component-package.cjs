'use strict';

// Original artifact preparation only: no archive extraction, native execution,
// component selection, credential access or changes to an installed QQ profile.
const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const https=require('node:https');
const {createHash,randomUUID}=require('node:crypto');
const {TextDecoder}=require('node:util');
const MAX_METADATA=256*1024,MAX_RECEIPT=4096,MAX_REDIRECTS=3;
const REPOSITORY='NapNeko/NapCatQQ';
const SHELL_CATALOG=Object.freeze({
  '4.18.42':Object.freeze({version:'4.18.42',tag:'v4.18.42',releaseId:428738017,assetId:691263446,name:'NapCat.Shell.zip',size:35967555,sha256:'02e5ff0f79916c1e04c81c1b4590056406fb4293f1f1300c955e71fd08b2829d',publishedAt:'2026-10-30T07:05:50Z'}),
});
const NODE_CATALOG=Object.freeze({
  '4.18.42':Object.freeze({version:'4.18.42',tag:'v4.18.42',releaseId:428738017,assetId:691263447,name:'NapCat.Shell.Windows.Node.zip',size:124162399,sha256:'77397ac38d66f46383e48f08f35d5f9d37ec575c22069f62d6c600e73b4521ed',publishedAt:'2026-10-30T07:05:50Z'}),
});
// The engine is a main-process constructor choice, never an asset URL supplied
// by a renderer. Shell remains the default with its original receipts/paths.
const CATALOGS=Object.freeze({'napcat-shell':SHELL_CATALOG,'napcat-node':NODE_CATALOG});
function catalog(component){if(typeof component!=='string'||!Object.hasOwn(CATALOGS,component))fail('invalid_request');return CATALOGS[component];}
const messages={
  invalid_request:'Choose a supported, fixed NapCat component release.',
  metadata_invalid:'The official release metadata is missing, oversized or inconsistent with the pinned component artifact.',
  digest_required:'The official asset does not provide the required SHA-256 digest.',
  transport_rejected:'The component transfer used an unsupported URL, redirect or encoding.',
  network_failed:'The official component request failed. No installed component was changed.',
  cancelled:'Component preparation was cancelled. No installed component was changed.',
  timeout:'Component preparation exceeded its time limit. No installed component was changed.',
  size_mismatch:'The received component size differs from the pinned official asset.',
  digest_mismatch:'The received component hash differs from the pinned official asset.',
  unsafe_directory:'The private staging location contains an unsupported path, file or link.',
  artifact_conflict:'An existing staged file conflicts with this verified artifact. It was kept unchanged.',
  staging_failed:'The package could not be staged completely. Existing files and installed components were kept.',
  staging_busy:'Another component preparation is already running in this manager.',
  package_not_staged:'This supported component package has not been verified and staged yet.',
};
class QQComponentPackageError extends Error{constructor(code){super(messages[code]||'Component preparation failed.');this.name=code==='cancelled'?'AbortError':'QQComponentPackageError';this.code=code;}}
const fail=code=>{throw new QQComponentPackageError(code);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
function localPath(value){if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0')||/^[/\\]{2}/.test(value))fail('unsafe_directory');return path.resolve(value);}
function directory(dir,create=false){
  const absolute=localPath(dir),base=path.parse(absolute).root;let current=base;
  for(const part of absolute.slice(base.length).split(path.sep).filter(Boolean)){
    current=path.join(current,part);
    try{const st=fs.lstatSync(current);if(!st.isDirectory()||st.isSymbolicLink())fail('unsafe_directory');}
    catch(error){if(error.code!=='ENOENT'||!create)fail('unsafe_directory');try{fs.mkdirSync(current,{mode:0o700});}catch{fail('unsafe_directory');}}
    if(!samePath(fs.realpathSync(current),current))fail('unsafe_directory');
  }
}
function statFile(file,{missing=false,max=Infinity}={}){
  try{const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>max||!samePath(fs.realpathSync(file),file))fail('unsafe_directory');return st;}
  catch(error){if(missing&&error.code==='ENOENT')return null;if(error instanceof QQComponentPackageError)throw error;fail('unsafe_directory');}
}
const sameFile=(a,b)=>a&&b&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs;
function selected(version,component){const values=catalog(component);if(typeof version!=='string'||!Object.hasOwn(values,version))fail('invalid_request');return {...values[version],component};}
const metadataURL=pin=>`https://api.github.com/repos/${REPOSITORY}/releases/tags/${pin.tag}`;
const assetURL=pin=>`https://github.com/${REPOSITORY}/releases/download/${pin.tag}/${pin.name}`;
const releaseURL=pin=>`https://github.com/${REPOSITORY}/releases/tag/${pin.tag}`;
function allowedURL(value,pin,metadata){
  let url;try{if(typeof value!=='string'||value.length>8192||/[\x00-\x20\x7f]/.test(value))fail('transport_rejected');url=new URL(value);}catch{fail('transport_rejected');}
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash)fail('transport_rejected');
  if(metadata){if(url.href!==metadataURL(pin))fail('transport_rejected');}
  else if(url.hostname==='github.com'){if(url.href!==assetURL(pin))fail('transport_rejected');}
  else if(!['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(url.hostname)||!/^\/github-production-release-asset(?:-2e65be)?\/\d+\/[\w-]+$/.test(url.pathname))fail('transport_rejected');
  return url.href;
}
function defaultTransport(url,{signal,headers}){
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{headers,signal,agent:false},response=>resolve({statusCode:response.statusCode,headers:response.headers,body:response}));
    request.once('error',()=>reject(new QQComponentPackageError('network_failed')));
  });
}
function context(signal,timeoutMs){
  if(signal!=null&&(typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean'))fail('invalid_request');
  const controller=new AbortController(),abort=()=>controller.abort(new QQComponentPackageError('cancelled'));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(()=>controller.abort(new QQComponentPackageError('timeout')),timeoutMs);
  return {signal:controller.signal,check(){if(controller.signal.aborted)throw controller.signal.reason;},close(){clearTimeout(timer);signal?.removeEventListener('abort',abort);}};
}
async function requestTransport(transport,url,headers,ctx){
  ctx.check();return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(error,value)=>{if(done){value?.body?.destroy?.();return;}done=true;ctx.signal.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>finish(ctx.signal.reason);ctx.signal.addEventListener('abort',abort,{once:true});
    if(ctx.signal.aborted){abort();return;}
    Promise.resolve().then(()=>transport(url,{signal:ctx.signal,headers})).then(response=>finish(null,response),()=>finish(ctx.signal.aborted?ctx.signal.reason:new QQComponentPackageError('network_failed')));
  });
}
async function responseFor(transport,pin,metadata,ctx){
  let url=metadata?metadataURL(pin):assetURL(pin);
  const headers={'User-Agent':'Agent-Arcade-Component-Preparer','Accept':metadata?'application/vnd.github+json':'application/octet-stream','Accept-Encoding':'identity',...(metadata?{'X-GitHub-Api-Version':'2022-11-28'}:{})};
  for(let redirect=0;;redirect++){
    const response=await requestTransport(transport,allowedURL(url,pin,metadata),headers,ctx);
    if(!response||!plain(response.headers)||!response.body||typeof response.body.destroy!=='function'||typeof response.body[Symbol.asyncIterator]!=='function'){response?.body?.destroy?.();fail('network_failed');}
    if([301,302,303,307,308].includes(response.statusCode)){
      response.body.destroy();if(redirect>=MAX_REDIRECTS||typeof response.headers.location!=='string')fail('transport_rejected');
      try{url=new URL(response.headers.location,url).href;}catch{fail('transport_rejected');}continue;
    }
    if(response.statusCode!==200){response.body.destroy();fail('network_failed');}
    if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'){response.body.destroy();fail('transport_rejected');}
    const length=response.headers['content-length'];
    if(length!==undefined&&(!/^\d{1,12}$/.test(String(length))||(metadata?Number(length)>MAX_METADATA:Number(length)!==pin.size))){response.body.destroy();fail(metadata?'metadata_invalid':'size_mismatch');}
    return response;
  }
}
async function consume(response,ctx,limit,accept,code){
  let bytes=0;const abort=()=>response.body.destroy();ctx.signal.addEventListener('abort',abort,{once:true});
  try{ctx.check();for await(const chunk of response.body){ctx.check();if(!Buffer.isBuffer(chunk))fail(code);bytes+=chunk.length;if(bytes>limit)fail(code);await accept(chunk);}ctx.check();return bytes;}
  catch(error){ctx.check();if(error instanceof QQComponentPackageError)throw error;fail('network_failed');}
  finally{ctx.signal.removeEventListener('abort',abort);response.body.destroy();}
}
function validateMetadata(value,pin){
  if(!plain(value)||value.id!==pin.releaseId||value.tag_name!==pin.tag||value.draft!==false||value.prerelease!==false||value.html_url!==releaseURL(pin)||value.published_at!==pin.publishedAt||!Array.isArray(value.assets)||value.assets.length>32)fail('metadata_invalid');
  const assets=value.assets.filter(asset=>plain(asset)&&asset.name===pin.name);if(assets.length!==1)fail('metadata_invalid');const asset=assets[0];
  if(typeof asset.digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(asset.digest))fail('digest_required');
  if(asset.id!==pin.assetId||asset.state!=='uploaded'||asset.size!==pin.size||asset.digest!==`sha256:${pin.sha256}`||asset.browser_download_url!==assetURL(pin))fail('metadata_invalid');
  return {component:pin.component,repository:REPOSITORY,...pin,url:assetURL(pin),releaseUrl:releaseURL(pin),source:'github-release-api',checkedAt:new Date().toISOString()};
}
async function inspectRelease(transport,pin,ctx){
  const response=await responseFor(transport,pin,true,ctx),chunks=[];await consume(response,ctx,MAX_METADATA,chunk=>chunks.push(chunk),'metadata_invalid');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{fail('metadata_invalid');}return validateMetadata(value,pin);
}
async function fileHash(file,expected,ctx){
  directory(path.dirname(file));const before=statFile(file);if(before.size!==expected)fail('artifact_conflict');let handle;
  try{
    handle=await fsp.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const opened=await handle.stat();if(!sameFile(before,opened)||opened.nlink!==1)fail('artifact_conflict');
    const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let position=0;
    while(position<expected){ctx.check();const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,expected-position),position);if(!bytesRead)fail('artifact_conflict');hash.update(buffer.subarray(0,bytesRead));position+=bytesRead;}
    ctx.check();if(!sameFile(before,await handle.stat())||!sameFile(before,statFile(file,{max:expected})))fail('artifact_conflict');return hash.digest('hex');
  }catch(error){if(error instanceof QQComponentPackageError)throw error;fail('staging_failed');}finally{await handle?.close();}
}
function receiptValue(pin){return {formatVersion:1,component:pin.component,repository:REPOSITORY,version:pin.version,tag:pin.tag,releaseId:pin.releaseId,assetId:pin.assetId,name:pin.name,size:pin.size,sha256:pin.sha256,source:'github-release-api'};}
function readReceipt(file,pin){
  const stat=statFile(file,{missing:true,max:MAX_RECEIPT});if(!stat)return false;
  let actual,fd;try{
    fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));if(!sameFile(stat,fs.fstatSync(fd)))fail('artifact_conflict');
    const buffer=Buffer.alloc(MAX_RECEIPT+1);let size=0,count;
    do{count=fs.readSync(fd,buffer,size,buffer.length-size,size);size+=count;}while(count&&size<buffer.length);
    if(size>MAX_RECEIPT||size!==stat.size||!sameFile(stat,fs.fstatSync(fd))||!sameFile(stat,statFile(file,{max:MAX_RECEIPT})))fail('artifact_conflict');
    actual=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size)));
  }catch{fail('artifact_conflict');}finally{if(fd!==undefined)fs.closeSync(fd);}
  const expected=receiptValue(pin);if(!plain(actual)||Object.keys(actual).length!==Object.keys(expected).length+1||Object.entries(expected).some(([key,value])=>actual[key]!==value)||typeof actual.verifiedAt!=='string'||actual.verifiedAt.length>64||!Number.isFinite(Date.parse(actual.verifiedAt)))fail('artifact_conflict');return true;
}
class QQComponentPackages {
  constructor({root,component='napcat-shell',transport=defaultTransport,timeoutMs=120000}={}){
    catalog(component);Object.defineProperty(this,'component',{value:component,enumerable:true});
    this.root=localPath(root);if(typeof transport!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)fail('invalid_request');this.transport=transport;this.timeoutMs=timeoutMs;this.busy=false;
  }
  async inspect({version='4.18.42',signal}={}){
    const pin=selected(version,this.component),ctx=context(signal,Math.min(this.timeoutMs,30000));try{return await inspectRelease(this.transport,pin,ctx);}catch(error){if(ctx.signal.aborted)throw ctx.signal.reason;if(error instanceof QQComponentPackageError)throw error;fail('network_failed');}finally{ctx.close();}
  }
  async verify({version='4.18.42',signal}={}){
    const pin=selected(version,this.component),ctx=context(signal,Math.min(this.timeoutMs,30000));
    try{
      ctx.check();const dir=path.join(this.root,'qq-component-packages',this.component,pin.version);
      try{fs.lstatSync(dir);}catch(error){if(error.code==='ENOENT')fail('package_not_staged');throw error;}directory(dir);
      const file=path.join(dir,pin.name);if(!readReceipt(path.join(dir,'verified.json'),pin)||!statFile(file,{missing:true}))fail('package_not_staged');
      if(await fileHash(file,pin.size,ctx)!==pin.sha256)fail('artifact_conflict');ctx.check();
      return {state:'verified-staged',component:pin.component,version:pin.version,file,size:pin.size,sha256:pin.sha256,assetId:pin.assetId,reused:true,source:'local-stage-recheck',upstreamSource:'github-release-api',checkedAt:new Date().toISOString(),installed:false,executed:false};
    }catch(error){if(ctx.signal.aborted)throw ctx.signal.reason;if(error instanceof QQComponentPackageError)throw error;fail('staging_failed');}finally{ctx.close();}
  }
  async stage({version='4.18.42',signal}={}){
    const pin=selected(version,this.component);if(this.busy)fail('staging_busy');const ctx=context(signal,this.timeoutMs);this.busy=true;let part,handle,partIdentity;
    try{
      const manifest=await inspectRelease(this.transport,pin,ctx);ctx.check();
      const dir=path.join(this.root,'qq-component-packages',this.component,pin.version);directory(dir,true);
      const file=path.join(dir,pin.name),receiptFile=path.join(dir,'verified.json');readReceipt(receiptFile,pin);
      let reused=!!statFile(file,{missing:true});
      if(reused){if(await fileHash(file,pin.size,ctx)!==pin.sha256)fail('artifact_conflict');}
      else{
        part=path.join(dir,`.${this.component==='napcat-shell'?'shell':'node'}-${randomUUID()}.part`);handle=await fsp.open(part,'wx',0o600);partIdentity=await handle.stat();const hash=createHash('sha256');
        const response=await responseFor(this.transport,pin,false,ctx);
        const bytes=await consume(response,ctx,pin.size,async chunk=>{hash.update(chunk);let offset=0;while(offset<chunk.length){ctx.check();const {bytesWritten}=await handle.write(chunk,offset,chunk.length-offset);if(!bytesWritten)fail('staging_failed');offset+=bytesWritten;}},'size_mismatch');
        if(bytes!==pin.size)fail('size_mismatch');if(hash.digest('hex')!==pin.sha256)fail('digest_mismatch');
        await handle.sync();const written=await handle.stat();await handle.close();handle=null;ctx.check();directory(dir);
        if(written.nlink!==1||!sameFile(written,statFile(part,{max:pin.size})))fail('unsafe_directory');
        // COPYFILE_EXCL never clobbers an existing file and creates no link.
        // A crash can leave an unverified candidate; only hash + receipt mark
        // a prepared package. Unknown/partial candidates are kept, not erased.
        try{await fsp.copyFile(part,file,fs.constants.COPYFILE_EXCL);}
        catch(error){if(error.code!=='EEXIST')fail('staging_failed');reused=true;}
        if(await fileHash(file,pin.size,ctx)!==pin.sha256)fail('artifact_conflict');
      }
      ctx.check();directory(dir);
      if(!readReceipt(receiptFile,pin)){
        let receiptHandle;
        try{receiptHandle=await fsp.open(receiptFile,'wx',0o600);await receiptHandle.writeFile(JSON.stringify({...receiptValue(pin),verifiedAt:new Date().toISOString()})+'\n');await receiptHandle.sync();}
        catch(error){if(error.code!=='EEXIST')fail('staging_failed');if(!readReceipt(receiptFile,pin))fail('artifact_conflict');}
        finally{await receiptHandle?.close();}
      }
      ctx.check();if(!readReceipt(receiptFile,pin))fail('artifact_conflict');
      return {state:'verified-staged',component:pin.component,version:pin.version,file,size:pin.size,sha256:pin.sha256,assetId:pin.assetId,reused,source:manifest.source,checkedAt:manifest.checkedAt,installed:false,executed:false};
    }catch(error){if(ctx.signal.aborted)throw ctx.signal.reason;if(error instanceof QQComponentPackageError)throw error;fail('staging_failed');}
    finally{
      await handle?.close().catch(()=>{});if(part)try{directory(path.dirname(part));const current=statFile(part);if(current.dev===partIdentity?.dev&&current.ino===partIdentity?.ino)await fsp.unlink(part);}catch{/* Unknown replacements and old installations are never removed. */}
      ctx.close();this.busy=false;
    }
  }
}
module.exports={QQComponentPackages,QQComponentPackageError};
