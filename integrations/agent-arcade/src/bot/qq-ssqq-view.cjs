'use strict';
// A separately isolated, explicitly opened manual OneBot client. No AI channel.
const path=require('node:path'),{randomUUID}=require('node:crypto');
const {QQSSQQMedia,mediaSource,HOSTS}=require('./qq-ssqq-media.cjs');
const SCHEME='http',PREFIX='/plugin/napcat-plugin-ssqq/files/static/',activePartitions=new Set();
const fail=code=>{throw Object.assign(Error('SSQQ view is unavailable.'),{code});};


function endpoint(value){let u;try{u=new URL(value);}catch{fail('invalid_endpoint');}if(u.protocol!=='ws:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.search||u.hash)fail('invalid_endpoint');return u.href;}
function dimensions(b){if(!b||Object.keys(b).sort().join('|')!=='height|width|x|y'||Object.values(b).some(v=>!Number.isInteger(v))||b.x<0||b.y<0||b.width<1||b.height<1||b.width>16384||b.height>16384)fail('invalid_bounds');return {...b};}
function contentType(name){return ({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.po':'text/plain'})[path.extname(name)]||'application/octet-stream';}
function loadAssets(assets){if(!assets||assets.archiveSha256!=='82b9ef50f7e4ddb92a07149d763f7ce98502d24ac73ce8039499b24b25df1c04'||assets.version!=='3.5.2'||assets.entry!=='index.html'||!(assets.files instanceof Map))fail('invalid_assets');const result=new Map();let bytes=0;for(const [name,value]of assets.files){if(!name||name.includes('\\')||name.split('/').some(x=>!x||x==='.'||x==='..')||!Buffer.isBuffer(value))fail('invalid_assets');const body=Buffer.from(value);bytes+=body.length;if(bytes>80*1024*1024)fail('invalid_assets');result.set(PREFIX+name,{body,type:contentType(name)});}if(!result.has(PREFIX+'index.html'))fail('invalid_assets');return result;}
class QQSSQQView{
 #token;#closed=false;#view=null;#session=null;#assets;#closing=null;#download=null;#windowClosed=null;#ownsPartition=false;#protocolHandled=new Set();#finished=false;#media;#mediaTickets=new Map();
 constructor({electron,window,assets,binding,scopeKey=binding?.scopeKey,endpointUrl=binding?.endpointUrl,token,assertCurrent,onState=()=>{},onRequestClose,partition,createMedia=options=>new QQSSQQMedia(options)}={}){
  if(!electron?.WebContentsView||!electron?.session||!window?.contentView||typeof assertCurrent!=='function'||typeof onState!=='function'||typeof onRequestClose!=='function'||typeof createMedia!=='function'||! /^[a-f0-9]{64}$/.test(scopeKey)||typeof token!=='string'||! /^[\x21-\x7e]{16,256}$/.test(token))fail('invalid_request');
  this.electron=electron;this.window=window;this.scopeKey=scopeKey;this.url=endpoint(endpointUrl);this.assertCurrent=assertCurrent;this.onState=onState;this.onRequestClose=onRequestClose;this.#token=token;this.#assets=loadAssets(assets);this.#media=createMedia({assertCurrent:()=>this.#check()});if(typeof this.#media?.read!=='function'||typeof this.#media?.close!=='function')fail('invalid_request');this.origin='http://'+scopeKey+'.ssqq.arcade.invalid';this.mediaOrigin='https://'+scopeKey+'.ssqq.arcade.invalid';this.partition=partition||'persist:arcade-ssqq-'+scopeKey;if(!/^(?:persist:)?arcade-ssqq-[a-f0-9-]{36,128}$/.test(this.partition))fail('invalid_partition');
 }
 #check(){if(this.#closed||this.window.isDestroyed())fail('closed');const r=this.assertCurrent();if(r?.then){r.catch?.(()=>{});fail('invalid_request');}}
 #state(value){try{this.onState(value);}catch{}}
 get webContents(){return this.#view?.webContents||null;}
 async open({bounds}={}){
  this.#check();if(this.#view||activePartitions.has(this.partition))fail('operation_in_progress');activePartitions.add(this.partition);this.#ownsPartition=true;const ses=this.#session=this.electron.session.fromPartition(this.partition,{cache:false});
  ses.setPermissionRequestHandler((_w,_p,cb)=>cb(false));ses.setPermissionCheckHandler(()=>false);ses.setDevicePermissionHandler(()=>false);
  const view=this.#view=new this.electron.WebContentsView({webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false,spellcheck:false}}),wc=view.webContents;
  const allowed=d=>{this.#check();if(d.webContentsId!==wc.id)return false;if(d.url===this.url&&d.resourceType==='webSocket')return true;const u=new URL(d.url);if(u.origin===this.mediaOrigin&&u.pathname.startsWith('/media/')){const ticket=this.#mediaTickets.get(u.pathname.slice(7));return d.method==='GET'&&d.resourceType==='image'&&!u.search&&!u.hash&&ticket&&ticket.expiresAt>Date.now();}return u.origin===this.origin&&!u.pathname.startsWith('/media/');};
  ses.webRequest.onBeforeRequest((d,cb)=>{
   let allow=false;try{
    this.#check();
    if(d.webContentsId===wc.id&&d.method==='GET'&&d.resourceType==='image'&&d.url.startsWith('https:')&&new URL(d.url).origin!==this.mediaOrigin){
     const source=mediaSource(d.url);for(const [key,ticket]of this.#mediaTickets)if(ticket.expiresAt<=Date.now())this.#mediaTickets.delete(key);
     if(this.#mediaTickets.size>=64)fail('busy');const id=randomUUID();this.#mediaTickets.set(id,{url:source.url,expiresAt:Date.now()+15000});
     this.#state({kind:'image-requested'});cb({redirectURL:this.mediaOrigin+'/media/'+id});return;
    }
    allow=allowed(d);
   }catch{}if(!allow)this.#state({kind:'request-blocked',resourceType:d.resourceType});cb({cancel:!allow});
  });
  ses.webRequest.onBeforeSendHeaders((d,cb)=>{try{if(!allowed(d))return cb({cancel:true});const headers={...d.requestHeaders};for(const name of Object.keys(headers))if(/^(authorization|proxy-authorization|cookie)$/i.test(name))delete headers[name];if(d.url===this.url&&d.resourceType==='webSocket'){headers.Authorization='Bearer '+this.#token;this.#state({kind:'socket-authorized'});}cb({requestHeaders:headers});}catch{cb({cancel:true});}});
  this.#download=e=>e.preventDefault();ses.on('will-download',this.#download);
  const csp=`default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${this.url}; img-src 'self' data: blob: ${this.mediaOrigin} ${HOSTS.map(h=>'https://'+h).join(' ')}; font-src 'self' data:; media-src 'self' blob:; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`;
  const preferences={address:this.url,auto_connect:true,save_password:'',connection_history:[],close_ga:true,open_ga_bot:false,log_level:'err',opt_dark:false,opt_auto_dark:true,opt_auto_win_color:false,theme_color:2};
  const boot=`<!doctype html><meta charset="utf-8"><script>const p=${JSON.stringify(preferences)};let entries=(localStorage.getItem('options')||'').split('&').filter(Boolean).map(s=>{const n=s.indexOf(':');return [s.slice(0,n),s.slice(n+1)]});for(const[k,v]of Object.entries(p)){entries=entries.filter(e=>e[0]!==k);entries.push([k,encodeURIComponent(typeof v==='string'?v:JSON.stringify(v))]);}localStorage.removeItem('token');localStorage.setItem('options',entries.map(e=>e.join(':')).join('&'));</script>`;
  const protocolRequest=async req=>{try{this.#check();const u=new URL(req.url);if(req.method!=='GET'||u.search||u.hash)return new Response('',{status:404});if(u.origin===this.mediaOrigin&&u.pathname.startsWith('/media/')){const id=u.pathname.slice(7),ticket=this.#mediaTickets.get(id);this.#mediaTickets.delete(id);if(!ticket||ticket.expiresAt<=Date.now())return new Response('',{status:410});let media;try{media=await this.#media.read(ticket.url,{signal:req.signal});this.#check();return new Response(media.bytes,{headers:{'content-type':media.mimeType,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"}});}finally{media?.bytes?.fill(0);}}
   if(u.origin!==this.origin)return new Response('',{status:404});if(/%(?:2f|5c)/i.test(u.pathname))return new Response('',{status:404});const asset=u.pathname==='/bootstrap'?{body:boot,type:'text/html'}:this.#assets.get(decodeURIComponent(u.pathname));if(!asset)return new Response('',{status:404});return new Response(asset.body,{headers:{'content-type':asset.type,'content-security-policy':csp,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});}catch{return new Response('',{status:410});}};for(const scheme of [SCHEME,'https']){ses.protocol.handle(scheme,protocolRequest);this.#protocolHandled.add(scheme);}
  const requestClose=()=>{if(this.#closed)return;try{this.onRequestClose();}catch{void this.close().catch(()=>{});}};
  wc.setWindowOpenHandler(()=>({action:'deny'}));wc.on('will-attach-webview',e=>e.preventDefault());wc.on('will-navigate',(e,url)=>{if(url!==this.origin+PREFIX+'index.html'&&url!==this.origin+'/bootstrap')e.preventDefault();});wc.on('will-redirect',e=>e.preventDefault());wc.on('before-input-event',(e,input)=>{if(input.type==='keyDown'&&input.key==='Escape'){e.preventDefault();requestClose();}});wc.on('destroyed',requestClose);wc.on('render-process-gone',requestClose);this.#windowClosed=requestClose;this.window.once('closed',requestClose);
  this.window.contentView.addChildView(view);view.setBounds(dimensions(bounds));this.#state({kind:'opening'});
  try{await wc.loadURL(this.origin+'/bootstrap');this.#check();await wc.loadURL(this.origin+PREFIX+'index.html');this.#check();this.#state({kind:'loaded'});return {opened:true};}catch(e){await this.close();throw e;}
 }
 setBounds(bounds){this.#check();if(!this.#view)fail('closed');this.#view.setBounds(dimensions(bounds));}
 close(){
  if(this.#finished)return Promise.resolve({closed:true});if(this.#closing)return this.#closing;
  this.#closed=true;this.#token='';this.#mediaTickets.clear();const mediaClosing=this.#media.close();mediaClosing.catch(()=>{});const view=this.#view,ses=this.#session;
  const operation=(async()=>{
   if(view){const wc=view.webContents;try{this.window.contentView.removeChildView(view);}catch{}
    if(!wc.isDestroyed())await new Promise((resolve,reject)=>{let settled=false;const done=error=>{if(settled)return;settled=true;clearTimeout(timer);wc.removeListener('destroyed',destroyed);error?reject(error):resolve();};const destroyed=()=>done(),timer=setTimeout(()=>done(Object.assign(Error('SSQQ close unconfirmed.'),{code:'view_close_failed'})),5000);wc.once('destroyed',destroyed);try{wc.close({waitForBeforeUnload:false});if(wc.isDestroyed())done();}catch(e){done(e);}});
   }
   await mediaClosing;
   if(ses){for(const scheme of this.#protocolHandled){await ses.protocol.unhandle(scheme);this.#protocolHandled.delete(scheme);}await ses.closeAllConnections();ses.webRequest.onBeforeRequest(null);ses.webRequest.onBeforeSendHeaders(null);if(this.#download)ses.removeListener('will-download',this.#download);}
   if(this.#windowClosed)this.window.removeListener('closed',this.#windowClosed);this.#view=null;this.#assets.clear();if(this.#ownsPartition){activePartitions.delete(this.partition);this.#ownsPartition=false;}this.#finished=true;this.#state({kind:'closed'});return {closed:true};
  })();
  this.#closing=operation.catch(()=>{this.#state({kind:'close-failed',code:'view_close_failed'});fail('view_close_failed');}).finally(()=>{this.#closing=null;});return this.#closing;
 }
}
module.exports={QQSSQQView};
