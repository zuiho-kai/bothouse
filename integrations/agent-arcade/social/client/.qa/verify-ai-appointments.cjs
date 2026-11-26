'use strict';

const {clickChatSetting}=require('./chat-controls.cjs');

const assert=require('node:assert/strict');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const {chromium}=require('playwright');
const {SocialStore,AI_NUMBER}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {createDeepSeekProvider}=require('../../server/ai-deepseek.cjs');
const {exactTime}=require('../../server/appointment-time.cjs');
const {makeBackup}=require('../../deploy/backup.cjs');

const btn=(page,name)=>page.getByRole('button',{name,exact:true});
const firstTask='核对合成蓝鲸记录';
const cancelledTask='取合成烟灰色样品';
const lateTask='读合成绿皮资料';
const missedTask='检查合成紫色信封';
const backupTask='整理合成橙色封面';
const publicFeedText='合成公开动态，今天的海风很轻。';
const zone='Australia/Sydney';
const storagePrefix='arcade-ai-appointments-';
const wait=async fn=>{
  for(let i=0;i<45;i++){
    if(await fn())return;
    await delay(100);
  }
  assert.fail('等待服务到期状态超时');
};

async function open(browser,origin,number,storageState,timezoneId=zone){
  const context=await browser.newContext({baseURL:origin,timezoneId,viewport:{width:440,height:860},storageState,serviceWorkers:'block'});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page=await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(origin);
  if(!storageState){
    await btn(page,'创建账号').click();
    await page.locator('[name=number]').fill(number);
    await page.locator('[name=displayName]').fill('同名验收账号');
    await page.locator('[name=password]').fill('synthetic-appointment-password');
    await page.locator('#auth-submit').click();
  }
  await page.locator('#directory-title').getByText('消息',{exact:true}).waitFor();
  return {page,number,context};
}

async function api({page},route,data,status=200){
  const res=await page.request.fetch('/api/v1'+route,{method:data===undefined?'GET':'POST',data});
  const body=await res.json();
  assert.equal(res.status(),status,JSON.stringify(body));
  return body;
}

async function startChat(actor){
  const {page}=actor;
  await page.locator('[data-tab=contacts]').click();
  await btn(page,'AI 联系人').click();
  await btn(page,'同意并开始私聊').click();
  await page.locator('#chat-title').getByText('鲸鱼娘',{exact:true}).waitFor();
  const {conversations}=await api(actor,'/conversations');
  return conversations.find(row=>row.type==='direct'&&row.members.some(user=>user.number===AI_NUMBER)).id;
}

async function send({page},text){
  const receive=page.waitForResponse(res=>res.request().method()==='POST'&&res.url().endsWith('/messages'));
  await page.locator('#message').fill(text);
  await btn(page,'发送').click();
  const response=await receive;
  const body=await response.json();
  assert.equal(response.status(),200,JSON.stringify(body));
  return body;
}

async function newAppointment({page},task,when){
  await btn(page,'新增约定').click();
  await page.getByLabel('提醒事项',{exact:true}).fill(task);
  await page.getByLabel('日期和时间',{exact:true}).fill(when);
  await btn(page,'保存约定').click();
  await page.locator('#dialog').getByText(task,{exact:true}).waitFor();
}

