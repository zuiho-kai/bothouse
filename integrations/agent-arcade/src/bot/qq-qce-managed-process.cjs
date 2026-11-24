'use strict';

// Fixed official QCE runtime identity. No plugin import, token read or process
// execution. A file name is never sufficient to admit a native child.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const RELEASE=require('./qq-qce-release.json');
const VERSION='6.4.2',PLUGIN='napcat-plugin-qce',API_PORT=40653,UNSAFE_BRIDGE_PORT=40654;
const EXECUTED=['package.json','index.mjs','runtime/ApiLauncher.mjs','runtime/rustBridge.mjs','bin/windows-x64/qce-server.exe'];
const BINARY=EXECUTED[4],HEX=/^[a-f0-9]{64}$/;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sha=b=>createHash('sha256').update(b).digest('hex');
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v),keys=(v,ks)=>plain(v)&&Object.keys(v).sort().join('|')===ks.split(' ').sort().join('|');
function fail(code='qce_process_unverified'){const e=new Error(`QCE runtime cannot be verified (${code}).`);e.code=code;throw e;}
function local(value){if(typeof value!=='string'||value.length>1024||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||/[\x00-\x1f]/.test(value)||value.slice(2).includes(':'))fail();return path.resolve(value);}
const stamp=s=>[s.dev,s.ino,s.birthtimeNs,s.size,s.mtimeNs,s.ctimeNs,s.nlink].map(String);
const dirIdentity=s=>[s.dev,s.ino,s.birthtimeNs].map(String);
function parents(file){const out=[];let current=path.dirname(local(file));for(;;){const s=fs.lstatSync(current,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink())fail();out.push({path:current,identity:dirIdentity(s)});if(out.length>32)fail();const next=path.dirname(current);if(next===current)return out;current=next;}}
function regular(file,max){const beforeParents=parents(file),st=fs.lstatSync(local(file),{bigint:true});if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1n||st.size<0n||st.size>BigInt(max)||!same(fs.realpathSync(file),file))fail();return {stamp:stamp(st),parents:beforeParents,size:Number(st.size)};}
function read(file,max){const before=regular(file,max);let fd;try{fd=fs.openSync(file,'r');if(!eq(before.stamp,stamp(fs.fstatSync(fd,{bigint:true}))))fail();const bytes=Buffer.alloc(before.size);let p=0;while(p<bytes.length){const n=fs.readSync(fd,bytes,p,bytes.length-p,p);if(!n)fail();p+=n;}if(!eq(before.stamp,stamp(fs.fstatSync(fd,{bigint:true})))||!eq(before,regular(file,max)))fail();return {...before,bytes,sha256:sha(bytes)};}finally{if(fd!==undefined)fs.closeSync(fd);}}
function pluginRoot(install){return path.join(local(install.workDir),'plugins',PLUGIN);}
function binaryPath(install){return path.join(pluginRoot(install),BINARY);}
function exactNativeDirectory(install){const dir=path.dirname(binaryPath(install));if(!eq(fs.readdirSync(dir).sort(),['qce-server.exe']))fail();}
function installedVersion(install){const file=path.join(pluginRoot(install),'package.json');try{fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}let m;try{m=JSON.parse(read(file,256*1024).bytes);}catch{fail('qce_version_unsupported');}if(m?.name!==PLUGIN||!['5.5.77',VERSION].includes(m.version))fail('qce_version_unsupported');return m.version;}
function verifyRelease(install){
 const root=pluginRoot(install),seen=new Set(),expected=new Map(RELEASE.files.map(r=>[r.path,r])),proofs=[];
 // Only fixed release code is accepted. Runtime output in data/logs does not
 // become executable permission and is deliberately outside this manifest.
 for(const row of RELEASE.files){const file=path.join(root,row.path),value=read(file,row.size);if(value.size!==row.size||value.sha256!==row.sha256)fail();seen.add(row.path);if(EXECUTED.includes(row.path))proofs.push({path:row.path,sha256:row.sha256,size:row.size,stamp:value.stamp,parents:value.parents});}
 if(seen.size!==expected.size||proofs.length!==EXECUTED.length)fail();exactNativeDirectory(install);
 return proofs.sort((a,b)=>EXECUTED.indexOf(a.path)-EXECUTED.indexOf(b.path));
}
function validPort(port){return Number.isInteger(port)&&port>=1024&&port<=65535&&port!==API_PORT&&port!==UNSAFE_BRIDGE_PORT;}
function captureLaunch(install,bridgePort,{userProfile}={}){if(install.installationKind!=='managed-shell'||!validPort(bridgePort))fail();return {schema:'qq_qce_managed_process_v1',version:VERSION,archiveSha256:RELEASE.archiveSha256,bridgePort,userProfile:local(userProfile),files:verifyRelease(install)};}
function validateProof(qce,workDir){
 if(!keys(qce,'schema version archiveSha256 bridgePort userProfile files')||qce.schema!=='qq_qce_managed_process_v1'||qce.version!==VERSION||qce.archiveSha256!==RELEASE.archiveSha256||!validPort(qce.bridgePort)||local(qce.userProfile)!==qce.userProfile||!Array.isArray(qce.files)||qce.files.length!==EXECUTED.length)fail();
 const numbers=x=>Array.isArray(x)&&x.every(n=>typeof n==='string'&&/^\d{1,30}$/.test(n));
 for(let i=0;i<EXECUTED.length;i++){const f=qce.files[i],r=RELEASE.files.find(r=>r.path===EXECUTED[i]);if(!keys(f,'path sha256 size stamp parents')||f.path!==r.path||f.sha256!==r.sha256||f.size!==r.size||!numbers(f.stamp)||f.stamp.length!==7||f.stamp[6]!=='1'||!Array.isArray(f.parents)||!f.parents.length||f.parents.length>32||f.parents.some(p=>!keys(p,'path identity')||local(p.path)!==p.path||!numbers(p.identity)||p.identity.length!==3))fail();const first=path.dirname(path.join(pluginRoot({workDir}),f.path));if(!same(first,f.parents[0].path))fail();}
 return qce;
}
function assertProof(qce,install,{hashes=false}={}){validateProof(qce,install.workDir);const root=pluginRoot(install);for(const f of qce.files){const file=path.join(root,f.path),r=hashes?read(file,f.size):regular(file,f.size);if(r.size!==f.size||!eq(r.stamp,f.stamp)||!eq(r.parents,f.parents)||hashes&&r.sha256!==f.sha256)fail();}exactNativeDirectory(install);return qce;}
function launchEnvironment(qce,install){assertProof(qce,install);return {USERPROFILE:qce.userProfile,QCE_BRIDGE_PORT:String(qce.bridgePort),QCE_SERVER_PORT:String(API_PORT),QCE_RUST_SERVER_PATH:binaryPath(install),QCE_NO_AUTO_OPEN:'1'};}
function isChild(child,tree,lease,install){
 const qce=lease?.binding?.qce;if(!qce||lease?.engine!=='managed-shell'||lease.binding.version!==2||!same(child?.executable,binaryPath(install)))return false;
 assertProof(qce,install);const parent=tree.find(p=>p.pid===child.parentPid);
 return !!parent&&same(parent.executable,install.qqExe)&&Number.isFinite(Date.parse(child.createdAt))&&Number.isFinite(Date.parse(parent.createdAt))&&Date.parse(child.createdAt)>=Date.parse(parent.createdAt)&&!tree.some(p=>p.parentPid===child.pid);
}
function readManagedQCEVersion({runtime,qqAccountId}){try{if(typeof runtime?.instance!=='function')fail('qce_version_unsupported');const install=runtime.instance(qqAccountId),version=installedVersion(install);if(!install.available||!version)fail('qce_version_unsupported');if(version===VERSION){if(!runtime.managed||install.installationKind!=='managed-shell')fail('qce_version_unsupported');const run=runtime.runs.get(qqAccountId);if(!run||run.lease.binding?.version!==2||!run.lease.binding.qce)fail();assertProof(run.lease.binding.qce,install);}return version;}catch(e){if(e.code==='qce_version_unsupported')throw e;fail('qce_process_unverified');}}

