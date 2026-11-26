'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');
const {chromium}=require('playwright');
const {SocialStore,AI_NUMBER}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {createAzureVoice}=require('../../server/ai-voice-azure.cjs');

async function main(){
  const output=process.argv[2];
  assert(output,'Pass a new evidence directory.');
  await fs.mkdir(output);
  const tempRoot=await fs.realpath(os.tmpdir());
  const temp=await fs.mkdtemp(path.join(tempRoot,'arcade-interrupt-'));
  const store=new SocialStore(path.join(temp,'test.sqlite'));
  const provider={provider:'deepseek',groupRoles:[{name:'鲸鱼娘',number:AI_NUMBER}],generate:()=>assert.fail('unexpected model call')};
  let sample,cloudCalls=0;
  const voiceEngine=createAzureVoice('eastasia','fixture-speech-only',{fetchImpl:async(url,request)=>{
    assert.equal(url,'https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1');
    assert.match(request.body,/zh-CN-XiaoyiNeural/);cloudCalls++;
    return new Response(sample,{headers:{'Content-Type':'audio/pcm'}});
  }});
  const server=createServer(store,{groupAiProviders:[provider],voiceEngine,...(process.env.TEST_SOCIAL_CLIENT&&{client:process.env.TEST_SOCIAL_CLIENT})});
  let browser;
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--disable-background-networking']});
    const sender=await browser.newContext(),receiver=await browser.newContext();
    async function post(ctx,route,data){
      const reply=await ctx.request.post(origin+'/api/v1'+route,{data});
      assert.equal(reply.status(),200,route);return reply.json();
    }
    for(const [ctx,number] of [[sender,'voice_alpha'],[receiver,'voice_bravo']]){
      await post(ctx,'/register',{number,displayName:number,password:'synthetic voice fixture'});
    }
    const req=await post(sender,'/friend-requests',{number:'voice_bravo'});
    await post(receiver,'/friend-requests/'+req.request.id+'/accept',{});
    const group=(await post(sender,'/groups',{title:'合成语音群',memberNumbers:['voice_bravo']})).conversation.id;
    await post(sender,'/groups/'+group+'/ai',{number:AI_NUMBER,enabled:true,expectedAccount:'voice_alpha'});
    await post(receiver,'/groups/'+group+'/ai-consent',{number:AI_NUMBER,provider:'deepseek',enabled:true,expectedAccount:'voice_bravo'});
    const rate=16000,seconds=6,samples=seconds*rate,wav=Buffer.alloc(44+samples*2);
    wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
    wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);
    wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
    for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(6000*Math.sin(2*Math.PI*440*i/rate)),44+i*2);
    sample=wav.subarray(44);
    const route='/api/v1/conversations/'+group;
    const upload=await sender.request.post(origin+route+'/voices',{data:wav,headers:{
      'Content-Type':'audio/wav','X-Social-Account':'voice_alpha','X-Social-Client-Id':'voice_interrupt_test'}});
    assert.equal(upload.status(),200);const {message}=await upload.json();
    await receiver.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
    const p=await receiver.newPage(),errors=[];
    p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(8000);
    await p.goto(origin+'/#chat/'+group);
    const button=p.locator('[data-voice-id="'+message.id+'"]'),audio=p.locator('#inline-voice-audio');
    const play=async()=>{
      await button.click();
      await p.waitForFunction(()=>{const a=document.querySelector('#inline-voice-audio');return a&&!a.paused&&a.currentTime>.12;});
    };
    await play();
    const measured=await audio.evaluate(async el=>{
      const ctx=new AudioContext(),node=ctx.createMediaElementSource(el),an=ctx.createAnalyser();
      node.connect(an);an.connect(ctx.destination);await ctx.resume();
      let rms=0;
      const data=new Float32Array(an.fftSize);
      for(let i=0;i<20&&rms<.05;i++){
        await new Promise(done=>setTimeout(done,30));an.getFloatTimeDomainData(data);
        rms=Math.sqrt(data.reduce((sum,value)=>sum+value*value,0)/data.length);
      }
      const currentTime=el.currentTime;
      window.testPlaybackSignal={ctx,an,el};return {rms,currentTime};
    });
    assert(measured.rms>.05,'media decoder must produce an audible signal');
    await button.click();
    await p.waitForFunction(()=>document.querySelector('#inline-voice-audio')?.paused);
    const paused=await audio.evaluate(a=>a.currentTime);await play();
    assert((await audio.evaluate(a=>a.currentTime))>=paused);
    await p.screenshot({path:path.join(output,'voice-playing.png')});
    const deactivate=()=>p.evaluate(()=>window.dispatchEvent(new Event('arcade-social-deactivate')));
    await deactivate();
    const stoppedOnDeactivate=await audio.count()===0;
    const afterStop=await p.evaluate(async()=>{
      const {ctx,an,el}=window.testPlaybackSignal;
      await new Promise(done=>setTimeout(done,140));
      const data=new Float32Array(an.fftSize);an.getFloatTimeDomainData(data);
      const rms=Math.sqrt(data.reduce((sum,value)=>sum+value*value,0)/data.length);
      await ctx.close();return {rms,paused:el.paused};
    });
    await p.evaluate(()=>window.dispatchEvent(new Event('arcade-social-activate')));
    if(stoppedOnDeactivate)await play();
    await p.locator('#chat-settings-toggle').click();await p.locator('#ai-voice').click();await p.locator('dialog[open]').waitFor();
    const stoppedForPreview=await audio.count()===0;
    const dialog=p.locator('dialog[open]');
    await dialog.getByLabel('音色',{exact:true}).selectOption('azure-xiaoyi');
    await dialog.getByRole('button',{name:'试听',exact:true}).click();
    await p.waitForFunction(()=>{const a=document.querySelector('dialog audio');return a&&!a.paused&&a.currentTime>.1;});
    assert.equal(cloudCalls,1);
    const facts={...measured,afterStop,stoppedOnDeactivate,stoppedForPreview,cloudPreviewPlaying:true,cloudCalls,errors};
    if(!stoppedOnDeactivate||!stoppedForPreview){
      await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(facts,null,2));
      throw Error('Old history audio remained active.');
    }
    assert(afterStop.paused&&afterStop.rms<.001);await p.keyboard.press('Escape');await p.locator('dialog[open]').waitFor({state:'detached'});
    const voicePath=origin+route+'/messages/'+message.id+'/voice';
    let release,entered;const waiting=new Promise(r=>{entered=r;}),hold=new Promise(r=>{release=r;});
    await p.route(voicePath,async r=>{entered();await hold;try{await r.fulfill({status:200,contentType:'audio/wav',body:wav});}catch{/* aborted fetch */}});
    await button.click();await waiting;await deactivate();release();
    await p.waitForTimeout(250);
    assert.equal(await audio.count(),0);assert.match(await button.textContent(),/^播放语音/);
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify({...facts,stoppedWhileDownloading:true},null,2));
    console.log(JSON.stringify(facts));
  }finally{
    await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done));
    store.db.close();const actual=await fs.realpath(temp);
    assert.equal(path.dirname(actual),tempRoot);assert.match(path.basename(actual),/^arcade-interrupt-[a-z0-9]+$/iu);
    await fs.rm(actual,{recursive:true,force:true,maxRetries:5});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
