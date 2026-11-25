'use strict';

const {randomUUID,createHash}=require('node:crypto');
const {GroupDrawingStore}=require('./qq-group-drawing.cjs');
const {OPENAI,validImageProvider,defaultImageModel,imageProviders}=require('./image-providers.cjs');
const {readSelected,validateImagePayload}=require('./qq-media.cjs');
const {groupDrawingNotice}=require('./group-drawing-route.cjs');
const {groupNamedStickers,selectedGroupMedia}=require('./qq-group-outgoing-policy.cjs');
const {getGroupNamedSticker,stickerAsset}=require('./qq-group-card-images.cjs');
const {publicCatalog}=require('../core/personas.cjs');

const builtIns=new Set(publicCatalog().map(role=>role.id));
const supportedRole=id=>builtIns.has(id)||/^card-[0-9a-f]{16}$/.test(id);
const fail=()=>Object.assign(Error('Review the current group and drawing permission.'),{code:'group_drawing_changed'});
const refused=code=>({outcome:'not_sent',code});
const referenceFailed=()=>Object.assign(Error('The selected group card portrait could not be used.'),{code:'image_reference_rejected'});
const key=name=>name.normalize('NFC').trim().toLowerCase();
const PROVIDER_RESULT_WINDOW_MS=10*60_000;
const providerStatusNotices=new Map([
  ['image_quota_exceeded','上次绘图时，云服务提示额度已用完。额度恢复后可以再试。'],
  ['image_auth','上次绘图时，云服务拒绝了当前凭据，需要主人检查连接。'],
  ['image_forbidden','上次绘图时，云服务提示当前凭据没有绘图权限。'],
]);

