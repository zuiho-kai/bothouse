'use strict';
const {randomUUID}=require('node:crypto');
const {QQRemoteClient}=require('./qq-remote-client.cjs');
const P=require('./qq-remote-policy.cjs');
const base=value=>({remoteId:value.remoteId,panelId:value.panelId});
const owns=(s,input)=>s?.remoteId===input.remoteId&&s?.panelId===input.panelId;
function remoteRequest(input,action='read'){
 if(action.startsWith('files'))return require('./qq-remote-files-policy.cjs').request(input,action);
 if(action.startsWith('passkey'))return require('./qq-remote-passkey-policy.cjs').request(input,action);
 if(action.startsWith('login'))return require('./qq-remote-login-policy.cjs').request(input,action);
 const extra={read:['totpCode'],preview:['observationId','operation','value'],confirm:['ticketId','expectedDigest'],dismiss:[],close:[],generate2FA:[],pickCertificate:[],resolveCredential:['choice','totpCode'],finishCredentialRecovery:['resolutionId']};
 if(!Object.hasOwn(extra,action))P.fail('invalid_request');const optional=action==='read'||action==='resolveCredential'?['totpCode']:[];P.keys(input,['remoteId','panelId',...extra[action].filter(k=>!optional.includes(k))],optional);
 if(!P.uuid(input.remoteId)||!P.uuid(input.panelId))P.fail('invalid_request');if(input.totpCode!==undefined)P.otp(input.totpCode);
 if(action==='preview'){if(!P.uuid(input.observationId))P.fail('invalid_request');P.operationValue(input.operation,input.value);}
 if(action==='confirm'&&(!P.uuid(input.ticketId)||!P.hex(input.expectedDigest)))P.fail('invalid_request');
 if(action==='resolveCredential'&&!['current','candidate'].includes(input.choice)||action==='finishCredentialRecovery'&&!P.uuid(input.resolutionId))P.fail('invalid_request');return input;
}
function captured(raw,input){
 if(!P.plain(raw)||raw.remoteId!==input.remoteId||raw.panelId!==input.panelId||!P.text(raw.contextKey,2048)||!raw.contextKey)P.fail('changed');
 const e=raw.entry;if(!P.plain(e)||e.remoteId!==input.remoteId||!P.uuid(e.revision)||!P.uuid(e.trustRevision)||!P.uuid(e.credentialRevision)||!P.text(e.label,64)||!P.text(e.origin,2048)||!P.plain(e.trust)||e.version!==P.VERSION)P.fail('changed');P.qq(e.expectedQQ);P.token(e.token);
 return {remoteId:raw.remoteId,panelId:raw.panelId,contextKey:raw.contextKey,entry:P.clone(e)};
}
function changeBase(operation){return {operation,submission:'not_submitted',bridgeResponse:'unavailable',outcome:'rejected',observation:{state:'unavailable'},persistenceVerified:false,automaticRetry:false,automaticRestart:false,recoveryRequired:false};}
class QQRemoteSession{
 constructor({registry,capture,clientFactory=entry=>new QQRemoteClient(entry),pickCertificateFiles,pickUploadFiles,pickDownloadFile,fileStageFactory,qrEncoder,passkeyBridge,getPasskeyContext,now=Date.now,monotonic=()=>performance.now()}={}){if(!registry||typeof registry.withOperation!=='function'||typeof capture!=='function'||typeof clientFactory!=='function')P.fail('invalid_config');Object.assign(this,{registry,capture,clientFactory,pickCertificateFiles,pickUploadFiles,pickDownloadFile,fileStageFactory,qrEncoder,passkeyBridge,getPasskeyContext,now,monotonic});this.session=null;this.retiringSession=null;this.retiring=Promise.resolve();this.closed=false;}
 get remoteId(){return this.session?.remoteId||null;}
 _capture(input){if(this.closed)P.fail('closed');const raw=this.capture(base(input));if(raw?.then){raw.catch?.(()=>{});P.fail('invalid_config');}return captured(raw,input);}
 _assert(s,lease){if(this.closed||this.session!==s||s.abort.signal.aborted)P.fail('changed');lease?.assertCurrent();if(P.digest(this._capture(s))!==P.digest(s.binding))P.fail('changed');}
 _adopt(s,lease){const next=lease.capture(),current=this._capture(s);if(current.contextKey!==s.binding.contextKey||P.digest(current.entry)!==P.digest(next)||['remoteId','origin','expectedQQ','trustRevision','associatedProfileId'].some(k=>next[k]!==s.binding.entry[k]))P.fail('changed');s.binding=current;this._assert(s,lease);}
 _get(input,{ready=true}={}){const s=this.session;if(!owns(s,input))P.fail('changed');if(s.pending)P.fail('operation_in_progress');this._assert(s);if(s.kind==='files')P.fail('files_unavailable');if(ready&&(s.kind==='login'||!s.client||!s.observation))P.fail('stale_observation');return s;}
 _makeClient(s,entry){this._assert(s);const client=this.clientFactory(entry);s.client=client;if(!client||['authenticate','read','mutate','generate2FA','close'].some(k=>typeof client[k]!=='function'))P.fail('invalid_response');this._assert(s);return client;}
 _profile(s,raw){
  if(!P.plain(raw)||!P.text(raw.version,64)||!raw.version||!['matched','logged_out'].includes(raw.identity)||raw.identity==='matched'&&P.qq(raw.actualQQ)!==s.binding.entry.expectedQQ||raw.identity==='logged_out'&&raw.actualQQ!==null)P.fail('invalid_response');
  P.keys(raw.twoFactor,['enabled','hasSecret'],[],'invalid_response');if(typeof raw.twoFactor.enabled!=='boolean'||typeof raw.twoFactor.hasSecret!=='boolean'||raw.twoFactor.enabled&&!raw.twoFactor.hasSecret)P.fail('invalid_response');
  const e=s.binding.entry,clean={version:raw.version,actualQQ:raw.actualQQ,identity:raw.identity,network:P.network(raw.network),twoFactor:P.clone(raw.twoFactor)},observationId=randomUUID();s.observation={id:observationId,raw:clean,digest:P.digest(P.baseline(clean))};
  return {observationId,label:e.label,origin:e.origin,expectedQQ:e.expectedQQ,...P.clone(clean),trust:{privateCA:!!e.trust.caPem,pinned:!!e.trust.spkiSha256},pendingRotation:!!e.pendingRotation,capabilities:P.capability(clean,!!e.pendingRotation),limits:P.clone(P.LIMITS),source:'remote-webui-observation',fetchedAt:new Date(this.now()).toISOString(),persistenceVerified:false};
 }
 _run(s,fn){const operation=this.registry.withOperation({remoteId:s.remoteId,revision:s.binding.entry.revision},async lease=>{this._assert(s,lease);return fn(lease);});s.pending=operation;return operation.finally(()=>{if(s.pending===operation)s.pending=null;});}
 async verifyTransferScope(input,{signal,assertCurrent}={}){
  // Internal handoff only: reuse an already authenticated management client,
  // including its original 2FA/Passkey session. No helper receives WebUI secrets.
  P.keys(input,['remoteId','panelId','remoteRevision']);
  if(!P.uuid(input.remoteId)||!P.uuid(input.panelId)||!P.uuid(input.remoteRevision)||typeof assertCurrent!=='function')P.fail('invalid_request');
  const s=this._get(input);if(s.binding.entry.revision!==input.remoteRevision)P.fail('registration_changed');
  if(s.binding.entry.pendingRotation)P.fail('rotation_unresolved');
  const check=lease=>{this._assert(s,lease);if(signal?.aborted)P.fail('cancelled');const result=assertCurrent();if(result?.then){result.catch?.(()=>{});P.fail('invalid_config');}};
  return this._run(s,async lease=>{
   check(lease);if(typeof s.client.fileIdentity!=='function')P.fail('invalid_response');
   const proof=await s.client.fileIdentity({signal:signal?AbortSignal.any([signal,s.abort.signal]):s.abort.signal,assertCurrent:()=>check(lease)});
   check(lease);if(proof?.version!==P.VERSION||proof.identity!=='matched'||proof.actualQQ!==s.binding.entry.expectedQQ)P.fail('account_unverified');
   return {verified:true};
  });
 }
 async _fresh(s,lease,check){const raw=await s.client.read({signal:s.abort.signal,assertCurrent:()=>{this._assert(s,lease);check?.();}});this._assert(s,lease);check?.();if(P.digest(P.baseline(raw))!==s.observation?.digest)P.fail('baseline_changed');return raw;}
 async read(input){
  remoteRequest(input);const binding=this._capture(input);if(this.session?.pending)P.fail('operation_in_progress');const retiring=this._retire();const s={...base(input),binding,abort:new AbortController(),client:null,pending:null,observation:null,ticket:null,enrollment:null,certificate:null,resolution:null};this.session=s;
  const begin=(async()=>{await retiring;this._assert(s);return this._run(s,async lease=>{if(s.binding.entry.pendingRotation)return {...base(s),challenge:{type:'credential_recovery',choices:['current','candidate']}};const client=this._makeClient(s,s.binding.entry);const auth=await client.authenticate({totpCode:input.totpCode,signal:s.abort.signal,assertCurrent:()=>this._assert(s,lease)});this._assert(s,lease);if(auth?.challenge==='totp')return {...base(s),challenge:{type:'totp'}};if(auth?.authenticated!==true)P.fail('invalid_response');const raw=await client.read({signal:s.abort.signal,assertCurrent:()=>this._assert(s,lease)});this._assert(s,lease);return {...base(s),profile:this._profile(s,raw)};});})();
  // Reserve even while the previous panel is retiring; no late client creation.
  s.pending=begin;try{return await begin;}catch(error){if(this.session===s)void this._retire();throw error;}finally{if(s.pending===begin)s.pending=null;}
 }
 preview(input){
  remoteRequest(input,'preview');const s=this._get(input);s.ticket=null;if(s.observation.id!==input.observationId)P.fail('stale_observation');const value=P.operationValue(input.operation,input.value),cap=P.capability(s.observation.raw,!!s.binding.entry.pendingRotation)[input.operation];if(!cap.allowed)P.fail(cap.reason);
  let privateValue=P.clone(value),details,deadline=this.monotonic()+P.LIMITS.ticketMs;
  if(input.operation==='rotateToken'&&value.newToken===s.binding.entry.token)P.fail('no_changes');
  if(input.operation==='enable2FA'){details=s.enrollment;if(!details||details.id!==value.enrollmentId)P.fail('enrollment_unavailable');deadline=Math.min(deadline,details.deadline);privateValue={secret:details.secret,totpCode:value.totpCode};}
  if(input.operation==='replaceCertificate'){details=s.certificate;if(!details||details.id!==value.certificateId)P.fail('certificate_unavailable');deadline=Math.min(deadline,details.deadline);privateValue={cert:details.cert,key:details.key};}
  if(this.monotonic()>=deadline)P.fail('expired_ticket');const values=P.previewValues(input.operation,value,s.observation.raw,details),ticketId=randomUUID(),expectedDigest=P.digest({ticketId,observationId:s.observation.id,operation:input.operation,...values});
  s.ticket={id:ticketId,expectedDigest,operation:input.operation,value:privateValue,deadline,observationId:s.observation.id,...values};this._assert(s);
  return {...base(s),preview:{ticketId,expectedDigest,observationId:s.observation.id,operation:input.operation,...values,expiresAt:this.now()+Math.max(1,Math.floor(deadline-this.monotonic())),automaticRetry:false,automaticRestart:false,persistenceVerified:false}};
 }
 async confirm(input){
  remoteRequest(input,'confirm');const s=this._get(input),ticket=s.ticket;if(!ticket||ticket.id!==input.ticketId||ticket.expectedDigest!==input.expectedDigest)P.fail('stale_ticket');s.ticket=null;
  return this._run(s,async lease=>{const change=changeBase(ticket.operation);let prepared=false,attempted=false,invoked=false;const check=()=>{this._assert(s,lease);if(this.monotonic()>=ticket.deadline)P.fail('expired_ticket');};try{check();await this._fresh(s,lease,check);check();
    if(ticket.operation==='rotateToken'){lease.prepareRotation(ticket.value.newToken);prepared=true;this._adopt(s,lease);check();}
    invoked=true;const raw=await s.client.mutate(ticket.operation,ticket.value,{signal:s.abort.signal,assertCurrent:check,onAttempt:()=>{attempted=true;}});
    if(!P.plain(raw)||!['not_submitted','submitted','unknown'].includes(raw.submission)||!['received','unavailable'].includes(raw.bridgeResponse)||!['acknowledged','rejected','unknown'].includes(raw.outcome)||raw.outcome==='acknowledged'&&(raw.submission!=='submitted'||raw.bridgeResponse!=='received'))P.fail('invalid_response');
    Object.assign(change,{submission:raw.submission,bridgeResponse:raw.bridgeResponse,outcome:raw.outcome});if(raw.code)change.code=P.safeCode(raw);change.recoveryRequired=prepared||raw.outcome==='unknown';
    if(prepared){try{lease.recordRotation(raw.outcome);if(this.session===s&&!s.abort.signal.aborted)this._adopt(s,lease);}catch(error){change.code=P.safeCode(error);change.recoveryRequired=true;}}
    if(raw.outcome==='acknowledged'&&['network','enable2FA','disable2FA'].includes(ticket.operation)){try{this._assert(s,lease);const observed=await s.client.read({signal:s.abort.signal,assertCurrent:()=>this._assert(s,lease)});this._assert(s,lease);change.observation.state=ticket.operation==='network'?(P.digest(P.network(observed.network))===P.digest(ticket.after)?'match':'different'):(observed.twoFactor.enabled===ticket.after.enabled?'match':'different');}catch{}}
   }catch(error){attempted=attempted||invoked||error?.submitted===true;change.code=attempted?'change_unknown':P.safeCode(error);change.recoveryRequired=prepared||attempted;if(attempted)Object.assign(change,{submission:'unknown',bridgeResponse:'unavailable',outcome:'unknown'});if(prepared)try{lease.recordRotation(attempted?'unknown':'rejected');if(this.session===s&&!s.abort.signal.aborted)this._adopt(s,lease);}catch{change.code='storage_write_unknown';}}
   finally{s.observation=null;s.enrollment=null;s.certificate=null;ticket.value=null;}
   return {...base(s),change};
  });
 }
 async generate2FA(input){remoteRequest(input,'generate2FA');const s=this._get(input);s.ticket=null;s.enrollment=null;const cap=P.capability(s.observation.raw,!!s.binding.entry.pendingRotation).enable2FA;if(!cap.allowed)P.fail(cap.reason);if(s.observation.raw.twoFactor.enabled)P.fail('no_changes');return this._run(s,async lease=>{await this._fresh(s,lease);const raw=await s.client.generate2FA({signal:s.abort.signal,assertCurrent:()=>this._assert(s,lease)});this._assert(s,lease);if(typeof raw.secret!=='string'||!/^[A-Z2-7]{16,128}$/.test(raw.secret)||typeof raw.otpauthUri!=='string'||raw.otpauthUri.length>1024)P.fail('invalid_response');const id=randomUUID(),expiresAt=this.now()+P.LIMITS.ticketMs;s.enrollment={id,secret:raw.secret,deadline:this.monotonic()+P.LIMITS.ticketMs};return {...base(s),enrollment:{enrollmentId:id,secret:raw.secret,otpauthUri:raw.otpauthUri,expiresAt}};});}
 async pickCertificate(input){remoteRequest(input,'pickCertificate');const s=this._get(input);s.ticket=null;s.certificate=null;if(typeof this.pickCertificateFiles!=='function')P.fail('certificate_unavailable');return this._run(s,async lease=>{const files=await this.pickCertificateFiles({signal:s.abort.signal,assertCurrent:()=>this._assert(s,lease)});this._assert(s,lease);if(files===null)return {...base(s),cancelled:true};const pair=P.certificatePair(files,this.now());this._assert(s,lease);const id=randomUUID(),expiresAt=this.now()+P.LIMITS.ticketMs;s.certificate={...pair,id,deadline:this.monotonic()+P.LIMITS.ticketMs};return {...base(s),certificate:{certificateId:id,sha256:pair.sha256,spkiSha256:pair.spkiSha256,validFrom:pair.validFrom,validTo:pair.validTo,expiresAt}};});}
 async resolveCredential(input){
  remoteRequest(input,'resolveCredential');if(this.session?.kind==='login'){const old=this._get(input,{ready:false});if(!old.binding.entry.pendingRotation)P.fail('invalid_rotation');await this.read(base(input));}const s=this._get(input,{ready:false});if(!s.binding.entry.pendingRotation)P.fail('invalid_rotation');s.ticket=null;s.resolution=null;s.authMethod=null;s.client?.close();s.client=null;
  return this._run(s,async lease=>{const pending=lease.capture().pendingRotation,entry={...lease.capture(),token:input.choice==='current'?pending.oldToken:pending.candidateToken};const client=this._makeClient(s,entry),auth=await client.authenticate({totpCode:input.totpCode,signal:s.abort.signal,assertCurrent:()=>this._assert(s,lease)});this._assert(s,lease);if(auth?.challenge==='totp')return {...base(s),challenge:{type:'totp'}};if(auth?.authenticated!==true)P.fail('invalid_response');const raw=await client.read({signal:s.abort.signal,assertCurrent:()=>this._assert(s,lease)});this._assert(s,lease);if(raw.identity!=='matched'||raw.actualQQ!==entry.expectedQQ||raw.version!==P.VERSION)P.fail('account_unverified');lease.selectCredential(input.choice);this._adopt(s,lease);const profile=this._profile(s,raw),resolutionId=randomUUID(),expiresAt=this.now()+P.LIMITS.ticketMs;s.resolution={id:resolutionId,choice:input.choice,revision:s.binding.entry.revision,deadline:this.monotonic()+P.LIMITS.ticketMs};return {...base(s),resolved:true,choice:input.choice,profile,credentialResolution:{resolutionId,choice:input.choice,expiresAt}};});
 }
 async finishCredentialRecovery(input){remoteRequest(input,'finishCredentialRecovery');const s=this._get(input,{ready:false}),resolution=s.resolution;s.resolution=null;if(!resolution||resolution.id!==input.resolutionId)P.fail('stale_ticket');return this._run(s,async lease=>{this._assert(s,lease);if(this.monotonic()>=resolution.deadline)P.fail('expired_ticket');const e=lease.capture();if(e.revision!==resolution.revision||e.pendingRotation?.selected!==resolution.choice)P.fail('changed');lease.clearRotation();this._adopt(s,lease);s.observation=null;return {...base(s),finished:true};});}
 dismiss(input){remoteRequest(input,'dismiss');if(owns(this.session,input)){this.session.ticket=null;this.session.enrollment=null;this.session.certificate=null;this.session.resolution=null;}return {...base(input),dismissed:true};}
 _retire(){const s=this.session;this.session=null;if(!s&&!this.fileStages?.size)return this.retiring;if(s){s.ticket=null;s.passkeyTicket=null;s.passkeyOperation?.abort.abort();s.observation=null;s.enrollment=null;s.certificate=null;s.resolution=null;s.loginObservation=null;s.qr=null;s.loginReady=false;s.fileView?.job?.abort.abort();s.abort.abort();try{s.client?.close();}catch{}this.retiringSession=s;}const owner=this.retiringSession,retiring=Promise.allSettled([this.retiring,s?.pending]).then(async()=>{await this._closeFileStages();return {closed:true};}).finally(()=>{if(this.retiringSession===owner&&!this.fileStages?.size)this.retiringSession=null;});retiring.catch(()=>{});this.retiring=retiring;return retiring;}
 closeOwned(input){remoteRequest(input,'close');if(!owns(this.session,input))return (owns(this.retiringSession,input)?this.fileStages?.size?this._retire():this.retiring:Promise.resolve()).then(()=>({...base(input),closed:true}));return this._retire().then(()=>({...base(input),closed:true}));}
 closeCurrent(){return this._retire();}
 observe(){if(this.session)try{this._assert(this.session);}catch{void this._retire();}}
 close(){
  this.closed=true;if(this.permanentClose)return this.permanentClose;
  const retired=this._retire();
  const operation=(async()=>{await retired;if(!this.passkeyBridgeClosed&&typeof this.passkeyBridge?.close==='function'){const result=await this.passkeyBridge.close();if(!P.plain(result)||result.closed!==true)P.fail('passkey_unavailable');this.passkeyBridgeClosed=true;}return {closed:true};})();
  // Keep the owned helper reference after any failed exit proof so a later quit may retry.
  const tracked=operation.finally(()=>{if(this.permanentClose===tracked)this.permanentClose=null;});this.permanentClose=tracked;return tracked;
 }
}
Object.assign(QQRemoteSession.prototype,require('./qq-remote-login-session.cjs').METHODS);
Object.assign(QQRemoteSession.prototype,require('./qq-remote-passkey-session.cjs').METHODS);
Object.assign(QQRemoteSession.prototype,require('./qq-remote-files-session.cjs').METHODS);
async function remoteResult(input,operation){try{const raw=await operation();if(!P.plain(raw)||raw.remoteId!==input.remoteId||raw.panelId!==input.panelId)P.fail('invalid_response');const result={ok:true,...base(input)};for(const key of ['profile','challenge','preview','change','enrollment','certificate','cancelled','dismissed','closed','resolved','choice','credentialResolution','finished','login','qr','loginId','availability','files','document','upload','download','fileViewId','operationId','cancelRequested'])if(Object.hasOwn(raw,key))result[key]=P.clone(raw[key]);return result;}catch(error){return {ok:false,...(P.uuid(input?.remoteId)?{remoteId:input.remoteId}:{}),...(P.uuid(input?.panelId)?{panelId:input.panelId}:{}),code:P.safeCode(error)};}}
module.exports={QQRemoteSession,remoteResult,remoteRequest,captured};
