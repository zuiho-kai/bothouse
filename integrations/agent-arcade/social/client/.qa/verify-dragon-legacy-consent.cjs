'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {chromium,expect}=require('playwright/test');

const [target,release115,release116,mode]=process.argv.slice(2);
const output=path.resolve(target);
const current=path.resolve(__dirname,'../..');
const dragon='arcade_dragon', ju='arcade_ju', alpha='audit_dragon_a', beta='audit_dragon_b';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const button=(area,name)=>area.getByRole('button',{name,exact:true});
const route=chat=>'/conversations/'+chat;
const proof={versions:{},wire:[],calls:[],blockedExternal:[]};
const pending=Promise.withResolvers(), late=Promise.withResolvers();
let seenAbort=false, server, store, browser, origin, port=0;

async function unpack(evidence,version){
  const metadata=JSON.parse(await fs.readFile(evidence,'utf8'));
  assert.equal(metadata.version,version);
  assert.equal(hash(await fs.readFile(metadata.service.path)),metadata.service.sha256);
  const root=path.join(output,version);
  await fs.mkdir(root);
  execFileSync('tar.exe',['-xf',metadata.service.path,'-C',root],{windowsHide:true});
  const social=path.join(root,'social');
  proof.versions[version]={source:metadata.freeze,zip:metadata.service.sha256,
    script:hash(await fs.readFile(path.join(social,'client/app.js')))};
  return social;
}
async function stop(){
  if(!server)return;
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  store.db.close();
  server=null;
}
async function serve(dir,{claude=true}={}){
  await stop();
  const {SocialStore}=require(path.join(dir,'server/store.cjs'));
  const {createServer}=require(path.join(dir,'server/http.cjs'));
  const {createOpenAIGroupProvider}=require(path.join(dir,'server/ai-openai.cjs'));
  const openaiProvider=createOpenAIGroupProvider('synthetic-dragon',{fetchImpl:async(url,init)=>{
    const body=JSON.parse(init.body), text=body.input.at(-1).content;
    proof.calls.push({url,model:body.model,text});
    if(text==='原连接等待撤回的测试消息'){
      init.signal.addEventListener('abort',()=>{seenAbort=true;},{once:true});
      pending.resolve();
      await late.promise;
    }
    return Response.json({status:'completed',output:[{type:'message',role:'assistant',
      content:[{type:'output_text',text:'测试回复：'+text}]}]});
  }});
  const claudeProvider=claude?{name:'橘娘',provider:'anthropic',groupRoles:[{name:'橘娘',number:ju}],
    async generate(){throw Error('Unexpected Claude call');}}:undefined;
  store=new SocialStore(path.join(output,'fixture.sqlite'));
  server=createServer(store,{openaiProvider,claudeProvider,groupAiProviders:[openaiProvider,claudeProvider].filter(Boolean)})
    .listen(port,'127.0.0.1');
  await once(server,'listening');
  port=server.address().port;
  origin='http://127.0.0.1:'+port;
}
async function account(number){
  const context=await browser.newContext({viewport:{width:440,height:790},serviceWorkers:'block'});
  await context.route('**/*',route=>{
    if(route.request().url().startsWith(origin+'/'))return route.continue();
    proof.blockedExternal.push(route.request().url());
    return route.abort();
  });
  const actor={number,context};
  await api(actor,'/register',{number,displayName:number,password:'synthetic-legacy-only'});
  return actor;
}
async function api(actor,endpoint,body,status=200,headers={}){
  const res=await actor.context.request.fetch(origin+'/api/v1'+endpoint,
    {method:body===undefined?'GET':'POST',data:body,headers});
  assert.equal(res.status(),status,endpoint+' '+await res.text());
  return res.json();
}
async function page(actor,script){
  const tab=await actor.context.newPage();
  tab.setDefaultTimeout(7000);
  const js=tab.waitForResponse(r=>new URL(r.url()).pathname==='/app.js');
  await tab.goto(origin);
  const bytes=(await (await js).body()).toString().replace(/^const servedClientBuild = "[a-f0-9]{64}";\n/,'');
  assert.equal(hash(bytes),script);
  await expect(button(tab,'通讯录')).toBeVisible();
  return tab;
}
async function contact(tab,{legacy=false}={}){
  await button(tab,'通讯录').click();
  await button(tab,'AI 联系人').click();
  const dialog=tab.locator('#dialog');
  await expect(dialog).toContainText('龙娘');
  if(legacy){
    await expect(dialog).toContainText('发给 DeepSeek');
    return dialog.getByText('龙娘 · AI',{exact:true}).locator('xpath=following-sibling::button[1]');
  }
  return button(dialog.locator('.request').filter({hasText:'龙娘'}),'同意并开始私聊');
}
async function click(tab,control,endpoint){
  const [sent]=await Promise.all([
    tab.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith(endpoint)),control.click(),
  ]);
  const response=await sent.response();
  const event={endpoint,body:sent.postDataJSON(),status:response.status(),
    claudeUi:sent.headers()['x-social-claude-ui']??null,result:await response.json()};
  proof.wire.push(event);
  return event;
}

