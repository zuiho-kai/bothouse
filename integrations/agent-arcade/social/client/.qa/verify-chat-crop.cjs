'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {once}=require('node:events'), {PNG}=require('pngjs'),{chromium,expect}=require('playwright/test');
const root=path.resolve(__dirname,'../../..'), files=path.join(root,'social/windows/chat-capture');
const {SocialStore}=require(path.join(root,'social/server/store.cjs')),{createServer}=require(path.join(root,'social/server/http.cjs'));
const out=process.argv[2]?path.resolve(process.argv[2]):fs.mkdtempSync(path.join(os.tmpdir(),'friends-crop-proof-'));
fs.mkdirSync(out,{recursive:true});
const store=new SocialStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'crop-')),'test.sqlite'));
const server=createServer(store,{}).listen(0,'127.0.0.1');
let browser,origin;
const report={kind:'headless Edge; synthetic source stream and IPC; real picker crop, chat, storage, recipient',cases:{}};
async function api(ctx,route,data) {
 const reply=await ctx.request.fetch(origin+'/api/v1'+route,data?{method:'POST',data}:{});
 assert.equal(reply.status(),200,route);return reply.headers()['content-type']==='image/png'?reply.body():reply.json();
}
async function main(){
 await once(server,'listening');origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking']});
 const sender=await browser.newContext(),other=await browser.newContext();
 const password='Synthetic-Offline-177';
 for(const [ctx,i] of [[sender,1],[other,2]]) await api(ctx,'/register',{number:'crop_test_'+i,password,displayName:'合成'+i});
 const {request}=await api(sender,'/friend-requests',{number:'crop_test_2'});
 const {conversation:direct}=await api(other,'/friend-requests/'+request.id+'/accept',{});
 const {conversation:group}=await api(sender,'/groups',{title:'群对照',memberNumbers:['crop_test_2']});
 let finish;
 await sender.exposeFunction('desktopIPC',async(channel)=>{
   if(channel==='arcade:startChatSnip')return false;
   if(channel==='arcade:pickChatCrop')return await new Promise(r=>finish=r);
   if(channel==='arcade:cancelChatCrop'){report.sawCancel=true;}
 });
 await sender.addInitScript({content:"{const process={isMainFrame:true,argv:['--arcade-chat-crop']};const require=()=>({ipcRenderer:{invoke:async ch=>{const b=await desktopIPC(ch);return Array.isArray(b)?new Uint8Array(b):b;},send:desktopIPC}});"+fs.readFileSync(path.join(root,'social/windows/privacy-preload.cjs'),'utf8')+"}"});
 const p=await sender.newPage();await p.goto(origin+'/#chat/'+direct.id);
 const fallback=async()=>{await p.locator('#chat-screenshot').click();await p.getByRole('button',{name:'应用内截图'}).click();await expect.poll(()=>typeof finish).toBe('function');};
 const messages=async id=>(await api(other,'/conversations/'+id+'/messages')).messages;
 await fallback();
 const local=await browser.newContext();
 let cropBytes,trackStops=0;
 await local.exposeFunction('cropAccepted',bytes=>{cropBytes=Buffer.from(bytes);});
 await local.exposeFunction('trackStopped',()=>{trackStops++;});
 await local.addInitScript({content:`{
 const require=()=>({ipcRenderer:{invoke:async()=>[{name:'Synthetic 160x100',screen:false}],send:(ch,b)=>{if(ch==='crop:accept')cropAccepted([...b]);}}});
 navigator.mediaDevices.getDisplayMedia=async options=>{
  if(options.video!==true||options.audio!==false)throw Error('unexpected options');
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=100;
  const ctx=canvas.getContext('2d');function draw(){ctx.fillStyle='rgb(17,34,51)';ctx.fillRect(0,0,160,100);
   ctx.fillStyle='rgb(210,180,90)';ctx.fillRect(50,0,110,100);}
  draw();const stream=canvas.captureStream(30);const timer=setInterval(draw,25);
  stream.getTracks()[0].addEventListener('ended',()=>clearInterval(timer));
  const stop=MediaStreamTrack.prototype.stop;stream.getTracks()[0].stop=function(){clearInterval(timer);stop.call(this);trackStopped();};return stream;
 };
 ${fs.readFileSync(path.join(files,'capture.cjs'),'utf8')}
 }`});
 const q=await local.newPage();await q.goto(require('node:url').pathToFileURL(path.join(files,'picker.html')).href);
 await q.locator('#target').selectOption('1');await q.locator('#take').click();await expect(q.locator('#frame')).toBeVisible();
 const rect=await q.locator('#frame').boundingBox();const pt=(x,y)=>[rect.x+x*rect.width/160,rect.y+y*rect.height/100];
 await q.mouse.move(...pt(89,66));await q.mouse.down();await q.mouse.move(...pt(21,12),{steps:7});await q.mouse.up();
 await expect(q.locator('#status')).toContainText('68 × 54');await q.screenshot({path:path.join(out,'01-选区.png')});
 await q.locator('#use').click();await expect.poll(()=>!!cropBytes).toBe(true);assert.equal(trackStops,1);
 const decode=PNG.sync.read(cropBytes);assert.equal(decode.width,68);assert.equal(decode.height,54);
 // Video conversion may round a channel. Confirm known source colours, then
 // compare every PNG channel exactly with the actual frozen frame's rectangle.
 const frame=await q.locator('#frame').evaluate(c=>[...c.getContext('2d').getImageData(21,12,68,54).data]);
 assert.deepEqual([...decode.data],frame);
 for(const [x,expected] of [[2,[17,34,51,255]],[63,[210,180,90,255]]]){
   assert(expected.every((v,k)=>Math.abs(frame[x*4+k]-v)<=3),'synthetic source colour');
 }
 finish([...cropBytes]);finish=null;
 await expect(p.locator('#dialog img')).toBeVisible();assert.equal((await messages(direct.id)).length,0);
 await p.keyboard.press('Escape');await expect(p.locator('#dialog')).toBeHidden();assert.equal((await messages(direct.id)).length,0);
 report.cases.cancelPreview=0;
 await fallback();await p.evaluate(id=>location.hash='#chat/'+id,group.id);await expect(p.locator('#chat-title')).toHaveText('群对照');
 await expect.poll(()=>report.sawCancel).toBe(true);finish([...cropBytes]);finish=null;
 assert.equal((await messages(group.id)).length,0);
 await p.goto(origin+'/#chat/'+direct.id);await fallback();finish([...cropBytes]);
 await expect(p.locator('#dialog img')).toBeVisible();await p.screenshot({path:path.join(out,'02-发送前.png')});
 await p.getByRole('button',{name:'发送截图',exact:true}).click();await expect(p.locator('#dialog')).toBeHidden();
 const got=await messages(direct.id);assert.equal(got.length,1);
 const png=await api(other,'/conversations/'+direct.id+'/messages/'+got[0].id+'/image');assert.deepEqual(png,cropBytes);
 fs.writeFileSync(path.join(out,'received.png'),png);
 report.cases={...report.cases,crop:'68x54',pixelMatches:3672,trackStops,recipientMessages:1,otherRoomMessages:(await messages(group.id)).length};
 report.passed=true;
}
main().catch(e=>{report.error=e.stack;console.error(e);process.exitCode=1;}).finally(async()=>{
 await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));store.db.close();
 fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(report,null,2));console.log(out,report.passed);
});
