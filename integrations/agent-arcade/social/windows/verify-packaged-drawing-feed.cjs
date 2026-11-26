'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {PNG}=require('pngjs');

const accountId='a'.repeat(32),token='synthetic-workers-token';
const prompt='潮汐旁的折纸小船，水面映着橙色路灯';
const title='白纸渡口';
const post='合成动态：今天把折纸小船放上窗台。';
const privateMarker='SYNTHETIC_PRIVATE_111_MARKER';
const role='arcade_whale', a='tls_card_owner', b='tls_card_peer';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

function extendFixture(scratch,card){
  const image=new PNG({width:256,height:256});
  for(let i=0;i<image.data.length;i+=4)image.data.set([i/1024%256,i/4%256,80,255],i);
  const bytes=PNG.sync.write(image);
  const wire=path.join(scratch,'drawing-feed-wire.jsonl');
  const fixture=path.join(scratch,'drawing-feed-provider.cjs');
  fs.writeFileSync(fixture,`
'use strict';
require(${JSON.stringify(card.mock)});
const cardFetch=globalThis.fetch, assert=require('node:assert/strict'), fs=require('node:fs');
const RealDate=Date, timestamp=RealDate.UTC(2028,3,1,8,5);
global.Date=class extends RealDate {
  constructor(...args){super(...(args.length?args:[timestamp]));}
  static now(){return timestamp;}
};
function record(row){fs.appendFileSync(${JSON.stringify(wire)},JSON.stringify(row)+'\\n');}
globalThis.fetch=async(raw,options)=>{
  const url=new URL(raw);
  if(url.origin==='https://api.cloudflare.com'){
    assert.equal(url.pathname,${JSON.stringify('/client/v4/accounts/'+accountId+'/ai/run/@cf/black-forest-labs/flux-2-klein-4b')});
    assert.equal(options.headers.Authorization,${JSON.stringify('Bearer '+token)});
    const fields=Object.fromEntries(options.body);
    assert.deepEqual(fields,{prompt:${JSON.stringify(prompt)},width:'1024',height:'1024'});
    record({kind:'drawing',prompt:fields.prompt});
    return Response.json({success:true,result:{image:${JSON.stringify(bytes.toString('base64'))}}});
  }
  assert.equal(url.href,'https://api.deepseek.com/chat/completions');
  const body=JSON.parse(options.body);
  if(body.messages[0].content.includes('写自己的角色动态')){
    assert.equal(body.messages.length,2);
    assert.equal(body.tool_choice,'none');
    assert.match(body.messages[1].content,/2028-04-01/);
    const request=JSON.stringify(body);
    for(const value of ${JSON.stringify([privateMarker,a,b,'合成群角色卡验收','合成角色栖潮',prompt])})
      assert(!request.includes(value));
    record({kind:'feed',messages:2,privateFields:false});
    return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({post:${JSON.stringify(post)}})}}]});
  }
  return cardFetch(raw,options);
};
`);
  return {fixture,bytes,wire};
}

