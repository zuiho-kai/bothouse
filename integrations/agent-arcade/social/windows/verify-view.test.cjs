'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { runInNewContext } = require('node:vm');
const { createSocialView } = require('./social-view.cjs');
const { serviceOrigin } = require('./endpoint.cjs');

test('the desktop sends only the live send-key choice to the trusted app page',()=>{
  const origin='https://social.arcade-example.com', delivered=[];
  let mode='ctrl-enter';
  const remoteSession=Object.assign(new EventEmitter(),{
    setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}},
  });
  class Guest {
    constructor(){
      this.webContents=Object.assign(new EventEmitter(),{
        mainFrame:{url:origin+'/'},isDestroyed:()=>false,setWindowOpenHandler(){},
        async executeJavaScript(script){
          runInNewContext(script,{CustomEvent,Event,window:{dispatchEvent(event){
            if(event.type==='arcade-social-send-shortcut')delivered.push(event.detail);
          }}});
        },
      });
    }
  }
  const {view,activate}=createSocialView({WebContentsView:Guest,session:{fromPartition:()=>remoteSession},
    configuration:{mode:'store',origin},readSendShortcut:()=>mode});
  view.webContents.emit('did-finish-load');
  mode='enter';
  activate();
  mode={otherSetting:'excluded'};
  view.webContents.emit('did-finish-load');
  view.webContents.mainFrame.url=origin+'/privacy.html';
  view.webContents.emit('did-finish-load');
  view.webContents.mainFrame.url='https://other.example.org/';
  view.webContents.emit('did-finish-load');
  assert.deepEqual(delivered,['ctrl-enter','enter','enter']);
});


test('image feedback dispatches a fixed event only on the active trusted Friends page',async()=>{
  const origin='https://social.arcade-example.com', delivered=[];
  let active=true, current=true, address=origin+'/';
  const browserSession=Object.assign(new EventEmitter(),{
    setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}},
  });
  class Guest {
    constructor(){
      this.webContents=Object.assign(new EventEmitter(),{
        isDestroyed:()=>false,setWindowOpenHandler(){},
        async loadURL(url){address=new URL(url).href;this.emit('did-navigate',{},address,200);},
        async executeJavaScript(script){
          runInNewContext(script,{Event,window:{dispatchEvent(event){delivered.push([event.type,event.detail]);}}});
        },
      });
      Object.defineProperty(this.webContents,'mainFrame',{get:()=>({url:address})});
    }
  }
  const guest=createSocialView({WebContentsView:Guest,session:{fromPartition:()=>browserSession},
    configuration:{mode:'store',origin},isActive:()=>active});
  const open=()=>guest.openImageFeedback(()=>current);
  await open();
  active=false;await open();
  active=true;current=false;await open();
  address='https://unrelated.example.org/';
  current=true;await open();
  assert.equal(address,origin+'/');
  assert.deepEqual(delivered,[['arcade-social-image-feedback',undefined],['arcade-social-image-feedback',undefined]]);
});

test('the operator endpoint is a bare HTTPS origin and test can only use loopback', () => {
  for (const origin of ['https://social.arcade-example.com', 'https://example.arcade-example.com',
    'https://social.example.com.au', 'https://social.examplehosting.net',
    'https://home.arpa.customer-support.org', 'https://myhome.arpa']) {
    assert.equal(serviceOrigin(origin+'/', 'store'), origin);
  }
  for (const domain of ['example.com','example.net','example.org']) {
    for (const labels of ['', 'social.', 'social.arcade.']) {
      assert.throws(() => serviceOrigin('https://'+labels+domain+'/', 'store'), /IANA example domain/u);
    }
  }
  for (const name of ['home.arpa','friends.home.arpa','friends.home.arpa.']) {
    assert.throws(() => serviceOrigin('https://'+name,'store'), /local or reserved DNS name: .*home[.]arpa/u);
  }
  for (const origin of ['https://127.0.0.1', 'http://social.example.org', 'https://server.local',
    'https://social.example.org/chat', 'https://u@social.example.org', 'https://social.example.org/?key=secret']) {
    assert.throws(() => serviceOrigin(origin, 'store'));
  }
  for (const mode of ['test','test-signed'])
    assert.equal(serviceOrigin('http://127.0.0.1:8765', mode), 'http://127.0.0.1:8765');
  assert.throws(() => serviceOrigin('http://192.168.1.2:8765', 'test'));
  assert.equal(serviceOrigin('https://arcade-store.test:8765','test'),'https://arcade-store.test:8765');
  assert.throws(() => serviceOrigin('https://arcade-store.test:8765','store'));
  assert.throws(() => serviceOrigin('https://unrelated.example.org:8765','test'));
  assert.throws(() => serviceOrigin('https://friends.home.arpa:8765','test'));
});

