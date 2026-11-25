'use strict';
// Original offline plugin-file transactions. No plugin module is imported.
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {performance} = require('node:perf_hooks');
const {scopeProjection, uuid} = require('./qq-plugin-admin.cjs');
const IDS = Object.freeze(['napcat-plugin-builtin','napcat-plugin-cleaner','napcat-plugin-ssqq','napcat-plugin-qce']);
const HISTORY = '.agent-arcade-plugin-history';
const LIMITS = Object.freeze({entries:4096, bytes:256*1024*1024, file:64*1024*1024, metadata:4*1024*1024, history:64});
const CODES = new Set(['invalid_request','changed','closed','cancelled','operation_in_progress','invalid_response','plugin_unsupported','plugin_invalid','unsafe_path','deployment_changed','deployment_failed','deployment_unknown','deployment_recovery_required','recovery_unavailable','history_full','stale_observation','stale_ticket','expired_ticket','prepared_invalid','package_not_found','package_too_large','runtime_running','process_check_failed','runtime_locked','component_locked','component_changed','component_unavailable','plugin_version_unsupported','desktop_running','component_lock_changed','configuration_changed','unsafe_lock','manager_closing','recovery_in_progress','preferences_unreadable','preferences_invalid','preference_present','initial_disable_unavailable']);
class QQPluginDeploymentError extends Error {
  constructor(code) { code=CODES.has(code)?code:'deployment_failed'; super(`Plugin files operation failed (${code}).`); this.code=code; }
}
const fail = code => { throw new QQPluginDeploymentError(code); };
const safeCode = error => CODES.has(error?.code)?error.code:'deployment_failed';
const sha = value => createHash('sha256').update(value).digest('hex');
const digest = value => sha(Buffer.from(JSON.stringify(value)));
const plain = value => !!value && typeof value==='object' && !Array.isArray(value);
const hex = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const version = value => typeof value==='string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?$/.test(value) && value.length<=64;
function exact(value, keys) { if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(value,key)))fail('invalid_request'); }
function local(value) { if(typeof value!=='string'||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||/[\0\r\n]/.test(value))fail('unsafe_path');return path.resolve(value); }
const pathSame=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
function exists(file) { try { fs.lstatSync(file); return true; } catch(error) { if(error.code==='ENOENT')return false;throw error; } }
function boundedNames(dir,limit=LIMITS.entries){const handle=fs.opendirSync(dir),out=[];try{for(;;){const row=handle.readSync();if(!row)break;if(out.length>=limit)fail('package_too_large');out.push(row.name);}return out.sort();}finally{handle.closeSync();}}
function safe(file, directory=false) {
  const resolved=local(file); let cursor=resolved, found;
  for(;;) { const st=fs.lstatSync(cursor,{bigint:true}); if(st.isSymbolicLink())fail('unsafe_path');
    if(cursor===resolved) { found=st; if(directory?!st.isDirectory():!st.isFile()||st.nlink!==1n||st.size>BigInt(LIMITS.file))fail('unsafe_path'); }
    else if(!st.isDirectory())fail('unsafe_path'); const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;
  }
  if(!pathSame(fs.realpathSync(resolved),resolved))fail('unsafe_path'); return found;
}
const identity=st=>({dev:String(st.dev),ino:String(st.ino)});
const fileIdentity=st=>({...identity(st),size:Number(st.size),mtime:String(st.mtimeNs),ctime:String(st.ctimeNs)});
function readFile(file, max=LIMITS.file, bytes=false) {
  const before=safe(file);if(before.size>BigInt(max))fail('package_too_large');const fd=fs.openSync(file,'r');
  try { const opened=fs.fstatSync(fd,{bigint:true});if(digest(fileIdentity(before))!==digest(fileIdentity(opened)))fail('deployment_changed');
    const hash=createHash('sha256'),buffer=Buffer.alloc(65536),parts=[];let offset=0;
    while(offset<Number(opened.size)){const n=fs.readSync(fd,buffer,0,Math.min(buffer.length,Number(opened.size)-offset),offset);if(!n)fail('deployment_changed');const part=buffer.subarray(0,n);hash.update(part);if(bytes)parts.push(Buffer.from(part));offset+=n;}
    if(digest(fileIdentity(opened))!==digest(fileIdentity(fs.fstatSync(fd,{bigint:true})))||digest(fileIdentity(opened))!==digest(fileIdentity(safe(file))))fail('deployment_changed');
    return {...fileIdentity(opened),sha256:hash.digest('hex'),...(bytes?{bytes:Buffer.concat(parts)}:{})};
  } finally {fs.closeSync(fd);}
}
function relative(value) {
  if(typeof value!=='string'||!value||value.length>240||value!==value.normalize('NFC')||value.includes('\\')||/[\p{Cc}\p{Cf}\p{Cs}:<>"|?*]/u.test(value)||value.startsWith('/'))fail('unsafe_path');
  const parts=value.split('/');if(parts.length>16||parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p)))fail('unsafe_path');return value;
}
function tree(root) {
  if(!exists(root))return null;const rows=[],names=new Set();let bytes=0,count=0;
  const walk=(dir,prefix='')=>{const before=safe(dir,true);rows.push({path:prefix,kind:'directory',...identity(before)});
    for(const name of boundedNames(dir,LIMITS.entries-count)){if(++count>LIMITS.entries)fail('package_too_large');const rel=relative(prefix?`${prefix}/${name}`:name),key=rel.toLowerCase();if(names.has(key))fail('unsafe_path');names.add(key);const file=path.join(dir,name),st=fs.lstatSync(file,{bigint:true});if(st.isSymbolicLink())fail('unsafe_path');if(st.isDirectory())walk(file,rel);else{const item=readFile(file);bytes+=item.size;if(bytes>LIMITS.bytes)fail('package_too_large');rows.push({path:rel,kind:'file',...item});}}
    if(digest(identity(before))!==digest(identity(safe(dir,true)))||before.mtimeNs!==fs.lstatSync(dir,{bigint:true}).mtimeNs)fail('deployment_changed');
  };walk(root);const content=contentRows(rows);
  return {rows,sha256:digest(content),files:rows.filter(row=>row.kind==='file').length,bytes};
}
function contentRows(rows){return rows.map(row=>row.kind==='directory'?{path:row.path,kind:row.kind}:{path:row.path,kind:row.kind,size:row.size,sha256:row.sha256}).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);}
function effectiveInfo(info,source,before){if(!before?.rows.some(row=>row.path==='data'))return info;const rows=[...source.rows.filter(row=>row.path!=='data'&&!row.path.startsWith('data/')),...before.rows.filter(row=>row.path==='data'||row.path.startsWith('data/'))];return {...info,sha256:digest(contentRows(rows)),files:rows.filter(row=>row.kind==='file').length,bytes:rows.filter(row=>row.kind==='file').reduce((sum,row)=>sum+row.size,0),dataPresent:true};}
const treeSame=(a,b)=>a===null?b===null:!!b&&digest(a)===digest(b);
// Rename changes directory timestamps; retained device/inode and file bytes still bind the tree.
function movedSame(expected, actual) { return expected===null?actual===null:!!actual&&expected.sha256===actual.sha256&&digest(expected.rows.map(row=>({path:row.path,kind:row.kind,dev:row.dev,ino:row.ino,...(row.kind==='file'?{size:row.size,sha256:row.sha256}:{})})))===digest(actual.rows.map(row=>({path:row.path,kind:row.kind,dev:row.dev,ino:row.ino,...(row.kind==='file'?{size:row.size,sha256:row.sha256}:{})}))); }
function readJson(file) { const raw=readFile(file,LIMITS.metadata,true);let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw.bytes));}catch{fail('deployment_changed');}return {value,proof:{...raw,bytes:undefined},sha256:raw.sha256}; }
function writeNew(file,value) {
  const bytes=Buffer.from(JSON.stringify(value)+'\n');if(bytes.length>LIMITS.metadata)fail('package_too_large');safe(path.dirname(file),true);const fd=fs.openSync(file,'wx',0o600);let opened;
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);opened=fs.fstatSync(fd,{bigint:true});}finally{fs.closeSync(fd);}
  const got=readFile(file,LIMITS.metadata);if(got.dev!==String(opened.dev)||got.ino!==String(opened.ino)||got.size!==bytes.length||got.sha256!==sha(bytes))fail('deployment_changed');return got;
}
function mkdir(dir){safe(path.dirname(dir),true);if(!exists(dir))fs.mkdirSync(dir,{mode:0o700});safe(dir,true);}
function copyTree(source,target,expected,{skipData=false}={}) {
  if(!treeSame(tree(source),expected))fail('deployment_changed');if(exists(target))fail('deployment_changed');mkdir(target);
  for(const row of expected.rows){if(!row.path||skipData&&(row.path==='data'||row.path.startsWith('data/')))continue;const dest=path.join(target,row.path);if(row.kind==='directory'){mkdir(dest);continue;}const src=path.join(source,row.path),before=readFile(src);if(digest(before)!==digest(Object.fromEntries(Object.entries(row).filter(([k])=>!['path','kind'].includes(k)))))fail('deployment_changed');fs.copyFileSync(src,dest,fs.constants.COPYFILE_EXCL);const fd=fs.openSync(dest,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const copied=readFile(dest);if(copied.sha256!==row.sha256||copied.size!==row.size)fail('deployment_changed');}
  if(!treeSame(tree(source),expected))fail('deployment_changed');return tree(target);
}
function packageInfo(root,id,proof=tree(root)) { if(!proof)return null;if(proof.rows.some(row=>row.path.split('/')[0].toLowerCase()==='data'&&row.path.split('/')[0]!=='data'))fail('unsafe_path');const manifest=readJson(path.join(root,'package.json')).value;if(!plain(manifest)||manifest.name!==id||!version(manifest.version))fail('plugin_invalid');return {id,version:manifest.version,sha256:proof.sha256,files:proof.files,bytes:proof.bytes,dataPresent:proof.rows.some(row=>row.path==='data')}; }
function configProof(configDir,id) {
  safe(configDir,true);const plugins=path.join(configDir,'plugins');if(exists(plugins))safe(plugins,true);
  const pref=path.join(configDir,'plugins.json');return {root:identity(safe(configDir,true)),preferences:exists(pref)?readFile(pref):null,plugin:tree(path.join(plugins,id))};
}
// Read only for the explicit first-install option. Old transactions preserve opaque bytes.
function preferenceDocument(configDir) { return jsonDocument(path.join(configDir,'plugins.json')); }
function jsonDocument(file,max=LIMITS.metadata) {
  let raw;
  try { raw=exists(file)?readFile(file,max,true):null; }
  catch { fail('preferences_unreadable'); }
  if(!raw)return {proof:null,bytes:null,text:'{}',value:Object.create(null),end:1,ranges:Object.create(null)};
  try {
    if(raw.bytes[0]===0xef&&raw.bytes[1]===0xbb&&raw.bytes[2]===0xbf)throw Error('BOM');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(raw.bytes),value=JSON.parse(text);
    if(!plain(value))throw Error('object required');
    // JSON.parse accepts duplicate keys. Scan every object before preserving the original text.
    let i=0,end=-1;const ranges=Object.create(null);
    const ws=()=>{while(/[\x20\t\r\n]/.test(text[i]||'x'))i++;};
    const string=()=>{const start=i++;for(;;){if(i>=text.length)throw Error('string');const c=text[i++];if(c==='\\')i++;else if(c==='"')break;}return JSON.parse(text.slice(start,i));};
    const item=depth=>{
      if(depth>64)throw Error('depth');ws();
      if(text[i]==='{'){
        i++;ws();const names=new Set();
        if(text[i]!=='}')for(;;){ws();if(text[i]!=='"')throw Error('key');const key=string();if(names.has(key))throw Error('duplicate');names.add(key);ws();if(text[i++]!==':')throw Error('colon');ws();const start=i;item(depth+1);if(depth===0)ranges[key]={start,end:i};ws();if(text[i]!==',')break;i++;}
        if(depth===0)end=i;if(text[i++]!=='}')throw Error('object');
      }else if(text[i]==='['){i++;ws();if(text[i]!==']')for(;;){item(depth+1);ws();if(text[i]!==',')break;i++;}if(text[i++]!==']')throw Error('array');}
      else if(text[i]==='"')string();
      else {const token=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));if(!token)throw Error('value');i+=token[0].length;}
    };
    item(0);ws();if(i!==text.length||end<0)throw Error('trailing');
    const {bytes,...proof}=raw;return {proof,bytes,text,value,end,ranges};
  }catch { fail('preferences_invalid'); }
}
function initialDisableOptions(configDir,rows) {
  let document,reason=null;
  try { document=preferenceDocument(configDir); }catch(error){reason=error.code==='preferences_invalid'?'preferences_invalid':'preferences_unreadable';}
  return rows.map(row=>{const why=row.proof?'already_installed':reason||(Object.hasOwn(document.value,row.id)?'preference_present':null);return {pluginId:row.id,available:why===null,reason:why};});
}
function disabledPreference(configDir,id) {
  const document=preferenceDocument(configDir);
  if(Object.hasOwn(document.value,id))fail('preference_present');
  const insertion=(Object.keys(document.value).length?',':'')+JSON.stringify(id)+':false';
  const bytes=Buffer.from(document.text.slice(0,document.end)+insertion+document.text.slice(document.end));
  if(bytes.length>LIMITS.metadata)fail('package_too_large');
  return {before:document.proof,bytes};
}
const movedFileSame=(expected,actual)=>expected===null?actual===null:!!actual&&['dev','ino','size','sha256'].every(k=>expected[k]===actual[k]);
const validFileProof=p=>plain(p)&&typeof p.dev==='string'&&typeof p.ino==='string'&&Number.isSafeInteger(p.size)&&p.size>=0&&p.size<=LIMITS.metadata&&typeof p.mtime==='string'&&typeof p.ctime==='string'&&hex(p.sha256);
function preferencePaths(configDir,dir) {return {live:path.join(configDir,'plugins.json'),before:path.join(dir,'preferences-before.json'),next:path.join(dir,'preferences-next.json'),displaced:path.join(dir,'preferences-displaced.json')};}
function preferenceState(configDir,tx) {
  const paths=preferencePaths(configDir,tx.dir),proof=tx.plan.preferences,got={};
  for(const [name,file] of Object.entries(paths))got[name]=exists(file)?readFile(file,LIMITS.metadata):null;
  for(const [name,expected] of [['before',proof.before],['next',proof.next],['displaced',proof.next]])if(got[name]&&!movedFileSame(expected,got[name]))fail('deployment_changed');
  const liveBefore=proof.before&&movedFileSame(proof.before,got.live),liveNext=movedFileSame(proof.next,got.live);
  if(got.live&&!liveBefore&&!liveNext)fail('deployment_changed');
  if(proof.before&&Number(!!liveBefore)+Number(!!got.before)!==1||!proof.before&&got.before)fail('deployment_changed');
  if(Number(!!liveNext)+Number(!!got.next)+Number(!!got.displaced)!==1)fail('deployment_changed');
  const config=configProof(configDir,tx.plan.pluginId);
  if(digest(config.root)!==digest(tx.plan.config.root)||!treeSame(config.plugin,tx.plan.config.plugin))fail('deployment_changed');
  return {paths,got,liveBefore:!!liveBefore,liveNext:!!liveNext,original:proof.before?!!liveBefore:got.live===null};
}
function writePreferenceStage(file,bytes) {
  safe(path.dirname(file),true);const fd=fs.openSync(file,'wx',0o600);let opened;
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);opened=fs.fstatSync(fd,{bigint:true});}finally{fs.closeSync(fd);}
  const proof=readFile(file,LIMITS.metadata);if(proof.dev!==String(opened.dev)||proof.ino!==String(opened.ino)||proof.size!==bytes.length||proof.sha256!==sha(bytes))fail('deployment_changed');return proof;
}
function validatePlan(value,id) {
  if(!plain(value)||!['qq_plugin_deployment_v1','qq_plugin_deployment_v2'].includes(value.schema)||value.id!==id||!uuid(id)||!IDS.includes(value.pluginId)||!['install','remove','restore'].includes(value.operation)||!['install','update','remove','restore'].includes(value.mode)||!Number.isFinite(Date.parse(value.createdAt))||!plain(value.config)||!Object.hasOwn(value,'before')||!Object.hasOwn(value,'next'))fail('deployment_recovery_required');
  if(value.schema==='qq_plugin_deployment_v2'&&(value.operation!=='install'||value.mode!=='install'||value.before!==null||!value.next||value.initialDisabled!==true||!plain(value.preferences)||!validFileProof(value.preferences.next)||value.preferences.before!==null&&!validFileProof(value.preferences.before)||digest(value.preferences.before)!==digest(value.config.preferences)))fail('deployment_recovery_required');
  for(const item of [value.before,value.next])if(item!==null&&(!plain(item)||!hex(item.sha256)||!Array.isArray(item.rows)||item.rows.length>LIMITS.entries+1))fail('deployment_recovery_required');return value;
}
function histories(workDir) {
  const root=path.join(workDir,HISTORY);if(!exists(root))return {root,items:[],pending:null};safe(root,true);const entries=boundedNames(root,LIMITS.history+1);if(entries.filter(n=>n!=='pending.json').length>LIMITS.history)fail('history_full');const items=[];
  for(const name of entries){if(name==='pending.json')continue;if(!uuid(name))fail('deployment_recovery_required');const dir=path.join(root,name);safe(dir,true);const planFile=path.join(dir,'plan.json');if(!exists(planFile))continue;const raw=readJson(planFile),plan=validatePlan(raw.value,name);let done=false,recovered=false;
    for(const [file,kind] of [['complete.json','done'],['recovered.json','recovered']])if(exists(path.join(dir,file))){const value=readJson(path.join(dir,file)).value;if(value.schema!=='qq_plugin_deployment_result_v1'||value.planSha256!==raw.sha256)fail('deployment_recovery_required');if(kind==='done')done=true;else recovered=true;}
    items.push({id:name,dir,plan,planSha256:raw.sha256,done,recovered});
  }
  const incomplete=items.filter(item=>!item.done&&!item.recovered);if(incomplete.length>1)fail('deployment_recovery_required');let pending=incomplete[0]||null;
  if(exists(path.join(root,'pending.json'))){const value=readJson(path.join(root,'pending.json')).value,found=items.find(item=>item.id===value.id);if(value.schema!=='qq_plugin_deployment_pending_v1'||!found||value.planSha256!==found.planSha256)fail('deployment_recovery_required');pending=found;}
  return {root,items,pending};
}
function assertPluginDeploymentReady(workDir) {try{safe(workDir,true);const state=histories(workDir);if(state.pending)fail('deployment_recovery_required');return true;}catch{fail('deployment_recovery_required');} }
const brief=info=>info?{version:info.version,sha256:info.sha256,files:info.files,bytes:info.bytes}:null;
const constants=()=>({preservesConfiguration:true,preservesOldTree:true,preservesData:true,existingEnableStatePreserved:true,laterStartMayLoad:true,automaticStart:false,executesPlugin:false});
class QQPluginDeployment {
  constructor({workDir,configDir,artifacts,scope,assertCurrent=()=>{},withDeploymentLock,now=Date.now,monotonic=()=>performance.now()}={}) {
    this.workDir=local(workDir);this.configDir=local(configDir);if(!pathSame(configDir,path.join(workDir,'config'))||typeof artifacts?.resolve!=='function'||typeof withDeploymentLock!=='function')fail('invalid_request');Object.assign(this,{artifacts,scope:scopeProjection(scope),assertCurrent,withDeploymentLock,now,monotonic});this.ticket=null;this.baseline=null;this.busy=false;this.closed=false;
  }
  _check(signal,ticket) { if(this.closed)fail('closed');if(signal?.aborted)fail('cancelled');const value=this.assertCurrent();if(value?.then){value.catch?.(()=>{});fail('invalid_request');}if(ticket&&this.monotonic()>=ticket.deadline)fail('expired_ticket'); }
  _state() {
    safe(this.workDir,true);safe(this.configDir,true);const pluginRoot=path.join(this.workDir,'plugins');if(exists(pluginRoot))safe(pluginRoot,true);const rows=IDS.map(id=>{const root=path.join(pluginRoot,id),proof=tree(root);return {id,proof,info:packageInfo(root,id,proof)};});const history=histories(this.workDir);
    return {root:identity(safe(this.workDir,true)),pluginRoot:exists(pluginRoot)?identity(safe(pluginRoot,true)):null,rows,history};
  }
  read({signal}={}) {if(this.busy)fail('operation_in_progress');this._check(signal);this.ticket=null;const state=this._state(),id=randomUUID();this.baseline={id,digest:digest({root:state.root,pluginRoot:state.pluginRoot,rows:state.rows,history:state.history.items.map(i=>({id:i.id,sha:i.planSha256,done:i.done,recovered:i.recovered})),pending:state.history.pending?.id||null})};
    return {kind:'plugin-files',observationId:id,fetchedAt:new Date(this.now()).toISOString(),scope:this.scope,plugins:state.rows.filter(r=>r.info).map(r=>r.info),backups:state.history.items.filter(item=>!item.recovered).map(item=>({backupId:item.id,pluginId:item.plan.pluginId,version:item.plan.beforeVersion,operation:item.plan.operation,createdAt:item.plan.createdAt,restores:item.plan.before?'present':'absent',pending:state.history.pending?.id===item.id})),recovery:{required:!!state.history.pending,backupId:state.history.pending?.id||null,pluginId:state.history.pending?.plan.pluginId||null},requiresStopped:true,pluginCodeAuthenticated:false,initialDisableOptions:initialDisableOptions(this.configDir,state.rows)};
  }
  async preview(value,{signal}={}) {
    if(this.busy)fail('operation_in_progress');this.ticket=null;this._check(signal);if(!plain(value)||!uuid(value.observationId)||!IDS.includes(value.pluginId)||!['install','remove','restore'].includes(value.operation))fail('invalid_request');const keys=['observationId','operation','pluginId',...(value.operation==='install'?['preparedId']:value.operation==='restore'?['backupId']:[]),...(Object.hasOwn(value,'initialDisabled')?['initialDisabled']:[])];exact(value,keys);if(Object.hasOwn(value,'initialDisabled')&&(value.operation!=='install'||value.initialDisabled!==true))fail('invalid_request');if(value.operation==='install'&&!uuid(value.preparedId)||value.operation==='restore'&&!uuid(value.backupId))fail('invalid_request');if(value.observationId!==this.baseline?.id)fail('stale_observation');
    this.busy=true;try {const state=this._state(),baseline=this.baseline;const stateDigest=digest({root:state.root,pluginRoot:state.pluginRoot,rows:state.rows,history:state.history.items.map(i=>({id:i.id,sha:i.planSha256,done:i.done,recovered:i.recovered})),pending:state.history.pending?.id||null});if(stateDigest!==baseline.digest)fail('deployment_changed');
      const row=state.rows.find(r=>r.id===value.pluginId),current=path.join(this.workDir,'plugins',value.pluginId);let source=null,sourceProof=null,after=null,backup=null,prepared=null;const initialDisabled=value.initialDisabled===true;if(initialDisabled&&row.proof)fail('initial_disable_unavailable');
      if(state.history.pending&&(value.operation!=='restore'||value.backupId!==state.history.pending.id))fail('deployment_recovery_required');
      if(value.operation==='install'){prepared=await this.artifacts.resolve(value.preparedId,{signal});this._check(signal);if(prepared.id!==value.pluginId||prepared.verification!=='full-manifest'||!hex(prepared.manifestSha256))fail('prepared_invalid');source=local(prepared.codeRoot);sourceProof=tree(source);after=packageInfo(source,value.pluginId,sourceProof);if(!after||after.version!==prepared.version)fail('prepared_invalid');after=effectiveInfo(after,sourceProof,row.proof);}
      if(value.operation==='remove'&&!row.proof)fail('package_not_found');
      if(value.operation==='restore'){backup=state.history.items.find(item=>item.id===value.backupId&&!item.recovered&&item.plan.pluginId===value.pluginId);if(!backup)fail('recovery_unavailable');if(backup.plan.before){const live=tree(current),stored=tree(path.join(backup.dir,'before'));source=movedSame(backup.plan.before,stored)?path.join(backup.dir,'before'):state.history.pending?.id===backup.id&&movedSame(backup.plan.before,live)?current:null;if(!source)fail('recovery_unavailable');sourceProof=tree(source);after=packageInfo(source,value.pluginId,sourceProof);}}
      const config=configProof(this.configDir,value.pluginId),preference=initialDisabled?disabledPreference(this.configDir,value.pluginId):null;if(preference&&digest(preference.before)!==digest(config.preferences))fail('deployment_changed');const effect=initialDisabled?'set_initial_disabled':backup?.plan.schema==='qq_plugin_deployment_v2'&&state.history.pending?.id===backup.id?'restore_initial_preference':'preserve';const ticket={id:randomUUID(),deadline:this.monotonic()+300000,operation:value.operation,mode:value.operation==='install'?(row.proof?'update':'install'):value.operation,pluginId:value.pluginId,preparedId:value.preparedId||null,backupId:value.backupId||null,before:row.proof,beforeInfo:row.info,source,sourceProof,initialDisabled,preference,effect,preparedHash:prepared?.manifestSha256||null,after,config,backup,pending:!!backup&&state.history.pending?.id===backup.id,work:state.root,pluginRoot:state.pluginRoot};this._check(signal);this.ticket=ticket;
      return {kind:'plugin-package-preview',ticketId:ticket.id,expiresAt:this.now()+300000,operation:ticket.operation,mode:ticket.mode,pluginId:ticket.pluginId,preparedId:ticket.preparedId,backupId:ticket.backupId,before:brief(row.info),after:brief(after),scope:this.scope,...constants(),initialDisabled,enablePreferenceEffect:effect,existingEnableStatePreserved:effect==='preserve',laterStartMayLoad:effect!=='set_initial_disabled',pendingRecovery:ticket.pending};
    }finally{this.busy=false;}
  }
  _receipt(t,fields) {return {kind:'plugin-package-change',ticketId:t.id,operation:t.operation,mode:t.mode,pluginId:t.pluginId,outcome:'not_committed',committed:false,backupId:null,readbackVerified:false,configurationPreserved:false,requiresRecovery:false,automaticRetry:false,automaticStart:false,pluginExecuted:false,laterStartMayLoad:t.effect!=='set_initial_disabled',initialDisabled:t.initialDisabled,enablePreferenceEffect:t.effect,enablePreferenceChanged:false,initialDisableVerified:false,...fields};}
  async confirm({ticketId},{signal}={}) {
    if(this.busy)fail('operation_in_progress');const t=this.ticket;this.ticket=null;this.baseline=null;if(!t||t.id!==ticketId)fail('stale_ticket');this.busy=true;let receipt=null,tx=null,attempted=false,journal=false;
    const check=()=>this._check(signal,t), pluginRoot=path.join(this.workDir,'plugins'),current=path.join(pluginRoot,t.pluginId);let parentProof=t.pluginRoot;
    const paths=()=>{if(digest(identity(safe(this.workDir,true)))!==digest(t.work)||digest(exists(pluginRoot)?identity(safe(pluginRoot,true)):null)!==digest(parentProof))fail('deployment_changed');};
    try {check();const returned=await this.withDeploymentLock({signal,assertCurrent:check},async({assertStopped})=>{
      const stopped=async()=>{check();paths();await assertStopped();paths();check();};await stopped();
      paths();if(!treeSame(tree(current),t.before)||digest(configProof(this.configDir,t.pluginId))!==digest(t.config))fail('deployment_changed');
      if(t.pending){journal=true;tx=t.backup;receipt=await this._recover(t,tx,{check,stopped,signal});return receipt;}
      assertPluginDeploymentReady(this.workDir);if(t.source&&!treeSame(tree(t.source),t.sourceProof))fail('deployment_changed');if(t.preparedId){const verified=await this.artifacts.resolve(t.preparedId,{signal});check();if(verified.manifestSha256!==t.preparedHash||!pathSame(verified.codeRoot,t.source))fail('prepared_invalid');}
      const history=histories(this.workDir);if(history.items.length>=LIMITS.history||exists(history.root)&&boundedNames(history.root,LIMITS.history+1).filter(n=>n!=='pending.json').length>=LIMITS.history)fail('history_full');paths();if(!parentProof){mkdir(pluginRoot);parentProof=identity(safe(pluginRoot,true));}mkdir(history.root);const id=randomUUID(),dir=path.join(history.root,id);mkdir(dir);tx={id,dir};let next=null;
      if(t.source){const preserveData=t.operation==='install'&&t.before?.rows.some(row=>row.path==='data');next=copyTree(t.source,path.join(dir,'staged'),t.sourceProof,{skipData:preserveData});if(preserveData){const oldData=path.join(current,'data');if(!safe(oldData,true).isDirectory())fail('unsafe_path');copyTree(oldData,path.join(dir,'staged','data'),tree(oldData));next=tree(path.join(dir,'staged'));}}
      await stopped();paths();if(!treeSame(tree(current),t.before)||digest(configProof(this.configDir,t.pluginId))!==digest(t.config)||t.source&&!treeSame(tree(t.source),t.sourceProof)||next&&next.sha256!==t.after.sha256)fail('deployment_changed');
      let preferenceNext=null;if(t.initialDisabled)preferenceNext=writePreferenceStage(path.join(dir,'preferences-next.json'),t.preference.bytes);const plan={schema:t.initialDisabled?'qq_plugin_deployment_v2':'qq_plugin_deployment_v1',id,pluginId:t.pluginId,operation:t.operation,mode:t.mode,createdAt:new Date(this.now()).toISOString(),before:t.before,beforeVersion:t.beforeInfo?.version||null,next,nextVersion:t.after?.version||null,config:t.config,...(t.initialDisabled?{initialDisabled:true,preferences:{before:t.preference.before,next:preferenceNext}}:{})};tx.plan=plan;journal=true;tx.planSha256=writeNew(path.join(dir,'plan.json'),plan).sha256;writeNew(path.join(history.root,'pending.json'),{schema:'qq_plugin_deployment_pending_v1',id,planSha256:tx.planSha256});
      let preferenceCommitted=false;const recheck=async()=>{await stopped();paths();if(readJson(path.join(dir,'plan.json')).sha256!==tx.planSha256)fail('deployment_changed');if(t.initialDisabled){const state=preferenceState(this.configDir,tx);if(preferenceCommitted?!state.liveNext:!state.original)fail('deployment_changed');}else if(digest(configProof(this.configDir,t.pluginId))!==digest(t.config))fail('deployment_changed');};
      await recheck();if(!treeSame(tree(current),t.before)||next&&!treeSame(tree(path.join(dir,'staged')),next))fail('deployment_changed');check();
      if(t.initialDisabled){const state=preferenceState(this.configDir,tx);attempted=true;if(state.got.live)fs.renameSync(state.paths.live,state.paths.before);const gap=preferenceState(this.configDir,tx);if(gap.got.live||!gap.got.next)fail('deployment_changed');check();fs.renameSync(gap.paths.next,gap.paths.live);if(!preferenceState(this.configDir,tx).liveNext)fail('deployment_unknown');preferenceCommitted=true;}
      if(t.before){attempted=true;fs.renameSync(current,path.join(dir,'before'));if(!movedSame(t.before,tree(path.join(dir,'before'))))fail('deployment_unknown');}
      if(next){await recheck();if(exists(current)||!treeSame(tree(path.join(dir,'staged')),next)||t.before&&!movedSame(t.before,tree(path.join(dir,'before'))))fail('deployment_changed');mkdir(path.dirname(current));check();attempted=true;fs.renameSync(path.join(dir,'staged'),current);}
      const actual=tree(current);if(!movedSame(next,actual)||t.before&&!movedSame(t.before,tree(path.join(dir,'before')))||(t.initialDisabled?!preferenceState(this.configDir,tx).liveNext:digest(configProof(this.configDir,t.pluginId))!==digest(t.config)))fail('deployment_unknown');
      writeNew(path.join(dir,'complete.json'),{schema:'qq_plugin_deployment_result_v1',planSha256:tx.planSha256});this._clearPending(tx);
      receipt=this._receipt(t,{outcome:'committed',committed:true,backupId:id,readbackVerified:true,configurationPreserved:!t.initialDisabled,enablePreferenceChanged:t.initialDisabled,initialDisableVerified:t.initialDisabled});return receipt;
    });return returned;
    }catch(error){if(receipt?.committed===true)return {...receipt,code:safeCode(error)};return this._receipt(t,{outcome:attempted||journal?'unknown':'not_committed',committed:attempted||journal?null:false,code:attempted||journal?'deployment_unknown':safeCode(error),backupId:tx?.id||null,requiresRecovery:journal,enablePreferenceChanged:t.effect==='preserve'?false:attempted||journal?null:false});}finally{this.busy=false;}
  }
  _clearPending(tx) {const file=path.join(this.workDir,HISTORY,'pending.json');if(!exists(file))return;const raw=readJson(file);if(raw.value.id!==tx.id||raw.value.planSha256!==tx.planSha256)fail('deployment_unknown');fs.unlinkSync(file);}
  async _recover(t,tx,{check,stopped}) {
    const current=path.join(this.workDir,'plugins',t.pluginId),stored=path.join(tx.dir,'before'),displaced=path.join(tx.dir,'displaced'),plan=tx.plan;
    const preferenceRecovery=plan.schema==='qq_plugin_deployment_v2';let preferenceChanged=false;if(readJson(path.join(tx.dir,'plan.json')).sha256!==tx.planSha256)fail('deployment_changed');if(preferenceRecovery)preferenceState(this.configDir,tx);else if(digest(configProof(this.configDir,t.pluginId))!==digest(plan.config))fail('deployment_changed');
    let active=tree(current),old=tree(stored);if(exists(displaced)&&!movedSame(plan.next,tree(displaced)))fail('recovery_unavailable');
    if(!movedSame(plan.before,active)){
      if(active&&!movedSame(plan.next,active)||plan.before&&!movedSame(plan.before,old))fail('recovery_unavailable');
      if(active){if(exists(displaced))fail('recovery_unavailable');await stopped();if(!movedSame(plan.next,tree(current)))fail('deployment_changed');check();fs.renameSync(current,displaced);}
      if(plan.before){await stopped();if(exists(current)||!movedSame(plan.before,tree(stored)))fail('deployment_changed');check();fs.renameSync(stored,current);}
    }
    if(preferenceRecovery){await stopped();if(!movedSame(plan.before,tree(current)))fail('deployment_changed');let state=preferenceState(this.configDir,tx);if(state.liveNext){if(state.got.displaced)fail('deployment_changed');check();fs.renameSync(state.paths.live,state.paths.displaced);preferenceChanged=true;state=preferenceState(this.configDir,tx);}if(plan.preferences.before&&!state.liveBefore){if(state.got.live||!state.got.before)fail('deployment_changed');check();fs.renameSync(state.paths.before,state.paths.live);preferenceChanged=true;}if(!preferenceState(this.configDir,tx).original)fail('deployment_unknown');}
    if(!movedSame(plan.before,tree(current))||(!preferenceRecovery&&digest(configProof(this.configDir,t.pluginId))!==digest(plan.config)))fail('deployment_unknown');
    if(!exists(path.join(tx.dir,'recovered.json')))writeNew(path.join(tx.dir,'recovered.json'),{schema:'qq_plugin_deployment_result_v1',planSha256:tx.planSha256});this._clearPending(tx);
    return this._receipt(t,{outcome:'committed',committed:true,backupId:tx.id,readbackVerified:true,configurationPreserved:true,enablePreferenceChanged:preferenceChanged});
  }
  discardPreview(){this.ticket=null;}
  close(){this.closed=true;this.ticket=null;this.baseline=null;}
}
module.exports={QQPluginDeployment,QQPluginDeploymentError,assertPluginDeploymentReady,IDS,LIMITS,safeCode,fail,plain,exact,digest,version,tree,brief,offlineIO:Object.freeze({local,pathSame,exists,safe,identity,readFile,jsonDocument,writePreferenceStage,mkdir,movedFileSame,boundedNames,sha})};
