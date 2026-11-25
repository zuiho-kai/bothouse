'use strict';
// node scripts/pets/test-round-touch.cjs H17-endpoint.exe H15-endpoint.exe [output directory]
// The file/stdin endpoints run the production firmware. No physical USB port is opened.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const {setTimeout:pause}=require('node:timers/promises'),{_electron}=require('playwright');
const {inspectPictures}=require('./round-recording.cjs');
const root=path.resolve(__dirname,'../..'),cacheTest=process.argv[2]==='--expression-cache';
const [touchPath,legacyPath,output]=process.argv.slice(cacheTest?4:2);
const h17=fs.realpathSync(touchPath),h15=fs.realpathSync(legacyPath);
const h20=cacheTest?fs.realpathSync(process.argv[3]):null;
const parent=path.resolve(output||(cacheTest?'outputs/round-expression-cache':'outputs/h17-touch-ui'));
fs.mkdirSync(parent,{recursive:true});
const out=fs.mkdtempSync(path.join(parent,'run-')),sha=b=>createHash('sha256').update(b).digest('hex');
const report={passed:false,hardware:false,source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  endpoints:{touch:sha(fs.readFileSync(h17)),legacy:sha(fs.readFileSync(h15))},screenshots:{},cases:{},errors:[]};
const board={path:'COM42',vendorId:'303A',productId:'1001',serialNumber:'02:00:00:00:00:B2'};
const portDir=name=>path.join(out,name,'port-01-'+board.path);
let app,page,preview,current;
const snapshot=()=>page.evaluate(async()=>(await arcade.snapshot()).petRobot.device);
async function until(fn,label,ms=12000){
  const end=Date.now()+ms;
  while(Date.now()<end){const v=await fn();if(v)return v;await pause(25);}
  throw Error(label);
}
async function openCase(name,exe,initial){
 const dir=path.join(out,name);fs.mkdirSync(dir);
 const profile=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'arcade-h16-'));
 const sub=n=>{const p=path.join(profile,n);fs.mkdirSync(p,{recursive:true});return p;};
 const home=sub('home'),arc=sub('arcade'),sys=process.env.SystemRoot,proxy='http://127.0.0.1:1';
 fs.writeFileSync(path.join(arc,'config.json'),JSON.stringify({language:'zh'}));
 const runtime=path.dirname(execFileSync('where.exe',['g++'],{encoding:'utf8'}).trim().split(/\r?\n/)[0]);
 const env={SystemRoot:sys,WINDIR:sys,ComSpec:path.join(sys,'System32/cmd.exe'),PATH:[path.join(sys,'System32'),sys,runtime].join(';'),
  HOME:home,USERPROFILE:home,APPDATA:sub('roaming'),LOCALAPPDATA:sub('local'),ProgramData:sub('program-data'),
  AGENT_ARCADE_HOME:arc,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(sub('claude'),'settings.json'),
  H16_PROFILE:profile,H16_ENDPOINT:exe,H16_CAPTURE:dir,H16_DEVICES:JSON.stringify([board]),H17_TOUCH:'1',H20_CACHE:cacheTest?'1':'0',
  HTTP_PROXY:proxy,HTTPS_PROXY:proxy,ALL_PROXY:proxy,TEMP:os.tmpdir(),TMP:os.tmpdir()};
 app=await _electron.launch({executablePath:require('electron'),cwd:root,env,args:[path.join(root,'test/fixtures/robot-usb-host.cjs'),
  '--user-data-dir='+path.join(arc,'electron-profile'),'--disable-background-networking','--disable-component-update','--disable-sync',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--proxy-server='+proxy,'--proxy-bypass-list=<-loopback>']});
 current=name;
 page=await until(()=>app.windows().find(w=>w.url().endsWith('/src/ui/index.html')),'main window');
 page.on('pageerror',e=>report.errors.push(String(e)));
 await app.evaluate((_,v)=>{h16.initialContact=v.initial;h16.failModeWrite=v.name==='mode-write-failure';},{initial,name});
 await page.locator('#shell-bar [data-view="settings"]').click();
 await page.locator('#petRobotPreview').click();
 preview=await until(()=>app.windows().find(w=>w.url().includes('/pet/robot/twin.html')),'preview window');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/pet/robot/twin.html')).setIgnoreMouseEvents(true));
 await preview.waitForFunction(()=>document.body.dataset.asleep==='false');
 await page.locator('#robot-device-refresh').click();
 const s=await until(async()=>{const s=await snapshot();return s.candidates.length&&s;},'USB choices');
 await page.locator('#robot-device-choice').selectOption(s.candidates[0].id);
 await page.locator('#robot-device-connect').click();
 const delivery=await until(async()=>{const d=(await snapshot()).delivery;return d?.phase==='confirmed'&&d;},'picture ACK after connecting');
 const hello=await app.evaluate(()=>JSON.parse(Buffer.from(h16.events.filter(e=>e.type===0x81).at(-1).payload,'hex').toString()));
 report.cases[name]={hello,delivery,events:[],fanout:[]};
 return delivery;
}
async function closeCase(){
 if(!app)return;
 try{
  const r=await app.evaluate(()=>({events:h16.events,fanout:h16.touchLog,errors:h16.errors,opens:h16.opens}));
  Object.assign(report.cases[current]||=( {}),r);report.errors.push(...r.errors);
 } finally{await app.close();app=null;}
}
const sample=(value,advance=55,silent=false)=>app.evaluate((_,v)=>h16.handles.at(-1).sample(...v),[value,advance,silent]);
const stable=async(value,advance=55)=>{await sample(value,advance);await sample(value,advance);await sample(value,advance);};
const count=()=>app.evaluate(()=>h16.events.filter(e=>e.type===0x82).length);
const touches=()=>app.evaluate(()=>h16.touchLog.filter(e=>e.source==='presence').map(e=>e.args));
async function shot(name){
 const data=await preview.screenshot({path:path.join(out,name+'.png')});
 report.screenshots[name]={sha256:sha(data),screen:await preview.locator('body').evaluate(b=>({...b.dataset}))};
}
async function testTouches(){
 const init=await openCase('contact',h17,1),rec=report.cases.contact;
 assert.equal(rec.hello.firmware,'0.2.0-s3');assert.deepEqual(rec.hello.abilities,['touch']);
 await page.locator('#robot-device-card').screenshot({path:path.join(out,'00-settings.png')});
 await stable(1,220);assert.equal(await count(),0);await shot('01-ready');
 await stable(0);assert.equal(await count(),0);
 const quietAt=Date.now(),writes=await app.evaluate(()=>h16.writes);
 await pause(2250);
 assert.equal((await snapshot()).delivery.session,init.session);
 assert.equal(await count(),0);
 rec.onlineIdle={elapsedMs:Date.now()-quietAt,writes:await app.evaluate(()=>h16.writes)-writes};
 assert(rec.onlineIdle.elapsedMs>2000&&rec.onlineIdle.writes>0);
 await stable(1);
 await preview.waitForFunction(()=>document.body.dataset.gesture==='poke');
 await shot('02-poke');
 const changed=await until(async()=>{const d=(await snapshot()).delivery;return d?.phase==='confirmed'&&d.session===init.session&&d.checksum!==init.checksum&&d;},'confirmed touch picture');
 assert.deepEqual(await touches(),[['robot-device','poke']]);
 await stable(1,220);assert.equal(await count(),1);await stable(0);assert.equal(await count(),1);
 const restored=await until(async()=>{const d=(await snapshot()).delivery;return d?.phase==='confirmed'&&d.checksum===init.checksum&&d.id>changed.id&&d;},'restored ordinary picture');
 await shot('03-restored');
 Object.assign(rec,{changed,restored});
 // Leave a finger down through an actual firmware timeout and the App's next HELLO.
 await stable(1,120);await until(async()=>await count()===2,'second press');
 rec.timeoutStep=await sample(1,2700,true);
 const fresh=await until(async()=>{const d=(await snapshot()).delivery;return d?.phase==='confirmed'&&d.session!==init.session&&d;},'fresh session after 2.5 s timeout',18000);
 await stable(1,180);assert.equal(await count(),2);await stable(0);assert.equal(await count(),2);
 rec.reconnected=fresh;
 await stable(1,120);await until(async()=>await count()===3,'first fresh press');
 const delayed=await app.evaluate(()=>h16.events.find(e=>e.type===0x82));
 await app.evaluate((_,hex)=>h16.inject(hex),delayed.wire);
 await pause(160);assert.equal((await touches()).length,3);
 await stable(0);await stable(0xff);await stable(1);assert.equal(await count(),3);
 await stable(0,150);await stable(1,120);await until(async()=>await count()===4,'post-NACK recovery');
 await until(async()=>(await touches()).length===4,'shared recovered poke');
 await stable(0);await stable(1);await preview.waitForFunction(()=>document.body.dataset.gesture==='huff');await shot('04-third-poke');
 // Exercise native handle loss as well as the same-peer AAP timeout above.
 // This fixture cold starts the reinserted board with its register still down.
 await app.evaluate(()=>{h16.initialContact=1;h16.setPorts([]);return h16.unplug();});
 await until(async()=>!(await snapshot()).portOpen,'old USB handle released');
 await app.evaluate((_,p)=>h16.setPorts([p]),board);
 rec.replugged=await until(async()=>{const d=(await snapshot()).delivery;return d?.phase==='confirmed'&&d.session!==fresh.session&&d;},'remembered USB board recovered',18000);
 await stable(1);assert.equal(await count(),5);
 await stable(0);await stable(1);await until(async()=>(await touches()).length===6,'new handle touch after fresh release');
 await closeCase();
}
async function displayOnly(name,exe,initial){
 const first=await openCase(name,exe,initial);assert.deepEqual(report.cases[name].hello.abilities,[]);
 await stable(1);await stable(0);assert.equal(await count(),0);
 // Preview touch is still a normal App input when no hardware sensor is available.
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/pet/robot/twin.html')).setIgnoreMouseEvents(false));
 await preview.locator('#stage').click({position:{x:130,y:130}});
 await until(async()=>{const d=(await snapshot()).delivery;return d?.phase==='confirmed'&&d.checksum!==first.checksum;},'display-only peer accepts another App picture');
 assert.deepEqual(await touches(),[['robot','poke']]);await closeCase();
}
function crop(pixels){
 const words=[];for(let y=322;y<=357;y++)for(let x=230;x<=323;x++)words.push(pixels[y*504+x]);
 return Uint16Array.from(words);
}
function saveRgb565(name,pixels,width,height){
 const {deflateSync,crc32}=require('node:zlib'),rgb=Buffer.alloc(height*(1+width*3));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=pixels[y*width+x],k=y*(1+width*3)+1+x*3;
  rgb[k]=Math.round((p>>11)*255/31);rgb[k+1]=Math.round(((p>>5)&63)*255/63);rgb[k+2]=Math.round((p&31)*255/31);
 }
 const u=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
 const chunk=(label,data)=>{const both=Buffer.concat([Buffer.from(label),data]);return Buffer.concat([u(data.length),both,u(crc32(both))]);};
 const hdr=Buffer.concat([u(width),u(height),Buffer.from([8,2,0,0,0])]);
 const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',hdr),chunk('IDAT',deflateSync(rgb)),chunk('IEND',Buffer.alloc(0))]);
 fs.writeFileSync(path.join(out,name+'.png'),png);return sha(png);
}
async function verify(){
 const c=report.cases.contact,frames=new Map();
 const records=await inspectPictures(portDir('contact'),(picture,pixels,scan)=>{
  const key=picture.session+'/'+picture.id;
  const content=fs.readFileSync(path.join(portDir('contact'),picture.step+'.content'));
  assert(content.equals(Buffer.from(pixels.buffer)),'wire reconstruction differs from committed board memory');
  frames.set(key,crop(new Uint16Array(content.buffer,content.byteOffset,504*504)));
  for(const [name,stage] of Object.entries({idle:c.delivery,smile:c.changed,restored:c.restored})){
   if(stage.session===picture.session&&stage.id===picture.id)
    picture.scanPng=saveRgb565('board-'+name,new Uint16Array(scan.buffer,scan.byteOffset,480*480),480,480);
  }
 },(step,ack)=>{
  // A transaction already written by the App can arrive after the forced outage.
  // It belongs to the expired session and must not be acknowledged.
  if(step<c.timeoutStep||ack.session!==c.delivery.session)return false;
  (c.expiredTransactions??=[]).push({step,...ack});return true;
 });
 const roi=d=>frames.get(d.session+'/'+d.id),idle=roi(c.delivery),smile=roi(c.changed),restored=roi(c.restored);
 assert(idle&&smile&&restored);let changed=0;
 for(let i=0;i<idle.length;i++){if(idle[i]!==smile[i])changed++;assert.equal(idle[i],restored[i]);}
 assert(changed>0);c.pictures=records;
 c.mouth={x:[230,323],y:[322,357],tested:idle.length,changed,base:sha(Buffer.from(idle.buffer)),
  touch:sha(Buffer.from(smile.buffer)),restored:sha(Buffer.from(restored.buffer))};
 const cells=[idle,smile,restored],scale=3,strip=new Uint16Array(3*94*scale*36*scale);
 for(let y=0;y<36*scale;y++)for(let x=0;x<3*94*scale;x++)
  strip[y*282*scale+x]=cells[Math.floor(x/(94*scale))][Math.floor(y/scale)*94+Math.floor(x/scale)%94];
 c.mouth.strip=saveRgb565('mouth-idle-smile-restored',strip,282*scale,36*scale);
 const statuses=c.events.filter(e=>e.type===0x83).map(e=>Buffer.from(e.payload,'hex'));
 assert(statuses.length&&statuses.every(b=>(b[1]&2)===0));
 const tk=c.events.filter(e=>e.type===0x82).map(e=>Buffer.from(e.payload,'hex'));
 assert(tk.every(b=>b.length===9&&b[0]===2));assert.deepEqual(tk.map(b=>[b.readUInt32LE(1),b.readUInt32LE(5)]),
  [[c.delivery.session,1],[c.delivery.session,2],[c.reconnected.session,1],[c.reconnected.session,2],[c.reconnected.session,3],[c.replugged.session,1]]);
 assert.deepEqual(c.fanout.filter(r=>r.source==='desktop').map(r=>r.args[0]),c.fanout.filter(r=>r.source==='preview').map(r=>r.args[0]));
 assert.deepEqual(c.fanout.filter(r=>r.source==='desktop').map(r=>r.args[0]),c.fanout.filter(r=>r.source==='presence').map(r=>r.args[1]));
 for(const name of ['contact','no-sensor'])assert(fs.statSync(path.join(portDir(name),'cst820-reads.tsv')).size>0);
 for(const name of ['contact','no-sensor','mode-write-failure']){
  const mode=fs.readFileSync(path.join(portDir(name),'cst820-mode.tsv'),'utf8').trim();
  assert.equal(mode,'0x15\t0xfe\t0xff\t'+(name==='mode-write-failure'?'NACK':'ACK'));report.cases[name].pollMode=mode;
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}
(async()=>{
 if(cacheTest){
  report.endpoints.cache=sha(fs.readFileSync(h20));
  await require('./round-cache-window.cjs').exercise({h20,h17,h15,out,report,openCase,closeCase,portDir,
    stable,sample,snapshot,until,saveRgb565,getApp:()=>app,getPreview:()=>preview,getPage:()=>page});
  return;
 }
 await testTouches();await displayOnly('no-sensor',h17,0xff);await displayOnly('mode-write-failure',h17,0);await displayOnly('h15',h15,0);await verify();
})()
 .catch(e=>{report.failure=String(e.stack);console.error(e);process.exitCode=1;})
 .finally(async()=>{await closeCase();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(out);});
