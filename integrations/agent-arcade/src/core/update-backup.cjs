'use strict';
// Cold, bounded snapshots before any business store is opened or migrated.
// A caller must first own the desktop's single-instance guard. Nothing here
// opens the source SQLite files, exports Keychain material or deletes old backups.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createHash,randomUUID}=require('node:crypto');

const STATE_FILE='.update-state.json',BACKUP_DIR='update-backups';
const LIMITS=Object.freeze({files:50000,bytes:1024*1024*1024,fileBytes:512*1024*1024,depth:32});
const CODE=/\.(?:cjs|mjs|js|css|html|json)$/i;
const BUILD=/^[a-f0-9]{64}$/;
const ERRORS=new Set(['invalid_options','identity_unavailable','unsafe_path','registry_unavailable','backup_limit','source_changed','sqlite_invalid','backup_failed','state_write_failed']);
class UpdateBackupError extends Error{
 constructor(code){super(`Update data backup failed (${ERRORS.has(code)?code:'backup_failed'}). Existing data was kept; do not continue with migration.`);this.name='UpdateBackupError';this.code=ERRORS.has(code)?code:'backup_failed';}
}
const fail=code=>{throw new UpdateBackupError(code);};
const inside=(child,parent)=>{const relative=path.relative(parent,child);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const SENSITIVE=new Set(['.claude','.codex','.aws']);
const PROFILE_MARKERS=['bot-config.json','bot-vault.json','social-memory.sqlite','bot-recovery.sqlite'];
function assertDataScope(directory){
 const home=fs.realpathSync(os.homedir());
 // A registry is not authority to snapshot a user's whole home/filesystem or
 // the original tools' credentials. Resolve aliases before applying this too.
 if(inside(home,directory))fail('unsafe_path');
 for(const name of SENSITIVE){
  const file=path.join(home,name),protectedRoots=[file];
  if(fs.existsSync(file))protectedRoots.push(fs.realpathSync(file));
  if(protectedRoots.some(root=>inside(directory,root)))fail('unsafe_path');
 }
}
const noLinkDirectory=file=>{const st=fs.lstatSync(file);if(!st.isDirectory()||st.isSymbolicLink())fail('unsafe_path');return fs.realpathSync(file);};
// The explicit App data root can be an ordinary alias (/var on macOS or an
// owner's AGENT_ARCADE_HOME link). Canonicalize it once; this does not authorize
// traversing links found inside that directory or in the backup destination.
function canonicalDataRoot(file){
 if(fs.existsSync(file)){
  const resolved=fs.realpathSync(file);if(!fs.statSync(resolved).isDirectory())fail('unsafe_path');return resolved;
 }
 // Do not create the unknown target of a dangling root link.
 try{if(fs.lstatSync(file).isSymbolicLink())fail('unsafe_path');}catch(error){if(error.code!=='ENOENT')throw error;}
 const parent=path.dirname(file);if(parent===file)fail('unsafe_path');
 const target=path.join(canonicalDataRoot(parent),path.basename(file));
 assertDataScope(target);
 if(!fs.existsSync(target))fs.mkdirSync(target,{mode:0o700});
 return noLinkDirectory(target);
}
function secureDirectory(file){
 if(fs.existsSync(file)){noLinkDirectory(file);return;}
 // Never follow a pre-existing link in a caller-supplied backup path.
 const parent=path.dirname(file);if(parent!==file)secureDirectory(parent);
 fs.mkdirSync(file,{mode:0o700});
}
function privateFile(file,bytes){
 const fd=fs.openSync(file,'wx',0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function atomicState(root,value){
 const file=path.join(root,STATE_FILE),tmp=path.join(root,`.update-state-${randomUUID()}.tmp`);
 try{
  if(fs.existsSync(file)){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink())fail('unsafe_path');}
  privateFile(tmp,Buffer.from(JSON.stringify(value)+'\n'));fs.renameSync(tmp,file);
 }catch(error){if(error instanceof UpdateBackupError)throw error;fail('state_write_failed');}
 finally{try{fs.unlinkSync(tmp);}catch{/* only our unpublished temporary file */}}
}
function readState(root){
 const file=path.join(root,STATE_FILE);
 try{
  const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile())fail('unsafe_path');
  if(stat.size>4096)return null;
  const state=JSON.parse(fs.readFileSync(file,'utf8'));
  return state?.version===1&&BUILD.test(state.buildId||'')?state:null;
 }catch(error){if(error instanceof UpdateBackupError)throw error;return null;}
}
function registeredRoots(root,additionalRoots){
 const candidates=[root,...additionalRoots],registered=[],registry=path.join(root,'companions.json');
 if(fs.existsSync(registry)){
  try{
   const st=fs.lstatSync(registry);if(st.isSymbolicLink()||!st.isFile()||st.size>64000)fail('registry_unavailable');
   const saved=JSON.parse(fs.readFileSync(registry,'utf8'));
   if(saved?.version!==1||!Array.isArray(saved.accounts)||!saved.accounts.length||saved.accounts.length>6)fail('registry_unavailable');
   for(const item of saved.accounts){if(typeof item?.root!=='string'||!path.isAbsolute(item.root))fail('registry_unavailable');candidates.push(item.root);registered.push(item.root);}
  }catch(error){if(error instanceof UpdateBackupError)throw error;fail('registry_unavailable');}
 }
 const roots=[...new Set(candidates.map(file=>{try{return fs.realpathSync(file);}catch{fail('registry_unavailable');}}))];
 roots.forEach(file=>{noLinkDirectory(file);assertDataScope(file);});
 for(const file of registered){
  const resolved=fs.realpathSync(file);if(inside(resolved,root))continue;
  // Existing App markers distinguish a registered profile from a mistyped
  // arbitrary folder. Only metadata is inspected; no credential is opened.
  if(!PROFILE_MARKERS.some(name=>{try{const st=fs.lstatSync(path.join(resolved,name));return st.isFile()&&!st.isSymbolicLink();}catch{return false;}}))fail('registry_unavailable');
 }
 // A nested companion is already part of its ancestor's complete snapshot.
 return roots.filter(file=>!roots.some(other=>other!==file&&inside(file,other))).sort();
}
function digestFile(file,stat){
 let fd;try{
  fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  const opened=fs.fstatSync(fd);if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)fail('source_changed');
  const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(65536);let count=0,read;
  while((read=fs.readSync(fd,buffer,0,buffer.length,null))>0){count+=read;if(count>stat.size)fail('source_changed');hash.update(buffer.subarray(0,read));}
  if(count!==stat.size)fail('source_changed');return hash.digest('hex');
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
function inventory(roots,excluded,limits){
 const rows=[];let total=0;
 const walk=(root,index,relative,depth)=>{
  if(depth>limits.depth)fail('backup_limit');
  const file=path.join(root,relative);if(excluded.some(x=>inside(file,x)))return;
  const st=fs.lstatSync(file),record={root:index,path:relative,mode:st.mode&0o777};
  if(relative&&SENSITIVE.has(path.basename(file))&&(st.isDirectory()||st.isSymbolicLink()))fail('unsafe_path');
  if(st.isDirectory()&&!st.isSymbolicLink()){
   if(relative)rows.push({...record,kind:'directory'});
   for(const name of fs.readdirSync(file).sort())walk(root,index,path.join(relative,name),depth+1);
  }else if(st.isSymbolicLink())rows.push({...record,kind:'symlink',target:fs.readlinkSync(file)});
  else if(st.isFile()){
   total+=st.size;if(st.size>limits.fileBytes||total>limits.bytes)fail('backup_limit');
   rows.push({...record,kind:'file',bytes:st.size,sha256:digestFile(file,st)});
  }else fail('unsafe_path');
  if(rows.length>limits.files)fail('backup_limit');
 };
 roots.forEach((root,index)=>walk(root,index,'',0));return {rows,bytes:total};
}
function copyEntry(source,destination,record){
 if(record.kind==='directory'){fs.mkdirSync(destination,{mode:0o700});return;}
 if(record.kind==='symlink'){fs.symlinkSync(record.target,destination);return;}
 let input,output;try{
  input=fs.openSync(source,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  if(!fs.fstatSync(input).isFile())fail('source_changed');
  output=fs.openSync(destination,'wx',0o600);
  const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(65536);let size=0,read;
  while((read=fs.readSync(input,buffer,0,buffer.length,null))>0){size+=read;if(size>record.bytes)fail('source_changed');const bytes=buffer.subarray(0,read);hash.update(bytes);fs.writeFileSync(output,bytes);}
  if(size!==record.bytes||hash.digest('hex')!==record.sha256)fail('source_changed');fs.fsyncSync(output);
 }finally{if(input!==undefined)fs.closeSync(input);if(output!==undefined)fs.closeSync(output);}
}
function verifySqlite(file){
 const {DatabaseSync}=require('node:sqlite');let db;
 try{db=new DatabaseSync(path.toNamespacedPath(file),{readOnly:true,allowExtension:false});const rows=db.prepare('PRAGMA quick_check').all();if(rows.length!==1||Object.values(rows[0])[0]!=='ok')fail('sqlite_invalid');}
 catch{fail('sqlite_invalid');}finally{db?.close();}
}
function harden(directory){
 fs.chmodSync(directory,0o700);
 for(const name of fs.readdirSync(directory)){
  const file=path.join(directory,name),st=fs.lstatSync(file);
  if(st.isDirectory()&&!st.isSymbolicLink())harden(file);else if(st.isFile())fs.chmodSync(file,0o600);
 }
}
/** Hash code and lock metadata; generated icons, media and build paths do not
 * change identity. Works with Electron's patched fs against app.asar too. */
function buildIdentity({appPath}={}){
 try{
  if(typeof appPath!=='string'||!path.isAbsolute(appPath))fail('invalid_options');
  const hash=createHash('sha256');let count=0,total=0;
  const add=relative=>{const file=path.join(appPath,relative),st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>8*1024*1024)fail('identity_unavailable');const bytes=fs.readFileSync(file);if(bytes.length!==st.size)fail('identity_unavailable');total+=bytes.length;if(++count>10000||total>64*1024*1024)fail('identity_unavailable');hash.update(relative.replaceAll(path.sep,'/')+'\0'+bytes.length+'\0');hash.update(bytes);};
  for(const name of ['package.json','package-lock.json'])if(fs.existsSync(path.join(appPath,name)))add(name);
  const walk=relative=>{for(const name of fs.readdirSync(path.join(appPath,relative)).sort()){const item=path.join(relative,name),st=fs.lstatSync(path.join(appPath,item));if(st.isSymbolicLink())fail('identity_unavailable');if(st.isDirectory())walk(item);else if(CODE.test(name))add(item);}};
  walk('src');if(!count)fail('identity_unavailable');return hash.digest('hex');
 }catch(error){if(error instanceof UpdateBackupError)throw error;fail('identity_unavailable');}
}
function ensureUpdateBackup({root,buildId,backupRoot,additionalRoots=[],limits={},now=Date.now,verifyDatabase=verifySqlite}={}){
 if(typeof root!=='string'||!path.isAbsolute(root)||!BUILD.test(buildId||'')||!Array.isArray(additionalRoots)||additionalRoots.length>2||additionalRoots.some(x=>typeof x!=='string'||!path.isAbsolute(x))||typeof now!=='function'||typeof verifyDatabase!=='function')fail('invalid_options');
 const bounds={...LIMITS,...limits};if(Object.keys(limits).some(key=>!Object.hasOwn(LIMITS,key))||Object.values(bounds).some(v=>!Number.isSafeInteger(v)||v<=0))fail('invalid_options');
 let stage;try{
  assertDataScope(path.resolve(root));root=canonicalDataRoot(root);assertDataScope(root);
  const state=readState(root);
  if(state?.buildId===buildId)return {backedUp:false,reason:'same_build',buildId};
  const target=backupRoot||path.join(root,BACKUP_DIR);if(typeof target!=='string'||!path.isAbsolute(target))fail('invalid_options');
  const roots=registeredRoots(root,additionalRoots);
  if(roots.some(source=>inside(source,target)))fail('unsafe_path');
  const before=inventory(roots,[target],bounds);
  const data=before.rows.filter(row=>row.kind!=='directory'&&!(roots[row.root]===root&&row.path===STATE_FILE));
  if(!data.length){atomicState(root,{version:1,buildId,establishedAt:now(),lastBackup:null});return {backedUp:false,reason:'fresh_profile',buildId};}
  secureDirectory(target);if(fs.realpathSync(target)!==target)fail('unsafe_path');
  const id=`${new Date(now()).toISOString().replace(/[:.]/g,'-')}-${buildId.slice(0,12)}-${randomUUID().slice(0,8)}`;
  stage=path.join(target,`.incomplete-${id}`);const final=path.join(target,id);fs.mkdirSync(stage,{mode:0o700});
  roots.forEach((_,index)=>fs.mkdirSync(path.join(stage,`root-${index}`),{mode:0o700}));
  for(const row of before.rows)copyEntry(path.join(roots[row.root],row.path),path.join(stage,`root-${row.root}`,row.path),row);
  let databases=0;
  for(const row of before.rows)if(row.kind==='file'&&/\.(?:sqlite|sqlite3)$/i.test(row.path)){verifyDatabase(path.join(stage,`root-${row.root}`,row.path));databases++;}
  // Detect changing input (including WAL/config/registry changes); never bless
  // a mixed copy as a successful backup or advance the build marker.
  const after=inventory(roots,[target],bounds);
  if(JSON.stringify(before)!==JSON.stringify(after))fail('source_changed');
  // SQLite readers may update only their copied SHM bookkeeping. Manifest
  // hashes describe the final copy, and permissions cover any copied-side files
  // SQLite created while validating WAL visibility.
  harden(stage);
  const snapshot=inventory(roots.map((_,index)=>path.join(stage,`root-${index}`)),[],bounds);
  const sourceModes=new Map(before.rows.map(row=>[`${row.root}\0${row.path}`,row.mode]));
  const files=snapshot.rows.map(row=>({...row,sourceMode:sourceModes.get(`${row.root}\0${row.path}`)??row.mode}));
  privateFile(path.join(stage,'manifest.json'),Buffer.from(JSON.stringify({version:1,createdAt:now(),buildId,previousBuildId:state?.buildId||null,roots,files,databases},null,2)+'\n'));
  fs.renameSync(stage,final);stage=null;
  // If stamping fails, the complete snapshot stays; the next start retries.
  atomicState(root,{version:1,buildId,establishedAt:now(),lastBackup:id});
  return {backedUp:true,reason:state?'build_changed':'first_existing_data',buildId,backupId:id,backupPath:final,files:before.rows.filter(x=>x.kind==='file').length,bytes:before.bytes,databases};
 }catch(error){if(error instanceof UpdateBackupError)throw error;fail('backup_failed');}
 finally{if(stage)try{fs.rmSync(stage,{recursive:true,force:true});}catch{/* only this invocation's incomplete snapshot */}}
}
module.exports={ensureUpdateBackup,buildIdentity,UpdateBackupError,STATE_FILE,BACKUP_DIR,LIMITS};
