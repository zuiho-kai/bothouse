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

const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const zipReader=String.raw`
import json,sys,zipfile,hashlib,base64
def read(bundle):
    with zipfile.ZipFile(bundle) as archive:
        def asset(file):
            names=[name for name in archive.namelist() if name.endswith('/client/'+file) or name=='client/'+file]
            assert len(names)==1,names
            return base64.b64encode(archive.read(names[0])).decode()
        return {file:asset(file) for file in ('index.html','app.js')}
print(json.dumps([read(bundle) for bundle in sys.argv[1:]]))
`;
const button=(page,name)=>page.getByRole('button',{name,exact:true});

async function main(){
  const [oldZip,newZip,output]=process.argv.slice(2);
  assert.ok(output,'Usage: node social/client/.qa/verify-mention-upgrade.cjs <.37 ZIP> <.38 ZIP> <fresh-output>');
  await fs.mkdir(output);
  const assets=JSON.parse(execFileSync('python',['-c',zipReader,oldZip,newZip],{encoding:'utf8',maxBuffer:4*1024*1024}))
    .map(files=>Object.fromEntries(Object.entries(files).map(([name,data])=>[name,Buffer.from(data,'base64')])));
  const [old,release]=assets;
  const fixes=await fs.readFile(path.resolve(__dirname,'../app.js'));
  assert.equal(sha(old['index.html']),'58f46ebee4d20906a37c6f0f0e2132395aa154e6dbbf8bc488ab048e704259b1');
  assert.equal(sha(old['app.js']),'ab25337a509c2c94b2e260d15b7b1236d6466e6c13f64c2c2afcfb9b9cb144f4');
  for(const file of ['index.html','app.js']){
    const frozen=execFileSync('git',['show','60e2d1e5:social/client/'+file],{cwd:path.resolve(__dirname,'../../..')});
    assert.equal(sha(release[file]),sha(frozen));
  }

  const store=new SocialStore(path.join(output,'synthetic.sqlite'));
  const server=createServer(store).listen(0,'127.0.0.1');
  let browser;
  try{
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking','--disable-gpu']});
    let externalRequests=0;
    async function actor(number,displayName){
      const context=await browser.newContext({viewport:{width:440,height:830},serviceWorkers:'block'});
      await context.route('**/*',route=>{
        if(route.request().url().startsWith(origin+'/'))return route.continue();
        externalRequests++;
        return route.abort();
      });
      async function api(route,data){
        const response=await context.request.fetch(origin+'/api/v1'+route,
          {method:data===undefined?'GET':'POST',data});
        assert.equal(response.status(),200,route);
        return response.json();
      }
      await api('/register',{number,displayName,password:'social-138-mention-synthetic'});
      return {context,api,number};
    }
    const a=await actor('mention_a','合成阿林'),b=await actor('mention_b','合成小岑');
    const {request}=await a.api('/friend-requests',{number:b.number});
    const {conversation:direct}=await b.api('/friend-requests/'+request.id+'/accept',{});
    const {conversation:group}=await a.api('/groups',{title:'合成旧群',memberNumbers:[b.number]});
    const route=id=>'/conversations/'+id+'/messages';
    await a.api(route(direct.id),{clientId:'direct_seed_138',text:'原来的好友消息'});
    await a.api(route(group.id),{clientId:'group_seed_138',text:'原来的群聊消息'});
    async function open(page,title){
      if(await page.locator('#back').isVisible())await page.locator('#back').click();
      await page.locator('#directory-body').getByRole('button',{name:new RegExp('^'+title)}).click();
    }
    const chat=page=>page.locator('#message');
    const history=page=>page.locator('#history');
    async function mix(page,mode){
      await page.route(url=>url.origin===origin&&['/','/app.js'].includes(url.pathname),async request=>{
        const isPage=new URL(request.request().url()).pathname==='/';
        if(isPage)return request.fulfill({contentType:'text/html; charset=utf-8',body:mode.document['index.html']});
        // Preserve the production service's build prefix when serving cached script bytes.
        const script=mode.script;
        const prefix=Buffer.from('const servedClientBuild = "'+sha(script)+'";\n');
        return request.fulfill({contentType:'application/javascript; charset=utf-8',body:Buffer.concat([prefix,script])});
      });
    }
    const red=await b.context.newPage();
    await mix(red,{document:old,script:release['app.js']});
    await red.goto(origin);
    await expect(red.locator('#workspace')).toBeVisible();
    const redError=red.waitForEvent('pageerror',{timeout:10000});
    await open(red,'合成旧群');
    const originalFailure=(await redError).message;
    assert.match(originalFailure,/null.*(?:hidden|properties)/u);
    await red.close();

    const reader=await b.context.newPage(),peer=await a.context.newPage();
    const mode={document:old,script:old['app.js']};
    await mix(reader,mode);
    const errors=[];
    reader.on('pageerror',error=>errors.push(error.message));
    await Promise.all([reader.goto(origin),peer.goto(origin)]);
    await Promise.all([open(reader,'合成旧群'),open(peer,'合成旧群')]);
    await expect(history(reader)).toContainText('原来的群聊消息');
    await chat(reader).fill('旧群未发草稿');
    const groupURL=reader.url();
    await open(reader,'合成阿林');
    await expect(history(reader)).toContainText('原来的好友消息');
    await chat(reader).fill('好友未发草稿');
    const directURL=reader.url();
    assert.notEqual(groupURL,directURL);

    mode.script=fixes;
    await reader.reload();
    await expect(chat(reader)).toHaveValue('好友未发草稿');
    assert.equal(reader.url(),directURL);
    await expect(history(reader)).toContainText('原来的好友消息');
    await open(reader,'合成旧群');
    await expect(history(reader)).toContainText('原来的群聊消息');
    await expect(chat(reader)).toHaveValue('旧群未发草稿');
    await expect(reader.locator('#mention-suggestions')).toHaveCount(0);
    await expect(chat(reader)).not.toHaveAttribute('aria-autocomplete','list');

    const chinese='旧群未发草稿，中文候选 @合成阿林';
    await chat(reader).focus();
    await chat(reader).dispatchEvent('compositionstart',{data:''});
    await chat(reader).fill(chinese);
    await chat(reader).dispatchEvent('keydown',{key:'Enter',keyCode:229,isComposing:true});
    await expect(chat(reader)).toHaveValue(chinese);
    await chat(reader).dispatchEvent('compositionend',{data:'中文候选'});
    await button(reader,'发送').click();
    await expect(history(peer)).toContainText(chinese,{timeout:10000});
    const afterPlain=await a.api(route(group.id));
    const plainRows=afterPlain.messages.filter(message=>message.text===chinese);
    assert.equal(plainRows.length,1);
    assert.ok(!plainRows[0].mention);

    await chat(reader).fill('换版前写在群里的草稿');
    mode.document=release;mode.script=old['app.js'];
    await reader.reload();
    await expect(chat(reader)).toHaveValue('换版前写在群里的草稿');
    await expect(reader.locator('#mention-suggestions')).toBeHidden();
    await chat(reader).press('End');
    await chat(reader).pressSequentially('@');
    await expect(reader.locator('#mention-suggestions')).toBeHidden();
    await chat(reader).fill('换版前写在群里的草稿');

    mode.script=fixes;
    await reader.reload();
    await expect(chat(reader)).toHaveValue('换版前写在群里的草稿');
    await open(reader,'合成阿林');
    await expect(chat(reader)).toHaveValue('好友未发草稿');
    await button(reader,'发送').click();
    let directMatch;
    await expect.poll(async()=>{
      const result=await a.api(route(direct.id));
      directMatch=result.messages.filter(message=>message.text==='好友未发草稿');
      return directMatch.length;
    }).toBe(1);
    await open(reader,'合成旧群');
    await chat(reader).fill('@合成阿林');
    const option=reader.getByRole('option',{name:/合成阿林/u});
    await expect(option).toBeVisible();
    await option.click();
    await chat(reader).press('End');
    await chat(reader).pressSequentially(' 点名后的正文');
    const mentionText='点名后的正文';
    await button(reader,'发送').click();
    await expect.poll(async()=>{
      const result=await a.api(route(group.id));
      return result.messages.filter(message=>message.mention?.number===a.number&&message.text===mentionText).length;
    }).toBe(1);
    assert.deepEqual(errors,[]);
    assert.equal(externalRequests,0);
    const result={oldPackage:sha(await fs.readFile(oldZip)),releasePackage:sha(await fs.readFile(newZip)),
      assetDigests:assets.map(set=>Object.fromEntries(Object.entries(set).map(([file,data])=>[file,sha(data)]))),
      candidateScript:sha(fixes),originalFailure,originalLoginVisible:true,
      combinations:['.37 page / .37 JS','.37 page / fixed .38 JS','.38 page / .37 JS','.38 page / fixed .38 JS'],
      realFriendAndGroup:true,restoredDrafts:true,chineseComposerAndPlainSend:true,structuredMentionSentOnce:true,
      unexpectedPageErrors:errors,externalRequests,visibleWindows:0};
    await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
  }finally{
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
