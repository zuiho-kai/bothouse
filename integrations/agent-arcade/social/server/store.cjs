'use strict';

const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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

class SocialStore {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
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
  register(account, name, kind, password) {
    if (this.one('SELECT 1 FROM users WHERE number=?', account)) fail(409, 'number_taken', '该用户号已注册');
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
  requestView(r) {
    return { id:r.id, from:this.user(r.sender), to:this.user(r.recipient), createdAt:r.created };
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
  decide(a,id,accept) {
    const r = this.one('SELECT * FROM requests WHERE id=? AND recipient=?',id,a);
    if (!r) fail(404, 'unknown_request', '没有找到该申请');
    const state = accept ? 'accepted' : 'declined';
    if (r.state !== 'pending' && r.state !== state) fail(409, 'request_closed', '申请已处理');
    this.run('UPDATE requests SET state=? WHERE id=?',state,id);
    if (!accept) return {ok:true};
    let direct = this.direct(a,r.sender);
    if (!direct) {
      const chat = randomUUID();
      this.run("INSERT INTO chats(id,type,first_user,second_user,created) VALUES(?,'direct',?,?,?)",chat,...[a,r.sender].sort(),now());
      this.run('INSERT INTO members VALUES(?,?,0),(?,?,0)',chat,a,chat,r.sender);
      direct = {id:chat};
    }
    return {conversation:this.conversation(a,direct.id)};
  }
  access(a,id) {
    const chat = this.one('SELECT c.*,m.since FROM chats c JOIN members m ON m.chat=c.id WHERE c.id=? AND m.account=?', id,a);
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
  message(r) {
    return {id:r.id, conversationId:r.chat, sender:this.user(r.sender), clientId:r.nonce,
      text:r.removed ? '[已移除]' : r.body, createdAt:r.created, removed:Boolean(r.removed)};
  }
  conversation(a,id) {
    const c = this.access(a,id);
    const members = this.all('SELECT u.number,u.name AS displayName,u.kind FROM users u JOIN members m ON m.account=u.number WHERE m.chat=? ORDER BY u.number',id);
    const last = this.one('SELECT * FROM messages WHERE chat=? AND id>? ORDER BY id DESC LIMIT 1',id,c.since);
    return {id, type:c.type, title:c.type === 'direct' ? members.find(m => m.number !== a).displayName : c.title,
      ownerNumber:c.owner, members, lastMessage:last ? this.message(last) : null};
  }
  conversations(a) {
    return this.all(`SELECT c.id FROM members m JOIN chats c ON c.id=m.chat WHERE m.account=?
      ORDER BY coalesce((SELECT created FROM messages WHERE chat=c.id AND id>m.since ORDER BY id DESC LIMIT 1), c.created) DESC,c.id`,a)
      .map(row => this.conversation(a,row.id));
  }
  history(a,id,params) {
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
    const rows = this.all('SELECT * FROM messages WHERE chat=? AND id>? AND id<? ORDER BY id ' + (forward ? 'ASC' : 'DESC') + ' LIMIT ?',id,start,end,limit);
    return (forward ? rows : rows.reverse()).map(r => this.message(r));
  }
  send(a,id,body) {
    const chat = this.access(a,id);
    if (typeof body.clientId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.clientId)) fail(400,'client_id','消息重试编号无效');
    const text = string(body.text,4000,'消息');
    const old = this.one('SELECT * FROM messages WHERE chat=? AND sender=? AND nonce=?',id,a,body.clientId);
    if (old) {
      if (old.id <= chat.since || old.body !== text) fail(409,'message_conflict','此编号已被使用');
      return this.message(old);
    }
    const row = this.run('INSERT INTO messages(chat,sender,nonce,body,created) VALUES(?,?,?,?,?)',id,a,body.clientId,text,now());
    return this.message(this.one('SELECT * FROM messages WHERE id=?',row.lastInsertRowid));
  }
  report(a,id,message,reason) {
    const chat = this.access(a,id);
    const r = this.one('SELECT id FROM messages WHERE chat=? AND id=? AND id>?',id,message,chat.since);
    if (!r) fail(404,'unknown_message','没有找到该消息');
    this.run("INSERT OR IGNORE INTO reports(id,reporter,message,reason,status,created) VALUES(?,?,?,?,'open',?)",randomUUID(),a,r.id,string(reason,500,'举报原因'),now());
    return this.one('SELECT id,status FROM reports WHERE reporter=? AND message=?',a,r.id);
  }
}
module.exports = { SocialStore, fail, number, string };
