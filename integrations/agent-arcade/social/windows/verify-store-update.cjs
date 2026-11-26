'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {test} = require('node:test');

const [payloadArg, receiptArg, dependencyArg, baselineArg] = process.argv.slice(2);
assert(payloadArg && receiptArg && dependencyArg,
  'Usage: node verify-store-update.cjs UNPACKED_RESOURCES_APP BUILD_RECEIPT DEPENDENCY_ROOT [OLD_UNPACKED_RESOURCES_APP]');
const payload = path.resolve(payloadArg);
const receipt = require(path.resolve(receiptArg));
const {chromium} = require(require.resolve('playwright', {paths:[path.resolve(dependencyArg)]}));
const {createStoreUpdate} = require(path.join(payload, 'src/core/store-app-update.cjs'));
const {createWindowsUpdate} = require(path.join(payload, 'src/core/windows-app-update.cjs'));
const updateArticle = source => fs.readFileSync(path.join(source,'src/ui/index.html'),'utf8')
  .match(/<article[^>]+id="app-update-panel"[\s\S]+?<\/article>/u)[0];

test('the unpacked test MSIX contains the expected loadable x64 bridge and reports no live identity', () => {
  const binary = path.join(payload,'store-update.node');
  const bytes = fs.readFileSync(binary);
  assert.equal(bytes.readUInt16LE(bytes.readUInt32LE(0x3c)+4),0x8664);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),receipt.storeUpdateSha256);
  assert.equal(require(path.join(payload,'service.json')).mode,'test');
  assert.equal(require(path.join(payload,'package.json')).storeEdition,true);
  const native = require(binary);
  assert.equal(native.begin(Buffer.alloc(8), 0),0);
  assert.equal(native.begin(Buffer.alloc(8), 1),0);
  assert.equal(native.result(),0);
});

test('production settings card drives Store checks, OS consent outcomes, and the fixed fallback', async () => {
  const hwnd = Buffer.alloc(8, 1);
  const calls = [], changed = [];
  let nativeStatus = 2, openFails = false;
  const updater = createStoreUpdate({version:'1.0.3',enabled:true,notify:value=>changed.push(value.status),
    getWindow:()=>({isDestroyed:()=>false,getNativeWindowHandle:()=>hwnd}),isClosing:()=>false,
    loadNative:()=>({begin(handle, install) { assert.equal(handle,hwnd); calls.push(install); return 1; },result:()=>nativeStatus}),
    delay:async()=>{}, openExternal:async uri=>{calls.push(uri); if (openFails) throw Error('mock no handler');},
  });
  const edge = path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe');
  const browser = await chromium.launch({headless:true, executablePath:edge});
  try {
    const page = await browser.newPage({viewport:{width:480,height:560}});
    const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    await page.exposeFunction('fixtureUpdate', action=>updater[action]());
    async function mount(initial, chinese = true, source = payload) {
      await page.setContent(updateArticle(source));
      await page.addScriptTag({path:path.join(source,'src/ui/app-update.js')});
      await page.evaluate(({initial,chinese})=>{
        window.arcade = {appUpdateCheck:()=>fixtureUpdate('check'),appUpdateStart:()=>fixtureUpdate('start'),
          appUpdateOpenStore:()=>fixtureUpdate('openStore')};
        window.mountAppUpdate((zh,en)=>chinese?zh:en)(initial);
      },{initial,chinese});
    }
    const status = page.locator('#app-update-status');
    const check = page.locator('#app-update-check');
    const apply = page.locator('#app-update-apply');
    const openStore = page.locator('#app-update-open-store');
    const message = text => status.filter({hasText:text}).waitFor();

    const baseline = baselineArg ? path.resolve(baselineArg) : payload;
    const {createWindowsUpdate: baselineUpdater} = require(path.join(baseline,'src/core/windows-app-update.cjs'));
    await mount(baselineUpdater({version:'1.0.3',binding:null}).state(),true,baseline);
    await message('本机日用发行入口'); // Baseline state from the pre-change Store main.
    assert.equal(await openStore.isVisible(), false);
    assert.equal(await apply.isVisible(), false);
    const testBuild = createStoreUpdate({version:'1.0.3',enabled:false});
    await mount(testBuild.state());
    await message('没有正式商店身份');
    assert.equal(await check.isEnabled(), false);
    assert.equal(await apply.isVisible(), false);
    assert.equal(await openStore.isVisible(), false);
    assert.equal((await testBuild.check()).status,'test_build');
    assert.equal((await testBuild.openStore()).status,'test_build');

    await mount(updater.state());
    assert.match(await page.locator('#app-update-version').innerText(),/1\.0\.3/u);
    await check.click(); await message('当前没有提供新版');
    nativeStatus = 3;
    await check.click(); await message('请先保存草稿');
    assert.match(await apply.innerText(),/下载并安装/u);
    nativeStatus = 5;
    await apply.click(); await message('已取消更新');
    nativeStatus = 4;
    await apply.click(); await message('已报告安装完成');
    assert.match(await page.locator('#app-update-version').innerText(),/1\.0\.3/u);
    nativeStatus = 7;
    await check.click(); await message('Wi-Fi');
    openFails = true;
    await openStore.click(); await message('无法打开商店更新页');
    openFails = false;
    await openStore.click(); await message('已请求打开商店更新页');
    assert.doesNotMatch(await status.innerText(),/安装完成/u);
    await mount(updater.state(),false);
    await message('Requested the Store updates page.');
    assert.deepEqual(calls,[0,0,1,1,0,'ms-windows-store://downloadsandupdates','ms-windows-store://downloadsandupdates']);
    assert.deepEqual(changed,['checking','current','checking','available','installing','cancelled','installing','completed',
      'checking','network','store_open_failed','store_opened']);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test('rapid duplicate check and install requests cannot open a second consent flow', async () => {
  let resume, n = 0;
  const updater = createStoreUpdate({version:'1.0.0',enabled:true,isClosing:()=>false,
    getWindow:()=>({isDestroyed:()=>false,getNativeWindowHandle:()=>Buffer.alloc(8)}),
    loadNative:()=>({begin:()=>{n++;return 1;},result:()=>n === 1 ? 3 : 5}),
    delay:()=>new Promise(resolve=>{resume=resolve;}),
  });
  const check = updater.check();
  assert.equal((await updater.start()).status,'checking');
  resume(); await check;
  const install = updater.start();
  assert.equal((await updater.start()).status,'installing');
  resume(); await install;
  assert.equal(n,2);
});

test('the personal update coordinator still does local check, prepare, quit and one commit', async () => {
  const current = '0.4.0-preview.61.personal.54', target = '0.4.0-preview.61.personal.59';
  const calls = [];
  const updater = createWindowsUpdate({version:current,binding:{local:true},identity:()=>({pid:123}),
    isClosing:()=>false,confirm:async value=>value===target,quit:()=>calls.push('quit'),
    open:async (binding,request)=>{
      assert.equal(binding.local,true);assert.equal(request.pid,123);calls.push(request.action);
      return {result:{status:request.action==='check'?'available':'prepared',target},commit:async()=>calls.push('commit')};
    },
  });
  assert.equal((await updater.check()).target,target);
  assert.equal((await updater.start(target)).status,'restarting');
  await updater.commit(); await updater.commit();
  assert.deepEqual(calls,['check','prepare','quit','commit']);
});
