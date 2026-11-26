'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {setTimeout:delay}=require('node:timers/promises');
const {createServer:loopback}=require('node:http');
const {chromium}=require('playwright');
const {SocialStore}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {AI_NUMBER,AI_JU_NUMBER,AI_DRAGON_NUMBER}=require('../../server/ai-roles.cjs');
const {createDeepSeekProvider}=require('../../server/ai-deepseek.cjs');
const {createClaudeProvider}=require('../../server/ai-claude.cjs');
const {createOpenAIGroupProvider}=require('../../server/ai-openai.cjs');

const btn=(page,name)=>page.getByRole('button',{name,exact:true});
const names={a:'fixture_reader_a',b:'fixture_reader_b',c:'fixture_reader_c'};
const posts={whale:'鲸鱼娘的合成短动态。',ju:'橘娘的合成短动态。',dragon:'龙娘的合成短动态。'};
const days=['2030-03-01','2030-03-02','2030-03-03'];
const stop=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
async function listen(server,port=0){
  server.listen(port,'127.0.0.1');
  await once(server,'listening');
  return 'http://127.0.0.1:'+server.address().port;
}
async function until(predicate){
  for(let attempt=0;attempt<300;attempt++){
    if(predicate())return;
    await delay(20);
  }
  throw Error('Timed out waiting for the background feed turn');
}
async function api(page,route,data,status=200,headers={}){
  const response=await page.request.fetch('/api/v1'+route,{method:data===undefined?'GET':'POST',data,
    headers:{'X-Social-Claude-UI':'1',...headers}});
  const result=await response.json();
  assert.equal(response.status(),status,JSON.stringify(result));
  return result;
}
async function newPage(browser,origin,storageState){
  const page=await browser.newPage({baseURL:origin,storageState,viewport:{width:1100,height:850},serviceWorkers:'block'});
  page.setDefaultTimeout(10000);
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.goto('/');
  return page;
}
async function register(page,number){
  await btn(page,'创建账号').click();
  await page.locator('[name=number]').fill(number);
  await page.locator('[name=displayName]').fill('合成同名读者');
  await page.locator('[name=password]').fill('synthetic feeds fixture passphrase');
  await page.locator('#auth-submit').click();
  await page.locator('#directory-title').getByText('消息',{exact:true}).waitFor();
}
async function openFeed(page){
  await page.locator('[data-tab=feed]').click();
  await page.locator('#feed-title').waitFor();
}
async function revealRoles(page){
  const control=page.locator('#feed-role summary');
  await control.waitFor();
  if(!await control.evaluate(summary=>summary.parentElement.open)){
    await control.press('Enter');
    assert(await control.evaluate(summary=>summary.parentElement.open));
  }
}
async function switchFeed(page,label,after){
  if(label!=='关注角色动态')await revealRoles(page);
  const target=btn(page,label);
  await target.click();
  const updated=btn(page,after);
  await updated.waitFor();
  if(label!=='关注角色动态')
    assert(await updated.evaluate(node=>document.activeElement===node));
}

