'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter,once}=require('node:events');
const {createHash}=require('node:crypto');
const {createServer:loopback}=require('node:http');
const {Readable}=require('node:stream');
const {pathToFileURL}=require('node:url');
const {PNG}=require('pngjs');
const {parseCardFile}=require('../../src/bot/character-cards.cjs');
const {writeCardToPng}=require('../../src/vendor/sillytavern/character-card-parser.cjs');
const {CharacterLibrary}=require('../../src/bot/character-library.cjs');
const {createGroupCardPicker}=require('../../src/core/store-group-card-picker.cjs');
const {createSocialView}=require('./social-view.cjs');
const {cloudDrawingProvider}=require('../server/group-cloud-drawing.cjs');
const {SocialStore,AI_NUMBER}=require('../server/store.cjs');
const {createServer}=require('../server/http.cjs');

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const rgba=bytes=>sha(PNG.sync.read(bytes).data);
const evidence=process.argv[2]&&path.resolve(process.argv[2]);
function sample(colour){
  const img=new PNG({width:32,height:24});
  for(let i=0;i<img.data.length;i+=4)img.data.set([(colour+i/4)%256,colour,190,255],i);
  return PNG.sync.write(img);
}
const nativeImage={createFromBuffer(bytes){
  const image=PNG.sync.read(bytes);
  return {isEmpty:()=>false,getSize:()=>({width:image.width,height:image.height}),toPNG:()=>PNG.sync.write(image)};
}};

class Contents extends EventEmitter{
  destroyed=false;
  handlers=new Map();
  ipc={handle:(key,cb)=>this.handlers.set(key,cb)};
  mainFrame={url:''};
  call(key,payload){return this.handlers.get(key)({sender:this,senderFrame:this.mainFrame},payload);}
  setWindowOpenHandler(){}
  focus(){}
  isDestroyed(){return this.destroyed;}
  loadFile(page){this.mainFrame.url=pathToFileURL(page).href;return Promise.resolve();}
  close(){this.destroyed=true;this.emit('destroyed');}
}
class View{webContents=new Contents();setBounds(){}}

