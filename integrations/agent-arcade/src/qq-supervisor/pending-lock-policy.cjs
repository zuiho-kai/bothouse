'use strict';
// A separate operation family; clearing a lock does not reconcile an update.
const P=require('./policy.cjs');
const {CODES:CORE_CODES}=require('../bot/qq-pending-update-lock-recovery.cjs');
const PROTOCOL='agent-arcade-qq-supervisor-pending-lock/1',BASE='/v1/pending-update-locks';
const LIMITS=Object.freeze({maxRecords:2,inspectionTtlMs:60000,previewTtlMs:300000,maxRequestBytes:16384,maxResponseBytes:65536,requestTimeoutMs:120000});
const CODES=new Set([...P.CODES,...CORE_CODES,'invalid_response','lock_recovery_disabled']);
class LockRecoveryError extends Error{constructor(code,status=409){super(CODES.has(code)?code:'pending_lock_failed');this.code=this.message;this.status=status;}}
const fail=(code,status)=>{throw new LockRecoveryError(code,status);};
const safeCode=e=>CODES.has(typeof e==='string'?e:e?.code)?(typeof e==='string'?e:e.code):'pending_lock_failed';
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),epoch=v=>Number.isSafeInteger(v)&&v>=0;
const kinds=Object.freeze({'clear-installation':'installation','clear-recovery-guard':'recovery-guard'});
const action=v=>Object.hasOwn(kinds,v);
function request(v){P.keys(v,['requestId','action','recordId','ticketId','expectedDigest']);if(!P.uuid(v.requestId)||!action(v.action)||!hex(v.recordId)||!P.uuid(v.ticketId)||!hex(v.expectedDigest))fail('invalid_request',400);return {requestId:v.requestId,action:v.action,recordId:v.recordId,ticketId:v.ticketId,expectedDigest:v.expectedDigest};}
function previewRequest(v){P.keys(v,['inspectionId','recordId']);if(!P.uuid(v.inspectionId)||!hex(v.recordId))fail('invalid_request',400);return {...v};}
const tri=v=>v===null||typeof v==='boolean';
function result(v){
 P.keys(v,['receiptId','committed','lockCleared','cleanupVerified','recoveryRequired','remainingLocks','pendingUpdateRecoveryRequired','updateRecordsChanged','accountRecordsChanged','automaticStart','automaticStop','rollsBackCode']);
 P.keys(v.remainingLocks,['installation','recoveryGuard']);
 if(!P.uuid(v.receiptId)||!tri(v.committed)||v.lockCleared!==v.committed||typeof v.cleanupVerified!=='boolean'||typeof v.recoveryRequired!=='boolean'||!tri(v.remainingLocks.installation)||!tri(v.remainingLocks.recoveryGuard)||v.pendingUpdateRecoveryRequired!==true||['updateRecordsChanged','accountRecordsChanged','automaticStart','automaticStop','rollsBackCode'].some(k=>v[k]!==false))fail('invalid_response');
 if((v.committed===null||!v.cleanupVerified||v.remainingLocks.installation!==false||v.remainingLocks.recoveryGuard!==false)&&v.recoveryRequired!==true)fail('invalid_response');
 return structuredClone(v);
}
function receipt(v,input){
 P.keys(v,['operation','recordId','kind','operationId','committed','lockCleared','cleanupVerified','recoveryRequired','remainingLocks','pendingUpdateRecoveryRequired','updateRecordsChanged','accountRecordsChanged','automaticStart','automaticStop','rollsBackCode','code']);
 if(v.operation!=='clear-pending-update-lock'||v.recordId!==input.recordId||v.kind!==kinds[input.action]||v.code!==null&&!CODES.has(v.code)||v.committed===false&&v.code===null)fail('invalid_response');
 const {operation,recordId,kind,operationId,code,...facts}=v;return {result:result({receiptId:operationId,...facts}),code};
}
function operation(v){
 P.keys(v,['type','requestId','action','recordId','phase','startedAt','finishedAt','code','result']);
 if(v.type!=='pending-update-lock-recovery'||!P.uuid(v.requestId)||!action(v.action)||!hex(v.recordId)||!epoch(v.startedAt)||!['attempted','completed','not_submitted','unknown'].includes(v.phase)||v.code!==null&&!CODES.has(v.code))fail('ledger_locked');
 if(v.phase==='attempted'){if(v.finishedAt!==null||v.code!==null||v.result!==null)fail('ledger_locked');}
 else if(!epoch(v.finishedAt)||v.finishedAt<v.startedAt)fail('ledger_locked');
 if(v.result!==null)result(v.result);
 if(v.phase==='completed'&&(typeof v.result?.committed!=='boolean'||v.result.committed===false&&v.code===null)||v.phase==='not_submitted'&&(v.result!==null||v.code===null)||v.phase==='unknown'&&v.result!==null&&v.result.committed!==null)fail('ledger_locked');
 return structuredClone(v);
}
function inspection(v){
 P.keys(v,['supported','component','version','scope','verification','records','issue']);
 if(typeof v.supported!=='boolean'||v.component!=='napcat-shell'||v.version!==P.VERSION||v.scope!=='declared-installation'||v.verification!=='not-checked'||!Array.isArray(v.records)||v.records.length>LIMITS.maxRecords||(v.supported?v.issue!==null:v.issue!=='pending_lock_unsupported'||v.records.length!==0))fail('invalid_response');
 const ids=new Set(),types=new Set();for(const row of v.records){P.keys(row,['recordId','kind','state','code']);if(!hex(row.recordId)||!Object.values(kinds).includes(row.kind)||!['present','unverified'].includes(row.state)||ids.has(row.recordId)||types.has(row.kind)||row.state==='present'&&row.code!==null||row.state==='unverified'&&!CODES.has(row.code))fail('invalid_response');ids.add(row.recordId);types.add(row.kind);}return structuredClone(v);
}
function preview(v,input){
 P.keys(v,['operation','recordId','kind','ticketId','expectedDigest','expiresAt','component','version','verification','owner','stopped','effects']);
 P.keys(v.effects,['scope','mayAffectOtherAccounts','clearsOnlySelectedLock','updateRecordsChanged','accountRecordsChanged','automaticStart','automaticStop','rollsBackCode']);
 if(v.operation!=='clear-pending-update-lock'||v.recordId!==input.recordId||!Object.values(kinds).includes(v.kind)||!P.uuid(v.ticketId)||!hex(v.expectedDigest)||!epoch(v.expiresAt)||v.component!=='napcat-shell'||v.version!==P.VERSION||v.verification!=='full-manifest'||v.owner!=='confirmed-absent'||v.stopped!=='all-related-processes-and-shared-locks-checked'||v.effects.scope!=='declared-installation'||v.effects.mayAffectOtherAccounts!==true||v.effects.clearsOnlySelectedLock!==true||['updateRecordsChanged','accountRecordsChanged','automaticStart','automaticStop','rollsBackCode'].some(k=>v.effects[k]!==false))fail('invalid_response');
 const {operation,kind,...rest}=v;return {action:Object.keys(kinds).find(k=>kinds[k]===kind),target:kind,...structuredClone(rest)};
}
module.exports={PROTOCOL,BASE,LIMITS,CODES,LockRecoveryError,fail,safeCode,hex,kinds,request,previewRequest,result,receipt,operation,inspection,preview};
