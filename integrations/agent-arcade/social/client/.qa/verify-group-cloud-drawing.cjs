'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
const {createServer:loopback}=require('node:http');
const {Readable}=require('node:stream');
const {chromium}=require('playwright');
const {SocialStore,AI_NUMBER}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {cloudDrawingProvider}=require('../../server/group-cloud-drawing.cjs');
const {moderate}=require('../../server/moderate.cjs');

const accountId='a'.repeat(32);
const token='synthetic-workers-token';
const model='@cf/black-forest-labs/flux-2-klein-4b';
const prompt='潮汐旁的折纸小船，蓝色三角帆上有三道细纹，水面映着橙色路灯';
const title='群内云生图合成验收';
const html=(page,selector)=>page.locator(selector);
const btn=(page,name)=>page.getByRole('button',{name,exact:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

async function register(browser,origin,number){
  const context=await browser.newContext({baseURL:origin,viewport:{width:420,height:840},serviceWorkers:'block'});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page=await context.newPage();
  await page.goto(origin);
  await btn(page,'创建账号').click();
  await html(page,'[name=number]').fill(number);
  await html(page,'[name=displayName]').fill(number);
  await html(page,'[name=password]').fill('draw-synthetic-password-only');
  await html(page,'#auth-submit').click();
  await html(page,'#directory-title').getByText('消息',{exact:true}).waitFor();
  return page;
}
async function api(page,route,data,status=200){
  const response=await page.request.fetch('/api/v1'+route,{method:data===undefined?'GET':'POST',data});
  assert.equal(response.status(),status);
  return response.json();
}
async function send(page,text){
  const pending=page.waitForResponse(row=>row.request().method()==='POST'&&row.url().endsWith('/messages'));
  await html(page,'#message').fill(text);
  await btn(page,'发送').click();
  const response=await pending;
  assert.equal(response.status(),200);
  return response.json();
}
async function receive(page,chat,reply,expected,mime='image/png'){
  assert.equal(reply.sender.number,AI_NUMBER);
  assert.equal(reply.text,'[AI 绘图]');
  assert(reply.attachment.drawing);
  const image=html(page,`[data-image-id="${reply.id}"] img`);
  await image.scrollIntoViewIfNeeded();
  await image.evaluate(image=>image.decode());
  assert.equal(await image.getAttribute('alt'),'AI 绘制的图片');
  assert.equal(await image.evaluate(image=>image.naturalWidth),256);
  const route=`/api/v1/conversations/${chat}/messages/${reply.id}/image`;
  const file=await page.request.get(route);
  assert.equal(file.status(),200);
  assert.equal(file.headers()['content-type'],mime);
  const bytes=await file.body();
  assert.deepEqual(bytes,expected);
  return {message:reply.id,sha256:sha(bytes),route};
}
const useServer=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const stopServer=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});

