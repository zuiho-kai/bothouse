'use strict';
const childProcess=require('node:child_process'),os=require('node:os');
const {isMainThread,workerData}=require('node:worker_threads');
const {MacCredentialError,validateProfile,inspectHelper,validateRequest,validateResult,requirement,MAX_BYTES,HEADER_BYTES}=require('./mac-credential-vault.cjs');
const NATIVE_ERRORS=Object.freeze({unauthorized:'IDENTITY_MISMATCH',invalid_request:'INVALID_REQUEST',keychain_unavailable:'UNAVAILABLE',key_not_found:'KEYCHAIN_MISSING',crypto_failed:'CRYPTO_FAILED',timeout:'HELPER_TIMEOUT',internal_error:'HELPER_FAILED',configuration_invalid:'INVALID_PROFILE',request_too_large:'INVALID_REQUEST',peer_rejected:'IDENTITY_MISMATCH',keychain_locked:'KEYCHAIN_LOCKED',item_missing:'KEYCHAIN_MISSING',item_ambiguous:'KEYCHAIN_FAILED',invalid_ciphertext:'INVALID_CIPHERTEXT',io_failed:'HELPER_FAILED'});
function error(code){return new MacCredentialError(code);}
function displayIdentity(text,profile){
 const hashes=[...text.matchAll(/^CDHash=([a-fA-F0-9]{40})\s*$/gm)],flags=[...text.matchAll(/^CodeDirectory .*?flags=0x([a-fA-F0-9]+)/gm)];
 if(hashes.length!==1||hashes[0][1].toLowerCase()!==profile.helperCdHash||flags.length!==1)throw error('IDENTITY_MISMATCH');
 const bits=Number.parseInt(flags[0][1],16);if((bits&0x10200)!==0x10200||(bits&0x6)!==0)throw error('IDENTITY_MISMATCH');
}
// execFile receives no plaintext; stderr is used only for fixed codesign
// metadata and is never included in errors, diagnostics or the shared result.
function codesign(args,{execFile=childProcess.execFile,timeoutMs}){return new Promise((resolve,reject)=>{
 try{execFile('/usr/bin/codesign',args,{encoding:'utf8',timeout:Math.max(1,timeoutMs),maxBuffer:16384,windowsHide:true,env:{PATH:'/usr/bin:/bin'}},(failure,stdout,stderr)=>{if(failure)reject(error('IDENTITY_MISMATCH'));else resolve(String(stdout||'')+String(stderr||''));});}catch{reject(error('IDENTITY_MISMATCH'));}
});}
async function runHelperRequest(rawProfile,rawRequest,options={}){
 const profile=validateProfile(rawProfile,options),request=validateRequest(rawRequest),authorize=options.authorize===true;
 if(authorize&&request.operation!=='status')throw error('INVALID_REQUEST');
 const limit=authorize?120000:8000,timeoutMs=Math.min(limit,Math.max(1,Number.isFinite(options.timeoutMs)?options.timeoutMs:limit)),deadline=Date.now()+timeoutMs;
 const remaining=()=>Math.max(1,deadline-Date.now()),signOptions=()=>({...options,timeoutMs:remaining()});
 const original=inspectHelper(profile,options);
 await codesign(['--verify','--verbose=4','--strict','-R',requirement(options.trustedIdentity),profile.helperPath],signOptions());
 displayIdentity(await codesign(['-d','--verbose=4',profile.helperPath],signOptions()),profile);
 const checked=inspectHelper(profile,options);if(checked.dev!==original.dev||checked.ino!==original.ino)throw error('HELPER_CHANGED');
 if(Date.now()>=deadline)throw error('HELPER_TIMEOUT');
 const spawn=options.spawn||childProcess.spawn;
 return new Promise((resolve,reject)=>{
  let child,settled=false,failure=null,response=null,buffer=Buffer.alloc(0),size=0,frames=0,verified=false,checking=false,closed=false,pendingPayload=null;
  let timer,cancel;
  const stop=code=>{pendingPayload?.fill(0);pendingPayload=null;if(!failure)failure=error(code);try{child?.stdin?.destroy();child?.kill('SIGKILL');}catch{};};
  const finish=()=>{
   if(settled)return;settled=true;clearTimeout(timer);clearInterval(cancel);buffer.fill(0);pendingPayload?.fill(0);pendingPayload=null;
   if(failure)reject(failure);else if(!response||frames!==2)reject(error('INVALID_RESPONSE'));else resolve(response);
  };
  const verifyReady=async frame=>{
   if(!frame||Object.keys(frame).sort().join(',')!=='pid,status,version'||frame.version!==1||frame.status!=='ready'||!Number.isSafeInteger(frame.pid)||frame.pid!==child.pid||frame.pid<2){stop('IDENTITY_MISMATCH');return;}
   checking=true;
   try{
    // PID verification checks dynamic validity. Verbosity and -R additionally
    // invoke static disk-representation checks unsupported by PID diskreps
    // on current macOS. The full static pin check above remains mandatory;
    // matching the live CodeDirectory binds this process back to that code.
    // A nonzero exit always fails, regardless of any 'dynamically valid' text.
    await codesign(['--verify',`+${child.pid}`],signOptions());
    displayIdentity(await codesign(['-d','--verbose=4',`+${child.pid}`],signOptions()),profile);
    if(failure||closed||Date.now()>=deadline||options.cancelled?.()){stop('HELPER_TIMEOUT');return;}
    verified=true;
    pendingPayload=Buffer.from(JSON.stringify(request));
    try{child.stdin.end(pendingPayload,()=>{pendingPayload?.fill(0);pendingPayload=null;});}catch{pendingPayload?.fill(0);pendingPayload=null;throw error('HELPER_FAILED');}
   }catch{stop('IDENTITY_MISMATCH');}
   finally{checking=false;if(closed)finish();}
  };
  try{
   child=spawn(profile.helperPath,authorize?['--authorize']:[],{stdio:['pipe','pipe','ignore'],windowsHide:true,env:{PATH:'/usr/bin:/bin',HOME:options.home||os.homedir(),LANG:'en_US.UTF-8'}});
   if(!Number.isSafeInteger(child.pid)||!child.stdin||!child.stdout){stop('HELPER_FAILED');finish();return;}
   timer=setTimeout(()=>stop('HELPER_TIMEOUT'),remaining());
   cancel=setInterval(()=>{if(options.cancelled?.())stop('HELPER_TIMEOUT');},10);
   child.stdin.on('error',()=>stop('HELPER_FAILED'));
   child.stdout.on('data',chunk=>{
    if(failure)return;
    size+=chunk.length;if(size>MAX_BYTES){stop('INVALID_RESPONSE');return;}
    const previous=buffer;buffer=Buffer.concat([buffer,chunk]);previous.fill(0);
    let newline;
    while((newline=buffer.indexOf(10))!==-1){
     let frame;try{frame=JSON.parse(buffer.subarray(0,newline).toString('utf8'));}catch{stop('INVALID_RESPONSE');return;}
     const tail=Buffer.from(buffer.subarray(newline+1));buffer.fill(0);buffer=tail;frames++;
     if(frames===1){
      if(frame?.version===1&&frame.status==='error'&&frame.code==='unauthorized'&&Object.keys(frame).sort().join(',')==='code,status,version'){stop('CALLER_REJECTED');return;}
      void verifyReady(frame);
     }
     else if(frames===2&&verified){
      try{if(frame?.status==='error'&&Object.keys(frame).sort().join(',')==='code,status,version'&&Object.hasOwn(NATIVE_ERRORS,frame.code))frame={version:frame.version,status:'error',code:NATIVE_ERRORS[frame.code]};response=validateResult(frame,request.operation);}catch{stop('INVALID_RESPONSE');return;}
     }else{stop('INVALID_RESPONSE');return;}
    }
   });
   child.stdout.on('error',()=>stop('HELPER_FAILED'));
   child.on('error',()=>{stop('HELPER_FAILED');if(!child.pid)finish();});
   child.on('close',code=>{closed=true;if(code!==0&&!failure&&response?.status!=='error')failure=error('HELPER_FAILED');if(buffer.length&&!failure)failure=error('INVALID_RESPONSE');if(!checking)finish();});
  }catch{stop('HELPER_FAILED');finish();}
 });
}
async function runShared(data){
 const control=new Int32Array(data.shared,0,4),input=new Uint8Array(data.shared,HEADER_BYTES,MAX_BYTES),output=new Uint8Array(data.shared,HEADER_BYTES+MAX_BYTES,MAX_BYTES);
 let response,request;
 try{
  const length=Atomics.load(control,1);if(length<1||length>MAX_BYTES)throw error('INVALID_REQUEST');
  try{request=JSON.parse(Buffer.from(input.subarray(0,length)).toString('utf8'));}finally{input.fill(0);}
  response=await runHelperRequest(data.profile,request,{trustedIdentity:data.trustedIdentity,pathRoot:data.pathRoot,timeoutMs:data.timeoutMs,cancelled:()=>Atomics.load(control,3)!==0});
 }catch(failure){response={version:1,status:'error',code:failure instanceof MacCredentialError?failure.code:'HELPER_FAILED'};}
 finally{request=null;input.fill(0);}
 let bytes=Buffer.from(JSON.stringify(response));response=null;
 if(bytes.length>MAX_BYTES){bytes.fill(0);bytes=Buffer.from('{"version":1,"status":"error","code":"INVALID_RESPONSE"}');}
 output.set(bytes);Atomics.store(control,2,bytes.length);bytes.fill(0);Atomics.store(control,0,1);Atomics.notify(control,0);
}
if(!isMainThread)void runShared(workerData);
module.exports={runHelperRequest,displayIdentity};
