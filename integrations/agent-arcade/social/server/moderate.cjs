'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {databasePath} = require('./config.cjs');
const {SocialStore,fail,string,feedbackWithReplies} = require('./store.cjs');
const {summarizeFeedback} = require('./feedback-summary.cjs');
const reportTargets=`
  SELECT r.id,r.reporter,r.reason,r.created,m.sender,r.status,r.reviewed,
    'message' AS targetType,m.id AS targetId,m.removed AS targetRemoved,
    CASE WHEN v.message IS NOT NULL THEN '[语音]' WHEN m.body='' THEN '[图片]' ELSE m.body END AS reportedText,
    a.mime AS sharedMedia
  FROM reports r JOIN messages m ON m.id=r.message LEFT JOIN message_voices v ON v.message=m.id
    LEFT JOIN report_media a ON a.report=r.id
  UNION ALL
  SELECT r.id,r.reporter,r.reason,r.created,p.author,r.status,r.reviewed,
    'friend_post',p.id,p.removed_at IS NOT NULL,r.reported_text,NULL
  FROM friend_post_reports r JOIN friend_posts p ON p.id=r.post`;

function reportById(store,id) {
  const row=store.one('SELECT * FROM ('+reportTargets+') WHERE id=?',id);
  if(!row)fail(404,'report','Unknown report');
  return row;
}

const extensions={'image/png':'.png','image/jpeg':'.jpg','audio/wav':'.wav'};
function exportReportMedia(store,id,directory) {
  const report=reportById(store,id);
  if(report.targetRemoved||report.status!=='open'||!Object.hasOwn(extensions,report.sharedMedia))
    fail(404,'report_media','This open report has no authorized media');
  const voice=report.sharedMedia==='audio/wav';
  const result=store.one(`SELECT media.bytes FROM reports r
    JOIN messages m ON m.id=r.message
    JOIN ${voice?'message_voices':'message_images'} media ON media.message=m.id
    WHERE r.id=? AND r.status='open' AND m.removed=0${voice?'':' AND media.mime=?'}`,
  id,...(voice?[]:[report.sharedMedia]));
  if(!result)fail(404,'report_media','The authorized media is unavailable');
  if(!/^[0-9a-f-]{36}$/u.test(report.id))throw Error('Invalid report ID');
  const file=path.resolve(directory,'report-'+report.id+extensions[report.sharedMedia]);
  fs.writeFileSync(file,result.bytes,{flag:'wx',mode:0o600});
  return {id:report.id,targetId:report.targetId,mime:report.sharedMedia,bytes:result.bytes.byteLength,file};
}

function replyToFeedback(store,id,text,version) {
  const reply=string(text,500,'处理结果');
  const retestVersion=version??null;
  if(retestVersion!==null && (typeof retestVersion!=='string' || !/^\d{1,5}(?:\.\d{1,5}){2,3}$/u.test(retestVersion)))
    fail(400,'retest_version','复测版本须为已确定的三段或四段应用版本');
  return store.transaction(()=>{
    if(!store.one('SELECT 1 FROM feedback WHERE id=?',id))
      fail(404,'feedback','Unknown feedback receipt');
    store.run(`INSERT INTO feedback_replies(feedback_id,reply_text,retest_version,replied_at) VALUES(?,?,?,?)
      ON CONFLICT(feedback_id) DO UPDATE SET reply_text=excluded.reply_text,
        retest_version=excluded.retest_version,replied_at=excluded.replied_at
      WHERE feedback_replies.reply_text IS NOT excluded.reply_text
        OR feedback_replies.retest_version IS NOT excluded.retest_version`,id,reply,retestVersion,new Date().toISOString());
    return store.one(feedbackWithReplies+' WHERE id=?',id);
  });
}

function moderate(store,command,id,argument,version) {
  if(command==='media'&&id&&argument)return exportReportMedia(store,id,argument);
  if(command==='feedback-reply'&&id)return replyToFeedback(store,id,argument,version);
  if (command === 'feedback' && id === undefined) return store.all(
    feedbackWithReplies+' ORDER BY created DESC,id DESC LIMIT 100');
  if (command === 'feedback' && id && argument === undefined) {
    const row = store.one(feedbackWithReplies+' WHERE id=?',id);
    if (!row) fail(404,'feedback','Unknown feedback receipt');
    return row;
  }
  if (command === 'feedback-summary' && id === undefined) return summarizeFeedback(store.db);
  if (command === 'feedback-pending' && id === undefined) return store.all(
    feedbackWithReplies+' WHERE feedback_replies.feedback_id IS NULL ORDER BY created,id LIMIT 100');
  if (command === 'list') return store.all('SELECT * FROM ('+reportTargets+") WHERE status='open' ORDER BY created,id LIMIT 100");
  if (command === 'show' && id) return reportById(store,id);
  if (!id || !['remove','dismiss'].includes(command))
    throw new Error('Use feedback [FEEDBACK_ID] | feedback-summary | feedback-pending | feedback-reply FEEDBACK_ID "RESULT" [RETEST_VERSION] | list | show REPORT_ID | media REPORT_ID PRIVATE_DIRECTORY | remove REPORT_ID | dismiss REPORT_ID');
  return store.transaction(() => {
    const r = reportById(store,id);
    if (r.status !== 'open') return {id,status:r.status};
    const reviewed = new Date().toISOString();
    const isPost=r.targetType==='friend_post';
    if (command === 'remove') {
      if(isPost) {
        store.hideFriendPost(r.targetId);
        store.run("UPDATE friend_post_reports SET status='removed',reviewed=? WHERE post=? AND status='open'",reviewed,r.targetId);
      } else {
        store.run('UPDATE messages SET removed=1 WHERE id=?',r.targetId);
        store.run("UPDATE reports SET status='removed',reviewed=? WHERE message=? AND status='open'",reviewed,r.targetId);
      }
    } else {
      const table=isPost?'friend_post_reports':'reports';
      store.run("UPDATE "+table+" SET status='dismissed',reviewed=? WHERE id=?",reviewed,id);
    }
    return {id,status:command === 'remove' ? 'removed' : 'dismissed'};
  });
}
if (require.main === module) {
  const file = databasePath();
  if (!fs.existsSync(file)) throw new Error('No database at SOCIAL_DB');
  const args = process.argv.slice(2);
  const store = args[0] === 'feedback-summary' ? {db:new DatabaseSync(file,{readOnly:true})} : new SocialStore(file);
  try { console.log(JSON.stringify(moderate(store,...args),null,2)); }
  finally { store.db.close(); }
}
module.exports = {moderate};
