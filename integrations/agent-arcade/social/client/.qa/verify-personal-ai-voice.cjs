'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {randomUUID}=require('node:crypto');
const {chromium}=require('playwright');
const {SocialStore}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {createAzureVoice}=require('../../server/ai-voice-azure.cjs');
const {createAiVoice}=require('../../server/ai-voice.cjs');
const {validateAiVoice}=require('../../server/voice-upload.cjs');

const output=process.argv[2];
assert(output,'Provide an evidence directory.');
const store=new SocialStore(':memory:');
const azureCalls=[], chatCalls=[], external=[], errors=[];
const spokenLater='纸灯什么时候亮', dropLater='夜游从哪里开始', failLine='春游需要准备什么';
const holds=new Map([spokenLater,dropLater].map(line=>[line,{
  entered:Promise.withResolvers(),release:Promise.withResolvers(),
}]));
const awaitSpeech=hold=>Promise.race([hold.entered.promise,new Promise((_,reject)=>{
  setTimeout(()=>reject(Error('Expected Azure request did not arrive')),8000).unref();
})]);
const speech=createAzureVoice('fixtureeast','fixture-azure-only',{fetchImpl:async(url,options)=>{
  assert.equal(url,'https://fixtureeast.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.equal(options.headers['Ocp-Apim-Subscription-Key'],'fixture-azure-only');
  const [,voice,line]=options.body.match(/<voice name="([^"]+)">([^<]+)<\/voice>/u);
  azureCalls.push({voice,line});
  for(const [phrase,hold] of holds)if(line.includes(phrase)){hold.entered.resolve(options.signal);await hold.release.promise;}
  if(line.includes(failLine))return new Response(null,{status:503});
  const frequency=voice.includes('Yunxi')?550:360;
  const pcm=Buffer.alloc(32000);
  for(let index=0;index<16000;index++)pcm.writeInt16LE(Math.round(1700*Math.sin(2*Math.PI*frequency*index/16000)),index*2);
  return new Response(pcm,{headers:{'Content-Type':'application/octet-stream'}});
}});
const server=createServer(store,{voiceEngine:speech,personalAiFetch:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');
  const owner={'Bearer fixture-chat-a':'a','Bearer fixture-chat-b':'b'}[options.headers.Authorization];
  assert(owner);
  const {input,tools,tool_choice:choice}=JSON.parse(options.body);
  const line=input.at(-1).content;
  assert.deepEqual(input,[{role:'user',content:JSON.stringify({publicGroupCharacter:{
    name:'纸灯',description:'',examples:'',background:[],
  }})},{role:'user',content:line}]);
  assert.deepEqual(tools,[]);
  assert.equal(choice,'none');
  chatCalls.push({owner,line});
  return Response.json({status:'completed',output:[{type:'message',role:'assistant',
    content:[{type:'output_text',text:'收到：'+line}]}]});
}});

