'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {fork} = require('node:child_process');
const {once} = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {SocialStore} = require('./store.cjs');
const {moderate} = require('./moderate.cjs');
const {provisionAi,bindAi} = require('./ai-adapter.cjs');
const {createServer} = require('./http.cjs');
const {createHash} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');

function client(base) {
  let cookie = '';
  return async function request(endpoint,body,status=200,headers={}) {
    const res = await fetch(base()+'/api/v1'+endpoint,{
      method:body === undefined ? 'GET' : 'POST',
      headers:{'Content-Type':'application/json',Cookie:cookie,...headers},
      body:body === undefined ? undefined : JSON.stringify(body)
    });
    const next = res.headers.get('Set-Cookie');
    if (next) cookie = next.split(';')[0];
    const data = await res.json();
    assert.equal(res.status,status,endpoint+' '+JSON.stringify(data));
    return data;
  };
}

test('authorized AI direct messages are isolated, durable and idempotent across two accounts',async t=>{
  const {createServer:mockServer}=require('node:http');
  const {createDeepSeekProvider}=require('./ai-deepseek.cjs');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcade-ai-direct-'));
  const filename=path.join(dir,'social.sqlite');
  const key='synthetic-deepseek-key';
  const calls=[];
  const arrived=Promise.withResolvers(),release=Promise.withResolvers(),upstreamClosed=Promise.withResolvers();
  const cloud=mockServer(async (req,res)=>{
    assert.equal(req.url,'/chat/completions');
    assert.equal(req.headers.authorization,'Bearer '+key);
    const chunks=[];
    for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks));
    calls.push(body);
    const text=body.messages.at(-1).content;
    if(text==='合成慢请求'){
      res.once('close',upstreamClosed.resolve);
      arrived.resolve();
      await release.promise;
    }
    res.writeHead(text==='合成失败'?503:200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'鲸鱼娘收到了 '+text}}]}));
  }).listen(0,'127.0.0.1');
  await once(cloud,'listening');
  let store,server,base;
  const stop=async()=>{
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    store?.db.close();
    store=null;
  };
  t.after(async()=>{
    await stop();
    await new Promise(resolve=>cloud.close(resolve));
    await fs.rm(dir,{recursive:true,force:true});
  });
  async function start(configured=true){
    store=new SocialStore(filename);
    const aiProvider=configured?createDeepSeekProvider(key,{fetchImpl:(url,init)=>{
      assert.equal(url,'https://api.deepseek.com/chat/completions');
      return fetch('http://127.0.0.1:'+cloud.address().port+'/chat/completions',init);
    }}):undefined;
    server=createServer(store,{aiProvider}).listen(0,'127.0.0.1');
    await once(server,'listening');
    base='http://127.0.0.1:'+server.address().port;
  }
  await start();
  const a=client(()=>base),b=client(()=>base);
  const password='fixture pass';
  for(const [session,number] of [[a,'studio_a'],[b,'studio_b']])await session('/register',{number,password,displayName:'合成同名'});
  const guests=await client(()=>base)('/ai-contacts',undefined,401);
  assert.equal(guests.error.code,'login_required');
  const {contacts:[bot]}=await a('/ai-contacts');
  assert.deepEqual(bot,{number:'arcade_whale',displayName:'鲸鱼娘',kind:'ai'});
  await client(()=>base)('/login',{number:bot.number,password},401);
  const connect=(session,account,consent=true,status=200)=>session('/ai-contacts/start',{
    number:bot.number,expectedAccount:account,allowCloud:consent,
  },status);
  await connect(a,'studio_a',false,403);
  await connect(b,'studio_a',true,403);
  assert.deepEqual((await a('/conversations')).conversations,[]);
  const privateA=(await connect(a,'studio_a')).conversation.id;
  const privateB=(await connect(b,'studio_b')).conversation.id;
  assert.notEqual(privateA,privateB);
  assert.equal((await connect(a,'studio_a')).conversation.id,privateA);
  const pathFor=id=>'/conversations/'+id+'/messages';
  const body=(clientId,text,aiConsentRevision=0)=>({clientId,text,aiConsentRevision});
  const consent=(id)=>'/conversations/'+id+'/ai-consent';
  await b(pathFor(privateA),undefined,404);
  await b(pathFor(privateA),body('wrong_chat','合成越权'),404);
  assert.equal((await a('/friend-requests',{number:bot.number,expectedAccount:'studio_a'})).conversation.id,privateA);
  await a('/groups',{title:'不可邀请 AI',memberNumbers:[bot.number]},403);
  const accounts=await a('/friend-requests',{number:'studio_b'});
  const pair=(await b('/friend-requests/'+accounts.request.id+'/accept',{})).conversation.id;
  await a(pathFor(pair),body('human_a1','人际私聊哨兵'));
  assert.equal(calls.length,0);
  const first=body('private_a1','甲的蓝纸鹤');
  const sent=await a(pathFor(privateA),first);
  const repeated=await a(pathFor(privateA),first);
  assert.equal(repeated.message.id,sent.message.id);
  assert.equal(sent.message.aiReply,'answered');
  assert.deepEqual(sent.reply.sender,bot);
  assert.equal(sent.reply.conversationId,privateA);
  assert.equal(calls.length,1);
  const second=await b(pathFor(privateB),body('private_a1','乙的红风筝'));
  assert.deepEqual(second.reply.sender,bot);
  assert.deepEqual(calls[1].messages.slice(1),[{role:'user',content:'乙的红风筝'}]);
  await a(pathFor(privateA),body('private_a2','甲的后续'));
  assert.deepEqual(calls[2].messages.slice(1).map(row=>row.content),['甲的蓝纸鹤','鲸鱼娘收到了 甲的蓝纸鹤','甲的后续']);
  assert(calls.every(row=>row.model==='deepseek-flash'&&row.tool_choice==='none'&&!row.tools&&row.messages[0].content.includes('鲸鱼娘')));
  const failed=body('private_a3','合成失败');
  const failure=await a(pathFor(privateA),failed);
  assert.equal(failure.message.aiReply,'failed');
  assert.equal(failure.reply,undefined);
  assert.equal((await a(pathFor(privateA),failed)).message.id,failure.message.id);
  assert.equal(calls.length,4);
  await a(pathFor(privateA)+'/'+sent.reply.id+'/report',{reason:'合成举报'});
  const slow=body('private_a4','合成慢请求');
  const pending=a(pathFor(privateA),slow);
  try{
    await arrived.promise;
    assert.equal((await a(pathFor(privateA),slow)).message.aiReply,'pending');
    assert.equal((await a(pathFor(privateA),body('private_a5','忙时这一条没有保存'),429)).error.code,'ai_busy');
    assert.equal(calls.length,5);
    await b(consent(privateA),{expectedAccount:'studio_b',allowCloud:false,revision:0},404);
    const disabled=await a(consent(privateA),{expectedAccount:'studio_a',allowCloud:false,revision:0});
    assert.deepEqual(disabled.conversation.cloudChat,{enabled:false,revision:1});
    await upstreamClosed.promise;
  }finally{release.resolve();}
  const abandoned=await pending;
  assert.equal(abandoned.message.aiReply,'failed');
  assert.equal(abandoned.reply,undefined);
  assert.equal((await a(pathFor(privateA),slow)).message.id,abandoned.message.id);
  assert.equal((await connect(a,'studio_a')).conversation.cloudChat.enabled,false);
  assert.equal((await a(pathFor(privateA),body('private_a6','关闭时的文字',1),409)).error.code,'ai_cloud_off');
  assert.equal((await a(consent(privateA),{expectedAccount:'studio_a',allowCloud:true,revision:0},409)).error.code,'ai_consent_changed');
  assert.equal((await b('/conversations/'+privateB)).conversation.cloudChat.enabled,true);
  assert.equal(calls.length,5);
  // Simulate a process ending after it admitted a turn but before it finished.
  const interrupted=store.send('studio_b',privateB,body('private_b2','合成中断'));
  store.run("INSERT INTO ai_direct_turns VALUES(?,?,'pending',?)",interrupted.id,privateB,Date.now());
  await stop();
  await start(false);
  assert.deepEqual((await b('/ai-contacts')).contacts,[]);
  assert.deepEqual((await a('/conversations/'+privateA)).conversation.cloudChat,{enabled:false,revision:1});
  assert.equal((await b(pathFor(privateB))).messages.at(-1).aiReply,'failed');
  assert.equal((await a(pathFor(privateA))).messages.find(row=>row.id===failure.message.id).aiReply,'failed');
  assert.equal((await b(pathFor(privateB),body('private_b3','本机未连接云'))).message.aiReply,'failed');
  await b(pathFor(pair),body('human_b1','停用云以后仍可真人私聊'));
  assert.equal(calls.length,5);
  await stop();
  await start();
  const enabled=await a(consent(privateA),{expectedAccount:'studio_a',allowCloud:true,revision:1});
  assert.deepEqual(enabled.conversation.cloudChat,{enabled:true,revision:2});
  assert.equal((await a(pathFor(privateA),body('private_a6','关闭时的文字',1),409)).error.code,'ai_consent_changed');
  assert.equal((await a(pathFor(privateA),{text:'没有版本的旧窗口',clientId:'private_old'},409)).error.code,'ai_consent_changed');
  assert.equal(calls.length,5);
  await a(pathFor(privateA),body('private_a7','恢复后明确发送',2));
  assert.deepEqual(calls[5].messages.slice(1),[{role:'user',content:'恢复后明确发送'}]);
});