test('production entry points reject a placeholder before checking release files',()=>{
  const entryPoints=['check-store-release.cjs'];
  if(process.platform==='win32')entryPoints.push('pack.cjs');
  for(const file of entryPoints){
    // No source handoff, support contact or packager is supplied. Both tools
    // must report the origin problem before reaching those requirements.
    for(const [origin,message] of [
      ['https://social.example.org',/Store cannot use an IANA example domain/u],
      ['https://friends.home.arpa',/Store cannot use a local or reserved DNS name: friends[.]home[.]arpa/u]
    ]){
      const result=spawnSync(process.execPath,[path.join(__dirname,file),'--mode=store',
        '--version=1.0.23.0','--origin='+origin],{encoding:'utf8',windowsHide:true,timeout:10000});
      assert.ifError(result.error);
      assert.equal(result.status,1,file);
      assert.match(result.stderr,message,file);
    }
  }
});

test('Store support preflight distinguishes placeholders from syntactically public contacts',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-support-preflight-'));
  const identity=path.join(root,'identity.json');
  try{
    fs.writeFileSync(identity,JSON.stringify({name:'AgentArcade.SyntheticSupport',publisher:'CN=Synthetic Support',
      displayName:'Synthetic Support',publisherDisplayName:'Synthetic Operator'}));
    const run=(support,mode='store')=>{
      const fixture=mode==='store'?['--origin=https://arcade-distribution.com','--identity',identity]:
        ['--origin=https://arcade-store.test:8765'];
      // No handoff is supplied. Passing the local support test stops at the
      // next required parameter, before reading artifacts or contacting anything.
      const result=spawnSync(process.execPath,[path.join(__dirname,'check-store-release.cjs'),
        '--mode='+mode,'--version=1.0.23.0','--operator-name=Synthetic Operator','--support',support,...fixture],
        {encoding:'utf8',windowsHide:true,timeout:10000});
      assert.ifError(result.error);
      assert.equal(result.status,1,support);
      return result.stderr;
    };
    for(const address of ['help@example.org','help@desk.Example.NET','https://help.example.com./contact',
      'help@loopback.localhost','https://localhost/contact','https://127.1/contact','https://[::1]/',
      'https://[::ffff:127.0.0.1]/','https://192.168.0.2/help','https://192.0.2.1/help',
      'help@198.51.100.9','https://203.0.113.254/','https://[::ffff:192.0.2.1]/',
      'https://[2001:db8::1]/','https://[3fff:fff::1]/','help@home.arpa',
      'https://support.home.arpa./help','https://224.0.0.1/','https://239.255.255.255/',
      'https://255.255.255.255/','https://[ff02::1]/'])
      assert.match(run(address),/Store support must use a public email or HTTPS address/u,address);
    for(const address of ['privacy@support-example.com','https://help.support-example.net/form?topic=privacy',
      'https://example.customer-support.org/contact','https://home.arpa.customer-support.org/contact',
      'https://8.8.8.8/','https://[2606:4700:4700::1111]/'])
      assert.match(run(address),/Supply the joint handoff and expected MSIX version/u,address);
    for(const address of ['help@example.org','help@home.arpa','https://192.0.2.1/help','https://[2001:db8::1]/'])
      assert.match(run(address,'test'),/Supply the joint handoff and expected MSIX version/u,address);
    for(const suffix of ['', '?topic=account#privacy-contact']){
      const address='https://arcade-store.test:8765/privacy.html'+suffix;
      assert.match(run(address,'test'),/Support URL resolves to the service privacy page/u,address);
    }
  }finally{
    if(fs.existsSync(identity))fs.unlinkSync(identity);
    fs.rmdirSync(root);
  }
});

