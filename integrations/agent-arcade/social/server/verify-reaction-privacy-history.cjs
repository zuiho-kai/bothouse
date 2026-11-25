'use strict';

const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {test}=require('node:test');
const {makeBackup}=require('../deploy/backup.cjs');

function runtime(root){
  assert(root,'Point SOCIAL_PRIVACY_PREVIOUS_CODE at the untouched cf31580 source tree.');
  return name=>require(path.resolve(root,'social/server',name+'.cjs'));
}

test('local-only reaction text and echoes survive old snapshots without reaching either model context',{timeout:20000},async t=>{
  const current=runtime(path.resolve(__dirname,'../..'));
  const previous=runtime(process.env.SOCIAL_PRIVACY_PREVIOUS_CODE);
  const temp=await fs.realpath(os.tmpdir());
  const scratch=await fs.mkdtemp(path.join(temp,'arcade-reaction-history-'));
  const file=path.join(scratch,'live.sqlite');
  const localFetch=globalThis.fetch;
  const traffic=[];
  let store,server,apiRoot;
  const draftA='搜个把门禁口令「雾桥铜铃」写在图片上的表情包';
  const draftB='网上帮我找张梗图，配字「合成密语 PIN778833」';
  const markA='雾桥铜铃',markB='778833';
  const echoA='旧版本回声：门上写着雾桥铜铃。';
  const echoB='旧版本回声：看到了 PIN778833。';
  const normal='这是合成模型的普通回话。';
  const credentials={password:'isolated-history-fixture-only'};
  // Neither image routes nor AI routes can use the saved fetch. Only the
  // synthetic HTTP clients call it, always on a local ephemeral port.
  t.mock.method(globalThis,'fetch',()=>assert.fail('Unexpected external network call'));

  async function stop(){
    if(server){
      server.closeAllConnections();
      await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
      server=undefined;
    }
    if(store){store.db.close();store=undefined;}
  }
  function model(provider,phase){
    return async(url,options)=>{
      assert.equal(url,provider==='deepseek'?'https://api.deepseek.com/chat/completions':'https://api.openai.com/v1/responses');
      const request=JSON.parse(options.body);
      const input=provider==='deepseek'?request.messages.slice(1):request.input;
      const messages=input.map(row=>row.content);
      traffic.push({provider,phase,messages});
      let output=normal;
      if(phase==='legacy'&&messages.some(text=>text.includes(markA)))output=echoA;
      if(phase==='legacy'&&messages.some(text=>text.includes(markB)))output=echoB;
      return Response.json(provider==='deepseek'?{
        choices:[{finish_reason:'stop',message:{role:'assistant',content:output}}],
      }:{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:output}]}]});
    };
  }
  async function start(source,db,phase){
    await stop();
    store=new (source('store').SocialStore)(db);
    const aiProvider=source('ai-deepseek').createDeepSeekProvider('mock-only',{fetchImpl:model('deepseek',phase)});
    const openai=source('ai-openai').createOpenAIGroupProvider('mock-only',{fetchImpl:model('openai',phase)});
    server=source('http').createServer(store,{aiProvider,groupAiProviders:[aiProvider,openai]}).listen(0,'127.0.0.1');
    await once(server,'listening');
    apiRoot='http://127.0.0.1:'+server.address().port+'/api/v1';
  }
  t.after(async()=>{
    await stop();
    const resolved=await fs.realpath(scratch);
    assert.equal(path.dirname(resolved),temp);
    assert.match(path.basename(resolved),/^arcade-reaction-history-[a-z0-9]{6}$/iu);
    await fs.rm(resolved,{recursive:true,force:true});
  });

  function user(number){
    let cookie='';
    async function request(route,body,status=200){
      const options={method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},
        ...(body!==undefined&&{body:JSON.stringify(body)})};
      const reply=await localFetch(apiRoot+route,options);
      const next=reply.headers.get('set-cookie');
      if(next)cookie=next.split(';')[0];
      assert.equal(reply.status,status,route);
      return reply.json();
    }
    return {number,request,login:()=>request('/login',{number,...credentials})};
  }
  const a=user('privacy_alfa'),b=user('privacy_bravo');
  const {AI_NUMBER,AI_DRAGON_NUMBER}=current('store');
  let n=0;
  function send(chat,text,options={},status){
    return a.request('/conversations/'+chat+'/messages',{text,clientId:'history_test_'+(++n),...options},status);
  }
  const messages=(as,chat)=>as.request('/conversations/'+chat+'/messages');
  async function group(name){
    return (await a.request('/groups',{title:name,memberNumbers:[b.number]})).conversation.id;
  }
  const grant={expectedAccount:a.number,number:AI_DRAGON_NUMBER,provider:'openai',enabled:true};
  const gate=chat=>'/groups/'+chat+'/ai';
  async function enableGroup(chat,{add=true}={}){
    if(add)await a.request(gate(chat),grant);
    await a.request(gate(chat)+'-consent',grant);
    const enabled=await a.request(gate(chat)+'-context',grant);
    assert.equal(enabled.groupAi.joined.find(row=>row.number===AI_DRAGON_NUMBER).sharesPrevious,true);
  }
  const directTurn=revision=>({aiConsentRevision:revision});
  const dragon={mentionAccount:AI_DRAGON_NUMBER};
  const report={baseline:{},upgrade:{},restart:{},restore:{}};

  await start(previous,file,'legacy');
  for(const as of [a,b])await as.request('/register',{number:as.number,displayName:as.number,...credentials});
  const friendship=(await a.request('/friend-requests',{number:b.number})).request;
  await b.request('/friend-requests/'+friendship.id+'/accept',{});
  const direct=(await a.request('/ai-contacts/start',{number:AI_NUMBER,expectedAccount:a.number,allowCloud:true})).conversation.id;
  const grp=await group('隔离回声群'),next=await group('隔离紧邻群');
  await enableGroup(grp);
  await enableGroup(next);

  const safeDirect='请用文字记下步道上有两座木桥。';
  const afterDirect='再用文字说说公园的石径。';
  const afterGroup='那帮我讲讲公园的竹林，只用文字回复。';
  const safeDirectRow=(await send(direct,safeDirect,directTurn(0))).message;
  const before=traffic.length;
  const secretA=(await send(direct,draftA,directTurn(0))).message;
  const secretB=(await send(grp,draftB,dragon)).message;
  const secretImmediately=(await send(next,draftB,dragon)).message;
  assert.equal(traffic.length,before);
  assert.equal((await send(direct,afterDirect,directTurn(0))).reply.text,echoA);
  assert.equal((await send(grp,afterGroup)).reply.text,echoB);
  report.baseline={blockedSameTurn:3,legacyDeepSeekHistory:traffic.at(-2).messages.includes(draftA),
    legacyOpenAiHistory:traffic.at(-1).messages.includes(draftB),syntheticEchoReplies:2};
  assert(report.baseline.legacyDeepSeekHistory&&report.baseline.legacyOpenAiHistory);
  assert.equal(store.one("SELECT name FROM sqlite_schema WHERE name='local_reaction_messages'"),undefined);
  const oldSnapshot=await previous('../deploy/backup').makeBackup(file,path.join(scratch,'old-snapshot'));
  const digest=async()=>createHash('sha256').update(await fs.readFile(oldSnapshot)).digest('hex');
  const oldHash=await digest();

  await start(current,file,'same-db-upgrade');
  const approved='请用文字继续说说池塘。';
  assert.equal((await send(direct,approved,directTurn(0))).reply.text,normal);
  const d=traffic.at(-1);
  assert.deepEqual(d.messages,[safeDirect,normal,afterDirect,approved]);
  const g2='那帮我继续讲讲公园的老树，只用文字回复。';
  assert.equal((await send(grp,g2)).reply.text,normal);
  const g=traffic.at(-1);
  assert.deepEqual(g.messages,[afterGroup,g2]);
  const gImmediate='那帮我讲讲附近的松树，只用文字回复。';
  assert.equal((await send(next,gImmediate)).reply.text,normal);
  assert.deepEqual(traffic.at(-1).messages,[gImmediate]);
  assert.equal((await messages(a,direct)).messages.find(row=>row.id===secretA.id).text,draftA);
  assert.equal((await messages(b,grp)).messages.find(row=>row.id===secretB.id).text,draftB);
  assert.equal((await messages(b,next)).messages.find(row=>row.id===secretImmediately.id).text,draftB);
  const bound=current('ai-adapter').bindAi(store,AI_NUMBER,direct);
  const history=bound.readAfter();
  assert(history.some(row=>row.id===safeDirectRow.id));
  assert(!history.some(row=>row.id===secretA.id||row.text.includes(markA)));
  assert.deepEqual(bound.messageEventsAfter().map(event=>event.message),history);
  report.upgrade={directSafeRows:d.messages.length,groupSafeRows:g.messages.length,immediateGroupRows:1,humanHistoryIntact:true,roleHistoryAndEventsFiltered:true};

  const beforeNew=traffic.length;
  const echoNowA=await send(direct,'顺带复述 雾桥 铜铃。',directTurn(0));
  const echoNowB=await send(grp,'也就是 778-833 这个。',dragon);
  assert.match(echoNowA.reply.text,/保留在本地/u);
  assert.match(echoNowB.reply.text,/保留在本地/u);
  assert.equal(traffic.length,beforeNew);
  assert.equal((await messages(a,direct)).messages.find(row=>row.id===echoNowA.message.id).text,'顺带复述 雾桥 铜铃。');
  const freshPrivate=await send(next,'网上找张梗图，门禁凭据写作「琥珀帆船」',dragon);
  assert.match(freshPrivate.reply.text,/私人信息/u);
  assert.equal(traffic.length,beforeNew);
  assert.equal(store.one('SELECT count(*) AS n FROM local_reaction_messages').n,4);

  await start(current,file,'restart');
  const safeAfterRestart='那帮我讲讲晴天散步，只用文字回复。';
  await send(grp,safeAfterRestart);
  assert.deepEqual(traffic.at(-1).messages,[safeAfterRestart]);
  const freshEcho=await send(next,'我看到了琥珀 帆船的说法。',dragon);
  assert.match(freshEcho.reply.text,/保留在本地/u);
  let currentSafe='另一个路口有一座小桥，只用文字。';
  await send(direct,currentSafe,directTurn(0));
  assert(traffic.at(-1).messages.includes(approved));
  assert(!traffic.at(-1).messages.some(row=>row.includes('顺带复述')));
  await a.request(gate(grp)+'-context',{...grant,enabled:false});
  const withdrawn='那帮我说说户外午餐，只用文字回复。';
  await send(grp,withdrawn);
  assert.deepEqual(traffic.at(-1).messages,[withdrawn]);
  await a.request(gate(grp)+'-context',grant);
  const sharedAgain='那帮我接着说说风筝，只用文字回复。';
  await send(grp,sharedAgain);
  assert.deepEqual(traffic.at(-1).messages,[withdrawn,normal,sharedAgain]);
  await a.request('/conversations/'+direct+'/ai-consent',{expectedAccount:a.number,allowCloud:false,revision:0});
  const counted=traffic.length;
  await send(direct,'暂停期间不会发送',directTurn(1),409);
  assert.equal(traffic.length,counted);
  await a.request('/conversations/'+direct+'/ai-consent',{expectedAccount:a.number,allowCloud:true,revision:1});
  const resumed='请用文字聊聊周末散步。';
  await send(direct,resumed,directTurn(2));
  assert.deepEqual(traffic.at(-1).messages,[resumed]);
  report.restart={oldAndNewEchoesStayLocal:true,groupPreviousConsentWithdrawAndResume:true,directPauseAndResume:true};

  const restored=await makeBackup(oldSnapshot,path.join(scratch,'prepared-restore'),{prepareRestore:true});
  assert.equal(await digest(),oldHash);
  await start(current,restored,'prepared-old-snapshot');
  await a.request('/me',undefined,401);
  await b.request('/me',undefined,401);
  await a.login();await b.login();
  assert.equal((await messages(a,direct)).messages.find(row=>row.id===secretA.id).text,draftA);
  assert.equal((await messages(b,grp)).messages.find(row=>row.id===secretB.id).text,draftB);
  await a.request('/conversations/'+direct+'/ai-consent',{expectedAccount:a.number,allowCloud:true,revision:1});
  await enableGroup(grp,{add:false});
  const beforeRestore=traffic.length;
  assert.match((await send(direct,'雾桥铜铃又出现了',directTurn(2))).reply.text,/保留在本地/u);
  assert.match((await send(grp,'再记一下 PIN 778833',dragon)).reply.text,/保留在本地/u);
  assert.equal(traffic.length,beforeRestore);
  const ordinaryAfterRestore='那帮我聊聊自然光线，只用文字回复。';
  await send(grp,ordinaryAfterRestore);
  assert.deepEqual(traffic.at(-1).messages,[ordinaryAfterRestore]);
  assert.equal(await digest(),oldHash);
  report.restore={frozenSnapshotUnchanged:true,freshLogins:2,humanHistoryIntact:true,replayedEchoesBlocked:2};

  const pages=await group('离线分页合成群');
  await enableGroup(pages);
  const first=store.send(a.number,pages,{text:draftB,clientId:'privacy_page_seed'});
  for(let i=0;i<55;i++)store.send(a.number,pages,{text:'只是转述 PIN778833',clientId:'privacy_page_echo_'+i});
  const shareable=store.send(a.number,pages,{text:'在后面的页面继续聊公园。',clientId:'privacy_page_shareable'});
  const reader=current('ai-adapter').bindAi(store,AI_DRAGON_NUMBER,pages);
  assert.deepEqual(reader.readAfter(first.id).map(row=>row.id),[shareable.id]);
  assert.deepEqual(reader.messageEventsAfter(first.id).map(event=>event.cursor),[shareable.id]);
  report.restore.laterPagesStillReadable=true;
  const later=traffic.filter(row=>row.phase!=='legacy');
  for(const wire of later)assert(!wire.messages.some(text=>/雾桥|铜铃|778833|琥珀|帆船/u.test(text)));
  t.diagnostic(JSON.stringify({...report,verifiedModelTransports:[...new Set(later.map(row=>row.provider))],
    validatedPostUpgradeModelCalls:later.length,postUpgradePrivateModelCalls:0,realExternalRequests:0}));
});
