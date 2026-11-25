'use strict';

const assert=require('node:assert/strict');
const {createServer}=require('../../server/http.cjs');
const {SocialStore}=require('../../server/store.cjs');
const {chromium}=require('playwright');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const path=require('node:path');

const btn=(page,name)=>page.getByRole('button',{name,exact:true});
const password='synthetic test password';
const generic='当前状态已变化，或这个用户号已被使用。请刷新后重试。';
const post=(page,route)=>page.waitForResponse(row=>row.request().method()==='POST'&&row.url().endsWith(route));
async function submit(page,route){
  const response=post(page,route);
  await page.locator('#auth-submit').click();
  return response;
}
async function main(){
  const output=process.argv[2];
  const baseline=process.argv.includes('--baseline');
  await fs.mkdir(output,{recursive:true});
  const store=new SocialStore(path.join(output,'fixture.sqlite'));
  const server=createServer(store).listen(0,'127.0.0.1');
  await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    const pages=await Promise.all([0,1,2].map(async()=>{
      const page=await browser.newPage({baseURL:origin,serviceWorkers:'block'});
      await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      await page.goto('/');
      return page;
    }));
    const [a,b,login]=pages;
    async function registerForm(page,number,name){
      await btn(page,'创建账号').click();
      await page.locator('[name=number]').fill(number);
      await page.locator('[name=displayName]').fill(name);
      await page.locator('[name=password]').fill(password);
    }
    await registerForm(a,'first_alice','合成甲');
    assert((await submit(a,'/register')).ok());
    await registerForm(b,'first_alice','合成乙');
    const dupe=await submit(b,'/register');
    assert.equal(dupe.status(),409);
    assert.equal((await dupe.json()).error.code,'number_taken');
    const expectedRegistration=baseline?generic:'这个用户号已被使用，请换一个用户号再试。';
    await b.locator('#auth-error').getByText(expectedRegistration,{exact:true}).waitFor();
    assert.equal(await b.locator('[name=displayName]').inputValue(),'合成乙');
    if(!baseline)assert(await b.locator('[name=number]').evaluate(node=>document.activeElement===node));
    await b.screenshot({path:path.join(output,'注册提示.png')});
    await b.locator('[name=number]').fill('first_bravo');
    assert((await submit(b,'/register')).ok());
    await b.getByRole('heading',{name:'消息',exact:true}).waitFor();
    await login.locator('[name=number]').fill('first_alice');
    await login.locator('[name=password]').fill('synthetic wrong password');
    const wrong=await submit(login,'/login');
    assert.equal(wrong.status(),401);
    await login.locator('#auth-error').getByText(/密码/u).waitFor();
    async function find(page,number){
      await btn(page,'添加朋友').click();
      await page.getByLabel('对方的用户号').fill(number);
      await btn(page,'查找').click();
      await btn(page,'发送好友请求').waitFor();
    }
    await find(a,'first_bravo'); // Keep the stale search result open.
    await find(b,'first_alice');
    const sent=post(b,'/friend-requests');
    await btn(b,'发送好友请求').click();
    assert((await sent).ok());
    const conflict=post(a,'/friend-requests');
    await btn(a,'发送好友请求').click();
    const response=await conflict;
    assert.equal(response.status(),409);
    assert.equal((await response.json()).error.code,'incoming_request');
    const proof={registration:expectedRegistration,nicknamePreserved:true,wrongPassword:wrong.status(),
      wrongPasswordText:await login.locator('#auth-error').textContent(),incomingStatus:response.status()};
    if(baseline){
      await a.locator('#dialog-error').getByText(generic,{exact:true}).waitFor();
      proof.incoming=generic;
    }else{
      await a.locator('#dialog').getByText('对方已向你发来好友请求。',{exact:true}).waitFor();
      await a.screenshot({path:path.join(output,'原地处理申请.png')});
      await btn(a,'接受').click();
      await a.locator('#chat-title').getByText('合成乙',{exact:true}).waitFor();
      const chat=a.url().split('#chat/')[1];
      await btn(b,'关闭').click();
      await b.goto('/#chat/'+chat);
      await b.locator('#chat-title').getByText('合成甲',{exact:true}).waitFor();
      async function message(sender,receiver,text){
        await sender.locator('#message').fill(text);
        await btn(sender,'发送').click();
        await receiver.locator('#history').getByText(text,{exact:true}).waitFor();
      }
      await message(a,b,'甲发乙收');
      await message(b,a,'乙发甲收');
      proof.friendChat=chat;
      proof.bothReceived=['甲发乙收','乙发甲收'];
      await b.screenshot({path:path.join(output,'好友双向消息.png')});
    }
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(proof,null,2)+'\n');
    console.log(proof);
  }finally{
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
