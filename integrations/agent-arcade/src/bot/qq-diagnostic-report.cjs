'use strict';

// A shareable projection of already classified app observations. Never read a
// raw log, credential, message, account database or process list here.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const SCHEMA='arcade_qq_diagnostic_v1',MAX_EVENTS=160,MAX_BYTES=64*1024;
const CODES=new Set(['invalid_request','diagnostics_unavailable','changed','operation_in_progress','report_invalid','report_too_large','save_failed','save_unconfirmed']);
const EVENTS=new Set(['session_expired','account_kicked','worker_restart','qr_expired','login_required','runtime_started','bridge_listening','launcher_started','launcher_stopped','runtime_exited','ownership_cleared','ownership_adopted','ownership_orphans_cleared']);
const ISSUES=new Set(['unsupported_platform','missing_components','invalid_installation','desktop_running','external_process','external_qq_unknown','runtime_locked','process_check_failed','ownership_lost','not_owned','start_failed','start_unverified','stop_failed','unsafe_lock','operation_in_progress','webui_unavailable','webui_config_not_local','recovery_required','owner_alive','orphaned_children','orphan_cleanup_changed','orphan_cleanup_unverified','orphan_cleanup_unavailable','orphan_cleanup_incomplete','manager_closing','runtime_running','changed','endpoint_unverified','endpoint_recheck_unavailable','connection_failed','timeout','unauthorized','invalid_response','account_mismatch','account_changed','account_offline','status_unverified','bridge_unhealthy','session_expired','installation_selection_invalid','installation_selection_changed','managed_installation_changed','selection_invalid','prepared_invalid','unsafe_path','configuration_invalid','configuration_cleanup_unverified','endpoint_store_locked']);
const select=(value,values,fallback='unknown')=>typeof value==='string'&&values.includes(value)?value:fallback;
const issue=value=>value===null||value===undefined?null:ISSUES.has(value)?value:'unknown';
for(const code of ['two_factor_required','rate_limited','http_error','request_rejected','response_too_large','invalid_identity','closed','cancelled','configuration_unavailable'])ISSUES.add(code);
const STATUS_PHASES=new Set(['webui-status','endpoint-before','endpoint-after',...['endpoint-before','endpoint-after'].flatMap(phase=>['batch','observation-first','observation-second','observation-shape','launcher','lease','owned-tree','tree-stability','retained-tree','endpoint','listener','identity-recheck','listener-recheck'].map(stage=>phase+':'+stage))]);
function projectStatusIssue(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!STATUS_PHASES.has(value.phase))return null;
  const time=timestamp(value.at);if(time.timeBasis!=='utc'||typeof value.code!=='string')return null;
  return {code:issue(value.code),phase:value.phase,at:time.time};
}
const boolean=value=>typeof value==='boolean'?value:null;
const version=value=>typeof value==='string'&&/^\d{1,5}(?:[.-]\d{1,5}){1,4}$/.test(value)?value:null;
const appVersion=value=>typeof value==='string'&&/^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-(?:preview|alpha|beta|rc|dev)(?:\.\d{1,5})?)?$/.test(value)?value:null;
function codeOf(error){return CODES.has(error?.code)?error.code:'save_failed';}
class QQDiagnosticError extends Error{constructor(code){super('QQ diagnostic report is unavailable.');this.name='QQDiagnosticError';this.code=CODES.has(code)?code:'save_failed';}}
const fail=code=>{throw new QQDiagnosticError(code);};
function timestamp(value){
  if(typeof value!=='string')return {time:null,timeBasis:'unknown'};
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value)return {time:value,timeBasis:'utc'};
  // Legacy log timestamps lack a reliable timezone, and sometimes a year.
  if(/^(?:\d{4}[-/])?\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,7})?$/.test(value))return {time:value,timeBasis:'local-log-unspecified'};
  return {time:null,timeBasis:'unknown'};
}
function createQQDiagnosticReport({version:app,platform,runtimeState,accountId,diagnosticEvents,capturedAt}={}){
  if(typeof accountId!=='string'||!/^[1-9]\d{4,14}$/.test(accountId)||!Number.isSafeInteger(Number(accountId))||!runtimeState||!Array.isArray(runtimeState.instances)||runtimeState.instances.length>32||!Array.isArray(diagnosticEvents)||diagnosticEvents.length>10000)fail('report_invalid');
  const matching=runtimeState.instances.filter(row=>row?.accountId===accountId);if(matching.length!==1)fail('report_invalid');
  const row=matching[0],components=runtimeState.components||{},time=timestamp(capturedAt);if(time.timeBasis!=='utc')fail('report_invalid');
  const events=[];let dropped=Math.max(0,diagnosticEvents.length-MAX_EVENTS);
  for(const entry of diagnosticEvents.slice(-MAX_EVENTS)){
    if(!entry||!EVENTS.has(entry.type)){dropped++;continue;}
    events.push({type:entry.type,...timestamp(entry.time)});
  }
  return {schema:SCHEMA,capturedAt:time.time,application:{version:appVersion(app),platform:select(platform,['win32','darwin','linux'])},observation:'cached-app-state-and-bounded-events',
    account:{alias:'selected-account',processRunning:boolean(row.processRunning),management:select(row.management,['owned','unknown','recoverable','external','stopped']),login:select(row.login?.state,['online','offline','unknown','stopped','login_required','initializing','reconnecting']),online:boolean(row.login?.online),reason:issue(row.reason),loginIssue:issue(row.login?.issue),endpointIssue:issue(row.endpointRecoveryIssue),configurationIssue:issue(row.configurationIssue),...(projectStatusIssue(row.lastStatusIssue)?{lastStatusIssue:projectStatusIssue(row.lastStatusIssue)}:{})},
    components:{installationKind:select(runtimeState.installationKind,['legacy','managed-shell','managed-node']),available:boolean(components.available),selectionKind:select(components.selectionKind,['original','prepared']),napcatVersion:version(components.napcatVersion),selectedNapcatVersion:version(components.selectedNapcatVersion),qqVersion:version(components.qqVersion),nodeVersion:version(components.nodeVersion),issue:issue(runtimeState.issue),desktopRunning:boolean(runtimeState.desktopRunning)},
    events,bounds:{maxEvents:MAX_EVENTS,includedEvents:events.length,droppedEvents:dropped,completeHistory:false},
    privacy:{accountIdentifiersIncluded:false,messagesIncluded:false,credentialsIncluded:false,localPathsIncluded:false,rawLogsIncluded:false,uploaded:false}};
}
function encodeQQDiagnosticReport(options){const buffer=Buffer.from(JSON.stringify(createQQDiagnosticReport(options),null,2)+'\n');if(buffer.length>MAX_BYTES)fail('report_too_large');return buffer;}
const STATS={bigint:true};
const sameId=(a,b)=>!!a&&!!b&&typeof a.dev==='bigint'&&typeof a.ino==='bigint'&&a.ino>0n&&a.dev===b.dev&&a.ino===b.ino;
const same=(a,b)=>sameId(a,b)&&a.birthtimeNs===b.birthtimeNs;
const exact=(a,b)=>same(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&a.nlink===b.nlink;
const regular=stat=>stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1n;
function statOrNull(io,file){try{return io.lstatSync(file,STATS);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function folders(io,dir){
  const result=[];let current=dir;
  for(let count=0;count<256;count++){
    const stat=io.lstatSync(current,STATS);if(!stat.isDirectory()||stat.isSymbolicLink())fail('save_failed');result.push([current,stat]);
    const parent=path.dirname(current);if(parent===current)return result;current=parent;
  }fail('save_failed');
}
function assertFolders(io,proofs){for(const [file,old]of proofs){const now=io.lstatSync(file,STATS);if(!now.isDirectory()||now.isSymbolicLink()||!same(now,old))fail('save_failed');}}
function assertSync(fn){if(typeof fn!=='function')fail('save_failed');const value=fn();if(value&&typeof value.then==='function'){value.catch?.(()=>{});fail('save_failed');}}
function readOwn(io,file,proof,expected){
  let fd,bytes;try{
    const before=io.lstatSync(file,STATS);if(!regular(before)||!same(before,proof)||before.size!==BigInt(expected.length))return false;
    fd=io.openSync(file,'r');const opened=io.fstatSync(fd,STATS);if(!regular(opened)||!same(opened,before)||opened.size!==BigInt(expected.length))return false;
    bytes=Buffer.alloc(expected.length+1);let offset=0;
    while(offset<bytes.length){const count=io.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!count)break;offset+=count;}
    const after=io.fstatSync(fd,STATS),named=io.lstatSync(file,STATS);
    return offset===expected.length&&exact(opened,after)&&exact(named,after)&&regular(named)&&bytes.subarray(0,offset).equals(expected);
  }finally{bytes?.fill(0);if(fd!==undefined)io.closeSync(fd);}
}
function writeQQDiagnosticReport(file,buffer,{assertCurrent=()=>{},io=fs}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||/^(?:\\\\|\/\/)/.test(file)||/[\x00-\x1f\x7f]/.test(file)||path.extname(file).toLowerCase()!=='.json'||!Buffer.isBuffer(buffer)||buffer.length<1)fail('save_failed');
  if(buffer.length>MAX_BYTES)fail('report_too_large');
  const bytes=Buffer.from(buffer),temp=path.join(path.dirname(file),`.qq-diagnostics-${randomUUID()}.tmp`);let fd,proof,attempted=false;
  const published=()=>{
    if(fd===undefined||!proof)return false;
    // NTFS may tunnel the deleted destination's creation time onto a renamed
    // file. Keep the exclusively created file open across publication: exact
    // 64-bit volume/file IDs cannot be reused while this handle is retained.
    const held=io.fstatSync(fd,STATS);
    return regular(held)&&sameId(held,proof)&&held.size===proof.size&&held.mtimeNs===proof.mtimeNs&&readOwn(io,file,held,bytes);
  };
  try{
    assertSync(assertCurrent);const dirs=folders(io,path.dirname(file)),before=statOrNull(io,file);if(before&&!regular(before))fail('save_failed');
    fd=io.openSync(temp,'wx',0o600);proof=io.fstatSync(fd,STATS);io.writeFileSync(fd,bytes);io.fsyncSync(fd);proof=io.fstatSync(fd,STATS);
    if(!readOwn(io,temp,proof,bytes))fail('save_failed');assertFolders(io,dirs);const current=statOrNull(io,file);if(before?!exact(before,current):current!==null)fail('save_failed');
    assertSync(assertCurrent);attempted=true;io.renameSync(temp,file);
    if(!published())fail('save_unconfirmed');return {saved:true,schema:SCHEMA};
  }catch(error){
    if(attempted){try{if(published())return {saved:true,schema:SCHEMA};}catch{/* Preserve uncertainty after publication. */}const uncertain=new QQDiagnosticError('save_unconfirmed');uncertain.saveAttempted=true;throw uncertain;}
    throw error instanceof QQDiagnosticError?error:new QQDiagnosticError('save_failed');
  }finally{
    if(fd!==undefined)try{io.closeSync(fd);}catch{/* No arbitrary cleanup after a failed close. */}
    if(proof)try{const found=statOrNull(io,temp);if(found&&regular(found)&&same(found,proof))io.unlinkSync(temp);}catch{/* Keep an unverified temporary file; it contains only the redacted report. */}
    bytes.fill(0);
  }
}
module.exports={SCHEMA,MAX_EVENTS,MAX_BYTES,QQDiagnosticError,codeOf,createQQDiagnosticReport,encodeQQDiagnosticReport,writeQQDiagnosticReport,projectStatusIssue};
