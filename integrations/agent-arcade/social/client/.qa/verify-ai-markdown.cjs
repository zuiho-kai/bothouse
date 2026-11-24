'use strict';
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium,expect}=require('playwright/test');
const {SocialStore,AI_NUMBER}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');

const reply=[
  '**检查步骤**',
  '',
  '1. 打开项目目录',
  '2. 执行命令',
  '',
  '```js',
  'const ok = true;',
  '```',
  '',
  '[示例出处](https://example.test/docs)',
  '<img src="https://example.test/raw.png">',
  '[无效地址](javascript:void(0))',
].join('\n');
const rendererRoute='/vendor/bothouse/rh-md.js';
const faultPrompt='测试单条排版降级。';
const faultReply='**QA渲染故障**';

async function main(){
  const proof=process.argv[2]&&path.resolve(process.argv[2]);
  const store=new SocialStore(':memory:');
  let browser,service;
  let modelCalls=0,externalRequests=0;
  const aiProvider={name:'鲸鱼娘',provider:'deepseek',groupRoles:[{number:AI_NUMBER,name:'鲸鱼娘'}],
    async generate(context){
      modelCalls++;
      return context.at(-1).content===faultPrompt?faultReply:reply;
    }};
  try{
    service=createServer(store,{aiProvider}).listen(0,'127.0.0.1');
    await once(service,'listening');
    const origin='http://127.0.0.1:'+service.address().port;
    const asset=await fetch(origin+rendererRoute);
    assert.equal(asset.status,200);
    assert.match(asset.headers.get('content-type'),/^text\/javascript/);
    const rendererSha256=createHash('sha256').update(Buffer.from(await asset.arrayBuffer())).digest('hex');
    assert.equal(rendererSha256,'15f35ca92ef148bdc754025df6c7ebebabeaaad3a16be4edaa29c960474fd4f8');

    browser=await chromium.launch({channel:'msedge',headless:true,
      args:['--disable-background-networking','--disable-gpu','--no-proxy-server']});
    const [a,b]=await Promise.all([browser.newPage({viewport:{width:360,height:780}}),browser.newPage()]);
    for(const page of [a,b])await page.route('**/*',route=>{
      if(new URL(route.request().url()).origin===origin)return route.continue();
      externalRequests++;
      return route.abort();
    });
    async function api(page,endpoint,data){
      const url=origin+'/api/v1'+endpoint;
      const response=await (data===undefined?page.request.get(url):page.request.post(url,{data}));
      assert.equal(response.status(),200,endpoint);
      return response.json();
    }
    for(const [page,number] of [[a,'markdown_alpha'],[b,'markdown_beta']])
      await api(page,'/register',{number,password:'synthetic only',displayName:number});
    const {request}=await api(a,'/friend-requests',{number:'markdown_beta'});
    const {conversation:humanChat}=await api(b,'/friend-requests/'+request.id+'/accept',{});
    const {conversation:direct}=await api(a,'/ai-contacts/start',{
      number:AI_NUMBER,expectedAccount:'markdown_alpha',allowCloud:true,provider:'deepseek'});
    const {conversation:group}=await api(a,'/groups',{title:'格式验收群',memberNumbers:['markdown_beta']});
    const groupRoute='/groups/'+group.id;
    await api(a,groupRoute+'/ai',{number:AI_NUMBER,enabled:true,expectedAccount:'markdown_alpha'});
    await api(a,groupRoute+'/ai-consent',{number:AI_NUMBER,provider:'deepseek',enabled:true,expectedAccount:'markdown_alpha'});
    await a.goto(origin+'/#chat/'+direct.id);
    const input=a.locator('textarea').first();
    await input.fill('请列出示例的检查步骤。');
    await a.getByRole('button',{name:'发送',exact:true}).click();
    const bubble=a.locator('#history .ai-markdown').last();
    await expect(bubble.locator('strong')).toHaveText('检查步骤');
    await expect(bubble.locator('ol li')).toHaveText(['打开项目目录','执行命令']);
    await expect(bubble.locator('pre code')).toHaveText('const ok = true;');
    await expect(bubble).toContainText('示例出处 (https://example.test/docs)');
    await expect(bubble).toContainText('<img src="https://example.test/raw.png">');
    await expect(bubble.locator('a,img')).toHaveCount(0);
    assert.equal(modelCalls,1);
    const history=await api(a,'/conversations/'+direct.id+'/messages');
    assert.equal(history.messages.find(m=>m.sender.number===AI_NUMBER).text,reply);
    await a.reload();
    await expect(bubble.locator('strong')).toHaveText('检查步骤');
    if(proof){
      await fs.mkdir(proof,{recursive:true});
      await a.screenshot({path:path.join(proof,'ai-direct-markdown.png')});
    }

    await api(a,'/conversations/'+group.id+'/messages',{
      text:'也在群里列一下检查步骤。',clientId:'markdown_group_1',mentionAccount:AI_NUMBER});
    await b.goto(origin+'/#chat/'+group.id);
    await expect(b.locator('#history .ai-markdown ol li')).toHaveCount(2);
    assert.equal(modelCalls,2);

    const literal='**真人保留原样** <b>文字</b>';
    await api(a,'/conversations/'+humanChat.id+'/messages',{text:literal,clientId:'markdown_human_1'});
    await b.goto(origin+'/#chat/'+humanChat.id);
    await expect(b.locator('#history p.body')).toHaveText(literal);
    await expect(b.locator('#history .ai-markdown')).toHaveCount(0);
    assert.equal(modelCalls,2);

    await a.route('**'+rendererRoute,route=>route.fulfill({status:404,body:'missing'}));
    await a.goto(origin+'/#chat/'+direct.id);
    await a.reload();
    await expect(a.locator('#history p.body').last()).toContainText('**检查步骤**');
    await expect(a.locator('#history .ai-markdown')).toHaveCount(0);
    await expect(a.getByRole('button',{name:'发送',exact:true})).toBeVisible();

    await a.unroute('**'+rendererRoute);
    await a.reload();
    await input.fill(faultPrompt);
    await a.getByRole('button',{name:'发送',exact:true}).click();
    await expect(a.locator('#history .ai-markdown strong').last()).toHaveText('QA渲染故障');
    assert.equal(modelCalls,3);
    await a.route('**'+rendererRoute,async route=>{
      const original=await route.fetch();
      const injection=`
        const upstreamRender = window.renderMarkdown;
        window.renderMarkdown = function(text) {
          if (text === ${JSON.stringify(faultReply)}) throw new Error('synthetic renderer exception');
          return upstreamRender(text);
        };`;
      await route.fulfill({response:original,body:(await original.text())+injection});
    });
    await a.reload();
    await expect(a.locator('#history p.body').filter({hasText:faultReply})).toBeVisible();
    await expect(a.locator('#history .ai-markdown strong')).toHaveText('检查步骤');
    await expect(a.locator('#history .ai-markdown ol li')).toHaveCount(2);
    await expect(a.locator('#history')).not.toContainText('暂时连不上服务');
    assert.equal(modelCalls,3);
    if(proof)await a.screenshot({path:path.join(proof,'ai-markdown-single-error.png')});
    assert.equal(externalRequests,0);
    const result={passed:true,rendererSha256,modelCalls,externalRequests,direct:true,groupRecipient:true,
      plainHuman:true,reloadPreservesFormatting:true,missingRendererFallback:true,modelLinksInert:true,
      rawTextPersisted:true,oneRendererExceptionKeptHistory:true,healthyNeighborFormatted:true};
    if(proof)await fs.writeFile(path.join(proof,'receipt.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
  }finally{
    await browser?.close();
    if(service?.listening)await new Promise(resolve=>service.close(resolve));
    store.db.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
