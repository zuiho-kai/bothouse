'use strict';

// Private recovery data only. No renderer API, plaintext log, or global NapCat
// configuration is used to recover a running account's management address.
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const MAX_PAYLOAD=3072,MAX_FILE=4096;
const unavailable=()=>Object.assign(Error('Encrypted QQ management recovery is unavailable. Stop this QQ runtime and start it again in the app.'),{code:'endpoint_recovery_unavailable'});
const canonical=value=>{
  if(typeof value!=='string'||value.includes('\0')||/^[/\\]{2}/.test(value)||!path.isAbsolute(value))throw unavailable();
  return path.resolve(value).toLowerCase();
};
const account=value=>typeof value==='string'&&/^[1-9]\d{4,11}$/.test(value);
const proof=value=>!!value&&Number.isSafeInteger(value.pid)&&value.pid>0&&typeof value.createdAt==='string'&&value.createdAt.length<64&&Number.isFinite(Date.parse(value.createdAt))&&typeof value.executable==='string'&&value.executable.length<768&&path.isAbsolute(value.executable)&&!value.executable.includes('\0');
const sameProof=(a,b)=>proof(a)&&proof(b)&&a.pid===b.pid&&a.createdAt===b.createdAt&&canonical(a.executable)===canonical(b.executable);
function secureDirectory(dir,create=false){
  canonical(dir);const resolved=path.resolve(dir),base=path.parse(resolved).root;let current=base;
  for(const part of resolved.slice(base.length).split(path.sep).filter(Boolean)){
    current=path.join(current,part);
    try{const st=fs.lstatSync(current);if(!st.isDirectory()||st.isSymbolicLink())throw unavailable();}
    catch(error){if(error.code!=='ENOENT'||!create)throw unavailable();fs.mkdirSync(current,{mode:0o700});}
    if(canonical(fs.realpathSync(current))!==canonical(current))throw unavailable();
  }
}
function readCipher(file){
  let fd;
  try{
    const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size<1||stat.size>MAX_FILE)throw unavailable();
    fd=fs.openSync(file,'r');const opened=fs.fstatSync(fd);if(opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)throw unavailable();
    const data=Buffer.alloc(stat.size);if(fs.readSync(fd,data,0,data.length,0)!==data.length)throw unavailable();return data;
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}
class QQRuntimeEndpointStore {
  constructor({root,profileRoot,componentsRoot,installationId,vault}){
    if(installationId!==undefined&&(typeof installationId!=='string'||!/^[a-f0-9]{64}$/.test(installationId)))throw unavailable();
    const base=path.join(path.resolve(root),'qq-runtime-endpoints');
    // Preserve the legacy v1 location and ciphertext. A newly managed
    // installation never reads, replaces or migrates that account-only file.
    this.directory=installationId===undefined?base:path.join(base,'installations',installationId);
    this.version=installationId===undefined?1:2;
    this.context={applicationRoot:canonical(root),profileRoot:canonical(profileRoot),componentsRoot:canonical(componentsRoot),...(installationId===undefined?{}:{installationId})};
    this.vault=vault;
  }
  file(accountId){if(!account(accountId))throw unavailable();return path.join(this.directory,`${createHash('sha256').update(accountId).digest('hex')}.bin`);}
  checkVault(){if(!this.vault?.isEncryptionAvailable?.()||typeof this.vault.encryptString!=='function'||typeof this.vault.decryptString!=='function')throw unavailable();}
  validate(value,accountId){
    if(!value||value.version!==this.version||value.accountId!==accountId||JSON.stringify(value.context)!==JSON.stringify(this.context)||!proof(value.runtime)||!proof(value.listener))throw unavailable();
    const endpoint=value.endpoint;
    if(!endpoint||!Number.isInteger(endpoint.port)||endpoint.port<1||endpoint.port>65535||!['http:','https:'].some(protocol=>endpoint.baseUrl===`${protocol}//127.0.0.1:${endpoint.port}`)||typeof endpoint.token!=='string'||endpoint.token.length<1||endpoint.token.length>256||/[\x00-\x20\x7f]/.test(endpoint.token))throw unavailable();
    return value;
  }
  read(accountId){
    this.checkVault();secureDirectory(this.directory);const data=readCipher(this.file(accountId));
    const plain=this.vault.decryptString(data);if(typeof plain!=='string'||Buffer.byteLength(plain)>MAX_PAYLOAD)throw unavailable();
    return {value:this.validate(JSON.parse(plain),accountId),cipherHash:createHash('sha256').update(data).digest('hex')};
  }
  load(accountId,runtime){
    try{const {value}=this.read(accountId);if(!sameProof(value.runtime,runtime))throw unavailable();return value;}
    catch{throw unavailable();}
  }
  save(accountId,{runtime,listener,endpoint}){
    let temp;
    try{
      this.checkVault();secureDirectory(this.directory,true);
      const value=this.validate({version:this.version,context:this.context,accountId,runtime,listener,endpoint},accountId),plain=JSON.stringify(value);
      if(Buffer.byteLength(plain)>MAX_PAYLOAD)throw unavailable();
      const file=this.file(accountId);let previous=null,exists=false;
      try{fs.lstatSync(file);exists=true;}catch(error){if(error.code!=='ENOENT')throw unavailable();}
      // Never replace a malformed file, changed profile or swapped ciphertext.
      if(exists)previous=this.read(accountId);
      if(previous&&JSON.stringify(previous.value)===plain)return;
      const cipher=this.vault.encryptString(plain);if(!Buffer.isBuffer(cipher)||cipher.length<1||cipher.length>MAX_FILE)throw unavailable();
      temp=`${file}.${randomUUID()}.tmp`;let fd;
      try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,cipher);fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);}
      secureDirectory(this.directory);
      if(previous){if(createHash('sha256').update(readCipher(file)).digest('hex')!==previous.cipherHash)throw unavailable();}
      else {try{fs.lstatSync(file);throw unavailable();}catch(error){if(error.code!=='ENOENT')throw error;}}
      fs.renameSync(temp,file);temp=null;
    }catch{throw unavailable();}
    finally{if(temp)try{fs.unlinkSync(temp);}catch{/* Do not expose private paths or underlying error text. */}}
  }
}
module.exports={QQRuntimeEndpointStore,MAX_PAYLOAD,MAX_FILE};
