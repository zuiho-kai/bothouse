'use strict';
// Bounded private installation selection. No account configuration or credentials.
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const HEX=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function fail(code='installation_selection_invalid'){throw Object.assign(new Error(`QQ installation selection failed (${code}).`),{code});}
function local(value){if(typeof value!=='string'||value.length>1500||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||/[\0\r\n]/.test(value)||value.slice(2).includes(':'))fail();return path.resolve(value);}
function installation(value){
  if(!value||typeof value!=='object'||Array.isArray(value))fail();
  if(value.kind==='legacy'&&Object.keys(value).every(key=>['kind','desktopDataRoot'].includes(key))&&(value.desktopDataRoot===null||typeof value.desktopDataRoot==='string'))return {kind:'legacy',desktopDataRoot:value.desktopDataRoot===null?null:local(value.desktopDataRoot)};
  if(['managed-shell','managed-node'].includes(value.kind)&&Object.keys(value).every(key=>['kind','setupId','descriptorSha256'].includes(key))&&typeof value.setupId==='string'&&UUID.test(value.setupId)&&typeof value.descriptorSha256==='string'&&HEX.test(value.descriptorSha256))return {kind:value.kind,setupId:value.setupId,descriptorSha256:value.descriptorSha256};
  fail();
}
function safeParents(file){let cursor=path.dirname(local(file));for(;;){let st;try{st=fs.lstatSync(cursor);}catch(error){if(error.code==='ENOENT'){const next=path.dirname(cursor);if(next===cursor)fail();cursor=next;continue;}throw error;}if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(cursor).toLowerCase()!==cursor.toLowerCase())fail();const next=path.dirname(cursor);if(next===cursor)break;cursor=next;}}
function readBytes(file){
  safeParents(file);let st;try{st=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>8192)fail();let fd;
  try{fd=fs.openSync(file,'r');const opened=fs.fstatSync(fd);if(opened.dev!==st.dev||opened.ino!==st.ino||opened.size!==st.size)fail('installation_selection_changed');const bytes=Buffer.alloc(opened.size);let offset=0;while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)fail('installation_selection_changed');offset+=n;}const after=fs.lstatSync(file),last=fs.fstatSync(fd);if(after.dev!==opened.dev||after.ino!==opened.ino||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||last.size!==opened.size||last.mtimeMs!==opened.mtimeMs)fail('installation_selection_changed');return bytes;}finally{if(fd!==undefined)fs.closeSync(fd);}
}
function readInstallationSettings(file){
  try{const bytes=readBytes(file);if(bytes===null)return {value:{version:2,current:{kind:'legacy',desktopDataRoot:null},previous:null},digest:null};const value=JSON.parse(bytes);
    if(value?.version===1&&Object.keys(value).every(key=>['version','desktopDataRoot'].includes(key)))return {value:{version:2,current:installation({kind:'legacy',desktopDataRoot:value.desktopDataRoot}),previous:null},digest:hash(bytes)};
    if(value?.version!==2||Object.keys(value).some(key=>!['version','current','previous'].includes(key)))fail();return {value:{version:2,current:installation(value.current),previous:value.previous===null?null:installation(value.previous)},digest:hash(bytes)};
  }catch(error){if(error?.code==='installation_selection_changed')throw error;fail();}
}
function writeInstallationSettings(file,value,{expectedDigest,assertCurrent=()=>{}}={}){
  const next={version:2,current:installation(value.current),previous:value.previous===null?null:installation(value.previous)},bytes=Buffer.from(JSON.stringify(next,null,2)+'\n'),digest=hash(bytes);let tmp,created=false,committed=false;
  const check=()=>{assertCurrent();const current=readBytes(file);if((current===null?null:hash(current))!==expectedDigest)fail('installation_selection_changed');};
  try{check();safeParents(file);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});safeParents(file);tmp=`${file}.${randomUUID()}.tmp`;const fd=fs.openSync(tmp,'wx',0o600);created=true;try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}check();fs.renameSync(tmp,file);committed=true;created=false;if(hash(readBytes(file))!==digest)fail('installation_selection_changed');return {committed:true,value:next,digest};}
  catch(error){if(!committed&&created){try{committed=hash(readBytes(file))===digest;}catch{}}
    const result=Object.assign(new Error('The QQ installation selection could not be saved.'),{code:['installation_selection_changed','changed','cancelled','operation_in_progress'].includes(error?.code)?error.code:'installation_save_failed'});if(committed)Object.assign(result,{committed:true,value:next,digest});throw result;
  }finally{if(created){try{const current=readBytes(tmp);if(current&&hash(current)===digest)fs.unlinkSync(tmp);}catch{/* Retain replaced or unverifiable files. */}}}
}
function installationSummary(value){const brief=row=>row?{kind:row.kind,...(['managed-shell','managed-node'].includes(row.kind)?{setupId:row.setupId}:{})}:null;return {current:brief(value.current),previous:brief(value.previous),canReturn:value.previous!==null};}
module.exports={installation,readInstallationSettings,writeInstallationSettings,installationSummary};
