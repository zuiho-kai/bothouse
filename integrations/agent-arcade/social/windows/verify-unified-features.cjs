'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {setTimeout:wait}=require('node:timers/promises');

function createAiFixture(scratch) {
  const file=path.join(scratch,'mock-providers.cjs');
  const log=path.join(scratch,'synthetic-model-calls.jsonl');
  const speechLog=path.join(scratch,'synthetic-speech-calls.jsonl');
  const release=path.join(scratch,'release-first-reply');
  fs.writeFileSync(file,`
'use strict';
const fs=require('node:fs');
const wait=require('node:timers/promises').setTimeout;
globalThis.fetch=async (url,options)=>{
  const endpoint=String(url);
  if(endpoint==='https://fixture.tts.speech.microsoft.com/cognitiveservices/v1'){
    if(options.headers['Ocp-Apim-Subscription-Key']!=='synthetic-speech-key'||options.redirect!=='error')throw Error('Unexpected speech fixture request');
    fs.appendFileSync(${JSON.stringify(speechLog)},JSON.stringify({body:options.body})+'\\n');
    const pcm=Buffer.alloc(31*32000);
    pcm.writeInt16LE(440);
    return new Response(pcm,{headers:{'Content-Type':'application/octet-stream'}});
  }
  const openai=endpoint==='https://api.openai.com/v1/responses';
  const valid=(openai&&options.headers.Authorization==='Bearer synthetic-store-openai-key')||
    (endpoint==='https://api.deepseek.com/chat/completions'&&options.headers.Authorization==='Bearer synthetic-store-key');
  if(!valid)throw new Error('Unexpected outbound request');
  const payload=JSON.parse(options.body);
  const prompt=openai?payload.input.at(-1).content:payload.messages.at(-1).content;
  fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({prompt,provider:openai?'openai':'deepseek'})+'\\n');
  if(openai)return Response.json({status:'completed',output:[{type:'message',role:'assistant',status:'completed',
    content:[{type:'output_text',text:'合成龙娘：'+prompt}]}]});
  if(prompt==='首轮合成模型请求'){
    for(let i=0;i<200&&!fs.existsSync(${JSON.stringify(release)});i++)await wait(40);
    if(!fs.existsSync(${JSON.stringify(release)}))throw new Error('Test release was never signaled');
  }
  return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'合成回复：'+prompt}}]});
};
`);
  const calls=()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse):[];
  const speechCalls=()=>fs.existsSync(speechLog)?fs.readFileSync(speechLog,'utf8').trim().split('\n').map(JSON.parse):[];
  return {file,release,calls,speechCalls,count:()=>calls().length};
}

