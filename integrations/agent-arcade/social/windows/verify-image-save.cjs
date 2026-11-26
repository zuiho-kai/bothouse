'use strict';

// Stage a disposable copy of the unpacked 1.0.4 test shell and overlay only the
// candidate modules. The real shell and guest run hidden. Only system dialogs
// are substituted so the test can supply paths and cancellation deterministically.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {_electron}=require('playwright');
const {SocialStore}=require('../server/store.cjs');
const {createServer}=require('../server/http.cjs');
const {moderate}=require('../server/moderate.cjs');

const repo=path.resolve(__dirname,'../..');
const password='synthetic-image-save-password';
const sha=value=>createHash('sha256').update(value).digest('hex');

async function until(read,description) {
  for(let index=0;index<120;index++){
    const value=await read();
    if(value)return value;
    await delay(125);
  }
  throw Error('Timed out: '+description);
}

async function main() {
  const [shellArg,evidenceArg,...extra]=process.argv.slice(2);
  assert(shellArg&&evidenceArg&&!extra.length,'Usage: node verify-image-save.cjs UNPACKED_TEST_EXE EVIDENCE_DIR');
  const base=path.resolve(shellArg),evidence=path.resolve(evidenceArg);
  const installed=path.dirname(base);
  const baseConfig=JSON.parse(fs.readFileSync(path.join(installed,'resources/app/service.json'),'utf8'));
  assert.equal(baseConfig.mode,'test');
  const temp=fs.realpathSync(os.tmpdir()),scratch=fs.mkdtempSync(path.join(temp,'arcade-image-save-'));
  fs.mkdirSync(evidence,{recursive:true});
  const store=new SocialStore(path.join(scratch,'synthetic.sqlite'));
  const server=createServer(store);
  const requests=[];
  server.on('request',request=>requests.push({url:request.url,account:request.headers['x-social-account']}));
  let app;
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    const staged=path.join(scratch,'shell');
    fs.cpSync(installed,staged,{recursive:true});
    const payload=path.join(staged,'resources/app');
    const overlays={
      'src/main.cjs':'src/main.cjs',
      'src/core/static-image.cjs':'src/core/static-image.cjs',
      'src/core/store-social-image-save.cjs':'src/core/store-social-image-save.cjs',
      'social-host.cjs':'social/windows/social-host.cjs',
      'social-view.cjs':'social/windows/social-view.cjs',
    };
    const hashes={};
    for(const [target,source] of Object.entries(overlays)){
      const bytes=fs.readFileSync(path.join(repo,source));
      fs.writeFileSync(path.join(payload,target),bytes);
      hashes[target]=sha(bytes);
    }
    fs.writeFileSync(path.join(payload,'service.json'),JSON.stringify({mode:'test',origin}));
    const profile=path.join(scratch,'profile');
    const env={...process.env,APPDATA:profile,LOCALAPPDATA:profile};
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    app=await _electron.launch({executablePath:path.join(staged,path.basename(base)),env,args:[
      '--arcade-store-test-profile='+profile,'--disable-gpu','--disable-background-networking',
      '--disable-component-update','--disable-sync','--no-proxy-server',
    ]});
    const host=await app.firstWindow();
    await app.evaluate(({dialog})=>{
      globalThis.saveFixture={dialogs:[],warnings:[],resume:null};
      dialog.showSaveDialog=(parent,options)=>{
        if(parent.isVisible())throw Error('The test must stay hidden');
        globalThis.saveFixture.dialogs.push(options);
        return new Promise(resolve=>{globalThis.saveFixture.resume=resolve;});
      };
      dialog.showMessageBox=async (_parent,options)=>{
        globalThis.saveFixture.warnings.push(options.title);
        return {response:0};
      };
    });
    if(await host.locator('#ws-social').isVisible())await host.locator('#ws-social').click();

    const guest=script=>app.evaluate(({BrowserWindow},source)=>{
      const [window]=BrowserWindow.getAllWindows();
      if(!window||window.isVisible()||BrowserWindow.getAllWindows().length!==1)throw Error('Expected one hidden shell');
      const view=window.contentView.children.find(child=>child.webContents&&child.webContents!==window.webContents);
      if(!view?.getVisible()||!view.webContents.getURL().startsWith('http://127.0.0.1:'))return null;
      return view.webContents.executeJavaScript(source,true);
    },script);
    const fixture=()=>app.evaluate(()=>({dialogs:globalThis.saveFixture.dialogs,warnings:globalThis.saveFixture.warnings}));
    const finish=(file)=>app.evaluate((_electron,dest)=>{
      const done=globalThis.saveFixture.resume;
      globalThis.saveFixture.resume=null;
      if(!done)throw Error('No save dialog is pending');
      done(dest?{canceled:false,filePath:dest}:{canceled:true,filePath:''});
    },file);
    await until(()=>guest('Boolean(document.querySelector("#auth-form"))'),'the normal social guest opened');
    await guest("document.querySelector('#auth-switch').click();"+
      "document.querySelector('[name=number]').value='saved_peer';"+
      "document.querySelector('[name=displayName]').value='保存验证接收者';"+
      "document.querySelector('[name=password]').value="+JSON.stringify(password)+";"+
      "document.querySelector('#auth-submit').click()");
    await until(()=>guest('!document.querySelector("#workspace").hidden'),'signed-in guest');

    const api=(route,data,cookie)=>fetch(origin+'/api/v1'+route,{
      method:data===undefined?'GET':'POST',headers:{
        ...(cookie&&{Cookie:cookie}),...(data!==undefined&&{'Content-Type':'application/json'}),
      },body:data===undefined?undefined:JSON.stringify(data),
    });
    const owner=await api('/register',{number:'saved_author',displayName:'保存验证发送者',password});
    assert.equal(owner.status,200);
    const cookie=owner.headers.get('set-cookie').split(';')[0];
    store.decide('saved_peer',store.request('saved_author','saved_peer').id,true);
    const direct=store.direct('saved_author','saved_peer');
    const group=store.createGroup('saved_author','保存验证群',['saved_peer']);
    const samples=await guest("['image/png','image/jpeg'].map((mime,index)=>{const c=document.createElement('canvas');"+
      "c.width=128;c.height=96;const ctx=c.getContext('2d');ctx.fillStyle=index?'#13436b':'#3a2264';ctx.fillRect(0,0,128,96);"+
      "ctx.fillStyle='#95e7c4';ctx.fillRect(27,18,64,54);return c.toDataURL(mime).split(',')[1];})");
    const png=Buffer.from(samples[0],'base64'),jpg=Buffer.from(samples[1],'base64');
    async function send(chat,mime,bytes,nonce){
      const response=await fetch(origin+'/api/v1/conversations/'+chat.id+'/images',{
        method:'POST',headers:{Cookie:cookie,'Content-Type':mime,'X-Social-Account':'saved_author','X-Social-Client-Id':nonce},body:bytes,
      });
      assert.equal(response.status,200);
      return (await response.json()).message;
    }
    const one=await send(direct,'image/png',png,'fixture-direct-save');
    const two=await send(group,'image/jpeg',jpg,'fixture-group-save');
    const three=await send(group,'image/png',png,'fixture-group-leave');
    const route=row=>'/api/v1/conversations/'+row.conversationId+'/messages/'+row.id+'/image';
    const refetches=row=>requests.filter(entry=>entry.url===route(row)&&entry.account==='saved_peer').length;
    const open=async row=>{
      await guest("location.hash='#chat/"+row.conversationId+"'");
      const selector='[data-image-id="'+row.id+'"]';
      await until(()=>guest('Boolean(document.querySelector('+JSON.stringify(selector)+'))'),'received image '+row.id);
      await guest('document.querySelector('+JSON.stringify(selector)+').click()');
      await until(()=>guest('Boolean(document.querySelector(".save-chat-image:not([hidden])"))'),'save link on real original');
    };
    const click=()=>guest('document.querySelector(".save-chat-image").click()');
    const dialogCount=async count=>until(async()=>(await fixture()).dialogs.length===count,'save dialog '+count);

    await open(one);
    await click();await dialogCount(1);
    assert.deepEqual((await fixture()).dialogs[0].filters[0].extensions,['png']);
    const saved=path.join(scratch,'readback.png');
    await finish(saved);
    await until(()=>fs.existsSync(saved),'written original');
    assert.deepEqual(fs.readFileSync(saved),png);
    assert.equal(refetches(one),1);

    await open(two);
    await click();await dialogCount(2);
    assert.deepEqual((await fixture()).dialogs[1].filters[0].extensions,['jpg']);
    const jpegSaved=path.join(scratch,'readback.jpg');
    await finish(jpegSaved);
    await until(()=>fs.existsSync(jpegSaved),'written JPEG');
    assert.deepEqual(fs.readFileSync(jpegSaved),jpg);
    assert.equal(refetches(two),1);

    await click();await dialogCount(3);
    const beforeCancel=refetches(two);
    await finish(null);
    await delay(350);
    assert.equal(refetches(two),beforeCancel);

    await click();await dialogCount(4);
    const report=store.report('saved_author',group.id,two.id,'synthetic removal');
    moderate(store,'remove',report.id);
    await until(()=>guest('!document.querySelector("#dialog").open'),'removed image closed old viewer');
    const deleted=path.join(scratch,'removed.jpg');
    await finish(deleted);
    await until(async()=>(await fixture()).warnings.length===1,'revoked server read failed after chooser');
    assert.equal(refetches(two),beforeCancel+1);
    assert.equal(fs.existsSync(deleted),false);
    assert.equal(await guest("fetch("+JSON.stringify(route(two))+"+'/download').then(r=>r.status)"),404);

    await open(three);
    await click();await dialogCount(5);
    const secondSession=await api('/login',{number:'saved_peer',password});
    const peerCookie=secondSession.headers.get('set-cookie').split(';')[0];
    assert.equal((await api('/groups/'+group.id+'/leave',{},peerCookie)).status,200);
    await until(()=>guest('!location.hash&&!document.querySelector("#dialog").open'),'left group closed old viewer');
    const departed=path.join(scratch,'departed.png');
    await finish(departed);
    assert.equal(await guest("fetch("+JSON.stringify(route(three))+"+'/download').then(r=>r.status)"),404);
    assert.equal(fs.existsSync(departed),false);

    await open(one);
    await guest("for(const href of ['/icon-192.png','http://127.0.0.1:1/icon-192.png']){"+
      "const a=document.createElement('a');a.href=href;a.download='blocked.png';document.body.append(a);a.click();a.remove();}");
    await until(()=>requests.some(row=>row.url==='/icon-192.png'),'ordinary same-origin download request');
    await delay(600);
    assert.equal((await fixture()).dialogs.length,5);
    const receipt={baseExe:sha(fs.readFileSync(base)),overlays:hashes,dialogMode:'native API substituted; actual Windows Store shell hidden',
      originalByteSHA256:{png:sha(png),jpeg:sha(jpg)},chooserCount:5,originalSave:true,cancelledWithoutRefetch:true,
      removedWhileChooserOpen:true,leftWhileChooserOpen:true,ordinaryAndUnrelatedDownloadBlocked:true,
      realServiceRequests:requests.filter(row=>row.url.endsWith('/download')||row.account==='saved_peer')};
    fs.writeFileSync(path.join(evidence,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify(receipt));
  } finally {
    try {await app?.close();}
    finally {
      if(server.listening){
        server.closeAllConnections();
        await new Promise(resolve=>server.close(resolve));
      }
      store.db.close();
      assert.equal(path.dirname(scratch),temp);
      assert.match(path.basename(scratch),/^arcade-image-save-[a-z0-9]{6}$/iu);
      await fs.promises.rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:150});
    }
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
