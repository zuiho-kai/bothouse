'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {pathToFileURL}=require('node:url');
const {createSocialView}=require('./social-view.cjs');
const {createGroupCardPicker,previewGroupCard,selectGroupCard}=require('../../src/core/store-group-card-picker.cjs');

const chat='12345678-1111-2222-3333-123456789abc',id='aaaaaaaaaaaaaaaa',role='arcade_whale';
const source={name:'禾川',description:'修钟表',exampleDialogue:'我在老街。',creatorNotes:'PRIVATE',systemPrompt:'PRIVATE',
  characterBook:{entries:[{enabled:true,keys:['茶'],content:'焙茶'},
    {enabled:true,keys:['街'],content:'梧桐树'},{enabled:true,selective:true,keys:['测试'],secondaryKeys:['慎用'],content:'SPECIAL'},
    {enabled:true,constant:true,keys:[],content:'@@dont_activate\nSPECIAL'},
    {enabled:true,keys:['问好'],scanDepth:0,content:'SPECIAL'}]}};
const library={list:()=>[{id,name:'禾川',creator:'PRIVATE'}],get:chosen=>chosen===id?source:null};

test('only the reviewed public snapshot and explicitly checked simple book content cross the boundary',()=>{
  const preview=previewGroupCard(library,id);
  assert.equal(preview.omitted,3);
  assert.deepEqual(selectGroupCard(preview,[0]),{name:'禾川',description:'修钟表',examples:'我在老街。',entries:[{keys:['茶'],content:'焙茶'}]});
  assert.deepEqual(selectGroupCard(preview,[]).entries,[]);
  assert.throws(()=>selectGroupCard(preview,[0,0]));
  assert.throws(()=>selectGroupCard(preview,[3]));
  assert.doesNotMatch(JSON.stringify(preview),/PRIVATE|SPECIAL/);
});

class Contents extends EventEmitter{
  handlers=new Map();
  destroyed=false;
  mainFrame={url:''};
  ipc={handle:(name,fn)=>this.handlers.set(name,fn)};
  isDestroyed(){return this.destroyed;}
  close(){this.destroyed=true;this.emit('destroyed');}
  setWindowOpenHandler(){}
  loadFile(page){this.mainFrame.url=pathToFileURL(page).href;return Promise.resolve();}
  focus(){}
  call(channel,input,senderFrame=this.mainFrame){
    return this.handlers.get(channel)({sender:this,senderFrame},input);
  }
}
test('review, cancellation and stale local cards are handled in a separate same-window view',async()=>{
  let view,chosen,latest=source;
  const window=Object.assign(new EventEmitter(),{isDestroyed:()=>false,getContentSize:()=>[801,700],
    contentView:{addChildView:child=>view=child,removeChildView:child=>assert.equal(child,view)}});
  class View{webContents=new Contents();setBounds(bounds){assert.equal(bounds.width,801);}}
  const open=createGroupCardPicker({window,WebContentsView:View,library:{...library,get:()=>latest}});
  const start=()=>{const control=new AbortController();chosen=open({groupId:chat,roleId:role},control.signal);return control;};
  const call=(input,frame)=>view.webContents.call('arcade:reviewGroupCard',input,frame);
  start();
  assert.equal(await call({action:'list'},{}),null);
  assert.deepEqual((await call({action:'list'})).cards,[{id,name:'禾川'}]);
  await call({action:'preview',id});
  latest={...source,description:'已改'};
  assert.equal(await call({action:'accept',id,indexes:[]}),false);
  await call({action:'preview',id});
  assert.equal(await call({action:'accept',id,indexes:[1]}),true);
  assert.deepEqual(await chosen,{name:'禾川',description:'已改',examples:'我在老街。',entries:[{keys:['街'],content:'梧桐树'}]});
  assert.ok(view.webContents.isDestroyed());
  start().abort();assert.equal(await chosen,null);
});

