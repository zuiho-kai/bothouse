'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {once}=require('node:events');
const {SocialStore}=require('../../server/store.cjs');
const {createServer}=require('../../server/http.cjs');
const {AI_NUMBER,AI_JU_NUMBER,AI_DRAGON_NUMBER}=require('../../server/ai-roles.cjs');

const account='synthetic_restore';
const password='synthetic offline restore test';
const roles=[[AI_NUMBER,'鲸鱼娘','deepseek'],[AI_JU_NUMBER,'橘娘','anthropic'],[AI_DRAGON_NUMBER,'龙娘','openai']];
const [aiProvider,claudeProvider,openaiProvider]=roles.map(([number,name,provider])=>({
  name,provider,groupRoles:[{number,name}],
  async generate(){throw Error('This test must never start a model turn');},
}));

async function runService(db,task,legacy){
  const Store=legacy?require(path.resolve(legacy,'social/server/store.cjs')).SocialStore:SocialStore;
  const serve=legacy?require(path.resolve(legacy,'social/server/http.cjs')).createServer:createServer;
  const store=new Store(db);
  const server=serve(store,{aiProvider,claudeProvider,openaiProvider}).listen(0,'127.0.0.1');
  await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  let cookie;
  async function api(route,data,status=200){
    const response=await fetch(origin+'/api/v1'+route,{method:data===undefined?'GET':'POST',
      headers:{'Content-Type':'application/json','X-Social-Claude-UI':'1','X-Social-AI-Friend-Roles':'1',...(cookie&&{Cookie:cookie})},
      body:data===undefined?undefined:JSON.stringify(data)});
    if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    const body=await response.json();
    assert.equal(response.status,status,JSON.stringify(body));
    return body;
  }
  try{return await task(api,store);}
  finally{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  }
}

const enabled=async api=>(await api('/ai-friend-preferences')).roles.filter(role=>role.enabled).map(role=>role.number);
const login=api=>api('/login',{number:account,password});
const freezeCopy=(backup,input,destination)=>{
  const output=execFileSync(process.execPath,[backup,'--prepare-restore',input,destination],{encoding:'utf8',windowsHide:true});
  const outputFile=path.join(destination,'social.sqlite');
  assert.equal(path.resolve(output.trim()),outputFile);
  return outputFile;
};

async function main(){
  const [outputPath,legacyPath,mode,preFixOut]=process.argv.slice(2);
  const output=path.resolve(outputPath);
  await fs.mkdir(output,{recursive:true});
  const oldBackup=path.resolve(legacyPath,'social/deploy/backup.cjs');
  const currentBackup=path.resolve(__dirname,'../../deploy/backup.cjs');
  const expectLeak=mode==='--expect-leak';
  const proof=[];
  for(const [name,selected] of [['ju-only',[AI_JU_NUMBER]],['whale-dragon',[AI_NUMBER,AI_DRAGON_NUMBER]]]){
    const original=path.join(output,name+'.sqlite');
    await runService(original,async api=>{
      await api('/register',{number:account,password,displayName:'合成恢复账号'});
      for(const number of selected)await api('/ai-friend-preferences',{expectedAccount:account,number,revision:0,enabled:true});
      assert.deepEqual(await enabled(api),selected);
    });
    let offOn=null;
    if(selected.includes(AI_NUMBER)){
      const setWhale=value=>runService(original,async api=>{
        await login(api);
        const {preference}=await api('/ai-friend-preference');
        await api('/ai-friend-preference',{expectedAccount:account,enabled:value,revision:preference.revision});
      },legacyPath);
      await setWhale(false);
      offOn=await runService(original,async api=>{await login(api);return enabled(api);});
      assert.deepEqual(offOn,[AI_DRAGON_NUMBER]);
      await setWhale(true);
    }
    const results={};
    for(const [kind,backup] of [['frozen127',oldBackup],['sameVersion',currentBackup]]){
      const prepared=freezeCopy(backup,original,path.join(output,name+'-'+kind));
      results[kind]=await runService(prepared,async (api,store)=>{
        await login(api);
        return {enabled:await enabled(api),newRoleRows:store.one('SELECT count(*) AS n FROM ai_friend_role_preferences').n,
          foreignKeyCheck:store.all('PRAGMA foreign_key_check')};
      });
      const expected=expectLeak&&kind==='frozen127'?selected.filter(role=>role!==AI_NUMBER):[];
      assert.deepEqual(results[kind],{enabled:expected,newRoleRows:expected.length,foreignKeyCheck:[]});
    }
    const sourceStillEnabled=await runService(original,async api=>{
      await login(api);return enabled(api);
    });
    assert.deepEqual(sourceStillEnabled,selected);
    let orphanFromPriorCandidate;
    if(preFixOut){
      const legacyFile=path.resolve(preFixOut,name+'-frozen127','social.sqlite');
      const copy=path.join(output,name+'-pre-fix-orphans.sqlite');
      await fs.copyFile(legacyFile,copy);
      orphanFromPriorCandidate=await runService(copy,async (api,store)=>{
        await login(api);
        assert.deepEqual(await enabled(api),[]);
        assert.equal(store.one('SELECT count(*) AS n FROM ai_friend_role_preferences').n,0);
        assert.deepEqual(store.all('PRAGMA foreign_key_check'),[]);
        return 'not restored';
      });
    }
    proof.push({name,sourceStillEnabled,whileLegacyWhaleOff:offOn,...results,orphanFromPriorCandidate});
  }
  await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify(proof,null,2));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
