'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Worker}=require('node:worker_threads');
const MAX_BYTES=512*1024,HEADER_BYTES=16,MAX_WAIT_MS=10000;
const SERVICE='agent-arcade Safe Storage',ACCOUNT='agent-arcade Key',IDENTIFIER='io.github.agentarcade.credentials.v1';
const CODES=new Set(['INVALID_PROFILE','UNSAFE_HELPER','HELPER_CHANGED','IDENTITY_MISMATCH','CALLER_REJECTED','INVALID_REQUEST','INVALID_RESPONSE','HELPER_FAILED','HELPER_TIMEOUT','UNAVAILABLE','KEYCHAIN_DENIED','KEYCHAIN_LOCKED','KEYCHAIN_MISSING','KEYCHAIN_FAILED','CRYPTO_FAILED','INVALID_CIPHERTEXT','INTERACTION_REQUIRED']);
class MacCredentialError extends Error{constructor(code){const safe=CODES.has(code)?code:'HELPER_FAILED';super(`Mac credential helper failed (${safe}).`);this.name='MacCredentialError';this.code=safe;}}
function fail(code){throw new MacCredentialError(code);}
function identity(value){if(typeof value!=='string'||!/^[a-fA-F0-9]{40}$/.test(value))fail('INVALID_PROFILE');return value.toUpperCase();}
function requirement(trustedIdentity){return `=identifier "${IDENTIFIER}" and certificate root=H"${identity(trustedIdentity)}"`;}
function validateProfile(profile,{trustedIdentity,pathRoot=path.join(os.homedir(),'Library','Application Support','Agent Arcade Credentials')}={}){
 const fields=['schema','protocol','helperPath','helperSha256','helperCdHash','identitySha1','sourceSha256','service','account'];
 if(!profile||typeof profile!=='object'||Array.isArray(profile)||Object.keys(profile).length!==fields.length||fields.some(key=>!Object.hasOwn(profile,key))||profile.schema!==1||profile.protocol!==1||profile.service!==SERVICE||profile.account!==ACCOUNT||typeof profile.helperPath!=='string'||profile.helperPath!==path.join(path.resolve(pathRoot),'helper-v1')||!['helperSha256','sourceSha256'].every(key=>typeof profile[key]==='string'&&/^[a-fA-F0-9]{64}$/.test(profile[key]))||typeof profile.helperCdHash!=='string'||!/^[a-fA-F0-9]{40}$/.test(profile.helperCdHash))fail('INVALID_PROFILE');
 if(identity(profile.identitySha1)!==identity(trustedIdentity))fail('IDENTITY_MISMATCH');
 return Object.freeze({...profile,identitySha1:identity(trustedIdentity),helperSha256:profile.helperSha256.toLowerCase(),helperCdHash:profile.helperCdHash.toLowerCase()});
}
// The immediate private directory and file must be owned by this user. Every
// component is checked with lstat: realpath alone would silently accept links.
function inspectHelper(profile,{fs:io=fs,uid=process.getuid?.()}={}){
 try{
  let current=path.parse(profile.helperPath).root;
  for(const component of profile.helperPath.slice(current.length).split(path.sep)){current=path.join(current,component);if(io.lstatSync(current).isSymbolicLink())fail('UNSAFE_HELPER');}
  const parent=io.lstatSync(path.dirname(profile.helperPath)),file=io.lstatSync(profile.helperPath);
  if(!Number.isInteger(uid)||!parent.isDirectory()||parent.uid!==uid||(parent.mode&0o7777)!==0o700||!file.isFile()||file.uid!==uid||![0o500,0o700].includes(file.mode&0o7777)||file.nlink!==1||file.size<1||file.size>32*1024*1024)fail('UNSAFE_HELPER');
  const fd=io.openSync(profile.helperPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const opened=io.fstatSync(fd);if(opened.dev!==file.dev||opened.ino!==file.ino)fail('HELPER_CHANGED');const bytes=io.readFileSync(fd);try{if(crypto.createHash('sha256').update(bytes).digest('hex')!==profile.helperSha256)fail('HELPER_CHANGED');}finally{bytes.fill(0);}}finally{io.closeSync(fd);}
  return {dev:file.dev,ino:file.ino};
 }catch(error){if(error instanceof MacCredentialError)throw error;fail('UNSAFE_HELPER');}
}
function validateRequest(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1)fail('INVALID_REQUEST');
 const op=value.operation,keys=op==='status'?['version','operation']:op==='encrypt'?['version','operation','text']:op==='decrypt'?['version','operation','data']:[];
 if(!keys.length||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))||op==='encrypt'&&typeof value.text!=='string'||op==='decrypt'&&!base64(value.data))fail('INVALID_REQUEST');
 if(Buffer.byteLength(JSON.stringify(value))>MAX_BYTES)fail('INVALID_REQUEST');return value;
}
function base64(value){return typeof value==='string'&&value.length>0&&value.length%4===0&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)&&Buffer.from(value,'base64').toString('base64')===value;}
function validateResult(value,operation){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1)fail('INVALID_RESPONSE');
 const keys=Object.keys(value).sort().join(',');
 if(value.status==='error'){if(keys!=='code,status,version'||!CODES.has(value.code))fail('INVALID_RESPONSE');return {version:1,status:'error',code:value.code};}
 if(value.status!=='ok')fail('INVALID_RESPONSE');
 if(operation==='status'&&keys==='available,status,version'&&typeof value.available==='boolean')return {version:1,status:'ok',available:value.available};
 if(operation==='encrypt'&&keys==='data,status,version'&&base64(value.data))return {version:1,status:'ok',data:value.data};
 if(operation==='decrypt'&&keys==='status,text,version'&&typeof value.text==='string')return {version:1,status:'ok',text:value.text};
 fail('INVALID_RESPONSE');
}
function createMacCredentialVault(options={}){
 const profile=validateProfile(options.profile,options),workerFactory=options.workerFactory||((filename,config)=>new Worker(filename,config));
 const timeoutMs=Math.min(8500,Math.max(1,Number.isFinite(options.timeoutMs)?options.timeoutMs:8000));
 function call(request){
  validateRequest(request);inspectHelper(profile,options);
  const shared=new SharedArrayBuffer(HEADER_BYTES+MAX_BYTES*2),control=new Int32Array(shared,0,4),input=new Uint8Array(shared,HEADER_BYTES,MAX_BYTES),output=new Uint8Array(shared,HEADER_BYTES+MAX_BYTES,MAX_BYTES);
  const bytes=Buffer.from(JSON.stringify(request));input.set(bytes);Atomics.store(control,1,bytes.length);bytes.fill(0);
  let worker;
  try{
   worker=workerFactory(path.join(__dirname,'mac-credential-worker.cjs'),{workerData:{shared,profile,trustedIdentity:options.trustedIdentity,pathRoot:options.pathRoot,timeoutMs}});
   // Native helper has its own lifetime bound. Do not terminate a worker that
   // may own a child: cancellation lets it kill and reap the process first.
   worker.on?.('error',()=>{});worker.unref?.();
   const started=Date.now();Atomics.wait(control,0,0,MAX_WAIT_MS-500);
   if(Atomics.load(control,0)===0){Atomics.store(control,3,1);Atomics.wait(control,0,0,Math.max(0,MAX_WAIT_MS-(Date.now()-started)));}
   if(Atomics.load(control,0)!==1)fail('HELPER_TIMEOUT');
   const size=Atomics.load(control,2);if(size<1||size>MAX_BYTES)fail('INVALID_RESPONSE');
   let value;try{value=validateResult(JSON.parse(Buffer.from(output.subarray(0,size)).toString('utf8')),request.operation);}catch(error){if(error instanceof MacCredentialError)throw error;fail('INVALID_RESPONSE');}
   if(value.status==='error')fail(value.code);return value;
  }catch(error){if(error instanceof MacCredentialError)throw error;fail('HELPER_FAILED');}
  finally{input.fill(0);output.fill(0);Atomics.store(control,3,1);}
 }
 return Object.freeze({isEncryptionAvailable(){try{return call({version:1,operation:'status'}).available;}catch{return false;}},encryptString(text){return Buffer.from(call({version:1,operation:'encrypt',text}).data,'base64');},decryptString(data){if(!Buffer.isBuffer(data)||!data.length||data.length>MAX_BYTES)fail('INVALID_REQUEST');return call({version:1,operation:'decrypt',data:data.toString('base64')}).text;}});
}
module.exports={createMacCredentialVault,MacCredentialError,validateProfile,inspectHelper,validateRequest,validateResult,requirement,MAX_BYTES,HEADER_BYTES,CODES};
