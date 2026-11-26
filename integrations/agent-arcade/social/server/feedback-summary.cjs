'use strict';
const {reviewTopics} = require('./chat-feedback-review.cjs');

// These labels describe words in voluntarily submitted feedback. They are
// neither verified defect diagnoses nor metadata about the user's chats.
const topics = [
  ['登录与账号', /登录|注册|密码|账号切换|sign[ -]?(?:in|up)|log[ -]?in|password/iu],
  ['好友与群管理', /加好友|添加朋友|好友申请|好友邀请|搜号|用户号|建群|拉群|退群|群成员|friend request|add (?:a )?friend|join (?:a )?group/iu],
  ['消息投递与回复', /发不出|发不了消息|收不到消息|没(?:有)?回复|未回复|不回(?:我|消息)|没有回应|不回复|不回话|重复(?:发送|消息)|消息重复|消息丢失|回复太慢|\b(?:no reply|duplicate message)\b/iu],
  ['回复长度与形式', /回复.{0,8}(?:太长|太短|啰嗦|截断|没说完)|(?:话|字数|篇幅)太(?:多|少|长|短)|长篇|只(?:用|要)文字|引用框|\b(?:reply length|too (?:long|short))\b/iu],
  ['草稿与未读', /草稿|未读|\b(?:unread|draft)\b/iu],
  ['搭档与角色', /接话|插话|抢答|人设|角色卡|世界书|\b(?:persona|lorebook)\b/iu],
  ['主动联系与提醒', /定时|提醒|预约|日程|通知|主动(?:聊天|提醒|发消息|联系)|\b(?:reminder|notification)\b/iu],
  ['图片与表情', /图片|照片|表情包|贴图|生图|画图|画一张|\b(?:image|photo|sticker)s?\b/iu],
  ['语音与录音', /语音|录音|麦克风|音色|转写|\b(?:voice|audio|microphone|recording)\b/iu],
  ['查找公开资料', /网页搜索|联网搜索|网络搜索|公开搜索|上网查|查官网|web search|online search/iu],
  ['安装与使用', /安装|更新失败|崩溃|黑屏|界面|卡顿|install|update fail|crash|interface/iu]
];
const oldReviewLine = /^\s*([^():]+)\s*:\s*\d+\s*条\s*[、,]\s*\d+\s*个会话\s*\(群聊\s*(\d+)\s*条\s*[、,]\s*\d+\s*个会话\s*;\s*私聊\s*(\d+)\s*条\s*[、,]\s*\d+\s*个会话\s*\)\s*$/u;
const compactReviewLine = /^\s*([^():]+?)\s*群聊\s*(\d+)\s*私聊\s*(\d+)\s*$/u;

function scopeMention(body) {
  const group = /群聊|群里|群内|群消息|群对话|\bgroup (?:chat|messages?)\b/iu.test(body);
  const direct = /私聊|私信|一对一|单聊|\b(?:direct (?:chat|messages?)|private chat|1[ -]on[ -]1)\b/iu.test(body);
  if (group && direct) return '群聊和私聊';
  if (group) return '群聊';
  if (direct) return '私聊';
  return '未说明';
}

