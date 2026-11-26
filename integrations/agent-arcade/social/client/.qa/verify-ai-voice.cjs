'use strict';

const {clickChatSetting}=require('./chat-controls.cjs');

const assert=require('node:assert/strict');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {SocialStore,AI_NUMBER,AI_DRAGON_NUMBER}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {createVoiceEngine,voiceCatalog}=require('../../server/ai-voice-engine.cjs');
const {createAzureVoice}=require('../../server/ai-voice-azure.cjs');
const {createAiVoice}=require('../../server/ai-voice.cjs');
const {validateAiVoice}=require('../../server/voice-upload.cjs');
const {makeBackup}=require('../../deploy/backup.cjs');

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const btn=(page,name)=>page.getByRole('button',{name,exact:true});
const paragraph='先把明天要做的事情按重要程度列出来。先做一件最重要的事，给它留出完整的时间。完成以后休息几分钟，再看剩下的任务。时间不够就把可延后的事移到第二天，记得留一点余量。';
const longDraft=paragraph.repeat(4);
const slowDraft=paragraph.repeat(2);
const factDraft='请听好现场安排。周五 19:10 后可以到场，须确认，周四不开放。联系人叫林冬，甲 & 乙都要先报名字。入口在东门，到时先在等候区集合，工作人员会分批带大家进去。如果临时到不了，先告知联系人，之后再约时间。同行的人也要分别确认，不用提前排队。请把这个安排告诉同行的人，以免他们走错入口或白跑一趟。';
const wrongDraft='周四 18:00 就可以直接入场，无需确认。';
const title='AI 合成语音验收群';

async function register(browser,origin,number){
  const context=await browser.newContext({baseURL:origin,viewport:{width:440,height:860},serviceWorkers:'block'});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page=await context.newPage();
  await page.goto(origin);
  await btn(page,'创建账号').click();
  await page.locator('[name=number]').fill(number);
  await page.locator('[name=displayName]').fill(number);
  await page.locator('[name=password]').fill('synthetic-voice-password');
  await page.locator('#auth-submit').click();
  await page.locator('#directory-title').getByText('消息',{exact:true}).waitFor();
  return page;
}
async function api(page,route,data,status=200){
  const response=await page.request.fetch('/api/v1'+route,{method:data===undefined?'GET':'POST',data});
  assert.equal(response.status(),status);
  return response.json();
}
async function send(page,text){
  const result=page.waitForResponse(row=>row.request().method()==='POST'&&row.url().endsWith('/messages'));
  await page.locator('#message').fill(text);
  await btn(page,'发送').click();
  const response=await result;
  assert.equal(response.status(),200);
  return response.json();
}
async function readVoice(page,chat,reply,account,exportFile){
  assert.equal(reply.attachment?.type,'voice');
  const url=`/api/v1/conversations/${chat}/messages/${reply.id}/voice`;
  const response=await page.request.get(url,{headers:{'X-Social-Account':account}});
  assert.equal(response.status(),200);
  const bytes=await response.body();
  assert.equal(validateAiVoice(bytes).durationMs,reply.attachment.durationMs);
  if(exportFile)await fs.writeFile(exportFile,bytes);
  return {id:reply.id,sha:sha(bytes),durationMs:reply.attachment.durationMs,url};
}
async function choose(page,role,voice,listen=false,enable=true){
  await clickChatSetting(page,'AI 音色');
  const dialog=page.locator('#dialog');
  await dialog.getByLabel('角色',{exact:true}).selectOption(role);
  await dialog.getByLabel('音色',{exact:true}).selectOption(voice);
  if(listen){
    await btn(page,'试听').click();
    await dialog.locator('audio').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#dialog audio').duration>0);
  }
  await btn(page,'保存音色').click();
  await dialog.getByText(/已为.*保存音色/u).waitFor({state:'visible'});
  if(enable&&await btn(page,'允许本会话语音').isVisible()){
    await btn(page,'允许本会话语音').click();
    await dialog.getByText('本会话已允许使用当前音色。',{exact:true}).waitFor();
  }
  await btn(page,'关闭').click();
}

