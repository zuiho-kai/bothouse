'use strict';

const {clickChatSetting}=require('./chat-controls.cjs');

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {chromium,expect}=require('playwright/test');
const {SocialStore,AI_NUMBER,AI_DRAGON_NUMBER}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {createDeepSeekProvider}=require('../../server/ai-deepseek.cjs');
const {createOpenAIGroupProvider}=require('../../server/ai-openai.cjs');

const baseline=process.argv.includes('--baseline');
const output=path.resolve(process.argv[2]);
const ju='arcade_ju', at='好友 Claude 群';
const button=(area,name)=>area.getByRole('button',{name,exact:true});
const calls=[],external=[];
const deepseek=createDeepSeekProvider('synthetic-deepseek',{fetchImpl:async(url,init)=>{
  calls.push({provider:'deepseek',url,body:JSON.parse(init.body)});
  return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'鲸鱼替身收到了。'}}]});
}});
const openai=createOpenAIGroupProvider('synthetic-openai',{fetchImpl:async(url,init)=>{
  calls.push({provider:'openai',url,body:JSON.parse(init.body)});
  return Response.json({status:'completed',output:[{type:'message',role:'assistant',status:'completed',
    content:[{type:'output_text',text:'龙娘替身收到了。'}]}]});
}});
const claudeProvider=baseline?undefined:require('../../server/ai-claude.cjs').createClaudeProvider('synthetic-claude',{
  fetchImpl:async(url,init)=>{
    assert.equal(init.headers['x-api-key'],'synthetic-claude');
    assert.equal(init.headers['anthropic-version'],'2026-10-21');
    assert.equal(url,'https://api.anthropic.com/v1/messages');
    const body=JSON.parse(init.body);
    assert.equal(body.model,'claude-opus-5-5');
    assert.equal(body.tools,undefined);
    calls.push({provider:'anthropic',url,body});
    return Response.json({type:'message',role:'assistant',stop_reason:'end_turn',content:[
      {type:'thinking',thinking:'SYNTHETIC_RAW_THINKING'},{type:'text',text:'橘娘替身收到了。'},
    ]});
  },
});

