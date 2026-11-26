'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {makeBackup}=require('../deploy/backup.cjs');
const {createServer:mockServer}=require('node:http');
const {SocialStore,AI_NUMBER,AI_DRAGON_NUMBER}=require('./store.cjs');
const {createServer}=require('./http.cjs');
const {createDeepSeekProvider}=require('./ai-deepseek.cjs');
const {createOpenAIGroupProvider}=require('./ai-openai.cjs');

test('two humans and two AI identities share a consented social group',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.now()});
  const advance=ms=>t.mock.timers.setTime(Date.now()+ms);
  const tempRoot=await fs.realpath(os.tmpdir());
  const fixture=await fs.mkdtemp(path.join(tempRoot,'arcade-group-backup-'));
  const database=path.join(fixture,'live.sqlite');
  let store=new SocialStore(database);
  const wire=[];
  const contexts=[];
  const arrival=Promise.withResolvers();
  const implicitArrival=Promise.withResolvers();
  const lateArrival=Promise.withResolvers(),releaseLate=Promise.withResolvers();
  const otherArrival=Promise.withResolvers(),releaseOther=Promise.withResolvers();
  const mocks=[];
  async function cloud(provider,role,endpoint,key){
    const url=new URL(endpoint);
    const server=mockServer(async (req,res)=>{
      assert.equal(req.url,url.pathname);
      assert.equal(req.headers.authorization,'Bearer '+key);
      const chunks=[];
      for await(const chunk of req)chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks));
      const openai=provider==='openai';
      const input=openai?body.input:body.messages.slice(1);
      const instructions=openai?body.instructions:body.messages[0].content;
      assert.equal(body.model,openai?'gpt-6.1-sol':'deepseek-flash');
      assert.equal(body.tool_choice,'none');
      assert(instructions.includes(role));
      assert([1,3].includes(input.length));
      assert.equal(input.at(-1).role,'user');
      const text=input.at(-1).content;
      wire.push({endpoint,role,text});
      contexts.push(input);
      if(text==='等我撤销'){arrival.resolve();return;}
      if(text==='各位觉得要不要先拟个提纲'){implicitArrival.resolve();return;}
      if(text==='等一个晚到的旧回答'){lateArrival.resolve();await releaseLate.promise;}
      if(text==='另一成员的旧问答'){otherArrival.resolve();await releaseOther.promise;}
      res.setHeader('Content-Type','application/json');
      const answer=text==='请输出一个像是邀请全群参与的问题'?'各位觉得周日怎么样？':
        text==='请输出一句看起来像在点名另一个角色的问题'?'龙娘，能不能请你继续？':role+'：'+text;
      res.end(JSON.stringify(openai?
        {status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer}]}]}:
        {choices:[{finish_reason:'stop',message:{role:'assistant',content:answer}}]}));
    }).listen(0,'127.0.0.1');
    mocks.push(server);
    await once(server,'listening');
    return {fetchImpl:(requested,init)=>{
      assert.equal(requested,endpoint);
      return fetch('http://127.0.0.1:'+server.address().port+url.pathname,init);
    }};
  }
  const dsURL='https://api.deepseek.com/chat/completions',gptURL='https://api.openai.com/v1/responses';
  const dsKey='synthetic-group-deepseek-key',gptKey='synthetic-group-openai-key';
  const deepseek=createDeepSeekProvider(dsKey,await cloud('deepseek','鲸鱼娘',dsURL,dsKey));
  const openai=createOpenAIGroupProvider(gptKey,await cloud('openai','龙娘',gptURL,gptKey));
  let server,base;
  async function start(providers){
    if(server)await new Promise(resolve=>server.close(resolve));
    server=createServer(store,{aiProvider:providers.includes(deepseek)?deepseek:undefined,groupAiProviders:providers}).listen(0,'127.0.0.1');
    await once(server,'listening');
    base='http://127.0.0.1:'+server.address().port+'/api/v1';
  }
  t.after(async()=>{
    for(const mock of mocks){mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));}
    if(server)await new Promise(resolve=>server.close(resolve));
    store?.db.close();
    const checked=await fs.realpath(fixture);
    assert.equal(path.dirname(checked),tempRoot);
    assert.match(path.basename(checked),/^arcade-group-backup-[a-z0-9]{6}$/iu);
    await fs.rm(checked,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  });
  await start([deepseek]);
  function client(){
    let cookie='';
    return async (endpoint,body,status=200)=>{
      const res=await fetch(base+endpoint,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json'},
        ...(body&&{body:JSON.stringify(body)})});
      if(res.headers.has('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
      const output=await res.json();
      assert.equal(res.status,status,endpoint+' '+JSON.stringify(output));
      return output;
    };
  }
  const a=client(),b=client(),outsider=client();
  for(const [session,id] of [[a,'group_alpha'],[b,'group_bravo'],[outsider,'group_other']])
    await session('/register',{number:id,password:'synthetic only',displayName:id==='group_bravo'?'鲸鱼娘':'陆河'});
  const friend=(await a('/friend-requests',{number:'group_bravo'})).request;
  const direct=(await b('/friend-requests/'+friend.id+'/accept',{})).conversation.id;
  const group=(await a('/groups',{title:'合成群',memberNumbers:['group_bravo']})).conversation.id;
  const settings='/groups/'+group+'/ai',share='/groups/'+group+'/ai-consent';
  const feed='/conversations/'+group+'/messages';
  let count=0;
  const send=(session,text,clientId='group_msg_'+(++count),mentionAccount)=>session(feed,{text,clientId,mentionAccount});
  const edit=(role,enabled,status=200)=>a(settings,{expectedAccount:'group_alpha',number:role,enabled},status);
  const consent=(session,account,role,enabled,status=200)=>session(share,{expectedAccount:account,number:role,
    provider:role===AI_NUMBER?'deepseek':'openai',enabled},status);
  await a('/conversations/'+direct+'/messages',{clientId:'direct_private',text:'真人私聊哨兵'});
  await send(a,'加入前的群聊哨兵');
  assert.deepEqual(wire,[]);
  await outsider(settings,undefined,404);
  await b(settings,{number:AI_NUMBER,enabled:true,expectedAccount:'group_bravo'},403);
  assert.deepEqual((await a(settings)).groupAi.available.map(role=>role.number),[AI_NUMBER]);
  await edit(AI_DRAGON_NUMBER,true,404);
  await edit(AI_NUMBER,true);
  await consent(a,'group_alpha',AI_NUMBER,true);
  await send(a,'@鲸鱼娘 手打同名不确定');
  const humanMention=await send(a,'点的是同名真人','mention_human','group_bravo');
  assert.equal(humanMention.message.mention.number,'group_bravo');
  assert.equal(humanMention.reply,undefined);
  assert.equal(wire.length,0);
  await start([deepseek,openai]);
  await edit(AI_DRAGON_NUMBER,true);
  const grants=(await a(settings)).groupAi.joined;
  assert.deepEqual(grants.map(role=>[role.provider,role.sharing]),[['deepseek',true],['openai',false]]);
  await a(share,{expectedAccount:'group_alpha',number:AI_DRAGON_NUMBER,provider:'deepseek',enabled:true},409);
  await send(a,'只同意过 DeepSeek','no_openai_grant',AI_DRAGON_NUMBER);
  const visible=(await b('/conversations/'+group)).conversation.members;
  assert.deepEqual(visible.filter(row=>row.kind==='ai').map(row=>row.number),[AI_DRAGON_NUMBER,AI_NUMBER]);
  await send(b,'未同意的哨兵','no_b_grant',AI_NUMBER);
  await b(share,{expectedAccount:'group_alpha',enabled:true},403);
  assert.deepEqual(wire,[]);
  await consent(b,'group_bravo',AI_NUMBER,true);
  await consent(b,'group_bravo',AI_DRAGON_NUMBER,true);
  const whale=await send(a,'你好呀','same_nonce',AI_NUMBER);
  const whaleRetry=await send(a,'你好呀','same_nonce',AI_NUMBER);
  await a(feed,{text:'你好呀',clientId:'same_nonce',mentionAccount:'group_bravo'},409);
  await a(feed,{text:'群外点名',clientId:'outside_target',mentionAccount:'group_other'},403);
  assert.equal(whale.message.id,whaleRetry.message.id);
  assert.equal(whale.reply.sender.number,AI_NUMBER);
  const dragon=await send(b,'@龙娘，讲一句工作近况');
  assert.equal(dragon.reply.sender.number,AI_DRAGON_NUMBER);
  await send(b,'周末见。');
  await send(a,'@鲸鱼娘 @龙娘 你们都说说？');
  advance(46_000);
  const open=await send(b,'大家觉得几点见？');
  assert.equal(open.reply.sender.number,AI_NUMBER);
  assert.deepEqual(wire,[{endpoint:dsURL,role:'鲸鱼娘',text:'你好呀'},{endpoint:gptURL,role:'龙娘',text:'讲一句工作近况'},
    {endpoint:dsURL,role:'鲸鱼娘',text:'大家觉得几点见？'}]);
  const pending=send(b,'@龙娘 等我撤销','group_slow_nonce');
  await arrival.promise;
  assert.equal((await send(b,'@龙娘 等我撤销','group_slow_nonce')).message.aiReply,'pending');
  await consent(b,'group_bravo',AI_DRAGON_NUMBER,false);
  const canceled=await pending;
  assert.equal(canceled.message.aiReply,'failed');
  assert.equal(canceled.reply,undefined);
  await send(b,'@龙娘 已经停止分享');
  await edit(AI_DRAGON_NUMBER,false);
  await send(a,'@龙娘 已移除');
  await edit(AI_NUMBER,false);
  assert.equal((await a(settings)).groupAi.joined.length,0);
  await edit(AI_NUMBER,true);
  await send(a,'移空重加需要再同意','rejoin_a',AI_NUMBER);
  assert.equal(wire.length,4);
  const history=(await b(feed)).messages;
  assert.deepEqual(history.filter(row=>row.sender.kind==='ai').map(row=>row.id),[whale.reply.id,dragon.reply.id,open.reply.id]);
  assert(history.every(row=>row.conversationId===group));
  await outsider(feed,undefined,404);
  await b(feed+'/'+dragon.reply.id+'/report',{reason:'合成群回复举报'});
  await consent(b,'group_bravo',AI_NUMBER,true);
  await b('/groups/'+group+'/leave',{});
  await b(settings,undefined,404);
  await a('/groups/'+group+'/members',{memberNumbers:['group_bravo']});
  assert.equal((await b(settings)).groupAi.joined[0].sharing,false);
  await send(b,'重新入群尚未同意','rejoin_b',AI_NUMBER);
  assert.equal(wire.length,4);
  await start([openai]);
  assert.deepEqual((await a(settings)).groupAi.available.map(role=>role.number),[AI_DRAGON_NUMBER]);
  assert.equal((await a(settings)).groupAi.joined[0].configured,false);
  assert.deepEqual((await a('/ai-contacts')).contacts,[]);
  await send(a,'未配置的角色不改走另一家','no_provider_fallback',AI_NUMBER);
  assert.equal(wire.length,4);
  await edit(AI_DRAGON_NUMBER,true);
  await consent(a,'group_alpha',AI_DRAGON_NUMBER,true);
  await a('/groups/'+group+'/ai-context',{expectedAccount:'group_alpha',number:AI_DRAGON_NUMBER,provider:'openai',enabled:true});
  assert.equal(store.one('SELECT count(*) AS count FROM ai_group_role_consents').count,1);
  assert.equal(store.one('SELECT count(*) AS count FROM ai_group_context_consents').count,1);
  const messageCount=store.one('SELECT count(*) AS count FROM messages WHERE chat=?',group).count;
  const sessionCount=store.one('SELECT count(*) AS count FROM sessions').count;
  assert(sessionCount>0);
  const prepared=await makeBackup(database,path.join(fixture,'restore'),{prepareRestore:true});
  const restored=new SocialStore(prepared);
  try{
    assert.equal(restored.one('SELECT count(*) AS count FROM sessions').count,0);
    assert.equal(store.one('SELECT count(*) AS count FROM sessions').count,sessionCount);
    assert.equal(restored.one('SELECT count(*) AS count FROM ai_group_role_consents').count,0);
    assert.equal(restored.one('SELECT count(*) AS count FROM ai_group_context_consents').count,0);
    assert.equal(restored.one('SELECT count(*) AS count FROM ai_group_roles WHERE chat=?',group).count,2);
    assert.equal(restored.one('SELECT count(*) AS count FROM messages WHERE chat=?',group).count,messageCount);
    assert.equal(store.one('SELECT count(*) AS count FROM ai_group_role_consents').count,1);
  }finally{restored.db.close();}
  t.diagnostic(JSON.stringify({humanAccounts:2,aiAccounts:2,providerRequests:wire,replyIds:[whale.reply.id,dragon.reply.id,open.reply.id],
    duplicateCalls:0,privateOrPrejoinContexts:0,cancelledState:canceled.message.aiReply,realRequests:0}));

  await start([deepseek,openai]);
  const samples=[];
  async function room(title,memberNumbers=['group_bravo']){
    const {conversation}=await a('/groups',{title,memberNumbers});
    const path='/groups/'+conversation.id;
    const messages='/conversations/'+conversation.id+'/messages';
    for(const [role,provider] of [[AI_NUMBER,'deepseek'],[AI_DRAGON_NUMBER,'openai']]){
      await a(path+'/ai',{expectedAccount:'group_alpha',number:role,enabled:true});
      for(const [session,account] of [[a,'group_alpha'],[b,'group_bravo']]){
        if(session!==a&&!memberNumbers.includes(account))continue;
        await session(path+'/ai-consent',{expectedAccount:account,number:role,provider,enabled:true});
      }
    }
    return {path,messages};
  }
  async function sample(room,session,label,text,{target,role,context,clientId='natural_'+(++count)}={}){
    const before=wire.length;
    const row=await session(room.messages,{text,clientId,...(target&&{mentionAccount:target})});
    assert.equal(wire.length,before+(role?1:0),label);
    assert.equal(row.reply?.sender.number,role,label);
    if(role)assert.deepEqual(contexts.at(-1).map(entry=>entry.content),context??[text],label);
    samples.push({label,text,providerCalls:wire.length-before,reply:row.reply?.sender.number??null,context:role?contexts.at(-1):[]});
    return row;
  }

  const fresh=await room('初次开放问话');
  const casual='晚上碰头吗？';
  await sample(fresh,a,'空闲群里的一般问句',casual,{role:AI_NUMBER});
  await sample(fresh,b,'另一位刚看到 AI 已经回话','各位觉得周五怎么样');
  advance(26_000);
  await sample(fresh,b,'面向全群且无问号','各位觉得周五怎么样',{role:AI_NUMBER});
  await sample(fresh,b,'不因改标点重复接刚答过的问题','各位觉得周五怎么样？');

  const human=await room('两位真人约时间');
  await sample(human,a,'原生点人后真人在接话','我六点半下班',{target:'group_bravo'});
  await sample(human,b,'同一句碰头问话在真人互动中',casual);
  await sample(human,b,'同一位真人紧接再问一句','在哪儿见');
  await sample(human,a,'双方正在约时间时不插进来','各位觉得周五怎么样');

  const addressed=await room('明确称呼真人');
  await sample(addressed,b,'无原生 @ 的真人称呼','陆河，你刚发给我的文件放哪儿了？');
  await sample(addressed,b,'姓名紧接无标点请求，原独验反例','陆河帮我把今天的排班表再发一下好吗');
  await sample(addressed,b,'空格隔开称呼且无问号','陆河 你能看看车票吗');
  await sample(addressed,b,'问候、敬称和破折号','喂，陆河同学——您收到车票了吗');
  await sample(addressed,b,'不明称呼加直接人称','陈星，你觉得哪个站台合适');
  const collision=await room('同昵称的两个目标');
  const sharedName='鲸鱼娘，你收到车票了吗';
  await sample(collision,a,'同名真人与 AI 的裸称','鲸鱼娘，你收到车票了吗');
  await sample(collision,a,'同句明确选中同名真人',sharedName,{target:'group_bravo'});
  await sample(collision,a,'同句明确选中 AI',sharedName,{target:AI_NUMBER,role:AI_NUMBER});

  const switched=await room('紧接 AI 回复但当前点真人');
  const seats='先给我说说座位';
  await sample(switched,b,'先明确点龙娘聊座位',seats,{target:AI_DRAGON_NUMBER,role:AI_DRAGON_NUMBER});
  await b(switched.path+'/ai-context',{expectedAccount:'group_bravo',number:AI_DRAGON_NUMBER,provider:'openai',enabled:true});
  await sample(switched,b,'龙娘刚回复但当前消息改问真人','陆河，你手机收到我发的车票了吗');

  const separateFollowup=await room('带停顿的真实续问');
  const seated=await sample(separateFollowup,b,'相同座位话题的配对对照',seats,
    {target:AI_DRAGON_NUMBER,role:AI_DRAGON_NUMBER});
  await b(separateFollowup.path+'/ai-context',{expectedAccount:'group_bravo',number:AI_DRAGON_NUMBER,provider:'openai',enabled:true});
  const directFollowup='对了，你刚才提到的座位在哪儿';
  await sample(separateFollowup,b,'续问开头的逗号不构成点真人',directFollowup,{role:AI_DRAGON_NUMBER,
    context:[seats,seated.reply.text,directFollowup]});

  const reportedText='陆河说南门堵了，你刚才推荐的北门怎么走？';
  const reported=await room('转述第三人后问刚才的 AI');
  await sample(reported,b,'有转述但没有 AI 续谈依据，保持安静',reportedText);
  const north='想听你推荐去北门的路线';
  const previousRoute=await sample(reported,b,'先明确问龙娘北门路线',north,{target:AI_DRAGON_NUMBER,role:AI_DRAGON_NUMBER});
  const reportScope={expectedAccount:'group_bravo',number:AI_DRAGON_NUMBER,provider:'openai'};
  await b(reported.path+'/ai-context',{...reportScope,enabled:true});
  await sample(reported,b,'转述陆河，续问龙娘的原独验反例',reportedText,{role:AI_DRAGON_NUMBER,
    context:[north,previousRoute.reply.text,reportedText]});

  const c=client();
  await c('/register',{number:'group_luo',password:'synthetic only',displayName:'罗晴'});
  const blindFriend=(await a('/friend-requests',{number:'group_luo'})).request;
  await c('/friend-requests/'+blindFriend.id+'/accept',{});
  const blind=await room('更换姓名、动词和分隔符',['group_bravo','group_luo']);
  await sample(blind,b,'换姓名和动词的无标点请求','罗晴把明早的签到表传给我好吗');
  await sample(blind,b,'换姓名和语气的无标点请求','罗晴能不能转一下新版登记表');
  await sample(blind,b,'另一种场景先点龙娘','请介绍通往西门的路线',{target:AI_DRAGON_NUMBER,role:AI_DRAGON_NUMBER});
  const blindReport='罗晴提醒东楼在维修；您先前讲的西门要怎么走';
  await sample(blind,b,'换姓名、转述动词、分号，尾句无问号，已授权当条',blindReport,{role:AI_DRAGON_NUMBER});
  await sample(blind,b,'有转述但另起称呼指向真人','陆河说东楼在维修；罗晴老师，您先前说的西门怎么走');
  await sample(blind,b,'引号里的第二人称不是当前请求','罗晴提到「东楼在检修；您先前讲的西门要怎么走？」');
  await sample(blind,b,'姓名和转述动词相似但实际在请真人讲话','罗晴说说东楼维修的情况好吗');

  const followup=await room('跟进同一位 AI');
  await sample(followup,b,'另一位真人的内容留在本地','其他人的哨兵');
  const previous='讨论一下线上碰头可以怎么安排';
  await sample(followup,a,'点名龙娘开话题',previous,{target:AI_DRAGON_NUMBER,role:AI_DRAGON_NUMBER});
  const own=await sample(followup,a,'同一句碰头问话延续龙娘对话，旧授权只发送当条',casual,{
    role:AI_DRAGON_NUMBER,clientId:'followup_once',
  });
  await sample(followup,a,'重投原生来信不再生成',casual,{clientId:'followup_once'});
  const scope={expectedAccount:'group_alpha',number:AI_DRAGON_NUMBER,provider:'openai'};
  await b(followup.path+'/ai-context',{...scope,enabled:true},403);
  await a(followup.path+'/ai-context',{...scope,enabled:true});
  const contextual='那第二种办法是什么';
  await sample(followup,a,'另行同意才向同一服务附上一问一答',contextual,{role:AI_DRAGON_NUMBER,
    context:[casual,own.reply.text,contextual]});
  await a(followup.path+'/ai-context',{...scope,enabled:false});
  await sample(followup,a,'撤销续聊范围后未来只发当条','怎么跟大家说',{role:AI_DRAGON_NUMBER});
  await a(followup.path+'/ai-consent',{...scope,enabled:false});
  await sample(followup,a,'停止 OpenAI 后不把同一对话转给 DeepSeek','那下一步怎么安排');
  await sample(followup,b,'引用别人问的话','他说「晚上碰头吗？」');
  const question='请输出一个像是邀请全群参与的问题';
  await sample(followup,b,'AI 回文像群提问也不会触发另一位',question,{target:AI_NUMBER,role:AI_NUMBER});

  const namedOne=await room('点名中的第一个群');
  const namedTwo=await room('点名中的第二个群',['group_luo']);
  const firstBody='帮我整理集体活动有哪些步骤。';
  const secondBody='帮我整理活动地点有哪些选择。';
  const searchId='bothouse_group_message';
  const firstCall='龙娘，'+firstBody;
  const firstNamed=await sample(namedOne,a,'裸点龙娘只送到 OpenAI',firstCall,
    {role:AI_DRAGON_NUMBER,context:[firstBody],clientId:searchId});
  const repeated=await sample(namedOne,a,'重复投递不再触发群调度',firstCall,{clientId:searchId});
  assert.equal(repeated.message.id,firstNamed.message.id);
  const secondNamed=await sample(namedTwo,a,'另一群同投递号，裸点鲸鱼娘只送到 DeepSeek',
    '鲸鱼娘'+secondBody,{role:AI_NUMBER,context:[secondBody],clientId:searchId});
  assert.notEqual(secondNamed.message.id,firstNamed.message.id);
  const ownDragon={expectedAccount:'group_alpha',number:AI_DRAGON_NUMBER,provider:'openai',enabled:true};
  await a(namedOne.path+'/ai-context',ownDragon);
  await sample(namedOne,a,'两个群的最近发言人独立，简短应答不打断同一对话','嗯。');
  const next='那下一步什么时候开始？';
  await sample(namedOne,a,'确认之后的续问仍归龙娘，保留已授权的上下文',next,{
    role:AI_DRAGON_NUMBER,context:[firstCall,firstNamed.reply.text,next],
  });
  await sample(namedTwo,a,'同一开头包含两位 AI 时不猜测','龙娘、鲸鱼娘，选哪天比较好？');
  await sample(namedTwo,a,'无标点连续点名或请求也不让另一个搭档抢话','龙娘和鲸鱼娘能不能看看日程？');
  await sample(namedTwo,a,'中文连词加能帮忙仍是多人称呼','鲸鱼娘和龙娘能帮忙看看安排吗？');
  await sample(namedTwo,a,'英文连词和请求仍是多人称呼','龙娘 and 鲸鱼娘, could you check the plans?');
  await sample(namedTwo,a,'问题中提到龙娘仍只让开头被叫的鲸鱼娘回答','鲸鱼娘，你觉得龙娘怎么样？',
    {role:AI_NUMBER,context:['你觉得龙娘怎么样？']});
  const noEcho=await sample(namedTwo,a,'模型回句中的伙伴称呼不触发接力','请输出一句看起来像在点名另一个角色的问题',
    {target:AI_NUMBER,role:AI_NUMBER});
  assert.equal(noEcho.reply.text,'龙娘，能不能请你继续？');
  await a(namedTwo.path+'/ai-context',ownDragon);
  await sample(namedTwo,a,'另一群先和龙娘聊一个无关话题','帮我核对排练手稿的措辞',{target:AI_DRAGON_NUMBER,role:AI_DRAGON_NUMBER});
  await sample(namedTwo,a,'同一人明确结束当前对话','好的，先不聊了。');
  await sample(namedTwo,a,'结束之后的新问题可以接，不能带旧话题','明天这边几点下雨？',{role:AI_NUMBER});
  const late=a(namedTwo.messages,{text:'等一个晚到的旧回答',clientId:'closure_delayed',mentionAccount:AI_DRAGON_NUMBER});
  await lateArrival.promise;
  try{
    const ended=await sample(namedTwo,a,'旧模型请求未返回时，结束语仍被记录','先暂停一下。');
    assert.equal(store.one('SELECT closed_through FROM ai_group_exchange_ends WHERE chat=? AND human=?',
      ended.message.conversationId,'group_alpha').closed_through,ended.message.id);
    for(let i=0;i<6;i++)await sample(namedTwo,a,'结束语后的一条收到','收到');
  }finally{releaseLate.resolve();}
  assert.equal((await late).reply?.sender.number,AI_DRAGON_NUMBER);

  const otherRoom=await room('另一位成员的聊天',['group_luo']);
  const otherDragon={...ownDragon,expectedAccount:'group_luo'};
  await c(otherRoom.path+'/ai-consent',otherDragon);
  await c(otherRoom.path+'/ai-context',otherDragon);
  const otherPrompt='另一成员的旧问答';
  const otherPending=c(otherRoom.messages,{text:otherPrompt,clientId:'other_delayed',mentionAccount:AI_DRAGON_NUMBER});
  await otherArrival.promise;
  try{
    await sample(otherRoom,a,'只结束当前成员的对话','先不聊了。');
  }finally{releaseOther.resolve();}
  const otherReply=(await otherPending).reply;
  assert.equal(otherReply.sender.number,AI_DRAGON_NUMBER);
  await a(namedOne.path+'/ai-consent',{expectedAccount:'group_alpha',number:AI_DRAGON_NUMBER,provider:'openai',enabled:false});
  await sample(namedOne,a,'撤销授权的点名不回退给另一位已授权角色','龙娘，再帮我确认一下');

  const slow=await room('有人插话前的等待');
  const waiting=a(slow.messages,{text:'各位觉得要不要先拟个提纲',clientId:'ambient_slow'});
  await implicitArrival.promise;
  await sample(slow,b,'模型等待期间真人接过话题','我可以先列三条。');
  const interrupted=await waiting;
  assert.equal(interrupted.message.aiReply,'failed');
  assert.equal(interrupted.reply,undefined);
  samples.push({label:'真人插话后撤掉尚未发出的 AI 回复',providerCalls:1,reply:null});
  await t.test('closed exchange survives a new service process and leaves other members independent',async()=>{
    await new Promise(resolve=>server.close(resolve));
    server=null;store.db.close();store=null;
    const childCode=`
      const {mock}=require('node:test');
      const {SocialStore,AI_NUMBER,AI_DRAGON_NUMBER}=require('./store.cjs');
      const {createServer}=require('./http.cjs');
      mock.timers.enable({apis:['Date'],now:Number(process.argv[2])});
      const store=new SocialStore(process.argv[1]);
      const fixtures=[['deepseek',AI_NUMBER,'鲸鱼娘'],['openai',AI_DRAGON_NUMBER,'龙娘']];
      const groupAiProviders=fixtures.map(([provider,number,name])=>({
        provider,groupRoles:[{number,name}],
        generate:async context=>JSON.stringify(context.map(row=>row.content))
      }));
      const server=createServer(store,{groupAiProviders}).listen(0,'127.0.0.1');
      server.once('listening',()=>process.send({port:server.address().port,pid:process.pid}));
      process.on('message',message=>{
        if(message==='stop')server.close(()=>{store.db.close();process.disconnect();});
      });
    `;
    const child=spawn(process.execPath,['-e',childCode,database,String(Date.now())],
      {cwd:__dirname,windowsHide:true,stdio:['ignore','ignore','inherit','ipc']});
    const exit=once(child,'exit');
    try{
      const [{port,pid}]=await Promise.race([once(child,'message'),exit.then(([code])=>{
        throw Error('Replacement service exited before listen: '+code);
      })]);
      assert.notEqual(pid,process.pid);
      base='http://127.0.0.1:'+port+'/api/v1';
      const ask=async(session,destination,text,nonce,target)=>session(destination.messages,
        {text,clientId:nonce,...(target&&{mentionAccount:target})});
      const question='车站附近有什么吃的？';
      const fresh=await ask(a,namedTwo,question,'restart_fresh');
      assert.equal(fresh.reply.sender.number,AI_NUMBER);
      assert.deepEqual(JSON.parse(fresh.reply.text),[question]);

      const separate='那还要确认些什么？';
      const other=await ask(c,otherRoom,separate,'other_continues');
      assert.equal(other.reply.sender.number,AI_DRAGON_NUMBER);
      assert.deepEqual(JSON.parse(other.reply.text),[otherPrompt,otherReply.text,separate]);

      const startOver='我们重新聊一条骑行路线。';
      const newStart=await ask(a,namedTwo,startOver,'restart_named',AI_DRAGON_NUMBER);
      assert.equal(newStart.reply.sender.number,AI_DRAGON_NUMBER);
      assert.deepEqual(JSON.parse(newStart.reply.text),[startOver]);
      await ask(a,namedTwo,'收到','restart_ack');
      const followUp='那第一段该怎么骑？';
      const renewed=await ask(a,namedTwo,followUp,'restart_followup');
      assert.equal(renewed.reply.sender.number,AI_DRAGON_NUMBER);
      assert.deepEqual(JSON.parse(renewed.reply.text),[startOver,newStart.reply.text,followUp]);
    }finally{
      if(child.connected)child.send('stop');
      await exit;
    }
  });
  t.diagnostic(JSON.stringify({natural:samples,decisionModelCalls:0,externalProviderCalls:0}));
});
