'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {chromium,expect}=require('playwright/test');
const {SocialStore,AI_NUMBER}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// This is the public smoke only. Negative, privacy and revocation fixtures
// live in server/public-reactions.test.cjs and cannot reach the Internet.
const input=[
  '去网上给我整一张笑哭表情包',
  '找张小动物躲起来偷看的表情包',
  '周末在公园看到小动物了，说说看。',
  '那帮我一起乐一乐，松鼠刚刚从树后探出脑袋。',
];

async function main(){
  const evidence=path.resolve(process.argv[2]);
  assert.equal(process.argv[3],'--live','Public-only Wikimedia Commons and OpenMoji smoke');
  const payload='https://raw.githubusercontent.com/hfg-gmuend/openmoji/17.0.0/';
  const allowed=new Set(['data/openmoji.json','color/618x618/1F602.png']);
  await fs.mkdir(evidence,{recursive:true});
  const tmp=await fs.realpath(os.tmpdir());
  const scratch=await fs.mkdtemp(path.join(tmp,'arcade-social-public-reaction-'));
  const store=new SocialStore(path.join(scratch,'social.sqlite'));
  const realFetch=globalThis.fetch;
  const calls=[], modelTurns=[];
  let browser,server;
  globalThis.fetch=async(url,options)=>{
    assert.equal(typeof url,'string');
    const address=new URL(url);
    const index=address.origin==='https://commons.wikimedia.org'&&address.pathname==='/w/api.php';
    const media=address.origin==='https://upload.wikimedia.org'&&/^\/wikipedia\/commons\//u.test(address.pathname)&&!address.search;
    if(index)assert(['cat peeking','squirrel peeking'].includes(address.searchParams.get('gsrsearch')));
    else assert(media||url.startsWith(payload)&&allowed.has(url.slice(payload.length)),url);
    assert.equal(options.credentials,'omit');
    assert.equal(options.redirect,'error');
    assert.equal(options.body,undefined);
    assert.deepEqual(Object.keys(options.headers),['User-Agent']);
    const response=await realFetch(url,options);
    const bytes=Buffer.from(await response.clone().arrayBuffer());
    calls.push({url,status:response.status,mime:response.headers.get('content-type'),bytes:bytes.length,sha256:sha(bytes)});
    return response;
  };
  const provider={name:'鲸鱼娘',provider:'deepseek',groupRoles:[{name:'鲸鱼娘',number:AI_NUMBER}],
    async generate(context,options){
      const latest=context.at(-1).content;
      assert([input[2],input[3]].includes(latest));
      const available=options.replyHint?.includes('[[public-reaction:squirrel-peeking]]');
      modelTurns.push({input:latest,publicSquirrelOffered:available});
      if(latest===input[2])return '公园有时能遇到很有趣的小动物。';
      assert(available);
      return '[[public-reaction:squirrel-peeking]]';
    }};
  try{
    server=createServer(store,{aiProvider:provider}).listen(0,'127.0.0.1');
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    async function user(number){
      const context=await browser.newContext({viewport:{width:530,height:850},serviceWorkers:'block'});
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      const credentials={number,displayName:number,password:'synthetic public search test'};
      const register=await context.request.post(origin+'/api/v1/register',{data:credentials});
      assert.equal(register.status(),200);
      return {context,page:await context.newPage(),number};
    }
    const [a,b]=await Promise.all([user('fixture_alpha'),user('fixture_bravo')]);
    async function api(as,route,data,status=200){
      const response=await as.context.request.fetch(origin+'/api/v1'+route,{method:data===undefined?'GET':'POST',data});
      assert.equal(response.status(),status,route);
      return response.json();
    }
    const send=(as,chat,text,clientId,extra={},status)=>api(as,'/conversations/'+chat+'/messages',{clientId,text,...extra},status);
    const {conversation:{id:direct}}=await api(a,'/ai-contacts/start',{number:AI_NUMBER,expectedAccount:a.number,allowCloud:true});
    const directResult=await send(a,direct,input[0],'search_public_direct',{aiConsentRevision:0});
    const directReply=directResult.reply;
    assert.equal(modelTurns.length,0);
    assert.deepEqual(await send(a,direct,input[0],'search_public_direct',{aiConsentRevision:0}),{message:directResult.message});
    assert.equal(calls.length,2);
    const {request}=await api(a,'/friend-requests',{number:b.number});
    await api(b,'/friend-requests/'+request.id+'/accept',{});
    const {conversation:{id:group}}=await api(a,'/groups',{title:'合成公开图源验收群',memberNumbers:[b.number]});
    await api(a,'/groups/'+group+'/ai',{expectedAccount:a.number,number:AI_NUMBER,enabled:true});
    const consent=(enabled)=>api(a,'/groups/'+group+'/ai-consent',{expectedAccount:a.number,number:AI_NUMBER,provider:'deepseek',enabled});
    await consent(true);
    const seed=await send(a,group,input[2],'ordinary_group_seed',{mentionAccount:AI_NUMBER});
    assert.match(seed.reply.text,/公园/u);

    async function received(as,reply,chat,label,file,author,mime){
      assert(reply,label+' should produce an image reply');
      assert.equal(reply.conversationId,chat);
      assert.equal(reply.sender.number,AI_NUMBER);
      const history=(await api(as,'/conversations/'+chat+'/messages')).messages;
      assert.equal(history.filter(row=>row.clientId===reply.clientId).length,1);
      const media=history.find(row=>row.id===reply.id).attachment;
      assert.equal(media.sticker.label,label);
      if(author)assert.equal(media.sticker.source.author,author);
      else assert.match(media.sticker.source.url,/^https:\/\/commons\.wikimedia\.org\//u);
      assert.match(media.sticker.source.licenseUrl,/^https:\/\/creativecommons\.org\//u);
      const response=await as.context.request.get(origin+`/api/v1/conversations/${chat}/messages/${reply.id}/image/download`);
      assert.equal(response.status(),200);
      const bytes=await response.body(),digest=sha(bytes);
      assert(calls.some(call=>call.sha256===digest&&call.mime===mime&&call.status===200));
      await fs.writeFile(path.join(evidence,file+(mime==='image/png'?'.png':'.jpg')),bytes);
      await as.page.goto(origin+'/#chat/'+chat);
      const card=as.page.locator('#history .bubble').filter({has:as.page.locator(`[data-image-id="${reply.id}"]`)});
      await expect(card).toContainText(label);
      await expect(card).not.toContainText('CC BY-SA');
      const open=as.page.locator(`[data-image-id="${reply.id}"]`);
      await open.locator('img').evaluate(img=>img.decode());
      assert.equal(await open.locator('img').evaluate(img=>img.naturalWidth),media.width);
      await open.click();
      await expect(as.page.locator('#dialog-body')).toContainText(media.sticker.source.url);
      await expect(as.page.locator('#dialog-body')).toContainText(media.sticker.source.licenseUrl);
      await as.page.locator('.original-image').evaluate(img=>img.decode());
      await as.page.screenshot({path:path.join(evidence,file+'-详情.png')});
      await as.page.locator('#dialog-close').click();
      return {id:reply.id,chat,label,digest,source:media.sticker.source};
    }
    const directEvidence=await received(a,directReply,direct,'笑到流泪','私聊口语请求','OpenMoji','image/png');
    const themeDirect=await send(a,direct,input[1],'public_theme_direct',{aiConsentRevision:0});
    const themeGroup=await send(a,group,input[3],'public_theme_group_automatic');
    assert.equal(themeGroup.message.mention,undefined);
    assert.equal((await send(a,group,input[3],'public_theme_group_automatic')).reply,undefined);
    const themeDirectEvidence=await received(a,themeDirect.reply,direct,'小猫探头偷看','私聊_动物探头','', 'image/jpeg');
    const themeGroupEvidence=await received(b,themeGroup.reply,group,'松鼠探头偷看','群成员_自然接话','', 'image/jpeg');
    assert.deepEqual(modelTurns.map(row=>row.input),input.slice(2));
    assert.equal(calls.length,6);
    assert.equal(calls.filter(call=>new URL(call.url).searchParams.has('gsrsearch')).length,2);
    await fs.writeFile(path.join(evidence,'receipt.json'),JSON.stringify({pass:true,publicOnly:true,input,directEvidence,themeDirectEvidence,
      themeGroupEvidence,calls,modelTurns,repeatGroupReply:false,realModelCalls:0},null,2)+'\n');
  }finally{
    globalThis.fetch=realFetch;
    await browser?.close();
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    store.db.close();
    const checked=await fs.realpath(scratch);
    assert.equal(path.dirname(checked),tmp);
    assert.match(path.basename(checked),/^arcade-social-public-reaction-[a-z0-9]{6}$/iu);
    await fs.rm(checked,{recursive:true,force:true});
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
