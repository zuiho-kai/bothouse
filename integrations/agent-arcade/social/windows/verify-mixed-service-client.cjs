'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const path = require('node:path');
const { chromium, expect } = require('playwright/test');

const host = '127.0.0.1';
const routes = ['/', '/app.js', '/style.css'];
const cases = [
  ['previous assets', routes],
  ['previous HTML, candidate JS/CSS', ['/']],
  ['candidate HTML, previous JS/CSS', ['/app.js', '/style.css']],
  ['candidate assets', []],
];

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function start(release, database, port = 0) {
  const { SocialStore } = require(path.join(release.directory, 'social/server/store.cjs'));
  const { createServer } = require(path.join(release.directory, 'social/server/http.cjs'));
  const store = new SocialStore(database);
  // Pass no provider or credentials. Use the same synthetic database after the switch.
  const server = createServer(store);
  try {
    const listening = once(server, 'listening');
    server.listen(port, host);
    await listening;
  } catch (error) {
    store.db.close();
    throw error;
  }
  return {
    port: server.address().port,
    async close() {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
      store.db.close();
    },
  };
}

async function replay(browser, database, prior, next, cachedRoutes, result, staleBuild=false, liveCutover=false) {
  const contexts = [];
  let service;
  const waitingScript=Promise.withResolvers(), releaseScript=Promise.withResolvers();
  try {
    service = await start(prior, database);
    const port = service.port;
    const origin = 'http://' + host + ':' + port;
    async function actor(number, displayName) {
      const context = await browser.newContext({ viewport: { width: 420, height: 800 }, serviceWorkers: 'block' });
      contexts.push(context);
      await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      async function api(endpoint, data) {
        const response = await context.request.fetch(origin + '/api/v1' + endpoint, {
          method: data === undefined ? 'GET' : 'POST', data, maxRedirects: 0,
        });
        assert.equal(response.status(), 200, endpoint);
        return response.json();
      }
      await api('/register', { number, displayName, password: 'synthetic-upgrade-only' });
      return { context, api };
    }
    const sender = await actor('upgrade_fixture_a', '合成发送人');
    const recipient = await actor('upgrade_fixture_b', '合成收件人');
    const request = (await sender.api('/friend-requests', { number: 'upgrade_fixture_b' })).request;
    await recipient.api('/friend-requests/' + request.id + '/accept', {});
    const title = '升级前已有的群';
    const { conversation } = await sender.api('/groups', { title, memberNumbers: ['upgrade_fixture_b'] });
    const feed = '/conversations/' + conversation.id + '/messages';
    const priorText = '服务切换前，这条群消息已经收到了。';
    const draft = '从旧会话保留的草稿，标点与空格  原样发送。';
    await sender.api(feed, { clientId: 'before_upgrade', text: priorText });

    const previous = new Map();
    for (const route of cachedRoutes) {
      const response = await fetch(origin + route, { redirect: 'error' });
      assert.equal(response.status, 200, 'Previous service ' + route);
      previous.set(route, { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') });
    }
    const page = await sender.context.newPage();
    const input = page.locator('#message');
    const history = page.locator('#history');
    const groupButton = current => current.locator('#directory-body').getByRole('button', { name: new RegExp(title) });
    await page.goto(origin);
    await groupButton(page).click();
    await expect(history).toContainText(priorText);
    await input.fill(draft);
    const groupUrl = page.url();
    assert(groupUrl.includes('#chat/'), 'Previous service did not open the existing group.');

    let switched=false;
    async function switchService(){
      await service.close();
      service=null;
      service=await start(next,database,port);
      switched=true;
    }
    if(!liveCutover)await switchService();
    result.stage = 'open existing group using mixed assets';
    const seen = new Set();
    let servedPreviousDocument=false;
    page.on('pageerror', error => result.pageErrors.push(error.stack||error.message));
    await page.route(url => url.origin === origin && (routes.includes(url.pathname)||url.pathname.startsWith('/_friends/')), async route => {
      const url=new URL(route.request().url()),name=url.pathname;
      if(liveCutover&&!switched&&name!=='/'){
        if(name==='/app.js')waitingScript.resolve(url.href);
        await releaseScript.promise;
      }
      const live=await route.fetch({maxRedirects:0,headers:{cookie:''}});
      const cached=previous.get(name);
      if(name==='/'){
        const text=(await live.body()).toString('utf8');
        if(liveCutover&&!switched){
          servedPreviousDocument=true;
          result.liveTransition={oldDocumentSha256:digest(text),oldDocumentLoadedBeforeSwitch:true};
        }
        const build=text.match(/data-friends-release="([a-f0-9]{64})"/u)?.[1];
        result.candidateBuild=build??null;
        const recovered=url.searchParams.has('friends-reload');
        if(recovered)result.recoveryNavigations=(result.recoveryNavigations??0)+1;
        if(staleBuild&&!recovered){
          assert(build,'Expected a pinned candidate document');
          return route.fulfill({response:live,body:text.replaceAll(build,build==='0'.repeat(64)?'1'.repeat(64):'0'.repeat(64))});
        }
        if(cached&&!recovered)servedPreviousDocument=true;
        if(recovered||!cached){
          result.assets[name]={from:'candidate',sha256:digest(text)};
          seen.add(name);
          return route.fulfill({response:live,body:text});
        }
      }
      if(live.status()!==200&&!cached)return route.fulfill({response:live});
      const body=cached?cached.body:await live.body();
      result.assets[name]={from:cached?'previous':'candidate',sha256:digest(body)};
      seen.add(name);
      await route.fulfill({response:live,body,contentType:cached?cached.contentType:live.headers()['content-type']});
    });
    if(liveCutover){
      await page.reload({waitUntil:'commit'});
      const timeout=AbortSignal.timeout(8000);
      const scriptUrl=await Promise.race([waitingScript.promise,new Promise((_,reject)=>{
        timeout.addEventListener('abort',()=>reject(Error('Legacy script was not requested before service switch.')),{once:true});
      })]);
      assert(result.liveTransition?.oldDocumentLoadedBeforeSwitch,'Old HTML was not served by the old process.');
      await switchService();
      Object.assign(result.liveTransition,{legacyScriptUrl:scriptUrl,scriptReleasedAfterSwitch:true});
      releaseScript.resolve();
    }else await page.reload();
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(history).toContainText(priorText);
    await expect(input).toHaveValue(draft);
    await expect(page).toHaveURL(groupUrl);
    if(liveCutover){
      assert.equal(result.assets['/app.js']?.from,'candidate');
      result.liveTransition.newLegacyScriptSha256=result.assets['/app.js'].sha256;
      result.liveTransition.recoveredPinnedBuild=result.candidateBuild;
      assert.equal(result.recoveryNavigations,1);
    }
    if(result.candidateBuild&&(!servedPreviousDocument||result.recoveryNavigations)){
      const prefix='/_friends/'+result.candidateBuild+'/';
      assert(seen.has(prefix+'app.js')&&seen.has(prefix+'style.css'),'Candidate document did not load its own assets.');
      if(!servedPreviousDocument&&!staleBuild)assert(!seen.has('/app.js'),'Candidate document used old script URL.');
      if(staleBuild||servedPreviousDocument)assert.equal(result.recoveryNavigations,1,'Stale resources must recover once.');
    }else{
      assert(seen.has('/')&&seen.has('/app.js')&&seen.has('/style.css'),'Legacy assets missing.');
    }
    assert.deepEqual(result.pageErrors, []);

    result.stage = 'send saved draft and verify on the recipient page';
    const other = await recipient.context.newPage();
    other.on('pageerror', error => result.pageErrors.push(error.stack||error.message));
    await other.goto(origin);
    await groupButton(other).click();
    await expect(other.locator('#history')).toContainText(priorText);
    const outgoing=page.waitForRequest(request=>request.method()==='POST'&&request.url()===origin+'/api/v1'+feed);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const sent=(await outgoing).postDataJSON();
    await expect(other.locator('#history')).toContainText(draft.replace('  ', ' '), { timeout: 10000 });
    await expect(input).toHaveValue('');
    const original=(await recipient.api(feed)).messages.find(message=>message.text===draft);
    const retry=await sender.api(feed,sent);
    assert.equal(retry.message.id,original.id,'Sender retry must return the same message id.');
    const received = (await recipient.api(feed)).messages.filter(message => message.text === draft);
    assert.equal(received.length, 1, 'Recipient must get the exact draft once.');
    result.recipientMessageId = received[0].id;
    assert.deepEqual(result.pageErrors, []);
    result.stage = 'verified';
  } finally {
    releaseScript.resolve();
    await Promise.all(contexts.map(context => context.close()));
    if (service) await service.close();
  }
}

async function verifyMixedClient(scratch, prior, next) {
  const receipt = { status: 'failed', previous: { version: prior.version, source: prior.source, sha256: prior.sha256 },
    candidate: { version: next.version, source: next.source, sha256: next.sha256 }, cases: [] };
  const browser = await chromium.launch({ channel: 'msedge', headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--proxy-server=http://127.0.0.1:1'] });
  try {
    const pinned = require('node:fs').existsSync(path.join(next.directory,'social/client/client-start.js'));
    const runs=pinned?[...cases,['candidate cached document with retired asset version',[],true],
      ['old document fetched before switching the service',[],false,true]]:cases;
    for (const [label, cached, staleBuild, liveCutover] of runs) {
      const result = { label, stage: 'prepare previous group and draft', assets: {}, pageErrors: [] };
      receipt.cases.push(result);
      try {
        await replay(browser, path.join(scratch, 'case-' + receipt.cases.length + '.sqlite'), prior, next, cached, result, staleBuild, liveCutover);
      } catch (error) {
        result.error = error.message;
      }
    }
    if (receipt.cases.some(result => result.stage !== 'verified' || result.error)) {
      const error = new Error('Service upgrade mixed-client replay failed.');
      error.upgrade = receipt;
      throw error;
    }
    receipt.status = 'verified';
    return receipt;
  } finally {
    await browser.close();
  }
}

module.exports = { verifyMixedClient };
