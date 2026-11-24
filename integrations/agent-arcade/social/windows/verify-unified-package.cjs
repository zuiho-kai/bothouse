'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {fork}=require('node:child_process');
const {once}=require('node:events');
const {setTimeout:wait}=require('node:timers/promises');
const {_electron}=require('playwright');

const [executable, evidence]=process.argv.slice(2).map(value=>path.resolve(value));
assert(executable&&evidence,'Usage: node verify-unified-package.cjs UNPACKED_EXE EVIDENCE_DIR');
const payload=path.join(path.dirname(executable),'resources','app');
const configuration=require(path.join(payload,'service.json'));
assert.equal(configuration.mode,'test');
const origin=new URL(configuration.origin);
assert.equal(origin.hostname,'127.0.0.1');
const scratch=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'arcade-store-unified-'));
const profile=path.join(scratch,'profile');
fs.mkdirSync(path.join(profile,'library'),{recursive:true});
fs.writeFileSync(path.join(profile,'library','config.json'),JSON.stringify({language:'zh'}));
const database=path.join(scratch,'synthetic.sqlite');
fs.mkdirSync(evidence,{recursive:true});
const checks=[];
const pageErrors=[];

async function until(check,label) {
  for(let i=0;i<100;i++){
    if(await check()) return;
    await wait(150);
  }
  throw new Error('Timed out: '+label);
}

