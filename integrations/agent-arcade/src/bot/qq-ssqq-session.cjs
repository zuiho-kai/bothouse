'use strict';
// Original owned session around a separately supplied, fixed upstream client.
// No upstream executable asset or QQ credential is exposed to Arcade's renderer.
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {QQClient,validateQQOwner,validateQQUrl}=require('./qq.cjs');
const {openManagementClient}=require('./qq-management-client.cjs');
const {installation:validateInstallation}=require('./qq-installation-settings.cjs');
const {offlineIO}=require('./qq-plugin-deployment.cjs');
const FIXED=require('./qq-ssqq-assets.json');
const CODES=new Set(['invalid_request','unconfigured','changed','closed','cancelled','operation_in_progress','invalid_response','unavailable','prepared_invalid','artifact_changed','unsupported_package','archive_invalid','archive_unsafe','archive_limit','prepare_busy','prepare_failed','publication_unconfirmed','list_limit','unsafe_directory','account_mismatch','account_changed','account_offline','status_unverified','bridge_unhealthy','disconnected','connect_failed','timeout','invalid_endpoint','invalid_assets','asset_changed','invalid_bounds','invalid_partition','view_close_failed']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v),profileId=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(v),sha=v=>createHash('sha256').update(v).digest('hex');
class QQSSQQError extends Error{constructor(code){code=CODES.has(code)?code:'unavailable';super(`SSQQ view is unavailable (${code}).`);this.code=code;}}
const fail=code=>{throw new QQSSQQError(code);};
function safeCode(e){return new QQSSQQError(({aborted:'cancelled',action_timeout:'timeout',request_limit:'operation_in_progress',login_required:'account_offline'})[e?.code]||e?.code).code;}
const correlation=v=>({accountId:v.accountId,panelId:v.panelId});
function exact(v,keys){if(!plain(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail('invalid_request');}
function bounds(v){exact(v,['x','y','width','height']);if(Object.values(v).some(n=>!Number.isInteger(n))||v.x<0||v.y<0||v.width<1||v.height<1||v.width>16384||v.height>16384)fail('invalid_bounds');return {...v};}
function request(v,action='read'){if(!['read','prepare','open','bounds','close'].includes(action))fail('invalid_request');exact(v,['accountId','panelId',...(action==='open'?['preparedId','bounds']:action==='bounds'?['viewId','bounds']:[])]);if(!profileId(v.accountId)||!uuid(v.panelId)||action==='open'&&!uuid(v.preparedId)||action==='bounds'&&!uuid(v.viewId))fail('invalid_request');if(['open','bounds'].includes(action))bounds(v.bounds);return v;}
const KEYS=['profileId','panelId','profile','generation','characterId','runtime','installation','runtimeEpoch','bridgeRevision','qqAccountId','ownerId','url','token','channel','status','endpointId','appScopeHash','workScope'];
function captured(v,input){
 if(!plain(v)||v.profileId!==input.accountId||v.panelId!==input.panelId||!v.profile||!v.runtime||!v.installation||v.channel!=='qq'||!['connected','disconnected'].includes(v.status))fail('unconfigured');
 if(!Number.isSafeInteger(v.generation)||v.generation<0||!Number.isSafeInteger(v.runtimeEpoch)||v.runtimeEpoch<0||typeof v.characterId!=='string'||!v.characterId||v.characterId.length>128||typeof v.bridgeRevision!=='string'||!v.bridgeRevision||v.bridgeRevision.length>128||typeof v.endpointId!=='string'||!v.endpointId||v.endpointId.length>256||typeof v.appScopeHash!=='string'||!/^[a-f0-9]{64}$/.test(v.appScopeHash)||v.workScope!==undefined&&(typeof v.workScope!=='string'||!/^[a-f0-9]{64}$/.test(v.workScope)))fail('unconfigured');
 let account,owner,url,installation;try{account=validateQQOwner(v.qqAccountId);owner=validateQQOwner(v.ownerId);url=validateQQUrl(v.url);installation=validateInstallation(v.installation);}catch{fail('unconfigured');}
 const u=new URL(url);if(u.protocol!=='ws:'||u.hostname!=='127.0.0.1'||u.search||u.hash||account===owner||typeof v.token!=='string'||!/^[\x21-\x7e]{16,256}$/.test(v.token))fail('unconfigured');
 return Object.freeze({...Object.fromEntries(KEYS.map(k=>[k,k==='qqAccountId'?account:k==='ownerId'?owner:k==='url'?url:v[k]])),installationKey:sha(JSON.stringify(installation))});
}
const same=(a,b)=>KEYS.every(k=>a[k]===b[k])&&a.installationKey===b.installationKey;
const fixedRow=row=>plain(row)&&row.id===FIXED.pluginId&&row.version===FIXED.pluginVersion&&row.archiveSha256===FIXED.archiveSha256;
function preparedRows(artifacts){const listing=artifacts.list();if(!plain(listing)||!Array.isArray(listing.items)||listing.items.length>64)fail('invalid_response');return listing.items.filter(fixedRow).map(row=>{if(!uuid(row.preparedId)||row.files!==FIXED.files.length||row.bytes!==FIXED.files.reduce((n,r)=>n+r.size,0))fail('prepared_invalid');return {preparedId:row.preparedId,version:row.version,files:row.files,bytes:row.bytes};});}
function validateResolved(raw,artifacts,preparedId){
 if(!fixedRow(raw)||raw.preparedId!==preparedId||raw.archiveSize!==FIXED.archiveSize||raw.verification!=='full-manifest'||raw.entry!=='index.mjs'||!Array.isArray(raw.files)||JSON.stringify(raw.files)!==JSON.stringify(FIXED.files))fail('prepared_invalid');
 const expected=path.join(artifacts.root,'qq-plugin-artifacts',preparedId,'code');if(!offlineIO.pathSame(raw.codeRoot,expected)||!offlineIO.pathSame(raw.manifestPath,path.join(path.dirname(expected),'prepared.json')))fail('prepared_invalid');return expected;
}
function loadFixedAssets(raw,artifacts,preparedId,assertCurrent){
 const root=validateResolved(raw,artifacts,preparedId),files=new Map();let total=0;
 try{for(const row of FIXED.files){assertCurrent();if(!row.path.startsWith('webui/dist/'))continue;const relative=row.path.slice('webui/dist/'.length);if(relative.split('/').some(p=>p.startsWith('.')))continue;
   const result=offlineIO.readFile(path.join(root,...row.path.split('/')),row.size,true);if(result.size!==row.size||result.sha256!==row.sha256){result.bytes.fill(0);fail('asset_changed');}total+=result.bytes.length;if(total>16*1024*1024){result.bytes.fill(0);fail('invalid_assets');}files.set(relative,result.bytes);
  }assertCurrent();if(!files.has('index.html'))fail('invalid_assets');return {archiveSha256:FIXED.archiveSha256,version:FIXED.frontendVersion,entry:'index.html',files};
 }catch(e){for(const bytes of files.values())bytes.fill(0);files.clear();throw e;}
}
function releaseAssets(assets){for(const bytes of assets?.files?.values()||[])bytes.fill(0);assets?.files?.clear();}
function closeProbe(s){
 const socket=s.probeSocket||s.client?.socket||s.socket;s.probeSocket=socket;
 if(!socket){try{s.client?.close();return Promise.resolve({closed:true});}catch{return Promise.reject(new QQSSQQError('view_close_failed'));}}
 return new Promise((resolve,reject)=>{let settled=false;const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);socket.removeListener('close',closed);error?reject(error):resolve({closed:true});},closed=()=>finish(),timer=setTimeout(()=>finish(new QQSSQQError('view_close_failed')),2000);socket.once('close',closed);try{if(socket.readyState!==3){if(s.client?.socket===socket)s.client.close();else socket.terminate();}if(socket.readyState===3)finish();}catch{finish(new QQSSQQError('view_close_failed'));}});
}
class QQSSQQSession{
 constructor({capture,verifyContext,artifacts,window,viewFactory,clientFactory=o=>new QQClient(o),selectArchive=async()=>null,onState=()=>{},assetLoader=loadFixedAssets}={}){
  if([capture,verifyContext,viewFactory,clientFactory,selectArchive,onState,assetLoader].some(f=>typeof f!=='function')||!artifacts||['list','resolve','prepareLocal'].some(k=>typeof artifacts[k]!=='function')||typeof artifacts.root!=='string')fail('invalid_request');
  Object.assign(this,{capture,verifyContext,artifacts,window,viewFactory,clientFactory,selectArchive,onState,assetLoader});this.session=null;this.retiring=Promise.resolve({closed:true});this.retiringSession=null;this.failedRetirement=null;this.closed=false;
 }
 get accountId(){return this.session?.accountId||this.failedRetirement?.accountId||this.retiringSession?.accountId||null;}
 _capture(input){if(this.closed)fail('closed');const raw=this.capture(correlation(input));if(raw?.then){raw.catch?.(()=>{});fail('invalid_request');}return captured(raw,input);}
 _assert(s,ready=!!s.socket){if(this.closed||this.session!==s||s.abort.signal.aborted||!same(s.binding,this._capture(s)))fail('changed');if(ready){const c=s.client;if(!c||!c.ready||c.closed||c.socket?.readyState!==1||c.socket!==s.socket||c.generation!==s.clientGeneration||c.accountId!==s.binding.qqAccountId||c.expectedAccountId!==s.binding.qqAccountId||c.ownerId!==s.binding.ownerId)fail('disconnected');}}
 async _verify(s,ready=!!s.socket){this._assert(s,ready);const raw=await this.verifyContext(s.binding,{signal:s.abort.signal});this._assert(s,ready);if(!plain(raw)||Object.keys(raw).length!==1||raw.verified!==true)fail('changed');}
 _get(input,existing=false){const binding=this._capture(input);if(this.failedRetirement)fail('view_close_failed');let s=this.session;if(s?.pending)fail('operation_in_progress');if(!s||s.accountId!==input.accountId||s.panelId!==input.panelId||!same(s.binding,binding)){if(existing)fail('changed');const retiring=this._retire();s={...correlation(input),binding,abort:new AbortController(),pending:null,client:null,socket:null,clientGeneration:null,view:null,viewId:null,preparedId:null,status:'closed',timer:null,retiring};this.session=s;}return s;}
 _state(s){return {status:s.status,viewId:s.viewId,preparedId:s.preparedId};}
 _public(s,extra={}){return {...correlation(s),qqAccountId:s.binding.qqAccountId,state:this._state(s),...extra};}
 _notify(s){if(this.session!==s)return;try{this.onState(this._public(s));}catch{}}
 _run(s,fn){const operation=Promise.resolve().then(fn);s.pending=operation;return operation.finally(()=>{if(s.pending===operation)s.pending=null;});}
 async read(input){request(input);const s=this._get(input);return this._run(s,async()=>{await s.retiring;this._assert(s);return this._public(s,{prepared:preparedRows(this.artifacts)});});}
 async prepare(input){request(input,'prepare');const s=this._get(input,true);if(s.view)fail('operation_in_progress');return this._run(s,async()=>{await s.retiring;this._assert(s);const file=await this.selectArchive(s.binding,{signal:s.abort.signal,assertCurrent:()=>this._assert(s)});this._assert(s);if(file===null)return this._public(s,{cancelled:true});if(typeof file!=='string')fail('invalid_request');
   const raw=offlineIO.readFile(file,FIXED.archiveSize,true);const matches=raw.size===FIXED.archiveSize&&raw.sha256===FIXED.archiveSha256;raw.bytes.fill(0);if(!matches)fail('unsupported_package');
   const prepared=await this.artifacts.prepareLocal(file,{signal:s.abort.signal});this._assert(s);validateResolved(prepared,this.artifacts,prepared.preparedId);return this._public(s,{preparedId:prepared.preparedId,prepared:preparedRows(this.artifacts)});
  });}
 async open(input){request(input,'open');const s=this._get(input,true);if(s.view)fail('operation_in_progress');return this._run(s,async()=>{let assets;try{
   await s.retiring;this._assert(s);const raw=await this.artifacts.resolve(input.preparedId,{signal:s.abort.signal});this._assert(s);assets=this.assetLoader(raw,this.artifacts,input.preparedId,()=>this._assert(s));
   const b=s.binding,c=await openManagementClient({retiring:s.retiring,verify:()=>this._verify(s,false),assertCurrent:()=>this._assert(s,false),clientFactory:this.clientFactory,onCreated:client=>{s.client=client;},options:{url:b.url,token:b.token,ownerId:b.ownerId,expectedAccountId:b.qqAccountId},signal:s.abort.signal,requiredMethods:['_request']});this._assert(s,false);s.socket=c.socket;s.clientGeneration=c.generation;this._assert(s);await this._verify(s);
   c.socket.once('close',()=>{if(this.session===s)void this._retire().catch(()=>{});});s.viewId=randomUUID();s.preparedId=input.preparedId;s.status='opening';
   const onState=value=>{if(this.session!==s||s.abort.signal.aborted)return;if(value?.kind==='opening'||value?.kind==='loaded'){s.status=value.kind;this._notify(s);}};
   s.view=this.viewFactory({window:typeof this.window==='function'?this.window():this.window,assets,scopeKey:sha(JSON.stringify(['ssqq',b.appScopeHash,b.profileId,b.installationKey,b.workScope||null,b.qqAccountId,b.url,FIXED.archiveSha256])),endpointUrl:b.url,token:b.token,assertCurrent:()=>this._assert(s),onState,onRequestClose:()=>{if(this.session===s)void this._retire().catch(()=>{});}});releaseAssets(assets);assets=null;
   if(!s.view||['open','close','setBounds'].some(k=>typeof s.view[k]!=='function'))fail('invalid_response');this._notify(s);await s.view.open({bounds:bounds(input.bounds)});this._assert(s);s.status='loaded';this._notify(s);s.timer=setInterval(()=>this.observe(),250);s.timer.unref?.();return this._public(s);
  }catch(e){releaseAssets(assets);if(this.session===s)void this._retire().catch(()=>{});throw new QQSSQQError(safeCode(e));}});}
 setBounds(input){request(input,'bounds');const s=this.session;if(!s||s.accountId!==input.accountId||s.panelId!==input.panelId||s.viewId!==input.viewId||!s.view||s.pending)fail('changed');this._assert(s);s.view.setBounds(bounds(input.bounds));return this._public(s,{updated:true});}
 _settleRetirement(s,previous){this.retiringSession=s;let cleanup;try{cleanup=s.view?.close();}catch(e){cleanup=Promise.reject(e);}const probe=s.probeClosing||closeProbe(s);s.probeClosing=null;const operation=Promise.allSettled([previous,s.pending,cleanup,probe]).then(results=>{const ownFailure=results[2].status==='rejected'||s.view&&results[2].value?.closed!==true||results[3].status==='rejected';if(ownFailure)this.failedRetirement=s;if(results[0].status==='rejected'||ownFailure){try{this.onState(this._public(s,{code:'view_close_failed'}));}catch{}fail('view_close_failed');}if(this.failedRetirement===s)this.failedRetirement=null;s.status='closed';s.viewId=null;s.preparedId=null;try{this.onState(this._public(s));}catch{}if(this.retiringSession===s)this.retiringSession=null;return {closed:true};});this.retiring=operation;operation.catch(()=>{});return operation;}
 _retire(){const s=this.session;this.session=null;if(!s)return this.failedRetirement?this._settleRetirement(this.failedRetirement,Promise.resolve({closed:true})):this.retiring;clearInterval(s.timer);s.probeClosing=closeProbe(s);s.abort.abort();
  const previous=this.failedRetirement?this._settleRetirement(this.failedRetirement,Promise.resolve({closed:true})):this.retiring;return this._settleRetirement(s,previous);
 }
 closeOwned(input){request(input,'close');const s=this.session;if(!s||s.accountId!==input.accountId||s.panelId!==input.panelId){const old=this.failedRetirement||this.retiringSession;const result=old&&old.accountId===input.accountId&&old.panelId===input.panelId?(this.failedRetirement===old?this._settleRetirement(old,Promise.resolve({closed:true})):this.retiring):Promise.resolve();return result.then(()=>({...correlation(input),closed:true}));}return this._retire().then(()=>({...correlation(input),closed:true}));}
 closeCurrent(){return this._retire();}
 observe(){try{if(this.session)this._assert(this.session);}catch{void this._retire().catch(()=>{});}}
 close(){this.closed=true;return this._retire();}
}
async function qqSSQQResult(input,operation){try{return {ok:true,...await operation()};}catch(e){return {ok:false,...(profileId(input?.accountId)?{accountId:input.accountId}:{}),...(uuid(input?.panelId)?{panelId:input.panelId}:{}),code:safeCode(e)};}}
module.exports={QQSSQQSession,QQSSQQError,ssqqResult:qqSSQQResult,ssqqRequest:request,qqSSQQResult,request,FIXED,loadFixedAssets};