async function run(){
  const old=await unpack(release115,'1.0.15.0');
  const later=await unpack(release116,'1.0.16.0');
  const script=hash(await fs.readFile(path.join(current,'client/app.js')));
  proof.versions.candidate={script};
  await serve(old,{claude:false});
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
  const b=await account(beta), oldest=await page(b,proof.versions['1.0.15.0'].script);
  const a=await account(alpha), oldRestore=await page(a,proof.versions['1.0.15.0'].script);
  await serve(later);
  const stale=await page(a,proof.versions['1.0.16.0'].script);
  assert(!(await api(a,'/ai-contacts')).contacts.some(row=>row.number===dragon));
  await serve(current);
  const control=await contact(stale);
  await expect(stale.locator('#dialog .request').filter({hasText:'龙娘'})).toContainText('OpenAI（GPT）');
  const opened=await click(stale,control,'/ai-contacts/start');
  assert.equal(opened.body.provider,'openai');
  assert.equal(opened.status,200);
  const chat=opened.result.conversation.id, endpoint=route(chat)+'/ai-consent';
  await expect(stale.locator('#chat-title')).toHaveText('龙娘');
  await button(stale,'关闭云聊天').click();
  await expect(stale.locator('#dialog')).toContainText('OpenAI（GPT）');
  const closed=await click(stale,button(stale,'确认关闭'),endpoint);
  assert.deepEqual(closed.body,{expectedAccount:alpha,revision:0,allowCloud:false});
  if(mode==='--baseline'){
    assert.equal(closed.status,409);
    assert.equal((await api(a,route(chat))).conversation.cloudChat.enabled,true);
    await expect(stale.locator('#dialog')).toContainText('云聊天设置已改变');
    await stale.screenshot({path:path.join(output,'旧页无法撤回.png')});
    return;
  }
  assert.equal(closed.status,200);
  await expect(stale.locator('#message')).toHaveAttribute('readonly','');
  await stale.screenshot({path:path.join(output,'旧页已撤回.png')});
  assert.deepEqual((await api(a,route(chat))).conversation.cloudChat,{enabled:false,revision:1});
  await api(a,endpoint,{expectedAccount:beta,revision:1,allowCloud:false},403);
  await api(b,endpoint,{expectedAccount:beta,revision:1,allowCloud:false},404);
  await api(a,endpoint,{...closed.body},409);
  await api(a,endpoint,{expectedAccount:alpha,revision:1,allowCloud:true,provider:'deepseek'},409);
  await button(stale,'恢复云聊天').click();
  const refusedResume=await click(stale,button(stale,'同意并恢复'),endpoint);
  assert.equal(refusedResume.status,409);
  assert.equal(refusedResume.result.error.code,'ai_provider_confirmation');
  assert.equal(refusedResume.body.provider,undefined);
  await expect(stale.locator('#dialog')).toContainText('请刷新后重试');
  await oldRestore.evaluate(id=>{location.hash='#chat/'+id;},chat);
  await button(oldRestore,'恢复云聊天').click();
  await expect(oldRestore.locator('#dialog')).toContainText('DeepSeek');
  const wrongRestore=await click(oldRestore,button(oldRestore,'同意并恢复'),endpoint);
  assert.equal(wrongRestore.status,409);
  assert.equal(wrongRestore.body.provider,undefined);
  await expect(oldRestore.locator('#dialog')).toContainText('请刷新后重试');
  const refusedStart=await click(oldest,await contact(oldest,{legacy:true}),'/ai-contacts/start');
  assert.equal(refusedStart.status,409);
  assert.equal(refusedStart.body.provider,undefined);
  await expect(oldest.locator('#dialog')).toContainText('请刷新后重试');
  assert.equal((await api(b,'/conversations')).conversations.length,0);
  assert.equal(proof.calls.length,0);
  const uiHeader={'X-Social-Claude-UI':'1'};
  assert(!(await api(a,'/ai-contacts')).contacts.some(row=>row.number===ju));
  assert((await api(a,'/ai-contacts',undefined,200,uiHeader)).contacts.some(row=>row.number===ju&&row.provider==='anthropic'));
  await api(b,'/ai-contacts/start',{number:ju,provider:'anthropic',allowCloud:true,expectedAccount:beta},409);

  const fresh=await page(a,script);
  await click(fresh,await contact(fresh),'/ai-contacts/start');
  await button(fresh,'恢复云聊天').click();
  const resumed=await click(fresh,button(fresh,'同意并恢复'),endpoint);
  assert.equal(resumed.body.provider,'openai');
  assert.equal(resumed.status,200);
  const send=text=>fresh.locator('#message').fill(text).then(()=>button(fresh,'发送').click());
  await send('恢复后的一条正常消息');
  await expect(fresh.locator('#history')).toContainText('测试回复：恢复后的一条正常消息');
  await stale.locator('#dialog-close').click();
  await expect(button(stale,'关闭云聊天')).toBeVisible();
  const inFlight=fresh.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/messages'));
  inFlight.catch(()=>{});
  await send('原连接等待撤回的测试消息');
  await expect.poll(()=>proof.calls.at(-1)?.text).toBe('原连接等待撤回的测试消息');
  await pending.promise;
  await button(stale,'关闭云聊天').click();
  const during=await click(stale,button(stale,'确认关闭'),endpoint);
  assert.equal(during.status,200);
  assert.equal(seenAbort,true);
  late.resolve();
  assert.equal((await (await inFlight).json()).reply,undefined);
  assert.equal(proof.calls.length,2);
  assert.deepEqual(proof.blockedExternal,[]);
  proof.finalState=(await api(a,route(chat))).conversation.cloudChat;
  assert.deepEqual(proof.finalState,{enabled:false,revision:3});
  proof.abortedInFlight=seenAbort;
}

fs.mkdir(output).then(run).catch(error=>{
  proof.error=error.stack;
  console.error(error);
  process.exitCode=1;
}).finally(async()=>{
  late.resolve();
  if(browser)await browser.close();
  await stop();
  await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(proof,null,2));
});
