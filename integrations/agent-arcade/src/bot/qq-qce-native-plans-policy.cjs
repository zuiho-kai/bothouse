'use strict';
const {randomUUID}=require('node:crypto');
const Q=require('./qq-qce-policy.cjs'),E=require('./qq-qce-export-policy.cjs');
const {validateNativeCron}=require('./qq-qce-native-cron.cjs');
const LIMITS=Object.freeze({ticketTtlMs:300000,maxPlans:128,maxHistory:100,maxNameLength:80,maxCronLength:128,maxLookbackSeconds:31622400,maxEmbedBytes:33554432,maxPathLength:1024});
const SCOPE=Object.freeze({kind:'shared-os-user',accountIsolated:false,futureQQBound:false});
const TIMING=Object.freeze({source:'qce-process-local',timeZone:null,nextRunVerified:false,dstDeduplicated:false});
const EFFECTS=Object.freeze({authenticationMayWriteSecurityMetadata:true,durablePersistenceVerified:false,futureQQBound:false,nativeTimeZoneVerified:false,atomicUpdate:false,cancelsRunning:false,cancelsQueued:false,deletesExportFiles:false,automaticRetry:false});
const CODES=new Set([...E.CODES,'invalid_cron','invalid_definition','native_plan_unavailable','native_plan_unsupported','native_plan_limit']);
class QCENativePlansError extends Error{constructor(code){code=CODES.has(code)?code:'qce_unavailable';super(`QCE shared-plan operation failed (${code}).`);this.code=code;}}
const fail=code=>{throw new QCENativePlansError(code);},safeCode=e=>CODES.has(e?.code)?e.code:'qce_unavailable';
const TYPES=['daily','weekly','monthly','custom'],RANGES=['yesterday','last-week','last-month','last-7-days','last-30-days','custom'],FORMATS=['JSON','HTML','TXT'];
const BOOL_OPTIONS=['includeResourceLinks','includeSystemMessages','filterPureImageMessages','prettyFormat','preferGroupMemberName','skipFileDownload','embedResourcesAsDataUri','showSearchBar','enableVirtualScroll'];
const OPTION_KEYS=Object.freeze([...BOOL_OPTIONS,'skipDownloadResourceTypes','maxEmbedFileSizeBytes']);
const integer=E.integer,iso=E.iso;
function nativeId(v){return Q.text(v,128)&&v===v.trim();}
function record(v){if(!Q.plain(v)||!nativeId(v.id)||typeof v.enabled!=='boolean'||typeof v.name!=='string'||v.name.length>1024||Buffer.byteLength(JSON.stringify(v))>65536)fail('invalid_response');return Q.copy(v);}
function list(v){if(!Q.plain(v)||!Array.isArray(v.scheduledExports)||v.scheduledExports.length>LIMITS.maxPlans)fail('native_plan_limit');const rows=v.scheduledExports.map(record);if(new Set(rows.map(r=>r.id)).size!==rows.length)fail('invalid_response');return rows;}
function optionValue(key,value){if(BOOL_OPTIONS.includes(key)){if(typeof value!=='boolean')fail('invalid_definition');return value;}if(key==='maxEmbedFileSizeBytes'){if(!integer(value,LIMITS.maxEmbedBytes)||value<1)fail('invalid_definition');return value;}if(!Array.isArray(value)||value.length>4||new Set(value).size!==value.length||value.some(v=>!E.RESOURCES.includes(v)))fail('invalid_definition');return [...value];}
function cells(raw){if(!Q.plain(raw))fail('invalid_definition');return Object.fromEntries(OPTION_KEYS.map(key=>[key,Object.hasOwn(raw,key)?{present:true,value:optionValue(key,raw[key])}:{present:false,value:null}]));}
function validateCells(value){Q.exact(value,OPTION_KEYS);return Object.fromEntries(OPTION_KEYS.map(key=>{const cell=value[key];Q.exact(cell,['present','value']);if(typeof cell.present!=='boolean'||!cell.present&&cell.value!==null)fail('invalid_definition');return [key,{present:cell.present,value:cell.present?optionValue(key,cell.value):null}];}));}
function timeFields(v,version='5.5.77'){
 Q.version(version);
 if(!TYPES.includes(v.scheduleType)||typeof v.executeTime!=='string'||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v.executeTime)||!RANGES.includes(v.timeRangeType)||!FORMATS.includes(v.format))fail('invalid_definition');
 if(v.scheduleType==='custom')validateNativeCron(v.cronExpression,version);else if(v.cronExpression!==null)fail('invalid_definition');
 if(v.timeRangeType==='custom'){Q.exact(v.customTimeRange,['startTime','endTime']);const {startTime:start,endTime:end}=v.customTimeRange;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start< -LIMITS.maxLookbackSeconds||start>=end||end>0)fail('invalid_definition');}else if(v.customTimeRange!==null)fail('invalid_definition');
 return {scheduleType:v.scheduleType,executeTime:v.executeTime,cronExpression:v.cronExpression,timeRangeType:v.timeRangeType,customTimeRange:Q.copy(v.customTimeRange),format:v.format};
}
function targetKind(raw){return raw.peer?.chatType===1?'friend':raw.peer?.chatType===2?'group':'unknown';}
function peer(raw){if(!Q.plain(raw)||![1,2].includes(raw.chatType)||!E.uid(raw.peerUid)||raw.guildId!==undefined&&raw.guildId!=='')fail('invalid_definition');return {chatType:raw.chatType,peerUid:raw.peerUid,guildId:''};}
function output(raw,config){const path=typeof raw.outputDir==='string'&&raw.outputDir?raw.outputDir:null;if(raw.outputDir!==undefined&&raw.outputDir!==null&&typeof raw.outputDir!=='string'||path!==null&&!Q.text(path,LIMITS.maxPathLength))fail('invalid_definition');return {mode:path===null?'default':'custom',path,effectivePath:path||config.currentScheduledExportsDir};}
function publicTarget(raw,resolved=null){if(resolved&&resolved.peer.chatType===raw.peer?.chatType&&resolved.peer.peerUid===raw.peer?.peerUid)return {kind:resolved.kind,name:resolved.name,number:resolved.number,resolved:true};return {kind:targetKind(raw),name:null,number:null,resolved:false};}
function definition(raw,config,resolved=null,version='5.5.77'){
 if(!Q.text(raw.name,LIMITS.maxNameLength))fail('invalid_definition');peer(raw.peer);
 const t=timeFields({...raw,cronExpression:raw.scheduleType==='custom'?raw.cronExpression:null,customTimeRange:raw.timeRangeType==='custom'?raw.customTimeRange:null},version);return {name:raw.name,target:publicTarget(raw,resolved),...t,options:cells(raw.options||{}),output:output(raw,config)};
}
function supported(raw,config,version='5.5.77'){try{definition(raw,config,null,version);return true;}catch{return false;}}
function summary(raw,id,config,version='5.5.77'){return {planId:id,name:E.display(raw.name).slice(0,LIMITS.maxNameLength)||'Untitled shared plan',enabled:raw.enabled,scheduleType:TYPES.includes(raw.scheduleType)?raw.scheduleType:'unsupported',format:FORMATS.includes(raw.format)?raw.format:'unsupported',targetKind:targetKind(raw),supported:supported(raw,config,version),canInspect:true,canDisable:raw.enabled,canRemove:true};}
function fingerprint(raw){const r=Q.copy(raw);delete r.lastRun;delete r.nextRun;return Q.digest(r);}
function draft(v,create){
 Q.exact(v,['name','target','scheduleType','executeTime','cronExpression','timeRangeType','customTimeRange','format','options','output']);if(!Q.text(v.name,LIMITS.maxNameLength)||v.name!==v.name.trim())fail('invalid_definition');timeFields(v);validateCells(v.options);
 if(v.target===null){if(create)fail('invalid_request');}else{Q.exact(v.target,['observationId','targetId']);if(!Q.uuid(v.target.observationId)||!Q.uuid(v.target.targetId))fail('invalid_request');}
 Q.exact(v.output,['mode','path']);if(!['keep','default','custom'].includes(v.output.mode)||create&&v.output.mode==='keep')fail('invalid_definition');if(v.output.mode==='custom'){if(v.output.path===null)fail('invalid_path');Q.directory(v.output.path);}else if(v.output.path!==null)fail('invalid_definition');return Q.copy(v);
}
function bodyFromDraft(v,old,target,version='5.5.77'){
 const selected=v.target===null?peer(old.peer):peer(target.peer),options={...(old?.options||{})};for(const key of OPTION_KEYS){const cell=v.options[key];if(cell.present)options[key]=Q.copy(cell.value);else delete options[key];}
 const body={name:v.name,...timeFields(v,version),options,enabled:false};if(v.target!==null)body.peer=selected;
 if(v.output.mode==='default')body.outputDir='';else if(v.output.mode==='custom')body.outputDir=v.output.path;
 if(version==='6.4.2'){if(body.cronExpression===null)delete body.cronExpression;if(body.customTimeRange===null)delete body.customTimeRange;}
 return body;
}
function projectedAfter(body,old,config,target,version='5.5.77'){const merged={...(old||{}),...Q.copy(body)};if(!merged.peer)merged.peer=peer(target.peer);return definition(merged,config,target,version);}
function effects(action){const now=['run','triggerAll'].includes(action),later=action==='enable';return {...EFFECTS,mayExecuteNow:now,mayExecuteLater:later,mayReadChat:now||later,mayDownloadResources:now||later,mayWriteExportFiles:now||later,mayOverwriteNewerPlan:!['create'].includes(action),mayReappearAfterRemoval:action==='remove'};}
function resourceSummary(value){if(!Q.plain(value))return null;const keys=['attempted','alreadyAvailable','downloaded','failed','skipped'];return keys.every(key=>integer(value[key]))?Object.fromEntries(keys.map(key=>[key,value[key]])):null;}
function historyItem(value,nativePlanId){
 if(!Q.plain(value)||!nativeId(value.id)||value.scheduledExportId!==nativePlanId||!iso(value.executedAt)||!['success','failed','partial'].includes(value.status)||!integer(value.duration))fail('invalid_response');
 if(value.messageCount!==undefined&&!integer(value.messageCount)||value.fileSize!==undefined&&!integer(value.fileSize)||value.filePath!==undefined&&!Q.text(value.filePath,4096))fail('invalid_response');
 return {historyId:randomUUID(),executedAt:value.executedAt,status:value.status,messageCount:value.messageCount??null,durationMs:value.duration,file:{present:typeof value.filePath==='string'&&!!value.filePath,bytes:value.fileSize??null},resourceSummary:resourceSummary(value.resourceSummary)};
}
function ack(action,data,{nativePlanId,body}={},version='5.5.77'){
 Q.version(version);
 if(['create','update','enable','disable'].includes(action)){const r=record(data);if(action!=='create'&&r.id!==nativePlanId)fail('invalid_response');for(const key of Object.keys(body))if(JSON.stringify(r[key])!==JSON.stringify(body[key]))fail('invalid_response');return {raw:r,execution:null,queue:null};}
 if(action==='remove'){if(!Q.plain(data)||!Q.text(data.message,2048))fail('invalid_response');return {raw:null,execution:null,queue:null};}
 if(action==='run')return {raw:null,execution:historyItem(data,nativePlanId),queue:null,nativeHistoryId:data.id};
 if(action==='triggerAll'){const count=version==='6.4.2'?data?.triggeredCount:data?.count;if(!Q.plain(data)||!Array.isArray(data.triggered)||data.triggered.length>128||count!==data.triggered.length||data.triggered.some(r=>!Q.plain(r)||!nativeId(r.id)||typeof r.name!=='string'||r.name.length>1024)||new Set(data.triggered.map(r=>r.id)).size!==data.triggered.length)fail('invalid_response');return {raw:null,execution:null,queue:{count}};}fail('invalid_request');
}
function qceNativePlansRequest(v,action='read'){
 const fields={read:[],inspect:['observationId','planId'],targets:['kind','page'],preview:['observationId','action','planId','draft'],confirm:['ticketId'],history:['observationId','planId','limit'],dismiss:[],close:[]};if(!Object.hasOwn(fields,action))fail('invalid_request');Q.exact(v,['accountId','panelId',...fields[action]]);if(!Q.profileId(v.accountId)||!Q.uuid(v.panelId))fail('invalid_request');
 if(['inspect','history'].includes(action)&&(!Q.uuid(v.observationId)||!Q.uuid(v.planId)))fail('invalid_request');if(action==='history'&&(!integer(v.limit,100)||v.limit<1))fail('invalid_request');
 if(action==='targets'&&(!['friend','group'].includes(v.kind)||!integer(v.page,100)||v.page<1))fail('invalid_request');if(action==='confirm'&&!Q.uuid(v.ticketId))fail('invalid_request');
 if(action==='preview'){if(!Q.uuid(v.observationId)||!['create','update','enable','disable','remove','run','triggerAll'].includes(v.action)||(['create','triggerAll'].includes(v.action)?v.planId!==null:!Q.uuid(v.planId)))fail('invalid_request');if(['create','update'].includes(v.action))draft(v.draft,v.action==='create');else if(v.action==='triggerAll'){Q.exact(v.draft,['includeDisabled']);if(typeof v.draft.includeDisabled!=='boolean')fail('invalid_request');}else if(v.draft!==null)fail('invalid_request');}return v;
}
module.exports={...Q,QCENativePlansError,fail,safeCode,CODES,LIMITS,SCOPE,TIMING,EFFECTS,OPTION_KEYS,TYPES,RANGES,FORMATS,integer,iso,nativeId,record,list,cells,validateCells,timeFields,peer,output,definition,summary,fingerprint,draft,bodyFromDraft,projectedAfter,effects,historyItem,ack,qceNativePlansRequest};
