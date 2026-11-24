'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');
const {SocialStore}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const btn=(page,name)=>page.getByRole('button',{name,exact:true});

async function main(){
  const folder=process.argv[2] || await fs.mkdtemp(path.join(os.tmpdir(),'arcade-file-'));
  await fs.mkdir(folder,{recursive:true});
  const store=new SocialStore(':memory:');
  const server=createServer(store);
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    async function register(number,width){
      const ctx=await browser.newContext({viewport:{width,height:780},serviceWorkers:'block'});
      await ctx.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      const page=await ctx.newPage();
      const response=await page.request.post(origin+'/api/v1/register',{data:{number,displayName:number,password:'synthetic-files-only'}});
      assert.equal(response.status(),200);
      return page;
    }
    const [a,b,c]=await Promise.all([register('paper_a',1050),register('paper_b',375),register('paper_c',380)]);
    const post=async(page,route,data)=>(await page.request.post(origin+'/api/v1/'+route,{data})).json();
    const request=(await post(a,'friend-requests',{number:'paper_b'})).request;
    await post(b,'friend-requests/'+request.id+'/accept',{});
    const group=(await post(a,'groups',{title:'附件校对',memberNumbers:['paper_b']})).conversation.id;
    const dm=(await post(a,'direct',{number:'paper_b'})).conversation.id;
    const open=(page,id)=>page.goto(origin+'/#chat/'+id);
    await Promise.all([open(a,group),open(b,group)]);
    const errorLog=[];
    for(const page of [a,b])page.on('pageerror',err=>errorLog.push(err.message));
    const bytes=Buffer.from([0,1,13,10,255,33,128,42,0,190,3]);
    const sample={name:'合成 测量结果.bin',mimeType:'application/octet-stream',buffer:bytes};
    async function select(){await btn(a,'文件').click();await a.locator('#dialog input[type=file]').setInputFiles(sample);}
    await select();await btn(a,'关闭').click();
    assert.equal(store.one('SELECT count(*) n FROM message_files').n,0);
    await select();
    const upload='**/conversations/'+group+'/files';
    await a.route(upload,async route=>{const result=await route.fetch();assert.equal(result.status(),200);await route.abort();},{times:1});
    await btn(a,'发送文件').click();
    await a.waitForFunction(()=>Boolean(document.querySelector('#dialog-error').textContent));
    await btn(a,'发送文件').click();await a.locator('#dialog').waitFor({state:'hidden'});
    assert.equal(store.one('SELECT count(*) n FROM message_files').n,1);
    const save=b.getByRole('link',{name:'保存文件'});
    await save.waitFor();
    const bubble=b.locator('article').filter({has:save});
    assert.match(await bubble.innerText(),/合成 测量结果.bin/);assert.match(await bubble.innerText(),/11 字节/);
    const downloadEvent=b.waitForEvent('download');await save.click();
    const dl=await downloadEvent;
    assert.equal(dl.suggestedFilename(),sample.name);
    const output=path.join(folder,'received.bin');await dl.saveAs(output);
    assert.deepEqual(await fs.readFile(output),bytes);
    await b.screenshot({path:path.join(folder,'receiver-narrow.png')});
    const fileUrl=new URL(await save.getAttribute('href'),origin).href;
    assert.equal((await c.request.get(fileUrl)).status(),409);
    assert.equal((await c.request.get(fileUrl.replace('account=paper_b','account=paper_c'))).status(),404);
    const baseHeaders={'X-Social-Member-Revision':store.access('paper_a',group).membershipRevision,'Content-Type':'application/octet-stream','X-Social-Account':'paper_a','X-Social-Client-Id':'repeat_01'};
    async function raw(name,data,extra={}){
      return a.request.post(origin+'/api/v1/conversations/'+group+'/files',{headers:{...baseHeaders,'X-Social-File-Name':encodeURIComponent(name),...extra},data});
    }
    for(const name of ['../foo','x\\y','AUX.txt','C:foo','x\u202etxt'])assert.equal((await raw(name,bytes)).status(),400);
    assert.equal((await raw('good.bin',bytes,{'X-Social-Account':'paper_b'})).status(),409);
    assert.equal((await raw('good.bin',bytes,{'X-Social-Member-Revision':'old'})).status(),409);
    const empty=await raw('empty.txt',Buffer.alloc(0));assert.equal(empty.status(),200);
    assert.equal((await empty.json()).message.attachment.bytes,0);
    assert.equal((await raw('empty.txt',bytes)).status(),409);
    const picture=await a.evaluate(()=>{const c=document.createElement('canvas');c.width=19;c.height=13;const ctx=c.getContext('2d');ctx.fillStyle='#0c98db';ctx.fillRect(0,0,19,13);return c.toDataURL().split(',')[1];});
    async function paste(){
      await btn(a,'截图').click();
      await a.locator('#dialog form').evaluate((form,encoded)=>{
        const dt=new DataTransfer();
        dt.items.add(new File([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],'synthetic.png',{type:'image/png'}));
        form.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
      },picture);
      await a.locator('#dialog img').waitFor({state:'visible'});
    }
    await paste();await a.screenshot({path:path.join(folder,'capture-preview.png')});await btn(a,'关闭').click();
    await paste();await open(a,dm);assert.equal(store.one('SELECT count(*) n FROM message_images').n,0);
    await Promise.all([open(a,group),open(b,group)]);await paste();
    await btn(a,'发送截图').click();await a.locator('#dialog').waitFor({state:'hidden'});
    await btn(b,'查看原图').click();const original=b.locator('img.original-image');
    const img=await b.request.get(new URL(await original.getAttribute('src'),origin).href);
    assert.equal(img.status(),200);assert.equal(digest(await img.body()),digest(Buffer.from(picture,'base64')));
    assert.equal(store.one('SELECT count(*) n FROM message_images').n,1);
    await Promise.all([open(a,dm),open(b,dm)]);await select();await btn(a,'发送文件').click();
    await b.getByRole('link',{name:'保存文件'}).waitFor();
    const dmLink=new URL(await b.getByRole('link',{name:'保存文件'}).getAttribute('href'),origin);
    assert.deepEqual(await (await b.request.get(dmLink.href)).body(),bytes);
    const removed=await post(a,'groups/'+group+'/remove',{number:'paper_b'});
    assert.ok(!removed.error,JSON.stringify(removed.error));
    assert.equal((await b.request.get(fileUrl)).status(),404);
    assert.deepEqual(errorLog,[]);
    const receipt={groupFile:{name:dl.suggestedFilename(),bytes:bytes.length,sha256:digest(bytes),rowsAfterRetry:1},outsideStatus:404,
      directBytesEqual:true,removedMemberStatus:404,zeroLength:true,wrongAccount:409,unsafeNames:5,previewCancelAndSwitchImages:0,receivedImages:1,pngSha256:digest(await img.body()),
      viewport:375,systemCapture:'synthetic paste only',browser:browser.version()};
    await fs.writeFile(path.join(folder,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
  }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));store.db.close();}
}
main().catch(err=>{console.error(err);process.exitCode=1;});
