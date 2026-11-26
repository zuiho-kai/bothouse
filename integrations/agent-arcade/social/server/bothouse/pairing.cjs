'use strict';

const {createHash, randomBytes, randomUUID} = require('node:crypto');
const {fail, number} = require('../store.cjs');
const hash = code => createHash('sha256').update(code).digest('hex');

function active(store, account) {
  const row = store.one('SELECT scope, revision FROM bothouse_links WHERE account=?', account);
  return row ? {...JSON.parse(row.scope),revision:row.revision} : null;
}

function checkAccount(account, expected) {
  if (account !== expected) fail(409,'account_changed','请回到生成配对码时使用的好友账号');
}

function revoke(store, account) {
  store.transaction(() => {
    store.run('DELETE FROM bothouse_pair_codes WHERE account=?',account);
    store.run('DELETE FROM bothouse_links WHERE account=?',account);
  });
  return {paired:false};
}

// The local operator selects the account and scope. The public service only redeems.
async function issue(store, request, account, selection) {
  account = number(account);
  if (!store.one("SELECT 1 FROM users WHERE number=? AND kind='human'",account))
    fail(404,'unknown_account','请先注册好友账号并核对号码');
  const identity=selection.identity;
  const projects=selection.projects;
  if (identity !== undefined) {
    if (projects !== undefined || typeof identity!=='string' || !identity.trim() || identity.length>160 ||
        identity==='*' || /[\x00-\x1f\x7f]/.test(identity)) fail(400,'identity','请核对上游实际用户 ID');
  } else if (!Array.isArray(projects) || !projects.length || projects.length>100 ||
             projects.some(p=>typeof p!=='string' || !p || p.length>256))
    fail(400,'selection','请选择一项或多项本机项目');
  const inventory=await request({action:'authority',identity:identity?.toLowerCase()});
  if (!inventory?.instance || !Array.isArray(inventory.projects)) fail(409,'offline','本机 Bothouse 目录暂不可用');
  let scope;
  if (identity !== undefined) {
    if (!inventory.projects.some(p=>p.matches)) fail(409,'identity','当前没有找到明确授权此身份的项目');
    scope={instance:inventory.instance,identity:identity.toLowerCase()};
  } else {
    const available=new Set(inventory.projects.filter(p=>p.selectable).map(p=>p.id));
    if (projects.some(p=>!available.has(p))) fail(409,'selection','部分项目不可选，请核对当前用户权限');
    scope={instance:inventory.instance,projects:[...new Set(projects)]};
  }
  const code=randomBytes(16).toString('hex');
  const expires=Date.now()+5*60*1000;
  store.run('INSERT OR REPLACE INTO bothouse_pair_codes(account,digest,scope,expires) VALUES(?,?,?,?)',
    account,hash(code),JSON.stringify(scope),expires);
  return {account,code,expires};
}

function redeem(store,account,body) {
  checkAccount(account,body.expectedAccount);
  const code=typeof body.code==='string' ? body.code.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{32}$/.test(code)) fail(400,'pair_code','请核对本机生成的配对码');
  return store.transaction(() => {
    const pending=store.one('SELECT scope FROM bothouse_pair_codes WHERE account=? AND digest=? AND expires>?',
      account,hash(code),Date.now());
    if (!pending) fail(409,'invalid_pair','配对码已过期、已使用或属于其他账号');
    store.run('INSERT OR REPLACE INTO bothouse_links(account,scope,revision) VALUES(?,?,?)',account,pending.scope,randomUUID());
    store.run('DELETE FROM bothouse_pair_codes WHERE account=?',account);
    return {paired:true};
  });
}
module.exports={active,checkAccount,revoke,issue,redeem};
