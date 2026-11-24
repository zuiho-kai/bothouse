'use strict';

const {randomUUID}=require('node:crypto');
const {fail,number}=require('./store.cjs');
const {AI_JU_NUMBER,providerForRole}=require('./ai-roles.cjs');
const {provisionAi,bindAi}=require('./ai-adapter.cjs');
const {aiBudget}=require('./ai-budget.cjs');
const {closesExchange,implicitReply}=require('./ai-group-conversation.cjs');
const {attachmentAddress,modelContext}=require('./model-context.cjs');
const {reviewedCard,reviewedLorebook,groupReplyContext}=require('./group-card.cjs');
const {decodePortrait}=require('../../src/core/group-drawing-portrait.cjs');
const {spokenGroupReply}=require('../../src/bot/group-spoken-dialogue.cjs');
const {createGroupCloudDrawing,bareResend}=require('./group-cloud-drawing.cjs');
const {readInvitingReply,invitationGuide}=require('./ai-friend-requests.cjs');
const {openingCall}=require('./bothouse/group-address.cjs');

function addressedReply(message,roles,members){
  function reply(target,text){
    const role=roles.find(row=>row.number===target);
    return role&&text?{role,text,addressed:true}:null;
  }
  const text=message.text;
  if(message.mention)return reply(message.mention.number,text);
  const mention=/^[@＠]([^\s@＠，,:：！？?。]+)[\s，,:：]+(.+)$/su.exec(text);
  if(mention){
    if(/[@＠]/u.test(mention[2]))return null;
    const matches=members().filter(row=>row.name.normalize('NFKC')===mention[1].normalize('NFKC'));
    return matches.length===1?reply(matches[0].number,mention[2].trim()):null;
  }
  const call=openingCall(text,members());
  if(!call)return undefined;
  return call.targets.size===1&&!/[@＠]/u.test(call.text)?reply([...call.targets][0],call.text):null;
}

