'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomBytes,randomUUID,generateKeyPairSync,createPublicKey,publicEncrypt,privateDecrypt,createCipheriv,createDecipheriv,createHash,constants}=require('node:crypto');

const WORKER_FLAG='--arcade-vault-migration-worker';
const MAX_PLAIN=128*1024,MAX_FILE=192*1024,MAX_REQUEST=16*1024,MAX_RESPONSE=256*1024;
const CODES=new Set(['INVALID_MIGRATION','UNREGISTERED_SOURCE','SOURCE_CHANGED','TARGET_EXISTS','TARGET_CHANGED','TARGET_WRITE_FAILED','MIGRATION_TIMEOUT','WORKER_FAILED','INVALID_RESPONSE','PROFILE_MISMATCH','PROFILE_IN_USE','VAULT_INVALID','VAULT_OPEN_FAILED','ENCRYPTION_UNAVAILABLE']);
class VaultMigrationError extends Error {constructor(code){super(`Application credential migration failed (${CODES.has(code)?code:'WORKER_FAILED'}). Original credentials were kept.`);this.name='VaultMigrationError';this.code=CODES.has(code)?code:'WORKER_FAILED';}}
const fail=code=>{throw new VaultMigrationError(code);};
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function directory(value){
  if(typeof value!=='string'||value.length>4096||!path.isAbsolute(value))fail('INVALID_MIGRATION');
  try{const real=fs.realpathSync(value);if(!fs.statSync(real).isDirectory())fail('INVALID_MIGRATION');return real;}catch{fail('INVALID_MIGRATION');}
}
function readSource(root){
  const file=path.join(root,'bot-vault.json');
  try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_FILE||!stat.size)fail('VAULT_INVALID');
    const bytes=fs.readFileSync(file);if(bytes.length>MAX_FILE)fail('VAULT_INVALID');
    const envelope=JSON.parse(bytes.toString('utf8'));if(!plain(envelope)||typeof envelope.data!=='string'||!envelope.data||envelope.data.length>MAX_FILE||!/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.data))fail('VAULT_INVALID');
    return {data:envelope.data,hash:createHash('sha256').update(bytes).digest('hex')};
  }catch(error){if(error instanceof VaultMigrationError)throw error;fail('VAULT_INVALID');}
}
function validatePlaintext(value){
  if(typeof value!=='string'||!value||Buffer.byteLength(value)>MAX_PLAIN)fail('VAULT_INVALID');
  try{if(!plain(JSON.parse(value)))fail('VAULT_INVALID');}catch{fail('VAULT_INVALID');}
  return value;
}
function validateRequest(request){
  if(!plain(request)||Object.keys(request).sort().join(',')!=='nonce,publicKey,sourceHash,sourceProfile,sourceRoot,version'||request.version!==1||typeof request.nonce!=='string'||!/^[a-f0-9]{64}$/.test(request.nonce)||typeof request.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(request.sourceHash)||typeof request.publicKey!=='string'||request.publicKey.length>4096)fail('INVALID_MIGRATION');
  const sourceRoot=directory(request.sourceRoot),sourceProfile=directory(request.sourceProfile);
  if(!samePath(sourceRoot,request.sourceRoot)||!samePath(sourceProfile,request.sourceProfile))fail('INVALID_MIGRATION');
  try{const key=createPublicKey(request.publicKey);if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength!==3072)fail('INVALID_MIGRATION');}catch{fail('INVALID_MIGRATION');}
  return {...request,sourceRoot,sourceProfile};
}
function sealPayload(text,publicKey,nonce,sourceHash){
  validatePlaintext(text);const key=randomBytes(32),iv=randomBytes(12);
  try{const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(`arcade-vault-v1:${nonce}:${sourceHash}`));
    const ciphertext=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);
    const wrappedKey=publicEncrypt({key:publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
    return {version:1,status:'ok',nonce,sourceHash,wrappedKey:wrappedKey.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
  }finally{key.fill(0);}
}
function openPayload(response,privateKey,nonce,sourceHash){
  let key;
  try{
    if(!plain(response)||response.version!==1||response.status!=='ok'||response.nonce!==nonce||response.sourceHash!==sourceHash||Object.keys(response).sort().join(',')!=='ciphertext,iv,nonce,sourceHash,status,tag,version,wrappedKey')fail('INVALID_RESPONSE');
    const decode=(name,max)=>{const value=response[name];if(typeof value!=='string'||value.length>max||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))fail('INVALID_RESPONSE');return Buffer.from(value,'base64');};
    key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},decode('wrappedKey',1024));
    const iv=decode('iv',32),tag=decode('tag',32),ciphertext=decode('ciphertext',Math.ceil(MAX_PLAIN/3)*4+8);
    if(key.length!==32||iv.length!==12||tag.length!==16)fail('INVALID_RESPONSE');
    const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from(`arcade-vault-v1:${nonce}:${sourceHash}`));decipher.setAuthTag(tag);
    return validatePlaintext(Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8'));
  }catch{fail('INVALID_RESPONSE');}finally{key?.fill(0);}
}
function exchange(child,request,timeoutMs){
  return new Promise((resolve,reject)=>{
    let output='',size=0,settled=false,ready=false,response=null;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){try{child.kill();}catch{}reject(error);}else resolve(result);};
    const timer=setTimeout(()=>finish(new VaultMigrationError('MIGRATION_TIMEOUT')),timeoutMs);
    child.on('error',()=>finish(new VaultMigrationError('WORKER_FAILED')));
    child.stdin.on('error',()=>finish(new VaultMigrationError('WORKER_FAILED')));
    child.stdout.on('data',chunk=>{
      size+=chunk.length;if(size>MAX_RESPONSE)return finish(new VaultMigrationError('INVALID_RESPONSE'));output+=chunk.toString('utf8');
      for(let newline;(newline=output.indexOf('\n'))!==-1;){
        const line=output.slice(0,newline).trim();output=output.slice(newline+1);if(!line)continue;
        try{const value=JSON.parse(line);
          if(!ready){
            if(!plain(value)||value.version!==1||value.status!=='ready'||Object.keys(value).sort().join(',')!=='status,version')fail('INVALID_RESPONSE');
            ready=true;
            // Send only after the worker has installed its request listeners.
            child.stdin.end(JSON.stringify(request)+'\n');
          }else{if(response)fail('INVALID_RESPONSE');response=value;}
        }catch{return finish(new VaultMigrationError('INVALID_RESPONSE'));}
      }
    });
    // Never relay worker diagnostics: only the fixed protocol can leave here.
    child.stderr.on('data',()=>{});
    child.on('close',code=>{
      if(settled)return;
      try{
        if(!ready||!response||output.trim())fail('INVALID_RESPONSE');
        if(response.status==='error'&&CODES.has(response.code))return finish(new VaultMigrationError(response.code));
        if(code!==0)return finish(new VaultMigrationError('WORKER_FAILED'));
        finish(null,response);
      }catch{finish(new VaultMigrationError('INVALID_RESPONSE'));}
    });
  });
}
function saveTarget(targetRoot,text,vault){
  const file=path.join(targetRoot,'bot-vault.json'),temporary=path.join(targetRoot,`.vault-migration-${randomUUID()}.tmp`);
  let bytes,linked=false;
  try{
    const data=vault.encryptString(text);if(!Buffer.isBuffer(data)||!data.length||data.length>MAX_PLAIN+4096||vault.decryptString(data)!==text)fail('TARGET_WRITE_FAILED');
    bytes=Buffer.from(JSON.stringify({data:data.toString('base64')})+'\n');
    const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    // A hard link publishes the fully written encrypted file without replacing
    // another process's target. Both paths are on the same destination volume.
    fs.linkSync(temporary,file);linked=true;
    if(!fs.readFileSync(file).equals(bytes))fail('TARGET_WRITE_FAILED');
    return createHash('sha256').update(bytes).digest('hex');
  }catch(error){
    if(linked){try{if(fs.readFileSync(file).equals(bytes))fs.unlinkSync(file);}catch{}}
    if(error?.code==='EEXIST')fail('TARGET_EXISTS');
    if(error instanceof VaultMigrationError)throw error;fail('TARGET_WRITE_FAILED');
  }finally{try{fs.unlinkSync(temporary);}catch{}}
}
async function migrateApplicationVault({electronPath,devAppPath,sourceRoot,sourceProfile,targetRoot,registeredRoots,recoverTargetSha256,vault,spawnProcess=spawn,timeoutMs=30000}={}){
  if(!Array.isArray(registeredRoots)||!registeredRoots.length||registeredRoots.length>6||typeof electronPath!=='string'||!path.isAbsolute(electronPath)||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)fail('INVALID_MIGRATION');
  const source=directory(sourceRoot),profile=directory(sourceProfile),target=directory(targetRoot);
  if(!registeredRoots.some(root=>samePath(directory(root),source)))fail('UNREGISTERED_SOURCE');
  if(samePath(source,target))fail('INVALID_MIGRATION');
  if(!vault?.isEncryptionAvailable?.())fail('ENCRYPTION_UNAVAILABLE');
  let existingText,existing;
  if(recoverTargetSha256!==undefined&&(typeof recoverTargetSha256!=='string'||!/^[a-f0-9]{64}$/.test(recoverTargetSha256)))fail('INVALID_MIGRATION');
  if(fs.existsSync(path.join(target,'bot-vault.json'))){
    if(!recoverTargetSha256)fail('TARGET_EXISTS');
    try{existing=readSource(target);existingText=validatePlaintext(vault.decryptString(Buffer.from(existing.data,'base64')));}catch{fail('TARGET_EXISTS');}
    if(existing.hash!==recoverTargetSha256)fail('TARGET_CHANGED');
  }else if(recoverTargetSha256)fail('TARGET_CHANGED');
  const original=readSource(source),nonce=randomBytes(32).toString('hex');
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'}});
  const request={version:1,nonce,sourceRoot:source,sourceProfile:profile,sourceHash:original.hash,publicKey};
  const args=[...(devAppPath?[directory(devAppPath)]:[]),WORKER_FLAG,`--user-data-dir=${profile}`];
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  let child;
  try{child=spawnProcess(electronPath,args,{stdio:['pipe','pipe','pipe'],windowsHide:true,env});}catch{fail('WORKER_FAILED');}
  const response=await exchange(child,request,timeoutMs);
  const text=openPayload(response,privateKey,nonce,original.hash);
  if(readSource(source).hash!==original.hash)fail('SOURCE_CHANGED');
  if(existing){
    // A crash may have published the encrypted copy before its registry entry.
    // Re-open the original through its normal profile, then compare only in
    // memory. A readable but unrelated target is never adopted or overwritten.
    let current;try{current=readSource(target);}catch{fail('TARGET_CHANGED');}
    if(current.hash!==existing.hash)fail('TARGET_CHANGED');
    if(existingText!==text)fail('TARGET_EXISTS');
    return {migrated:true,recovered:true,sourceRoot:source,targetRoot:target,sourceVaultSha256:original.hash,targetVaultSha256:existing.hash};
  }
  const targetVaultSha256=saveTarget(target,text,vault);
  return {migrated:true,sourceRoot:source,targetRoot:target,sourceVaultSha256:original.hash,targetVaultSha256};
}
module.exports={migrateApplicationVault,VaultMigrationError,WORKER_FLAG,MAX_REQUEST,MAX_RESPONSE,MAX_PLAIN,validateRequest,validatePlaintext,readSource,sealPayload,samePath,directory,CODES};
