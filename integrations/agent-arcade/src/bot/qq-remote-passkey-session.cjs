'use strict';
// Original Passkey ceremonies use the same private remote owner, capture and registry lease.
const {randomUUID}=require('node:crypto');
const P=require('./qq-remote-policy.cjs'),K=require('./qq-remote-passkey-policy.cjs');
const base=s=>({remoteId:s.remoteId,panelId:s.panelId});
// Shared per process, including distinct registry entries and QQRemoteSession instances.
const origins=new Map();
const NATIVE_CODES=Object.freeze({webauthn_unavailable:'passkey_unavailable',webauthn_invalid_request:'passkey_unavailable',webauthn_options_unsupported:'passkey_options_unsupported',webauthn_abi_invalid:'passkey_unavailable',webauthn_cancelled:'passkey_cancelled',webauthn_timeout:'passkey_expired',webauthn_changed:'changed',webauthn_busy:'passkey_busy',webauthn_native_failed:'passkey_unavailable',webauthn_response_invalid:'passkey_response_invalid',webauthn_close_unconfirmed:'passkey_unavailable'});
function nativeFailure(error){P.fail(NATIVE_CODES[error?.code]||P.safeCode(error));}
function reserve(origin,id){if(origins.has(origin))P.fail('passkey_busy');origins.set(origin,id);return ()=>{if(origins.get(origin)===id)origins.delete(origin);};}
function receipt(s,id,kind){return {ceremonyId:id,operation:kind==='register'?'registerPasskey':'authenticatePasskey',submission:'not_submitted',bridgeResponse:'unavailable',outcome:'not_submitted',authenticated:false,observation:'unavailable',localCredentialMayExist:false,persistenceVerified:false,automaticRetry:false,pendingRotation:!!s.binding.entry.pendingRotation};}
function fixedReceipt(raw){
 if(!P.plain(raw)||!['attempted','not_submitted'].includes(raw.submission)||!['received','unavailable'].includes(raw.bridgeResponse)||!['acknowledged','unknown','not_submitted'].includes(raw.outcome)||typeof raw.authenticated!=='boolean'||raw.outcome==='acknowledged'&&(raw.submission!=='attempted'||raw.bridgeResponse!=='received')||raw.submission==='not_submitted'&&(raw.outcome!=='not_submitted'||raw.bridgeResponse!=='unavailable'||raw.authenticated)||raw.outcome==='not_submitted'&&raw.submission!=='not_submitted'||raw.authenticated&&raw.outcome!=='acknowledged')P.fail('invalid_response');return raw;
}
const METHODS={
 _passkeyBridge(){const b=this.passkeyBridge;if(!b||['availability','create','get'].some(k=>typeof b[k]!=='function')||typeof this.getPasskeyContext!=='function')P.fail('passkey_unavailable');return b;},
 async passkeyAvailability(input){
  K.request(input,'passkeyAvailability');const captured=this._capture(input);K.origin(captured.entry.origin);const b=this._passkeyBridge();
  let raw;try{raw=await b.availability({});}catch(error){nativeFailure(error);}if(P.digest(this._capture(input))!==P.digest(captured))P.fail('changed');return {...base(input),availability:K.availability(raw)};
 },
 passkeyPreview(input){
  K.request(input,'passkeyPreview');const s=this._get(input);s.passkeyTicket=null;s.ticket=null;
  if(s.observation.id!==input.observationId)P.fail('stale_observation');const cap=P.capability(s.observation.raw,!!s.binding.entry.pendingRotation).network;if(!cap.allowed)P.fail(cap.reason);
  this._passkeyBridge();const identity=K.origin(s.binding.entry.origin),ticketId=randomUUID(),deadline=this.monotonic()+P.LIMITS.ticketMs;
  const preview={ticketId,expectedDigest:P.digest({ticketId,binding:s.binding,observation:s.observation.digest,operation:'registerPasskey'}),operation:'registerPasskey',...identity,expectedQQ:s.binding.entry.expectedQQ,expiresAt:this.now()+P.LIMITS.ticketMs,effects:{webUIWide:true,mayCreateLocalCredential:true,mayWriteRemoteCredential:true,automaticRetry:false,revocationAvailable:false,persistenceVerified:false}};
  s.passkeyTicket={id:ticketId,digest:preview.expectedDigest,deadline,baseline:s.observation.digest,epoch:s.passkeyEpoch||0};this._assert(s);return {...base(s),preview};
 },
 async _passkeyCeremony(s,lease,kind,ticket){
  const bridge=this._passkeyBridge(),identity=K.origin(s.binding.entry.origin),ceremonyId=randomUUID(),change=receipt(s,ceremonyId,kind),release=reserve(identity.origin,ceremonyId);
  const epoch=s.passkeyEpoch||0,operation={id:ceremonyId,abort:new AbortController()};s.passkeyOperation=operation;
  let deadline=ticket?.deadline??this.monotonic()+P.LIMITS.ticketMs,attempted=false,invoked=false,publicKey=null,nativeResponse=null,timer;
  const signal=AbortSignal.any([s.abort.signal,operation.abort.signal]);
  const check=()=>{this._assert(s,lease);if(s.passkeyOperation!==operation||(s.passkeyEpoch||0)!==epoch||signal.aborted)P.fail('passkey_cancelled');if(this.monotonic()>=deadline)P.fail('passkey_expired');};
  try{
   check();if(ticket&&ticket.epoch!==epoch)P.fail('changed');
   if(ticket){await this._fresh(s,lease,check);check();if(s.observation?.digest!==ticket.baseline)P.fail('baseline_changed');}
   let rawAvailability;try{rawAvailability=await bridge.availability({signal});}catch(error){nativeFailure(error);}const available=K.availability(rawAvailability);check();if(!available.supported)P.fail('passkey_unavailable');
   if(['passkeyOptions','verifyPasskey'].some(k=>typeof s.client[k]!=='function'))P.fail('invalid_response');
   const raw=await s.client.passkeyOptions(kind,{signal,assertCurrent:check});check();publicKey=K.options(kind,raw,identity.origin);
   deadline=Math.min(deadline,this.monotonic()+publicKey.timeout);publicKey.timeout=Math.max(1,Math.floor(deadline-this.monotonic()));
   timer=setTimeout(()=>operation.abort.abort(),publicKey.timeout);timer.unref?.();check();
   const context=this.getPasskeyContext();if(context?.then){context.catch?.(()=>{});P.fail('passkey_unavailable');}const nativeContext=K.nativeContext(context);check();
   if(kind==='register')change.localCredentialMayExist=true;
   try{nativeResponse=await bridge[kind==='register'?'create':'get']({operationId:ceremonyId,...identity,...nativeContext,publicKey},{signal,assertCurrent:check});}catch(error){if(kind==='register'&&error?.nativeInvoked===false)change.localCredentialMayExist=false;nativeFailure(error);}check();
   nativeResponse=K.response(kind,nativeResponse,publicKey,identity.origin);
   if(ticket){await this._fresh(s,lease,check);check();if(s.observation?.digest!==ticket.baseline)P.fail('baseline_changed');}
   check();invoked=true;
   const rawReceipt=await s.client.verifyPasskey(kind,nativeResponse,{signal,assertCurrent:check,onAttempt:()=>{attempted=true;}}),result=fixedReceipt(rawReceipt);
   if(kind==='register'&&result.authenticated)P.fail('invalid_response');
   for(const k of ['submission','bridgeResponse','outcome','authenticated'])change[k]=result[k];if(result.code)change.code=P.safeCode(result);
   if(kind==='authenticate'&&change.authenticated){
    // Authentication acknowledgement survives a later read failure or owner retirement.
    try{check();const rawProfile=await s.client.read({signal,assertCurrent:check});check();const profile=this._profile(s,rawProfile);s.authMethod='passkey';change.observation=profile.identity;return {...base(s),change,profile};}
    catch(error){change.code=P.safeCode(error);if(this.session===s){s.observation=null;s.authMethod=null;s.client?.close();s.client=null;}}
   }
  }catch(error){
   if(invoked||attempted||error?.submitted===true)Object.assign(change,{submission:'attempted',outcome:'unknown',code:'change_unknown'});
   else change.code=P.safeCode(error);
  }finally{
   clearTimeout(timer);publicKey=null;nativeResponse=null;if(s.passkeyOperation===operation)s.passkeyOperation=null;operation.abort.abort();release();
   if(kind==='register')s.observation=null;
  }
  return {...base(s),change};
 },
 async passkeyConfirm(input){
  K.request(input,'passkeyConfirm');const s=this._get(input),ticket=s.passkeyTicket;
  if(!ticket||ticket.id!==input.ticketId||ticket.digest!==input.expectedDigest)P.fail('stale_ticket');s.passkeyTicket=null;s.ticket=null;
  return this._run(s,lease=>this._passkeyCeremony(s,lease,'register',ticket));
 },
 async passkeyAuthenticate(input){
  K.request(input,'passkeyAuthenticate');const binding=this._capture(input);K.origin(binding.entry.origin);this._passkeyBridge();if(this.session?.pending)P.fail('operation_in_progress');
  const retiring=this._retire(),s={...base(input),binding,abort:new AbortController(),client:null,pending:null,observation:null,ticket:null,passkeyTicket:null,passkeyEpoch:0,enrollment:null,certificate:null,resolution:null};this.session=s;
  const begin=(async()=>{await retiring;this._assert(s);return this._run(s,async lease=>{this._assert(s,lease);this._makeClient(s,s.binding.entry);return this._passkeyCeremony(s,lease,'authenticate');});})();
  s.pending=begin;try{return await begin;}catch(error){if(this.session===s)void this._retire();throw error;}finally{if(s.pending===begin)s.pending=null;}
 },
 passkeyDismiss(input){K.request(input,'passkeyDismiss');const s=this.session;if(s?.remoteId===input.remoteId&&s?.panelId===input.panelId){s.passkeyEpoch=(s.passkeyEpoch||0)+1;s.passkeyTicket=null;s.passkeyOperation?.abort.abort();}return {...base(input),dismissed:true};}
};
module.exports={METHODS};
