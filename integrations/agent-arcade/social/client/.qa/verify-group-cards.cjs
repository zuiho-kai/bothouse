'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {chromium,expect}=require('playwright/test');
const {PNG}=require('pngjs');
const {SocialStore,AI_NUMBER}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {createDeepSeekProvider}=require('../../server/ai-deepseek.cjs');

// Only the native picker's reviewed result is substituted here. The click in
// the social view traverses the shipping preload; no bridge exists in the
// ordinary web context. The native review itself has its own host test.
const card={name:'禾川',description:'我在老街开了一家茶店。',examples:'我慢慢泡，你坐会儿。',
  entries:[{keys:['茶'],content:'我给客人泡焙茶，用厚胎陶杯。'}]};
const question='你店里给客人泡什么茶？';
const originalReply='我还没有开茶店。';
const button=(page,name)=>page.getByRole('button',{name,exact:true});

async function main(){
  if(process.argv.length!==3)throw Error('Usage: node verify-group-cards.cjs NEW_OUTPUT_DIRECTORY');
  const out=path.resolve(process.argv[2]);
  await fs.mkdir(out);
  const store=new SocialStore(path.join(out,'synthetic.sqlite'));
  const requests=[],saves=[],pickerCalls=[],pageErrors=[],external=[];
  let pendingPick;
  const provider=createDeepSeekProvider('synthetic-key',{fetchImpl:async(_url,init)=>{
    const wire=JSON.parse(init.body);
    requests.push(wire);
    const projected=wire.messages.find(item=>item.role==='user'&&item.content.startsWith('{"publicGroupCharacter"'));
    const background=projected&&JSON.parse(projected.content).publicGroupCharacter.background;
    const reply=background?.[0]??originalReply;
    return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:reply}}]});
  }});
  const server=createServer(store,{aiProvider:provider}).listen(0,'127.0.0.1');
  let browser;
  try{
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    const preload=await fs.readFile(path.join(__dirname,'../../windows/privacy-preload.cjs'),'utf8');
    async function actor(number,desktop){
      const ctx=await browser.newContext({viewport:{width:390,height:820},serviceWorkers:'block'});
      await ctx.route('**/*',route=>{
        if(route.request().url().startsWith(origin+'/'))return route.continue();
        external.push(route.request().url());return route.abort();
      });
      if(desktop){
        await ctx.exposeBinding('fixturePick',(_source,channel,target)=>{
          assert.equal(channel,'arcade:pickGroupCard');pickerCalls.push(target);
          if(pendingPick){pendingPick.started.resolve();return pendingPick.result.promise;}
          return card;
        });
        await ctx.addInitScript({content:'(function(require,process){'+preload+'})(()=>({ipcRenderer:{invoke:window.fixturePick}}),{isMainFrame:true});'});
      }
      const page=await ctx.newPage();
      page.on('pageerror',e=>pageErrors.push(e.message));
      page.on('request',r=>{if(r.url().endsWith('/ai-card')&&r.method()==='POST')saves.push(r.postDataJSON());});
      async function api(url,data){
        const response=await ctx.request.fetch(origin+'/api/v1'+url,{method:data===undefined?'GET':'POST',data});
        assert.equal(response.status(),200,url);return response.json();
      }
      await api('/register',{number,displayName:number,password:'synthetic only'});
      return {ctx,page,api,number};
    }
    const owner=await actor('group_owner',true), peer=await actor('group_peer',false);
    const req=await owner.api('/friend-requests',{number:peer.number});
    await peer.api('/friend-requests/'+req.request.id+'/accept',{});
    const {conversation:{id}}=await owner.api('/groups',{title:'老街茶话会',memberNumbers:[peer.number]});
    await owner.api('/groups/'+id+'/ai',{expectedAccount:owner.number,number:AI_NUMBER,enabled:true});
    await peer.api('/groups/'+id+'/ai-consent',{expectedAccount:peer.number,provider:'deepseek',number:AI_NUMBER,enabled:true});
    const chat=origin+'/#chat/'+id;
    await owner.page.goto(chat);await peer.page.goto(chat);
    async function groupAi(page){
      await button(page,'群成员').click();await button(page,'群内 AI').click();
      await expect(page.locator('#dialog-body')).toContainText('鲸鱼娘');
    }
    async function settings(page){
      await groupAi(page);
      await button(page,'本群角色卡').click();
    }
    await groupAi(peer.page);
    await expect(button(peer.page,'本群角色卡')).toHaveCount(0);
    await peer.page.locator('#dialog-close').click();
    await settings(owner.page);
    const select=button(owner.page,'从本机角色库选择'), save=button(owner.page,'保存到本群');
    await select.click();
    await expect(owner.page.locator('#dialog-body')).toContainText(card.entries[0].content);
    assert.deepEqual(pickerCalls.map(({groupId,roleId})=>({groupId,roleId})),[{groupId:id,roleId:AI_NUMBER}]);
    assert.equal(saves.length,0);assert.equal(requests.length,0);
    await owner.page.screenshot({path:path.join(out,'群主预览.png')});
    await save.click();
    await expect(owner.page.getByRole('status').filter({hasText:'已保存。'})).toBeVisible();
    assert.deepEqual(saves.map(req=>req.card),[card]);
    await owner.page.screenshot({path:path.join(out,'群主已保存.png')});
    async function ask(expected){
      await button(peer.page,'群成员').click();
      await button(peer.page,'@鲸鱼娘（AI）').click();
      await peer.page.locator('#message').fill(question);
      await button(peer.page,'发送').click();
      await expect(peer.page.locator('#history')).toContainText(expected);
      await expect(owner.page.locator('#history')).toContainText(expected);
    }
    await ask(card.entries[0].content);
    await peer.page.screenshot({path:path.join(out,'群友收到禾川台词.png')});
    await button(owner.page,'切回搭档原设定').click();
    await button(owner.page,'取消更改').click();
    assert.equal(saves.length,1);
    await expect(owner.page.locator('#dialog-body')).toContainText('当前：禾川');
    await button(owner.page,'切回搭档原设定').click();
    await save.click();
    await expect(owner.page.locator('#dialog-body')).toContainText('当前：搭档原设定');
    await expect(owner.page.getByRole('status').filter({hasText:'已保存。'})).toBeVisible();
    await ask(originalReply);
    assert.equal(requests.length,2);
    assert(requests[0].messages.some(row=>row.content.includes(card.entries[0].content)));
    assert(!requests[1].messages.some(row=>row.content.includes('禾川')||row.content.includes('焙茶')));
    assert.deepEqual(saves.map(req=>req.card),[card,null]);
    // A second owner tab changed the binding after this preview was opened.
    // Re-reading the active card must discard the stale draft.
    await select.click();
    await expect(save).toBeVisible();
    const current=(await owner.api('/groups/'+id+'/ai')).groupAi.joined[0];
    const other={...card,name:'秋灯',entries:[]};
    await owner.api('/groups/'+id+'/ai-card',{expectedAccount:owner.number,number:AI_NUMBER,expectedRevision:current.roleRevision,card:other});
    await save.click();
    await expect(owner.page.locator('#dialog-body')).toContainText('请重新查看当前设置');
    assert.equal((await owner.api('/groups/'+id+'/ai')).groupAi.joined[0].card.name,'秋灯');
    await button(owner.page,'重新查看群内 AI').click();
    await button(owner.page,'本群角色卡').click();
    await expect(owner.page.locator('#dialog-body')).toContainText('当前：秋灯');
    // If the chat changes while the native picker is open, discard its result.
    const next=(await owner.api('/groups',{title:'另一个群',memberNumbers:[peer.number]})).conversation.id;
    await owner.api('/groups/'+next+'/ai',{expectedAccount:owner.number,number:AI_NUMBER,enabled:true});
    pendingPick={started:Promise.withResolvers(),result:Promise.withResolvers()};
    await select.click();
    await pendingPick.started.promise;
    await owner.page.evaluate(next=>{location.hash='#chat/'+next;},next);
    await expect(owner.page.locator('#chat-title')).toHaveText('另一个群');
    await settings(owner.page);
    pendingPick.result.resolve(card);
    await expect(owner.page.locator('#dialog-body')).toContainText('当前：搭档原设定');
    await expect(save).toHaveCount(0);
    assert.equal((await owner.api('/groups/'+next+'/ai')).groupAi.joined[0].card,null);
    assert.equal(saves.length,3);
    pendingPick={started:Promise.withResolvers(),result:Promise.withResolvers()};
    await select.click();
    await pendingPick.started.promise;
    const target=pickerCalls.at(-1);
    assert.equal(target.groupId,next);
    // Rehearse the renderer receiving only the native save receipt.
    const portrait=new PNG({width:2,height:2});
    portrait.data.fill(120);
    await owner.api('/groups/'+next+'/ai-card',{expectedAccount:owner.number,number:AI_NUMBER,
      expectedRevision:target.roleRevision,card,portrait:PNG.sync.write(portrait).toString('base64')});
    pendingPick.result.resolve({portraitSaved:true});
    await expect(owner.page.locator('#dialog-body')).toContainText('绘图卡面 · 已批准');
    await owner.page.screenshot({path:path.join(out,'群卡面已批准.png')});
    await button(owner.page,'撤销绘图卡面').click();
    await button(owner.page,'取消更改').click();
    await expect(owner.page.locator('#dialog-body')).toContainText('绘图卡面 · 已批准');
    await button(owner.page,'撤销绘图卡面').click();
    await save.click();
    await expect(owner.page.locator('#dialog-body')).toContainText('绘图卡面 · 未批准');
    const unshared=(await owner.api('/groups/'+next+'/ai')).groupAi.joined[0];
    assert.equal(unshared.portraitApproved,false);
    assert.deepEqual(unshared.card,card);
    assert.equal(saves.length,4);
    await owner.page.screenshot({path:path.join(out,'群卡面已撤销.png')});
    assert.deepEqual(pageErrors,[]);assert.deepEqual(external,[]);
    await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify({
      group:id,role:AI_NUMBER,viewport:'390x820',grantedMember:peer.number,pickerCalls,saves,
      requests,peerReplies:[card.entries[0].content,originalReply],nonOwnerCanEdit:false,
      staleSaveRejected:true,otherGroupRetainedOriginal:true,
      externalRequests:external,pageErrors,
      fixture:'Real client, social preload, local HTTP/SQLite and provider request builder. Native picker return and provider text are synthetic.'
    },null,2));
    console.log('Group card preview, save, peer question, cancel and restore passed; two local provider captures.');
  }finally{
    await browser?.close();
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
