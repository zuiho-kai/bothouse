'use strict';

const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {SocialStore,AI_NUMBER,AI_DRAGON_NUMBER}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {createDeepSeekProvider}=require('../../server/ai-deepseek.cjs');
const {createOpenAIGroupProvider}=require('../../server/ai-openai.cjs');
const {moderate}=require('../../server/moderate.cjs');

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const title='贴图合成验收群';
const password='fixture-only-sticker-password';
const btn=(page,name)=>page.getByRole('button',{name,exact:true});
const readAsset=key=>fs.readFile(path.join(__dirname,'../../assets/stickers',key+'.png'));

async function register(browser,origin,number,viewport){
  const context=await browser.newContext({baseURL:origin,viewport,serviceWorkers:'block'});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page=await context.newPage();
  await page.goto(origin);
  await btn(page,'创建账号').click();
  await page.locator('[name=number]').fill(number);
  await page.locator('[name=displayName]').fill(number);
  await page.locator('[name=password]').fill(password);
  await page.locator('#auth-submit').click();
  await page.locator('#directory-title').getByText('消息',{exact:true}).waitFor();
  return page;
}

async function api(page,route,data,status=200){
  const result=await page.request.fetch('/api/v1'+route,{method:data===undefined?'GET':'POST',data});
  assert.equal(result.status(),status);
  return result.json();
}

async function send(page,text){
  const response=page.waitForResponse(row=>row.request().method()==='POST'&&row.url().endsWith('/messages'));
  await page.locator('#message').fill(text);
  await btn(page,'发送').click();
  const received=await response;
  assert.equal(received.status(),200);
  return received.json();
}

async function assertImage(page,chat,reply,key,label){
  assert.equal(reply.conversationId,chat);
  assert.equal(reply.text,'[表情图]');
  assert.equal(reply.attachment.sticker.label,label);
  const preview=page.locator(`[data-image-id="${reply.id}"] img`);
  await preview.scrollIntoViewIfNeeded();
  await preview.evaluate(image=>image.decode());
  assert.equal(await preview.getAttribute('alt'),label);
  assert.equal(await preview.evaluate(image=>image.naturalWidth),256);
  const original=await page.request.get(`/api/v1/conversations/${chat}/messages/${reply.id}/image`);
  assert.equal(original.status(),200);
  assert.equal(original.headers()['content-type'],'image/png');
  const bytes=await original.body();
  assert.deepEqual(bytes,await readAsset(key));
  return sha(bytes);
}

