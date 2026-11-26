'use strict';

// Main-only fixed Node layout. Account paths are derived, never created here.
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {RELEASE_ID,VERSION,NODE_FILES}=require('./qq-managed-node-setup.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
function fail(code='invalid_installation'){throw Object.assign(new Error(`Managed Node layout failed (${code}).`),{code});}
function local(value){if(typeof value!=='string'||value.length>1500||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||/[\0\r\n]/.test(value)||value.slice(2).includes(':'))fail();return path.resolve(value);}
function directory(value,{missing=false}={}){
  const file=local(value);let cursor=file,absent=false;
  for(;;){try{const st=fs.lstatSync(cursor);if(!st.isDirectory()||st.isSymbolicLink())fail('unsafe_path');}catch(error){if(!missing||error.code!=='ENOENT')throw error;absent=true;}const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
  if(!absent&&!same(fs.realpathSync(file),file))fail('unsafe_path');return file;
}
function deepFreeze(value){for(const child of Object.values(value))if(child&&typeof child==='object')deepFreeze(child);return Object.freeze(value);}
function normalized(value){
  if(!value||value.schema!=='qq_managed_node_v1'||value.engine!=='managed-node'||value.dataPolicy!=='isolated-new'||value.previous!==null||typeof value.setupId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.setupId)||!hex(value.descriptorSha256))fail();
  const installationRoot=directory(value.installationRoot),instancesRoot=directory(value.instancesRoot),codeRoot=directory(value.codeRoot);
  const base=path.dirname(installationRoot),root=path.dirname(base);
  if(path.basename(base)!=='qq-node-installations'||path.basename(installationRoot)!==value.setupId||!same(instancesRoot,path.join(installationRoot,'instances'))||!same(codeRoot,path.join(root,'qq-component-versions','napcat-node',RELEASE_ID,'code'))||value.installationId!==hash(installationRoot.toLowerCase()))fail();
  const selected=value.current;
  if(selected?.kind!=='prepared'||selected.version!==VERSION||selected.versionId!==RELEASE_ID||!hex(selected.manifestSha256)||JSON.stringify(value.prepared)!==JSON.stringify(selected))fail();
  if(value.node?.version!=='22.11.0'||value.node.architecture!=='x64'||value.node.file!=='node.exe'||value.node.size!==NODE_FILES['node.exe'].size||value.node.sha256!==NODE_FILES['node.exe'].sha256||value.qq?.version!=='9.9.31-49738'||value.entry?.file!=='index.js'||value.entry.size!==NODE_FILES['index.js'].size||value.entry.sha256!==NODE_FILES['index.js'].sha256)fail();
  const manifestPath=path.join(path.dirname(codeRoot),'prepared.json');if(!same(value.manifestPath,manifestPath))fail();
  return deepFreeze({schema:value.schema,engine:'managed-node',dataPolicy:'isolated-new',previous:null,setupId:value.setupId,installationId:value.installationId,installationRoot,instancesRoot,codeRoot,manifestPath,descriptorSha256:value.descriptorSha256,current:{...selected},prepared:{...selected},node:{...value.node},qq:{...value.qq},entry:{...value.entry},native:structuredClone(value.native)});
}
class QQManagedNodeLayout{
  constructor({read}={}){if(typeof read!=='function')fail();this.reader=read;this.initial=this._read();this.fingerprint=JSON.stringify(this.initial);}
  _read(){const value=this.reader();if(value&&typeof value.then==='function'){Promise.resolve(value).catch(()=>{});fail();}return normalized(value);}
  read(){const value=this._read();if(JSON.stringify(value)!==this.fingerprint)fail('managed_installation_changed');return value;}
  instance(accountId){
    if(typeof accountId!=='string'||!/^[1-9]\d{4,11}$/.test(accountId))fail('invalid_account');
    const layout=this.read(),accountDigest=hash(accountId),instanceRoot=path.join(layout.instancesRoot,accountDigest),workDir=path.join(instanceRoot,'work'),configDir=path.join(workDir,'config'),qqDataDir=path.join(instanceRoot,'qq-data');
    for(const dir of [instanceRoot,workDir,configDir,qqDataDir])directory(dir,{missing:true});
    return deepFreeze({accountId,accountDigest,installationId:layout.installationId,setupId:layout.setupId,instanceRoot,workDir,configDir,qqDataDir,codeRoot:layout.codeRoot,manifestPath:layout.manifestPath,descriptorSha256:layout.descriptorSha256});
  }
}
module.exports={QQManagedNodeLayout};
