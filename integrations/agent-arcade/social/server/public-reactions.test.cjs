'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {once}=require('node:events');
const {test}=require('node:test');
const {SocialStore,AI_NUMBER,AI_DRAGON_NUMBER}=require('./store.cjs');
const {createServer}=require('./http.cjs');
const {createAzureVoice}=require('./ai-voice-azure.cjs');
const {makeBackup}=require('../deploy/backup.cjs');

test('public reactions use only local captures for privacy, ambiguity and withdrawal controls',{timeout:15000},async t=>{
  const root=await fs.realpath(os.tmpdir());
  const dir=await fs.mkdtemp(path.join(root,'arcade-reaction-offline-'));
  const store=new SocialStore(path.join(dir,'social.sqlite'));
  const loopback=globalThis.fetch;
  const png=await fs.readFile(path.join(__dirname,'../assets/stickers/whale-happy.png'));
  const wav=Buffer.alloc(6444);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4);
  wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(16000,24); wav.writeUInt32LE(32000,28);
  wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34);
  wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
  const sources=[],models=[],speech=[];
  let speechSeconds=31;
  const voiceEngine=createAzureVoice('fixture','synthetic-only',{fetchImpl:async(url,request)=>{
    assert.equal(url,'https://fixture.tts.speech.microsoft.com/cognitiveservices/v1');
    assert.equal(request.redirect,'error');
    const match=/<voice name="([^"]+)">([^<]*)<\/voice>/u.exec(request.body);
    assert(match);
    speech.push({voice:match[1],text:match[2]});
    const pcm=Buffer.alloc(speechSeconds*32000);
    pcm.writeInt16LE(440,0);
    return new Response(pcm,{headers:{'Content-Type':'application/octet-stream'}});
  }});
  let sourceState='ambiguous';
  let held, server;
  // The production source adapter always reaches this replacement. It cannot
  // call the saved fetch. Only the test's HTTP clients use the saved fetch.
  t.mock.method(globalThis,'fetch',async (url,request)=>{
    const address=new URL(url);
    if(sourceState==='matched'&&url==='https://upload.wikimedia.org/wikipedia/commons/qa/cat.png'){
      sources.push('cat original');
      return new Response(png,{headers:{'Content-Type':'image/png'}});
    }
    assert.equal(address.origin,'https://commons.wikimedia.org');
    assert.equal(address.pathname,'/w/api.php');
    assert.equal(request.body,undefined);
    assert.deepEqual(Object.keys(request.headers),['User-Agent']);
    const query=address.searchParams.get('gsrsearch');
    sources.push(query);
    if(sourceState==='matched')return Response.json({query:{pages:[{ns:6,pageid:121,imagerepository:'local',index:1,
      title:'File:Cat peeking.png',imageinfo:[{mime:'image/png',size:png.length,width:256,height:256,
        url:'https://upload.wikimedia.org/wikipedia/commons/qa/cat.png',extmetadata:{
          LicenseShortName:{value:'CC BY 2.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by/2.0/'},
          Artist:{value:'Synthetic fixture'},Restrictions:{value:''},ImageDescription:{value:'Cat peeking.'},
        }}]}]}});
    if(sourceState==='unavailable')return new Response(null,{status:503});
    if(held){held.started.resolve();await held.release.promise;request.signal.throwIfAborted();}
    const badTitles=['Rabbit beside peeking squirrel.jpg','Rabbit watches a peeking squirrel.jpg','Rabbit and squirrel peeking.jpg'];
    return Response.json({query:{pages:badTitles.map((title,index)=>({ns:6,pageid:99+index,imagerepository:'local',index,
      title:'File:'+title,imageinfo:[{mime:'image/jpeg',size:128,width:500,height:500,
        url:'https://upload.wikimedia.org/wikipedia/commons/qa/never-download.jpg',extmetadata:{
          LicenseShortName:{value:'CC BY 2.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by/2.0/'},
          Artist:{value:'Synthetic fixture'},Restrictions:{value:''},ImageDescription:{value:'The rabbit is peeking.'},
        }}]}))}});
  });
  let modelText='固定的本机替身文字。';
  const provider={name:'鲸鱼娘',provider:'deepseek',groupRoles:[{name:'鲸鱼娘',number:AI_NUMBER}],
    async generate(rows,{replyHint}){models.push({input:rows.at(-1).content,hint:replyHint,rows});return modelText;}};
  t.after(async()=>{
    held?.release.resolve();
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    store.db.close();
    const resolved=await fs.realpath(dir);
    assert.equal(path.dirname(resolved),root);
    assert.match(path.basename(resolved),/^arcade-reaction-offline-[a-z0-9]{6}$/iu);
    await fs.rm(resolved,{recursive:true,force:true});
  });
  const dragon={name:'龙娘',provider:'openai',groupRoles:[{name:'龙娘',number:AI_DRAGON_NUMBER}],
    async generate(){assert.fail('An explicit public picture request should not call OpenAI');}};
  server=createServer(store,{aiProvider:provider,groupAiProviders:[provider,dragon],voiceEngine}).listen(0,'127.0.0.1');
  await once(server,'listening');
  const address='http://127.0.0.1:'+server.address().port+'/api/v1';
  function user(number){
    let cookie='';
    return {number,media(route,body,mime){
      return loopback(address+route,{method:body?'POST':'GET',headers:{Cookie:cookie,'X-Social-Account':number,
        ...(body&&{'Content-Type':mime,'X-Social-Client-Id':'mixed_'+mime.split('/')[1]})},body});
    },async api(route,body){
      const reply=await loopback(address+route,{method:body===undefined?'GET':'POST',
        headers:{Cookie:cookie,'Content-Type':'application/json'},...(body!==undefined&&{body:JSON.stringify(body)})});
      assert.equal(reply.status,200,route);
      if(reply.headers.has('Set-Cookie'))cookie=reply.headers.get('Set-Cookie').split(';')[0];
      return reply.json();
    }};
  }
  const [a,b]=['fixture_a','fixture_b'].map(user);
  for(const u of [a,b])await u.api('/register',{number:u.number,displayName:u.number,password:'synthetic test password'});
  const {conversation:{id:direct}}=await a.api('/ai-contacts/start',{number:AI_NUMBER,expectedAccount:a.number,allowCloud:true});
  const {request}=await a.api('/friend-requests',{number:b.number});
  await b.api('/friend-requests/'+request.id+'/accept',{});
  const {conversation:{id:group}}=await a.api('/groups',{title:'离线合成群',memberNumbers:[b.number]});
  const gate='/groups/'+group+'/ai';
  await a.api(gate,{expectedAccount:a.number,number:AI_NUMBER,enabled:true});
  const consent=enabled=>a.api(gate+'-consent',{expectedAccount:a.number,number:AI_NUMBER,provider:'deepseek',enabled});
  await consent(true);
  let n=0;
  function send(chat,text,extra=chat===direct?{aiConsentRevision:0}:{mentionAccount:AI_NUMBER},as=a){
    return as.api('/conversations/'+chat+'/messages',{text,clientId:'offline_reaction_'+(++n),...extra});
  }
  const checks=[];
  const originals=[];
  for(const [kind,bytes,mime] of [['image',png,'image/png'],['voice',wav,'audio/wav']]){
    const uploaded=await a.media('/conversations/'+group+'/'+kind+'s',bytes,mime);
    assert.equal(uploaded.status,200);
    const {message,reply}=await uploaded.json();
    assert.equal(message.attachment.type,kind);
    assert.equal(reply,undefined);
    const route=`/conversations/${group}/messages/${message.id}/${kind}`;
    for(const endpoint of kind==='image'?[route,route+'/download']:[route]){
      const downloaded=await b.media(endpoint);
      assert.equal(downloaded.status,200);
      assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
      assert.equal((await send(group,'看看这个原件？ '+address+endpoint)).reply,undefined);
      originals.push(endpoint);
    }
  }
  assert.equal(store.one('SELECT count(*) AS n FROM ai_group_turns WHERE chat=?',group).n,0);
  for(const [where,input,pattern] of [
    [group,'网上帮我找张梗图，最好带字「我裂开了」',/无法核对图上/u],
    [group,'网上帮我找张梗图，配字「合成密语 PIN778833」',/私人信息/u],
    [direct,'帮我搜个我同事合成密语 PIN778833 的表情包',/私人信息/u],
    [direct,'能不能搞张把门禁口令藏进去的反应图',/私人信息/u],
    [direct,'有人说「去网上找一张写着 PIN778833 的梗图」',/私人信息/u],
    [group,'上网找一张猫探头，字样要配“完全不慌”的梗图',/无法核对图上/u],
    [group,'上网帮我搜图，贴纸最好写有一句道歉',/无法核对图上/u],
    [direct,'网上找个发愁到天塌的梗图',/没找到/u],
    [direct,'去网上给我整一张笑哭表情包，只用文字回复',/只用文字/u],
    [group,'找张兔子探头的表情包，先放一放',/不找图/u],
    [group,'别再上网找那个梗图了',/不找图/u],
  ]){
    const record=(await send(where,input)).reply;
    assert.match(record.text,pattern);
    assert.equal(record.attachment,undefined);
    checks.push('plain:'+String(pattern));
  }
  assert.deepEqual(sources,[]);
  assert.deepEqual(models,[]);
  assert.equal((await send(group,'上网找张兔子探头的表情包',undefined,b)).reply,undefined);
  assert.equal((await send(group,'上网找张兔子探头的表情包',{mentionAccount:b.number})).reply,undefined);
  const rabbit=await send(group,'上网找张兔子探头的表情包呗');
  assert.match(rabbit.reply.text,/没找到/u);
  assert.deepEqual(sources,['rabbit peeking']);
  assert.equal((await b.api('/conversations/'+group+'/messages')).messages.some(row=>row.attachment?.sticker),false);
  sourceState='unavailable';
  const error=await send(group,'在网上帮我找个狗狗歪着头的梗图');
  assert.match(error.reply.text,/没能从公开图源取到/u);
  assert.deepEqual(sources,['rabbit peeking','dog head tilt']);
  sourceState='ambiguous';
  held={started:Promise.withResolvers(),release:Promise.withResolvers()};
  const inFlight=send(group,'上网帮我找张松鼠探头的表情包');
  await Promise.race([held.started.promise,inFlight.then(()=>assert.fail('Search did not reach the fixture'))]);
  await consent(false);
  held.release.resolve();
  assert.equal((await inFlight).reply,undefined);
  assert.deepEqual(sources,['rabbit peeking','dog head tilt','squirrel peeking']);
  assert.deepEqual(models,[]);

  await consent(true);
  modelText='[[public-reaction:squirrel-peeking]] 这也太有趣了。';
  const mixed=await send(group,'真有趣，刚见一只松鼠从树后探出脑袋。');
  assert.equal(mixed.reply.text,'这也太有趣了。');
  assert.equal(mixed.reply.attachment,undefined);
  assert.match(models.at(-1).hint,/\[\[public-reaction:squirrel-peeking\]\]/u);
  modelText='[[public-reaction:squirrel-peeking]] 还是用文字吧。';
  const unrelated=await send(group,'刚看完一场展览，还挺有意思。');
  assert.equal(unrelated.reply.text,'还是用文字吧。');
  assert.doesNotMatch(models.at(-1).hint,/\[\[public-reaction:squirrel-peeking\]\]/u);
  assert.deepEqual(sources,['rabbit peeking','dog head tilt','squirrel peeking']);
  await a.api(gate,{expectedAccount:a.number,number:AI_DRAGON_NUMBER,enabled:true});
  await a.api(gate+'-consent',{expectedAccount:a.number,number:AI_DRAGON_NUMBER,provider:'openai',enabled:true});
  sourceState='matched';
  const positive=await send(group,'帮我找张猫探头的表情包',{mentionAccount:AI_DRAGON_NUMBER});
  assert.equal(positive.reply.sender.number,AI_DRAGON_NUMBER);
  assert.equal(positive.reply.attachment.sticker.source.author,'Synthetic fixture');
  assert.deepEqual(sources.slice(3),['cat peeking','cat original']);
  const {conversation:{id:casualGroup}}=await a.api('/groups',{title:'合成普通接话群',memberNumbers:[b.number]});
  for(const number of [AI_NUMBER,AI_DRAGON_NUMBER]){
    await a.api('/groups/'+casualGroup+'/ai',{number,enabled:true,expectedAccount:a.number});
  }
  await a.api('/groups/'+casualGroup+'/ai-consent',{number:AI_NUMBER,provider:'deepseek',enabled:true,expectedAccount:a.number});
  const voicePath=chat=>'/conversations/'+chat+'/ai-voice';
  async function allowSpeech(chat){
    const saved=await a.api(voicePath(chat));
    const role=saved.roles.find(row=>row.number===AI_NUMBER);
    const chosen=await a.api(voicePath(chat),{number:AI_NUMBER,voice:'azure-xiaoxiao',revision:role.revision,expectedAccount:a.number});
    const choice=chosen.roles.find(row=>row.number===AI_NUMBER);
    const granted=await a.api(voicePath(chat),{action:'scope',number:AI_NUMBER,allowed:true,
      revision:choice.revision,scopeRevision:choice.scopeRevision,expectedAccount:a.number});
    assert(granted.roles.find(row=>row.number===AI_NUMBER).allowed);
  }
  await allowSpeech(casualGroup);
  modelText='刚才在聊公园里见到的动物。';
  const seed=await send(casualGroup,'我们刚才聊到公园里见到的动物。');
  assert.equal(seed.reply.sender.number,AI_NUMBER);
  modelText='[[public-reaction:cat-peeking]]';
  const automatic=await send(casualGroup,'那帮我一起乐一乐，猫刚从门边探出头。',{});
  assert.equal(automatic.message.mention,undefined);
  assert.equal(automatic.reply.sender.number,AI_NUMBER);
  assert.equal(automatic.reply.attachment.sticker.source.author,'Synthetic fixture');
  assert.deepEqual(sources.slice(3),['cat peeking','cat original','cat peeking','cat original']);
  modelText='这轮只用文字。';
  const written=await send(casualGroup,'那帮我接着聊猫从门边探出头的事，只用文字。',{});
  assert.equal(written.reply.text,'这轮只用文字。');
  assert.equal(written.reply.attachment,undefined);
  assert.doesNotMatch(models.at(-1).hint,/\[\[public-reaction:/u);
  assert.deepEqual(sources.slice(3),['cat peeking','cat original','cat peeking','cat original']);
  assert.deepEqual(speech,[]);

  const longDraft='先从正门进入，沿河边慢慢走。脚下很滑，记得穿防滑的鞋。'.repeat(4);
  modelText=longDraft;
  const spoken=await send(casualGroup,'请详细说明步道的安排');
  assert.equal(spoken.reply.attachment.durationMs,31000);
  assert.deepEqual(speech,[{voice:'zh-CN-XiaoxiaoNeural',text:longDraft}]);
  const spokenOriginal=`/conversations/${casualGroup}/messages/${spoken.reply.id}/voice`;
  const wavFromReceiver=await b.media(spokenOriginal);
  assert.equal(wavFromReceiver.status,200);
  const longWav=Buffer.from(await wavFromReceiver.arrayBuffer());
  assert.equal(longWav.length,44+31*32000);
  assert.deepEqual(longWav,Buffer.from(await (await a.media(spokenOriginal)).arrayBuffer()));
  assert.equal((await a.media('/conversations/'+casualGroup+'/voices',longWav,'audio/wav')).status,413);

  speechSeconds=120;
  const explicitInput='用语音回复：说明第一段步道';
  modelText='第一段从桥上往东走。';
  const explicit=await send(casualGroup,explicitInput);
  assert.equal(explicit.reply.attachment.durationMs,120000);
  assert.equal(speech.at(-1).text,modelText);
  speechSeconds=121;
  const tooLong=await send(casualGroup,'用语音回复：说明第二段步道');
  assert.equal(tooLong.reply.attachment,undefined);
  assert.match(tooLong.reply.text,/超过语音时长上限/u);

  const privateTag='PIN991317';
  const privateInput='网上帮我找张梗图，配字「合成密语 '+privateTag+'」';
  const noOutbound=[models.length,sources.length,speech.length];
  assert.match((await send(casualGroup,privateInput)).reply.text,/私人信息/u);
  assert.match((await send(casualGroup,'帮我用语音念「'+privateTag+'」')).reply.text,/私人信息/u);
  assert.equal((await send(casualGroup,'可以用语音念这个链接吗？ '+address+spokenOriginal)).reply,undefined);
  assert.equal((await send(casualGroup,'找张猫探头的表情包',{mentionAccount:b.number})).reply,undefined);
  assert.deepEqual([models.length,sources.length,speech.length],noOutbound);
  modelText=longDraft+privateTag;
  const echo=await send(casualGroup,'用语音回复：介绍湿地入口');
  assert.equal(echo.reply.attachment,undefined);
  assert.equal(speech.length,noOutbound[2]);
  modelText='湿地入口就在西边。';
  const followup='那帮我接着介绍湿地，只用文字。';
  assert.equal((await send(casualGroup,followup,{})).reply.text,modelText);
  assert.equal(models.at(-1).input,followup);
  assert.equal(speech.length,noOutbound[2]);
  assert(!JSON.stringify(models).includes(privateTag));
  assert(!JSON.stringify(sources).includes(privateTag));
  assert(!JSON.stringify(speech).includes(privateTag));
  assert(!JSON.stringify(models).includes(spokenOriginal));

  const restored=await makeBackup(path.join(dir,'social.sqlite'),path.join(dir,'restored'),{prepareRestore:true});
  const recovery=new SocialStore(restored);
  try{
    for(const table of ['sessions','ai_group_role_consents','ai_group_context_consents','ai_voice_scopes','ai_voice_preferences'])
      assert.equal(recovery.one('SELECT count(*) AS n FROM '+table).n,0,table);
    assert.equal(recovery.one('SELECT duration_ms AS durationMs FROM message_voices WHERE message=?',spoken.reply.id).durationMs,31000);
  }finally{recovery.db.close();}

  // Open the current data with the preceding runtime and exercise its own
  // consent handlers, which do not know about the newer voice scope tables.
  const oldRoot=process.env.SOCIAL_VOICE_ROLLBACK_CODE;
  if(oldRoot){
    const oldStore=new (require(path.join(oldRoot,'social/server/store.cjs')).SocialStore)(path.join(dir,'social.sqlite'));
    try{
      const {createAiGroup}=require(path.join(oldRoot,'social/server/ai-group.cjs'));
      const {createAiDirect}=require(path.join(oldRoot,'social/server/ai-direct.cjs'));
      const oldGroup=createAiGroup(oldStore,[provider]);
      await allowSpeech(direct);
      const oldDirect=createAiDirect(oldStore,provider);
      const {revision}=oldStore.directAiConsent(a.number,direct);
      oldDirect.setConsent(a.number,direct,{revision,expectedAccount:a.number,allowCloud:false});
      oldGroup.setSharing(a.number,casualGroup,{number:AI_NUMBER,provider:'deepseek',enabled:false,expectedAccount:a.number});
      assert.equal(store.one('SELECT count(*) AS n FROM ai_voice_scopes').n,0);
      assert.equal(store.one('SELECT duration_ms AS durationMs FROM message_voices WHERE message=?',spoken.reply.id).durationMs,31000);
    }finally{oldStore.db.close();}
  }
  const publicOriginal=`/conversations/${group}/messages/${positive.reply.id}/image`;
  const publicImage=await b.media(publicOriginal);
  assert.equal(publicImage.status,200);
  assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()),png);
  await b.api('/groups/'+group+'/leave',{});
  for(const endpoint of [...originals,publicOriginal])assert.equal((await b.media(endpoint)).status,404);
  t.diagnostic(JSON.stringify({offlineCases:checks.length,ambiguousCandidatesSkipped:3,subjectActionQueries:sources,
    privateInputModelCalls:0,privateInputSourceCalls:0,mixedTokensDoNotSearch:true,realNetworkCalls:0,withdrawalBlocked:true,
    mixedGroupOriginals:originals.length,attachmentTurns:0,removedMemberAccess:404,matchedImageRole:positive.reply.sender.number,
    automaticMixedGroupRole:automatic.reply.sender.number,wordsOnlyLookups:0,
    spokenMs:spoken.reply.attachment.durationMs,aiCeilingMs:explicit.reply.attachment.durationMs,human31Seconds:413,
    rejectedPromptAndEchoExternalCalls:0,oldServiceRevocationVerified:!!oldRoot,restoreClearedVoiceScopes:true}));
});