async function main(){
  const [target,earlier]=process.argv.slice(2);
  const output=path.resolve(target);
  await fs.mkdir(output,{recursive:true});
  const fixture=path.join(output,'synthetic.sqlite');
  const calls=[],unexpected=[];
  const stalled=Promise.withResolvers(),release=Promise.withResolvers();
  const nativeFetch=globalThis.fetch;
  globalThis.fetch=async url=>{unexpected.push(String(url));throw Error('All external requests are disabled');};
  const mock=loopback(async(req,res)=>{
    const parts=[];
    for await(const bytes of req)parts.push(bytes);
    const body=JSON.parse(Buffer.concat(parts));
    const model=body.model, route=req.url;
    const role=route==='/chat/completions'?'whale':route==='/v1/messages'?'ju':'dragon';
    const rows=body.messages??body.input;
    const userRows=rows.filter(row=>row.role==='user');
    const system=body.instructions??body.system??rows.find(row=>row.role==='system').content;
    const prompt=userRows[0].content;
    const day=prompt.match(/\d{4}-\d\d-\d\d/u)[0];
    assert.equal(userRows.length,1);
    assert.match(system,/只用公开角色设定/u);
    assert.match(prompt,/^这是 \d{4}-\d\d-\d\d（UTC）的发布机会。/u);
    assert(!/fixture_reader_|合成同名读者|私聊内容不得外发/u.test(JSON.stringify(body)));
    calls.push({role,route,model,day,prompt,publicPersona:system.slice(0,150)});
    if(role==='dragon'&&day===days[2]){stalled.resolve();await release.promise;}
    const post=day===days[0]&&role!=='dragon'?posts[role]:
      role==='dragon'&&day!==days[0]?posts.dragon:null;
    const text=JSON.stringify({post});
    res.setHeader('Content-Type','application/json');
    if(role==='whale')res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}]}));
    else if(role==='ju')res.end(JSON.stringify({type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text}]}));
    else res.end(JSON.stringify({status:'completed',output:[{role:'assistant',type:'message',content:[{type:'output_text',text}]}]}));
  });
  let browser,server,store,port=0;
  const originOf=(value)=>new URL(value);
  let now=new Date(days[0]+'T07:59:00Z');
  async function finish(){
    if(server){await stop(server);server=undefined;}
    store?.db.close();store=undefined;
  }
  try{
    const loopbackOrigin=await listen(mock);
    const fetchImpl=(url,options)=>{
      const target=originOf(url);
      assert(['api.deepseek.com','api.anthropic.com','api.openai.com'].includes(target.hostname));
      assert.equal(options.redirect,'error');
      return nativeFetch(loopbackOrigin+target.pathname,options);
    };
    const opts={fetchImpl};
    const providers={aiProvider:createDeepSeekProvider('synthetic',opts),claudeProvider:createClaudeProvider('synthetic',opts),
      openaiProvider:createOpenAIGroupProvider('synthetic',opts)};
    async function start(previous=false){
      const Store=previous?require(path.resolve(earlier,'social/server/store.cjs')).SocialStore:SocialStore;
      const serve=previous?require(path.resolve(earlier,'social/server/http.cjs')).createServer:createServer;
      store=new Store(fixture);
      server=serve(store,{...providers,feedClock:()=>now});
      const origin=await listen(server,port);
      port=server.address().port;
      return origin;
    }
    now=new Date(days[0]+'T08:00:00Z');
    const origin=await start();
    await delay(25);
    assert.deepEqual(calls,[]);
    assert.deepEqual(store.all('SELECT * FROM ai_feed_turns'),[]);
    await finish();
    now=new Date(days[0]+'T07:59:00Z');
    await start(Boolean(earlier));
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    let [a,b,c]=await Promise.all(Object.values(names).map(()=>newPage(browser,origin)));
    for(const [index,page] of [a,b,c].entries())await register(page,Object.values(names)[index]);
    await openFeed(a);
    if(earlier)await switchFeed(a,'关注角色动态','取消关注');
    else await api(a,'/friend-feed/follow',{role:AI_NUMBER,expectedAccount:names.a,enabled:true});
    const request=(await api(a,'/friend-requests',{number:names.c})).request;
    await api(c,'/friend-requests/'+request.id+'/accept',{});
    await api(c,'/ai-contacts/start',{number:AI_JU_NUMBER,allowCloud:true,expectedAccount:names.c,provider:'anthropic'});
    const actors=await Promise.all([a,b,c].map(page=>page.context().storageState()));
    const closePages=()=>Promise.all([a,b,c].map(page=>page.context().close()));
    const reopen=async()=>{
      [a,b,c]=await Promise.all(actors.map(state=>newPage(browser,origin,state)));
      await Promise.all([a,b,c].map(openFeed));
    };
    await closePages();
    await finish();
    await start();
    await reopen();
    await revealRoles(a);
    await btn(a,'取消关注鲸鱼娘动态').waitFor();
    await btn(a,'关注橘娘动态').waitFor();
    await btn(a,'关注龙娘动态').waitFor();
    const upgraded=(await api(a,'/friend-feed')).roles.filter(role=>role.following).map(role=>role.number);
    assert.deepEqual(upgraded,[AI_NUMBER]);
    await switchFeed(a,'关注橘娘动态','取消关注橘娘动态');
    await switchFeed(b,'关注橘娘动态','取消关注橘娘动态');
    const relationships=await api(b,'/friends');
    assert.deepEqual(relationships.friends,[]);
    assert.deepEqual((await api(b,'/conversations')).conversations,[]);
    await a.screenshot({path:path.join(output,'三角色独立关注.png')});

    await closePages();
    await finish();
    now=new Date(days[0]+'T08:21:00Z');
    await start();
    const turns=day=>store.all('SELECT role,state FROM ai_feed_turns WHERE day=? ORDER BY role',day);
    await until(()=>turns(days[0]).length===2&&turns(days[0]).every(row=>row.state==='published'));
    assert.deepEqual(calls.map(row=>row.role),['whale','ju']);
    await reopen();
    const first=async page=>(await api(page,'/friend-feed')).posts;
    const pa=await first(a),pb=await first(b);
    assert.equal(pa.length,2);
    assert.equal(pb.length,1);
    assert.deepEqual(pb[0],pa.find(post=>post.author.number===AI_JU_NUMBER));
    assert.equal(pb[0].text,posts.ju);
    assert.deepEqual(await first(c),[]);
    const report='/friend-feed/'+pb[0].id+'/report';
    await switchFeed(a,'取消关注橘娘动态','关注橘娘动态');
    assert.deepEqual((await first(a)).map(post=>post.author.number),[AI_NUMBER]);
    await api(a,report,{reason:'不应可举报已隐藏的合成动态'},404,{'X-Social-Account':names.a});
    assert((await api(b,report,{reason:'关注者本机举报验收'},200,{'X-Social-Account':names.b})).report.id);
    assert.deepEqual(await first(b),pb);
    await switchFeed(a,'关注龙娘动态','取消关注龙娘动态');

    await closePages();
    await finish();
    now=new Date(days[1]+'T08:21:00Z');
    await start();
    await until(()=>turns(days[1]).length===3&&turns(days[1]).every(row=>row.state!=='pending'));
    assert.deepEqual(turns(days[1]).map(({role,state})=>[role,state]),
      [[AI_DRAGON_NUMBER,'published'],[AI_JU_NUMBER,'quiet'],[AI_NUMBER,'quiet']]);
    await reopen();
    assert.deepEqual((await first(a)).map(post=>post.author.number),[AI_DRAGON_NUMBER,AI_NUMBER]);
    const friendText='周末想去看展，回来和你分享。';
    const {post:friendPost}=await api(c,'/friend-feed',{clientId:'synthetic-first-view',text:friendText,expectedAccount:names.c});
    await btn(a,'刷新').click();
    const firstPost=a.locator('#feed-posts').getByText(friendText,{exact:true});
    await firstPost.waitFor();
    assert.equal(await a.locator('#feed-posts article').first().getAttribute('data-author'),names.c);
    const panel=a.locator('#feed-role');
    assert.equal(await panel.evaluate(node=>node.open),false);
    assert.equal(await btn(a,'取消关注龙娘动态').isVisible(),false);
    for(const [width,height,file] of [[1100,850,'动态首屏-普通窗口.png'],[410,700,'动态首屏-较窄窗口.png']]){
      await a.setViewportSize({width,height});
      const box=await firstPost.boundingBox();
      const compose=await btn(a,'发动态').boundingBox();
      assert(box.y+box.height<height&&compose.y+compose.height<height);
      await a.screenshot({path:path.join(output,file)});
    }
    await api(c,'/friend-feed/'+friendPost.id+'/delete',{expectedAccount:names.c});
    await btn(a,'刷新').click();
    await firstPost.waitFor({state:'hidden'});
    await a.setViewportSize({width:410,height:510});
    await revealRoles(a);
    await a.locator('#friend-feed').evaluate(node=>{node.scrollTop=75;});
    const stable=a.locator('[data-role="arcade_ju"] button');
    await stable.focus();
    const scroll=await a.locator('#friend-feed').evaluate(node=>node.scrollTop);
    assert(scroll>0);
    await stable.press('Space');
    await btn(a,'取消关注橘娘动态').waitFor();
    await a.locator('#feed-status').getByText('已关注橘娘的动态。',{exact:true}).waitFor();
    assert(await stable.evaluate(node=>document.activeElement===node));
    assert.equal(await a.locator('#friend-feed').evaluate(node=>node.scrollTop),scroll);
    await stable.press('Space');
    await a.locator('#feed-status').getByText('已取消关注橘娘的动态。',{exact:true}).waitFor();
    assert(await stable.evaluate(node=>document.activeElement===node));
    assert.deepEqual(await first(b),pb);
    assert.deepEqual(await first(c),[]);
    await closePages();

    await finish();
    now=new Date(days[2]+'T08:21:00Z');
    await start();
    await Promise.race([stalled.promise,delay(7000,undefined,{ref:false}).then(()=>{throw Error('No pending Dragon feed call');})]);
    await reopen();
    await switchFeed(a,'取消关注龙娘动态','关注龙娘动态');
    release.resolve();
    await until(()=>turns(days[2]).find(row=>row.role===AI_DRAGON_NUMBER)?.state==='quiet');
    assert.deepEqual((await first(a)).map(post=>post.author.number),[AI_NUMBER]);

    await closePages();
    await finish();
    const callCount=calls.length;
    await start();
    await delay(25);
    assert.equal(calls.length,callCount);

    // Fill the shared daily quota with group turns on a new synthetic UTC day.
    // Neither of the still-followed roles should reserve or call its provider.
    const quotaDay='2030-03-04';
    const quotaStart=new Date(quotaDay+'T08:20:00Z').valueOf();
    store.transaction(()=>{
      const group=store.createGroup(names.a,'合成共享额度群',[names.c]);
      for(let index=0;index<100;index++){
        const message=store.send(names.a,group.id,{clientId:'qa-quota-'+index,text:'合成占额'});
        store.run("INSERT INTO ai_group_turns(prompt,chat,state,started) VALUES(?,?,'answered',?)",
          message.id,group.id,quotaStart);
      }
    });
    await finish();
    now=new Date(quotaDay+'T08:21:00Z');
    await start();
    await delay(25);
    assert.deepEqual(turns(quotaDay),[]);
    assert.equal(calls.length,callCount);
    assert.deepEqual(unexpected,[]);
    assert.equal(calls.find(row=>row.role==='ju').route,'/v1/messages');
    assert.equal(calls.find(row=>row.role==='dragon').route,'/v1/responses');
    const proof={legacyFollowOnFrozen128:Boolean(earlier),upgraded,noFollowersAtWindowStart:true,
      dragonUnfollowedFirstDayCalls:0,juSharedPost:{id:pb[0].id,author:pb[0].author.number,readers:2},
      quietAndPublished:turns(days[1]),lastDragonUnfollowDiscardedLateResult:true,unfollowBlocksReadingAndReporting:true,
      noFeedFromFriendshipOrCloudConsent:true,restartExtraCalls:0,sharedQuotaBlockedNewTurns:true,rolesCollapsedOnEntry:true,keyboardAndScrollPreserved:true,externalCalls:0,calls};
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(proof,null,2)+'\n');
    console.log(JSON.stringify(proof,null,2));
  }finally{
    release.resolve();
    await browser?.close();
    await finish();
    await stop(mock);
    globalThis.fetch=nativeFetch;
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