test('submission checks the installed offline contact while retaining historical package reads',()=>{
  const {releaseContact,verifyOfflineSupport}=require('./support.cjs');
  const settings={mode:'store',origin:'https://arcade-distribution.com',operatorName:'Synthetic desk'};
  for(const support of ['help@arcade-support.net','https://arcade-support.net/help?topic=privacy']){
    const contact=releaseContact({...settings,support});
    assert.equal(verifyOfflineSupport({mode:'store',offlineSupport:contact},contact,true),'matches-release-contact');
    assert.throws(()=>verifyOfflineSupport({mode:'store',offlineSupport:{...contact,name:'Other desk'}},contact,true),/differs/u);
    assert.throws(()=>verifyOfflineSupport({mode:'store'},contact,true),/differs/u);
    assert.throws(()=>verifyOfflineSupport({mode:'store'},contact,false),/Store submission requires offline support/u);
    assert.equal(verifyOfflineSupport({mode:'store'},contact,false,{historical:true}),'legacy-no-offline-contact');
    assert.throws(()=>verifyOfflineSupport({mode:'store'},contact,true,{historical:true}),/differs/u);
    assert.throws(()=>verifyOfflineSupport({mode:'store',offlineSupport:{...contact,href:'mailto:wrong@arcade-support.net'}},
      contact,true,{historical:true}),/differs/u);
    assert.equal(verifyOfflineSupport({mode:'test'},contact,true),'test-distributor-hint');
    assert.throws(()=>verifyOfflineSupport({mode:'test',offlineSupport:contact},contact,true),/distributor/u);
  }
});

test('a committed HTTP error page stays retryable even when loadURL resolves', async () => {
  const origin='https://social.arcade-example.com';
  let mainStatus=503;
  const remoteSession=Object.assign(new EventEmitter(),{
    setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}},
  });
  class Guest {
    constructor(){
      this.webContents=Object.assign(new EventEmitter(),{
        setWindowOpenHandler(){},
        async loadURL(url){
          this.emit('did-navigate',{},url,mainStatus);
          this.emit('did-frame-navigate',{},url+'/frame',503,'Service Unavailable',false);
        },
      });
    }
  }
  const {view,load}=createSocialView({WebContentsView:Guest,session:{fromPartition:()=>remoteSession},
    configuration:{mode:'store',origin}});
  await assert.rejects(load(), /HTTP 503/);
  assert.equal(view.webContents.listenerCount('did-navigate'),0);
  mainStatus=200;
  await load();
  assert.equal(view.webContents.listenerCount('did-navigate'),0);
});

test('a local host view keeps its own preload while the remote view has only its own session', async () => {
  const origin = 'https://social.arcade-example.com';
  const localHost = { preload: 'trusted-local-preload.cjs', fileAccess: 'existing local IPC', partition: 'default' };
  let preferences, load, popup, permissions, filter;
  class Guest {
    constructor(options) {
      preferences = options.webPreferences;
      this.webContents = new EventEmitter();
      this.webContents.loadURL = async url => { load = url; };
      this.webContents.setWindowOpenHandler = callback => { popup = callback; };
    }
  }
  const isolated = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler(cb) { permissions = cb; },
    setPermissionCheckHandler(cb) { assert.equal(cb(), false); },
    webRequest: { onBeforeRequest(cb) { filter = cb; } },
  });
  const { view, load: show } = createSocialView({ WebContentsView: Guest,
    session: { fromPartition(partition) {
      assert.equal(partition, 'persist:arcade-social');
      assert.notEqual(partition, localHost.partition);
      return isolated;
    } },
    configuration: { mode: 'store', origin },
  });
  assert.match(preferences.preload, /[\\/]privacy-preload\.cjs$/);
  assert.deepEqual({...preferences,preload:undefined}, { session: isolated, contextIsolation: true, nodeIntegration: false,
    sandbox: true, devTools: false,preload:undefined });
  assert.equal(localHost.preload, 'trusted-local-preload.cjs');
  await show();
  assert.equal(load, origin);
  for (const kind of ['will-navigate','will-redirect','will-frame-navigate']) {
    view.webContents.emit(kind, { preventDefault: assert.fail }, origin + '/');
    view.webContents.emit(kind, { url: origin + '/login', preventDefault: assert.fail });
    let blocked = 0;
    view.webContents.emit(kind, { preventDefault() { blocked++; } }, { url: 'file:///private/app.html' });
    assert.equal(blocked, 1);
  }
  assert.deepEqual(popup(), { action: 'deny' });
  permissions(null, 'camera', granted => assert.equal(granted, false));
  for (const [url, resourceType, cancel] of [
    [origin+'/api/v1/friends', 'xhr', false],
    ['https://other.example.org/pixel.png', 'image', true],
    ['file:///local/credentials', 'xhr', true],
    ['data:text/javascript,void(0)', 'script', true],
    ['data:image/png;base64,AA', 'image', false],
  ]) filter({ url, resourceType }, decision => assert.equal(decision.cancel, cancel));
});

