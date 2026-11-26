'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {chromium,expect}=require('playwright/test');
const {SocialStore}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {moderate}=require('../../server/moderate.cjs');

async function main(){
  const output=process.argv[2]&&path.resolve(process.argv[2]);
  if(!output)throw Error('Usage: node social/client/.qa/verify-history-search.cjs <fresh-output-dir>');
  await fs.mkdir(output,{recursive:false});
  const store=new SocialStore(path.join(output,'synthetic.sqlite'));
  const server=createServer(store).listen(0,'127.0.0.1');
  let browser;
  try{
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    async function actor(number,displayName){
      const context=await browser.newContext({viewport:{width:420,height:830},serviceWorkers:'block'});
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      async function api(route,body){
        const response=await context.request.fetch(origin+'/api/v1'+route,{method:body===undefined?'GET':'POST',data:body});
        return {status:response.status(),json:await response.json()};
      }
      assert.equal((await api('/register',{number,displayName,password:'synthetic-history-only'})).status,200);
      return {number,api,context};
    }
    const a=await actor('history_alice','合成甲'), b=await actor('history_bob','合成乙');
    const request=(await a.api('/friend-requests',{number:b.number})).json.request;
    const direct=(await b.api('/friend-requests/'+request.id+'/accept',{})).json.conversation.id;
    const group=(await a.api('/groups',{title:'隔离对照群',memberNumbers:[b.number]})).json.conversation.id;
    const directPath='/conversations/'+direct,groupPath='/conversations/'+group;
    let seedId=0;
    const seed=(author,id,text)=>store.send(author.number,id,{clientId:'history_seed_'+(++seedId),text});
    for(let i=1;i<=32;i++)seed(a,direct,'锚点之前的普通来信 '+i);
    const original=seed(a,direct,'石桥旧锚点 <b>这段是普通文字</b>，靠河那侧。');
    for(let i=1;i<=26;i++)seed(a,direct,'石桥 新一些的同名匹配 '+i);
    for(let i=1;i<=61;i++)seed(a,direct,'最近的普通来信 '+i);
    const hidden=seed(a,group,'只在对照群出现的私有合成词 梨树栈台');
    const matches=(account,thread,q)=>thread+'/history-search?'+new URLSearchParams({account,q});
    assert.deepEqual((await b.api(matches(b.number,directPath,'梨树栈台'))).json.results,[]);
    assert.deepEqual((await b.api(matches(b.number,groupPath,'梨树栈台'))).json.results.map(r=>r.id),[hidden.id]);
    assert.equal((await b.api(matches(a.number,directPath,'石桥'))).status,409);
    const invalid=await b.api(directPath+'/history-search?'+new URLSearchParams({account:b.number,around:hidden.id}));
    assert.equal(invalid.status,404);

    const receiver=await b.context.newPage(), sender=await a.context.newPage();
    const directory=page=>page.locator('#directory-body');
    const threadButton=(page,number)=>directory(page).getByRole('button',{name:new RegExp(number)});
    const button=(page,name)=>page.getByRole('button',{name,exact:true});
    const quote=receiver.locator(`[data-history-message="${original.id}"]`);
    const launchSearch=async page=>{
      await button(page,'会话设置').click();
      await button(page,'搜索消息').click();
    };
    await Promise.all([receiver.goto(origin),sender.goto(origin)]);
    await threadButton(receiver,'合成甲').click();
    await threadButton(sender,'合成乙').click();
    await receiver.bringToFront();
    const receiverInput=receiver.locator('#message'),senderInput=sender.locator('#message');
    await expect(receiver.locator('#history')).toContainText('最近的普通来信 61');
    await expect(quote).toHaveCount(0);
    await expect.poll(async ()=> (await b.api(directPath)).json.conversation.unreadThrough).toBeNull();
    await receiverInput.fill('这是未发送的合成草稿');
    await launchSearch(receiver);
    const modal=receiver.getByRole('dialog');
    await modal.getByRole('searchbox',{name:'关键词'}).fill('石桥');
    await button(modal,'搜索').click();
    await expect(modal.getByRole('status')).toHaveText('已显示 20 条结果。');
    await expect(modal.getByText(/石桥旧锚点/)).toHaveCount(0);
    await button(modal,'更多结果').click();
    await expect(modal.getByRole('status')).toHaveText('已显示 27 条结果。');
    await expect(modal.getByRole('searchbox',{name:'关键词'})).toBeInViewport();
    const hit=modal.getByRole('button',{name:/旧锚点/});
    await expect(hit.locator('mark')).toHaveText('石桥');
    await expect(hit.locator('b')).toHaveCount(0);
    await receiver.screenshot({path:path.join(output,'01-search.png')});
    await hit.click();
    await expect(modal).not.toBeVisible();
    await expect(quote).toHaveClass(/history-anchor/);
    await expect(quote).toContainText(original.text);
    await expect(quote).toBeFocused();
    await expect(receiverInput).toHaveValue('这是未发送的合成草稿');
    await expect(receiver.locator('#history')).not.toContainText('最近的普通来信 61');

    const live='真实发送入口的合成新消息';
    const livePoll=receiver.waitForResponse(async response=>{
      if(!response.url().includes(directPath+'/messages?after=')||!response.ok())return false;
      return (await response.json()).messages.some(row=>row.text===live);
    });
    await senderInput.fill(live);
    await button(sender,'发送').click();
    await expect(sender.locator('#history')).toContainText(live);
    await receiver.bringToFront();
    await livePoll;
    await expect.poll(async ()=> (await b.api(directPath)).json.conversation.lastMessage.text).toBe(live);
    await expect.poll(async ()=> (await b.api(directPath)).json.conversation.unreadThrough).not.toBeNull();
    await expect(quote).toHaveClass(/history-anchor/);
    await expect(quote).toBeFocused();
    await expect(receiver.locator('#history')).not.toContainText(live);
    await receiver.screenshot({path:path.join(output,'02-original-while-receiving.png')});
    await button(receiver,'加载更早消息').click();
    await expect(receiver.locator('#history')).toContainText('锚点之前的普通来信 1');
    await expect(quote).toHaveClass(/history-anchor/);
    await button(receiver,'回到最新消息').click();
    await expect(receiver.locator('#history')).toContainText(live,{timeout:10000});
    await expect.poll(async ()=> (await b.api(directPath)).json.conversation.unreadThrough).toBeNull();
    await expect(receiverInput).toHaveValue('这是未发送的合成草稿');
    await button(receiver,'发送').click();
    await expect(sender.locator('#history')).toContainText('这是未发送的合成草稿',{timeout:10000});
    await expect(sender.locator('#history .body').filter({hasText:'这是未发送的合成草稿'})).toHaveCount(1);

    await sender.screenshot({path:path.join(output,'03-other-recipient.png')});

    const flagged=seed(a,direct,'准备测试移除的消息 纸地图');
    await launchSearch(receiver);
    await modal.getByRole('searchbox',{name:'关键词'}).fill('纸地图');
    await button(modal,'搜索').click();
    const flaggedHit=modal.getByRole('button',{name:/纸地图/});
    await expect(flaggedHit).toBeVisible();
    const report=(await b.api(directPath+'/messages/'+flagged.id+'/report',{reason:'合成移除验证'})).json.report;
    assert.equal(moderate(store,'remove',report.id).status,'removed');
    await expect(flaggedHit).toHaveCount(0,{timeout:10000});
    assert.deepEqual((await b.api(matches(b.number,directPath,'纸地图'))).json.results,[]);
    await button(modal,'关闭').click();

    const lateQuery=async route=>{
      const response=await route.fetch();
      captured();
      await hold;
      await route.fulfill({response});
    };
    let release,captured;
    const capturedRequest=new Promise(resolve=>{captured=resolve;});
    const hold=new Promise(resolve=>{release=resolve;});
    const lateURL=url=>url.pathname.endsWith(directPath+'/history-search')&&url.searchParams.get('q')==='石桥';
    await receiver.route(lateURL,lateQuery,{times:1});
    const releasedResponse=receiver.waitForResponse(response=>lateURL(new URL(response.url())));
    await launchSearch(receiver);
    try{
      await modal.getByRole('searchbox',{name:'关键词'}).fill('石桥');
      await button(modal,'搜索').click();
      await Promise.race([capturedRequest,new Promise((_,reject)=>setTimeout(()=>reject(Error('search request missing')),8000).unref())]);
      await button(modal,'关闭').click();
      await receiver.locator('#back').click();
      await directory(receiver).getByRole('button',{name:/隔离对照群/}).click();
    }finally{release();}
    assert.equal((await releasedResponse).status(),200);
    await expect(modal).not.toBeVisible();
    await expect(receiver.locator('#history')).not.toContainText('旧锚点');
    await receiver.unroute(lateURL,lateQuery);
    await launchSearch(receiver);
    await receiver.getByRole('searchbox',{name:'关键词'}).fill('石桥');
    await button(receiver.getByRole('dialog'),'搜索').click();
    await expect(receiver.getByRole('dialog').getByRole('status')).toHaveText('没找到相关消息。');
    await button(receiver,'关闭').click();
    const removed=await a.api('/groups/'+group+'/remove',{number:b.number});
    assert.equal(removed.status,200);
    assert([403,404].includes((await b.api(matches(b.number,groupPath,'梨树栈台'))).status));
    assert.equal((await a.api('/groups/'+group+'/members',{memberNumbers:[b.number]})).status,200);
    assert.deepEqual((await b.api(matches(b.number,groupPath,'梨树栈台'))).json.results,[]);
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify({
      baseline:'2a99420e71e9bc47640f695d7e6ad3b8a3a23078',
      historySeed:'synthetic store fixtures only',screenshots:3,visibleWindows:0,modelRequests:0,
      checks:{originalInitiallyUnloaded:true,literalMarks:true,resultsAcrossTwoPages:27,
        originalAndOlderContext:true,liveReceiveAndReadWatermark:true,repliesBothDirections:true,
        draftWhileLocatingAndSending:true,conversationAndAccountIsolation:true,groupRemovalAndRejoinFloor:true,
        moderatorRemovalCleansOpenResults:true,lateResultAfterSwitchDiscarded:true}
    },null,2)+'\n');
    console.log('PASS: two independent browsers/accounts, historical original, real live delivery, draft and visibility.');
  }finally{
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
