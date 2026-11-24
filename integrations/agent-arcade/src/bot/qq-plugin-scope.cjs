'use strict';

// Main-only binding of a plugin preference file to its installed work scope.
// The public projection names registered companions, never filesystem paths.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const fail=code=>{throw Object.assign(Error('QQ plugin scope unavailable.'),{code});};
function identity(file,directory=false){
  if(typeof file!=='string'||!path.isAbsolute(file))fail('component_unavailable');
  let real,stat;try{real=fs.realpathSync(file);stat=fs.statSync(real);}catch{fail('component_unavailable');}
  if(directory?!stat.isDirectory():!stat.isFile())fail('component_unavailable');
  return {path:process.platform==='win32'?real.toLowerCase():real,dev:stat.dev,ino:stat.ino,...(!directory?{size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs}:{})};
}
function capturePluginWorkScope({runtime,qqAccountId,profileId,profiles}){
  if(!runtime||typeof runtime.instance!=='function'||!Array.isArray(profiles)||!profiles.length||profiles.length>32)fail('changed');
  let selected;try{selected=runtime.instance(qqAccountId);}catch{fail('component_unavailable');}
  if(selected.available!==true||!Array.isArray(selected.accounts))fail('component_unavailable');
  const componentVersion=selected.selectedNapcatVersion||selected.napcatVersion;
  if(componentVersion!=='4.18.42')fail('plugin_version_unsupported');
  const work=identity(selected.workDir,true),config=identity(selected.configDir,true),core=identity(selected.core);
  const affectedProfiles=[],bindings=[],ids=new Set();
  for(const entry of profiles){
    if(!entry||typeof entry.accountId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(entry.accountId)||ids.has(entry.accountId))fail('changed');
    ids.add(entry.accountId);
    if(typeof entry.qqAccountId!=='string'||!/^[1-9]\d{4,14}$/.test(entry.qqAccountId))continue;
    if(!selected.accounts.includes(entry.qqAccountId))continue;
    let install;try{install=runtime.instance(entry.qqAccountId);}catch{fail('changed');}
    const other=identity(install.workDir,true);
    if(JSON.stringify(other)!==JSON.stringify(work))continue;
    if(typeof entry.label!=='string'||entry.label.length<1||entry.label.length>80||/[\x00-\x1f\x7f]/.test(entry.label))fail('changed');
    affectedProfiles.push({accountId:entry.accountId,label:entry.label});
    bindings.push([entry.accountId,entry.qqAccountId]);
  }
  if(!affectedProfiles.some(entry=>entry.accountId===profileId))fail('changed');
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  affectedProfiles.sort((a,b)=>compare(a.accountId,b.accountId));
  bindings.sort((a,b)=>compare(a[0],b[0]));
  const workScopeKind=selected.installationKind==='managed-node'?'account':'installation';
  const workScope=createHash('sha256').update(JSON.stringify({work,config,core,componentVersion,workScopeKind,bindings})).digest('hex');
  return {componentVersion,workScope,workScopeKind,affectedProfiles};
}
module.exports={capturePluginWorkScope};
