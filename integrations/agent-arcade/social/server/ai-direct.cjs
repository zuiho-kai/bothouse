'use strict';

const {fail,number}=require('./store.cjs');
const {AI_NUMBER,AI_DRAGON_NUMBER,providerForRole}=require('./ai-roles.cjs');
const {provisionAi,bindAi}=require('./ai-adapter.cjs');
const {aiBudget}=require('./ai-budget.cjs');
const {modelContext}=require('./model-context.cjs');
const {personalDirectProfile}=require('./group-card.cjs');
const {spokenGroupReply}=require('../../src/bot/group-spoken-dialogue.cjs');
const {createGroupCloudDrawing}=require('./group-cloud-drawing.cjs');
const {personalStickerReply}=require('./ai-stickers.cjs');

const drawingFailures=new Map([
  ['image_quota_exceeded','云生图服务的额度已用完。'],
  ['image_rate_limited','云生图服务正在限流。'],
  ['image_network','暂时无法连接云生图服务。'],
  ['image_timeout','云生图服务这次超时。'],
  ['image_auth','云生图服务的凭据不可用。'],
  ['image_forbidden','云生图服务拒绝了当前配置的访问。'],
  ['image_reference_rejected','云生图服务无法使用这张公开头像。'],
]);

function createAiDirect(store,providers,voiceReplies,web,personal,drawingProvider){
  const drawing=createGroupCloudDrawing(store,drawingProvider);
  const running=new Map();
  const catalog=new Map();
  for(const [id,adapter] of providers){
    if(typeof adapter?.generate!=='function')continue;
    const name=adapter.name??'鲸鱼娘';
    const existing=store.one('SELECT kind,name FROM users WHERE number=?',id);
    if(!existing)provisionAi(store,id,name);
    else if(existing.kind!=='ai'||existing.name!==name)throw Error('The configured social AI identity is unavailable');
    catalog.set(id,adapter);
  }
  // This service has one SQLite writer process. Do not replay an interrupted
  // provider request whose outcome or cost is unknown after a restart.
  store.run("UPDATE ai_direct_turns SET state='failed' WHERE state='pending'");
  const access=(account,target)=>personal?.privateAccess(account,target);
  function requirePersonal(access){
    if(access&&!access.allowed)fail(403,'personal_ai_private_cloud','这位 AI 的主人尚未允许你使用其云聊天服务');
  }

  function start(account,body){
    const target=number(body.number);
    const policy=access(account,target);
    requirePersonal(policy);
    if(policy&&!store.direct(account,target))fail(403,'friends_only','请先添加这位 AI 为好友');
    if(!(policy?policy.adapter:catalog.has(target)))fail(404,'ai_unavailable','这个 AI 联系人暂不可用');
    if(body.allowCloud!==true||body.expectedAccount!==account)fail(403,'ai_consent_required','请在当前账号确认使用云聊天');
    verifyProvider(body,target,policy);
    if(policy)requireContextConsent(body);
    const conversation=store.openDirect(account,target);
    const existing=policy&&store.directAiConsent(account,conversation.id);
    if(existing&&!existing.enabled)fail(409,'ai_consent_changed','请从当前会话重新确认云聊天设置');
    store.run('INSERT OR IGNORE INTO ai_direct_grants VALUES(?,?,?)',conversation.id,account,target);
    if(policy&&!existing)return setConsent(account,conversation.id,{...body,revision:store.directAiConsent(account,conversation.id).revision});
    return {conversation:store.conversation(account,conversation.id)};
  }

  function verifyProvider(body,target,policy){
    if(policy){
      if(body.provider!==policy.provider)fail(409,'ai_consent_changed','请重新核对这位 AI 使用的云服务');
      return;
    }
    // The old Whale-only client did not send a provider field.
    if(body.provider===undefined){
      if(target===AI_NUMBER)return;
      if(target===AI_DRAGON_NUMBER)
        fail(409,'ai_provider_confirmation','请刷新好友页面或使用新版，再确认 OpenAI（GPT）授权');
    }
    if(body.provider!==providerForRole.get(target))fail(409,'ai_consent_changed','请重新核对这个角色使用的云服务');
  }

  function requireContextConsent(body){
    if(body.personalContext!==true)
      fail(409,'ai_context_confirmation','请刷新好友页面并核对这段私聊的新授权说明');
  }

  function setConsent(account,chat,body){
    if(body.expectedAccount!==account) fail(403,'ai_consent_required','请在当前账号确认云聊天设置');
    store.access(account,chat);
    const current=store.directAiConsent(account,chat);
    if(!current) fail(404,'ai_unavailable','这个 AI 私聊不可用');
    if(typeof body.allowCloud!=='boolean'||body.revision!==current.revision)
      fail(409,'ai_consent_changed','云聊天设置已变化，请重新确认');
    // Older pages omit the provider. Revocation can only remove the current grant.
    const policy=access(account,current.ai);
    if(body.allowCloud){
      requirePersonal(policy);
      if(policy)requireContextConsent(body);
    }
    if(body.allowCloud||body.provider!==undefined)verifyProvider(body,current.ai,policy);
    const enabled=Number(body.allowCloud);
    if(enabled===current.enabled) return {conversation:store.conversation(account,chat)};
    if(enabled&&!(policy?policy.adapter:catalog.has(current.ai))) fail(409,'ai_unavailable','这个 AI 联系人暂不可用');
    const floor=enabled?store.one('SELECT coalesce(max(id),0) AS id FROM messages WHERE chat=?',chat).id:current.contextFloor;
    store.run(`INSERT INTO ai_direct_permissions VALUES(?,?,?,?)
      ON CONFLICT(chat) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision,
      context_floor=excluded.context_floor`,chat,enabled,current.revision+1,floor);
    if(enabled&&policy)store.run('INSERT OR IGNORE INTO personal_ai_direct_context(chat) VALUES(?)',chat);
    if(!enabled) store.run("UPDATE ai_direct_turns SET state='failed' WHERE chat=? AND state='pending'",chat);
    return {conversation:store.conversation(account,chat),...(!enabled&&{abortDirectChat:chat})};
  }

  function abort(chat){running.get(chat)?.controller.abort();}
  function cancelStalePersonal(){
    for(const [chat,job] of running){
      if(!job.policy)continue;
      const current=access(job.account,job.ai);
      if(current?.allowed&&current.adapter&&current.revision===job.policy.revision)continue;
      job.controller.abort();
      store.run("UPDATE ai_direct_turns SET state='failed' WHERE prompt=? AND state='pending'",job.prompt);
      running.delete(chat);
    }
  }

  // Called in the same transaction as the human message. A retry of that
  // message keeps its original turn and never reserves another provider call.
  function stage(account,message,revision){
    const chat=message.conversationId;
    const permission=store.directAiConsent(account,chat);
    if(!permission&&store.connectedAi(account,chat))
      fail(409,'ai_consent_required','请先单独确认这段 AI 云私聊');
    if(!permission||message.removed)return false;
    const policy=access(account,permission.ai);
    requirePersonal(policy);
    if(!permission.enabled) fail(409,'ai_cloud_off','本段私聊的云聊天已关闭');
    if(permission.revision!==revision) fail(409,'ai_consent_changed','云聊天设置已变化，请重新确认');
    const started=Date.now();
    const configured=policy?!!policy.adapter:catalog.has(permission.ai);
    const limit=configured?aiBudget(store,chat,started):null;
    const role=store.user(permission.ai);
    if(policy){
      role.privateProfileRevision=policy.profile.profileRevision;
      role.privateCardName=policy.profile.card?.name;
    }
    const request=drawing.parse(message.text,role,{direct:true});
    let work=request&&drawing.admit(chat,account,role,request,started,limit,{direct:true,personal:!!policy});
    if(work&&policy&&!configured&&(work.brief||work.resend||request.action==='inquiry'))
      work={text:'这位个人 AI 的聊天服务尚未连接。请主人重新连接后再试。'};
    if(work){
      if(running.has(chat)||store.one("SELECT 1 FROM ai_direct_turns WHERE chat=? AND state='pending'",chat))
        fail(429,'ai_busy','正在等 AI 回复，请稍后再发送');
      store.run("INSERT INTO ai_direct_turns VALUES(?,?,'pending',?)",message.id,chat,work.brief?started:0);
      if(work.brief)store.run('INSERT INTO ai_direct_draw_requests(prompt,chat,human,ai,started) VALUES(?,?,?,?,?)',
        message.id,chat,account,permission.ai,started);
      return {drawing:work};
    }
    if(configured){
      if(running.has(chat)||limit==='busy')
        fail(429,'ai_busy','正在等 AI 回复，请稍后再发送');
      if(limit==='daily_limit')
        fail(429,'ai_daily_limit','今天的 AI 聊天次数已用完');
    }
    store.run('INSERT INTO ai_direct_turns VALUES(?,?,?,?)',message.id,chat,configured?'pending':'failed',started);
    return configured;
  }

  async function finish(message,turn=true){
    const chat=message.conversationId;
    const controller=new AbortController();
    let reply;
    try{
      const permission=store.directAiConsent(message.sender.number,chat);
      if(!permission?.enabled||!store.one("SELECT 1 FROM ai_direct_turns WHERE prompt=? AND state='pending'",message.id))return;
      const account=message.sender.number, policy=access(account,permission.ai);
      requirePersonal(policy);
      const adapter=policy?policy.adapter:catalog.get(permission.ai);
      const needsPersonalConnection=!turn.drawing?.text;
      if(!adapter&&(!turn.drawing||(policy&&needsPersonalConnection)))throw Error('AI provider unavailable');
      const bot=bindAi(store,permission.ai,chat);
      running.set(chat,{controller,account,ai:permission.ai,policy,prompt:message.id});
      const assertCurrent=()=>{
        const current=store.directAiConsent(message.sender.number,chat);
        if(!current?.enabled||current.ai!==permission.ai||current.revision!==permission.revision||!store.one(`SELECT 1 FROM messages m
          JOIN ai_direct_turns t ON t.prompt=m.id WHERE m.id=? AND m.removed=0 AND t.state='pending'`,message.id))
          throw Error('AI prompt changed');
        if(policy){
          const allowed=access(account,permission.ai);
          if(controller.signal.aborted||!allowed?.allowed||(needsPersonalConnection&&!allowed.adapter)||allowed.revision!==policy.revision)
            throw Error('Personal AI authorization changed');
        }
      };
      const afterSend=()=>{
        if(store.one('SELECT removed FROM messages WHERE id=?',message.id)?.removed!==0)
          throw Error('AI prompt changed');
        if(!store.run("UPDATE ai_direct_turns SET state='answered' WHERE prompt=? AND state='pending'",message.id).changes)
          throw Error('AI turn changed');
      };
      const clientId='ai-reply-'+message.id;
      if(turn.drawing){
        const work=turn.drawing;
        const answered=result=>{
          assertCurrent();
          if(work.brief&&result.attachment?.drawing)
            store.run('UPDATE ai_direct_draw_requests SET reply=? WHERE prompt=?',result.id,message.id);
          afterSend();
        };
        if(work.text)return bot.send({clientId,text:work.text},answered);
        if(work.resend){
          const image=drawing.original(chat,message.sender.number,permission.ai,'',work.resend);
          if(!image||image.removed||image.promptRemoved)
            return bot.send({clientId,text:'这张原图现在无法重发。'},answered);
          return bot.sendDrawing(clientId,image,answered);
        }
        let image;
        try {
          assertCurrent();
          const reference=drawing.reference(chat,bot.identity,work);
          image=await drawing.generate(work.brief,{signal:controller.signal,assertCurrent,reference});
        } catch(error) {
          assertCurrent();
          const reason=drawingFailures.get(error.code)??'云生图服务没有返回可用图片。';
          return bot.send({clientId,text:reason+'这次没有收到可用图片。'},answered);
        }
        assertCurrent();
        return bot.sendDrawing(clientId,{...image,title:work.title},answered);
      }
      const lookup=!policy&&web.inspect(message,message.text,bot.identity);
      if(lookup){
        const result=await web.reply(chat,lookup,{signal:controller.signal,assertCurrent});
        assertCurrent();
        return web.send(bot,clientId,result,afterSend);
      }
      const rows=store.history(bot.identity.number,chat,new URLSearchParams({before:String(message.id+1),limit:'10'}));
      const privacy=modelContext(store,chat);
      const context=rows.map(row=>row.attachment?.type==='voice'&&row.sender.number===bot.identity.number?
        {...row,text:store.one('SELECT body FROM messages WHERE id=?',row.id).body}:row
      ).filter(row=>row.id>permission.contextFloor&&
        (!policy||!row.attachment&&(row.sender.number===account||row.sender.number===permission.ai))&&
        privacy.allowsHistory(row)).map(row=>({
        role:row.sender.number===bot.identity.number?'assistant':'user',content:row.text,
      }));
      if(rows.at(-1)?.id!==message.id||rows.at(-1).removed)throw Error('AI prompt changed');
      if(policy){
        assertCurrent();
        const prior=context.slice(0,-1).findLast(row=>row.role==='user')?.content??'';
        const sticker=await personalStickerReply(bot.identity,message.text,prior,{
          signal:controller.signal,assertCurrent,localOnly:!privacy.allows(message),
        });
        if(sticker){
          assertCurrent();
          const complete=()=>{assertCurrent();afterSend();};
          return sticker.image?bot.sendSticker(clientId,sticker.image,complete):
            bot.send({clientId,text:sticker.text},complete);
        }
        const name=bot.identity.displayName;
        const profile=personalDirectProfile(policy.profile,message.text,privacy,name);
        const text=privacy.allows(message)?
          await adapter.generate([profile,...context],{signal:controller.signal,personalDirect:true}):
          '这条消息没有发送给云服务。';
        assertCurrent();
        return bot.send({clientId,text:spokenGroupReply(text,name,message.text)},()=>{
          assertCurrent();
          afterSend();
        });
      }
      const {text,image,voice}=await voiceReplies.reply({bot:bot.identity,chat,human:message.sender.number,
        input:message.text,signal:controller.signal,publicSearch:true,localOnly:!privacy.allows(message),
        canShareSpeech:text=>privacy.allows({text}),assertCurrent},
        replyHint=>{
          assertCurrent();
          return adapter.generate(context,{signal:controller.signal,replyHint});
        });
      if(controller.signal.aborted) return;
      reply=voice?bot.sendVoice(clientId,voice,text,afterSend):
        image?bot.sendSticker(clientId,image,afterSend):bot.send({clientId,text},afterSend);
    }catch{
      store.run("UPDATE ai_direct_turns SET state='failed' WHERE prompt=? AND state='pending'",message.id);
    }finally{
      if(running.get(chat)?.controller===controller)running.delete(chat);
    }
    return reply;
  }
  function drawingResend(account,chat,message,body){
    const membership=store.access(account,chat);
    const grant=store.directAiConsent(account,chat);
    if(body&&(body.expectedAccount!==account||body.membershipRevision!==membership.membershipRevision||
        body.aiConsentRevision!==grant?.revision))
      fail(409,'drawing_resend_session','会话身份已变化，请重新打开原图');
    const policy=grant&&access(account,grant.ai);
    const eligible=grant?.enabled&&(policy?policy.allowed&&policy.adapter:providerForRole.has(grant.ai));
    const image=eligible&&drawing.original(chat,account,grant.ai,'',message,1,Boolean(body),true);
    if(!body)return {available:Boolean(image)};
    if(typeof body.clientId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/u.test(body.clientId))
      fail(400,'drawing_resend_request','重发编号无效');
    if(!image)fail(404,'drawing_resend_unavailable','这张原图已不可重发');
    const sent=drawing.resendOriginal(account,chat,image,body.clientId);
    return {messageId:sent.id,removed:sent.removed};
  }
  function contacts(){
    return Array.from(catalog.keys(),id=>({
      ...store.user(id),...(id!==AI_NUMBER&&{provider:providerForRole.get(id)}),
    }));
  }
  return {contacts,start,setConsent,abort,stage,finish,cancelStalePersonal,drawingResend};
}
module.exports={createAiDirect};
