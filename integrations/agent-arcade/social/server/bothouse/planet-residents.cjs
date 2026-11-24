'use strict';
const {spawn}=require('node:child_process');
const {existsSync}=require('node:fs');
const path=require('node:path');
const {fail}=require('../store.cjs');
const {instanceSettings}=require('./directory.cjs');

const heartbeatInterval=6000, publisherRecoveryWindow=60000;
const sourcePattern=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const msg={
  config:[503,'请先在好友服务配置小星球地址和居民发布器。'],
  session:[409,'账号或连接已更换，请重新打开自己的小星球。'],
  binding:[403,'请在自己的小星球重新连接居民。'],
  empty:[409,'请先在 AI 联系人中取得可展示的 Bothouse 角色。'],
  in_use:[409,'当前账号已连接另一颗星球，请先在原星球断开。'],
  busy:[429,'居民发布器正忙，请稍后再试。'],
  unavailable:[503,'未能确认居民更新。请确认世界与 Bothouse 都在运行，再重试。']
};
const problem=reason=>fail(msg[reason][0],'planet_'+reason,msg[reason][1]);
function configuredOrigin(value){
  try{
    const u=new URL(value);
    if(u.origin===value&&(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(u.hostname)))return u.origin;
  }catch{}
  return null;
}

function planetPublishers({store,bothouse,socialOrigin,env=process.env}){
  const origin=configuredOrigin(env.LITTLE_WORLDS_ORIGIN);
  const publisher=env.SOCIAL_LITTLE_WORLDS_PUBLISHER;
  const {config,python}=instanceSettings(env);
  const configured=()=>Boolean(origin&&bothouse&&path.isAbsolute(publisher||'')&&existsSync(publisher)&&existsSync(config));
  const jobs=new Map(),pending=new Map();
  let closed=false,workers=0;
  function view(account){
    const job=jobs.get(account);
    return {account,available:configured(),worldOrigin:origin,active:!!job?.ready,sourceId:job?.ready?job.sourceId:null};
  }
  function sessionAlive(job){
    return !closed&&!!store.one('SELECT 1 FROM sessions WHERE account=? AND digest=? AND expires>?',job.account,job.session,Date.now());
  }
  async function control(job,action){
    let response;
    try{
      response=await fetch(origin+'/api/resident-feed/'+action,{method:'POST',redirect:'error',
        signal:AbortSignal.timeout(5000),headers:{Authorization:'Bearer '+job.token,'Content-Type':'application/json'},
        body:JSON.stringify(action==='check'?{account:job.account,socialOrigin:socialOrigin(),sourceId:job.sourceId}:{})});
      if([401,403,404].includes(response.status)){
        if(action==='pause')return;  // The owner may already have revoked this slot.
        problem('binding');
      }
      if(!response.ok)problem('unavailable');
      const verified=await response.json();
      if(verified.ok!==true)problem('unavailable');
      return verified;
    }catch(e){if(e.status)throw e;problem('unavailable');}
    finally{if(response&&!response.bodyUsed)await response.body?.cancel();}
  }
  async function friendPlanet(account,number){
    function requireFriend(){
      if(number===account||!store.direct(account,number)||store.user(number).kind!=='human')
        fail(403,'friends_only','请从真人好友的私聊打开。');
    }
    requireFriend();
    const response={account,number,worldOrigin:origin,planetId:null};
    const job=jobs.get(number);
    if(!job?.ready||!sessionAlive(job))return response;
    let verified;
    try{verified=await control(job,'check');}
    catch(error){if(error.code!=='planet_binding')throw error;}
    requireFriend();
    if(!verified||job!==jobs.get(number)||!sessionAlive(job))return response;
    if(typeof verified.planetId!=='string'||!/^p-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(verified.planetId))
      problem('unavailable');
    return {...response,planetId:verified.planetId};
  }
  function stop(job){
    if(jobs.get(job.account)===job)jobs.delete(job.account);
    clearTimeout(job.timer);
    job.child?.kill();
    return job.pausing??=control(job,'pause');
  }
  function current(job){
    if(jobs.get(job.account)!==job||!sessionAlive(job))problem('session');
  }
  async function heartbeat(job){
    current(job);
    if(workers>=4)problem('busy');
    workers++;
    try{
      return await new Promise((resolve,reject)=>{
        const child=job.child=spawn(python,['-I','-B','-X','utf8',path.join(__dirname,'world-publish.py'),publisher,config,origin],
          {windowsHide:true,env:Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE','LOCALAPPDATA','LANG','LC_ALL'].filter(k=>env[k]).map(k=>[k,env[k]])),
            stdio:['pipe','pipe','ignore']});
        const deadline=setTimeout(()=>child.kill(),30000);
        let buf='',count=null,dirState='offline',reading=false,directorySeen=false;
        const cleanup=()=>{clearTimeout(deadline);if(job.child===child)job.child=null;};
        child.once('error',e=>{cleanup();reject(e);});
        child.stdin.on('error',()=>{});
        child.stdout.setEncoding('utf8').on('data',chunk=>{
          buf+=chunk;
          if(buf.length>2048){child.kill();return;}
          for(let newline;(newline=buf.indexOf('\n'))>=0;){
            const line=buf.slice(0,newline).trim();buf=buf.slice(newline+1);
            if(line==='directory'&&!reading){
              reading=true;
              Promise.resolve().then(async()=>{
                current(job);
                const {contacts,directoryStatus}=await bothouse.list(job.account);
                current(job);
                const ids=contacts.filter(r=>r.source==='bothouse'&&/^bh_[a-f0-9]{21}$/u.test(r.number)).map(r=>r.number);
                directorySeen=true;dirState=ids.length?'has_ids':directoryStatus==='offline'?'offline':'empty';
                const output=JSON.stringify(ids);
                if(output.length>=1024*1024)throw Error();
                reading=false;child.stdin.write(output+'\n');
              }).catch(()=>child.kill());
            }else{
              try{
                const result=JSON.parse(line);
                if(!Number.isSafeInteger(result.count)||result.count<0||count!==null)throw Error();
                count=result.count;
              }catch{child.kill();}
            }
          }
        });
        child.once('close',code=>{
          cleanup();
          try{
            current(job);
            if(code!==0||!directorySeen||count===null)problem('unavailable');
            if(count===0)problem(dirState==='empty'?'empty':'unavailable');
            resolve();
          }catch(e){reject(e);}
        });
        child.stdin.write(JSON.stringify(job.token)+'\n');
      });
    }finally{workers--;}
  }
  function schedule(job){
    job.timer=setTimeout(async()=>{
      if(jobs.get(job.account)!==job)return;
      // Defer saturated ticks briefly; keep at most one child in flight per slot.
      if(workers>=4&&sessionAlive(job)){schedule(job);return;}
      try{
        await heartbeat(job);
        current(job);
        job.lastPublished=Date.now();
      }catch(error){
        if(jobs.get(job.account)!==job)return;
        // A failed sample can leave the verified owner grant intact. The world
        // independently expires stale residents, and every visit rechecks the grant.
        if(error.code!=='planet_unavailable'||!sessionAlive(job)||Date.now()-job.lastPublished>=publisherRecoveryWindow){
          await stop(job).catch(()=>{});
          return;
        }
      }
      schedule(job);
    },heartbeatInterval);
    job.timer.unref();
  }
  async function change(account,session,body){
    if(body.expectedAccount!==account)problem('session');
    if(!sourcePattern.test(body.sourceId||''))problem('binding');
    const existing=jobs.get(account),checking=pending.get(account);
    if([existing,checking].some(j=>j&&j.sourceId!==body.sourceId))problem('in_use');
    if(body.action==='disconnect'){
      if(checking)pending.delete(account);
      if(existing)await stop(existing);
      return view(account);
    }
    if(body.action!=='connect'||!configured()||body.worldOrigin!==origin)problem('config');
    if(!/^[a-f0-9]{64}$/u.test(body.token||''))problem('binding');
    if(checking){
      if(checking.session===session&&checking.token===body.token)return checking.promise;
      problem('busy');
    }
    if(!existing&&jobs.size+pending.size>=32)problem('busy');
    const job={account,session,token:body.token,sourceId:body.sourceId};
    pending.set(account,job);
    job.promise=(async()=>{
      // A claimed world slot must match this server, this social account and this owner.
      // Never cancel an existing publisher until the replacement has proved its own grant.
      await control(job,'check');
      try{
        if(pending.get(account)!==job||!sessionAlive(job))problem('session');
        if(existing?.ready&&existing.token===job.token&&existing.session===session)return view(account);
        if(existing){
          if(existing.token!==job.token)await stop(existing).catch(()=>{});
          else {clearTimeout(existing.timer);existing.child?.kill();}
        }
        if(pending.get(account)!==job||!sessionAlive(job))problem('session');
        jobs.set(account,job);
        await heartbeat(job);current(job);
        job.ready=true;job.lastPublished=Date.now();schedule(job);return view(account);
      }catch(e){
        // A late pass cannot stop a newer source that now owns this token.
        const next=jobs.get(account),nextPending=pending.get(account);
        if((!next||next===job||next.token!==job.token)&&(!nextPending||nextPending===job||nextPending.token!==job.token))
          await stop(job).catch(()=>{});
        if(e.status)throw e;problem('unavailable');
      }
    })();
    try{return await job.promise;}finally{if(pending.get(account)===job)pending.delete(account);}
  }
  function cancel(predicate){
    for(const [a,p] of pending)if(predicate(p))pending.delete(a);
    for(const j of [...jobs.values()])if(predicate(j))void stop(j).catch(()=>{});
  }
  return {view,change,friendPlanet,endSession:d=>{if(d)cancel(j=>j.session===d);},
    unpair:a=>cancel(j=>j.account===a),close:()=>{closed=true;cancel(()=>true);}};
}
module.exports={planetPublishers};
