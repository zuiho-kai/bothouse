'use strict';
// Run on Windows with the H15 host endpoint. This opens isolated real
// Electron windows; only the hardware transport and its clock are supplied.
// node scripts/pets/test-round-connection.cjs path/to/endpoint.exe outputs/h16-ui
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const {setTimeout:sleep}=require('node:timers/promises');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'../..');
const endpoint=fs.realpathSync(process.argv[2]);
const out=path.resolve(process.argv[3]||'outputs/h16-ui');
fs.mkdirSync(out,{recursive:true});
const evidence=fs.mkdtempSync(path.join(out,'run-'));
const profile=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'arcade-h16-'));
const folder=name=>{const p=path.join(profile,name);fs.mkdirSync(p,{recursive:true});return p;};
const home=folder('home'),arc=folder('arcade'),userData=path.join(arc,'electron-profile');
fs.writeFileSync(path.join(arc,'config.json'),JSON.stringify({language:'zh'}));
const sha=b=>createHash('sha256').update(b).digest('hex');
const report={commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  passed:false,hardware:false,h15EndpointSha256:sha(fs.readFileSync(endpoint)),steps:[],sessions:[],screenshots:{},errors:[]};
const usb=(port,serialNumber)=>({path:port,vendorId:'303A',productId:'1001',manufacturer:'Espressif',
  ...(serialNumber?{serialNumber}:{})});
