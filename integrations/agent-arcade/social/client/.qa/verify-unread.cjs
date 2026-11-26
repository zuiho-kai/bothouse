'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {chromium,expect}=require('playwright/test');
const {SocialStore}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');

const password='synthetic-unread-only';
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const feed=id=>'/conversations/'+id+'/messages';
const baseline=process.argv[3]==='baseline';
const output=process.argv[2]&&path.resolve(process.argv[2]);
const input=process.argv[3]&&!baseline?path.resolve(process.argv[3]):null;

async function main(){
  if(!output)throw Error('Usage: node social/client/.qa/verify-unread.cjs <new-output-dir> [baseline|legacy-output-dir]');
  await fs.mkdir(output);
  const database=path.join(output,'fixture.sqlite');
  let fixture;
  if(input){
    await fs.copyFile(path.join(input,'fixture.sqlite'),database);
    fixture=JSON.parse(await fs.readFile(path.join(input,'receipt.json'),'utf8')).fixture;
  }
  const store=new SocialStore(database);
  const server=createServer(store).listen(0,'127.0.0.1');
  let browser;
  try{
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    async function actor(number,name){
      const context=await browser.newContext({viewport:{width:390,height:820},serviceWorkers:'block'});
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      async function api(route,data,status=200){
        const res=await context.request.fetch(origin+'/api/v1'+route,{method:data===undefined?'GET':'POST',data});
        assert.equal(res.status(),status,route);return res.json();
      }
      await api(input?'/login':'/register',{number,password,...(!input&&{displayName:name})});
      return {api,context,number};
    }
    const viewer=await actor('unread_viewer','测试收件人');
    const a=await actor('unread_same_a','同名小林'),b=await actor('unread_same_b','同名小林');
    let seq=0;
    async function send(actor,id,text){
      return (await actor.api(feed(id),{clientId:(baseline?'before_':'after_')+String(++seq).padStart(5,'0'),text})).message;
    }
    async function addFriend(actor){
      const {request}=await viewer.api('/friend-requests',{number:actor.number});
      return (await actor.api('/friend-requests/'+request.id+'/accept',{})).conversation.id;
    }
    if(!fixture){
      const first=await addFriend(a),second=await addFriend(b);
      const group=(await viewer.api('/groups',{title:'合成周末群',memberNumbers:[a.number,b.number]})).conversation.id;
      fixture={first,second,group};
      const seeded=[
        [first,await send(a,first,'旧档里已有寒暄')],
        [second,await send(b,second,'旧档里已有问候')],
      ];
      // A standalone run seeds already-read conversations. The legacy-input
      // run below exercises the real upgrade of an existing database.
      if(!baseline)for(const [id,message] of seeded)
        await viewer.api('/conversations/'+id+'/read',{expectedAccount:viewer.number,through:message.id});
    }
    const {first,second,group}=fixture;
    let page=await viewer.context.newPage();
    const directory=()=>page.locator('#directory-body');
    const firstRow=()=>directory().getByRole('button',{name:/unread_same_a/});
    const secondRow=()=>directory().getByRole('button',{name:/unread_same_b/});
    const groupRow=()=>directory().getByRole('button',{name:/合成周末群/});
    const badge=row=>row.locator('.row-unread');
    const pictured=async(name)=>page.screenshot({path:path.join(output,name+'.png')});
    const controls=[];
    const back=()=>page.getByRole('button',{name:/^返回(?:，|$)/u});
    const messageTab=()=>page.getByRole('button',{name:/^消息(?:，|$)/u});
    let legacyShell;
    await page.goto(origin);
    await expect(firstRow()).toBeVisible();
    if(!baseline){
      await expect(directory().getByText('旧档里已有寒暄')).toBeVisible();
      await expect(directory().locator('.row-unread')).toHaveCount(0);
      controls.push(input?'原版已有消息在首次升级后可见，未计作未读':'既有已读消息可见，未计作未读');
    }
    await firstRow().click();
    await expect(page.locator('#history')).toContainText('旧档里已有寒暄');
    const dm=await send(b,second,baseline?'旧版验证的私聊新句':'新版验证的私聊新句');
    const gm=await send(a,group,baseline?'旧版验证的群中新句':'新版验证的群中新句');
    if(!baseline){
      await expect(back()).toHaveAccessibleName('返回，2 个其他未读会话');
      await expect(back().locator('#back-message-count')).toHaveText('2');
    }
    await back().click();
    if(!baseline)await expect(messageTab()).toHaveAccessibleName('消息，2 个未读会话');
    await expect(secondRow()).toContainText(dm.text);
    await expect(groupRow()).toContainText(gm.text);
    const threads=await viewer.api('/conversations');
    if(baseline){
      assert(threads.conversations.every(row=>!Object.keys(row).some(key=>/unread|readThrough/i.test(key))));
      assert.doesNotMatch(await directory().innerText(),/未读/);
      await pictured('旧版列表无未读');
    }else{
      await expect(badge(secondRow())).toHaveText('未读');
      await expect(badge(groupRow())).toHaveText('未读');
      await expect(badge(firstRow())).toHaveCount(0);
      await pictured('私聊与群未读');
      await expect(secondRow()).toHaveAccessibleName(/unread_same_b.*未读/u);
      await page.close();
      const offline=await send(b,second,'窗口关闭期间的新句');
      page=await viewer.context.newPage();
      await page.goto(origin);
      await expect(secondRow()).toContainText(offline.text);
      await expect(badge(secondRow())).toHaveText('未读');
      await expect(badge(groupRow())).toHaveText('未读');
      const fromOtherDevice=await send(viewer,first,'自己在另一端发的消息');
      await expect(firstRow()).toContainText(fromOtherDevice.text);
      await expect(badge(firstRow())).toHaveCount(0);
      const ownAroundUnread=await send(viewer,second,'发给还没有打开的会话');
      await expect(secondRow()).toContainText(ownAroundUnread.text);
      await expect(badge(secondRow())).toHaveText('未读');
      const reopenedStore=new SocialStore(database);
      try{
        assert.equal(reopenedStore.conversation(viewer.number,second).unreadThrough,offline.id);
        assert.equal(reopenedStore.conversation(viewer.number,group).unreadThrough,gm.id);
      }finally{reopenedStore.db.close();}
      await pictured('重开保留未读');
      controls.push('关闭窗口期间的私聊和未打开的群仍未读，同名朋友与自己的发送分别处理');

      // Freeze the initial B history response, insert another message, then
      // release the already-read snapshot. The read write must name that snapshot.
      const frozen=Promise.withResolvers(),resume=Promise.withResolvers();
      const initial=origin+'/api/v1'+feed(second)+'?limit=50&removedAfter=latest';
      await page.route(initial,async route=>{
        const result=await route.fetch();
        frozen.resolve();
        await resume.promise;
        await route.fulfill({response:result});
      },{times:1});
      await page.route(url=>url.pathname==='/api/v1'+feed(second)&&url.searchParams.has('after'),route=>route.abort());
      const receipt=page.waitForResponse(response=>response.url()===origin+'/api/v1/conversations/'+second+'/read'&&response.ok());
      await secondRow().click();
      await frozen.promise;
      const racing=await send(b,second,'打开对话后才到的新一句');
      resume.resolve();
      await expect(page.locator('#history')).toContainText(offline.text);
      assert.equal((await receipt).request().postDataJSON().through,offline.id);
      await back().click();
      await expect(secondRow()).toContainText(racing.text);
      await expect(badge(secondRow())).toHaveText('未读');
      await expect(badge(groupRow())).toHaveText('未读');
      await pictured('打开时新消息仍未读');
      await secondRow().click();
      await expect(page.locator('#history')).toContainText(racing.text);
      await back().click();
      await expect(badge(secondRow())).toHaveCount(0);
      await expect(badge(groupRow())).toHaveText('未读');
      await groupRow().click();
      await expect(page.locator('#history')).toContainText(gm.text);
      await back().click();
      await expect(directory().locator('.row-unread')).toHaveCount(0);
      await pictured('打开后清除对应未读');
      controls.push('手机宽度下只清已展示的消息，后来的一条及另一个群继续未读，逐一打开后清除');
      const bogus=await viewer.api('/conversations/'+first+'/read',{expectedAccount:viewer.number,through:racing.id},404);
      assert(bogus.error);
      await viewer.api('/conversations/'+second+'/read',{expectedAccount:b.number,through:racing.id},409);
      const stale=await viewer.api('/conversations/'+second+'/read',{expectedAccount:viewer.number,through:offline.id});
      assert.equal(stale.readThrough,racing.id);
      const rejoin=(await b.api('/groups',{title:'重入时的可见边界',memberNumbers:[viewer.number]})).conversation.id;
      const previous=await send(b,rejoin,'离开之前的旧消息');
      assert.equal((await viewer.api('/conversations/'+rejoin)).conversation.unreadThrough,previous.id);
      await b.api('/groups/'+rejoin+'/remove',{number:viewer.number});
      await viewer.api('/conversations/'+rejoin,undefined,404);
      await b.api('/groups/'+rejoin+'/members',{memberNumbers:[viewer.number]});
      assert.equal((await viewer.api('/conversations/'+rejoin)).conversation.unreadThrough,null);
      await viewer.api('/conversations/'+rejoin+'/read',{expectedAccount:viewer.number,through:previous.id},404);
      const rejoined=await send(b,rejoin,'重新入群后的新消息');
      assert.equal((await viewer.api('/conversations/'+rejoin)).conversation.unreadThrough,rejoined.id);
      controls.push('SQLite 重开保留未读，本人回复不清他人消息，迟到已读写入不后退，重入按本次可见边界计算');

      // Emulate the cached document from before the unread navigation update.
      // Only the HTML response is changed. The browser requests the actual
      // client script and API from the same running service and origin.
      const legacyPage=await viewer.context.newPage();
      await legacyPage.route(origin+'/',async route=>{
        const response=await route.fetch();
        const html=(await response.text())
          .replace(/<small id="message-count"[^>]*><\/small>/u,'')
          .replace(/ <small id="back-message-count"[^>]*><\/small>/u,'');
        await route.fulfill({response,body:html});
      },{times:1});
      const script=legacyPage.waitForResponse(response=>response.url()===origin+'/app.js'&&response.ok());
      const identity=legacyPage.waitForResponse(response=>response.url()===origin+'/api/v1/me');
      const pageErrors=[];
      legacyPage.on('pageerror',error=>pageErrors.push(error.message));
      await legacyPage.goto(origin);
      await script;
      const me=await identity;
      assert.equal(me.status(),200);
      assert.equal((await me.json()).user.number,viewer.number);
      await expect(legacyPage.locator('#message-count, #back-message-count')).toHaveCount(0);
      const legacyRow=legacyPage.locator('#directory-body').getByRole('button',{name:/unread_same_a/});
      try{
        await expect(legacyRow).toBeVisible();
      }catch(error){
        const status=await legacyPage.locator('#auth-error, #sync-status').allTextContents();
        throw Error('Existing account cannot open a chat with the legacy document: '+JSON.stringify({identityStatus:me.status(),status,pageErrors}),{cause:error});
      }

      const recipient=await a.context.newPage();
      await recipient.goto(origin);
      await recipient.locator('#directory-body').getByRole('button',{name:/^测试收件人/u}).click();
      await expect(recipient.locator('#history')).toContainText('旧档里已有寒暄');
      await legacyRow.click();
      await expect(legacyPage.locator('#history')).toContainText('旧档里已有寒暄');
      const text='旧首页加载新版脚本后发出的一条消息';
      const sendUrl=origin+'/api/v1'+feed(first);
      const posts=[];
      legacyPage.on('request',request=>{
        if(request.method()==='POST'&&request.url()===sendUrl)posts.push(request.postDataJSON());
      });
      const posted=legacyPage.waitForResponse(response=>response.url()===sendUrl&&response.request().method()==='POST');
      await legacyPage.locator('#message').fill(text);
      await button(legacyPage,'发送').click();
      const ack=await posted;
      assert.equal(ack.status(),200);
      const {message}=await ack.json();
      const received=recipient.locator('#history').getByText(text,{exact:true});
      await expect(received).toBeVisible();
      await expect(received).toHaveCount(1);
      const copies=(await a.api(feed(first))).messages.filter(item=>item.text===text);
      assert.deepEqual(copies.map(item=>[item.id,item.sender.number]),[[message.id,viewer.number]]);
      assert.deepEqual(posts.map(post=>post.text),[text]);
      assert.deepEqual(pageErrors,[]);
      legacyShell={script:new URL((await script).url()).pathname,missingBadgeNodes:2,identityStatus:me.status(),
        sentBy:viewer.number,receivedBy:a.number,messageId:message.id,posts:posts.length,copies:copies.length};
      await recipient.screenshot({path:path.join(output,'旧首页发送对端收件.png')});
    }
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify({baseline,fixture,controls,legacyShell,
      previewIds:[dm.id,gm.id],list:await directory().innerText(),externalRequests:0},null,2)+'\n');
  }finally{
    if(browser)await browser.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
