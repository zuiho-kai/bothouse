'use strict';

const {createHash,randomBytes,randomUUID}=require('node:crypto');
const {fail,number,string}=require('./store.cjs');
const {AI_NUMBER,AI_DRAGON_NUMBER,AI_JU_NUMBER,providerForRole}=require('./ai-roles.cjs');
const {bindAi}=require('./ai-adapter.cjs');
const {aiBudget}=require('./ai-budget.cjs');
const {modelContext,attachmentAddress}=require('./model-context.cjs');
const {createOpenAIGroupProvider}=require('./ai-openai.cjs');
const {createDeepSeekProvider}=require('./ai-deepseek.cjs');
const {createClaudeProvider}=require('./ai-claude.cjs');
const {speechRequest,speechAllowed}=require('./ai-voice.cjs');
const {reviewedCard,reviewedLorebook,groupReplyContext}=require('./group-card.cjs');
const {decodePortrait}=require('../../src/core/group-drawing-portrait.cjs');
const {spokenGroupReply}=require('../../src/bot/group-spoken-dialogue.cjs');

const factories=new Map([[AI_NUMBER,createDeepSeekProvider],[AI_DRAGON_NUMBER,createOpenAIGroupProvider],[AI_JU_NUMBER,createClaudeProvider]]);
const grantError=()=>fail(409,'personal_ai_changed','个人 AI 或群授权已变化，请重新打开设置');
function createPersonalAi(store,fetchImpl,voiceReplies){
  // Credentials stay in the private service process. Persistent rows contain identity and grant revisions only.
  const connections=new Map(),active=new Map();
  const byOwner=owner=>store.one('SELECT * FROM personal_ai WHERE owner=?',owner);
  const byId=ai=>store.one('SELECT * FROM personal_ai WHERE ai=?',ai);
  const friendPolicy=ai=>store.one('SELECT discoverable,guest_cloud,revision FROM personal_ai_friend_settings WHERE ai=?',ai);
  function friendSettings(account){
    const own=byOwner(account);
    if(!own)return null;
    const policy=friendPolicy(own.ai);
    return {number:own.ai,discoverable:!!policy?.discoverable,guestCloud:!!policy?.guest_cloud,revision:policy?.revision??null};
  }
  function pausePrivate(ai,exclude=''){
    store.run(`INSERT INTO ai_direct_permissions(chat,enabled,revision,context_floor)
      SELECT g.chat,0,coalesce(p.revision,0)+1,coalesce(p.context_floor,0)
      FROM ai_direct_grants g LEFT JOIN ai_direct_permissions p ON p.chat=g.chat
      WHERE g.ai=? AND g.human<>?
      ON CONFLICT(chat) DO UPDATE SET enabled=0,revision=excluded.revision`,ai,exclude);
  }
  function saveFriendSettings(account,body){
    verifiedActor(account,body);
    const saved=friendSettings(account);
    if(!saved||saved.number!==body.number||saved.revision!==body.revision||
      typeof body.discoverable!=='boolean'||typeof body.guestCloud!=='boolean'||body.guestCloud&&!body.discoverable)grantError();
    if(saved.discoverable===body.discoverable&&saved.guestCloud===body.guestCloud)return saved;
    store.run(`INSERT INTO personal_ai_friend_settings VALUES(?,?,?,?)
      ON CONFLICT(ai) DO UPDATE SET discoverable=excluded.discoverable,guest_cloud=excluded.guest_cloud,revision=excluded.revision`,
    saved.number,Number(body.discoverable),Number(body.guestCloud),randomUUID());
    if(saved.guestCloud&&!body.guestCloud)pausePrivate(saved.number,account);
    return friendSettings(account);
  }
  function friendAvailability(account,ai){
    const row=byId(ai);
    return row?(row.owner===account?'owner':friendPolicy(ai)?.discoverable?'public':'private'):null;
  }
  function privateAccess(account,ai){
    const row=byId(ai);
    if(!row)return null;
    const policy=friendPolicy(ai), owner=row.owner===account;
    const directProfile=profile(ai,true);
    return {provider:providerForRole.get(row.role),adapter:connections.get(ai),allowed:owner||!!policy?.guest_cloud,
      profile:directProfile,revision:JSON.stringify([row.revision,owner?null:policy?.revision??null,directProfile.profileRevision])};
  }
  const profileTable=direct=>direct?'personal_ai_private_profiles':'personal_ai_public_profiles';
  function profile(ai,direct=false){
    const saved=store.one('SELECT * FROM '+profileTable(direct)+' WHERE ai=?',ai);
    return {card:saved?.card?JSON.parse(saved.card):null,lorebook:saved?.lorebook?JSON.parse(saved.lorebook):null,
      profileRevision:saved?.revision??null};
  }
  function publicProfile(account,direct=false){
    const own=byOwner(account);
    if(!own)return null;
    const setting=profile(own.ai,direct);
    const png=direct&&setting.card&&store.one('SELECT png FROM personal_ai_private_portraits WHERE ai=?',own.ai)?.png;
    return {number:own.ai,owner:own.owner,displayName:store.user(own.ai).displayName,...setting,
      ...(direct&&{portraitApproved:!!png,portraitPreview:png?Buffer.from(png).toString('base64'):null})};
  }
  function saveProfile(account,body,direct=false){
    verifiedActor(account,body);
    const saved=publicProfile(account,direct);
    if(!saved||saved.number!==body.number||saved.profileRevision!==body.expectedRevision)grantError();
    const changingCard=Object.hasOwn(body,'card');
    const hasPortrait=Object.hasOwn(body,'portrait');
    if(changingCard===Object.hasOwn(body,'lorebook')||hasPortrait&&(!direct||!changingCard))grantError();
    const card=changingCard?reviewedCard(body.card):saved.card;
    const lorebook=changingCard?saved.lorebook:reviewedLorebook(body.lorebook);
    let portrait;
    if(hasPortrait){
      if(!card)fail(400,'private_card_portrait','请先选择私聊角色卡');
      try{portrait=decodePortrait(body.portrait);}
      catch{fail(400,'private_card_portrait','这张卡面无法使用，请从本机角色库重新选择');}
    }
    const samePortrait=!changingCard||(portrait?body.portrait===saved.portraitPreview:!saved.portraitApproved);
    if(samePortrait&&JSON.stringify(card)===JSON.stringify(saved.card)&&JSON.stringify(lorebook)===JSON.stringify(saved.lorebook))return saved;
    store.run(`INSERT INTO ${profileTable(direct)}(ai,card,lorebook,revision) VALUES(?,?,?,?)
      ON CONFLICT(ai) DO UPDATE SET card=excluded.card,lorebook=excluded.lorebook,revision=excluded.revision`,
    saved.number,card?JSON.stringify(card):null,lorebook?JSON.stringify(lorebook):null,randomUUID());
    if(direct&&changingCard){
      store.run('DELETE FROM personal_ai_private_portraits WHERE ai=?',saved.number);
      if(portrait)store.run('INSERT INTO personal_ai_private_portraits VALUES(?,?)',saved.number,portrait);
    }
    if(direct)store.run(`UPDATE ai_direct_permissions SET revision=revision+1,
      context_floor=max(context_floor,(SELECT coalesce(max(id),0) FROM messages WHERE chat=ai_direct_permissions.chat))
      WHERE chat IN (SELECT chat FROM ai_direct_grants WHERE ai=?) AND enabled=1`,saved.number);
    return publicProfile(account,direct);
  }
  function identity(row){
    return row&&{...store.user(row.ai),owner:row.owner,role:row.role,provider:providerForRole.get(row.role),
      configured:connections.has(row.ai),revision:row.revision};
  }
  function verifiedActor(account,body){
    if(body.expectedAccount!==account)fail(403,'personal_ai_account','请在当前账号确认个人 AI');
  }
  function ownerVoiceRole(account){
    const row=byOwner(account);
    return row&&{number:row.ai,displayName:store.user(row.ai).displayName,voiceOwner:account};
  }
  function voiceRoles(account,chat){
    return room(account,chat).roles.filter(row=>row.state==='joined'&&row.configured&&row.sharing)
      .map(({number,displayName,owner})=>({number,displayName,voiceOwner:owner}));
  }
  function save(account,body){
    verifiedActor(account,body);
    let row=byOwner(account);
    if((row?.revision??null)!==body.revision)grantError();
    if(body.action==='withdraw'&&row){
      store.run('DELETE FROM personal_ai_invitations WHERE owner=?',account);
      store.run('UPDATE personal_ai SET revision=? WHERE owner=?',randomUUID(),account);
      pausePrivate(row.ai);
      store.run('UPDATE personal_ai_friend_settings SET guest_cloud=0,revision=? WHERE ai=? AND guest_cloud=1',randomUUID(),row.ai);
      connections.delete(row.ai);
    }else if(body.action==='bind'){
      const role=number(body.role),factory=factories.get(role);
      if(!factory||(row&&role!==row.role))grantError();
      if(typeof body.key!=='string'||!/^\S{1,2048}$/u.test(body.key))fail(400,'personal_ai_key','请填写此服务商的 API key');
      const provider=factory(body.key,{fetchImpl});
      if(!row){
        const ai='ai_'+randomBytes(10).toString('hex');
        const name=string(body.name,48,'AI 昵称');
        store.register(ai,name,'ai',null);
        store.run('INSERT INTO personal_ai VALUES(?,?,?,?)',account,ai,role,randomUUID());
        row=byOwner(account);
      }else store.run('UPDATE personal_ai SET revision=? WHERE owner=?',randomUUID(),account);
      connections.set(row.ai,provider);
    }else grantError();
    return identity(byOwner(account));
  }
  const requests=chat=>store.all('SELECT owner,ai,state,revision FROM personal_ai_invitations WHERE chat=? ORDER BY rowid',chat);
  function room(account,chat){
    const group=store.group(account,chat);
    const roles=requests(chat).filter(r=>r.state==='joined'||r.owner===account||group.owner===account).map(r=>{
      const {revision:binding,...publicRole}=identity(byId(r.ai));
      const grant=store.one('SELECT revision FROM ai_group_role_consents WHERE chat=? AND human=? AND ai=?',chat,account,r.ai);
      return {...publicRole,state:r.state,revision:r.revision,sharing:!!grant,sharingRevision:grant?.revision??null};
    });
    return {mine:identity(byOwner(account))??null,canManage:group.owner===account,roles};
  }
  function edit(account,chat,body){
    verifiedActor(account,body);
    const group=store.group(account,chat),ai=number(body.number),row=byId(ai);
    if(!row)grantError();
    const invite=store.one('SELECT * FROM personal_ai_invitations WHERE chat=? AND ai=?',chat,ai);
    const own=row.owner===account,manage=group.owner===account;
    if(body.action==='invite'){
      if(!own||!connections.has(ai)||body.revision!==row.revision||invite)grantError();
      store.run('INSERT INTO personal_ai_invitations VALUES(?,?,?,?,?)',chat,account,ai,'pending',randomUUID());
    }else{
      if(!invite||invite.revision!==body.revision)grantError();
      if(body.action==='remove'&&(own||manage)){
        store.run('DELETE FROM personal_ai_invitations WHERE chat=? AND ai=?',chat,ai);
      }else if(body.action==='accept'&&manage&&invite.state==='pending'&&connections.has(ai)){
        if(store.one('SELECT count(*) AS n FROM members WHERE chat=?',chat).n>=100)fail(409,'group_full','群成员上限为 100 人');
        const since=store.one('SELECT coalesce(max(id),0) AS id FROM messages WHERE chat=?',chat).id;
        store.run('INSERT INTO members VALUES(?,?,?)',chat,ai,since);
        const revision=randomUUID();
        store.run('INSERT INTO ai_group_roles VALUES(?,?,?)',chat,ai,revision);
        store.run("UPDATE personal_ai_invitations SET state='joined',revision=? WHERE chat=? AND ai=?",revision,chat,ai);
      }else if(body.action==='share'&&invite.state==='joined'&&typeof body.enabled==='boolean'){
        const provider=providerForRole.get(row.role);
        if(body.provider!==provider||body.enabled&&!connections.has(ai))grantError();
        const grant=store.one('SELECT revision FROM ai_group_role_consents WHERE chat=? AND human=? AND ai=?',chat,account,ai);
        if((grant?.revision??null)!==body.sharingRevision)grantError();
        if(body.enabled)store.run('INSERT OR IGNORE INTO ai_group_role_consents VALUES(?,?,?,?,?)',chat,account,ai,provider,randomUUID());
        else store.run('DELETE FROM ai_group_role_consents WHERE chat=? AND human=? AND ai=?',chat,account,ai);
      }else grantError();
    }
    return room(account,chat);
  }
  function route(chat,human,ai){
    return store.one(`SELECT p.role,p.revision AS binding,i.revision AS invitation,s.revision AS consent
      FROM personal_ai p JOIN personal_ai_invitations i ON i.owner=p.owner AND i.ai=p.ai
      JOIN ai_group_role_consents s ON s.chat=i.chat AND s.ai=i.ai
      WHERE i.chat=? AND s.human=? AND i.ai=? AND i.state='joined'`,chat,human,ai);
  }
  function jobFor(account,message){
    const chat=message.conversationId,ai=message.mention?.number;
    if(!ai||!connections.has(ai)||message.sender.number!==account||message.sender.kind!=='human'||message.attachment||message.removed||
       attachmentAddress.test(message.text)||!modelContext(store,chat).allows(message))return null;
    const grant=route(chat,account,ai);
    if(!grant)return null;
    const {owner}=byId(ai);
    const voice=voiceReplies.selection(chat,account,ai,owner);
    return {chat,account,ai,id:message.id,text:message.text,owner,voice,profile:profile(ai),...grant};
  }
  function offerRevision(job){
    return createHash('sha256').update(JSON.stringify([job.chat,job.id,job.account,job.ai,job.binding,job.invitation,job.consent,
      job.voice.revision,job.profile.profileRevision,'azure'])).digest('hex');
  }
  function reserve(job, retry=false){
    const started=Date.now(),limited=aiBudget(store,job.chat,started);
    if(limited&&retry)fail(429,'personal_voice_busy','群内 AI 暂时无法接话，可以稍后从这条消息继续');
    store.run('INSERT INTO ai_group_turns VALUES(?,?,?,?)',job.id,job.chat,limited?'failed':'pending',limited?null:started);
    return limited?null:job;
  }
  // Adapted from Bothouse cwip_bot.py _on_message: only directly mentioned bots receive human text.
  // Friends binds continuation to the original message, role and consent revisions.
  function stage(account,message){
    const job=jobFor(account,message);
    if(!job)return null;
    if(job.voice.available&&!job.voice.allowed&&!job.voice.blocked&&speechAllowed(job.text)&&
      speechRequest(job.role,message.mention.displayName,job.text).explicit){
      store.run('INSERT INTO personal_voice_offers VALUES(?,?)',job.id,offerRevision(job));
      return null;
    }
    return reserve(job);
  }
  function offeredJob(account,message){
    if(message.sender.number!==account||message.removed||!message.mention)return null;
    const offer=store.one('SELECT revision FROM personal_voice_offers WHERE prompt=?',message.id);
    if(!offer)return null;
    const job=jobFor(account,message);
    return job?.voice.available&&!job.voice.blocked&&offer.revision===offerRevision(job)?{job,revision:offer.revision}:null;
  }
  function withVoiceOffer(account,message){
    const offer=offeredJob(account,message);
    return offer?{...message,personalVoiceOffer:{revision:offer.revision,provider:'azure'}}:message;
  }
  function resumeVoice(account,chat,prompt,body){
    const member=store.group(account,chat);
    verifiedActor(account,body);
    const original=store.one('SELECT * FROM messages WHERE chat=? AND id=? AND id>? AND sender=? AND removed=0',
      chat,prompt,member.since??0,account);
    if(!original)fail(404,'personal_voice_prompt','找不到你在本群的这条请求');
    const message=store.message(original);
    if(store.one('SELECT 1 FROM ai_group_turns WHERE prompt=?',prompt))return {message};
    const offer=offeredJob(account,message);
    if(!offer||offer.revision!==body.revision||!['room','remember','text'].includes(body.action))grantError();
    const {job}=offer;
    if(body.action==='text')job.textOnly=true;
    else{
      voiceReplies.allowFromMessage(chat,account,job.ai,job.voice,body.action==='remember');
      job.voice=voiceReplies.selection(chat,account,job.ai,job.owner);
    }
    const personalTurn=reserve(job,true);
    store.run('DELETE FROM personal_voice_offers WHERE prompt=?',prompt);
    return {message,personalTurn};
  }
  function current(job){
    const grant=route(job.chat,job.account,job.ai);
    return connections.has(job.ai)&&grant?.binding===job.binding&&grant.invitation===job.invitation&&grant.consent===job.consent&&
      (store.one('SELECT revision FROM personal_ai_public_profiles WHERE ai=?',job.ai)?.revision??null)===job.profile.profileRevision&&
      store.one("SELECT 1 FROM ai_group_turns t JOIN messages m ON m.id=t.prompt WHERE t.prompt=? AND m.chat=? AND m.removed=0 AND t.state='pending'",job.id,job.chat);
  }
  function cancelStale(){
    for(const [job,{controller,voiceController}] of active){
      if(!current(job)){
        store.run("UPDATE ai_group_turns SET state='failed' WHERE prompt=? AND state='pending'",job.id);
        controller.abort();
      }else if(job.voice.allowed&&!voiceReplies.voiceCurrent(job.chat,job.account,job.ai,job.voice,job.owner)){
        voiceController.abort();
      }
    }
  }
  async function finish(job){
    const controller=new AbortController();
    const voiceController=new AbortController();
    active.set(job,{controller,voiceController});
    try{
      const assertCurrent=()=>{if(!current(job))throw Error('grant changed');};
      assertCurrent();
      const bot=bindAi(store,job.ai,job.chat);
      const clientId='ai-reply-'+job.id;
      const privacy=modelContext(store,job.chat);
      const {context,cardName,hasGroupLorebook}=groupReplyContext(job.profile,job.text,privacy,bot.identity.displayName);
      context.push({role:'user',content:job.text});
      const {text,voice}=await voiceReplies.reply({
        bot:bot.identity,chat:job.chat,human:job.account,input:job.text,signal:controller.signal,
        canShareSpeech:text=>modelContext(store,job.chat).allows({text}),assertCurrent,
        personal:{role:job.role,owner:job.owner,saved:job.voice,textOnly:job.textOnly,
          signal:AbortSignal.any([controller.signal,voiceController.signal])},
      },async()=>{
        assertCurrent();
        const text=await connections.get(job.ai).generate(context,{groupRole:job.role,signal:controller.signal,
          hasGroupCard:true,hasGroupLorebook,personalProfile:true});
        return spokenGroupReply(text,cardName,job.text);
      });
      assertCurrent();
      const answered=reply=>{
        assertCurrent();
        store.run('INSERT INTO ai_group_reply_links VALUES(?,?,?,?)',reply.id,job.id,job.invitation,job.consent);
        store.run("UPDATE ai_group_turns SET state='answered' WHERE prompt=?",job.id);
      };
      return voice&&voiceReplies.voiceCurrent(job.chat,job.account,job.ai,job.voice,job.owner)?
        bot.sendVoice(clientId,voice,text,answered):bot.send({clientId,text},answered);
    }catch{
      store.run("UPDATE ai_group_turns SET state='failed' WHERE prompt=? AND state='pending'",job.id);
      return null;
    }finally{active.delete(job);}
  }
  return {mine:account=>identity(byOwner(account))??null,save,room,edit,stage,finish,cancelStale,ownerVoiceRole,voiceRoles,
    withVoiceOffer,resumeVoice,publicProfile,saveProfile,friendSettings,saveFriendSettings,friendAvailability,privateAccess};
}
module.exports={createPersonalAi};
