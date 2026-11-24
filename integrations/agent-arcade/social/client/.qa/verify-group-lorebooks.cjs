'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {EventEmitter,once}=require('node:events');
const {chromium,expect}=require('playwright/test');
const {PNG}=require('pngjs');

const [evidencePath,baselinePath]=process.argv.slice(2);
const out=path.resolve(evidencePath);
const root=path.resolve(__dirname,'../../..');
const baseline=baselinePath&&path.resolve(baselinePath);
const shell=baseline?path.join(baseline,'unpacked/Social/resources/app'):root;
const windows=baseline?shell:path.join(root,'social/windows');
const serverDir=path.join(baseline?path.join(baseline,'service'):root,'social/server');
const {SocialStore,AI_NUMBER}=require(path.join(serverDir,'store.cjs'));
const {createServer}=require(path.join(serverDir,'http.cjs'));
const {createDeepSeekProvider}=require(path.join(serverDir,'ai-deepseek.cjs'));
const {LorebookLibrary,importWorldInfoFile}=require(path.join(shell,'src/bot/st/lorebooks.cjs'));
const {createGroupCardPicker}=require(path.join(shell,'src/core/store-group-card-picker.cjs'));
const {createSocialView}=require(path.join(windows,'social-view.cjs'));

class Contents extends EventEmitter {
  handlers=new Map();
  destroyed=false;
  mainFrame={url:''};
  ipc={handle:(name,fn)=>this.handlers.set(name,fn)};
  setWindowOpenHandler(){}
  isDestroyed(){return this.destroyed;}
  close(){this.destroyed=true;this.emit('destroyed');}
  focus(){}
  loadFile(page){this.mainFrame.url=pathToFileURL(page).href;return Promise.resolve();}
  call(channel,input){return this.handlers.get(channel)({sender:this,senderFrame:this.mainFrame},input);}
}
class View {webContents=new Contents();setBounds(){}}

