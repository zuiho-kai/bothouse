'use strict';

const {reportMessage}=require('./chat-controls.cjs');

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {PNG}=require('pngjs');
const {chromium,expect}=require('playwright/test');
const {SocialStore,AI_NUMBER}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const baseline=process.argv[3]==='baseline';
const baselineDir=process.argv[3]&&!baseline?path.resolve(process.argv[3]):null;
const cross=process.argv.includes('--keyboard-upload');
const output=path.resolve(process.argv[2]);
const password='synthetic-media-report';
const personA='media_sender',personB='media_reporter';
const button=(where,name)=>where.getByRole('button',{name,exact:true});

function png(width,height,shade){
  const image=new PNG({width,height});
  for(let i=0;i<image.data.length;i+=4)image.data.set([shade,(shade+i/4)%256,45,255],i);
  return PNG.sync.write(image);
}
function wav(){
  const samples=8000,bytes=Buffer.alloc(44+samples*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);
  bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
  bytes.write('data',36);bytes.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)bytes.writeInt16LE(Math.round(3500*Math.sin(i*2*Math.PI*440/16000)),44+i*2);
  return bytes;
}
function cli(db,args,success=true){
  const run=spawnSync(process.execPath,[path.resolve(__dirname,'../../server/moderate.cjs'),...args],
    {env:{...process.env,SOCIAL_DB:db},encoding:'utf8',windowsHide:true,timeout:12000});
  if(run.error)throw run.error;
  if(success){assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout);}
  assert.notEqual(run.status,0,run.stdout);return run.stderr;
}

