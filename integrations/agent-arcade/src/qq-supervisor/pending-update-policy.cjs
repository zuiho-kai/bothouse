'use strict';
// Original, separately versioned recovery wire; no process action broadening.
const P=require('./policy.cjs');
const {CODES:HELPER_CODES}=require('../bot/qq-pending-update-recovery.cjs');
const PROTOCOL='agent-arcade-qq-supervisor-pending-update/1',BASE='/v1/pending-update-recovery';
const LIMITS=Object.freeze({maxRecords:1,maxMarkerBytes:2097152,maxRetainedOperations:64,inspectionTtlMs:60000,previewTtlMs:300000,maxRequestBytes:16384,maxResponseBytes:65536,requestTimeoutMs:120000});
const CODES=new Set([...P.CODES,...HELPER_CODES,'recovery_disabled']);
class RecoveryError extends Error{constructor(code,status=409){super(CODES.has(code)?code:'pending_update_failed');this.code=this.message;this.status=status;}}
const fail=(code,status)=>{throw new RecoveryError(code,status);};
const safeCode=e=>CODES.has(typeof e==='string'?e:e?.code)?(typeof e==='string'?e:e.code):'pending_update_failed';
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const epoch=v=>Number.isSafeInteger(v)&&v>=0;
const action=v=>v==='disable'||v==='reconcile';
function request(v){P.keys(v,['requestId','action','recordId','ticketId','expectedDigest']);if(!P.uuid(v.requestId)||!action(v.action)||!hex(v.recordId)||!P.uuid(v.ticketId)||!hex(v.expectedDigest))fail('invalid_request',400);return {requestId:v.requestId,action:v.action,recordId:v.recordId,ticketId:v.ticketId,expectedDigest:v.expectedDigest};}
function previewRequest(v){P.keys(v,['inspectionId','recordId','action']);if(!P.uuid(v.inspectionId)||!hex(v.recordId)||!action(v.action))fail('invalid_request',400);return {...v};}
function result(v){P.keys(v,['committed','disabled','retained','preservationId','automaticStart','rollsBackCode']);if(v.automaticStart!==false||v.rollsBackCode!==false||v.preservationId!==null&&!P.uuid(v.preservationId))fail('invalid_response');if(v.committed===true){if(typeof v.disabled!=='boolean'||v.retained!==v.disabled||v.preservationId===null)fail('invalid_response');}else if(v.committed===null){if(v.disabled!==null||v.retained!==null)fail('invalid_response');}else fail('invalid_response');return {...v};}
function receipt(v,recordId){if(!P.plain(v)||v.recordId!==recordId||Object.keys(v).some(k=>!['committed','disabled','retained','recordId','operationId','automaticStart','rollsBackCode','code'].includes(k))||v.code!==undefined&&!CODES.has(v.code))fail('invalid_response');return {result:result({committed:v.committed,disabled:v.disabled,retained:v.retained,preservationId:v.operationId,automaticStart:v.automaticStart,rollsBackCode:v.rollsBackCode}),code:v.code??null};}
function operation(v){P.keys(v,['type','requestId','action','recordId','phase','startedAt','finishedAt','code','result']);if(v.type!=='pending-update-recovery'||!P.uuid(v.requestId)||!action(v.action)||!hex(v.recordId)||!epoch(v.startedAt)||!['attempted','completed','not_submitted','unknown'].includes(v.phase)||v.code!==null&&!CODES.has(v.code))fail('ledger_locked');if(v.phase==='attempted'){if(v.finishedAt!==null||v.code!==null||v.result!==null)fail('ledger_locked');}else if(!epoch(v.finishedAt)||v.finishedAt<v.startedAt)fail('ledger_locked');if(v.result!==null)result(v.result);if(v.phase==='completed'&&(v.result?.committed!==true||v.action==='disable'&&v.result.disabled!==true)||v.phase==='not_submitted'&&(v.result!==null||v.code===null)||v.phase==='unknown'&&v.result?.committed===true)fail('ledger_locked');return structuredClone(v);}
module.exports={PROTOCOL,BASE,LIMITS,CODES,RecoveryError,fail,safeCode,hex,request,previewRequest,result,receipt,operation};
