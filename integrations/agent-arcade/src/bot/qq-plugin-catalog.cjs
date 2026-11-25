'use strict';
// Original static artifact discovery. Never calls NapCat, imports plugin code,
// sends credentials, follows mirrors or interprets an index as a signature.
const https=require('node:https');
const {createHash}=require('node:crypto');
const SUPPORTED_IDS=Object.freeze(['napcat-plugin-builtin','napcat-plugin-cleaner','napcat-plugin-ssqq','napcat-plugin-qce']);
const MAX_METADATA=2*1024*1024,MAX_ARCHIVE=64*1024*1024;
const REPO='NapNeko/napcat-plugin-index',API='https://api.github.com';
const INDEX=`${API}/repos/${REPO}/contents/plugins.v4.json?ref=main`;
const CODES=new Set(['invalid_request','catalog_expired','catalog_invalid','unsupported_plugin','release_invalid','release_changed','digest_required','digest_mismatch','size_mismatch','transport_rejected','network_failed','cancelled','timeout']);
class QQPluginCatalogError extends Error{constructor(code){const safe=CODES.has(code)?code:'network_failed';super(`Plugin catalog unavailable (${safe}).`);this.code=safe;this.name=safe==='cancelled'?'AbortError':'QQPluginCatalogError';}}
const fail=code=>{throw new QQPluginCatalogError(code);};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const hash=b=>createHash('sha256').update(b).digest('hex');
const text=(x,n)=>typeof x==='string'&&x.length>0&&x.length<=n&&!/[\p{Cc}\p{Cf}]/u.test(x);
function context(signal,ms){
 if(signal!=null&&(typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean'))fail('invalid_request');
 const controller=new AbortController(),abort=()=>controller.abort(new QQPluginCatalogError('cancelled'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const timer=setTimeout(()=>controller.abort(new QQPluginCatalogError('timeout')),ms);
 return {signal:controller.signal,check(){if(controller.signal.aborted)throw controller.signal.reason;},close(){clearTimeout(timer);signal?.removeEventListener('abort',abort);}};
}
function transport(url,{signal,headers}){return new Promise((resolve,reject)=>{const req=https.get(url,{signal,headers,agent:false},r=>resolve({statusCode:r.statusCode,headers:r.headers,body:r}));req.once('error',reject);});}
function urlParts(value){
 let u;try{u=new URL(value);}catch{fail('catalog_invalid');}
 if(u.protocol!=='https:'||u.hostname!=='github.com'||u.port||u.username||u.password||u.search||u.hash||u.href!==value)fail('catalog_invalid');
 const m=/^\/([A-Za-z0-9_-]{1,100})\/([A-Za-z0-9_.-]{1,100})\/releases\/download\/([^/]{1,200})\/([^/]{1,200}\.zip)$/.exec(u.pathname);if(!m)fail('catalog_invalid');
 let tag,name;try{tag=decodeURIComponent(m[3]);name=decodeURIComponent(m[4]);}catch{fail('catalog_invalid');}
 if(!text(tag,100)||!text(name,180)||/[\\/\s?#]/.test(tag)||/[\\/\x00-\x1f]/.test(name)||tag==='.'||tag==='..')fail('catalog_invalid');
 return {repository:`${m[1]}/${m[2]}`,tag,assetName:name};
}
function minimumSupported(value){if(!/^\d+\.\d+\.\d+$/.test(value))return false;const a=value.split('.').map(Number),b=[4,18,42];for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]<b[i];}return true;}
function entry(row){
 if(!plain(row)||!text(row.id,100)||!/^napcat-plugin-[a-z0-9-]+$/.test(row.id)||!text(row.name,120)||!text(row.version,80)||!text(row.description,2048)||!text(row.author,160)||!text(row.homepage,1000)||!text(row.minVersion,40)||!Array.isArray(row.tags)||row.tags.length>16||row.tags.some(x=>!text(x,64)))fail('catalog_invalid');
 const source=urlParts(row.downloadUrl),supported=SUPPORTED_IDS.includes(row.id)&&minimumSupported(row.minVersion);
 return {id:row.id,name:row.name,version:row.version,description:row.description,author:row.author,homepage:row.homepage,tags:[...row.tags],minVersion:row.minVersion,supported,...(!supported?{reason:SUPPORTED_IDS.includes(row.id)?'component_version_unsupported':'loader_unsupported'}:{}),downloadUrl:row.downloadUrl,...source};
}
class QQPluginCatalog{
 constructor({transport:request=transport,now=Date.now,timeoutMs=120000}={}){if(typeof request!=='function'||typeof now!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)fail('invalid_request');this.request=request;this.now=now;this.timeoutMs=timeoutMs;this.snapshot=null;}
 async _body(url,{ctx,limit=MAX_METADATA,asset=false,exactSize}={}){
  const initial=url;for(let redirects=0;;redirects++){
   ctx.check();let u;try{u=new URL(url);}catch{fail('transport_rejected');}
   const first=url===initial;if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||(!first&&(!asset||!['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname)||!/^\/github-production-release-asset(?:-2e65be)?\/\d+\/[\w-]+$/.test(u.pathname))))fail('transport_rejected');
   const headers={'User-Agent':'Agent-Arcade-Plugin-Artifacts','Accept':asset?'application/octet-stream':'application/vnd.github+json','Accept-Encoding':'identity','X-GitHub-Api-Version':'2022-11-28'};
   let r;try{r=await new Promise((resolve,reject)=>{let done=false;const finish=(e,v)=>{if(done){v?.body?.destroy?.();return;}done=true;ctx.signal.removeEventListener('abort',aborted);e?reject(e):resolve(v);},aborted=()=>finish(ctx.signal.reason);ctx.signal.addEventListener('abort',aborted,{once:true});if(ctx.signal.aborted)return aborted();Promise.resolve().then(()=>this.request(url,{signal:ctx.signal,headers})).then(v=>finish(null,v),e=>finish(e));});}catch(e){ctx.check();fail('network_failed');}
   if(!r||!plain(r.headers)||typeof r.body?.destroy!=='function'||typeof r.body?.[Symbol.asyncIterator]!=='function'){r?.body?.destroy?.();fail('network_failed');}
   if([301,302,303,307,308].includes(r.statusCode)){r.body.destroy();if(!asset||redirects>=3||typeof r.headers.location!=='string')fail('transport_rejected');try{url=new URL(r.headers.location,url).href;}catch{fail('transport_rejected');}continue;}
   const length=r.headers['content-length'];if(r.statusCode!==200||r.headers['content-encoding']&&r.headers['content-encoding']!=='identity'){r.body.destroy();fail('network_failed');}
   if(length!==undefined&&(!/^\d{1,12}$/.test(String(length))||Number(length)>limit||exactSize!==undefined&&Number(length)!==exactSize)){r.body.destroy();fail('size_mismatch');}
   let size=0;const chunks=[],abort=()=>r.body.destroy();ctx.signal.addEventListener('abort',abort,{once:true});
   try{ctx.check();for await(const chunk of r.body){ctx.check();if(!Buffer.isBuffer(chunk))fail('transport_rejected');size+=chunk.length;if(size>limit)fail('size_mismatch');chunks.push(chunk);}ctx.check();if(length!==undefined&&size!==Number(length)||exactSize!==undefined&&size!==exactSize)fail('size_mismatch');return Buffer.concat(chunks,size);}
   catch(e){ctx.check();if(e instanceof QQPluginCatalogError)throw e;fail('network_failed');}finally{ctx.signal.removeEventListener('abort',abort);r.body.destroy();}
  }
 }
 async _json(url,ctx){const bytes=await this._body(url,{ctx});try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('catalog_invalid');}}
 async _run(signal,fn){const ctx=context(signal,this.timeoutMs);try{ctx.check();return await fn(ctx);}catch(e){if(e instanceof QQPluginCatalogError)throw e;fail('network_failed');}finally{ctx.close();}}
 list({signal}={}){return this._run(signal,async ctx=>{
  const raw=await this._json(INDEX,ctx),repo=await this._json(`${API}/repos/${REPO}`,ctx);ctx.check();
  if(!plain(raw)||raw.type!=='file'||raw.path!=='plugins.v4.json'||raw.encoding!=='base64'||!Number.isInteger(raw.size)||raw.size<1||raw.size>MAX_METADATA||typeof raw.content!=='string'||!/^[a-f0-9]{40}$/.test(raw.sha)||!plain(repo)||repo.full_name!==REPO||typeof repo.archived!=='boolean')fail('catalog_invalid');
  const encoded=raw.content.replace(/\n/g,'');if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))fail('catalog_invalid');const bytes=Buffer.from(encoded,'base64');
  if(bytes.length!==raw.size||createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')!==raw.sha)fail('catalog_invalid');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('catalog_invalid');}
  if(!plain(value)||!text(value.version,40)||!text(value.updateTime,80)||!Array.isArray(value.plugins)||value.plugins.length>256)fail('catalog_invalid');const items=value.plugins.map(entry);if(new Set(items.map(x=>x.id)).size!==items.length)fail('catalog_invalid');
  const catalogId=hash(bytes);this.snapshot={catalogId,at:this.now(),items,blobSha:raw.sha,archived:repo.archived,pins:new Map()};
  return {catalogId,source:`https://github.com/${REPO}`,indexBlobSha:raw.sha,archived:repo.archived,indexLicense:'readme-mit-declaration',authorAuthenticated:false,items:items.map(({repository,tag,name:displayName,...row})=>({id:row.id,name:displayName,version:row.version,description:row.description,author:row.author,homepage:row.homepage,tags:row.tags,minVersion:row.minVersion,supported:row.supported,...(row.reason?{reason:row.reason}:{})}))};
 });}
 _entry({catalogId,id}={}){const s=this.snapshot;if(!s||catalogId!==s.catalogId||this.now()<s.at||this.now()-s.at>=600000)fail('catalog_expired');const row=s.items.find(x=>x.id===id);if(!row)fail('invalid_request');if(!row.supported)fail('unsupported_plugin');return {...row,indexBlobSha:s.blobSha,catalogId};}
 async _inspect(input,ctx){
  const item=this._entry(input),release=await this._json(`${API}/repos/${item.repository}/releases/tags/${encodeURIComponent(item.tag)}`,ctx);this._entry(input);ctx.check();
  if(!plain(release)||release.tag_name!==item.tag||release.draft!==false||release.prerelease!==false||!Number.isSafeInteger(release.id)||release.id<1||!Array.isArray(release.assets)||release.assets.length>256)fail('release_invalid');
  const matches=release.assets.filter(a=>plain(a)&&a.name===item.assetName);if(matches.length!==1)fail('release_invalid');const a=matches[0];
  if(a.state!=='uploaded'||!Number.isSafeInteger(a.id)||a.id<1||!Number.isSafeInteger(a.size)||a.size<1||a.size>MAX_ARCHIVE||a.browser_download_url!==item.downloadUrl)fail('release_invalid');
  if(typeof a.digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(a.digest))fail('digest_required');
  const source={kind:'github-release',catalogId:item.catalogId,indexBlobSha:item.indexBlobSha,id:item.id,version:item.version,repository:item.repository,tag:item.tag,releaseId:release.id,assetId:a.id,assetName:a.name,archiveSize:a.size,archiveSha256:a.digest.slice(7),authorAuthenticated:false};
  const pin=JSON.stringify(source),previous=this.snapshot.pins.get(item.id);if(previous!==undefined&&previous!==pin)fail('release_changed');this.snapshot.pins.set(item.id,pin);return source;
 }
 inspect(input,{signal}={}){return this._run(signal,ctx=>this._inspect(input,ctx));}
 download(input,{signal}={}){return this._run(signal,async ctx=>{const source=await this._inspect(input,ctx),bytes=await this._body(`${API}/repos/${source.repository}/releases/assets/${source.assetId}`,{ctx,asset:true,limit:MAX_ARCHIVE,exactSize:source.archiveSize});this._entry(input);ctx.check();if(hash(bytes)!==source.archiveSha256)fail('digest_mismatch');return {bytes,source};});}
}
module.exports={QQPluginCatalog,QQPluginCatalogError,SUPPORTED_IDS,MAX_METADATA,MAX_ARCHIVE};
