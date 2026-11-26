'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, fork } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: wait } = require('node:timers/promises');
const { _electron } = require('playwright');

const args = process.argv.slice(2);
const unified=args.at(-1)==='--unified';
const conduct=args.at(-1)==='--conduct';
const drawingFeed=args.at(-1)==='--drawing-feed';
const cardPreview=args.at(-1)==='--group-card-preview'||drawingFeed;
const stagePrivacySource=args.at(-1)==='--privacy-contact-open';
const privacyOpen=stagePrivacySource||args.at(-1)==='--privacy-contact-packaged';
const privacyOnly=args.at(-1)==='--privacy-contact'||privacyOpen;
if(unified||privacyOnly||conduct||cardPreview)args.pop();
assert.equal(args.length,3,'Usage: node verify-https-package.cjs UNPACKED_EXE OPENSSL EVIDENCE_DIR [--unified|--conduct|--group-card-preview|--drawing-feed|--privacy-contact|--privacy-contact-open|--privacy-contact-packaged]');
const [executable, openssl, evidence] = args.map(value => path.resolve(value));
const payload = path.join(path.dirname(executable), 'resources', 'app');
const config = require(path.join(payload, 'service.json'));
const origin = new URL(config.origin);
assert.equal(config.mode, 'test');
assert.equal(origin.hostname, 'arcade-store.test');
assert.equal(origin.protocol, 'https:');
const tempRoot = fs.realpathSync(os.tmpdir());
const scratch = fs.mkdtempSync(path.join(tempRoot, 'arcade-store-tls-'));
const serviceRoot=path.resolve(process.env.ARCADE_QA_SERVICE_ROOT || path.join(__dirname,'..'));
const apps = new Set();
const password = 'synthetic-https-only';
const drawing=drawingFeed?require('./verify-packaged-drawing-feed.cjs'):null;
let worker, proxy, upstreamPort;
let runtimeExe=executable;
const contactLookups=[];
const voiceUploads=[];
const fakeMicrophone=path.join(scratch,'synthetic-microphone.wav');

function writeFakeMicrophone() {
  const pcm=Buffer.alloc(44+16000*2*8);
  pcm.write('RIFF');pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);
  pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);
  pcm.writeUInt32LE(16000,24);pcm.writeUInt32LE(32000,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);
  pcm.write('data',36);pcm.writeUInt32LE(pcm.length-44,40);
  for(let i=44;i<pcm.length;i+=2)pcm.writeInt16LE(Math.round(5000*Math.sin(2*Math.PI*440*(i-44)/32000)),i);
  fs.writeFileSync(fakeMicrophone,pcm);
}

