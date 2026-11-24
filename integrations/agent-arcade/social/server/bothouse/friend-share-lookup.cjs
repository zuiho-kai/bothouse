'use strict';

const {createHmac,timingSafeEqual,randomUUID}=require('node:crypto');
const {fail,number}=require('../store.cjs');

function friendShareLookup(store,req,token) {
  const time=req.headers['x-friends-lookup-time'];
  const nonce=req.headers['x-friends-lookup-nonce'];
  const proof=req.headers['x-friends-lookup-proof'];
  if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ||
      !token || typeof time!=='string' || !/^\d{10}$/.test(time) || Math.abs(Date.now()/1000-Number(time))>15 ||
      typeof nonce!=='string' || !/^[a-f0-9]{32}$/.test(nonce) ||
      typeof proof!=='string' || !/^[a-f0-9]{64}$/.test(proof))
    fail(403,'share_lookup','好友号核对不可用');
  const account=number(new URL(req.url,'http://127.0.0.1').searchParams.get('number'));
  const challenge=account+'\n'+time+'\n'+nonce;
  const mac=data=>createHmac('sha256',token).update(data).digest();
  if(!timingSafeEqual(Buffer.from(proof,'hex'),mac('lookup\n'+challenge)))
    fail(403,'share_lookup','好友号核对不可用');
  const recipient=store.transaction(()=>{
    const user=store.one("SELECT name FROM users WHERE number=? AND kind='human'",account);
    if(!user) fail(404,'unknown_user','没有这个已注册的好友用户号');
    store.run('INSERT OR IGNORE INTO bothouse_share_accounts(account,identity) VALUES(?,?)',account,randomUUID());
    const {identity}=store.one('SELECT identity FROM bothouse_share_accounts WHERE account=?',account);
    return {number:account,displayName:user.name,identity};
  });
  const body=JSON.stringify(recipient);
  return {body,proof:mac('result\n'+challenge+'\n'+body).toString('hex')};
}
module.exports={friendShareLookup};