function createAiGroup(store,providers,voiceReplies,drawingProvider,friendRequests,web){
  const catalog=new Map();
  const active=new Set();
  const drawing=createGroupCloudDrawing(store,drawingProvider);
  for(const provider of providers){
    for(const role of provider.groupRoles??[]){
      if(providerForRole.get(role.number)!==provider.provider||catalog.has(role.number))
        throw Error('Invalid group AI provider binding');
      const existing=store.one('SELECT kind,name FROM users WHERE number=?',role.number);
      if(!existing)provisionAi(store,role.number,role.name);
      else if(existing.kind!=='ai'||existing.name!==role.name)throw Error('The configured group AI identity is unavailable');
      catalog.set(role.number,provider);
    }
  }
  store.run("UPDATE ai_group_turns SET state='failed' WHERE state='pending'");

  function members(chat){
    return store.all(`SELECT r.ai AS number,r.revision,u.name AS displayName,u.kind,c.projection,b.projection AS book
      FROM ai_group_roles r JOIN users u ON u.number=r.ai LEFT JOIN ai_group_cards c ON c.chat=r.chat AND c.ai=r.ai
      LEFT JOIN ai_group_lorebooks b ON b.chat=r.chat AND b.ai=r.ai
      WHERE r.chat=? AND NOT EXISTS (SELECT 1 FROM personal_ai p WHERE p.ai=r.ai) ORDER BY r.rowid`,chat).map(({projection,book,...role})=>({...role,
        card:projection?JSON.parse(projection):null,lorebook:book?JSON.parse(book):null}));
  }
  function sharedWith(account,chat){
    const rows=store.all('SELECT ai,provider,revision FROM ai_group_role_consents WHERE chat=? AND human=?',chat,account);
    return new Map(rows.filter(row=>row.provider===providerForRole.get(row.ai)).map(row=>[row.ai,row.revision]));
  }
  function contextConsent(chat,account,role){
    return store.one('SELECT revision FROM ai_group_context_consents WHERE chat=? AND human=? AND ai=? AND provider=?',
      chat,account,role,providerForRole.get(role))?.revision;
  }
  function memberNames(chat){
    return store.all('SELECT users.number,users.name,users.kind FROM users JOIN members ON members.account=users.number WHERE members.chat=?',chat);
  }
  function view(account,chat){
    const group=store.group(account,chat);
    const grants=sharedWith(account,chat);
    const canManage=group.owner===account;
    const joined=members(chat).map(({number,displayName,kind,revision,card,lorebook})=>({number,displayName,kind,
      provider:providerForRole.get(number),configured:catalog.has(number),sharing:grants.has(number),
      sharesPrevious:!!contextConsent(chat,account,number),
      drawing:catalog.has(number)?drawing.status(chat,number):{configured:false,enabled:false},
      ...(canManage&&{roleRevision:revision,card,lorebook,portraitApproved:!!(card&&drawing.portrait(chat,number,revision,false))})}));
    return {joined,canManage,available:canManage?Array.from(catalog.keys(),number=>({
      ...store.user(number),provider:providerForRole.get(number),
    })):[]};
  }
  function verifyEdit(account,body){
    if(body.expectedAccount!==account||typeof body.enabled!=='boolean')fail(403,'ai_consent_required','请在当前账号确认 AI 设置');
  }
  function setMember(account,chat,body){
    verifyEdit(account,body);
    if(store.group(account,chat).owner!==account)fail(403,'group_owner','只有群主可以增减群里的 AI');
    const target=number(body.number);
    const joined=members(chat).some(role=>role.number===target);
    if(body.enabled&&!joined){
      if(!catalog.has(target))fail(404,'ai_unavailable','这位 AI 暂不可用');
      if(store.one('SELECT count(*) AS n FROM members WHERE chat=?',chat).n>=100)fail(409,'group_full','群成员上限为 100 人');
      const since=store.one('SELECT coalesce(max(id),0) AS id FROM messages WHERE chat=?',chat).id;
      store.run('INSERT OR IGNORE INTO members VALUES(?,?,?)',chat,target,since);
      store.run('INSERT INTO ai_group_roles VALUES(?,?,?)',chat,target,randomUUID());
    }else if(!body.enabled&&joined)store.remove(account,chat,target,false);
    return view(account,chat);
  }
  function setSharing(account,chat,body){
    verifyEdit(account,body);
    store.group(account,chat);
    const target=number(body.number),provider=providerForRole.get(target);
    if(!provider||provider!==body.provider||!members(chat).some(role=>role.number===target))
      fail(409,'ai_unavailable','这位群内 AI 或其服务已变化');
    if(body.enabled){
      if(!catalog.has(target))fail(409,'ai_unavailable','该 AI 服务暂未配置');
      store.run('INSERT OR IGNORE INTO ai_group_role_consents VALUES(?,?,?,?,?)',chat,account,target,provider,randomUUID());
    }else store.run('DELETE FROM ai_group_role_consents WHERE chat=? AND human=? AND ai=? AND provider=?',chat,account,target,provider);
    return view(account,chat);
  }
  function reviewTarget(account,chat,body){
    if(store.group(account,chat).owner!==account)fail(403,'group_owner','只有群主可以修改群角色');
    if(body.expectedAccount!==account)fail(409,'group_card_account','账号已切换，请重新打开群设置');
    const target=number(body.number);
    const role=members(chat).find(row=>row.number===target);
    if(!role||role.revision!==body.expectedRevision)fail(409,'group_card_changed','角色设置已变化，请重新预览');
    return role;
  }
  function setCard(account,chat,body){
    const role=reviewTarget(account,chat,body),target=role.number;
    const card=reviewedCard(body.card);
    let portrait;
    if(body.portrait!==undefined){
      if(!card)fail(400,'group_card_portrait','请先选好本群角色卡');
      try{portrait=decodePortrait(body.portrait);}
      catch{fail(400,'group_card_portrait','这张卡面无法使用，请从本机角色库重新选择');}
    }
    const prior=drawing.portrait(chat,target,role.revision);
    if(JSON.stringify(card)===JSON.stringify(role.card)&&
       (portrait?prior&&portrait.equals(prior):!prior))return view(account,chat);
    if(card)store.run(`INSERT INTO ai_group_cards(chat,ai,projection) VALUES(?,?,?)
      ON CONFLICT(chat,ai) DO UPDATE SET projection=excluded.projection`,chat,target,JSON.stringify(card));
    else store.run('DELETE FROM ai_group_cards WHERE chat=? AND ai=?',chat,target);
    const revision=randomUUID();
    store.run('UPDATE ai_group_roles SET revision=? WHERE chat=? AND ai=?',revision,chat,target);
    store.run('DELETE FROM ai_group_card_portraits WHERE chat=? AND ai=?',chat,target);
    if(portrait)store.run('INSERT INTO ai_group_card_portraits VALUES(?,?,?,?)',chat,target,revision,portrait);
    return view(account,chat);
  }
  function setLorebook(account,chat,body){
    const role=reviewTarget(account,chat,body),target=role.number;
    const book=reviewedLorebook(body.lorebook);
    if(JSON.stringify(book)===JSON.stringify(role.lorebook))return view(account,chat);
    if(book)store.run(`INSERT INTO ai_group_lorebooks(chat,ai,projection) VALUES(?,?,?)
      ON CONFLICT(chat,ai) DO UPDATE SET projection=excluded.projection`,chat,target,JSON.stringify(book));
    else store.run('DELETE FROM ai_group_lorebooks WHERE chat=? AND ai=?',chat,target);
    const revision=randomUUID();
    store.run('UPDATE ai_group_roles SET revision=? WHERE chat=? AND ai=?',revision,chat,target);
    store.run('UPDATE ai_group_card_portraits SET revision=? WHERE chat=? AND ai=? AND revision=?',revision,chat,target,role.revision);
    return view(account,chat);
  }
  function setContextSharing(account,chat,body){
    verifyEdit(account,body);
    store.group(account,chat);
    const target=number(body.number),provider=providerForRole.get(target);
    if(!provider||provider!==body.provider||!sharedWith(account,chat).has(target))
      fail(409,'ai_unavailable','请先核对该角色的群内云服务授权');
    if(body.enabled){
      if(!catalog.has(target))fail(409,'ai_unavailable','该 AI 服务暂未配置');
      store.run('INSERT OR IGNORE INTO ai_group_context_consents VALUES(?,?,?,?,?)',chat,account,target,provider,randomUUID());
    }else store.run('DELETE FROM ai_group_context_consents WHERE chat=? AND human=? AND ai=? AND provider=?',
      chat,account,target,provider);
    return view(account,chat);
  }
  function setDrawing(account,chat,body){
    drawing.configure(account,chat,body,role=>catalog.has(role));
    return view(account,chat);
  }
  function recentMessages(chat,account,before){
    return store.all(`SELECT m.id,m.sender,m.created,u.kind,target.kind AS mentionKind,mention.account AS mentionAccount,
      CASE WHEN m.sender=viewer.account THEN m.body END AS ownBody
      FROM members viewer JOIN messages m ON m.chat=viewer.chat
      JOIN users u ON u.number=m.sender
      LEFT JOIN message_mentions mention ON mention.message=m.id
      LEFT JOIN users target ON target.number=mention.account
      WHERE viewer.chat=? AND viewer.account=? AND m.id>viewer.since AND m.id<? AND m.removed=0
      ORDER BY m.id DESC LIMIT 6`,chat,account,before);
  }
  function previousExchange(chat,account,replyId){
    return store.one(`SELECT p.id AS humanId,p.body AS human,r.id AS replyId,r.body AS reply,link.role_revision AS roleRevision,
      link.consent_revision AS consentRevision
      FROM ai_group_reply_links link
      JOIN messages p ON p.id=link.prompt
      JOIN messages r ON r.id=link.reply AND r.chat=p.chat
      JOIN members viewer ON viewer.chat=p.chat AND viewer.account=p.sender
      WHERE r.id=? AND p.chat=? AND p.sender=? AND p.id>viewer.since AND p.removed=0 AND r.removed=0`,replyId,chat,account);
  }
  function closeExchange(chat,account,id){
    // A human's room-local boundary survives recall, window paging and restart.
    // It orders the original prompts, not the delivery time of their replies.
    store.run('INSERT INTO ai_group_exchange_ends(chat,human,closed_through) '+
      "SELECT id,?,? FROM chats WHERE id=? AND type='group' "+
      'ON CONFLICT(chat,human) DO UPDATE SET closed_through=max(closed_through,excluded.closed_through)',
      account,id,chat);
  }
  function stage(account,message,claudeUi){
    const chat=message.conversationId;
    if(message.sender.kind!=='human'||message.removed||message.attachment||attachmentAddress.test(message.text))return null;
    if(closesExchange(message.text)&&(!message.mention||message.mention.kind==='ai')){
      closeExchange(chat,account,message.id);
      return null;
    }
    if(!catalog.size)return null;
    const consents=sharedWith(account,chat);
    const available=members(chat).filter(role=>catalog.has(role.number));
    const started=Date.now();
    const explicit=addressedReply(message,available,()=>memberNames(chat));
    if(explicit===null)return null;
    if(explicit&&closesExchange(explicit.text)){
      closeExchange(chat,account,message.id);
      return null;
    }
    if(!claudeUi){
      if(explicit?.role.number===AI_JU_NUMBER)
        fail(409,'claude_client_update','请刷新好友页面或使用新版，再核对 Claude（Anthropic）授权');
      consents.delete(AI_JU_NUMBER);
    }
    if(!consents.size)return null;
    const drawRequest=drawing.parse(explicit?.text??message.text,explicit?.role);
    let addressed=explicit;
    if(!addressed&&drawRequest?.action==='resend'&&bareResend.test(message.text)){
      const source=drawing.original(chat,account,null,'');
      const role=source&&available.find(role=>role.number===source.ai);
      if(role)addressed={role,text:message.text};
    }
    // An implicit conversational turn never starts a paid image request.
    if(drawRequest&&!addressed&&drawRequest.action!=='chat')return null;
    const selected=addressed||implicitReply({
      message,roles:available,consents,memberNames:()=>memberNames(chat).map(row=>row.name),
      recent:()=>recentMessages(chat,account,message.id),
      previousExchange:replyId=>previousExchange(chat,account,replyId),
      closedThrough:store.one('SELECT closed_through FROM ai_group_exchange_ends WHERE chat=? AND human=?',
        chat,account)?.closed_through??0,now:started,
    });
    const consent=selected&&consents.get(selected.role.number);
    if(!selected?.text||!consent)return null;
    const limited=aiBudget(store,chat,started);
    const drawingJob=drawRequest&&drawing.admit(chat,account,selected.role,drawRequest,started,limited);
    if(drawingJob){
      if(store.one("SELECT 1 FROM ai_group_turns WHERE chat=? AND state='pending'",chat)){
        store.run("INSERT INTO ai_group_turns VALUES(?,?,'failed',NULL)",message.id,chat);
        return null;
      }
      store.run("INSERT INTO ai_group_turns VALUES(?,?,'pending',?)",message.id,chat,drawingJob.brief?started:null);
      if(drawingJob.brief)store.run('INSERT INTO ai_group_draw_requests(prompt,chat,human,ai,started) VALUES(?,?,?,?,?)',
        message.id,chat,account,selected.role.number,started);
      return {id:message.id,chat,account,consent,...selected,drawing:drawingJob};
    }
    if(limited&&selected.implicit)return null;
    store.run('INSERT INTO ai_group_turns VALUES(?,?,?,?)',message.id,chat,limited?'failed':'pending',limited?null:started);
    if(limited)return null;
    const contextRevision=selected.previousReply?contextConsent(chat,account,selected.role.number):undefined;
    const friendRevision=selected.addressed?friendRequests.eligible(account,selected.role.number):undefined;
    return {id:message.id,chat,account,consent,contextRevision,friendRevision,...selected};
  }
  function current(job){
    if(!drawing.allowed(job.chat,job.role.number,job.drawing))return false;
    if(job.contextRevision&&contextConsent(job.chat,job.account,job.role.number)!==job.contextRevision)return false;
    if(job.implicit&&store.one(`SELECT 1 FROM messages m JOIN users u ON u.number=m.sender
      WHERE m.chat=? AND m.id>? AND m.sender<>? AND u.kind='human' LIMIT 1`,job.chat,job.id,job.account))return false;
    return !!store.one(`SELECT 1 FROM ai_group_role_consents s
      JOIN ai_group_roles r ON r.chat=s.chat AND r.ai=s.ai
      JOIN messages m ON m.chat=s.chat AND m.sender=s.human
      JOIN ai_group_turns t ON t.prompt=m.id
      WHERE s.chat=? AND s.human=? AND s.revision=? AND s.provider=? AND r.ai=? AND r.revision=?
      AND m.id=? AND m.removed=0 AND t.state='pending'`,job.chat,job.account,job.consent,
    providerForRole.get(job.role.number),job.role.number,job.role.revision,job.id);
  }
  async function finish(job){
    const controller=new AbortController();
    const running={job,controller};
    active.add(running);
    try{
      if(!current(job))throw Error('Group AI consent changed');
      const bot=bindAi(store,job.role.number,job.chat);
      const assertCurrent=()=>{if(!current(job))throw Error('Group AI consent changed');};
      const clientId='ai-reply-'+job.id;
      if(job.drawing){
        const work=job.drawing;
        const answered=reply=>{
          assertCurrent();
          if(work.brief&&reply.attachment?.drawing)
            store.run('UPDATE ai_group_draw_requests SET reply=? WHERE prompt=?',reply.id,job.id);
          store.run("UPDATE ai_group_turns SET state='answered' WHERE prompt=?",job.id);
        };
        if(work.text)return bot.send({clientId,text:work.text},answered);
        if(work.resend){
          const image=drawing.original(job.chat,job.account,job.role.number,'',work.resend);
          if(image&&!image.removed&&!image.promptRemoved)
            return bot.sendDrawing(clientId,image,reply=>{
              const original=drawing.original(job.chat,job.account,job.role.number,'',work.resend);
              if(!original||original.removed||original.promptRemoved)
                throw Error('Drawing original is no longer available');
              answered(reply);
            });
          return bot.send({clientId,text:'这张原图现在无法重发。'},answered);
        }
        let image;
        try{
          const reference=drawing.reference(job.chat,job.role,work);
          image=await drawing.generate(work.brief,{signal:controller.signal,assertCurrent,reference});
        }
        catch(error){
          assertCurrent();
          const text=['image_rate_limited','image_quota_exceeded'].includes(error.code)?
            '云生图服务当前限流或额度已用完，这次没有生成图片。':'云生图这次没有返回可用图片。';
          return bot.send({clientId,text},answered);
        }
        assertCurrent();
        return bot.sendDrawing(clientId,{...image,title:work.title},answered);
      }
      const lookup=web.inspect({id:job.id,conversationId:job.chat},job.text,bot.identity);
      if(lookup){
        const result=await web.reply(job.chat,lookup,{signal:controller.signal,assertCurrent,needsMention:!job.addressed});
        assertCurrent();
        return web.send(bot,clientId,result,()=>{
          assertCurrent();
          store.run("UPDATE ai_group_turns SET state='answered' WHERE prompt=?",job.id);
        });
      }
      const privacy=modelContext(store,job.chat);
      const pair=job.contextRevision&&previousExchange(job.chat,job.account,job.previousReply);
      const {context,cardName,hasGroupLorebook}=groupReplyContext(job.role,job.text,privacy);
      if(pair&&pair.roleRevision===job.role.revision&&pair.consentRevision===job.consent&&
          !attachmentAddress.test(pair.human)&&!attachmentAddress.test(pair.reply)&&
          privacy.allows({id:pair.humanId,text:pair.human})){
        context.push({role:'user',content:pair.human});
        if(privacy.allows({id:pair.replyId,text:pair.reply}))context.push({role:'assistant',content:pair.reply});
      }
      context.push({role:'user',content:job.text});
      const shareable=privacy.allows({id:job.id,text:job.text});
      let invite=false;
      const {text,image,voice}=await voiceReplies.reply({bot:bot.identity,chat:job.chat,human:job.account,
        input:job.text,signal:controller.signal,publicSearch:!job.implicit,automaticPublic:true,
        localOnly:!shareable,canShareSpeech:text=>privacy.allows({text}),assertCurrent},
        async replyHint=>{
          assertCurrent();
          const offered=job.friendRevision!==undefined&&
            friendRequests.eligible(job.account,job.role.number)===job.friendRevision&&
            shareable&&!/\[\[\s*friend-request/iu.test(job.text);
          const raw=await catalog.get(job.role.number).generate(context,{groupRole:job.role.number,
            hasGroupCard:!!cardName,hasGroupLorebook,signal:controller.signal,
            replyHint:offered?(replyHint||'')+invitationGuide:replyHint});
          const {text:draft,invite:chosen}=readInvitingReply(raw);
          invite=offered&&chosen;
          return cardName?spokenGroupReply(draft,cardName,job.text):draft;
        });
      const afterSend=reply=>{
        if(!current(job))throw Error('Group AI consent changed');
        store.run('INSERT INTO ai_group_reply_links VALUES(?,?,?,?)',reply.id,job.id,job.role.revision,job.consent);
        if(invite)friendRequests.deliver(job,reply);
        store.run("UPDATE ai_group_turns SET state='answered' WHERE prompt=?",job.id);
      };
      return voice?bot.sendVoice(clientId,voice,text,afterSend):
        image?bot.sendSticker(clientId,image,afterSend):bot.send({clientId,text},afterSend);
    }catch{
      store.run("UPDATE ai_group_turns SET state='failed' WHERE prompt=? AND state='pending'",job.id);
      return null;
    }finally{active.delete(running);}
  }
  function drawingResend(account,chat,message,body){
    const membership=store.group(account,chat);
    if(body&&(body.expectedAccount!==account||body.membershipRevision!==membership.membershipRevision))
      fail(409,'drawing_resend_session','会话身份已变化，请重新打开原图');
    const image=drawing.original(chat,account,null,'',message,1,Boolean(body));
    const eligible=image&&!image.removed&&!image.promptRemoved&&store.one('SELECT 1 FROM ai_group_roles r JOIN members m ON m.chat=r.chat AND m.account=r.ai '+
      'WHERE r.chat=? AND r.ai=? AND ? > m.since',chat,image.ai,image.original)&&sharedWith(account,chat).has(image.ai);
    if(!body)return {available:Boolean(eligible)};
    if(typeof body.clientId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/u.test(body.clientId))
      fail(400,'drawing_resend_request','重发编号无效');
    if(!eligible)fail(404,'drawing_resend_unavailable','这张原图已不可重发');
    const sent=drawing.resendOriginal(account,chat,image,body.clientId);
    return {messageId:sent.id,removed:sent.removed};
  }
  function cancelStale(){
    for(const {job,controller} of active)if(!current(job)){
      store.run("UPDATE ai_group_turns SET state='failed' WHERE prompt=? AND state='pending'",job.id);
      controller.abort();
    }
  }
  return {view,setMember,setCard,setLorebook,setSharing,setContextSharing,setDrawing,drawingResend,stage,finish,cancelStale};
}
module.exports={createAiGroup};
