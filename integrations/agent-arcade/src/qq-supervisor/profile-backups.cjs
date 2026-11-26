'use strict';
const path=require('node:path'),{randomUUID}=require('node:crypto');
const P=require('./policy.cjs'),B=require('./profile-backups-policy.cjs'),{QQProfileBackups}=require('../bot/qq-profile-backups.cjs');
class SupervisorProfileBackups{
 constructor(config,{runtime,now=Date.now,monotonic=()=>performance.now(),helperFactory=o=>new QQProfileBackups(o)}={}){Object.assign(this,{config,runtime,now,monotonic,helperFactory,ticket:null,closed:false});}
 capability(){return B.capability({supported:true,enabled:this.config.profileBackups?.enabled===true,version:'4.18.42',scope:'fixed-instance-onebot-config',requiresStoppedRuntime:true,automaticStart:false,automaticStop:false,maxResponseBytes:B.MAX_RESPONSE_BYTES});}
 _check(o={}){if(this.closed)B.fail('closed');if(!this.capability().enabled)B.fail('profile_backups_disabled');if(o.signal?.aborted)B.fail('cancelled');o.assertCurrent?.();}
 _binding(){const m=this.runtime.manager;if(!m?.managed)B.fail('unsupported_installation');const context=m.componentSelection().shellOwnerContext();if(context.current.kind!=='prepared'||context.current.version!=='4.18.42')B.fail('unsupported_installation');const i=m.instance(this.config.expectedQQ);if(!i.available)B.fail(i.componentIssue||'missing_components');return P.hash(JSON.stringify({installation:this.config.installation,context,path:i.onebotConfigPath}));}
 _helper(o,binding=this._binding()){const check=()=>{this._check(o);if(this._binding()!==binding)B.fail('changed');};check();return this.helperFactory({profiles:{runtime:this.runtime.manager,backupRoot:path.join(this.config.stateDir,'profile-backups')},assertCurrent:check});}
 _cleanup(raw){const out=[];for(const [key,fallback]of [['configurationRecoveryIssue','configuration_cleanup_unverified'],['lockRecoveryIssue','component_lock_state_unverified']])if(raw?.[key]!==undefined)out.push(B.CLEANUP_CODES.includes(raw[key])?raw[key]:fallback);return out;}
 list(o={}){this._check(o);this.ticket=null;const binding=this._binding(),h=this._helper(o,binding),r=h.list(this.config.expectedQQ,{limit:100});this._check(o);if(this._binding()!==binding)B.fail('changed');return B.listing(r);}
 async preview(input,o={}){input=B.previewRequest(input);this._check(o);this.ticket=null;const binding=this._binding(),h=this._helper(o,binding),id=this.config.expectedQQ;
  const raw=await this.runtime.manager.withConfigurationLock(id,{},async install=>{await install.assertStopped();this._check(o);if(this._binding()!==binding)B.fail('changed');return input.action==='backup'?h.current(id):h.preview(id,input);});
  this._check(o);if(this._binding()!==binding)B.fail('changed');const issues=this._cleanup(raw);if(issues.length)B.fail(issues[0]);const currentSha256=input.action==='backup'?raw.sha256:raw.currentSha256,ticketId=randomUUID(),expectedDigest=P.hash(JSON.stringify({binding,input,currentSha256,ticketId})),expiresAt=this.now()+60000;
  this.ticket={...input,currentSha256,ticketId,expectedDigest,binding,deadline:this.monotonic()+60000};
  return B.preview({...input,currentSha256,ticketId,expectedDigest,expiresAt,size:raw.size,currentValid:input.action==='backup'?raw.valid:raw.changes.currentValid,unchanged:input.action==='backup'||raw.unchanged,changes:input.action==='backup'?null:raw.changes,requiresStoppedRuntime:true,automaticStart:false,automaticStop:false,companionCredentialsUpdated:false});
 }
 take(input,o={}){input=B.request(input);this._check(o);const t=this.ticket;this.ticket=null;if(!t||['action','backupId','sha256','currentSha256','ticketId','expectedDigest'].some(k=>input[k]!==t[k]))B.fail('stale_ticket');if(this.monotonic()>=t.deadline)B.fail('preview_expired');if(this._binding()!==t.binding)B.fail('changed');return t;}
 async confirm(input,t,o={}){this._check(o);const h=this._helper({...o,assertCurrent:()=>{this._check(o);if(this.monotonic()>=t.deadline)B.fail('preview_expired');}},t.binding),id=this.config.expectedQQ;
  const raw=t.action==='backup'?await h.create(id,{currentSha256:t.currentSha256}):await h.restore(id,t),cleanupIssues=this._cleanup(raw);
  // No post-write context assertion erases an exact byte readback. Cleanup is a separate fact.
  const backup=t.action==='backup'?(raw.valid?{id:raw.id,createdAt:raw.createdAt,sha256:raw.sha256,size:raw.size,valid:true}:{id:raw.id,createdAt:raw.createdAt,valid:false,issue:'backup_invalid'}):null;
  return B.result({action:t.action,receiptId:input.requestId,backup,restoredSha256:t.action==='restore'?raw.sha256:null,preservedBackupId:t.action==='restore'?raw.preservedBackupId:null,credentialsMayChange:t.action==='restore'?raw.credentialsMayChange:false,recheckBinding:t.action==='restore',cleanupVerified:cleanupIssues.length===0,cleanupIssues,automaticStart:false,automaticStop:false,companionCredentialsUpdated:false,onlineIdentityVerified:false});
 }
 discard(){this.ticket=null;return {discarded:true};}
 close(){this.closed=true;this.ticket=null;return {closed:true};}
}
module.exports={SupervisorProfileBackups};