test('real HTTP accounts, durable sessions, friendships, groups, retries and moderation',async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'arcade-social-'));
  const db = path.join(dir,'synthetic.sqlite');
  let server,base;
  async function start() {
    server = fork(path.join(__dirname,'main.cjs'),[],{env:{
      SystemRoot:process.env.SystemRoot || '',PATH:process.env.PATH || '',
      SOCIAL_HOST:'127.0.0.1',SOCIAL_PORT:'0',SOCIAL_DB:db
    },stdio:['ignore','ignore','inherit','ipc']});
    const child = server;
    const ready = await new Promise((resolve,reject) => {
      const stopped = code => reject(new Error('Server exited before readiness: '+code));
      child.once('exit',stopped);
      child.once('error',reject);
      child.once('message',m => { child.off('exit',stopped); resolve(m); });
    });
    base = 'http://127.0.0.1:'+ready.port;
  }
  async function stop() {
    if (!server || server.exitCode !== null || server.signalCode) return;
    const done = once(server,'exit');
    server.kill();
    await done;
  }
  t.after(async () => { await stop(); await fs.rm(dir,{recursive:true,force:true}); });
  await start();
  const A = client(() => base), B = client(() => base), C = client(() => base), D = client(() => base);
  const password = 'synthetic pass only';
  const reg = (account,displayName) => ({number:account,password,displayName});
  await A('/register',reg('ALPHA','同名'));
  await B('/register',reg('bravo','同名'));
  await C('/register',reg('charlie','丙'));
  await D('/register',reg('delta','丁'));
  await client(() => base)('/register',reg('Alpha','另一个人'),409);
  await client(() => base)('/me',undefined,401);
  assert.equal((await A('/users?number=BRAVO')).user.displayName,'同名');
  assert.equal((await A('/me')).user.number,'alpha');
  assert.equal((await B('/me')).user.number,'bravo');
  await A('/direct',{number:'bravo'},403);
  const req = (await A('/friend-requests',{number:'bravo'})).request;
  assert.equal((await A('/friend-requests',{number:'BRAVO'})).request.id,req.id);
  await B('/friend-requests',{number:'alpha'},409);
  await A('/friend-requests/'+req.id+'/accept',{},404);
  assert.equal((await B('/friend-requests')).incoming[0].id,req.id);
  const direct = (await B('/friend-requests/'+req.id+'/accept',{})).conversation;
  assert.equal((await A('/direct',{number:'bravo'})).conversation.id,direct.id);
  assert.equal((await A('/friends')).friends[0].number,'bravo');
  await C('/conversations/'+direct.id,undefined,404);
  const dm = '/conversations/'+direct.id+'/messages';
  const msg = {text:'你好，乙',clientId:'alpha_msg_1'};
  const pair = await Promise.all([A(dm,msg),A(dm,msg)]);
  assert.equal(pair[0].message.id,pair[1].message.id);
  await A(dm,{...msg,text:'另一条'},409);
  assert.deepEqual((await B(dm)).messages.map(m => m.text),['你好，乙']);
  const reply = (await B(dm,{text:'收到，甲',clientId:'bravo_msg_1'})).message;
  assert.equal((await A(dm+'?after='+pair[0].message.id)).messages[0].id,reply.id);
  assert.equal((await A(dm+'?before='+reply.id)).messages.length,1);
  await A(dm+'?after=0&before=1',undefined,400);
  const group = (await A('/groups',{title:'合成小组',memberNumbers:['bravo']})).conversation;
  const groupPath = '/groups/'+group.id, chat = '/conversations/'+group.id, feed = chat+'/messages';
  const first = (await A(feed,{text:'入群前',clientId:'pre_join_1'})).message.id;
  await C(feed,undefined,404);
  await C(feed,{text:'越权',clientId:'not_member'},404);
  await C(feed+'/'+first+'/report',{reason:'越权'},404);
  const reqC = (await B('/friend-requests',{number:'charlie'})).request;
  await C('/friend-requests/'+reqC.id+'/accept',{});
  await B(groupPath+'/members',{memberNumbers:['charlie','delta']},403);
  assert.equal((await B(chat)).conversation.members.length,2);
  await B(groupPath+'/members',{memberNumbers:['charlie']});
  assert.deepEqual((await C(feed)).messages,[]);
  assert.equal((await C(chat)).conversation.lastMessage,null);
  await C(feed+'/'+first+'/report',{reason:'无历史权限'},404);
  const posted = (await C(feed,{text:'大家好',clientId:'c_group_1'})).message;
  assert.equal((await B(feed+'?after='+first)).messages[0].sender.number,'charlie');
  const flag = feed+'/'+posted.id+'/report';
  const report = (await B(flag,{reason:'合成测试'})).report;
  assert.equal((await B(flag,{reason:'再次提交'})).report.id,report.id);
  await B(groupPath+'/remove',{number:'charlie'},403);
  await A(groupPath+'/remove',{number:'charlie'});
  await C(feed,undefined,404);
  await B(groupPath+'/members',{memberNumbers:['charlie']});
  assert.deepEqual((await C(feed)).messages,[]);
  await C(groupPath+'/leave',{});
  await C(chat,undefined,404);
  await A(groupPath+'/leave',{},403);

  const source=await fs.readFile(path.join(__dirname,'../client/app.js'));
  const build=createHash('sha256').update(source).digest('hex');
  const shell=await fetch(base+'/');
  assert.equal(shell.headers.get('cache-control'),'no-store');
  const release=(await shell.text()).match(/data-friends-release="([a-f0-9]{64})"/u)[1];
  const pinned=await fetch(base+'/_friends/'+release+'/app.js');
  assert.equal(pinned.headers.get('cache-control'),'public, max-age=31536000, immutable');
  const served=await pinned.text();
  const legacy=await fetch(base+'/app.js');
  assert.equal(legacy.headers.get('cache-control'),'no-store');
  assert.match(await legacy.text(),/friends-reload/u);
  assert.equal((await fetch(base+'/_friends/'+'0'.repeat(64)+'/app.js')).status,404);
  assert.equal(served,'const servedClientBuild = "'+build+'";\n'+source.toString('utf8'));
  await client(()=>base)('/feedback',undefined,401);
  const input={clientId:'trial_feedback_1',expectedAccount:'alpha',clientBuild:build,text:' 合成体验建议 '};
  await A('/feedback',{...input,clientType:'store'},400);
  await A('/feedback',{...input,clientBuild:'stale'},409);
  await A('/feedback',{...input,desktopVersion:'65536.0.0.0'},400);
  await A('/feedback',{...input,desktopVersion:null,clientBuild:'stale'},400);
  await B('/feedback',input,409);
  const [sent,retry]=await Promise.all([A('/feedback',input),A('/feedback',input)]);
  const feedback=sent.feedback;
  assert.deepEqual(retry.feedback,feedback);
  assert.deepEqual(Object.keys(feedback),['id','text','createdAt','clientType','clientBuild','desktopVersion']);
  assert.equal(feedback.text,'合成体验建议');
  assert.equal(feedback.clientBuild,build);
  assert.equal(feedback.clientType,'web');
  assert.equal(feedback.desktopVersion,null);
  await A('/feedback',{...input,text:'different'},409);
  assert.deepEqual(await B('/feedback'),{account:'bravo',feedback:[]});
  const bFeedback=(await B('/feedback',{...input,expectedAccount:'bravo',text:'乙的测试记录'})).feedback;
  assert.notEqual(bFeedback.id,feedback.id);

  await stop();
  const preUpgrade=new DatabaseSync(db);
  preUpgrade.exec('DROP TABLE feedback_desktop_versions');
  preUpgrade.close();
  await start();
  assert.equal((await B('/me')).user.number,'bravo');
  assert.deepEqual((await B(dm)).messages.map(m => m.text),['你好，乙','收到，甲']);
  assert.equal((await A('/conversations')).conversations.length,2);
  assert.deepEqual((await B(chat)).conversation.members.map(m => m.number),['alpha','bravo']);
  assert.equal((await A(dm,msg)).message.id,pair[0].message.id);
  const noReply={replyText:null,retestVersion:null,repliedAt:null};
  assert.deepEqual((await A('/feedback')).feedback,[{...feedback,...noReply}]);
  assert.deepEqual((await B('/feedback')).feedback,[{...bFeedback,...noReply}]);
  assert.deepEqual((await A('/feedback',{...input,clientBuild:'previous-build-after-reload'})).feedback,feedback);
  assert.deepEqual((await A('/feedback',{...input,clientBuild:null})).feedback,feedback);
  const unknownInput={...input,clientId:'legacy_pending_feedback',clientBuild:null};
  await A('/feedback',{...unknownInput,desktopVersion:'1.0.13.0'},400);
  const {feedback:unknown}=await A('/feedback',unknownInput);
  assert.equal(unknown.clientType,'unknown');
  assert.equal(unknown.clientBuild,null);
  assert.equal(unknown.desktopVersion,null);
  assert.deepEqual((await A('/feedback',unknownInput)).feedback,unknown);
  const operator = new SocialStore(db);
  try {
    const own=moderate(operator,'feedback');
    assert.deepEqual(new Set(own.map(row=>row.id)),new Set([feedback.id,bFeedback.id,unknown.id]));
    assert.equal(own.find(row=>row.id===unknown.id).clientBuild,null);
    assert(own.every(row=>!Object.hasOwn(row,'account')));
    const reply=moderate(operator,'feedback-reply',feedback.id,'已修复，请重新打开意见反馈。','1.0.16.0');
    assert.deepEqual(moderate(operator,'feedback-reply',feedback.id,'已修复，请重新打开意见反馈。','1.0.16.0'),reply);
    assert.equal((await A('/feedback')).feedback.find(row=>row.id===feedback.id).replyText,reply.replyText);
    assert.deepEqual((await B('/feedback')).feedback,[{...bFeedback,...noReply}]);
    assert.deepEqual((await A('/feedback',input)).feedback,feedback);
    assert.deepEqual(moderate(operator,'list').map(r => r.reportedText),['大家好']);
    assert.equal(moderate(operator,'remove',report.id).status,'removed');
    assert.equal(moderate(operator,'list').length,0);
  } finally { operator.db.close(); }
  assert.equal((await A(feed)).messages.at(-1).text,'[已移除]');
  const delta=await A(feed+'?after='+posted.id+'&removedAfter=0');
  assert.deepEqual(delta.messages,[]);
  assert.deepEqual(delta.moderation.removedIds,[posted.id]);
  assert.deepEqual((await A(feed+'?removedAfter='+delta.moderation.cursor)).moderation.removedIds,[]);
  await C(feed+'?removedAfter=0',undefined,404);
  assert.equal((await B(flag,{reason:'重试领取原回执'})).report.id,report.id);
  await A(flag,{reason:'已移除内容不接受新举报'},404);
  assert.equal((await B(chat)).conversation.lastMessage.removed,true);
  await B('/logout',{});
  await B('/me',undefined,401);
  const freshB = client(() => base);
  await freshB('/login',{number:'BRAVO',password:'bad synthetic password'},401);
  await freshB('/login',{number:'BRAVO',password});
  assert.equal((await freshB(dm)).messages.at(-1).id,reply.id);
  const denied = await fetch(base+'/api/v1/login',{method:'POST',headers:{Origin:'https://unrelated.invalid','Content-Type':'application/json'},body:'{}'});
  assert.equal(denied.status,403);
  assert.equal((await fetch(base+'/server/schema.sql')).status,404);
});