async function verifyDrawingFeed({owner,peer,guest,until,button,send,history,restart,fixture,restoreSnapshot}){
  const groupId=await guest(owner,'location.hash.slice(6)');
  const chat='/conversations/'+groupId;
  const api=(client,route,body)=>guest(client,`(async()=>{
    const response=await fetch('/api/v1'+${JSON.stringify(route)},{method:${JSON.stringify(body?'POST':'GET')},
      headers:{'Content-Type':'application/json'},body:${JSON.stringify(body?JSON.stringify(body):undefined)}});
    if(!response.ok)throw Error('Fixture API '+response.status+' '+await response.text());
    return response.json();
  })()`);
  const visit=(client,hash)=>guest(client,`location.hash=${JSON.stringify(hash)}`);
  async function click(client,label){
    await until(()=>guest(client,'!!'+button(label)),'button '+label);
    await guest(client,button(label)+'.click()');
  }
  const requests=()=>fs.existsSync(fixture.wire)?fs.readFileSync(fixture.wire,'utf8').trim().split('\n').map(JSON.parse):[];
  const summary=async client=>(await api(client,'/groups/'+groupId+'/ai')).groupAi.joined.find(item=>item.number===role);
  const direct=(await api(owner,'/direct',{number:b})).conversation;
  await api(owner,'/conversations/'+direct.id+'/messages',{clientId:'private_marker_111',text:privateMarker});
  await click(owner,'群成员');
  await click(owner,'群内 AI');
  await click(owner,'开启云生图');
  await until(async()=>{const state=await summary(owner);return state.drawing.enabled&&state.card?.name==='合成角色栖潮';},
    'drawing and saved card appear in the same role summary');
  await click(owner,'关闭');

  await click(owner,'好友动态');
  await click(owner,'关注角色动态');
  await until(async()=>(await api(owner,'/friend-feed')).role.following,'owner follows');
  assert.equal((await api(peer,'/friend-feed')).role.following,false);
  await restart();
  await click(owner,'刷新');
  await until(()=>guest(owner,`document.querySelector('#feed-posts').textContent.includes(${JSON.stringify(post)})`),'owner sees role post');
  assert.equal((await api(peer,'/friend-feed')).posts.length,0);
  const firstPost=(await api(owner,'/friend-feed')).posts[0];
  assert.equal(firstPost.author.number,role);

  await visit(owner,'#chat/'+groupId);
  await until(()=>guest(owner,'!document.querySelector("#composer").hidden'),'owner returns to group');
  assert.equal((await summary(owner)).sharing,false);
  await send(owner,'@鲸鱼娘 画一张'+prompt);
  await until(()=>history(peer,'@鲸鱼娘 画一张'+prompt),'peer sees the consent-negative prompt');
  assert.equal((await summary(owner)).drawing.usedToday,0);
  assert.deepEqual(requests(),[{kind:'feed',messages:2,privateFields:false}]);

  const valid='画一张'+prompt+'，取名「'+title+'」';
  await click(peer,'群成员');
  await click(peer,'群内 AI');
  await click(peer,'@鲸鱼娘（AI）');
  await send(peer,valid);
  async function receive(count){
    const controls='[...document.querySelectorAll("[data-image-id]")]';
    await until(()=>guest(owner,`${controls}.length===${count}`),'image '+count+' received in other profile');
    const item=await guest(owner,`${controls}.at(-1).dataset.imageId`);
    await guest(owner,`${controls}.at(-1).click()`);
    await until(()=>guest(owner,'Boolean(document.querySelector("#dialog img")?.naturalWidth)'),'original image decoded');
    const file=await guest(owner,`(async()=>{
      const image=document.querySelector('#dialog img'),reply=await fetch(image.src);
      return {displayed:image.naturalWidth,mime:reply.headers.get('Content-Type'),bytes:Array.from(new Uint8Array(await reply.arrayBuffer()))};
    })()`);
    assert.equal(file.displayed,256);
    assert.equal(file.mime,'image/png');
    assert.deepEqual(Buffer.from(file.bytes),fixture.bytes);
    await click(owner,'关闭');
    return {id:Number(item),sha256:sha(Buffer.from(file.bytes))};
  }
  const original=await receive(1);
  await send(peer,'再发一次');
  const resent=await receive(2);
  assert.notEqual(original.id,resent.id);
  assert.equal(resent.sha256,original.sha256);
  assert.equal((await summary(owner)).drawing.usedToday,1);
  assert.equal((await api(peer,'/friend-feed')).posts.length,0);
  await click(peer,'好友动态');
  await click(peer,'关注角色动态');
  await until(async()=>(await api(peer,'/friend-feed')).posts[0]?.id===firstPost.id,'second follower sees same post');
  assert.deepEqual(requests(),[{kind:'feed',messages:2,privateFields:false},{kind:'drawing',prompt}]);
  return {passed:true,original,resent,groupRoleCardPreserved:true,samePost:firstPost.id,drawingRequiresItsOwnConsent:true,
    nonFollowerCouldDrawWithConsent:true,unfollowedPostHidden:true,providerCalls:requests(),restore:await restoreSnapshot()};
}

async function verifyRestore({scratch,serviceRoot}){
  const {makeBackup}=require(path.join(serviceRoot,'deploy/backup.cjs'));
  const source=path.join(scratch,'synthetic.sqlite');
  const restored=await makeBackup(source,path.join(scratch,'restore-preview'),{prepareRestore:true});
  function read(file){
    const db=new DatabaseSync(file,{readOnly:true});
    try{
      const tables=['sessions','ai_group_cards','ai_group_draw_settings','ai_feed_follows','ai_group_role_consents',
        'ai_group_draw_requests','ai_feed_turns','friend_posts'];
      return Object.fromEntries(tables.map(table=>[table,db.prepare('SELECT count(*) AS n FROM '+table).get().n]));
    }finally{db.close();}
  }
  const before=read(source),after=read(restored);
  for(const table of ['sessions','ai_group_cards','ai_group_draw_settings','ai_feed_follows','ai_group_role_consents']){
    assert(before[table]>0,table);
    assert.equal(after[table],0,table);
  }
  for(const table of ['ai_group_draw_requests','ai_feed_turns','friend_posts']){
    assert(before[table]>0,table);
    assert.equal(after[table],before[table],table);
  }
  return {before,after};
}

module.exports={accountId,token,extendFixture,verifyDrawingFeed,verifyRestore};
