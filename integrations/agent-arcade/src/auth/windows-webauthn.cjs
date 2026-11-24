'use strict';
// Original Windows WebAuthn host. Native options and results remain main-process only.
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {isIP}=require('node:net');
const MAX_FRAME=131072;
const CODES=new Set(['webauthn_unavailable','webauthn_invalid_request','webauthn_options_unsupported','webauthn_abi_invalid','webauthn_cancelled','webauthn_timeout','webauthn_changed','webauthn_busy','webauthn_native_failed','webauthn_response_invalid','webauthn_close_unconfirmed']);
class WindowsWebAuthnError extends Error {constructor(code,nativeInvoked=false){super(CODES.has(code)?code:'webauthn_native_failed');this.code=this.message;this.nativeInvoked=nativeInvoked===true;}}
const fail=(code='webauthn_invalid_request')=>{throw new WindowsWebAuthnError(code);};
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function keys(v,required,optional=[]){if(!plain(v)||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))fail();}
function binary(value,min,max){if(typeof value!=='string'||value.length>Math.ceil(max*4/3)||! /^[A-Za-z0-9_-]+$/.test(value))fail();const b=Buffer.from(value,'base64url');if(b.length<min||b.length>max||b.toString('base64url')!==value)fail();return b;}
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
function guard(assertCurrent){try{const result=assertCurrent?.();if(result?.then){result.catch?.(()=>{});fail('webauthn_changed');}}catch(error){throw new WindowsWebAuthnError(error?.code==='passkey_expired'?'webauthn_timeout':error?.code==='passkey_cancelled'?'webauthn_cancelled':'webauthn_changed');}}
const TRANSPORTS=Object.freeze({usb:1,nfc:2,ble:4,internal:16,hybrid:32,cable:32,'smart-card':64});
function credentialList(rows){if(!Array.isArray(rows)||rows.length>64)fail();const ids=new Set();return rows.map(row=>{keys(row,['type','id'],['transports']);binary(row.id,1,1024);if(row.type!=='public-key'||ids.has(row.id))fail();ids.add(row.id);let transports=0;if(row.transports!==undefined){if(!Array.isArray(row.transports)||row.transports.length>7||new Set(row.transports).size!==row.transports.length)fail();for(const t of row.transports){if(!Object.hasOwn(TRANSPORTS,t))fail();transports|=TRANSPORTS[t];}}return {id:row.id,transports};});}
function normalize(kind,input){
 keys(input,['operationId','origin','rpId','parentHwnd','ownerPid','publicKey']);
 if(!uuid(input.operationId)||typeof input.origin!=='string'||input.origin.length>2048||typeof input.parentHwnd!=='string'||!/^0x[0-9a-f]{1,16}$/i.test(input.parentHwnd)||BigInt(input.parentHwnd)===0n||input.ownerPid!==process.pid)fail();
 let u;try{u=new URL(input.origin);}catch{fail();}
 if(u.origin!==input.origin||u.protocol!=='https:'||u.pathname!=='/'||u.username||u.password||u.hash||u.search||isIP(u.hostname)||!u.hostname.includes('.')||u.hostname!==input.rpId||u.hostname.length>253||u.hostname.split('.').some(s=>!s||s.length>63||! /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s)))fail();
 const p=input.publicKey;let encoded;try{encoded=JSON.stringify(p);}catch{fail();}if(typeof encoded!=='string'||Buffer.byteLength(encoded)>65536)fail();
 keys(p,kind==='create'?['challenge','rp','user','pubKeyCredParams','timeout','attestation','excludeCredentials','authenticatorSelection']:['challenge','rpId','allowCredentials','timeout','userVerification'],kind==='create'?['extensions','hints']:['extensions']);
 binary(p.challenge,16,128);if(!Number.isSafeInteger(p.timeout)||p.timeout<1||p.timeout>120000)fail();
 const wire={operationId:input.operationId,origin:input.origin,rpId:input.rpId,parentHwnd:input.parentHwnd,ownerPid:input.ownerPid,challenge:p.challenge,timeout:p.timeout};
 if(kind==='create'){
  keys(p.rp,['id','name']);keys(p.user,['id','name','displayName']);keys(p.authenticatorSelection,['userVerification']);
  if(p.rp.id!==input.rpId||p.rp.name!=='NapCat WebUI'||p.user.name!=='NapCat User'||p.user.displayName!==''||p.user.id!==Buffer.from('napcat-user').toString('base64url')||p.attestation!=='none'||p.authenticatorSelection.userVerification!=='preferred')fail('webauthn_options_unsupported');
  if(!Array.isArray(p.pubKeyCredParams)||p.pubKeyCredParams.length<1||p.pubKeyCredParams.length>2)fail();
  wire.algorithms=p.pubKeyCredParams.map(row=>{keys(row,['type','alg']);if(row.type!=='public-key'||![-7,-257].includes(row.alg))fail('webauthn_options_unsupported');return row.alg;});if(new Set(wire.algorithms).size!==wire.algorithms.length)fail();
  if(p.extensions!==undefined){keys(p.extensions,['credProps']);if(p.extensions.credProps!==true)fail();}if(p.hints!==undefined&&(!Array.isArray(p.hints)||p.hints.length))fail();
  wire.credentials=credentialList(p.excludeCredentials);wire.userId=p.user.id;
 }else{
  if(p.rpId!==input.rpId||p.userVerification!=='preferred')fail();if(p.extensions!==undefined)keys(p.extensions,[]);wire.credentials=credentialList(p.allowCredentials);if(!wire.credentials.length)fail();
 }
 return wire;
}
function checkResult(kind,result,wire){
 if(Buffer.byteLength(JSON.stringify(result))>98304)fail('webauthn_response_invalid');keys(result,['id','rawId','type','response','clientExtensionResults']);binary(result.id,1,1024);
 if(result.rawId!==result.id||result.type!=='public-key')fail('webauthn_response_invalid');keys(result.clientExtensionResults,[]);
 const r=result.response;keys(r,kind==='create'?['clientDataJSON','attestationObject']:['clientDataJSON','authenticatorData','signature','userHandle']);
 const data=binary(r.clientDataJSON,1,8192);let c;try{c=JSON.parse(data.toString('utf8'));}catch{fail('webauthn_response_invalid');}keys(c,['type','origin','challenge','crossOrigin']);
 if(!Buffer.from(data.toString('utf8')).equals(data)||c.type!==`webauthn.${kind}`||c.origin!==wire.origin||c.challenge!==wire.challenge||c.crossOrigin!==false)fail('webauthn_response_invalid');
 if(kind==='create'){binary(r.attestationObject,1,65536);if(wire.credentials.some(x=>x.id===result.id))fail('webauthn_response_invalid');}
 else{binary(r.authenticatorData,37,16384);binary(r.signature,1,16384);if(r.userHandle!==null&&r.userHandle!==Buffer.from('napcat-user').toString('base64url'))fail('webauthn_response_invalid');if(!wire.credentials.some(x=>x.id===result.id))fail('webauthn_response_invalid');}
 return result;
}
function systemPowerShell(){
 const root=process.env.SystemRoot;if(typeof root!=='string'||! /^[a-z]:\\[^\r\n]+$/i.test(root))fail('webauthn_unavailable');
 const exe=path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
 for(const p of [root,path.win32.join(root,'System32'),path.win32.dirname(exe),exe]){const st=fs.lstatSync(p);if(st.isSymbolicLink()||fs.realpathSync.native(p).toLowerCase()!==p.toLowerCase()||(p===exe?!st.isFile():!st.isDirectory()))fail('webauthn_unavailable');}
 return exe;
}
// Only bundled source is sent on the first line. No origin, options or secret enters argv.
const BOOTSTRAP="$ErrorActionPreference='Stop'; $b=[System.Text.StringBuilder]::new(); while($true){$c=[Console]::Read(); if($c -lt 0){exit 2}; if($c -eq 10){break}; if($b.Length -ge 262144){exit 2}; [void]$b.Append([char]$c)}; Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b.ToString()))) -ReferencedAssemblies System.Web.Extensions; [ArcadeWebAuthnHost]::Run()";
class WindowsWebAuthn {
 constructor({platform=process.platform,spawnProcess=spawn,resolveExecutable=systemPowerShell,startupMs=20000,closeMs=5000,sourcePath=path.join(__dirname,'windows-webauthn.cs')}={}){Object.assign(this,{platform,spawnProcess,resolveExecutable,startupMs,closeMs,sourcePath});this.child=null;this.starting=null;this.ready=null;this.active=null;this.closing=null;this.closed=false;}
 _send(frame){if(!this.child||this.closed||this.child.stdin.destroyed)fail('webauthn_unavailable');const line=JSON.stringify({...frame,nonce:this.nonce});if(Buffer.byteLength(line)>MAX_FRAME)fail();this.child.stdin.write(line+'\n');}
 async _start(){
  if(this.closed||this.closing||this.stopping)fail('webauthn_unavailable');if(this.ready)return this.ready;if(this.starting)return this.starting;if(this.platform!=='win32')fail('webauthn_unavailable');
  this.starting=new Promise((resolve,reject)=>{
   let source,exe;try{source=fs.readFileSync(this.sourcePath);if(source.length>196608)fail('webauthn_unavailable');exe=this.resolveExecutable();}catch{reject(new WindowsWebAuthnError('webauthn_unavailable'));return;}
   this.nonce=randomBytes(16).toString('hex');let child;try{child=this.spawnProcess(exe,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(BOOTSTRAP,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});}catch{reject(new WindowsWebAuthnError('webauthn_unavailable'));return;}
   this.child=child;let buffer='',settled=false,stderrBytes=0;
   const timer=setTimeout(()=>broken('webauthn_timeout'),this.startupMs);
   const broken=code=>{if(!settled){settled=true;clearTimeout(timer);reject(new WindowsWebAuthnError(code));}this.ready=null;if(this.active)this._settle(this.active,new WindowsWebAuthnError(code,this.active.sent));void this.close().catch(()=>{});};
   child.stdout.setEncoding('utf8');child.stderr.on('data',data=>{stderrBytes+=data.length;if(stderrBytes>65536)broken('webauthn_response_invalid');});
   child.stdout.on('data',chunk=>{buffer+=chunk;if(Buffer.byteLength(buffer)>MAX_FRAME*2){broken('webauthn_response_invalid');return;}for(;;){const n=buffer.indexOf('\n');if(n<0)break;const line=buffer.slice(0,n);buffer=buffer.slice(n+1);let f;try{if(Buffer.byteLength(line)>MAX_FRAME)throw Error();f=JSON.parse(line);if(!plain(f)||f.nonce!==this.nonce)throw Error();}catch{broken('webauthn_response_invalid');return;}
    if(!settled){try{keys(f,['nonce','event','pid','availability']);keys(f.availability,['protocol','supported','apiVersion','platformAuthenticatorAvailable','abiVerified']);const a=f.availability;if(f.event!=='ready'||f.pid!==child.pid||a.protocol!==1||!Number.isSafeInteger(a.apiVersion)||a.apiVersion<0||['supported','platformAuthenticatorAvailable','abiVerified'].some(k=>typeof a[k]!=='boolean')||a.supported&&(!a.abiVerified||a.apiVersion<1))throw Error();settled=true;clearTimeout(timer);this.ready=Object.freeze({...a});resolve(this.ready);}catch{broken('webauthn_response_invalid');}continue;}
    const a=this.active;if(f.event==='cancelled')continue;if(!a||f.operationId!==a.wire.operationId){broken('webauthn_response_invalid');continue;}
    if(f.event==='started'){a.nativeInvoked=true;continue;}
    if(f.event==='result'&&Object.hasOwn(f,'result'))this._settle(a,null,f.result);
    else if(f.event==='error'&&CODES.has(f.code)&&typeof f.nativeInvoked==='boolean')this._settle(a,new WindowsWebAuthnError(f.code,f.nativeInvoked));
    else broken('webauthn_response_invalid');
   }});
   child.on('error',()=>broken('webauthn_unavailable'));child.stdin.on('error',()=>broken('webauthn_unavailable'));
   this.exited=new Promise(done=>child.once('close',()=>{clearTimeout(timer);if(!settled){settled=true;reject(new WindowsWebAuthnError('webauthn_unavailable'));}if(this.active)this._settle(this.active,new WindowsWebAuthnError('webauthn_native_failed',this.active.sent));this.ready=null;this.child=null;done();}));
   child.stdin.write(source.toString('base64')+'\n');this._send({op:'init',protocol:1});
  });
  try{return await this.starting;}finally{this.starting=null;}
 }
 _settle(a,error,result){if(this.active!==a)return;this.active=null;clearTimeout(a.timer);clearTimeout(a.cancelTimer);a.signal?.removeEventListener('abort',a.abort);a.done();if(a.cancelCode)a.reject(new WindowsWebAuthnError(a.cancelCode,a.nativeInvoked||error?.nativeInvoked===true));else if(error)a.reject(error);else{try{a.resolve(checkResult(a.kind,result,a.wire));}catch{a.reject(new WindowsWebAuthnError('webauthn_response_invalid',true));}}}
 async availability({signal}={}){if(signal?.aborted)fail('webauthn_cancelled');const value=await this._start();if(signal?.aborted)fail('webauthn_cancelled');return {...value};}
 async _ceremony(kind,input,{signal,assertCurrent}={}){
  const wire=normalize(kind,input);if(this.active)fail('webauthn_busy');if(signal?.aborted)fail('webauthn_cancelled');guard(assertCurrent);
  // Reserve before compilation/await. A second caller cannot replace the operation.
  let settled;const completion=new Promise(resolve=>{settled=resolve;});let resolve,reject;const result=new Promise((a,b)=>{resolve=a;reject=b;});result.catch(()=>{});
  const a={kind,wire,resolve,reject,done:settled,completion,signal,sent:false,nativeInvoked:false,cancelCode:null};this.active=a;
  a.abort=()=>this._cancel(a,'webauthn_cancelled');signal?.addEventListener('abort',a.abort,{once:true});
  try{const available=await this._start();if(this.active!==a)return result;if(a.cancelCode||signal?.aborted)throw new WindowsWebAuthnError('webauthn_cancelled');if(!available.supported)fail('webauthn_unavailable');guard(assertCurrent);if(a.cancelCode||signal?.aborted)throw new WindowsWebAuthnError('webauthn_cancelled');a.timer=setTimeout(()=>this._cancel(a,'webauthn_timeout'),wire.timeout+1000);this._send({op:kind,...wire});a.sent=true;}catch(e){this._settle(a,new WindowsWebAuthnError(CODES.has(e?.code)?e.code:'webauthn_changed',false));}
  return result;
 }
 create(input,options){return this._ceremony('create',input,options);}
 get(input,options){return this._ceremony('get',input,options);}
 _cancel(a,code){if(this.active!==a)return false;a.cancelCode||=code;if(!a.sent){this._settle(a,new WindowsWebAuthnError(code));return true;}try{this._send({op:'cancel',operationId:a.wire.operationId});}catch{}if(!a.cancelTimer)a.cancelTimer=setTimeout(()=>{void this.close().catch(()=>{if(this.active===a)this._settle(a,new WindowsWebAuthnError('webauthn_close_unconfirmed',true));});},this.closeMs);return true;}
 async cancel(operationId){const a=this.active;if(!a||a.wire.operationId!==operationId)return {cancelRequested:false,settled:true};this._cancel(a,'webauthn_cancelled');await a.completion;return {cancelRequested:true,settled:this.active!==a};}
 async close(){
  if(this.closed)return {closed:true};if(this.closing)return this.closing;this.stopping=true;
  this.closing=(async()=>{const child=this.child;if(!child){if(this.active)this._settle(this.active,new WindowsWebAuthnError('webauthn_cancelled'));this.closed=true;return {closed:true};}
   if(this.active)this._cancel(this.active,'webauthn_cancelled');try{this._send({op:'close'});}catch{}
   const wait=ms=>new Promise(resolve=>{const t=setTimeout(()=>resolve(false),ms);this.exited.then(()=>{clearTimeout(t);resolve(true);});});
   let gone=await wait(this.closeMs);if(!gone){try{child.kill();}catch{}gone=await wait(this.closeMs);}
   if(!gone)throw new WindowsWebAuthnError('webauthn_close_unconfirmed',!!this.active?.sent);this.closed=true;return {closed:true};
  })();try{return await this.closing;}finally{this.closing=null;}
 }
}
module.exports={WindowsWebAuthn,WindowsWebAuthnError};