async function start() {
  const worker=fork(path.join(__dirname,'../server/main.cjs'),[],{windowsHide:true,stdio:['ignore','ignore','inherit','ipc'],
    env:{...process.env,SOCIAL_DB:database,SOCIAL_HOST:'127.0.0.1',SOCIAL_PORT:origin.port,SOCIAL_PUBLIC_ORIGIN:'',SOCIAL_DEEPSEEK_KEY:'',SOCIAL_OPENAI_KEY:''}});
  await Promise.race([once(worker,'message'),once(worker,'exit').then(([code])=>assert.fail('Social service exited: '+code))]);
  assert.equal((await fetch(origin.href+'healthz')).status,200);
  return worker;
}
async function stop(worker) {
  if(!worker||worker.exitCode!==null||worker.signalCode)return;
  const done=once(worker,'exit');worker.kill();await done;
}
async function launch() {
  const env={...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:executable,env,
    args:['--arcade-store-test-profile='+profile,'--disable-background-networking','--disable-component-update','--disable-sync']});
  const page=await app.firstWindow();
  await page.waitForURL('file:**');
  page.on('pageerror',error=>pageErrors.push(error.message));
  return {app,page};
}
async function guest(app,script) {
  return app.evaluate(async({BrowserWindow},js)=>{
    const w=BrowserWindow.getAllWindows()[0];
    const guest=w.contentView.children.find(view=>view.webContents&&view.webContents!==w.webContents);
    if(!guest||!guest.webContents.getURL().startsWith('http://'))return null;
    return guest.webContents.executeJavaScript(js);
  },script);
}
async function assertBoundary(app,visible) {
  const view=await app.evaluate(async({BrowserWindow,app})=>{
    const windows=BrowserWindow.getAllWindows(),w=windows[0];
    const child=w.contentView.children.find(v=>v.webContents&&v.webContents!==w.webContents);
    const wc=child.webContents,p=wc.getLastWebPreferences();
    const compactStoreShell=await w.webContents.executeJavaScript("!!document.getElementById('store-more')");
    return {count:windows.length,desktopVisible:w.isVisible(),guestVisible:child.getVisible(),bounds:child.getBounds(),compactStoreShell,
      url:wc.getURL(),localUrl:w.webContents.getURL(),preload:p.preload?.split(/[\\/]/).at(-1),preloads:wc.session.getPreloadScripts().length,
      sandbox:p.sandbox,nodeIntegration:p.nodeIntegration,contextIsolation:p.contextIsolation,
      separatePartition:wc.session!==w.webContents.session,profile:app.getPath('userData')};
  });
  assert.equal(view.count,1);
  assert.equal(view.desktopVisible,false);
  assert.equal(view.guestVisible,visible);
  assert.equal(view.profile,profile);
  assert.equal(view.bounds.y,view.compactStoreShell?44:56);
  assert.equal(new URL(view.url).origin,origin.origin);
  assert.match(view.localUrl,/\/src\/ui\/index.html/);
  assert.deepEqual([view.preload,view.preloads,view.sandbox,view.nodeIntegration,view.contextIsolation,view.separatePartition],
    ['privacy-preload.cjs',0,true,false,true,true]);
}
async function settings(page) {
  await page.locator('#store-more').click();
  await page.locator('#store-settings').click();
  await page.locator('#settings-back').waitFor();
  assert.equal(await page.locator('#ai-card-open').count(),0);
  assert.equal(await page.locator('#ws-companion, #ws-work, #settings-advanced').count(),0);
}
async function fillRegistration(app) {
  await guest(app,`document.querySelector('#auth-switch').click();
    document.querySelector('[name=number]').value='store_fixture_a';
    document.querySelector('[name=displayName]').value='封装账号甲';
    document.querySelector('[name=password]').value='synthetic-only-password';
    document.querySelector('#auth-submit').click()`);
  await until(()=>guest(app,`!document.querySelector('#workspace').hidden`),'social registration');
}
async function peer() {
  let cookie='';
  return async(route,body)=>{
    const response=await fetch(origin.origin+'/api/v1'+route,{method:body===undefined?'GET':'POST',
      headers:{Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    assert.equal(response.status,200,route);
    cookie=response.headers.getSetCookie()[0]?.split(';')[0]||cookie;
    return response.json();
  };
}
async function main(){
  let worker, running;
  try {
    worker=await start();
    running=await launch();
    const {app,page}=running;
    await until(()=>guest(app,`!!document.querySelector('#auth-form')`),'Friends is the first workspace');
    await assertBoundary(app,true);
    assert.deepEqual(await guest(app,`[typeof window.arcade,typeof require,typeof process]`),['undefined','undefined','undefined']);
    await fillRegistration(app);
    const b=await peer();
    await b('/register',{number:'store_fixture_b',displayName:'封装账号乙',password:'synthetic-only-password'});
    const {request}=await b('/friend-requests',{number:'store_fixture_a'});
    await guest(app,`document.querySelector('[data-tab=contacts]').click()`);
    await until(()=>guest(app,`[...document.querySelectorAll('button')].some(e=>e.textContent==='新的朋友（1）')`),'peer request');
    await guest(app,`[...document.querySelectorAll('button')].find(e=>e.textContent==='新的朋友（1）').click();
       [...document.querySelectorAll('button')].find(e=>e.textContent==='接受').click()`);
    const chat=await b('/direct',{number:'store_fixture_a'});
    const route='/conversations/'+chat.conversation.id+'/messages';
    await b(route,{clientId:'store_peer_first',text:'合成社交历史'});
    await until(()=>guest(app,`document.querySelector('#history').textContent.includes('合成社交历史')`),'packaged UI received message');
    await guest(app,`document.querySelector('#message').value='合成社交回复';document.querySelector('#composer button[type=submit]').click()`);
    await until(async()=> (await b(route)).messages.some(m=>m.text==='合成社交回复'),'peer received packaged UI reply');
    checks.push('包内好友首屏与真实回环服务注册、接受好友、双向私聊');
    const image=await app.evaluate(async({BrowserWindow})=>{
      const w=BrowserWindow.getAllWindows()[0];
      const v=w.contentView.children.find(c=>c.webContents&&c.webContents!==w.webContents);
      return (await v.webContents.capturePage()).toPNG().toString('base64');
    });
    fs.writeFileSync(path.join(evidence,'friends.png'),Buffer.from(image,'base64'));
    await guest(app,"document.querySelector('#message').value='未发送的合成草稿';document.querySelector('#message').dispatchEvent(new Event('input',{bubbles:true}))");
    await settings(page);
    await assertBoundary(app,false);
    await page.locator('#settings-nav-devices').click();
    await page.locator('#robot-device-card').waitFor();
    await page.screenshot({path:path.join(evidence,'devices.png')});
    await page.locator('#settings-back').click();
    await assertBoundary(app,true);
    assert.equal(await guest(app,"document.querySelector('#message').value"),'未发送的合成草稿');
    checks.push('更多进入设备设置，返回原私聊并保留草稿');
    assert(await guest(app,`document.querySelector('#history').textContent.includes('合成社交历史')`));
    await guest(app,`document.querySelector('[data-tab=profile]').click();
      [...document.querySelectorAll('button')].find(e=>e.textContent==='意见反馈').click()`);
    await until(()=>guest(app,`!!document.querySelector('#feedback-text')`),'feedback form');
    await guest(app,`document.querySelector('#feedback-text').value='合成商店包意见反馈';
      document.querySelector('#feedback-text').form.querySelector('button[type=submit]').click()`);
    await until(()=>guest(app,`document.querySelector('.feedback-history').textContent.includes('合成商店包意见反馈')`),'feedback receipt');
    checks.push('同源意见反馈实际提交并回读');
    await app.close();running=null;
    running=await launch();
    await until(()=>guest(running.app,`!document.querySelector('#workspace').hidden`),'persistent social login');
    await assertBoundary(running.app,true);
    await guest(running.app,`[...document.querySelectorAll('#directory-body button')].find(e=>e.textContent.includes('封装账号乙')).click()`);
    await until(()=>guest(running.app,`document.querySelector('#history').textContent.includes('合成社交回复')`),'durable message');
    checks.push('重开包后同一好友登录和历史恢复');
    await running.app.close();running=null;
    await stop(worker);worker=null;
    running=await launch();
    await running.page.getByRole('button',{name:'重试',exact:true}).waitFor();
    await settings(running.page);
    await running.page.locator('#settings-nav-window').click();
    await running.page.locator('#alwaysOnTop').waitFor();
    checks.push('好友服务离线时仍能进入本机窗口设置');
    assert.deepEqual(pageErrors,[]);
  } finally {
    await running?.app.close();
    await stop(worker);
    assert.equal(path.dirname(fs.realpathSync(scratch)),fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(scratch),/^arcade-store-unified-[a-z0-9]{6}$/i);
    fs.rmSync(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:150});
  }
  const result={passed:true,executable,checks,visibleWindows:0,remotePreloads:0,pageErrors,
    execution:'Unpacked MSIX executable, two synthetic accounts, loopback server and temporary profile'};
  fs.writeFileSync(path.join(evidence,'runtime-receipt.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
