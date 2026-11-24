'use strict';
// Headless DOM check. The two Electron IPC boundaries are replaced locally.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const {PNG}=require('pngjs');
const {previewGroupCard,selectGroupCard}=require('../../src/core/store-group-card-picker.cjs');

async function main(){
  const out=path.resolve(process.argv[2]);
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:760,height:840},locale:'zh-CN'});
  const groupId='12345678-1111-2222-3333-123456789abc',roleId='arcade_whale',id='aaaaaaaaaaaaaaaa';
  const target={groupId,roleId,account:'demo_owner',groupTitle:'老街茶馆',roleName:'鲸鱼娘'};
  const detail=previewGroupCard({get:()=>({name:'禾川',description:'我在老街开修钟表的铺子。',exampleDialogue:'我给你泡杯茶。',
    creatorNotes:'LOCAL-ONLY',characterBook:{entries:[{enabled:true,keys:['茶'],content:'给客人泡焙茶，用有小缺口的白瓷杯。'},
      {enabled:true,keys:['街口'],content:'街口有一棵梧桐树。'}]}})},id);
  const localCalls=[],guestCalls=[];
  let result,approvedPortrait;
  const portrait=new PNG({width:32,height:24});
  for(let i=0;i<portrait.data.length;i+=4)portrait.data.set([32+(i/4)%128,85,180,255],i);
  const png=PNG.sync.write(portrait).toString('base64');
  const bridge=async input=>{
    localCalls.push(input.action);
    if(input.action==='list')return {target,cards:[{id,name:'禾川'}]};
    if(input.action==='preview')return {...detail,portrait:png};
    if(input.action==='accept'){result=selectGroupCard(detail,input.indexes);approvedPortrait=input.sharePortrait;return true;}
    return null;
  };
  const server=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(
    '<!doctype html><button data-arcade-group-card-picker data-group-id="'+groupId+'" data-role-id="'+roleId+'">选择本机角色卡</button>');});
  try{
    await page.exposeBinding('reviewMock',(_caller,input)=>bridge(input));
    await page.addInitScript(()=>{
      window.cardReview={list:()=>reviewMock({action:'list'}),preview:id=>reviewMock({action:'preview',id}),
        accept:(id,indexes,sharePortrait)=>reviewMock({action:'accept',id,indexes,sharePortrait}),cancel:()=>reviewMock({action:'cancel'})};
    });
    await page.goto(pathToFileURL(path.resolve(__dirname,'../../src/ui/store-group-card.html')).href);
    await page.locator('#card').selectOption(id);
    await page.getByLabel(/提到 茶/).check();
    const consent=page.getByLabel('允许用这张卡面画本群这个角色');
    assert.equal(await consent.isChecked(),false);
    await page.waitForFunction(()=>document.querySelector('#portrait-image').naturalWidth===32);
    await consent.check();
    assert.equal(await page.locator('#accept').innerText(),'批准卡面并保存到本群');
    assert.equal(await page.locator('#entries input:checked').count(),1);
    assert.doesNotMatch(await page.locator('body').innerText(),/LOCAL-ONLY/);
    fs.mkdirSync(out,{recursive:true});
    await page.screenshot({path:path.join(out,'本机角色卡预览.png'),fullPage:true});
    await page.locator('#accept').click();
    await page.waitForFunction(()=>document.querySelector('#accept').disabled);
    assert.equal(result.entries.length,1);
    assert.equal(approvedPortrait,true);
    const guest=await browser.newPage();
    await guest.exposeBinding('guestMock',(_caller,channel,input)=>{
      assert.equal(channel,'arcade:pickGroupCard');
      guestCalls.push(input);
      return result;
    });
    const preload=fs.readFileSync(path.join(__dirname,'privacy-preload.cjs'),'utf8');
    await guest.addInitScript({content:'{const process={isMainFrame:true}; const require=()=>({ipcRenderer:{invoke:window.guestMock}});\n'+preload+'\n}'});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    await guest.goto('http://127.0.0.1:'+server.address().port+'/#chat/'+groupId);
    assert.equal(await guest.locator('html').getAttribute('data-arcade-group-card-picker'),'available');
    await guest.evaluate(()=>{
      const button=document.querySelector('button');
      button.addEventListener('arcade-group-card-picked',event=>document.title=event.detail);
      button.click();
    });
    assert.equal(guestCalls.length,0);
    await guest.getByRole('button').click();
    await guest.waitForFunction(()=>document.title.includes('焙茶'));
    assert.deepEqual(JSON.parse(await guest.title()),{groupId,roleId,card:result});
    assert.deepEqual(guestCalls.map(({groupId,roleId})=>({groupId,roleId})),[{groupId,roleId}]);
    const receipt={localCalls,guestCalls,reviewed:result,uncheckedRows:1,untrustedClicksOpened:0,approvedPortrait,
      scope:'Production local selector and remote preload, headless Chromium, local synthetic IPC, no Electron window or cloud'};
    fs.writeFileSync(path.join(out,'picker-headless.json'),JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify(receipt));
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    await browser.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
