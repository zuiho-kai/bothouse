'use strict';
// Original bounded WebAuthn JSON policy. No browser-origin override or raw renderer data.
const {isIP}=require('node:net');
const {createHash}=require('node:crypto');
const P=require('./qq-remote-policy.cjs');
const LIMITS=Object.freeze({optionsBytes:65536,responseBytes:98304,credentialBytes:1024,credentials:64,ceremonyMs:120000});
const TRANSPORTS=Object.freeze(['usb','nfc','ble','internal','hybrid','cable','smart-card']);
function request(input,action){
 const extra={passkeyAvailability:[],passkeyPreview:['observationId'],passkeyConfirm:['ticketId','expectedDigest'],passkeyAuthenticate:[],passkeyDismiss:[]};
 if(!Object.hasOwn(extra,action))P.fail('invalid_request');P.keys(input,['remoteId','panelId',...extra[action]]);
 if(!P.uuid(input.remoteId)||!P.uuid(input.panelId)||action==='passkeyPreview'&&!P.uuid(input.observationId)||action==='passkeyConfirm'&&(!P.uuid(input.ticketId)||!P.hex(input.expectedDigest)))P.fail('invalid_request');return input;
}
function origin(value){
 let url;try{url=new URL(value);}catch{P.fail('passkey_origin_unsupported');}
 if(url.origin!==value||url.protocol!=='https:'||url.username||url.password||url.hash||url.search||url.pathname!=='/'||isIP(url.hostname)||url.hostname.startsWith('[')||url.hostname.length>253||!url.hostname.includes('.')||url.hostname.split('.').some(s=>!s||s.length>63||! /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s)))P.fail('passkey_origin_unsupported');
 return {origin:value,rpId:url.hostname};
}
function binary(value,min,max,code='passkey_options_unsupported'){
 if(typeof value!=='string'||value.length>Math.ceil(max*4/3)||! /^[A-Za-z0-9_-]+$/.test(value))P.fail(code);
 const bytes=Buffer.from(value,'base64url');if(bytes.length<min||bytes.length>max||bytes.toString('base64url')!==value)P.fail(code);return bytes;
}
function bounded(value,max,code){let json;try{json=JSON.stringify(value);}catch{P.fail(code);}if(typeof json!=='string'||Buffer.byteLength(json)>max)P.fail(code);}
function list(value){
 if(!Array.isArray(value)||value.length>LIMITS.credentials)P.fail('passkey_options_unsupported');const ids=new Set();
 return value.map(row=>{P.keys(row,['id','type'],['transports'],'passkey_options_unsupported');binary(row.id,1,LIMITS.credentialBytes);if(row.type!=='public-key'||ids.has(row.id))P.fail('passkey_options_unsupported');ids.add(row.id);if(row.transports!==undefined&&(!Array.isArray(row.transports)||row.transports.length>TRANSPORTS.length||new Set(row.transports).size!==row.transports.length||row.transports.some(t=>!TRANSPORTS.includes(t))))P.fail('passkey_options_unsupported');return P.clone(row);});
}
function options(kind,raw,capturedOrigin){
 bounded(raw,LIMITS.optionsBytes,'passkey_options_unsupported');const {rpId}=origin(capturedOrigin),code='passkey_options_unsupported';
 if(!['register','authenticate'].includes(kind))P.fail('invalid_request');
 P.keys(raw,kind==='register'?['challenge','rp','user','pubKeyCredParams','timeout','attestation','excludeCredentials','authenticatorSelection']:['rpId','challenge','allowCredentials','timeout','userVerification'],kind==='register'?['extensions','hints']:['extensions'],code);
 binary(raw.challenge,16,128);if(!Number.isSafeInteger(raw.timeout)||raw.timeout<1||raw.timeout>300000)P.fail(code);
 const timeout=Math.min(raw.timeout,LIMITS.ceremonyMs);let result;
 if(kind==='register'){
  P.keys(raw.rp,['id','name'],[],code);P.keys(raw.user,['id','name','displayName'],[],code);
  if(raw.rp.id!==rpId||raw.rp.name!=='NapCat WebUI'||raw.user.id!==Buffer.from('napcat-user').toString('base64url')||raw.user.name!=='NapCat User'||raw.user.displayName!==''||raw.attestation!=='none')P.fail(code);
  P.keys(raw.authenticatorSelection,['userVerification'],[],code);if(raw.authenticatorSelection.userVerification!=='preferred')P.fail(code);
  if(!Array.isArray(raw.pubKeyCredParams)||!raw.pubKeyCredParams.length||raw.pubKeyCredParams.length>8)P.fail(code);
  const algorithms=new Set();for(const row of raw.pubKeyCredParams){P.keys(row,['type','alg'],[],code);if(row.type!=='public-key'||![-8,-7,-257].includes(row.alg)||algorithms.has(row.alg))P.fail(code);algorithms.add(row.alg);}
  const pubKeyCredParams=raw.pubKeyCredParams.filter(row=>[-7,-257].includes(row.alg));if(!pubKeyCredParams.length)P.fail(code);
  if(raw.extensions!==undefined){P.keys(raw.extensions,['credProps'],[],code);if(raw.extensions.credProps!==true)P.fail(code);}
  if(raw.hints!==undefined&&(!Array.isArray(raw.hints)||raw.hints.length))P.fail(code);
  result={...P.clone(raw),pubKeyCredParams:P.clone(pubKeyCredParams),excludeCredentials:list(raw.excludeCredentials),timeout};
 }else{
  if(raw.rpId!==rpId||raw.userVerification!=='preferred')P.fail(code);if(raw.extensions!==undefined)P.keys(raw.extensions,[],[],code);
  const allowCredentials=list(raw.allowCredentials);if(!allowCredentials.length)P.fail(code);result={...P.clone(raw),allowCredentials,timeout};
 }
 return result;
}
function response(kind,value,publicKey,capturedOrigin){
 const code='passkey_response_invalid';bounded(value,LIMITS.responseBytes,code);P.keys(value,['id','rawId','type','response','clientExtensionResults'],['authenticatorAttachment'],code);
 binary(value.id,1,LIMITS.credentialBytes,code);if(value.id!==value.rawId||value.type!=='public-key'||value.authenticatorAttachment!==undefined&&!['platform','cross-platform'].includes(value.authenticatorAttachment))P.fail(code);
 P.keys(value.clientExtensionResults,[],['credProps'],code);if(value.clientExtensionResults.credProps!==undefined){P.keys(value.clientExtensionResults.credProps,['rk'],[],code);if(typeof value.clientExtensionResults.credProps.rk!=='boolean')P.fail(code);}
 const out=value.response;P.keys(out,kind==='register'?['clientDataJSON','attestationObject']:['clientDataJSON','authenticatorData','signature'],kind==='register'?['transports']:['userHandle'],code);
 const clientBytes=binary(out.clientDataJSON,1,8192,code);let client;try{client=JSON.parse(clientBytes.toString('utf8'));}catch{P.fail(code);}
 if(!Buffer.from(clientBytes.toString('utf8')).equals(clientBytes))P.fail(code);P.keys(client,['type','challenge','origin'],['crossOrigin'],code);
 if(client.type!==(kind==='register'?'webauthn.create':'webauthn.get')||client.challenge!==publicKey.challenge||client.origin!==capturedOrigin||client.crossOrigin!==undefined&&client.crossOrigin!==false)P.fail(code);
 if(kind==='register'){
  binary(out.attestationObject,1,65536,code);if(publicKey.excludeCredentials.some(c=>c.id===value.id))P.fail(code);
  if(out.transports!==undefined&&(!Array.isArray(out.transports)||out.transports.length>TRANSPORTS.length||new Set(out.transports).size!==out.transports.length||out.transports.some(t=>!TRANSPORTS.includes(t))))P.fail(code);
 }else{
  if(!publicKey.allowCredentials.some(c=>c.id===value.id))P.fail(code);
  const auth=binary(out.authenticatorData,37,16384,code),expectedHash=createHash('sha256').update(origin(capturedOrigin).rpId).digest();if(!auth.subarray(0,32).equals(expectedHash)||(auth[32]&1)!==1)P.fail(code);
  binary(out.signature,1,16384,code);if(out.userHandle!==undefined&&out.userHandle!==null&&out.userHandle!==Buffer.from('napcat-user').toString('base64url'))P.fail(code);
 }
 return P.clone(value);
}
function nativeContext(raw){P.keys(raw,['parentHwnd','ownerPid'],[],'passkey_unavailable');if(typeof raw.parentHwnd!=='string'||! /^0x[0-9a-fA-F]{1,16}$/.test(raw.parentHwnd)||BigInt(raw.parentHwnd)===0n||!Number.isSafeInteger(raw.ownerPid)||raw.ownerPid<1)P.fail('passkey_unavailable');return P.clone(raw);}
function availability(raw){P.keys(raw,['protocol','supported','apiVersion','platformAuthenticatorAvailable','abiVerified'],[],'passkey_unavailable');if(raw.protocol!==1||!Number.isSafeInteger(raw.apiVersion)||raw.apiVersion<0||['supported','platformAuthenticatorAvailable','abiVerified'].some(k=>typeof raw[k]!=='boolean')||raw.supported&&(!raw.abiVerified||raw.apiVersion<1))P.fail('passkey_unavailable');return {supported:raw.supported,reason:raw.supported?null:'passkey_unavailable',platform:'windows',apiVersion:raw.apiVersion,platformAuthenticatorAvailable:raw.platformAuthenticatorAvailable,registrationScope:'remote-webui'};}
module.exports={LIMITS,request,origin,binary,options,response,nativeContext,availability};
