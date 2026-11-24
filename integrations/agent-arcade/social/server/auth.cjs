'use strict';
const { randomBytes, createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { fail, number, string } = require('./store.cjs');
const derive = promisify(scrypt);
const lifetime = 30 * 24 * 3600;
const digest = token => createHash('sha256').update(token).digest('hex');
function cookieValue(req) {
  return /(?:^|;\s*)arcade_social=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
}
function current(store,req) {
  const token = cookieValue(req);
  const row = token && store.one('SELECT account FROM sessions WHERE digest=? AND expires>?',digest(token),Date.now());
  if (!row) fail(401,'login_required','请先登录');
  return row.account;
}
function makeAuth(store,secure) {
  const attempts = new Map();
  let active = 0;
  const attributes = '; Path=/; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '');
  function issue(account,res,req) {
    const token = randomBytes(32).toString('hex');
    store.run('DELETE FROM sessions WHERE expires<=?',Date.now());
    const previous = cookieValue(req);
    if (previous) store.run('DELETE FROM sessions WHERE digest=?',digest(previous));
    store.run('INSERT INTO sessions VALUES(?,?,?)',digest(token),account,Date.now()+lifetime*1000);
    res.setHeader('Set-Cookie','arcade_social='+token+'; Max-Age='+lifetime+attributes);
  }
  async function enter(register,body,req,res) {
    const account = number(body.number);
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) fail(400,'password','密码长度须为 8–128');
    // The reverse proxy may overwrite this single header only on the private loopback upstream.
    const key = secure ? (req.headers['x-real-ip'] || req.socket.remoteAddress) : req.socket.remoteAddress;
    const time = Date.now();
    if (attempts.size >= 4096) for (const [k,v] of attempts) if (v.until <= time) attempts.delete(k);
    const old = attempts.get(key);
    const window = old && old.until > time ? old : {count:0,until:time+60000};
    if (active >= 4 || ++window.count > 30 || (!old && attempts.size >= 4096)) fail(429,'slow_down','请求过于频繁，请稍后重试');
    attempts.set(key,window);
    active++;
    try {
      const row = register ? null : store.one("SELECT password FROM users WHERE number=? AND kind='human'",account);
      const [salt,expected] = row ? row.password.split('.') : [randomBytes(16).toString('hex'),null];
      const key = await derive(body.password,salt,64);
      if (!register && (!expected || !timingSafeEqual(key,Buffer.from(expected,'hex')))) fail(401,'bad_login','用户号或密码有误');
      return store.transaction(() => {
        const user = register ? store.register(account,string(body.displayName,48,'昵称'),'human',salt+'.'+key.toString('hex')) : store.user(account);
        issue(account,res,req);
        return {user};
      });
    } finally { active--; }
  }
  function logout(req,res) {
    const token = cookieValue(req);
    if (token) store.run('DELETE FROM sessions WHERE digest=?',digest(token));
    res.setHeader('Set-Cookie','arcade_social=; Max-Age=0'+attributes);
    return {ok:true};
  }
  return {enter,logout};
}
module.exports = { current, makeAuth };
