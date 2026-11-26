'use strict';

const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {once}=require('node:events');
const {chromium,expect}=require('playwright/test');
const {SocialStore,AI_NUMBER}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {createDeepSeekProvider}=require('../../server/ai-deepseek.cjs');
const root=path.resolve(__dirname,'../../..');
const output=path.resolve(process.argv[2]);
const baseline=process.argv.includes('--baseline');
const button=(area,name)=>area.getByRole('button',{name,exact:true});
const chatId=page=>new URL(page.url()).hash.slice(6);

async function run(){
  fs.mkdirSync(output,{recursive:true});
  let client;
  if(baseline){
    const archive=path.join(output,'baseline.tar');
    execFileSync('git',['-C',root,'archive','--output='+archive,'7323e7f35eaf86d24abc056a14b85fb23d4832b3','social/client'],{windowsHide:true});
    execFileSync('tar',['-xf',archive,'-C',output],{windowsHide:true});
    client=path.join(output,'social/client');
  }
  const store=new SocialStore(path.join(output,'synthetic.sqlite')),calls=[],external=[],errors=[];
  const aiProvider=createDeepSeekProvider('synthetic-only',{fetchImpl:async(url,init)=>{
    assert.equal(url,'https://api.deepseek.com/chat/completions');
    const payload=JSON.parse(init.body);
    const group=payload.messages[0].content.includes('多人群');
    calls.push({group});
    return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',
      content:group?'好呀，雨要是停了，我们就沿河走。':'可以呀，带上上次没读完的那本。'}}]});
  }});
  const server=createServer(store,{client,aiProvider}).listen(0,'127.0.0.1');
  let browser;
  try{
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    async function actor(number,name,touch){
      const context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1152,height:820},
        hasTouch:touch,isMobile:touch,deviceScaleFactor:1,serviceWorkers:'block'});
      await context.route(/^https?:/u,route=>{
        if(route.request().url().startsWith(origin+'/'))return route.continue();
        external.push(route.request().url());return route.abort();
      });
      const page=await context.newPage();
      page.on('pageerror',error=>errors.push(error.message));
      if(!touch){
        const me=origin+'/api/v1/me';
        await page.route(me,route=>route.fulfill({status:503,json:{error:'service_unavailable'}}),{times:1});
        await page.goto(origin);
        await expect(page.locator('#auth-error')).toHaveText('服务暂时不可用，请稍后再试。');
        await page.screenshot({path:path.join(output,'01-冷启动连接错误.png')});
      }
      await page.goto(origin);
      await expect(page.getByRole('heading',{name:'登录',exact:true})).toBeVisible();
      if(!touch)await page.screenshot({path:path.join(output,'02-冷开登录.png')});
      await button(page,'创建账号').click();
      await page.locator('[name=number]').fill(number);
      await page.locator('[name=displayName]').fill(name);
      await page.locator('[name=password]').fill('synthetic-access-only');
      await page.locator('#auth-submit').click();
      await expect(page.locator('#directory-title')).toHaveText('消息');
      async function api(route){return (await context.request.get(origin+'/api/v1'+route)).json();}
      return {number,name,page,api};
    }
    const owner=await actor('proof_linshan','林杉',false),peer=await actor('proof_youxia','柚夏',true);
    const a=owner.page,b=peer.page;
    const shot=(page,file)=>page.screenshot({path:path.join(output,file+'.png')});
    async function jump(page,id){await page.goto(origin+'/#chat/'+id);await expect(page.locator('#composer')).toBeVisible();}
    async function send(page,message,{keyboard=false}={}){
      const pending=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/messages'));
      const editor=page.locator('#message');
      await editor.fill(message);
      if(keyboard)await editor.press('Enter');else await button(page,'发送').click();
      const response=await pending;
      assert.equal(response.status(),200);
      const result=await response.json();
      assert.equal(result.message.text,message);
      await expect(page.locator('#history')).toContainText(message);
      return result;
    }
    await button(a,'添加朋友').click();
    await a.getByLabel('对方的用户号').fill(peer.number);
    await button(a,'查找').click();
    await button(a,'发送好友请求').click();
    await expect(a.locator('#dialog')).toContainText('已发送好友请求');
    await a.keyboard.press('Escape');
    await button(b,'通讯录').tap();
    await button(b,'新的朋友（1）').tap();
    await button(b,'接受').tap();
    await expect(b.locator('#chat-title')).toHaveText(owner.name);
    const direct=chatId(b);
    await send(b,'周六上午十点，河边那家书店见？');
    await jump(a,direct);
    await expect(a.locator('#history')).toContainText('周六上午十点');
    await send(a,'好呀，我把那本书带上。',{keyboard:true});
    await shot(a,'03-真人私聊-宽窗');
    await button(a,'发起群聊').click();
    await a.getByLabel('群名称').fill('周末读书局');
    await a.getByRole('checkbox',{name:/柚夏/u}).check();
    await button(a,'创建群聊').click();
    await expect(a.locator('#chat-title')).toHaveText('周末读书局');
    const group=chatId(a);
    await send(a,'我先订两杯咖啡，读完再去河边散步。');
    await jump(b,group);
    await expect(b.locator('#history')).toContainText('读完再去河边散步');
    await send(b,'好，我去借一本新的诗集。');
    await button(a,'群成员').click();await button(a,'群内 AI').click();
    await button(a,'加入鲸鱼娘（DeepSeek）').click();
    await expect(a.locator('#dialog')).toContainText('鲸鱼娘 · AI');
    const approval=a.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/ai-consent'));
    await button(a,'同意发给 DeepSeek').click();
    assert.equal((await approval).status(),200);
    await a.keyboard.press('Escape');
    await jump(a,group);
    await (baseline?button(a,'群成员'):button(a,'点名群成员')).click();
    await button(a,'@鲸鱼娘（AI）').click();
    await send(a,'如果天气好，读完一起去散步吗？',{keyboard:true});
    await expect(a.locator('#history')).toContainText('我们就沿河走');
    await shot(a,'04-群聊与AI-宽窗');
    await expect(b.locator('#history')).toContainText('我们就沿河走');
    await shot(b,'05-群聊-窄窗');
    const selected=b.locator('#history article').filter({hasText:'我先订两杯咖啡'});
    if(!baseline){
      assert.equal(await b.locator('#history').getByRole('button',{name:'举报消息'}).count(),0);
      await button(selected,'消息操作').tap();
      await expect(b.locator('#message-actions')).toBeVisible();
      await shot(b,'06-触屏消息操作');
      await button(b,'举报消息').tap();
      await expect(b.locator('#dialog blockquote')).toHaveText('我先订两杯咖啡，读完再去河边散步。');
      await b.getByLabel('举报原因').fill('合成验收，只送这一条');
      const report=b.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/report'));
      await button(b,'提交举报').tap();
      assert.equal((await report).status(),200);
      await expect(b.locator('#dialog')).toContainText('举报回执');
      await button(b,'关闭').tap();
      await button(b,'返回').tap();
      await expect(b.locator('.directory')).toBeVisible();
      await expect(b.locator('[data-chat-id="'+group+'"]').first()).toBeFocused();
      await expect(b.locator('#history')).toBeHidden();
      await shot(b,'06a-返回会话列表');
    }
    await button(a,'通讯录').click();
    await button(a,'AI 联系人').click();
    await button(a,'同意并开始私聊').click();
    await expect(a.locator('#chat-title')).toHaveText('鲸鱼娘');
    const ai=chatId(a);
    await send(a,'周六读书会要带什么？');
    await expect(a.locator('#history')).toContainText('上次没读完的那本');
    if(!baseline){
      const portrait=a.locator('#chat-avatar img');
      await expect.poll(()=>portrait.evaluate(node=>node.naturalWidth)).toBe(160);
      const received=a.locator('#history article').filter({hasText:'上次没读完的那本'});
      await button(received,'消息操作').focus();
      await a.keyboard.press('Enter');
      await expect(button(a,'举报消息')).toBeVisible();
      await a.keyboard.press('Escape');
      await expect(button(received,'消息操作')).toBeFocused();
      await shot(a,'07-AI私聊-宽窗');
      await button(a,'会话设置').focus();await a.keyboard.press('Enter');
      await expect(button(a,'关闭云聊天')).toBeVisible();
      await expect(button(a,'AI 音色')).toBeVisible();
      await expect(button(a,'主动联系')).toBeVisible();
      await expect(button(a,'约定提醒')).toBeVisible();
      await shot(a,'08-会话设置');
    }else await shot(a,'07-AI私聊-宽窗');
    await button(a,'关闭云聊天').click();
    await button(a,'确认关闭').click();
    await expect(a.locator('#message')).toHaveAttribute('readonly','');
    await expect(button(a,'恢复云聊天')).toBeVisible();
    const cloud=(await owner.api('/conversations/'+ai)).conversation.cloudChat;
    assert.equal(cloud.enabled,false);
    await shot(a,'09-关闭云聊天');
    for(const label of ['好友动态','我','消息'])await button(a,label).click();
    await expect(a.locator('#directory-title')).toHaveText('消息');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    assert.deepEqual(calls,[{group:true},{group:false}]);
    fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify({baseline,direct,group,ai,
      nativeSendByKeyboard:true,cloudWithdrawn:!cloud.enabled,reportViaTouch:!baseline,
      desktop:[1152,820],narrow:[390,844],errors,external,calls},null,2)+'\n');
  }finally{
    if(browser)await browser.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}

run().catch(error=>{console.error(error);process.exitCode=1;});
