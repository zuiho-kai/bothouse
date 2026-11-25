'use strict';
const {isIP}=require('node:net');
const {randomUUID}=require('node:crypto');
const Q=require('./qq-qce-policy.cjs');
const LIMITS=Object.freeze({ticketTtlMs:300000,maxRules:128,maxRuleLength:256,maxRuleDisplayLength:1536,maxNewRuleLength:128,maxHostLength:253});
const SCOPE=Object.freeze({kind:'shared-os-user',accountIsolated:false});
const EFFECTS=Object.freeze({authenticationMayWriteSecurityMetadata:true,readbackMayWriteConfiguration:true,persistenceVerified:false,allRoutesProtected:false,listenerChanged:false,sharedOSscope:true,rotatesToken:false,automaticRetry:false});
const CODES=new Set([...Q.CODES,'invalid_rule','invalid_host','rules_limit','ip_not_allowed','token_expired']);
class QCESecurityError extends Error{constructor(code){code=CODES.has(code)?code:'qce_unavailable';super(`QCE access-rule operation failed (${code}).`);this.code=code;}}
const fail=code=>{throw new QCESecurityError(code);};
const safeCode=error=>CODES.has(error?.code)?error.code:'qce_unavailable';
function ipv4(value){return typeof value==='string'&&value.split('.').length===4&&value.split('.').every(v=>/^(0|[1-9][0-9]{0,2})$/.test(v)&&Number(v)<=255);}
function rule(value){
 if(!Q.text(value,LIMITS.maxNewRuleLength)||value!==value.trim()||/[\s%]/u.test(value))fail('invalid_rule');
 if(value==='*'||ipv4(value)||isIP(value)===6)return value;
 const parts=value.split('/');if(parts.length===2&&ipv4(parts[0])&&/^(0|[1-9][0-9]?)$/.test(parts[1])&&Number(parts[1])<=32)return value;
 fail('invalid_rule');
}
const supported=value=>{try{rule(value);return true;}catch{return false;}};
function host(value,version='5.5.77'){
 Q.version(version);if(version==='6.4.2'&&typeof value==='string'&&value.includes(':'))fail('invalid_host');
 if(!Q.text(value,LIMITS.maxHostLength)||value!==value.trim()||/[\s%/@?#\\]/u.test(value))fail('invalid_host');
 if(ipv4(value)||isIP(value)===6)return value;
 if(!/^[A-Za-z0-9.-]+$/.test(value)||value.endsWith('.')||value.split('.').some(v=>!v||v.length>63||!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(v))||/^[0-9.]+$/.test(value))fail('invalid_host');
 return value;
}
const displayHost=value=>value==='0.0.0.0'?'127.0.0.1':value;
function rawRules(value){if(!Array.isArray(value)||value.length>LIMITS.maxRules||value.some(v=>typeof v!=='string'||v.length>LIMITS.maxRuleLength))fail('invalid_response');return [...value];}
function whitelist(value,version='5.5.77'){
 Q.version(version);if(version==='6.4.2'){
  if(!Q.plain(value)||typeof value.disabled!=='boolean'||typeof value.isDocker!=='boolean'||!Q.text(value.currentClientIP,128))fail('invalid_response');
  return {rules:rawRules(value.allowedIPs),disabled:value.disabled,isDocker:value.isDocker,currentClientIP:value.currentClientIP};
 }
 if(!Q.plain(value)||typeof value.disabled!=='boolean'||typeof value.isDocker!=='boolean'||!Q.text(value.configPath,4096)||!Q.text(value.currentClientIP,128))fail('invalid_response');
 return {rules:rawRules(value.allowedIPs),disabled:value.disabled,isDocker:value.isDocker,configPath:value.configPath,currentClientIP:value.currentClientIP};
}
function status(value,version='5.5.77'){
 Q.version(version);if(version==='6.4.2'){
  if(!Q.plain(value)||typeof value.hasConfig!=='boolean'||typeof value.tokenExpired!=='boolean'||value.requiresAuth!==true)fail('invalid_response');
  return {hasConfig:value.hasConfig,tokenExpired:value.tokenExpired,requiresAuth:true};
 }
 if(!Q.plain(value)||typeof value.hasConfig!=='boolean'||typeof value.tokenExpired!=='boolean'||value.requiresAuth!==true||typeof value.isDocker!=='boolean'||typeof value.ipWhitelistDisabled!=='boolean'||!Q.text(value.configPath,4096)||!Q.text(value.currentClientIP,128)||(value.publicIP!==null&&!Q.text(value.publicIP,253))||(value.serverIP!==null&&!Q.text(value.serverIP,253)))fail('invalid_response');
 return {rules:rawRules(value.allowedIPs),disabled:value.ipWhitelistDisabled,isDocker:value.isDocker,configPath:value.configPath,currentClientIP:value.currentClientIP,displayHost:value.publicIP};
}
function authentication(value){
 if(!Q.plain(value)||value.authenticated!==true||!Q.text(value.clientIP,128)||(value.serverIP!==null&&!Q.text(value.serverIP,253)))fail('invalid_response');
 return {currentClientIP:value.clientIP,displayHost:value.serverIP};
}
function combine(list,info,version='5.5.77'){Q.version(version);if(version==='6.4.2'){if(list.currentClientIP!==info.currentClientIP)fail('baseline_changed');return {...list,displayHost:info.displayHost};}for(const key of ['rules','disabled','isDocker','configPath','currentClientIP'])if(JSON.stringify(list[key])!==JSON.stringify(info[key]))fail('baseline_changed');return {...list,displayHost:info.displayHost};}
const allowsAll=value=>value.disabled||value.rules.length===0||value.rules.some(v=>v==='*'||v==='0.0.0.0');
// Compatibility prediction for existing native IPv4 CIDR literals, including its
// permissive parseInt grammar. New rules use the stricter validator above.
function legacyCIDR(value){const [address,prefix,...rest]=value.split('/');if(rest.length||prefix===undefined)return null;const bits=parseInt(prefix,10),parts=address.split('.').map(v=>parseInt(v,10));if(!Number.isInteger(bits)||bits<0||bits>32||parts.length!==4||parts.some(v=>!Number.isInteger(v)||v<0||v>255))return null;return {bits,number:parts.reduce((n,v)=>n*256+v,0)};}
// Rust u32 parsing is complete (optional plus/leading zeros), unlike JS parseInt.
function rustCIDR(value){const [address,prefix,...rest]=value.split('/');if(rest.length||prefix===undefined)return null;const integer=v=>/^\+?[0-9]+$/.test(v)&&Number.isSafeInteger(Number(v))&&Number(v)<=4294967295?Number(v):null;const bits=integer(prefix),parts=address.replace(/^::ffff:/,'').split('.').map(integer);if(bits===null||bits>32||parts.length!==4||parts.some(v=>v===null||v>255))return null;return {bits,number:parts.reduce((n,v)=>n*256+v,0)};}
function allowsLoopback(value,version='5.5.77'){Q.version(version);if(allowsAll(value))return true;return value.rules.some(v=>{if(v==='127.0.0.1')return true;const cidr=(version==='6.4.2'?rustCIDR:legacyCIDR)(v);return cidr!==null&&Math.floor(2130706433/2**(32-cidr.bits))===Math.floor(cidr.number/2**(32-cidr.bits));});}
const safeDisplay=value=>value.replace(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu,char=>Array.from({length:char.length},(_,i)=>'\\u'+char.charCodeAt(i).toString(16).padStart(4,'0')).join(''));
function project(value,ids=value.rules.map(()=>randomUUID())){return {rules:value.rules.map((v,i)=>({ruleId:ids[i],value:safeDisplay(v),supported:supported(v),removable:v.length>0})),disabled:value.disabled,allowsAll:allowsAll(value),currentClientIP:value.currentClientIP,displayHost:value.displayHost};}
function mutation(saved,action,value,version='5.5.77'){Q.version(version);
 const before=Q.copy(saved.value),after=Q.copy(before),ids=[...saved.ids];let command;
 if(action==='addRule'||action==='addCurrent'){
  const literal=rule(action==='addCurrent'?before.currentClientIP:value);if(before.rules.includes(literal))fail('no_changes');if(before.rules.length>=LIMITS.maxRules)fail('rules_limit');after.rules.push(literal);ids.push(randomUUID());command={action:'addRule',value:literal};
 }else if(action==='removeRule'){
  const selected=saved.ids.indexOf(value);if(selected<0)fail('invalid_request');const literal=before.rules[selected];if(literal.length===0)fail('invalid_rule');const index=before.rules.indexOf(literal);after.rules.splice(index,1);ids.splice(index,1);command={action,value:literal};
 }else if(action==='setDisabled'){if(before.disabled===value)fail('no_changes');after.disabled=value;command={action,value};}
 else if(action==='setDisplayHost'){const literal=host(value,version),effective=displayHost(literal);if(before.displayHost===effective)fail('no_changes');after.displayHost=effective;command={action,value:literal};}
 else fail('invalid_request');
 const beforeAll=allowsAll(before),afterAll=allowsAll(after),addressChange=action!=='setDisplayHost';
 const effects={...EFFECTS,broadens:addressChange&&!beforeAll&&(afterAll||action==='addRule'||action==='addCurrent'),restricts:addressChange&&!afterAll&&(beforeAll||action==='removeRule'),beforeAllowsAll:beforeAll,afterAllowsAll:afterAll,mayBlockThisConnection:!allowsLoopback(after,version)};
 return {command,expected:after,before:project(before,saved.ids),after:project(after,ids),effects};
}
function acknowledged(command,data){
 if(!Q.plain(data)||!Q.text(data.message,2048))fail('invalid_response');
 if(command.action==='addRule'||command.action==='removeRule')rawRules(data.allowedIPs);
 else if(command.action==='setDisabled'){if(data.disabled!==command.value)fail('invalid_response');}
 else if(command.action==='setDisplayHost'){
  if(!Q.plain(data.serverAddresses)||data.serverAddresses.local!=='http://127.0.0.1:40653'||Object.keys(data.serverAddresses).some(k=>!['local','external'].includes(k))||(Object.hasOwn(data.serverAddresses,'external')&&!Q.text(data.serverAddresses.external,1024)))fail('invalid_response');
 }else fail('invalid_request');
}
function qceSecurityRequest(value,action='read'){
 const fields={read:[],preview:['observationId','action','value'],confirm:['ticketId'],dismiss:[],close:[]};if(!Object.hasOwn(fields,action))fail('invalid_request');Q.exact(value,['accountId','panelId',...fields[action]]);if(!Q.profileId(value.accountId)||!Q.uuid(value.panelId))fail('invalid_request');
 if(action==='preview'){
  if(!Q.uuid(value.observationId))fail('invalid_request');
  if(value.action==='addRule')rule(value.value);else if(value.action==='removeRule'){if(!Q.uuid(value.value))fail('invalid_request');}else if(value.action==='setDisabled'){if(typeof value.value!=='boolean')fail('invalid_request');}else if(value.action==='setDisplayHost')host(value.value);else if(value.action==='addCurrent'){if(value.value!==null)fail('invalid_request');}else fail('invalid_request');
 }if(action==='confirm'&&!Q.uuid(value.ticketId))fail('invalid_request');return value;
}
module.exports={...Q,QCESecurityError,fail,safeCode,CODES,LIMITS,SCOPE,EFFECTS,rule,host,rawRules,whitelist,status,authentication,combine,allowsAll,allowsLoopback,project,mutation,acknowledged,qceSecurityRequest};
