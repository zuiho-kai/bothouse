'use strict';

// Main-process-only maintenance for QQProfileConfig's private byte backups.
// A digest detects a changed selection; legacy files have no signed manifest.
// Account association is their existing hashed filename, not a QQ login proof.
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {MAX_CONFIG_BYTES}=require('./qq-profile-config.cjs');

const MAX_BACKUPS=100,MAX_SCAN=2000,MAX_SERVERS=64;
const messages={
  invalid_config:'The backup request has unsupported or invalid fields.',
  invalid_account:'Select an existing numeric QQ account.',
  backup_invalid:'The selected private backup is missing, linked, malformed or too large.',
  backup_changed:'The selected backup changed. List and preview it again.',
  backup_selection_required:'Select one backup and preview its current SHA-256 before restoring.',
  backup_directory_unsafe:'The private backup directory is not a regular local directory.',
  config_invalid:'The current configuration cannot be read safely. It was not changed.',
  config_changed:'The current configuration changed. Preview it again before restoring.',
  backup_failed:'The current configuration could not be backed up. Restoration was aborted.',
  write_failed:'Restoration could not be verified. Keep both backups and inspect the current configuration.',
};
class QQProfileBackupError extends Error{constructor(code){super(messages[code]||'The QQ backup operation failed.');this.name='QQProfileBackupError';this.code=code;}}
const fail=code=>{throw new QQProfileBackupError(code);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const validAccount=id=>typeof id==='string'&&/^[1-9]\d{4,11}$/.test(id);
const validDigest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
function directory(dir,code,{missing=false,create=false}={}){
  try{
    if(!fs.existsSync(dir)){if(create)fs.mkdirSync(dir,{recursive:true,mode:0o700});else if(missing)return false;}
    const st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||!samePath(fs.realpathSync(dir),dir))fail(code);
    return true;
  }catch(error){if(error instanceof QQProfileBackupError)throw error;fail(code);}
}
function readBytes(file,code){
  let fd;
  try{
    directory(path.dirname(file),code);
    const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>MAX_CONFIG_BYTES||!samePath(fs.realpathSync(file),file))fail(code);
    fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const before=fs.fstatSync(fd);
    if(!before.isFile()||before.nlink!==1||before.size>MAX_CONFIG_BYTES||before.ino!==st.ino||before.dev!==st.dev)fail(code);
    const bytes=Buffer.alloc(before.size);let offset=0;
    while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!count)fail(code);offset+=count;}
    const after=fs.fstatSync(fd),current=fs.lstatSync(file);
    if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||current.ino!==before.ino||current.dev!==before.dev||current.isSymbolicLink()||current.nlink!==1)fail(code);
    return {bytes,sha256:digest(bytes),size:bytes.length};
  }catch(error){if(error instanceof QQProfileBackupError)throw error;fail(code);}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}
