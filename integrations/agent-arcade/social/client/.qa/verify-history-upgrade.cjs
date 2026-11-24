'use strict';

const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium,expect}=require('playwright/test');
const {SocialStore}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');

const base='2a99420e71e9bc47640f695d7e6ad3b8a3a23078';
const failed='163b94c254db07bebf682b4f90425106061a9507';
const root=path.resolve(__dirname,'../../..');
const readGit=(commit,file)=>execFileSync('git',['show',commit+':social/client/'+file],{cwd:root});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const button=(page,name)=>page.getByRole('button',{name,exact:true});

async function main(){
  const output=process.argv[2]&&path.resolve(process.argv[2]);
  if(!output)throw Error('Usage: node social/client/.qa/verify-history-upgrade.cjs <fresh-output-dir>');
  await fs.mkdir(output);
  // These digests were checked against the frozen .37 service ZIP.
  const oldDocument=readGit(base,'index.html'),oldScript=readGit(base,'app.js');
  const oldDocumentSha='58f46ebee4d20906a37c6f0f0e2132395aa154e6dbbf8bc488ab048e704259b1';
  const oldScriptSha='ab25337a509c2c94b2e260d15b7b1236d6466e6c13f64c2c2afcfb9b9cb144f4';
  assert.equal(sha(oldDocument),oldDocumentSha);
  assert.equal(sha(oldScript),oldScriptSha);
  const brokenScript=readGit(failed,'app.js');
  const store=new SocialStore(path.join(output,'synthetic.sqlite'));
  const server=createServer(store).listen(0,'127.0.0.1');
  let browser;
  try{
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    async function actor(number,displayName){
      const context=await browser.newContext({viewport:{width:420,height:830},serviceWorkers:'block'});
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      async function call(route,data){
        const response=await context.request.fetch(origin+'/api/v1'+route,
          {method:data===undefined?'GET':'POST',data});
        assert.equal(response.status(),200,route);
        return response.json();
      }
      await call('/register',{number,displayName,password:'history-upgrade-synthetic'});
      return {number,context,call};
    }
    const a=await actor('compat_sender','合成甲'),b=await actor('compat_reader','合成乙');
    const {request}=await a.call('/friend-requests',{number:b.number});
    const {conversation}=await b.call('/friend-requests/'+request.id+'/accept',{});
    const messages='/conversations/'+conversation.id+'/messages';
    const oldText='原有会话里的台阶旧消息。';
    const {message:old}=await a.call(messages,{clientId:'persisted_older_seed',text:oldText});
    function shell(page,modes){
      return page.route(url=>url.origin===origin&&['/','/app.js'].includes(url.pathname),async route=>{
        const isPage=new URL(route.request().url()).pathname==='/';
        if(isPage&&modes.document==='old'){
          await route.fulfill({contentType:'text/html; charset=utf-8',body:oldDocument});
        }else if(!isPage&&modes.script!=='new'){
          const script=modes.script==='broken'?brokenScript:oldScript;
          const prefix='const servedClientBuild = "'+sha(script)+'";\n';
          await route.fulfill({contentType:'application/javascript; charset=utf-8',
            body:Buffer.concat([Buffer.from(prefix),script])});
        }else await route.continue();
      });
    }
    const red=await b.context.newPage();
    await shell(red,{document:'old',script:'broken'});
    const error=red.waitForEvent('pageerror',{timeout:12000});
    await red.goto(origin);
    const originalFailure=(await error).message;
    assert.match(originalFailure,/null.*addEventListener/u);
    await expect(red.locator('#workspace')).toBeHidden();
    await red.close();

    const sender=await a.context.newPage(),reader=await b.context.newPage();
    const mode={document:'old',script:'old'};
    await shell(reader,mode);
    const errors=[];
    reader.on('pageerror',error=>errors.push(error.message));
    const chat=(page,name)=>page.locator('#directory-body').getByRole('button',{name:new RegExp(name)});
    const input=reader.locator('#message'),history=reader.locator('#history');
    const unchangedSession=async()=>expect(reader.locator('#workspace')).toBeVisible();
    const phases=[];
    await Promise.all([sender.goto(origin),reader.goto(origin)]);
    await Promise.all([chat(sender,'合成乙').click(),chat(reader,'合成甲').click()]);
    await expect(input).toBeVisible();
    await expect(history).toContainText(oldText);
    const originalChatURL=reader.url();
    assert.match(originalChatURL,/#.+/u);
    await input.fill('从旧页面保留的未发草稿。');
    phases.push('old-page + old-script');

    mode.script='new';
    await reader.reload();
    await unchangedSession();
    await expect(input).toHaveValue('从旧页面保留的未发草稿。');
    await expect(history).toContainText(oldText);
    await expect(reader.locator('#history-search')).toHaveCount(0);
    await expect(reader.locator('#chat-settings-toggle')).toBeHidden();
    assert.equal(reader.url(),originalChatURL);
    await button(reader,'发送').click();
    await expect(sender.locator('#history')).toContainText('从旧页面保留的未发草稿。',{timeout:10000});
    await expect(sender.locator('#history .body').filter({hasText:'从旧页面保留的未发草稿。'})).toHaveCount(1);
    phases.push('old-page + new-script');

    mode.document='new';mode.script='old';
    await reader.reload();
    await unchangedSession();
    await expect(history).toContainText(oldText);
    await expect(reader.locator('#history-search')).toHaveCount(1);
    await expect(reader.locator('#history-search')).toBeHidden();
    await expect(reader.locator('#chat-settings-toggle')).toBeHidden();
    await input.fill('切换脚本前另外写下的草稿。');
    phases.push('new-page + old-script');

    mode.script='new';
    await reader.reload();
    await unchangedSession();
    await expect(input).toHaveValue('切换脚本前另外写下的草稿。');
    await button(reader,'会话设置').click();
    await button(reader,'搜索消息').click();
    const dialog=reader.getByRole('dialog');
    await dialog.getByRole('searchbox',{name:'关键词'}).fill('台阶');
    await button(dialog,'搜索').click();
    await dialog.getByRole('button',{name:/台阶旧消息/}).click();
    await expect(history.locator('[data-history-message="'+old.id+'"]')).toHaveClass(/history-anchor/);
    await expect(input).toHaveValue('切换脚本前另外写下的草稿。');
    await button(reader,'回到最新消息').click();
    const live='升级完成以后收到的真人合成消息。';
    await sender.locator('#message').fill(live);
    await button(sender,'发送').click();
    await expect(history).toContainText(live,{timeout:10000});
    await expect(input).toHaveValue('切换脚本前另外写下的草稿。');
    assert.deepEqual(errors,[]);
    phases.push('new-page + new-script');

    const result={base,failed,oldDocumentSha,oldScriptSha,failedScriptSha:sha(brokenScript),originalFailure,
      phases,conversation:conversation.id,oldMessage:old.id,loginRestored:true,oldMessageRetained:true,
      oldDraftSentOnce:true,upgradeDraftRetained:true,searchAfterRefresh:true,newIncomingVisible:true,unexpectedPageErrors:errors,
      externalRequests:0,visibleWindows:0};
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(result,null,2)+'\n');
    console.log('PASS: exact .37 shell reproduces 163b94c2 error; all four repaired upgrade stages settled.');
  }finally{
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
