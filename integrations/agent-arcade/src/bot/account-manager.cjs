'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {atomicJSON,readJSON}=require('../core/files.cjs');
const {personaForBackend}=require('../core/personas.cjs');
const {BotService}=require('./service.cjs');
const {GroupPeerTurns}=require('./group-peer-turns.cjs');
const {groupMemberAlias}=require('./group-public-context.cjs');
const {QQGroupSpeakerDispatch}=require('./qq-group-speaker-dispatch.cjs');
const {groupCommandRecipient}=require('./commands.cjs');
const {drawingRoleNames}=require('./group-drawing-request.cjs');
const {validateQQUrl,validateQQOwner}=require('./qq.cjs');
const {validateXId}=require('./x-channel-policy.cjs');
const {validateId:validateMessengerId}=require('./messenger-channel-policy.cjs');

const MAX_ACCOUNTS=6, MAX_GROUP_COMMAND_ASSIGNMENTS=256;
const REMOVED_COMPANION_ECHO_MS=60000;
const groupDispatchError=code=>Object.assign(Error('QQ group reply dispatch ('+code+').'),{code});
function groupVoiceEvent(message){
  const {accountId,groupId,voice,from}=message;
  if(message.groupPeerTurn||voice?.kind!=='qq-group-voice'||voice.accountId!==accountId||
     voice.groupId!==groupId||voice.senderId!==from||message.id!=='group:'+groupId+':'+voice.id)return null;
  const source=voice.resourceDigest||voice.sourceDigest;
  if(typeof source!=='string'||!/^[a-f0-9]{64}$/.test(source)||
     typeof message.groupEventKey!=='string'||!/^[a-f0-9]{64}$/.test(message.groupEventKey))return null;
  const eventKey=createHash('sha256').update(JSON.stringify(['group-voice',from,message.groupEventKey,source])).digest('hex');
  return {kind:'voice',groupId,eventKey,createdAt:voice.createdAt,accountId,from};
}
function groupPhotoEvent(message){
  const {accountId,groupId,image,from}=message;
  if(message.groupPeerTurn||image?.kind!=='qq-group-image'||image.accountId!==accountId||
     image.groupId!==groupId||image.senderId!==from||message.id!=='group:'+groupId+':'+image.id||
     !/^[a-f0-9]{64}$/.test(message.groupEventKey)||!/^[a-f0-9]{64}$/.test(image.resourceDigest))return null;
  const eventKey=createHash('sha256').update(JSON.stringify([message.groupEventKey,image.resourceDigest])).digest('hex');
  return {kind:'photo',groupId,eventKey,createdAt:image.createdAt,accountId,from};
}
function label(value){if(typeof value!=='string'||!value.trim()||value.length>40||/[\x00-\x1f]/.test(value))throw Error('Give this companion a name of 1–40 characters.');return value.trim();}
function canonical(root){if(typeof root!=='string'||!path.isAbsolute(root)||!fs.statSync(root).isDirectory())throw Error('Choose an existing Agent Arcade data folder.');return fs.realpathSync(root);}
function qqContext(config){
  try{
    const ownerId=validateQQOwner(config.qqOwnerId),expectedAccountId=config.qqAccountId===undefined?'':validateQQOwner(config.qqAccountId);
    if(ownerId===expectedAccountId)return null;
    return {url:validateQQUrl(config.qqUrl),ownerId,expectedAccountId};
  }catch{return null;}
}
function readQQBinding(binding){
  if(binding===undefined)return undefined;
  try{
    if(!binding||typeof binding!=='object'||Array.isArray(binding)||typeof binding.accountId!=='string'||typeof binding.url!=='string'||!Number.isSafeInteger(binding.verifiedAt)||binding.verifiedAt<1)throw Error();
    const base={accountId:validateQQOwner(binding.accountId),url:validateQQUrl(binding.url),verifiedAt:binding.verifiedAt};
    // Versionless metadata predates owner/expected-account association. Retain
    // it on disk, but never infer that it belongs to today's configuration.
    if(binding.contextVersion===undefined&&binding.ownerId===undefined&&binding.expectedAccountId===undefined)return base;
    if(binding.contextVersion!==1||typeof binding.ownerId!=='string'||typeof binding.expectedAccountId!=='string')throw Error();
    const ownerId=validateQQOwner(binding.ownerId),expectedAccountId=binding.expectedAccountId===''?'':validateQQOwner(binding.expectedAccountId);
    if(ownerId===base.accountId||expectedAccountId&&expectedAccountId!==base.accountId)throw Error();
    return {...base,contextVersion:1,ownerId,expectedAccountId};
  }catch{throw Error('Companion registry contains an invalid QQ identity record.');}
}
function currentQQBinding(entry,config){
  const saved=entry.qqBinding;
  if(config?.channel!=='qq'||saved?.contextVersion!==1)return null;
  const context=qqContext(config);
  return context&&saved.url===context.url&&saved.ownerId===context.ownerId&&
    saved.expectedAccountId===context.expectedAccountId?saved:null;
}