test('only a direct friend-image download from the active main frame requests a native save',async()=>{
  const origin='https://social.arcade-example.com', id='12345678-1111-2222-3333-123456789abc';
  const url=origin+'/api/v1/conversations/'+id+'/messages/27/image/download';
  const frame={url:origin+'/#chat/'+id}, calls=[];
  let active=true;
  const isolated=Object.assign(new EventEmitter(),{
    setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}},
  });
  class Guest {
    constructor(){
      this.webContents=Object.assign(new EventEmitter(),{
        mainFrame:frame,isDestroyed:()=>false,setWindowOpenHandler(){},
      });
    }
  }
  const {view}=createSocialView({WebContentsView:Guest,session:{fromPartition:()=>isolated},
    configuration:{mode:'store',origin},isActive:()=>active,saveImage:async request=>{calls.push(request);}});
  const fileUrl=url.replace('/image/download','/file/download?account=reader_a');
  function checkFile(raw,name,allowed){
    let blocked=false,options;
    isolated.emit('will-download',{preventDefault(){blocked=true;}},{
      getURL:()=>raw,getURLChain:()=>[raw],getMimeType:()=>'application/octet-stream',
      getFilename:()=>name,setSaveDialogOptions:value=>{options=value;}
    },view.webContents,frame);
    assert.equal(blocked,!allowed);
    if(allowed)assert.equal(options.defaultPath,name);
  }
  checkFile(fileUrl,'测量.bin',true);
  checkFile(fileUrl,'../outside.bin',false);
  checkFile(fileUrl,'..',false);
  checkFile(fileUrl,'NUL.txt',false);
  checkFile(fileUrl.replace('/27/','/0/'),'测量.bin',false);
  checkFile(fileUrl.replace(id,'12345678-1111-2222-3333-123456789abe'),'测量.bin',false);
  checkFile(fileUrl.replace(origin,'https://elsewhere.example'),'测量.bin',false);
  active=false;checkFile(fileUrl,'测量.bin',false);active=true;
  function emit(raw,options={}){
    let cancelled=false;
    const {target=view.webContents,from=frame,chain=[raw],mime='image/png'}=options;
    isolated.emit('will-download',{preventDefault(){cancelled=true;}},
      {getURL:()=>raw,getURLChain:()=>chain,getMimeType:()=>mime},target,from);
    assert.equal(cancelled,true);
  }
  emit(url.replace('/download',''));
  emit(origin+'/icon-192.png');
  emit(url.replace(origin,'https://other.example.org'));
  emit(url+'?next=anything');
  emit(url,{chain:[origin+'/redirect',url]});
  emit(url,{from:{}});
  emit(url,{mime:'application/json'});
  active=false;emit(url);active=true;
  assert.equal(calls.length,0);
  emit(url);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,url.replace('/download',''));
  assert.equal(calls[0].browserSession,isolated);
  assert.equal(calls[0].current(),true);
  frame.url=origin+'/';
  assert.equal(calls[0].current(),false);
});

test('the visible social chat may request only its own top-frame microphone',async()=>{
  const origin='https://social.arcade-example.com';
  const url=origin+'/#chat/12345678-1111-2222-3333-123456789abc';
  let active=true,request,check,deactivated;
  const isolated=Object.assign(new EventEmitter(),{
    setPermissionRequestHandler(fn){request=fn;},
    setPermissionCheckHandler(fn){check=fn;},
    webRequest:{onBeforeRequest(){}},
  });
  class Guest {
    constructor() {
      this.webContents=Object.assign(new EventEmitter(),{
        mainFrame:{url},isDestroyed:()=>false,setWindowOpenHandler(){},
        executeJavaScript:async code=>{deactivated=code;},
      });
    }
  }
  const {view,deactivate}=createSocialView({WebContentsView:Guest,
    session:{fromPartition:()=>isolated},configuration:{mode:'store',origin},isActive:()=>active});
  const caller=view.webContents;
  const details={isMainFrame:true,requestingUrl:origin+'/',mediaType:'audio',mediaTypes:['audio']};
  function expect(allowed,contents=caller,permission='media',requestingOrigin=origin,extra={}) {
    assert.equal(check(contents,permission,requestingOrigin,{...details,...extra}),allowed);
    request(contents,permission,result=>assert.equal(result,allowed),{...details,...extra});
  }
  expect(true);
  expect(false,{});
  expect(false,caller,'display-capture');
  expect(false,caller,'media','https://other.example.org',{requestingUrl:'https://other.example.org/'});
  expect(false,caller,'media',origin,{isMainFrame:false});
  expect(false,caller,'media',origin,{mediaType:'video',mediaTypes:['video']});
  request(caller,'media',result=>assert.equal(result,false),{...details,mediaTypes:['audio','video']});
  active=false;
  expect(false);
  deactivate();
  assert.match(deactivated,/arcade-social-deactivate/);
  active=true;
  caller.mainFrame.url=origin+'/';
  expect(false);
});

