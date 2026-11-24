'use strict';

const assert = require('node:assert/strict');
const {fork} = require('node:child_process');
const {createHash,randomUUID} = require('node:crypto');
const {once} = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');

const button = (page,name) => page.getByRole('button',{name,exact:true});
const api = '/api/v1';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const output=fs.mkdtempSync(path.join(process.argv[2]||os.tmpdir(),'feed-photos-'));
  const database=path.join(output,'synthetic.sqlite');
  let service,browser,port=0;
  async function start() {
    service=fork(path.resolve(__dirname,'../../server/main.cjs'),[],{
      stdio:['ignore','ignore','inherit','ipc'],windowsHide:true,
      env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:os.tmpdir(),TMP:os.tmpdir(),
        BOTHOUSE_DATA_DIR:output,SOCIAL_DB:database,SOCIAL_HOST:'127.0.0.1',SOCIAL_PORT:String(port)}
    });
    const [bound]=await Promise.race([once(service,'message'),once(service,'exit').then(()=>{throw Error('service stopped before ready');})]);
    port=bound.port;
    return 'http://127.0.0.1:'+port;
  }
  async function stop() {
    if(!service||service.exitCode!==null)return;
    const done=once(service,'exit');
    service.kill();await done;
  }
  try {
    const origin=await start();
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    const errors=[];
    async function person(number,width) {
      const page=await browser.newPage({baseURL:origin,viewport:{width,height:820},serviceWorkers:'block'});
      page.on('pageerror',err=>errors.push(err.message));
      await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
      await page.goto('/');
      await page.locator('#auth-switch').click();
      await page.locator('[name=number]').fill(number);
      await page.locator('[name=displayName]').fill('合成朋友');
      await page.locator('[name=password]').fill(randomUUID());
      await page.locator('#auth-submit').click();
      await page.locator('[data-tab=feed]').click();
      return {page,number};
    }
    async function json(p,route,data,status=200){
      const res=await p.page.request.fetch(api+route,{method:data?'POST':'GET',data});
      assert.equal(res.status(),status,route+' '+await res.text());
      return res.json();
    }
    async function original(p,route,fixture,status=200) {
      const res=await p.page.request.get(api+route);
      assert.equal(res.status(),status,route);
      if(status===200){
        assert.equal(res.headers()['cache-control'],'no-store');
        assert.equal(res.headers()['content-type'],fixture.mimeType);
        assert.deepEqual(await res.body(),fixture.buffer);
      }
    }
    async function refresh(p){
      const fresh=p.page.waitForResponse(res=>res.url().includes('/api/v1/friend-feed?')&&res.ok());
      await p.page.locator('#refresh-feed').click();
      await fresh;
    }
    const a=await person('feed_author',390), b=await person('feed_friend',390), c=await person('feed_other',1024);
    const {request}=await json(a,'/friend-requests',{number:b.number});
    const {conversation}=await json(b,'/friend-requests/'+request.id+'/accept',{});
    const legacy=(await json(a,'/friend-feed',{expectedAccount:a.number,clientId:randomUUID(),text:'原有文字动态'})).post;
    assert.equal(legacy.images,undefined);
    const fixtures=await a.page.evaluate(()=>{
      const tile=document.createElement('canvas');
      tile.width=48;tile.height=32;
      const ctx=tile.getContext('2d');
      return [['image/png','#c48b50'],['image/jpeg','#286c83'],['image/png','#937acc']].map(([mime,color])=>{
        ctx.fillStyle=color;ctx.fillRect(0,0,tile.width,tile.height);
        return tile.toDataURL(mime).split(',')[1];
      });
    });
    const [first,second,third]=fixtures.map((image,i)=>({name:i===1?'second.jpg':'photo-'+i+'.png',
      mimeType:i===1?'image/jpeg':'image/png',buffer:Buffer.from(image,'base64')}));
    const composer=()=>a.page.locator('#compose-post').click();
    const picker=a.page.getByLabel('添加图片');
    const preview=a.page.locator('.feed-image-preview');
    await composer();
    await picker.setInputFiles([first,second,third]);
    await preview.nth(2).waitFor();
    await button(a.page,'移除第 2 张图片').click();
    assert.equal(await preview.count(),2);
    await a.page.screenshot({path:path.join(output,'composer.png')});
    await button(a.page,'取消').click();
    assert.equal((await json(a,'/friend-feed')).posts.length,1);

    async function publish(text,photos){
      await composer();
      await a.page.locator('#post-content').fill(text);
      await picker.setInputFiles(photos);
      await preview.nth(photos.length-1).waitFor();
      const reply=a.page.waitForResponse(res=>res.url().endsWith('/api/v1/friend-feed')&&res.request().method()==='POST'&&res.ok());
      await button(a.page,'发布动态').click();
      const {post}=await (await reply).json();
      await a.page.getByText('动态已发布。',{exact:true}).waitFor();
      return post;
    }
    const imageOnly=await publish('',[first]);
    await composer();
    await a.page.locator('#post-content').fill('两张图，留在同一条动态。');
    await picker.setInputFiles([first,second]);
    await preview.nth(1).waitFor();
    const lost=[];
    const route='**/api/v1/friend-feed';
    const loseAck=async r=>{
      if(r.request().method()!=='POST')return r.continue();
      const response=await r.fetch();assert.equal(response.status(),200);
      lost.push((await response.json()).post.id);
      await r.abort('failed');
    };
    await a.page.route(route,loseAck);
    await button(a.page,'发布动态').click();
    await a.page.locator('#dialog-error').filter({hasText:/.+/}).waitFor();
    assert.equal(await preview.count(),2);
    await a.page.unroute(route,loseAck);
    const ack=a.page.waitForResponse(res=>res.url().endsWith('/api/v1/friend-feed')&&res.request().method()==='POST'&&res.ok());
    await button(a.page,'发布动态').click();
    const {post:mixed}=await (await ack).json();
    assert.deepEqual(lost,[mixed.id]);
    await a.page.getByText('动态已发布。',{exact:true}).waitFor();
    assert.deepEqual(mixed.images,[{position:1},{position:2}]);
    assert.deepEqual((await json(a,'/friend-feed')).posts.map(p=>p.id),[mixed.id,imageOnly.id,legacy.id]);

    const address=(post,n)=>'/friend-feed/'+post.id+'/images/'+n;
    await refresh(b);
    const entry=b.page.locator('.feed-post').filter({hasText:mixed.text});
    await button(entry,'查看第 2 张原图').click();
    await b.page.waitForFunction(()=>document.querySelector('img.original-image')?.naturalWidth===48);
    await b.page.screenshot({path:path.join(output,'original.png')});
    await original(b,address(mixed,2),second);
    await original(b,address(mixed,1),first);
    await original(b,address(imageOnly,1),first);
    await original(c,address(mixed,2),second,404);
    const anonymous=await fetch(origin+api+address(mixed,1));
    assert.equal(anonymous.status,401);
    await b.page.locator('#dialog-close').click();
    await button(entry,'评论').click();
    await b.page.getByLabel('写评论').fill('第二张是蓝色。');
    await button(b.page,'发送评论').click();
    await b.page.getByText('评论已发送。',{exact:true}).waitFor();
    await refresh(a);
    await a.page.getByText('第二张是蓝色。',{exact:false}).first().waitFor();

    await stop();assert.equal(await start(),origin);
    await b.page.reload();await b.page.locator('[data-tab=feed]').click();
    await b.page.locator('.feed-post').filter({hasText:mixed.text}).waitFor();
    await original(b,address(mixed,2),second);
    await b.page.getByText('第二张是蓝色。',{exact:false}).first().waitFor();
    await b.page.screenshot({path:path.join(output,'friend-after-restart.png')});

    await b.page.goto('/#chat/'+encodeURIComponent(conversation.id));
    await b.page.locator('#chat-settings-toggle').click();
    await button(b.page,'删除好友').click();
    await button(b.page,'确认删除好友').click();
    await button(b.page,'重新添加好友').waitFor();
    await original(b,address(mixed,2),second,404);
    await original(b,address(imageOnly,1),first,404);
    await json(b,'/friend-feed/'+mixed.id+'/comments',undefined,404);
    await original(a,address(mixed,2),second);

    await refresh(a);
    await button(a.page.locator('.feed-post').filter({hasText:mixed.text}),'删除').click();
    await button(a.page,'删除动态').click();
    await a.page.getByText('动态已删除。',{exact:true}).waitFor();
    await original(a,address(mixed,1),first,404);
    await original(b,address(mixed,2),second,404);
    await json(a,'/friend-feed/'+mixed.id+'/comments',undefined,404);
    const db = new (require('node:sqlite').DatabaseSync)(database,{readOnly:true});
    try{
      assert.equal(db.prepare('SELECT count(*) n FROM friend_post_images WHERE post=?').get(mixed.id).n,0);
    }finally{db.close();}
    assert.deepEqual(errors,[]);
    const proof={passed:true,clients:3,viewport:[390,1024],legacyText:true,imageOnly:imageOnly.id,orderedImages:mixed.images,
      originalSha256:[digest(first.buffer),digest(second.buffer)],cancelCreatedPosts:0,sameIdAfterLostReply:mixed.id,
      persistedOriginalAndComment:true,removedFriendOriginal:404,deletedOriginal:404,anonymousOriginal:401,unrelatedOriginal:404,
      pageErrors:errors};
    fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(proof,null,2));
    console.log(output,proof);
  } finally {
    await browser?.close();
    await stop();
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