test('removal events page separately, remain idempotent and obey the current membership history floor',()=>{
  const store=new SocialStore(':memory:');
  try {
    for(const account of ['host','first','later'])store.register(account,account,'human','fixture');
    for(const account of ['first','later'])store.decide(account,store.request('host',account).id,true);
    const group=store.createGroup('host','QA',['first']);
    const send=index=>store.send('host',group.id,{clientId:'fixture-'+index,text:'body '+index});
    const page=(account,query)=>store.historyPage(account,group.id,new URLSearchParams(query));
    const rows=Array.from({length:101},(_,index)=>send(index));
    const snapshot=page('first','removedAfter=latest');
    assert.equal(snapshot.moderation.cursor,0);
    assert.equal(snapshot.messages.length,50);
    store.addMembers('host',group.id,['later']);
    const newRow=send(101);
    for(const row of [...rows,newRow]) {
      const report=store.report('first',group.id,row.id,'fixture');
      moderate(store,'remove',report.id);
      moderate(store,'remove',report.id);
    }
    const a=page('first','after='+newRow.id+'&removedAfter=0');
    assert.deepEqual(a.messages,[]);
    assert.deepEqual(a.moderation.removedIds,rows.slice(0,100).map(row=>row.id));
    const b=page('first','before='+rows[2].id+'&removedAfter='+a.moderation.cursor);
    assert.deepEqual(b.messages.map(row=>[row.id,row.text]),rows.slice(0,2).map(row=>[row.id,'[已移除]']));
    assert.deepEqual(b.moderation.removedIds,[rows.at(-1).id,newRow.id]);
    const late=page('later','removedAfter=0');
    assert.deepEqual(late.moderation.removedIds,[newRow.id]);
    assert.equal(late.moderation.historyFloor,rows.at(-1).id);
    assert.deepEqual(page('first','removedAfter='+b.moderation.cursor).moderation.removedIds,[]);
    store.remove('host',group.id,'first',false);
    assert.throws(()=>page('first','removedAfter=0'),{status:404});
    assert.throws(()=>page('later','removedAfter=invalid'),{status:400});
  } finally {store.db.close();}
});

