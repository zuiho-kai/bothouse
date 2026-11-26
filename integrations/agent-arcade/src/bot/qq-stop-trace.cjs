'use strict';

// Optional main-process diagnostics. No renderer controls, credentials, command
// lines, raw executable paths, chat text or network access. Failure is inert.
const fs=require('node:fs'),path=require('node:path');
const MAX_BYTES=2*1024*1024,MAX_EVENTS=256;
const kinds=new Set(['begin','stage','snapshot','inspect','host_step','host_result','success','failure']);
const phases=new Set(['begin','waiting_reconcile','layout','before_snapshot','lease','reconcile','checked_tree','host_stop','confirm_stopped','release','discover','done']);
const steps=new Set(['opened','terminate','wait_complete','failed']);
const origins=new Set(['background','stop-before','stop-confirm','stop-confirm-recheck','stop-proof','stop-final-lookup','stop-retry-lookup']);
const codes=new Set(['orphaned_children','ownership_lost','process_check_failed','stop_failed','runtime_locked','desktop_running','not_owned','manager_closing','invalid_installation','managed_installation_changed','missing_components']);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const pid=value=>Number.isSafeInteger(value)&&value>0;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
function safe(event){
  if(!event||!kinds.has(event.kind)||!phases.has(event.phase)||typeof event.operationId!=='string'||!/^[a-f0-9-]{36}$/.test(event.operationId))return null;
  const row={at:new Date().toISOString(),kind:event.kind,phase:event.phase,operationId:event.operationId};
  if(codes.has(event.code))row.code=event.code;
  if(origins.has(event.origin))row.origin=event.origin;
  for(const key of ['observedCount','selectedCount','inputCount'])if(Number.isSafeInteger(event[key])&&event[key]>=0&&event[key]<=4096)row[key]=event[key];
  if(typeof event.truncated==='boolean')row.truncated=event.truncated;
  if(Array.isArray(event.requestedPids)&&event.requestedPids.length<=128&&event.requestedPids.every(pid))row.requestedPids=[...event.requestedPids];
  if(Array.isArray(event.processes))row.processes=event.processes.slice(0,128).filter(p=>pid(p.pid)&&hex(p.executablePathSha256)).map(p=>({pid:p.pid,...(Number.isSafeInteger(p.parentPid)&&p.parentPid>=0?{parentPid:p.parentPid}:{}),createdAt:timestamp(p.createdAt)?p.createdAt:null,executablePathSha256:p.executablePathSha256}));
  if(steps.has(event.step))row.step=event.step;
  if(pid(event.pid))row.pid=event.pid;
  if(typeof event.exited==='boolean')row.exited=event.exited;
  if(timestamp(event.hostAt))row.hostAt=event.hostAt;
  return row;
}
function createQQStopTrace({directory,filename}={}){
  let fd=null,written=0,events=0,owned=null;
  const close=()=>{if(fd!==null){try{fs.closeSync(fd);}catch{}fd=null;}};
  try{
    if(typeof directory!=='string'||!path.isAbsolute(directory)||/^[/\\]{2}/.test(directory)||!['outputs','diagnostics'].includes(path.basename(directory).toLowerCase())||typeof filename!=='string'||!/^qq-stop-trace-[a-z0-9-]{1,80}\.jsonl$/.test(filename))return{record:()=>false,close,enabled:false};
    const target=path.resolve(directory);let cursor=path.dirname(target);for(;;){const st=fs.lstatSync(cursor);if(!st.isDirectory()||st.isSymbolicLink())throw Error();const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
    if(!fs.existsSync(target)&&path.basename(target).toLowerCase()==='diagnostics')fs.mkdirSync(target,{mode:0o700});const targetStat=fs.lstatSync(target);if(!targetStat.isDirectory()||targetStat.isSymbolicLink())throw Error();
    fd=fs.openSync(path.join(target,filename),'wx',0o600);owned=fs.fstatSync(fd);
  }catch{close();return{record:()=>false,close,enabled:false};}
  const record=event=>{if(fd===null||events>=MAX_EVENTS)return false;try{const row=safe(event);if(!row)return false;const bytes=Buffer.from(JSON.stringify(row)+'\n');if(written+bytes.length>MAX_BYTES){close();return false;}const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.ino!==owned.ino||stat.dev!==owned.dev||stat.size!==written){close();return false;}let offset=0;while(offset<bytes.length){const count=fs.writeSync(fd,bytes,offset,bytes.length-offset);if(!count)throw Error();offset+=count;}written+=bytes.length;events++;return true;}catch{close();return false;}};
  return{record,close,enabled:true};
}
module.exports={createQQStopTrace,MAX_BYTES,MAX_EVENTS};
