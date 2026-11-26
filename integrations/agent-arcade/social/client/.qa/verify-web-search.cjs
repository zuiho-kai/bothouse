'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {once}=require('node:events');
const {createServer:loopback}=require('node:http');
const {chromium}=require('playwright');
const {clickChatSetting}=require('./chat-controls.cjs');
const {createServer}=require('../../server/http.cjs');
const {SocialStore,AI_NUMBER}=require('../../server/store.cjs');
const {makeBackup}=require('../../deploy/backup.cjs');
const {publicWebRequest}=require('../../../src/bot/qq-public-lookup.cjs');

const btn=(page,name)=>page.getByRole('button',{name,exact:true});
const localFetch=globalThis.fetch;
const heading=(page,name)=>page.getByRole('heading',{name,exact:true});
const start=async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;};
const stop=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});

async function register(browser,origin,number,displayName=number){
  const page=await browser.newPage({baseURL:origin,serviceWorkers:'block'});
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  // Record the content through the actual message action, without replacing
  // the Windows user's system clipboard.
  await page.addInitScript(()=>{
    Object.defineProperty(navigator.clipboard,'writeText',{value:async value=>{window.copiedMessage=value;}});
  });
  await page.goto('/');
  await btn(page,'创建账号').click();
  await page.locator('[name=number]').fill(number);
  await page.locator('[name=displayName]').fill(displayName);
  await page.locator('[name=password]').fill('web-search synthetic test phrase');
  await page.locator('#auth-submit').click();
  await heading(page,'消息').waitFor();
  return page;
}

async function api(page,route,data,status=200){
  const response=await page.request.fetch('/api/v1'+route,{method:data===undefined?'GET':'POST',data});
  assert.equal(response.status(),status);
  return response.json();
}
async function send(page,text){
  const pending=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/messages'));
  await page.locator('#message').fill(text);
  await btn(page,'发送').click();
  const response=await pending;
  assert.equal(response.status(),200);
  return response.json();
}
async function toggle(page,enabled){
  await clickChatSetting(page,'公开网页搜索 · '+(enabled?'已关闭':'已开启'));
  await page.locator('#dialog').getByText(/只把这条消息中的公开主题词/u).waitFor();
  await btn(page,(enabled?'开启':'关闭')+'本会话的搜索').click();
  await page.locator('#dialog').waitFor({state:'hidden'});
}