test('a quiet group rejoin changes the draft membership revision even at the same floor',()=>{
  const store=new SocialStore(':memory:');
  try {
    for(const account of ['host','guest'])store.register(account,account,'human','fixture');
    store.decide('guest',store.request('host','guest').id,true);
    const group=store.createGroup('host','Quiet group',['guest']);
    const moderation=()=>store.historyPage('guest',group.id,new URLSearchParams('removedAfter=latest')).moderation;
    // Simulate a membership created before this revision table was installed.
    store.run('DELETE FROM conversation_membership_revisions WHERE chat=? AND account=?',group.id,'guest');
    const before=moderation();
    assert.equal(moderation().membershipRevision,before.membershipRevision);
    store.remove('guest',group.id,'guest',true);
    assert.throws(moderation,{status:404});
    store.addMembers('host',group.id,['guest']);
    const after=moderation();
    assert.equal(after.historyFloor,before.historyFloor);
    assert.notEqual(after.membershipRevision,before.membershipRevision);
    assert.equal(moderation().membershipRevision,after.membershipRevision);
  } finally {store.db.close();}
});

test('AI adapter binds a distinct non-login identity and rechecks membership without a provider',() => {
  const s = new SocialStore(':memory:');
  try {
    s.register('human1','人一','human','fixture');
    s.register('human2','人二','human','fixture');
    provisionAi(s,'test_bot','实验 AI');
    const befriend = (a,b) => s.decide(b,s.request(a,b).id,true);
    befriend('human1','human2');
    befriend('human1','test_bot');
    const group = s.createGroup('human1','测试群',['human2','test_bot']);
    assert.throws(() => bindAi(s,'human1',group.id),e => e.status === 403);
    const humanChat = s.direct('human1','human2').id;
    assert.throws(() => bindAi(s,'test_bot',humanChat),e => e.status === 404);
    const ai = bindAi(s,'test_bot',group.id);
    const m = ai.send({text:'隔离适配器',clientId:'ai_test_1',sender:'human1',conversationId:humanChat});
    assert.equal(m.sender.kind,'ai');
    assert.equal(m.sender.number,'test_bot');
    assert.equal(m.conversationId,group.id);
    assert.equal(ai.readAfter()[0].id,m.id);
    assert.equal(ai.messageEventsAfter()[0].type,'social.message.created');
    assert.deepEqual(ai.messageEventsAfter(m.id),[]);
    s.remove('human1',group.id,'test_bot',false);
    assert.throws(() => ai.readAfter(),e => e.status === 404);
    assert.throws(() => ai.send({text:'已退群',clientId:'ai_test_2'}),e => e.status === 404);
  } finally { s.db.close(); }
});

