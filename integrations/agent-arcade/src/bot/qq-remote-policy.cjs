'use strict';
// Original fixed remote-management policy. No server config or credential logging.
const fs=require('node:fs');
const net=require('node:net');
const {createHash,X509Certificate,createPrivateKey,createPublicKey}=require('node:crypto');
const VERSION='4.18.42';
const OPERATIONS=Object.freeze(['network','rotateToken','enable2FA','disable2FA','replaceCertificate','removeCertificate','requestRestart']);
const NETWORK_KEYS=Object.freeze(['host','port','loginRate','disableWebUI','accessControlMode','ipWhitelist','ipBlacklist','enableXForwardedFor']);
const LIMITS=Object.freeze({tokenMin:6,tokenMax:1024,hostMax:253,ipRulesMax:64,ipRuleMax:128,loginRateMax:10000,certificateMaxBytes:65536,ticketMs:300000});
const CODES=new Set(['invalid_request','invalid_response','invalid_config','invalid_field','closed','operation_in_progress','cancelled','timeout','connection_failed','dns_failed','address_rejected','tls_untrusted','redirect_rejected','http_error','unauthorized','response_too_large','changed','expired_ticket','stale_ticket','stale_observation','baseline_changed','account_changed','account_unverified','unsupported_version','two_factor_required','request_rejected','no_changes','change_unknown','unavailable','certificate_invalid','certificate_unavailable','enrollment_unavailable','rotation_unresolved','remote_not_found','registration_changed','credentials_locked','encryption_unavailable','storage_write_unknown','operation_closed','invalid_rotation','invalid_token']);
for(const code of ['qr_url_unsupported','qr_unavailable','login_expired','observation_limit','observation_too_soon','quick_login_unavailable','login_state_changed'])CODES.add(code);
for(const code of ['passkey_unavailable','passkey_origin_unsupported','passkey_options_unsupported','passkey_response_invalid','passkey_expired','passkey_busy','passkey_cancelled'])CODES.add(code);
for(const code of ['files_unavailable','files_expired','files_limit','file_path_unsupported','file_name_unsupported','file_selection_invalid','file_baseline_changed','file_text_unsupported','file_text_too_large','file_transfer_too_large','file_upload_unavailable','file_download_unavailable','file_download_unknown','file_cleanup_unconfirmed','file_archive_invalid','file_rate_limited','file_upload_ambiguous'])CODES.add(code);
class QQRemoteError extends Error{constructor(code){code=CODES.has(code)?code:'unavailable';super(`Remote management failed (${code}).`);this.code=code;}}
const fail=code=>{throw new QQRemoteError(code);};
const safeCode=error=>new QQRemoteError(error?.code).code;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function keys(value,required,optional=[],code='invalid_request'){if(!plain(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))fail(code);}
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=(value,max=1024)=>typeof value==='string'&&value.length<=max&&!/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u.test(value);
function clone(value){return structuredClone(value);}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(plain(value))return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function token(value){if(!text(value,LIMITS.tokenMax)||value.length<LIMITS.tokenMin)fail('invalid_token');return value;}
function otp(value){if(typeof value!=='string'||!/^\d{6}$/.test(value))fail('invalid_field');return value;}
function qq(value){if(typeof value==='number'&&Number.isSafeInteger(value))value=String(value);if(typeof value!=='string'||!/^[1-9]\d{4,14}$/.test(value))fail('invalid_response');return value;}
function ipRule(value){
 if(!text(value,LIMITS.ipRuleMax)||!value||value.trim()!==value)fail('invalid_field');
 if(net.isIP(value))return value;
 if(value.includes('/')){const [ip,bits,...rest]=value.split('/'),family=net.isIP(ip);if(rest.length||!family||!/^\d{1,3}$/.test(bits)||String(Number(bits))!==bits||Number(bits)>(family===4?32:128))fail('invalid_field');return value;}
 const parts=value.split('.');if(parts.length!==4||!parts.includes('*')||parts.some(v=>v!=='*'&&(!/^(0|[1-9]\d{0,2})$/.test(v)||Number(v)>255)))fail('invalid_field');return value;
}
function networkField(key,value){
 if(key==='host'){if(!text(value,LIMITS.hostMax)||!value||value.trim()!==value||!net.isIP(value)&&! /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(value))fail('invalid_field');return value;}
 if(key==='port'||key==='loginRate'){if(!Number.isSafeInteger(value)||value<1||value>(key==='port'?65535:LIMITS.loginRateMax))fail('invalid_field');return value;}
 if(key==='disableWebUI'||key==='enableXForwardedFor'){if(typeof value!=='boolean')fail('invalid_field');return value;}
 if(key==='accessControlMode'){if(!['none','whitelist','blacklist'].includes(value))fail('invalid_field');return value;}
 if(key==='ipWhitelist'||key==='ipBlacklist'){if(!Array.isArray(value)||value.length>LIMITS.ipRulesMax||new Set(value).size!==value.length)fail('invalid_field');return value.map(ipRule);}
 fail('invalid_field');
}
function network(value){keys(value,NETWORK_KEYS,[],'invalid_response');try{return Object.fromEntries(NETWORK_KEYS.map(k=>[k,networkField(k,value[k])]));}catch{fail('invalid_response');}}
function networkPatch(value){keys(value,[],NETWORK_KEYS);if(!Object.keys(value).length)fail('no_changes');return Object.fromEntries(NETWORK_KEYS.filter(k=>Object.hasOwn(value,k)).map(k=>[k,networkField(k,value[k])]));}
function twoFactor(value){keys(value,['enable2FA','hasSecret'],[],'invalid_response');if(typeof value.enable2FA!=='boolean'||typeof value.hasSecret!=='boolean'||value.enable2FA&&!value.hasSecret)fail('invalid_response');return {enabled:value.enable2FA,hasSecret:value.hasSecret};}
function operationValue(operation,value){
 if(!OPERATIONS.includes(operation))fail('invalid_request');
 if(operation==='network'){keys(value,['patch']);return {patch:networkPatch(value.patch)};}
 if(operation==='rotateToken'){keys(value,['newToken']);const v=token(value.newToken);if(!/[A-Za-z]/.test(v)||!/[0-9]/.test(v))fail('invalid_token');return {newToken:v};}
 if(operation==='enable2FA'){keys(value,['enrollmentId','totpCode']);if(!uuid(value.enrollmentId))fail('invalid_request');return {enrollmentId:value.enrollmentId,totpCode:otp(value.totpCode)};}
 if(operation==='disable2FA'){keys(value,['totpCode']);return {totpCode:otp(value.totpCode)};}
 if(operation==='replaceCertificate'){keys(value,['certificateId']);if(!uuid(value.certificateId))fail('invalid_request');return {certificateId:value.certificateId};}
 keys(value,[]);return {};
}
function baseline(value){return {version:value.version,actualQQ:value.actualQQ,identity:value.identity,network:network(value.network),twoFactor:clone(value.twoFactor)};}
function capability(profile,pending){const reason=profile.version!==VERSION?'unsupported_version':profile.identity!=='matched'?'account_unverified':pending?'rotation_unresolved':null;return Object.fromEntries(OPERATIONS.map(op=>[op,{allowed:reason===null,reason}]));}
function previewValues(op,value,profile,details){
 if(op==='network'){const after={...clone(profile.network),...clone(value.patch)};if(digest(after)===digest(profile.network))fail('no_changes');return {before:clone(profile.network),after};}
 if(op==='rotateToken')return {before:{credential:'current'},after:{credential:'candidate',secretDisplayed:false}};
 if(op==='enable2FA'||op==='disable2FA'){const enabled=op==='enable2FA';if(profile.twoFactor.enabled===enabled)fail('no_changes');return {before:{enabled:profile.twoFactor.enabled},after:{enabled}};}
 if(op==='replaceCertificate')return {before:{certificate:'not_read'},after:{certificateSha256:details.sha256,spkiSha256:details.spkiSha256,validFrom:details.validFrom,validTo:details.validTo}};
 if(op==='removeCertificate')return {before:{certificate:'not_read'},after:{remove:true}};
 return {before:{restartRequested:false},after:{restartRequested:true}};
}
function readPEM(file){
 if(typeof file!=='string'||!require('node:path').isAbsolute(file))fail('certificate_invalid');
 let fd;try{const before=fs.lstatSync(file,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size>BigInt(LIMITS.certificateMaxBytes))fail('certificate_invalid');fd=fs.openSync(file,'r');const own=fs.fstatSync(fd,{bigint:true});if(own.dev!==before.dev||own.ino!==before.ino||own.size!==before.size)fail('certificate_invalid');const buffer=Buffer.alloc(Number(own.size)+1);let length=0;while(length<buffer.length){const n=fs.readSync(fd,buffer,length,buffer.length-length,null);if(!n)break;length+=n;}const after=fs.lstatSync(file,{bigint:true}),end=fs.fstatSync(fd,{bigint:true});if(length!==Number(own.size)||[after,end].some(s=>s.dev!==own.dev||s.ino!==own.ino||s.size!==own.size||s.mtimeNs!==own.mtimeNs||s.nlink!==1n))fail('certificate_invalid');const bytes=buffer.subarray(0,length);const value=bytes.toString('utf8');if(!Buffer.from(value).equals(bytes))fail('certificate_invalid');return value;}catch{fail('certificate_invalid');}finally{if(fd!==undefined)fs.closeSync(fd);}
}
function certificatePair(files,now=Date.now()){
 keys(files,['certPath','keyPath']);const cert=readPEM(files.certPath),key=readPEM(files.keyPath);if(Buffer.byteLength(JSON.stringify({cert,key}))>128*1024)fail('certificate_invalid');
 try{if(!/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(cert)||!/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(key))fail('certificate_invalid');const certificate=new X509Certificate(cert),privateKey=createPrivateKey(key);const publicBytes=createPublicKey(privateKey).export({type:'spki',format:'der'}),certificateBytes=certificate.publicKey.export({type:'spki',format:'der'});const from=Date.parse(certificate.validFrom),to=Date.parse(certificate.validTo);if(!publicBytes.equals(certificateBytes)||!Number.isFinite(from)||!Number.isFinite(to)||from>now||to<=now)fail('certificate_invalid');return {cert,key,sha256:createHash('sha256').update(certificate.raw).digest('hex'),spkiSha256:createHash('sha256').update(certificateBytes).digest('hex'),validFrom:new Date(from).toISOString(),validTo:new Date(to).toISOString()};}catch{fail('certificate_invalid');}
}
module.exports={VERSION,OPERATIONS,NETWORK_KEYS,LIMITS,QQRemoteError,fail,safeCode,plain,keys,uuid,hex,text,clone,digest,token,otp,qq,ipRule,network,networkPatch,twoFactor,operationValue,baseline,capability,previewValues,certificatePair};
