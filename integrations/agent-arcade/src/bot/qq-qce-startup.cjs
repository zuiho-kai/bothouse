'use strict';
// Read-only pre-spawn guard for the pinned QCE 6.4.2 Rust migration contract.
// This is not a filesystem lock: another OS process may change data after the
// final check. Never reuse this proof to reject stopping an already running QQ.
const fs=require('node:fs'),path=require('node:path');
const {offlineIO:I}=require('./qq-plugin-deployment.cjs');
const SCHEMA='qq_qce_startup_v1',MAX_CONFIG=65536;
const LEGACY=Object.freeze(['exports','group-files','group-albums','sticker-packs','scheduled-exports']);
const CODES=new Set(['qce_startup_unverified','qce_startup_migration_required','qce_startup_changed']);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function fail(code='qce_startup_unverified'){throw Object.assign(new Error(`QCE startup cannot be verified (${code}).`),{code});}
function local(value){
 if(typeof value!=='string'||value.length>1500||!/^[a-z]:[\\/]/i.test(value)||/[\p{Cc}\p{Cf}\p{Cs}<>"|?*]/u.test(value)||value.slice(2).includes(':'))fail();
 const parts=value.slice(3).split(/[\\/]/);if(parts.length>32||parts.some(v=>!v||v==='.'||v==='..'||/[. ]$/.test(v)||/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(v)))fail();
 return path.resolve(value);
}
const identity=s=>({dev:String(s.dev),ino:String(s.ino),birthtimeNs:String(s.birthtimeNs)});
function directories(value){
 const target=local(value),root=path.parse(target).root,parts=path.relative(root,target).split(path.sep),rows=[];let cursor=root;
 for(let i=-1;i<parts.length;i++){
  if(i>=0)cursor=path.join(cursor,parts[i]);let stat;
  try{stat=fs.lstatSync(cursor,{bigint:true});}catch(e){if(e.code==='ENOENT')return {path:target,present:false,missingAt:cursor,parents:rows};throw e;}
  if(!stat.isDirectory()||stat.isSymbolicLink()||path.resolve(fs.realpathSync(cursor)).toLowerCase()!==cursor.toLowerCase())fail();rows.push({path:cursor,...identity(stat)});
 }
 return {path:target,present:true,parents:rows};
}
function custom(value){
 if(value===undefined||value===null)return null;
 if(typeof value!=='string')fail();let cleaned=value.trim();if(!cleaned)return null;
 if(cleaned.length>=2&&((cleaned.startsWith('"')&&cleaned.endsWith('"'))||(cleaned.startsWith("'")&&cleaned.endsWith("'"))))cleaned=cleaned.slice(1,-1).trim();
 const dir=local(cleaned),normalized=dir.replaceAll('\\','/').toLowerCase();
 // These strings must also pass the upstream setter. A rejected setter leaves
 // its Option empty and would still schedule migration from the old location.
 if(normalized.includes('/windows/system32')||normalized.includes('/windows/syswow64'))fail();
 return directories(dir);
}
// serde_json rejects overflow numbers and lone escaped surrogates even in
// unrelated fields. If it rejected the document, Rust would ignore both dirs.
function rustJSON(value){
 if(typeof value==='number'&&!Number.isFinite(value)||typeof value==='string'&&/[\p{Cs}]/u.test(value))fail();
 if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){if(/[\p{Cs}]/u.test(key))fail();rustJSON(item);}
}
function observe(userProfile){
 const home=directories(userProfile);if(!home.present)fail();const base=path.join(home.path,'.qq-chat-exporter'),baseProof=directories(base);
 const document=I.jsonDocument(path.join(base,'user-config.json'),MAX_CONFIG);
 rustJSON(document.value);const field=key=>Object.hasOwn(document.value,key)?document.value[key]:undefined;
 const output=custom(field('customOutputDir')),scheduled=custom(field('customScheduledExportDir'));
 let mode,legacy;
 if(output&&scheduled){mode='custom-directories';legacy=null;}
 else{mode='legacy-absent';legacy=LEGACY.map(name=>directories(path.join(base,name)));if(legacy.some(row=>row.present))fail('qce_startup_migration_required');}
 return {schema:SCHEMA,userProfile:home.path,mode,home,base:baseProof,config:document.proof,customOutput:output,customScheduled:scheduled,legacy};
}
function guarded(fn){try{return fn();}catch(e){if(CODES.has(e?.code))throw e;fail();}}
function captureQCEStartup({userProfile=process.env.USERPROFILE}={}){return guarded(()=>{if(process.platform!=='win32')fail();const first=observe(userProfile),second=observe(userProfile);if(!same(first,second))fail('qce_startup_changed');return first;});}
function assertQCEStartup(proof){return guarded(()=>{if(!proof||proof.schema!==SCHEMA||typeof proof.userProfile!=='string')fail();let current;try{current=captureQCEStartup({userProfile:proof.userProfile});}catch(e){if(e.code==='qce_startup_migration_required')fail('qce_startup_changed');throw e;}if(!same(current,proof))fail('qce_startup_changed');return proof;});}
module.exports={SCHEMA,MAX_CONFIG,LEGACY,captureQCEStartup,assertQCEStartup};
