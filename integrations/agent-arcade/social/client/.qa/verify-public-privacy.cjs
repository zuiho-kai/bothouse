'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {fork}=require('node:child_process');
const {once}=require('node:events');
const {chromium}=require('playwright');

async function main(){
  const output=process.argv[2];
  if(!output||process.argv.length!==3)throw Error('Usage: node verify-public-privacy.cjs NEW_OUTPUT_DIRECTORY');
  await fs.mkdir(output);
  const temporary=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'arcade-public-privacy-'));
  const filename=path.join(temporary,'social.sqlite');
  const server=path.resolve(__dirname,'../../server/main.cjs');
  const cases=[
    {id:'email',name:'合成主办 <甲> & 同伴',contact:'privacy+alpha@example.org',href:'mailto:privacy+alpha@example.org'},
    {id:'https',name:'合成运营乙',contact:'https://support.example.net/privacy?from=arcade&lang=zh',href:'https://support.example.net/privacy?from=arcade&lang=zh'},
    {id:'unconfigured'},
  ];
  const password='synthetic-login-password';
  const checks=[],errors=[];
  let child,browser;
  const launch=({name,contact})=>fork(server,[],{windowsHide:true,silent:true,env:{
    SystemRoot:process.env.SystemRoot||'',PATH:process.env.PATH||'',SOCIAL_DB:filename,SOCIAL_HOST:'127.0.0.1',SOCIAL_PORT:'0',
    ...(name&&{SOCIAL_PUBLIC_OPERATOR_NAME:name}),...(contact&&{SOCIAL_PUBLIC_PRIVACY_CONTACT:contact}),
  }});
  async function stop(){
    if(child&&child.exitCode===null&&child.signalCode===null){
      const gone=once(child,'exit');
      child.kill();
      await gone;
    }
    child=undefined;
  }
  try{
    browser=await chromium.launch({headless:true,channel:'msedge',args:['--disable-background-networking','--disable-sync']});
    for(const item of cases){
      child=launch(item);
      const [{port}]=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw Error('Server failed to start');})]);
      const origin='http://127.0.0.1:'+port;
      const [get,head]=await Promise.all([fetch(origin+'/privacy.html'),fetch(origin+'/privacy.html',{method:'HEAD'})]);
      assert.equal(get.status,200);
      assert.equal(head.status,200);
      const html=await get.text();
      assert.equal(await head.text(),'');
      assert.equal(Number(head.headers.get('content-length')),Buffer.byteLength(html));
      assert.match(get.headers.get('content-type'),/^text\/html/);
      assert.equal(get.headers.get('set-cookie'),null);
      assert.equal((await fetch(origin+'/api/v1/me')).status,401);
      if(item.id==='email'){
        assert.match(html,/合成主办 &lt;甲&gt; &amp; 同伴/);
        const response=await fetch(origin+'/api/v1/register',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({number:'privacy_fixture',displayName:'合成登录',password})});
        assert.equal(response.status,200);
      }
      if(item.id==='https')assert.match(html,/from=arcade&amp;lang=zh/);
      const context=await browser.newContext({viewport:{width:390,height:780}});
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      const page=await context.newPage();
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin);
      await page.getByRole('link',{name:'隐私说明',exact:true}).click();
      const section=page.getByRole('region',{name:'运营方与隐私联系'});
      if(item.href){
        await section.getByText('公开运营名称：'+item.name,{exact:true}).waitFor();
        assert.equal(await section.getByRole('link').getAttribute('href'),item.href);
        assert.equal(await section.getByRole('textbox',{name:'隐私联系方式'}).inputValue(),item.contact);
        await section.getByRole('button',{name:'复制联系方式'}).waitFor();
      } else {
        await section.getByText('此服务尚未公布运营名称和隐私联系方式。',{exact:true}).waitFor();
        assert.equal(await section.getByRole('link').count(),0);
        assert.equal(await section.getByRole('button',{name:'复制联系方式'}).count(),0);
      }
      await section.screenshot({path:path.join(output,item.id+'.png')});
      await page.getByRole('link',{name:'返回好友',exact:true}).click();
      await page.locator('[name=number]').fill('privacy_fixture');
      await page.locator('[name=password]').fill(password);
      await page.getByRole('button',{name:'登录',exact:true}).click();
      await page.getByRole('heading',{name:'消息',exact:true}).waitFor();
      await page.getByRole('button',{name:'我',exact:true}).click();
      assert.equal(await page.getByRole('link',{name:'隐私说明',exact:true}).getAttribute('href'),'./privacy.html');
      checks.push({mode:item.id,anonymousGet:200,anonymousHead:200,emptyHead:true,login:true,profileLink:true});
      await context.close();
      await stop();
    }
    for(const invalid of [
      {name:'合成名称'},
      {name:'合成名称',contact:'javascript:alert(1)'},
      {name:'合成名称',contact:'https://user:pass@example.org/help'},
    ]){
      child=launch(invalid);
      let stderr='';
      child.stderr.on('data',data=>stderr+=data);
      const [code]=await once(child,'close');
      assert.notEqual(code,0);
      assert.match(stderr,/SOCIAL_PUBLIC_PRIVACY_CONTACT/);
    }
    assert.deepEqual(errors,[]);
  }finally{
    await browser?.close();
    await stop();
    await fs.rm(temporary,{recursive:true,force:true});
  }
  const receipt={passed:true,sameServiceSource:true,sameTestAccountAcrossRestarts:true,checks,invalidConfigurationsRejected:3,
    visibleWindows:0,externalRequests:0,errors};
  await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(receipt));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
