'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const { SocialStore, AI_NUMBER } = require('../../server/store.cjs');
const { createServer } = require('../../server/http.cjs');
const { moderate } = require('../../server/moderate.cjs');
const { makeBackup } = require('../../deploy/backup.cjs');

const password = 'synthetic-image-check-only';
const button = (scope,name) => scope.getByRole('button',{name,exact:true});
const preview = page => page.locator('#history img[alt="聊天图片"]');
const sha = value => createHash('sha256').update(value).digest('hex');

async function serve(store,aiProvider) {
  const server = createServer(store,{aiProvider});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return {server,origin:'http://127.0.0.1:'+server.address().port};
}

async function stop(server) {
  if(!server?.listening)return;
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}

async function register(browser,origin,number,width) {
  const context = await browser.newContext({viewport:{width,height:820},serviceWorkers:'block'});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page = await context.newPage();
  await page.goto(origin);
  await button(page,'创建账号').click();
  await page.locator('[name=number]').fill(number);
  await page.locator('[name=displayName]').fill(number);
  await page.locator('[name=password]').fill(password);
  await page.locator('#auth-submit').click();
  await page.getByRole('heading',{name:'消息',exact:true}).waitFor();
  return {context,page,number};
}

async function json(page,origin,endpoint,data,status=200) {
  const url=origin+'/api/v1'+endpoint;
  const response=data===undefined?await page.request.get(url):await page.request.post(url,{data});
  const body=await response.json();
  assert.equal(response.status(),status,JSON.stringify(body));
  return body;
}

async function chooseAndSend(page,fixture) {
  await button(page,'图片').click();
  await page.getByLabel('选择一张图片').setInputFiles(fixture);
  await page.locator('#dialog img.attachment-preview').waitFor({state:'visible'});
  const reply=page.waitForResponse(res=>res.url().endsWith('/images')&&res.request().method()==='POST');
  await button(page,'发送图片').click();
  const res=await reply;
  assert.equal(res.status(),200);
  assert.deepEqual(res.request().postDataBuffer(),fixture.buffer);
  const sent=(await res.json()).message;
  assert.equal(sent.attachment.mime,fixture.mimeType);
  assert.equal(sent.attachment.bytes,fixture.buffer.length);
  await page.locator('#dialog').waitFor({state:'hidden'});
  return sent;
}

async function original(page,index,width,height) {
  await button(page,'查看原图').nth(index).click();
  const selector='#dialog img.original-image';
  await page.waitForFunction(([selector,w,h])=>{
    const image=document.querySelector(selector);
    return image?.complete&&image.naturalWidth===w&&image.naturalHeight===h;
  },[selector,width,height]);
  const save=page.getByRole('link',{name:'保存图片'});
  await save.waitFor({state:'visible'});
  const href=new URL(await save.getAttribute('href'),page.url());
  assert.match(href.pathname,/^\/api\/v1\/conversations\/[^/]+\/messages\/\d+\/image\/download$/u);
}

function address(origin,message) {
  return origin+'/api/v1/conversations/'+message.conversationId+'/messages/'+message.id+'/image';
}

async function readOriginal(request,url,bytes) {
  const response=await request.get(url);
  assert.equal(response.status(),200);
  assert.equal(response.headers()['cache-control'],'no-store');
  assert.equal(response.headers()['cross-origin-resource-policy'],'same-origin');
  assert.deepEqual(await response.body(),bytes);
}

