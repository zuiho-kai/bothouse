'use strict';
// A separate opt-in capability; normal Start/Stop/Recover never grants it.
const P=require('./policy.cjs');
const PROTOCOL='agent-arcade-qq-supervisor-orphan-cleanup/2',BASE='/v1/orphan-cleanup';
const LIMITS=Object.freeze({inspectionTtlMs:60000,previewTtlMs:60000,maxSelectedProcesses:64,maxRequestBytes:16384,maxResponseBytes:65536,requestTimeoutMs:120000});
const CODES=new Set([...P.CODES,'invalid_response','cancelled','orphan_cleanup_disabled','orphan_cleanup_unavailable','orphan_cleanup_changed','orphan_cleanup_unverified','orphan_cleanup_incomplete','orphan_preview_required','orphan_preview_expired']);
class OrphanCleanupError extends Error{constructor(code,status=400){super(CODES.has(code)?code:'runtime_failed');this.code=this.message;this.status=status;}}
const fail=(code,status)=>{throw new OrphanCleanupError(code,status);};
const safeCode=e=>CODES.has(e?.code)?e.code:'runtime_failed';
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const epoch=v=>Number.isSafeInteger(v)&&v>=0;
const action=v=>['terminate','settle','settle-resources'].includes(v);
function exact(v,keys){try{P.keys(v,keys);}catch{fail('invalid_request');}}
function previewRequest(v){exact(v,['inspectionId']);if(!P.uuid(v.inspectionId))fail('invalid_request');return {...v};}
function discardRequest(v){exact(v,['ticketId','expectedDigest']);if(!P.uuid(v.ticketId)||!hex(v.expectedDigest))fail('invalid_request');return {...v};}
function request(v){exact(v,['requestId','action','ticketId','expectedDigest']);if(!P.uuid(v.requestId)||!action(v.action))fail('invalid_request');discardRequest({ticketId:v.ticketId,expectedDigest:v.expectedDigest});return {...v};}
function capability(v){exact(v,['supported','enabled','component','version','scope','accountId','limits']);if(v.supported!==true||typeof v.enabled!=='boolean'||v.component!=='napcat-shell'||v.version!==P.VERSION||v.scope!=='declared-account'||!P.qq(v.accountId))fail('invalid_response');exact(v.limits,Object.keys(LIMITS));for(const k of Object.keys(LIMITS))if(v.limits[k]!==LIMITS[k])fail('invalid_response');return structuredClone(v);}
function inspection(v){exact(v,['inspectionId','expiresAt','accountId','state','issue','automaticStart']);if(!P.uuid(v.inspectionId)||!epoch(v.expiresAt)||!P.qq(v.accountId)||!['available','resources','unavailable'].includes(v.state)||v.automaticStart!==false||v.issue!==null&&!CODES.has(v.issue)||v.state!=='unavailable'&&v.issue!==null)fail('invalid_response');return structuredClone(v);}
function healthyLocalPreview(v,accountId,expiresAt){
 exact(v,['kind','accountId','count','expectedDigest','automaticStart']);
 if(v.kind!=='verified-orphan-cleanup'||v.accountId!==accountId||!P.qq(accountId)||!Number.isInteger(v.count)||v.count<1||v.count>LIMITS.maxSelectedProcesses||!hex(v.expectedDigest)||v.automaticStart!==false||!epoch(expiresAt))fail('invalid_response');
 // This expiry belongs to the service ticket, not a claimed local runtime TTL.
 return localPreview({...v,action:'terminate',expiresAt:new Date(expiresAt).toISOString()},accountId);
}
function localPreview(v,accountId){
 const resource=v?.action==='settle-resources',keys=['kind','action','accountId','expectedDigest','expiresAt','automaticStart',...(resource?[]:['count'])];exact(v,keys);
 if(!P.qq(v.accountId)||v.accountId!==accountId||!action(v.action)||v.automaticStart!==false||!hex(v.expectedDigest)||typeof v.expiresAt!=='string'||v.expiresAt.length>40||!Number.isFinite(Date.parse(v.expiresAt)))fail('invalid_response');
 if(resource?v.kind!=='pending-shell-inspection-resources':v.kind!=='verified-orphan-cleanup'||!Number.isInteger(v.count)||v.action==='settle'&&v.count!==0||v.action==='terminate'&&(v.count<1||v.count>LIMITS.maxSelectedProcesses))fail('invalid_response');return structuredClone(v);
}
function preview(v,accountId){exact(v,['ticketId','kind','action','accountId','expectedDigest','expiresAt','automaticStart',...(v?.action==='settle-resources'?[]:['count'])]);if(!P.uuid(v.ticketId))fail('invalid_response');const {ticketId,...raw}=v;return {ticketId,...localPreview(raw,accountId)};}
function cleanup(v,accountId,expectedAction){
 const resource=expectedAction==='settle-resources';
 if(resource){exact(v,['kind','accountId','resources','processControlAttempted','leaseMutationAttempted','pendingUpdateRecordsModified','automaticStart']);if(v.kind!=='pending-shell-inspection-resources'||['processControlAttempted','leaseMutationAttempted','pendingUpdateRecordsModified','automaticStart'].some(k=>v[k]!==false))fail('invalid_response');}
 else{const healthy=v?.kind==='healthy-shell-orphan-cleanup';exact(v,['kind','accountId','selectedCount','confirmedAbsentCount','terminationAttempted','processes','lease','resources','automaticStart',...(!healthy?['pendingUpdateRecoveryRequired']:[])]);if(healthy?expectedAction!=='terminate':v.kind!=='pending-shell-orphan-cleanup')fail('invalid_response');if(!Number.isInteger(v.selectedCount)||v.selectedCount<1||v.selectedCount>64||typeof v.terminationAttempted!=='boolean'||expectedAction==='settle'&&v.terminationAttempted!==false||v.automaticStart!==false||!healthy&&v.pendingUpdateRecoveryRequired!==true||!['confirmed-absent','remaining','unverified'].includes(v.processes)||!['cleared','retained','unverified'].includes(v.lease))fail('invalid_response');const n=v.confirmedAbsentCount;if(v.processes==='unverified'?n!==null:!Number.isInteger(n)||n<0||n>v.selectedCount||v.processes==='confirmed-absent'&&n!==v.selectedCount||v.processes==='remaining'&&n>=v.selectedCount)fail('invalid_response');if(v.lease==='cleared'&&v.processes!=='confirmed-absent')fail('invalid_response');}
 if(v.accountId!==accountId||!P.qq(v.accountId)||!['closed','unconfirmed'].includes(v.resources))fail('invalid_response');return structuredClone(v);
}
const isComplete=v=>v.resources==='closed'&&(v.kind==='pending-shell-inspection-resources'||v.processes==='confirmed-absent'&&v.lease==='cleared');
function result(v,accountId,expectedAction){exact(v,['completed','cleanup']);const detail=cleanup(v.cleanup,accountId,expectedAction);if(typeof v.completed!=='boolean'||v.completed!==isComplete(detail))fail('invalid_response');return {completed:v.completed,cleanup:detail};}
function success(v,accountId,expectedAction){
 const resource=expectedAction==='settle-resources';exact(v,['recovery','accountId','automaticStart','cleanup',...(resource?[]:['terminatedCount'])]);if(v.accountId!==accountId||v.automaticStart!==false||v.recovery!==(resource?'inspection-resources-settled':'orphans-cleared'))fail('invalid_response');const detail=cleanup(v.cleanup,accountId,expectedAction);if(!isComplete(detail)||!resource&&(v.terminatedCount!==(expectedAction==='terminate'?detail.selectedCount:0)||expectedAction==='terminate'&&detail.terminationAttempted!==true))fail('invalid_response');return {completed:true,cleanup:detail};
}
function operation(v,accountId){
 exact(v,['type','requestId','action','phase','startedAt','finishedAt','code','result']);if(v.type!=='orphan-cleanup'||!P.uuid(v.requestId)||!action(v.action)||!epoch(v.startedAt)||!['attempted','completed','not_submitted','unknown'].includes(v.phase)||v.code!==null&&!CODES.has(v.code))fail('ledger_locked');
 if(v.phase==='attempted'){if(v.finishedAt!==null||v.code!==null||v.result!==null)fail('ledger_locked');}else if(!epoch(v.finishedAt)||v.finishedAt<v.startedAt)fail('ledger_locked');
 if(v.result!==null)result(v.result,accountId,v.action);
 if(v.phase==='completed'&&(v.result?.completed!==true||v.code!==null)||v.phase==='not_submitted'&&(v.result!==null||v.code===null)||v.phase==='unknown'&&(v.result?.completed===true||v.code===null))fail('ledger_locked');return structuredClone(v);
}
module.exports={PROTOCOL,BASE,LIMITS,CODES,OrphanCleanupError,fail,safeCode,hex,epoch,action,exact,previewRequest,discardRequest,request,capability,inspection,healthyLocalPreview,localPreview,preview,cleanup,isComplete,result,success,operation};
