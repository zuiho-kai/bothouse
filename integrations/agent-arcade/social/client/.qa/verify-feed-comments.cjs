'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const {fork,execFileSync}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require('playwright');

async function main(){
  const output=fs.mkdtempSync(path.join(process.argv[2]||os.tmpdir(),'comments-'));
  const dbFile=path.join(output,'synthetic.sqlite');
  const service=fork(path.resolve(__dirname,'../../server/main.cjs'),[],{stdio:['ignore','pipe','inherit','ipc'],windowsHide:true,
    env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:os.tmpdir(),TMP:os.tmpdir(),
      BOTHOUSE_DATA_DIR:output,SOCIAL_DB:dbFile,SOCIAL_PORT:'0',SOCIAL_HOST:'127.0.0.1'}});
  let browser,db;
  try{
    const [{port}]=await once(service,'message');
    const origin='http://127.0.0.1:'+port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    async function actor(number){
      const page=await browser.newPage({baseURL:origin,viewport:{width:390,height:820},serviceWorkers:'block'});
      page.setDefaultTimeout(9000);
      await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
      const api=async(route,data,status=200)=>{
        const res=await page.request.fetch('/api/v1/'+route,{method:data?'POST':'GET',data});
        assert.equal(res.status(),status,route+' '+await res.text());return res.json();
      };
      await page.goto('/');
      await page.locator('#auth-switch').click();
      await page.locator('[name=number]').fill(number);
      await page.locator('[name=displayName]').fill('同名合成朋友');
      await page.locator('[name=password]').fill(randomUUID());
      await page.locator('#auth-submit').click();await page.locator('[data-tab=feed]').click();
      return {page,number,api};
    }
    const a=await actor('author_a'),b=await actor('reader_b'),c=await actor('other_c');
    const req=async(x,y)=>(await x.api('friend-requests',{number:y.number})).request.id;
    const accept=(x,id)=>x.api('friend-requests/'+id+'/accept',{});
    const {conversation:dm}=await accept(b,await req(a,b));
    await a.page.locator('#compose-post').click();
    await a.page.locator('#post-content').fill('周日一起去公园。');
    await a.page.getByRole('button',{name:'发布动态',exact:true}).click();
    await a.page.getByText('动态已发布。',{exact:true}).waitFor();
    const [post]=(await a.api('friend-feed')).posts;
    const route='friend-feed/'+post.id+'/comments';
    const data=(x,text,id=randomUUID())=>({expectedAccount:x.number,text,clientId:id});
    const refresh=p=>p.locator('#refresh-feed').click();
    const open=p=>p.locator('.feed-post').getByRole('button',{name:'评论',exact:true}).click();
    const write=async(page,text)=>{
      await open(page);await page.getByLabel('写评论').fill(text);await page.getByRole('button',{name:'发送评论'}).click();
    };
    const ids=[];
    const pattern='**/api/v1/'+route;
    async function loseAck(r){
      if(r.request().method()!=='POST')return r.continue();
      const res=await r.fetch();assert.equal(res.status(),200);ids.push((await res.json()).commentId);
      await r.abort('failed');
    }
    await b.page.route(pattern,loseAck);await refresh(b.page);await write(b.page,'我带野餐垫。');
    await b.page.getByText(/仍可点击.*重试/).waitFor();
    await b.page.unroute(pattern,loseAck);
    await b.page.reload();await b.page.locator('[data-tab=feed]').click();await open(b.page);
    assert.equal(await b.page.getByLabel('写评论').inputValue(),'我带野餐垫。');
    const ack=b.page.waitForResponse(res=>res.url().endsWith(route)&&res.request().method()==='POST');
    await b.page.getByRole('button',{name:'发送评论'}).click();ids.push((await (await ack).json()).commentId);
    assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
    await refresh(a.page);await a.page.locator('.post-comments p').filter({hasText:'我带野餐垫。'}).waitFor();
    assert.equal((await a.api(route)).comments.length,1);
    await write(a.page,'好，我带水。');await a.page.getByText('评论已发送。',{exact:true}).waitFor();
    await refresh(b.page);await b.page.locator('.post-comments p').filter({hasText:'好，我带水。'}).waitFor();
    await b.page.screenshot({path:path.join(output,'friend-feed.png')});
    await open(b.page);await b.page.getByText('同名合成朋友（author_a）：好，我带水。',{exact:true}).waitFor();
    await b.page.screenshot({path:path.join(output,'comments.png')});
    await b.page.locator('#dialog-close').click();
    const pending=await req(c,a);
    await c.api(route,undefined,404);await c.api(route,data(c,'不可见'),404);
    await accept(a,pending);
    assert.deepEqual((await c.api(route)).comments.map(row=>row.author.number),[a.number]);
    assert.deepEqual((await c.api('friend-feed?comments=1')).posts[0].recentComments.map(row=>row.author.number),[a.number]);
    await b.api(route,data(a,'不能冒充'),409);
    for(let i=0;i<21;i++)await a.api(route,data(a,'分页 '+i));
    const page1=await b.api(route);
    const lastAttempt=data(a,'翻页期间新增');
    await a.api(route,lastAttempt);
    const page2=await b.api(route+'?before='+page1.nextBefore);
    assert.equal(page1.comments.length,20);assert.equal(page2.comments.length,3);
    assert.equal(new Set([...page1.comments,...page2.comments].map(row=>row.id)).size,23);
    // There is no human unfriend endpoint on this baseline. Remove the empty
    // synthetic DM relationship in the fixture DB, then test the live HTTP paths.
    db=new DatabaseSync(dbFile);
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
    db.prepare('DELETE FROM members WHERE chat=?').run(dm.id);
    db.prepare('DELETE FROM chats WHERE id=?').run(dm.id);db.exec('COMMIT');
    await b.api(route,undefined,404);await b.api(route,data(b,'失效后写入'),404);
    assert.equal((await b.api('friend-feed?comments=1')).posts.length,0);
    assert(!(await a.api(route+'?before='+page1.nextBefore)).comments.some(row=>row.author.number===b.number));
    await a.page.locator('.feed-post').getByRole('button',{name:'删除',exact:true}).click();
    await a.page.getByRole('button',{name:'删除动态',exact:true}).click();
    await a.page.getByText('动态已删除。',{exact:true}).waitFor();
    await c.api(route,undefined,404);await a.api(route,lastAttempt,404);
    const remaining=db.prepare('SELECT COUNT(*) n FROM friend_post_comments WHERE post=?').get(post.id).n;
    assert.equal(remaining,0);
    // Seed an already-followed role. Use the normal API to withdraw that relationship.
    const role='arcade_whale';
    db.prepare("INSERT OR IGNORE INTO users(number,name,kind,password) VALUES(?,?,'ai',NULL)").run(role,'合成旧角色');
    const rolePost=db.prepare('INSERT INTO friend_posts(author,nonce,body,created) VALUES(?,?,?,?)')
      .run(role,'fixture-role-post','合成角色动态',new Date().toISOString()).lastInsertRowid;
    for(const viewer of [a,c])db.prepare('INSERT INTO ai_feed_follows VALUES(?,?)').run(viewer.number,role);
    const roleRoute='friend-feed/'+rolePost+'/comments';
    await c.api(roleRoute,data(c,'角色动态评论'));
    assert.equal((await a.api(roleRoute)).comments.length,1);
    await c.api('friend-feed/follow',{role,enabled:false,expectedAccount:c.number});
    await c.api(roleRoute,undefined,404);await c.api(roleRoute,data(c,'取消关注后'),404);
    assert.equal((await a.api(roleRoute)).comments.length,0);
    await a.api(roleRoute,data(a,'运营移除后应被清除'));
    const reportResponse=await a.page.request.post('/api/v1/friend-feed/'+rolePost+'/report',
      {data:{reason:'合成测试'},headers:{'X-Social-Account':a.number}});
    assert.equal(reportResponse.status(),200);
    const {report}=await reportResponse.json();
    const decision=JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../../server/moderate.cjs'),'remove',report.id],
      {env:{...process.env,SOCIAL_DB:dbFile},windowsHide:true,encoding:'utf8'}));
    assert.equal(decision.status,'removed');await a.api(roleRoute,undefined,404);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM friend_post_comments WHERE post=?').get(rolePost).n,0);
    const receipt={passed:true,contexts:3,ui:'headless Edge, 390px, stock main.cjs',post:post.id,commentFirstAndRetry:ids,
      authorRead:'我带野餐垫。',friendRead:'好，我带水。',pendingReadWrite:[404,404],nonMutualVisibleAuthors:[a.number],
      afterFixtureUnfriendReadWrite:[404,404],afterDeleteLiveComments:remaining,afterUnfollowReadWrite:[404,404],moderatedPostComments:0,pagination:[20,3]};
    fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2));
    console.log(output,JSON.stringify(receipt));
  }finally{db?.close();await browser?.close();service.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
