'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { execFileSync } = require('node:child_process');
const { setTimeout: wait } = require('node:timers/promises');
const { _electron, chromium } = require('playwright');
const { SocialStore } = require('../server/store.cjs');
const { createServer } = require('../server/http.cjs');

const [firstExe, secondExe, evidence] = process.argv.slice(2).map(input=>path.resolve(input));
assert(firstExe && secondExe && evidence, 'Usage: node verify-feedback-version.cjs OLD_TEST_EXE NEW_TEST_EXE EVIDENCE_DIR');
function packageInfo(executable) {
  const root = path.dirname(path.dirname(executable));
  const config = require(path.join(root,'Social/resources/app/service.json'));
  assert.equal(config.mode,'test');
  const manifest = fs.readFileSync(path.join(root,'AppxManifest.xml'),'utf8');
  assert.equal(manifest.match(/<Identity\b[^>]*\bVersion="([^"]+)"/u)?.[1],config.desktopVersion);
  return config;
}
const first = packageInfo(firstExe), second = packageInfo(secondExe);
assert.notEqual(first.desktopVersion,second.desktopVersion);
assert.equal(first.origin,second.origin);
const origin = new URL(first.origin);
assert.equal(origin.hostname,'127.0.0.1');

const tempRoot = fs.realpathSync(os.tmpdir());
const scratch = fs.mkdtempSync(path.join(tempRoot,'arcade-feedback-version-'));
const profile = path.join(scratch,'profile');
const db = path.join(scratch,'feedback.sqlite');
const clientDir = path.join(scratch,'client');
fs.cpSync(path.join(__dirname,'../client'),clientDir,{
  recursive:true,filter:entry=>path.basename(entry)!=='.qa',
});
fs.mkdirSync(path.join(profile,'library'),{recursive:true});
fs.writeFileSync(path.join(profile,'library/config.json'),JSON.stringify({language:'zh'}));
fs.mkdirSync(evidence,{recursive:true});
const store = new SocialStore(db);
const server = createServer(store,{client:clientDir});
const request = server.listeners('request')[0];
let dropBeforeWrite = false;
let dropped = 0;
server.removeListener('request',request);
server.on('request',(req,res)=>{
  if(dropBeforeWrite && req.method==='POST' && req.url==='/api/v1/feedback'){
    dropped++;
    req.destroy();
    return;
  }
  request(req,res);
});

