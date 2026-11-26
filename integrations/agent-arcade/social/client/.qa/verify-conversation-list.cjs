'use strict';

// Headless Edge against the real Friends HTTP entry and an isolated SQLite store.
const assert = require('node:assert/strict');
const {once} = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium,expect} = require('playwright/test');
const {createServer} = require('../../server/http.cjs');
const {SocialStore} = require('../../server/store.cjs');
const {clientRelease,entryFiles} = require('../../server/client-release.cjs');
const {createHash} = require('node:crypto');

async function main(){
  const output = path.resolve(process.argv[2]);
  await fs.mkdir(output,{recursive:true});
  // Old archival preflight must compute the same release ID without the new module.
  const legacyFiles = entryFiles.filter(name => name !== 'conversation-list.js');
  const oldAssets = new Map(await Promise.all(legacyFiles.map(async name =>
    [name,await fs.readFile(path.join(__dirname,'..',name))])));
  const previous = createHash('sha256');
  for(const [name,bytes] of oldAssets) {
    previous.update(name+'\0').update(createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(clientRelease(oldAssets).build,previous.digest('hex'));
  const store = new SocialStore(':memory:');
  const server = createServer(store).listen(0,'127.0.0.1');
  await once(server,'listening');
  const origin = 'http://127.0.0.1:'+server.address().port;
  const browser = await chromium.launch({channel:'msedge',headless:true,
    args:['--disable-background-networking','--disable-component-update','--disable-sync']});
  const errors=[], external=[], checks=[];
  const password='synthetic-list-test-password';
  try {
    const a=await browser.newContext({viewport:{width:1120,height:800}}),b=await browser.newContext();
    async function api(context,route,body){
      const response=await context.request.fetch(origin+'/api/v1'+route,{
        method:body===undefined?'GET':'POST',data:body,
      });
      assert.equal(response.status(),200,route);
      return response.json();
    }
    await api(a,'/register',{number:'pins_first',displayName:'小禾',password});
    await api(b,'/register',{number:'pins_other',displayName:'林杉 Alice',password});
    const {request}=await api(a,'/friend-requests',{number:'pins_other'});
    const dm=(await api(b,'/friend-requests/'+request.id+'/accept',{})).conversation.id;
    const group=(await api(a,'/groups',{title:'河畔读书会',memberNumbers:['pins_other']})).conversation.id;
    await api(a,'/conversations/'+group+'/messages',{clientId:'group-message-fixture',text:'这句用于验证实时排序。'});
    await api(b,'/conversations/'+dm+'/messages',{clientId:'direct-message-fixture',text:'私聊原会话测试。'});
    const before=(await api(a,'/conversations')).conversations.map(row=>row.id);
    assert.deepEqual(before,[dm,group]);
    let page;
    const dir=()=>page.locator('#directory-body');
    const order=()=>dir().locator('[data-chat-id]').evaluateAll(rows=>rows.map(n=>n.dataset.chatId));
    const chatRow=id=>dir().locator('[data-chat-id="'+id+'"]');
    const tools=id=>dir().locator('.conversation-row[data-id="'+id+'"]').getByRole('button',{name:'会话操作'});
    const search=()=>page.getByRole('searchbox',{name:'搜索会话'});
    const clear=()=>page.getByRole('button',{name:'清除会话搜索'});
    const menuAction=name=>page.locator('#conversation-list-menu').getByRole('button',{name,exact:true});
    const tab=name=>page.locator('[data-tab="'+name+'"]');
    async function openPage(){
      const p=await a.newPage();
      p.on('pageerror',e=>errors.push(e.message));
      await p.route('**/*',route=>{
        if(new URL(route.request().url()).origin===origin)return route.continue();
        external.push(route.request().url());return route.abort();
      });
      return p;
    }
    page=await openPage();
    const moduleResponse=page.waitForResponse(res=>res.url().endsWith('/conversation-list.js'));
    await page.goto(origin);
    const asset=await moduleResponse;
    assert.equal(asset.status(),200);
    assert.match(new URL(asset.url()).pathname,/^\/_friends\/[a-f0-9]{64}\/conversation-list\.js$/);
    assert.match((await asset.allHeaders())['cache-control'],/immutable/);
    await expect(search()).toBeVisible();
    await expect(chatRow(dm)).toHaveAttribute('aria-label',/未读/);
    assert.deepEqual(await order(),before);
    await tools(group).focus();
    await tools(group).press('Enter');
    await expect(menuAction('置顶会话')).toBeFocused();
    await menuAction('置顶会话').press('Enter');
    await expect(tools(group)).toBeFocused();
    await expect(chatRow(group)).toHaveAttribute('aria-description','已置顶');
    assert.deepEqual(await order(),[group,dm]);
    await page.screenshot({path:path.join(output,'01-desktop-pinned.png')});
    checks.push('桌面用键盘打开列表菜单并置顶，未读标记保留');

    await page.close();
    page=await openPage();await page.goto(origin);await expect(search()).toBeVisible();
    assert.deepEqual(await order(),[group,dm]);
    await api(b,'/conversations/'+dm+'/messages',{clientId:'new-chat-while-pinned',text:'置顶后也保持在第一条之外。'});
    await expect(chatRow(dm)).toContainText('置顶后也保持在第一条之外。');
    assert.deepEqual(await order(),[group,dm]);
    checks.push('同一浏览器关闭再开仍置顶，未置顶私聊的新消息照常刷新');

    await search().fill('读书');
    await search().press('Enter');
    await expect(page.locator('#message')).toBeFocused();
    await page.setViewportSize({width:360,height:760});
    if(await page.locator('#back').isVisible())await page.locator('#back').click();
    await search().fill('  ＡＬＩＣＥ ');
    assert.deepEqual(await order(),[dm]);
    await expect(search()).toBeFocused();
    await search().dispatchEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true});
    assert.equal(new URL(page.url()).hash,'');
    await search().press('Enter');
    await expect(page.locator('#history')).toContainText('私聊原会话测试。');
    assert.equal(decodeURIComponent(new URL(page.url()).hash.slice(6)),dm);
    await page.locator('#back').click();
    await expect(search()).toHaveValue('  ＡＬＩＣＥ ');
    await search().fill('读书');
    assert.deepEqual(await order(),[group]);
    await page.screenshot({path:path.join(output,'02-narrow-search.png')});
    await search().press('ArrowDown');
    await expect(chatRow(group)).toBeFocused();
    await chatRow(group).press('Enter');
    await expect(page.locator('#history')).toContainText('这句用于验证实时排序。');
    assert.equal(decodeURIComponent(new URL(page.url()).hash.slice(6)),group);
    await page.locator('#back').click();
    await search().fill('置顶后也保持');
    await expect(dir()).toContainText('未找到会话');
    await clear().click();
    await expect(search()).toBeFocused();
    assert.deepEqual(await order(),[group,dm]);
    checks.push('窄窗中英文按名称即时找回原私聊和群，IME 确认不跳转，清除恢复置顶顺序');

    await chatRow(group).press('Shift+F10');
    await expect(menuAction('取消置顶')).toBeFocused();
    await page.screenshot({path:path.join(output,'03-narrow-menu.png')});
    await menuAction('取消置顶').press('Escape');
    await expect(tools(group)).toBeFocused();
    await expect(menuAction('取消置顶')).toBeHidden();
    await tools(group).click();
    await menuAction('取消置顶').click();
    assert.deepEqual(await order(),before);
    await page.reload();await expect(search()).toBeVisible();
    assert.deepEqual(await order(),before);
    checks.push('快捷菜单 Escape 返回焦点，取消置顶和重开恢复服务原顺序');

    await tools(group).click();await menuAction('置顶会话').click();
    await search().fill('读书');
    async function switchTo(number){
      await tab('profile').click();
      await page.getByRole('button',{name:'退出登录',exact:true}).click();
      await page.locator('[name=number]').fill(number);
      await page.locator('[name=password]').fill(password);
      await page.locator('#auth-submit').click();
      await expect(search()).toBeVisible();
    }
    await switchTo('pins_other');
    await expect(search()).toHaveValue('');
    await expect(chatRow(group)).toBeVisible();
    await expect(dir().locator('[data-pinned]')).toHaveCount(0);
    await tools(dm).click();await menuAction('置顶会话').click();
    await switchTo('pins_first');
    await expect(dir().locator('[data-pinned]')).toHaveAttribute('data-id',group);
    assert.deepEqual(await order(),[group,dm]);
    checks.push('同一浏览器中换号，两个账号各有独立置顶。搜索词随会话退出清除');

    assert.deepEqual(errors,[]);
    assert.deepEqual(external,[]);
    const receipt={passed:true,checks,errors,external,productionHTTP:true,headless:true,moduleStatus:asset.status(),legacyReleaseDigestPreserved:true};
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify(receipt));
  } finally {
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
