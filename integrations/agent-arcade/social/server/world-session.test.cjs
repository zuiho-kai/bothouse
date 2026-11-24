'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {SocialStore}=require('./store.cjs');
const {planetPublishers}=require('./bothouse/planet-residents.cjs');

test('world tickets bind the current session, audience and durable Friends instance',t=>{
  const store=new SocialStore(':memory:');
  const origin='https://world.example', account='harbour';
  const session='synthetic-session';
  const start=()=>planetPublishers({store,socialOrigin:()=>'https://friends.example',
    env:{LITTLE_WORLDS_ORIGIN:origin}});
  const body={expectedAccount:account,worldOrigin:origin};
  const first=start();
  try{
    store.register(account,'Harbour','human','synthetic');
    store.run('INSERT INTO sessions VALUES(?,?,?)',session,account,Date.now()+120000);
    assert.throws(()=>first.issueTicket(account,session,{...body,expectedAccount:'another'}));
    assert.throws(()=>first.issueTicket(account,session,{...body,worldOrigin:'https://other.example'}));
    const mint=()=>first.issueTicket(account,session,body).ticket;
    const redeem=ticket=>first.redeemTicket({ticket,worldOrigin:origin});
    const ticket=mint();
    assert.throws(()=>first.redeemTicket({ticket,worldOrigin:'https://other.example'}));
    const record=redeem(ticket);
    assert.equal(record.account,account);assert.equal(record.legacy,null);
    assert.match(record.instanceId,/^[\da-f-]{36}$/);assert.throws(()=>redeem(ticket));
    const second=start();
    try{
      const another=second.issueTicket(account,session,body);
      assert.equal(second.redeemTicket({...another,worldOrigin:origin}).instanceId,record.instanceId);
      const expired=mint(), now=Date.now();
      const advance=t.mock.method(Date,'now',()=>now+60001);
      assert.throws(()=>redeem(expired));
      advance.mock.restore();
      const original=mint();
      store.run('DELETE FROM sessions WHERE digest=?',session);
      assert.throws(()=>redeem(original));
    }finally{second.close();}
  }finally{first.close();store.db.close();}
});


test('resident recovery never samples a signed-out, expired or reassigned binding',async t=>{
  const store=new SocialStore(':memory:');
  const world='https://world.example', issuer='https://friends.example';
  const planet='p-12345678-1234-1234-1234-123456789abc',source=planet.slice(2);
  const revoked=[];
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.equal(url,world+'/api/resident-feed/pause');
    revoked.push(options.headers.Authorization);
    return Response.json({ok:true});
  });
  const service=planetPublishers({store,socialOrigin:()=>issuer,
    bothouse:{list:()=>assert.fail('An invalid grant cannot request a directory')},
    env:{LITTLE_WORLDS_ORIGIN:world}});
  function grant(account,expires,revision,home=planet){
    const session='session-'+account,token=account[0].repeat(64);
    store.register(account,account,'human','synthetic');
    store.run('INSERT INTO sessions VALUES(?,?,?)',session,account,expires);
    store.run(`INSERT INTO friend_world_homes(account,issuer,world,planet,resident_source,visits)
      VALUES(?,?,?,?,?,'allowed')`,account,issuer,world,home,source);
    store.run('INSERT INTO world_resident_publishers VALUES(?,?,?,?,?,?,?,?)',
      account,issuer,world,session,planet,source,token,revision);
    return {session,token};
  }
  try{
    const future=Date.now()+60000;
    const signedOut=grant('alice',future,null);
    store.run('DELETE FROM sessions WHERE digest=?',signedOut.session);
    grant('dave',Date.now()-1,null);
    const roleRevoked=grant('bob',future,'withdrawn-pairing');
    const homeChanged=grant('carol',future,null,'p-12345678-1234-1234-1234-123456789abd');
    service.start();
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.deepEqual(new Set(revoked),new Set([roleRevoked,homeChanged].map(x=>'Bearer '+x.token)));
    assert.equal(store.one('SELECT count(*) AS count FROM world_resident_publishers').count,0);
  }finally{service.close();store.db.close();}
});
