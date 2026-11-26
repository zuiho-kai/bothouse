'use strict';
const path = require('node:path');
const {createHash} = require('node:crypto');
const FIELDS = Object.freeze(['customOutputDir', 'customScheduledExportDir']);
const PATHS = Object.freeze([...FIELDS, 'currentExportsDir', 'currentScheduledExportsDir']);
const LIMITS = Object.freeze({maxPathLength:1024, ticketTtlMs:300000});
const EFFECTS = Object.freeze({authenticationMayWriteSecurityMetadata:true, mayCreateDirectories:true, movesExistingFiles:false, startsExport:false, createsOrRunsSchedule:false, existingSchedulesWithoutOverrideAffected:true, unknownFieldsPreservationVerified:false, nullBaselineHealthVerified:false, durablePersistenceVerified:false});
const SCOPE = Object.freeze({kind:'shared-os-user', accountIsolated:false});
const CODES = new Set(['invalid_request','invalid_response','invalid_path','no_changes','changed','closed','cancelled','operation_in_progress','stale_observation','stale_ticket','expired_ticket','endpoint_unverified','qce_unavailable','qce_version_unsupported','qq_mismatch','qq_offline','unauthorized','timeout','connection_failed','response_too_large','redirect_rejected','action_failed','baseline_changed','change_unknown','credentials_locked','credential_missing','credential_changed','credential_scope_changed','listener_unverified','component_unavailable','plugin_version_unsupported','plugin_not_found','manager_unavailable','account_changed','account_offline','unsupported_version','unconfigured','scope_changed']);
class QCEError extends Error { constructor(code) { code=CODES.has(code)?code:'qce_unavailable'; super(`QCE settings operation failed (${code}).`); this.code=code; } }
for(const code of ['qce_invalid_request','qce_invalid_token','qce_credentials_locked','qce_credential_missing','qce_credential_scope_changed','qce_credential_revision_changed','qce_encryption_unavailable','qce_storage_write_unknown','qce_credential_limit','qce_listener_unverified','qce_process_unverified','qce_startup_unverified','qce_startup_migration_required','qce_startup_changed','qce_binding_changed','qce_binding_cancelled'])CODES.add(code);
const fail = code => { throw new QCEError(code); };
const safeCode = error => new QCEError(error?.code).code;
const plain = value => value!==null && typeof value==='object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
function exact(value, keys, code='invalid_request') { if(!plain(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail(code); }
const uuid = value => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const profileId = value => typeof value==='string' && /^[A-Za-z0-9-]{1,64}$/.test(value);
const qq = value => typeof value==='string' && /^[1-9][0-9]{4,19}$/.test(value);
const text = (value, max=1024, empty=false) => typeof value==='string' && (empty||value.length>0) && value.length<=max && !/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
function directory(value) {
 if(value===null)return value;
 if(!text(value)||value!==value.trim()||/[\/"<>|?*]/.test(value.replace(/\\/g,''))||value.includes('/')||/^\\\\[?.]\\/.test(value)||!path.win32.isAbsolute(value))fail('invalid_path');
 let components;
 if(/^[A-Za-z]:\\/.test(value))components=value.slice(3).split('\\');
 else if(/^\\\\[^\\]+\\[^\\]+/.test(value))components=value.slice(2).split('\\');
 else fail('invalid_path');
 if(components.at(-1)==='')components.pop();
 if(components.some(v=>!v||v==='.'||v==='..'||/[. ]$/.test(v)||/[\x00-\x1f<>:"/|?*]/.test(v)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(v)))fail('invalid_path');
 return value;
}
function config(value) {
 if(!plain(value))fail('invalid_response');
 const result={};
 for(const key of PATHS){const v=value[key];if(!(FIELDS.includes(key)&&v===null)&&!text(v))fail('invalid_response');result[key]=v;}
 return result;
}
const VERSIONS=Object.freeze(['5.5.77','6.4.2']);
function version(value){if(!VERSIONS.includes(value))fail('qce_version_unsupported');return value;}
function identity(value,expectedQQ,expectedVersion='5.5.77') {
 version(expectedVersion);if(!plain(value)||value.mode!=='plugin'||value.version!==expectedVersion)fail('qce_version_unsupported');
 if(!plain(value.napcat)||!plain(value.napcat.selfInfo)||!qq(value.napcat.selfInfo.uin))fail('invalid_response');
 if(value.napcat.selfInfo.uin!==expectedQQ)fail('qq_mismatch');
 if(value.napcat.online!==true)fail('qq_offline');
 return {version:expectedVersion,qqAccountId:expectedQQ,online:true};
}
function qceRequest(value,action='read') {
 const extra={status:[],saveCredential:['token','expectedRevision'],removeCredential:['expectedRevision'],read:[],preview:['observationId','field','value'],confirm:['ticketId'],dismiss:[],close:[]};
 if(!Object.hasOwn(extra,action))fail('invalid_request');exact(value,['accountId','panelId',...extra[action]]);
 if(!profileId(value.accountId)||!uuid(value.panelId))fail('invalid_request');
 if(['saveCredential','removeCredential'].includes(action)&&!uuid(value.expectedRevision))fail('invalid_request');
 if(action==='saveCredential'&&!(typeof value.token==='string'&&/^[A-Za-z0-9]{40}$/.test(value.token)))fail('invalid_request');
 if(action==='preview'){if(!uuid(value.observationId)||!FIELDS.includes(value.field))fail('invalid_request');directory(value.value);}
 if(action==='confirm'&&!uuid(value.ticketId))fail('invalid_request');return value;
}
module.exports={VERSIONS,version,QCEError,fail,safeCode,plain,exact,uuid,profileId,qq,text,digest,copy,directory,config,identity,qceRequest,FIELDS,PATHS,LIMITS,EFFECTS,SCOPE,CODES};