async function run(){
  if(evidence)fs.mkdirSync(evidence,{recursive:true});
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-group-card-portrait-'));
  const library=new CharacterLibrary({root:path.join(temp,'characters')});
  const db=new SocialStore(path.join(temp,'social.sqlite'));
  const sourceA=sample(31),sourceB=sample(134),output=sample(210),photo=sample(80);
  const localCalls=[],wire=[],guestReads=[],webOpened=[],negatives=[];
  function imported(name,bytes){
    const json=JSON.stringify({spec:'chara_card_v2',spec_version:'2.0',
      data:{name,description:'在街角修钟表',creator_notes:'SYNTHETIC_PRIVATE_AUTHOR'}});
    const file=bytes?writeCardToPng(bytes,json):Buffer.from(json);
    const parsed=parseCardFile(file,{fileName:bytes?'card.png':'card.json'});
    return library.add({card:parsed.card,portrait:parsed.portrait}).id;
  }
  // Same visible name and card text. Only the imported portraits differ.
  const cardA=imported('禾川',sourceA),cardB=imported('禾川',sourceB),textOnly=imported('秋灯');
  const modelArrived=Promise.withResolvers(),release=Promise.withResolvers();
  const privateArrived=Promise.withResolvers(),releasePrivate=Promise.withResolvers();
  let upstreamError;
  const upstream=loopback((req,res)=>void(async()=>{
    const form=await new Request('http://localhost'+req.url,{method:'POST',headers:req.headers,
      body:Readable.toWeb(req),duplex:'half'}).formData();
    const ref=form.get('input_image_0'),bytes=ref?Buffer.from(await ref.arrayBuffer()):null;
    if(ref){assert.equal(ref.type,'image/png');assert.equal(ref.name,'reference.png');}
    wire.push({url:req.url,prompt:form.get('prompt'),fields:[...form.keys()],mime:ref?.type,
      pngSha256:bytes&&sha(bytes),rgbaSha256:bytes&&rgba(bytes)});
    if(form.get('prompt').includes('等撤销')){modelArrived.resolve();await release.promise;}
    if(form.get('prompt').includes('绘稿等切换')){privateArrived.resolve();await releasePrivate.promise;}
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({success:true,result:{image:output.toString('base64')}}));
  })().catch(error=>{upstreamError=error;modelArrived.reject(error);res.writeHead(500).end();})).listen(0,'127.0.0.1');
  await once(upstream,'listening');
  const aiProvider={provider:'deepseek',groupRoles:[{number:AI_NUMBER,name:'鲸鱼娘'}],
    generate(){throw Error('Unexpected chat model request');}};
  const drawingProvider=cloudDrawingProvider({accountId:'a'.repeat(32),apiToken:'synthetic-only-token',dailyLimit:30,
    fetchImpl:(url,options)=>{
      assert.equal(new URL(url).origin,'https://api.cloudflare.com');
      return fetch('http://127.0.0.1:'+upstream.address().port+new URL(url).pathname,options);
    }});
  const server=createServer(db,{aiProvider,drawingProvider,personalAiFetch(){
    throw Error('Unexpected personal chat model request');
  }}).listen(0,'127.0.0.1');
  let browser;
  try{
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    function user(number){
      let cookie='';
      async function raw(route,options={}){
        const headers=new Headers(options.headers);
        headers.set('Cookie',cookie);
        const response=await fetch(origin+route,{...options,headers});
        if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
        return response;
      }
      return {number,raw,async api(route,data,status=200){
        const reply=await raw('/api/v1'+route,data===undefined?{}:{method:'POST',
          headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
        const result=await reply.json();
        assert.equal(reply.status,status,route+' '+JSON.stringify(result));
        return result;
      }};
    }
    const owner=user('card_owner'),peer=user('card_peer');
    for(const u of [owner,peer])await u.api('/register',{number:u.number,displayName:u.number,password:'synthetic-only-password'});
    const friendship=(await owner.api('/friend-requests',{number:peer.number})).request;
    await peer.api('/friend-requests/'+friendship.id+'/accept',{});
    async function group(title){
      const id=(await owner.api('/groups',{title,memberNumbers:[peer.number]})).conversation.id;
      const route='/groups/'+id;
      await owner.api(route+'/ai',{number:AI_NUMBER,expectedAccount:owner.number,enabled:true});
      await owner.api(route+'/ai-drawing',{number:AI_NUMBER,expectedAccount:owner.number,enabled:true});
      await peer.api(route+'/ai-consent',{number:AI_NUMBER,expectedAccount:peer.number,provider:'deepseek',enabled:true});
      return {id,route,feed:'/conversations/'+id+'/messages'};
    }
    const a=await group('禾川的合成群'),b=await group('邻群'),c=await group('撤销在途');
    let context;
    if(evidence){
      const {chromium}=require('playwright');
      browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
      context=await browser.newContext({viewport:{width:420,height:840},serviceWorkers:'block'});
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      const login=await context.request.post(origin+'/api/v1/login',{data:{number:owner.number,password:'synthetic-only-password'}});
      assert.equal(login.status(),200);
    }
    async function openOriginal(room,reply,label){
      if(!context)return;
      const page=await context.newPage();
      try{
        await page.goto(origin+'/#chat/'+room.id);
        const imagePath='/api/v1'+room.feed+'/'+reply+'/image';
        const fetched=page.waitForResponse(response=>response.url()===origin+imagePath&&response.ok());
        await page.locator('button[data-image-id="'+reply+'"]').click();
        await page.getByAltText('AI 绘制的原图',{exact:true}).waitFor();
        await page.waitForFunction(()=>document.querySelector('.original-image')?.naturalWidth===32);
        const bytes=await (await fetched).body();
        assert.deepEqual(bytes,output);
        await page.screenshot({path:path.join(evidence,label+'.png')});
        webOpened.push({room:room.id,reply,account:owner.number,sha256:sha(bytes),screenshot:label+'.png'});
      }finally{await page.close();}
    }
    let pendingView;
    const window=Object.assign(new EventEmitter(),{isDestroyed:()=>false,getContentSize:()=>[900,700],
      contentView:{addChildView(view){pendingView.resolve(view.webContents);},removeChildView(){}}});
    const choice=createGroupCardPicker({window,WebContentsView:View,library,nativeImage});
    const browserSession=Object.assign(new EventEmitter(),{webRequest:{onBeforeRequest(){}},setPermissionCheckHandler(){},setPermissionRequestHandler(){},
      fetch(url,options){return owner.raw(url.slice(origin.length),options);}});
    const guest=createSocialView({WebContentsView:View,session:{fromPartition:()=>browserSession},configuration:{mode:'test',origin},
      isActive:()=>true,pickGroupCard:choice}).view.webContents;
    const settings=async(room,u=owner)=>(await u.api(room.route+'/ai')).groupAi.joined[0];
    async function choose(room,id,share,expectedSource,confirm=true){
      guest.mainFrame.url=origin+'/#chat/'+room.id;
      pendingView=Promise.withResolvers();
      const before=await settings(room),count=wire.length;
      const picking=guest.call('arcade:pickGroupCard',{groupId:room.id,roleId:AI_NUMBER,roleRevision:before.roleRevision});
      const local=await pendingView.promise;
      const request=data=>local.call('arcade:reviewGroupCard',data);
      assert((await request({action:'list'})).cards.some(card=>card.id===id));
      const preview=await request({action:'preview',id});
      if(expectedSource){
        const previewPng=Buffer.from(preview.portrait,'base64');
        assert.equal(rgba(previewPng),rgba(expectedSource));
        assert.doesNotMatch(previewPng.toString('latin1'),/chara|ccv3|SYNTHETIC_PRIVATE_AUTHOR/u);
      }
      else assert.equal(preview.portrait,undefined);
      await request(confirm?{action:'accept',id,indexes:[],sharePortrait:share}:{action:'cancel'});
      const result=await picking;
      if(!confirm){assert.equal(result,null);assert.equal((await settings(room)).roleRevision,before.roleRevision);}
      else if(share)assert.deepEqual(result,{portraitSaved:true});
      else await owner.api(room.route+'/ai-card',{expectedAccount:owner.number,number:AI_NUMBER,expectedRevision:before.roleRevision,card:result});
      assert.equal(wire.length,count,'Preview and save use no model');
      assert(!JSON.stringify(await settings(room)).includes('SYNTHETIC_PRIVATE_AUTHOR'));
      assert(!Object.hasOwn(await settings(room,peer),'portraitApproved'));
      localCalls.push({room:room.id,card:preview.name,confirmed:confirm,shared:confirm&&share,
        previewRgba:preview.portrait?rgba(Buffer.from(preview.portrait,'base64')):null});
    }
    let seq=0;
    function ask(room,text){return peer.api(room.feed,{clientId:'portrait_probe_'+(++seq),mentionAccount:AI_NUMBER,text});}
    async function generated(room,text,expectedSource,open){
      const count=wire.length;
      const {message,reply}=await ask(room,text);
      assert.ifError(upstreamError);
      assert.equal(wire.length,count+1,text+' → '+JSON.stringify(reply));
      assert.equal(wire.at(-1).rgbaSha256,expectedSource?rgba(expectedSource):null,text);
      assert(wire.at(-1).prompt.endsWith(text.replace(/^(?:现在就)?画一张/u,'')),text);
      assert.equal(reply.sender.number,AI_NUMBER);
      assert.equal(reply.conversationId,room.id);
      assert.equal(reply.attachment.mime,'image/png');
      assert((await owner.api(room.feed)).messages.some(message=>message.id===reply.id));
      const response=await owner.raw('/api/v1'+room.feed+'/'+reply.id+'/image');
      assert.equal(response.status,200);
      const bytes=Buffer.from(await response.arrayBuffer());
      assert.deepEqual(bytes,output);
      guestReads.push({room:room.id,request:message.id,text,reply:reply.id,sender:reply.sender.number,sha256:sha(bytes),rgbaSha256:rgba(bytes)});
      if(open)await openOriginal(room,reply.id,open);
    }
    await choose(a,cardA,true,sourceA,false);
    await choose(a,cardA,true,sourceA);
    assert.equal((await settings(a)).portraitApproved,true);
    const savedA=await settings(a);
    const fakeReference={expectedAccount:owner.number,number:AI_NUMBER,expectedRevision:savedA.roleRevision,
      card:savedA.card,portrait:'https://example.invalid/member-photo.png'};
    await owner.api(a.route+'/ai-card',fakeReference,400);
    await peer.api(a.route+'/ai-card',{...fakeReference,expectedAccount:peer.number,portrait:photo.toString('base64')},403);
    const lantern='画一张你自己的表情，抱一盏蓝纸灯';
    await generated(a,lantern,sourceA,'同名卡A-原图');
    const billedBefore=db.one('SELECT count(*) AS n FROM ai_group_draw_requests WHERE chat=?',a.id).n;
    const uploaded=await peer.raw('/api/v1/conversations/'+a.id+'/images',{method:'POST',
      headers:{'Content-Type':'image/png','X-Social-Account':peer.number,'X-Social-Client-Id':'normal_group_photo'},body:photo});
    assert.equal(uploaded.status,200);
    for(const [suffix,photoControl] of [['先报费用',false],['等我说开始再动笔',false],['先别画',false],['参考我刚才上传的照片',true]]){
      const text=lantern+'，'+suffix,count=wire.length;
      const {message,reply}=await ask(a,text);
      assert.equal(wire.length,count);
      assert(!reply?.attachment);
      if(photoControl)assert.match(reply.text,/照片/u);
      negatives.push({text,request:message.id,reply:reply?.text??null,drawingCalls:0});
    }
    assert.equal(db.one('SELECT count(*) AS n FROM ai_group_draw_requests WHERE chat=?',a.id).n,billedBefore);
    await choose(a,cardB,true,sourceB);
    await owner.api(a.route+'/ai-card',{...fakeReference,portrait:sourceA.toString('base64')},409);
    await generated(a,'现在就'+lantern,sourceB,'同名卡B-原图');
    await generated(a,'画一张潮汐旁的折纸小船，蓝色三角帆上有三道细纹，水面映着橙色路灯',null);
    await choose(b,textOnly,false,null);
    await generated(b,'画一张你自己抱紫纸灯的表情',null);
    const upload=await peer.raw('/api/v1/conversations/'+b.id+'/images',{method:'POST',
      headers:{'Content-Type':'image/png','X-Social-Account':peer.number,'X-Social-Client-Id':'normal_group_photo'},body:photo});
    assert.equal(upload.status,200);
    const before=wire.length;
    const rejected=await ask(b,'画一张用我刚才上传的照片当底稿的插画');
    assert.match(rejected.reply.text,/照片/u);
    assert.equal(wire.length,before);
    await choose(c,cardB,true,sourceB);
    await generated(c,'画一张禾川的店门口',null);
    const inFlight=ask(c,'画一张你自己抱着写有等撤销的纸灯');
    await Promise.race([modelArrived.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('No request')),6000).unref())]);
    const card=await settings(c);
    await owner.api(c.route+'/ai-card',{expectedAccount:owner.number,number:AI_NUMBER,
      expectedRevision:card.roleRevision,card:card.card});
    assert.equal((await settings(c)).portraitApproved,false);
    release.resolve();
    assert.equal((await inFlight).reply,undefined);
    await generated(c,'画一张你自己挥手的表情',null);

    const privateRoute='/personal-ai/private-profile', privateCalls=[];
    async function bind(u){
      return (await u.api('/personal-ai',{action:'bind',role:'arcade_dragon',revision:null,
        expectedAccount:u.number,name:'同名信使',key:'synthetic-only-text-key'})).identity;
    }
    const ownRole=await bind(owner),otherRole=await bind(peer);
    assert.notEqual(ownRole.number,otherRole.number);
    await owner.api('/personal-ai/friend-settings',{expectedAccount:owner.number,number:ownRole.number,
      revision:null,discoverable:true,guestCloud:true});
    async function start(u,role){
      const {conversation}=await u.api('/friend-requests',{expectedAccount:u.number,number:role.number});
      await u.api('/ai-contacts/start',{expectedAccount:u.number,number:role.number,provider:'openai',
        allowCloud:true,personalContext:true});
      return {client:u,role,id:conversation.id,feed:'/conversations/'+conversation.id+'/messages'};
    }
    const own=await start(owner,ownRole), other=await start(peer,otherRole), friend=await start(peer,ownRole);
    function viewFor(actor){
      const session=Object.assign(new EventEmitter(),{webRequest:{onBeforeRequest(){}},
        setPermissionCheckHandler(){},setPermissionRequestHandler(){},
        fetch:(url,options)=>actor.raw(url.slice(origin.length),options)});
      return createSocialView({WebContentsView:View,session:{fromPartition:()=>session},
        configuration:{mode:'test',origin},isActive:()=>true,pickGroupCard:choice}).view.webContents;
    }
    const profileOf=async actor=>(await actor.api(privateRoute)).profile;
    async function choosePrivate(room,id,expectedSource){
      const {client,role}=room, before=await profileOf(client), count=wire.length;
      const view=viewFor(client);
      view.mainFrame.url=origin+'/#chat/'+room.id;
      pendingView=Promise.withResolvers();
      const picking=view.call('arcade:pickGroupCard',{scope:'personal-direct',groupId:'',roleId:role.number,
        roleRevision:before.profileRevision});
      const local=await pendingView.promise;
      const request=data=>local.call('arcade:reviewGroupCard',data);
      const {target}=await request({action:'list'});
      assert(target.direct&&target.maySharePortrait&&target.roleId===role.number);
      const preview=await request({action:'preview',id});
      if(expectedSource)assert.equal(rgba(Buffer.from(preview.portrait,'base64')),rgba(expectedSource));
      else assert.equal(preview.portrait,undefined);
      await request({action:'accept',id,indexes:[],sharePortrait:!!expectedSource});
      const result=await picking;
      if(expectedSource)assert.deepEqual(result,{portraitSaved:true});
      else await client.api(privateRoute,{expectedAccount:client.number,number:role.number,
        expectedRevision:before.profileRevision,card:result});
      const after=await profileOf(client);
      assert.equal(after.portraitApproved,!!expectedSource);
      assert.equal(wire.length,count);
      return after;
    }
    async function privateAsk(room,text){
      const {conversation}=await room.client.api('/conversations/'+room.id);
      return room.client.api(room.feed,{clientId:'portrait_private_'+(++seq),aiConsentRevision:conversation.cloudChat.revision,text});
    }
    async function privateImage(room,text,source,proof){
      const count=wire.length;
      const {reply}=await privateAsk(room,text);
      assert.equal(wire.length,count+1,text+' → '+JSON.stringify(reply));
      const sent=wire.at(-1);
      assert.equal(sent.rgbaSha256,source?rgba(source):null);
      assert.deepEqual(sent.fields,source?['prompt','width','height','input_image_0']:['prompt','width','height']);
      assert.doesNotMatch(sent.prompt,/SYNTHETIC_PRIVATE_AUTHOR|在街角修钟表|群卡哨兵/u);
      assert.equal(reply.sender.number,room.role.number);
      assert.equal(reply.conversationId,room.id);
      assert.deepEqual(Buffer.from(await (await room.client.raw('/api/v1'+room.feed+'/'+reply.id+'/image')).arrayBuffer()),output);
      privateCalls.push({case:proof,role:room.role.number,reply:reply.id,pngSha256:sent.pngSha256,rgbaSha256:sent.rgbaSha256});
      return sent;
    }
    const explicit='照着你的公开头像，画一张表情包';
    const countBefore=wire.length;
    const preApproval=await privateAsk(own,explicit);
    assert.match(preApproval.reply.text,/没有获准/u);
    assert.equal(wire.length,countBefore);
    const approved=await choosePrivate(own,cardA,sourceA);
    await choosePrivate(other,cardB,sourceB);
    const rawApproved=Buffer.from(approved.portraitPreview,'base64');
    assert.doesNotMatch(rawApproved.toString('latin1'),/chara|ccv3|SYNTHETIC_PRIVATE_AUTHOR/u);
    await peer.api(privateRoute,{expectedAccount:peer.number,number:ownRole.number,expectedRevision:approved.profileRevision,
      card:approved.card,portrait:approved.portraitPreview},409);
    const original=await privateImage(own,explicit,sourceA,'主人按原句');
    assert.equal(original.pngSha256,sha(rawApproved));
    await privateImage(other,'画一张你自己的表情，双手抱一盏青灯',sourceB,'另一位同名角色');
    await privateImage(friend,'画一张你自己的表情，抱一盏蓝纸灯',sourceA,'已同意好友');
    const changed=await choosePrivate(own,cardB,sourceB);
    assert.notEqual(changed.portraitPreview,approved.portraitPreview);
    await owner.api(privateRoute,{expectedAccount:owner.number,number:ownRole.number,expectedRevision:approved.profileRevision,
      card:approved.card,portrait:approved.portraitPreview},409);
    await privateImage(friend,explicit,sourceB,'换卡后好友重问');
    await privateImage(friend,'画一张黄昏海岸，潮水漫过礁石',null,'风景');
    const beforePhoto=wire.length;
    assert.match((await privateAsk(own,'画一张用我刚才上传的照片当底稿的插画')).reply.text,/聊天照片/u);
    assert.equal(wire.length,beforePhoto);
    const delayedPrivate=privateAsk(own,'画一张你自己抱着写有绘稿等切换的纸灯');
    await Promise.race([privateArrived.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('No private request')),6000).unref())]);
    if(context){
      const page=await context.newPage();
      try{
        await page.goto(origin+'/#chat/'+own.id);
        await page.getByRole('button',{name:'会话设置',exact:true}).click();
        await page.getByRole('button',{name:'私聊角色设定',exact:true}).click();
        const image=page.getByAltText('已获准用于私聊绘图的卡面');
        await image.waitFor();
        assert.equal(await image.getAttribute('src'),'data:image/png;base64,'+changed.portraitPreview);
        await page.waitForFunction(()=>document.querySelector('.private-drawing-portrait')?.naturalWidth===32);
        await page.screenshot({path:path.join(evidence,'私聊角色卡面.png')});
        await page.getByRole('button',{name:'关闭私聊卡面参考',exact:true}).click();
        await page.getByRole('button',{name:'保存到私聊',exact:true}).click();
        await page.getByText('已保存，下一条新私聊消息开始使用。',{exact:true}).waitFor();
      }finally{await page.close();}
    }else{
      await owner.api(privateRoute,{expectedAccount:owner.number,number:ownRole.number,
        expectedRevision:changed.profileRevision,card:changed.card});
    }
    releasePrivate.resolve();
    assert.equal((await delayedPrivate).reply,undefined);
    assert.equal((await profileOf(owner)).portraitApproved,false);
    assert.equal((await profileOf(peer)).portraitApproved,true);
    const afterClose=wire.length;
    assert.match((await privateAsk(own,explicit)).reply.text,/没有获准/u);
    assert.equal(wire.length,afterClose);
    await choosePrivate(own,textOnly,null);
    await privateImage(own,'画一张你自己挥手的表情',null,'JSON 卡只发画面描述');
    return {sources:{cardA:rgba(sourceA),cardB:rgba(sourceB),groupPhoto:rgba(photo)},
      localCalls,wire,guestReads,webOpened,negatives,privateCalls,privateRevokedInFlightReply:0,privatePhotoRequests:0,
      revokedInFlightReply:0,ordinaryPhotoDrawingRequests:0,externalRequests:0,
      scope:'Native Image codec and WebContents are substituted; actual card import, picker control, social HTTP and Workers multipart request are exercised.'};
  }finally{
    release.resolve();
    releasePrivate.resolve();
    if(browser)await browser.close();
    for(const service of [server,upstream]){
      service.closeAllConnections();
      await new Promise(resolve=>service.close(resolve));
    }
    db.db.close();
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
run().then(value=>console.log(JSON.stringify(value,null,2))).catch(error=>{console.error(error);process.exitCode=1;});