async function main(){
  assert(process.env.SOCIAL_ESPEAK,'Set SOCIAL_ESPEAK to the local eSpeak NG executable');
  const target=process.argv[2]&&path.resolve(process.argv[2]);
  if(target)await fs.mkdir(target,{recursive:true});
  const temp=await fs.realpath(os.tmpdir());
  const scratch=await fs.mkdtemp(path.join(temp,'arcade-ai-voice-'));
  const store=new SocialStore(path.join(scratch,'qa.sqlite'));
  const real=createVoiceEngine(process.env.SOCIAL_ESPEAK);
  const localWire=[],remoteWire=[],chatWire=[];
  const changing=Promise.withResolvers(),changed=Promise.withResolvers();
  const cancelling=Promise.withResolvers(),cancelled=Promise.withResolvers();
  const backupTone={
    ...real,render(text,id,signal){localWire.push({text,id});return real.render(text,id,signal);},
  };
  const azure=createAzureVoice('australiaeast','synthetic-no-billing',{
    fetchImpl:async (url,init)=>{
      assert.equal(url,'https://australiaeast.tts.speech.microsoft.com/cognitiveservices/v1');
      assert.equal(init.headers['Ocp-Apim-Subscription-Key'],'synthetic-no-billing');
      assert.equal(init.headers['X-Microsoft-OutputFormat'],'raw-16khz-16bit-mono-pcm');
      const [,speaker,text]=/name="([^"]+)">([^<]*)<\/voice>/u.exec(init.body);
      remoteWire.push({speaker,text});
      if(text.includes('服务失败'))return new Response(null,{status:429});
      if(text.includes('等换音色')){changing.resolve();await changed.promise;}
      if(text.includes('等撤回授权')){cancelling.resolve();await cancelled.promise;}
      const audio=await real.render(text.replaceAll('&amp;','&'),real.voices[0].id,init.signal);
      return new Response(audio.subarray(44),{headers:{'Content-Type':'audio/pcm'}});
    },
  });
  const textModel={provider:'deepseek',name:'鲸鱼娘',groupRoles:[{number:AI_NUMBER,name:'鲸鱼娘'}],
    async generate(rows,options){
      const input=rows.at(-1).content;
      chatWire.push({input,group:!!options.groupRole});
      if(options.replyHint.includes('改成一条')||input.startsWith('{"reply":'))return wrongDraft;
      if(input.includes('超长原回复'))return longDraft;
      if(input.includes('朗读会超时'))return slowDraft;
      if(input.includes('超出资源界限'))return paragraph.repeat(6);
      if(input.includes('现场安排'))return factDraft;
      if(input.includes('换音色'))return '等换音色，原句保留。';
      if(input.includes('撤回授权'))return '等撤回授权，这个回复不会送达。';
      if(input.includes('详细说明'))return paragraph;
      if(input.includes('晴天'))return '早上好，今天是个晴天。';
      if(input.includes('晚安')||input==='帮我发一条语音')return '晚安，明天再聊。';
      if(input.includes('服务失败'))return '服务失败时，先喝口水，等会儿再试。';
      if(input.includes('测试符号'))return '欢迎来到这里，甲 & 乙。';
      return '收到，稍后见。';
    }};
  const dragon={...textModel,provider:'openai',groupRoles:[{number:AI_DRAGON_NUMBER,name:'龙娘'}]};
  let browser;
  const server=createServer(store,{aiProvider:textModel,groupAiProviders:[textModel,dragon],
    voiceEngine:voiceCatalog(azure,backupTone)}).listen(0,'127.0.0.1');
  try{
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--mute-audio','--disable-gpu']});
    const [a,b,other]=await Promise.all(['voice_alice','voice_bobby','voice_other'].map(name=>register(browser,origin,name)));
    await a.locator('[data-tab=contacts]').click();
    await btn(a,'AI 联系人').click();
    await btn(a,'同意并开始私聊').click();
    await a.locator('#chat-title').getByText('鲸鱼娘',{exact:true}).waitFor();
    const direct=(await api(a,'/conversations')).conversations[0].id;
    await choose(a,AI_NUMBER,'mandarin-bright',true);
    const first=await send(a,'用语音回复：问一次晴天');
    const second=await send(a,'帮我发一条语音');
    const offline=[await readVoice(a,direct,first.reply,'voice_alice',target&&path.join(target,'离线回执-晴天.wav')),
      await readVoice(a,direct,second.reply,'voice_alice',target&&path.join(target,'离线回执-晚安.wav'))];
    assert.notEqual(offline[0].sha,offline[1].sha);
    assert.equal(localWire.at(-2).text,'早上好，今天是个晴天。');
    assert.equal(localWire.at(-1).text,'晚安，明天再聊。');
    const beforeText=localWire.length;
    const onlyText=await send(a,'这条纯文字回答就好。用语音回复：问一次晴天');
    assert.equal(onlyText.reply.text,'早上好，今天是个晴天。');
    assert.equal(onlyText.reply.attachment,undefined);
    assert.equal(localWire.length,beforeText);
    const short=await send(a,'现在方便聊两句吗？');
    assert.equal(short.reply.attachment,undefined);
    const long=await send(a,'请详细说明怎么安排明天的事项');
    const auto=await readVoice(a,direct,long.reply,'voice_alice');
    const beforeLong=[localWire.length,chatWire.length];
    const extended=await send(a,'用语音回复：试一段超长原回复');
    const extendedVoice=await readVoice(a,direct,extended.reply,'voice_alice',target&&path.join(target,'长回复原文语音.wav'));
    assert(extendedVoice.durationMs>30000&&extendedVoice.durationMs<=120000);
    assert.equal(localWire.at(-1).text,longDraft);
    assert.equal(store.one('SELECT body FROM messages WHERE id=?',extended.reply.id).body,longDraft);
    assert.deepEqual([localWire.length,chatWire.length],[beforeLong[0]+1,beforeLong[1]+1]);
    await a.locator(`[data-voice-id="${extended.reply.id}"]`).click();
    await a.waitForFunction(()=>document.querySelector('#inline-voice-audio')?.currentTime>0&&!document.querySelector('#dialog').open);
    if(target)await a.screenshot({path:path.join(target,'播放长回复原文语音.png')});
    await a.locator(`[data-voice-id="${extended.reply.id}"]`).click();
    const beforeCompactRetry=[localWire.length,chatWire.length];
    const directMeta=(await api(a,`/conversations/${direct}`)).conversation;
    const repeated=await api(a,`/conversations/${direct}/messages`,{
      clientId:extended.message.clientId,text:extended.message.text,aiConsentRevision:directMeta.cloudChat.revision});
    assert.equal(repeated.message.id,extended.message.id);
    assert.equal(repeated.reply,undefined);
    assert.deepEqual([localWire.length,chatWire.length],beforeCompactRetry);
    const overTime=await send(a,'用语音回复：试一段朗读会超时的回复');
    assert((await readVoice(a,direct,overTime.reply,'voice_alice')).durationMs>30000);
    assert.deepEqual(localWire.slice(-2).map(row=>row.text),[longDraft,slowDraft]);
    const exceeded=await send(a,'用语音回复：试一段超出资源界限的回复');
    assert.equal(exceeded.reply.attachment,undefined);
    assert.equal(exceeded.reply.text,paragraph.repeat(6)+'\n\n（这段回复超过语音时长上限，保留完整文字。）');
    const beforeWritten=[localWire.length,chatWire.length];
    const writtenLong=await send(a,'只用文字回答，试一段超长原回复');
    assert.equal(writtenLong.reply.text,longDraft);
    assert.equal(writtenLong.reply.attachment,undefined);
    assert.deepEqual([localWire.length,chatWire.length],[beforeWritten[0],beforeWritten[1]+1]);
    const precise=await send(a,'用语音回复：请逐条核对超长原回复');
    assert.equal(precise.reply.text,longDraft);
    assert.equal(precise.reply.attachment,undefined);
    assert.deepEqual([localWire.length,chatWire.length],[beforeWritten[0],beforeWritten[1]+2]);

    const {request}=await api(a,'/friend-requests',{number:'voice_bobby'});
    await api(b,'/friend-requests/'+request.id+'/accept',{});
    const {conversation:humans}=await api(a,'/direct',{number:'voice_bobby'});
    const humanUpload=await a.request.post(`/api/v1/conversations/${humans.id}/voices`,{
      headers:{'X-Social-Account':'voice_alice','X-Social-Client-Id':'long-human-rejected','Content-Type':'audio/wav'},
      data:await real.render(slowDraft,real.voices[0].id),
    });
    assert.equal(humanUpload.status(),413);
    const {conversation:group}=await api(a,'/groups',{title,memberNumbers:['voice_bobby']});
    await Promise.all([a,b].map(page=>page.goto(origin+'/#chat/'+group.id)));
    await btn(a,'群成员').click();
    await btn(a,'群内 AI').click();
    await btn(a,'加入鲸鱼娘（DeepSeek）').click();
    await btn(a,'同意发给 DeepSeek').click();
    await btn(a,'加入龙娘（OpenAI）').click();
    await btn(a,'同意发给 OpenAI（GPT）').click();
    await btn(a,'关闭').click();
    assert.equal((await api(b,`/conversations/${group.id}/ai-voice`)).roles.length,0);
    await api(b,`/conversations/${group.id}/ai-voice`,{number:AI_NUMBER,voice:'azure-xiaoxiao',revision:null,expectedAccount:'voice_bobby'},403);
    await choose(a,AI_NUMBER,'azure-xiaoxiao',true);
    await choose(a,AI_DRAGON_NUMBER,'azure-xiaoyi',true);
    if(target){
      await clickChatSetting(a,'AI 音色');
      await a.getByLabel('角色',{exact:true}).selectOption(AI_DRAGON_NUMBER);
      await a.screenshot({path:path.join(target,'音色试听与选择.png')});
      await btn(a,'关闭').click();
    }
    await a.reload();
    const getChoices=async id=>(await api(a,`/conversations/${id}/ai-voice`)).roles.map(({number,voice})=>[number,voice]);
    assert.deepEqual(await getChoices(group.id),[[AI_NUMBER,'azure-xiaoxiao'],[AI_DRAGON_NUMBER,'azure-xiaoyi']]);
    assert.deepEqual(await getChoices(direct),[[AI_NUMBER,'azure-xiaoxiao']]);
    assert.equal((await api(a,`/conversations/${direct}/ai-voice`)).roles[0].allowed,false);
    const beforeFact=chatWire.length;
    const whale=await send(a,'@鲸鱼娘 用语音回复：请说明现场安排');
    const dragonReply=await send(a,'@龙娘 用语音回复：跟我说晚安');
    const mixed=[await readVoice(b,group.id,whale.reply,'voice_bobby',target&&path.join(target,'现场安排原文语音.wav')),
      await readVoice(b,group.id,dragonReply.reply,'voice_bobby')];
    assert.match(remoteWire.at(-2).speaker,/XiaoxiaoNeural$/u);
    assert.match(remoteWire.at(-2).text,/甲 &amp; 乙/u);
    assert.equal(remoteWire.at(-2).text.replaceAll('&amp;','&'),factDraft);
    assert.equal(store.one('SELECT body FROM messages WHERE id=?',whale.reply.id).body,factDraft);
    assert.equal(chatWire.length,beforeFact+2);
    assert(mixed[0].durationMs>30000);
    assert.equal(mixed[0].sha,sha(await real.render(factDraft,real.voices[0].id)));
    assert.match(remoteWire.at(-1).speaker,/XiaoyiNeural$/u);
    const history=await api(b,`/conversations/${group.id}/messages`);
    const order=history.messages.filter(row=>row.attachment?.type==='voice');
    assert.deepEqual(order.map(row=>row.id),mixed.map(row=>row.id));
    for(let retry=0;retry<2;retry++){
      if(retry)await b.reload();
      await b.locator(`[data-voice-id="${mixed[0].id}"]`).click();
      await b.waitForFunction(()=>document.querySelector('#inline-voice-audio')?.currentTime>0&&!document.querySelector('#dialog').open);
      if(target&&!retry)await b.screenshot({path:path.join(target,'群友播放语音.png')});
      await b.locator(`[data-voice-id="${mixed[0].id}"]`).click();
    }
    const beforeRetry=[chatWire.length,remoteWire.length];
    const duplicate=await api(a,`/conversations/${group.id}/messages`,{
      clientId:dragonReply.message.clientId,text:dragonReply.message.text,mentionAccount:dragonReply.message.mention?.number});
    assert.equal(duplicate.message.id,dragonReply.message.id);
    assert.equal(duplicate.reply,undefined);
    assert.deepEqual([chatWire.length,remoteWire.length],beforeRetry);
    const fallback=await send(a,'@龙娘 用语音回复：测试服务失败');
    assert.equal(fallback.reply.text,'服务失败时，先喝口水，等会儿再试。\n\n（这次语音暂时无法生成，保留完整文字。）');
    assert.equal(fallback.reply.attachment,undefined);
    const groupVoicePath=`/conversations/${group.id}/ai-voice`;
    const oldVoice=send(a,'@龙娘 用语音回复：测试换音色');
    await Promise.race([changing.promise,oldVoice.then(()=>{throw Error('Expected an in-flight voice');})]);
    const voiceSetting=(await api(a,groupVoicePath)).roles.find(role=>role.number===AI_DRAGON_NUMBER);
    await api(a,groupVoicePath,{number:AI_DRAGON_NUMBER,voice:'azure-yunxi',revision:voiceSetting.revision,expectedAccount:'voice_alice'});
    changed.resolve();
    const changedTurn=await oldVoice;
    assert.equal(changedTurn.reply.text,'等换音色，原句保留。');
    assert.equal(changedTurn.reply.attachment,undefined);
    const pending=send(a,'@龙娘 用语音回复：测试撤回授权');
    await Promise.race([cancelling.promise,pending.then(()=>{throw Error('Expected an in-flight voice');})]);
    await api(a,`/groups/${group.id}/ai-consent`,{number:AI_DRAGON_NUMBER,provider:'openai',enabled:false,expectedAccount:'voice_alice'});
    cancelled.resolve();
    const revoked=await pending;
    assert.equal(revoked.reply,undefined);
    assert.equal(revoked.message.aiReply,'failed');
    const {conversation:group2}=await api(a,'/groups',{title:'第二个语音验收群',memberNumbers:['voice_bobby']});
    const group2Path=`/groups/${group2.id}`;
    await api(a,group2Path+'/ai',{expectedAccount:'voice_alice',number:AI_NUMBER,enabled:true});
    await api(a,group2Path+'/ai-consent',{expectedAccount:'voice_alice',number:AI_NUMBER,provider:'deepseek',enabled:true});
    await a.goto(origin+'/#chat/'+group2.id);
    const secondPath=`/conversations/${group2.id}/ai-voice`;
    const pref=(await api(a,secondPath)).roles[0];
    assert.equal(pref.voice,'azure-xiaoxiao');
    assert.equal(pref.allowed,false);
    const noGrant=remoteWire.length;
    const beforeGrant=await send(a,'@鲸鱼娘 用语音回复：问一次晴天');
    assert.equal(beforeGrant.reply.attachment,undefined);
    assert.equal(remoteWire.length,noGrant);
    await clickChatSetting(a,'AI 音色');
    await btn(a,'允许本会话语音').click();
    await a.locator('#dialog').getByText('本会话已允许使用当前音色。',{exact:true}).waitFor();
    await btn(a,'关闭').click();
    const secondGroup=await send(a,'@鲸鱼娘 用语音回复：问一次晴天');
    await readVoice(b,group2.id,secondGroup.reply,'voice_bobby');
    assert.equal(remoteWire.at(-1).speaker,'zh-CN-XiaoxiaoNeural');
    await api(b,group2Path+'/ai-consent',{expectedAccount:'voice_bobby',number:AI_NUMBER,provider:'deepseek',enabled:true});
    const peerPref=(await api(b,secondPath)).roles[0];
    assert.equal(peerPref.voice,null);
    assert.equal(peerPref.allowed,false);
    await a.goto(origin+'/#chat/'+group.id);
    await a.locator('#chat-title').getByText(group.title,{exact:true}).waitFor();
    await choose(a,AI_NUMBER,'azure-yunxi',false,false);
    assert.deepEqual((await api(a,secondPath)).roles.map(({voice,allowed})=>[voice,allowed]),[['azure-yunxi',true]]);
    await choose(a,AI_NUMBER,'mandarin-soft');
    assert.equal((await api(a,secondPath)).roles[0].allowed,false);
    const beforeLocalGroup=remoteWire.length;
    const localGroup=await send(a,'@鲸鱼娘 用语音回复：再问一次晴天');
    const offlineGroup=await readVoice(b,group.id,localGroup.reply,'voice_bobby');
    assert.deepEqual(localWire.at(-1),{text:'早上好，今天是个晴天。',id:'mandarin-soft'});
    assert.equal(remoteWire.length,beforeLocalGroup);
    await b.locator(`[data-voice-id="${offlineGroup.id}"]`).click();
    await b.waitForFunction(duration=>{
      const player=document.querySelector('#inline-voice-audio');
      return player?.currentTime>0&&Math.abs(player.duration*1000-duration)<2;
    },offlineGroup.durationMs);
    if(target)await b.screenshot({path:path.join(target,'群友播放离线语音.png')});
    await b.locator(`[data-voice-id="${offlineGroup.id}"]`).click();
    const restore=await makeBackup(path.join(scratch,'qa.sqlite'),path.join(scratch,'restore'),{prepareRestore:true});
    const restored=new SocialStore(restore);
    try{
      assert.equal(restored.one('SELECT count(*) AS n FROM ai_voice_choices').n,0);
      assert.equal(restored.one('SELECT count(*) AS n FROM ai_voice_preferences').n,0);
      assert.equal(restored.one('SELECT count(*) AS n FROM ai_voice_scopes').n,0);
      assert.equal(sha(restored.messageVoice('voice_bobby',group.id,localGroup.reply.id).bytes),offlineGroup.sha);
      assert.equal(sha(restored.messageVoice('voice_alice',direct,extended.reply.id).bytes),extendedVoice.sha);
      const legacy=[
        [direct,'voice_alice',AI_NUMBER,'mandarin-bright','old-local'],
        [group.id,'voice_alice',AI_NUMBER,'azure-xiaoxiao','old-azure'],
        [group2.id,'voice_alice',AI_NUMBER,null,'old-off'],
        [group.id,'voice_alice',AI_DRAGON_NUMBER,'azure-xiaoyi','old-unique'],
      ];
      for(const row of legacy)restored.run('INSERT INTO ai_voice_choices VALUES(?,?,?,?,?)',...row);
      restored.db.exec(`
        ALTER TABLE message_voices RENAME TO voice_fixture_source;
        CREATE TABLE message_voices (
          message INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
          duration_ms INTEGER NOT NULL CHECK(duration_ms BETWEEN 200 AND 30000),
          digest TEXT NOT NULL, bytes BLOB NOT NULL CHECK(length(bytes) BETWEEN 6444 AND 960044)
        );
        INSERT INTO message_voices SELECT * FROM voice_fixture_source WHERE duration_ms<=30000;
        DROP TABLE voice_fixture_source;
        PRAGMA user_version=0;
      `);
    }finally{restored.db.close();}
    const migrated=new SocialStore(restore);
    try{
      const read=(id,number)=>createAiVoice(migrated,voiceCatalog(azure,backupTone))
        .view(id,'voice_alice',[{number}]).roles[0];
      assert.deepEqual([read(direct,AI_NUMBER).voice,read(direct,AI_NUMBER).allowed],['mandarin-bright',true]);
      assert.deepEqual([read(group.id,AI_NUMBER).voice,read(group.id,AI_NUMBER).allowed],['azure-xiaoxiao',true]);
      assert.deepEqual([read(group2.id,AI_NUMBER).voice,read(group2.id,AI_NUMBER).allowed],[null,false]);
      assert.equal(migrated.one('SELECT voice FROM ai_voice_preferences WHERE human=? AND ai=?',
        'voice_alice',AI_DRAGON_NUMBER).voice,'azure-xiaoyi');
      assert.equal(migrated.one('PRAGMA user_version').user_version,store.one('PRAGMA user_version').user_version);
      assert.equal(sha(migrated.messageVoice('voice_alice',direct,first.reply.id).bytes),offline[0].sha);
    }finally{migrated.db.close();}
    assert.equal((await other.request.get(mixed[0].url,{headers:{'X-Social-Account':'voice_other'}})).status(),404);
    await api(b,`/groups/${group.id}/leave`,{});
    assert.equal((await b.request.get(mixed[0].url,{headers:{'X-Social-Account':'voice_bobby'}})).status(),404);
    assert(chatWire.every(row=>!row.input.startsWith('{"reply":')));
    const evidence={offline,offlineGroup,auto,mixed,extendedVoice,factDraft,fullWrittenChars:longDraft.length,
      exactOriginalSynthesis:true,humanUploadStillCapped:true,inflightVoiceChangeAndRevocation:true,
      sharedAcrossTwoGroupsAndDirect:true,unapprovedGroupUsedText:true,localGrantBlockedAzure:true,legacyScopesPreserved:true,
      localWire,remoteWire,chatWire,remoteRequests:0,
      replayedInAnotherProfile:true,accountAndRoleSelectionIsolated:true,textOnlyNoSynthesis:true,
      retryDeduplicated:true,failedAzureReturnedText:true,outsiderAndFormerMemberBlocked:true,
      backupPreservedAudioAndResetSelections:true};
    if(target)await fs.writeFile(path.join(target,'receipt.json'),JSON.stringify(evidence,null,2)+'\n');
    console.log(JSON.stringify(evidence));
  }finally{
    changed.resolve();
    cancelled.resolve();
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
    assert.equal(path.dirname(scratch),temp);
    assert.match(path.basename(scratch),/^arcade-ai-voice-[a-z0-9]{6}$/iu);
    await fs.rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