// This guard is used only immediately before an explicit plugin enable. A
// disabled plugin receives the same launch environment/proof as an enabled one.
// An older running host cannot acquire that authority by finding new files.
async function verifyManagedQCEEnable({runtime,qqAccountId,signal,assertCurrent}={}){
 const {QQRuntimeManager,runtimeSupport:S}=require('./qq-runtime.cjs');
 const startup=require('./qq-qce-startup.cjs');
 if(!(runtime instanceof QQRuntimeManager)||!runtime.managed||typeof assertCurrent!=='function')fail();
 const outside=()=>{if(signal?.aborted)fail();const value=assertCurrent();if(value?.then){value.catch?.(()=>{});fail();}};
 outside();const install=runtime.instance(qqAccountId),run=runtime.runs.get(qqAccountId);
 if(!install.available||install.installationKind!=='managed-shell'||!run?.proof||!S.validProof(run.proof)||run.lease?.binding?.version!==2||!run.lease.binding.qce)fail();
 const qce=run.lease.binding.qce,proof={...run.proof},runtimeId=runtime.id;
 assertProof(qce,install);const startupProof=startup.captureQCEStartup({userProfile:qce.userProfile});
 const installationKey=i=>JSON.stringify(['installationKind','launcher','qqExe','workDir','configDir','core','selectedNapcatVersion','napcatVersion','descriptorSha256','selectionDigest'].map(k=>i[k]??null));
 const key=installationKey(install),{file:leaseFile,...lease}=run.lease,leaseKey=JSON.stringify(lease);
 const check=()=>{
  outside();if(runtime.closing||runtime.pending.has(qqAccountId)||runtime.id!==runtimeId||runtime.runs.get(qqAccountId)!==run||!S.matches(run.proof,proof)||run.proof.parentPid!==proof.parentPid||installationKey(runtime.instance(qqAccountId))!==key)fail();
  const {file,...current}=run.lease,saved=S.readObject(file);if(file!==leaseFile||JSON.stringify(current)!==leaseKey||JSON.stringify(saved)!==leaseKey||saved?.instance!==runtimeId||!runtime._validLease(saved,qqAccountId)||!S.matches(saved.runtime,proof))fail();
  assertProof(qce,install);startup.assertQCEStartup(startupProof);
 };
 const observe=async()=>{
  check();const rows=await runtime._processes();check();if(!S.matches(rows.find(p=>p.pid===proof.pid),proof))fail();
  const tree=runtime._tree(rows,proof,install,run.lease);if(!tree.length||tree.length>64||tree.some(p=>!S.validProof(S.identity(p))||!Number.isSafeInteger(p.parentPid)||p.parentPid<1||same(p.executable,binaryPath(install))))fail();
  const retained=lease.runtimeTree||[],ids=[...new Set([...tree,...retained].map(p=>p.pid))];if(ids.length>128)fail();
  const exact=S.validProcesses(await runtime._inspect(ids));check();const matches=(a,b)=>S.matches(a,b)&&a.parentPid===b.parentPid;
  if(tree.some(p=>!matches(exact.find(x=>x.pid===p.pid),p)))fail();for(const old of retained){const current=exact.find(p=>p.pid===old.pid);if(current&&(!S.matches(current,old)||!tree.some(p=>matches(current,p))))fail();}
  const listeners=await runtime.host.listeners();check();if(!Array.isArray(listeners)||listeners.length>4096||listeners.some(p=>!p||!Number.isSafeInteger(p.pid)||p.pid<1||!Number.isInteger(p.port)||p.port<1||p.port>65535||typeof p.address!=='string'||p.address.length>128))fail();
  if(listeners.some(p=>p.port===API_PORT||p.port===qce.bridgePort))fail('qce_port_unavailable');
  return JSON.stringify(tree.map(p=>({...S.identity(p),parentPid:p.parentPid})).sort((a,b)=>a.pid-b.pid));
 };
 const first=await observe(),second=await observe();check();if(first!==second)fail();
 return {assertCurrent:check};
}
module.exports={VERSION,PLUGIN,API_PORT,UNSAFE_BRIDGE_PORT,RELEASE,EXECUTED,binaryPath,installedVersion,verifyRelease,captureLaunch,validateProof,assertProof,launchEnvironment,isChild,readManagedQCEVersion,verifyManagedQCEEnable};