async function verifyUnifiedFeatures({a,b,ca,scratch,serviceRoot,payload,evidence,guest,until,launch,authReady,close,send,history,voiceUploads,restartWithAi}) {
  const checks={};
  const click=(client,name)=>guest(client,`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(name)}).click()`);
  const clickChatSetting=async(client,name)=>{
    await guest(client,`document.querySelector('#chat-settings-toggle:not([hidden])')?.click()`);
    await click(client,name);
  };
  const buttonPresent=(client,name)=>guest(client,`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()===${JSON.stringify(name)})`);
  async function login(client,number){
    await authReady(client);
    await guest(client,`document.querySelector('[name=number]').value=${JSON.stringify(number)};
      document.querySelector('[name=password]').value='synthetic-https-only';
      document.querySelector('#auth-submit').click()`);
    await until(()=>guest(client,'!document.querySelector("#workspace").hidden'),'second authenticated page');
  }
  const activeHash=client=>guest(client,'location.hash');
  const hasText=(client,selector,text)=>guest(client,`document.querySelector(${JSON.stringify(selector)})?.textContent.includes(${JSON.stringify(text)})`);
  const openRow=async (client,name)=>{
    const row=`[...document.querySelectorAll('#directory-body button')].find(e=>e.textContent.includes(${JSON.stringify(name)}))`;
    await until(()=>guest(client,'!!'+row),'directory row '+name);
    await guest(client,row+'.click()');
    await until(()=>hasText(client,'#chat-title',name),'opened '+name);
  };
  const report=async(client,text)=>{
    await guest(client,`{
      const bubble=[...document.querySelectorAll('#history article')].find(e=>e.textContent.includes(${JSON.stringify(text)}));
      const trigger=bubble.querySelector('.message-action-trigger');
      if(trigger){
        trigger.click();
        document.querySelector('#report-message').click();
      }else bubble.querySelector('.report-action').click();
    }`);
    await until(()=>hasText(client,'#dialog blockquote',text),'report excerpt');
  };

  await guest(a,"document.querySelector('[data-tab=contacts]').click()");
  await click(a,'AI 联系人');
  await until(()=>hasText(a,'#dialog','目前没有开放的 AI 联系人。'),'no-key AI catalog');
  await click(a,'关闭');
  await click(a,'消息');
  await openRow(a,'加密乙');
  checks.humanDirectWithoutKey=true;

  const moderate=(action,id)=>JSON.parse(execFileSync(process.execPath,[
    path.join(serviceRoot,'server','moderate.cjs'),action,...(id?[id]:[]),
  ],{env:{...process.env,SOCIAL_DB:path.join(scratch,'synthetic.sqlite')},windowsHide:true,encoding:'utf8'}));

  async function reportThenRemove(sender,reader,text) {
    await send(sender,text);
    try {
      await until(()=>history(sender,text),'sender can see submitted report target');
      await until(()=>history(reader,text),'peer can see report target');
    }catch(error){
      const state=await Promise.all([sender,reader].map(client=>guest(client,
        '({hash:location.hash,hidden:document.hidden,history:document.querySelector("#history").textContent,sendError:document.querySelector("#send-error").textContent,sync:document.querySelector("#sync-status").textContent})')));
      throw new Error(error.message+' '+JSON.stringify(state),{cause:error});
    }
    await report(reader,text);
    await guest(reader,`document.querySelector('#report-reason').value='合成举报原因'`);
    await click(reader,'提交举报');
    await until(()=>hasText(reader,'#dialog','举报回执'),'report receipt');
    const rows=moderate('list');
    assert.equal(rows.length,1);
    assert.equal(rows[0].reportedText,text);
    const before=await Promise.all([activeHash(sender),activeHash(reader)]);
    assert.equal(moderate('remove',rows[0].id).status,'removed');
    for(const client of [sender,reader]){
      await until(async()=>await history(client,'[已移除]')&&!await history(client,text),'automatic moderation refresh');
    }
    assert.deepEqual(await Promise.all([activeHash(sender),activeHash(reader)]),before);
    await until(()=>guest(reader,'!document.querySelector("#dialog").open'),'removed excerpt dialog closes');
  }

  checks.imageSave=await require('./verify-unified-images.cjs').verifyImages({
    a,b,guest,until,scratch,click,openRow,hasText,moderate,activeHash,wait,
  });
  await reportThenRemove(a,b,'待撤下的合成私聊');
  checks.openDirectPagesUpdated=2;
  await click(a,'发起群聊');
  await guest(a,`document.querySelector('#dialog [name=title]').value='回环合成群';
    document.querySelector('#dialog input[value=tls_bravo]').click()`);
  await click(a,'创建群聊');
  await until(()=>hasText(a,'#chat-title','回环合成群'),'group created without AI key');
  await click(b,'消息');
  await openRow(b,'回环合成群');
  await reportThenRemove(a,b,'待撤下的合成群消息');
  checks.openGroupPagesUpdated=2;
  checks.humanGroupWithoutKey=true;

  const staleHash=await activeHash(b);
  await send(a,'跨页退群后必须消失的摘录');
  await until(()=>history(b,'跨页退群后必须消失的摘录'),'member receives excerpt');
  await report(b,'跨页退群后必须消失的摘录');
  const second=await launch('bravo-second-page',ca);
  await login(second,'tls_bravo');
  await openRow(second,'回环合成群');
  await click(second,'群成员');
  await click(second,'退出群聊');
  await click(second,'确认退出');
  await until(()=>guest(b,`!location.hash&&!document.querySelector('#dialog').open&&!document.querySelector('#history').textContent`),'the other page revoked group excerpt');
  const id=staleHash.split('/').at(-1);
  const inaccessible=await guest(second,`Promise.all([
    fetch('/api/v1/conversations/'+${JSON.stringify(id)}+'/messages').then(r=>r.status),
    fetch('/api/v1/groups/'+${JSON.stringify(id)}+'/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status)])`);
  assert.deepEqual(inaccessible,[404,404]);
  assert(await history(a,'跨页退群后必须消失的摘录'));
  await close(second);
  checks.otherGroupPageCleared=true;

  const settings=await launch('store-settings');
  await settings.page.getByRole('button',{name:'重试',exact:true}).waitFor({timeout:15000});
  if(!await settings.page.locator('#ws-companion').isVisible())await settings.page.locator('#store-more').click();
  await settings.page.locator('#ws-companion').click();
  await settings.page.locator('button[data-view=settings]:visible').first().click();
  await settings.page.locator('#app-update-panel').waitFor({timeout:10000});
  await settings.page.locator('#app-update-panel').scrollIntoViewIfNeeded();
  const appVersion=JSON.parse(fs.readFileSync(path.join(payload,'package.json'),'utf8')).version;
  assert.equal(await settings.page.locator('#app-update-version').textContent(),'当前版本：'+appVersion);
  assert.match(await settings.page.locator('#app-update-status').textContent(),/没有正式商店身份/u);
  assert.equal(await settings.page.locator('#app-update-check').isDisabled(),true);
  checks.storeUpdateVisibleWithTestIdentityStatus=true;
  fs.mkdirSync(evidence,{recursive:true});
  const pristine=await settings.page.locator('#app-update-panel').innerText();
  await settings.app.evaluate(({BrowserWindow,ipcMain},location)=>{
    const {createRequire}=process.getBuiltinModule('module');
    const path=process.getBuiltinModule('path');
    const requirePackage=createRequire(path.join(location.payload,'package.json'));
    const {createStoreUpdate}=requirePackage('./src/core/store-app-update.cjs');
    const w=BrowserWindow.getAllWindows()[0],contents=w.webContents;
    const trustedUrl=contents.getURL();
    const sequence=[{action:0,status:2},{action:0,status:3},{action:1,status:5},{action:0,status:7}];
    const update=createStoreUpdate({
      version:location.version,enabled:true,getWindow:()=>w,isClosing:()=>false,
      openExternal:async uri=>{
        if(uri!=='ms-windows-store://downloadsandupdates')throw new Error('Unexpected Store URI');
      },
      loadNative:()=>({begin(hwnd,action){
        const step=sequence.shift();
        if(!Buffer.isBuffer(hwnd)||!hwnd.some(Boolean)||step?.action!==action)
          throw new Error('Unexpected native update call');
        return step.status;
      }}),
      notify:state=>contents.send('arcade:appUpdate',state),
    });
    for(const [name,handler] of [['appUpdateCheck',update.check],['appUpdateStart',update.start],['appUpdateOpenStore',update.openStore]]){
      const channel='arcade:'+name;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel,event=>{
        if(event.sender!==contents||event.senderFrame!==contents.mainFrame||event.senderFrame.url!==trustedUrl)
          throw new Error('Untrusted sender');
        return handler();
      });
    }
    contents.send('arcade:appUpdate',update.state());
  },{payload,version:appVersion});
  const updateStatus=settings.page.locator('#app-update-status');
  const updateCheck=settings.page.locator('#app-update-check');
  const states=[];
  for(const [control,copy] of [
    [updateCheck,'当前没有提供新版'],
    [updateCheck,'Microsoft Store 有新版'],
    [settings.page.locator('#app-update-apply'),'已取消更新'],
    [updateCheck,'连上 Wi-Fi'],
    [settings.page.locator('#app-update-open-store'),'已请求打开商店更新页'],
  ]){
    await control.click();
    await updateStatus.filter({hasText:copy}).waitFor({timeout:10000});
    states.push(await updateStatus.innerText());
  }
  fs.writeFileSync(path.join(evidence,'store-update-settings.json'),JSON.stringify({pristine,states},null,2));
  checks.storeUpdateSystemFixture=['current','available','cancelled','network','store_opened'];
  await close(settings);

  const ai=createAiFixture(scratch);
  await restartWithAi(ai.file);
  await guest(a,"document.querySelector('[data-tab=contacts]').click()");
  await click(a,'AI 联系人');
  await until(()=>hasText(a,'#dialog','鲸鱼娘'),'AI in address book');
  assert.equal(ai.count(),0);
  await click(a,'关闭');
  assert.equal(ai.count(),0);
  await click(a,'AI 联系人');
  await until(()=>buttonPresent(a,'同意并开始私聊'),'explicit consent');
  await click(a,'同意并开始私聊');
  await until(()=>hasText(a,'#chat-title','鲸鱼娘'),'AI direct chat');
  const otherAiPage=await launch('alpha-second-page',ca);
  await login(otherAiPage,'tls_alpha');
  await openRow(otherAiPage,'鲸鱼娘');
  await send(a,'首轮合成模型请求');
  await until(()=>ai.count()===1,'provider starts one round');
  await send(otherAiPage,'正在等待时的第二条');
  await until(()=>hasText(otherAiPage,'#send-error','正在等 AI 回复'),'friendly busy error');
  fs.writeFileSync(ai.release,'ok');
  await until(()=>history(a,'合成回复：首轮合成模型请求'),'actual synthetic AI reply');
  await close(otherAiPage);
  for(let n=2;n<=12;n++){
    await send(a,'合成额度测试 '+n);
    await until(()=>history(a,'合成回复：合成额度测试 '+n),'mock reply '+n);
  }
  await send(a,'达到今日上限');
  await until(()=>hasText(a,'#send-error','今天的 AI 聊天次数已用完'),'friendly daily limit error');
  assert.equal(ai.count(),12);
  checks.aiConsentAndPrivateReply=true;
  checks.aiErrors=['ai_busy','ai_daily_limit'];
  checks.syntheticModelRequests=12;
  await clickChatSetting(a,'关闭云聊天');
  await click(a,'确认关闭');
  await until(()=>hasText(a,'#chat-detail','云聊天已关闭'),'private cloud chat disabled');
  assert(await guest(a,'document.querySelector("#message").readOnly'));
  assert(await history(a,'合成回复：首轮合成模型请求'));
  checks.directCloudDisabledHistoryRetained=true;

  await click(a,'消息');
  await click(a,'发起群聊');
  await guest(a,`document.querySelector('#dialog [name=title]').value='双服务合成群';
    document.querySelector('#dialog input[value=tls_bravo]').click()`);
  await click(a,'创建群聊');
  await until(()=>hasText(a,'#chat-title','双服务合成群'),'created AI group');
  await click(b,'消息');
  await openRow(b,'双服务合成群');

  async function groupAi(client){
    await click(client,'群成员');
    await click(client,'群内 AI');
    await until(()=>hasText(client,'#dialog','云传输与撤回说明'),'provider privacy disclosure');
  }
  await groupAi(a);
  await click(a,'加入鲸鱼娘（DeepSeek）');
  await until(()=>buttonPresent(a,'同意发给 DeepSeek'),'Whale joined with no default consent');
  await click(a,'加入龙娘（OpenAI）');
  await until(()=>buttonPresent(a,'同意发给 OpenAI（GPT）'),'Dragon joined with no default consent');
  await click(a,'同意发给 DeepSeek');
  await until(()=>buttonPresent(a,'停止发给 DeepSeek'),'owner consent is scoped to one provider');
  await click(a,'@鲸鱼娘（AI）');
  await send(a,'包内群聊由鲸鱼娘答');
  await until(()=>history(b,'合成回复：包内群聊由鲸鱼娘答'),'DeepSeek group reply');

  await groupAi(b);
  assert(await buttonPresent(b,'同意发给 DeepSeek'));
  await click(b,'同意发给 OpenAI（GPT）');
  await until(()=>buttonPresent(b,'停止发给 OpenAI（GPT）'),'member consent is scoped to OpenAI');
  await click(b,'@龙娘（AI）');
  await send(b,'包内群聊由龙娘答');
  await until(()=>history(a,'合成龙娘：包内群聊由龙娘答'),'OpenAI group reply');

  await groupAi(b);
  await click(b,'停止发给 OpenAI（GPT）');
  await until(()=>buttonPresent(b,'同意发给 OpenAI（GPT）'),'member withdrew OpenAI');
  await click(b,'关闭');
  await click(b,'群成员');
  await click(b,'@龙娘（AI）');
  await send(b,'撤回后仅发群消息');
  await until(()=>history(a,'撤回后仅发群消息'),'withdrawn user can still use human group');
  await groupAi(a);
  await click(a,'@鲸鱼娘（AI）');
  await send(a,'发一张开心贴图');
  const stickerImage=`[...document.querySelectorAll('#history img')].find(img=>img.alt==='鲸鱼娘 · 开心地笑')`;
  await until(()=>guest(b,`(${stickerImage})?.naturalWidth===256`),'new group member received the packaged role sticker');
  const bytes=await guest(b,`(async()=>Array.from(new Uint8Array(await (await fetch((${stickerImage}).src)).arrayBuffer())))()`);
  assert.deepEqual(Buffer.from(bytes),fs.readFileSync(path.join(serviceRoot,'assets','stickers','whale-happy.png')));
  await guest(b,`(${stickerImage}).closest('[data-image-id]').click()`);
  await until(()=>hasText(b,'#dialog','Agent Arcade 原创素材'),'role sticker attribution');
  await click(b,'关闭');
  const photoUrl=await guest(b,`(${stickerImage}).src`);

  const cameraAndMic=await guest(a,`(async()=>{
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:true});stream.getTracks().forEach(track=>track.stop());return 'granted';}
    catch(error){return error.name;}
  })()`);
  assert.equal(cameraAndMic,'NotAllowedError');
  await guest(a,`(()=>{
    const create=URL.createObjectURL;
    URL.createObjectURL=function(value){
      const url=create.call(this,value);
      if(value.type==='audio/wav')window.qaRecordedVoice={url,value};
      return url;
    };
  })()`);
  await click(a,'录音');
  await until(()=>hasText(a,'#dialog','录音中'),'native host microphone from the active chat');
  await wait(1900);
  await click(a,'停止录音');
  await until(()=>guest(a,`document.querySelector('#dialog audio')?.duration>1`),'local WAV preview');
  assert.equal(voiceUploads.length,0);
  const voice=Buffer.from(await guest(a,`(async()=>{
    const recorded=window.qaRecordedVoice;
    if(recorded?.url!==document.querySelector('#dialog audio').src)throw Error('Recorded blob is not the active preview');
    return Array.from(new Uint8Array(await recorded.value.arrayBuffer()));
  })()`));
  await click(a,'发送语音');
  const voiceButton=`document.querySelector('#history [data-voice-id]')`;
  await until(()=>guest(b,`!!${voiceButton}`),'mixed group voice reached the second client');
  assert.equal(voiceUploads.length,1);
  const voiceUrl=await guest(b,`'/api/v1/conversations/'+location.hash.slice(6)+'/messages/'+(${voiceButton}).dataset.voiceId+'/voice'`);
  await guest(b,`${voiceButton}.click()`);
  await until(()=>guest(b,`document.querySelector('#inline-voice-audio')?.currentTime>0.12&&!document.querySelector('#dialog').open`),
    'decoded inline playback without a modal');
  const voiceBytes=await guest(b,`(async()=>Array.from(new Uint8Array(await (await fetch(${JSON.stringify(voiceUrl)},
    {headers:{'X-Social-Account':'tls_bravo'}})).arrayBuffer())))()`);
  assert.deepEqual(Buffer.from(voiceBytes),voice);
  await clickChatSetting(a,'AI 音色');
  await until(()=>guest(a,`!!document.querySelector('#dialog select[aria-label="音色"] option[value="azure-xiaoxiao"]')`),'role speech options');
  await guest(a,`(()=>{const list=document.querySelector('#dialog select[aria-label="音色"]');
    list.value='azure-xiaoxiao';list.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click(a,'保存音色');
  await until(()=>hasText(a,'#dialog','已为鲸鱼娘保存音色'),'role voice saved');
  await click(a,'允许本会话语音');
  await until(()=>hasText(a,'#dialog','本会话已允许使用当前音色'),'role voice scoped to the active group');
  await click(a,'关闭');
  await groupAi(a);
  await click(a,'@鲸鱼娘（AI）');
  const speechPrompt='用语音回复：确认包内语音';
  await send(a,speechPrompt);
  const aiVoiceButton=`[...document.querySelectorAll('#history [data-voice-id]')].at(-1)`;
  await until(()=>guest(b,`document.querySelectorAll('#history [data-voice-id]').length===2`),'role voice reached the other group member');
  await guest(b,`(${aiVoiceButton}).click()`);
  await until(()=>guest(b,`(()=>{const audio=document.querySelector('#inline-voice-audio');
    return audio?.currentTime>0.12&&audio.duration===31&&!document.querySelector('#dialog').open;})()`),'role voice plays in the same inline player');
  assert.equal(ai.speechCalls().length,1);
  assert(ai.speechCalls()[0].body.includes('>合成回复：'+speechPrompt+'</voice>'));
  await click(b,'群成员');
  await click(b,'退出群聊');
  await click(b,'确认退出');
  await until(()=>guest(b,`!document.querySelector('#inline-voice-audio')&&!location.hash`),'leaving the mixed group stopped playback');
  assert.deepEqual(await guest(b,`Promise.all([
    fetch(${JSON.stringify(voiceUrl)},{headers:{'X-Social-Account':'tls_bravo'}}).then(r=>r.status),
    fetch(${JSON.stringify(photoUrl)}).then(r=>r.status),
  ])`),[404,404]);
  assert.deepEqual(ai.calls().slice(12),[
    {prompt:'包内群聊由鲸鱼娘答',provider:'deepseek'},
    {prompt:'包内群聊由龙娘答',provider:'openai'},
    {prompt:speechPrompt,provider:'deepseek'},
  ]);
  checks.groupProviders=['deepseek','openai'];
  checks.groupConsentIsPerAccountAndProvider=true;
  checks.groupSticker={receivedPixels:256,byteMatchesServiceAsset:true,attributionVisible:true};
  checks.mixedGroupVoice={fakeMicRecordedFromChat:true,cameraAndMicRejected:true,beforeSendUploads:0,playedInline:true,
    originalBytesMatch:true,stopsOnLeave:true,voiceAndPhotoAfterLeave:[404,404]};
  checks.roleVoice={durationSeconds:31,playedInline:true,originalReplyUsed:true,syntheticSpeechRequests:1};
  checks.syntheticModelRequests=ai.count();
  return checks;
}

module.exports={verifyUnifiedFeatures};
