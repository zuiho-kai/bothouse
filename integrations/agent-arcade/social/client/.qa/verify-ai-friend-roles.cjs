'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {chromium}=require('playwright');
const {SocialStore}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {makeBackup}=require('../../deploy/backup.cjs');
const {AI_NUMBER,AI_JU_NUMBER,AI_DRAGON_NUMBER}=require('../../server/ai-roles.cjs');
const {invitationGuide}=require('../../server/ai-friend-requests.cjs');

const roles=[[AI_NUMBER,'鲸鱼娘','deepseek'],[AI_JU_NUMBER,'橘娘','anthropic'],[AI_DRAGON_NUMBER,'龙娘','openai']];
const buttons=(page,name)=>page.getByRole('button',{name,exact:true});
const heading=(page,name)=>page.locator('#chat-title').getByText(name,{exact:true});
const answer='这段情节我也记得。';
const holding='这条合成消息需要暂扣模型回复。';
const silent='这轮只聊聊故事就好。';
const configs='/ai-friend-preferences';

async function register(browser,origin,number){
  const page=await browser.newPage({baseURL:origin,viewport:{width:950,height:770},serviceWorkers:'block'});
  page.setDefaultTimeout(10000);
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.goto('/');
  await buttons(page,'创建账号').click();
  await page.locator('[name=number]').fill(number);
  await page.locator('[name=displayName]').fill('合成同名');
  await page.locator('[name=password]').fill('synthetic per role invitation fixture');
  await page.locator('#auth-submit').click();
  await page.locator('#directory-title').getByText('消息',{exact:true}).waitFor();
  return page;
}

async function api(page,route,data,status=200,{legacy=false,claude=true}={}){
  const response=await page.request.fetch('/api/v1'+route,{method:data===undefined?'GET':'POST',data,
    headers:{...(claude&&{'X-Social-Claude-UI':'1'}),...(!legacy&&{'X-Social-AI-Friend-Roles':'1'})}});
  const result=await response.json();
  assert.equal(response.status(),status,JSON.stringify(result));
  return result;
}
const inviteRows=async (page,options)=>(await api(page,'/friend-requests',undefined,200,options)).incoming.filter(row=>row.from.kind==='ai');
const options=async page=>(await api(page,configs)).roles;

async function freshInbox(page,n){
  await page.goto('/');
  await buttons(page,'通讯录').click();
  await buttons(page,n?'新的朋友（'+n+'）':'新的朋友').click();
  return page.locator('#dialog');
}

async function choose(page,name,enabled){
  const before=enabled?'允许接收':'停止接收',after=enabled?'停止接收':'允许接收';
  await buttons(page,before+name+'的申请').click();
  await buttons(page,after+name+'的申请').waitFor();
}
async function send(page,text,onPending){
  const pending=page.waitForResponse(row=>row.request().method()==='POST'&&row.url().endsWith('/messages'));
  await page.locator('#message').fill(text);
  await buttons(page,'发送').click();
  if(onPending)await Promise.race([onPending(),pending.then(()=>{throw Error('Reply completed before its trigger');})]);
  const response=await pending;
  const result=await response.json();
  assert.equal(response.status(),200,JSON.stringify(result));
  return {result,body:response.request().postDataJSON()};
}