test('configured production origin issues a Secure cookie for the HTTPS proxy and rejects mismatched host',async t => {
  const store = new SocialStore(':memory:');
  const server = createServer(store,{publicOrigin:'https://social.example.test'});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async () => {const closed = once(server,'close'); server.close(); server.closeAllConnections(); await closed; store.db.close();});
  const options = {hostname:'127.0.0.1',port:server.address().port};
  function proxy(pathname,host,body) {
    return new Promise((resolve,reject) => {
      const req = require('node:http').request({...options,path:pathname,method:body ? 'POST' : 'GET',
        headers:{host,origin:'https://'+host,'Content-Type':'application/json'}},res => {
        res.resume();
        res.on('end',() => resolve(res));
      });
      req.on('error',reject);
      req.end(body && JSON.stringify(body));
    });
  }
  assert.equal((await proxy('/healthz','wrong.example.test')).statusCode,403);
  const response = await proxy('/api/v1/register','social.example.test',{number:'store1',displayName:'店',password:'synthetic password'});
  assert.equal(response.statusCode,200);
  assert.match(response.headers['set-cookie'][0],/; Secure/);
});

async function consentFixture(t, providers) {
  const store = new SocialStore(':memory:');
  const server = createServer(store,providers).listen(0,'127.0.0.1');
  t.after(async()=>{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  });
  await once(server,'listening');
  const base = ()=>'http://127.0.0.1:'+server.address().port;
  return async number=>{
    const session = client(base);
    await session('/register',{number,displayName:number,password:'synthetic consent password'});
    return session;
  };
}