function feedbackTopics(body) {
  const seen = new Map();
  function mark(category,scope) {
    if (category==='记忆与角色') category='搭档与角色';
    if (category==='其他 App 或搭档问题') category='其他或未归类';
    if (!seen.has(category)) seen.set(category,new Set());
    seen.get(category).add(scope);
  }
  // Review drafts use one category and one actual chat type per line. A
  // reported message count in the text is never a count of submissions.
  for (const line of body.normalize('NFKC').split(/\n/u)) {
    const review = /^\s*([^():]+)\((群聊|私聊)\)\s*:\s*[1-9]\d*\s*条\s*[、,]\s*[1-9]\d*\s*个会话\s*$/u.exec(line);
    if (review && reviewTopics.has(review[1].trim())) {
      mark(review[1].trim(),review[2]);
      continue;
    }
    // Earlier review drafts included both chat types even for zero counts.
    const previous = oldReviewLine.exec(line)??compactReviewLine.exec(line);
    if (previous && reviewTopics.has(previous[1].trim())) {
      if (Number(previous[2])>0) mark(previous[1].trim(),'群聊');
      if (Number(previous[3])>0) mark(previous[1].trim(),'私聊');
      continue;
    }
    for (const sentence of line.split(/[。!?;]+/u)) {
      let leadingScope='未说明';
      for (const clause of sentence.split(/[,，]/u)) {
        const labels=topics.filter(([,pattern])=>pattern.test(clause)).map(([name])=>name);
        const scope=scopeMention(clause);
        if (labels.length) {
          for (const category of labels) mark(category,scope==='未说明'?leadingScope:scope);
          leadingScope='未说明';
        } else {
          leadingScope=scope;
        }
      }
    }
  }
  if (!seen.size) mark('其他或未归类','未说明');
  return [...seen].map(([category,scopes])=>{
    const group=scopes.has('群聊'), direct=scopes.has('私聊');
    const scope=scopes.has('群聊和私聊')||group&&direct?'群聊和私聊':group?'群聊':direct?'私聊':'未说明';
    return {category,scope};
  });
}

function tally() {
  return {submissions:0, accounts:new Set()};
}

function add(totals,account) {
  totals.submissions++;
  if (account) totals.accounts.add(account);
}

function counts(totals) {
  return {submissions:totals.submissions,submitters:totals.accounts.size};
}

function summarizeFeedback(db) {
  const hasDesktopVersions = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='feedback_desktop_versions'").get();
  const desktopVersion = hasDesktopVersions
    ? '(SELECT desktop_version FROM feedback_desktop_versions WHERE feedback_id=feedback.id)'
    : 'NULL';
  const rows = db.prepare(`SELECT account,body,client_build AS clientBuild,${desktopVersion} AS desktopVersion FROM feedback`);
  const total = tally();
  const categories = new Map();
  for (const row of rows.iterate()) {
    add(total,row.account);
    const clientBuild = /^[a-f0-9]{64}$/u.test(row.clientBuild) ? row.clientBuild : null;
    const desktop = /^\d{1,5}(?:\.\d{1,5}){3}$/u.test(row.desktopVersion) ? row.desktopVersion : null;
    const version = JSON.stringify([clientBuild,desktop]);
    for (const {category,scope} of feedbackTopics(row.body)) {
      if (!categories.has(category)) categories.set(category,{...tally(),scopes:new Map()});
      const categoryTotal = categories.get(category);
      add(categoryTotal,row.account);
      if (!categoryTotal.scopes.has(scope)) categoryTotal.scopes.set(scope,{...tally(),versions:new Map()});
      const scopeTotal = categoryTotal.scopes.get(scope);
      add(scopeTotal,row.account);
      if (!scopeTotal.versions.has(version)) scopeTotal.versions.set(version,{...tally(),clientBuild,desktopVersion:desktop});
      add(scopeTotal.versions.get(version),row.account);
    }
  }
  const byNameAndFrequency = ([a,x],[b,y]) => y.accounts.size-x.accounts.size || y.submissions-x.submissions || a.localeCompare(b,'zh');
  return {
    ...counts(total),
    categories:[...categories].sort(byNameAndFrequency).map(([category,categoryTotal])=>({
      category,...counts(categoryTotal),
      scopes:[...categoryTotal.scopes].sort(byNameAndFrequency).map(([scope,scopeTotal])=>({
        scope,...counts(scopeTotal),
        versions:[...scopeTotal.versions].sort(byNameAndFrequency).map(([,version])=>({
          clientBuild:version.clientBuild,desktopVersion:version.desktopVersion,...counts(version)
        }))
      }))
    }))
  };
}

module.exports = {summarizeFeedback};
