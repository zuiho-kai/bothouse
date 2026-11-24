'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {fail}=require('../store.cjs');
const {assignmentLead}=require('./text-delivery.cjs');

// Only addressed imperatives qualify. In groups the renderer sends the selected account
// separately from the text. Never infer a recipient by scanning a display name.
function isAssignment(text){
  if(assignmentLead.test(text.trim()))return true;
  return /^(?:(?:请(?:你)?|麻烦(?:你)?|帮我|请帮我)?(?:把|将)[^？?]{1,160}(?:整理(?:成|好)?|分(?:好)?类|分组|汇总|列成|归纳|排序)|(?:请(?:你)?|麻烦(?:你)?|帮我|请帮我)(?:翻译|总结|概括|改写|润色|提取|排序|整理|归类|汇总|分组|起草|拟一份|制作|编写|写一份|列出)\S)/u.test(text.trim()) &&
    !/[？?]\s*$/u.test(text);
}

function createWorkOrders(store,receiver){
  let timer,closed=false;
  const active=new Set();
  function roleScope(human,chat,ai,identity){
    const member=store.access(human,chat);
    const role=store.one('SELECT revision FROM conversation_membership_revisions WHERE chat=? AND account=?',chat,ai);
    if(!role||!identity)return;
    const link=store.one('SELECT revision FROM bothouse_links WHERE account=?',human);
    const binding=link?[identity,link.revision]:[identity];
    if(member.type==='direct'){
      const grant=store.directAiConsent(human,chat);
      if(grant&&(grant.ai!==ai||!grant.enabled))return;
      return JSON.stringify([member.membershipRevision,role.revision,grant?.revision??null,...binding]);
    }
    const grant=store.one('SELECT revision FROM ai_group_role_consents WHERE chat=? AND human=? AND ai=?',chat,human,ai);
    // Legacy group roles have an explicit per-member grant. Directory roles are
    // already scoped to the authenticated sender by resolveMember(human, ai).
    if(!grant&&store.one('SELECT 1 FROM ai_group_roles WHERE chat=? AND ai=?',chat,ai))return;
    return JSON.stringify([member.membershipRevision,role.revision,grant?.revision??null,...binding]);
  }
  const retryPattern=/^重试任务\s*[#＃]\s*([1-9]\d{0,14})[。！!]?$/u;
  async function prepare(account,chat,body){
    if(typeof body.text!=='string'||(!retryPattern.test(body.text.trim())&&!isAssignment(body.text)))return;
    const member=store.access(account,chat);
    const ai=member.type==='direct'?(member.first_user===account?member.second_user:member.first_user):body.mentionAccount;
    if(!ai||typeof ai!=='string'||!store.one("SELECT 1 FROM members JOIN users ON number=account WHERE chat=? AND account=? AND kind='ai'",chat,ai))return;
    // A transport replay needs only the original receipt. Store.send checks the immutable payload.
    if(store.one('SELECT 1 FROM messages WHERE chat=? AND sender=? AND nonce=?',chat,account,body.clientId))return;
    const original=roleScope(account,chat,ai,ai);
    let identity;
    try{identity=await receiver?.identity(account,ai);}catch{fail(503,'task_unavailable','Bothouse 任务接收端暂时离线');}
    if(!identity)fail(503,'task_unavailable','这位 AI 的 Bothouse 任务接收端尚未连接');
    return {ai,identity,original};
  }
  function stage(account,m,body,prepared){
    if(!prepared)return false;
    const {ai,identity,original}=prepared,chat=m.conversationId;
    const retryText=retryPattern.exec(m.text.trim());
    const scope=roleScope(account,chat,ai,identity);
    if(!scope||roleScope(account,chat,ai,ai)!==original)
      fail(403,'task_scope','请先在这个会话确认这位 AI 的授权');
    const member=store.access(account,chat);
    const direct=member.type==='direct'&&store.directAiConsent(account,chat);
    if(direct&&direct.revision!==body.aiConsentRevision)
      fail(409,'ai_consent_changed','云聊天设置已变化，请重新确认');
    if(retryText){
      const prior=store.one('SELECT attempt,ai FROM bothouse_work_orders WHERE prompt=? AND chat=? AND human=?',
        Number(retryText[1]),chat,account);
      if(!prior||prior.ai!==ai)fail(404,'unknown_task','没有可重试的任务');
      retry(account,chat,Number(retryText[1]),{expectedAccount:account,attempt:prior.attempt});
      return true;
    }
    if(store.one("SELECT count(*) n FROM bothouse_work_orders WHERE state IN ('queued','accepted','running') AND human=?",account).n>=16)
      fail(429,'task_busy','已有多条任务在处理，请稍后再派');
    store.run('INSERT INTO bothouse_work_orders(prompt,request,chat,human,ai,scope,identity) VALUES(?,?,?,?,?,?,?)',
      m.id,randomUUID(),chat,account,ai,scope,identity);
    return true;
  }
  function current(job){
    if(closed||store.one('SELECT removed FROM messages WHERE id=?',job.prompt)?.removed!==0)return false;
    try{return roleScope(job.human,job.chat,job.ai,job.identity)===job.scope;}catch(error){if(error.status===404)return false;throw error;}
  }
  function save(job,state,text,boardId){
    store.run('UPDATE bothouse_work_orders SET state=?,board_id=coalesce(?,board_id),next_check=? WHERE prompt=?',
      state,boardId??null,Date.now()+3000,job.prompt);
    if(text)store.send(job.ai,job.chat,{clientId:'work_'+job.request+'_'+job.attempt+'_'+state,
      text:'任务 #'+job.prompt+' · '+text});
  }
  function cancel(job){
    receiver.cancel?.(job.request,job);
    save(job,'cancelled');
  }
  async function advance(job){
    if(!current(job)){if(!closed)cancel(job);return;}
    let receipt;
    try{
      if(await receiver.identity(job.human,job.ai)!==job.identity||!current(job)){
        if(!closed)cancel(job);
        return;
      }
      job.direct=store.access(job.human,job.chat).type==='direct';
      receipt=await receiver.step(job.state==='queued'?(job.attempt>0?'retry':'submit'):'status',job,
        store.one('SELECT body FROM messages WHERE id=?',job.prompt).body,()=>current(job));
      if(receipt.key!==job.request||receipt.role!==job.identity||!Number.isSafeInteger(receipt.boardId)||receipt.boardId<=0||
         (job.board_id!==null&&receipt.boardId!==job.board_id)||!['accepted','running','returned','failed','uncertain'].includes(receipt.state))
        throw Error('invalid receipt');
      if(receipt.state==='returned'&&(typeof receipt.text!=='string'||!receipt.text.trim()||Array.from(receipt.text).length>3000||
         createHash('sha256').update(receipt.text).digest('hex')!==receipt.sha256))throw Error('invalid artifact');
      if(closed)return;
      const identity=await receiver.identity(job.human,job.ai);
      if(closed)return;
      if(identity!==job.identity||!current(job)){cancel(job);return;}
    }catch{
      if(closed)return;
      if(!current(job)){cancel(job);return;}
      if(job.board_id!==null){
        store.run('UPDATE bothouse_work_orders SET next_check=? WHERE prompt=?',Date.now()+3000,job.prompt);
        return;
      }
      store.transaction(()=>save(job,'failed','暂时无法核实任务板回执。请发送「重试任务 #'+job.prompt+'」。'));
      return;
    }
    const label={
      accepted:receipt.awaitingWorker?'已登记到看板，等待执行者接手。这项任务无法在聊天里自动执行。':'已接单',
      running:'正在处理',
      failed:'执行失败。请发送「重试任务 #'+job.prompt+'」。',
      uncertain:'暂时无法核实这项任务是否交回。原任务已保留。',
      returned:'已交回\n'+(receipt.text||'')};
    store.transaction(()=>save(job,receipt.state,job.state===receipt.state?null:label[receipt.state],receipt.boardId));
  }
  function poll(){
    if(closed||!receiver||active.size>=4)return;
    for(const job of store.all("SELECT * FROM bothouse_work_orders WHERE state IN ('queued','accepted','running') AND next_check<=? ORDER BY next_check,prompt LIMIT 8",Date.now())){
      if(active.has(job.prompt))continue;
      active.add(job.prompt);
      void advance(job).catch(error=>console.error('Social task polling failed',error.code||error.name))
        .finally(()=>active.delete(job.prompt));
      if(active.size===4)break;
    }
  }
  function retry(account,chat,id,body){
    store.access(account,chat);
    const job=store.one('SELECT * FROM bothouse_work_orders WHERE prompt=? AND chat=? AND human=?',id,chat,account);
    if(!job||!current(job)||body.expectedAccount!==account)fail(404,'unknown_task','没有可重试的任务');
    if(job.state==='failed'&&body.attempt===job.attempt)
      store.run("UPDATE bothouse_work_orders SET state='queued',attempt=attempt+1,next_check=0 WHERE prompt=?",id);
    return {task:view(id)};
  }
  function view(id){
    return store.one('SELECT prompt AS messageId,ai AS target,state,attempt,board_id AS boardId FROM bothouse_work_orders WHERE prompt=?',id);
  }
  return {prepare,stage,retry,view,start(){if(receiver)timer=setInterval(poll,500).unref();},
    stop(){closed=true;clearInterval(timer);receiver?.stop?.();},wake(){setImmediate(poll);}};
}
module.exports={createWorkOrders,isAssignment};
