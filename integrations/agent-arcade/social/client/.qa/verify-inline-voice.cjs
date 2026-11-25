'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');
const {SocialStore,AI_NUMBER}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {moderate}=require('../../server/moderate.cjs');

function tone(hz,seconds) {
  const sampleRate=16000,samples=sampleRate*seconds;
  const pcm=Buffer.alloc(44+samples*2);
  pcm.write('RIFF');pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);
  pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);
  pcm.writeUInt32LE(sampleRate,24);pcm.writeUInt32LE(sampleRate*2,28);
  pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)pcm.writeInt16LE(Math.round(6000*Math.sin(2*Math.PI*hz*i/sampleRate)),44+2*i);
  return pcm;
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const btn=(page,name)=>page.getByRole('button',{name,exact:true});
const visible=locator=>locator.waitFor({state:'visible'});
const control=(page,id)=>page.locator('[data-voice-id="'+id+'"]');
const clock=page=>page.locator('#inline-voice-audio').evaluate(audio=>audio.currentTime);
async function playing(page,id) {
  await page.waitForFunction(message=>{
    const audio=document.querySelector('#inline-voice-audio');
    return audio&&!audio.paused&&audio.currentTime>0.12&&
      document.querySelector('[data-voice-id="'+message+'"]')?.textContent.startsWith('暂停语音');
  },id);
  assert.equal(await page.locator('dialog').evaluate(node=>node.open),false);
}
async function main(){
  assert(process.argv[2]&&process.argv.length===3,'Usage: node verify-inline-voice.cjs NEW_EVIDENCE_DIRECTORY');
  const output=path.resolve(process.argv[2]);
  await fs.mkdir(output);
  const tempRoot=await fs.realpath(os.tmpdir());
  const temp=await fs.mkdtemp(path.join(tempRoot,'arcade-inline-voice-'));
  const mic=path.join(temp,'fake-microphone.wav');
  await fs.writeFile(mic,tone(440,10));
  const store=new SocialStore(path.join(temp,'fixture.sqlite'));
  const provider={provider:'deepseek',groupRoles:[{name:'鲸鱼娘',number:AI_NUMBER}],
    async generate(){assert.fail('Human attachments must not reach the group model');}};
  const server=createServer(store,{groupAiProviders:[provider]});
  const errors=[],gets=[],posts=[];
  let browser;
  try{
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    server.on('request',req=>{
      if(req.url.endsWith('/voice'))gets.push(req.url);
      if(req.url.endsWith('/voices')&&req.method==='POST')posts.push(req.url);
    });
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking',
      '--disable-component-update','--disable-sync','--mute-audio','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+mic]});
    async function account(number,name,width){
      const context=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block'});
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      await context.grantPermissions(['microphone'],{origin});
      const page=await context.newPage();
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin);
      await btn(page,'创建账号').click();
      await page.locator('[name=number]').fill(number);
      await page.locator('[name=displayName]').fill(name);
      await page.locator('[name=password]').fill('synthetic-inline-only');
      await page.locator('#auth-submit').click();
      await visible(page.getByRole('heading',{name:'消息',exact:true}));
      return {page,context,number};
    }
    async function api(who,route,data,status=200) {
      const url=origin+'/api/v1'+route;
      const reply=await (data===undefined?who.context.request.get(url):who.context.request.post(url,{data}));
      assert.equal(reply.status(),status,route);
      return reply.json();
    }
    async function upload(who,thread,bytes,id) {
      const reply=await who.context.request.post(origin+'/api/v1/conversations/'+thread+'/voices',
        {data:bytes,headers:{'Content-Type':'audio/wav','X-Social-Account':who.number,'X-Social-Client-Id':id}});
      assert.equal(reply.status(),200);
      return (await reply.json()).message;
    }
    const a=await account('inline_alpha','发件合成甲',1024);
    const b=await account('inline_bravo','收件合成乙',360);
    const request=(await api(a,'/friend-requests',{number:b.number})).request;
    const direct=(await api(b,'/friend-requests/'+request.id+'/accept',{})).conversation.id;
    const group=(await api(a,'/groups',{title:'语音合成群',memberNumbers:[b.number]})).conversation.id;
    await api(a,'/groups/'+group+'/ai',{number:AI_NUMBER,enabled:true,expectedAccount:a.number});
    await api(a,'/groups/'+group+'/ai-consent',{number:AI_NUMBER,provider:'deepseek',enabled:true,expectedAccount:a.number});
    const copy=await (await fetch(origin+'/privacy.html')).text();
    assert.match(copy,/点「发送语音」才会上传.*数据库及备份.*群里有 AI 时.*录音不会自动转写.*普通附件及原件地址不会触发 AI 接话/);
    await a.page.goto(origin+'/#chat/'+direct);
    await btn(a.page,'录音').click();
    await visible(a.page.getByText('录音中，最多 30 秒。',{exact:true}));
    await a.page.waitForTimeout(2100);
    await btn(a.page,'停止录音').click();
    await visible(a.page.getByText('可以先试听，再发送。',{exact:true}));
    await a.page.waitForFunction(()=>document.querySelector('dialog audio')?.duration>1);
    assert.equal(posts.length,0);
    await a.page.screenshot({path:path.join(output,'sender-local-preview.png')});
    const save=a.page.waitForResponse(reply=>reply.request().method()==='POST'&&reply.url().endsWith('/voices'));
    await btn(a.page,'发送语音').click();
    const saved=await save;
    assert.equal(saved.status(),200);
    const first=(await saved.json()).message;
    assert.equal(posts.length,1);
    const secondBytes=tone(720,12);
    const second=await upload(a,direct,secondBytes,'inline_second');
    const inGroup=await upload(a,group,tone(540,12),'inline_group');
    const png=await fs.readFile(path.join(__dirname,'../../assets/stickers/whale-happy.png'));
    const groupPhoto=await a.context.request.post(origin+'/api/v1/conversations/'+group+'/images',{
      data:png,headers:{'Content-Type':'image/png','X-Social-Account':a.number,'X-Social-Client-Id':'inline_group_photo'},
    });
    assert.equal(groupPhoto.status(),200);
    const {message:photo}=await groupPhoto.json();
    const photoOriginal=origin+`/api/v1/conversations/${group}/messages/${photo.id}/image`;
    const linkMessage=await api(a,'/conversations/'+group+'/messages',{
      clientId:'inline_original_link',text:'可以看看这个原件吗？ '+photoOriginal,mentionAccount:AI_NUMBER,
    });
    assert.equal(linkMessage.reply,undefined);
    assert.equal(store.one('SELECT count(*) AS n FROM ai_group_turns WHERE chat=?',group).n,0);
    const restricted=origin+'/api/v1/conversations/'+direct+'/messages/'+first.id+'/voice';
    const delivered=await b.context.request.get(restricted,{headers:{'X-Social-Account':b.number}});
    assert.equal(delivered.status(),200);
    assert.notEqual(digest(await delivered.body()),digest(secondBytes));

    await b.page.goto(origin+'/#chat/'+direct);
    const firstButton=control(b.page,first.id),secondButton=control(b.page,second.id);
    await firstButton.click();
    await playing(b.page,first.id);
    await firstButton.click();
    await b.page.waitForFunction(()=>document.querySelector('#inline-voice-audio')?.paused);
    const pausedAt=await clock(b.page);
    await firstButton.press('Enter');
    await playing(b.page,first.id);
    assert((await clock(b.page))>=pausedAt);

    await secondButton.press('Space');
    await playing(b.page,second.id);
    assert.match(await firstButton.textContent(),/^播放语音/);
    assert.equal(await b.page.locator('#inline-voice-audio').count(),1);
    await api(a,'/conversations/'+direct+'/messages',{clientId:'inline_arrival',text:'播着也会收到新消息'});
    await visible(b.page.locator('#history').getByText('播着也会收到新消息',{exact:true}));
    assert.equal(await secondButton.evaluate(node=>node===document.activeElement),true);
    await b.page.locator('#message').fill('我可以边听边写');
    assert.equal(await b.page.locator('#message').inputValue(),'我可以边听边写');
    assert.equal(await b.page.locator('#inline-voice-audio').evaluate(audio=>audio.paused),false);
    assert(await b.page.evaluate(()=>document.documentElement.scrollWidth===window.innerWidth));
    await b.page.screenshot({path:path.join(output,'recipient-inline-playing.png')});

    await b.page.locator('#back').click();
    assert.equal(await b.page.locator('#inline-voice-audio').count(),0);
    await b.page.locator('#directory-body').getByRole('button',{name:/发件合成甲/}).click();
    await secondButton.waitFor({state:'visible'});
    assert.equal(await b.page.locator('#message').inputValue(),'我可以边听边写');
    await secondButton.click();
    await playing(b.page,second.id);
    const report=await api(b,'/conversations/'+direct+'/messages/'+second.id+'/report',{reason:'合成移除验收'});
    moderate(store,'remove',report.report.id);
    await secondButton.waitFor({state:'detached'});
    assert.equal(await b.page.locator('#inline-voice-audio').count(),0);
    await visible(b.page.locator('#history').getByText('[已移除]',{exact:true}));

    await b.page.goto(origin+'/#chat/'+group);
    const picture=b.page.locator(`[data-image-id="${photo.id}"] img`);
    await picture.evaluate(img=>img.decode());
    assert.deepEqual(await (await b.context.request.get(photoOriginal)).body(),png);
    await control(b.page,inGroup.id).click();
    await playing(b.page,inGroup.id);
    await btn(b.page,'群成员').click();
    await btn(b.page,'退出群聊').click();
    await btn(b.page,'确认退出').click();
    await b.page.waitForFunction(()=>!document.querySelector('#inline-voice-audio')&&!location.hash);
    const notMember=await b.context.request.get(origin+'/api/v1/conversations/'+group+'/messages/'+inGroup.id+'/voice',
      {headers:{'X-Social-Account':b.number}});
    assert.equal(notMember.status(),404);
    assert.equal((await b.context.request.get(photoOriginal)).status(),404);
    assert.deepEqual(errors,[]);
    const receipt={passed:true,viewport:360,realReceiver:true,clickAndKeyboard:true,recordingPreviewBeforeUpload:true,
      twoDifferentAudioMessages:true,singlePlayback:true,pauseAndResume:true,focusSurvivesIncomingMessage:true,
      composeWhileListening:true,stoppedOnConversationChange:true,stoppedOnRemoval:true,stoppedOnLeave:true,
      formerMemberAudioStatus:404,formerMemberPhotoStatus:404,mixedGroupPhotoAndVoice:true,mixedGroupAttachmentTurns:0,
      externallySent:0,visibleWindows:0,voiceGets:gets.length};
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify(receipt));
  }finally{
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
    const actual=await fs.realpath(temp);
    assert.equal(path.dirname(actual),tempRoot);
    assert.match(path.basename(actual),/^arcade-inline-voice-[a-z0-9]+$/i);
    await fs.rm(actual,{recursive:true,force:true,maxRetries:5});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
