'use strict';
// node scripts/pets/test-desktop-portrait.cjs [--out DIRECTORY]
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {setTimeout: pause} = require('node:timers/promises');
const {fileURLToPath} = require('node:url');
const root = path.resolve(__dirname, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function launch() {
  const args = process.argv.slice(2);
  assert(!args.length || (args.length === 2 && args[0] === '--out' && args[1]), 'Use [--out DIRECTORY]');
  const base = path.resolve(args[1] || path.join(root, 'outputs', 'desktop-portrait'));
  fs.mkdirSync(base, {recursive:true});
  const output = fs.mkdtempSync(path.join(base, 'run-')), temp = fs.realpathSync(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(temp, 'arcade-portrait-'));
  const env = {HOME:profile, USERPROFILE:profile, H28_PROFILE:profile, H28_OUTPUT:output};
  for (const name of ['SystemRoot','WINDIR','ComSpec','SystemDrive','PATH','PATHEXT','TEMP','TMP','TMPDIR','LANG','LC_ALL','LC_CTYPE']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  try {
    for (const name of ['APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','AGENT_ARCADE_HOME']) {
      env[name] = path.join(profile,name);
      fs.mkdirSync(env[name]);
    }
    const child = spawnSync(require('electron'), ['--user-data-dir='+path.join(profile,'electron'),__filename],
      {cwd:root, env, windowsHide:true, stdio:'inherit', timeout:150000});
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
  } finally {
    assert.equal(path.dirname(fs.realpathSync(profile)),temp);
    assert.match(path.basename(profile),/^arcade-portrait-[a-zA-Z0-9]+$/);
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:4,retryDelay:250});
    console.log(output);
  }
}

// A deterministic compositor input clock, installed before the actual page loads.
// Browser-generated pointer and media events, preload IPC and the App reply timer remain live.
function installClock() {
  let frame=0, id=0;
  const queued = new Map();
  const compositorFrame = window.requestAnimationFrame.bind(window);
  window.__portraitCompositorFrame = () => new Promise(resolve => compositorFrame(() => resolve()));
  Object.defineProperty(performance, 'now', {value:() => frame*1000/30});
  window.requestAnimationFrame = cb => {queued.set(++id,cb); return id;};
  window.cancelAnimationFrame = token => queued.delete(token);
  window.__portraitPending = () => queued.size;
  window.__portraitStep = count => {
    for (let n=0; n<count; n++) {
      const callbacks=[...queued.values()];
      queued.clear();
      frame++;
      callbacks.forEach(fn=>fn(frame*1000/30));
    }
    return frame;
  };
}