class QQGroupDrawing {
  constructor(service,prepare,unique){
    this.service=service;
    this.store=new GroupDrawingStore({root:service.root});
    this.prepare=prepare;
    this.unique=unique;
    this.editors=new Map();
    this.pending=new Map();
    this.providerResults=new Map();
    this.activity=0;
  }
  settings(input,write=false,profileSelection=0){
    const {expectedAccountId,groupId,roleId}=input,service=this.service;
    const fields=['expectedAccountId','groupId','roleId',...(write?['revision','enabled','dailyLimit','provider','useReference']:[])];
    if(!expectedAccountId||Object.keys(input).some(k=>!fields.includes(k))||!supportedRole(roleId)||service.config.qqGroups?.enabled!==true)throw fail();
    const accountId=service.groupMediaSettingsScope(input),scope={accountId,groupId,roleId};
    const policy=this.store.view(scope),roleVersion=service.groupRoleRevision(groupId);
    let editor=this.editors.get(groupId);
    if(!editor||editor.accountId!==accountId||editor.roleId!==roleId||editor.roleVersion!==roleVersion||
       editor.policy!==policy.revision||editor.generation!==service.generation||editor.profileSelection!==profileSelection){
      editor={accountId,roleId,roleVersion,policy:policy.revision,generation:service.generation,profileSelection,token:randomUUID()};
      this.editors.set(groupId,editor);
    }
    let hasReference=false;
    try{hasReference=!!this.referenceSource(roleId);}catch{/* Invalid card sources cannot be attached. */}
    if(write){
      const provider=input.provider===undefined?policy.provider:input.provider;
      if(!validImageProvider(provider)||policy.localRetired&&input.enabled&&input.provider===undefined||
        input.useReference!==undefined&&typeof input.useReference!=='boolean')throw fail();
      if(input.revision!==editor.token||typeof input.enabled!=='boolean'||!Number.isInteger(input.dailyLimit)||input.dailyLimit<1||input.dailyLimit>10)throw fail();
      let referenceHash=provider===policy.provider&&input.useReference===undefined?policy.referenceHash:null;
      if(input.useReference){
        if(!input.enabled||!hasReference)throw fail();
        referenceHash=service.characterLibrary.portraitFingerprint(roleId.slice(5));
        if(!referenceHash)throw fail();
      }
      if(!input.enabled)referenceHash=null;
      if(policy.localRetired||policy.enabled!==input.enabled||policy.dailyLimit!==input.dailyLimit||
        provider!==policy.provider||referenceHash!==policy.referenceHash){
        this.store.configure(scope,{expectedRevision:policy.revision,enabled:input.enabled,dailyLimit:input.dailyLimit,provider,referenceHash});
        this.providerResults.delete(groupId);
        this.abort(groupId);this.activity++;service.changed();
        return this.settings({expectedAccountId,groupId,roleId},false,profileSelection);
      }
    }
    return {...scope,enabled:policy.enabled,dailyLimit:policy.dailyLimit,usedToday:policy.usedToday,
      revision:editor.token,provider:policy.provider,useReference:!!policy.referenceHash,referencePreference:policy.referenceHash?true:null,
      hasReference,canResend:policy.canResend,localRetired:policy.localRetired,providers:imageProviders(service),
      ready:service.stickerGenerationReady(policy.provider),model:defaultImageModel(policy.provider)};
  }
  referenceSource(roleId){
    return roleId.startsWith('card-')?this.service.characterLibrary?.portraitSource(roleId.slice(5)):null;
  }
  async generateCloud(policy,roleId,options,assertCurrent){
    let raw,reference;
    try{
      if(policy.referenceHash){
        try{
          const file=this.referenceSource(roleId);
          if(!file)throw referenceFailed();
          raw=await readSelected(file,options.signal);
          if(createHash('sha256').update(raw).digest('hex')!==policy.referenceHash)throw referenceFailed();
          reference=this.prepare(raw);
          validateImagePayload(reference);
        }catch{
          assertCurrent();
          throw referenceFailed();
        }
      }
      assertCurrent();
      return await this.service.generateCharacterSticker({
        ...options,provider:policy.provider,assertCurrent,
        ...(policy.provider===OPENAI&&{quality:'low',complexity:'low'}),
        ...(reference&&{reference,prompt:options.prompt+'\nUse the attached card portrait as the visual reference for this fictional character.'})
      });
    }finally{raw?.fill(0);reference?.fill(0);}
  }
  abort(groupId){
    for(const [controller,id] of this.pending)if(!groupId||id===groupId)controller.abort();
  }
  revoke(accountId,groupId){
    if(!accountId)return;
    this.store.revoke(accountId,groupId);
    if(groupId)this.providerResults.delete(groupId);else this.providerResults.clear();
    if(groupId)this.editors.delete(groupId);else this.editors.clear();
    this.abort(groupId);this.activity++;
  }
  has({accountId,groupId,characterId},name){
    return supportedRole(characterId)&&this.store.has({accountId,groupId,roleId:characterId},name);
  }
  capabilityAnswer({accountId,groupId,characterId:roleId}){
    const service=this.service;
    let target;
    try{target=service.imageTargetBinding(groupId);}
    catch{return '当前 QQ 账号或群设置无法确认，暂时不能在这里画图。';}
    if(target.accountId!==accountId||target.roleId!==roleId||!supportedRole(roleId)){
      return '当前群的绘图权限与我的角色或账号不匹配。';
    }
    let policy;
    try{policy=this.store.view({accountId,groupId,roleId});}
    catch{return '暂时读不到本群的绘图设置。';}
    if(!policy.enabled)return '本群还没允许我用云服务画图。';
    if(!service.stickerGenerationReady(policy.provider))return '本群已允许我画图，主人还需要连接本群选的绘图服务。';
    if(policy.usedToday>=policy.dailyLimit)return groupDrawingNotice('quota');
    if(typeof this.prepare!=='function')return '这次无法确认本群能处理成图。';
    const recent=this.providerResults.get(groupId);
    if(recent?.revision===policy.revision&&recent.vault===service.vaultFingerprint&&recent.until>Date.now()){
      return providerStatusNotices.get(recent.code);
    }
    return '本群已允许绘图，也配置了云服务。可以 @我说「画一张……」，出图以服务返回为准。';
  }
  handlesLookup(binding,name,{directed}){
    if(this.has(binding,name))return true;
    // A sibling's paid work also claims an unaddressed lookup. Keeping it out
    // of this role's generic sticker/text route prevents duplicate replies.
    return !directed&&this.unique?.(binding.groupId,name,false)===false;
  }
  fixedName({accountId,groupId,characterId},name){
    const cfg=this.service.config;
    // Both generations of the fixed-sticker API return only request-approved names here.
    const options=groupNamedStickers?groupNamedStickers(cfg,accountId,groupId,characterId,'request'):
      selectedGroupMedia(cfg,accountId,groupId,characterId).includes(stickerAsset(characterId))?
        [getGroupNamedSticker(cfg,accountId,groupId,characterId)]:[];
    return options.some(row=>row&&key(row.name)===key(name));
  }
  async handle({binding,request,eventId,contextToken,signal,assertCurrent,reserveDelivery}){
    const {accountId,groupId,characterId:roleId}=binding,scope={accountId,groupId,roleId};
    if(!supportedRole(roleId))return refused('unsupported_role');
    const service=this.service;
    let policy;
    try{policy=this.store.view(scope);}catch{return refused('storage_unavailable');}
    if(!(request.action==='resend'?policy.canResend:policy.enabled))return refused('disabled');
    if(this.pending.size>=64||[...this.pending.values()].filter(id=>id===groupId).length>=16)return refused('in_progress');
    const controller=new AbortController(),active=AbortSignal.any([signal,controller.signal]);
    this.pending.set(controller,groupId);
    let drawingSource;
    try{
      const origin=service.imageTargetBinding(groupId),client=origin.client,socket=client.socket,clientGeneration=client.generation;
      const check=()=>{
        assertCurrent();
        const target=service.imageTargetBinding(groupId);
        if(active.aborted||target.accountId!==accountId||target.roleId!==roleId||target.scopeId!==origin.scopeId||
          target.generation!==origin.generation||target.groupRevision!==origin.groupRevision||target.route!==origin.route||
          target.client!==client||client.socket!==socket||client.generation!==clientGeneration)throw fail();
        if(drawingSource)drawingSource.assertCurrent();
        else client.assertGroupReplyContext(binding,contextToken);
      };
      const nameIssue=()=>{
        if(request.action==='needs_name')return 'name_required';
        const drawingOnly=request.source==='drawing';
        if(!request.directed&&this.unique?.(groupId,request.name,!drawingOnly)===false)return 'other_role';
        if(drawingOnly||!this.fixedName(binding,request.name))return null;
        return request.action==='create'?'name_conflict':'choose_source';
      };
      check();
      const code=nameIssue();
      if(code){
        const notice=code==='choose_source'?
          '本群有两张同名图。要现场画的，发「再发一次群里画的『'+request.name+'』」。要已选表情，发「发『'+request.name+'』表情包」。':
          request.directed&&groupDrawingNotice(code);
        if(notice){reserveDelivery();await client.sendGroupText(binding,notice,contextToken,randomUUID(),active);}
        return refused(code);
      }
      if(request.source==='drawing'&&!this.has(binding,request.name))return refused('not_found');
      if(request.action==='create')drawingSource=client.retainGroupDrawingSource(binding,contextToken);
      const target=await client.verifyGroupImageTarget(groupId,active,{assertCurrent:check});
      check();
      if(target.accountId!==accountId||target.groupId!==groupId||target.revision!==origin.groupRevision)return refused('scope_changed');
      const stillCurrent=()=>{check();if(nameIssue())throw fail();};
      const roleName=service.groupPublicRole(accountId,groupId).roleName;
      const vault=service.vaultFingerprint;
      const canGenerate=()=>{
        stillCurrent();
        if(this.store.view(scope).revision!==policy.revision||service.vaultFingerprint!==vault)throw fail();
      };
      const result=await this.store.handle({scope,roleName,expectedRevision:policy.revision,eventId,action:request.action,
        name:request.name,brief:request.brief,signal:active,assertCurrent:stillCurrent,isReady:()=>service.stickerGenerationReady(policy.provider),
        generate:async options=>{
          this.activity++;service.changed();
          let providerCode;
          try{
            return await this.generateCloud(policy,roleId,options,canGenerate);
          }catch(error){
            providerCode=error?.code||'unknown';
            throw error;
          }finally{
            try{
              canGenerate();
              if(providerStatusNotices.has(providerCode)){
                this.providerResults.set(groupId,{code:providerCode,revision:policy.revision,vault,until:Date.now()+PROVIDER_RESULT_WINDOW_MS});
              }else if(!providerCode)this.providerResults.delete(groupId);
            }catch{/* A changed scope cannot publish provider status. */ }
          }
        },prepare:this.prepare,
        send:(bytes,guard,sendSignal)=>{
          try{stillCurrent();guard();reserveDelivery();}
          catch(error){return {outcome:'not_sent',code:error?.code||'scope_changed'};}
          return client.sendGroupImage(groupId,bytes,randomUUID(),sendSignal,{assertCurrent:()=>{stillCurrent();guard();},scopeId:origin.scopeId});
        }});
      if(result.outcome==='accepted')service.outgoingAccepted++;
      else if(request.action==='create'&&result.outcome==='not_sent'){
        const notice=groupDrawingNotice(result.code);
        if(notice){
          stillCurrent();
          if(this.store.view(scope).revision!==policy.revision)return result;
          reserveDelivery();
          try{await drawingSource.sendNotice(notice,active);}catch{/* A notice is attempted once. */}
        }
      }
      return result;
    }catch(error){return refused(error?.code==='group_delivery_limit'?'group_delivery_limit':'scope_changed');}
    finally{drawingSource?.release();this.pending.delete(controller);}
  }
}
module.exports={QQGroupDrawing};