async function main() {
  if(process.argv[2])await fs.mkdir(process.argv[2],{recursive:true});
  const tempRoot=await fs.realpath(os.tmpdir());
  const scratch=await fs.mkdtemp(path.join(tempRoot,'arcade-social-images-'));
  const db=path.join(scratch,'source.sqlite');
  const source=new SocialStore(db);
  let browser, server, replica, restoredServer, cloudCalls=0;
  try {
    const listener=await serve(source,{generate:async()=>{cloudCalls++;throw Error('unexpected paid model');}});
    server=listener.server;
    const {origin}=listener;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    const [a,b,c]=await Promise.all([
      register(browser,origin,'image_a',1120),register(browser,origin,'image_b',390),register(browser,origin,'image_c',430),
    ]);
    const errors=[];
    for(const {page} of [a,b,c])page.on('pageerror',error=>errors.push(error.message));
    for(const friend of [b,c]){
      const {request}=await json(a.page,origin,'/friend-requests',{number:friend.number});
      await json(friend.page,origin,'/friend-requests/'+request.id+'/accept',{});
    }
    const fixtures=await a.page.evaluate(()=>{
      return ['image/png','image/jpeg'].map((type,index)=>{
        const canvas=document.createElement('canvas');canvas.width=240;canvas.height=160;
        const ctx=canvas.getContext('2d');
        ctx.fillStyle=index?'#14395f':'#6a4e84';ctx.fillRect(0,0,240,160);
        ctx.fillStyle=index?'#ffc56c':'#9ef0da';ctx.beginPath();ctx.arc(120,80,52,0,Math.PI*2);ctx.fill();
        return {mimeType:type,name:index?'synthetic.jpg':'synthetic.png',encoded:canvas.toDataURL(type).split(',')[1]};
      });
    });
    const [png,jpg]=fixtures.map(({encoded,...fixture})=>({...fixture,buffer:Buffer.from(encoded,'base64')}));
    const {conversation:direct}=await json(a.page,origin,'/direct',{number:b.number});
    const open=(page,id)=>page.goto(origin+'/#chat/'+id);
    await Promise.all([open(a.page,direct.id),open(b.page,direct.id)]);
    const first=await chooseAndSend(a.page,png);
    await preview(b.page).first().waitFor({state:'visible'});
    await original(b.page,0,240,160);
    await readOriginal(b.page.request,address(origin,first),png.buffer);
    if(process.argv[2])await b.page.screenshot({path:path.join(process.argv[2],'私聊原图.png')});
    await b.page.reload();
    await original(b.page,0,240,160);
    assert.equal((await c.page.request.get(address(origin,first))).status(),404);
    assert.equal((await fetch(address(origin,first))).status,401);

    const sendRaw=(chat,fixture,clientId=first.clientId)=>a.page.request.post(origin+'/api/v1/conversations/'+chat+'/images',{
      headers:{'Content-Type':fixture.mimeType,'X-Social-Account':a.number,'X-Social-Client-Id':clientId},
      data:fixture.buffer,
    });
    assert.deepEqual((await (await sendRaw(direct.id,png)).json()).message,first);
    assert.equal((await sendRaw(direct.id,jpg)).status(),409);
    assert.equal((await sendRaw(direct.id,{...png,mimeType:'image/jpeg'},'bad-image-mime')).status(),422);
    assert.equal((await sendRaw(direct.id,{...png,buffer:Buffer.alloc(4*1024*1024+1)},'too-big-image')).status(),413);

    const {conversation:group}=await json(a.page,origin,'/groups',{title:'图像验收合成群',memberNumbers:[b.number]});
    await Promise.all([open(a.page,group.id),open(b.page,group.id)]);
    const older=await chooseAndSend(a.page,jpg);
    await original(b.page,0,240,160);
    await readOriginal(b.page.request,address(origin,older),jpg.buffer);
    assert.equal((await c.page.request.get(address(origin,older))).status(),404);
    if(process.argv[2])await b.page.screenshot({path:path.join(process.argv[2],'群聊原图.png')});
    await button(b.page,'关闭').click();
    await json(a.page,origin,'/groups/'+group.id+'/members',{memberNumbers:[c.number]});
    await open(c.page,group.id);
    await c.page.getByText('还没有消息。先打个招呼。',{exact:true}).waitFor();
    assert.equal((await c.page.request.get(address(origin,older))).status(),404);
    const visible=await chooseAndSend(a.page,png);
    await original(c.page,0,240,160);
    await readOriginal(c.page.request,address(origin,visible),png.buffer);
    const leaveTab=await c.context.newPage();
    await open(leaveTab,group.id);
    await button(leaveTab,'群成员').click();
    await button(leaveTab,'退出群聊').click();
    await button(leaveTab,'确认退出').click();
    await leaveTab.waitForURL(url=>!url.hash);
    await c.page.waitForURL(url=>!url.hash);
    assert.equal(await c.page.locator('#dialog').isVisible(),false);
    assert.equal((await c.page.request.get(address(origin,visible))).status(),404);
    await readOriginal(b.page.request,address(origin,visible),png.buffer);

    await original(b.page,1,240,160);
    const report=(await json(a.page,origin,
      '/conversations/'+group.id+'/messages/'+visible.id+'/report',{reason:'合成图审核'})).report;
    assert.equal(moderate(source,'list')[0].reportedText,'[图片]');
    assert.equal(moderate(source,'remove',report.id).status,'removed');
    await b.page.locator('#dialog').waitFor({state:'hidden'});
    await b.page.locator('#history').getByText('[已移除]',{exact:true}).waitFor();
    assert.equal((await b.page.request.get(address(origin,visible))).status(),404);

    const {conversation:ai}=await json(a.page,origin,'/ai-contacts/start',
      {number:AI_NUMBER,allowCloud:true,expectedAccount:a.number});
    await open(a.page,ai.id);
    await a.page.locator('#chat-title').getByText('鲸鱼娘',{exact:true}).waitFor();
    assert.equal(await button(a.page,'图片').isHidden(),true);
    assert.equal((await sendRaw(ai.id,png,'no-cloud-image')).status(),403);
    assert.equal(cloudCalls,0);
    const snapshot=await makeBackup(db,path.join(scratch,'snapshot'));
    const restored=path.join(scratch,'restored.sqlite');
    await fs.copyFile(snapshot,restored);
    replica=new SocialStore(restored);
    const recovery=await serve(replica);
    restoredServer=recovery.server;
    const authenticated=await fetch(recovery.origin+'/api/v1/login',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({number:b.number,password}),
    });
    assert.equal(authenticated.status,200);
    const cookie=authenticated.headers.get('set-cookie').split(';')[0];
    for(const [row,fixture] of [[first,png],[older,jpg]]){
      const response=await fetch(address(recovery.origin,row),{headers:{Cookie:cookie}});
      assert.equal(response.status,200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),fixture.buffer);
    }
    assert.equal((await fetch(address(recovery.origin,visible),{headers:{Cookie:cookie}})).status,404);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({directReceipt:first.id,groupReceipts:[older.id,visible.id],pngSHA256:sha(png.buffer),jpegSHA256:sha(jpg.buffer),
      isolatedUsers:3,viewports:[1120,390,430],originalAfterReload:true,failedMimeRejected:true,oversizeRejected:true,
      groupHistoryBoundary:true,leaveAndModerationBlockRead:true,restoredOriginalBytes:true,cloudCalls,errors},null,2));
  } finally {
    try {await browser?.close();}
    finally {
      await stop(restoredServer);
      await stop(server);
      replica?.db.close();
      source.db.close();
      assert.equal(path.dirname(scratch),tempRoot);
      assert.match(path.basename(scratch),/^arcade-social-images-[a-z0-9]{6}$/iu);
      await fs.rm(scratch,{recursive:true,force:true});
    }
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
