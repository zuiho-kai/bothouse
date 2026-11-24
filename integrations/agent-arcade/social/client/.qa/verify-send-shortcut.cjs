'use strict';
const assert=require('node:assert/strict');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');
const source=process.env.SOCIAL_SHORTCUT_SOURCE||path.resolve(__dirname,'../..');
const {SocialStore}=require(path.join(source,'server/store.cjs'));
const {createServer}=require(path.join(source,'server/http.cjs'));

const btn=(page,name)=>page.getByRole('button',{name,exact:true});
async function register(browser,origin,number){
  const context=await browser.newContext({baseURL:origin,serviceWorkers:'block',viewport:{width:980,height:810}});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page=await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(origin);
  await btn(page,'创建账号').click();
  await page.locator('[name=number]').fill(number);
  await page.locator('[name=displayName]').fill(number);
  await page.locator('[name=password]').fill('synthetic-shortcut-password');
  await page.locator('#auth-submit').click();
  await page.locator('#directory-title').getByText('消息',{exact:true}).waitFor();
  return page;
}
async function api(page,route,data){
  const res=await page.request.fetch('/api/v1'+route,{method:data===undefined?'GET':'POST',data});
  assert.equal(res.status(),200);
  return res.json();
}
const rows=async (page,id)=>(await api(page,'/conversations/'+id+'/messages')).messages.map(row=>row.text);
async function sent(page,action){
  const incoming=page.waitForResponse(res=>res.request().method()==='POST'&&res.url().endsWith('/messages'));
  await action();
  assert.equal((await incoming).status(),200);
  await page.waitForFunction(()=>document.querySelector('#message').value==='');
}
async function main(){
  const store=new SocialStore(':memory:');
  const server=createServer(store).listen(0,'127.0.0.1');
  let browser;
  try{
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    const [a,b]=await Promise.all(['keys_author','keys_reader'].map(number=>register(browser,origin,number)));
    const {request}=await api(a,'/friend-requests',{number:'keys_reader'});
    const {conversation:direct}=await api(b,'/friend-requests/'+request.id+'/accept',{});
    const {conversation:group}=await api(a,'/groups',{title:'发送键验收群',memberNumbers:['keys_reader']});
    const evidence={};
    for(const scope of [direct,group]){
      await Promise.all([a,b].map(page=>page.goto(origin+'/#chat/'+scope.id)));
      await a.locator('#chat-title').getByText(scope.type==='direct'?'keys_reader':scope.title,{exact:true}).waitFor();
      await a.locator('#composer').waitFor({state:'visible'});
      const editor=a.locator('#message');
      if(process.argv.includes('--baseline')){
        await editor.fill('普通回车');
        await editor.press('Enter');
        assert.equal(await editor.inputValue(),'普通回车\n');
        assert.deepEqual(await rows(b,scope.id),[]);
        await sent(a,()=>btn(a,'发送').click());
        assert.deepEqual(await rows(b,scope.id),['普通回车']);
        evidence[scope.type]='Enter inserts a newline; only the click delivered a message';
        continue;
      }
      await editor.fill('第一行');
      await editor.press('Shift+Enter');
      await a.keyboard.insertText('第二行');
      assert.equal(await editor.inputValue(),'第一行\n第二行');
      assert.deepEqual(await rows(b,scope.id),[]);
      await sent(a,()=>editor.press('Enter'));

      await editor.fill('中文候选');
      await editor.evaluate(node=>{
        const key=options=>node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...options}));
        node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
        key({});
        key({isComposing:true});
        node.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中文候选'}));
        key({});
        node.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true}));
      });
      await editor.evaluate(node=>{
        const key=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
        Object.defineProperty(key,'keyCode',{value:229});
        node.dispatchEvent(key);
      });
      assert.equal(await editor.inputValue(),'中文候选');
      assert.deepEqual(await rows(b,scope.id),['第一行\n第二行']);
      await sent(a,()=>editor.press('Enter'));

      await a.evaluate(()=>window.dispatchEvent(new CustomEvent('arcade-social-send-shortcut',{detail:'ctrl-enter'})));
      await btn(a,'发送').getAttribute('aria-keyshortcuts').then(value=>assert.equal(value,'Control+Enter'));
      await editor.fill('换行首行');
      await editor.press('Enter');
      await a.keyboard.insertText('换行次行');
      await editor.press('Control+Shift+Enter');
      await a.keyboard.insertText('换行末行');
      assert.equal(await editor.inputValue(),'换行首行\n换行次行\n换行末行');
      assert.equal((await rows(b,scope.id)).length,2);
      await sent(a,()=>editor.press('Control+Enter'));
      await editor.fill('按钮发送');
      await sent(a,()=>btn(a,'发送').click());
      evidence[scope.type]=await rows(b,scope.id);
      assert.deepEqual(evidence[scope.type],['第一行\n第二行','中文候选','换行首行\n换行次行\n换行末行','按钮发送']);
      await b.locator('#history').getByText('按钮发送',{exact:true}).waitFor();
      await a.evaluate(()=>window.dispatchEvent(new CustomEvent('arcade-social-send-shortcut',{detail:'enter'})));
    }
    const result={...(process.argv.includes('--baseline')?{}:{
      ime:'synthetic compositionstart/end, isComposing and Windows keyCode 229; real keyboard for later Enter',
    }),...evidence};
    if(process.env.SOCIAL_SHORTCUT_RECEIPT)await fs.writeFile(process.env.SOCIAL_SHORTCUT_RECEIPT,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
