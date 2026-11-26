'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {makeBackup}=require('../deploy/backup.cjs');

function runtime(root) {
  assert(root,'Supply the isolated historical source worktree, never an application profile');
  const server=path.join(path.resolve(root),'social','server');
  return {store:require(path.join(server,'store.cjs')).SocialStore,createServer:require(path.join(server,'http.cjs')).createServer};
}

test('normal HTTP across old binary rollback and restore from a pre-withdrawal backup', {timeout:20000}, async t=>{
  const old=runtime(process.env.SOCIAL_ROLLBACK_CODE);
  const unguarded=runtime(process.env.SOCIAL_UNGUARDED_CODE);
  const current=runtime(path.resolve(__dirname,'../..'));
  const tempRoot=await fs.realpath(os.tmpdir());
  const folder=await fs.mkdtemp(path.join(tempRoot,'arcade-social-rollback-'));
  const active=path.join(folder,'live.sqlite');
  const runs=[];
  let worker,store,base;
  async function stop() {
    if(worker) {
      await new Promise((resolve,reject)=>worker.close(error=>error?reject(error):resolve()));
      worker=null;
    }
    if(store){store.db.close();store=null;}
  }
  async function start(code,label,file=active) {
    await stop();
    store=new code.store(file);
    worker=code.createServer(store,{aiProvider:{async generate(context){
      const text=context.at(-1).content;
      runs.push({label,text,context:context.map(row=>row.content)});
      return '合成回复 '+text;
    }}}).listen(0,'127.0.0.1');
    await once(worker,'listening');
    base='http://127.0.0.1:'+worker.address().port+'/api/v1';
  }
  t.after(async()=>{
    await stop();
    const real=await fs.realpath(folder);
    assert.equal(path.dirname(real),tempRoot);
    assert.match(path.basename(real),/^arcade-social-rollback-[a-z0-9]+$/i);
    await fs.rm(real,{recursive:true,force:true});
  });
  function session(initialCookie=''){
    let cookie=initialCookie;
    const request=async(endpoint,body,status=200)=>{
      const reply=await fetch(base+endpoint,{method:body?'POST':'GET',
        headers:{Cookie:cookie,'Content-Type':'application/json'},...(body&&{body:JSON.stringify(body)})});
      const next=reply.headers.get('Set-Cookie');
      if(next)cookie=next.split(';')[0];
      const result=await reply.json();
      assert.equal(reply.status,status,endpoint+' '+JSON.stringify(result));
      return result;
    };
    request.copy=()=>session(cookie);
    return request;
  }
  const a=session(),b=session();
  const password='synthetic rollback password';
  const startAi=(session,account)=>session('/ai-contacts/start',{number:'arcade_whale',expectedAccount:account,allowCloud:true});
  function send(session,thread,text,clientId,status=200,revision){
    return session(thread+'/messages',{clientId,text,...(revision!==undefined&&{aiConsentRevision:revision})},status);
  }

  await start(old,'old-natural');
  for(const [who,number] of [[a,'safe_alpha'],[b,'safe_bravo']]) await who('/register',{number,displayName:number,password});
  const request=(await a('/friend-requests',{number:'safe_bravo'})).request;
  const human='/conversations/'+(await b('/friend-requests/'+request.id+'/accept',{})).conversation.id;
  const stored=await send(a,human,'真人历史保留','human_history');
  const ta='/conversations/'+(await startAi(a,'safe_alpha')).conversation.id;
  const tb='/conversations/'+(await startAi(b,'safe_bravo')).conversation.id;
  const oldSent=await send(a,ta,'旧版正常发出','old_initial');
  assert.equal(oldSent.reply.text,'合成回复 旧版正常发出');
  const prior=await makeBackup(active,path.join(folder,'before-withdrawal'));
  const control=await makeBackup(prior,path.join(folder,'unprotected-copy'));

  await start(unguarded,'without-guard',control);
  assert.equal((await a('/me')).user.number,'safe_alpha');
  await a(ta+'/ai-consent',{expectedAccount:'safe_alpha',allowCloud:false,revision:0});
  await start(old,'unprotected-old-rollback',control);
  assert.equal((await send(a,ta,'旧实现回退反例','legacy_leak')).reply.text,'合成回复 旧实现回退反例');

  await start(current,'current-withdraw');
  assert.equal((await a('/me')).user.number,'safe_alpha');
  assert.equal((await b('/me')).user.number,'safe_bravo');
  assert.deepEqual((await a(ta)).conversation.cloudChat,{enabled:true,revision:0});
  assert.deepEqual((await a(ta+'/ai-consent',{expectedAccount:'safe_alpha',allowCloud:false,revision:0})).conversation.cloudChat,
    {enabled:false,revision:1});
  await start(old,'guarded-old-rollback');
  const guardResult=await send(a,ta,'同库回退必须阻断','guarded_rollback',500);
  assert.equal(guardResult.error.code,'internal');
  assert.equal((await send(b,tb,'旧版另一账号正常发送','guarded_other')).reply.text,'合成回复 旧版另一账号正常发送');
  assert(!(await a(ta+'/messages')).messages.some(row=>row.text==='同库回退必须阻断'));
  const staleA=a.copy(),staleB=b.copy();
  await a('/logout',{});
  assert.equal((await staleA('/me',undefined,401)).error.code,'login_required');
  assert.equal((await staleB('/me')).user.number,'safe_bravo');

  const restore=path.join(folder,'ready-restore');
  const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const originalHash=await hash(prior);
  const result=await promisify(execFile)(process.execPath,[
    path.join(__dirname,'..','deploy','backup.cjs'),'--prepare-restore',prior,restore,
  ],{windowsHide:true});
  const prepared=path.join(restore,'social.sqlite');
  assert.equal(result.stdout.trim(),prepared);
  assert.deepEqual(await fs.readdir(restore),['social.sqlite']);
  assert.equal(await hash(prior),originalHash);
  await start(old,'restored-snapshot-old-server',prepared);
  assert.equal((await staleA('/me',undefined,401)).error.code,'login_required');
  assert.equal((await staleB('/me',undefined,401)).error.code,'login_required');
  await a('/login',{number:'safe_alpha',password});
  await b('/login',{number:'safe_bravo',password});
  await send(a,ta,'旧快照已关停','guarded_restore',500);
  await start(current,'restored-snapshot-current-server',prepared);
  assert.equal((await a('/me')).user.number,'safe_alpha');
  assert.equal((await b('/me')).user.number,'safe_bravo');
  assert.equal((await b('/friends')).friends[0].number,'safe_alpha');
  assert.equal((await b(human+'/messages')).messages[0].id,stored.message.id);
  assert.deepEqual((await a(ta)).conversation.cloudChat,{enabled:false,revision:1});
  assert.equal((await b(tb)).conversation.cloudChat.enabled,false);
  await send(a,ta,'用户未重新同意','paused_recovery',409,1);
  assert.equal((await a(ta+'/messages')).messages[0].id,oldSent.message.id);
  await a(ta+'/ai-consent',{expectedAccount:'safe_alpha',allowCloud:true,revision:1});
  await send(a,ta,'恢复后明确发送','restore_allowed',200,2);
  assert.deepEqual(runs,[
    {label:'old-natural',text:'旧版正常发出',context:['旧版正常发出']},
    {label:'unprotected-old-rollback',text:'旧实现回退反例',context:['旧版正常发出','合成回复 旧版正常发出','旧实现回退反例']},
    {label:'guarded-old-rollback',text:'旧版另一账号正常发送',context:['旧版另一账号正常发送']},
    {label:'restored-snapshot-current-server',text:'恢复后明确发送',context:['恢复后明确发送']},
  ]);
  t.diagnostic(JSON.stringify({provedOldBug:true,sameDatabaseRollback:{status:500,providerCallsForRevokedAccount:0},
    sessionRecovery:{ordinaryBackupKeepsSessions:true,inPlaceUpgradeKeepsSessions:true,originalBackupUnchanged:true,
      loggedOutCookieAfterRestore:401,otherDeviceCookieAfterRestore:401,freshLogins:2,friendshipAndHumanHistoryRetained:true},
    restoredPriorSnapshot:{legacyProviderCalls:0,newProviderCallsAfterExplicitResume:1,historyRetained:true},
    accounts:2,totalSyntheticProviderCalls:runs.length,externalCalls:0}));
});
