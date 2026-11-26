'use strict';
// node scripts/pets/test-board-handback.cjs [output-directory]
// node scripts/pets/test-board-handback.cjs --task-receipt [output-directory]
// Normal Electron settings and task-board controls, real git worktrees and hook
// inbox. The fixture supplies a local background CLI and no physical devices.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {createHash, randomUUID} = require('node:crypto'), {execFileSync} = require('node:child_process');
const {setTimeout:pause} = require('node:timers/promises'), {_electron} = require('playwright');
const receiptMode = process.argv[2] === '--task-receipt';
const root = path.resolve(__dirname,'../..'), output = path.resolve(process.argv[receiptMode ? 3 : 2] || (receiptMode ? 'outputs/task-receipt' : 'outputs/board-handback'));
fs.mkdirSync(output,{recursive:true});
const out = fs.mkdtempSync(path.join(output,'run-'));
const profile = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'arcade-handback-'));
const sub = name => {const p=path.join(profile,name); fs.mkdirSync(p); return p;};
const home = sub('home'), arcadeHome = sub('arcade'), project = sub('project with spaces');
const sha = data => createHash('sha256').update(data).digest('hex');
const git = (dir, ...args) => execFileSync('git',args,{cwd:dir,encoding:'utf8',windowsHide:true}).trim();
const source = ['scripts/pets/test-board-handback.cjs','test/fixtures/board-handback-window.cjs','src/main.cjs',
  'src/bot/task-board.cjs','src/pet/window.cjs','src/pet/presence.cjs','src/hook.cjs','src/core/store.cjs','src/pet/robot/twin-page.js'];
if (receiptMode) source.push('scripts/pets/board-receipt-window.cjs','src/bot/task-receipt.cjs','src/bot/task-worktree.cjs','src/ui/tasks.js','src/core/events.cjs','src/core/files.cjs');
const report = {pass:false, commit:git(root,'rev-parse','HEAD'), sources:Object.fromEntries(source.map(f=>[f,sha(fs.readFileSync(path.join(root,f)))])),
  platform:process.platform, scope:receiptMode
    ? 'Development Electron, ordinary UI, real git worktree. Local background CLI writes the dispatched receipt. Both handbacks run without hooks; an isolated Stop is a separate control.'
    : 'Development Electron, ordinary UI and hook capture, real git. Local background CLI and folder picker doubles, no hardware.',
  steps:[], hooks:[], images:{}, tasks:[], errors:[]};