function parse(bytes){
  try{
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text.replace(/^\uFEFF/,''));
    if(!plain(value)||(value.network!==undefined&&!plain(value.network)))return null;
    const pending=[[value,0]];let nodes=0;
    while(pending.length){const [item,depth]=pending.pop();if(++nodes>100000||depth>64)return null;if(item&&typeof item==='object')for(const child of Object.values(item))pending.push([child,depth+1]);}
    for(const key of ['websocketServers','httpServers','httpSseServers']){const list=value.network?.[key];if(list!==undefined&&(!Array.isArray(list)||list.length>MAX_SERVERS||list.some(row=>!plain(row))))return null;}
    return value;
  }catch{return null;}
}
function metadata(accountId,id){
  if(typeof id!=='string')fail('backup_selection_required');
  const match=/^([a-f0-9]{64})-(\d{13})-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.json$/.exec(id);
  if(!match||match[1]!==digest(accountId)||!Number.isSafeInteger(Number(match[2])))fail('backup_invalid');
  return {id,createdAt:Number(match[2])};
}
function validateBackupRequest(kind,value){
  const allowed={list:['accountId','limit'],preview:['accountId','backupId','sha256'],restore:['accountId','backupId','sha256','currentSha256']}[kind];
  if(!allowed||!plain(value)||Object.keys(value).some(key=>!allowed.includes(key))||!validAccount(value.accountId))fail('invalid_config');
  if(kind==='list'){if(value.limit!==undefined&&(!Number.isInteger(value.limit)||value.limit<1||value.limit>MAX_BACKUPS))fail('invalid_config');}
  else{metadata(value.accountId,value.backupId);if(!validDigest(value.sha256)||(kind==='restore'&&!validDigest(value.currentSha256)))fail('invalid_config');}
  return value;
}
function serverState(row){
  if(!row)return null;
  return {enabled:row.enable===true,port:Number.isInteger(row.port)&&row.port>0&&row.port<=65535?row.port:null,loopbackOnly:row.host==='127.0.0.1'||row.host==='::1',hasToken:typeof row.token==='string'&&row.token.length>0};
}
function omit(value,keys){return Object.fromEntries(Object.entries(value||{}).filter(([key])=>!keys.includes(key)));}
function changes(current,backup){
  if(!current)return {currentValid:false,restoredServerCounts:Object.fromEntries(['websocketServers','httpServers','httpSseServers'].map(key=>[key,(backup.network?.[key]||[]).length])),credentialsMayChange:true};
  const groups=[];
  const otherNetworkFieldsChanged=!isDeepStrictEqual(omit(current.network,['websocketServers','httpServers','httpSseServers']),omit(backup.network,['websocketServers','httpServers','httpSseServers']));
  const otherTopLevelFieldsChanged=!isDeepStrictEqual(omit(current,['network']),omit(backup,['network']));
  // Reverse clients, plugins and unknown fields can also contain credentials.
  // A limited preview cannot establish that those secrets are unchanged.
  let credentialsMayChange=otherNetworkFieldsChanged||otherTopLevelFieldsChanged;
  const known=['name','enable','host','port','token','messagePostFormat','reportSelfMessage','enableForcePushEvent','debug','heartInterval'];
  for(const kind of ['websocketServers','httpServers','httpSseServers']){
    const before=current.network?.[kind]||[],after=backup.network?.[kind]||[],rows=[];
    for(let index=0;index<Math.max(before.length,after.length);index++){
      const a=before[index],b=after[index];if(isDeepStrictEqual(a,b))continue;
      const fields=known.filter(key=>!isDeepStrictEqual(a?.[key],b?.[key]));
      const otherFieldsChanged=!isDeepStrictEqual(omit(a,known),omit(b,known));
      const credentialChanged=!isDeepStrictEqual(a?.token,b?.token);credentialsMayChange ||= credentialChanged||otherFieldsChanged;
      rows.push({index,before:serverState(a),after:serverState(b),changedFields:fields,otherFieldsChanged});
    }
    if(rows.length)groups.push({kind,rows});
  }
  // Never export unknown key names, arbitrary host/name strings or field values.
  return {currentValid:true,groups,credentialsMayChange,otherNetworkFieldsChanged,otherTopLevelFieldsChanged};
}