async function main(){
  const evidence=process.argv[2]&&path.resolve(process.argv[2]);
  if(evidence)await fs.mkdir(evidence,{recursive:true});
  const temp=await fs.realpath(os.tmpdir());
  const scratch=await fs.mkdtemp(path.join(temp,'arcade-social-sticker-'));
  const store=new SocialStore(path.join(scratch,'qa.sqlite'));
  const model=[];
  const outbound=[];
  const originalFetch=globalThis.fetch;
  const arrived=Promise.withResolvers(),release=Promise.withResolvers();
  function stub(provider,endpoint){
    return async (url,init)=>{
      assert.equal(url,endpoint);
      const body=JSON.parse(init.body),openai=provider==='openai';
      const rows=openai?body.input:body.messages.slice(1);
      const latest=rows.at(-1).content;
      const system=openai?body.instructions:body.messages[0].content;
      const offered=system.includes('[[sticker:happy]]');
      model.push({provider,latest,offered,contextLines:rows.length});
      let response=offered?'[[sticker:surprised]]':'收到，这轮用文字说。';
      if(latest==='我的录取通知到了！')response=offered?'[[sticker:happy]]':response;
      if(latest==='发个表情包')response=offered?'[[sticker:happy]]':response;
      if(latest==='我们就这么定啦！')response=offered?'[[sticker:approve]]':response;
      if(latest==='大家早啊，今天都还好吗')response=offered?'[[sticker:happy]]':response;
      if(latest.includes('我爸去世了'))response='抱抱你。先联系一个你信得过的人陪你。';
      if(latest.includes('仍强制错误码'))response='[[sticker:happy]]';
      if(latest.includes('我的作品入选啦')||latest.includes('我的录取通知刚到了'))
        response='`[[sticker:happy]]` 恭喜你呀！ [[sticker:approve]]';
      if(latest==='我有一个惊喜等你猜！'){arrived.resolve();await release.promise;}
      return Response.json(openai?
        {status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:response}]}]}:
        {choices:[{finish_reason:'stop',message:{role:'assistant',content:response}}]});
    };
  }
  const whale=createDeepSeekProvider('synthetic-test-only',{fetchImpl:stub('deepseek','https://api.deepseek.com/chat/completions')});
  const dragon=createOpenAIGroupProvider('synthetic-test-only',{fetchImpl:stub('openai','https://api.openai.com/v1/responses')});
  const server=createServer(store,{aiProvider:whale,groupAiProviders:[whale,dragon]}).listen(0,'127.0.0.1');
  let browser;
  try{
    globalThis.fetch=async url=>{
      outbound.push(String(url));
      throw Error('The bundled sticker and consent rehearsal must stay offline');
    };
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    const [a,b,other]=await Promise.all([
      register(browser,origin,'sticker_a',{width:430,height:850}),
      register(browser,origin,'sticker_b',{width:430,height:850}),
      register(browser,origin,'not_in_group',{width:900,height:740}),
    ]);
    await a.locator('[data-tab=contacts]').click();
    await btn(a,'AI 联系人').click();
    await a.locator('#dialog').getByText(/OpenMoji.*Wikimedia Commons.*公开主题词|OpenMoji.*公开主题词.*Wikimedia Commons/u).waitFor();
    await btn(a,'同意并开始私聊').click();
    await a.locator('#chat-title').getByText('鲸鱼娘',{exact:true}).waitFor();
    const direct=(await api(a,'/conversations')).conversations[0].id;

    const explicit=await send(a,'能不能发个开心的表情给我看看');
    const directHash=await assertImage(a,direct,explicit.reply,'whale-happy','鲸鱼娘 · 开心地笑');
    assert.equal(model.length,0);
    await a.locator(`[data-image-id="${explicit.reply.id}"]`).click();
    await a.locator('#dialog').getByText('鲸鱼娘 · 开心地笑。Agent Arcade 原创素材。',{exact:true}).waitFor();
    if(evidence)await a.screenshot({path:path.join(evidence,'私聊贴图原图.png')});
    await btn(a,'关闭').click();
    const automatic=await send(a,'我的录取通知到了！');
    await assertImage(a,direct,automatic.reply,'whale-happy','鲸鱼娘 · 开心地笑');
    assert.equal(model.at(-1).offered,true);

    const capability=await send(a,'你能发表情吗？');
    assert.match(capability.reply.text,/挑一张表情图/u);
    assert.equal(capability.reply.attachment,undefined);
    assert.equal(model.length,1);
    const written=await send(a,'这条纯文字回答就好。我的录取通知刚到了！');
    assert.equal(written.reply.text,'恭喜你呀！');
    assert.equal(written.reply.attachment,undefined);
    assert.equal(model.at(-1).offered,false);
    const serious=await send(a,'我爸去世了，我接下来怎么办？');
    assert.match(serious.reply.text,/信得过的人/u);
    assert.equal(model.at(-1).offered,false);
    const forced=await send(a,'只用文字，这轮合成模型仍强制错误码。');
    assert.equal(forced.message.aiReply,'failed');
    assert.equal(forced.reply,undefined);
    assert.equal(await a.locator('#history').getByText('[[sticker:happy]]',{exact:true}).count(),0);
    const missing=await send(a,'发一张捂肚子笑的蓝鲸表情包');
    assert.equal(missing.reply.text,'这次没找到合适的表情图。');
    assert.equal(missing.reply.attachment,undefined);
    const generic=await send(a,'发个表情包');
    await assertImage(a,direct,generic.reply,'whale-happy','鲸鱼娘 · 开心地笑');
    const beforeOnline=model.length;
    const online=await send(a,'上网帮我找张开心的表情包');
    assert.equal(online.reply.text,'这次没找到符合你描述的公开表情图。');
    assert.equal(online.reply.attachment,undefined);
    assert.equal(model.length,beforeOnline);
    const otherOrder=await send(a,'帮我上网搜一张开心表情图');
    assert.equal(otherOrder.reply.text,online.reply.text);
    assert.equal(otherOrder.reply.attachment,undefined);
    assert.equal(model.length,beforeOnline);
    await a.reload();
    await assertImage(a,direct,automatic.reply,'whale-happy','鲸鱼娘 · 开心地笑');
    const directHistory=(await api(a,`/conversations/${direct}/messages`)).messages;
    assert.equal(directHistory.filter(row=>row.attachment?.sticker).length,3);
    for(const sent of [written,online,otherOrder])assert.deepEqual(directHistory.find(row=>row.id===sent.reply.id),sent.reply);
    await a.locator('#history').getByText(written.reply.text,{exact:true}).waitFor();
    assert.doesNotMatch(await a.locator('#history').innerText(),/\[\[sticker:/iu);

    const {request}=await api(a,'/friend-requests',{number:'sticker_b'});
    await api(b,'/friend-requests/'+request.id+'/accept',{});
    const {conversation:group}=await api(a,'/groups',{title,memberNumbers:['sticker_b']});
    await Promise.all([a,b].map(page=>page.goto(origin+'/#chat/'+group.id)));
    await btn(a,'群成员').click();
    await btn(a,'群内 AI').click();
    await a.locator('#dialog').getByText(/OpenMoji.*Wikimedia Commons/u).waitFor();
    await btn(a,'加入鲸鱼娘（DeepSeek）').click();
    await btn(a,'同意发给 DeepSeek').click();
    await btn(a,'加入龙娘（OpenAI）').click();
    await btn(a,'同意发给 OpenAI（GPT）').click();
    await btn(a,'@龙娘（AI）').click();
    const groupExplicit=await send(a,'发一张开心贴图');
    assert.equal(groupExplicit.reply.sender.number,AI_DRAGON_NUMBER);
    const groupHash=await assertImage(b,group.id,groupExplicit.reply,'dragon-happy','龙娘 · 开心地笑');
    assert.notEqual(directHash,groupHash);
    if(evidence)await b.screenshot({path:path.join(evidence,'群成员收到贴图.png')});

    await btn(a,'群成员').click();
    await btn(a,'群内 AI').click();
    await btn(a,'@鲸鱼娘（AI）').click();
    const groupAutomatic=await send(a,'我们提前一天把作品做完啦！');
    const automaticHash=await assertImage(b,group.id,groupAutomatic.reply,'whale-surprised','鲸鱼娘 · 惊讶');
    assert.deepEqual(model.at(-1),{provider:'deepseek',latest:'我们提前一天把作品做完啦！',offered:true,contextLines:1});
    assert.equal(groupAutomatic.message.aiReply,'answered');
    const dragonAutomatic=await send(a,'@龙娘 我们就这么定啦！');
    const dragonAutoHash=await assertImage(b,group.id,dragonAutomatic.reply,'dragon-approve','龙娘 · 表示赞同');
    assert.deepEqual(model.at(-1),{provider:'openai',latest:'我们就这么定啦！',offered:true,contextLines:1});
    const groupWritten=await send(a,'@鲸鱼娘 我只想要纯文字，我的作品入选啦！');
    assert.equal(groupWritten.reply.text,'恭喜你呀！');
    assert.equal(groupWritten.reply.attachment,undefined);
    assert.equal(model.at(-1).offered,false);
    const beforeGroupOnline=model.length;
    const groupOnline=await send(a,'@鲸鱼娘 上网帮我找张开心的表情包');
    assert.equal(groupOnline.reply.text,online.reply.text);
    assert.equal(groupOnline.reply.attachment,undefined);
    assert.equal(model.length,beforeGroupOnline);
    await b.locator('#history').getByText(groupWritten.reply.text,{exact:true}).waitFor();
    await b.locator('#history').getByText(groupOnline.reply.text,{exact:true}).waitFor();
    assert.doesNotMatch(await b.locator('#history').innerText(),/\[\[sticker:/iu);
    const peerHistory=(await api(b,`/conversations/${group.id}/messages`)).messages;
    for(const sent of [groupWritten,groupOnline])assert.deepEqual(peerHistory.find(row=>row.id===sent.reply.id),sent.reply);
    if(evidence)await b.screenshot({path:path.join(evidence,'群成员收到文字修订.png')});
    const beforeRepeat=model.length;
    const retry=await api(a,`/conversations/${group.id}/messages`,{clientId:groupAutomatic.message.clientId,
      text:groupAutomatic.message.text,mentionAccount:AI_NUMBER});
    assert.equal(retry.message.id,groupAutomatic.message.id);
    assert.equal(model.length,beforeRepeat);
    assert.equal((await api(a,`/conversations/${group.id}/messages`)).messages.filter(row=>row.attachment).length,3);
    const groupPath=`/api/v1/conversations/${group.id}/messages/${groupAutomatic.reply.id}/image`;
    assert.equal((await other.request.get(groupPath)).status(),404);
    const unconsented=await send(b,'@鲸鱼娘 发一张开心贴图');
    assert.equal(unconsented.reply,undefined);
    assert.equal(model.length,beforeRepeat);

    const inflight=send(a,'@鲸鱼娘 我有一个惊喜等你猜！');
    await Promise.race([arrived.promise,inflight.then(()=>{throw Error('Expected group model turn');})]);
    await api(a,`/groups/${group.id}/ai-consent`,{number:AI_NUMBER,provider:'deepseek',enabled:false,expectedAccount:'sticker_a'});
    release.resolve();
    assert.equal((await inflight).reply,undefined);
    assert.equal((await api(a,`/conversations/${group.id}/messages`)).messages.filter(row=>row.attachment).length,3);

    const report=store.report('sticker_a',group.id,groupAutomatic.reply.id,'synthetic moderation');
    moderate(store,'remove',report.id);
    await b.locator(`[data-image-id="${groupAutomatic.reply.id}"]`).waitFor({state:'detached'});
    assert.equal((await b.request.get(groupPath)).status(),404);
    await api(b,`/groups/${group.id}/leave`,{});
    assert.equal((await b.request.get(`/api/v1/conversations/${group.id}/messages/${groupExplicit.reply.id}/image`)).status(),404);

    const newGroup=async label=>{
      const {conversation}=await api(a,'/groups',{title:label,memberNumbers:['sticker_b']});
      for(const number of [AI_NUMBER,AI_DRAGON_NUMBER]){
        await api(a,`/groups/${conversation.id}/ai`,{number,enabled:true,expectedAccount:'sticker_a'});
      }
      await api(a,`/groups/${conversation.id}/ai-consent`,{
        number:AI_NUMBER,provider:'deepseek',enabled:true,expectedAccount:'sticker_a',
      });
      await Promise.all([a,b].map(page=>page.goto(origin+'/#chat/'+conversation.id)));
      return conversation.id;
    };
    const naturalChat=await newGroup('自然接话与贴图对照');
    const beforeNatural=model.length;
    const greeting=await send(a,'大家早啊，今天都还好吗');
    assert.equal(greeting.reply.sender.number,AI_NUMBER);
    const naturalHash=await assertImage(b,naturalChat,greeting.reply,'whale-happy','鲸鱼娘 · 开心地笑');
    assert.equal(model.length,beforeNatural+1);
    const naturalWritten=await send(a,'那你刚才说的还有什么建议，只要文字好吗');
    assert.equal(naturalWritten.reply.text,'收到，这轮用文字说。');
    assert.equal(naturalWritten.reply.attachment,undefined);
    assert.deepEqual(model.at(-1),{provider:'deepseek',latest:'那你刚才说的还有什么建议，只要文字好吗',offered:false,contextLines:1});
    const beforeQuiet=model.length;
    const naturalOnline=await send(a,'能不能上网帮我找张开心的表情包吗');
    assert.equal(naturalOnline.reply.text,'在群里点名我后，可以请我找公开表情图。');
    assert.equal(naturalOnline.reply.attachment,undefined);
    const addressedHuman=await send(a,'sticker_b，你能不能发一张开心贴图');
    const otherRole=await send(a,'@龙娘 我们就这么定啦！');
    assert.equal(addressedHuman.reply,undefined);
    assert.equal(otherRole.reply,undefined);
    assert.equal(model.length,beforeQuiet);
    assert.equal((await api(b,`/conversations/${naturalChat}/messages`)).messages.filter(row=>row.attachment?.sticker).length,1);
    await api(a,`/groups/${naturalChat}/ai-consent`,{
      number:AI_DRAGON_NUMBER,provider:'openai',enabled:true,expectedAccount:'sticker_a',
    });
    const whaleApproval=await send(a,'@鲸鱼娘 发一张点赞贴图');
    const whaleApprovalHash=await assertImage(b,naturalChat,whaleApproval.reply,'whale-approve','鲸鱼娘 · 表示赞同');
    const dragonSurprise=await send(a,'@龙娘 发一张惊讶贴图');
    const dragonSurpriseHash=await assertImage(b,naturalChat,dragonSurprise.reply,'dragon-surprised','龙娘 · 惊讶');
    assert.equal(model.length,beforeQuiet);

    assert.deepEqual(outbound,[]);
    const receipt={directHash,groupHash,automaticHash,dragonAutoHash,model,realProviderRequests:0,roleSpecificImages:true,
      thirdPartySourceNoticeBeforeDirectAndGroupConsent:true,realImageSourceRequests:0,
      explicitLocalSticker:true,capabilityText:true,writtenAndSeriousText:true,controlCodeHidden:true,
      writtenReadback:{direct:written.reply.text,group:groupWritten.reply.text},
      onlineReadback:{direct:online.reply.text,alternate:otherOrder.reply.text,group:groupOnline.reply.text,providerCalls:0},
      naturalGroup:{naturalHash,stickerCount:1,wordsOnly:naturalWritten.reply.text,online:naturalOnline.reply.text,
        humanAddressCalls:0,unconsentedRoleCalls:0,aiRepliesDidNotTriggerAnotherRole:true},
      receivedAssets:{'whale-happy':directHash,'whale-approve':whaleApprovalHash,'whale-surprised':automaticHash,
        'dragon-happy':groupHash,'dragon-approve':dragonAutoHash,'dragon-surprised':dragonSurpriseHash},
      noWrongSubjectFallback:true,persisted:true,memberReceived:true,duplicatePrevented:true,
      groupPermissionAndRevocation:true,removedAndDepartedAccessBlocked:true};
    if(evidence)await fs.writeFile(path.join(evidence,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify(receipt));
  }finally{
    globalThis.fetch=originalFetch;
    release.resolve();
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
    const checked=await fs.realpath(scratch);
    assert.equal(path.dirname(checked),temp);
    assert.match(path.basename(checked),/^arcade-social-sticker-[a-z0-9]{6}$/iu);
    await fs.rm(checked,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
