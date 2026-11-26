'use strict';

// Main-process installation adapter. The reader is injected from the fixed
// setup root + opaque setup ID; it is never a renderer-supplied object/path.
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
function fail(code='invalid_installation'){throw Object.assign(new Error(`Managed QQ layout failed (${code}).`),{code});}
function local(value){if(typeof value!=='string'||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||/[\0\r\n]/.test(value)||value.slice(2).includes(':'))fail();return path.resolve(value);}
function directory(value){const file=local(value);let cursor=file;for(;;){const st=fs.lstatSync(cursor);if(!st.isDirectory()||st.isSymbolicLink())fail('unsafe_path');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}if(!same(fs.realpathSync(file),file))fail('unsafe_path');return file;}
function normalized(value){
  if(!value||value.schema!=='qq_managed_shell_v1'||value.engine!=='managed-shell'||value.dataPolicy!=='isolated-new'||value.previous!==null||typeof value.setupId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.setupId)||!hex(value.descriptorSha256))fail();
  const installationRoot=directory(value.installationRoot),workDir=directory(value.workDir),configDir=directory(value.configDir),qqDataDir=directory(value.qqDataDir);
  if(path.basename(installationRoot)!==value.setupId||!same(workDir,path.join(installationRoot,'work'))||!same(configDir,path.join(workDir,'config'))||!same(qqDataDir,path.join(installationRoot,'qq-data'))||value.installationId!==hash(installationRoot.toLowerCase()))fail();
  const qq=value.qq,current=value.prepared||value.current;
  if(!qq||!hex(qq.sha256)||!Number.isSafeInteger(qq.size)||qq.size<256||qq.size>512*1024*1024||typeof qq.version!=='string'||!/^\d{1,3}(?:[.-]\d{1,8}){2,3}$/.test(qq.version)||path.basename(local(qq.file)).toLowerCase()!=='qq.exe')fail();
  if(current?.kind!=='prepared'||current.version!=='4.18.42'||current.versionId!=='napcat-shell-4.18.42-02e5ff0f79916c1e'||!hex(current.manifestSha256))fail();
  return {schema:'qq_managed_shell_v1',engine:'managed-shell',dataPolicy:'isolated-new',previous:null,setupId:value.setupId,installationId:value.installationId,installationRoot,workDir,configDir,qqDataDir,descriptorSha256:value.descriptorSha256,qq:{file:local(qq.file),size:qq.size,sha256:qq.sha256,version:qq.version},prepared:{kind:'prepared',version:current.version,versionId:current.versionId,manifestSha256:current.manifestSha256}};
}
class QQManagedLayout{
  constructor({read}={}){if(typeof read!=='function')fail();this.reader=read;this.initial=this._read();this.fingerprint=JSON.stringify(this.initial);}
  _read(){const value=this.reader();if(value&&typeof value.then==='function')fail();return normalized(value);}
  read(){const value=this._read();if(JSON.stringify(value)!==this.fingerprint)fail('managed_installation_changed');return value;}
}
module.exports={QQManagedLayout};
