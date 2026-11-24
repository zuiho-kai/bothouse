'use strict';

const {attribution}=require('./public-reactions.cjs');

const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {AI_NUMBER,AI_DRAGON_NUMBER,AI_JU_NUMBER,providerForRole}=require('./ai-roles.cjs');

function fail(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}
function number(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{4,24}$/.test(value)) fail(400, 'number', '用户号须为 4–24 位字母、数字或下划线');
  return value.toLowerCase();
}
function string(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max)
    fail(400, 'invalid_text', label + '长度不合要求');
  return value.trim();
}
const now = () => new Date().toISOString();
const feedbackColumns = `id,body AS text,created AS createdAt,client_type AS clientType,NULLIF(client_build,'') AS clientBuild,
  (SELECT desktop_version FROM feedback_desktop_versions WHERE feedback_id=feedback.id) AS desktopVersion`;
const feedbackWithReplies = `SELECT ${feedbackColumns},reply_text AS replyText,retest_version AS retestVersion,replied_at AS repliedAt
  FROM feedback LEFT JOIN feedback_replies ON feedback_replies.feedback_id=feedback.id`;
const feedPageSize = 30;
const isPostId=id=>/^[1-9]\d*$/u.test(id)&&Number.isSafeInteger(Number(id));
// Both the timeline and the report endpoint use the same audience.
const feedAuthors=`WITH authors(number,kind) AS (
  SELECT $viewer,'human'
  UNION
  SELECT CASE WHEN c.first_user=$viewer THEN c.second_user ELSE c.first_user END,'human'
  FROM chats c WHERE $includeOthers=1 AND c.type='direct' AND (c.first_user=$viewer OR c.second_user=$viewer)
  UNION
  SELECT role,'ai' FROM ai_feed_follows WHERE account=$viewer AND $includeOthers=1
)`;
const feedAuthorPosts=`FROM authors a JOIN friend_posts p ON p.author=a.number
  JOIN users u ON u.number=p.author AND u.kind=a.kind`;