class QQProfileBackups{
  constructor({profiles,assertCurrent=()=>{}}={}){
    if(!profiles?.runtime||typeof profiles.runtime.instance!=='function'||typeof profiles.runtime.withConfigurationLock!=='function'||typeof profiles.backupRoot!=='string')fail('backup_directory_unsafe');
    this.runtime=profiles.runtime;this.backupRoot=path.resolve(profiles.backupRoot);this.assertCurrent=assertCurrent;
  }
  _account(accountId){if(!validAccount(accountId))fail('invalid_account');return this.runtime.instance(accountId);}
  _backup(accountId,backupId,sha256){
    const meta=metadata(accountId,backupId);directory(this.backupRoot,'backup_directory_unsafe');
    const data=readBytes(path.join(this.backupRoot,meta.id),'backup_invalid');
    if(sha256!==undefined&&data.sha256!==sha256)fail('backup_changed');
    const value=parse(data.bytes);if(!value)fail('backup_invalid');return {...meta,...data,value};
  }
  list(accountId,{limit=30}={}){
    this._account(accountId);limit=Number.isInteger(limit)?Math.max(1,Math.min(MAX_BACKUPS,limit)):30;
    if(!directory(this.backupRoot,'backup_directory_unsafe',{missing:true}))return {backups:[],hasMore:false,scanLimited:false};
    const selected=[];let scanned=0,scanLimited=false;const dir=fs.opendirSync(this.backupRoot);
    try{let entry;while((entry=dir.readSync())){if(++scanned>MAX_SCAN){scanLimited=true;break;}try{selected.push(metadata(accountId,entry.name));}catch{/* Other accounts and unrelated files are not exposed. */}}}finally{dir.closeSync();}
    selected.sort((a,b)=>b.createdAt-a.createdAt||b.id.localeCompare(a.id));
    const backups=selected.slice(0,limit).map(meta=>{try{const row=this._backup(accountId,meta.id);return {...meta,sha256:row.sha256,size:row.size,valid:true};}catch{return {...meta,valid:false,issue:'backup_invalid'};}});
    return {backups,hasMore:selected.length>limit||scanLimited,scanLimited};
  }
  preview(accountId,{backupId,sha256}={}){
    const install=this._account(accountId);if(!validDigest(sha256))fail('backup_selection_required');
    const backup=this._backup(accountId,backupId,sha256),current=readBytes(install.onebotConfigPath,'config_invalid');
    return {backupId:backup.id,sha256:backup.sha256,currentSha256:current.sha256,createdAt:backup.createdAt,size:backup.size,unchanged:backup.sha256===current.sha256,changes:changes(parse(current.bytes),backup.value),requiresStoppedRuntime:true,onlineIdentityVerified:false,companionCredentialsUpdated:false};
  }
  current(accountId){
    const install=this._account(accountId),current=readBytes(install.onebotConfigPath,'config_invalid');
    return {sha256:current.sha256,size:current.size,valid:parse(current.bytes)!==null};
  }
  async create(accountId,{currentSha256}={}){
    if(!validAccount(accountId))fail('invalid_account');if(!validDigest(currentSha256))fail('backup_selection_required');
    return this.runtime.withConfigurationLock(accountId,{},async install=>{
      this.assertCurrent();await install.assertStopped();this.assertCurrent();
      const current=readBytes(install.onebotConfigPath,'config_invalid');if(current.sha256!==currentSha256)fail('config_changed');
      const id=this._preserve(accountId,current.bytes);
      // Preserve the completed byte receipt even if a later process appears.
      return {id,createdAt:metadata(accountId,id).createdAt,sha256:current.sha256,size:current.size,valid:parse(current.bytes)!==null};
    });
  }
  _preserve(accountId,bytes){
    let fd;
    try{
      directory(this.backupRoot,'backup_failed',{create:true});
      const id=`${digest(accountId)}-${Date.now()}-${randomUUID()}.json`,file=path.join(this.backupRoot,id);
      fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
      if(!readBytes(file,'backup_failed').bytes.equals(bytes))fail('backup_failed');return id;
    }catch(error){if(error instanceof QQProfileBackupError)throw error;fail('backup_failed');}
    finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  async restore(accountId,{backupId,sha256,currentSha256}={}){
    if(!validAccount(accountId))fail('invalid_account');if(!validDigest(sha256)||!validDigest(currentSha256))fail('backup_selection_required');
    metadata(accountId,backupId);
    return this.runtime.withConfigurationLock(accountId,{},async install=>{
      this.assertCurrent();
      const backup=this._backup(accountId,backupId,sha256),current=readBytes(install.onebotConfigPath,'config_invalid');
      if(current.sha256!==currentSha256)fail('config_changed');
      await install.assertStopped();
      this.assertCurrent();
      if(readBytes(install.onebotConfigPath,'config_invalid').sha256!==currentSha256)fail('config_changed');
      const preservedId=this._preserve(accountId,current.bytes);
      await install.assertStopped();
      this.assertCurrent();
      this._backup(accountId,backupId,sha256);
      if(readBytes(install.onebotConfigPath,'config_invalid').sha256!==currentSha256)fail('config_changed');
      // Do not call configure(): restoration must not generate a new token,
      // normalize unknown fields, or write the companion's encrypted vault.
      const temporary=`${install.onebotConfigPath}.${randomUUID()}.restore-tmp`;let fd;
      try{
        fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,backup.bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
        // A separate manager/editor does not honor this application's lock.
        // Recheck after potentially slow temporary-file I/O, just before rename.
        await install.assertStopped();this.assertCurrent();
        this._backup(accountId,backupId,sha256);
        if(readBytes(install.onebotConfigPath,'config_invalid').sha256!==currentSha256)fail('config_changed');
        fs.renameSync(temporary,install.onebotConfigPath);
        if(!readBytes(install.onebotConfigPath,'write_failed').bytes.equals(backup.bytes))fail('write_failed');
      }catch(error){if(error instanceof QQProfileBackupError)throw error;fail('write_failed');}
      finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch{/* Only our unique temporary file is eligible for removal. */}}
      return {restored:true,sha256:backup.sha256,preservedBackupId:preservedId,credentialsMayChange:changes(parse(current.bytes),backup.value).credentialsMayChange,recheckBinding:true,companionCredentialsUpdated:false,onlineIdentityVerified:false};
    });
  }
}
module.exports={QQProfileBackups,QQProfileBackupError,validateBackupRequest,MAX_BACKUPS,MAX_SCAN};
