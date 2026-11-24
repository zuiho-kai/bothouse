'use strict';

const {reportMessage}=require('./chat-controls.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fork,execFileSync}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require('playwright');
const runtime=path.resolve(__dirname,'../../server/main.cjs');
const tempRoot=fs.realpathSync.native(os.tmpdir()),temp=fs.mkdtempSync(path.join(tempRoot,'arcade-social-client-'));
const screenshots=process.argv[2]||__dirname;
const runs=[], reports=[], revocations=[];
let worker,browser,origin;
const errors=[];
async function start(){
  worker=fork(runtime,[],{env:{...process.env,SOCIAL_HOST:'127.0.0.1',SOCIAL_PORT:'0',SOCIAL_DB:path.join(temp,'qa.sqlite'),SOCIAL_PUBLIC_ORIGIN:'',SOCIAL_DEEPSEEK_KEY:'',SOCIAL_OPENAI_KEY:''},windowsHide:true,silent:true});
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
function moderate(...args){
  return JSON.parse(execFileSync(process.execPath,[path.join(path.dirname(runtime),'moderate.cjs'),...args],{
    env:{...process.env,SOCIAL_DB:path.join(temp,'qa.sqlite')},encoding:'utf8',windowsHide:true,
  }));
}
const chatId=p=>new URL(p.url()).hash.slice('#chat/'.length);
async function watchRemoval(page,target) {
  const polls=[];
  while(polls.length<2){
    const response=await page.waitForResponse(row=>row.url().includes('/messages?after=')&&row.status()===200);
    polls.push((await response.json()).moderation.removedIds);
  }
  assert(polls.some(ids=>ids.includes(target)));
  return polls;
}
async function reportAndRemove(sender,reporter,text,{outsider,screenshot,olderPage=false}={}){
  const bubble=reporter.locator('#history article').filter({has:reporter.getByText(text,{exact:true})});
  await visible(bubble);
  await reportMessage(reporter,bubble);
  await visible(reporter.locator('#dialog blockquote').getByText(text,{exact:true}));
  assert.match(await reporter.locator('#dialog').innerText(),/运营方会审核.*意见反馈/su);
  const reason='合成验收：仅举报选中的这一条';
  await reporter.getByLabel('举报原因').fill(reason);
  const post=reporter.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/report'));
  await btn(reporter,'提交举报').click();
  const response=await post;
  assert.equal(response.status(),200);
  assert.deepEqual(response.request().postDataJSON(),{reason});
  assert.equal((await reporter.request.post(response.url(),{
    data:{reason},headers:{'X-Social-Account':'wrong_session'},
  })).status(),409);
  const {report}=await response.json();
  assert.equal(report.status,'open');
  await visible(reporter.getByText('已提交，等待审核。 举报回执 '+report.id,{exact:true}));
  if(screenshot)await reporter.screenshot({path:path.join(screenshots,'mobile-report-receipt.png')});
  const found=moderate('list');
  assert.equal(found.length,1);
  assert.deepEqual([found[0].id,found[0].reportedText,found[0].reason],[report.id,text,reason]);
  if(outsider){
    const original=outsider.url();
    await outsider.goto(reporter.url());
    await outsider.waitForURL(url=>!url.hash);
    assert.equal(await outsider.getByText(text,{exact:true}).count(),0);
    assert.equal(await outsider.getByRole('button',{name:'消息操作'}).count(),0);
    assert.equal((await outsider.request.post(response.url(),{data:{reason}})).status(),404);
    await outsider.goto(original);
    await visible(outsider.locator('#chat-head'));
  }
  const target=Number(new URL(response.url()).pathname.split('/').at(-2));
  const urls=[sender.url(),reporter.url()];
  const polls=Promise.all([watchRemoval(sender,target),watchRemoval(reporter,target)]);
  assert.equal(moderate('remove',report.id).status,'removed');
  assert.deepEqual(moderate('list'),[]);
  const observed=await polls;
  assert.deepEqual([sender.url(),reporter.url()],urls);
  for(const page of [sender,reporter]){
    await visible(page.locator('#history').getByText('[已移除]',{exact:true}));
    assert.equal(await page.locator('#dialog').isVisible(),false);
    assert.equal(await page.locator('#dialog-body').getByText(text,{exact:true}).count(),0);
    assert.equal(await page.locator('#history').getByText(text,{exact:true}).count(),0);
    assert.equal(await page.locator('#history article').filter({hasText:'[已移除]'})
      .getByRole('button',{name:'消息操作'}).count(),0);
  }
  if(screenshot)await reporter.screenshot({path:path.join(screenshots,'mobile-message-removed.png')});
  reports.push({receipt:report.id,operatorFoundExactMessage:true,participantsReloaded:0,
    participantsSynced:2,olderPage,observed,outsiderRejected:!!outsider,staleDialogClosed:true});
}
async function verifyRevocation(owner,member,text,groupName,account,leave){
  const group=chatId(owner), url=origin+'/#chat/'+group;
  await member.goto(url);
  await visible(member.locator('#chat-title').getByText(groupName,{exact:true}));
  await send(owner,text);
  const bubble=member.locator('#history article').filter({has:member.getByText(text,{exact:true})});
  await visible(bubble);
  await reportMessage(member,bubble);
  await visible(member.locator('#dialog blockquote').getByText(text,{exact:true}));
  let via='member-removal';
  if(leave){
    const tab=await member.context().newPage();
    await tab.goto(url);
    await visible(tab.locator('#chat-title').getByText(groupName,{exact:true}));
    if(process.env.ARCADE_QA_UI_LEAVE==='1'){
      await btn(tab,'群成员').click();
      await btn(tab,'退出群聊').click();
      const posted=tab.waitForResponse(row=>row.url().endsWith('/leave')&&row.request().method()==='POST');
      await btn(tab,'确认退出').click();
      assert.equal((await posted).status(),200);
      via='leave-button-in-second-tab';
    }else{
      assert.equal((await tab.request.post(origin+'/api/v1/groups/'+group+'/leave',{data:{}})).status(),200);
      via='leave-endpoint-in-second-tab';
    }
    await tab.close();
  }else{
    assert.equal((await owner.request.post(origin+'/api/v1/groups/'+group+'/remove',{data:{number:account}})).status(),200);
  }
  await member.waitForURL(visit=>!visit.hash);
  assert.equal(await member.locator('#dialog').isVisible(),false);
  assert.equal(await member.getByText(text,{exact:true}).count(),0);
  assert.equal((await member.request.get(origin+'/api/v1/conversations/'+group+'/messages?removedAfter=0')).status(),404);
  revocations.push({via,bodyCleared:true,dialogClosed:true,historyStatus:404});
}
async function main(){
  fs.mkdirSync(screenshots,{recursive:true});
  await start();
  browser=await chromium.launch({headless:true,channel:'msedge',
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
  await btn(b.page,'返回').click();
  await b.page.getByRole('button',{name:/周末读书局/}).click();
  const groupReport='合成验收消息：群里的这一条';
  await send(a.page,groupReport);
  for(let index=0;index<51;index++){
    const response=await a.page.request.post(origin+'/api/v1/conversations/'+chatId(a.page)+'/messages',{
      data:{clientId:'older-ui-fixture-'+index,text:'分页合成消息 '+index},
    });
    assert.equal(response.status(),200);
  }
  for(const client of [a.page,b.page]){
    await client.reload(); // Load the default page before opening the older page.
    await visible(btn(client,'加载更早消息'));
    assert.equal(await client.locator('#history').getByText(groupReport,{exact:true}).count(),0);
    await btn(client,'加载更早消息').click();
    await visible(client.locator('#history').getByText(groupReport,{exact:true}));
  }
  await reportAndRemove(a.page,b.page,groupReport,{outsider:c.page,screenshot:true,olderPage:true});
  await btn(b.page,'返回').click();
  await b.page.getByRole('button',{name:/木青/}).click();
  record('双方翻到较早页后举报，未入群账号无正文且直调举报被拒，运营移除后当前群页自动更新');
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
  await btn(a.page,'群成员').click();
  assert.equal(await btn(a.page,'退出群聊').count(),0);
  await btn(a.page,'关闭').click();
  const stale=await c.context.newPage();
  stale.on('pageerror',error=>errors.push(error.message));
  await stale.goto(chatUrl);
  await visible(stale.locator('#history').getByText(later,{exact:true}));
  await stale.locator('#message').fill('另一页的未发送群草稿');
  await btn(stale,'群成员').click();
  const leavePosts=[];
  c.page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/leave'))leavePosts.push(request.url());});
  await c.page.locator('#message').fill('本页的未发送群草稿');
  await btn(c.page,'群成员').click();
  await btn(c.page,'退出群聊').click();
  assert.equal(await btn(c.page,'取消').evaluate(node=>node===document.activeElement),true);
  await c.page.screenshot({path:path.join(screenshots,'mobile-leave-confirmation.png')});
  await btn(c.page,'取消').click();
  await visible(c.page.getByRole('heading',{name:'群成员',exact:true}));
  await btn(c.page,'关闭').click();
  await visible(c.page.locator('#history').getByText(later,{exact:true}));
  assert.equal(await c.page.locator('#message').inputValue(),'本页的未发送群草稿');
  assert.equal(leavePosts.length,0);
  await btn(c.page,'群成员').click();
  await btn(c.page,'退出群聊').click();
  const leaveResponse=c.page.waitForResponse(response=>response.url().endsWith('/leave')&&response.request().method()==='POST');
  await btn(c.page,'确认退出').click();
  assert.deepEqual(await (await leaveResponse).json(),{ok:true});
  assert.equal(leavePosts.length,1);
  await c.page.waitForFunction(()=>!location.hash&&!document.querySelector('#history').textContent);
  await stale.waitForFunction(()=>!location.hash&&!document.querySelector('dialog').open&&!document.querySelector('#history').textContent);
  for (const p of [c.page,stale]) {
    assert.equal(await p.locator('#composer').isHidden(),true);
    assert.equal(await p.locator('#message').inputValue(),'');
    assert.equal(await p.locator('#chat-title').textContent(),'');
    assert.equal(await p.locator('#directory-body').getByText('周末读书局',{exact:true}).count(),0);
  }
  const groupId=decodeURIComponent(new URL(chatUrl).hash.slice(6));
  const route=origin+'/api/v1/conversations/'+encodeURIComponent(groupId);
  const denied=await Promise.all([c.context.request.get(route+'/messages'),
    c.context.request.post(route+'/messages',{data:{clientId:'departed-member',text:'退出后不能发送'}})]);
  assert(denied.every(response=>[403,404].includes(response.status())));
  await stale.goto(chatUrl);
  await stale.waitForFunction(()=>!location.hash&&!document.querySelector('#history').textContent);
  await btn(c.page,'我').click();
  await btn(c.page,'退出登录').click();
  await visible(c.page.getByRole('heading',{name:'登录',exact:true}));
  await login(c.page,C);
  const sessionThreads=await c.context.request.get(origin+'/api/v1/conversations');
  assert.equal(sessionThreads.status(),200);
  assert(!(await sessionThreads.json()).conversations.some(item=>item.id===groupId));
  assert.equal(await c.page.locator('#directory-body').getByText('周末读书局',{exact:true}).count(),0);
  await c.page.screenshot({path:path.join(screenshots,'mobile-after-leave.png')});
  await visible(a.page.getByText('2 位群成员',{exact:true}));
  await b.page.goto(chatUrl);
  await visible(b.page.locator('#history').getByText(later,{exact:true}));
  await send(b.page,'留在群里的成员还能发送。');
  await visible(a.page.locator('#history').getByText('留在群里的成员还能发送。',{exact:true}));
  await btn(b.page,'返回').click();
  await b.page.getByRole('button',{name:/木青/}).click();
  await visible(b.page.locator('#history').getByText(directA,{exact:true}));
  record('群主没有退出入口；取消零请求；确认一次；旧页、旧地址和收发均失效；重登仍退出；其余成员继续收发');
  for(const [text,leave] of [['跨页退群时举报弹窗必须撤掉摘录',true],['被群主移出时举报弹窗必须撤掉摘录',false]]){
    assert.equal((await a.page.request.post(origin+'/api/v1/groups/'+chatId(a.page)+'/members',{
      data:{memberNumbers:[C.number]},
    })).status(),200);
    await verifyRevocation(a.page,c.page,text,'周末读书局',C.number,leave);
  }
  record('从另一标签页退群和被群主移出均自动清除举报摘录、历史和旧会话地址');
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
  await a.page.getByRole('button',{name:/林杉/}).click();
  await reportAndRemove(b.page,a.page,directB);
  record('私聊消息通过同一举报入口，运营移除后双方当前页面自动更新');
  await btn(a.page,'我').click();
  await btn(a.page,'意见反馈').click();
  await a.page.getByLabel('问题或建议').fill('合成意见：建议加大字号');
  await btn(a.page,'提交反馈').click();
  await visible(a.page.getByText('已收到反馈。',{exact:true}));
  assert.equal(moderate('feedback')[0].text,'合成意见：建议加大字号');
  assert.deepEqual(moderate('list'),[]);
  record('意见反馈仍可正常提交，与违规举报分开存取');
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
    screenshots:['mobile-chat-375.png','desktop-group-1280.png','mobile-report-receipt.png','mobile-message-removed.png',
      'mobile-leave-confirmation.png','mobile-after-leave.png'],
    reports,revocations,serviceCleaned:true,errors};
  fs.writeFileSync(path.join(screenshots,'receipt.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}).catch(error=>{console.error(error);process.exitCode=1;});
