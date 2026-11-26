'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const cardName='合成角色栖潮';
const approvedLine='潮簧用蓝铜片校到七分。';
const privateMarker='SYNTHETIC_AUTHOR_ONLY_MARKER';
const unselectedMarker='SYNTHETIC_UNSELECTED_BOOK_MARKER';

function createCardFixture({scratch,payload}){
  const {CharacterLibrary}=require(path.join(payload,'src/bot/character-library.cjs'));
  const {parseCardFile}=require(path.join(payload,'src/bot/character-cards.cjs'));
  const card={spec:'chara_card_v2',spec_version:'2.0',data:{name:cardName,description:'我在合成观测站检查潮簧。',
    personality:'表达清楚。',scenario:'合成观测练习。',first_mes:'你好。',mes_example:'<START>\n{{user}}: 你好。\n{{char}}: 你好。',
    creator_notes:privateMarker,system_prompt:privateMarker,character_book:{name:'合成书',scan_depth:3,entries:[
      {id:1,keys:['潮簧'],content:approvedLine,enabled:true,insertion_order:1},
      {id:2,keys:['潮簧'],content:unselectedMarker,enabled:true,insertion_order:2},
    ]}}};
  const library=new CharacterLibrary({root:path.join(scratch,'card-owner','library','characters')});
  const {card:parsed}=parseCardFile(Buffer.from(JSON.stringify(card)),{fileName:'synthetic-group-card.json'});
  library.add({card:parsed});
  const mock=path.join(scratch,'card-provider.cjs'), wire=path.join(scratch,'card-provider.json');
  fs.writeFileSync(mock,`'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.deepseek.com/chat/completions');
  const data=JSON.parse(options.body), serialized=JSON.stringify(data);
  assert(!serialized.includes(${JSON.stringify(privateMarker)}));
  assert(!serialized.includes(${JSON.stringify(unselectedMarker)}));
  assert(serialized.includes(${JSON.stringify(approvedLine)}));
  assert.equal(data.tool_choice,'none');
  fs.writeFileSync(${JSON.stringify(wire)},JSON.stringify({approvedEntry:true,privateFields:false,unselectedEntry:false,tools:false}));
  return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:${JSON.stringify(approvedLine)}}}]});
};
`);
  return {mock,wire};
}

async function verifyPackagedCard({owner,peer,origin,guest,until,button,register,wire}){
  const a='tls_card_owner', b='tls_card_peer';
  await register(owner,a,'合成群主');
  await register(peer,b,'合成群友');
  const api=(client,route,body)=>guest(client,`(async()=>{
    const response=await fetch('/api/v1'+${JSON.stringify(route)},{method:${JSON.stringify(body?'POST':'GET')},
      headers:{'Content-Type':'application/json'},body:${JSON.stringify(body?JSON.stringify(body):undefined)}});
    if(!response.ok)throw Error('Fixture API '+response.status+' '+await response.text());
    return response.json();
  })()`);
  const {request}=await api(owner,'/friend-requests',{number:b});
  await api(peer,'/friend-requests/'+request.id+'/accept',{});
  const {conversation:{id}}=await api(owner,'/groups',{title:'合成群角色卡验收',memberNumbers:[b]});
  const group='/groups/'+id, role='arcade_whale';
  await api(owner,group+'/ai',{expectedAccount:a,number:role,enabled:true});
  await api(peer,group+'/ai-consent',{expectedAccount:b,number:role,provider:'deepseek',enabled:true});
  for(const client of [owner,peer])await guest(client,`location.hash=${JSON.stringify('#chat/'+id)}`);
  const click=(client,name)=>guest(client,button(name)+'.click()');
  const present=(client,name)=>guest(client,'!!'+button(name));
  const dialog=fragment=>guest(owner,`document.querySelector('#dialog-body')?.textContent.includes(${JSON.stringify(fragment)})`);
  await until(()=>present(owner,'群成员'),'owner group settings');
  await click(owner,'群成员');
  await click(owner,'群内 AI');
  await until(()=>present(owner,'本群角色卡'),'group role card control');
  await click(owner,'本群角色卡');
  await until(()=>present(owner,'从本机角色库选择'),'packaged card picker route');
  assert.deepEqual(await guest(owner,'[typeof window.arcade,typeof window.cardReview,typeof require]'),['undefined','undefined','undefined']);
  // Exercise the real, trusted click handler through Chromium's input system.
  await owner.app.evaluate(async ({BrowserWindow},site)=>{
    const window=BrowserWindow.getAllWindows()[0];
    if(window.isVisible()||BrowserWindow.getAllWindows().length!==1)throw Error('Preview window must remain hidden');
    const contents=window.contentView.children.find(view=>view.webContents?.getURL().startsWith(site+'/')).webContents;
    contents.debugger.attach('1.3');
    try{
      await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
      const point=await contents.executeJavaScript(`(()=>{
        const target=document.querySelector('button[data-arcade-group-card-picker]');target.scrollIntoView({block:'center'});
        const {left,top,width,height}=target.getBoundingClientRect();return {x:left+width/2,y:top+height/2};
      })()`);
      for(const type of ['mousePressed','mouseReleased'])
        await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
    }finally{contents.debugger.detach();}
  },origin.origin);
  const local=script=>owner.app.evaluate(({BrowserWindow},source)=>{
    const [window]=BrowserWindow.getAllWindows();
    if(window.isVisible()||BrowserWindow.getAllWindows().length!==1)throw Error('Picker must be in the same hidden window');
    const view=window.contentView.children.find(child=>child.webContents?.getURL().endsWith('/store-group-card.html'));
    return view?.webContents.executeJavaScript(source);
  },script);
  await until(()=>local(`!!document.querySelector('#card option[value]:not([value=""])')`),'local review populates the isolated library');
  await local(`(()=>{const select=document.querySelector('#card');select.selectedIndex=1;
    select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(()=>local(`document.querySelector('#name').textContent===${JSON.stringify(cardName)}`),'real picker reviews the synthetic card');
  await local(`document.querySelector('#entries input[type=checkbox]').click()`);
  await local(`document.querySelector('#accept').click()`);
  await until(()=>dialog('待保存：'+cardName),'approved selection returns to the group settings');
  assert.equal(fs.existsSync(wire),false);
  await click(owner,'保存到本群');
  await until(()=>dialog('当前：'+cardName),'selected card saved for the single role');
  const {reply}=await api(peer,'/conversations/'+id+'/messages',{clientId:'packaged_card_followup',text:'请用文字说明潮簧怎么校准',mentionAccount:role});
  assert.equal(reply.sender.number,role);
  assert.equal(reply.text,approvedLine);
  await until(()=>guest(owner,`document.querySelector('#history').textContent.includes(${JSON.stringify(approvedLine)})`),'the other client sees the reviewed reply');
  return {passed:true,realPackagedProfile:true,hiddenWindows:true,approvedCard:cardName,cancelledOrUnexpectedModelCalls:0,
    originalRole:role,otherMemberReadback:true,wire:JSON.parse(fs.readFileSync(wire,'utf8'))};
}

module.exports={createCardFixture,verifyPackagedCard};
