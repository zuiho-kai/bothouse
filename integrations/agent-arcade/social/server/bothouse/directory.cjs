'use strict';
const {execFile} = require('node:child_process');
const {existsSync} = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {fail} = require('../store.cjs');
const pairing = require('./pairing.cjs');
const {dimensions,modelPhoto} = require('../../../src/core/static-image.cjs');

const portraitLimit = 2 * 1024 * 1024;

function localInstance(env = process.env) {
  const preferred = path.join(os.homedir(), '.bothouse');
  const legacy = path.join(os.homedir(), '.cc-connect');
  const config = path.join(env.BOTHOUSE_DATA_DIR || (existsSync(preferred) || !existsSync(legacy) ? preferred : legacy), 'config.toml');
  const python = env.SOCIAL_BOTHOUSE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  let active = 0;
  return async function request(data) {
    if (active >= 24 || !path.isAbsolute(config) || !existsSync(config)) return {error:'unavailable'};
    active++;
    try {
      return await new Promise(resolve => {
        const child = execFile(python, ['-I','-B','-X','utf8',path.join(__dirname,'instance.py'),config],
          {windowsHide:true, timeout:data.action === 'chat' ? 70000 : 9000,
            maxBuffer:data.action === 'portrait' ? 3 * 1024 * 1024 : 256 * 1024}, (error,out) => {
            if (!error) try {return resolve(JSON.parse(out));} catch {}
            resolve({error:'unavailable'});
          });
        child.stdin.on('error',()=>{});
        child.stdin.end(JSON.stringify(data));
      });
    } finally {active--;}
  };
}

