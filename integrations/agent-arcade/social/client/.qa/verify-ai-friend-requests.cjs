'use strict';

const assert=require('node:assert/strict');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {SocialStore,AI_NUMBER}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {createDeepSeekProvider}=require('../../server/ai-deepseek.cjs');
const {invitationGuide}=require('../../server/ai-friend-requests.cjs');

const btn=(page,name)=>page.getByRole('button',{name,exact:true});
const marker='[[friend-request]]';
const talk='那篇小说里我最喜欢结尾的重逢。';
const quiet='今天只是简单说一声早安。';
const race='读到结尾让我想起了前一章。';
const response='我也很喜欢，你记得好仔细。';

async function register(browser,origin,number){
  const context=await browser.newContext({baseURL:origin,viewport:{width:440,height:860},serviceWorkers:'block'});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page=await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(origin);
  await btn(page,'创建账号').click();
  await page.locator('[name=number]').fill(number);
  await page.locator('[name=displayName]').fill(number);
  await page.locator('[name=password]').fill('synthetic-invite-password');
  await page.locator('#auth-submit').click();
  await page.locator('#directory-title').getByText('消息',{exact:true}).waitFor();
  return {page,number};
}

async function api({page},route,data,status=200){
  const res=await page.request.fetch('/api/v1'+route,{method:data===undefined?'GET':'POST',data});
  const body=await res.json();
  assert.equal(res.status(),status,JSON.stringify(body));
  return body;
}
const invites=async actor=>(await api(actor,'/friend-requests')).incoming.filter(row=>row.from.kind==='ai');

async function inbox({page},count=0){
  const label=count?'新的朋友（'+count+'）':'新的朋友';
  if(new URL(page.url()).hash.startsWith('#chat/'))await btn(page,'返回').click();
  const contacts=page.locator('[data-tab=contacts]');
  await contacts.click();
  await btn(page,label).click();
  return page.locator('#dialog');
}

async function allow(actor,enable){
  const {page}=actor;
  const from=enable?'允许接收鲸鱼娘的申请':'停止接收鲸鱼娘的申请';
  const to=enable?'停止接收鲸鱼娘的申请':'允许接收鲸鱼娘的申请';
  await btn(page,from).click();
  await btn(page,to).waitFor();
}

async function send({page},value,onPosted){
  const received=page.waitForResponse(row=>row.request().method()==='POST'&&row.url().endsWith('/messages'));
  await page.locator('#message').fill(value);
  await btn(page,'发送').click();
  if(onPosted)await Promise.race([onPosted(),received.then(()=>{throw Error('The pending model turn ended before the setting changed');})]);
  const res=await received;
  const body=await res.json();
  assert.equal(res.status(),200,JSON.stringify(body));
  return body;
}