async function main(){
  const out=path.resolve(process.argv[2]),oldRoot=process.argv[3]&&path.resolve(process.argv[3]);
  await fs.mkdir(out,{recursive:true});
  const dbPath=path.join(out,'synthetic.sqlite');
  const calls=[],unexpected=[];
  const held=Promise.withResolvers(),release=Promise.withResolvers();
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>{unexpected.push(String(url));throw Error('External calls forbidden');};
  const [aiProvider,claudeProvider,openaiProvider]=roles.map(([number,name,provider])=>({
    name,provider,groupRoles:[{number,name}],
    async generate(rows,{groupRole,replyHint}={}){
      assert(!groupRole||groupRole===number);
      const prompt=rows.at(-1).content;
      const offered=replyHint?.includes(invitationGuide)??false;
      if(groupRole)assert.deepEqual(rows,[{role:'user',content:prompt}]);
      calls.push({number,provider,group:!!groupRole,offered,prompt});
      if(prompt===holding){held.resolve();await release.promise;}
      return prompt===silent||!groupRole?answer:answer+'\n[[friend-request]]';
    },
  }));
  let store,server,browser,port=0;
  async function start(earlier=false){
    const modules=earlier?{
      Store:require(path.join(oldRoot,'social/server/store.cjs')).SocialStore,
      serve:require(path.join(oldRoot,'social/server/http.cjs')).createServer,
    }:{Store:SocialStore,serve:createServer};
    store=new modules.Store(dbPath);
    server=modules.serve(store,{aiProvider,claudeProvider,openaiProvider}).listen(port,'127.0.0.1');
    await once(server,'listening');
    port=server.address().port;
    return 'http://127.0.0.1:'+port;
  }
  async function stop(){
    if(server){
      server.closeAllConnections();
      await new Promise(resolve=>server.close(resolve));
      server=undefined;
    }
    store?.db.close();
    store=undefined;
  }
  try{
    const origin=await start(Boolean(oldRoot));
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    const [a,b]=await Promise.all(['invite_alpha','invite_bravo'].map(number=>register(browser,origin,number)));
    if(oldRoot){
      await freshInbox(a,0);
      await buttons(a,'允许 AI 好友申请').click();
      await buttons(a,'停止接收 AI 好友申请').waitFor();
    }else await api(a,'/ai-friend-preference',{expectedAccount:'invite_alpha',enabled:true,revision:0});
    await stop();
    await start();
    const old=await options(a);
    assert.deepEqual(old.map(role=>[role.number,role.enabled,role.revision]),
      [[AI_NUMBER,true,1],[AI_JU_NUMBER,false,0],[AI_DRAGON_NUMBER,false,0]]);
    assert((await options(b)).every(role=>role.enabled===false));
    await freshInbox(a,0);
    await buttons(a,'停止接收鲸鱼娘的申请').waitFor();
    await buttons(a,'允许接收橘娘的申请').waitFor();
    await buttons(a,'允许接收龙娘的申请').waitFor();
    await a.screenshot({path:path.join(out,'旧鲸鱼娘设置沿用.png')});
    await choose(a,'橘娘',true);
    await buttons(a,'允许接收龙娘的申请').waitFor();
    await buttons(a,'关闭').click();
    await freshInbox(b,0);
    await choose(b,'橘娘',true);
    await buttons(b,'关闭').click();

    const human=(await api(a,'/friend-requests',{number:'invite_bravo'})).request;
    await api(b,'/friend-requests/'+human.id+'/accept',{});
    const group=(await api(a,'/groups',{title:'同名合成账号的三角色群',memberNumbers:['invite_bravo']})).conversation;
    const groupRoute='/groups/'+group.id, messages='/conversations/'+group.id+'/messages';
    for(const [number,,provider] of roles){
      await api(a,groupRoute+'/ai',{expectedAccount:'invite_alpha',number,enabled:true});
      if(number!==AI_JU_NUMBER)await api(a,groupRoute+'/ai-consent',{expectedAccount:'invite_alpha',number,provider,enabled:true});
      await api(b,groupRoute+'/ai-consent',{expectedAccount:'invite_bravo',number,provider,enabled:true});
    }
    const enterGroup=async page=>{
      await page.goto('/#chat/'+group.id);
      await heading(page,group.title).waitFor();
    };
    await Promise.all([a,b].map(enterGroup));
    const noConsent=await send(a,'@橘娘 今天读到重逢这一段。');
    assert.equal(noConsent.result.reply,undefined);
    assert.equal(calls.length,0);
    await api(a,groupRoute+'/ai-consent',{expectedAccount:'invite_alpha',number:AI_JU_NUMBER,provider:'anthropic',enabled:true});
    const unselected=await send(a,'@龙娘 今天读到重逢这一段。');
    assert.equal(unselected.result.reply.text,answer);
    assert.equal(calls.at(-1).offered,false);
    assert.deepEqual(await inviteRows(a),[]);
    await freshInbox(a,0);
    await choose(a,'龙娘',true);
    await buttons(a,'关闭').click();
    await enterGroup(a);
    const quiet=await send(a,'@橘娘 '+silent);
    assert.equal(quiet.result.reply.text,answer);
    assert.equal(calls.at(-1).offered,true);
    assert.deepEqual(await inviteRows(a),[]);
    const change=async (page,account,number,enabled)=>{
      const role=(await options(page)).find(role=>role.number===number);
      return api(page,configs,{expectedAccount:account,number,enabled,revision:role.revision});
    };
    const raced=await send(a,'@橘娘 '+holding,async()=>{
      await held.promise;
      await change(a,'invite_alpha',AI_JU_NUMBER,false);
      await change(a,'invite_alpha',AI_JU_NUMBER,true);
      release.resolve();
    });
    assert.equal(raced.result.reply.text,answer);
    assert.equal(calls.at(-1).offered,true);
    assert.deepEqual(await inviteRows(a),[]);

    const posted=await send(a,'@橘娘 重逢那段我们接着聊。');
    await send(a,'@龙娘 重逢这段你印象怎样？');
    await send(a,'@鲸鱼娘 这个结尾让我想起另一篇故事。');
    const pending=await inviteRows(a);
    assert.deepEqual(new Set(pending.map(row=>row.from.number)),new Set(roles.map(([number])=>number)));
    assert(pending.every(row=>row.to.number==='invite_alpha'&&row.reason==='group_interaction'));
    assert.deepEqual(await inviteRows(b),[]);
    const roleRequest=number=>pending.find(row=>row.from.number===number);
    await api(b,'/friend-requests/'+roleRequest(AI_JU_NUMBER).id+'/accept',{},404);
    const count=calls.length;
    const retried=await api(a,messages,posted.body);
    assert.equal(retried.message.id,posted.result.message.id);
    assert.equal(calls.length,count);
    assert.deepEqual((await inviteRows(a,{legacy:true})).map(row=>row.from.number),[AI_NUMBER]);
    const legacy=(await api(a,'/ai-friend-preference')).preference;
    await api(a,'/ai-friend-preference',{expectedAccount:'invite_alpha',enabled:false,revision:legacy.revision});
    assert.deepEqual(new Set((await inviteRows(a)).map(row=>row.from.number)),new Set([AI_JU_NUMBER,AI_DRAGON_NUMBER]));
    const switchOff=(await options(a)).find(role=>role.number===AI_NUMBER);
    assert.equal(switchOff.enabled,false);
    await api(a,'/friend-requests/'+roleRequest(AI_NUMBER).id+'/accept',{},409);

    let inbox=await freshInbox(a,2);
    await inbox.getByText('你们在同一个群里聊过。龙娘想在好友里认识你。',{exact:true}).waitFor();
    await inbox.locator('.request').filter({hasText:'龙娘 · AI'}).getByRole('button',{name:'拒绝',exact:true}).click();
    await inbox.getByText('龙娘 · AI',{exact:true}).waitFor({state:'hidden'});
    await buttons(a,'关闭').click();
    await enterGroup(a);
    await send(a,'@龙娘 再聊一次这个结尾。');
    assert.equal(calls.at(-1).offered,false);
    assert.deepEqual((await inviteRows(a)).map(row=>row.from.number),[AI_JU_NUMBER]);

    async function accept(page,role,name,provider){
      const before=calls.length;
      const screen=await freshInbox(page,(await inviteRows(page)).length);
      await screen.locator('.request').filter({hasText:name+' · AI'}).getByRole('button',{name:'接受',exact:true}).click();
      await heading(page,name).waitFor();
      const id=page.url().split('#chat/')[1],route='/conversations/'+id;
      const {conversation}=await api(page,route);
      const {user}=await api(page,'/me');
      assert.equal(conversation.aiProvider,provider);
      assert.equal(conversation.requiresAiCloudConsent,true);
      assert.equal(conversation.cloudChat,undefined);
      assert.equal(await page.locator('#message').getAttribute('readonly'),'');
      const blocked=await api(page,route+'/messages',{clientId:'before-cloud-grant',text:'不应进入云模型'},409);
      assert.equal(blocked.error.code,'ai_consent_required');
      const wrong=await api(page,'/ai-contacts/start',{number:role,expectedAccount:user.number,allowCloud:true,provider:'deepseek'},409);
      assert.equal(wrong.error.code,'ai_consent_changed');
      assert.equal(calls.length,before);
      await buttons(page,'开启云聊天').click();
      await page.locator('#dialog').getByText(provider==='anthropic'?/Claude（Anthropic）/u:/OpenAI（GPT）/u).waitFor();
      await buttons(page,'同意并开始私聊').click();
      await page.locator('#chat-detail').getByText(/云聊天已开启/u).waitFor();
      assert.equal(calls.length,before);
      const sent=await send(page,'这才是明确同意后的第一句话。');
      assert.equal(sent.result.reply.sender.number,role);
      assert.equal(calls.at(-1).provider,provider);
      return {id,role,provider,preConsent:409,privateCallsAfterOptIn:1};
    }

    const ju=await accept(a,AI_JU_NUMBER,'橘娘','anthropic');
    await freshInbox(b,0);
    await choose(b,'龙娘',true);
    await buttons(b,'关闭').click();
    await enterGroup(b);
    await send(b,'@龙娘 我也想聊聊重逢。');
    await send(b,'@橘娘 我很喜欢那一章。');
    const dragon=await accept(b,AI_DRAGON_NUMBER,'龙娘','openai');
    await freshInbox(b,1);
    await choose(b,'鲸鱼娘',true);
    await buttons(b,'关闭').click();
    await enterGroup(b);
    await send(b,'@鲸鱼娘 我也刚读到这里。');
    const inboxBefore=(await inviteRows(b));
    assert.deepEqual(new Set(inboxBefore.map(row=>row.from.number)),new Set([AI_NUMBER,AI_JU_NUMBER]));
    const keep=inboxBefore.find(row=>row.from.number===AI_NUMBER);
    const revokeScreen=await freshInbox(b,2);
    await choose(b,'橘娘',false);
    await revokeScreen.getByText('橘娘 · AI',{exact:true}).waitFor({state:'hidden'});
    await revokeScreen.getByText('鲸鱼娘 · AI',{exact:true}).waitFor();
    assert.deepEqual((await inviteRows(b)).map(row=>row.id),[keep.id]);
    await stop();
    await start();
    assert.equal((await inviteRows(b))[0].id,keep.id);
    assert.equal((await options(b)).find(role=>role.number===AI_JU_NUMBER).enabled,false);
    const restored=await makeBackup(dbPath,path.join(out,'prepared-restore'),{prepareRestore:true});
    const snapshot=new SocialStore(restored);
    try{
      for(const table of ['ai_friend_preferences','ai_friend_role_preferences'])
        assert.equal(snapshot.one('SELECT count(*) AS n FROM '+table).n,0);
      assert.equal(snapshot.one('SELECT state FROM requests WHERE id=?',keep.id).state,'declined');
      assert.equal(snapshot.invitingAi('invite_alpha',ju.id),AI_JU_NUMBER);
      assert.equal(snapshot.invitingAi('invite_bravo',dragon.id),AI_DRAGON_NUMBER);
      assert.equal(snapshot.directAiConsent('invite_alpha',ju.id).enabled,0);
    }finally{snapshot.db.close();}
    assert.deepEqual(unexpected,[]);
    const receipt={usedFrozen127:Boolean(oldRoot),old,threeInviters:pending.map(row=>({from:row.from.number,to:row.to.number})),
      legacyInboxOnlyWhale:true,neighborDidNotReceiveAlphaInvites:true,lateAfterToggleDropped:true,
      declinedDragonDidNotRepeat:true,revokingJuLeftWhalePending:true,retryExtraRequests:0,acceptance:[ju,dragon],restartRetained:keep.id,
      preparedRestoreClearedBothPreferences:true,externalRequests:0,calls};
    await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify(receipt,null,2));
  } finally {
    release.resolve();
    await browser?.close();
    await stop();
    globalThis.fetch=originalFetch;
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