test('legacy group page cannot approve Claude under a DeepSeek label',async t=>{
  const {createClaudeProvider}=require('./ai-claude.cjs');
  const calls=[];
  const claudeProvider=createClaudeProvider('synthetic-claude',{fetchImpl:async(url,request)=>{
    assert.equal(url,'https://api.anthropic.com/v1/messages');
    calls.push(JSON.parse(request.body).messages.at(-1).content);
    return Response.json({type:'message',role:'assistant',stop_reason:'end_turn',
      content:[{type:'text',text:'橘娘收到。'}]});
  }});
  const actor=await consentFixture(t,{claudeProvider});
  const owner=await actor('consent_owner'), member=await actor('consent_member');
  const {request}=await owner('/friend-requests',{number:'consent_member'});
  await member('/friend-requests/'+request.id+'/accept',{});
  const {conversation:{id}}=await owner('/groups',{title:'合成授权群',memberNumbers:['consent_member']});
  const route='/groups/'+id;
  const messages='/conversations/'+id+'/messages';
  const modern={'X-Social-Claude-UI':'1'};
  await owner(route+'/ai',{expectedAccount:'consent_owner',number:'arcade_ju',enabled:true},200,modern);

  // Old pages displayed the fallback label but submitted the server's provider value.
  const consent={expectedAccount:'consent_member',number:'arcade_ju',provider:'anthropic',enabled:true};
  assert.equal((await member(route+'/ai-consent',consent,409)).error.code,'claude_client_update');
  assert(!(await member(route+'/ai')).groupAi.joined.some(role=>role.number==='arcade_ju'));
  const match=role=>role.number==='arcade_ju';
  const visible=(await member(route+'/ai',undefined,200,modern)).groupAi.joined.find(match);
  assert.equal(visible.provider,'anthropic');
  assert.equal(visible.sharing,false);
  const message={clientId:'legacy_claude_1',mentionAccount:'arcade_ju',text:'橘娘，请帮我看一下。'};
  assert.equal((await member(messages,message,409)).error.code,'claude_client_update');
  assert.equal(calls.length,0);

  const {groupAi}=await member(route+'/ai-consent',consent,200,modern);
  assert.equal(groupAi.joined.find(match).provider,'anthropic');
  assert.equal(groupAi.joined.find(match).sharing,true);
  assert.equal((await owner(route+'/ai',undefined,200,modern)).groupAi.joined.find(match).sharing,false);
  assert.equal((await member(messages,message,409)).error.code,'claude_client_update');
  const sent=await member(messages,message,200,modern);
  assert.equal(sent.reply.sender.number,'arcade_ju');
  assert.deepEqual(calls,[message.text]);
});

test('legacy Dragon private chat can revoke in flight and restore only with explicit OpenAI consent',async t=>{
  const {createOpenAIGroupProvider}=require('./ai-openai.cjs');
  const arrived=Promise.withResolvers(), release=Promise.withResolvers();
  const calls=[];
  let lateSignal, lateReturned=false;
  const openaiProvider=createOpenAIGroupProvider('synthetic-openai',{fetchImpl:async(url,request)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    const {input}=JSON.parse(request.body);
    calls.push(input);
    const held=input.at(-1).content==='这条生成期间要关掉';
    if(held){
      lateSignal=request.signal;
      arrived.resolve();
      // This upstream deliberately returns a valid reply even after cancellation.
      await release.promise;
      lateReturned=true;
    }
    return Response.json({status:'completed',output:[{type:'message',role:'assistant',status:'completed',
      content:[{type:'output_text',text:held?'迟到的龙娘回复':'新一轮的龙娘回复'}]}]});
  }});
  const actor=await consentFixture(t,{openaiProvider});
  const a=await actor('dragon_consent');
  const {conversation:{id}}=await a('/ai-contacts/start',{
    expectedAccount:'dragon_consent',number:'arcade_dragon',provider:'openai',allowCloud:true,
  });
  const route='/conversations/'+id, messages=route+'/messages', setting=route+'/ai-consent';
  const old={clientId:'dragon_pending_1',text:'这条生成期间要关掉',aiConsentRevision:0};
  const pending=a(messages,old);
  try{
    await Promise.race([arrived.promise,pending.then(()=>assert.fail('The provider did not hold the original turn'))]);
    const saved=(await a(messages)).messages.at(-1);
    assert.equal(saved.aiReply,'pending');
    const {conversation}=await a(setting,{expectedAccount:'dragon_consent',revision:0,allowCloud:false});
    assert.deepEqual(conversation.cloudChat,{enabled:false,revision:1});
    assert(lateSignal.aborted);
  }finally{release.resolve();}
  const abandoned=await pending;
  assert(lateReturned);
  assert.equal(abandoned.message.aiReply,'failed');
  assert.equal(abandoned.reply,undefined);
  assert.deepEqual((await a(messages)).messages,[abandoned.message]);

  const resume={expectedAccount:'dragon_consent',revision:1,allowCloud:true};
  assert.equal((await a(setting,resume,409)).error.code,'ai_provider_confirmation');
  assert.equal((await a(setting,{...resume,provider:'deepseek'},409)).error.code,'ai_consent_changed');
  assert.equal((await a(setting,{...resume,provider:'openai',expectedAccount:'some_other_account'},403)).error.code,'ai_consent_required');
  assert.equal((await a(route)).conversation.cloudChat.enabled,false);
  assert.equal(calls.length,1);
  const displayed=(await a(route)).conversation;
  assert.equal(displayed.aiProvider,'openai');
  const {conversation:resumed}=await a(setting,{...resume,provider:displayed.aiProvider});
  assert.deepEqual(resumed.cloudChat,{enabled:true,revision:2});
  const fresh={clientId:'dragon_resumed_2',text:'恢复后只回答这条',aiConsentRevision:2};
  const sent=await a(messages,fresh);
  assert.equal(sent.reply.text,'新一轮的龙娘回复');
  assert.equal(sent.reply.sender.number,'arcade_dragon');
  assert.deepEqual(calls[1],[{role:'user',content:fresh.text}]);
  assert.deepEqual(await a(messages,old),abandoned);
  assert.deepEqual((await a(messages)).messages,[abandoned.message,sent.message,sent.reply]);
  assert.equal(calls.length,2);
});

