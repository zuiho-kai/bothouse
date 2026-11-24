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
  if(!output)throw Error('Usage: node social/client/.qa/verify-message-replies.cjs <fresh-output-dir>');
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
    const pages=await Promise.all([a.context.newPage(),b.context.newPage()]);
    await Promise.all(pages.map(page=>page.goto(origin)));
    const directory=page=>page.locator('#directory-body');
    const open=async(page,label)=>{
      if(await page.locator('#back').isVisible())await page.locator('#back').click();
      await directory(page).getByRole('button',{name:new RegExp(label)}).click();
      await expect(page.locator('#chat-title')).toHaveText(label);
    };
    const send=async(page,text)=>{
      await page.locator('#message').fill(text);
      await page.locator('#composer').getByRole('button',{name:'发送',exact:true}).click();
      await expect(page.locator('#history .body').filter({hasText:text})).toBeVisible();
    };
    const runs=[];
    for(const [index,room] of [directPath,groupPath].entries()){
      const [writer,reader]=pages;
      const title=index?'隔离对照群':null;
      await open(writer,title||'合成乙');await open(reader,title||'合成甲');
      const originalText=index?'南门的集合安排定了吗？':'周六下午两点，在图书馆门口碰头。';
      const answer=index?'定了，按这一条走。':'好，我会提前到。';
      await send(writer,originalText);
      const original=reader.locator('article').filter({has:reader.locator('.body',{hasText:originalText})});
      await original.getByRole('button',{name:'消息操作'}).click();
      await reader.getByRole('button',{name:'回复',exact:true}).click();
      await expect(reader.locator('#reply-target')).toContainText(originalText);
      const post=reader.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith(room+'/messages'));
      await send(reader,answer);
      const attempt=(await post).postDataJSON();
      const result=await b.api(room+'/messages',attempt);
      assert.equal(result.status,200);
      const sent=result.json.message;
      assert.deepEqual(sent.quote,{id:attempt.replyTo,name:'合成甲',text:originalText});
      for(const page of pages){
        const bubble=page.locator('[data-history-message="'+sent.id+'"]');
        await expect(bubble.locator('.message-quote')).toHaveText('合成甲'+originalText,{timeout:12000});
        await expect(bubble.locator('.body')).toHaveText(answer);
        await bubble.locator('.message-quote').click();
        await expect(page.locator('[data-history-message="'+attempt.replyTo+'"]')).toBeFocused();
        await page.getByRole('button',{name:'回到最新消息'}).click();
      }
      await writer.screenshot({path:path.join(output,index?'02-group.png':'01-direct.png')});
      const rows=(await b.api(room+'/messages')).json.messages;
      assert.equal(rows.filter(row=>row.clientId===attempt.clientId).length,1);
      const internal=store.history(b.number,sent.conversationId,new URLSearchParams()).find(row=>row.id===sent.id);
      assert.equal(internal.quote,undefined);
      runs.push({room:index?'group':'direct',original:attempt.replyTo,reply:sent.id,attempt,originalText,
        senderAndRecipientOpened:true,oneStoredMessage:true});
    }
    const dm=runs[0],g=runs[1];
    // An old original is loaded through the authenticated history window after a cold page reload.
    for(let i=0;i<55;i++)store.send(a.number,direct,{clientId:'padding_'+i,text:'合成分页 '+i});
    assert.equal((await b.api(directPath+'/messages',{clientId:'late_quote_nonce',replyTo:dm.original,text:'补充这条安排'})).status,200);
    await open(pages[0],'合成乙');await pages[0].reload();
    await expect(pages[0].locator('#chat-title')).toHaveText('合成乙');
    await expect(pages[0].locator('[data-history-message="'+dm.original+'"]')).toHaveCount(0);
    await pages[0].locator('.message-quote').filter({hasText:dm.originalText}).click();
    await expect(pages[0].locator('[data-history-message="'+dm.original+'"]')).toBeFocused();
    await pages[0].screenshot({path:path.join(output,'03-older-original.png')});
    const invalid=await b.api(groupPath+'/messages',{clientId:'wrong_chat_nonce',text:'跨会话对照',replyTo:dm.original});
    assert.equal(invalid.json.error.code,'reply_unavailable');
    const report=(await a.api(groupPath+'/messages/'+g.original+'/report',{reason:'合成移除测试'})).json.report;
    assert.equal(moderate(store,'remove',report.id).status,'removed');
    const tombstone=pages[1].locator('[data-history-message="'+g.reply+'"] .message-quote');
    await expect(tombstone).toHaveText('原消息已移除或不可查看',{timeout:12000});
    assert.deepEqual((await b.api(groupPath+'/messages',g.attempt)).json.message.quote,{unavailable:true});
    assert.equal((await b.api(groupPath+'/messages',{...g.attempt,clientId:'removed_new_nonce'})).json.error.code,'reply_unavailable');
    const floorOriginal=(await a.api(groupPath+'/messages',{clientId:'before_rejoin',text:'入群前的合成内容'})).json.message;
    assert.equal((await a.api('/groups/'+group+'/remove',{number:b.number})).status,200);
    assert.equal((await a.api('/groups/'+group+'/members',{memberNumbers:[b.number]})).status,200);
    const later=(await a.api(groupPath+'/messages',{clientId:'after_rejoin',text:'新消息',replyTo:floorOriginal.id})).json.message;
    assert.equal(later.quote.text,floorOriginal.text);
    const visible=(await b.api(groupPath+'/messages')).json.messages;
    assert.deepEqual(visible.find(row=>row.id===later.id).quote,{unavailable:true});
    assert(!JSON.stringify(visible).includes(floorOriginal.text));
    assert.equal((await b.api(groupPath+'/history-search?account='+b.number+'&around='+floorOriginal.id)).status,404);
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify({baseline:'1b65c89302b938bdeccb9309a95d9c3cb157138c',
      runs:runs.map(({room,original,reply,senderAndRecipientOpened,oneStoredMessage})=>
        ({room,original,reply,senderAndRecipientOpened,oneStoredMessage})),
      olderOriginalAfterReload:true,crossChatRejected:true,liveRemovalCleared:true,
      retryAfterRemovalReturnsOriginal:true,rejoinHidesSource:true,modelHistoryContainsNoQuotePreview:true,
      actors:2,realCloudRequests:0,visibleWindows:0},null,2));
    console.log('PASS: direct and group replies, both browsers, cold jump, nonce, removal and membership floor.');
  }finally{
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