class SocialStore {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    const oldVoiceTable=this.one("SELECT 1 FROM sqlite_schema WHERE name='message_voices' AND type='table'");
    this.db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    if(this.one('PRAGMA user_version').user_version===0)this.transaction(()=>{
      if(oldVoiceTable)this.db.exec(`
        ALTER TABLE message_voices RENAME TO message_voices_v0;
        CREATE TABLE message_voices (
          message INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
          duration_ms INTEGER NOT NULL CHECK(duration_ms BETWEEN 200 AND 120000),
          digest TEXT NOT NULL, bytes BLOB NOT NULL CHECK(length(bytes) BETWEEN 6444 AND 3840044)
        );
        INSERT INTO message_voices SELECT * FROM message_voices_v0;
        DROP TABLE message_voices_v0;
      `);
      this.db.exec('PRAGMA user_version=1');
    });
    if(this.one('PRAGMA user_version').user_version<2)this.transaction(()=>{
      // Establish the watermark once for existing memberships. A restart
      // must preserve unread arrivals, including for members without a row.
      if(this.one('PRAGMA user_version').user_version>=2)return;
      this.run(`INSERT OR IGNORE INTO conversation_reads(chat,account,through)
        SELECT m.chat,m.account,(SELECT id FROM messages WHERE chat=m.chat ORDER BY id DESC LIMIT 1)
        FROM members m WHERE EXISTS(SELECT 1 FROM messages WHERE chat=m.chat AND id>m.since)`);
      this.db.exec('PRAGMA user_version=2');
    });
    if(this.one('PRAGMA user_version').user_version<3)this.transaction(()=>{
      if(this.one('PRAGMA user_version').user_version>=3)return;
      // Preview group approvals didn't record whether the page correctly named Claude.
      // Clearing those approvals cascades to the corresponding previous-turn consent.
      this.run("DELETE FROM ai_group_role_consents WHERE ai=? AND provider='anthropic'",AI_JU_NUMBER);
      this.db.exec('PRAGMA user_version=3');
    });
    const rolePreferenceParents=this.all('PRAGMA foreign_key_list(ai_friend_role_preferences)');
    if(!rolePreferenceParents.some(key=>key.from==='human'&&key.table==='ai_friend_preferences'&&key.on_delete==='CASCADE')){
      // The earlier, unreleased candidate did not require the old preference
      // row. An orphan is indistinguishable from a grant cleared by .27's
      // restore tool. Only copy roles whose parent still exists.
      this.transaction(()=>this.db.exec(`
        ALTER TABLE ai_friend_role_preferences RENAME TO ai_friend_role_preferences_unscoped;
        CREATE TABLE ai_friend_role_preferences (
          human TEXT NOT NULL REFERENCES ai_friend_preferences(human) ON DELETE CASCADE,
          ai TEXT NOT NULL REFERENCES users(number) CHECK(ai IN ('arcade_ju','arcade_dragon')),
          enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
          revision INTEGER NOT NULL,
          PRIMARY KEY(human,ai)
        );
        INSERT INTO ai_friend_role_preferences(human,ai,enabled,revision)
          SELECT r.human,r.ai,r.enabled,r.revision FROM ai_friend_role_preferences_unscoped r
          JOIN ai_friend_preferences p ON p.human=r.human;
        DROP TABLE ai_friend_role_preferences_unscoped;
      `));
    }
    if(this.one('SELECT 1 FROM ai_voice_choices LIMIT 1'))this.transaction(()=>{
      this.run(`INSERT OR IGNORE INTO ai_voice_preferences(human,ai,voice,revision)
        SELECT human,ai,min(voice),min(revision) FROM ai_voice_choices WHERE voice IS NOT NULL
        GROUP BY human,ai HAVING count(DISTINCT voice)=1`);
      this.run(`INSERT OR IGNORE INTO ai_voice_scopes(chat,human,ai,backend,revision,legacy_voice)
        SELECT chat,human,ai,CASE WHEN voice LIKE 'azure-%' THEN 'azure' ELSE 'local' END,revision,voice
        FROM ai_voice_choices WHERE voice IS NOT NULL`);
      this.run('DELETE FROM ai_voice_choices');
    });
  }
  one(sql, ...args) { return this.db.prepare(sql).get(...args); }
  all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  run(sql, ...args) { return this.db.prepare(sql).run(...args); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
  user(account) {
    const user = this.one('SELECT number,name AS displayName,kind FROM users WHERE number=?', account);
    if (!user) fail(404, 'unknown_user', '没有找到该用户号');
    return user;
  }
  feedback(account) {
    return this.all(feedbackWithReplies+' WHERE account=? ORDER BY created DESC,id DESC LIMIT 50',account);
  }
  feedbackPage(account,before) {
    const limit=20;
    let boundary,values=[];
    if(before!==null){
      const cursor=this.one('SELECT created,id FROM feedback WHERE account=? AND id=?',account,before);
      if(!cursor)fail(400,'feedback_cursor','无法继续读取这页反馈，请重新打开意见反馈');
      boundary=' AND (created,id)<(?,?)';
      values=[cursor.created,cursor.id];
    }
    const rows=this.all(feedbackWithReplies+' WHERE account=?'+(boundary||'')+' ORDER BY created DESC,id DESC LIMIT ?',
      account,...values,limit+1);
    const feedback=rows.slice(0,limit);
    const next=rows.length>limit?feedback.at(-1).id:null;
    if(before!==null)return {feedback,next};
    const recentReplies=this.all(feedbackWithReplies+
      ' WHERE account=? AND replied_at IS NOT NULL ORDER BY replied_at DESC,id DESC LIMIT 5',account);
    return {feedback,next,recentReplies};
  }
  ownReports(account) {
    return this.all(`SELECT id,'message' AS kind,status,created,reviewed,reason FROM reports WHERE reporter=?
      UNION ALL
      SELECT id,'friend_post' AS kind,status,created,reviewed,reason FROM friend_post_reports WHERE reporter=?
      ORDER BY created DESC,id DESC,kind DESC LIMIT 50`,account,account);
  }
  submitFeedback(account, body, build) {
    const {clientId,text,clientBuild,expectedAccount,desktopVersion=null} = body;
    if (Object.keys(body).some(key => !['clientId','text','clientBuild','expectedAccount','desktopVersion'].includes(key)) ||
        typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(clientId))
      fail(400,'feedback_request','反馈请求无效');
    if (expectedAccount !== account) fail(409,'feedback_session','账号已切换，请重新打开意见反馈');
    const content = string(text,1000,'反馈');
    const existing = this.one('SELECT ' + feedbackColumns + ' FROM feedback WHERE account=? AND nonce=?',account,clientId);
    if (existing) {
      if (existing.text !== content) fail(409,'feedback_conflict','该提交编号已用于另一条反馈');
      return existing;
    }
    const versionsUnrecorded = clientBuild === null;
    if (versionsUnrecorded) {
      if (Object.hasOwn(body,'desktopVersion')) fail(400,'feedback_request','旧反馈没有首次提交版本');
    } else if (Object.hasOwn(body,'desktopVersion')) {
      if (typeof clientBuild !== 'string' || !/^[a-f0-9]{64}$/u.test(clientBuild))
        fail(400,'feedback_request','网页构建号无效');
      if (desktopVersion !== null && (typeof desktopVersion !== 'string' ||
          !/^[1-9]\d{0,4}(?:\.(?:0|[1-9]\d{0,4})){2}\.0$/u.test(desktopVersion) ||
          desktopVersion.split('.').some(part=>Number(part)>65535)))
        fail(400,'feedback_request','桌面版本无效');
    } else if (clientBuild !== build) {
      fail(409,'feedback_build','客户端已更新，请刷新后重试');
    }
    let clientType = desktopVersion?'windows':'web';
    if(versionsUnrecorded)clientType='unknown';
    const id = randomUUID(), createdAt = now();
    this.run('INSERT INTO feedback(id,account,nonce,body,created,client_type,client_build) VALUES(?,?,?,?,?,?,?)',
      id,account,clientId,content,createdAt,clientType,clientBuild??'');
    if(desktopVersion)this.run('INSERT INTO feedback_desktop_versions(feedback_id,desktop_version) VALUES(?,?)',id,desktopVersion);
    return {id,text:content,createdAt,clientType,clientBuild,desktopVersion};
  }
  register(account, name, kind, password) {
    if ((kind==='human'&&(providerForRole.has(account)||/^bh_[a-f0-9]{21}$/.test(account)))||this.one('SELECT 1 FROM users WHERE number=?', account))
      fail(409, 'number_taken', '该用户号已注册或保留');
    this.run('INSERT INTO users VALUES(?,?,?,?)', account, name, kind, password);
    return this.user(account);
  }
  direct(a,b) {
    return this.one('SELECT id FROM chats WHERE first_user=? AND second_user=?', ...[a,b].sort());
  }
  friends(a) {
    return this.all(`SELECT u.number,u.name AS displayName,u.kind FROM chats c
      JOIN users u ON u.number=CASE WHEN c.first_user=? THEN c.second_user ELSE c.first_user END
      WHERE c.first_user=? OR c.second_user=? ORDER BY u.name,u.number`, a,a,a);
  }
  friendFeed(a,params) {
    const scope=params.get('scope')??'friends';
    const before=params.get('before');
    if(!['friends','mine'].includes(scope)||before!==null&&
       (!/^[1-9]\d*$/u.test(before)||!Number.isSafeInteger(Number(before))))
      fail(400,'feed_filter','动态范围或分页无效');
    const cursor=before===null?null:Number(before);
    const rows=this.all(`${feedAuthors}
      SELECT p.id,p.body,p.created,u.number,u.name AS displayName,u.kind
      ${feedAuthorPosts} WHERE p.removed_at IS NULL AND ($cursor IS NULL OR p.id<$cursor)
      ORDER BY p.id DESC LIMIT $limit`,{$viewer:a,$includeOthers:Number(scope==='friends'),$cursor:cursor,$limit:feedPageSize+1});
    return {
      account:a,
      posts:rows.slice(0,feedPageSize).map(({id,body,created,...author})=>({id,text:body,createdAt:created,author})),
      nextBefore:rows.length>feedPageSize?rows[feedPageSize-1].id:null,
    };
  }
  visibleFriendPost(viewer,id) {
    const row=this.one(`${feedAuthors} SELECT p.id,u.number,u.kind ${feedAuthorPosts}
      WHERE p.id=$id AND p.removed_at IS NULL`,{$viewer:viewer,$includeOthers:1,$id:id});
    return row&&{id:row.id,author:{number:row.number,kind:row.kind}};
  }
  publishFriendPost(a,body) {
    if(body.expectedAccount!==a)fail(409,'feed_session','账号已切换，请重新打开好友动态');
    const author=this.user(a);
    if(author.kind!=='human')fail(403,'feed_human_only','此入口仅供真人账号发布');
    if(Object.keys(body).some(key=>!['clientId','text','expectedAccount'].includes(key))||
        typeof body.clientId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/u.test(body.clientId))
      fail(400,'feed_request','发布请求无效');
    const text=string(body.text,1000,'动态');
    const existing=this.one('SELECT id,body,created,removed_at FROM friend_posts WHERE author=? AND nonce=?',a,body.clientId);
    if(existing) {
      if(existing.removed_at)fail(409,'feed_removed','这条动态已经删除');
      if(existing.body!==text)fail(409,'feed_conflict','此编号已用于另一条动态');
      return {id:existing.id,text,createdAt:existing.created,author};
    }
    const createdAt=now();
    const {lastInsertRowid:id}=this.run('INSERT INTO friend_posts(author,nonce,body,created) VALUES(?,?,?,?)',
      a,body.clientId,text,createdAt);
    return {id,text,createdAt,author};
  }
  deleteFriendPost(a,id,body) {
    if(body.expectedAccount!==a)fail(409,'feed_session','账号已切换，请重新打开好友动态');
    if(this.user(a).kind!=='human')fail(403,'feed_human_only','此入口仅供真人账号管理动态');
    if(!isPostId(id)||!this.one('SELECT 1 FROM friend_posts WHERE id=? AND author=?',id,a))
      fail(404,'unknown_post','没有找到这条动态');
    this.hideFriendPost(id);
    return {ok:true};
  }
  hideFriendPost(id) {
    this.run("UPDATE friend_posts SET body='',removed_at=? WHERE id=? AND removed_at IS NULL",now(),id);
  }
  reportFriendPost(a,id,reason) {
    const post=isPostId(id)&&this.one(`${feedAuthors}
      SELECT p.author,p.body,p.removed_at ${feedAuthorPosts} WHERE p.id=$id AND p.author<>$viewer`,
      {$viewer:a,$includeOthers:1,$id:id});
    if(!post||this.user(a).kind!=='human')fail(404,'unknown_post','没有找到这条动态');
    const existing=this.one('SELECT id,status FROM friend_post_reports WHERE reporter=? AND post=?',a,id);
    if(existing)return existing;
    if(post.removed_at)fail(404,'unknown_post','没有找到这条动态');
    const receipt='post-'+randomUUID();
    this.run(`INSERT INTO friend_post_reports(id,reporter,post,reason,reported_text,status,created)
      VALUES(?,?,?,?,?,'open',?)`,receipt,a,id,string(reason,500,'举报原因'),post.body,now());
    return {id:receipt,status:'open'};
  }
  requestView(r) {
    const from=this.user(r.sender);
    return { id:r.id, from, to:this.user(r.recipient), createdAt:r.created,
      ...(from.kind==='ai'&&providerForRole.has(from.number)&&{reason:'group_interaction'}) };
  }
  requests(a) {
    const list = (column) => this.all("SELECT * FROM requests WHERE state='pending' AND " + column + "=? ORDER BY created DESC", a).map(r => this.requestView(r));
    return { incoming:list('recipient'), outgoing:list('sender') };
  }
  request(a,b) {
    this.user(b);
    if (a === b || this.direct(a,b)) fail(409, 'already_connected', '无法向自己或已有好友发申请');
    const existing = this.one("SELECT * FROM requests WHERE state='pending' AND min(sender,recipient)=? AND max(sender,recipient)=?", ...[a,b].sort());
    if (existing) {
      if (existing.sender !== a) fail(409, 'incoming_request', '对方已经发来申请，请到好友申请中处理');
      return this.requestView(existing);
    }
    const id = randomUUID();
    this.run("INSERT INTO requests VALUES(?,?,?,'pending',?)", id,a,b,now());
    return this.requestView(this.one('SELECT * FROM requests WHERE id=?',id));
  }
  acceptAiFriendRequest(a,b) {
    const pending=this.one("SELECT * FROM requests WHERE state='pending' AND min(sender,recipient)=? AND max(sender,recipient)=?", ...[a,b].sort());
    if(pending){
      const {conversation}=this.decide(pending.recipient,pending.id,true);
      return {conversation:this.conversation(a,conversation.id)};
    }
    const direct=this.direct(a,b);
    if(direct)return {conversation:this.conversation(a,direct.id)};
    const request=this.request(a,b);
    const {conversation}=this.decide(b,request.id,true);
    return {conversation:this.conversation(a,conversation.id)};
  }
  acceptPendingAiFriendRequests() {
    this.transaction(()=>{
      const pending=this.all(`SELECT r.id,r.recipient FROM requests r
        JOIN users sender ON sender.number=r.sender AND sender.kind='human'
        JOIN users recipient ON recipient.number=r.recipient AND recipient.kind='ai'
        WHERE r.state='pending' AND r.recipient IN (?,?,?)`,AI_NUMBER,AI_DRAGON_NUMBER,AI_JU_NUMBER);
      for(const {id,recipient} of pending)this.decide(recipient,id,true);
    });
  }
  decide(a,id,accept) {
    const r = this.one('SELECT * FROM requests WHERE id=? AND recipient=?',id,a);
    if (!r) fail(404, 'unknown_request', '没有找到该申请');
    const state = accept ? 'accepted' : 'declined';
    if (r.state !== 'pending' && r.state !== state) fail(409, 'request_closed', '申请已处理');
    this.run('UPDATE requests SET state=? WHERE id=?',state,id);
    if (!accept) return {ok:true};
    return {conversation:this.openDirect(a,r.sender)};
  }
  openDirect(a,b) {
    let direct = this.direct(a,b);
    if (!direct) {
      const chat = randomUUID();
      this.run("INSERT INTO chats(id,type,first_user,second_user,created) VALUES(?,'direct',?,?,?)",chat,...[a,b].sort(),now());
      this.run('INSERT INTO members VALUES(?,?,0),(?,?,0)',chat,a,chat,b);
      direct = {id:chat};
    }
    return this.conversation(a,direct.id);
  }
  access(a,id) {
    // Existing memberships keep a stable identity until they are removed.
    const chat = this.one(`SELECT c.*,m.since,COALESCE(r.revision,c.id||'/'||m.account) AS membershipRevision
      FROM chats c JOIN members m ON m.chat=c.id
      LEFT JOIN conversation_membership_revisions r ON r.chat=m.chat AND r.account=m.account
      WHERE c.id=? AND m.account=?`,id,a);
    if (!chat) fail(404, 'unknown_chat', '你无法访问这个会话');
    return chat;
  }
  group(a,id) {
    const chat = this.access(a,id);
    if (chat.type !== 'group') fail(400, 'group_required', '此操作仅用于群聊');
    return chat;
  }
  addMembers(a,id,values) {
    this.group(a,id);
    if (!Array.isArray(values) || !values.length || values.length > 99) fail(400,'members','请选择 1–99 位好友');
    const since = this.one('SELECT coalesce(max(id),0) AS id FROM messages').id;
    for (const b of new Set(values.map(number))) {
      if (a === b || !this.direct(a,b)) fail(403,'friends_only','只能邀请自己的好友');
      this.run('INSERT OR IGNORE INTO members VALUES(?,?,?)',id,b,since);
    }
    if (this.one('SELECT count(*) AS n FROM members WHERE chat=?',id).n > 100) fail(409,'group_full','群成员上限为 100 人');
    return this.conversation(a,id);
  }
  createGroup(a,title,values) {
    const id = randomUUID();
    this.run("INSERT INTO chats(id,type,title,owner,created) VALUES(?,'group',?,?,?)",id,string(title,80,'群名'),a,now());
    this.run('INSERT INTO members VALUES(?,?,0)',id,a);
    return this.addMembers(a,id,values);
  }
  remove(a,id,target,leaving) {
    const chat = this.group(a,id);
    if ((!leaving && a !== chat.owner) || target === chat.owner) fail(403,'group_owner','群主保留在群内，移除他人需群主权限');
    this.run('DELETE FROM members WHERE chat=? AND account=?',id,target);
    return leaving ? {ok:true} : {conversation:this.conversation(a,id)};
  }
  messagePerson(account) {
    const person=this.user(account);
    if(person.kind==='ai')Object.assign(person,this.one('SELECT owner AS aiOwner FROM personal_ai WHERE ai=?',account));
    return person;
  }
  message(r) {
    const task=!r.removed&&this.one('SELECT prompt AS messageId,ai AS target,state,attempt,board_id AS boardId FROM bothouse_work_orders WHERE prompt=?',r.id);
    const pictureQuestion=this.one('SELECT state,image,ai FROM ai_image_turns WHERE prompt=?',r.id);
    const aiReply = pictureQuestion?.state??this.one('SELECT state FROM ai_direct_turns WHERE prompt=? UNION ALL SELECT state FROM ai_group_turns WHERE prompt=?',r.id,r.id)?.state;
    const mentioned = this.one('SELECT account FROM message_mentions WHERE message=?',r.id)?.account;
    const image=!r.removed&&r.body===''&&this.one(`SELECT i.mime,i.width,i.height,length(i.bytes) AS bytes,s.label,p.source_code,d.title AS drawing
      FROM message_images i LEFT JOIN message_stickers s ON s.message=i.message
      LEFT JOIN message_sticker_sources p ON p.message=i.message
      LEFT JOIN message_drawings d ON d.message=i.message WHERE i.message=?`,r.id);
    const voice=!r.removed&&!image&&this.one(
      'SELECT duration_ms AS durationMs,length(bytes) AS bytes FROM message_voices WHERE message=?',r.id);
    const {label,source_code,drawing,...picture}=image||{};
    const source=source_code?attribution(JSON.parse(source_code)):null;
    const attachment=image?{type:'image',...picture,...(label&&{sticker:{label,...(source&&{source})}}),
      ...(drawing!==null&&{drawing:{title:drawing}})}:
      voice&&{type:'voice',mime:'audio/wav',...voice};
    const webResults=!r.removed&&r.nonce.startsWith('ai-reply-')&&
      this.one('SELECT sources FROM message_web_results WHERE message=?',r.id)?.sources;
    return {id:r.id, conversationId:r.chat, sender:this.messagePerson(r.sender), clientId:r.nonce,
      ...(webResults&&{webResults:JSON.parse(webResults)}),
      text:r.removed ? '[已移除]' : image?(drawing!==null?'[AI 绘图]':label?'[表情图]':'[图片]'):voice?'[语音]':r.body,
      createdAt:r.created, removed:Boolean(r.removed),
      ...(aiReply && {aiReply}), ...(task&&{task}),
      ...(!r.removed&&pictureQuestion&&{imageQuestion:{image:pictureQuestion.image,role:this.user(pictureQuestion.ai)}}),
      ...(!r.removed&&mentioned&&{mention:this.messagePerson(mentioned)}), ...(attachment&&{attachment})};
  }
  directAiConsent(a,id) {
    return this.one(`SELECT g.ai,CASE WHEN person.ai IS NOT NULL AND context.chat IS NULL THEN 0
      ELSE coalesce(p.enabled,1) END AS enabled,coalesce(p.revision,0) AS revision,
      coalesce(p.context_floor,0) AS contextFloor FROM ai_direct_grants g
      JOIN chats c ON c.id=g.chat AND c.type='direct' AND c.first_user=min(g.human,g.ai) AND c.second_user=max(g.human,g.ai)
      LEFT JOIN ai_direct_permissions p ON p.chat=g.chat
      LEFT JOIN personal_ai person ON person.ai=g.ai
      LEFT JOIN personal_ai_direct_context context ON context.chat=g.chat WHERE g.chat=? AND g.human=?`,id,a);
  }
  connectedAi(a,id) {
    const peer=this.one(`SELECT u.number FROM chats c JOIN members m ON m.chat=c.id
      JOIN users u ON u.number=m.account AND u.kind='ai'
      WHERE c.id=? AND c.type='direct' AND ((c.first_user=? AND c.second_user=u.number)
        OR (c.second_user=? AND c.first_user=u.number))`,id,a,a)?.number;
    if(providerForRole.has(peer)||peer&&this.one('SELECT 1 FROM personal_ai WHERE ai=?',peer))return peer;
  }
  imageUploadAccess(a,id) {
    const chat=this.access(a,id);
    const grant=chat.type==='direct'&&this.directAiConsent(a,id);
    if(grant?.enabled&&providerForRole.has(grant.ai))return chat;
    return this.humanAttachmentAccess(a,id,'image');
  }
  humanAttachmentAccess(a,id,kind) {
    const chat=this.access(a,id);
    const aiDirect=chat.type==='direct'&&this.one(
      "SELECT 1 FROM members m JOIN users u ON u.number=m.account WHERE m.chat=? AND u.kind='ai'",id);
    if(this.user(a).kind!=='human'||aiDirect)
      fail(403,kind+'_human_only','附件仅供真人在好友私聊或群聊中发送');
    return chat;
  }
  sendImage(a,id,clientId,image) {
    const chat=this.imageUploadAccess(a,id);
    return this.writeImage(a,chat,clientId,image,null);
  }
  sendAiSticker(a,id,clientId,image) {
    const chat=this.access(a,id);
    if(this.user(a).kind!=='ai')fail(403,'ai_required','表情图必须由当前 AI 角色发送');
    const source=image.source===undefined?null:attribution(image.source);
    if(image.source!==undefined&&!source)fail(422,'image_source','表情图出处无效');
    return this.writeImage(a,chat,clientId,image,string(image.label,72,'表情图说明'),source&&JSON.stringify(source));
  }
  sendAiDrawing(a,id,clientId,image) {
    const chat=this.access(a,id);
    if(this.user(a).kind!=='ai')fail(403,'ai_required','绘图只能由当前会话的 AI 角色发送');
    if(chat.type==='direct'){
      const human=chat.first_user===a?chat.second_user:chat.first_user;
      const grant=this.directAiConsent(human,id);
      if(!grant?.enabled||grant.ai!==a||this.connectedAi(human,id)!==a)fail(403,'drawing_scope','这段私聊无法发送云绘图原图');
    }
    return this.writeImage(a,chat,clientId,image,null,null,{title:image.title,original:image.original});
  }
  writeImage(a,chat,clientId,image,label,sourceCode=null,drawing=null) {
    const id=chat.id;
    const old=this.one('SELECT * FROM messages WHERE chat=? AND sender=? AND nonce=?',id,a,clientId);
    if(old) {
      const saved=this.one(`SELECT i.mime,i.digest,s.label,p.source_code,d.title,d.original FROM message_images i
        LEFT JOIN message_stickers s ON s.message=i.message LEFT JOIN message_sticker_sources p ON p.message=i.message
        LEFT JOIN message_drawings d ON d.message=i.message
        WHERE i.message=?`,old.id);
      if(old.id<=chat.since||!saved||saved.mime!==image.mime||saved.digest!==image.digest||saved.label!==label||saved.source_code!==sourceCode)
        fail(409,'message_conflict','此编号已被使用');
      if(saved.title!==(drawing?.title??null)||saved.original!==(drawing?(drawing.original??old.id):null))
        fail(409,'message_conflict','此编号已被使用');
      return this.message(old);
    }
    const row=this.run("INSERT INTO messages(chat,sender,nonce,body,created) VALUES(?,?,?,'',?)",id,a,clientId,now());
    this.run('INSERT INTO message_images VALUES(?,?,?,?,?,?)',row.lastInsertRowid,
      image.mime,image.width,image.height,image.digest,image.bytes);
    if(label)this.run('INSERT INTO message_stickers VALUES(?,?)',row.lastInsertRowid,label);
    if(sourceCode)this.run('INSERT INTO message_sticker_sources VALUES(?,?)',row.lastInsertRowid,sourceCode);
    if(drawing)this.run('INSERT INTO message_drawings VALUES(?,?,?)',row.lastInsertRowid,
      drawing.original??row.lastInsertRowid,drawing.title);
    return this.message(this.one('SELECT * FROM messages WHERE id=?',row.lastInsertRowid));
  }
  messageImage(a,id,message) {
    const chat=this.access(a,id);
    const image=this.one(`SELECT i.mime,i.bytes FROM message_images i JOIN messages m ON i.message=m.id
      WHERE m.chat=? AND m.id=? AND m.id>? AND m.removed=0`, id,message,chat.since);
    if(!image)fail(404,'unknown_image','没有找到该图片');
    return image;
  }
  sendVoice(a,id,clientId,voice) {
    return this.writeVoice(a,this.humanAttachmentAccess(a,id,'voice'),clientId,voice,'');
  }
  sendAiVoice(a,id,clientId,voice,transcript) {
    const chat=this.access(a,id);
    if(this.user(a).kind!=='ai')fail(403,'ai_required','语音回复必须来自当前 AI 角色');
    return this.writeVoice(a,chat,clientId,voice,string(transcript,600,'语音台词'));
  }
  writeVoice(a,chat,clientId,voice,transcript) {
    const id=chat.id;
    const old=this.one('SELECT * FROM messages WHERE chat=? AND sender=? AND nonce=?',id,a,clientId);
    if(old){
      const saved=this.one('SELECT digest FROM message_voices WHERE message=?',old.id);
      if(old.id<=chat.since||saved?.digest!==voice.digest||old.body!==transcript)fail(409,'message_conflict','此编号已被使用');
      return this.message(old);
    }
    const row=this.run('INSERT INTO messages(chat,sender,nonce,body,created) VALUES(?,?,?,?,?)',id,a,clientId,transcript,now());
    this.run('INSERT INTO message_voices VALUES(?,?,?,?)',row.lastInsertRowid,voice.durationMs,voice.digest,voice.bytes);
    return this.message(this.one('SELECT * FROM messages WHERE id=?',row.lastInsertRowid));
  }
  messageVoice(a,id,message) {
    const chat=this.access(a,id);
    const voice=this.one(`SELECT v.bytes FROM message_voices v JOIN messages m ON m.id=v.message
      WHERE m.chat=? AND m.id=? AND m.id>? AND m.removed=0`,id,message,chat.since);
    if(!voice)fail(404,'unknown_voice','这条语音已无法播放');
    return voice;
  }
  webSearchSetting(chat) {
    return this.one(`SELECT coalesce(s.enabled,c.type='group') AS enabled,coalesce(s.revision,0) AS revision
      FROM chats c LEFT JOIN ai_web_search_settings s ON s.chat=c.id WHERE c.id=?`,chat);
  }
  conversation(a,id) {
    const c = this.access(a,id);
    const members = this.all('SELECT u.number,u.name AS displayName,u.kind FROM users u JOIN members m ON m.account=u.number WHERE m.chat=? ORDER BY u.number',id);
    const last = this.one('SELECT * FROM messages WHERE chat=? AND id>? ORDER BY id DESC LIMIT 1',id,c.since);
    const readThrough=Math.max(c.since,this.one('SELECT through FROM conversation_reads WHERE chat=? AND account=?',id,a)?.through??0);
    const unreadThrough=last?.id>readThrough?this.one(`SELECT id FROM messages
      WHERE chat=? AND id>? AND id<=? AND sender<>? AND removed=0 ORDER BY id DESC LIMIT 1`,id,readThrough,last.id,a)?.id??null:null;
    const permission=c.type==='direct'&&this.directAiConsent(a,id);
    const cloudChat=permission&&{enabled:!!permission.enabled,revision:permission.revision};
    const peer=c.type==='direct'&&!permission?this.connectedAi(a,id):undefined;
    const requiresAiCloudConsent=Boolean(peer);
    const number=permission?.ai??peer;
    const personal=number&&this.one(`SELECT p.owner,p.role,coalesce(s.guest_cloud,0) AS guestCloud
      FROM personal_ai p LEFT JOIN personal_ai_friend_settings s ON s.ai=p.ai WHERE p.ai=?`,number);
    const aiProvider=providerForRole.get(personal?.role??number);
    const hasAi=!personal&&Boolean(cloudChat)||c.type==='group'&&members.some(member=>member.kind==='ai');
    const search=hasAi&&this.webSearchSetting(id);
    const webSearch=hasAi&&{enabled:!!search?.enabled,revision:search?.revision??0,canManage:c.type==='direct'||c.owner===a};
    return {id, type:c.type, title:c.type === 'direct' ? members.find(m => m.number !== a).displayName : c.title,
      ownerNumber:c.owner, members, lastMessage:last ? this.message(last) : null, readThrough, unreadThrough, ...(cloudChat&&{cloudChat}),
      ...(aiProvider&&{aiProvider}),...(requiresAiCloudConsent&&{requiresAiCloudConsent}),...(webSearch&&{webSearch}),
      ...(personal&&{personalAi:true,personalAiOwner:personal.owner===a,
        personalCloudAllowed:personal.owner===a||Boolean(personal.guestCloud)})};
  }
  markConversationRead(a,id,{expectedAccount,through}) {
    if(expectedAccount!==a)fail(409,'read_session','账号已切换，请重新打开会话');
    const chat=this.access(a,id);
    if(!Number.isSafeInteger(through)||through<1)fail(400,'cursor','已读位置无效');
    if(through<=chat.since||!this.one('SELECT 1 FROM messages WHERE chat=? AND id=?',id,through))
      fail(404,'unknown_message','没有找到这条消息');
    this.run(`INSERT INTO conversation_reads(chat,account,through) VALUES(?,?,?)
      ON CONFLICT(chat,account) DO UPDATE SET through=max(through,excluded.through)`,id,a,through);
    return {readThrough:this.one('SELECT through FROM conversation_reads WHERE chat=? AND account=?',id,a).through};
  }
  conversations(a) {
    return this.all(`SELECT c.id FROM members m JOIN chats c ON c.id=m.chat WHERE m.account=?
      ORDER BY coalesce((SELECT created FROM messages WHERE chat=c.id AND id>m.since ORDER BY id DESC LIMIT 1), c.created) DESC,c.id`,a)
      .map(row => this.conversation(a,row.id));
  }
  history(a,id,params) {
    return this.historyPage(a,id,params).messages;
  }
  historySearch(a,id,params) {
    if(params.get('account')!==a)fail(409,'history_session','账号已切换，请重新打开会话');
    const chat=this.access(a,id);
    const scope={historyFloor:chat.since,membershipRevision:chat.membershipRevision};
    const readId=(key,fallback)=>{
      const raw=params.get(key);
      if(raw===null)return fallback;
      const value=Number(raw);
      if(!/^[1-9]\d*$/u.test(raw)||!Number.isSafeInteger(value))fail(400,'cursor','消息位置无效');
      return value;
    };
    if(params.has('around')){
      if(params.has('q')||params.has('before'))fail(400,'cursor','请选择一种查询方式');
      const target=readId('around',null);
      const original=this.one('SELECT * FROM messages WHERE chat=? AND id=? AND id>? AND removed=0',id,target,chat.since);
      if(!original)fail(404,'unknown_message','这条消息已移除或不可查看');
      const before=this.all('SELECT * FROM messages WHERE chat=? AND id>? AND id<? ORDER BY id DESC LIMIT 26',id,chat.since,target);
      const after=this.all('SELECT * FROM messages WHERE chat=? AND id>? ORDER BY id LIMIT 24',id,target);
      return {...scope,anchor:target,older:before.length>25,
        messages:[...before.slice(0,25).reverse(),original,...after].map(row=>this.message(row))};
    }
    const query=string(params.get('q'),100,'搜索关键词');
    const before=readId('before',Number.MAX_SAFE_INTEGER), limit=20;
    const matches=this.all(`SELECT m.id,m.body AS text,m.created AS createdAt,u.name AS sender
      FROM messages m JOIN users u ON u.number=m.sender
      WHERE m.chat=? AND m.id>? AND m.id<? AND m.removed=0 AND instr(lower(m.body),lower(?))>0
      ORDER BY m.id DESC LIMIT ?`,id,chat.since,before,query,limit+1);
    const results=matches.slice(0,limit);
    return {...scope,results,next:matches.length>limit?results.at(-1).id:null};
  }
  historyPage(a,id,params) {
    const chat = this.access(a,id);
    function integer(key,fallback,min,max) {
      if (!params.has(key)) return fallback;
      const raw = params.get(key), n = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max) fail(400,'cursor','分页参数无效');
      return n;
    }
    if (params.has('after') && params.has('before')) fail(400,'cursor','请选择一个分页方向');
    const limit = integer('limit',50,1,100);
    const start = Math.max(chat.since,integer('after',0,0,Number.MAX_SAFE_INTEGER));
    const end = integer('before',Number.MAX_SAFE_INTEGER,1,Number.MAX_SAFE_INTEGER);
    const forward = params.has('after');
    // Take the initial watermark before reading message bodies. A concurrent
    // removal is then reflected in the bodies or picked up on the next poll.
    let moderation;
    if (params.has('removedAfter')) {
      let cursor, removedIds = [];
      if (params.get('removedAfter') === 'latest') {
        cursor = this.one('SELECT coalesce(max(id),0) AS cursor FROM message_removals WHERE chat=? AND message>?',id,chat.since).cursor;
      } else {
        const after = integer('removedAfter',0,0,Number.MAX_SAFE_INTEGER);
        const events = this.all('SELECT id,message FROM message_removals WHERE chat=? AND id>? AND message>? ORDER BY id LIMIT 100',
          id,after,chat.since);
        cursor = events.at(-1)?.id ?? after;
        removedIds = events.map(event => event.message);
      }
      moderation = {cursor,removedIds,historyFloor:chat.since,membershipRevision:chat.membershipRevision};
    }
    const rows = this.all('SELECT * FROM messages WHERE chat=? AND id>? AND id<? ORDER BY id ' + (forward ? 'ASC' : 'DESC') + ' LIMIT ?',id,start,end,limit);
    const messages = (forward ? rows : rows.reverse()).map(r => this.message(r));
    return moderation ? {messages,moderation} : {messages};
  }
  // Project quotes only for the recipient of an HTTP response. Internal AI history
  // and turn staging continue to receive the original, unexpanded message bodies.
  withReplyPreviews(a,id,messages) {
    if(!messages.length)return messages;
    const {since}=this.access(a,id);
    const slots=messages.map(()=>'?').join(',');
    const rows=this.all(`SELECT r.message,m.id,u.name,
      CASE WHEN v.message IS NOT NULL THEN '[语音]' WHEN i.message IS NOT NULL THEN '[图片]'
        WHEN length(m.body)>120 THEN substr(m.body,1,120)||'…' ELSE m.body END AS text
      FROM message_replies r JOIN messages child ON child.id=r.message
      LEFT JOIN messages m ON m.id=r.original AND m.chat=child.chat AND m.id>? AND m.removed=0
      LEFT JOIN users u ON u.number=m.sender
      LEFT JOIN message_voices v ON v.message=m.id LEFT JOIN message_images i ON i.message=m.id
      WHERE child.chat=? AND child.id>? AND child.removed=0 AND r.message IN (${slots})`,
      since,id,since,...messages.map(message=>message.id));
    const quotes=new Map(rows.map(row=>[row.message,row.id===null?{unavailable:true}:
      {id:row.id,name:row.name,text:row.text}]));
    return messages.map(message=>quotes.has(message.id)?{...message,quote:quotes.get(message.id)}:message);
  }
  send(a,id,body,onInsert) {
    const chat = this.access(a,id);
    if (typeof body.clientId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.clientId)) fail(400,'client_id','消息重试编号无效');
    // Only a trusted AI sender may add a brief delivery note to the original reply.
    const text = string(body.text,body.text?.length>4000&&this.user(a).kind==='ai'?4096:4000,'消息');
    const original=body.replyTo===undefined?null:body.replyTo;
    if(body.replyTo!==undefined&&(!Number.isSafeInteger(original)||original<1))
      fail(400,'reply_target','原消息位置无效');
    const mentionAccount=body.mentionAccount===undefined?null:number(body.mentionAccount);
    const old = this.one('SELECT * FROM messages WHERE chat=? AND sender=? AND nonce=?',id,a,body.clientId);
    if (old) {
      const oldMention=this.one('SELECT account FROM message_mentions WHERE message=?',old.id)?.account??null;
      const previous=this.one('SELECT original FROM message_replies WHERE message=?',old.id)?.original??null;
      if (old.id <= chat.since || old.body !== text || oldMention!==mentionAccount || previous!==original) fail(409,'message_conflict','此编号已被使用');
      return this.message(old);
    }
    if(original!==null&&!this.one('SELECT 1 FROM messages WHERE id=? AND chat=? AND id>? AND removed=0',original,id,chat.since))
      fail(409,'reply_unavailable','原消息已移除或不可查看。可取消引用后发送。');
    if(mentionAccount&&(chat.type!=='group'||this.user(a).kind!=='human'||
       !this.one('SELECT 1 FROM members WHERE chat=? AND account=?',id,mentionAccount)))
      fail(403,'mention_unavailable','点名对象需要是当前群成员');
    const row = this.run('INSERT INTO messages(chat,sender,nonce,body,created) VALUES(?,?,?,?,?)',id,a,body.clientId,text,now());
    if(original!==null)this.run('INSERT INTO message_replies(message,original) VALUES(?,?)',row.lastInsertRowid,original);
    if(mentionAccount)this.run('INSERT INTO message_mentions VALUES(?,?)',row.lastInsertRowid,mentionAccount);
    const message=this.message(this.one('SELECT * FROM messages WHERE id=?',row.lastInsertRowid));
    onInsert?.(message);
    return message;
  }
  report(a,id,message,reason,includeMedia=false) {
    const chat = this.access(a,id);
    const r = this.one(`SELECT m.id,m.removed,CASE WHEN v.message IS NOT NULL THEN 'audio/wav' ELSE i.mime END AS mediaMime
      FROM messages m LEFT JOIN message_voices v ON v.message=m.id LEFT JOIN message_images i ON i.message=m.id
      WHERE m.chat=? AND m.id=? AND m.id>?`,id,message,chat.since);
    if (!r) fail(404,'unknown_message','没有找到该消息');
    const previous=this.one(`SELECT r.id,r.status,m.mime AS sharedMedia FROM reports r
      LEFT JOIN report_media m ON m.report=r.id WHERE r.reporter=? AND r.message=?`,a,r.id);
    if(previous){
      const {id,status,sharedMedia}=previous;
      // Repeat submissions return the first receipt, including its scope.
      return {id,status,...(sharedMedia&&{sharedMedia})};
    }
    if(r.removed)fail(404,'unknown_message','没有找到该消息');
    if(typeof includeMedia!=='boolean'||(includeMedia&&!r.mediaMime))
      fail(400,'report_media','这条消息没有可一并提交的图片或语音');
    const receipt=randomUUID();
    this.run("INSERT INTO reports(id,reporter,message,reason,status,created) VALUES(?,?,?,?,'open',?)",receipt,a,r.id,string(reason,500,'举报原因'),now());
    if(includeMedia)this.run('INSERT INTO report_media(report,mime) VALUES(?,?)',receipt,r.mediaMime);
    return {id:receipt,status:'open',...(includeMedia&&{sharedMedia:r.mediaMime})};
  }
}
module.exports = { SocialStore, fail, number, string, AI_NUMBER, AI_DRAGON_NUMBER, feedbackWithReplies };