let app, page, robot, step='setup', neutral;
function mark(name) {step=name; report.steps.push({name, at:Date.now()}); console.log(name);}
async function until(fn,label,timeout=14000) {
  const end=Date.now()+timeout;
  do {const v=await fn(); if(v)return v; await pause(60);} while(Date.now()<end);
  throw Error('Timed out waiting for '+label);
}
const read = () => app.evaluate(()=>handback.summary());
const snapshot = () => page.evaluate(()=>arcade.snapshot());
async function tasks() {return Object.values((await snapshot()).taskBoard.columns).flat();}
const fk = key => page.locator('#tasks-content [data-fk="'+key+'"]');
async function focus(which) {
  await (which==='main'?page:robot).bringToFront();
  await until(()=>app.evaluate((_e,w)=>handback.focus(w),which),'real focus '+which);
}
async function settings() {await focus('main'); await page.locator('#shell-bar [data-view="settings"]').click();}
async function board() {
  await focus('main'); await page.locator('#ws-work').click();
  await page.locator('nav [data-view="tasks"]').click(); await fk('new').waitFor();
}
async function dispatch(title) {
  await board(); await fk('new').click(); await fk('form-pick').click();
  await fk('form-title').fill(title); await fk('form-brief').fill('隔离样例。仅使用本地替身。'); await fk('form-save').click();
  const row=await until(async()=>(await tasks()).find(t=>t.title===title),'new draft '+title);
  await fk('t:'+row.id+':dispatch').click(); await fk('t:'+row.id+':dispatch-go').click();
  const bound=await until(async()=>(await tasks()).find(t=>t.id===row.id&&t.sessionId&&t.jobId),'bound session '+title);
  assert.ok(fs.statSync(path.join(bound.worktree,'.git')).isFile());
  assert.equal(git(bound.worktree,'branch','--show-current'),bound.branch);
  assert.equal(git(bound.worktree,'rev-parse','HEAD'),bound.baseCommit);
  report.tasks.push({id:bound.id,title,sessionId:bound.sessionId,jobId:bound.jobId,branch:bound.branch,baseCommit:bound.baseCommit});
  return bound;
}
const copy = '背景：隔离看板验收\n做了什么：写入合成报告\n要你做的：请核对改动\n我加的：本地样例';
async function submit(row,entries) {
  const inputs=entries.map(e=>({session_id:row.sessionId,cwd:row.worktree,...e}));
  const events=await app.evaluate((_e,values)=>handback.submit(values),inputs);
  report.hooks.push({step,events:events.map(e=>({id:e.id,at:e.at,event:e.event,session:e.session,agent:e.agent,
    retainedReply:Boolean(e.result),resultSha:e.result?sha(e.result):null}))});
  const inbox=path.join(arcadeHome,'inbox');
  await until(()=>!fs.readdirSync(inbox).some(n=>events.some(e=>n.includes(e.id))),'main consumed hook batch');
  return events;
}
const stop = text=>({hook_event_name:'Stop',last_assistant_message:text});
const end = {hook_event_name:'SessionEnd'};
async function sample(cue,name) {
  await robot.waitForFunction(mark=>document.body.dataset.activity==='idle'&&document.body.dataset.cue===mark&&
    document.body.dataset.asleep==='false'&&window.handbackTwin?.frames>0,cue);
  const result=await robot.evaluate(()=>{
    const t=window.handbackTwin,bytes=new Uint8Array(t.buffer.buffer,t.buffer.byteOffset,t.buffer.byteLength);
    const parts=[]; for(let i=0;i<bytes.length;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
    return {dom:{...document.body.dataset},width:t.content.width,height:t.content.height,frames:t.frames,
      rgb565:btoa(parts.join('')),content:t.content.toDataURL('image/png').split(',')[1]};
  });
  assert.deepEqual([result.width,result.height],[504,504]);
  const pixels=Buffer.from(result.rgb565,'base64'), png=Buffer.from(result.content,'base64');
  assert.equal(pixels.length,504*504*2);
  neutral??=pixels;
  let changed=0,x0=504,y0=504,x1=-1,y1=-1;
  for(let i=0;i<pixels.length;i+=2) if(pixels.readUInt16LE(i)!==neutral.readUInt16LE(i)){
    const x=(i/2)%504,y=Math.floor(i/2/504);changed++;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
  }
  if(cue) assert.ok(changed>100 && x0>250 && x1<504 && y0>0 && y1<230,'unread pixels occupy the upper-right badge');
  else assert.equal(changed,0,'full neutral content restores exactly');
  fs.writeFileSync(path.join(out,name+'-content.png'),png);
  const capture=await robot.screenshot({path:path.join(out,name+'-window.png')});
  const s=await read(), desktop=s.desktop.at(-1);
  assert.equal(desktop.attention,Boolean(cue)); assert.equal(desktop.activity,'idle');
  if(process.platform==='win32')assert.deepEqual([desktop.supported,desktop.visible],[false,false]);
  assert.ok(s.robotIPC.some(m=>m.attention===Boolean(cue)&&m.activity==='idle'));
  report.images[name]={at:Date.now(),contentPixels:sha(pixels),contentPNG:sha(png),windowPNG:sha(capture),changed,
    bounds:changed?[x0,y0,x1,y1]:null,dom:result.dom,frames:result.frames,desktop};
}
async function quiet(count,label) {
  await pause(1250);
  const s=await read();
  assert.equal(s.raises.length,count,label+' must not raise attention again');
  assert.equal(s.desktop.at(-1).attention,false,label);
  assert.equal(await robot.locator('body').getAttribute('data-cue'),'');
  report.steps.push({name:label, at:Date.now(), callsToRaise:s.raises.length, desktop:s.desktop.at(-1), previewCue:''});
}
function openEnvironment(){
  const sys=process.env.SystemRoot,query=process.platform==='win32'?'where.exe':'which';
  const gitDir=path.dirname(execFileSync(query,['git'],{encoding:'utf8'}).trim().split(/\r?\n/)[0]);
  const sysDirs=process.platform==='win32'?[path.join(sys,'System32'),sys]:['/usr/bin','/bin'];
  const env={HOME:home,USERPROFILE:home,APPDATA:sub('roaming'),LOCALAPPDATA:sub('local'),ProgramData:sub('program-data'),
    PATH:[gitDir,...sysDirs].join(path.delimiter),TEMP:profile,TMP:profile,TMPDIR:profile,AGENT_ARCADE_HOME:arcadeHome,
    AGENT_ARCADE_CLAUDE_SETTINGS:path.join(sub('claude'),'settings.json'), BOARD_TEST_PROFILE:profile,BOARD_TEST_NODE:process.execPath,
    BOARD_TEST_RECEIPT:receiptMode?'1':'0',
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(home,'empty-gitconfig'),GIT_TERMINAL_PROMPT:'0'};
  if(sys) Object.assign(env,{SystemRoot:sys,WINDIR:sys,ComSpec:path.join(sys,'System32','cmd.exe')});
  return env;
}
async function run(){
  git(project,'init','--quiet');git(project,'-c','user.name=Local fixture','-c','user.email=local@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','--quiet','-m','Local fixture');
  fs.writeFileSync(path.join(arcadeHome,'config.json'),JSON.stringify({language:'zh',notifications:false}));
  const past=Date.now()-3*864e5;
  fs.writeFileSync(path.join(arcadeHome,'task-board.json'),JSON.stringify({version:1,tasks:[{id:'history001',title:'历史交回样例',project,
    brief:'旧任务',state:'reported',createdAt:past,updatedAt:past,observedAt:past,reportStatus:'parsed',report:{background:'旧',done:'旧',todo:'旧',added:'旧'}}]}));
  const env=openEnvironment(),entry=path.join(root,'test/fixtures/board-handback-window.cjs');
  async function launch(expectCapture) {
    app=await _electron.launch({executablePath:require('electron'),cwd:root,env,args:[entry,
      '--user-data-dir='+path.join(arcadeHome,'electron-profile'),'--disable-background-networking','--disable-component-update','--disable-sync',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--proxy-server=http://127.0.0.1:1','--proxy-bypass-list=<-loopback>']});
    page=await app.firstWindow();page.setDefaultTimeout(12000);
    page.on('pageerror',e=>report.errors.push(e.message));
    await page.waitForURL('**/src/ui/index.html');
    const initial=await snapshot(); assert.equal(initial.demo,false);assert.equal(initial.bot.hasKey,false);assert.equal(initial.bot.qq.hasToken,false);
    await settings(); assert.equal(await page.locator('#captureResults').isChecked(),expectCapture);
    await page.locator('#petRobotPreview').click();
    robot=await until(()=>app.windows().find(p=>p.url().includes('/pet/robot/twin.html')),'ordinary preview');
    robot.on('pageerror',e=>report.errors.push(e.message));
    await robot.evaluate(async()=>{const {RobotTwin}=await import('./twin.js'),update=RobotTwin.prototype.update;
      RobotTwin.prototype.update=function(...args){const result=update.apply(this,args);window.handbackTwin=this;return result;};});
  }
  mark('history and capture default'); await launch(false);
  if (receiptMode) {
    await require('./board-receipt-window.cjs')({app,page,read,report,out,arcadeHome,git,sha,mark,dispatch,focus,quiet,sample,submit,stop,fk,until,tasks,snapshot});
    report.pass=true; return;
  }
  assert.ok((await tasks()).some(t=>t.id==='history001'&&t.reportStatus==='parsed'));
  await focus('robot'); await sample('','01-historical-quiet'); await quiet(0,'restored record');
  mark('capture disabled'); const disabled=await dispatch('隐私关闭时的派出'); await focus('robot');
  const hidden=await submit(disabled,[stop(copy)]); assert.equal(hidden[0].result,'');
  await quiet(0,'capture disabled');
  mark('enable capture in settings'); await settings();await page.locator('#captureResults').check();await until(async()=>(await snapshot()).config.captureResults,'saved capture opt-in');
  mark('ordinary stop and session end'); const plain=await dispatch('普通结束样例');await focus('robot');await submit(plain,[stop('本轮已结束'),end]);
  await quiet(0,'ordinary Stop and SessionEnd');
  mark('foreign session and subagent'); const live=await dispatch('已派新任务的明确交回'); await focus('robot');
  await submit(live,[{...stop(copy),session_id:randomUUID()},{hook_event_name:'SubagentStop',agent_id:'test-child',last_assistant_message:copy}]);
  await quiet(0,'foreign and subagent');
  mark('explicit report in background'); await submit(live,[stop(copy)]);
  await sample('!','02-new-handback');
  let row=(await tasks()).find(t=>t.id===live.id);
  assert.equal(row.reportStatus,'parsed');assert.equal(row.state,'reported');assert.equal(row.outcome,'unverified');
  assert.equal((await read()).raises.length,1);
  mark('main window clears and displays report');await focus('main');await sample('','03-open-cleared');
  const card=page.locator('[data-id="'+live.id+'"]');await card.scrollIntoViewIfNeeded();
  const cardBytes=await card.screenshot({path:path.join(out,'04-board.png')});
  report.images.board={sha256:sha(cardBytes),text:await card.innerText()};
  mark('repeated report, refresh and session end');await focus('robot');await submit(live,[stop(copy)]);
  await quiet(1,'same round repeated');await submit(live,[end]);await quiet(1,'later close');
  await page.reload();await board();assert.ok((await tasks()).find(t=>t.id===live.id&&t.state==='reported'));
  await focus('robot');await quiet(1,'refresh');
  mark('explicit report and session end in one poll');const paired=await dispatch('同批交回与会话关闭');await focus('robot');
  await submit(paired,[stop(copy),end]);await sample('!','05-paired-handback');assert.equal((await read()).raises.length,2);
  await focus('main');await sample('','06-paired-cleared');
  mark('already looking at app');const fore=await dispatch('在前台时交回');await focus('main');await submit(fore,[stop(copy)]);
  assert.equal((await tasks()).find(t=>t.id===fore.id).reportStatus,'parsed');await quiet(2,'already in foreground');
  const s=await read();assert.deepEqual(s.network,[]);assert.deepEqual(report.errors,[]);
  assert.ok(s.desktop.every(e=>e.fields.join(',')==='activity,attention'));assert.ok(s.robotIPC.every(e=>e.fields.join(',')==='activity,attention,token'));
  report.observed=s;
  mark('cold restart with persisted board and observer records');
  await app.close();app=null;
  for(const file of ['task-board.json','state.json']) {
    fs.copyFileSync(path.join(arcadeHome,file),path.join(out,file));
    report.sources[file]=sha(fs.readFileSync(path.join(out,file)));
  }
  await launch(true); await board();
  assert.ok((await tasks()).some(t=>t.id===live.id&&t.state==='reported'&&t.reportStatus==='parsed'&&t.sessionId===live.sessionId));
  await focus('robot');await quiet(0,'cold restart');await sample('','07-restart-quiet');
  report.restart=await read();assert.deepEqual(report.restart.network,[]);assert.deepEqual(report.errors,[]);report.pass=true;
}
run().catch(async e=>{
  report.failure={step,message:String(e),stack:e.stack};
  if(page) try{
    const text=(await page.locator('body').innerText()).slice(-4000);
    // Do not save even a failed window's text if the product exposed a secret.
    report.lastUI=receiptMode&&await app.evaluate((_e,s)=>handback.containsReceiptCode(s),text)?'[receipt code withheld]':text;
  }catch{}
  if(app) try{report.lastProcess=await read();}catch{}
}).finally(async()=>{
  if(app) try{await app.close();}catch(e){report.closeError=String(e);report.pass=false;}
  if(report.pass) {
    const resolved=fs.realpathSync(profile);
    assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(resolved),/^arcade-handback-[a-zA-Z0-9]+$/);
    fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3});
  }
  const file=path.join(out,'report.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({pass:report.pass,step,file,sha256:sha(fs.readFileSync(file)),error:report.failure?.message}));
  if(!report.pass)process.exitCode=1;
});