async function run() {
  const {app,BrowserWindow,ipcMain,screen,session,nativeImage} = require('electron');
  const {PetWindow,supported} = require('../../src/pet/window.cjs');
  const {mainHarness} = require('../../test/helpers/desktop-chat-main-harness.cjs');
  const out=process.env.H28_OUTPUT, profile=process.env.H28_PROFILE;
  app.setPath('userData',path.join(profile,'electron'));
  app.setPath('appData',profile);
  for (const key of ['disable-background-networking','disable-component-update','disable-sync','disable-renderer-backgrounding','disable-backgrounding-occluded-windows','use-mock-keychain']) app.commandLine.appendSwitch(key);
  app.commandLine.appendSwitch('password-store','basic');
  app.commandLine.appendSwitch('force-device-scale-factor','1');
  const sources=new Set(['scripts/pets/test-desktop-portrait.cjs','test/helpers/desktop-chat-main-harness.cjs',
    'src/main.cjs','src/bot/desktop-chat.cjs','src/pet/presence.cjs','src/pet/window.cjs','src/pet/preload.cjs']);
  const report={passed:false,platform:process.platform,productSupported:supported(),electron:process.versions.electron,
    boundary:'Real PetWindow/preload/page on the host platform. Isolated mainHarness, local delayed provider, simulated screen cursor, native Electron input, 30 Hz renderer clock, DPR 1.',
    gitHead:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout?.trim(),
    captures:{},transitions:{},errors:[],remote:[],desktopTouches:[],otherBodyReactions:[]};
  const images=new Map();
  let pet,wc,focused=true,point={x:-2000,y:-2000};
  async function until(fn,label) {
    const end=Date.now()+12000;
    while (Date.now()<end) { const value=await fn(); if (value) return value; await pause(20); }
    throw Error('Timed out: '+label);
  }
  try {
    assert.ok(supported(), 'Run on Windows or macOS with the product desktop window enabled on this platform');
    await app.whenReady();
    app.on('window-all-closed',()=>{});
    session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(req,done)=>{
      report.remote.push(new URL(req.url).origin);
      done({cancel:true});
    });
    class PreviewWindow extends BrowserWindow {
      setIgnoreMouseEvents(ignore,options) {
        this.ignoring=ignore;
        return super.setIgnoreMouseEvents(ignore,options);
      }
      async loadFile(file,options) {
        if (!this.webContents.getURL()) await this.webContents.loadURL('about:blank');
        const dbg=this.webContents.debugger;
        dbg.attach('1.3');
        dbg.on('message',(_e,name,args)=>{
          if (name!=='Network.responseReceived'||!args.response.url.startsWith('file:')) return;
          const relative=path.relative(root,fileURLToPath(args.response.url)).split(path.sep).join('/');
          if (relative.startsWith('src/')) sources.add(relative);
        });
        await dbg.sendCommand('Page.enable');
        await dbg.sendCommand('Network.enable');
        await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:'('+installClock.toString()+')()'});
        await dbg.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
        return super.loadFile(file,options);
      }
    }
    const h=mainHarness(), p=h.pet(), presence=p.presence, service=h.a;
    h.win.isFocused=()=>focused;
    h.win.focus=()=>{focused=true;};
    h.win.show=()=>{};
    service.localStart=async()=>{};
    service.localConversationContext=()=>({dispatcher:service.dispatcher,scope:service.socialScope,character:'claude-ju',settings:'{}',generation:1});
    await h.invoke('desktopConversationSelect',{accountId:'a',kind:'local'});
    let chat=await h.open(), serial=0;
    const settings={enabled:true,pet:'ju',size:'m'};
    const monitor={getCursorScreenPoint:()=>point};
    for(const key of ['getAllDisplays','getDisplayMatching','getDisplayNearestPoint','getPrimaryDisplay']) monitor[key]=screen[key].bind(screen);
    pet=new PetWindow({electron:{BrowserWindow:PreviewWindow,ipcMain,screen:monitor},
      getSettings:()=>settings,saveSettings:value=>Object.assign(settings,value),language:()=>'zh',
      onOpen:()=>{report.openCount=(report.openCount||0)+1;p.openApp();},
      onTouch:kind=>{report.desktopTouches.push(kind); presence.touched('window',kind);},
      interval:{set:()=>1,clear(){}}});
    presence.attach('window',pet);
    presence.attach('robot',{react:kind=>report.otherBodyReactions.push(kind)});
    pet.apply();
    wc=pet.win.webContents;
    wc.on('console-message',info=>{if(info.level==='error') report.errors.push(info.message);});
    await until(()=>{if(pet.problem) throw Error(pet.problem);return pet.ready;},'pet:ready via preload');
    assert.equal(path.resolve(fileURLToPath(wc.getURL())),path.join(root,'src/pet/pet.html'));
    const js = code=>wc.executeJavaScript(code);
    const step = n=>js('window.__portraitStep('+n+')');
    const state=()=>js(`({pose:document.body.dataset.pose,gesture:document.body.dataset.gesture,activity:document.body.dataset.activity,
      reduced:document.body.dataset.reducedMotion,cue:document.querySelector('#cue').hidden?'':document.querySelector('#cue').textContent.trim(),
      media:matchMedia('(prefers-reduced-motion: reduce)').matches})`);
    const png=async()=>Buffer.from(await js("document.querySelector('#stage').toDataURL('image/png').split(',')[1]"),'base64');
    async function expect(want) {
      return until(async()=>{
        await step(1);
        const value=await state();
        return Object.entries(want).every(([k,v])=>value[k]===v)&&value;
      },JSON.stringify(want));
    }
    const compositorFrame=()=>Promise.race([js('window.__portraitCompositorFrame()'),pause(150)]);
    async function capture(name) {
      const data=await png(), canvas=nativeImage.createFromBuffer(data), s=canvas.getSize();
      assert.deepEqual(s,settings.size==='m'?{width:270,height:350}:{width:210,height:270});
      const bitmap=canvas.toBitmap(), alpha=bitmap.filter((_v,i)=>i%4===3&&bitmap[i]>200);
      assert.ok(alpha.length>s.width*s.height*.08&&bitmap[3]===0,'Expected a transparent portrait');
      // Canvas changes are synchronous. A native window capture reads the last presented surface.
      await compositorFrame();
      await compositorFrame();
      const windowImage=await wc.capturePage();
      assert.ok(!windowImage.isEmpty());
      const shot=windowImage.toPNG();
      assert.deepEqual(windowImage.getSize(),s);
      const surface=windowImage.toBitmap();
      let checked=0, differing=0;
      for(let i=Math.ceil(s.height*.4)*s.width*4;i<bitmap.length;i+=4) {
        if(bitmap[i+3]<=248) continue;
        checked++;
        if([0,1,2].some(c=>Math.abs(bitmap[i+c]-surface[i+c])>4)) differing++;
      }
      assert.ok(checked>1000 && differing/checked<.005,name+' native surface differs from canvas: '+differing+'/'+checked);
      const bounds=await js(`Array.from(document.querySelectorAll('#cue span')).filter(el=>!el.hidden&&!el.parentElement.hidden).map(el=>{
        const r=el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};
      })`);
      const badges=bounds.map(rect=>{
        const pixels=windowImage.crop(rect).toBitmap();
        let glyphPixels=0;
        for(let y=5;y<rect.height-5;y++) for(let x=6;x<rect.width-6;x++) {
          const i=(y*rect.width+x)*4;
          if(pixels[i+3]>200 && pixels[i+2]<160) glyphPixels++;
        }
        assert.ok(glyphPixels>3,'Badge must contain a visible glyph');
        return {rect,glyphPixels,sha256:sha(pixels)};
      });
      fs.writeFileSync(path.join(out,name+'-canvas.png'),data);
      fs.writeFileSync(path.join(out,name+'-window.png'),shot);
      images.set(name,bitmap);
      report.captures[name]={...await state(),size:s,opaquePixels:alpha.length,nativeCheckedPixels:checked,
        nativePixelsOverTolerance:differing,badges,canvasSHA256:sha(data),windowSHA256:sha(shot)};
    }
    function difference(a,b) {
      const old=images.get(a), next=images.get(b);
      assert.equal(old.length,next.length);
      let n=0;
      for(let i=0;i<old.length;i+=4) if(old.readUInt32LE(i)!==next.readUInt32LE(i)) n++;
      assert.ok(n>30,a+' and '+b+' should show different character pixels');
      return n;
    }
    async function begin() {
      const entered=Promise.withResolvers(), reply=Promise.withResolvers();
      service.localReply=()=>{entered.resolve();return reply.promise;};
      const done=h.invoke('desktopChatSend',{sessionId:chat.sessionId,contextId:chat.contextId,requestId:'portrait-'+ ++serial,text:'本地测试'});
      await Promise.race([entered.promise,done.then(()=>{throw Error('Chat ended before reaching fixture');})]);
      return {reply,done};
    }
    async function media(reduced) {
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia',{
        media:'screen',features:[{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]});
      // Deliver Chromium's real media change without advancing the portrait's fade clock.
      const before=Date.now();
      let observed;
      do {
        observed=await state();
        if(observed.reduced===String(reduced) && observed.media===reduced) return;
        await compositorFrame();
      } while(Date.now()-before<4000);
      throw Error('Media preference was not delivered: '+JSON.stringify({
        reduced,observed,visibility:await js('document.visibilityState'),pending:await js('window.__portraitPending()')}));
    }
    async function normalTurn(prefix,checkFade) {
      const turn=await begin();
      await expect({pose:'thinking',activity:'thinking',cue:'…'});
      await step(1);
      const intermediate=sha(await png());
      await step(7);
      const steady=sha(await png());
      assert.equal(intermediate===steady,!checkFade,'Preference should govern the transition pixels');
      report.transitions[prefix]={during:intermediate,settled:steady,reduced:(await state()).media};
      await capture(prefix+'-thinking');
      turn.reply.resolve({outcome:'reply_ended',text:'收到。'});
      assert.equal((await turn.done).outcome,'reply_ended');
      await expect({pose:'speaking',activity:'speaking',cue:''});
      await step(7);
      await capture(prefix+'-speaking');
      await expect({pose:'idle',activity:'idle'});
      await step(7);
      assert.ok(presence.touched('robot','pat'));
      await expect({pose:'pat',gesture:'pat'});
      await step(7);
      await capture(prefix+'-shared-pat');
      await step(60);
      await expect({pose:'idle',gesture:''});
    }
    await expect({pose:'idle',activity:'idle',reduced:'true',media:true});
    await capture('medium-idle');
    await step(18);
    assert.equal(sha(await png()),report.captures['medium-idle'].canvasSHA256);
    await normalTurn('medium',false);
    const {openRecordedTouch}=require('./recorded-round-touch.cjs');
    sources.add('scripts/pets/recorded-round-touch.cjs');
    sources.add('scripts/pets/replay-round-link.cjs');
    sources.add('test/fixtures/h17-recorded-touch.json');
    sources.add('test/fixtures/h17-idle.rgb565.gz');
    presence.attach('robot-device',{});
    const device=await openRecordedTouch({onTouch:kind=>presence.touched('robot-device',kind)});
    try {
      report.h17=device.proof;
      assert.equal(await device.receive('first'),'poke');
      await expect({pose:'pat',gesture:'poke'});
      await capture('medium-h17');
      assert.equal(report.captures['medium-h17'].canvasSHA256,report.captures['medium-shared-pat'].canvasSHA256);
      assert.equal(await device.receive('duplicate'),null);
    } finally {await device.close();}
    await expect({pose:'idle',gesture:''});
    const b=pet.win.getBounds(), x=Math.floor(b.width/2);
    const neutral=images.get('medium-idle'), touched=images.get('medium-shared-pat');
    let y=Math.floor(b.height*.6);
    while (y<b.height && Math.min(neutral[(y*b.width+x)*4+3],touched[(y*b.width+x)*4+3])<=235) y++;
    assert.ok(y<b.height,'Expected an opaque touch target in both poses');
    point={x:b.x+x,y:b.y+y};
    pet.poll();
    await step(2);
    async function click(expected) {
      const count=report.desktopTouches.length;
      for(const type of ['mouseDown','mouseUp']) wc.sendInputEvent({type,x,y,button:'left',clickCount:1});
      await until(()=>report.desktopTouches.length>count,'native pointer -> pet:touch');
      assert.equal(report.desktopTouches.at(-1),expected);
    }
    await click('poke');
    await expect({gesture:'poke',pose:'pat'});
    await step(6);
    await capture('medium-poke');
    await click('poke');
    await step(3);
    await click('huff');
    await expect({gesture:'huff',pose:'huff'});
    await step(8);
    await capture('medium-huff');
    assert.deepEqual(report.otherBodyReactions,['poke','poke','poke','huff']);
    await step(115);
    await expect({pose:'idle',gesture:''});
    await capture('medium-restored');
    assert.equal(report.captures['medium-idle'].canvasSHA256,report.captures['medium-restored'].canvasSHA256);
    const overlap=await begin();
    await expect({activity:'thinking',pose:'thinking'});
    assert.ok(presence.touched('robot','pat'));
    await expect({gesture:'pat',pose:'pat',activity:'thinking'});
    overlap.reply.resolve({outcome:'reply_ended'});
    assert.equal((await overlap.done).outcome,'reply_ended');
    await expect({gesture:'pat',pose:'pat',activity:'speaking'});
    await capture('medium-pat-during-reply');
    await expect({gesture:'',pose:'speaking',activity:'speaking'});
    await capture('medium-reply-after-pat');
    assert.equal(report.captures['medium-shared-pat'].canvasSHA256,report.captures['medium-pat-during-reply'].canvasSHA256);
    assert.equal(report.captures['medium-speaking'].canvasSHA256,report.captures['medium-reply-after-pat'].canvasSHA256);
    await expect({pose:'idle',activity:'idle'});

    function position(px,py) {
      const current=pet.win.getBounds();
      point={x:current.x+px,y:current.y+py};
      pet.poll();
    }
    function input(type,px,py) {wc.sendInputEvent({type,x:px,y:py,button:'left',clickCount:1});}
    position(1,1);
    await until(()=>pet.win.ignoring===true,'transparent pixel -> native click-through');
    const ignoresBlank=pet.win.ignoring, touchesAtBlank=report.desktopTouches.length;
    input('mouseDown',1,1);
    input('mouseUp',1,1);
    await pause(100);
    const blankTouchCount=report.desktopTouches.length-touchesAtBlank;
    assert.equal(blankTouchCount,0);
    position(x,y);
    await until(()=>pet.win.ignoring===false,'portrait pixel -> native interaction');
    const ignoresBody=pet.win.ignoring;
    input('mouseDown',x,y);
    input('mouseMove',x-12,y-5);
    await until(()=>pet.drag,'native drag-start');
    const before=pet.win.getBounds();
    point={x:point.x-32,y:point.y-19};
    pet.poll();
    await until(()=>pet.win.getBounds().x<before.x,'drag moved native window');
    const after=pet.win.getBounds();
    input('mouseUp',x,y);
    await until(()=>!pet.drag,'native drag-end');
    assert.deepEqual(report.desktopTouches.slice(-2),['held','released']);
    assert.equal(settings.x,after.x);
    assert.equal(settings.y,after.y);
    report.pointer={blankIgnored:ignoresBlank,blankTouchCount,bodyIgnored:ignoresBody,
      dragDX:after.x-before.x,dragDY:after.y-before.y,saved:{x:settings.x,y:settings.y}};
    settings.size='s';
    pet.apply();
    await until(()=>js('innerWidth===210 && innerHeight===270'),'small viewport');
    await expect({pose:'idle',activity:'idle'});
    await step(7);
    await capture('small-idle');
    await media(false);
    await normalTurn('small',true);
    assert.ok(presence.touched('robot','pat'));
    await expect({pose:'pat'});
    await step(1);
    const activeFade=sha(await png());
    await media(true);
    await capture('small-reduce-mid-pat');
    assert.notEqual(activeFade,report.captures['small-reduce-mid-pat'].canvasSHA256);
    assert.equal(report.captures['small-shared-pat'].canvasSHA256,report.captures['small-reduce-mid-pat'].canvasSHA256);
    report.midFade={beforeReduce:activeFade,immediateReduced:report.captures['small-reduce-mid-pat'].canvasSHA256,
      expectedSettled:report.captures['small-shared-pat'].canvasSHA256,pendingFrames:await js('window.__portraitPending()')};
    assert.equal(report.midFade.pendingFrames,0);
    await expect({pose:'idle',reduced:'true'});
    await step(8);
    await capture('small-reduced');
    assert.equal(report.captures['small-idle'].canvasSHA256,report.captures['small-reduced'].canvasSHA256);
    settings.size='m';
    pet.apply();
    await until(()=>js('innerWidth===270 && innerHeight===350'),'medium viewport');
    focused=false;
    service.localReply=async()=>({outcome:'error'});
    const value={sessionId:chat.sessionId,contextId:chat.contextId,requestId:'failed',text:'本地测试'};
    assert.equal((await h.invoke('desktopChatSend',value)).code,'reply_failed');
    p.handback();
    await expect({activity:'failed',cue:'×!'});
    await capture('medium-failed-unread');
    const lost=await begin();
    p.rendererGone(null,{reason:'crashed'});
    await expect({activity:'unknown',cue:'?!'});
    await capture('medium-unknown-unread');
    lost.reply.resolve({outcome:'reply_ended'});
    assert.equal((await lost.done).outcome,'cancelled');
    position(1,1);
    await until(()=>pet.win.ignoring===true,'blank area beside unread character is click-through');
    position(x,y);
    await until(()=>pet.win.ignoring===false,'unread character is interactive');
    const touchesBeforeOpen=report.desktopTouches.length;
    input('mouseDown',x,y);
    input('mouseUp',x,y);
    await expect({activity:'unknown',cue:'?'});
    await capture('medium-unknown-opened');
    assert.equal(report.openCount,1);
    assert.equal(report.desktopTouches.length,touchesBeforeOpen);
    assert.deepEqual(presence.snapshot(),{activity:'unknown',attention:false});
    report.unreadClick={opens:report.openCount,additionalTouches:report.desktopTouches.length-touchesBeforeOpen,
      cueAfterOpen:(await state()).cue,presence:presence.snapshot()};
    const failureMarks=report.captures['medium-failed-unread'].badges;
    const unknownMarks=report.captures['medium-unknown-unread'].badges;
    assert.equal(failureMarks.length,2);
    assert.equal(unknownMarks.length,2);
    assert.notEqual(failureMarks[0].sha256,unknownMarks[0].sha256);
    assert.deepEqual(report.captures['medium-unknown-opened'].badges,[unknownMarks[0]]);
    report.changedPixels={};
    for(const size of ['small','medium']) for(const key of ['thinking','speaking','shared-pat']) {
      report.changedPixels[size+'-'+key]=difference(size+'-idle',size+'-'+key);
    }
    report.changedPixels.pokeVsHuff=difference('medium-poke','medium-huff');
    assert.deepEqual(report.errors,[]);
    assert.deepEqual(report.remote,[]);
    for(const pose of ['idle','thinking','speaking','pat','huff'])
      assert.ok(sources.has('src/pet/portrait/art/'+pose+'.png'),'Desktop did not load '+pose+' art');
    report.passed=true;
  } catch(error) {
    report.failure=error.stack || String(error);
    console.error(report.failure);
  } finally {
    report.sources=Object.fromEntries([...sources].sort().map(n=>[n,sha(fs.readFileSync(path.join(root,n)))]));
    pet?.close();
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
    app.exit(report.passed?0:1);
  }
}
if (process.versions.electron) run().catch(e=>{console.error(e);require('electron').app.exit(1);}); else launch();