const btn=(root,name)=>root.getByRole('button',{name,exact:true});
async function main(){
  await fs.mkdir(output,{recursive:true});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  let browser;
  const result={ok:false};
  try{
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-sync','--proxy-server=http://127.0.0.1:1']});
    async function account(id,width){
      const context=await browser.newContext({viewport:{width,height:820},serviceWorkers:'block'});
      await context.route('**/*',route=>{
        if(route.request().url().startsWith(base+'/'))return route.continue();
        external.push(new URL(route.request().url()).origin);return route.abort();
      });
      const page=await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base);
      await btn(page,'创建账号').click();await page.locator('[name=number]').fill(id);
      await page.locator('[name=displayName]').fill(id);await page.locator('[name=password]').fill(randomUUID());
      await page.locator('#auth-submit').click();await page.locator('#workspace').waitFor();
      async function api(route,data,status=200){
        const response=data===undefined?await context.request.get(base+'/api/v1'+route):
          await context.request.post(base+'/api/v1'+route,{data});
        assert.equal(response.status(),status,route);return response.json();
      }
      return {id,page,context,api};
    }
    const a=await account('personal_voice_a',740),b=await account('personal_voice_b',380);
    const friend=(await a.api('/friend-requests',{number:b.id})).request;
    await b.api('/friend-requests/'+friend.id+'/accept',{});
    const makeRoom=async title=>(await a.api('/groups',{title,memberNumbers:[b.id]})).conversation.id;
    const room=await makeRoom('纸灯交流群'),neighbor=await makeRoom('无语音许可群');
    const roomApi=id=>'/groups/'+id+'/personal-ai';
    const thread=id=>'/conversations/'+id;
    const say=(actor,id,number,text,clientId=randomUUID())=>actor.api(thread(id)+'/messages',{number,text,clientId,mentionAccount:number});
    async function self(actor){
      await actor.page.goto(base);
      await actor.page.getByRole('button',{name:/通讯录/}).click();
      await btn(actor.page,'AI 联系人').click();await btn(actor.page,'我的 AI').click();
    }
    async function bind(actor,key,voice){
      const page=actor.page;await self(actor);
      await page.getByLabel('AI 昵称').fill('纸灯');
      await page.getByLabel('角色与服务').selectOption('arcade_dragon');
      await page.getByLabel('本人的 API key').fill(key);
      await btn(page,'绑定我的 AI').click();
      await btn(page,'选择群 AI 音色').click();
      await page.getByLabel('音色',{exact:true}).selectOption(voice);
      await page.getByText(/好友服务用自己配置的 Azure/).waitFor();
      if(actor===a){
        const preview=page.waitForResponse(response=>response.url().endsWith('/personal-ai/voice/preview'));
        await btn(page,'试听').click();assert.equal((await preview).status(),200);
      }
      await btn(page,'保存音色').click();await page.getByText(/已为纸灯保存音色/).waitFor();
      if(actor===a)await page.screenshot({path:path.join(output,'owner-voice.png')});
      return (await actor.api('/personal-ai')).identity;
    }
    const first=await bind(a,'fixture-chat-a','azure-xiaoxiao'),second=await bind(b,'fixture-chat-b','azure-yunxi');
    assert.notEqual(first.number,second.number);
    await a.api('/personal-ai/voice',{expectedAccount:a.id,number:second.number,voice:'azure-xiaoyi',revision:null},403);
    const row=(view,bot)=>view.roles.find(item=>item.number===bot.number);
    const edit=(actor,id,action,bot,extra={})=>actor.api(roomApi(id),{action,expectedAccount:actor.id,number:bot.number,revision:bot.revision,...extra});
    async function invite(owner,id,bot){
      const pending=row(await edit(owner,id,'invite',bot),bot);
      return row(await edit(a,id,'accept',pending),bot);
    }
    const roleA=await invite(a,room,first),roleB=await invite(b,room,second);
    const neighborB=await invite(b,neighbor,second),neighborA=await invite(a,neighbor,first);
    await edit(a,neighbor,'share',neighborB,{provider:'openai',enabled:true,sharingRevision:null});
    await edit(a,room,'share',roleB,{provider:'openai',enabled:true,sharingRevision:null});
    await edit(b,room,'share',roleA,{provider:'openai',enabled:true,sharingRevision:null});
    await edit(b,neighbor,'share',neighborA,{provider:'openai',enabled:true,sharingRevision:null});
    const before=azureCalls.length;

    async function panel(actor){
      const page=actor.page;
      await page.goto(base+'/#chat/'+room);await page.reload();
      await btn(page,'群成员').click();await btn(page,'群内 AI').click();await btn(page,'成员带来的 AI').click();
    }
    const section=(actor,bot)=>actor.page.locator('#dialog-body .request').filter({hasText:bot.number});
    const voicePath=thread(room)+'/ai-voice';
    const selected=async(actor,bot)=>row(await actor.api(voicePath),bot);
    const choice=await selected(a,second);
    await a.api(voicePath,{expectedAccount:a.id,number:second.number,revision:choice.revision,voice:'azure-xiaoyi'},403);
    async function send(actor,bot,text){
      await panel(actor);
      await btn(section(actor,bot),'@纸灯（AI）').click();
      const page=actor.page;
      assert.match(await page.locator('#message').inputValue(),/^@纸灯/u);
      await page.keyboard.insertText(text);
      const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/messages'));
      await btn(page,'发送').click();
      const sent=await response;
      assert.equal(sent.status(),200);
      assert.equal(sent.request().postDataJSON().mentionAccount,bot.number);
      return sent.json();
    }
    const continuation=(id,message)=>thread(id)+'/messages/'+message.id+'/personal-voice';
    const body=(actor,message,action)=>({action,expectedAccount:actor.id,revision:message.personalVoiceOffer.revision});
    async function continueInChat(actor,message,label){
      const page=actor.page;
      const actions=page.locator('[data-history-message="'+message.id+'"]');
      const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(continuation(room,message)));
      await btn(actions,label).waitFor();
      if(actor===a)await page.screenshot({path:path.join(output,'inline-voice-choice.png')});
      await btn(actions,label).click();const received=await response;
      assert.equal(received.status(),200,await received.text());
      return received.json();
    }
    const requestedB=(await send(a,second,'发个语音，聊聊春游群的安排')).message;
    const queuedB=(await send(a,second,'发个语音，聊聊桥边茶会的安排')).message;
    assert(requestedB.personalVoiceOffer&&queuedB.personalVoiceOffer);
    assert.notEqual(requestedB.id,queuedB.id);
    assert.equal(azureCalls.length,before);
    assert.equal(chatCalls.length,0);
    await b.api(continuation(room,requestedB),body(b,requestedB,'remember'),404);
    assert(!(await b.api(thread(room)+'/messages')).messages.some(m=>m.personalVoiceOffer));
    await a.page.reload();
    const audioB=await continueInChat(a,requestedB,'记住 Azure 选择并继续');
    await a.api(continuation(room,requestedB),body(a,requestedB,'remember'));
    assert.equal(azureCalls.length,before+1);
    await a.page.reload();
    const audioQueued=await continueInChat(a,queuedB,'仅本群允许并继续');
    assert.equal(audioQueued.reply.sender.number,second.number);
    assert.equal(audioQueued.reply.attachment?.type,'voice');
    assert.match(azureCalls.at(-1).line,/桥边茶会/u);
    await a.api(continuation(room,queuedB),body(a,queuedB,'room'));
    assert.equal(azureCalls.length,before+2);
    assert.deepEqual(store.all('SELECT prompt,reply FROM ai_group_reply_links WHERE prompt IN (?,?) ORDER BY prompt',
      requestedB.id,queuedB.id).map(({prompt,reply})=>[prompt,reply]),[
      [requestedB.id,audioB.reply.id],[queuedB.id,audioQueued.reply.id],
    ]);
    const requestedA=(await send(b,first,'发个语音，跟大家说早安')).message;
    assert(requestedA.personalVoiceOffer);
    const audioA=await continueInChat(b,requestedA,'仅本群允许并继续');
    assert.equal(audioB.reply.sender.number,second.number);assert.equal(audioA.reply.sender.number,first.number);
    assert.equal(audioB.reply.attachment?.type,'voice',audioB.reply.text);
    assert.equal(audioA.reply.attachment?.type,'voice',audioA.reply.text);
    const riff=async(actor,message)=>{
      const response=await actor.context.request.get(base+'/api/v1'+thread(room)+'/messages/'+message.id+'/voice',
        {headers:{'X-Social-Account':actor.id}});
      assert.equal(response.status(),200);assert.equal(response.headers()['content-type'],'audio/wav');
      const bytes=await response.body();assert.equal(validateAiVoice(bytes).durationMs,1000);return bytes;
    };
    assert.notDeepEqual(await riff(b,audioB.reply),await riff(a,audioA.reply));
    await b.page.goto(base+'/#chat/'+room);await b.page.reload();
    const play=b.page.locator('#history').getByRole('button',{name:/播放语音/}).first();
    const playing=b.page.waitForResponse(response=>response.url().endsWith('/messages/'+audioB.reply.id+'/voice'));
    await play.click();
    assert.equal((await playing).status(),200);
    await b.page.locator('#history').getByRole('button',{name:/暂停语音/}).first().waitFor();
    await b.page.screenshot({path:path.join(output,'group-playback.png')});
    assert.deepEqual(azureCalls.slice(before).map(c=>c.voice),['zh-CN-YunxiNeural','zh-CN-YunxiNeural','zh-CN-XiaoxiaoNeural']);

    const written=await say(a,room,second.number,'只发文字，别发语音：如何安排春游？');
    assert.equal(written.reply.sender.number,second.number);assert(!written.reply.attachment);
    assert.equal(azureCalls.length,before+3);

    const failId=randomUUID();
    const failed=await say(a,room,second.number,'发个语音，聊聊'+failLine,failId);
    assert.match(failed.reply.text,/这次语音暂时无法生成/u);assert(!failed.reply.attachment);
    const afterFail=azureCalls.length;
    await say(a,room,second.number,'发个语音，聊聊'+failLine,failId);
    assert.equal(azureCalls.length,afterFail);
    async function scope(actor,bot,allowed,id=room,action='scope'){
      const route=thread(id)+'/ai-voice', v=row(await actor.api(route),bot);
      return actor.api(route,{expectedAccount:actor.id,action,number:bot.number,allowed,
        revision:v.revision,scopeRevision:v.scopeRevision,defaultRevision:v.defaultRevision,pauseRevision:v.pauseRevision});
    }
    const inherited=await say(a,neighbor,second.number,'发个语音，聊聊郊游的路线');
    assert.equal(inherited.reply?.attachment?.type,'voice',inherited.reply?.text);
    await scope(a,second,false,neighbor);
    const paused=await say(a,neighbor,second.number,'发个语音');
    assert(!paused.message.personalVoiceOffer);assert(!paused.reply.attachment);
    const otherAccount=await say(b,neighbor,first.number,'发个语音');
    assert(otherAccount.message.personalVoiceOffer);
    const otherText=await b.api(continuation(neighbor,otherAccount.message),body(b,otherAccount.message,'text'));
    assert.equal(otherText.reply.sender.number,first.number);assert(!otherText.reply.attachment);
    const cancelRoom=await makeRoom('撤回待续语音对照群');
    const cancelA=await invite(a,cancelRoom,first);
    await edit(b,cancelRoom,'share',cancelA,{provider:'openai',enabled:true,sharingRevision:null});
    const dropped=(await say(b,cancelRoom,first.number,'发个语音，聊聊海边值班')).message;
    assert(dropped.personalVoiceOffer);
    await scope(b,first,false,cancelRoom);
    await scope(b,first,true,cancelRoom);
    await b.api(continuation(cancelRoom,dropped),body(b,dropped,'remember'),409);
    const stale=(await say(b,neighbor,first.number,'发个语音，聊聊备用路线')).message;
    assert(stale.personalVoiceOffer);
    const beforeStale=azureCalls.length;
    await edit(a,neighbor,'remove',neighborA);
    await b.api(continuation(neighbor,stale),body(b,stale,'remember'),409);
    await b.api('/groups/'+neighbor+'/leave',{});
    await b.api(continuation(neighbor,stale),body(b,stale,'remember'),404);
    assert.equal(azureCalls.length,beforeStale);

    await scope(a,second,false,room,'personal-default');
    const stopped=await say(a,room,second.number,'发个语音');
    assert(!stopped.message.personalVoiceOffer);assert(!stopped.reply.attachment);
    await scope(a,second,true,room,'personal-default');
    const later=holds.get(spokenLater);
    const pending=say(a,room,second.number,'发个语音，聊聊'+spokenLater);
    const signal=await awaitSpeech(later);
    await scope(a,second,false);assert.equal(signal.aborted,true);await scope(a,second,true);
    later.release.resolve();
    const retained=await pending;
    assert.equal(retained.reply.sender.number,second.number);assert(!retained.reply.attachment);
    const end=holds.get(dropLater);
    const request=say(a,room,second.number,'发个语音，聊聊'+dropLater);
    await awaitSpeech(end).then(async signal=>{
      const current=(await b.api('/personal-ai')).identity;
      await b.api('/personal-ai',{expectedAccount:b.id,action:'withdraw',revision:current.revision});
      assert.equal(signal.aborted,true);
    });
    end.release.resolve();
    assert.equal((await request).reply,undefined);
    const messages=(await b.api(thread(room)+'/messages')).messages;
    assert.equal(messages.filter(item=>item.attachment?.type==='voice').length,3);
    const clean=(await a.api(thread(neighbor)+'/messages')).messages;
    assert.equal(clean.filter(item=>item.attachment?.type==='voice').length,1);
    assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
    assert(chatCalls.some(c=>c.owner==='a'&&c.line.includes('早安')));
    assert(chatCalls.some(c=>c.owner==='b'&&c.line.includes('春游群')));
    const noAzure=createAiVoice(store);
    assert.deepEqual(noAzure.ownerView(a.id,{number:first.number,voiceOwner:a.id}),{voices:[],roles:[]});
    const unconfigured=await noAzure.reply({
      bot:{number:first.number,displayName:'纸灯'},chat:room,human:b.id,input:'发个语音',
      personal:{role:first.role,owner:a.id,saved:noAzure.selection(room,b.id,first.number,a.id)},
    },()=>assert.fail('The unconfigured media notice does not need a model call'));
    assert.match(unconfigured.text,/没有可用的云语音/u);
    const otherProvider=createAiVoice(store,{voices:[{id:'other-cloud',remote:true}]});
    assert.equal(otherProvider.selection(room,a.id,second.number,b.id).allowed,false);
    assert.deepEqual(otherProvider.ownerView(a.id,{number:first.number,voiceOwner:a.id}).voices,[]);
    Object.assign(result,{ok:true,roleNumbers:[first.number,second.number],azureCalls,chatCalls,
      originalGroupAudio:3,neighborAudio:1,recipientPlayback:audioB.reply.id,voiceOnlyRevocationKeptText:true,ownerWithdrawalDroppedTurn:true,
      independentOffers:[{prompt:requestedB.id,reply:audioB.reply.id,retryAddedAudio:0},
        {prompt:queuedB.id,reply:audioQueued.reply.id,retryAddedAudio:0}],pausedOfferStayedRevoked:true,
      inChatAuthorContinuation:true,groupPauseOverride:true,accountDefaultOverride:true,repeatContinuationDeduped:true,
      roleRemovalAndLeaveBlockedOldOffer:true,otherProviderNotAuthorized:true,unconfiguredVoiceFallsBack:true,external,errors});
  }catch(error){
    result.error=error.message;
    throw error;
  }finally{
    for(const hold of holds.values())hold.release.resolve();
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(result,null,2)+'\n');
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