async function main(){
  const target=process.argv[2]&&path.resolve(process.argv[2]);
  if(target)await fs.mkdir(target,{recursive:true});
  const temp=await fs.realpath(os.tmpdir());
  const scratch=await fs.mkdtemp(path.join(temp,'arcade-ai-invite-'));
  const file=path.join(scratch,'social.sqlite');
  const wire=[];
  const held=Promise.withResolvers(),release=Promise.withResolvers();
  const provider=createDeepSeekProvider('synthetic-unused-token',{fetchImpl:async (url,options)=>{
    assert.equal(new URL(url).hostname,'api.deepseek.com');
    const {messages,tool_choice:toolChoice}=JSON.parse(options.body);
    assert.equal(toolChoice,'none');
    const [system,...context]=messages;
    const input=context.at(-1).content;
    const group=system.content.includes('你在多人群里');
    const offered=system.content.includes(invitationGuide);
    for(const row of messages)assert.doesNotMatch(row.content,/invite_(owner|accept|decline)|不要共享这条/iu);
    if(group)assert.deepEqual(context,[{role:'user',content:input}]);
    wire.push({group,offered,roles:messages.map(row=>row.role),input,toolChoice});
    if(input===race){held.resolve();await release.promise;}
    const content=input===quiet||!group?response:response+'\n'+marker;
    return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content}}]});
  }});
  let browser,server,store;
  function start(){
    store=new SocialStore(file);
    server=createServer(store,{aiProvider:provider,groupAiProviders:[provider]}).listen(0,'127.0.0.1');
    return once(server,'listening').then(()=>('http://127.0.0.1:'+server.address().port));
  }
  try{
    const origin=await start();
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    const [owner,decliner,recipient]=await Promise.all(['invite_owner','invite_decline','invite_accept'].map(number=>register(browser,origin,number)));
    for(const actor of [decliner,recipient]){
      const {request}=await api(owner,'/friend-requests',{number:actor.number});
      await api(actor,'/friend-requests/'+request.id+'/accept',{});
    }
    const {conversation:group}=await api(owner,'/groups',{title:'同群相遇隔离验收',memberNumbers:[decliner.number,recipient.number]});
    const openGroup=async ({page})=>{
      if(await page.locator('#dialog-close').isVisible())await page.locator('#dialog-close').click();
      await page.goto(origin+'/#chat/'+group.id);
    };
    await Promise.all([owner,decliner,recipient].map(openGroup));
    await btn(owner.page,'群成员').click();
    await btn(owner.page,'群内 AI').click();
    await btn(owner.page,'加入鲸鱼娘（DeepSeek）').click();
    await btn(owner.page,'关闭').click();
    for(const {page} of [owner,decliner]){
      await btn(page,'群成员').click();
      await btn(page,'群内 AI').click();
      await btn(page,'同意发给 DeepSeek').click();
      await btn(page,'关闭').click();
    }

    await inbox(owner);
    await allow(owner,true);
    if(target)await owner.page.screenshot({path:path.join(target,'新的朋友-允许.png')});
    assert.equal(wire.length,0);
    assert.deepEqual(await invites(owner),[]);
    await openGroup(owner);
    await send(owner,'不要共享这条普通群消息。');
    assert.equal(wire.length,0);
    const noConsent=await send(recipient,'@鲸鱼娘 '+talk);
    assert.equal(noConsent.reply,undefined);
    assert.equal(wire.length,0);
    await btn(recipient.page,'群成员').click();
    await btn(recipient.page,'群内 AI').click();
    await btn(recipient.page,'同意发给 DeepSeek').click();
    await btn(recipient.page,'关闭').click();

    const optedOut=await send(decliner,'@鲸鱼娘 '+talk);
    assert.equal(optedOut.reply.text,response);
    assert.equal(wire.at(-1).offered,false);
    assert.deepEqual(await invites(decliner),[]);
    const silent=await send(owner,'@鲸鱼娘 '+quiet);
    assert.equal(silent.reply.text,response);
    assert.equal(wire.at(-1).offered,true);
    assert.deepEqual(await invites(owner),[]);
    const paused=await send(owner,'@鲸鱼娘 '+race,async()=>{
      await held.promise;
      const {preference}=await api(owner,'/ai-friend-preference');
      const {preference:off}=await api(owner,'/ai-friend-preference',{enabled:false,revision:preference.revision,expectedAccount:owner.number});
      await api(owner,'/ai-friend-preference',{enabled:true,revision:off.revision,expectedAccount:owner.number});
      release.resolve();
    });
    assert.equal(paused.reply.text,response);
    assert.equal(wire.at(-1).offered,true);
    assert.deepEqual(await invites(owner),[]);

    await inbox(decliner);
    await allow(decliner,true);
    await openGroup(decliner);
    const first=await send(decliner,'@鲸鱼娘 '+talk);
    assert.equal(first.reply.text,response);
    assert.equal(wire.at(-1).offered,true);
    const [request]=await invites(decliner);
    assert.deepEqual([request.from.number,request.from.kind,request.to.number,request.reason],[AI_NUMBER,'ai',decliner.number,'group_interaction']);
    await api(owner,'/friend-requests/'+request.id+'/accept',{},404);
    const priorCount=wire.length;
    const retry=await api(decliner,'/conversations/'+group.id+'/messages',{text:first.message.text,clientId:first.message.clientId});
    assert.equal(retry.message.id,first.message.id);
    assert.equal(wire.length,priorCount);
    await send(decliner,'@鲸鱼娘 '+talk);
    assert.equal(wire.at(-1).offered,false);
    assert.deepEqual((await invites(decliner)).map(row=>row.id),[request.id]);
    await decliner.page.reload();
    const visible=await inbox(decliner,1);
    await visible.getByText('鲸鱼娘 · AI',{exact:true}).waitFor();
    await visible.getByText('你们在同一个群里聊过。鲸鱼娘想在好友里认识你。',{exact:true}).waitFor();
    await btn(decliner.page,'停止接收鲸鱼娘的申请').waitFor();
    if(target)await decliner.page.screenshot({path:path.join(target,'新的朋友-AI申请.png')});
    await btn(decliner.page,'拒绝').click();
    await visible.getByText('暂无待处理的好友请求。',{exact:true}).waitFor();
    await openGroup(decliner);
    await send(decliner,'@鲸鱼娘 '+talk);
    assert.equal(wire.at(-1).offered,false);
    assert.deepEqual(await invites(decliner),[]);
    assert.equal(store.one('SELECT state FROM requests WHERE id=?',request.id).state,'declined');
    await decliner.page.reload();
    assert.equal((await api(decliner,'/ai-friend-preference')).preference.enabled,true);
    assert.equal((await api(recipient,'/ai-friend-preference')).preference.enabled,false);

    await inbox(recipient);
    await allow(recipient,true);
    await openGroup(recipient);
    await send(recipient,'@鲸鱼娘 '+talk);
    const [acceptRequest]=await invites(recipient);
    await recipient.page.reload();
    await inbox(recipient,1);
    await btn(recipient.page,'接受').click();
    await recipient.page.locator('#chat-detail').getByText('DeepSeek · 未开启云聊天',{exact:true}).waitFor();
    assert.equal(await recipient.page.locator('#message').getAttribute('readonly'),'');
    const direct=(await api(recipient,'/conversations')).conversations.find(row=>row.type==='direct'&&row.members.some(member=>member.number===AI_NUMBER));
    assert.equal(direct.cloudChat,undefined);
    assert.equal(direct.requiresAiCloudConsent,true);
    const beforeCloud=wire.length;
    const blocked=await api(recipient,'/conversations/'+direct.id+'/messages',{text:'这条在云聊天未同意时被挡住',clientId:'blocked-message'},409);
    assert.equal(blocked.error.code,'ai_consent_required');
    assert.equal(wire.length,beforeCloud);
    assert.equal(store.one('SELECT count(*) AS n FROM messages WHERE chat=?',direct.id).n,0);
    await recipient.page.reload();
    await btn(recipient.page,'返回').click();
    await recipient.page.locator('[data-tab=contacts]').click();
    await recipient.page.locator('#directory-body').getByRole('button',{name:/鲸鱼娘/}).click();
    await recipient.page.locator('#chat-detail').getByText('DeepSeek · 未开启云聊天',{exact:true}).waitFor();
    if(target)await recipient.page.screenshot({path:path.join(target,'接受后-云聊天未开启.png')});
    await btn(recipient.page,'开启云聊天').click();
    await recipient.page.locator('#dialog').getByText(/会发送给 DeepSeek/u).waitFor();
    await btn(recipient.page,'同意并开始私聊').click();
    await recipient.page.locator('#chat-detail').getByText('DeepSeek · 云聊天已开启',{exact:true}).waitFor();
    const chat=await send(recipient,'你好，第一次私聊。');
    assert.equal(chat.reply.sender.number,AI_NUMBER);
    assert.equal(chat.reply.conversationId,direct.id);
    assert.equal(wire.at(-1).group,false);
    assert.equal(wire.at(-1).offered,false);
    assert.equal(wire.length,beforeCloud+1);
    await openGroup(recipient);
    await send(recipient,'@鲸鱼娘 '+talk);
    assert.equal(wire.at(-1).offered,false);
    assert.deepEqual(await invites(recipient),[]);
    assert.equal(store.one('SELECT state FROM requests WHERE id=?',acceptRequest.id).state,'accepted');
    assert.equal(store.one('SELECT count(*) AS n FROM requests WHERE sender=?',AI_NUMBER).n,2);

    const evidence={group:group.id,contacts:[request.from,acceptRequest.from],declined:request.id,
      accepted:acceptRequest.id,direct:direct.id,retry:first.message.id,blocked:blocked.error.code,
      firstPrivateReply:chat.reply.id,totalRequests:2,providerCalls:wire,upstream:'in-process HTTP observation, synthetic response'};
    if(target)await fs.writeFile(path.join(target,'receipt.json'),JSON.stringify(evidence,null,2)+'\n');
    console.log(JSON.stringify(evidence,null,2));
  }finally{
    release.resolve();
    if(browser)await browser.close();
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    store?.db.close();
    if(path.dirname(scratch)===temp&&path.basename(scratch).startsWith('arcade-ai-invite-'))
      await fs.rm(scratch,{recursive:true,force:true});
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
