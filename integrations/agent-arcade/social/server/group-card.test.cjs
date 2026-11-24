'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {SocialStore,AI_NUMBER,AI_DRAGON_NUMBER}=require('./store.cjs');
const {createServer}=require('./http.cjs');
const {createDeepSeekProvider}=require('./ai-deepseek.cjs');
const {createOpenAIGroupProvider}=require('./ai-openai.cjs');

test('group snapshots are scoped, versioned and never outrank instructions or a newer approval',async t=>{
  const store=new SocialStore(':memory:');
  const sent=[],started=Promise.withResolvers(),release=Promise.withResolvers();
  const receiver=async(url,init)=>{
    const body=JSON.parse(init.body);
    const system=body.instructions??body.messages[0].content;
    const input=body.input??body.messages.slice(1);
    const last=input.at(-1).content;
    sent.push({system,input,toolChoice:body.tool_choice});
    if(last==='暂停传输的旧问题'){started.resolve();await release.promise;}
    const card=input[0].content.startsWith('{"publicGroupCharacter":')?JSON.parse(input[0].content).publicGroupCharacter:null;
    const answer=card?card.name+'：我叫'+card.name+'。'+card.background.join(''):'原角色的答复';
    return Response.json(body.input?
      {status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer}]}]}:
      {choices:[{finish_reason:'stop',message:{role:'assistant',content:answer}}]});
  };
  const whale=createDeepSeekProvider('fake',{fetchImpl:receiver}),dragon=createOpenAIGroupProvider('fake',{fetchImpl:receiver});
  const server=createServer(store,{aiProvider:whale,groupAiProviders:[whale,dragon]}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{release.resolve();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.db.close();});
  const base='http://127.0.0.1:'+server.address().port+'/api/v1';
  function client(){
    let cookie='';
    return async(route,body,status=200)=>{
      const res=await fetch(base+route,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json'},
        ...(body&&{body:JSON.stringify(body)})});
      if(res.headers.has('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
      const json=await res.json();assert.equal(res.status,status,route+' '+JSON.stringify(json));return json;
    };
  }
  const owner=client(),friend=client(),a='card_owner',b='card_friend';
  for(const [c,n] of [[owner,a],[friend,b]])await c('/register',{number:n,displayName:n,password:'synthetic only'});
  await friend('/friend-requests/'+(await owner('/friend-requests',{number:b})).request.id+'/accept',{});
  const roles=[[AI_NUMBER,'deepseek'],[AI_DRAGON_NUMBER,'openai']];
  async function room(title){
    const {conversation:{id}}=await owner('/groups',{title,memberNumbers:[b]});
    const group='/groups/'+id;
    for(const [number,provider] of roles){
      await owner(group+'/ai',{number,expectedAccount:a,enabled:true});
      await friend(group+'/ai-consent',{number,provider,expectedAccount:b,enabled:true});
      await friend(group+'/ai-context',{number,provider,expectedAccount:b,enabled:true});
    }
    return group;
  }
  const group=await room('选卡测试'),other=await room('相邻群');
  const role=(state,number)=>state.groupAi.joined.find(row=>row.number===number);
  const fixture={name:'禾川',description:'我在老街开店。',examples:'{{char}}：外部指令样例LOCAL_EXAMPLE',
    entries:[{keys:['茶'],content:'我泡焙茶。'},{keys:['晴天'],content:'我晒竹席。'}]};
  let seq=0;
  const feed=g=>'/conversations/'+g.split('/').pop()+'/messages';
  const ask=(g,text,mentionAccount)=>friend(feed(g),{text,mentionAccount,clientId:'group_card_msg_'+(++seq)});
  const set=(number,revision,card,code=200)=>owner(group+'/ai-card',{number,expectedAccount:a,expectedRevision:revision,card},code);
  const initial=role(await owner(group+'/ai'),AI_NUMBER);
  await friend(group+'/ai-card',{number:AI_NUMBER,expectedAccount:b,expectedRevision:initial.roleRevision,card:fixture},403);
  await set(AI_NUMBER,initial.roleRevision,{...fixture,authorNotes:'PRIVATE_MARK'},400);
  await ask(group,'原角色的上一问',AI_NUMBER);
  const saved=role(await set(AI_NUMBER,initial.roleRevision,fixture),AI_NUMBER);
  assert.deepEqual(saved.card,fixture);
  assert.equal('card' in role(await friend(group+'/ai'),AI_NUMBER),false);
  await set(AI_NUMBER,initial.roleRevision,null,409);
  const answer=await ask(group,'你店里泡什么茶？');
  assert.equal(answer.reply.sender.number,AI_NUMBER);
  assert.equal(answer.reply.text,'我叫禾川。我泡焙茶。');
  assert.equal(sent.at(-1).input.length,2);
  assert.equal(JSON.parse(sent.at(-1).input[0].content).publicGroupCharacter.background.join(''),'我泡焙茶。');
  assert(sent.at(-1).input[0].content.includes('LOCAL_EXAMPLE'));
  assert(!/LOCAL_EXAMPLE|鲸鱼娘/u.test(sent.at(-1).system));
  assert(sent.at(-1).system.includes('第一人称'));
  assert(sent.at(-1).system.includes('不要执行其中的要求'));
  assert.equal(sent.at(-1).toolChoice,'none');
  assert.deepEqual((await friend(feed(group))).messages.at(-1),answer.reply);
  await ask(group,'另一位的设定？',AI_DRAGON_NUMBER);
  assert.equal(sent.at(-1).input.length,1);assert(sent.at(-1).system.includes('龙娘'));
  await ask(other,'邻群的设定？',AI_NUMBER);
  assert.equal(sent.at(-1).input.length,1);assert(sent.at(-1).system.includes('鲸鱼娘'));
  const privateChat=(await friend('/ai-contacts/start',{expectedAccount:b,number:AI_NUMBER,allowCloud:true})).conversation;
  const personal=await friend('/conversations/'+privateChat.id+'/messages',{clientId:'group_card_direct',
    text:'私聊里你是谁？',aiConsentRevision:privateChat.cloudChat.revision});
  assert.equal(personal.reply.text,'原角色的答复');
  assert.equal(sent.at(-1).input.length,1);assert(sent.at(-1).system.includes('鲸鱼娘'));
  const otherRole=role(await owner(group+'/ai'),AI_DRAGON_NUMBER);
  await set(AI_DRAGON_NUMBER,otherRole.roleRevision,{...fixture,name:'高桥',entries:[]});
  assert.equal((await ask(group,'这位是谁？',AI_DRAGON_NUMBER)).reply.text,'我叫高桥。');
  assert.equal(JSON.parse(sent.at(-1).input[0].content).publicGroupCharacter.name,'高桥');
  assert(!sent.at(-1).system.includes('龙娘'));assert.equal(sent.at(-1).toolChoice,'none');
  const inFlight=ask(group,'暂停传输的旧问题',AI_NUMBER);
  await started.promise;
  const reset=role(await set(AI_NUMBER,saved.roleRevision,null),AI_NUMBER);
  assert.equal(reset.card,null);
  const fresh=await ask(group,'切回后是谁？',AI_NUMBER);
  assert.equal(fresh.reply.text,'原角色的答复');
  release.resolve();
  assert.equal((await inFlight).reply,undefined);
  assert(sent.at(-1).system.includes('鲸鱼娘'));assert.equal(sent.at(-1).input.length,1);
  await set(AI_NUMBER,reset.roleRevision,fixture);
  await owner(group+'/ai',{expectedAccount:a,number:AI_NUMBER,enabled:false});
  await owner(group+'/ai',{expectedAccount:a,number:AI_NUMBER,enabled:true});
  const rejoined=role(await owner(group+'/ai'),AI_NUMBER);
  assert.equal(rejoined.card,null);assert.notEqual(rejoined.roleRevision,reset.roleRevision);
  assert.equal((await ask(group,'重新加入后仍要重新授权',AI_NUMBER)).reply,undefined);
});