async function main(){
  const proof=process.argv[2]&&path.resolve(process.argv[2]);
  if(proof)await fs.mkdir(proof,{recursive:true});
  const root=await fs.realpath(os.tmpdir());
  const scratch=await fs.mkdtemp(path.join(root,'arcade-friends-web-'));
  const database=path.join(scratch,'test.sqlite');
  let store=new SocialStore(database);
  const requests=[],model=[],modelContexts=[],observed={};
  const inFlight=Promise.withResolvers(), cancelled=Promise.withResolvers();
  const upstream=loopback((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    const query=url.searchParams.get('q');
    requests.push({method:req.method,pathname:url.pathname,params:[...url.searchParams],
      cookies:req.headers.cookie??null,authorization:req.headers.authorization??null,referer:req.headers.referer??null});
    if(query==='Krita'){
      res.on('close',cancelled.resolve);
      inFlight.resolve();
      return;
    }
    if(query==='Audacity'){
      res.writeHead(503,{'Content-Type':'application/json'});
      res.end('{}');
      return;
    }
    const results=query==='极光的形成'?[{title:'极光的形成',url:'https://science.nasa.gov/sun/auroras/'}]:
      ['Blender','Blender 4.2'].includes(query)?[{title:'Blender 官方网站',url:'https://www.blender.org/'}]:
      query==='大熊猫的栖息地'?[
        {title:'大熊猫栖息地',url:'https://www.worldwildlife.org/species/giant-panda'},
        {title:'大熊猫与竹林',url:'https://nationalzoo.si.edu/animals/giant-panda'},
      ]:[];
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({results}));
  });
  const endpoint=await start(upstream);
  const provider={name:'鲸鱼娘',provider:'deepseek',groupRoles:[{number:AI_NUMBER,name:'鲸鱼娘'}],
    async generate(rows){modelContexts.push(rows);model.push(rows.at(-1).content);return '本机聊天替身回复。';}};
  const serviceOptions={aiProvider:provider,webSearchFetch:(target,options)=>{
    const url=new URL(target);
    assert.equal(url.origin,'https://api.mwmbl.org');
    assert.equal(options.redirect,'error');
    return localFetch(endpoint+url.pathname+url.search,options);
  }};
  let server=createServer(store,serviceOptions),browser;
  // A misrouted sticker or model request must never use the Internet.
  globalThis.fetch=()=>{throw Error('Unexpected global fetch');};
  try{
    const origin=await start(server);
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    const [a,b,c]=await Promise.all([
      register(browser,origin,'web_alice'),register(browser,origin,'web_bobby','试验青'),register(browser,origin,'2844'),
    ]);
    await btn(a,'通讯录').click();
    await btn(a,'AI 联系人').click();
    await btn(a,'同意并开始私聊').click();
    await heading(a,'鲸鱼娘').waitFor();
    const direct=(await api(a,'/conversations')).conversations[0].id;
    const {request}=await api(a,'/friend-requests',{number:'web_bobby'});
    await api(b,'/friend-requests/'+request.id+'/accept',{});
    const {conversation:group}=await api(a,'/groups',{title:'公开搜索隔离验收群',memberNumbers:['web_bobby']});
    const groupPath='/groups/'+group.id, groupChat='/conversations/'+group.id, directChat='/conversations/'+direct;
    const open=async (page,id,name)=>{
      await page.goto('/#chat/'+id);
      await heading(page,name).waitFor();
    };
    await open(a,group.id,group.title);
    await open(b,group.id,group.title);
    await btn(a,'群成员').click();
    await btn(a,'群内 AI').click();
    await btn(a,'加入鲸鱼娘（DeepSeek）').click();
    await btn(a,'同意发给 DeepSeek').click();
    await btn(a,'关闭').click();

    await open(a,direct,'鲸鱼娘');
    observed.directOff=(await send(a,'你能联网搜索资料吗？')).reply.text;
    assert.match(observed.directOff,/还没开启/u);
    const naturalCheck='帮我查一下极光的形成';
    observed.naturalLookupOff=(await send(a,naturalCheck)).reply.text;
    assert.match(observed.naturalLookupOff,/还没开启/u);
    assert.deepEqual([requests.length,model.length],[0,0]);
    await toggle(a,true);
    observed.naturalLookupOn=(await send(a,naturalCheck)).reply;
    assert.equal(observed.naturalLookupOn.webResults[0].url,'https://science.nasa.gov/sun/auroras/');
    assert.equal(model.length,0);
    observed.narration=(await send(a,'我昨天查了一下极光的成因。')).reply.text;
    assert.equal(observed.narration,'本机聊天替身回复。');
    assert.equal(requests.length,1);
    const directReply=(await send(a,'帮我查一下 Blender 的官网')).reply;
    assert.match(directReply.text,/https:\/\/www\.blender\.org\//u);
    observed.directReply=directReply;
    assert.equal((await api(a,groupChat)).conversation.webSearch.enabled,true);
    observed.groupDefaultsOn=true;
    await open(a,group.id,group.title);
    await toggle(a,false);
    observed.groupOff=(await send(a,'@鲸鱼娘 联网查：Blender')).reply.text;
    assert.match(observed.groupOff,/还没开启/u);
    assert.equal(requests.length,2);
    await api(b,groupChat+'/web-search',{expectedAccount:'web_bobby',enabled:true,revision:0},403);
    await api(c,groupChat+'/web-search',{expectedAccount:'2844',enabled:true,revision:0},404);
    await toggle(a,true);
    const unapproved=await send(b,'@鲸鱼娘 联网查：Blender');
    assert.equal(unapproved.reply,undefined);
    assert.equal(requests.length,2);
    await api(b,groupPath+'/ai-consent',{expectedAccount:'web_bobby',number:AI_NUMBER,enabled:true,provider:'deepseek'});
    const beforeGuards=requests.length;
    observed.capability=(await send(b,'@鲸鱼娘 你能联网搜索资料吗？')).reply.text;
    assert.match(observed.capability,/可以查公开网页.*不能直接打开/u);
    await send(a,'查一下我们的聊天记录');
    await send(a,'@鲸鱼娘 先别查一下日食原理');
    await send(a,'@鲸鱼娘 搜个表情包');
    await send(a,'@鲸鱼娘 帮我查一查月相周期 晚点再查');
    await send(a,'@鲸鱼娘 联网查：公司内部官网');
    const ambiguous=await send(a,'@鲸鱼娘 帮我搜一下相关资料');
    assert.match(ambiguous.reply.text,/主题词/u);
    const held=await send(a,'@鲸鱼娘 帮我搜一下 Blender 先不要上网');
    assert.equal(held.reply.text,'好，这次先不搜。');
    assert.equal(requests.length,beforeGuards);
    assert.equal(publicWebRequest('帮我搜一下大熊猫的栖息地'),null);
    assert.equal(publicWebRequest(naturalCheck),null);
    assert.equal(publicWebRequest('查一查水星的一天有多长'),null);

    const nonce='web-search-retry-same-turn';
    const panda='帮我搜一下大熊猫的栖息地';
    const expectedQuery=['极光的形成','Blender','大熊猫的栖息地','Inkscape','Audacity','Krita','Blender 4.2'];
    const groupReply=(await send(a,'@鲸鱼娘 '+panda)).reply;
    observed.groupReply=groupReply;
    const source='https://nationalzoo.si.edu/animals/giant-panda';
    await b.locator('#history').getByText(new RegExp(source,'u')).waitFor();
    assert.equal(await btn(b,'复制网址').count(),2);
    await b.locator('.web-result').filter({hasText:'大熊猫与竹林'}).getByRole('button',{name:'复制网址'}).click();
    observed.copied=await b.evaluate(()=>window.copiedMessage);
    assert.equal(observed.copied,source);
    await b.locator('summary').getByText('来源说明',{exact:true}).click();
    await b.locator('#history').getByText(/Mwmbl.*CC BY-NC-SA/u).waitFor();
    if(proof)await b.screenshot({path:path.join(proof,'好友群-公开来源.png')});
    const requestBody={clientId:nonce,text:'联网查：Inkscape',mentionAccount:AI_NUMBER};
    const miss=await api(a,groupChat+'/messages',requestBody);
    assert.match(miss.reply.text,/没找到相关/u);
    const retried=await api(a,groupChat+'/messages',requestBody);
    assert.equal(miss.message.id,retried.message.id);
    assert.equal(retried.reply,undefined);
    observed.empty=miss.reply.text;
    const groupModelCount=model.length;
    observed.unavailable=(await send(a,'@鲸鱼娘 查一查 Audacity')).reply.text;
    assert.equal(model.length,groupModelCount);
    assert.match(observed.unavailable,/没能.*取回/u);

    const olderSnapshot=await makeBackup(database,path.join(scratch,'older-snapshot'));
    const pending=send(a,'@鲸鱼娘 联网查：Krita');
    await inFlight.promise;
    const {webSearch:{revision}}=(await api(a,groupChat)).conversation;
    await api(a,groupChat+'/web-search',{expectedAccount:'web_alice',enabled:false,revision});
    await cancelled.promise;
    assert.equal((await pending).reply,undefined);
    assert.equal((await api(a,directChat)).conversation.webSearch.enabled,true);
    assert.equal((await api(a,groupChat)).conversation.webSearch.enabled,false);
    const originalPort=server.address().port;
    await stop(server);
    store.db.close();
    if(process.env.ARCADE_QA_BASELINE_STORE){
      // The earlier SocialStore can open this file without knowing the new
      // tables. Opening it in the new release again must preserve the rows.
      const {SocialStore:EarlierStore}=require(path.resolve(process.env.ARCADE_QA_BASELINE_STORE));
      const earlier=new EarlierStore(database);
      try{
        assert.equal(earlier.conversation('web_alice',direct).webSearch,undefined);
      }finally{earlier.db.close();}
      observed.earlierSchemaOpenedSameDatabase=true;
    }
    store=new SocialStore(database);
    server=createServer(store,serviceOptions);
    server.listen(originalPort,'127.0.0.1');
    await once(server,'listening');
    await b.reload();
    await heading(b,group.title).waitFor();
    await b.locator('#history').getByText(new RegExp(source,'u')).waitFor();
    observed.afterRestart={
      direct:(await api(a,directChat)).conversation.webSearch,
      group:(await api(b,groupChat)).conversation.webSearch,
      sourceStillVisible:true,
    };
    assert.equal(observed.afterRestart.direct.enabled,true);
    assert.equal(observed.afterRestart.group.enabled,false);
    const restored=await makeBackup(olderSnapshot,path.join(scratch,'prepared-restore'),{prepareRestore:true});
    const fresh=new SocialStore(restored);
    try{
      observed.preparedRestore=[direct,group.id].map(id=>({...fresh.webSearchSetting(id)}));
      assert.deepEqual(observed.preparedRestore,[{enabled:0,revision:2},{enabled:0,revision:3}]);
      assert.equal(fresh.one('SELECT count(*) AS total FROM ai_web_search_settings').total,2);
      assert(fresh.one('SELECT sources FROM message_web_results WHERE message=?',groupReply.id));
      assert.equal((await api(a,directChat)).conversation.webSearch.enabled,true);
    }finally{fresh.db.close();}
    const {request:third}=await api(a,'/friend-requests',{number:'2844'});
    await api(c,'/friend-requests/'+third.id+'/accept',{});
    const {conversation:privacyGroup}=await api(a,'/groups',{title:'搜索隐私回归群',memberNumbers:['web_bobby','2844']});
    await api(a,'/groups/'+privacyGroup.id+'/ai',{expectedAccount:'web_alice',number:AI_NUMBER,enabled:true});
    await api(a,'/groups/'+privacyGroup.id+'/ai-consent',{expectedAccount:'web_alice',number:AI_NUMBER,enabled:true,provider:'deepseek'});
    await open(a,privacyGroup.id,privacyGroup.title);
    assert.equal((await api(a,'/conversations/'+privacyGroup.id)).conversation.webSearch.enabled,true);

    observed.privateSearches=[];
    async function refused(scope,prompt){
      const counts=[requests.length,model.length];
      const {message,reply}=await send(a,prompt);
      assert.match(reply.text,/身份或私密内容/u,prompt);
      assert.deepEqual([requests.length,model.length],counts,prompt);
      observed.privateSearches.push({scope,prompt,message:message.id,reply:reply.text,searchCalls:0,modelCalls:0});
    }
    for(const prompt of ['联网查：试验青的用户号','帮我搜一下 ＷＥＢ＿ＢＯＢＢＹ',
      '帮我查一下 web_bobby 的官网','查一查试验青的账号编号','联网查：2844','查一下我们的聊天记录','搜一下群里那位的主页']){
      await refused('group','@鲸鱼娘 '+prompt);
    }

    await open(a,direct,'鲸鱼娘');
    for(const prompt of ['联网查：web_alice','帮我搜一下 ＷＥＢ＿ＡＬＩＣＥ','帮我查一下 web_alice 的官方文档',
      '查一下我们的聊天记录','帮我搜一下上一条私信提到的地址']){
      await refused('direct',prompt);
    }
    const ordinary=await send(a,'跟我说声早安。');
    assert.equal(ordinary.reply.text,'本机聊天替身回复。');
    const nextInputs=modelContexts.at(-1).map(row=>row.content);
    for(const {scope,prompt} of observed.privateSearches){
      if(scope==='direct')assert(!nextInputs.includes(prompt),'local rejection leaked into a subsequent model context');
    }
    observed.nextModelOmittedPrivateSearches=true;

    const digitTopic=await send(a,'帮我搜一下 Blender 4.2');
    assert.equal(digitTopic.reply.webResults[0].url,'https://www.blender.org/');
    observed.publicTopicWithDigits={query:'Blender 4.2',reply:digitTopic.reply.id};
    await btn(b,'通讯录').click();
    await btn(b,'AI 联系人').click();
    await btn(b,'同意并开始私聊').click();
    await heading(b,'鲸鱼娘').waitFor();
    const reboot=async configured=>{
      const port=server.address().port;
      await stop(server);
      store.db.close();
      store=new SocialStore(database);
      server=createServer(store,{...serviceOptions,aiProvider:configured?provider:undefined});
      server.listen(port,'127.0.0.1');
      await once(server,'listening');
      await b.reload();
      await heading(b,'鲸鱼娘').waitFor();
    };

    const outageCalls=[requests.length,modelContexts.length];
    await reboot(false);
    const normalOld='普通旧消息：窗边有一本诗集。';
    await send(b,normalOld);
    const markedText='联网查：试验青的账号编号';
    const legacyText='鲸鱼娘，联网查：web_bobby';
    const marked=(await send(b,markedText)).message;
    const legacy=(await send(b,legacyText)).message;
    assert.deepEqual([requests.length,modelContexts.length],outageCalls);
    for(const message of [marked,legacy]){
      assert.equal(message.aiReply,'failed');
      assert(store.one('SELECT 1 FROM local_web_search_messages WHERE message=?',message.id));
    }
    // Emulate a pre-fix database where the text was saved without a marker.
    store.run('DELETE FROM local_web_search_messages WHERE message=?',legacy.id);
    assert.equal(store.one('SELECT 1 FROM local_web_search_messages WHERE message=?',legacy.id),undefined);
    await reboot(true);
    for(const text of [normalOld,markedText,legacyText])
      await b.locator('#history').getByText(text,{exact:true}).waitFor();
    const current='恢复后聊聊春天。';
    await send(b,current);
    assert.equal(modelContexts.length,outageCalls[1]+1);
    const restoredContext=modelContexts.at(-1).map(row=>row.content);
    assert.deepEqual(restoredContext,[normalOld,current]);
    assert(store.one('SELECT 1 FROM local_web_search_messages WHERE message=?',legacy.id));
    observed.providerOutage={
      sourceCalls:requests.length-outageCalls[0],modelCallsDuring:0,privateTextsVisible:true,
      markedAtWrite:marked.id,legacyMarkedAfterRead:legacy.id,restoredContext,
    };

    assert.deepEqual(requests.map(row=>row.params[0]?.[1]),expectedQuery);
    for(const row of requests)assert.deepEqual(row,{method:'GET',pathname:'/api/v2/search/',
      params:[['q',row.params[0][1]]],cookies:null,authorization:null,referer:null});
    for(const query of expectedQuery)assert(!model.some(text=>text.includes(query)&&
      !text.includes('这件事先放一放')),'search prompts should bypass the chat model');
    const receipt={...observed,requests,model,inFlightCancelled:true,directStillEnabled:true,outsiderDenied:true,
      note:'真实 Friends 客户端、HTTP/SQLite 与出站适配器；Mwmbl HTTP、语言模型、剪贴板写入为隔离替身。'};
    if(proof)await fs.writeFile(path.join(proof,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify(receipt,null,2));
  }finally{
    globalThis.fetch=localFetch;
    await browser?.close();
    await Promise.all([stop(server),stop(upstream)]);
    if(store.db.isOpen)store.db.close();
    const owned=await fs.realpath(scratch);
    if(path.dirname(owned)===root&&path.basename(owned).startsWith('arcade-friends-web-'))
      await fs.rm(owned,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