test('Windows rectangle tool launch is fixed and limited to the active chat frame',{skip:process.platform!=='win32'},async()=>{
  const origin='https://social.arcade-example.com',frame={url:origin+'/#chat/12345678-1111-2222-3333-123456789abc'};
  let active=true,launch,handler;
  const isolated=Object.assign(new EventEmitter(),{webRequest:{onBeforeRequest(){}},setPermissionRequestHandler(){},setPermissionCheckHandler(){}});
  class Guest{
    constructor(){this.webContents=Object.assign(new EventEmitter(),{mainFrame:frame,isDestroyed:()=>false,setWindowOpenHandler(){},
      ipc:{handle(name,callback){if(name==='arcade:startChatSnip')handler=callback;}}});}
  }
  const {view}=createSocialView({WebContentsView:Guest,session:{fromPartition:()=>isolated},configuration:{origin,mode:'store'},isActive:()=>active,
    spawnSnip:(exe,args,options)=>{
      launch={exe,args,options};
      const child=Object.assign(new EventEmitter(),{unref(){}});
      queueMicrotask(()=>child.emit('spawn'));return child;
    }});
  const event={sender:view.webContents,senderFrame:frame};
  assert.equal(await handler({...event,senderFrame:{}}),false);
  active=false;assert.equal(await handler(event),false);active=true;
  assert.equal(launch,undefined);
  assert.equal(await handler(event),true);
  assert.equal(require('node:path').win32.basename(launch.exe),'SnippingTool.exe');
  assert.deepEqual(launch.args,['/clip']);assert.equal(launch.options.shell,false);
  frame.url=origin+'/privacy.html';assert.equal(await handler(event),false);
});

test('a planet visit uses the peer in the current active human conversation',async()=>{
  const origin='http://127.0.0.1:18747',chat='31234567-1980-4000-8000-123456789abc';
  let active=true,handler,changeDuringRead=false;
  const sent=[],peer={account:'visitor',number:'friend'};
  const session=Object.assign(new EventEmitter(),{
    setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}},
    async fetch(url,{headers}){
      assert.equal(url,origin+'/api/v1/conversations/'+chat);assert.equal(headers['X-Social-Account'],'visitor');
      if(changeDuringRead)view.webContents.mainFrame.url=origin+'/';
      return Response.json({conversation:{type:'direct',members:[{number:'visitor',kind:'human'},{number:'friend',kind:'human'}]}});
    }
  });
  class Guest{
    constructor(){
      this.webContents=Object.assign(new EventEmitter(),{isDestroyed:()=>false,mainFrame:{url:origin+'/#chat/'+chat},
        ipc:{handle:(key,fn)=>{if(key==='arcade:visitFriend')handler=fn;}},setWindowOpenHandler(){}});
    }
  }
  const {view}=createSocialView({WebContentsView:Guest,session:{fromPartition:()=>session},configuration:{mode:'test',origin},
    isActive:()=>active,visitFriend:request=>sent.push(request)});
  const event={sender:view.webContents,senderFrame:view.webContents.mainFrame};
  assert.equal((await handler(event,peer)).state,'opened');
  assert.equal((await handler(event,{...peer,number:'other'})).state,'changed');
  active=false;assert.equal((await handler(event,peer)).state,'changed');
  active=true;changeDuringRead=true;assert.equal((await handler(event,peer)).state,'changed');
  assert.deepEqual(sent,[peer]);
});

test('both release commands reject unsafe world origins before packaging or network access', () => {
  for (const file of ['pack.cjs', 'check-store-release.cjs']) {
    for (const [mode, origin, world, expected] of [
      ['store', 'https://friends.arcade-distribution.com', 'https://127.0.0.1:8123', /Store requires an HTTPS DNS origin/u],
      ['store', 'https://friends.arcade-distribution.com', 'https://world.localhost:8123', /local or reserved DNS name/u],
      ['store', 'https://friends.arcade-distribution.com', 'https://test:user@world.arcade-distribution.com', /without credentials/u],
      ['store', 'https://friends.arcade-distribution.com', 'https://world.arcade-distribution.com/game', /without credentials or a path/u],
      ['test', 'https://arcade-store.test:8123', 'https://world.arcade-distribution.com', /reserved HTTPS test host/u],
    ]) {
      const result = spawnSync(process.execPath, [path.join(__dirname, file), '--mode='+mode,
        '--version=1.0.20.0', '--origin='+origin, '--world-origin='+world],
      {encoding:'utf8', windowsHide:true, timeout:10000});
      assert.ifError(result.error);
      assert.equal(result.status, 1, file);
      assert.match(result.stderr, expected, file);
    }
  }
});