async function run(){
  fs.mkdirSync(out);
  const library=new LorebookLibrary({root:path.join(out,'lorebooks')});
  const facts=['磁针轻叩三下。','磁针向东四格。'];
  const names=['北崖航务簿','南湾风标册'];
  for(const [index,name] of names.entries()){
    const json={name,entries:[{id:1,keys:['雾针'],content:facts[index],enabled:true},
      {id:2,keys:['雾针'],content:'LOCAL_UNCHECKED_MARKER',enabled:true},
      {id:3,keys:['雾针'],content:'LOCAL_COMPLEX_MARKER',enabled:true,selective:true,secondary_keys:['珊瑚']}]};
    fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(json,null,2));
    library.batchImporter()({name,book:importWorldInfoFile(JSON.stringify(json)).book});
  }
  const requests=[],reads=[],approved=[],external=[];
  const store=new SocialStore(path.join(out,'synthetic.sqlite'));
  const provider=createDeepSeekProvider('local-fixture-only',{fetchImpl:async(url,options)=>{
    assert.equal(new URL(url).hostname,'api.deepseek.com');
    const payload=JSON.parse(options.body);
    assert.doesNotMatch(JSON.stringify(payload),/LOCAL_(?:UNCHECKED|COMPLEX)_MARKER|北崖航务簿|南湾风标册/u);
    const question=payload.messages.at(-1).content;
    if(question==='撤书以后还能说雾针吗？')assert(!facts.some(fact=>JSON.stringify(payload).includes(fact)));
    const json=prefix=>payload.messages.find(row=>row.content.startsWith('{"'+prefix+'"'))?.content;
    const card=json('publicGroupCharacter'),book=json('publicGroupLorebook');
    const parsed=book?JSON.parse(book).publicGroupLorebook:[];
    const embedded=card?JSON.parse(card).publicGroupCharacter.background:[];
    requests.push({question,card:card&&JSON.parse(card).publicGroupCharacter.name,book:parsed,embedded});
    const reply=parsed[0]||embedded[0]||'我先查一下。';
    return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:reply}}]});
  }});
  const server=createServer(store,{aiProvider:provider}).listen(0,'127.0.0.1');
  let browser;
  try{
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    async function actor(number){
      const context=await browser.newContext({viewport:{width:430,height:840},serviceWorkers:'block'});
      await context.route(/^https?:/u,route=>{
        if(route.request().url().startsWith(origin+'/'))return route.continue();
        external.push(route.request().url());return route.abort();
      });
      async function api(route,data,status=200){
        const result=await context.request.fetch(origin+'/api/v1'+route,{method:data===undefined?'GET':'POST',data});
        assert.equal(result.status(),status,route+' '+await result.text());
        return result.json();
      }
      await api('/register',{number,displayName:number,password:'local synthetic only'});
      return {number,context,api};
    }
    const owner=await actor('worldbook_owner'),peer=await actor('worldbook_peer');
    const invite=(await owner.api('/friend-requests',{number:peer.number})).request.id;
    await peer.api('/friend-requests/'+invite+'/accept',{});
    async function group(title){
      const {conversation:{id}}=await owner.api('/groups',{title,memberNumbers:[peer.number]});
      await owner.api('/groups/'+id+'/ai',{number:AI_NUMBER,expectedAccount:owner.number,enabled:true});
      await peer.api('/groups/'+id+'/ai-consent',{number:AI_NUMBER,expectedAccount:peer.number,provider:'deepseek',enabled:true});
      return id;
    }
    const groupA=await group('北崖主群'),groupB=await group('南湾邻群');
    await peer.api('/groups/'+groupA+'/ai-context',{number:AI_NUMBER,expectedAccount:peer.number,provider:'deepseek',enabled:true});
    async function state(id){return (await owner.api('/groups/'+id+'/ai')).groupAi.joined[0];}
    const card={name:'岑苇灯',description:'我在码头记录风向。',examples:'',entries:[{keys:['桅灯'],content:'桅灯挂在船尾。'}]};
    const target={expectedAccount:owner.number,number:AI_NUMBER,expectedRevision:(await state(groupA)).roleRevision};
    const image=new PNG({width:16,height:16});
    image.data.fill(220);
    const portrait=PNG.sync.write(image);
    await owner.api('/groups/'+groupA+'/ai-card',{...target,card,portrait:portrait.toString('base64')});

    let overlay;
    const window=Object.assign(new EventEmitter(),{isDestroyed:()=>false,getContentSize:()=>[800,760],
      contentView:{addChildView(view){overlay=view.webContents;},removeChildView(){overlay=undefined;}}});
    const pickGroupCard=createGroupCardPicker({window,WebContentsView:View,library:{},lorebookLibrary:library});
    const session=Object.assign(new EventEmitter(),{webRequest:{onBeforeRequest(){}},setPermissionCheckHandler(){},setPermissionRequestHandler(){},
      async fetch(url){
        const response=await owner.context.request.get(url);
        return {ok:response.ok(),json:()=>response.json()};
      }});
    const {view}=createSocialView({WebContentsView:View,session:{fromPartition:()=>session},configuration:{mode:'test',origin},
      isActive:()=>true,pickGroupCard});
    const host=view.webContents;
    await owner.context.exposeBinding('qaHostPick',(source,channel,input)=>{
      assert.equal(channel,'arcade:pickGroupCard');
      host.mainFrame.url=source.page.url();
      return host.call(channel,input);
    });
    const preload=fs.readFileSync(path.join(windows,'privacy-preload.cjs'),'utf8');
    await owner.context.addInitScript({content:'(function(require,process){'+preload+'})(()=>({ipcRenderer:{invoke:window.qaHostPick}}),{isMainFrame:true,argv:[]});'});
    const lead=await owner.context.newPage(),friend=await peer.context.newPage();
    const button=(page,name)=>page.getByRole('button',{name,exact:true});
    async function settings(id){
      await lead.goto(origin+'/#chat/'+id);
      await button(lead,'群成员').click();await button(lead,'群内 AI').click();await button(lead,'本群角色卡').click();
    }
    await settings(groupA);
    await expect(lead.locator('#dialog-body')).toContainText('桅灯挂在船尾。');
    if(baseline){
      await expect(button(lead,'从本机角色库选择')).toBeVisible();
      await expect(button(lead,'从本机世界书库选择')).toHaveCount(0);
      assert.equal(Object.hasOwn(await state(groupA),'lorebook'),false);
      await lead.screenshot({path:path.join(out,'1.0.13-本群角色卡.png')});
      return {baseline:true,localBooks:library.list().map(row=>row.name),groupStandaloneControl:false};
    }
    async function choose(label,index,{cancel=false}={}){
      await button(lead,label).click();
      for(let wait=0;wait<60&&!overlay;wait++)await new Promise(resolve=>setTimeout(resolve,50));
      assert(overlay,'Main process created the local review view');
      const local=overlay;
      const review=await browser.newPage({viewport:{width:610,height:760}});
      await review.exposeBinding('qaReview',(_source,input)=>local.call('arcade:reviewGroupCard',input));
      await review.addInitScript(()=>{window.cardReview={list:()=>qaReview({action:'list'}),preview:id=>qaReview({action:'preview',id}),
        accept:(id,indexes,sharePortrait)=>qaReview({action:'accept',id,indexes,sharePortrait}),cancel:()=>qaReview({action:'cancel'})};});
      await review.goto(local.mainFrame.url);
      await review.locator('#card').selectOption({label:names[index]});
      await expect(review.getByRole('heading',{name:'选择本机世界书'})).toBeVisible();
      await expect(review.locator('#entries')).not.toContainText('LOCAL_COMPLEX_MARKER');
      const apply=button(review,'将所选内容带到群设置');
      await expect(apply).toBeDisabled();
      await review.getByLabel(new RegExp(facts[index])).check();
      await expect(apply).toBeEnabled();
      if(!index&&!cancel&&!fs.existsSync(path.join(out,'本机预览与勾选.png'))){
        await review.screenshot({path:path.join(out,'本机预览与勾选.png')});
      }
      if(cancel)await button(review,'取消').click();else await apply.click();
      await expect.poll(()=>local.isDestroyed()).toBe(true);
      await review.close();
    }
    async function save(id,expected){
      const count=requests.length;
      await button(lead,'保存到本群').click();
      await expect(lead.getByRole('status').filter({hasText:'已保存。'})).toBeVisible();
      const value=await state(id);
      assert.deepEqual(value.lorebook,expected);
      assert.deepEqual(value.card,id===groupA?card:null);
      if(id===groupA){
        assert.equal(value.portraitApproved,true);
        const stored=store.one('SELECT revision,png FROM ai_group_card_portraits WHERE chat=? AND ai=?',id,AI_NUMBER);
        assert.equal(stored.revision,value.roleRevision);
        assert.deepEqual(Buffer.from(stored.png),portrait);
      }
      assert.equal(requests.length,count);
      approved.push({group:id,book:expected?.name??null,card:value.card?.name??null,revision:value.roleRevision});
      return value;
    }
    const book=index=>({name:names[index],entries:[{keys:['雾针'],content:facts[index]}]});
    async function ask(id,question,answer,expectedBook){
      if(friend.url()!==origin+'/#chat/'+id)await friend.goto(origin+'/#chat/'+id);
      const feed='/conversations/'+id+'/messages';
      const before=(await peer.api(feed)).messages.at(-1)?.id??0;
      await button(friend,'群成员').click();await button(friend,'@鲸鱼娘（AI）').click();
      await friend.locator('#message').fill(question);await button(friend,'发送').click();
      await expect(friend.locator('#history')).toContainText(answer);
      await expect.poll(()=>requests.at(-1)?.question).toBe(question);
      assert.deepEqual(requests.at(-1).book,expectedBook);
      assert.equal(requests.at(-1).card,id===groupA?card.name:undefined);
      let received;
      await expect.poll(async()=>{
        received=(await peer.api(feed)).messages.findLast(row=>row.id>before&&row.text===answer&&row.sender.number===AI_NUMBER);
        return !!received;
      }).toBe(true);
      reads.push({group:id,question,reply:received.id,answer,sender:AI_NUMBER});
    }
    await choose('从本机世界书库选择',0,{cancel:true});
    assert.equal((await state(groupA)).lorebook,null);
    await choose('从本机世界书库选择',0);
    await expect(lead.locator('#dialog-body')).toContainText('待保存：'+names[0]);
    assert.equal((await state(groupA)).lorebook,null);
    const first=await save(groupA,book(0));
    await ask(groupA,'雾针如何校准？',facts[0],[facts[0]]);
    await ask(groupA,'今天潮水如何？','我先查一下。',[]);
    await friend.screenshot({path:path.join(out,'群友收到世界书台词.png')});
    await choose('替换本群世界书',1);
    await save(groupA,book(1));
    await ask(groupA,'做记号时雾针看哪里？',facts[1],[facts[1]]);
    const edit={...target,expectedRevision:first.roleRevision,lorebook:null};
    await owner.api('/groups/'+groupA+'/ai-lorebook',edit,409);
    await peer.api('/groups/'+groupA+'/ai-lorebook',{...edit,expectedAccount:peer.number},403);
    await settings(groupB);
    await choose('从本机世界书库选择',0);await save(groupB,book(0));
    await ask(groupB,'邻群的雾针如何看？',facts[0],[facts[0]]);
    await settings(groupA);
    await button(lead,'撤销本群世界书').click();await save(groupA,null);
    await ask(groupA,'撤书以后还能说雾针吗？','我先查一下。',[]);
    await ask(groupA,'桅灯挂哪里？','桅灯挂在船尾。',[]);
    assert.deepEqual(requests.at(-1).embedded,['桅灯挂在船尾。']);
    assert.deepEqual((await state(groupB)).lorebook,book(0));
    await lead.screenshot({path:path.join(out,'撤书后随卡条目仍在.png')});
    assert.deepEqual(external,[]);
    return {groupA,groupB,approved,requests,reads,external,staleSaveRejected:true,nonOwnerRejected:true,
      cardPortraitStillApproved:true,previousReplyContextEnabled:true,revokedBookInLaterContext:false};
  }finally{
    if(browser)await browser.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}

run().then(result=>fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(result,null,2)+'\n'))
  .catch(error=>{console.error(error);process.exitCode=1;});
