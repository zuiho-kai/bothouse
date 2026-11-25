'use strict';

const {clickChatSetting}=require('./chat-controls.cjs');

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
const {chromium,expect}=require('playwright/test');
const {SocialStore}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {createOpenAIGroupProvider}=require('../../server/ai-openai.cjs');
const {AI_NUMBER,AI_JU_NUMBER,AI_DRAGON_NUMBER:dragon}=require('../../server/ai-roles.cjs');
const {DEFAULT_MODEL,ENDPOINT}=require('../../../src/core/gpt-model.cjs');

const output=path.resolve(process.argv[2]);
const mode=process.argv[3];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const calls=[],voices=[],external=[];
const openaiProvider=createOpenAIGroupProvider('synthetic',{
  fetchImpl:async(url,init)=>{
    const body=JSON.parse(init.body);
    assert.equal(url,ENDPOINT);
    assert.equal(body.model,DEFAULT_MODEL);
    assert.equal(body.store,false);
    assert.deepEqual(body.tools,[]);
    assert.match(body.instructions,/当前私聊/);
    const text=body.input.at(-1).content;
    calls.push({url,body});
    return Response.json({status:'completed',output:[{type:'message',role:'assistant',status:'completed',
      content:[{type:'output_text',text:text.includes('语音')?'晚安，明天见。':'龙娘替身收到了。'}]}]});
  },
});
function wave(){
  const bytes=Buffer.alloc(32044);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length-8,4);
  bytes.write('WAVEfmt ',8); bytes.writeUInt32LE(16,16);
  bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(16000,24); bytes.writeUInt32LE(32000,28);
  bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34);
  bytes.write('data',36); bytes.writeUInt32LE(bytes.length-44,40);
  return bytes;
}
async function run(){
  await fs.mkdir(output);
  const store=new SocialStore(path.join(output,'fixture.sqlite'));
  const unexpected=async()=>{external.push('unexpected other provider');throw Error('Unexpected provider');};
  const aiProvider={name:'鲸鱼娘',provider:'deepseek',generate:unexpected};
  const claudeProvider={name:'橘娘',provider:'anthropic',generate:unexpected};
  const voiceEngine={voices:[{id:'fixture-voice',label:'合成音色'}],async render(text,id){
    voices.push({text,id}); return wave();
  }};
  const server=createServer(store,{aiProvider,claudeProvider,voiceEngine,
    openaiProvider:mode==='--unconfigured'?undefined:openaiProvider,
    groupAiProviders:mode==='--unconfigured'?[]:[openaiProvider]}).listen(0,'127.0.0.1');
  let browser;
  try{
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    async function actor(number){
      const context=await browser.newContext({viewport:{width:420,height:850}});
      await context.route('**/*',route=>{
        if(route.request().url().startsWith(origin+'/'))return route.continue();
        external.push(route.request().url());return route.abort();
      });
      async function api(route,data,status=200){
        const res=await context.request.fetch(origin+'/api/v1'+route,{method:data===undefined?'GET':'POST',data,
          headers:{'X-Social-Claude-UI':'1'}});
        assert.equal(res.status(),status,route+' '+await res.text());
        return res.json();
      }
      await api('/register',{number,displayName:number,password:'synthetic-dragon-only'});
      const page=await context.newPage();
      const contacts=async()=>{
        await page.goto(origin+'/');
        await button(page,'通讯录').click();
        await button(page,'AI 联系人').click();
        await expect(page.locator('#dialog')).toContainText('鲸鱼娘');
      };
      const start=(role,provider,status=200)=>api('/ai-contacts/start',{number:role,expectedAccount:number,
        allowCloud:true,provider},status);
      async function attachment(chat,message,type){
        const response=await context.request.get(origin+'/api/v1/conversations/'+chat+'/messages/'+message.id+'/'+type,
          {headers:{'X-Social-Account':number}});
        assert.equal(response.status(),200);
        return response.body();
      }
      return {number,api,page,contacts,start,attachment};
    }
    const a=await actor('dragon_alpha'),b=await actor('dragon_beta');
    await a.contacts();
    const contacts=(await a.api('/ai-contacts')).contacts;
    await a.page.screenshot({path:path.join(output,'AI联系人.png')});
    if(mode){
      assert.deepEqual(contacts.map(row=>row.number),[AI_NUMBER,AI_JU_NUMBER]);
      await a.start(dragon,'openai',404);
      assert.deepEqual(external,[]);
      await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify({mode,contacts,calls,external},null,2));
      return;
    }
    const {conversation:whale}=await a.start(AI_NUMBER,'deepseek');
    const {conversation:ju}=await a.start(AI_JU_NUMBER,'anthropic');
    const route=id=>'/conversations/'+id;
    await a.api(route(ju.id)+'/ai-consent',{expectedAccount:a.number,revision:0,allowCloud:false,provider:'anthropic'});
    await a.start(dragon,'anthropic',409);
    const choice={expectedAccount:a.number,number:dragon};
    const {request}=await a.api('/friend-requests',{number:b.number});
    await b.api('/friend-requests/'+request.id+'/accept',{});
    const {conversation:group}=await a.api('/groups',{title:'合成音色群',memberNumbers:[b.number]});
    const groupRoute='/groups/'+group.id;
    await a.api(groupRoute+'/ai',{...choice,enabled:true});
    await a.api(groupRoute+'/ai-consent',{...choice,enabled:true,provider:'openai'});
    await a.api(route(group.id)+'/ai-voice',{...choice,revision:null,voice:'fixture-voice'});
    async function open(actor){
      const card=actor.page.locator('#dialog .request').filter({hasText:'龙娘'});
      await expect(card).toContainText('OpenAI（GPT）');
      await button(card,'同意并开始私聊').click();
      await expect(actor.page.locator('#chat-title')).toHaveText('龙娘');
      await expect(actor.page.locator('#chat-detail')).toContainText('OpenAI');
      return decodeURIComponent(new URL(actor.page.url()).hash.slice(6));
    }
    const id=await open(a);
    await b.contacts();
    const second=await open(b);
    assert.notEqual(id,second);
    await b.api(route(id)+'/messages',undefined,404);
    await a.page.locator('#message').fill('请打字回复一下独立私聊。');
    await button(a.page,'发送').click();
    await expect(a.page.locator('#history')).toContainText('龙娘替身收到了。');
    await expect(b.page.locator('#history')).not.toContainText('请打字回复一下独立私聊。');
    await a.page.screenshot({path:path.join(output,'龙娘私聊.png')});

    const voiceRoute=route(id)+'/ai-voice';
    const role=(await a.api(voiceRoute)).roles.find(row=>row.number===dragon);
    assert.equal(role.voice,'fixture-voice');
    assert.equal(role.allowed,false);
    await a.api(voiceRoute,{...choice,revision:role.revision,scopeRevision:role.scopeRevision,action:'scope',allowed:true});
    const send=(text,number)=>a.api(route(id)+'/messages',{text,clientId:'dragon_media_'+number,aiConsentRevision:0});
    const audio=(await send('用语音回复：跟我说晚安',1)).reply;
    const sticker=(await send('发个开心的表情',2)).reply;
    assert.equal(audio.sender.number,dragon);
    assert.equal(audio.attachment.type,'voice');
    assert.deepEqual(voices,[{id:'fixture-voice',text:'晚安，明天见。'}]);
    const audioBytes=await a.attachment(id,audio,'voice');
    assert.deepEqual(audioBytes,wave());
    assert.equal(sticker.sender.number,dragon);
    assert.equal(sticker.attachment.type,'image');
    const file=await fs.readFile(path.join(__dirname,'../../assets/stickers/dragon-happy.png'));
    const stickerBytes=await a.attachment(id,sticker,'image');
    assert.deepEqual(stickerBytes,file);
    await a.page.reload();
    await expect(a.page.locator('#history')).toContainText('龙娘替身收到了。');
    await clickChatSetting(a.page,'关闭云聊天');
    await expect(a.page.locator('#dialog')).toContainText('OpenAI（GPT）');
    await button(a.page,'确认关闭').click();
    await expect(a.page.locator('#message')).toHaveAttribute('readonly','');
    const mine=(await a.api('/conversations')).conversations;
    assert.deepEqual(mine.find(row=>row.id===whale.id).cloudChat,{enabled:true,revision:0});
    assert.deepEqual(mine.find(row=>row.id===ju.id).cloudChat,{enabled:false,revision:1});
    assert.deepEqual((await b.api('/conversations')).conversations.find(row=>row.id===second).cloudChat,{enabled:true,revision:0});
    assert.equal(calls.length,2);
    assert.deepEqual(external,[]);
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify({contacts,id,second,calls,voices,
      voiceAttachment:{...audio.attachment,sha256:hash(audioBytes)},sticker:{...sticker.attachment,sha256:hash(stickerBytes)},external},null,2));
  }finally{
    if(browser)await browser.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