// Each service retains its own vault, journal, conversation and cancellation.
// Import references an existing data folder; credentials are never exported.
class AccountManager {
  constructor({root,onChange=()=>{},serviceFactory=options=>new BotService(options),...serviceOptions}){
    fs.mkdirSync(root,{recursive:true});this.root=canonical(root);this.file=path.join(root,'companions.json');this.onChange=onChange;this.serviceFactory=serviceFactory;this.serviceOptions=serviceOptions;this.services=new Map();this.claims=new Map();this.groupPeerTurns=new GroupPeerTurns();this.credentialMigrations=new Set();
    this.groupCommandAssignments=new Map();
    this.removedGroupCompanions=new Map();
    this.selectionRevision=0;
    this.groupSpeakerTurns=new QQGroupSpeakerDispatch({file:path.join(this.root,'qq-group-speaker-dispatch.json'),now:serviceOptions.knowledgeNow});
    let stored=null;
    if(fs.existsSync(this.file)){try{if(fs.statSync(this.file).size>64000)throw Error();stored=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!stored||typeof stored!=='object')throw Error();}catch{throw Error('Companion registry is invalid. Your account data has not been changed.');}}
    if(stored){
      if(stored.version!==1)throw Error('Companion registry version is unsupported. Your account data has not been changed.');
      if(!Array.isArray(stored.accounts)||!stored.accounts.length||stored.accounts.length>MAX_ACCOUNTS)throw Error('Companion registry is invalid. Your account data has not been changed.');
      const ids=new Set(),roots=new Set();
      this.accounts=stored.accounts.map(item=>{
        if(!item||typeof item.id!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(item.id)||ids.has(item.id))throw Error('Companion registry contains an invalid identity.');
        if(item.managedVault!==undefined&&typeof item.managedVault!=='boolean')throw Error('Companion registry contains an invalid managed credential flag.');
        ids.add(item.id);const resolved=canonical(item.root),key=resolved.toLowerCase();if(roots.has(key))throw Error('A companion data folder is registered twice.');roots.add(key);
        const binding=readQQBinding(item.qqBinding);
        return {id:item.id,name:label(item.name),root:resolved,managedVault:item.managedVault===true,...(binding?{qqBinding:binding}:{})};
      });
      this.selectedId=ids.has(stored.selectedId)?stored.selectedId:this.accounts[0].id;
    }else{this.accounts=[{id:'primary',name:'我的搭档',root:this.root,managedVault:false}];this.selectedId='primary';}
    for(const entry of this.accounts)this.makeService(entry);
  }
  save(){atomicJSON(this.file,{version:1,selectedId:this.selectedId,accounts:this.accounts});}
  makeService(entry,{register=true}={}){
    const service=this.serviceFactory({...this.serviceOptions,root:entry.root,vaultFile:entry.managedVault?path.join(this.managedCredentialRoot(entry.id),'bot-vault.json'):undefined,onChange:()=>this.onChange(),claimIdentity:identity=>this.claim(entry.id,identity),
      groupPeerTurnFor:message=>this.groupPeerTurn(entry.id,message),groupCommandFor:message=>this.groupCommand(entry.id,message),
      groupSpeakerVote:(event,willing,signal,cancel)=>this.groupSpeakerVote(entry.id,event,willing,signal,cancel),
      groupAddressAdmission:message=>this.groupAddressAdmission(entry.id,message),
      uniqueGroupDrawing:(groupId,name,includeFixed)=>this.uniqueGroupDrawing(entry.id,groupId,name,includeFixed),
      groupSpeakerMetadata:(action,event,earlier)=>this.groupSpeakerMetadata(entry.id,action,event,earlier),
      groupVoiceClaim:message=>this.groupVoiceClaim(entry.id,message),
      groupPhotoSource:message=>this.groupPhotoSource(entry.id,message),
      groupMediaContinuation:(message,action)=>this.groupMediaContinuation(entry.id,message,action),
      beginGroupCommandReply:(accountId,groupId)=>this.beginGroupCommandReply(entry.id,accountId,groupId)});
    if(register)this.services.set(entry.id,service);return service;
  }
  managedCredentialRoot(id,{create=false}={}){
    if(!this.accounts.some(entry=>entry.id===id))throw Error('Companion was not found.');
    const parent=path.join(this.root,'credential-profiles'),target=path.join(parent,id);
    for(const dir of [parent,target]){
      if(fs.existsSync(dir)){const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Managed credential folders cannot be links or files.');}
      else if(create)fs.mkdirSync(dir,{mode:0o700});
    }
    return target;
  }
  captureCredentialMigration(id){
    const service=this.get(id),entry=this.accounts.find(item=>item.id===id);
    service.assertNotForgetting();
    if(this.credentialMigrations.has(id))throw Error('Credential migration is already in progress for this companion.');
    if(service.status!=='disconnected'||service.snapshot().credentialState!=='locked')throw Error('Only a disconnected companion with locked credentials can be migrated.');
    return {id,service,entry,generation:service.generation,config:JSON.stringify(service.config)};
  }
  assertCredentialMigration(ticket){
    if(!ticket||this.services.get(ticket.id)!==ticket.service||!this.accounts.includes(ticket.entry)||ticket.service.status!=='disconnected'||ticket.service.snapshot().credentialState!=='locked'||ticket.service.generation!==ticket.generation||JSON.stringify(ticket.service.config)!==ticket.config)throw Error('The companion changed while credentials were being migrated. Please review it and try again.');
    ticket.service.assertNotForgetting();
  }
  async migrateCredentials(ticket,migrate){
    this.assertCredentialMigration(ticket);const {id,service,entry}=ticket;
    if(this.credentialMigrations.has(id))throw Error('Credential migration is already in progress for this companion.');
    if(typeof migrate!=='function')throw Error('A credential migration operation is required.');
    const targetRoot=this.managedCredentialRoot(id,{create:true}),targetFile=path.join(targetRoot,'bot-vault.json');
    let recoveryFingerprint;
    if(fs.existsSync(targetFile)){
      try{
        const stat=fs.lstatSync(targetFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64000)throw Error();
        const bytes=fs.readFileSync(targetFile),saved=JSON.parse(bytes.toString('utf8'));
        if(!saved||typeof saved.data!=='string'||!saved.data||!/^[A-Za-z0-9+/]+={0,2}$/.test(saved.data))throw Error();
        recoveryFingerprint=createHash('sha256').update(bytes).digest('hex');
      }catch{throw Error('An existing credential copy could not be verified. It was not overwritten.');}
    }
    const previousManaged=entry.managedVault;let replacement,result,newFingerprint;
    this.credentialMigrations.add(id);this.onChange();
    try{
      result=await migrate({sourceRoot:entry.root,targetRoot,registeredRoots:this.accounts.map(item=>item.root),...(recoveryFingerprint?{recoverTargetSha256:recoveryFingerprint}:{})});
      if(result?.migrated!==true)throw Error('Credential migration was not completed.');
      if(!!recoveryFingerprint!==(result.recovered===true))throw Error('The existing credential copy has no verified recovery receipt.');
      if(typeof result.targetVaultSha256!=='string'||!/^[a-f0-9]{64}$/.test(result.targetVaultSha256))throw Error('The migrated credential copy has no verifiable receipt.');
      newFingerprint=result.targetVaultSha256;
      if(recoveryFingerprint&&newFingerprint!==recoveryFingerprint)throw Error('The existing credential copy changed during recovery.');
      if(fs.statSync(targetFile).size>64000||createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex')!==newFingerprint)throw Error('The migrated credential copy changed before it could be adopted.');
      this.assertCredentialMigration(ticket);
      replacement=this.makeService({...entry,managedVault:true},{register:false});
      if(replacement.status!=='disconnected'||replacement.snapshot().credentialState!=='ready')throw Error('The new credential copy could not be opened in this app profile.');
      await service.localStop?.();this.assertCredentialMigration(ticket);entry.managedVault=true;
      try{this.save();}catch(error){entry.managedVault=previousManaged;throw error;}
      this.services.set(id,replacement);try{service.journal?.close?.();}catch{/* The replacement and registry are already committed. */}return {migrated:true,...(recoveryFingerprint?{recovered:true}:{})};
    }catch(error){
      entry.managedVault=previousManaged;
      try{replacement?.journal?.close?.();}catch{/* Preserve the original migration failure. */}
      // Roll back only the exact newly created encrypted copy. The source
      // vault and every registered data folder remain untouched.
      if(!recoveryFingerprint&&newFingerprint&&fs.existsSync(targetFile)){
        try{if(createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex')===newFingerprint)fs.unlinkSync(targetFile);}catch{/* Preserve an uncertain copy rather than delete another writer's file. */}
      }
      throw error;
    }finally{this.credentialMigrations.delete(id);this.onChange();}
  }
  current(){return this.get(this.selectedId);}
  pauseGroupsForRemovedCard(cardId){
    for(const service of this.services.values())service.pauseGroupsForRemovedCard(cardId);
  }
  get(id){const service=this.services.get(id);if(!service)throw Error('Companion was not found.');return service;}
  configuredQQPorts(excludeId){
    const ports=new Set();
    for(const [id,service] of this.services){
      if(id===excludeId)continue;
      const {qqUrl,qqOwnerId,qqAccountId}=service.config;
      // Use stored configuration, never the default address in a blank snapshot.
      // A locked vault with an explicit binding might still own its port.
      const bound=qqOwnerId||qqAccountId;
      const configured=service.secret.qqToken&&(qqUrl||bound)||
        service.credentialState==='locked'&&qqUrl&&bound;
      if(!configured)continue;
      try{ports.add(Number(new URL(validateQQUrl(qqUrl)).port));}
      catch{/* An invalid saved address cannot identify a local port. */}
    }
    return ports;
  }
  claim(id,{channel,accountId}){
    const service=this.get(id),entry=this.accounts.find(item=>item.id===id);
    let context;
    if(channel==='qqofficial'){
      if(typeof accountId!=='string'||!/^\d{5,32}$/.test(accountId)||accountId!==service.config.qqOfficialAppId)throw Object.assign(Error('The official QQ application does not match this companion.'),{code:'account_mismatch'});
    }
    if(channel==='messenger'){
      accountId=validateMessengerId(accountId);
      if(accountId!==service.config.messengerPageId||accountId===service.config.messengerOwnerId)throw Object.assign(Error('The Messenger Page does not match this companion.'),{code:'page_changed'});
    }
    if(channel==='x'){
      accountId=validateXId(accountId);
      if(accountId!==service.config.xAccountId||accountId===service.config.xOwnerId)throw Object.assign(Error('The X account does not match this companion.'),{code:'account_mismatch'});
    }
    if(channel==='qq'){
      accountId=validateQQOwner(accountId);context=qqContext(service.config);
      if(!context)throw Error('The QQ owner and connection settings must be valid before claiming an account.');
      if(accountId===context.ownerId)throw Object.assign(Error('The companion cannot be its owner QQ account.'),{code:'owner_is_agent_account'});
      if(context.expectedAccountId&&accountId!==context.expectedAccountId)throw Object.assign(Error('The QQ account does not match this companion.'),{code:'account_mismatch'});
    }
    const key=`${channel}:${accountId}`;
    const owner=this.claims.get(key);if(owner&&owner.id!==id)throw Object.assign(Error('This social account is already connected by another companion.'),{code:'account_in_use'});
    // Retain the observed identity across restarts. This can withhold an
    // explicit @ from other roles, but cannot authorize a send or media read.
    if(channel==='qq'){
      const previous=entry.qqBinding;
      entry.qqBinding={accountId,...context,contextVersion:1,verifiedAt:Date.now()};
      try{this.save();}catch(error){if(previous)entry.qqBinding=previous;else delete entry.qqBinding;throw error;}
    }
    const lease={id,token:randomUUID()};this.claims.set(key,lease);
    return ()=>{if(this.claims.get(key)===lease)this.claims.delete(key);};
  }
  groupPeerTurn(profileId,message){
    const active=this.claims.get('qq:'+message.accountId);
    if(active?.id!==profileId)return;
    const {from:sender,groupId,createdAt}=message;
    const removed=this.removedGroupCompanions.get(sender),now=Date.now();
    if(this.verifiedGroupCompanion(sender,groupId)||
       removed&&now-removed.at<=REMOVED_COMPANION_ECHO_MS&&removed.groups.has(groupId)&&
       Number.isSafeInteger(createdAt)&&createdAt<=removed.at){
      return {localSender:true};
    }
    const local=this.claims.has('qq:'+sender)||this.accounts.some(entry=>
      currentQQBinding(entry,this.services.get(entry.id)?.config)?.accountId===sender);
    if(local)return {...this.groupPeerTurns.peerTurn(message,profileId),commandEcho:this.groupPeerTurns.commandEcho(message)};
    this.groupPeerTurns.observeHuman(message);
  }
  verifiedGroupCompanion(accountId,groupId){
    if(this.groupRouteForAccount(accountId)?.ownsOrdinaryGroup(accountId,groupId))return true;
    return this.accounts.some(entry=>{
      const service=this.services.get(entry.id);
      return currentQQBinding(entry,service?.config)?.accountId===accountId&&service.hasEnabledOrdinaryGroup(groupId);
    });
  }
  sharedReplyGroup(accountId,groupId){
    return this.accounts.some(entry=>{
      const service=this.services.get(entry.id);
      const binding=currentQQBinding(entry,service?.config);
      return binding&&binding.accountId!==accountId&&service.hasEnabledOrdinaryGroup(groupId);
    });
  }
  groupSpeakerOwner(groupId, setting){
    if(!setting.enabled)return null;
    const service=this.services.get(setting.profileId);
    try{
      const scorer=service?.qqGroupSpeakerScorer(setting.accountId,groupId);
      return scorer?{scorer,name:this.accounts.find(entry=>entry.id===setting.profileId)?.name||null}:null;
    }catch{return null;}
  }
  async groupSpeakerDispatch(profileId,{expectedAccountId:accountId,groupId,action,revision,endpoint,model,keySlot}={}){
    const valid=['view','configure','enable','disable'];
    if(typeof groupId!=='string'||!/^[1-9]\d{4,14}$/.test(groupId)||!valid.includes(action)){
      throw groupDispatchError('group_dispatch_invalid');
    }
    const service=this.get(profileId),scorer=service.qqGroupSpeakerScorer(accountId,groupId),policy=this.groupSpeakerTurns;
    const status=()=>{
      const row=policy.read(groupId), owner=this.groupSpeakerOwner(groupId,row);
      const editable=!owner||row.profileId===profileId&&row.accountId===accountId;
      const config=(owner?.scorer||scorer).status();
      const ownerName=owner?.name||(config.configured?this.accounts.find(entry=>entry.id===profileId)?.name:null);
      return {revision:row.revision,editable,ownerName:ownerName||null,enabled:!!owner,configured:config.configured,
        ready:config.ready,endpoint:config.endpoint,model:config.model,keySlot:config.keySlot,
        problem:config.keySlot!==null&&!config.keyPresent?'key_missing':null};
    };
    const before=status();
    if(action==='view')return before;
    if(before.revision!==revision)throw groupDispatchError('group_dispatch_changed');
    if(!before.editable)throw groupDispatchError('group_dispatch_read_only');
    const previous=policy.read(groupId);
    if(action==='configure'){
      if(before.enabled)throw groupDispatchError('group_dispatch_busy');
      try{scorer.configure({endpoint,model,keySlot});}catch{throw groupDispatchError('group_dispatch_configure_failed');}
      policy.save(groupId,previous,{profileId,accountId,enabled:false});
    }else{
      const enabling=action==='enable';
      if(enabling&&!before.ready)throw groupDispatchError('group_dispatch_not_ready');
      if(enabling!==before.enabled)policy.save(groupId,previous,{profileId,accountId,enabled:enabling});
    }
    this.onChange();
    return status();
  }
  groupSpeakerPolicy(profileId,{accountId,groupId}){
    if(this.claims.get('qq:'+accountId)?.id!==profileId)return null;
    try{return this.groupSpeakerOwner(groupId,this.groupSpeakerTurns.read(groupId));}
    catch{return null;}
  }
  groupSpeakerMetadata(profileId,action,event,earlier){
    if(this.claims.get('qq:'+event.accountId)?.id!==profileId)return;
    if(action==='quote-recall'){
      this.groupSpeakerTurns.forgetQuoteOwner(event);
    }else if(this.sharedReplyGroup(event.accountId,event.groupId)||this.groupSpeakerPolicy(profileId,event)){
      this.groupSpeakerTurns.observe(action,this.groupSpeakerAddress(event),earlier);
    }
  }
  groupSpeakerAddress(event){
    if(event.addressKind==='mention'||!event.reference)return event;
    // Only the companion's own retained OneBot receipt can nominate it.
    // Other bridges may use entirely different native message numbers.
    return {...event,targets:[event.accountId],addressKey:event.reference.eventKey,addressAt:event.reference.createdAt,addressKind:'quote'};
  }
  groupVoiceClaim(profileId,message){
    if(!this.groupSpeakerPolicy(profileId,message))return true;
    const {accountId,groupId}=message, targets=message.commandAddress?.targets, event=groupVoiceEvent(message);
    if(!event||!Array.isArray(targets))return false;
    const photo=!message.commandAddress.blocked&&this.groupSpeakerTurns.photoForVoice(event,targets,source=>
      this.groupTextRoute(source.accountId,groupId)?.photoFollowupState(groupId,event.from,source.eventKey));
    if(photo){
      // Reserve before consulting other readers. A permission missing on the
      // photo's named companion does not give the audio to another companion.
      this.groupSpeakerTurns.reserveMedia({...event,accountId:photo.accountId,photo});
      if(accountId!==photo.accountId||!this.groupVoiceRoute(accountId,groupId)||
         !this.groupSpeakerTurns.claimVoice(event))return false;
      return photo.attachable&&!photo.recalled?{photoKey:photo.eventKey}:true;
    }
    if(targets.length&&!targets.includes(accountId)){
      if(targets.length===1&&this.groupVoiceRoute(targets[0],groupId)){
        this.groupSpeakerTurns.reserveMedia({...event,accountId:targets[0]});
      }
      return false;
    }
    // Keep the existing local ASR error for a uniquely addressed companion.
    if(targets.length!==1&&!this.services.get(profileId)?.canAttemptFileAsr())return false;
    return this.groupSpeakerTurns.claimVoice(event);
  }
  groupTextRoute(accountId,groupId){
    const route=this.groupRouteForAccount(accountId);
    return route?.allowsOrdinaryGroupCommand(accountId,groupId)?route:null;
  }
  groupRouteForAccount(accountId){
    return this.services.get(this.claims.get('qq:'+accountId)?.id)?.groupRoute;
  }
  groupQuoteAccount(profileId,message){
    const {accountId,groupId}=message;
    const original=this.services.get(profileId)?.groupRoute?.retainedOrdinaryGroupQuote(message);
    if(!original)return null;
    if(original.kind==='character')return accountId;
    const authors=[...this.claims].filter(([identity,claim])=>{
      if(!identity.startsWith('qq:'))return false;
      const candidate=identity.slice(3);
      return candidate!==accountId&&this.services.get(claim.id)?.groupRoute?.ownsOrdinaryGroup(candidate,groupId)&&
        groupMemberAlias('qq-onebot',accountId,groupId,candidate)===original.speaker;
    });
    return authors.length===1?authors[0][0].slice(3):null;
  }
  uniqueGroupDrawing(profileId,groupId,name,includeFixed=true){
    for(const [id,service] of this.services){
      if(id===profileId||service.status!=='connected')continue;
      const route=service.groupRoute,accountId=service.config.qqAccountId;
      if(route?.platform!=='qq-onebot'||!route.allowsOrdinaryGroupCommand(accountId,groupId))continue;
      const binding={accountId,groupId,characterId:route.characterFor(groupId)};
      if(service.groupDrawing.has(binding,name)||includeFixed&&service.groupDrawing.fixedName(binding,name))return false;
    }
    return true;
  }
  groupAddressAdmission(profileId,message){
    const {accountId,groupId,commandAddress}=message;
    if(message.image?.replyId){
      if(commandAddress?.blocked!==false||!Array.isArray(commandAddress.targets)||commandAddress.targets.length>1)return null;
      const author=this.groupQuoteAccount(profileId,message),[target]=commandAddress.targets;
      if(!author||target&&target!==accountId&&!this.groupRouteForAccount(target)?.ownsOrdinaryGroup(target,groupId))return null;
      return (target||author)===accountId;
    }
    if(commandAddress?.blocked!==false||!Array.isArray(commandAddress.targets))return true;
    const targets=commandAddress.targets;
    const [target]=targets;
    if(targets.length>1||target===accountId)return true;
    if(!targets.length&&(!message.quote||message.image||message.voice))return true;
    if(target)return !this.verifiedGroupCompanion(target,groupId);
    if(this.groupSpeakerPolicy(profileId,message))return true;
    const author=this.groupQuoteAccount(profileId,message);
    return !author||author===accountId;
  }
  groupVoiceRoute(accountId,groupId){
    const route=this.groupTextRoute(accountId,groupId);
    return route?.configuration.voiceGroupIds?.includes(groupId)&&route.makeVoicePipeline?route:null;
  }
  groupPhotoSource(profileId,message){
    if(!this.groupSpeakerPolicy(profileId,message))return null;
    const event=groupPhotoEvent(message), address=message.commandAddress;
    if(!event||address?.blocked||address?.targets.length!==1)return null;
    const accountId=address.targets[0], route=this.groupTextRoute(accountId,event.groupId);
    const target=this.services.get(this.claims.get('qq:'+accountId)?.id);
    if(!route)return null;
    const attachable=!!route.configuration.imageGroupIds?.includes(event.groupId)&&!!target?.qqGroupImageCapability();
    const eventKey=this.groupSpeakerTurns.observePhoto({...event,accountId},event.accountId,message.id,attachable);
    return attachable&&event.accountId===accountId?eventKey:null;
  }
  groupMediaContinuation(profileId,message,action){
    if(!this.groupSpeakerPolicy(profileId,message))return true;
    if(action==='recall'){
      const event=groupVoiceEvent(message);
      if(event)this.groupSpeakerTurns.recallVoice(event);
      else this.groupSpeakerTurns.recallPhoto(message);
      return true;
    }
    const {groupId,from,accountId,createdAt,groupEventKey}=message,targets=message.commandAddress?.targets;
    if(!Array.isArray(targets))return true;
    const named=targets.length===1&&this.groupTextRoute(targets[0],groupId)?targets[0]:null;
    const assignment=this.groupSpeakerTurns.mediaFollowup({groupId,from,createdAt,eventKey:groupEventKey},source=>{
      if(source.kind==='photo')return this.groupTextRoute(source.accountId,groupId)?.photoFollowupState(groupId,from,source.eventKey);
      return this.groupVoiceRoute(source.accountId,groupId)?.hasPendingVoice(groupId,from);
    },named);
    if(!assignment)return true;
    const {source,accountId:recipient}=assignment;
    if(source.kind==='photo'){
      if(message.commandAddress.blocked||targets.length&&!named)return true;
      if(!recipient)return true;
      if(accountId!==recipient)return false;
      return recipient===source.accountId?{photoKey:source.eventKey}:true;
    }
    if(named&&accountId!==named)return false;
    const photo=source.photo,route=this.groupVoiceRoute(accountId,groupId);
    if(photo&&recipient===accountId&&!route?.hasPendingVoice(groupId,from)&&
       route?.photoFollowupState(groupId,from,photo.eventKey))return {photoKey:photo.eventKey};
    if(named)return true;
    // A new native @ can carry its own text turn without receiving the old
    // companion's audio or transcription, even while ASR is working.
    if(targets.length)return accountId!==source.accountId||targets.includes(source.accountId);
    return recipient&&this.groupTextRoute(recipient,groupId)?accountId===recipient:accountId!==source.accountId;
  }
  groupSpeakerVote(profileId,event,willing,signal,cancel){
    const {accountId,groupId}=event;
    const owner=this.groupSpeakerPolicy(profileId,event);
    if(!event.jointSticker&&!owner&&!this.sharedReplyGroup(accountId,groupId)&&!this.groupSpeakerTurns.hasTurn(event))return willing;
    const roster=[], local=new Set();
    for(const [key,{id}] of this.claims){
      if(!key.startsWith('qq:'))continue;
      const account=key.slice(3),service=this.services.get(id),route=service?.groupRoute;
      if(!route?.allowsOrdinaryGroupCommand(account,groupId))continue;
      local.add(account);
      if(event.photo&&(!route.configuration.imageGroupIds?.includes(groupId)||!service.qqGroupImageCapability()))continue;
      roster.push({id:account,name:route.publicRoles.get(groupId)?.name||route.persona.name});
    }
    if(event.jointSticker&&(event.targets.length!==2||!event.targets.includes(accountId)||
       !event.targets.every(target=>local.has(target))))return false;
    // Do not send a targeted photo to another role when the named local
    // companion has no picture permission or model support for this group.
    if(event.photo&&event.addressKind==='mention'&&event.targets.some(target=>local.has(target))&&
       !roster.some(role=>event.targets.includes(role.id)))return false;
    // Shared groups use the same one-winner ballot with or without an optional scorer.
    // A lone remaining role must still honor an existing peer ballot for this event.
    return this.groupSpeakerTurns.vote(this.groupSpeakerAddress(event),willing,signal,cancel,{roster,scorer:owner?.scorer});
  }
  beginGroupCommandReply(profileId,accountId,groupId){
    const route=this.services.get(profileId)?.groupRoute;
    if(this.claims.get('qq:'+accountId)?.id===profileId&&route?.allowsOrdinaryGroupCommand?.(accountId,groupId)){
      return this.groupPeerTurns.beginCommandReply(groupId,accountId);
    }
  }
  groupCommand(profileId,{accountId,groupId,groupEventKey,commandAddress,from,commandReceipt,drawingHintName}){
    if(this.claims.get('qq:'+accountId)?.id!==profileId)return null;
    const eligible=[],hintMatches=[];
    for(const [key,{id}] of this.claims){
      if(!key.startsWith('qq:'))continue;
      const account=key.slice(3);
      const route=this.services.get(id)?.groupRoute;
      if(!route?.allowsOrdinaryGroupCommand?.(account,groupId))continue;
      eligible.push(account);
      if(drawingHintName&&drawingRoleNames(route.publicRoles.get(groupId)?.name||route.persona.name,
        route.characterFor(groupId)).includes(drawingHintName))hintMatches.push(account);
    }
    if(!eligible.includes(accountId))return null;
    if(commandReceipt&&commandAddress?.blocked===false&&commandAddress.targets?.length===0){
      // A bridge-local ID can refer to an unrelated confirmation on
      // another QQ connection. Only the receiving route can resolve it.
      const ownsReceipt=this.services.get(profileId)?.groupRoute?.ownsCommandReceipt({
        accountId,groupId,senderId:from,receipt:commandReceipt,
      });
      // In a multi-role group another bridge may already be acting on its
      // own copy. An unresolved copy must not ask the member to repeat it.
      return ownsReceipt||eligible.length===1?'execute':null;
    }
    eligible.sort();
    // Keep the first audience decision for the same event through local
    // connect/disconnect races. The receiving route owns durable receipt dedup.
    const key=/^[a-f0-9]{64}$/.test(groupEventKey)?
      groupId+':'+groupEventKey+(drawingHintName?':drawing-hint':commandReceipt?':'+commandReceipt.kind+':'+commandReceipt.id:''):null;
    if(drawingHintName&&!key)return null;
    let assignment=key&&this.groupCommandAssignments.get(key);
    if(assignment===undefined||!key){
      // A typed name can choose a help reply only. It never becomes a QQ target.
      assignment=drawingHintName?(hintMatches.length===1?{accountId:hintMatches[0],action:'hint'}:null):
        groupCommandRecipient(commandAddress,eligible);
      if(key){
        this.groupCommandAssignments.set(key,assignment);
        if(this.groupCommandAssignments.size>MAX_GROUP_COMMAND_ASSIGNMENTS)this.groupCommandAssignments.delete(this.groupCommandAssignments.keys().next().value);
      }
    }
    return assignment?.accountId===accountId?assignment.action:null;
  }
  snapshot(){return {selectedId:this.selectedId,maxAccounts:MAX_ACCOUNTS,accounts:this.accounts.map(entry=>{
    const service=this.get(entry.id),state=typeof service.accountSnapshot==='function'?service.accountSnapshot():service.snapshot(),settings=state.social?.config;
    const backend=({native:'claude-native',claude:'claude-native',api:'claude-api',codex:'codex',deepseek:'deepseek',gpt:'gpt',gemini:'gemini',doubao:'doubao'})[state.mode]||'claude-api';
    const defaultCharacter=personaForBackend(backend).id;
    const characterId=settings?.enabled&&state.social.supported?settings.characterId||defaultCharacter:defaultCharacter;
    const context=qqContext(service.config),saved=currentQQBinding(entry,service.config);
    const binding=state.channel==='qq'&&saved?{accountId:saved.accountId,verifiedAt:saved.verifiedAt,source:'last_verified'}:null;
    const checked=state.qq?.check,lease=checked?.accountId&&this.claims.get(`qq:${checked.accountId}`);
    const accountId=state.channel==='qq'&&state.status==='connected'&&checked?.state==='checked'&&lease?.id===entry.id&&binding?.accountId===checked.accountId?checked.accountId:'';
    return {id:entry.id,name:entry.name,root:entry.root,mode:state.mode,channel:state.channel,status:state.status,credentialState:state.credentialState||'empty',credentialMigration:this.credentialMigrations.has(entry.id),problem:state.problem,characterId,companion:!!settings?.enabled,accountId,qqOwnerId:context?.ownerId||'',expectedQQAccountId:context?.expectedAccountId||'',qqBinding:binding,incomingCount:state.incomingCount,outgoingAccepted:state.outgoingAccepted,busy:!!state.social?.busy};
  })};}
  select(id){
    this.get(id);const previous=this.selectedId;this.selectedId=id;
    try{this.save();}catch(error){this.selectedId=previous;throw error;}
    if(id!==previous)this.selectionRevision++;
    this.onChange();return this.current();
  }
  rename(id,name){this.get(id);const item=this.accounts.find(item=>item.id===id),previous=item.name;item.name=label(name);try{this.save();}catch(error){item.name=previous;throw error;}this.onChange();}
  add({name,root}={}){
    if(this.accounts.length>=MAX_ACCOUNTS)throw Error(`At most ${MAX_ACCOUNTS} companions can be managed together.`);
    const id=randomUUID();const displayName=label(name);
    if(root){root=canonical(root);if(!fs.existsSync(path.join(root,'bot-config.json')))throw Error('This folder does not contain an Agent Arcade connection.');}
    else{root=path.join(this.root,'companions',id);fs.mkdirSync(root,{recursive:true});}
    if(this.accounts.some(item=>item.root.toLowerCase()===root.toLowerCase()))throw Error('This companion data folder is already registered.');
    const previous=this.selectedId,entry={id,name:displayName,root,managedVault:false};const service=this.makeService(entry);this.accounts.push(entry);this.selectedId=id;try{this.save();}catch(error){this.accounts.pop();this.selectedId=previous;this.services.delete(id);throw error;}
    this.selectionRevision++;this.onChange();return service;
  }
  remove(id){
    if(this.credentialMigrations.has(id))throw Error('Wait for this companion’s credential migration to finish.');
    const service=this.get(id);if(id==='primary'||this.accounts.length===1)throw Error('The primary companion cannot be removed.');
    if(service.status!=='disconnected')throw Error('Disconnect this companion before removing it from the list.');
    service.assertLocalStopped?.();
    const entry=this.accounts.find(item=>item.id===id),binding=currentQQBinding(entry,service.config);
    const groups=binding?new Set((service.config.qqGroups?.groupIds||[]).filter(groupId=>service.hasEnabledOrdinaryGroup(groupId))):null;
    const previous=this.accounts,selected=this.selectedId;this.accounts=this.accounts.filter(item=>item.id!==id);if(this.selectedId===id)this.selectedId=this.accounts[0].id;try{this.save();}catch(error){this.accounts=previous;this.selectedId=selected;throw error;}
    if(groups?.size){
      // Briefly recognize events already created by the verified sender on
      // that group's other bridge. New events from the removed account are ordinary input.
      this.removedGroupCompanions.delete(binding.accountId);
      this.removedGroupCompanions.set(binding.accountId,{groups,at:Date.now()});
      if(this.removedGroupCompanions.size>MAX_ACCOUNTS)this.removedGroupCompanions.delete(this.removedGroupCompanions.keys().next().value);
    }
    if(this.selectedId!==selected)this.selectionRevision++;
    this.services.delete(id);this.onChange();
    // Removing a registry entry deliberately keeps its files and encrypted key.
  }
  async connect(id,{assertCurrent}={}){
    if(assertCurrent!==undefined&&typeof assertCurrent!=='function')throw Object.assign(Error('Invalid connection guard.'),{code:'invalid_request'});
    if(this.credentialMigrations.has(id))throw Error('Wait for this companion’s credential migration to finish.');
    const service=this.get(id);for(const [otherId,other] of this.services){if(otherId!==id&&other.status!=='disconnected'&&service.config.channel==='qq'&&other.config.channel==='qq'&&validateQQUrl(other.config.qqUrl)===validateQQUrl(service.config.qqUrl))throw Error('This QQ bridge is already connected by another companion.');}
    const guard=assertCurrent?state=>{if(this.services.get(id)!==service||this.credentialMigrations.has(id))throw Object.assign(Error('The companion changed.'),{code:'changed'});return assertCurrent(state);}:undefined;
    await service.connect(guard?{assertCurrent:guard}:undefined);this.onChange();return service.snapshot();
  }
  async disconnect(id){await this.get(id).disconnect();this.onChange();}
  async close(){this.groupSpeakerTurns.close();await Promise.allSettled([...this.services.values()].map(service=>service.disconnect()));}
}
module.exports={AccountManager,MAX_ACCOUNTS};
