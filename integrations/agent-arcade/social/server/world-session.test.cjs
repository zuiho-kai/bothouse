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