async function main(){
  assert(Number.isNaN(exactTime('2026-04-05T02:30',zone)),'DST overlap requires explicit clarification');
  assert(Number.isNaN(exactTime('2026-10-04T02:30',zone)),'DST gap cannot be scheduled');
  assert(Number.isNaN(exactTime('2026-02-30T15:00',zone)),'Invalid dates cannot be normalized');
  assert.equal(exactTime('2026-11-24T15:25',zone),Date.parse('2026-11-24T04:25:00Z'));
  const target=process.argv[2]&&path.resolve(process.argv[2]);
  if(target)await fs.mkdir(target,{recursive:true});
  const temp=await fs.realpath(os.tmpdir());
  const scratch=await fs.mkdtemp(path.join(temp,storagePrefix));
  const file=path.join(scratch,'social.sqlite');
  let clock=Date.parse('2026-11-23T00:00:00Z');
  const wire=[];
  const privateSentinels=[firstTask,cancelledTask,lateTask,missedTask,backupTask];
  const provider=createDeepSeekProvider('synthetic-unused',{
    fetchImpl:async (url,options)=>{
      const payload=JSON.parse(options.body);
      wire.push({url,messages:payload.messages.map(({role,content})=>({role,content})),toolChoice:payload.tool_choice});
      return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'今天可以聊聊书。'}}]});
    },
  });
  provider.generateFriendPost=async()=>JSON.stringify({post:null});
  let browser,server,store,port;
  const start=async()=>{
    store=new SocialStore(file);
    server=createServer(store,{aiProvider:provider,appointmentClock:()=>clock}).listen(port||0,'127.0.0.1');
    await once(server,'listening');
    port=server.address().port;
    return 'http://127.0.0.1:'+port;
  };
  const stop=async()=>{
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
    server=store=null;
  };
  try{
    const origin=await start();
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    let [owner,other]=await Promise.all(['appt_owner','appt_other'].map(number=>open(browser,origin,number)));
    const [chat,otherChat]=await Promise.all([startChat(owner),startChat(other)]);
    const route='/conversations/'+chat, ownAppointments=route+'/appointments';
    const {request}=await api(owner,'/friend-requests',{number:other.number});
    await api(other,'/friend-requests/'+request.id+'/accept',{});
    const {conversation:group}=await api(owner,'/groups',{title:'约定隔离公开对照群',memberNumbers:[other.number]});
    // Simulate a pre-existing role post. This test checks what a follower
    // actually reads while the private scheduler runs, regardless of hour.
    store.run('INSERT INTO friend_posts(author,nonce,body,created) VALUES(?,?,?,?)',
      AI_NUMBER,'qa-existing-role-post',publicFeedText,new Date(clock).toISOString());
    await btn(other.page,'返回').click();
    await other.page.locator('[data-tab=feed]').click();
    await btn(other.page,'关注角色动态').click();
    await btn(other.page,'取消关注').waitFor();
    await other.page.locator('.feed-post__body').getByText(publicFeedText,{exact:true}).waitFor();
    assert(!JSON.stringify((await api(owner,'/friend-feed')).posts).includes(publicFeedText));
    assert.equal((await api(owner,route+'/ai-proactive')).settings.enabled,false);

    const first=await send(owner,'明天下午 3 点提醒我'+firstTask+'。');
    assert.equal(first.reply.sender.number,AI_NUMBER);
    assert.match(first.reply.text,/2026-11-24 15:00（Australia\/Sydney）/u);
    await owner.page.locator('#history').getByText(first.reply.text,{exact:true}).waitFor();
    if(target)await owner.page.screenshot({path:path.join(target,'原聊天确认.png')});
    const replay=await api(owner,route+'/messages',{text:first.message.text,clientId:first.message.clientId,
      aiConsentRevision:0,timeZone:zone});
    assert.equal(replay.reply.id,first.reply.id);
    assert.equal((await api(owner,ownAppointments)).appointments.length,1);

    const needTime=await send(owner,'提醒我'+cancelledTask+'。');
    assert.equal(needTime.reply.text,'你想哪天几点提醒？可以说“明天下午 3 点”。');
    assert.equal((await api(owner,ownAppointments)).appointments.length,1);
    const clarified=await send(owner,'明晚八点。');
    assert.match(clarified.reply.text,/2026-11-24 20:00（Australia\/Sydney）/u);
    const withdrawn=await send(owner,'明天下午3点提醒我检查撤回对照，算了。');
    assert.equal(withdrawn.reply.text,'好，这次先不安排新提醒。');
    assert.equal((await api(owner,ownAppointments)).appointments.length,2);
    assert.equal(wire.length,0);
    await clickChatSetting(owner.page,'约定提醒');
    function card(task){return owner.page.locator('#dialog .request').filter({hasText:task});}
    await card(firstTask).getByRole('button',{name:'改时间',exact:true}).click();
    await owner.page.getByLabel('日期和时间',{exact:true}).fill('2026-11-24T15:25');
    await btn(owner.page,'保存新时间').click();
    await card(firstTask).getByText(/15:25.*待提醒/u).waitFor();
    await card(cancelledTask).getByRole('button',{name:'取消提醒',exact:true}).click();
    await btn(owner.page,'确认取消').click();
    await card(cancelledTask).getByText(/已取消/u).waitFor();
    await newAppointment(owner,missedTask,'2026-11-24T15:32');
    await btn(owner.page,'关闭').click();
    const mutual=await send(owner,'我们约好明天下午3点40分'+lateTask+'，到时候来找我。');
    assert.match(mutual.reply.text,/2026-11-24 15:40（Australia\/Sydney）/u);
    assert.match(mutual.reply.text,new RegExp(lateTask+'。$','u'));
    await clickChatSetting(owner.page,'约定提醒');
    await card(lateTask).getByText(/15:40.*待提醒/u).waitFor();
    if(target)await owner.page.screenshot({path:path.join(target,'已改时和取消.png')});
    await btn(owner.page,'关闭').click();
    await owner.page.locator('#history').getByText(/改到 2026-11-24 15:25/u).waitFor();

    const {appointments}=await api(owner,ownAppointments);
    const ids=Object.fromEntries(appointments.map(row=>[row.task,row.id]));
    const changed=appointments.find(row=>row.id===ids[firstTask]);
    assert.equal(changed.revision,1);
    assert.equal(changed.dueAt,Date.parse('2026-11-24T04:25:00Z'));
    await api(owner,ownAppointments,{action:'cancel',expectedAccount:owner.number,id:changed.id,revision:0},409);
    await api(other,ownAppointments,undefined,404);
    await api(other,ownAppointments,{action:'cancel',expectedAccount:other.number,id:changed.id,revision:1},404);
    assert.deepEqual((await api(other,'/conversations/'+otherChat+'/appointments')).appointments,[]);
    await api(other,'/conversations/'+group.id+'/appointments',undefined,404);
    assert.equal(wire.length,0);

    const states=await Promise.all([owner.context.storageState(),other.context.storageState()]);
    await Promise.all([owner.context.close(),other.context.close()]);
    assert.equal(browser.contexts().length,0);
    const dueMessage=(id)=>store.one('SELECT * FROM messages WHERE chat=? AND nonce=?',chat,'appointment-due-'+id);
    clock=Date.parse('2026-11-24T04:00:01Z');
    await delay(1150);
    assert.equal(dueMessage(changed.id),undefined);
    clock=Date.parse('2026-11-24T04:25:00Z');
    await wait(()=>dueMessage(changed.id));
    const offlineDelivery=dueMessage(changed.id).id;
    assert.equal(dueMessage(changed.id).sender,AI_NUMBER);
    assert.match(dueMessage(changed.id).body,new RegExp(firstTask,'u'));
    await stop();
    clock=Date.parse('2026-11-24T04:43:00Z');
    assert.equal(await start(),origin);
    await wait(()=>dueMessage(ids[lateTask]));
    assert.equal(dueMessage(changed.id).id,offlineDelivery);
    assert.equal(dueMessage(ids[cancelledTask]),undefined);
    assert.equal(dueMessage(ids[missedTask]),undefined);
    assert.match(dueMessage(ids[lateTask]).body,/补上 .*15:40.* 的约定/u);

    [owner,other]=await Promise.all(states.map((state,i)=>open(browser,origin,i?'appt_other':'appt_owner',state)));
    await owner.page.goto(origin+'/#chat/'+chat);
    const history=owner.page.locator('#history');
    await history.getByText('到我们约好的时间啦，提醒你：'+firstTask+'。',{exact:true}).waitFor();
    assert.equal(await history.getByText('到我们约好的时间啦，提醒你：'+firstTask+'。',{exact:true}).count(),1);
    if(target)await owner.page.screenshot({path:path.join(target,'离线送达后重开.png')});
    await clickChatSetting(owner.page,'约定提醒');
    await card(lateTask).getByText(/已提醒/u).waitFor();
    await card(missedTask).getByText(/已错过/u).waitFor();
    if(target)await owner.page.screenshot({path:path.join(target,'恢复后已提醒和已错过.png')});
    await newAppointment(owner,backupTask,'2026-11-24T17:00');
    await btn(owner.page,'关闭').click();
    const prepared=await makeBackup(file,path.join(scratch,'restore'),{prepareRestore:true});
    const restored=new SocialStore(prepared);
    try{
      assert.equal(restored.one('SELECT state FROM ai_appointments WHERE task=?',backupTask).state,'cancelled');
      assert.equal(restored.one('SELECT id FROM messages WHERE nonce=?','appointment-due-'+changed.id).id,offlineDelivery);
    }finally{restored.db.close();}

    const tail=await send(owner,'“明天3点提醒我买水”只是举例。接下来聊聊书。');
    assert.equal(tail.reply.text,'今天可以聊聊书。');
    assert.equal(wire.length,1);
    assert.deepEqual(wire[0].messages.map(row=>row.role),['system','user']);
    for(const sentinel of privateSentinels)assert(!JSON.stringify(wire).includes(sentinel));
    assert(!JSON.stringify(wire).includes('检查撤回对照'));
    assert.equal((await api(other,'/friend-feed')).role.following,true);
    await other.page.locator('[data-tab=feed]').click();
    await btn(other.page,'取消关注').waitFor();
    await other.page.locator('.feed-post__body').getByText(publicFeedText,{exact:true}).waitFor();
    const visibleFeed=await other.page.locator('.feed-post__body').allTextContents();
    assert.deepEqual(visibleFeed,[publicFeedText]);
    if(target)await other.page.screenshot({path:path.join(target,'关注者只读到公开动态.png')});
    for(const source of ['/friend-feed','/conversations/'+group.id+'/messages','/conversations/'+otherChat+'/messages']){
      const read=await api(other,source);
      for(const sentinel of privateSentinels)assert(!JSON.stringify(read).includes(sentinel));
    }
    const dueRows=store.all("SELECT id,sender,nonce FROM messages WHERE chat=? AND nonce LIKE 'appointment-due-%' ORDER BY id",chat);
    assert.equal(dueRows.length,2);
    const stopped=(await api(owner,ownAppointments)).appointments;
    const evidence={chat,zone,replayedReply:replay.reply.id,confirmed:first.reply.id,clarification:needTime.reply.id,
      originalDueAt:'2026-11-24T04:00:00Z',rescheduledUtc:new Date(changed.dueAt).toISOString(),closedBrowserContexts:0,
      offlineDelivery,dueRows,states:stopped.map(({id,task,state,wall})=>({id,task,state,wall})),
      privacy:{otherPrivateChat:404,groupScope:404,feedFollowingAndNoPrivateRows:true,visibleFeed,appointmentProviderCalls:wire.length-1,
        ordinaryProviderControl:wire[0]},restart:'reopened same SQLite on the same loopback port with both clients closed'};
    if(target)await fs.writeFile(path.join(target,'receipt.json'),JSON.stringify(evidence,null,2)+'\n');
    console.log(JSON.stringify(evidence,null,2));

    const india=await open(browser,origin,owner.number,await owner.context.storageState(),'Asia/Kolkata');
    await india.page.goto(origin+'/#chat/'+chat);
    const midnight=[];
    async function check(input,task,wall,utc){
      const {reply}=await send(india,input);
      await india.page.locator('#history').getByText(reply.text,{exact:true}).waitFor();
      const {appointments}=await api(india,ownAppointments);
      const saved=appointments.find(row=>row.task===task);
      assert.equal(saved?.wall,wall);
      assert.match(saved.timeZone,/^Asia\/(?:Calcutta|Kolkata)$/u);
      assert.equal(new Date(saved.dueAt).toISOString(),utc);
      assert.equal(reply.text,'记好了，'+wall.replace('T',' ')+'（'+saved.timeZone+'）提醒你：'+task+'。');
      midnight.push({input,reply:reply.text,wall,timeZone:saved.timeZone,utc});
    }
    clock=Date.parse('2030-01-14T04:30:00Z');
    await check('今晚十二点提醒我归还展板。','归还展板','2030-01-15T00:00','2030-01-14T18:30:00.000Z');
    await check('今天中午十二点提醒我交还白板笔。','交还白板笔','2030-01-14T12:00','2030-01-14T06:30:00.000Z');
    if(target)await india.page.screenshot({path:path.join(target,'午夜和正午-私聊.png')});
    const unclear=await send(india,'今晚中午十二点提醒我核对歧义。');
    assert.match(unclear.reply.text,/你想哪天几点提醒/u);
    assert(!(await api(india,ownAppointments)).appointments.some(row=>row.task==='核对歧义'));
    clock=Date.parse('2030-12-31T04:30:00Z');
    await check('今天晚上十二点提醒我核对跨年清单。','核对跨年清单','2031-01-01T00:00','2030-12-31T18:30:00.000Z');
    await check('2030-12-31 12:00提醒我中午取票。','中午取票','2030-12-31T12:00','2030-12-31T06:30:00.000Z');
    await check('2031-01-01 00:30提醒我汇总清单。','汇总清单','2031-01-01T00:30','2030-12-31T19:00:00.000Z');
    assert.equal(wire.length,1);
    if(target){
      await india.page.screenshot({path:path.join(target,'跨年和24小时制-私聊.png')});
      await fs.writeFile(path.join(target,'midnight-check.json'),JSON.stringify({
        cases:midnight,unclear:unclear.reply.text,appointmentProviderCalls:0,
      },null,2)+'\n');
    }
    console.log(JSON.stringify({midnight,unclear:unclear.reply.text}));
  }finally{
    if(browser)await browser.close();
    if(server)await stop();
    if(path.dirname(scratch)===temp&&path.basename(scratch).startsWith(storagePrefix))
      await fs.rm(scratch,{recursive:true,force:true});
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
