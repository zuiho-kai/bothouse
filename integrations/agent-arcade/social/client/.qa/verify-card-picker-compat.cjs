'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {EventEmitter,once}=require('node:events');
const {chromium}=require('playwright');

const [output,desktopRoot,version,mode,serverRoot]=process.argv.slice(2);
assert(output&&desktopRoot&&version&&mode,'Usage: output desktop-root version baseline|legacy|group-only|current|reverse [server-root]');
const load=(root,name)=>require(path.resolve(root,name));
const source=serverRoot||path.join(__dirname,'../../..');
const {SocialStore,AI_NUMBER}=load(source,'social/server/store.cjs');
const {createServer}=load(source,'social/server/http.cjs');
const {createSocialView}=load(desktopRoot,'social/windows/social-view.cjs');
const btn=(root,name)=>root.getByRole('button',{name,exact:true});

async function run(){
  await fs.mkdir(output,{recursive:true});
  const preload=await fs.readFile(path.join(desktopRoot,'social/windows/privacy-preload.cjs'),'utf8');
  const store=new SocialStore(':memory:');
  const server=createServer(store,{aiProvider:{provider:'deepseek',groupRoles:[{number:AI_NUMBER,name:'鲸鱼娘'}],
    generate(){throw Error('Unexpected model call');}},personalAiFetch(){throw Error('Unexpected model call');}});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const calls=[],reviews=[],errors=[];
  let browser;
  try{
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking']});
    const context=await browser.newContext({viewport:{width:390,height:820},serviceWorkers:'block'});
    await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
    const account='picker_owner',card={name:'合成角色',description:'可公开的钟楼守夜人',examples:'',entries:[]};
    const book={name:'合成世界书',entries:[{keys:['钟塔'],content:'在钟塔见。'}]};
    const api=async(route,data,expected=200)=>{
      const res=data===undefined?await context.request.get(base+'/api/v1'+route):
        await context.request.post(base+'/api/v1'+route,{data});
      assert.equal(res.status(),expected,route+' '+await res.text());
      return res.json();
    };
    await api('/register',{number:account,displayName:'合成主人',password:'fixture-password-only'});
    const handlers=new Map();
    let args;
    class View{
      constructor({webPreferences}){
        args=webPreferences.additionalArguments||[];
        this.webContents=Object.assign(new EventEmitter(),{
          mainFrame:{},isDestroyed:()=>false,setWindowOpenHandler(){},
          ipc:{handle:(key,callback)=>handlers.set(key,callback)},
        });
      }
    }
    const session=Object.assign(new EventEmitter(),{webRequest:{onBeforeRequest(){}},
      setPermissionCheckHandler(){},setPermissionRequestHandler(){},
      async fetch(url,options){
        const res=await context.request.fetch(url,{
          method:options.method,headers:options.headers,data:options.body,
        });
        return {ok:res.ok(),json:()=>res.json(),body:{cancel:async()=>{}}};
      },
    });
    const {view:{webContents}}=createSocialView({
      WebContentsView:View,session:{fromPartition:()=>session},isActive:()=>true,
      configuration:{origin:base,mode:'test',desktopVersion:version},
      async pickGroupCard(target){
        reviews.push({groupId:target.groupId,roleId:target.roleId,direct:!!target.direct,kind:target.kind??'card'});
        return target.kind==='lorebook'?book:card;
      },
    });
    await context.exposeBinding('fixtureInvoke',({frame},channel,input)=>{
      calls.push(input);
      webContents.mainFrame.url=frame.url();
      return handlers.get(channel)({sender:webContents,senderFrame:webContents.mainFrame},input);
    });
    await context.addInitScript({content:'((require,process)=>{'+preload+
      '\n})(()=>({ipcRenderer:{invoke:(...args)=>window.fixtureInvoke(...args)}}),'+JSON.stringify({isMainFrame:true,argv:args})+');'});
    const page=await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror',e=>errors.push(e.message));
    const friend='picker_friend', peer=await browser.newContext();
    assert.equal((await peer.request.post(base+'/api/v1/register',{
      data:{number:friend,displayName:'合成好友',password:'fixture-password-only'},
    })).status(),200);
    const {request}=await api('/friend-requests',{number:friend});
    assert.equal((await peer.request.post(base+'/api/v1/friend-requests/'+request.id+'/accept',{data:{}})).status(),200);
    await peer.close();
    const group=(await api('/groups',{title:'原有的群',memberNumbers:[friend]})).conversation.id;
    await api('/groups/'+group+'/ai',{number:AI_NUMBER,expectedAccount:account,enabled:true});

    if(mode!=='reverse'){
      const role=(await api('/personal-ai',{expectedAccount:account,role:'arcade_dragon',name:'纸灯',
        action:'bind',revision:null,key:'fake-personal-api'})).identity;
      const own=(await api('/friend-requests',{expectedAccount:account,number:role.number})).conversation;
      await api('/ai-contacts/start',{expectedAccount:account,number:role.number,provider:'openai',allowCloud:true,personalContext:true});
      const privateRoute='/personal-ai/private-profile';
      const {profile}=await api(privateRoute,{expectedAccount:account,number:role.number,expectedRevision:null,card});
      await api(privateRoute,{expectedAccount:account,number:role.number,expectedRevision:profile.profileRevision,lorebook:book});
      await page.goto(base+'/#chat/'+own.id);
      await btn(page,'会话设置').click();
      await btn(page,'私聊角色设定').click();
      await page.getByText(card.description,{exact:true}).waitFor();
      const picker=btn(page,'从本机角色库选择'),chooseBook=btn(page,'替换私聊世界书');
      if(mode==='baseline'){
        await picker.click();
        await chooseBook.click();
        assert.equal(calls.length,0);
        assert.equal(reviews.length,0);
        await page.screenshot({path:path.join(output,'legacy-dead-controls.png')});
      }else if(mode==='legacy'||mode==='group-only'){
        assert.equal(await picker.count(),0);
        assert.equal(await chooseBook.count(),0);
        await page.getByText(/设置.*应用更新/).waitFor();
        await page.screenshot({path:path.join(output,'legacy-available-actions.png')});
        await btn(page,'撤回私聊世界书').click();
        await btn(page,'确认撤回').click();
        await page.getByText('当前：未使用单独的世界书',{exact:true}).waitFor();
        await btn(page,'撤回私聊角色卡').click();
        await btn(page,'确认撤回').click();
        await page.getByText('当前：使用本人设置的名字',{exact:true}).waitFor();
        assert.equal((await api(privateRoute)).profile.card,null);
        assert.equal((await api(privateRoute)).profile.lorebook,null);
      }else{
        await picker.click();
        await page.getByText('待保存：'+card.name,{exact:true}).waitFor();
        await btn(page,'取消更改').click();
        await chooseBook.click();
        await page.getByText('待保存：'+book.name,{exact:true}).waitFor();
        assert(reviews.some(review=>review.direct&&review.kind==='card'&&review.roleId===role.number));
        assert(reviews.some(review=>review.direct&&review.kind==='lorebook'&&review.roleId===role.number));
        await page.screenshot({path:path.join(output,'current-private-book.png')});
      }
      if(mode!=='baseline'){
        await page.goto(base);
        await page.getByRole('button',{name:/通讯录/}).click();
        await btn(page,'AI 联系人').click();await btn(page,'我的 AI').click();
        await btn(page,'角色设定').click();await btn(page,'群聊角色设定').click();
        await page.getByText('群内名字 · 纸灯',{exact:true}).waitFor();
        if(mode==='legacy'){
          assert.equal(await btn(page,'从本机角色库选择').count(),0);
          assert.equal(await btn(page,'从本机世界书库选择').count(),0);
          await page.getByText(/设置.*应用更新/).waitFor();
        }else{
          await btn(page,'从本机角色库选择').click();
          await page.getByText('待保存：'+card.name,{exact:true}).waitFor();
          await btn(page,'取消更改').click();
          await btn(page,'从本机世界书库选择').click();
          await page.getByText('待保存：'+book.name,{exact:true}).waitFor();
          assert(reviews.some(review=>!review.direct&&!review.groupId&&review.kind==='card'));
          assert(reviews.some(review=>!review.direct&&!review.groupId&&review.kind==='lorebook'));
        }
      }
    }
    if(await page.locator('#dialog[open]').count())await btn(page,'关闭').click();
    await page.goto(base+'/#chat/'+group);
    await btn(page,'群成员').click();
    await btn(page,'群内 AI').click();
    await page.getByRole('button',{name:/选.*角色卡|本群角色卡/}).click();
    await btn(page,'从本机角色库选择').click();
    await page.getByText('待保存：'+card.name,{exact:true}).waitFor();
    await btn(page,'保存到本群').click();
    await page.getByText('已保存。下一次在本群回复时生效。',{exact:true}).waitFor();
    assert(reviews.some(review=>review.groupId===group&&review.kind==='card'&&review.roleId===AI_NUMBER));
    await btn(page,'从本机世界书库选择').click();
    await page.getByText('待保存：'+book.name,{exact:true}).waitFor();
    assert(reviews.some(review=>review.groupId===group&&review.kind==='lorebook'));
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify({
      ok:true,mode,version,preloadSha256:createHash('sha256').update(preload).digest('hex'),calls,reviews,errors,
    },null,2)+'\n');
  }finally{
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
