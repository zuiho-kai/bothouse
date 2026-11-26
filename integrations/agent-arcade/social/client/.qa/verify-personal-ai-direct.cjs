'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {EventEmitter,once}=require('node:events');
const {randomUUID}=require('node:crypto');
const {chromium}=require('playwright');
const {SocialStore}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {createSocialView}=require('../../windows/social-view.cjs');

const output=process.argv[2];
assert(output,'Provide an isolated evidence directory.');
const store=new SocialStore(':memory:'), wire=[], external=[], errors=[];
const delays=new Map(['换卡时正在回答','需要停止的私聊'].map(text=>[text,{
  entered:Promise.withResolvers(),released:Promise.withResolvers(),
}]));
const cardA={name:'初版档案',description:'我在银湾替潮汐守灯。',examples:'',entries:[{keys:['堤坝'],content:'堤坝内侧有风铃。'}]};
const cardB={name:'同名卡',description:'我是纸岛寄信人。',examples:'',entries:[]};
const changedA={name:'换用档案',description:'我在北屿维护星台。',examples:'',entries:[]};
const book={name:'灯塔笔记',entries:[{keys:['蓝门'],content:'蓝门靠琥珀灯识别。'},{keys:['红门'],content:'红门靠铜铃识别。'}]};
const server=createServer(store,{personalAiFetch:async (url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');
  const owner={'Bearer fixture-owner-a':'a','Bearer fixture-owner-b':'b'}[options.headers.Authorization];
  assert(owner);
  const {input,instructions,tools}=JSON.parse(options.body);
  const [{content:identity},...history]=input;
  const {privateAiIdentity:profile}=JSON.parse(identity);
  assert.equal(profile.name,'同名信使');
  assert.deepEqual(tools,[]);
  assert.match(instructions,/privateAiIdentity/u);
  assert.doesNotMatch(JSON.stringify(input),/群公开卡对照|旧授权范围文字/u);
  const text=history.at(-1).content;
  wire.push({owner,text,profile,history});
  const held=delays.get(text);
  if(held){held.entered.resolve(options.signal);await held.released.promise;}
  let answer='收到 '+text;
  if(text==='你平时怎么认出蓝门？')answer=profile.lorebook?.[0]??'没有已批准的指引';
  if(text==='所以我应该记住什么？')answer='请记住：'+(history.at(-2)?.content??'前文缺失');
  return Response.json({status:'completed',output:[{type:'message',role:'assistant',
    content:[{type:'output_text',text:'同名信使：'+answer}]}]});
}});
const btn=(root,name)=>root.getByRole('button',{name,exact:true});
async function run(){
  await fs.mkdir(output,{recursive:true});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  let browser;
  const preload=await fs.readFile(path.join(__dirname,'../../windows/privacy-preload.cjs'),'utf8');
  const result={ok:false};
  try{
    browser=await chromium.launch({channel:'msedge',headless:true,
      args:['--disable-background-networking','--disable-sync','--proxy-server=http://127.0.0.1:1']});
    async function account(id,width,locale='zh-CN'){
      const context=await browser.newContext({viewport:{width,height:820},locale,serviceWorkers:'block'});
      await context.route('**/*',route=>{
        if(route.request().url().startsWith(base+'/'))return route.continue();
        external.push(new URL(route.request().url()).origin);return route.abort();
      });
      let selection;
      const ipc=new Map();
      class View {
        constructor(){
          this.webContents=Object.assign(new EventEmitter(),{mainFrame:{},isDestroyed:()=>false,
            ipc:{handle:(channel,callback)=>ipc.set(channel,callback)},setWindowOpenHandler(){}});
        }
      }
      const electronSession=Object.assign(new EventEmitter(),{
        webRequest:{onBeforeRequest(){}},setPermissionCheckHandler(){},setPermissionRequestHandler(){},
        async fetch(url,options){
          const pending=await context.request.get(url,{headers:options.headers});
          return {ok:pending.ok(),json:()=>pending.json()};
        },
      });
      const {view:{webContents}}=createSocialView({
        WebContentsView:View,session:{fromPartition:()=>electronSession},
        configuration:{origin:base,mode:'test'},isActive:()=>true,
        async pickGroupCard(target){
          assert(target.direct&&target.personal);
          assert.equal(target.maySharePortrait,selection.kind!=='lorebook');
          assert.equal(target.account,id);
          assert.equal(target.roleId,selection.role);
          assert.equal(target.kind,selection.kind);
          return selection.item;
        },
      });
      await context.exposeBinding('fixtureCardPick',({frame},channel,input)=>{
        webContents.mainFrame.url=frame.url();
        return ipc.get(channel)({sender:webContents,senderFrame:webContents.mainFrame},input);
      });
      await context.addInitScript({content:`((require,process)=>{${preload}
      })(()=>({ipcRenderer:{invoke:(...args)=>window.fixtureCardPick(...args)}}),{isMainFrame:true,argv:[]});`});
      const page=await context.newPage();page.setDefaultTimeout(10000);
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base);await btn(page,'创建账号').click();
      await page.locator('[name=number]').fill(id);await page.locator('[name=displayName]').fill(id);
      await page.locator('[name=password]').fill(randomUUID());
      await page.locator('#auth-submit').click();await page.locator('#workspace').waitFor();
      async function api(route,data,status=200){
        const response=data===undefined?await context.request.get(base+'/api/v1'+route):
          await context.request.post(base+'/api/v1'+route,{data});
        assert.equal(response.status(),status,route+' '+await response.text());
        return response.json();
      }
      return {id,page,api,setSelection:value=>{selection=value;}};
    }
    const a=await account('verify_personal_a',740),b=await account('verify_personal_b',360,'en-US'),c=await account('verify_personal_c',390);
    async function directory(actor){
      await actor.page.goto(base);await actor.page.getByRole('button',{name:/通讯录/}).click();
    }
    async function personal(actor){
      await directory(actor);
      await btn(actor.page,'AI 联系人').click();await btn(actor.page,'我的 AI').click();
    }
    async function bind(actor,key){
      const p=actor.page;await personal(actor);
      await p.getByLabel('AI 昵称').fill('同名信使');
      await p.getByLabel('角色与服务').selectOption('arcade_dragon');
      await p.getByLabel('本人的 API key').fill(key);await btn(p,'绑定我的 AI').click();
      await btn(p,'和自己的 AI 私聊').waitFor();
      return (await actor.api('/personal-ai')).identity;
    }
    const first=await bind(a,'fixture-owner-a'),second=await bind(b,'fixture-owner-b');
    assert.notEqual(first.number,second.number);
    await a.api('/personal-ai/profile',{expectedAccount:a.id,number:first.number,expectedRevision:null,
      card:{name:'群公开卡对照',description:'群公开卡对照',examples:'',entries:[]}});
    async function waitPost(actor,suffix,click){
      const pending=actor.page.waitForResponse(response=>
        response.request().method()==='POST'&&response.url().endsWith('/api/v1'+suffix));
      await click();const response=await pending;
      assert.equal(response.status(),200,await response.text());
      return response.json();
    }
    const ownA=(await waitPost(a,'/friend-requests',()=>btn(a.page,'和自己的 AI 私聊').click())).conversation;
    const ownB=(await waitPost(b,'/friend-requests',()=>btn(b.page,'和自己的 AI 私聊').click())).conversation;
    assert(ownA.requiresAiCloudConsent&&ownB.requiresAiCloudConsent);
    assert.equal(wire.length,0);
    async function lookup(actor,id){
      await directory(actor);await btn(actor.page,'添加朋友').click();
      await actor.page.getByLabel('对方的用户号').fill(id);await btn(actor.page,'查找').click();
      const result=actor.page.locator('.search-result');
      await result.locator('p').getByText(id,{exact:true}).waitFor();return result;
    }
    const privateResult=await lookup(c,first.number);
    await privateResult.getByText('私人 AI · 仅主人可添加好友。',{exact:true}).waitFor();
    assert.equal(await btn(privateResult,'添加 AI 好友').count(),0);
    await c.page.screenshot({path:path.join(output,'private-search.png')});
    await c.api('/friend-requests',{expectedAccount:c.id,number:first.number},403);
    async function policy(actor,visible,guest){
      const p=actor.page;await personal(actor);
      await btn(p,'好友权限').click();
      const publish=p.getByLabel(/允许其他人按编号添加/), cost=p.getByLabel(/可能产生我的云用量/);
      await publish.setChecked(visible);
      if(visible)await cost.setChecked(guest);
      await btn(p,'保存好友权限').click();await p.getByText('好友权限已保存。',{exact:true}).waitFor();
    }
    await policy(a,true,false);
    await a.page.screenshot({path:path.join(output,'owner-friend-policy.png')});
    const search=await lookup(c,first.number);
    const guest=(await waitPost(c,'/friend-requests',()=>btn(search,'添加 AI 好友').click())).conversation;
    assert.equal(guest.personalCloudAllowed,false);
    assert.equal(wire.length,0);
    await c.page.getByText('主人尚未授权好友使用云私聊',{exact:true}).waitFor();
    await c.page.screenshot({path:path.join(output,'guest-cloud-blocked.png')});
    assert.equal((await c.api('/friend-requests',{expectedAccount:c.id,number:first.number})).conversation.id,guest.id);
    await c.api('/ai-contacts/start',{expectedAccount:c.id,number:first.number,allowCloud:true,provider:'openai'},403);
    await c.api('/conversations/'+guest.id+'/messages',{text:'不应提交',clientId:randomUUID()},409);
    assert.equal(wire.length,0);
    const other=await lookup(c,second.number);
    await other.getByText('私人 AI · 仅主人可添加好友。',{exact:true}).waitFor();
    assert.equal(await btn(other,'添加 AI 好友').count(),0);

    const human=await lookup(c,b.id);
    await waitPost(c,'/friend-requests',()=>btn(human,'发送好友请求').click());
    assert((await c.api('/friend-requests')).outgoing.some(row=>row.to.number===b.id));
    assert((await b.api('/friend-requests')).incoming.some(row=>row.from.number===c.id));
    assert(!(await c.api('/conversations')).conversations.some(x=>x.members.some(m=>m.number===b.id)));
    assert.equal(wire.length,0);

    async function profileDialog(actor){
      await personal(actor);
      await btn(actor.page,'角色设定').click();
      await actor.page.getByText('群聊与私聊各自选择角色卡和世界书。',{exact:true}).waitFor();
      await btn(actor.page,'群聊角色设定').waitFor();
      await btn(actor.page,'私聊角色设定').click();
      await actor.page.getByText('私聊名字 · 同名信使',{exact:true}).waitFor();
    }
    async function choose(actor,role,item,kind){
      const p=actor.page;
      await profileDialog(actor);
      actor.setSelection({role,item,kind});
      await btn(p,kind==='lorebook'?'从本机世界书库选择':'从本机角色库选择').click();
      await p.getByText('待保存：'+item.name,{exact:true}).waitFor();
      if(item===cardA)await p.screenshot({path:path.join(output,'private-card-preview.png')});
      const {profile}=await waitPost(actor,'/personal-ai/private-profile',()=>btn(p,'保存到私聊').click());
      assert.deepEqual(kind==='lorebook'?profile.lorebook:profile.card,item);
    }
    await choose(a,first.number,cardA);
    await choose(a,first.number,book,'lorebook');
    await choose(b,second.number,cardB);
    await c.api('/personal-ai/private-profile',{expectedAccount:c.id,number:first.number,expectedRevision:null,card:null},409);
    assert.equal((await c.api('/personal-ai/private-profile')).profile,null);
    assert.equal((await a.api('/personal-ai/profile')).profile.card.name,'群公开卡对照');
    assert.equal(wire.length,0);

    async function open(actor,id){await actor.page.goto(base+'/#chat/'+id);await actor.page.reload();}
    async function consent(actor,id,resume=false){
      await open(actor,id);
      await btn(actor.page,resume?'恢复云聊天':'开启云聊天').click();
      await actor.page.getByText(/近期对话.*主人批准/).waitFor();
      if(actor===c&&!resume)await actor.page.screenshot({path:path.join(output,'private-context-consent.png')});
      const {conversation}=await waitPost(actor,resume?'/conversations/'+id+'/ai-consent':'/ai-contacts/start',
        ()=>btn(actor.page,resume?'同意并恢复':'同意并开始私聊').click());
      assert.equal(conversation.id,id);assert(conversation.cloudChat.enabled);
      return conversation;
    }
    async function sayUi(actor,id,text){
      await actor.page.locator('#message').fill(text);
      return waitPost(actor,'/conversations/'+id+'/messages',()=>btn(actor.page,'发送').click());
    }
    async function directSettings(actor,id,description,other){
      await open(actor,id);
      assert.equal((await actor.api('/conversations/'+id)).conversation.personalAiOwner,true);
      const p=actor.page;
      const draft='暂存的草稿 · '+actor.id;
      await p.locator('#message').fill(draft);
      await btn(p,'会话设置').click();
      await btn(p,'私聊角色设定').click();
      await p.getByText(description,{exact:true}).waitFor();
      assert.equal(await p.getByText(other,{exact:true}).count(),0);
      const bounds=await p.locator('#dialog').boundingBox(),width=p.viewportSize().width;
      assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
      await p.screenshot({path:path.join(output,'owner-direct-'+width+'.png')});
      await p.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
      assert.equal(await p.locator('#message').inputValue(),draft);
      assert.equal(new URL(p.url()).hash,'#chat/'+id);
    }
    await consent(a,ownA.id);
    await directSettings(a,ownA.id,cardA.description,cardB.description);
    const r1=await sayUi(a,ownA.id,'只发给我的角色甲，堤坝在哪里？');
    assert.equal(r1.reply.sender.number,first.number);
    assert.deepEqual(wire.at(-1).profile.background,['堤坝内侧有风铃。']);
    const old=store.transaction(()=>{
      store.run('INSERT INTO ai_direct_grants VALUES(?,?,?)',ownB.id,b.id,second.number);
      return store.send(b.id,ownB.id,{clientId:randomUUID(),text:'旧授权范围文字'});
    });
    await b.api('/conversations/'+ownB.id+'/ai-consent',{expectedAccount:b.id,allowCloud:true,provider:'openai',revision:0},409);
    await b.api('/conversations/'+ownB.id+'/messages',{text:'未重新同意',clientId:randomUUID(),aiConsentRevision:0},409);
    assert.equal(wire.length,1);
    await consent(b,ownB.id,true);
    await directSettings(b,ownB.id,cardB.description,cardA.description);
    const r2=await sayUi(b,ownB.id,'只发给我的角色乙');
    assert.equal(r2.reply.sender.number,second.number);
    assert.equal(wire.at(-1).profile.description,cardB.description);
    assert.equal(wire.at(-1).history.length,1);
    assert((await b.api('/conversations/'+ownB.id+'/messages')).messages.some(row=>row.id===old.id));
    await policy(a,true,true);
    await c.api('/ai-contacts/start',{expectedAccount:c.id,number:first.number,allowCloud:true,provider:'deepseek',personalContext:true},409);
    const allowed=await consent(c,guest.id);
    assert.equal(allowed.personalAiOwner,false);
    await btn(c.page,'会话设置').click();
    assert.equal(await btn(c.page,'私聊角色设定').count(),0);
    await btn(c.page,'关闭云聊天').waitFor();
    await c.page.keyboard.press('Escape');
    const r3=await sayUi(c,guest.id,'你平时怎么认出蓝门？');
    assert.equal(r3.reply.sender.number,first.number);
    assert.equal(r3.reply.text,'蓝门靠琥珀灯识别。');
    assert.deepEqual(wire.at(-1).profile.lorebook,[book.entries[0].content]);
    assert.equal(wire.at(-1).profile.description,cardA.description);
    assert.equal(wire.at(-1).history.length,1);
    const r4=await sayUi(c,guest.id,'所以我应该记住什么？');
    assert.equal(r4.reply.text,'请记住：蓝门靠琥珀灯识别。');
    assert.deepEqual(wire.at(-1).history,[
      {role:'user',content:r3.message.text},{role:'assistant',content:r3.reply.text},{role:'user',content:r4.message.text},
    ]);
    assert.equal(wire.at(-1).profile.lorebook,undefined);
    await c.page.locator('#history').getByText(r4.reply.text,{exact:true}).waitFor();
    await c.page.screenshot({path:path.join(output,'guest-private-followup.png')});
    const same=await c.api('/conversations/'+guest.id+'/messages',{
      text:r3.message.text,clientId:r3.message.clientId,aiConsentRevision:allowed.cloudChat.revision});
    assert.equal(same.message.id,r3.message.id);
    assert.deepEqual(wire.map(x=>x.owner),['a','b','a','a']);

    async function whilePending(text,revision,action){
      const held=c.api('/conversations/'+guest.id+'/messages',{clientId:randomUUID(),text,aiConsentRevision:revision});
      const delay=delays.get(text);
      const signal=await Promise.race([delay.entered.promise,new Promise((_,reject)=>{
        setTimeout(()=>reject(Error('Expected provider request did not start: '+text)),6000).unref();
      })]);
      assert.equal(signal.aborted,false);
      await action();assert.equal(signal.reason?.name,'AbortError');delay.released.resolve();
      assert.equal((await held).reply,undefined);
    }
    await whilePending('换卡时正在回答',allowed.cloudChat.revision,()=>choose(a,first.number,changedA));
    await open(c,guest.id);
    const next=await sayUi(c,guest.id,'换卡后，还是你吗？');
    assert.equal(next.reply.sender.number,first.number);
    assert.equal(wire.at(-1).profile.description,changedA.description);
    assert.equal(wire.at(-1).history.length,1);
    assert.equal((await a.api('/personal-ai/profile')).profile.card.name,'群公开卡对照');

    await profileDialog(a);
    await btn(a.page,'撤回私聊世界书').click();
    await waitPost(a,'/personal-ai/private-profile',()=>btn(a.page,'确认撤回').click());
    await open(c,guest.id);
    const withoutBook=await sayUi(c,guest.id,'你平时怎么认出蓝门？');
    assert.equal(withoutBook.reply.text,'没有已批准的指引');
    assert.equal(wire.at(-1).history.length,1);

    const current=(await c.api('/conversations/'+guest.id)).conversation;
    await whilePending('需要停止的私聊',current.cloudChat.revision,()=>policy(a,false,false));
    await open(c,guest.id);
    await c.page.getByText('主人尚未授权好友使用云私聊',{exact:true}).waitFor();
    assert((await c.api('/conversations/'+guest.id+'/messages')).messages.some(row=>row.id===r3.reply.id));
    await c.api('/conversations/'+guest.id+'/ai-consent',{expectedAccount:c.id,allowCloud:true,
      provider:'openai',revision:current.cloudChat.revision+1,personalContext:true},403);
    await b.api('/friend-requests',{expectedAccount:b.id,number:first.number},403);
    await policy(a,true,true);
    const reopened=(await c.api('/conversations/'+guest.id)).conversation;
    assert.equal(reopened.personalCloudAllowed,true);assert.equal(reopened.cloudChat.enabled,false);
    await c.api('/ai-contacts/start',{expectedAccount:c.id,number:first.number,allowCloud:true,provider:'openai',personalContext:true},409);
    await c.api('/conversations/'+guest.id+'/messages',{clientId:randomUUID(),text:'恢复仍需本人确认',
      aiConsentRevision:reopened.cloudChat.revision},409);
    await consent(c,guest.id,true);
    const newTurn=await sayUi(c,guest.id,'重新同意后的新话题');
    assert.equal(newTurn.reply.sender.number,first.number);
    assert.equal(wire.at(-1).history.length,1);
    await profileDialog(a);
    await btn(a.page,'撤回私聊角色卡').click();
    await waitPost(a,'/personal-ai/private-profile',()=>btn(a.page,'确认撤回').click());
    await open(c,guest.id);
    await sayUi(c,guest.id,'撤卡以后你是谁？');
    assert.deepEqual(wire.at(-1).profile,{name:'同名信使'});
    assert.equal(wire.at(-1).history.length,1);
    await btn(c.page,'会话设置').click();
    await btn(c.page,'关闭云聊天').click();
    const {conversation:paused}=await waitPost(c,'/conversations/'+guest.id+'/ai-consent',
      ()=>btn(c.page,'确认关闭').click());
    assert.equal(paused.cloudChat.enabled,false);
    await consent(c,guest.id,true);
    await sayUi(c,guest.id,'我自己恢复后的新话题');
    assert.equal(wire.at(-1).history.length,1);
    assert((await c.api('/conversations/'+guest.id+'/messages')).messages.some(row=>row.id===r4.reply.id));
    assert(!wire.filter(call=>call.text!=='只发给我的角色甲，堤坝在哪里？')
      .some(call=>call.history.some(row=>row.content.includes('只发给我的角色甲'))));
    assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
    Object.assign(result,{ok:true,roleIds:[first.number,second.number],directs:[ownA.id,ownB.id,guest.id],
      friendCreationModelCalls:0,guestBeforeOwnerApprovalCalls:0,humanStillPending:true,
      friendRetryStable:true,messageRetryAddedCalls:0,revocationAborted:true,revokedReplyDelivered:false,
      reopeningRequiresNewGuestConsent:true,oldScopeRequiresNewConsent:true,realFollowup:true,
      profileChangeAborted:true,profileChangeResetContext:true,ownerProfileIsolated:true,bookMatchedAndWithdrawn:true,
      previousConsentRetainedInInboxOnly:true,participantRevocationResetContext:true,ownerOnlySettingsByStableRole:true,draftsPreserved:true,wire,external,errors});
  }catch(error){result.error=error.message;throw error;}
  finally{
    for(const delay of delays.values())delay.released.resolve();
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(result,null,2)+'\n');
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
