'use strict';

const {clickChatSetting}=require('./chat-controls.cjs');

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
const {chromium,expect}=require('playwright/test');
const {PNG}=require('pngjs');

const [outputPath,baselinePath]=process.argv.slice(2);
const output=path.resolve(outputPath);
const root=baselinePath?path.resolve(baselinePath):path.resolve(__dirname,'../../..');
const load=name=>require(path.join(root,'social/server',name+'.cjs'));
const {SocialStore}=load('store');
const {AI_JU_NUMBER:ju,AI_NUMBER,AI_DRAGON_NUMBER}=load('ai-roles');
const {createServer}=load('http');
const {createClaudeProvider}=load('ai-claude');
const {createVoiceEngine}=load('ai-voice-engine');
const {validateAiVoice}=load('voice-upload');
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

async function run(){
  await fs.mkdir(output);
  const calls=[],speech=[],external=[],observed=[];
  const engine=createVoiceEngine(process.env.SOCIAL_ESPEAK);
  assert(engine,'Supply the already installed local eSpeak test runtime');
  const syntheticAi=(provider,number,name)=>({provider,name,groupRoles:[{number,name}],async generate(){return '收到。';}});
  const whale=syntheticAi('deepseek',AI_NUMBER,'鲸鱼娘'),dragon=syntheticAi('openai',AI_DRAGON_NUMBER,'龙娘');
  const claude=createClaudeProvider('fixture-only',{fetchImpl:async(url,init)=>{
    assert.equal(url,'https://api.anthropic.com/v1/messages');
    const {system,messages}=JSON.parse(init.body),input=messages.at(-1).content;
    const group=system.includes('多人群'), stickers=system.includes('[[sticker:approve]]');
    const text=stickers&&input==='发个表情'?(group?'[[sticker:annoyed]]':'[[sticker:approve]]'):
      stickers&&input==='我今天领奖啦！'?'[[sticker:happy]]':
      system.includes('只写当轮适合朗读的台词')?(group?'晚上好，大家辛苦啦。':'忙了一天，先喝口水吧。'):'橘娘这轮用文字。';
    calls.push({input,group,stickers,text});
    return Response.json({type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text}]});
  }});
  const store=new SocialStore(path.join(output,'synthetic.sqlite'));
  const server=createServer(store,{aiProvider:whale,claudeProvider:claude,groupAiProviders:[whale,dragon,claude],
    voiceEngine:{...engine,render(text,id,signal){speech.push({text,id});return engine.render(text,id,signal);}}}).listen(0,'127.0.0.1');
  let browser;
  try{
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--mute-audio','--disable-gpu']});
    async function actor(number){
      const context=await browser.newContext({viewport:{width:428,height:850},serviceWorkers:'block'});
      await context.route(/^https?:/u,route=>{
        if(route.request().url().startsWith(origin+'/'))return route.continue();
        external.push(route.request().url());return route.abort();
      });
      async function api(route,data){
        const response=await context.request.fetch(origin+'/api/v1'+route,{
          method:data===undefined?'GET':'POST',data,headers:{'X-Social-Claude-UI':'1'},
        });
        assert.equal(response.status(),200,route+' '+await response.text());
        return response.json();
      }
      await api('/register',{number,displayName:number,password:'synthetic-only'});
      return {number,api,page:await context.newPage()};
    }
    const a=await actor('ju_voice_one'),b=await actor('ju_voice_two');
    const direct=(await a.api('/ai-contacts/start',{number:ju,provider:'anthropic',expectedAccount:a.number,allowCloud:true})).conversation.id;
    const invite=(await a.api('/friend-requests',{number:b.number})).request.id;
    await b.api('/friend-requests/'+invite+'/accept',{});
    const group=(await a.api('/groups',{title:'橘娘媒体合成群',memberNumbers:[b.number]})).conversation.id;
    for(const [number,provider] of [[ju,'anthropic'],[AI_NUMBER,'deepseek'],[AI_DRAGON_NUMBER,'openai']]){
      await a.api('/groups/'+group+'/ai',{number,expectedAccount:a.number,enabled:true});
      for(const actor of [a,b])await actor.api('/groups/'+group+'/ai-consent',{number,provider,expectedAccount:actor.number,enabled:true});
    }
    async function chat(actor,id){await actor.page.goto(origin+'/#chat/'+id);await button(actor.page,'发送').waitFor();}
    async function send(actor,id,text,number=ju){
      const page=actor.page;
      if(id===group){
        await button(page,'群成员').click();
        await button(page,'@'+{[ju]:'橘娘',[AI_NUMBER]:'鲸鱼娘',[AI_DRAGON_NUMBER]:'龙娘'}[number]+'（AI）').click();
      }
      const result=page.waitForResponse(row=>row.request().method()==='POST'&&row.url().endsWith('/messages'));
      await page.locator('#message').fill(text);await button(page,'发送').click();
      const {reply}=await (await result).json();
      assert.equal(reply.sender.number,number,text);
      observed.push({chat:id,input:text,from:actor.number,sender:number,text:reply.text,media:reply.attachment?.type??null});
      return reply;
    }
    async function picture(actor,id,reply,asset){
      assert.equal(reply.attachment?.type,'image');
      const image=actor.page.locator('[data-image-id="'+reply.id+'"]');
      await image.click();
      const original=actor.page.locator('#dialog img.original-image');
      await expect.poll(()=>original.evaluate(node=>node.naturalWidth)).toBe(256);
      const file=await actor.page.request.get(origin+'/api/v1/conversations/'+id+'/messages/'+reply.id+'/image');
      const received=await file.body(),source=await fs.readFile(path.join(root,'social/assets/stickers',asset+'.png'));
      assert.deepEqual(received,source);
      assert.deepEqual([PNG.sync.read(received).width,PNG.sync.read(received).height],[256,256]);
      await actor.page.screenshot({path:path.join(output,asset+'.png')});
      await button(actor.page,'关闭').click();
      return sha(received);
    }
    async function choose(actor,id){
      await clickChatSetting(actor.page,'AI 音色');
      const dialog=actor.page.locator('#dialog');
      await dialog.getByLabel('角色',{exact:true}).selectOption(ju);
      await dialog.getByLabel('音色',{exact:true}).selectOption(id);
      await button(dialog,'保存音色').click();
      await expect(dialog).toContainText('已为橘娘保存音色。');
      await button(dialog,'允许本会话语音').click();
      await expect(dialog).toContainText('本会话已允许使用当前音色。');
      await button(dialog,'关闭').click();
    }
    async function audio(actor,id,reply,filename){
      assert.equal(reply.attachment?.type,'voice',JSON.stringify(reply));
      const media=await actor.page.request.get(origin+'/api/v1/conversations/'+id+'/messages/'+reply.id+'/voice',{
        headers:{'X-Social-Account':actor.number}});
      assert.equal(media.status(),200);
      const bytes=await media.body();
      assert.equal(validateAiVoice(bytes).durationMs,reply.attachment.durationMs);
      await actor.page.getByRole('button',{name:/^播放语音/}).last().click();
      await actor.page.waitForFunction(()=>document.querySelector('#inline-voice-audio')?.currentTime>0.08);
      await actor.page.screenshot({path:path.join(output,filename+'.png')});
      await fs.writeFile(path.join(output,filename+'.wav'),bytes);
      return {hash:sha(bytes),durationMs:reply.attachment.durationMs,text:reply.text};
    }

    await chat(a,direct);await chat(b,group);
    const privateSticker=await send(a,direct,'发个表情'),groupSticker=await send(b,group,'发个表情');
    const privateVoiceBefore=await send(a,direct,'发个语音'),groupVoiceBefore=await send(b,group,'发个语音');
    const directRoles=(await a.api('/conversations/'+direct+'/ai-voice')).roles;
    const groupRoles=(await b.api('/conversations/'+group+'/ai-voice')).roles;
    if(baselinePath){
      for(const reply of [privateSticker,groupSticker,privateVoiceBefore,groupVoiceBefore]){
        assert.equal(reply.text,'橘娘这轮用文字。');assert(!reply.attachment);
      }
      assert(!directRoles.some(row=>row.number===ju)&&!groupRoles.some(row=>row.number===ju));
      await expect(button(a.page,'AI 音色')).toHaveCount(0);
      await b.page.screenshot({path:path.join(output,'修前群聊只有文字.png')});
      return {observed,calls,speech,external,voiceRoles:{direct:directRoles,group:groupRoles}};
    }
    assert.match(privateVoiceBefore.text,/选个声音/u);assert.match(groupVoiceBefore.text,/选个声音/u);
    assert(directRoles.some(row=>row.number===ju)&&groupRoles.some(row=>row.number===ju));
    const art=[await picture(a,direct,privateSticker,'ju-approve'),await picture(b,group,groupSticker,'ju-annoyed')];
    art.push(await picture(a,direct,await send(a,direct,'我今天领奖啦！'),'ju-happy'));
    assert.equal(new Set(art).size,3);
    await choose(a,'mandarin-bright');await choose(b,'mandarin-soft');
    const privateAudio=await audio(a,direct,await send(a,direct,'发个语音'),'私聊当轮语音');
    const groupReply=await send(b,group,'发个语音');
    const groupAudio=await audio(b,group,groupReply,'群里当轮语音');
    assert.deepEqual(speech,[{text:'忙了一天，先喝口水吧。',id:'mandarin-bright'},
      {text:'晚上好，大家辛苦啦。',id:'mandarin-soft'}]);
    await chat(a,group);
    const peerAudio=await audio(a,group,groupReply,'另一群友播放同一语音');
    assert.deepEqual(peerAudio,groupAudio);
    const scoped=await send(a,group,'发个语音');
    assert.match(scoped.text,/音色已经选好了.*允许本会话/u);assert(!scoped.attachment);
    const written=await send(b,group,'这次只要文字，先别发语音。');
    assert.equal(written.text,'橘娘这轮用文字。');assert(!written.attachment);
    await picture(b,group,await send(b,group,'发个开心的表情',AI_NUMBER),'whale-happy');
    await picture(b,group,await send(b,group,'发个开心的表情',AI_DRAGON_NUMBER),'dragon-happy');
    assert.equal(speech.length,2);
    assert.deepEqual(external,[]);
    return {observed,calls,speech,external,art,privateAudio,groupAudio,peerAudio};
  }finally{
    if(browser)await browser.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}

run().then(value=>fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(value,null,2)+'\n'))
  .catch(error=>{console.error(error);process.exitCode=1;});