test('own report receipts merge both kinds and keep authors and reported content private',async t=>{
  const store=new SocialStore(':memory:');
  const server=createServer(store).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  });
  const base=()=> 'http://127.0.0.1:'+server.address().port;
  const a=client(base),b=client(base),mine='/reports/mine';
  const password='synthetic receipt fixture';
  await client(base)(mine,undefined,401);
  await a('/register',{number:'audit_alpha',displayName:'合成同名',password});
  await b('/register',{number:'audit_bravo',displayName:'合成同名',password});
  assert.deepEqual(await b(mine),{account:'audit_bravo',reports:[]});
  const {request}=await a('/friend-requests',{number:'audit_bravo'});
  const {conversation:direct}=await b('/friend-requests/'+request.id+'/accept',{});
  const {conversation:group}=await a('/groups',{title:'合成举报群',memberNumbers:['audit_bravo']});
  const groupMessages='/conversations/'+group.id+'/messages';
  const message=(await a(groupMessages,{text:'合成的被举报原文',clientId:'audit-message'})).message;
  const report=(await b(groupMessages+'/'+message.id+'/report',{reason:'乙自己填写的消息举报原因'})).report;
  const post=(await a('/friend-feed',{expectedAccount:'audit_alpha',text:'不应返回的动态原文',clientId:'audit-post'})).post;
  const feedReport=(await b('/friend-feed/'+post.id+'/report',{reason:'乙自己填写的动态举报原因'},200,
    {'X-Social-Account':'audit_bravo'})).report;
  const otherMessage=(await b(groupMessages,{text:'另一账号被举报的原文',clientId:'audit-other'})).message;
  const otherReport=(await a(groupMessages+'/'+otherMessage.id+'/report',{reason:'甲自己的举报原因'})).report;

  const receipt=(id,kind,status,reviewed,reason)=>({
    id,kind,status,created:'2025-01-01T10:00:00.000Z',reviewed,reason,
  });
  // Force equal timestamps across receipt kinds, including existing records.
  store.run('UPDATE reports SET created=?','2025-01-01T10:00:00.000Z');
  store.run('UPDATE friend_post_reports SET created=?','2025-01-01T10:00:00.000Z');
  const expected=[
    receipt(report.id,'message','open',null,'乙自己填写的消息举报原因'),
    receipt(feedReport.id,'friend_post','open',null,'乙自己填写的动态举报原因'),
  ].sort((left,right)=>left.id<right.id?1:-1);
  assert.deepEqual(await b(mine),{account:'audit_bravo',reports:expected});
  assert.deepEqual(await a(mine+'?account=audit_bravo'),{account:'audit_alpha',reports:[
    receipt(otherReport.id,'message','open',null,'甲自己的举报原因'),
  ]});
  // This cookie jar represents a browser whose other tab signs in again.
  await a('/login',{number:'audit_bravo',password});
  assert.deepEqual(await a(mine+'?account=audit_alpha'),{account:'audit_bravo',reports:expected});
  await b('/groups/'+group.id+'/leave',{});
  await b(groupMessages,undefined,404);
  moderate(store,'remove',report.id);
  moderate(store,'dismiss',feedReport.id);
  const processed=await b(mine);
  assert.equal(processed.account,'audit_bravo');
  for(const row of processed.reports){
    assert(!Number.isNaN(Date.parse(row.reviewed)));
    const original=expected.find(item=>item.id===row.id);
    assert.deepEqual(row,{...original,status:row.kind==='message'?'removed':'dismissed',reviewed:row.reviewed});
  }
  assert.deepEqual(processed.reports.map(row=>row.id),expected.map(row=>row.id));

  // Exercise the combined limit with real records from both stores.
  for(let index=0;index<50;index++){
    const sent=store.send('audit_alpha',direct.id,{clientId:'report-limit-'+index,text:'合成分页对照'});
    store.report('audit_bravo',direct.id,sent.id,'乙的新增原因');
  }
  const limited=await b(mine);
  assert.equal(limited.reports.length,50);
  assert(limited.reports.every(row=>row.reason==='乙的新增原因'));
  await b('/logout',{});
  await b(mine,undefined,401);
  t.diagnostic(JSON.stringify({route:'/api/v1/reports/mine',sameDisplayNames:true,sharedSessionAccountSwitch:true,retainedAfterLeaving:true,
    statuses:['open','removed','dismissed'],combinedLimit:limited.reports.length,unauthenticated:401}));
});

