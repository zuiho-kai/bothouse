'use strict';
// Original, finite account-bound scheduling policy. No native QCE cron routes.
const E=require('./qq-qce-export-policy.cjs');
const {validateRecurrence,nextOccurrence}=require('./qq-qce-schedule-time.cjs');
const LIMITS=Object.freeze({ticketTtlMs:300000,pageSize:100,maxPages:100,maxPlans:16,maxRuns:128,maxNameLength:80,maxLookbackDays:366,lateWindowMs:60000});
const CODES=new Set([...E.CODES,'qce_schedules_locked','qce_schedules_changed','qce_schedules_limit','qce_schedules_unknown','qce_schedule_not_found','invalid_recurrence','invalid_schedule_time','schedule_time_out_of_range','schedule_time_unavailable','schedule_missed','interrupted']);
const fail=code=>{const c=CODES.has(code)?code:'qce_unavailable';throw Object.assign(Error(`QCE schedule operation failed (${c}).`),{code:c});};
const safeCode=e=>CODES.has(e?.code)?e.code:'qce_unavailable';
function exact(v,keys,code='invalid_request'){E.exact(v,keys,code);if(Reflect.ownKeys(v).length!==keys.length||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')))fail(code);}
function localScope(v){if(!E.profileId(v?.accountId)||!E.qq(v?.qqAccountId)||typeof v?.workScope!=='string'||!/^[a-f0-9]{64}$/.test(v.workScope))fail('changed');return {accountId:v.accountId,qqAccountId:v.qqAccountId,workScope:v.workScope};}
function fullScope(v){const s=localScope(v);if(!E.uuid(v.credentialRevision))fail('credential_missing');return {...s,credentialRevision:v.credentialRevision};}
const sameScope=(a,b,full=false)=>['accountId','qqAccountId','workScope',...(full?['credentialRevision']:[])].every(k=>a?.[k]===b?.[k]);
function settings(v){if(!E.text(v.name,LIMITS.maxNameLength)||v.name!==v.name.trim()||!Number.isSafeInteger(v.lookbackDays)||v.lookbackDays<1||v.lookbackDays>LIMITS.maxLookbackDays||!E.FORMATS.includes(v.format))fail('invalid_request');return {name:v.name,recurrence:validateRecurrence(v.recurrence),lookbackDays:v.lookbackDays,format:v.format,options:E.options(v.options,v.format)};}
function validateDefinition(v){
 exact(v,['name','target','targetPage','configBaseline','recurrence','lookbackDays','format','options']);const set=settings(v),t=v.target;exact(t,['kind','peer','name','number']);exact(t.peer,['chatType','peerUid']);
 if(!['friend','group'].includes(t.kind)||t.peer.chatType!==(t.kind==='friend'?1:2)||!E.uid(t.peer.peerUid)||!E.text(t.name,200)||!E.qq(t.number)||t.kind==='group'&&t.peer.peerUid!==t.number||!Number.isSafeInteger(v.targetPage)||v.targetPage<1||v.targetPage>100)fail('invalid_request');
 exact(v.configBaseline,E.PATHS);const configBaseline=E.config(v.configBaseline);for(const value of Object.values(configBaseline))E.directory(value);
 return {name:set.name,target:E.copy(t),targetPage:v.targetPage,configBaseline,recurrence:set.recurrence,lookbackDays:set.lookbackDays,format:set.format,options:set.options};
}
function summary(d){return {name:d.name,target:E.publicTarget(d.target),recurrence:E.copy(d.recurrence),lookbackDays:d.lookbackDays,format:d.format,options:E.copy(d.options)};}
function publicPlan(p,b){return {scheduleId:p.scheduleId,revision:p.revision,...summary(p.definition),enabled:p.enabled,nextAt:p.nextAt,lastScheduledAt:p.lastScheduledAt,createdAt:p.createdAt,updatedAt:p.updatedAt,bindingCurrent:sameScope(p.scope,b,true)};}
function publicRun(r,b){return {runId:r.runId,revision:r.revision,scheduleId:r.scheduleId,kind:r.kind,scheduledAt:r.scheduledAt,operationId:r.operationId,outcome:r.outcome,code:r.code===null?null:safeCode(r),createdAt:r.createdAt,updatedAt:r.updatedAt,bindingCurrent:sameScope(r.scope,b,true),canForget:r.outcome!=='claimed'};}
function effects(action,d){const active=['enable','run'].includes(action);return {startsNativeSchedule:false,automaticWhileAppRunning:action==='enable',readsChatHistory:active,writesExportFiles:active,mayDownloadResources:active&&Object.values(d?.options?.resources||{}).some(Boolean),sourceAccountAtomicityVerified:false,pauseStopsSubmittedTasks:false,automaticRetry:false,missedCatchUp:false,sharedOsUserStorage:true};}
function qceScheduleRequest(v,action='list'){
 let fields={list:[],read:['kind','page'],confirm:['ticketId'],runs:['scheduleId'],forgetRun:['runId','revision'],dismiss:[],close:[]}[action];
 if(action==='preview'){fields=['action'];if(['create','edit'].includes(v?.action))fields.push('observationId','targetId','name','recurrence','lookbackDays','format','options');if(['edit','enable','disable','remove','run'].includes(v?.action))fields.push('scheduleId','revision');}
 if(!fields)fail('invalid_request');exact(v,['accountId','panelId',...fields]);if(!E.profileId(v.accountId)||!E.uuid(v.panelId))fail('invalid_request');
 if(action==='read'&&(!['friends','groups'].includes(v.kind)||!Number.isSafeInteger(v.page)||v.page<1||v.page>100))fail('invalid_request');
 if(action==='preview'){if(!['create','edit','enable','disable','remove','run'].includes(v.action))fail('invalid_request');if(['create','edit'].includes(v.action)){if(!E.uuid(v.observationId)||!E.uuid(v.targetId))fail('invalid_request');settings(v);}if(v.action!=='create'&&(!E.uuid(v.scheduleId)||!E.uuid(v.revision)))fail('invalid_request');}
 if(action==='confirm'&&!E.uuid(v.ticketId)||action==='runs'&&v.scheduleId!==null&&!E.uuid(v.scheduleId)||action==='forgetRun'&&(!E.uuid(v.runId)||!E.uuid(v.revision)))fail('invalid_request');return v;
}
function windowFor(d,at){return E.range({startTime:at-d.lookbackDays*86400000,endTime:at},at);}
function next(d,after){const result=nextOccurrence(d.recurrence,after);if(!result)fail('schedule_time_out_of_range');return result;}
module.exports={...E,LIMITS,CODES,fail,safeCode,exact,localScope,fullScope,sameScope,settings,validateDefinition,summary,publicPlan,publicRun,effects,qceScheduleRequest,windowFor,next,validateRecurrence,nextOccurrence};