async function run(){
  await fs.mkdir(output);
  const store=new SocialStore(path.join(output,'fixture.sqlite'));
  const server=createServer(store,{aiProvider:deepseek,claudeProvider,groupAiProviders:[deepseek,openai,claudeProvider].filter(Boolean)})
    .listen(0,'127.0.0.1');
  let browser;
  try{
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    async function actor(number,name){
      const context=await browser.newContext({viewport:{width:420,height:850},serviceWorkers:'block'});
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
      await api('/register',{number,displayName:name,password:'synthetic-claude-only'});
      return {number,api,page:await context.newPage()};
    }
    const owner=await actor('claude_owner','合成群主'), peer=await actor('claude_peer','合成群友');
    const {request}=await owner.api('/friend-requests',{number:peer.number});
    await peer.api('/friend-requests/'+request.id+'/accept',{});
    const {conversation:{id:group}}=await owner.api('/groups',{title:at,memberNumbers:[peer.number]});
    const a=owner.page,b=peer.page, dialog=page=>page.locator('#dialog');
    await a.goto(origin);
    await button(a,'通讯录').click();
    await button(a,'AI 联系人').click();
    await expect(dialog(a)).toContainText('鲸鱼娘');
    const contacts=(await owner.api('/ai-contacts')).contacts;
    await a.screenshot({path:path.join(output,'AI联系人.png')});
    async function groupSettings(page){
      if(await dialog(page).isVisible())await page.locator('#dialog-close').click();
      await page.goto(origin+'/#chat/'+group);
      await button(page,'群成员').click();
      await button(page,'群内 AI').click();
      await expect(dialog(page)).toContainText('授权只适用于');
    }
    if(baseline){
      assert.deepEqual(contacts.map(x=>x.number),[AI_NUMBER]);
      await expect(dialog(a)).not.toContainText('橘娘');
      await groupSettings(a);
      await expect(dialog(a)).not.toContainText('橘娘');
      assert.deepEqual((await owner.api('/groups/'+group+'/ai')).groupAi.available.map(role=>role.number),[AI_NUMBER,AI_DRAGON_NUMBER]);
      await a.screenshot({path:path.join(output,'群内AI.png')});
      await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify({contacts,group,claudeCalls:0,external},null,2));
      return;
    }
    assert.equal(contacts.find(row=>row.number===ju)?.provider,'anthropic');
    await owner.api('/ai-contacts/start',{number:ju,expectedAccount:owner.number,allowCloud:true,provider:'deepseek'},409);
    await owner.api('/ai-contacts/start',{number:ju,expectedAccount:owner.number,allowCloud:false,provider:'anthropic'},403);
    const contact=dialog(a).locator('.request').filter({hasText:'橘娘'});
    await expect(contact).toContainText('Claude（Anthropic）');
    await button(contact,'同意并开始私聊').click();
    await expect(a.locator('#chat-title')).toHaveText('橘娘');
    await expect(a.locator('#chat-detail')).toContainText('Claude');
    const direct=decodeURIComponent(new URL(a.url()).hash.slice(6));
    await a.locator('#message').fill('橘娘，你好，我在私聊。');
    await button(a,'发送').click();
    await expect(a.locator('#history')).toContainText('橘娘替身收到了。');
    await expect(a.locator('#history')).not.toContainText('SYNTHETIC_RAW_THINKING');
    await a.screenshot({path:path.join(output,'橘娘私聊.png')});
    await clickChatSetting(a,'关闭云聊天');
    await expect(dialog(a)).toContainText('已发送给 Claude（Anthropic）');
    await button(dialog(a),'确认关闭').click();
    await expect(a.locator('#message')).toHaveAttribute('readonly','');
    await expect(a.locator('#history')).toContainText('橘娘，你好，我在私聊。');
    await button(a,'恢复云聊天').click();
    await button(dialog(a),'同意并恢复').click();
    await a.locator('#message').fill('橘娘，恢复后重新打声招呼。');
    await button(a,'发送').click();
    await expect(a.locator('#history').getByText('橘娘替身收到了。',{exact:true})).toHaveCount(2);
    assert.deepEqual(calls[1].body.messages,[{role:'user',content:'橘娘，恢复后重新打声招呼。'}]);

    const route='/groups/'+group, feed='/conversations/'+group+'/messages';
    const edit=(role,enabled=true)=>owner.api(route+'/ai',{expectedAccount:owner.number,number:role,enabled});
    const consent=(actor,role,provider,status=200)=>actor.api(route+'/ai-consent',
      {expectedAccount:actor.number,number:role,provider,enabled:true},status);
    let seq=0;
    const send=(actor,number,text)=>actor.api(feed,{mentionAccount:number,clientId:'synthetic_ju_'+(++seq),text});
    await groupSettings(a);
    await button(dialog(a),'加入橘娘（Claude）').click();
    await expect(dialog(a)).toContainText('橘娘 · AI');
    await a.locator('#dialog-close').click();
    await edit(AI_NUMBER);await edit(AI_DRAGON_NUMBER);
    await consent(peer,AI_NUMBER,'deepseek');
    await consent(peer,AI_DRAGON_NUMBER,'openai');
    await consent(peer,ju,'deepseek',409);
    await consent(peer,ju,'openai',409);
    assert(!(await send(peer,ju,'另两个服务已同意，橘娘还没有')).reply);
    assert(!(await send(peer,owner.number,'这句点的是群主')).reply);
    assert.equal(calls.length,2);
    await groupSettings(b);
    await button(dialog(b),'同意发给 Claude（Anthropic）').click();
    await expect(dialog(b).getByText('Claude（Anthropic） · 已同意',{exact:true})).toBeVisible();
    await b.screenshot({path:path.join(output,'群友单独同意Claude.png')});
    assert(!(await send(owner,ju,'群主未替自己同意')).reply);
    let result=await send(peer,ju,'橘娘，这条只问你。');
    assert.equal(result.reply.sender.number,ju);
    assert.equal((await send(peer,AI_NUMBER,'鲸鱼，这条只问你。')).reply.sender.number,AI_NUMBER);
    assert.equal((await send(peer,AI_DRAGON_NUMBER,'龙娘，这条只问你。')).reply.sender.number,AI_DRAGON_NUMBER);
    await a.goto(origin+'/#chat/'+group);
    await expect(a.locator('#history')).toContainText('橘娘替身收到了。');
    await a.screenshot({path:path.join(output,'群友看到橘娘回话.png')});
    const row=(await owner.api(route+'/ai')).groupAi.joined.find(role=>role.number===ju);
    const {groupAi:managed}=await owner.api(route+'/ai-card',{expectedAccount:owner.number,number:ju,expectedRevision:row.roleRevision,
      card:{name:'合成群卡',description:'只供这个群',examples:'',entries:[]}});
    await owner.api(route+'/ai-lorebook',{expectedAccount:owner.number,number:ju,
      expectedRevision:managed.joined.find(role=>role.number===ju).roleRevision,
      lorebook:{name:'合成独立书',entries:[
        {keys:['泡什么茶'],content:'用深蓝杯给客人泡合成焙茶。'},
        {keys:['下雪'],content:'SYNTHETIC_UNMATCHED_BOOK_ENTRY'},
      ]}});
    result=await send(peer,ju,'你店里给客人泡什么茶？');
    assert.equal(result.reply.sender.number,ju);
    const finalBody=calls.at(-1).body;
    assert(finalBody.messages.some(row=>row.content.includes('合成群卡')));
    assert(finalBody.messages.some(row=>row.content.includes('深蓝杯')&&row.content.includes('合成焙茶')));
    assert(!JSON.stringify(finalBody).includes('SYNTHETIC_UNMATCHED_BOOK_ENTRY'));
    assert.deepEqual(calls.map(call=>call.provider),['anthropic','anthropic','anthropic','deepseek','openai','anthropic']);
    for(const {body} of calls.slice(2).filter(call=>call.provider==='anthropic'))
      assert(!/我在私聊|恢复后重新打声招呼/.test(JSON.stringify(body)));
    assert.deepEqual(external,[]);
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify({contacts,group,direct,calls,
      lastReply:result.reply,external},null,2));
  }finally{
    if(browser)await browser.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