async function until(check,description) {
  for(let i=0;i<120;i++){
    const value=await check();
    if(value)return value;
    await wait(125);
  }
  throw new Error('Timed out: '+description);
}
async function launch(executable) {
  const env={...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  return _electron.launch({executablePath:executable,env,
    args:['--arcade-store-test-profile='+profile,'--disable-background-networking','--disable-component-update','--disable-sync']});
}
async function guest(app,script) {
  return app.evaluate(async({BrowserWindow},js)=>{
    const window=BrowserWindow.getAllWindows()[0];
    if(!window)return null;
    if(window.isVisible())throw new Error('The test window must remain hidden');
    const view=window.contentView.children.find(child=>child.webContents?.getURL().startsWith('http://127.0.0.1:'));
    return view?view.webContents.executeJavaScript(js):null;
  },script);
}
async function screenshot(app,name) {
  const png = await app.evaluate(async({BrowserWindow})=>{
    const view=BrowserWindow.getAllWindows()[0].contentView.children
      .find(child=>child.webContents?.getURL().startsWith('http://127.0.0.1:'));
    const contents=view.webContents;
    contents.backgroundThrottling=false;
    await contents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    return (await contents.capturePage(undefined,{stayHidden:true})).toPNG().toString('base64');
  });
  fs.writeFileSync(path.join(evidence,name),Buffer.from(png,'base64'));
}
const click = caption =>
  `[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(caption)})?.click()`;
async function openFeedback(app) {
  await until(()=>guest(app,`document.querySelector('#workspace')?.hidden===false`),'signed-in workspace');
  await guest(app,click('我'));
  await guest(app,click('意见反馈'));
  return until(()=>guest(app,`document.querySelector('#feedback-text')?.form.innerText`),'feedback dialog');
}

async function main() {
  let app, browser;
  try {
    server.listen(Number(origin.port),origin.hostname);
    await once(server,'listening');
    app=await launch(firstExe);
    await until(()=>guest(app,`!!document.querySelector('#auth-switch')`),'registration');
    await guest(app,`document.querySelector('#auth-switch').click();
      document.querySelector('[name=number]').value='feedback_desktop';
      document.querySelector('[name=displayName]').value='合成桌面账号';
      document.querySelector('[name=password]').value='synthetic password only';
      document.querySelector('#auth-submit').click();`);
    const firstText=await openFeedback(app);
    assert(firstText.includes(first.desktopVersion+'（客户端报告）'));
    const originalBuild=firstText.match(/网页构建 ([a-f0-9]{12})/u)?.[1];
    assert(originalBuild);
    const idea='更新前提交的合成反馈';
    dropBeforeWrite=true;
    await guest(app,`const input=document.querySelector('#feedback-text');
      input.value=${JSON.stringify(idea)};input.dispatchEvent(new Event('input'));
      input.form.requestSubmit();`);
    await until(()=>guest(app,`document.querySelector('#dialog-error').textContent.includes('暂时连不上服务')`),'offline error');
    assert(dropped>=1);
    assert.equal(store.feedback('feedback_desktop').length,0);
    await screenshot(app,'01-first-attempt.png');
    await app.close();
    app=null;
    dropBeforeWrite=false;

    fs.appendFileSync(path.join(clientDir,'app.js'),'\n// Updated synthetic deployment.\n');
    app=await launch(secondExe);
    const retryText=await openFeedback(app);
    assert(retryText.includes('待重试版本：Windows App '+first.desktopVersion));
    assert(retryText.includes(originalBuild));
    assert.equal(await guest(app,`document.documentElement.dataset.arcadeFeedbackDesktopVersion`),second.desktopVersion);
    assert.equal(await guest(app,`document.querySelector('#feedback-text').value`),idea);
    await screenshot(app,'02-after-cold-update.png');
    await guest(app,click('提交反馈'));
    await until(()=>guest(app,`document.querySelector('.feedback-history article')?.innerText.includes(${JSON.stringify(idea)})`),'stored old version');
    const saved=store.feedback('feedback_desktop');
    assert.equal(saved.length,1);
    assert.equal(saved[0].desktopVersion,first.desktopVersion);
    assert(saved[0].clientBuild.startsWith(originalBuild));
    const newForm=await guest(app,`document.querySelector('#feedback-text').form.innerText`);
    assert(newForm.includes('本次提交版本：Windows App '+second.desktopVersion));
    assert(!newForm.includes(originalBuild));
    await guest(app,`document.querySelector('#feedback-text').value='更新后新提交的合成反馈';
      document.querySelector('#feedback-text').form.requestSubmit();`);
    await until(()=>guest(app,`document.querySelectorAll('.feedback-history article').length===2`),'new version receipt');
    await app.close();
    app=await launch(secondExe);
    await openFeedback(app);
    const reopened=await until(()=>guest(app,
      `document.querySelectorAll('.feedback-history article').length===2&&document.querySelector('.feedback-history').innerText`),
    'both receipts after cold reopening');
    assert(reopened.includes(first.desktopVersion)&&reopened.includes(second.desktopVersion));
    await screenshot(app,'03-desktop-receipts.png');

    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    const page=await browser.newPage();
    await page.route('**/*',route=>route.request().url().startsWith(origin.origin+'/')?route.continue():route.abort());
    await page.goto(origin.origin);
    await page.locator('#auth-switch').click();
    await page.locator('[name=number]').fill('feedback_browser');
    await page.locator('[name=displayName]').fill('合成网页账号');
    await page.locator('[name=password]').fill('synthetic password only');
    await page.locator('#auth-submit').click();
    await page.getByRole('button',{name:'我',exact:true}).click();
    await page.getByRole('button',{name:'意见反馈',exact:true}).click();
    await page.getByText('网页客户端（未报告桌面版本）',{exact:false}).waitFor();
    await page.getByText('还没有提交反馈。',{exact:true}).waitFor();
    await page.getByLabel('问题或建议').fill('普通浏览器的合成反馈');
    await page.getByRole('button',{name:'提交反馈'}).click();
    await page.locator('.feedback-history article').getByText('未记录桌面版本',{exact:false}).waitFor();
    assert.equal(await page.locator('.feedback-history article').count(),1);
    await page.screenshot({path:path.join(evidence,'04-browser-receipt.png')});

    const operator=JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'../server/moderate.cjs'),'feedback'],{
      env:{...process.env,SOCIAL_DB:db},encoding:'utf8',windowsHide:true,
    }));
    assert.equal(operator.length,3);
    assert(operator.every(row=>!('account' in row)));
    const byText=Object.fromEntries(operator.map(row=>[row.text,row]));
    assert.deepEqual(byText[idea],{...saved[0]});
    assert.equal(byText['更新后新提交的合成反馈'].desktopVersion,second.desktopVersion);
    assert.equal(byText['普通浏览器的合成反馈'].desktopVersion,null);
    assert.equal(byText['普通浏览器的合成反馈'].clientType,'web');
    assert.equal(byText['更新后新提交的合成反馈'].clientBuild,byText['普通浏览器的合成反馈'].clientBuild);
    fs.writeFileSync(path.join(evidence,'replay.json'),JSON.stringify({
      manifestVersions:[first.desktopVersion,second.desktopVersion],offlineBeforeWrite:dropped,
      oldDraftRetriedAfterColdUpdate:true,receiptsAfterColdReopening:2,operator:operator.map(({clientType,clientBuild,desktopVersion})=>
        ({clientType,clientBuild,desktopVersion})),headlessBrowser:true,desktopWindowsHidden:true,
    },null,2)+'\n');
  } finally {
    await browser?.close();
    await app?.close();
    server.closeAllConnections();
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    store.db.close();
    const resolved=fs.realpathSync(scratch);
    assert.equal(path.dirname(resolved),tempRoot);
    assert.match(path.basename(resolved),/^arcade-feedback-version-[a-z0-9]{6}$/iu);
    fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
