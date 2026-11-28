'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fork}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require('playwright');
const runtime=path.resolve(__dirname,'../../server/main.cjs');
const tempRoot=fs.realpathSync.native(os.tmpdir()),temp=fs.mkdtempSync(path.join(tempRoot,'arcade-social-client-'));
const screenshots=__dirname;
const runs=[];
let worker,browser,origin;
const errors=[];
async function start(){
  worker=fork(runtime,[],{env:{...process.env,SOCIAL_HOST:'127.0.0.1',SOCIAL_PORT:'0',SOCIAL_DB:path.join(temp,'qa.sqlite'),SOCIAL_PUBLIC_ORIGIN:''},windowsHide:true,silent:true});
  worker.stderr.on('data',buf=>process.stderr.write(buf));
  const [{port}]=await Promise.race([once(worker,'message'),once(worker,'exit').then(([code])=>{throw Error('Server exited '+code);})]);
  origin='http://127.0.0.1:'+port;
  assert.equal((await fetch(origin+'/healthz')).status,200);
}
function record(check){runs.push(check);}
async function page(viewport,isMobile=false){
  const context=await browser.newContext({viewport,isMobile,hasTouch:isMobile,deviceScaleFactor:1,serviceWorkers:'block'});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const p=await context.newPage();
  p.on('pageerror',error=>errors.push(error.message));
  await p.goto(origin);
  return {context,page:p};
}
const password='synthetic-only-password';
const btn=(p,name)=>p.getByRole('button',{name,exact:true});
const visible=locator=>locator.waitFor({state:'visible'});
async function register(p,profile){
  await visible(p.getByRole('heading',{name:'登录',exact:true}));
  await btn(p,'创建账号').click();
  await visible(p.getByRole('heading',{name:'创建账号',exact:true}));
  await btn(p,'已有账号，去登录').click();
  await visible(p.getByRole('heading',{name:'登录',exact:true}));
  await btn(p,'创建账号').click();
  await p.locator('[name=number]').fill(profile.number);
  await p.locator('[name=displayName]').fill(profile.name);
  await p.locator('[name=password]').fill(password);
  await p.locator('#auth-submit').click();
  await visible(p.getByRole('heading',{name:'消息',exact:true}));
}
async function login(p,profile){
  await p.locator('[name=number]').fill(profile.number);
  await p.locator('[name=password]').fill(password);
  await btn(p,'登录').click();
  await visible(p.getByRole('heading',{name:'消息',exact:true}));
}
async function friend(sender,receiver,source,dest){
  await btn(sender,'添加朋友').click();
  await sender.getByLabel('对方的用户号').fill(dest.number);
  await btn(sender,'查找').click();
  await visible(sender.getByText(dest.name,{exact:true}));
  await btn(sender,'发送好友请求').click();
  await visible(sender.getByText('已发送好友请求。',{exact:true}));
  await btn(sender,'关闭').click();
  await receiver.locator('[data-tab=contacts]').click();
  await receiver.getByRole('button',{name:'新的朋友（1）',exact:true}).click();
  await visible(receiver.getByText(source.name,{exact:true}));
  await btn(receiver,'接受').click();
  await visible(receiver.locator('#chat-title').getByText(source.name,{exact:true}));
}
async function send(p,text){
  await p.getByRole('textbox',{name:'消息内容'}).fill(text);
  await btn(p,'发送').click();
  await visible(p.locator('#history').getByText(text,{exact:true}));
}
async function main(){
  await start();
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args:['--disable-background-networking','--disable-component-update','--disable-sync']});
  const A={number:'qa_muqing',name:'木青'}, B={number:'qa_linshan',name:'林杉'}, C={number:'qa_xiaoman',name:'小满'};
  const a=await page({width:1280,height:800}),b=await page({width:375,height:760},true),c=await page({width:390,height:780},true);
  for(const [who,profile] of [[a,A],[b,B],[c,C]])await register(who.page,profile);
  await btn(a.page,'我').click();
  await visible(a.page.getByText('我的用户号 '+A.number,{exact:true}));
  await btn(a.page,'消息').click();
  await friend(a.page,b.page,A,B);
  await a.page.getByRole('button',{name:/林杉/}).click();
  const directA='周六见，河边书店门口。', directB='好，我带那本新书。';
  await send(a.page,directA);
  await visible(b.page.locator('#history').getByText(directA,{exact:true}));
  await send(b.page,directB);
  await visible(a.page.locator('#history').getByText(directB,{exact:true}));
  record('独立登录会话下按用户号查找、发送并接受好友请求，两个账号双向私聊');
  await b.page.screenshot({path:path.join(screenshots,'mobile-chat-375.png')});
  await btn(a.page,'消息').click();
  await friend(a.page,c.page,A,C);
  await btn(a.page,'发起群聊').click();
  await a.page.getByLabel('群名称').fill('周末读书局');
  await a.page.getByLabel('林杉（qa_linshan）').check();
  await btn(a.page,'创建群聊').click();
  await visible(a.page.locator('#chat-title').getByText('周末读书局',{exact:true}));
  const early='这条在小满入群前发出。';
  await send(a.page,early);
  await btn(a.page,'群成员').click();
  await btn(a.page,'添加成员').click();
  await a.page.getByLabel('小满（qa_xiaoman）').check();
  await btn(a.page,'添加成员').click();
  await visible(a.page.getByText('3 位群成员',{exact:true}));
  await btn(c.page,'返回').click();
  await c.page.getByRole('button',{name:/周末读书局/}).click();
  await visible(c.page.locator('#chat-title').getByText('周末读书局',{exact:true}));
  assert.equal(await c.page.getByText(early,{exact:true}).count(),0);
  const later='欢迎小满，星期六上午十点见。';
  await send(a.page,later);
  await visible(c.page.locator('#history').getByText(later,{exact:true}));
  await send(c.page,'收到，我会准时到。');
  await visible(a.page.locator('#history').getByText('收到，我会准时到。',{exact:true}));
  record('从通讯录勾选建群，在已有群添加第三位好友，入群后双向收发');
  await a.page.screenshot({path:path.join(screenshots,'desktop-group-1280.png')});
  const chatUrl=a.page.url();
  await a.page.reload();
  await visible(a.page.locator('#history').getByText(later,{exact:true}));
  assert.equal(a.page.url(),chatUrl);
  const privateDraft='未发送的私聊草稿';
  await b.page.locator('#message').fill(privateDraft);
  await btn(b.page,'返回').click();
  await btn(b.page,'我').click();
  await btn(b.page,'退出登录').click();
  await visible(b.page.getByRole('heading',{name:'登录',exact:true}));
  assert.equal(await b.page.locator('#auth-submit').textContent(),'登录');
  assert.equal(await b.page.locator('#name-field').isHidden(),true);
  assert.equal(await b.page.locator('[name=password]').getAttribute('autocomplete'),'current-password');
  const loggedOut=await b.page.evaluate(()=>({body:document.body.textContent,draft:document.querySelector('#message').value,hash:location.hash}));
  assert(!loggedOut.body.includes(directA)&&!loggedOut.body.includes(directB)&&!loggedOut.body.includes(B.number));
  assert.deepEqual([loggedOut.draft,loggedOut.hash],['','']);
  await login(b.page,C);
  assert.equal(await b.page.getByText(directA,{exact:true}).count(),0);
  await btn(b.page,'我').click();
  await btn(b.page,'退出登录').click();
  await visible(b.page.getByRole('heading',{name:'登录',exact:true}));
  record('首次可显式切换注册与登录，首次注册后退出默认登录，清除前账号正文、草稿和会话地址，换号无串档');
  await login(b.page,B);
  await b.page.getByRole('button',{name:/木青/}).click();
  await visible(b.page.locator('#history').getByText(directA,{exact:true}));
  await visible(b.page.locator('#history').getByText(directB,{exact:true}));
  assert.equal(await b.page.locator('#message').inputValue(),'');
  record('同一会话刷新及退出重登后，从真实服务重新读回历史');
  const mobileFits=await b.page.evaluate(()=>document.documentElement.scrollWidth===window.innerWidth);
  assert(mobileFits);
  const standalone=await (await fetch(origin+'/app.webmanifest')).json();
  assert.equal(standalone.display,'standalone');
  for(const icon of standalone.icons)assert.equal((await fetch(new URL(icon.src,origin))).status,200);
  assert.deepEqual(errors,[]);
}
async function cleanup(){
  try{await browser?.close();}
  finally{
    if(worker&&worker.exitCode===null&&worker.signalCode===null){const done=once(worker,'exit');worker.kill();await done;}
    const actual=fs.realpathSync.native(temp);
    assert.equal(path.dirname(actual),tempRoot);
    assert.match(path.basename(actual),/^arcade-social-client-[a-z0-9]{6}$/i);
    fs.rmSync(actual,{recursive:true,force:true,maxRetries:8,retryDelay:180});
  }
}
main().finally(cleanup).then(()=>{
  const report={passed:true,realServer:true,syntheticAccounts:3,uiChecks:runs,chromiumHeadless:true,visibleTestWindows:0,
    screenshots:['mobile-chat-375.png','desktop-group-1280.png'],serviceCleaned:true,errors};
  fs.writeFileSync(path.join(__dirname,'receipt.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}).catch(error=>{console.error(error);process.exitCode=1;});
