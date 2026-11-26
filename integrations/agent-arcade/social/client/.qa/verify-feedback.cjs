'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { SocialStore } = require('../../server/store.cjs');
const { createServer } = require('../../server/http.cjs');

async function main() {
  const tempRoot = await fs.realpath(os.tmpdir());
  const temp = await fs.mkdtemp(path.join(tempRoot, 'arcade-feedback-'));
  const db = path.join(temp, 'test.sqlite');
  const store = new SocialStore(db);
  const server = createServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel:'msedge', headless:true,
      args:['--disable-background-networking','--disable-gpu'] });
    const errors = [];
    async function register(number, viewport) {
      const context = await browser.newContext({viewport, serviceWorkers:'block'});
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      const page = await context.newPage();
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin);
      await page.getByRole('button',{name:'创建账号',exact:true}).click();
      await page.locator('[name=number]').fill(number);
      await page.locator('[name=displayName]').fill('同名合成用户');
      await page.locator('[name=password]').fill('synthetic password 123');
      await page.locator('#auth-submit').click();
      await page.getByRole('heading',{name:'消息',exact:true}).waitFor();
      return page;
    }
    async function open(page) {
      await page.getByRole('button',{name:'我',exact:true}).click();
      await page.getByRole('button',{name:'意见反馈',exact:true}).click();
      await page.getByRole('heading',{name:'我的反馈'}).waitFor();
    }

    const a = await register('feedback_a',{width:390,height:844});
    const b = await register('feedback_b',{width:1024,height:768});
    const submissions = [];
    let drop = true;
    await a.route('**/api/v1/feedback',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      const response = await route.fetch();
      const data = await response.json();
      assert.equal(response.status(),200);
      submissions.push({request:route.request().postDataJSON(),receipt:data.feedback});
      if(drop){drop=false;return route.abort('connectionreset');}
      return route.fulfill({response});
    });

    await open(a);
    const idea = '消息列表的字体可以再大一点 <b>纯文本</b>';
    await a.getByLabel('问题或建议').fill(idea);
    await a.getByRole('button',{name:'提交反馈'}).click();
    await a.getByText('暂时连不上服务，请检查网络后重试。',{exact:true}).waitFor();
    await a.reload();
    await open(a);
    assert.equal(await a.getByLabel('问题或建议').inputValue(),idea);
    await a.getByRole('button',{name:'提交反馈'}).click();
    await a.getByText('已收到反馈。',{exact:true}).waitFor();
    assert.deepEqual(submissions[1],submissions[0]);
    await a.getByText(idea,{exact:true}).waitFor();
    assert.equal(await a.locator('.feedback-history article').count(),1);
    assert.equal(await a.locator('.feedback-history b').count(),0);
    const screenshot = process.argv[2];
    if(screenshot)await a.screenshot({path:screenshot});

    await open(b);
    await b.getByText('还没有提交反馈。',{exact:true}).waitFor();
    assert.equal(await b.getByText(idea,{exact:true}).count(),0);
    const second = '群聊里希望更容易找到返回按钮';
    await b.getByLabel('问题或建议').fill(second);
    await b.getByRole('button',{name:'提交反馈'}).click();
    await b.getByText('已收到反馈。',{exact:true}).waitFor();
    await b.getByRole('button',{name:'关闭',exact:true}).click();
    await open(b);
    await b.getByText(second,{exact:true}).waitFor();
    assert.equal(await b.getByText(idea,{exact:true}).count(),0);

    const operator = JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'../../server/moderate.cjs'),'feedback'],{
      env:{...process.env,SOCIAL_DB:db},encoding:'utf8',windowsHide:true,
    }));
    assert.equal(operator.length,2);
    assert.deepEqual(new Set(operator.map(row=>row.text)),new Set([idea,second]));
    assert(operator.every(row=>row.clientType==='web'&&row.desktopVersion===null&&/^[a-f0-9]{64}$/.test(row.clientBuild)&&!('account' in row)));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({browser:browser.version(),viewports:['390×844','1024×768'],
      failedReceiptDeliveryRetried:submissions.length===2,operator,errors},null,2));
  } finally {
    try { await browser?.close(); }
    finally {
      server.closeAllConnections();
      await new Promise(resolve=>server.close(resolve));
      store.db.close();
      assert.equal(path.dirname(temp),tempRoot);
      assert.match(path.basename(temp),/^arcade-feedback-[a-z0-9]{6}$/iu);
      await fs.rm(temp,{recursive:true,force:true});
    }
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
