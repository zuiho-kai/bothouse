'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
const {createServer:loopback}=require('node:http');
const {chromium}=require('playwright');
const {createServer}=require('../../server/http.cjs');
const {SocialStore,AI_NUMBER}=require('../../server/store.cjs');
const {moderate}=require('../../server/moderate.cjs');
const {AI_DRAGON_NUMBER,AI_JU_NUMBER}=require('../../server/ai-roles.cjs');
const {createDeepSeekProvider}=require('../../server/ai-deepseek.cjs');
const {createOpenAIGroupProvider}=require('../../server/ai-openai.cjs');
const {createClaudeProvider}=require('../../server/ai-claude.cjs');

const button=(page,name)=>page.getByRole('button',{name,exact:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const listen=async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;};
const stop=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});

async function api(page,route,data,status=200){
  const response=await page.request.fetch('/api/v1'+route,{method:data===undefined?'GET':'POST',
    headers:{'x-social-claude-ui':'1'},data});
  assert.equal(response.status(),status,await response.text());
  return response.json();
}

async function register(browser,origin,number){
  const page=await browser.newPage({baseURL:origin,viewport:{width:980,height:820},serviceWorkers:'block'});
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.goto('/');
  await button(page,'创建账号').click();
  await page.locator('[name=number]').fill(number);
  await page.locator('[name=displayName]').fill(number);
  await page.locator('[name=password]').fill('synthetic only test phrase');
  await page.locator('#auth-submit').click();
  await page.getByRole('heading',{name:'消息',exact:true}).waitFor();
  return page;
}

async function sample(page,color,format){
  return Buffer.from(await page.evaluate(({color,format})=>{
    const canvas=document.createElement('canvas');
    canvas.width=48;canvas.height=32;
    const context=canvas.getContext('2d');
    context.fillStyle=color;context.fillRect(0,0,48,32);
    context.fillStyle='white';context.fillRect(31,14,10,12);
    return canvas.toDataURL(format).split(',')[1];
  },{color,format}),'base64');
}

function phoneJpeg(jpeg){
  const tiff=Buffer.alloc(92);
  tiff.write('II');tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);
  tiff.writeUInt16LE(2,8);
  tiff.writeUInt16LE(0x112,10);tiff.writeUInt16LE(3,12);tiff.writeUInt32LE(1,14);tiff.writeUInt16LE(6,18);
  tiff.writeUInt16LE(0x8825,22);tiff.writeUInt16LE(4,24);tiff.writeUInt32LE(1,26);tiff.writeUInt32LE(38,30);
  tiff.writeUInt16LE(2,38);
  tiff.writeUInt16LE(1,40);tiff.writeUInt16LE(2,42);tiff.writeUInt32LE(2,44);tiff.write('N',48);
  tiff.writeUInt16LE(2,52);tiff.writeUInt16LE(5,54);tiff.writeUInt32LE(3,56);tiff.writeUInt32LE(68,60);
  for(const [index,value] of [12,34,56].entries()){
    tiff.writeUInt32LE(value,68+index*8);tiff.writeUInt32LE(1,72+index*8);
  }
  const segment=(marker,bytes)=>{
    const head=Buffer.from([255,marker,0,0]);head.writeUInt16BE(bytes.length+2,2);
    return Buffer.concat([head,bytes]);
  };
  return Buffer.concat([jpeg.subarray(0,2),segment(225,Buffer.concat([Buffer.from('Exif\0\0'),tiff])),
    segment(225,Buffer.from('http://ns.adobe.com/xap/1.0/\0GPSLatitude=SYNTHETIC_LOCATION')),
    segment(254,Buffer.from('SYNTHETIC_CAPTURE_COMMENT')),jpeg.subarray(2)]);
}