async function main(){
  await fs.mkdir(output);
  const db=path.join(output,'fixture.sqlite'),store=new SocialStore(db);
  const aiProvider={provider:'deepseek',groupRoles:[{number:AI_NUMBER,name:'鲸鱼娘'}],
    generate(){throw Error('No model expected');}};
  const server=createServer(store,{aiProvider}).listen(0,'127.0.0.1');
  const shared={},files={},decisions={};
  let browser;
  try{
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu','--mute-audio']});
    const external=[];
    async function actor(number){
      const context=await browser.newContext({viewport:{width:420,height:840},serviceWorkers:'block'});
      await context.route('**/*',route=>{
        if(route.request().url().startsWith(origin+'/'))return route.continue();
        external.push(route.request().url());return route.abort();
      });
      async function api(route,body,status=200,headers={}){
        const res=await context.request.fetch(origin+'/api/v1'+route,{method:body===undefined?'GET':'POST',data:body,headers});
        assert.equal(res.status(),status,route);return res.json();
      }
      await api('/register',{number,displayName:number===personA?'合成发送者':'合成举报者',password});
      return {number,api,context};
    }
    const a=await actor(personA),b=await actor(personB);
    const {request}=await a.api('/friend-requests',{number:personB});
    await b.api('/friend-requests/'+request.id+'/accept',{});
    const {conversation:{id}}=await a.api('/groups',{title:'合成审核群',memberNumbers:[personB]});
    const thread='/conversations/'+id;
    await a.api('/groups/'+id+'/ai',{expectedAccount:personA,number:AI_NUMBER,enabled:true});
    async function attachment(route,mime,bytes,nonce){
      return (await a.api(thread+'/'+route,bytes,200,{
        'Content-Type':mime,'X-Social-Account':personA,'X-Social-Client-Id':nonce,
      })).message;
    }
    const photo=png(32,24,39),ai=png(48,36,117),neighbor=png(28,20,195),voice=wav();
    let groupEntry;
    async function uploadFromChat(){
      const sender=await a.context.newPage();
      await sender.goto(origin+'/#chat/'+id);
      await sender.locator('#composer').waitFor({state:'visible'});
      await sender.evaluate(()=>window.dispatchEvent(new CustomEvent('arcade-social-send-shortcut',{detail:'ctrl-enter'})));
      const text='键盘发送后的合成图片';
      const editor=sender.locator('#message');
      await editor.fill(text);await editor.press('Enter');
      assert.equal(await editor.inputValue(),text+'\n');
      assert.equal((await b.api(thread+'/messages')).messages.length,0);
      const textSent=sender.waitForResponse(res=>res.url()===origin+'/api/v1'+thread+'/messages'&&res.request().method()==='POST');
      await editor.press('Control+Enter');
      const written=await (await textSent).json();
      assert.equal(written.message.text,text);
      const old=(await b.api(thread+'/messages')).messages;
      assert.deepEqual(old.map(row=>row.id),[written.message.id]);
      await sender.locator('#attach-image').click();
      await sender.locator('#dialog input[type=file]').setInputFiles({name:'合成照片.png',mimeType:'image/png',buffer:photo});
      const uploaded=sender.waitForResponse(res=>res.url()===origin+'/api/v1'+thread+'/images'&&res.request().method()==='POST');
      await button(sender.locator('#dialog'),'发送图片').click();
      const response=await uploaded;
      assert.equal(response.status(),200);
      const {message}=await response.json();
      groupEntry={keyboardMessage:written.message.id,uploadedImage:message.id,shortcut:'Control+Enter'};
      return message;
    }
    const media=[
      {key:'photo',bytes:photo,message:await (cross?uploadFromChat():attachment('images','image/png',photo,'photo_1234'))},
      {key:'voice',bytes:voice,message:await attachment('voices','audio/wav',voice,'voice_1234')},
      {key:'ai',bytes:ai,message:store.sendAiDrawing(AI_NUMBER,id,'drawing_1234',
        {mime:'image/png',bytes:ai,digest:sha(ai),width:48,height:36,title:'合成 AI 图'})},
      {key:'noteOnly',bytes:neighbor,message:await attachment('images','image/png',neighbor,'photo_5678')},
    ];
    const adjacent=(await a.api(thread+'/messages',{text:'邻近无关的正文哨兵',clientId:'neighbor_text'})).message;
    const page=await b.context.newPage();
    await page.goto(origin+'/#chat/'+id);
    await expect(page.locator('#history')).toContainText(adjacent.text);
    const dialog=page.locator('#dialog');
    async function report(item,include){
      const selector=item.key==='voice'?'data-voice-id':'data-image-id';
      const bubble=page.locator('.bubble').filter({has:page.locator('['+selector+'="'+item.message.id+'"]')});
      await reportMessage(page,bubble);
      const checkbox=dialog.getByRole('checkbox');
      if(baseline)await expect(checkbox).toHaveCount(0);
      else{
        await expect(checkbox).not.toBeChecked();
        await expect(dialog).toContainText('仅这条');
        if(include)await checkbox.check();
      }
      await page.locator('#report-reason').fill('隔离审核 '+item.key);
      if(include&&!baseline)await page.screenshot({path:path.join(output,item.key+'-举报前.png')});
      const route=origin+'/api/v1'+thread+'/messages/'+item.message.id+'/report';
      const pending=page.waitForResponse(res=>res.url()===route&&res.request().method()==='POST');
      await button(dialog,'提交举报').click();
      const response=await pending;
      assert.equal(response.status(),200);
      const {report}=await response.json();
      await expect(dialog.getByRole('status')).toContainText(report.id);
      await page.locator('#dialog-close').click();
      return report;
    }
    for(const item of media){
      const include=item.key!=='noteOnly';
      const result=await report(item,include);
      const shown=cli(db,['show',result.id]);
      assert.equal(shown.targetId,item.message.id);
      assert.equal(shown.reportedText,item.key==='voice'?'[语音]':'[图片]');
      assert(!JSON.stringify(shown).includes(adjacent.text));
      shared[item.key]={result,shown};
    }
    if(baseline){
      assert(Object.values(shared).every(({shown})=>shown.sharedMedia===undefined));
      assert.match(cli(db,['media',shared.photo.result.id,output],false),/Use feedback/u);
      await reportMessage(page,page.locator('.bubble').filter({hasText:adjacent.text}));
      await expect(dialog.getByRole('checkbox')).toHaveCount(0);
      await page.screenshot({path:path.join(output,'旧版举报只填写原因.png')});
    }else{
      const exportDir=path.join(output,'private-review');
      await fs.mkdir(exportDir);
      const operator=await browser.newPage();
      for(const item of media.filter(item=>item.key!=='noteOnly')){
        const {result,shown}=shared[item.key];
        const mime=item.key==='voice'?'audio/wav':'image/png';
        assert.equal(result.sharedMedia,mime);assert.equal(shown.sharedMedia,mime);
        const file=cli(db,['media',result.id,exportDir]);
        assert.equal(file.targetId,item.message.id);assert.equal(file.mime,mime);
        const bytes=await fs.readFile(file.file);
        assert.deepEqual(bytes,item.bytes);
        assert.match(cli(db,['media',result.id,exportDir],false),/EEXIST/u);
        const url='data:'+mime+';base64,'+bytes.toString('base64');
        if(item.key==='voice'){
          await operator.setContent('<button>试听</button><audio controls></audio>');
          await operator.evaluate(url=>{
            const audio=document.querySelector('audio');
            audio.src=url;
            document.querySelector('button').onclick=()=>void audio.play();
          },url);
          await button(operator,'试听').click();
          await operator.waitForFunction(()=>document.querySelector('audio').ended);
          const duration=await operator.locator('audio').evaluate(node=>node.duration);
          assert.equal(duration,0.5);
          files.voice={...file,sha256:sha(bytes),duration,finishedPlayback:true};
        }else{
          await operator.setContent('<img alt="审核导出的原图">');
          const img=operator.locator('img');
          const dimensions=await img.evaluate(async(node,url)=>{
            node.src=url;await node.decode();return [node.naturalWidth,node.naturalHeight];
          },url);
          assert.deepEqual(dimensions,item.key==='ai'?[48,36]:[32,24]);
          files[item.key]={...file,sha256:sha(bytes),dimensions};
        }
      }
      await operator.close();
      const noMedia=shared.noteOnly.result;
      assert.equal(noMedia.sharedMedia,undefined);
      const notePath=thread+'/messages/'+media.find(item=>item.key==='noteOnly').message.id+'/report';
      const retry=await b.api(notePath,{reason:'重试也不会改旧范围',includeMedia:true},200,{'X-Social-Account':personB});
      assert.deepEqual(retry.report,noMedia);
      assert.match(cli(db,['media',noMedia.id,exportDir],false),/no authorized media/u);
      assert.deepEqual((await fs.readdir(exportDir)).sort(),Object.values(files).map(row=>path.basename(row.file)).sort());
      const textPath=thread+'/messages/'+adjacent.id+'/report';
      await b.api(textPath,{reason:'虚构原件开关',includeMedia:true},400,{'X-Social-Account':personB});
      await b.api(textPath,{reason:'原文字范围',includeMedia:true},409);
      const {report:textReport}=await b.api(textPath,{reason:'原文字范围'});
      assert.equal(cli(db,['show',textReport.id]).reportedText,adjacent.text);

      decisions.photo=cli(db,['dismiss',shared.photo.result.id]);
      decisions.voice=cli(db,['remove',shared.voice.result.id]);
      decisions.ai=cli(db,['remove',shared.ai.result.id]);
      assert.deepEqual(Object.values(decisions).map(row=>row.status),['dismissed','removed','removed']);
      for(const row of Object.values(decisions))assert.match(cli(db,['media',row.id,exportDir],false),/no authorized media/u);
      const after=(await b.api(thread+'/messages')).messages;
      assert(after.some(row=>row.id===media[0].message.id&&row.attachment?.type==='image'));
      assert(after.some(row=>row.id===media[3].message.id&&row.attachment?.type==='image'));
      assert(after.some(row=>row.id===adjacent.id&&row.text===adjacent.text));
      if(groupEntry){
        assert.equal(shared.photo.shown.targetId,groupEntry.uploadedImage);
        assert(after.some(row=>row.id===groupEntry.keyboardMessage&&row.text==='键盘发送后的合成图片'));
        groupEntry.report=shared.photo.result.id;
      }
      for(const row of media.slice(1,3))assert(after.some(msg=>msg.id===row.message.id&&msg.removed&&!msg.attachment));
      await expect(page.locator('#history')).toContainText('[已移除]');
      await page.screenshot({path:path.join(output,'仅移除两条审核消息.png')});
      if(baselineDir){
        const older=JSON.parse(await fs.readFile(path.join(baselineDir,'receipt.json'),'utf8'));
        const migrated=path.join(output,'migrated.sqlite');
        await fs.copyFile(path.join(baselineDir,'fixture.sqlite'),migrated);
        assert.equal(cli(migrated,['show',older.shared.photo.result.id]).sharedMedia,null);
        assert.match(cli(migrated,['media',older.shared.photo.result.id,exportDir],false),/no authorized media/u);
        decisions.legacyMediaDenied=true;
      }
    }
    assert.deepEqual(external,[]);
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify({baseline,group:id,groupEntry,shared,files,decisions,external},null,2)+'\n');
  }finally{
    if(browser)await browser.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
