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

function client(base) {
  let cookie = '';
  return async function request(endpoint,body,status=200) {
    const res = await fetch(base()+'/api/v1'+endpoint,{
      method:body === undefined ? 'GET' : 'POST',
      headers:{'Content-Type':'application/json',Cookie:cookie},
      body:body === undefined ? undefined : JSON.stringify(body)
    });
    const next = res.headers.get('Set-Cookie');
    if (next) cookie = next.split(';')[0];
    const data = await res.json();
    assert.equal(res.status,status,endpoint+' '+JSON.stringify(data));
    return data;
  };
}

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

  await stop();
  await start();
  assert.equal((await B('/me')).user.number,'bravo');
  assert.deepEqual((await B(dm)).messages.map(m => m.text),['你好，乙','收到，甲']);
  assert.equal((await A('/conversations')).conversations.length,2);
  assert.deepEqual((await B(chat)).conversation.members.map(m => m.number),['alpha','bravo']);
  assert.equal((await A(dm,msg)).message.id,pair[0].message.id);
  const operator = new SocialStore(db);
  try {
    assert.deepEqual(moderate(operator,'list').map(r => r.reportedText),['大家好']);
    assert.equal(moderate(operator,'remove',report.id).status,'removed');
    assert.equal(moderate(operator,'list').length,0);
  } finally { operator.db.close(); }
  assert.equal((await A(feed)).messages.at(-1).text,'[已移除]');
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