async function main(){
  const proof=process.argv[2]&&path.resolve(process.argv[2]);
  if(proof)await fs.mkdir(proof,{recursive:true});
  const temporary=await fs.realpath(os.tmpdir());
  const scratch=await fs.mkdtemp(path.join(temporary,'arcade-social-drawing-'));
  const store=new SocialStore(path.join(scratch,'drawing.sqlite'));
  const wires=[],modelCalls=[];
  const avatarSha=sha(await fs.readFile(path.join(__dirname,'../art/whale.png')));
  let fixture,jpeg,browser,server;
  const pending=Promise.withResolvers(),released=Promise.withResolvers();
  const upstream=loopback((req,res)=>void (async()=>{
    const form=await new Request('http://127.0.0.1'+req.url,{
      method:req.method,headers:req.headers,body:Readable.toWeb(req),duplex:'half',
    }).formData();
    const fields=Object.fromEntries(form);
    const reference=fields.input_image_0;
    const referenceSha=reference?sha(Buffer.from(await reference.arrayBuffer())):null;
    assert.deepEqual(Object.keys(fields).sort(),reference?['height','input_image_0','prompt','width']:['height','prompt','width']);
    delete fields.input_image_0;
    assert.deepEqual([fields.height,fields.width],['1024','1024']);
    assert.equal(req.headers.authorization,'Bearer '+token);
    wires.push({path:req.url,method:req.method,fields,referenceSha});
    if(fields.prompt.includes('限流样图')){
      res.writeHead(429,{'Content-Type':'application/json'});
      res.end(JSON.stringify({success:false,errors:[{code:3040}]}));return;
    }
    if(fields.prompt.includes('坏图样例')){
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({success:true,result:{image:'bm90IGFuIGltYWdl'}}));return;
    }
    if(fields.prompt.includes('在途样图')){pending.resolve();await released.promise;}
    res.writeHead(200,{'Content-Type':'application/json'});
    const pixels=fields.prompt.includes('河面倒映')?jpeg:fixture;
    res.end(JSON.stringify({success:true,result:{image:pixels.toString('base64')}}));
  })().catch(error=>{res.writeHead(500);res.end();pending.reject(error);}));
  const nativeFetch=globalThis.fetch;
  try{
    await useServer(upstream);
    const drawingProvider=cloudDrawingProvider({accountId,apiToken:token,timeoutMs:15000,
      fetchImpl:(target,options)=>{
        const endpoint=new URL(target);
        assert.equal(endpoint.origin,'https://api.cloudflare.com');
        assert.equal(endpoint.pathname,'/client/v4/accounts/'+accountId+'/ai/run/'+model);
        assert.equal(options.redirect,'error');
        return nativeFetch('http://127.0.0.1:'+upstream.address().port+endpoint.pathname,options);
      }});
    // Public-search fallbacks must not escape the fixture.
    globalThis.fetch=(target,options)=>{
      assert.equal(new URL(target).hostname,'127.0.0.1');
      return nativeFetch(target,options);
    };
    const ai={name:'鲸鱼娘',provider:'deepseek',groupRoles:[{number:AI_NUMBER,name:'鲸鱼娘'}],
      async generate(rows){modelCalls.push(rows);return '这条由文字模型回复。';}};
    server=createServer(store,{aiProvider:ai,drawingProvider});
    await useServer(server);
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    const [a,b,other]=await Promise.all(['draw_alice','draw_bobby','draw_outside'].map(number=>register(browser,origin,number)));
    const encoded=await a.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
      const c=canvas.getContext('2d'), sky=c.createLinearGradient(0,0,0,256);
      sky.addColorStop(0,'#16162d');sky.addColorStop(1,'#526ca8');
      c.fillStyle=sky;c.fillRect(0,0,256,256);
      c.fillStyle='#1e3553';c.fillRect(0,180,256,76);
      c.fillStyle='#ffdb94';c.beginPath();c.moveTo(137,97);c.lineTo(250,57);c.lineTo(249,137);c.closePath();c.fill();
      c.fillStyle='#e9dcbb';c.fillRect(112,95,29,97);
      c.fillStyle='#a1424c';c.fillRect(112,131,29,15);c.fillRect(112,161,29,15);
      c.beginPath();c.moveTo(106,96);c.lineTo(145,96);c.lineTo(126,72);c.closePath();c.fill();
      c.strokeStyle='#9abed4';
      for(const [x,y] of [[15,196],[85,218],[170,234],[36,231],[202,197]]){c.beginPath();c.moveTo(x,y);c.lineTo(x+25,y);c.stroke();}
      return ['image/png','image/jpeg'].map(mime=>canvas.toDataURL(mime).split(',')[1]);
    });
    [fixture,jpeg]=encoded.map(value=>Buffer.from(value,'base64'));
    await btn(other,'添加朋友').first().click();
    await other.getByLabel('对方的用户号').fill('arcade_dragon');
    await btn(other,'查找').click();
    await btn(other,'添加 AI 好友').click();
    await other.waitForURL(url=>url.hash.startsWith('#chat/'));
    const aiFriend=(await api(other,'/conversations')).conversations.find(chat=>chat.members.some(member=>member.number==='arcade_dragon'));
    assert.equal(aiFriend?.requiresAiCloudConsent,true);
    assert(!aiFriend.cloudChat);
    assert((await api(other,'/friends')).friends.some(friend=>friend.number==='arcade_dragon'));
    if(proof)await other.screenshot({path:path.join(proof,'AI好友已通过.png')});
    const {request}=await api(a,'/friend-requests',{number:'draw_bobby'});
    await api(b,'/friend-requests/'+request.id+'/accept',{});
    const {conversation:group}=await api(a,'/groups',{title,memberNumbers:['draw_bobby']});
    const groupPath='/groups/'+group.id;
    await Promise.all([a,b].map(page=>page.goto(origin+'/#chat/'+group.id)));
    await btn(a,'群成员').click();
    await btn(a,'群内 AI').click();
    await btn(a,'加入鲸鱼娘（DeepSeek）').click();
    await btn(a,'同意发给 DeepSeek').click();
    await html(a,'#dialog').getByText('云生图已开启 · 今日 0/3 次',{exact:true}).waitFor();
    if(proof)await a.screenshot({path:path.join(proof,'群绘图默认.png')});
    await btn(a,'关闭云生图').click();
    await html(a,'#dialog').getByText('云生图已关闭',{exact:true}).waitFor();
    await btn(a,'关闭').click();
    const disabled=await send(a,'@鲸鱼娘 画一张'+prompt);
    assert.match(disabled.reply.text,/已为我关闭云生图/u);
    assert.equal(wires.length,0);
    await api(b,groupPath+'/ai-drawing',{expectedAccount:'draw_bobby',number:AI_NUMBER,enabled:true},403);
    await btn(a,'群成员').click();
    await btn(a,'群内 AI').click();
    await btn(a,'开启云生图').click();
    await html(a,'#dialog').getByText('云生图已开启 · 今日 0/3 次',{exact:true}).waitFor();
    if(proof)await a.screenshot({path:path.join(proof,'群绘图设置.png')});
    await btn(a,'关闭').click();
    await send(b,'群友私密历史哨兵，不属于画面描述。');
    const unanointed=await send(b,'@鲸鱼娘 画一张小兔子');
    assert.equal(unanointed.reply,undefined);
    const plain=await send(a,'画一张未点名的候鸟');
    assert.equal(plain.reply,undefined);
    const emptyResend=await send(a,'@鲸鱼娘 再发一次');
    assert.match(emptyResend.reply.text,/没找到/u);
    for(const page of [a,b]){
      await btn(page,'图片').click();
      await html(page,'#dialog input[type=file]').setInputFiles({name:'synthetic-upload.png',mimeType:'image/png',buffer:fixture});
      const uploadAck=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/images'));
      await btn(page,'发送图片').click();
      assert.equal((await uploadAck).status(),200);
      await html(page,'#dialog').waitFor({state:'hidden'});
    }
    const usedDrawingQuota=async()=>(await api(a,groupPath+'/ai')).groupAi.joined[0].drawing.usedToday;
    const beforeReference=await usedDrawingQuota();
    const blockedReferences=[];
    for(const text of [
      '照着我刚发的照片画一张肖像',
      '画一张以我刚传上来的照片为底稿的小熊插画',
      '画一张拿我先前贴上来的合照当底稿的登山纪念图',
      '画一张小熊插画，参考群友刚发的照片',
      '画一张小熊插画，参考你的公开头像和我刚发的照片',
    ]){
      const calls=wires.length;
      const modelCount=modelCalls.length;
      const quota=await usedDrawingQuota();
      const result=await send(a,'@鲸鱼娘 '+text);
      assert.equal(result.reply.text,'群聊照片和其他人的图片无法用作绘图参考。可指定当前角色的公开头像或本群已批准的卡面。',text);
      assert.equal(result.reply.attachment,undefined,text);
      assert.equal(wires.length,calls,text);
      assert.equal(modelCalls.length,modelCount,text);
      const used=await usedDrawingQuota();
      assert.equal(used,quota,text);
      blockedReferences.push({text,providerCalls:wires.length-calls,quotaUsed:used-quota});
    }
    const afterReference=await usedDrawingQuota();
    assert.equal(beforeReference,afterReference);
    const held=await send(a,'@鲸鱼娘 画一张'+prompt+'，先别画');
    assert.equal(held.reply?.attachment?.drawing,undefined);
    const quote=await send(a,'@鲸鱼娘 画一张'+prompt+'，先报个价');
    assert.equal(quote.reply?.attachment?.drawing,undefined);
    const lookup=await send(a,'@鲸鱼娘 帮我找一张金色印刷机表情包');
    assert.equal(wires.length,0);
    assert.equal(lookup.reply?.attachment?.drawing,undefined);
    const capabilities=await send(a,'@鲸鱼娘 能不能画图？');
    assert.match(capabilities.reply.text,/已开启.*可能计入/u);
    const nonDrawingTurns=[];
    for(const text of [
      '画一张'+prompt+'，先报个价',
      '画一张'+prompt+'，先别画',
      '画一张'+prompt+'，得用哪些工具',
      '帮我找一张金色印刷机表情包',
      '他们上次画的帆船很漂亮',
      '画一张拎着纸灯的熊，参考我刚发的照片',
    ]){
      const count=wires.length;
      const turn=await send(a,'@鲸鱼娘 '+text);
      assert.equal(turn.reply?.attachment?.drawing,undefined,text);
      assert.equal(wires.length,count,text);
      nonDrawingTurns.push({text,providerCalls:wires.length-count,reply:turn.reply?.text});
    }
    const beforeModel=modelCalls.length;

    await btn(a,'群成员').click();
    await btn(a,'群内 AI').click();
    await btn(a,'@鲸鱼娘（AI）').click();
    const created=await send(a,'画一张'+prompt+'，取名『蓝帆对照』');
    const first=await receive(b,group.id,created.reply,fixture);
    assert.equal(created.reply.attachment.drawing.title,'蓝帆对照');
    assert.equal(wires[0].referenceSha,null);
    assert.deepEqual(wires[0].fields,{prompt,width:'1024',height:'1024'});
    assert.equal(modelCalls.length,beforeModel);
    const replay=await api(a,`/conversations/${group.id}/messages`,{clientId:created.message.clientId,text:created.message.text,
      mentionAccount:created.message.mention?.number});
    assert.equal(replay.message.id,created.message.id);
    assert.equal(replay.reply,undefined);
    const resent=await send(a,'再发一次');
    const second=await receive(b,group.id,resent.reply,fixture);
    assert.notEqual(first.message,second.message);
    assert.equal(first.sha256,second.sha256);
    assert.equal(wires.length,1);
    await b.reload();
    await receive(b,group.id,resent.reply,fixture);
    await html(b,`[data-image-id="${resent.reply.id}"]`).click();
    await html(b,'#dialog').getByText('由 Cloudflare Workers AI 生成。',{exact:true}).waitFor();
    await html(b,'#dialog img').evaluate(image=>image.decode());
    await html(b,'#dialog .save-chat-image').waitFor({state:'visible'});
    if(proof){
      await b.screenshot({path:path.join(proof,'收件人重发原图.png')});
      const recovered=await b.request.get(second.route);
      await fs.writeFile(path.join(proof,'收件人原图.png'),await recovered.body());
    }
    await btn(b,'关闭').click();
    assert.equal((await other.request.get(first.route)).status(),404);
    await api(b,groupPath+'/ai-consent',{expectedAccount:'draw_bobby',number:AI_NUMBER,provider:'deepseek',enabled:true});
    const wrongRequester=await send(b,'@鲸鱼娘 再发一次');
    assert.match(wrongRequester.reply.text,/没找到/u);
    assert.equal(wires.length,1);
    const failed=await send(a,'@鲸鱼娘 画一张限流样图里的帆船');
    assert.equal(failed.reply.attachment,undefined);
    assert.match(failed.reply.text,/限流.*没有生成/u);
    const inFlight=send(a,'@鲸鱼娘 画一张在途样图里的雨伞');
    await Promise.race([pending.promise,inFlight.then(()=>{throw Error('Expected cloud drawing request');})]);
    await api(a,groupPath+'/ai-drawing',{expectedAccount:'draw_alice',number:AI_NUMBER,enabled:false});
    released.resolve();
    const aborted=await inFlight;
    assert.equal(aborted.reply,undefined);
    await api(a,groupPath+'/ai-drawing',{expectedAccount:'draw_alice',number:AI_NUMBER,enabled:true});
    const capped=await send(a,'@鲸鱼娘 画一张超过额度后的孤舟');
    assert.match(capped.reply.text,/次数已用完/u);
    assert.equal(wires.length,3);
    const afterCap=await send(a,'再发一次');
    assert.equal((await receive(b,group.id,afterCap.reply,fixture)).sha256,first.sha256);
    assert.equal(wires.length,3);
    const {conversation:secondGroup}=await api(a,'/groups',{title:'无原图的对照群',memberNumbers:['draw_bobby']});
    const secondGroupPath='/groups/'+secondGroup.id;
    await api(a,secondGroupPath+'/ai',{expectedAccount:'draw_alice',number:AI_NUMBER,enabled:true});
    await api(a,secondGroupPath+'/ai-consent',{expectedAccount:'draw_alice',number:AI_NUMBER,provider:'deepseek',enabled:true});
    await a.goto(origin+'/#chat/'+secondGroup.id);
    const wrongChat=await send(a,'@鲸鱼娘 再发一次');
    assert.match(wrongChat.reply.text,/没找到/u);
    await api(a,secondGroupPath+'/ai-drawing',{expectedAccount:'draw_alice',number:AI_NUMBER,enabled:true});
    const invalid=await send(a,'@鲸鱼娘 画一张坏图样例里的船');
    assert.equal(invalid.reply.attachment,undefined);
    assert.match(invalid.reply.text,/没有返回可用图片/u);
    await b.goto(origin+'/#chat/'+secondGroup.id);
    const jpegDraw=await send(a,'@鲸鱼娘 画一张江岸的木桥，河面倒映着青色月光，取名「月下木桥」');
    const jpegReceived=await receive(b,secondGroup.id,jpegDraw.reply,jpeg,'image/jpeg');
    const busBrief='等电车的卖花姑娘，零钱从布袋中露出来，图上不要有字';
    const busText='现在就画一张'+busBrief;
    const beforeBus=wires.length;
    const bus=await send(a,'@鲸鱼娘 '+busText);
    assert.equal(wires.length,beforeBus+1);
    assert.equal(wires[beforeBus].fields.prompt,busBrief);
    const immediate={text:busText,providerCalls:1,original:await receive(b,secondGroup.id,bus.reply,fixture)};
    assert.equal(modelCalls.length,beforeModel);
    const delayed=[];
    async function verifyDeferred(chat,text){
      const calls=wires.length;
      const used=()=>store.one('SELECT count(*) AS n FROM ai_group_draw_requests WHERE chat=?',chat).n;
      const previous=used();
      const turn=await send(a,'@鲸鱼娘 '+text);
      const received=(await api(b,`/conversations/${chat}/messages`)).messages.find(row=>row.id===turn.reply?.id);
      assert.equal(received?.text,'这条由文字模型回复。',text);
      assert.equal(received.attachment,undefined,text);
      assert.equal(wires.length,calls,text);
      assert.equal(used(),previous,text);
      delayed.push({text,providerCalls:wires.length-calls,quotaReservations:used()-previous,recipientMessage:received.id,reply:received.text});
    }
    for(const text of [
      '画一张海边的小木屋，等我说开始就动笔',
      '画一张河边的小桥，费用先说一下',
      '画一张红砖小站，生图的次数先确认下',
      '画一张草原上的木门，要扣几次',
      '画一张车站的钟，还剩几次',
      '画一张木船，先说下',
      '画一张黄昏的老钟，确认了就开画',
    ])await verifyDeferred(secondGroup.id,text);
    await b.goto(origin+'/#chat/'+group.id);
    await receive(b,group.id,resent.reply,fixture);
    const report=store.report('draw_bobby',group.id,first.message,'synthetic moderation');
    moderate(store,'remove',report.id);
    assert.equal((await b.request.get(first.route)).status(),404);
    assert.equal((await b.request.get(second.route)).status(),404);
    await b.locator(`[data-image-id="${second.message}"]`).waitFor({state:'detached'});
    await a.goto(origin+'/#chat/'+group.id);
    const removed=await send(a,'再发一次');
    assert.match(removed.reply.text,/没找到/u);
    assert.equal(wires.length,6);
    const {conversation:detailGroup}=await api(a,'/groups',{title:'独立画面续句对照',memberNumbers:['draw_bobby']});
    const detailPath='/groups/'+detailGroup.id;
    await api(a,detailPath+'/ai',{expectedAccount:'draw_alice',number:AI_NUMBER,enabled:true});
    await api(a,detailPath+'/ai-consent',{expectedAccount:'draw_alice',number:AI_NUMBER,provider:'deepseek',enabled:true});
    await api(a,detailPath+'/ai-drawing',{expectedAccount:'draw_alice',number:AI_NUMBER,enabled:true});
    await Promise.all([a,b].map(page=>page.goto(origin+'/#chat/'+detailGroup.id)));
    for(const text of [
      '画一张你自己的表情，先报费用',
      '画一张小船，等我说开始再动笔',
      '画一张山谷里的纸桥先把预计费用告诉我',
      '画一张悬在走廊里的纸鹤，先估算一下这次的成本',
      '画一张晨雾里的站台，等我说「开画」，才开始画',
      '画一张紫藤花架，收到我的口令再动手',
      '画一张黄昏的小巷，只有预算确认后才出图',
    ])await verifyDeferred(detailGroup.id,text);
    const beforeImmediateDrawing=modelCalls.length;
    const additional=[];
    for(const [brief,caption] of [
      ['你自己的表情，抱一盏蓝纸灯',''],
      ['旧温室旁的药草摊，铜壶盖上结了一圈霜，苜蓿从砖缝钻出来','铜壶'],
      ['院子里修钟的狸猫，俯身把耳朵凑近齿轮，袖口绣着细小的菱形','齿轮'],
    ]){
      const count=wires.length;
      const text='画一张'+brief+(caption?'，取名「'+caption+'」':'');
      const turn=await send(a,'@鲸鱼娘 '+text);
      assert.equal(wires.length,count+1,text);
      const wire=wires[count];
      if(brief.startsWith('你自己')){
        assert.equal(wire.referenceSha,avatarSha,text);
        assert.match(wire.fields.prompt,/公开头像作为人物参考/u,text);
        assert.ok(wire.fields.prompt.endsWith(brief),text);
      }else{
        assert.equal(wire.referenceSha,null,text);
        assert.equal(wire.fields.prompt,brief);
      }
      assert.equal(turn.reply.attachment.drawing.title,caption);
      additional.push({text,providerCalls:1,referenceSha:wire.referenceSha,original:await receive(b,detailGroup.id,turn.reply,fixture)});
    }
    assert.equal(modelCalls.length,beforeImmediateDrawing);
    const {conversation:avatarGroup}=await api(a,'/groups',{title:'公开头像原句对照',memberNumbers:['draw_bobby']});
    const avatarPath='/groups/'+avatarGroup.id;
    await api(a,avatarPath+'/ai',{expectedAccount:'draw_alice',number:AI_NUMBER,enabled:true});
    await api(a,avatarPath+'/ai-consent',{expectedAccount:'draw_alice',number:AI_NUMBER,provider:'deepseek',enabled:true});
    await api(a,avatarPath+'/ai-drawing',{expectedAccount:'draw_alice',number:AI_NUMBER,enabled:true});
    await Promise.all([a,b].map(page=>page.goto(origin+'/#chat/'+avatarGroup.id)));
    const avatarText='画一张你的头像';
    const beforeAvatar=wires.length;
    const avatarTurn=await send(a,'@鲸鱼娘 '+avatarText);
    assert.equal(wires.length,beforeAvatar+1);
    const avatarWire=wires[beforeAvatar];
    assert.equal(avatarWire.referenceSha,avatarSha);
    assert.match(avatarWire.fields.prompt,/公开头像作为人物参考/u);
    const explicitAvatar={text:avatarText,referenceSha:avatarWire.referenceSha,
      original:await receive(b,avatarGroup.id,avatarTurn.reply,fixture)};
    const result={first,second,jpegReceived,additional,explicitAvatar,immediate,delayed,nonDrawingTurns,wires,accountTokenRecorded:false,realExternalRequests:0,
      allowedOriginalAndResend:true,requesterAndGroupScoped:true,removedOriginalBlocksCopies:true,
      duplicateDidNotGenerate:true,lookupDidNotGenerate:true,disabledAndUnconsentedDidNotGenerate:true,
      blockedReference:true,blockedReferences,simulatedAttempts:wires.length,noChargeForResend:true,revokedInFlightNoImage:true,
      malformedProviderImageRejected:true,referenceQuotaBefore:beforeReference,referenceQuotaAfter:afterReference};
    if(proof)await fs.writeFile(path.join(proof,'receipt.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result));
  }finally{
    released.resolve();
    globalThis.fetch=nativeFetch;
    await browser?.close();
    if(server?.listening)await stopServer(server);
    if(upstream.listening)await stopServer(upstream);
    store.db.close();
    assert.equal(path.dirname(scratch),temporary);
    assert.match(path.basename(scratch),/^arcade-social-drawing-[a-z0-9]{6}$/iu);
    await fs.rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
