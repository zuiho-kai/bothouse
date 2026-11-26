'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {randomUUID}=require('node:crypto');
const http=require('node:http');
const {createServer}=require('./http.cjs');
const {SocialStore}=require('./store.cjs');

test('each owner brings a separately authenticated AI into an approved room',async t=>{
  const store=new SocialStore(':memory:');
  const arrived=Promise.withResolvers(),release=Promise.withResolvers();
  const calls=[];
  const cloud=http.createServer(async(req,res)=>{
    const chunks=[];
    for await(const part of req)chunks.push(part);
    const body=JSON.parse(Buffer.concat(chunks));
    const key=req.headers.authorization;
    const content=body.input.at(-1).content;
    calls.push({key,content,context:body.input,tools:body.tools,choice:body.tool_choice});
    if(content==='请等一下'){arrived.resolve();await release.promise;}
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',
      content:[{type:'output_text',text:'收到 '+content+'。@伙伴 保留为文字。'}]}]}));
  }).listen(0,'127.0.0.1');
  await once(cloud,'listening');
  let latestSignal;
  const service=createServer(store,{personalAiFetch:(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    latestSignal=options.signal;
    // This mock deliberately delivers its late answer despite cancellation.
    return fetch('http://127.0.0.1:'+cloud.address().port,{...options,signal:undefined});
  }}).listen(0,'127.0.0.1');
  await once(service,'listening');
  t.after(async()=>{
    release.resolve();
    await Promise.all([service,cloud].map(s=>new Promise(resolve=>s.close(resolve))));
    store.db.close();
  });
  const base='http://127.0.0.1:'+service.address().port+'/api/v1';
  async function account(id){
    let cookie;
    async function api(route,data,status=200){
      const res=await fetch(base+route,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',
        ...(cookie?{Cookie:cookie}:{})},...(data&&{body:JSON.stringify(data)})});
      if(res.headers.has('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
      const result=await res.json();
      assert.equal(res.status,status,route+' '+JSON.stringify(result));
      return result;
    }
    await api('/register',{number:id,password:'test fixture only',displayName:id});
    return {id,api};
  }
  const a=await account('test_alice'),b=await account('test_bravo'),other=await account('test_other');
  const friend=(await a.api('/friend-requests',{number:b.id})).request;
  await b.api('/friend-requests/'+friend.id+'/accept',{});
  async function createRoom(title){return (await a.api('/groups',{title,memberNumbers:[b.id]})).conversation.id;}
  const one=await createRoom('第一群'),two=await createRoom('第二群');
  async function bind(actor,key,revision=null){
    return (await actor.api('/personal-ai',{expectedAccount:actor.id,action:'bind',role:'arcade_dragon',name:'同名搭档',key,revision})).identity;
  }
  const alice=await bind(a,'fixture-a'),bravo=await bind(b,'fixture-b');
  assert.notEqual(alice.number,bravo.number);
  assert.equal(alice.displayName,bravo.displayName);
  assert.equal((await a.api('/personal-ai')).identity.number,alice.number);
  const path=room=>'/groups/'+room+'/personal-ai';
  const action=(actor,room,verb,row,more={},code=200)=>actor.api(path(room),{action:verb,expectedAccount:actor.id,
    number:row.number,revision:row.revision,...more},code);
  const say=(actor,room,text,mentionAccount,clientId=randomUUID(),code=200)=>actor.api('/conversations/'+room+'/messages',{clientId,text,mentionAccount},code);
  const aiIn=(state,ai)=>state.roles.find(r=>r.number===ai.number);
  await other.api(path(one),undefined,404);
  await action(a,one,'invite',bravo,{},409);
  const grant=async(actor,role,room)=>{
    const request=aiIn(await action(actor,room,'invite',role),role);
    await say(a,room,'尚未进群',role.number,undefined,403);
    if(actor.id!==a.id)await action(actor,room,'accept',request,{},409);
    return aiIn(await action(a,room,'accept',request),role);
  };
  const ra=await grant(a,alice,one),rb=await grant(b,bravo,one);
  await grant(b,bravo,two);
  await say(a,one,'尚未授权',bravo.number);
  const share=(actor,room,row)=>action(actor,room,'share',row,{provider:'openai',enabled:true,sharingRevision:null});
  await share(b,one,ra);await share(a,one,rb);
  await say(a,one,'各位想说什么？');
  await say(a,two,'仅第一群已授权',bravo.number);
  assert.equal(calls.length,0);
  const stable=randomUUID();
  assert.equal((await say(b,one,'回答甲',alice.number,stable)).reply.sender.number,alice.number);
  await say(b,one,'回答甲',alice.number,stable);
  assert.equal((await say(a,one,'回答乙',bravo.number)).reply.sender.number,bravo.number);
  assert.deepEqual(calls.map(c=>[c.key,c.content]),[['Bearer fixture-a','回答甲'],['Bearer fixture-b','回答乙']]);
  for(const c of calls){
    assert.deepEqual(c.context,[{role:'user',content:JSON.stringify({publicGroupCharacter:{
      name:'同名搭档',description:'',examples:'',background:[],
    }})},{role:'user',content:c.content}]);
    assert.deepEqual(c.tools,[]);assert.equal(c.choice,'none');
  }
  assert.equal((await b.api('/conversations/'+two+'/messages')).messages.filter(m=>m.sender.kind==='ai').length,0);
  const delayed=say(a,one,'请等一下',bravo.number);
  await arrived.promise;
  const cleared=(await b.api('/personal-ai',{expectedAccount:b.id,action:'withdraw',revision:bravo.revision})).identity;
  assert.equal(cleared.configured,false);assert.equal(latestSignal.aborted,true);
  await say(a,one,'撤回后的新消息',bravo.number,undefined,403);
  // Reconnect and re-authorize the very same stable identity before the old answer returns.
  const again=await bind(b,'fixture-b-new',cleared.revision);
  assert.equal(again.number,bravo.number);
  const newGrant=await grant(b,again,one);
  await share(a,one,newGrant);
  release.resolve();
  assert.equal((await delayed).reply,undefined);
  assert.equal((await a.api(path(two))).roles.length,0);
  assert.equal((await say(a,one,'用新授权',bravo.number)).reply.sender.number,bravo.number);
  assert.equal(calls.at(-1).key,'Bearer fixture-b-new');
  await b.api('/groups/'+one+'/leave',{});
  assert.equal((await a.api(path(one))).roles.some(r=>r.number===bravo.number),false);
  await say(a,one,'主人已经离群',bravo.number,undefined,403);
  assert.equal(calls.length,4);
});