test('group cloud defaults and AI friendships preserve member permissions on upgrade',async t=>{
  const {AI_NUMBER,AI_DRAGON_NUMBER,AI_JU_NUMBER}=require('./ai-roles.cjs');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcade-social-cloud-defaults-'));
  const filename=path.join(dir,'social.sqlite');
  const image=await fs.readFile(path.join(__dirname,'../client/art/whale.png'));
  const wire={model:[],draw:[],search:[]};
  const aiProvider={provider:'deepseek',name:'鲸鱼娘',groupRoles:[{number:AI_NUMBER,name:'鲸鱼娘'}],
    async generate(context){wire.model.push(context);return '搭档已读到这条合成消息。';}};
  const drawingProvider={dailyLimit:12,async generate(brief,{reference}){
    wire.draw.push({brief,reference});
    return {bytes:image,mime:'image/png',width:image.readUInt32BE(16),height:image.readUInt32BE(20),
      digest:createHash('sha256').update(image).digest('hex')};
  }};
  const webSearchFetch=async url=>{
    assert.equal(new URL(url).hostname,'api.mwmbl.org');
    wire.search.push(String(url));
    return Response.json([]);
  };
  let store,server,base;
  async function stop(){
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    store?.db.close();
    store=null;
  }
  async function start(configured=true){
    await stop();
    store=new SocialStore(filename);
    server=createServer(store,configured?{aiProvider,drawingProvider,webSearchFetch}:{webSearchFetch})
      .listen(0,'127.0.0.1');
    await once(server,'listening');
    base='http://127.0.0.1:'+server.address().port;
  }
  t.after(async()=>{await stop();await fs.rm(dir,{recursive:true,force:true});});
  await start();
  const a=client(()=>base), b=client(()=>base);
  const owner='cloud_host', guest='cloud_guest';
  for(const [request,number] of [[a,owner],[b,guest]])
    await request('/register',{number,password:'synthetic only',displayName:number});
  const pending=(await a('/friend-requests',{number:guest})).request;
  assert.equal((await b('/friend-requests')).incoming[0].id,pending.id);
  const humanDirect=(await b('/friend-requests/'+pending.id+'/accept',{})).conversation.id;
  async function room(title){
    const id=(await a('/groups',{title,memberNumbers:[guest]})).conversation.id;
    await a('/groups/'+id+'/ai',{number:AI_NUMBER,enabled:true,expectedAccount:owner});
    return id;
  }
  const existing=await room('已有群'), paused=await room('旧版搜索已关闭');
  store.run('INSERT INTO ai_web_search_settings VALUES(?,0,7)',paused);
  const historical=store.request(owner,AI_NUMBER);
  const aiToHuman=store.request(AI_DRAGON_NUMBER,guest);
  store.run('DROP TABLE ai_group_draw_pauses');
  await start();
  assert.equal(store.one('SELECT state FROM requests WHERE id=?',historical.id).state,'accepted');
  assert.equal(store.one('SELECT state FROM requests WHERE id=?',aiToHuman.id).state,'pending');
  assert((await a('/friends')).friends.some(friend=>friend.number===AI_NUMBER));
  assert(!(await a('/friend-requests')).outgoing.some(row=>row.id===historical.id));

  const direct=(await a('/direct',{number:AI_NUMBER})).conversation;
  assert.equal(direct.requiresAiCloudConsent,true);
  let nonce=0;
  const say=(request,id,text,extra={},status=200)=>request('/conversations/'+id+'/messages',
    {text,clientId:'cloud_default_'+(++nonce),...extra},status);
  await say(a,direct.id,'授权前私聊',{},409);
  await say(a,humanDirect,'只在真人私聊出现');
  assert.equal(wire.model.length,0);
  const open=(await a('/ai-contacts/start',{number:AI_NUMBER,provider:'deepseek',allowCloud:true,expectedAccount:owner})).conversation;
  assert.equal(open.id,direct.id);
  await say(a,direct.id,'直接说给搭档听',{aiConsentRevision:open.cloudChat.revision});
  assert.equal(wire.model.length,1);
  await a('/conversations/'+direct.id+'/ai-consent',
    {provider:'deepseek',allowCloud:false,expectedAccount:owner,revision:open.cloudChat.revision});
  assert.equal((await a('/ai-contacts/start',{number:AI_NUMBER,provider:'deepseek',allowCloud:true,expectedAccount:owner})).conversation.cloudChat.enabled,false);

  for(const number of [AI_DRAGON_NUMBER,AI_JU_NUMBER]){
    const added=(await a('/friend-requests',{number,expectedAccount:owner})).conversation;
    assert.equal(added.requiresAiCloudConsent,true);
    assert.equal((await a('/friend-requests',{number,expectedAccount:owner})).conversation.id,added.id);
    assert((await a('/friends')).friends.some(friend=>friend.number===number));
  }
  await b('/friend-requests',{number:AI_JU_NUMBER,expectedAccount:owner},403);
  assert(!(await b('/friends')).friends.some(friend=>friend.number===AI_JU_NUMBER));

  const fresh=await room('升级后创建');
  const view=async id=>(await b('/groups/'+id+'/ai')).groupAi.joined[0];
  const meta=async id=>(await b('/conversations')).conversations.find(c=>c.id===id);
  const consent=(id,enabled)=>b('/groups/'+id+'/ai-consent',
    {expectedAccount:guest,number:AI_NUMBER,provider:'deepseek',enabled});
  const addressed=(id,text)=>say(b,id,text,{mentionAccount:AI_NUMBER});
  for(const id of [existing,fresh]){
    assert.equal((await view(id)).drawing.enabled,true);
    assert.equal((await meta(id)).webSearch.enabled,true);
  }
  assert.equal((await meta(paused)).webSearch.enabled,false);
  await addressed(existing,'画一张雨夜的灯塔');
  assert.equal(wire.draw.length,0);
  await consent(existing,true);
  await addressed(existing,'稍后提醒我看看测试结果');
  assert.equal(wire.model.length,2);
  await addressed(existing,'帮我搜一下 Blender 官网');
  assert.equal(wire.search.length,1);
  await addressed(existing,'画一张雨夜的灯塔');
  assert.equal(wire.draw.length,1);
  assert.equal(wire.draw[0].reference,undefined);
  const received=(await a('/conversations/'+existing+'/messages')).messages;
  assert(received.some(message=>message.attachment?.drawing!==undefined && message.sender.number===AI_NUMBER));
  await consent(paused,true);
  await addressed(paused,'帮我搜一下 Blender 官网');
  assert.equal(wire.search.length,1);
  await consent(existing,false);
  await addressed(existing,'你能再说一句吗');
  await addressed(fresh,'你能再说一句吗');
  assert.equal(wire.model.length,2);
  await a('/groups/'+existing+'/ai-drawing',{expectedAccount:owner,number:AI_NUMBER,enabled:false});
  await start();
  assert.equal((await view(existing)).drawing.enabled,false);
  assert.equal((await view(fresh)).drawing.enabled,true);
  await consent(existing,true);
  await addressed(existing,'画一张雨夜的灯塔');
  assert.equal(wire.draw.length,1);
  await consent(fresh,true);
  assert.deepEqual((await b('/conversations/'+fresh+'/ai-voice')).voices,[]);
  await addressed(fresh,'搭档，你收到新群里的话了吗');
  await addressed(fresh,'画一张温室里的橙花');
  assert.equal(wire.draw.length,2);
  await start(false);
  assert.equal((await view(fresh)).configured,false);
  assert.equal((await view(fresh)).drawing.configured,false);
  await addressed(existing,'画一张雨夜的灯塔');
  assert.deepEqual([wire.model.length,wire.draw.length,wire.search.length],[3,2,1]);
});