async function upload(page,file,name,mime,withPrompt){
  await button(page,'图片').click();
  const dialog=page.locator('#dialog');
  await dialog.locator('input[type=file]').setInputFiles({name,mimeType:mime,buffer:file});
  if(withPrompt)await dialog.getByText(/本次会把所选照片的画面和问题发给鲸鱼娘使用的 DeepSeek/u).waitFor();
  const pending=page.waitForResponse(res=>res.request().method()==='POST'&&res.url().endsWith('/images'));
  await button(page,withPrompt?'发送图片和问题':'发送图片').click();
  const response=await pending;
  assert.equal(response.status(),200);
  return (await response.json()).message;
}

async function openPhoto(page,id){
  await page.locator('[data-image-id="'+id+'"]').click();
  await button(page,'问 AI').click();
  await page.getByRole('heading',{name:'问 AI 看这张图片'}).waitFor();
}

async function main(){
  const output=path.resolve(process.argv[2]);
  await fs.mkdir(output);
  const store=new SocialStore(path.join(output,'fixture.sqlite'));
  const requests=[],publicRequests=[],capturedImages=new Map();
  const inFlight=Promise.withResolvers(), release=Promise.withResolvers();
  const cardInFlight=Promise.withResolvers(), releaseCard=Promise.withResolvers();
  let browser,server;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async target=>{publicRequests.push(String(target));throw Error('No external requests allowed');};
  const upstream=loopback(async (req,res)=>{
    const buffers=[];
    for await(const chunk of req)buffers.push(chunk);
    const body=JSON.parse(Buffer.concat(buffers));
    const parts=(body.messages??body.input).at(-1).content;
    const endpoint=req.url;
    const image=Array.isArray(parts)&&parts.find(part=>['image_url','input_image','image'].includes(part.type));
    const data=image?.source?.data??(image?.image_url?.url??image?.image_url)?.split(',')[1];
    const imageBytes=data&&Buffer.from(data,'base64');
    const digest=imageBytes&&sha(imageBytes);
    if(digest)capturedImages.set(digest,imageBytes);
    const reply='本机模型替身回执 '+(digest?.slice(0,10)??'纯文字');
    requests.push({endpoint,model:body.model,parts:Array.isArray(parts)?parts.map(part=>part.type):['plain'],
      prompt:Array.isArray(parts)?parts.find(part=>part.text)?.text:parts,digest,
      userTurns:(body.messages??body.input).filter(row=>row.role==='user').length,
      context:(body.messages??body.input).slice(0,-1).filter(row=>row.role==='user').map(row=>row.content),
      instructions:body.instructions??body.system??body.messages?.find(row=>row.role==='system')?.content});
    if(parts.some?.(part=>part.text==='已提交但来源即将移除')){inFlight.resolve();await release.promise;}
    if(parts.some?.(part=>part.text==='软木盒：换卡前的在途问题')){cardInFlight.resolve();await releaseCard.promise;}
    res.setHeader('Content-Type','application/json');
    if(endpoint==='/chat/completions')res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:reply}}]}));
    else if(endpoint==='/v1/messages')res.end(JSON.stringify({type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:reply}]}));
    else res.end(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:reply}]}]}));
  });
  try{
    const endpoint=await listen(upstream);
    const fetchImpl=(url,options)=>{
      const target=new URL(url);
      assert(['api.deepseek.com','api.openai.com','api.anthropic.com'].includes(target.hostname));
      assert.equal(options.redirect,'error');
      return originalFetch(endpoint+target.pathname,options);
    };
    const options={fetchImpl};
    const openaiProvider=createOpenAIGroupProvider('synthetic',options);
    server=createServer(store,{aiProvider:createDeepSeekProvider('synthetic',options),
      openaiProvider,claudeProvider:createClaudeProvider('synthetic',options)});
    const origin=await listen(server);
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    const [a,b,outside]=await Promise.all(['photo_alice','photo_bobby','photo_other'].map(n=>register(browser,origin,n)));
    const red=await sample(a,'red','image/png'),unrotated=await sample(a,'blue','image/jpeg');
    const blue=phoneJpeg(unrotated);
    const hashes={red:sha(red),originalBlue:sha(blue)};
    assert.notEqual(hashes.red,hashes.originalBlue);
    const {conversation:direct}=await api(a,'/ai-contacts/start',{number:AI_NUMBER,expectedAccount:'photo_alice',allowCloud:true});
    await a.goto('/#chat/'+direct.id);
    await a.locator('#message').fill('这是什么？');
    const directPhoto=await upload(a,red,'red.png','image/png',true);
    await a.locator('#history').getByText('本机模型替身回执 '+hashes.red.slice(0,10),{exact:true}).waitFor();
    assert.equal(await a.locator('#message').inputValue(),'');
    assert.deepEqual(requests.map(row=>[row.endpoint,row.digest,row.prompt,row.userTurns]),
      [['/chat/completions',hashes.red,'这是什么？',1]]);
    const directPlain=await upload(a,blue,'blue.jpg','image/jpeg');
    await a.locator('[data-image-id="'+directPlain.id+'"]').waitFor();
    assert.equal(requests.length,1);
    await openPhoto(a,directPlain.id);
    const originalDownload=await a.request.get('/api/v1/conversations/'+direct.id+'/messages/'+directPlain.id+'/image/download');
    assert.deepEqual(await originalDownload.body(),blue);
    await a.locator('#dialog textarea').fill('请看第二张。');
    const directAsked=a.waitForResponse(res=>res.request().method()==='POST'&&res.url().endsWith('/vision'));
    await button(a,'发送图片和问题给 AI').click();
    const directBody=await (await directAsked).json();
    hashes.blue=requests[1].digest;
    await a.locator('#history').getByText(directBody.reply.text,{exact:true}).waitFor();
    const sent=capturedImages.get(hashes.blue);
    assert.notEqual(hashes.blue,hashes.originalBlue);
    assert(!sent.includes(Buffer.from('SYNTHETIC_LOCATION')));
    assert(!sent.includes(Buffer.from('SYNTHETIC_CAPTURE_COMMENT')));
    // One EXIF entry (orientation=6) and no GPS directory remain.
    assert.equal(sent.readUInt16BE(4),34);
    assert.equal(sent.readUInt16LE(20),1);
    assert.equal(sent.readUInt16LE(22),0x112);
    assert.equal(sent.readUInt16LE(30),6);
    const decoded=await a.evaluate(async variants=>Promise.all(variants.map(async data=>{
      const image=new Image();
      image.src='data:image/jpeg;base64,'+data;
      await image.decode();
      const canvas=document.createElement('canvas');
      canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const pixels=canvas.getContext('2d');
      pixels.drawImage(image,0,0);
      return {width:canvas.width,height:canvas.height,data:Array.from(pixels.getImageData(0,0,canvas.width,canvas.height).data)};
    })),[blue,sent,unrotated].map(bytes=>bytes.toString('base64')));
    assert.deepEqual(decoded[0],decoded[1]);
    assert.deepEqual([decoded[1].width,decoded[1].height],[32,48]);
    assert.deepEqual([decoded[2].width,decoded[2].height],[48,32]);

    const {request}=await api(a,'/friend-requests',{number:'photo_bobby'});
    await api(b,'/friend-requests/'+request.id+'/accept',{});
    const {conversation:group}=await api(a,'/groups',{title:'看图验收群',memberNumbers:['photo_bobby']});
    const groupPath='/groups/'+group.id, history='/conversations/'+group.id+'/messages';
    for(const [number,provider] of [[AI_NUMBER,'deepseek'],[AI_DRAGON_NUMBER,'openai'],[AI_JU_NUMBER,'anthropic']]){
      await api(a,groupPath+'/ai',{expectedAccount:'photo_alice',number,enabled:true});
      await api(a,groupPath+'/ai-consent',{expectedAccount:'photo_alice',number,provider,enabled:true});
      await api(b,groupPath+'/ai-consent',{expectedAccount:'photo_bobby',number,provider,enabled:true});
    }
    await Promise.all([a,b].map(page=>page.goto('/#chat/'+group.id)));
    const first=await upload(a,red,'red.png','image/png');
    const second=await upload(a,blue,'blue.jpg','image/jpeg');
    await openPhoto(b,second.id);
    await b.locator('#dialog select').selectOption(AI_DRAGON_NUMBER);
    await b.locator('#dialog').getByText(/图片作者还没有允许/u).waitFor();
    assert.equal(await button(b,'发送图片和问题给 AI').isDisabled(),true);
    const route=history+'/'+second.id, bView=await api(b,route+'/vision');
    const target=bView.roles.find(role=>role.number===AI_DRAGON_NUMBER);
    const ask={expectedAccount:'photo_bobby',number:target.number,provider:target.provider,revision:target.revision,
      text:'第二张图片是什么？',clientId:'only-once-blue'};
    await api(b,route+'/vision',ask,403);
    await api(outside,route+'/vision',undefined,404);
    await api(b,history.replace(group.id,direct.id)+'/'+second.id+'/vision',undefined,404);
    assert.equal(requests.length,2);
    await button(b,'关闭').click();
    await openPhoto(a,second.id);
    await a.locator('#dialog select').selectOption(AI_DRAGON_NUMBER);
    await button(a,'允许群友问这位 AI').click();
    await button(a,'撤销群友问这位 AI 的授权').waitFor();
    await button(a,'关闭').click();

    await openPhoto(b,second.id);
    await b.locator('#dialog select').selectOption(AI_DRAGON_NUMBER);
    await b.locator('#dialog textarea').fill(ask.text);
    const requestAndReply=b.waitForResponse(res=>res.request().method()==='POST'&&res.url().endsWith('/vision'));
    await button(b,'发送图片和问题给 AI').click();
    const result=await requestAndReply;
    const {message,reply}=await result.json();
    assert.equal(reply.sender.number,AI_DRAGON_NUMBER);
    assert.equal(message.imageQuestion.image,second.id);
    assert.equal(requests[2].endpoint,'/v1/responses');
    assert.equal(requests[2].digest,hashes.blue);
    assert.equal(requests[2].userTurns,1);
    await a.locator('#history').getByText(reply.text,{exact:true}).waitFor();
    const retried=await api(b,route+'/vision',result.request().postDataJSON());
    assert.equal(retried.message.id,message.id);
    assert.equal(retried.reply.id,reply.id);
    assert.equal(requests.length,3);

    await openPhoto(a,first.id);
    await a.locator('#dialog select').selectOption(AI_JU_NUMBER);
    await a.locator('#dialog textarea').fill('请描述群里的第一张。');
    await button(a,'发送图片和问题给 AI').click();
    await b.locator('#history').getByText('本机模型替身回执 '+hashes.red.slice(0,10),{exact:true}).waitFor();
    assert.equal(requests[3].endpoint,'/v1/messages');
    assert.equal(requests[3].digest,hashes.red);
    assert.equal(requests[3].userTurns,1);
    assert.deepEqual(requests[2].context,[]);
    assert.deepEqual(requests[3].context,[]);
    assert.match(requests[3].instructions,/橘娘/);
    assert.match(requests[3].instructions,/多人群里/);
    await openPhoto(a,second.id);
    await a.locator('#dialog select').selectOption(AI_DRAGON_NUMBER);
    await button(a,'撤销群友问这位 AI 的授权').click();
    await button(a,'允许群友问这位 AI').waitFor();
    await api(b,route+'/vision',{...ask,clientId:'after-revoke'},403);
    await button(a,'关闭').click();
    const describeImage=openaiProvider.describeImage;
    delete openaiProvider.describeImage;
    const unsupported=await api(a,route+'/vision',{...ask,expectedAccount:'photo_alice',clientId:'unsupported-role'},409);
    assert.equal(unsupported.error.code,'vision_unsupported');
    assert.equal(requests.length,4);
    openaiProvider.describeImage=describeImage;
    const firstRoute=history+'/'+first.id;
    const ready=(await api(a,firstRoute+'/vision')).roles.find(role=>role.number===AI_JU_NUMBER);
    const late=api(a,firstRoute+'/vision',{expectedAccount:'photo_alice',number:ready.number,provider:ready.provider,
      revision:ready.revision,clientId:'removed-in-flight',text:'已提交但来源即将移除'});
    await Promise.race([inFlight.promise,late.then(row=>{throw Error(JSON.stringify(row));})]);
    const {report}=await api(b,firstRoute+'/report',{reason:'合成验收移除照片'});
    moderate(store,'remove',report.id);
    release.resolve();
    const removed=await late;
    assert.equal(removed.reply,undefined);
    assert.match(removed.visionError,/已撤回/u);
    assert.equal(removed.message.aiReply,'failed');
    await api(a,firstRoute+'/vision',undefined,404);
    assert.equal(requests.length,5);
    async function configure(chat,number,card,lorebook){
      const home='/groups/'+chat.id;
      const revision=async()=> (await api(a,home+'/ai')).groupAi.joined.find(role=>role.number===number).roleRevision;
      const target=()=>({expectedAccount:'photo_alice',number});
      await api(a,home+'/ai-card',{...target(),expectedRevision:await revision(),card});
      await api(a,home+'/ai-lorebook',{...target(),expectedRevision:await revision(),lorebook});
    }
    const other=(await api(a,'/groups',{title:'看图隔离对照群',memberNumbers:['photo_bobby']})).conversation;
    await api(a,'/groups/'+other.id+'/ai',{expectedAccount:'photo_alice',number:AI_DRAGON_NUMBER,enabled:true});
    await configure(other,AI_DRAGON_NUMBER,{name:'另群角色',description:'另群私有对照',examples:'',entries:[]},
      {name:'另群世界书',entries:[{keys:['软木盒'],content:'另群不会进入当前问题'}]});
    const configured=[];
    for(const [number,shown,model] of [[AI_DRAGON_NUMBER,'龙娘','gpt-6.1-sol'],
      [AI_NUMBER,'鲸鱼娘','deepseek-flash'],[AI_JU_NUMBER,'橘娘','claude-opus-5-5']]){
      const card={name:'青栀'+shown,description:'本群公开人物描述 '+shown,examples:'',
        entries:[{keys:['软木盒'],content:'本群卡内命中 '+shown},{keys:['船坞'],content:'卡内未命中 '+shown}]};
      const lorebook={name:'本群批准世界书',entries:[
        {keys:['软木盒'],content:'本群独立书命中 '+shown},{keys:['罗盘'],content:'独立书未命中 '+shown},
      ]};
      const previous=(await api(a,groupPath+'/ai')).groupAi.joined.find(role=>role.number===number);
      await api(a,groupPath+'/ai-card',{expectedAccount:'photo_alice',number,expectedRevision:previous.roleRevision,
        card:{...card,creatorNotes:'私人卡字段不得进入'}},400);
      await configure(group,number,card,lorebook);
      const userText='软木盒里面有什么？见字回答即可。';
      const pending=a.waitForResponse(res=>res.request().method()==='POST'&&res.url().endsWith(history));
      await a.locator('#message').fill('@'+shown+' '+userText);
      await button(a,'发送').click();
      const letter=await (await pending).json();
      assert.equal(letter.reply.sender.number,number);
      const normal=requests.at(-1);
      assert.equal(normal.model,model);
      assert.deepEqual(normal.context.map(JSON.parse),[
        {publicGroupCharacter:{name:card.name,description:card.description,examples:'',background:['本群卡内命中 '+shown]}},
        {publicGroupLorebook:['本群独立书命中 '+shown]},
      ]);
      await openPhoto(a,second.id);
      await a.locator('#dialog select').selectOption(number);
      await a.locator('#dialog textarea').fill(userText);
      const response=a.waitForResponse(res=>res.request().method()==='POST'&&res.url().endsWith('/vision'));
      await button(a,'发送图片和问题给 AI').click();
      const answer=await (await response).json();
      await a.locator('#dialog').waitFor({state:'hidden'});
      const photo=requests.at(-1);
      assert.equal(answer.reply.sender.number,number);
      assert.equal(photo.model,model);
      assert.equal(photo.digest,hashes.blue);
      assert.equal(photo.prompt,userText);
      assert.deepEqual(photo.context,normal.context,'vision must use the same reviewed group context as text');
      assert.equal(photo.userTurns,3);
      assert.match(photo.instructions,/publicGroupCharacter/);
      assert.match(photo.instructions,/publicGroupLorebook/);
      configured.push({number,model,context:photo.context.map(JSON.parse),sameAsText:true,digest:photo.digest});
    }
    const previous=(await api(a,route+'/vision')).roles.find(role=>role.number===AI_DRAGON_NUMBER);
    const delayed=api(a,route+'/vision',{expectedAccount:'photo_alice',number:previous.number,
      provider:previous.provider,revision:previous.revision,clientId:'vision-card-in-flight',text:'软木盒：换卡前的在途问题'});
    await Promise.race([cardInFlight.promise,delayed.then(row=>{throw Error(JSON.stringify(row));})]);
    const nextCard={name:'青栀新角色',description:'临时换卡后才可发的公开人物描述',examples:'',entries:[]};
    const active=(await api(a,groupPath+'/ai')).groupAi.joined.find(role=>role.number===AI_DRAGON_NUMBER);
    await api(a,groupPath+'/ai-card',{expectedAccount:'photo_alice',number:AI_DRAGON_NUMBER,
      expectedRevision:active.roleRevision,card:nextCard});
    releaseCard.resolve();
    const stale=await delayed;
    assert.equal(stale.reply,undefined);
    assert.equal(stale.message.aiReply,'failed');
    const current=(await api(a,route+'/vision')).roles.find(role=>role.number===AI_DRAGON_NUMBER);
    const fresh=await api(a,route+'/vision',{expectedAccount:'photo_alice',number:current.number,
      provider:current.provider,revision:current.revision,clientId:'vision-card-after-edit',text:'软木盒：换卡后看这一张'});
    assert.equal(fresh.reply.sender.number,AI_DRAGON_NUMBER);
    const newer=requests.at(-1);
    assert.equal(JSON.parse(newer.context[0]).publicGroupCharacter.name,nextCard.name);
    assert.deepEqual(JSON.parse(newer.context[1]).publicGroupLorebook,['本群独立书命中 龙娘']);
    assert.equal(newer.digest,hashes.blue);
    assert.deepEqual(publicRequests,[]);
    await b.screenshot({path:path.join(output,'群看图收到短回复.png')});
    const proof={hashes,requests,directPhoto:directPhoto.id,groupPhotoIds:[first.id,second.id],
      groupReply:[reply.id,reply.sender.number],repeatReplyId:retried.reply.id,configured,
      changedCard:{staleStatus:stale.message.aiReply,lateReply:stale.reply??null,newCard:newer.context.map(JSON.parse)},
      deniedBeforeAuthorGrant:true,deniedAfterRevocation:true,removedImageDenied:true,outsiderDenied:true,
      unsupportedRoleZeroRequests:true,removedWhileInFlight:{reply:null,status:removed.message.aiReply,error:removed.visionError},
      phoneJpeg:{originalDownloadUnchanged:true,gpsAndCommentRemoved:true,decodedPixelsEqual:true,
        decodedWithOrientation:[decoded[1].width,decoded[1].height],withoutOrientation:[decoded[2].width,decoded[2].height]},
      note:'真实客户端、SQLite、图片与三家正式适配器产生的 HTTP 请求。模型回复来自本机替身，未验证真实视觉识别。'};
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(proof,null,2)+'\n');
    console.log(JSON.stringify(proof,null,2));
  }finally{
    release.resolve();releaseCard.resolve();
    await browser?.close();
    if(server)await stop(server);
    await stop(upstream);
    store.db.close();
    globalThis.fetch=originalFetch;
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
