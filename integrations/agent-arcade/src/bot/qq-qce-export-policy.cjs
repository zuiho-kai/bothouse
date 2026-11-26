'use strict';
// Original fixed QCE export projection. No content, task URL or native path is public.
const path=require('node:path');
const P=require('./qq-qce-policy.cjs');
const LIMITS=Object.freeze({ticketTtlMs:300000,pageSize:100,maxPages:100,maxRangeDays:366,maxDownloadBytes:128*1024*1024,maxJobs:64});
const FORMATS=Object.freeze(['JSON','TXT','HTML','EXCEL']),RESOURCES=Object.freeze(['image','video','audio','file']);
const CODES=new Set([...P.CODES,'qce_jobs_locked','qce_jobs_changed','qce_jobs_limit','qce_jobs_unknown','qce_job_not_found','target_unavailable','target_limit','task_unavailable','task_binding_changed','task_not_completed','file_transfer_too_large','file_download_unknown','file_cleanup_unconfirmed','file_local_unsafe','file_local_unavailable','file_archive_invalid','file_source_changed','download_unavailable']);
class QCEExportError extends Error{constructor(code){const safe=CODES.has(code)?code:'qce_unavailable';super(`QCE export operation failed (${safe}).`);this.code=safe;}}
const fail=code=>{throw new QCEExportError(code);},safeCode=e=>new QCEExportError(e?.code).code;
const exact=(v,k,code='invalid_request')=>{if(!P.plain(v)||Object.keys(v).length!==k.length||k.some(x=>!Object.hasOwn(v,x)))fail(code);};
const integer=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const taskId=v=>typeof v==='string'&&/^export_[0-9]{13}_[a-z0-9]{1,9}$/.test(v);
const uid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const display=v=>typeof v==='string'?v.replace(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu,'').slice(0,200):'';
const iso=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
function fileName(v){if(!P.text(v,240)||Buffer.byteLength(v)>240||v!==v.trim()||/[. ]$/.test(v)||/[\\/<>:"|?*]/.test(v)||v.includes('..')||v.includes('%00')||/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(v))fail('invalid_response');return v;}
function extension(v,format,zip){fileName(v);const ext=path.win32.extname(v).toLowerCase();if(!({JSON:['.json'],TXT:['.txt'],EXCEL:['.xlsx'],HTML:zip?['.html','.zip']:['.html']}[format]||[]).includes(ext))fail('invalid_response');return ext;}
function range(v,now=Date.now()){exact(v,['startTime','endTime']);if(!integer(v.startTime)||!integer(v.endTime)||v.startTime<1000000000000||v.endTime<=v.startTime||v.endTime>now+60000||v.endTime-v.startTime>LIMITS.maxRangeDays*86400000)fail('invalid_request');return {...v};}
function options(v,format){exact(v,['includeSystemMessages','preferGroupMemberName','resources','htmlZip']);exact(v.resources,RESOURCES);if([v.includeSystemMessages,v.preferGroupMemberName,v.htmlZip,...Object.values(v.resources)].some(x=>typeof x!=='boolean')||format!=='HTML'&&v.htmlZip)fail('invalid_request');return P.copy(v);}
function qceExportRequest(v,action='read'){
 const fields={read:['kind','page'],jobs:[],preview:v?.action==='create'?['action','observationId','targetId','format','range','options']:['action','operationId'],confirm:['ticketId'],observe:['operationId'],download:['operationId'],forget:['operationId','revision'],dismiss:[],close:[]};
 if(!Object.hasOwn(fields,action))fail('invalid_request');exact(v,['accountId','panelId',...fields[action]]);if(!P.profileId(v.accountId)||!P.uuid(v.panelId))fail('invalid_request');
 if(action==='read'&&(!['friends','groups'].includes(v.kind)||!Number.isSafeInteger(v.page)||v.page<1||v.page>LIMITS.maxPages))fail('invalid_request');
 if(action==='preview'){if(v.action==='create'){if(!P.uuid(v.observationId)||!P.uuid(v.targetId)||!FORMATS.includes(v.format))fail('invalid_request');range(v.range,Number.MAX_SAFE_INTEGER-60000);options(v.options,v.format);}else if(v.action!=='cancel'||!P.uuid(v.operationId))fail('invalid_request');}
 if(['observe','download','forget'].includes(action)&&!P.uuid(v.operationId)||action==='forget'&&!P.uuid(v.revision)||action==='confirm'&&!P.uuid(v.ticketId))fail('invalid_request');return v;
}
function targets(v,kind,page){
 const key=kind==='friends'?'friends':'groups';if(!P.plain(v)||!Array.isArray(v[key])||v[key].length>100||!integer(v.totalCount,10000)||!integer(v.totalPages,100)||v.currentPage!==page||v.totalPages!==Math.ceil(v.totalCount/100)||v[key].length!==Math.min(100,Math.max(0,v.totalCount-(page-1)*100))||v.hasNext!==(page<v.totalPages)||v.hasPrev!==(page>1))fail('invalid_response');
 if(page>Math.max(1,v.totalPages))fail('target_unavailable');const seen=new Set();const rows=v[key].map(row=>{if(!P.plain(row))fail('invalid_response');const peerUid=kind==='friends'?row.uid:row.groupCode,number=kind==='friends'?row.uin:row.groupCode;if(!uid(peerUid)||!P.qq(number)||seen.has(peerUid))fail('invalid_response');seen.add(peerUid);return {kind:kind==='friends'?'friend':'group',peer:{chatType:kind==='friends'?1:2,peerUid},name:display(kind==='friends'?(row.remark||row.nick):row.groupName)||number,number};});return {rows,totalCount:v.totalCount,totalPages:v.totalPages};
}
const publicTarget=t=>({kind:t.kind,name:t.name,number:t.number});
function createBody(target,format,time,o,outputDir){return {peer:{...target.peer},format,filter:{...time},options:{outputDir,batchSize:100,includeResourceLinks:true,includeSystemMessages:o.includeSystemMessages,preferGroupMemberName:o.preferGroupMemberName,prettyFormat:true,embedAvatarsAsBase64:false,useNameInFileName:false,useFriendlyFileName:false,skipDownloadResourceTypes:RESOURCES.filter(k=>!o.resources[k]),filterPureImageMessages:RESOURCES.every(k=>!o.resources[k]),exportAsZip:o.htmlZip}};}
function createAck(v,request,version='5.5.77'){P.version(version);if(!P.plain(v)||!taskId(v.taskId)||v.status!==(version==='6.4.2'?'queued':'running')||v.messageCount!==0||v.startTime!==request.filter.startTime||v.endTime!==request.filter.endTime)fail('invalid_response');extension(v.fileName,request.format,false);return {taskId:v.taskId,fileName:v.fileName};}
function summary(v){if(!P.plain(v))return null;const keys=['attempted','alreadyAvailable','downloaded','failed','skipped'];return keys.every(k=>integer(v[k]))?Object.fromEntries(keys.map(k=>[k,v[k]])):null;}
function task(v,record,version='5.5.77'){
 P.version(version);
 const r=record.request;if(!P.plain(v)||v.id!==record.taskId||!P.plain(v.peer)||v.peer.chatType!==r.peer.chatType||v.peer.peerUid!==r.peer.peerUid||v.format!==r.format||v.startTime!==r.filter.startTime||v.endTime!==r.filter.endTime)fail('task_binding_changed');
 if(![...(version==='6.4.2'?['queued']:[]),'pending','running','paused','completed','failed','cancelled'].includes(v.status)||typeof v.progress!=='number'||!Number.isFinite(v.progress)||v.progress<0||v.progress>100||!integer(v.messageCount)||!iso(v.createdAt)||v.completedAt!==undefined&&v.completedAt!==null&&!iso(v.completedAt))fail('invalid_response');
 const ext=extension(v.fileName,r.format,r.options.exportAsZip);
 return {operationId:record.operationId,status:v.status,progress:v.progress,format:r.format,target:{kind:r.peer.chatType===1?'friend':'group',name:display(v.sessionName)||(r.peer.chatType===1?'Friend':'Group'),number:r.peer.chatType===2?r.peer.peerUid:null},messageCount:v.messageCount,fileName:v.fileName,createdAt:v.createdAt,completedAt:v.completedAt||null,downloadAvailable:v.status==='completed',zipRequested:r.options.exportAsZip,zipProduced:ext==='.zip',resourceSummary:summary(v.resourceSummary),errorPresent:v.error!==undefined&&v.error!==null};
}
function cancelAck(v,id,record,version='5.5.77'){P.version(version);if(version==='6.4.2'){if(!record||record.taskId!==id)fail('task_binding_changed');const result=task(v,record,version);if(result.status!=='cancelled'||result.completedAt===null)fail('invalid_response');return {cancelled:true};}if(!P.plain(v)||v.taskId!==id||typeof v.cancelled!=='boolean'||!v.cancelled&&!['completed','failed','cancelled'].includes(v.status))fail('invalid_response');return {cancelled:v.cancelled};}
const effects=action=>({readsChatHistory:action==='create',writesExportFiles:action==='create',mayDownloadResources:action==='create',sharedOsUserStorage:true,sourceAccountAtomicityVerified:false,cancelStopsAllWritesVerified:false,automaticRetry:false,htmlZipMayFallBack:true,sidecarsIncludedInSingleFile:false});
function publicJob(r,binding){const bindingCurrent=r.scope.credentialRevision===binding.credentialRevision&&(r.scope.pluginVersion||'5.5.77')===(binding.pluginVersion||'5.5.77');return {operationId:r.operationId,revision:r.revision,submission:r.submission,createdAt:r.createdAt,updatedAt:r.updatedAt,taskRecorded:r.taskId!==null,format:r.request.format,targetKind:r.request.peer.chatType===1?'friend':'group',bindingCurrent,canObserve:r.taskId!==null&&bindingCurrent,canForget:true};}
function scope(binding){const result=Object.fromEntries(['accountId','qqAccountId','workScope','credentialRevision'].map(k=>[k,binding[k]]));if(binding.pluginVersion==='6.4.2')result.pluginVersion='6.4.2';return result;}
module.exports={...P,fail,safeCode,exact,QCEExportError,CODES,LIMITS,FORMATS,RESOURCES,integer,taskId,uid,display,iso,fileName,extension,range,options,qceExportRequest,targets,publicTarget,createBody,createAck,task,cancelAck,effects,publicJob,scope};
