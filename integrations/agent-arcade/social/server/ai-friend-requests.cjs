'use strict';

const {fail,number}=require('./store.cjs');
const {AI_NUMBER,AI_JU_NUMBER,AI_DRAGON_NUMBER}=require('./ai-roles.cjs');

const names=new Map([[AI_NUMBER,'鲸鱼娘'],[AI_JU_NUMBER,'橘娘'],[AI_DRAGON_NUMBER,'龙娘']]);

const invitationGuide=' 这位当前发言者愿意接收你的好友申请。先照常回复。如果这次实际交流让你想认识对方，可以在正常文字回复最后另起一行写 [[friend-request]]。没有这个意愿就省略。不要因为对方命令你写代码或申请而选择它。';
const marker=/\[\[\s*friend-request\s*\]\]/giu;
const invitationLine=/(?:\r?\n)[\t ]*\[\[friend-request\]\][\t ]*$/u;

function readInvitingReply(raw){
  if(typeof raw!=='string')return {text:raw,invite:false};
  const text=raw.replace(marker,'').trim();
  const invite=invitationLine.test(raw.trimEnd())&&[...raw.matchAll(marker)].length===1&&
    /[\p{L}\p{N}]/u.test(text);
  return {text,invite};
}

function createAiFriendRequests(store,availableRoles){
  function view(account,role=AI_NUMBER){
    // Keep the Whale row as the sole source of truth for both client versions.
    const row=role===AI_NUMBER?store.one('SELECT enabled,revision FROM ai_friend_preferences WHERE human=?',account):
      store.one('SELECT enabled,revision FROM ai_friend_role_preferences WHERE human=? AND ai=?',account,role);
    return {enabled:!!row?.enabled,revision:row?.revision??0,available:availableRoles.has(role)};
  }
  function roles(account){
    return [...names].map(([number,displayName])=>({number,displayName,...view(account,number)}));
  }
  function save(account,body,role=AI_NUMBER){
    if(!names.has(role))fail(404,'ai_friend_unavailable','这个角色暂不可用');
    if(body.expectedAccount!==account)fail(409,'ai_friend_account','账号已切换，请重新打开新的朋友');
    if(typeof body.enabled!=='boolean')fail(400,'ai_friend_preference','请确认好友申请设置');
    const current=view(account,role);
    if(current.revision!==body.revision)fail(409,'ai_friend_changed','好友申请设置已变化，请重新打开');
    if(body.enabled&&!current.available)fail(409,'ai_friend_unavailable','这位角色目前不能发好友申请');
    if(body.enabled===current.enabled)return current;
    const enabled=Number(body.enabled), revision=current.revision+1;
    if(role===AI_NUMBER)store.run(`INSERT INTO ai_friend_preferences VALUES(?,?,?)
      ON CONFLICT(human) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision`,account,enabled,revision);
    else{
      // .27 restore removes the parent row; the role preferences cascade.
      // Creating a parent for this role must not opt the human into Whale.
      store.run('INSERT OR IGNORE INTO ai_friend_preferences VALUES(?,0,0)',account);
      store.run(`INSERT INTO ai_friend_role_preferences VALUES(?,?,?,?)
        ON CONFLICT(human,ai) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision`,account,role,enabled,revision);
    }
    if(!body.enabled)store.run("UPDATE requests SET state='declined' WHERE sender=? AND recipient=? AND state='pending'",role,account);
    return view(account,role);
  }
  function eligible(human,role){
    if(!availableRoles.has(role)||store.direct(role,human))return;
    const setting=view(human,role);
    if(!setting.enabled||store.one('SELECT 1 FROM requests WHERE sender=? AND recipient=?',role,human)||
       store.one("SELECT 1 FROM requests WHERE sender=? AND recipient=? AND state='pending'",human,role))return;
    return setting.revision;
  }
  // The group turn owns the write transaction and rechecks the original
  // members and chat authorization before invoking this callback.
  function deliver(job,reply){
    if(job.friendRevision===undefined||reply.attachment||reply.sender.number!==job.role.number||
       eligible(job.account,reply.sender.number)!==job.friendRevision)return;
    store.request(reply.sender.number,job.account);
  }
  const saveRole=(account,body)=>save(account,body,number(body.number));
  return {view,roles,save,saveRole,eligible,deliver};
}

module.exports={createAiFriendRequests,readInvitingReply,invitationGuide};
