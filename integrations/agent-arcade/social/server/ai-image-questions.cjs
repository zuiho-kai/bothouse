'use strict';

const {randomUUID}=require('node:crypto');
const {fail,number,string}=require('./store.cjs');
const {bindAi}=require('./ai-adapter.cjs');
const {aiBudget}=require('./ai-budget.cjs');
const {AI_JU_NUMBER,providerForRole}=require('./ai-roles.cjs');
const {modelPhoto}=require('../../src/core/static-image.cjs');
const {spokenGroupReply}=require('../../src/bot/group-spoken-dialogue.cjs');
const {modelContext}=require('./model-context.cjs');
const {groupReplyContext}=require('./group-card.cjs');

function createImageQuestions(store,providers){
  const catalog=new Map();
  for(const provider of providers)for(const role of provider?.groupRoles??[])catalog.set(role.number,provider);
  store.run("UPDATE ai_image_turns SET state='failed' WHERE state='pending'");

  function photo(account,chat,id){
    const membership=store.access(account,chat);
    const image=store.one(`SELECT m.sender AS author,i.mime FROM message_images i
      JOIN messages m ON m.id=i.message JOIN users u ON u.number=m.sender
      JOIN members author ON author.chat=m.chat AND author.account=m.sender AND m.id>author.since
      WHERE m.chat=? AND m.id=? AND m.id>? AND m.removed=0 AND u.kind='human'
      AND i.mime IN ('image/png','image/jpeg')`,chat,id,membership.since);
    if(!image)fail(404,'vision_image','图片已撤回或当前无法查看');
    return {...image,group:membership.type==='group'};
  }

  function roles(account,chat,id,claudeUi){
    const image=photo(account,chat,id);
    const rows=image.group?store.all(`SELECT r.ai AS number,u.name AS displayName,r.revision AS roleRevision,
      s.revision AS consentRevision,s.provider AS consentProvider FROM ai_group_roles r JOIN users u ON u.number=r.ai
      LEFT JOIN ai_group_role_consents s ON s.chat=r.chat AND s.ai=r.ai AND s.human=? WHERE r.chat=?`,account,chat):
      store.all(`SELECT u.number,u.name AS displayName FROM members m JOIN users u ON u.number=m.account
        WHERE m.chat=? AND u.kind='ai'`,chat);
    const owner=image.author===account;
    const direct=!image.group&&store.directAiConsent(account,chat);
    return {owner,group:image.group,roles:rows.filter(row=>claudeUi||row.number!==AI_JU_NUMBER).map(row=>{
      const provider=providerForRole.get(row.number);
      const approved=image.group&&store.one('SELECT revision FROM image_ai_permissions WHERE image=? AND ai=? AND provider=?',id,row.number,provider)?.revision;
      const configured=typeof catalog.get(row.number)?.describeImage==='function';
      const consent=image.group?row.consentProvider===provider&&row.consentRevision:
        direct?.ai===row.number&&direct.enabled&&String(direct.revision);
      return {number:row.number,displayName:row.displayName,provider,configured,consented:!!consent,
        authorAllowed:!!approved,canAsk:!!(configured&&consent&&(owner||approved)),
        roleRevision:row.roleRevision,revision:JSON.stringify([row.roleRevision,consent,owner?null:approved])};
    })};
  }

  function roleFor(account,chat,id,body,claudeUi){
    if(body.expectedAccount!==account)fail(409,'vision_account','账号已切换，请重新打开图片');
    const view=roles(account,chat,id,claudeUi);
    const role=view.roles.find(row=>row.number===number(body.number)&&row.provider===body.provider);
    if(!role)fail(409,'vision_role','这位角色或它使用的服务已变化');
    return {role,view};
  }

  function permission(account,chat,id,body,claudeUi){
    const {role,view}=roleFor(account,chat,id,body,claudeUi);
    if(!view.owner||!view.group)fail(403,'vision_author','只有群内图片作者可以更改授权');
    if(typeof body.enabled!=='boolean')fail(400,'vision_permission','请选择允许或撤销');
    if(body.enabled&&!role.configured)fail(409,'vision_unsupported','这位角色现在无法看图');
    if(body.enabled)store.run('INSERT OR IGNORE INTO image_ai_permissions VALUES(?,?,?,?)',id,role.number,role.provider,randomUUID());
    else store.run('DELETE FROM image_ai_permissions WHERE image=? AND ai=? AND provider=?',id,role.number,role.provider);
    return roles(account,chat,id,claudeUi);
  }

  function allowed(account,chat,id,role,claudeUi){
    const current=roles(account,chat,id,claudeUi).roles.find(row=>row.number===role.number);
    if(!current?.configured)fail(409,'vision_unsupported','这位角色的当前服务无法看图');
    if(!current.consented)fail(403,'vision_consent','请先同意这位角色在本会话使用云聊天');
    if(!current.canAsk)fail(403,'vision_author','图片作者还未允许这位角色看图');
    if(current.revision!==role.revision)fail(409,'vision_changed','看图授权已变化，请重新打开图片');
  }

  function stage(account,chat,id,body,claudeUi){
    const {role,view}=roleFor(account,chat,id,body,claudeUi);
    const text=string(body.text,500,'图片问题');
    let job;
    const message=store.send(account,chat,{clientId:body.clientId,text,...(view.group&&{mentionAccount:role.number})},row=>{
      allowed(account,chat,id,{...role,revision:body.revision},claudeUi);
      const started=Date.now(), limit=aiBudget(store,chat,started);
      if(limit)fail(429,'vision_'+limit,limit==='busy'?'正在等 AI 回复，请稍后再问':'今天的 AI 聊天次数已用完');
      store.run("INSERT INTO ai_image_turns(prompt,chat,image,ai,started,state) VALUES(?,?,?,?,?,'pending')",
        row.id,chat,id,role.number,started);
      job={account,chat,id,role,claudeUi,text,prompt:row.id};
    });
    const turn=store.one('SELECT image,ai,reply,state FROM ai_image_turns WHERE prompt=?',message.id);
    if(!turn||turn.image!==Number(id)||turn.ai!==role.number)fail(409,'message_conflict','此编号已被使用');
    return {message,job,...(turn.state==='failed'&&{visionError:'这次没有收到有效的看图回复。'}),
      ...(turn.reply&&{reply:store.message(store.one('SELECT * FROM messages WHERE id=?',turn.reply))})};
  }

  function imageContext(chat,role,text){
    if(!role.roleRevision)return {};
    const snapshot=store.one(`SELECT c.projection AS card,b.projection AS lorebook
      FROM ai_group_roles r LEFT JOIN ai_group_cards c ON c.chat=r.chat AND c.ai=r.ai
      LEFT JOIN ai_group_lorebooks b ON b.chat=r.chat AND b.ai=r.ai
      WHERE r.chat=? AND r.ai=? AND r.revision=?`,chat,role.number,role.roleRevision);
    if(!snapshot)fail(409,'vision_changed','群角色资料已变化，请重新打开图片');
    const {context,cardName,hasGroupLorebook}=groupReplyContext({
      card:snapshot.card&&JSON.parse(snapshot.card),lorebook:snapshot.lorebook&&JSON.parse(snapshot.lorebook),
    },text,modelContext(store,chat));
    return {context,cardName,groupRole:role.number,hasGroupCard:!!cardName,hasGroupLorebook};
  }

  async function finish(job){
    const {account,chat,id,role,claudeUi,text,prompt}=job;
    const assertCurrent=()=>{
      allowed(account,chat,id,role,claudeUi);
      if(!store.one(`SELECT 1 FROM ai_image_turns t JOIN messages m ON m.id=t.prompt
        WHERE t.prompt=? AND t.state='pending' AND m.removed=0`,prompt))
        fail(409,'vision_changed','这个看图问题已失效');
    };
    try{
      assertCurrent();
      const image=store.messageImage(account,chat,id);
      let bytes;
      try{bytes=modelPhoto(Buffer.from(image.bytes),image.mime);}
      catch{fail(422,'vision_image_format','这张图片无法安全准备给 AI，请换一张静态 PNG 或 JPEG');}
      const {cardName,...context}=imageContext(chat,role,text);
      const result=await catalog.get(role.number).describeImage(text,{mime:image.mime,bytes},context);
      const reply=cardName?spokenGroupReply(result,cardName,text):result;
      assertCurrent();
      const bot=bindAi(store,role.number,chat);
      return {reply:bot.send({clientId:'ai-image-'+prompt,text:string(reply,4000,'AI 看图回复')},row=>{
        assertCurrent();
        store.run("UPDATE ai_image_turns SET state='answered',reply=? WHERE prompt=?",row.id,prompt);
      })};
    }catch(error){
      store.run("UPDATE ai_image_turns SET state='failed' WHERE prompt=? AND state='pending'",prompt);
      return {visionError:error.status?error.message:'这次没有收到有效的看图回复。'};
    }
  }

  return {roles,permission,stage,finish};
}

module.exports={createImageQuestions};