test('only an active owner viewing this joined AI can open and receive the reviewed projection',async()=>{
  const origin='https://social.arcade-example.com';
  let owner='user_one',sessionUser='user_one',active=true,joined=true,beforeReturn,opened=0;
  const session=Object.assign(new EventEmitter(),{webRequest:{onBeforeRequest(){}},setPermissionCheckHandler(){},setPermissionRequestHandler(){},
    async fetch(raw,options){
      assert.equal(options.redirect,'error');
      const route=raw.slice(origin.length);
      const data=route==='/api/v1/me'?{user:{number:sessionUser}}:{conversation:{id:chat,type:'group',title:'试用群',ownerNumber:owner,
        members:joined?[{number:role,displayName:'鲸鱼娘',kind:'ai'}]:[]}};
      return {ok:true,json:async()=>data};
    }});
  class Guest{webContents=new Contents();}
  const {view}=createSocialView({WebContentsView:Guest,session:{fromPartition:()=>session},configuration:{mode:'store',origin},
    isActive:()=>active,pickGroupCard:async target=>{
      assert.equal(target.groupTitle,'试用群');
      opened++;
      beforeReturn?.();
      return selectGroupCard(previewGroupCard(library,id),[0]);
    }});
  const contents=view.webContents;
  contents.mainFrame.url=origin+'/#chat/'+chat;
  const call=(input,frame)=>contents.call('arcade:pickGroupCard',input??{groupId:chat,roleId:role},frame);
  assert.equal(await call(undefined,{}),null);
  assert.equal(await call({groupId:chat.slice(1),roleId:role}),null);
  owner='user_two';assert.equal(await call(),null);
  owner=sessionUser;joined=false;assert.equal(await call(),null);
  joined=true;active=false;assert.equal(await call(),null);
  active=true;
  assert.equal(opened,0);
  assert.deepEqual(await call(),selectGroupCard(previewGroupCard(library,id),[0]));
  beforeReturn=()=>{sessionUser='user_two';};assert.equal(await call(),null);
  sessionUser=owner;beforeReturn=()=>{joined=false;};assert.equal(await call(),null);
  joined=true;beforeReturn=()=>{contents.emit('did-start-navigation',{},origin+'/',true,true);};assert.equal(await call(),null);
  assert.equal(opened,4);
});

test('personal projection reviews are bound to the current owner, exact role and revision',async()=>{
  const origin='https://social.arcade-example.com', ai='ai_0123456789abcdef0123';
  let owner='user_one',profileRevision=null,afterOpen,opened=0;
  const browser=Object.assign(new EventEmitter(),{webRequest:{onBeforeRequest(){}},
    setPermissionCheckHandler(){},setPermissionRequestHandler(){},
    async fetch(url){
      if(url===origin+'/api/v1/me')return Response.json({user:{number:'user_one'}});
      assert.equal(url,origin+'/api/v1/personal-ai/profile');
      return Response.json({profile:{number:ai,owner,displayName:'雁汀',profileRevision}});
    }});
  class Guest{webContents=new Contents();}
  const {view}=createSocialView({WebContentsView:Guest,session:{fromPartition:()=>browser},
    configuration:{mode:'store',origin},isActive:()=>true,pickGroupCard:async target=>{
      assert.equal(target.roleName,'雁汀');assert.equal(target.maySharePortrait,false);
      opened++;afterOpen?.();
      return selectGroupCard(previewGroupCard(library,id),[0]);
    }});
  const contents=view.webContents;
  contents.mainFrame.url=origin+'/';
  const select=(overrides={})=>contents.call('arcade:pickGroupCard',{scope:'personal',groupId:'',roleId:ai,roleRevision:'',...overrides});
  assert.equal(await select({roleId:'ai_00000000000000000000'}),null);
  assert.equal(await select({groupId:chat}),null);
  owner='user_two';assert.equal(await select(),null);
  owner='user_one';assert.equal((await select()).name,'禾川');
  afterOpen=()=>{profileRevision='9080b4af-2e03-42d4-9abf-4de42432fc92';};
  assert.equal(await select(),null);
  assert.equal(await select(),null);
  assert.equal(opened,2);
});
