'use strict';

const {clickChatSetting,reportMessage}=require('./chat-controls.cjs');

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {once}=require('node:events');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const {createServer}=require('../../server/http.cjs');
const {SocialStore,AI_NUMBER}=require('../../server/store.cjs');

const password='synthetic-consent-phrase';
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const visible=locator=>locator.waitFor({state:'visible'});
const history=(page,text)=>page.locator('#history').getByText(text,{exact:true});
async function register(page,number) {
  await button(page,'创建账号').click();
  await page.locator('[name=number]').fill(number);
  await page.locator('[name=displayName]').fill(number);
  await page.locator('[name=password]').fill(password);
  await page.locator('#auth-submit').click();
  await visible(page.getByRole('heading',{name:'消息',exact:true}));
}
async function openAi(page) {
  await button(page,'通讯录').click();
  await button(page,'AI 联系人').click();
  await button(page,'同意并开始私聊').click();
  await visible(page.locator('#chat-detail').filter({hasText:'云聊天已开启'}));
}
async function send(page,text) {
  await page.locator('#message').fill(text);
  await button(page,'发送').click();
}

async function main() {
  const output=process.argv[2];
  if(!output||process.argv.length!==3) throw Error('Usage: node verify-ai-consent.cjs NEW_OUTPUT_DIRECTORY');
  await fs.mkdir(output);
  const temp=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'arcade-ai-consent-'));
  const database=path.join(temp,'fixture.sqlite');
  const store=new SocialStore(database);
  const calls=[], errors=[], steps=[];
  const pending=Promise.withResolvers(), abandon=Promise.withResolvers();
  let browser, reportedAi, groupModeration;
  const provider={provider:'deepseek',groupRoles:[{number:AI_NUMBER,name:'鲸鱼娘'}],
    async generate(messages,{signal}) {
      const text=messages.at(-1).content;
      const entry={text,context:messages.map(message=>message.content)};
      calls.push(entry);
      if(text==='关闭前的在途请求') {
        signal.addEventListener('abort',()=>{entry.abortObserved=true;},{once:true});
        pending.resolve();
        await abandon.promise;
      }
      return '替身回复：'+text;
    },
  };
  const server=createServer(store,{aiProvider:provider,groupAiProviders:[provider]}).listen(0,'127.0.0.1');
  try {
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    const publicPage=await fetch(origin+'/conduct.html');
    assert.equal(publicPage.status,200);
    assert.equal(publicPage.headers.get('set-cookie'),null);
    assert.match(await publicPage.text(),/举报真人消息或 AI 回复/);
    assert.equal((await fetch(origin+'/privacy.html')).status,200);
    browser=await chromium.launch({channel:'msedge',headless:true,
      args:['--disable-background-networking','--disable-component-update','--disable-sync']});
    async function newAccount() {
      const context=await browser.newContext({viewport:{width:390,height:780},serviceWorkers:'block'});
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      return context;
    }
    async function open(context,url=origin) {
      const page=await context.newPage();
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(url);
      return page;
    }
    const a=await newAccount(),b=await newAccount();
    const pa=await open(a),pb=await open(b);
    await visible(pa.getByRole('heading',{name:'登录',exact:true}));
    await button(pa,'创建账号').click();
    await visible(pa.getByRole('heading',{name:'创建账号',exact:true}));
    await pa.getByRole('link',{name:'内容准则',exact:true}).click();
    assert.equal(pa.url(),origin+'/conduct.html');
    await visible(pa.getByText(/举报不会附上整段会话/));
    await pa.screenshot({path:path.join(output,'conduct-before-registration.png')});
    await pa.getByRole('link',{name:'返回好友',exact:true}).click();
    await pa.getByRole('link',{name:'隐私说明',exact:true}).click();
    const policy=pa.getByRole('region',{name:'可选 AI 私聊'});
    await visible(policy.getByText(/在 AI 私聊顶部打开「会话设置」，选择「关闭云聊天」/));
    await visible(policy.getByText(/已经发给 DeepSeek 的内容无法撤回/));
    const groupPrivacy=pa.getByRole('region',{name:'可选群内 AI'});
    await visible(groupPrivacy.getByText(/DeepSeek，api.deepseek.com.*OpenAI GPT，api.openai.com/));
    await visible(groupPrivacy.getByText(/停止发给 DeepSeek.*停止发给 OpenAI/));
    await policy.screenshot({path:path.join(output,'privacy-before-registration.png')});
    await groupPrivacy.screenshot({path:path.join(output,'group-cloud-privacy.png')});
    await pa.getByRole('link',{name:'返回好友',exact:true}).click();
    await register(pa,'consent_alpha');
    await register(pb,'consent_beta');
    await button(pa,'我').click();
    assert.equal(await pa.getByRole('link',{name:'隐私说明',exact:true}).getAttribute('href'),'./privacy.html');
    await pa.getByRole('link',{name:'内容准则',exact:true}).click();
    assert.equal(pa.url(),origin+'/conduct.html');
    await pa.getByRole('link',{name:'返回好友',exact:true}).click();
    await visible(pa.getByRole('heading',{name:'消息',exact:true}));
    steps.push('anonymous direct URL, registration and signed-in profile share the same conduct page; existing privacy URL remains available');
    steps.push('privacy notice reachable before registration and from the signed-in profile; discloses withdrawal, provider and group scope');
    await openAi(pa);
    await openAi(pb);
    await send(pa,'关闭前已完成的消息');
    await visible(history(pa,'替身回复：关闭前已完成的消息'));
    const aiReply='替身回复：关闭前已完成的消息', reason='合成：核对只举报这一条角色回复';
    const aiBubble=pa.locator('#history article').filter({has:pa.getByText(aiReply,{exact:true})});
    await reportMessage(pa,aiBubble);
    const reportDialog=pa.getByRole('dialog');
    assert.equal(await reportDialog.getByRole('link',{name:'内容准则',exact:true}).getAttribute('href'),'./conduct.html#reporting');
    await visible(reportDialog.locator('blockquote').getByText(aiReply,{exact:true}));
    await reportDialog.getByLabel('举报原因').fill(reason);
    const submitted=pa.waitForResponse(res=>res.request().method()==='POST'&&res.url().endsWith('/report'));
    await button(reportDialog,'提交举报').click();
    const reportResponse=await submitted;
    assert.equal(reportResponse.status(),200);
    const {report}=await reportResponse.json();
    await visible(reportDialog.getByText('已提交，等待审核。 举报回执 '+report.id,{exact:true}));
    const operator=JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'../../server/moderate.cjs'),'list'],
      {env:{...process.env,SOCIAL_DB:database},encoding:'utf8',windowsHide:true}));
    assert.deepEqual(operator.map(({id,reporter,sender,reportedText,reason})=>({id,reporter,sender,reportedText,reason})),
      [{id:report.id,reporter:'consent_alpha',sender:'arcade_whale',reportedText:aiReply,reason}]);
    reportedAi={receipt:report.id,messageId:Number(new URL(reportResponse.url()).pathname.split('/').at(-2)),
      reporter:operator[0].reporter,sender:operator[0].sender,targetTextMatched:true,reasonMatched:true};
    await pa.screenshot({path:path.join(output,'ai-report-receipt.png')});
    await button(reportDialog,'关闭').click();
    steps.push('AI report in the normal message UI returned the same receipt, target, sender and reason in the actual operator CLI');

    const stale=await open(a,pa.url());
    await visible(stale.locator('#chat-detail').filter({hasText:'云聊天已开启'}));
    const id=decodeURIComponent(new URL(pa.url()).hash.slice(6));
    const chat=origin+'/api/v1/conversations/'+encodeURIComponent(id);
    const messages=chat+'/messages';
    const closeRequests=[];
    pa.on('request',request=>{if(request.url()===chat+'/ai-consent')closeRequests.push(request.postDataJSON());});
    await clickChatSetting(pa,'关闭云聊天');
    assert.equal(closeRequests.length,0);
    await button(pa,'取消').click();
    await visible(history(pa,'替身回复：关闭前已完成的消息'));
    await pa.locator('#message').fill('关闭前尚未发送的草稿');

    await send(stale,'关闭前的在途请求');
    await Promise.race([pending.promise,new Promise((_,reject)=>{
      const timer=setTimeout(()=>reject(Error('Mock provider did not receive the in-flight request')),8000);
      timer.unref();
    })]);
    await clickChatSetting(pa,'关闭云聊天');
    await visible(pa.getByText(/已发送给 DeepSeek 的内容无法撤回/));
    await pa.screenshot({path:path.join(output,'withdraw-confirmation.png')});
    await button(pa,'确认关闭').click();
    await visible(button(pa,'恢复云聊天'));
    assert.equal(await pa.locator('#message').inputValue(),'关闭前尚未发送的草稿');
    assert.deepEqual(closeRequests,[{expectedAccount:'consent_alpha',revision:0,allowCloud:false}]);
    assert.equal(calls.find(call=>call.text==='关闭前的在途请求').abortObserved,true);
    abandon.resolve();
    await visible(button(stale,'恢复云聊天'));
    await visible(history(stale,'AI 未能回复。'));
    assert.equal(await history(stale,'替身回复：关闭前的在途请求').count(),0);
    await visible(history(stale,'替身回复：关闭前已完成的消息'));
    assert.equal(await button(stale,'发送').isDisabled(),true);
    steps.push('ordinary withdrawal sent once, abandoned turn stopped and its late result was discarded on both tabs');

    const old={clientId:'old-tab-message',text:'关闭期间旧窗口的文字',aiConsentRevision:0};
    const paused=await a.request.post(messages,{data:old});
    assert.equal(paused.status(),409);
    assert.equal((await paused.json()).error.code,'ai_cloud_off');
    const afterPause=await (await a.request.get(messages)).json();
    assert(!afterPause.messages.some(row=>row.text.includes('关闭期间旧窗口')||row.text.includes('尚未发送的草稿')));
    await send(pb,'另一账号照常发送');
    await visible(history(pb,'替身回复：另一账号照常发送'));
    assert.deepEqual(calls.map(call=>call.text),['关闭前已完成的消息','关闭前的在途请求','另一账号照常发送']);
    steps.push('old request while paused made no provider call, other account stayed enabled');

    await pa.reload();
    await visible(button(pa,'恢复云聊天'));
    await visible(history(pa,'关闭前已完成的消息'));
    await pa.screenshot({path:path.join(output,'paused-history.png')});
    await button(pa,'恢复云聊天').click();
    await button(pa,'取消').click();
    assert.equal(closeRequests.length,1);
    await button(pa,'恢复云聊天').click();
    await button(pa,'同意并恢复').click();
    await visible(pa.locator('#chat-detail').filter({hasText:'云聊天已开启'}));
    assert.deepEqual(closeRequests.at(-1),{expectedAccount:'consent_alpha',revision:1,allowCloud:true});
    assert.equal(calls.length,3);
    const replay=await a.request.post(messages,{data:old});
    assert.equal(replay.status(),409);
    assert.equal((await replay.json()).error.code,'ai_consent_changed');
    await send(pa,'恢复后的第一条');
    await visible(history(pa,'替身回复：恢复后的第一条'));
    assert.deepEqual(calls.at(-1),{text:'恢复后的第一条',context:['恢复后的第一条']});
    assert.equal(calls.length,4);
    assert.deepEqual(errors,[]);
    steps.push('reload retained consent and history; explicit re-enable did not replay and only the new turn entered context');

    async function api(context,route,body){
      const reply=await context.request.fetch(origin+'/api/v1'+route,{method:body?'POST':'GET',data:body});
      assert.equal(reply.status(),200,route);
      return reply.json();
    }
    const {request}=await api(a,'/friend-requests',{number:'consent_beta'});
    await api(b,'/friend-requests/'+request.id+'/accept',{});
    const {conversation:group}=await api(a,'/groups',{title:'合成举报验收群',memberNumbers:['consent_beta']});
    const settings={expectedAccount:'consent_alpha',number:AI_NUMBER,enabled:true};
    await api(a,'/groups/'+group.id+'/ai',settings);
    await api(a,'/groups/'+group.id+'/ai-consent',{...settings,provider:'deepseek'});
    const route='/conversations/'+group.id+'/messages';
    const before='举报目标之前的合成消息。', after='举报目标之后的合成消息。';
    const prompt='只用文字回复合成举报目标。', answer='替身回复：'+prompt;
    await api(a,route,{clientId:'report_before',text:before});
    const {reply:target}=await api(a,route,{clientId:'report_target',text:prompt,mentionAccount:AI_NUMBER});
    assert.equal(target.text,answer);
    await api(a,route,{clientId:'report_after',text:after});
    await Promise.all([pa,pb].map(page=>page.goto(origin+'/#chat/'+group.id)));
    for(const page of [pa,pb])for(const text of [before,answer,after])await visible(history(page,text));
    const baseline=(await api(b,route)).messages;
    await reportMessage(pb,pb.locator('#history article').filter({has:pb.getByText(answer,{exact:true})}));
    const dialog=pb.getByRole('dialog'), why='合成：仅移除这一条群内 AI 回复';
    await visible(dialog.locator('blockquote').getByText(answer,{exact:true}));
    await dialog.getByLabel('举报原因').fill(why);
    const reporting=pb.waitForResponse(res=>res.request().method()==='POST'&&res.url().endsWith('/report'));
    await button(dialog,'提交举报').click();
    const sent=await reporting;
    assert.equal(sent.status(),200);
    assert(sent.url().endsWith('/messages/'+target.id+'/report'));
    const {report:groupReport}=await sent.json();
    await visible(dialog.getByText('已提交，等待审核。 举报回执 '+groupReport.id,{exact:true}));
    const cli=(...argv)=>JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'../../server/moderate.cjs'),...argv],
      {env:{...process.env,SOCIAL_DB:database},encoding:'utf8',windowsHide:true}));
    const entry=cli('list').find(row=>row.id===groupReport.id);
    assert.equal(entry.reporter,'consent_beta');
    assert.equal(entry.sender,AI_NUMBER);
    assert.equal(entry.reportedText,answer);
    assert.equal(entry.reason,why);
    assert.equal(cli('remove',groupReport.id).status,'removed');
    await button(dialog,'关闭').click();
    const expected=baseline.map(row=>row.id===target.id?{...row,text:'[已移除]',removed:true}:row);
    for(const [page,session] of [[pa,a],[pb,b]]){
      await visible(history(page,'[已移除]'));
      await page.reload();
      await visible(history(page,'[已移除]'));
      for(const text of [before,after])await visible(history(page,text));
      assert.equal(await history(page,'[已移除]').count(),1);
      assert.equal(await history(page,answer).count(),0);
      assert.deepEqual((await api(session,route)).messages,expected);
    }
    await pb.screenshot({path:path.join(output,'group-ai-report-removed.png')});
    groupModeration={targetMessageId:target.id,reportId:groupReport.id,reporter:entry.reporter,sender:entry.sender,
      cliRemoved:true,automaticRefreshAndReload:2,onlyTargetChanged:true,neighborMessages:baseline.length-1};
    assert.equal(calls.length,5);
    assert.deepEqual(errors,[]);
  } finally {
    abandon.resolve();
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
    await fs.rm(temp,{recursive:true,force:true,maxRetries:5});
  }
  const receipt={passed:true,syntheticAccounts:2,realClient:true,realLocalHttpService:true,
    visibleWindows:0,externalCloudCalls:0,providerCalls:calls.length,reportedAi,groupModeration,steps,errors};
  await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(receipt));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
