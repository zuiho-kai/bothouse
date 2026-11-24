'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {SocialStore}=require('./store.cjs');
const {createServer}=require('./http.cjs');
const {scopeDirectory,directoryBoardReceiver}=require('./bothouse/board-receiver.cjs');
const {createDeepSeekProvider}=require('./ai-deepseek.cjs');
const {createOpenAIGroupProvider}=require('./ai-openai.cjs');

test('normal direct and group sends hand a task to the addressed Bothouse board member', {
  skip:!process.env.BOTHOUSE_TEST_GATE&&'set BOTHOUSE_TEST_GATE to the upstream bridge/contrib/gate directory',
  timeout:90000
},async t=>{
  const gate=path.resolve(process.env.BOTHOUSE_TEST_GATE);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'arcade-work-'));
  const board=path.join(root,'board');
  const ids=new Map([['arcade_whale','fixture-whale'],['arcade_dragon','fixture-dragon']]);
  const requests=[];
  const release=Promise.withResolvers();
  const directory={async runTextTask(turn){
    requests.push(turn);
    if(requests.length===1)return {text:'我已经全部执行完成了。'};
    await release.promise;
    const input=JSON.parse(turn.text.split('\n').at(-1));
    return {text:JSON.stringify(input.items.map(item=>item.startsWith('今天')?'今天':'周末'))};
  },resolveMember:(viewer,number)=>viewer==='task_alpha'&&ids.has(number)&&
    ({id:ids.get(number),number,displayName:'合成同名角色',configured:ids.has(number)})};
  const oldGate=process.env.SOCIAL_BOTHOUSE_GATE,oldRoot=process.env.SOCIAL_BOTHOUSE_WORK_DIR;
  process.env.SOCIAL_BOTHOUSE_GATE=gate;process.env.SOCIAL_BOTHOUSE_WORK_DIR=board;
  t.after(()=>{
    if(oldGate===undefined)delete process.env.SOCIAL_BOTHOUSE_GATE;else process.env.SOCIAL_BOTHOUSE_GATE=oldGate;
    if(oldRoot===undefined)delete process.env.SOCIAL_BOTHOUSE_WORK_DIR;else process.env.SOCIAL_BOTHOUSE_WORK_DIR=oldRoot;
  });
  const store=new SocialStore(path.join(root,'db.sqlite'));
  let chats=0;
  const provider=createDeepSeekProvider('fixture',{fetchImpl:async()=>{
    chats++;
    return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'你好'}}]});
  }});
  const openai=createOpenAIGroupProvider('fixture',{fetchImpl:()=>{throw Error('unexpected chat');}});
  const server=createServer(store,{aiProvider:provider,openaiProvider:openai,taskReceiver:directoryBoardReceiver(directory)}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{await new Promise(done=>server.close(done));store.db.close();
    await fs.rm(root,{recursive:true,force:true,maxRetries:4});});
  const base='http://127.0.0.1:'+server.address().port+'/api/v1';
  function browser(){
    let cookie='';
    return async(route,body,status=200)=>{
      const response=await fetch(base+route,{method:body?'POST':'GET',headers:{cookie,'content-type':'application/json',
        'x-social-claude-ui':'1'},body:body?JSON.stringify(body):undefined});
      if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
      const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;
    };
  }
  const a=browser(),b=browser();
  for(const [client,number] of [[a,'task_alpha'],[b,'task_bravo']])
    await client('/register',{number,displayName:'同名',password:'synthetic only'});
  const invite=await a('/friend-requests',{number:'task_bravo'});
  const human=(await b('/friend-requests/'+invite.request.id+'/accept',{})).conversation.id;
  const dm=(await a('/ai-contacts/start',{number:'arcade_whale',expectedAccount:'task_alpha',allowCloud:true})).conversation.id;
  const group=(await a('/groups',{title:'派工测试',memberNumbers:['task_bravo']})).conversation.id;
  for(const [number,provider] of [['arcade_dragon','openai'],['arcade_whale','deepseek']]){
    await a('/groups/'+group+'/ai',{expectedAccount:'task_alpha',number,enabled:true});
    await a('/groups/'+group+'/ai-consent',{expectedAccount:'task_alpha',number,provider,enabled:true});
  }
  const route=chat=>'/conversations/'+chat+'/messages';
  const directWork='给你一个任务：核对交接账目';
  const work='请把三条待办分类：今天寄信；周末散步；今天还书';
  const send=(chat,text,clientId,mentionAccount)=>a(route(chat),{text,clientId,mentionAccount,aiConsentRevision:0});
  await send(human,work,'humanonly');
  await send(group,work,'grouphuman','task_bravo');
  await send(group,'你好','hellobot','arcade_whale');
  assert.equal(chats,1);
  assert.equal(store.one('SELECT count(*) AS n FROM bothouse_work_orders').n,0);
  async function state(chat,id,wanted,reader=a){
    const until=Date.now()+14000;
    do{
      const messages=(await reader(route(chat))).messages;
      if(messages.find(m=>m.id===id)?.task?.state===wanted)return messages;
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<until);
    assert.fail('did not reach '+wanted+' for '+id+' '+JSON.stringify(store.one('SELECT * FROM bothouse_work_orders WHERE prompt=?',id)));
  }
  let directRequest,groupRequest,page,groupNonce;
  if(process.env.ARCADE_WORK_TEST_BROWSER==='1'){
    const {chromium}=require('playwright');
    const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    t.after(()=>browser.close());
    page=await browser.newPage({viewport:{width:1050,height:760},serviceWorkers:'block'});
    const origin=new URL(base).origin;
    await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
    await page.goto(origin);
    await page.locator('[name="number"]').fill('task_alpha');
    await page.locator('[name="password"]').fill('synthetic only');
    await page.locator('#auth-submit').click();
    async function open(title){
      await page.locator('#directory-body').getByRole('button',{name:new RegExp('^'+title)}).click();
    }
    const message=page.locator('#message');
    async function submit(chat){
      const ack=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(route(chat)));
      await page.getByRole('button',{name:'发送',exact:true}).click();
      const response=await ack;
      assert.equal(response.status(),200);
      return (await response.json()).message;
    }
    await open('鲸鱼娘');
    await message.fill(directWork);
    assert.equal(store.one('SELECT count(*) n FROM bothouse_work_orders').n,0);
    directRequest=await submit(dm);
    await open('派工测试');
    await message.fill('@龙');
    await page.locator('#mention-suggestions [role="option"]').first().click();
    await message.press('End');
    await message.pressSequentially(' ');
    await page.keyboard.insertText(work);
    groupRequest=await submit(group);
    assert.equal(groupRequest.mention.number,'arcade_dragon');
    groupNonce=groupRequest.clientId;
  }else{
    directRequest=(await send(dm,directWork,'directjob')).message;
    groupNonce='groupjob';
    groupRequest=(await send(group,work,groupNonce,'arcade_dragon')).message;
  }
  assert.equal((await send(group,work,groupNonce,'arcade_dragon')).message.id,groupRequest.id);
  await state(dm,directRequest.id,'accepted');
  await state(group,groupRequest.id,'accepted',b);
  const groupBoard=scopeDirectory(board,'arcade_dragon',group);
  const directBoard=scopeDirectory(board,'arcade_whale',dm);
  const rows=async dir=>(await fs.readFile(path.join(dir,'board.jsonl'),'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  const entries=await rows(groupBoard);
  assert.equal(entries.length,1);
  assert.equal((await rows(directBoard)).length,1);
  const taken=entries.find(e=>e.who==='fixture-dragon');
  assert.equal(taken.what,work);
  assert.equal(taken.where,'arcade:'+group+'/messages/'+groupRequest.id);
  assert.equal(taken.assigner.id,'task_alpha');
  const key=taken.sk.slice('arcade:'.length);
  const runWorker=(op,data={})=>JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',
    ['-I','-B','-X','utf8',path.join(__dirname,'bothouse/work_board.py'),gate,groupBoard,taken.who,key,op],
    {input:JSON.stringify(data),encoding:'utf8',windowsHide:true}));
  await state(group,groupRequest.id,'failed');
  assert.equal(requests.length,1);
  assert.equal(requests[0].account,'task_alpha');
  assert.equal(requests[0].number,'arcade_dragon');
  assert.equal(requests[0].chat,group);
  assert.equal(requests[0].direct,false);
  const retry=route(group)+'/'+groupRequest.id+'/task-retry';
  await b(retry,{expectedAccount:'task_bravo',attempt:0},404);
  await a(retry,{expectedAccount:'task_alpha',attempt:0});
  await a(retry,{expectedAccount:'task_alpha',attempt:0});
  await state(group,groupRequest.id,'accepted');
  await state(group,groupRequest.id,'running',b);
  release.resolve();
  const output='今天：今天寄信、今天还书\n周末：周末散步';
  const messages=await state(group,groupRequest.id,'returned',b);
  runWorker('return',{text:'迟到重复的交回'});
  assert.equal(requests.length,2);
  const results=messages.filter(row=>row.text.includes(output));
  assert.equal(results.length,1);
  assert.equal(results[0].sender.number,'arcade_dragon');
  await b(route(dm),undefined,404);
  assert(!(await a(route(dm))).messages.some(m=>m.text.includes(output)));
  assert.equal(chats,1);
  if(page)await page.locator('#history').getByText(/今天：今天寄信、今天还书/).waitFor({timeout:10000});
  const artifact=JSON.parse(await fs.readFile(path.join(groupBoard,'social-results',key+'.json'),'utf8'));
  assert.equal(artifact.result,output);
  assert.equal((await rows(groupBoard)).length,1);
  // The real role can report late, but an account or membership change suppresses delivery.
  const dmEntry=(await rows(directBoard))[0];
  ids.delete('arcade_whale');
  const late='已撤权的私聊结果';
  execFileSync(process.platform==='win32'?'python':'python3',['-I','-B','-X','utf8',
    path.join(__dirname,'bothouse/work_board.py'),gate,directBoard,dmEntry.who,dmEntry.sk.slice(7),'return'],
    {input:JSON.stringify({text:late}),encoding:'utf8',windowsHide:true});
  const hidden=await state(dm,directRequest.id,'cancelled');
  assert(!hidden.some(message=>message.text.includes(late)));
  const evidence={passed:true,revokedLateResultDelivered:false,roleDirectoryScopedBySender:true,chat:group,sourceMessage:groupRequest.id,resultMessage:results[0].id,
    browserComposer:Boolean(page),boardId:taken.id,member:taken.who,request:key,artifact,sha256:createHash('sha256').update(output).digest('hex'),
    boardEvents:(await fs.readFile(path.join(groupBoard,'board-events.jsonl'),'utf8')).trim().split(/\r?\n/).map(JSON.parse),
    modelStatementsAcceptedAsCompletion:0,taskAttempts:requests.length,chatCalls:chats,upstream:'Bothouse board.add / update / returned',worker:'real board and artifact worker; synthetic role returned category labels'};
  if(process.env.ARCADE_WORK_TEST_RECEIPT)await fs.writeFile(process.env.ARCADE_WORK_TEST_RECEIPT,JSON.stringify(evidence,null,2)+'\n');
});

test('a task inserted in the composer keeps the same classification items as a natural request',()=>{
  const {textTask}=require('./bothouse/text-delivery.cjs');
  const direct='请把这些物品分类：蓝笔；旧书';
  const prefixed=textTask('给你一个任务：'+direct);
  assert.equal(prefixed.prompt,textTask(direct).prompt);
  assert.equal(prefixed.render('["文具","书籍"]'),'文具：蓝笔\n书籍：旧书');
});