const A=usb('COM41','02:00:00:00:00:A1'),B=usb('COM42','02:00:00:00:00:B2'),anon=usb('COM44');
let app,page,card,session=0;
const button=name=>card.locator('#robot-device-'+name);
const get=()=>page.evaluate(async()=>(await window.arcade.snapshot()).petRobot.device);
async function until(fn,label,timeout=16000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const result=await fn();if(result)return result;await sleep(40);}
  throw Error(label+JSON.stringify(await get()));
}
async function waitState(label,predicate,timeout){
  return until(async()=>{const s=await get();return predicate(s)&&s;},label,timeout);
}
async function record(name,photo=false){
  const snap=await get(),text=await card.innerText();
  report.steps.push({name,snapshot:snap,text});console.log(name,snap.state,snap.delivery?.phase||'');
  if(photo){const png=await card.screenshot({path:path.join(evidence,name+'.png')});report.screenshots[name]=sha(png);}
  return snap;
}
async function start(rows){
  const dir=path.join(evidence,'process-'+(++session));fs.mkdirSync(dir);
  const sys=process.env.SystemRoot,proxy='http://127.0.0.1:1';
  const runtime=path.dirname(execFileSync('where.exe',['g++'],{encoding:'utf8'}).trim().split(/\r?\n/)[0]);
  const env={SystemRoot:sys,WINDIR:sys,ComSpec:path.join(sys,'System32/cmd.exe'),PATH:[path.join(sys,'System32'),sys,runtime].join(';'),
    USERPROFILE:home,HOME:home,APPDATA:folder('roaming'),LOCALAPPDATA:folder('local'),ProgramData:folder('system-data'),
    AGENT_ARCADE_HOME:arc,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(folder('claude'),'settings.json'),
    H16_PROFILE:profile,H16_ENDPOINT:endpoint,H16_CAPTURE:dir,H16_DEVICES:JSON.stringify(rows),
    HTTP_PROXY:proxy,HTTPS_PROXY:proxy,ALL_PROXY:proxy,TEMP:os.tmpdir(),TMP:os.tmpdir()};
  app=await _electron.launch({executablePath:require('electron'),cwd:root,args:[path.join(root,'test/fixtures/robot-usb-host.cjs'),
    '--user-data-dir='+userData,'--disable-background-networking','--disable-component-update','--disable-breakpad','--disable-sync',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--proxy-server='+proxy,'--proxy-bypass-list=<-loopback>'],env});
  page=await until(async()=>app.windows().find(p=>p.url().endsWith('/src/ui/index.html')),'missing main window',20000);
  page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(String(e)));
  await page.locator('#shell-bar [data-view="settings"]').click();card=page.locator('#robot-device-card');
  await card.waitFor();await card.scrollIntoViewIfNeeded();
}
async function finish(){
  if(!app)return;
  try{
    report.sessions.push(await app.evaluate(()=>({lists:h16.lists,opens:h16.opens,reads:h16.reads,writes:h16.writes,drains:h16.drains,events:h16.events,errors:h16.errors})));
    report.errors.push(...report.sessions.at(-1).errors);
  }finally{await app.close();app=null;}
}
async function scan(rows){await app.evaluate((_,v)=>h16.setPorts(v),rows);await button('refresh').click();}
async function select(label){const s=await waitState('candidate '+label,s=>s.candidates.some(c=>c.label.includes(label)));
  await button('choice').selectOption(s.candidates.find(c=>c.label.includes(label)).id);}
const confirmed=s=>s.portOpen&&s.state==='connected'&&s.delivery?.phase==='confirmed';
async function connect(label){await select(label);await button('connect').click();}
const {inspectPictures}=require('./round-recording.cjs');
async function main(){
 await start([]);
 assert.deepEqual(await app.evaluate(()=>[h16.lists,h16.opens.length]),[0,0]);
 await page.locator('#petRobotPreview').click();await until(async()=>(await page.evaluate(async()=>(await arcade.snapshot()).petRobot.previewOpen)),'preview did not open');
 assert.deepEqual(await app.evaluate(()=>[h16.lists,h16.opens.length]),[0,0]);
 await page.locator('#petRobotPreview').click();
 await scan([]);assert.equal((await get()).candidates.length,0);assert(await button('connect').isDisabled());
 assert.deepEqual(await app.evaluate(()=>[h16.lists,h16.opens.length]),[1,0]);
 await record('01-no-device',true);
 await scan([A,B]);await select(B.serialNumber);assert.equal((await get()).candidates.length,2);
 assert((await button('choice').innerText()).includes(A.serialNumber));assert((await button('choice').innerText()).includes(B.serialNumber));
 await record('02-selected-second-board',true);
 report.screenshots['02-full-settings']=sha(await page.screenshot({path:path.join(evidence,'02-full-settings.png')}));
 await app.evaluate(()=>{h16.holdHello=true;h16.holdAck=true;});
 await button('connect').click();await waitState('port opened before identification',s=>s.portOpen&&s.state==='connecting');
 await record('03-port-open',true);
 await app.evaluate(()=>{h16.holdHello=false;h16.flush();});
 await waitState('matched handshake',s=>s.state==='connected'&&s.delivery?.phase==='syncing');
 await record('04-syncing',true);
 await until(()=>app.evaluate(()=>h16.latestAck!==null),'first board ACK');
 const oldAck=await app.evaluate(()=>h16.latestAck.toString('hex'));
 await app.evaluate(()=>{h16.holdAck=false;h16.flush();});
 await waitState('first picture',confirmed);const first=await record('05-picture-confirmed',true);assert(first.remembered);
 await page.locator('#petRobotPreview').click();
 const preview=await until(()=>app.windows().find(w=>w.url().includes('/pet/robot/twin.html')),'preview unavailable');
 await preview.waitForFunction(()=>document.body.dataset.asleep==='false');
 const touchStart=await app.evaluate(()=>h16.events.length);
 await preview.locator('#stage').click({position:{x:120,y:120}});
 const touched=await until(()=>app.evaluate((_,v)=>h16.events.slice(v.index).find(e=>e.ack&&e.ack.session===v.session&&e.ack.checksum!==v.checksum),
   {index:touchStart,session:first.delivery.session,checksum:first.delivery.checksum}),'preview touch did not produce a new picture ACK');
 report.previewTouch={before:first.delivery,after:touched};
 await waitState('touch ACK reflected by Settings',s=>confirmed(s)&&s.delivery.session===touched.ack.session&&s.delivery.id===touched.ack.id&&s.delivery.checksum===touched.ack.checksum);
 await record('05b-preview-touch',true);
 await page.locator('#petRobotPreview').click();
 await page.locator('#settings-language-en').click();
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/src/ui/index.html'));w.setMinimumSize(380,380);w.setContentSize(440,780);});
 await card.scrollIntoViewIfNeeded();await until(async()=>(await card.innerText()).includes('53 mm desk robot connection'),'English controls');
 const fits=await card.evaluate(n=>n.scrollWidth<=n.clientWidth+1 && n.getBoundingClientRect().width<=innerWidth);
 assert(fits);await record('06-english-narrow',true);
 const replacement=usb(B.path,'02:00:00:00:00:C3');
 await app.evaluate((_,rows)=>{h16.setPorts(rows);return h16.unplug();},[A,replacement]);
 await waitState('lost serial identity',s=>!s.portOpen&&s.remembered);
 await button('refresh').click();await waitState('replacement list',s=>s.candidates.some(c=>c.label.includes(replacement.serialNumber)));
 await record('07-replaced-on-same-path',true);assert.equal(await app.evaluate(()=>h16.opens.length),1);
 const moved=usb('COM49',B.serialNumber);
 await app.evaluate(()=>{h16.holdAck=true;});
 await scan([A,replacement,moved]);
 await until(()=>app.evaluate(()=>h16.opens.at(-1)?.path==='COM49'&&h16.events.some(x=>x.port.endsWith('COM49')&&x.held&&x.ack)),'same serial at new path',24000);
 await app.evaluate((_,hex)=>h16.inject(hex),oldAck);await sleep(140);
 assert(!confirmed(await get()));await record('08-old-ack-after-reconnect');
 await app.evaluate(()=>{h16.holdAck=false;h16.flush();});
 await waitState('new matching ACK',confirmed);await record('09-same-board-new-port',true);
 await finish();
 await start([A,moved]);await waitState('auto reconnect after restart',confirmed,24000);await record('10-restart-restored');
 await button('disconnect').click();await waitState('user disconnected',s=>s.state==='idle'&&!s.portOpen&&s.remembered);await record('11-disconnect-keeps-device');
 await finish();await start([A,moved]);await button('refresh').click();await waitState('remembered device after explicit disconnect',s=>s.remembered&&!s.portOpen&&s.candidates.length===2);
 assert.equal(await app.evaluate(()=>h16.opens.length),0);await record('12-restart-after-disconnect');
 await select(A.serialNumber);
 assert((await button('target').innerText()).includes(A.serialNumber));
 assert((await button('saved').innerText()).includes(B.serialNumber));
 await app.evaluate(()=>{h16.holdHello=true;});
 await button('connect').click();await waitState('new choice with old remembered identity',s=>s.portOpen&&s.state==='connecting');
 assert((await button('target').innerText()).includes(A.serialNumber));
 assert((await button('saved').innerText()).includes(B.serialNumber));
 await record('12b-different-selected-and-remembered',true);
 await button('disconnect').click();await waitState('cancel before handshake',s=>s.state==='idle'&&s.remembered);
 await app.evaluate(()=>{h16.holdHello=false;});
 await scan([A,moved]);
 await connect(B.serialNumber);await waitState('manual reconnection',confirmed);
 await button('forget').click();await waitState('forgotten',s=>!s.remembered&&!s.portOpen);await record('13-forgotten',true);
 await scan([anon]);await select(anon.path);assert.equal((await get()).candidates[0].rememberable,false);
 await record('14-session-only',true);await button('connect').click();await waitState('anonymous board',confirmed);
 assert.equal((await get()).remembered,false);
 await app.evaluate((_,p)=>{h16.setPorts([p]);return h16.unplug();},usb(anon.path,'02:00:00:00:00:D4'));
 await waitState('anonymous disconnect',s=>!s.portOpen&&!s.remembered);
 const before=await app.evaluate(()=>h16.opens.length);await button('refresh').click();await sleep(350);
 assert.equal(await app.evaluate(()=>h16.opens.length),before);await record('15-anonymous-replaced');
 await finish();await start([anon,moved]);await button('refresh').click();await waitState('final restart',s=>!s.remembered&&!s.portOpen&&s.candidates.length===2);
 assert.equal(await app.evaluate(()=>h16.opens.length),0);await record('16-clean-restart');
 await finish();assert.deepEqual(report.errors,[]);
 const originalPort=path.join(evidence,'process-1','port-01-'+B.path);
 report.activePictures=await inspectPictures(originalPort);
 const original=report.activePictures.find(p=>p.id===first.delivery.id&&p.session===first.delivery.session);
 assert(original?.tiles>1&&original.checksum===first.delivery.checksum);
 assert(report.activePictures.some(p=>p.scanMatchesCentered&&p.checksum===original.checksum),'H15 idle centered scanout mismatch');
 const changed=report.activePictures.find(p=>p.step===touched.step&&p.checksum===touched.ack.checksum);
 assert(changed&&changed.pixelsSha256!==original.pixelsSha256&&changed.scanSha256!==original.scanSha256);
 report.passed=true;
}
main().catch(e=>{report.failure=String(e.stack);console.error(report.failure);process.exitCode=1;}).finally(async()=>{
 try{await finish();}finally{fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(evidence);}
});
