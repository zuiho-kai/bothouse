'use strict';
// Login substate uses the existing remote session's capture, lease and retirement.
const {randomUUID}=require('node:crypto');
const P=require('./qq-remote-policy.cjs'),L=require('./qq-remote-login-policy.cjs');
const base=s=>({remoteId:s.remoteId,panelId:s.panelId});
const loginBase=s=>({...base(s),loginId:s.loginId});
const METHODS={
 _loginCheck(s,lease){this._assert(s,lease);if(this.monotonic()>=s.loginDeadline)P.fail('login_expired');},
 _loginGet(input){const s=this._get(input,{ready:false});if(s.kind!=='login'||s.loginId!==input.loginId||!s.loginReady)P.fail('changed');this._loginCheck(s);return s;},
 async _loginRead(s,lease,{count=true,throttle=false,check}={}){
  this._loginCheck(s,lease);check?.();
  if(count){if(s.observationCount>=L.LIMITS.observations)P.fail('observation_limit');if(throttle&&this.monotonic()<s.nextObservationAt)P.fail('observation_too_soon');s.observationCount++;s.nextObservationAt=this.monotonic()+L.LIMITS.pollMs;}
  const raw=await s.client.readLogin({signal:s.abort.signal,assertCurrent:()=>{this._loginCheck(s,lease);check?.();}});
  this._loginCheck(s,lease);check?.();L.snapshot(raw);
  return raw;
 },
 _loginProfile(s,raw){
  this._loginCheck(s);L.snapshot(raw);const observationId=randomUUID();s.loginObservation={id:observationId,raw:P.clone(raw),digest:L.baseline(raw)};
  if(s.qr&&(s.qr.url!==raw.qrURL||!raw.canShowQRCode||this.monotonic()>=s.qr.deadline))s.qr=null;
  const out={loginId:s.loginId,observationId,expectedQQ:s.binding.entry.expectedQQ,credentialChoice:s.credentialChoice,pendingRotation:!!s.binding.entry.pendingRotation,expiresAt:s.loginExpiresAt,observationsRemaining:Math.max(0,L.LIMITS.observations-s.observationCount),pollAfterMs:L.LIMITS.pollMs,qrId:s.qr?.id||null,source:'remote-webui-observation'};
  for(const k of ['version','state','phase','actualQQ','onlineVerified','coreReady','qrLoginAccepted','hasLoginError','quickLoginAvailable','canShowQRCode','canRefreshQR','canQuickLogin'])out[k]=raw[k];
  return out;
 },
 async loginOpen(input){
  L.request(input,'loginOpen');const binding=this._capture(input);
  if(!binding.entry.pendingRotation&&input.choice!==undefined)P.fail('invalid_request');
  if(this.session?.pending)P.fail('operation_in_progress');
  // Explicit same-owner handoff only. Never close the client after transferring ownership.
  const previous=this.session,reusable=input.choice===undefined&&input.totpCode===undefined&&previous?.kind!=='login'&&previous?.authMethod==='passkey'&&previous?.client&&previous?.observation?.raw.version===P.VERSION&&P.digest(previous.binding)===P.digest(binding);
  const handedClient=reusable?previous.client:null;if(handedClient){this._assert(previous);previous.client=null;}
  const retiring=this._retire(),s={...base(input),binding,kind:'login',loginId:randomUUID(),loginDeadline:this.monotonic()+L.LIMITS.lifetimeMs,loginExpiresAt:this.now()+L.LIMITS.lifetimeMs,observationCount:0,nextObservationAt:0,credentialChoice:handedClient?'passkey':binding.entry.pendingRotation?input.choice:'active',authMethod:handedClient?'passkey':null,abort:new AbortController(),client:handedClient,pending:null,observation:null,loginObservation:null,loginReady:false,loginDraftEpoch:0,ticket:null,qr:null};
  this.session=s;
  const begin=(async()=>{await retiring;this._loginCheck(s);return this._run(s,async lease=>{
   const entry=P.clone(s.binding.entry);
   if(entry.pendingRotation&&!handedClient){if(!input.choice)return {...base(s),challenge:{type:'credential_recovery',choices:['current','candidate']}};entry.token=input.choice==='current'?entry.pendingRotation.oldToken:entry.pendingRotation.candidateToken;}
   this._loginCheck(s,lease);const client=handedClient||this._makeClient(s,entry);
   if(['readLogin','readLoginQRCode','mutateLogin'].some(k=>typeof client[k]!=='function'))P.fail('invalid_response');
   const auth=handedClient?{authenticated:true}:await client.authenticate({totpCode:input.totpCode,signal:s.abort.signal,assertCurrent:()=>this._loginCheck(s,lease)});
   this._loginCheck(s,lease);if(auth?.challenge==='totp')return {...base(s),challenge:{type:'totp'}};if(auth?.authenticated!==true)P.fail('invalid_response');
   s.loginReady=true;const raw=await this._loginRead(s,lease);return {...base(s),login:this._loginProfile(s,raw)};
  });})();
  s.pending=begin;try{return await begin;}catch(error){if(this.session===s)void this._retire();throw error;}finally{if(s.pending===begin)s.pending=null;}
 },
 async loginObserve(input){
  L.request(input,'loginObserve');const s=this._loginGet(input);s.ticket=null;
  return this._run(s,async lease=>{const raw=await this._loginRead(s,lease,{throttle:true});return {...base(s),login:this._loginProfile(s,raw)};});
 },
 async loginQRCode(input){
  L.request(input,'loginQRCode');const s=this._loginGet(input);s.ticket=null;s.qr=null;const epoch=s.loginDraftEpoch;
  if(typeof this.qrEncoder!=='function')P.fail('qr_unavailable');
  return this._run(s,async lease=>{
   const check=()=>{this._loginCheck(s,lease);if(s.loginDraftEpoch!==epoch)P.fail('changed');};
   const first=await this._loginRead(s,lease,{throttle:true,check});check();if(!first.canShowQRCode)P.fail('qr_unavailable');
   const url=L.qrURL(await s.client.readLoginQRCode({signal:s.abort.signal,assertCurrent:check}));check();
   const last=await this._loginRead(s,lease,{count:false,check});check();
   if(!last.canShowQRCode||url!==first.qrURL||url!==last.qrURL)P.fail('login_state_changed');
   const pngDataUrl=L.png(await this.qrEncoder(url));check();
   const id=randomUUID(),deadline=Math.min(s.loginDeadline,this.monotonic()+L.LIMITS.displayMs),displayUntil=this.now()+Math.floor(deadline-this.monotonic());
   s.qr={id,url,deadline};return {...base(s),login:this._loginProfile(s,last),qr:{loginId:s.loginId,qrId:id,pngDataUrl,displayUntil,serverExpiryKnown:false}};
  });
 },
 async loginPreview(input){
  L.request(input,'loginPreview');const s=this._loginGet(input);s.ticket=null;s.qr=null;const epoch=s.loginDraftEpoch;
  const observation=s.loginObservation;if(!observation||observation.id!==input.observationId)P.fail('stale_observation');
  return this._run(s,async lease=>{
   const check=()=>{this._loginCheck(s,lease);if(s.loginDraftEpoch!==epoch)P.fail('changed');};
   const raw=await this._loginRead(s,lease,{check});check();if(L.baseline(raw)!==observation.digest)P.fail('baseline_changed');L.requireEffect(raw,input.operation);
   const ticketId=randomUUID(),deadline=Math.min(s.loginDeadline,this.monotonic()+P.LIMITS.ticketMs),before={state:raw.state,phase:raw.phase,quickLoginAvailable:raw.quickLoginAvailable},after={request:input.operation==='refreshQR'?'refresh_qr':'quick_login',expectedQQ:s.binding.entry.expectedQQ};
   const expectedDigest=P.digest({loginId:s.loginId,ticketId,operation:input.operation,before,after,baseline:observation.digest});
   s.ticket={id:ticketId,expectedDigest,operation:input.operation,deadline,baseline:observation.digest,epoch};
   return {...base(s),preview:{loginId:s.loginId,ticketId,expectedDigest,operation:input.operation,expectedQQ:s.binding.entry.expectedQQ,expiresAt:this.now()+Math.floor(deadline-this.monotonic()),before,after,effects:{mayReplaceQRCode:true,mayReconnectLoginService:input.operation==='refreshQR',automaticRetry:false,doesNotSetAutoLogin:true,doesNotChangeExpectedQQ:true,doesNotStartLocalProcess:true}}};
  });
 },
 async loginConfirm(input){
  L.request(input,'loginConfirm');const s=this._loginGet(input),ticket=s.ticket;
  if(!ticket||ticket.id!==input.ticketId||ticket.expectedDigest!==input.expectedDigest)P.fail('stale_ticket');
  s.ticket=null;s.qr=null;
  return this._run(s,async lease=>{
   const change={loginId:s.loginId,ticketId:ticket.id,operation:ticket.operation,expectedQQ:s.binding.entry.expectedQQ,submission:'not_submitted',bridgeResponse:'unavailable',outcome:'not_submitted',restarting:false,automaticRetry:false,loginVerified:false};
   let invoked=false,attempted=false;
   const check=()=>{this._loginCheck(s,lease);if(s.loginDraftEpoch!==ticket.epoch)P.fail('changed');if(this.monotonic()>=ticket.deadline)P.fail('expired_ticket');};
   try{
    check();const raw=await this._loginRead(s,lease,{check});check();if(L.baseline(raw)!==ticket.baseline)P.fail('baseline_changed');L.requireEffect(raw,ticket.operation);
    invoked=true;const result=await s.client.mutateLogin(ticket.operation,{signal:s.abort.signal,assertCurrent:check,onAttempt:()=>{attempted=true;}});
    if(!P.plain(result)||!['attempted','not_submitted'].includes(result.submission)||!['received','unavailable'].includes(result.bridgeResponse)||!['acknowledged','unknown','not_submitted'].includes(result.outcome)||typeof result.restarting!=='boolean'||result.outcome==='acknowledged'&&(result.submission!=='attempted'||result.bridgeResponse!=='received')||result.outcome==='not_submitted'&&result.submission!=='not_submitted'||result.submission==='not_submitted'&&(result.outcome!=='not_submitted'||result.bridgeResponse!=='unavailable'))P.fail('invalid_response');
    for(const k of ['submission','bridgeResponse','outcome','restarting'])change[k]=result[k];
    if(result.code)change.code=P.safeCode(result);
   }catch(error){
    attempted=attempted||invoked||error?.submitted===true;
    if(attempted)Object.assign(change,{submission:'attempted',outcome:'unknown',code:'change_unknown'});
    else change.code=P.safeCode(error);
   }finally{s.loginObservation=null;}
   return {...base(s),change};
  });
 },
 loginDismiss(input){L.request(input,'loginDismiss');const s=this.session;if(s?.kind==='login'&&s.remoteId===input.remoteId&&s.panelId===input.panelId&&s.loginId===input.loginId){s.loginDraftEpoch++;s.ticket=null;s.qr=null;}return {...loginBase(input),dismissed:true};},
 loginClose(input){L.request(input,'loginClose');const s=this.session;if(s?.kind==='login'&&s.remoteId===input.remoteId&&s.panelId===input.panelId&&s.loginId===input.loginId)return this._retire().then(()=>({...loginBase(input),closed:true}));const old=this.retiringSession;return (old?.kind==='login'&&old.remoteId===input.remoteId&&old.panelId===input.panelId&&old.loginId===input.loginId?this.retiring:Promise.resolve()).then(()=>({...loginBase(input),closed:true}));}
};
module.exports={METHODS};

