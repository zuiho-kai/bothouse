'use strict';
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');

const output=process.argv[2];
assert(output,'Supply an isolated output directory.');
const root=path.resolve(process.argv[3]||path.join(__dirname,'../../..'));
const baseline=process.argv[4]==='baseline';
const fromRoot=file=>require(path.join(root,file));
const {SocialStore}=fromRoot('social/server/store.cjs');
const {createServer}=fromRoot('social/server/http.cjs');
const {createAzureVoice}=fromRoot('social/server/ai-voice-azure.cjs');
const {previewGroupCard,selectGroupCard}=fromRoot('src/core/store-group-card-picker.cjs');
const store=new SocialStore(':memory:');
const wires=[], audio=[], errors=[], external=[], bridgeCalls=[];
const delayed=Promise.withResolvers(), release=Promise.withResolvers();
const cardData=setup=>({
  name:'本机卡名',description:setup,exampleDialogue:'本机卡名：我在整理路线。',
  creatorNotes:'PRIVATE_CREATOR_42',systemPrompt:'PRIVATE_SYSTEM_42',
  characterBook:{entries:[
    {enabled:true,keys:['雾铃'],content:setup+'的雾铃设定'},
    {enabled:true,keys:['雾铃'],content:'NOT_CHOSEN_CARD_42'},
    {enabled:false,keys:['雾铃'],content:'DISABLED_CARD_42'},
  ]},
});
const projection=text=>selectGroupCard(previewGroupCard({get:()=>cardData(text)},'0000000000000001'),[0]);
const book=previewGroupCard({get:()=>({name:'信使簿',characterBook:{entries:[
  {enabled:true,keys:['费米站'],content:'费米站的钥匙放在纸盒里'},
  {enabled:true,keys:['费米站'],content:'NOT_CHOSEN_BOOK_42'},
]}})},'0000000000000002');
const bookProjection={name:book.name,entries:[book.entries[0]]};
const speech=createAzureVoice('fixtureeast','fixture-only',{fetchImpl:async(_url,{body})=>{
  audio.push(body);
  return new Response(Buffer.alloc(32000,7),{headers:{'Content-Type':'application/octet-stream'}});
}});
const server=createServer(store,{voiceEngine:speech,personalAiFetch:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');
  const owner={'Bearer fixture-a':'a','Bearer fixture-b':'b'}[options.headers.Authorization];
  assert(owner);
  const {input,instructions,tools,tool_choice:choice}=JSON.parse(options.body);
  assert.deepEqual(tools,[]);assert.equal(choice,'none');
  const prompt=input.at(-1).content;
  let visible;
  try{visible=JSON.parse(input[0].content).publicGroupCharacter;}catch{}
  wires.push({owner,instructions,input});
  if(prompt==='请等一等再说你的背景'){delayed.resolve(options.signal);await release.promise;}
  const response=visible?visible.name+'：我叫'+visible.name+'。'+(visible.description||'我是群里的搭档。'):'我是龙娘。';
  return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:response}]}]});
}});
const btn=(page,name)=>page.getByRole('button',{name,exact:true});
async function run(){
  await fs.mkdir(output,{recursive:true});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  let browser;
  const receipt={ok:false,baseline};
  try{
    const preload=await fs.readFile(path.join(root,'social/windows/privacy-preload.cjs'),'utf8');
    browser=await chromium.launch({channel:'msedge',headless:true,
      args:['--disable-background-networking','--disable-sync','--proxy-server=http://127.0.0.1:1']});
    async function account(id,cardChoices){
      const ctx=await browser.newContext({viewport:{width:id.endsWith('a')?740:380,height:820},serviceWorkers:'block'});
      const page=await ctx.newPage();
      page.setDefaultTimeout(10000);
      await ctx.route('**/*',route=>{
        if(route.request().url().startsWith(base+'/'))return route.continue();
        external.push(new URL(route.request().url()).origin);
        return route.abort();
      });
      page.on('pageerror',error=>errors.push(error.message));
      await page.exposeFunction('reviewSyntheticProfile',async input=>{
        bridgeCalls.push({account:id,input});
        assert.equal(input.scope,'personal');assert.equal(input.groupId,'');
        const target=await api('/personal-ai/profile');
        assert.equal(target.profile.owner,id);assert.equal(target.profile.number,input.roleId);
        assert.equal(target.profile.profileRevision,input.roleRevision||null);
        if(input.kind==='lorebook')return bookProjection;
        assert(cardChoices.length);
        return cardChoices.shift();
      });
      await ctx.addInitScript(value=>{
        const require=()=>({ipcRenderer:{invoke:(channel,input)=>{
          if(channel==='arcade:pickGroupCard')return window.reviewSyntheticProfile(input);
        }}});
        Function('require','process',value)(require,{isMainFrame:true,argv:[]});
      },preload);
      await page.goto(base);
      await btn(page,'创建账号').click();await page.locator('[name=number]').fill(id);
      await page.locator('[name=displayName]').fill(id);await page.locator('[name=password]').fill(randomUUID());
      await page.locator('#auth-submit').click();await page.locator('#workspace').waitFor();
      async function api(route,data,status=200){
        const response=data===undefined?await ctx.request.get(base+'/api/v1'+route):
          await ctx.request.post(base+'/api/v1'+route,{data});
        assert.equal(response.status(),status,route);
        return response.json();
      }
      async function personal(){
        await page.goto(base);await page.getByRole('button',{name:/通讯录/}).click();
        await btn(page,'AI 联系人').click();
        await page.getByRole('button',{name:/^我的群? AI$/u}).click();
      }
      await personal();
      await page.getByLabel(/^(?:AI 昵称|群昵称)$/u).fill('雁汀');
      await page.getByLabel('角色与服务').selectOption('arcade_dragon');
      await page.getByLabel('本人的 API key').fill(id.endsWith('a')?'fixture-a':'fixture-b');
      await btn(page,'绑定我的 AI').click();
      await page.getByText(/雁汀 · ai_.*已连接/).waitFor();
      return {id,page,api,personal,bot:(await api('/personal-ai')).identity};
    }

    const a=await account('role_scope_a',[projection('修南堤潮汐钟'),projection('守北岬纸灯塔')]);
    const b=await account('role_scope_b',[projection('在山城绘制铁路图')]);
    const friend=(await a.api('/friend-requests',{number:b.id})).request;
    await b.api('/friend-requests/'+friend.id+'/accept',{});
    const room=(await a.api('/groups',{title:'雁汀群卡对照',memberNumbers:[b.id]})).conversation.id;
    const group='/groups/'+room+'/personal-ai';
    const thread='/conversations/'+room;
    const row=(view,number)=>view.roles.find(item=>item.number===number);
    const edit=(actor,action,bot,extra)=>actor.api(group,{action,expectedAccount:actor.id,number:bot.number,revision:bot.revision,...extra});
    for(const [owner,speaker] of [[a,b],[b,a]]){
      const pending=row(await edit(owner,'invite',owner.bot),owner.bot.number);
      const joined=row(await edit(a,'accept',pending),owner.bot.number);
      await edit(speaker,'share',joined,{provider:'openai',enabled:true,sharingRevision:null});
    }
    async function say(actor,recipient,text){
      const page=actor.page;
      await page.goto(base+'/#chat/'+room);await page.reload();
      await btn(page,'点名群成员').click();
      const member=page.locator('#dialog-body .request').filter({hasText:recipient.bot.number});
      await btn(member,'@雁汀（AI）').click();
      assert.match(await page.locator('#message').inputValue(),/^@雁汀/u);
      await page.keyboard.insertText(text);
      const reply=page.waitForResponse(response=>response.url().endsWith(thread+'/messages')&&response.request().method()==='POST');
      await btn(page,'发送').click();
      const response=await reply;
      assert.equal(response.status(),200);
      assert.equal(response.request().postDataJSON().mentionAccount,recipient.bot.number);
      return response.json();
    }
    const uncased=await say(b,a,'你是谁？你的背景？');
    if(baseline){
      assert.equal(await a.page.getByRole('button',{name:'公开角色设定'}).count(),0);
      assert.equal(wires.length,1);
      assert.deepEqual(wires[0].input,[{role:'user',content:'你是谁？你的背景？'}]);
      assert.match(wires[0].instructions,/龙娘/u);
      assert.equal(uncased.reply.text,'我是龙娘。');
      Object.assign(receipt,{ok:true,baselineReply:uncased.reply.text,wires});
      return;
    }
    assert.match(uncased.reply.text,/^我叫雁汀/u);
    assert.equal(JSON.parse(wires[0].input[0].content).publicGroupCharacter.description,'');
    async function profileTo(actor,action,save=true){
      await actor.personal();
      const settings=actor.page.getByRole('button',{name:/^(?:公开)?角色设定$/u});
      const usesScopes=await settings.textContent()==='角色设定';
      await settings.click();
      if(usesScopes)await btn(actor.page,'群聊角色设定').click();
      await btn(actor.page,action).click();
      const confirmation=btn(actor.page,action.startsWith('撤回')?'确认撤回':'确认分享给获准加入的群');
      await confirmation.waitFor();
      if(!save){await btn(actor.page,'取消更改').click();return;}
      await confirmation.click();
      await actor.page.getByText(/已保存，下次该 AI/u).waitFor();
    }
    await profileTo(a,'从本机角色库选择');
    await profileTo(a,'从本机世界书库选择');
    await a.page.screenshot({path:path.join(output,'approved-profile.png')});
    await profileTo(b,'从本机角色库选择');
    const owned=(await a.api('/personal-ai/profile')).profile;
    await b.api('/personal-ai/profile',{expectedAccount:b.id,number:a.bot.number,expectedRevision:owned.profileRevision,card:null},409);
    const replyA=await say(b,a,'雾铃和费米站，你是谁？');
    const replyB=await say(a,b,'你的背景和费米站是什么？');
    assert.equal(replyA.reply.sender.number,a.bot.number);assert.equal(replyB.reply.sender.number,b.bot.number);
    assert.match(replyA.reply.text,/^我叫雁汀。修南堤潮汐钟/u);
    assert.match(replyB.reply.text,/^我叫雁汀。在山城绘制铁路图/u);
    assert.match(JSON.stringify(wires[1].input),/雾铃设定|费米站的钥匙/u);
    assert.equal(wires[1].input.length,3);
    assert.match(JSON.stringify(wires[1].input),/修南堤潮汐钟的雾铃设定/u);
    assert.match(JSON.stringify(wires[1].input),/费米站的钥匙放在纸盒里/u);
    assert.doesNotMatch(JSON.stringify(wires[2].input),/南堤|纸盒/u);

    const waiting=b.api(thread+'/messages',{clientId:randomUUID(),text:'请等一等再说你的背景',mentionAccount:a.bot.number});
    const guard=await Promise.race([delayed.promise,new Promise((_,reject)=>{
      setTimeout(()=>reject(Error('Expected model request did not start')),5000).unref();
    })]);
    await profileTo(a,'从本机角色库选择');
    assert.equal(guard.aborted,true);
    release.resolve();
    assert.equal((await waiting).reply,undefined);
    const updated=await say(b,a,'你现在做什么？');
    assert.match(updated.reply.text,/守北岬纸灯塔/u);
    assert.doesNotMatch(JSON.stringify(wires.at(-1).input),/南堤|钥匙/u);

    const voice='/conversations/'+room+'/ai-voice';
    await a.api('/personal-ai/voice',{expectedAccount:a.id,number:a.bot.number,revision:null,voice:'azure-xiaoxiao'});
    const sound=(await b.api(voice)).roles.find(person=>person.number===a.bot.number);
    await b.api(voice,{expectedAccount:b.id,number:a.bot.number,action:'scope',allowed:true,revision:sound.revision,scopeRevision:null});
    const spoken=await say(b,a,'用语音解释你的背景');
    assert.equal(spoken.reply.attachment?.type,'voice');
    assert.match(audio.at(-1),/>我叫雁汀。守北岬纸灯塔<\/voice>/u);
    assert.doesNotMatch(audio.at(-1),/雁汀：|龙娘/u);

    await profileTo(a,'撤回公开世界书');
    await profileTo(a,'撤回公开角色卡');
    const revoked=await say(b,a,'费米站的背景是什么？');
    assert.match(revoked.reply.text,/^我叫雁汀/u);
    assert.doesNotMatch(JSON.stringify(wires.at(-1).input),/北岬|钥匙/u);
    for(const request of wires){
      assert.doesNotMatch(JSON.stringify(request),/PRIVATE_|NOT_CHOSEN_|DISABLED_CARD_|本机卡名/u);
      assert.match(request.instructions,/第一人称|AI 主人/u);
      assert(!request.instructions.includes('你是龙娘'));
    }
    assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
    Object.assign(receipt,{ok:true,ownerIsolation:true,nicknameWithoutCard:true,bookKeywordAndSelections:true,
      staleReplyDropped:true,spokenFirstPerson:true,revokedBackToNickname:true,wires,audio,bridgeCalls,errors,external});
  }catch(error){receipt.error=error.message;throw error;}
  finally{
    release.resolve();
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));store.db.close();
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
