'use strict';

const {timingSafeEqual,randomUUID}=require('node:crypto');
const {fail,number}=require('../store.cjs');

function friendShareLookup(store,req,token) {
  const presented=req.headers.authorization;
  if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ||
      !token || token.length<32 || typeof presented!=='string' ||
      Buffer.byteLength(presented)!==Buffer.byteLength('Bearer '+token) ||
      !timingSafeEqual(Buffer.from(presented),Buffer.from('Bearer '+token)))
    fail(403,'share_lookup','好友号核对不可用');
  const account=number(new URL(req.url,'http://127.0.0.1').searchParams.get('number'));
  return store.transaction(()=>{
    const user=store.one("SELECT name FROM users WHERE number=? AND kind='human'",account);
    if(!user) fail(404,'unknown_user','没有这个已注册的好友用户号');
    store.run('INSERT OR IGNORE INTO bothouse_share_accounts(account,identity) VALUES(?,?)',account,randomUUID());
    const {identity}=store.one('SELECT identity FROM bothouse_share_accounts WHERE account=?',account);
    return {number:account,displayName:user.name,identity};
  });
}
module.exports={friendShareLookup};