function bothouseDirectory(store, request) {
  const targetNumber = /^bh_[a-f0-9]{21}$/;
  async function list(account, number) {
    const data = await request({action:'list',account,link:pairing.active(store,account),...(number && {number})});
    if (!Array.isArray(data?.contacts)) return {contacts:[],directoryStatus:'offline'};
    return {contacts:data.contacts, directoryStatus:data.directoryStatus};
  }
  async function resolveMember(account, number) {
    if (typeof number!=='string' || !targetNumber.test(number.toLowerCase())) return null;
    number=number.toLowerCase();
    return (await list(account,number)).contacts.find(member=>member.number === number) || null;
  }
  function install(role) {
    const old = store.one('SELECT kind FROM users WHERE number=?',role.number);
    if (!old) store.register(role.number,role.displayName,'ai',null);
    else if (old.kind !== 'ai') fail(409,'role_conflict','这个角色的社交号已被占用');
    else store.run('UPDATE users SET name=? WHERE number=? AND name<>?',role.displayName,role.number,role.displayName);
  }
  async function start(account,body) {
    if (body.expectedAccount !== account) fail(409,'account_changed','请回到当前账号');
    const role = await resolveMember(account,body.number);
    if (!role?.configured) fail(409,'bothouse_unavailable','此账号暂时无法联系这位 Bothouse 角色');
    return store.transaction(()=>{ install(role); return {conversation:store.openDirect(account,role.number)}; });
  }
  async function group(account,chat,body) {
    const canManage = store.group(account,chat).owner === account;
    const {contacts,directoryStatus} = await list(account);
    if (body) {
      if (!canManage || body.expectedAccount !== account || typeof body.enabled !== 'boolean')
        fail(403,'group_owner','请用当前群主账号管理群成员');
      const role = contacts.find(r=>r.number===body.number);
      store.transaction(()=>{
        if (!targetNumber.test(body.number)) fail(404,'unknown_role','找不到这个角色');
        if (!body.enabled) {store.remove(account,chat,body.number,false);return;}
        if (!role?.configured) fail(409,'bothouse_unavailable','这位 Bothouse 角色暂不可用');
        install(role);
        if (store.one('SELECT 1 FROM members WHERE chat=? AND account=?',chat,role.number)) return;
        if (store.one('SELECT count(*) n FROM members WHERE chat=?',chat).n>=100) fail(409,'group_full','群成员上限为 100 人');
        const floor = store.one('SELECT coalesce(max(id),0) n FROM messages').n;
        store.run('INSERT INTO members VALUES(?,?,?)',chat,role.number,floor);
      });
    }
    const joined = store.all("SELECT u.number,u.name AS displayName FROM members m JOIN users u ON m.account=u.number WHERE m.chat=? AND u.kind='ai'",chat)
      .filter(row=>targetNumber.test(row.number)).map(row=>{
        const role=contacts.find(r=>r.number===row.number);
        return {...row,kind:'ai',source:'bothouse',configured:!!role?.configured,sharing:!!role?.configured};
      });
    return {groupAi:{joined,canManage,available:canManage?contacts:[],directoryStatus}};
  }
  async function portrait(account, chatId) {
    const peer = chat => chat.first_user === account ? chat.second_user : chat.first_user;
    const chat = store.access(account,chatId);
    if (chat.type !== 'direct') return null;
    const number = peer(chat);
    if (!targetNumber.test(number) || store.user(number).kind !== 'ai') return null;
    const link = pairing.active(store,account);
    const result = await request({action:'portrait',account,number,link});
    if (pairing.active(store,account)?.revision !== link?.revision) return null;
    const current = store.access(account,chatId);
    if (current.type !== 'direct' || peer(current) !== number || current.membershipRevision !== chat.membershipRevision)
      return null;
    const {mime,portrait} = result || {};
    if (!['image/png','image/jpeg'].includes(mime) || typeof portrait !== 'string' ||
        portrait.length > Math.ceil(portraitLimit / 3) * 4) return null;
    try {
      const source = Buffer.from(portrait,'base64');
      if (source.length > portraitLimit || source.toString('base64') !== portrait) return null;
      const {width,height} = dimensions(source,mime === 'image/png' ? '.png' : '.jpg');
      if (width > 4096 || height > 4096) return null;
      return 'data:'+mime+';base64,'+modelPhoto(source,mime).toString('base64');
    } catch { return null; }
  }
  function stage(account,message) {
    const chat=store.access(account,message.conversationId);
    const direct=chat.type==='direct';
    const number=direct ? (chat.first_user===account ? chat.second_user : chat.first_user) : message.mention?.number;
    if (!targetNumber.test(number) || store.user(number).kind !== 'ai') return null;
    const role=store.access(number,chat.id);
    const link=pairing.active(store,account);
    return {account,number,direct,messageId:message.id,text:message.text,chat:chat.id,link,
      scope:[chat.id,chat.membershipRevision,role.membershipRevision,...(link ? [link.revision] : [])]};
  }
  function current(turn) {
    try {
      return pairing.active(store,turn.account)?.revision===turn.scope[3] &&
        store.access(turn.account,turn.chat).membershipRevision===turn.scope[1] &&
        store.access(turn.number,turn.chat).membershipRevision===turn.scope[2] &&
        store.one('SELECT removed FROM messages WHERE id=?',turn.messageId)?.removed===0;
    } catch (error) {if(error.status===404)return false;throw error;}
  }
  async function finish(turn) {
    if (!current(turn)) return {};
    if (/^\s*\//u.test(turn.text)) return {bothouseStatus:'chat_text_only'};
    const data=await request({action:'chat',...turn});
    if (!data?.text) return {bothouseStatus:'unavailable'};
    // Re-read live visibility after the turn; a removed/replaced role cannot answer for its successor.
    const role=await resolveMember(turn.account,turn.number);
    if (!role?.configured || !current(turn)) return {bothouseStatus:'cancelled'};
    const reply=store.send(turn.number,turn.chat,{text:data.text,clientId:'bothouse-'+turn.messageId});
    return {reply,bothouseStatus:'replied'};
  }
  return {list,resolveMember,start,group,portrait,stage,finish,isRole:number=>typeof number==='string' && targetNumber.test(number.toLowerCase())};
}
module.exports = {localInstance,bothouseDirectory};