function run(...argv) {
  execFileSync(openssl, argv, {
    cwd:scratch, windowsHide:true, stdio:'pipe',
    env:{...process.env,OPENSSL_CONF:path.join(scratch,'openssl.cnf')},
  });
}
function createCertificates() {
  const ca = path.join(scratch, 'ca.pem');
  fs.writeFileSync(path.join(scratch,'openssl.cnf'),'[req]\ndistinguished_name=dn\n[dn]\n');
  run('req', '-new', '-x509', '-newkey', 'rsa:2048', '-noenc', '-days', '1',
    '-subj', '/CN=Arcade temporary acceptance CA', '-keyout', 'ca.key', '-out', 'ca.pem',
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-addext', 'subjectKeyIdentifier=hash');
  fs.writeFileSync(path.join(scratch, 'leaf.ext'), [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth',
    'subjectAltName=DNS:' + origin.hostname,
    'subjectKeyIdentifier=hash',
    'authorityKeyIdentifier=keyid,issuer',
  ].join('\n'));
  run('req', '-new', '-newkey', 'rsa:2048', '-noenc', '-subj', '/CN=' + origin.hostname,
    '-keyout', 'leaf.key', '-out', 'leaf.csr');
  run('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key',
    '-CAcreateserial', '-days', '1', '-extfile', 'leaf.ext', '-out', 'leaf.pem');
  run('req', '-new', '-x509', '-newkey', 'rsa:2048', '-noenc', '-days', '1',
    '-subj', '/CN=Arcade unrelated test CA', '-keyout', 'wrong.key', '-out', 'wrong.pem',
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-addext', 'subjectKeyIdentifier=hash');
  return ca;
}
async function startWorker(aiFixture,contact) {
  worker = fork(path.join(serviceRoot,'server','main.cjs'), [], {
    execArgv:aiFixture?['--require',aiFixture]:[],
    windowsHide: true, stdio: ['ignore','ignore','inherit','ipc'],
    env: {...process.env, SOCIAL_DB: path.join(scratch,'synthetic.sqlite'), SOCIAL_HOST:'127.0.0.1',
      SOCIAL_PORT:'0', SOCIAL_PUBLIC_ORIGIN:origin.origin, SOCIAL_DEEPSEEK_KEY:aiFixture?'synthetic-store-key':'', SOCIAL_OPENAI_KEY:aiFixture?'synthetic-store-openai-key':'',
      SOCIAL_CLOUDFLARE_ACCOUNT_ID:drawing?.accountId||'',SOCIAL_CLOUDFLARE_API_TOKEN:drawing?.token||'',SOCIAL_CLOUDFLARE_DRAW_DAILY:'12',
      SOCIAL_ESPEAK:'',SOCIAL_AZURE_SPEECH_REGION:aiFixture?'fixture':'',SOCIAL_AZURE_SPEECH_KEY:aiFixture?'synthetic-speech-key':'',
      ...(contact!==undefined&&{SOCIAL_PUBLIC_PRIVACY_CONTACT:contact,SOCIAL_PUBLIC_OPERATOR_NAME:contact?'合成运营':''})},
  });
  const [{port}] = await Promise.race([once(worker,'message'),
    once(worker,'exit').then(([code]) => assert.fail('Social service exited: ' + code))]);
  upstreamPort=port;
}
async function stopWorker(){
  if(worker&&worker.exitCode===null&&worker.signalCode===null){
    const done=once(worker,'exit');
    worker.kill();
    await done;
  }
}
async function startServer(aiFixture){
  await startWorker(aiFixture);
  proxy = https.createServer({
    key: fs.readFileSync(path.join(scratch,'leaf.key')),
    cert: fs.readFileSync(path.join(scratch,'leaf.pem')),
    minVersion: 'TLSv1.2',
  }, (request,response) => {
    if(request.url==='/api/v1/public-privacy-contact')contactLookups.push({cookie:!!request.headers.cookie});
    if(request.method==='POST'&&request.url.endsWith('/voices'))voiceUploads.push(request.url);
    const upstream = http.request({hostname:'127.0.0.1',port:upstreamPort,path:request.url,method:request.method,
      headers:{...request.headers,'x-real-ip':request.socket.remoteAddress}}, reply => {
      response.writeHead(reply.statusCode,reply.headers);
      reply.pipe(response);
    });
    upstream.on('error',error => response.destroy(error));
    request.pipe(upstream);
  });
  proxy.listen(Number(origin.port),'127.0.0.1');
  await once(proxy,'listening');
}

async function launch(label, caFile) {
  const profile = path.join(scratch,label);
  fs.mkdirSync(path.join(profile,'library'),{recursive:true});
  fs.writeFileSync(path.join(profile,'library','config.json'),JSON.stringify({language:'zh'}));
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({executablePath:runtimeExe, env, args:[
    '--arcade-store-test-profile='+profile, '--host-resolver-rules=MAP '+origin.hostname+' 127.0.0.1',
    '--no-proxy-server', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--mute-audio',
    ...(unified?['--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+fakeMicrophone]:[]),
  ]});
  apps.add(app);
  await app.evaluate(async ({app,session},options) => {
    await app.whenReady();
    const browserSession=session.fromPartition('persist:arcade-social');
    const fs=process.getBuiltinModule('fs');
    const cp=process.getBuiltinModule('child_process');
    browserSession.setCertificateVerifyProc((request,done)=>{
      if(!options.caFile || request.hostname!==options.hostname){done(-3);return;}
      // Validate the actual Chromium peer leaf with the fixture CA. OpenSSL
      // enforces chain, dates, hostname, extensions and TLS server purpose.
      fs.writeFileSync(options.leaf,request.certificate.data);
      cp.execFile(options.openssl,[
        'verify','-CAfile',options.caFile,'-no-CApath','-no-CAstore','-x509_strict',
        '-verify_hostname',options.hostname,'-purpose','sslserver',options.leaf,
      ],{windowsHide:true,timeout:5000},error=>done(error?-2:0));
    });
  }, { caFile, openssl, hostname:origin.hostname, leaf:path.join(scratch,label+'-received-leaf.pem') });
  const page = await app.firstWindow();
  await page.waitForURL('file:**');
  return {app,page};
}
async function close(client) {
  await client.app.close();
  apps.delete(client.app);
}
async function guest(client, expression) {
  return client.app.evaluate(({BrowserWindow},script)=>{
    const window=BrowserWindow.getAllWindows()[0];
    assertSingleHidden(window,BrowserWindow);
    const view=window.contentView.children.find(child=>child.webContents&&child.webContents!==window.webContents);
    if(!view?.getVisible()||!view.webContents.getURL().startsWith('https:'))return null;
    return view.webContents.executeJavaScript(script);
    function assertSingleHidden(w,windows) {
      if(windows.getAllWindows().length!==1||w.isVisible())throw new Error('Expected one hidden desktop window per test process');
    }
  },expression);
}
async function until(read,label) {
  for(let i=0;i<100;i++){ if(await read()) return; await wait(150); }
  throw new Error('Timed out: '+label);
}
async function loaded(client) {
  const retry = client.page.getByRole('button',{name:'重试',exact:true});
  let didRetry = false;
  await until(async ()=>{
    if(await guest(client,'!!document.querySelector("#auth-form")'))return true;
    if(!didRetry&&await retry.isVisible()){didRetry=true;await retry.click();}
    return false;
  },'secure social page');
}
async function authReady(client) {
  await loaded(client);
  await until(()=>guest(client,`
    document.readyState === 'complete' &&
    !document.querySelector('#auth-loading:not([hidden])') &&
    !!document.querySelector('#auth:not([hidden]) #auth-switch:enabled') &&
    !!document.querySelector('#auth-form [name=number]:enabled') &&
    !!document.querySelector('#auth-form [name=password]:enabled') &&
    !!document.querySelector('#auth-submit:enabled')
  `),'enabled social login form');
}
async function register(client,number,name) {
  await authReady(client);
  await guest(client,`
    document.querySelector('#auth-switch').click();
    document.querySelector('[name=number]').value=${JSON.stringify(number)};
    document.querySelector('[name=displayName]').value=${JSON.stringify(name)};
    document.querySelector('[name=password]').value=${JSON.stringify(password)};
    document.querySelector('#auth-submit').click();
  `);
  await until(()=>guest(client,'!document.querySelector("#workspace").hidden'),'registered '+number);
}
async function cookieProperties(client) {
  return client.app.evaluate(async ({session},serviceOrigin)=>{
    const cookies=await session.fromPartition('persist:arcade-social').cookies.get({url:serviceOrigin,name:'arcade_social'});
    if(cookies.length!==1) throw new Error('Expected exactly one social session cookie');
    const {secure,httpOnly,session:temporary}=cookies[0];
    return {secure,httpOnly,persistent:!temporary};
  },origin.origin);
}
const button = name => `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(name)})`;
async function send(client,text) {
  const enabled="!!document.querySelector('#composer:not([hidden]) button[type=submit]:enabled')";
  await until(()=>guest(client,enabled),'enabled composer');
  await guest(client,`document.querySelector('#message').value=${JSON.stringify(text)};
    document.querySelector('#composer button[type=submit]').click()`);
}
function history(client,text) {
  return guest(client,`document.querySelector('#history').textContent.includes(${JSON.stringify(text)})`);
}

async function openSignedOutPrivacy(client) {
  await until(()=>guest(client,`
    (() => {
      const link = [...document.querySelectorAll('#auth a[href]')]
        .find(anchor => anchor.href === location.origin + '/privacy.html' && anchor.getClientRects().length);
      if (!link) return false;
      setTimeout(() => link.click(), 0);
      return true;
    })()
  `),'signed-out privacy link');
  await wait(150);
  await until(()=>guest(client,'location.pathname==="/privacy.html" && !location.search && !location.hash'),
    'signed-out privacy page');
}
async function privacyContact(ca) {
  const checks=[];
  for(const [mode,value] of [['email','privacy@example.org'],
    ['https','https://contact.invalid/privacy?from=fixture'],['unset','']]){
    await stopWorker();
    await startWorker(undefined,value);
    const client=await launch('privacy-'+mode,ca);
    await loaded(client);
    assert.deepEqual(await guest(client,'[typeof window.arcade,typeof require,typeof document.documentElement.dataset.arcadePrivacyLink]'),
      ['undefined','undefined','undefined']);
    await openSignedOutPrivacy(client);
    if(!value){
      assert(await guest(client,'!!document.querySelector("#privacy-contact-unconfigured")&&!document.querySelector("#copy-privacy-contact")'));
      checks.push({mode,unconfiguredNotice:true});
      await close(client);
      continue;
    }
    await until(()=>guest(client,'!document.querySelector("#copy-privacy-contact").hidden'),'copy button ready');
    const opensLink=privacyOpen&&mode==='https';
    assert.deepEqual(await guest(client,'[document.querySelector("#privacy-contact-value").value,document.querySelector("#open-privacy-contact").hidden]'),[value,!opensLink]);
    for(const keyboard of [false,true]){
      const result=await client.app.evaluate(async ({BrowserWindow},keyboard)=>{
      const win=BrowserWindow.getAllWindows()[0];
      if(win.isVisible())throw Error('Test window must remain hidden');
      const contents=win.contentView.children.find(child=>child.webContents&&child.getVisible()).webContents;
      contents.debugger.attach('1.3');
      try{
        await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
        // Observe the renderer's native copy event without writing to the host clipboard.
        const point=await contents.executeJavaScript(`(()=>{
        window.qaCopy=[];
        window.qaActivation=[];
        document.addEventListener('copy',event=>{
          const field=document.querySelector('#privacy-contact-value');
          qaCopy.push({trusted:event.isTrusted,text:field.value.slice(field.selectionStart,field.selectionEnd)});
          event.preventDefault();
        },{once:true});
        const control=document.querySelector('#copy-privacy-contact');
        control.scrollIntoView({block:'center'});
        control.focus();
        control.addEventListener('click',event=>qaActivation.push(event.isTrusted),{once:true});
        const r=control.getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2};
      })()`);
        const send=(method,data)=>contents.debugger.sendCommand('Input.'+method,data);
        if(keyboard){
          const key={key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13};
          await send('dispatchKeyEvent',{...key,type:'keyDown',text:'\r',unmodifiedText:'\r'});
          await send('dispatchKeyEvent',{...key,type:'keyUp'});
        }else{
          for(const type of ['mousePressed','mouseReleased'])await send('dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
        }
        return await contents.executeJavaScript(`({copy:qaCopy,activation:qaActivation,
          status:document.querySelector('#privacy-copy-status').textContent,stayed:location.pathname==='/privacy.html'})`);
      }finally{contents.debugger.detach();}
      },keyboard);
      assert.deepEqual(result,{copy:[{trusted:true,text:value}],activation:[true],status:'已复制联系方式。',stayed:true});
    }
    const fallback=await guest(client,`(()=>{
      document.execCommand=()=>false;
      document.querySelector('#copy-privacy-contact').click();
      const field=document.querySelector('#privacy-contact-value');
      return [field.value.slice(field.selectionStart,field.selectionEnd),
        document.querySelector('#privacy-copy-status').textContent];
    })()`);
    assert.deepEqual(fallback,[value,'已选中联系方式，可按 Ctrl+C 或用系统菜单复制。']);
    const opened=opensLink?await verifyExternalContact(client,value):undefined;
    checks.push({mode,input:['mouse','keyboard'],trustedCopy:true,manualFallback:true,stayedOnPrivacy:true,opened});
    await close(client);
  }
  return {passed:true,executable,visibleTestWindows:0,clipboardWritePreventedByFixture:true,
    browserLaunchSubstituted:privacyOpen,usedPreloadFromExportedPackage:privacyOpen&&!stagePrivacySource,contactLookups,checks};
}

async function verifyExternalContact(client,address) {
  await client.app.evaluate(async ({shell,session},site)=>{
    globalThis.privacyBrowserCalls=[];
    shell.openExternal=async url=>{privacyBrowserCalls.push(url);};
    await session.fromPartition('persist:arcade-social').cookies.set({url:site,name:'synthetic_session_marker',value:'isolated',secure:true});
  },origin.origin);
  await guest(client,'document.querySelector("#open-privacy-contact").click()');
  const requests=()=>client.app.evaluate(()=>globalThis.privacyBrowserCalls);
  assert.deepEqual(await requests(),[]);
  assert(await guest(client,`(()=>{
    const external='https://other.invalid/regular-navigation';
    const link=document.createElement('a');link.href=external;document.body.append(link);link.click();link.remove();
    return window.open(external)===null;
  })()`));
  assert(await guest(client,'location.pathname==="/privacy.html"'));
  assert.deepEqual(await requests(),[]);
  async function click(){
    await client.app.evaluate(async ({BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows()[0];
      const contents=win.contentView.children.find(child=>child.webContents&&child.getVisible()).webContents;
      contents.debugger.attach('1.3');
      try{
        await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
        const point=await contents.executeJavaScript(`(()=>{
          const link=document.querySelector('#open-privacy-contact');link.scrollIntoView({block:'center'});
          const r=link.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
        })()`);
        for(const type of ['mousePressed','mouseReleased'])
          await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
      }finally{contents.debugger.detach();}
    });
  }
  await click();
  await until(()=>guest(client,'document.querySelector("#privacy-copy-status").textContent==="已请求用系统浏览器打开。"'),'external open requested');
  assert.deepEqual(await requests(),[address]);
  await guest(client,'document.querySelector("#open-privacy-contact").href="https://other.invalid/not-approved"');
  await click();
  await until(()=>guest(client,'document.querySelector("#privacy-copy-status").textContent.startsWith("未能打开")'),'changed destination rejected');
  assert.deepEqual(await requests(),[address]);
  assert.deepEqual(contactLookups,[{cookie:false},{cookie:false}]);
  assert(await guest(client,'location.pathname==="/privacy.html"'));
  return {address,keyboardCopyAlsoVerified:true,programmaticClickDidNotOpen:true,tamperedHrefRejected:true,
    ordinaryExternalNavigationBlocked:true,cookiesOnContactLookups:false,realBrowserStarted:false};
}

async function main() {
  let receipt;
  try {
    if(stagePrivacySource){
      const staged=path.join(scratch,'privacy-shell');
      fs.cpSync(path.dirname(executable),staged,{recursive:true});
      runtimeExe=path.join(staged,path.basename(executable));
      for(const name of ['social-view.cjs','privacy-preload.cjs'])
        fs.copyFileSync(path.join(__dirname,name),path.join(staged,'resources','app',name));
    }
    if(unified)writeFakeMicrophone();
    const ca = createCertificates();
    if(cardPreview){
      const {createCardFixture,verifyPackagedCard}=require('./verify-packaged-group-card.cjs');
      const fixture=createCardFixture({scratch,payload});
      const extended=drawing?.extendFixture(scratch,fixture);
      await startServer(extended?.fixture||fixture.mock);
      const owner=await launch('card-owner',ca), peer=await launch('card-peer',ca);
      const report=await verifyPackagedCard({owner,peer,origin,guest,until,button,register,wire:fixture.wire});
      if(drawing){
        const restart=async()=>{await stopWorker();await startWorker(extended.fixture);};
        report.drawingFeed=await drawing.verifyDrawingFeed({owner,peer,guest,until,button,send,history,restart,fixture:extended,
          restoreSnapshot:()=>drawing.verifyRestore({scratch,serviceRoot})});
      }
      fs.mkdirSync(evidence,{recursive:true});
      fs.writeFileSync(path.join(evidence,drawingFeed?'package-drawing-feed.json':'package-group-card.json'),JSON.stringify(report,null,2)+'\n');
      console.log(JSON.stringify(report));
      return;
    }
    await startServer();
    if(conduct){
      const client=await launch('conduct',ca);
      await loaded(client);
      const ruleLink=`[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='内容准则'&&a.getClientRects().length)`;
      assert(await guest(client,`!!${ruleLink}`));
      await guest(client,ruleLink+'.click()');
      const policy=()=>guest(client,`location.href===${JSON.stringify(origin.origin+'/conduct.html')}&&document.body.textContent.includes('举报真人消息或 AI 回复')`);
      await until(policy,'the packaged signed-out link uses the conduct page');
      await guest(client,`[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='返回好友').click()`);
      await loaded(client);
      await register(client,'tls_conduct','合成准则验收');
      await guest(client,button('我')+'.click()');
      await until(()=>guest(client,`!!${ruleLink}`),'signed-in conduct link');
      await guest(client,ruleLink+'.click()');
      await until(policy,'the packaged signed-in link uses the same conduct page');
      await close(client);
      const report={passed:true,executable,origin:origin.origin,page:'/conduct.html',signedOut:true,signedIn:true,visibleWindows:0};
      fs.mkdirSync(evidence,{recursive:true});
      fs.writeFileSync(path.join(evidence,'package-conduct.json'),JSON.stringify(report,null,2)+'\n');
      console.log(JSON.stringify(report));
      return;
    }
    if(privacyOnly){
      const report=await privacyContact(ca);
      fs.mkdirSync(evidence,{recursive:true});
      fs.writeFileSync(path.join(evidence,'privacy-contact-runtime.json'),JSON.stringify(report,null,2)+'\n');
      console.log(JSON.stringify(report));
      return;
    }
    const wrong=await launch('wrong-trust',path.join(scratch,'wrong.pem'));
    const wrongRetry=wrong.page.getByRole('button',{name:'重试',exact:true});
    await wrongRetry.waitFor({timeout:20000});
    await wrongRetry.click();
    await wrongRetry.waitFor({timeout:20000});
    await close(wrong);
    assert(fs.existsSync(path.join(scratch,'wrong-trust-received-leaf.pem')),'Wrong CA must be checked against the actual peer');
    const a=await launch('alpha',ca), b=await launch('bravo',ca);
    await register(a,'tls_alpha','加密甲');
    await register(b,'tls_bravo','加密乙');
    const expected={secure:true,httpOnly:true,persistent:true};
    assert.deepEqual(await cookieProperties(a),expected);
    assert.deepEqual(await cookieProperties(b),expected);
    assert.deepEqual(await guest(a,`[isSecureContext,location.origin,typeof window.arcade,typeof require]`),
      [true,origin.origin,'undefined','undefined']);
    await guest(a,button('添加朋友')+'.click()');
    await guest(a,`document.querySelector('#dialog [name=number]').value='tls_bravo';${button('查找')}.click()`);
    await until(()=>guest(a,`!!${button('发送好友请求')}`),'find friend');
    await guest(a,button('发送好友请求')+'.click()');
    await until(()=>guest(a,`document.querySelector('#dialog').textContent.includes('已发送好友请求')`),'request sent');
    await guest(a,`document.querySelector('#dialog-close').click();${button('消息')}.click()`);
    await guest(b,`document.querySelector('[data-tab=contacts]').click()`);
    await until(()=>guest(b,`!!${button('新的朋友（1）')}`),'incoming request');
    await guest(b,`${button('新的朋友（1）')}.click();${button('接受')}.click()`);
    await until(()=>guest(b,`document.querySelector('#chat-title').textContent==='加密甲'`),'accepted request');
    await send(b,'经 HTTPS 从乙发给甲');
    const openPeer=`[...document.querySelectorAll('#directory-body button')].find(e=>e.textContent.includes('加密乙'))`;
    await until(()=>guest(a,`!!${openPeer}`),'direct conversation appeared');
    await guest(a,openPeer+'.click()');
    await until(()=>history(a,'经 HTTPS 从乙发给甲'),'received B to A');
    await send(a,'经 HTTPS 从甲回复乙');
    await until(()=>history(b,'经 HTTPS 从甲回复乙'),'received A to B');
    const features=unified?await require('./verify-unified-features.cjs').verifyUnifiedFeatures({
      a,b,ca,scratch,serviceRoot,payload,evidence,guest,until,launch,authReady,close,send,history,voiceUploads,
      async restartWithAi(fixture){await stopWorker();await startWorker(fixture);},
    }):undefined;
    await close(a);
    await close(b);
    const reopenedA=await launch('alpha',ca), reopenedB=await launch('bravo',ca);
    for(const [client,peer] of [[reopenedA,'加密乙'],[reopenedB,'加密甲']]){
      await loaded(client);
      await until(()=>guest(client,'!document.querySelector("#workspace").hidden'),'signed in after process restart');
      const row=`[...document.querySelectorAll('#directory-body button')].find(e=>e.textContent.includes(${JSON.stringify(peer)}))`;
      await until(()=>guest(client,'!!'+row),'peer persisted');
      await guest(client,row+'.click()');
      await until(()=>history(client,'经 HTTPS 从甲回复乙'),'restored A to B message');
      assert(await history(client,'经 HTTPS 从乙发给甲'));
      assert.deepEqual(await cookieProperties(client),expected);
    }
    receipt={passed:true,executable,origin:origin.origin,secureCookie:expected,independentAppProfiles:2,
      bothDirections:true,bothColdReopened:true,rejectedUntrustedChain:true,packageGuestHasNoLocalBridge:true,
      visibleTestWindows:0,features,trustScope:'OpenSSL verified Chromium peer against one temporary CA in test session only'};
  } finally {
    await Promise.allSettled([...apps].map(app=>app.close()));
    if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
    await stopWorker();
    assert.equal(path.dirname(fs.realpathSync(scratch)),tempRoot);
    assert.match(path.basename(scratch),/^arcade-store-tls-[a-z0-9]{6}$/i);
    fs.rmSync(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:150});
  }
  fs.mkdirSync(evidence,{recursive:true});
  fs.writeFileSync(path.join(evidence,'https-runtime-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
