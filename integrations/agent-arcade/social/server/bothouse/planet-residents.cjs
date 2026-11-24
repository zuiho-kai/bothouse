'use strict';
const {spawn}=require('node:child_process');
const {randomBytes,randomUUID}=require('node:crypto');
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
  const tickets=new Map();
  const homeRow=account=>store.one('SELECT * FROM friend_world_homes WHERE account=? AND issuer=? AND world=?',account,socialOrigin(),origin);
  const validPlanet=id=>typeof id==='string'&&/^p-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(id);
  function issueTicket(account,session,body){
    if(account!==body.expectedAccount)problem('session');
    if(!origin||body.worldOrigin!==origin)problem('config');
    const now=Date.now();
    let pendingForSession=0;
    for(const [key,grant] of tickets){
      if(grant.expires<=now)tickets.delete(key);
      else if(grant.session===session)pendingForSession++;
    }
    if(pendingForSession>=12)problem('busy');
    if(tickets.size>=4096)problem('busy');
    const ticket=randomBytes(32).toString('hex');
    tickets.set(ticket,{account,session,expires:now+60000});
    return {ticket};
  }
  function redeemTicket({ticket,worldOrigin}){
    const grant=tickets.get(ticket);
    if(!grant||worldOrigin!==origin||!origin)problem('binding');
    tickets.delete(ticket);
    if(grant.expires<=Date.now()||!sessionAlive(grant))problem('session');
    let instance=store.one('SELECT id FROM world_friends_instance WHERE singleton=1');
    if(!instance){
      store.run('INSERT OR IGNORE INTO world_friends_instance VALUES(1,?)',randomUUID());
      instance=store.one('SELECT id FROM world_friends_instance WHERE singleton=1');
    }
    const row=homeRow(grant.account);
    return {account:grant.account,worldOrigin,instanceId:instance.id,
      legacy:row?.resident_source?{sourceId:row.resident_source,planetId:row.planet}:null};
  }
  function visits(account){
    const row=homeRow(account);
    return {account,sharing:!!row?.planet&&row.visits!=='closed'};
  }
  async function shareVisits(account,session,body){
    if(account!==body.expectedAccount)problem('session');
    if(!origin||body.worldOrigin!==origin)problem('config');
    if(typeof body.sharing!=='boolean')problem('binding');
    const keys=[account,socialOrigin(),origin];
    if(!body.sharing){
      store.run(`INSERT INTO friend_world_homes(account,issuer,world,visits) VALUES(?,?,?,'closed')
        ON CONFLICT(account,issuer,world) DO UPDATE SET visits='closed',revision=revision+1`,...keys);
      return visits(account);
    }
    const revision=homeRow(account)?.revision;
    const {ticket}=issueTicket(account,session,body);
    let verified;
    try{
      const response=await fetch(origin+'/api/friends-home',{method:'POST',redirect:'error',
        headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(6000),body:JSON.stringify({ticket,expectedAccount:account})});
      if(!response.ok)problem('unavailable');
      verified=await response.json();
    }catch(error){if(error.status)throw error;problem('unavailable');}
    finally{tickets.delete(ticket);}
    if(!sessionAlive({account,session})||homeRow(account)?.revision!==revision)problem('session');
    if(verified?.ok!==true||verified.account!==account||!validPlanet(verified.planetId))
      fail(409,'planet_home','请先在自己的星球建立家园，再允许好友拜访。');
    store.run(`INSERT INTO friend_world_homes(account,issuer,world,visits,planet) VALUES(?,?,?,'allowed',?)
      ON CONFLICT(account,issuer,world) DO UPDATE SET visits='allowed',revision=revision+1,
      resident_source=CASE WHEN planet=excluded.planet THEN resident_source END,planet=excluded.planet`,...keys,verified.planetId);
    return visits(account);
  }
  function friendPlanet(account,number){
    if(number===account||!store.direct(account,number)||store.user(number).kind!=='human')
      fail(403,'friends_only','请从真人好友的私聊打开。');
    const row=homeRow(number);
    return {account,number,worldOrigin:origin,planetId:row&&row.visits!=='closed'?row.planet:null};
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
      store.run(`UPDATE friend_world_homes SET resident_source=NULL,visits=CASE WHEN visits='residents' THEN 'closed' ELSE visits END,
        revision=revision+1 WHERE account=? AND issuer=? AND world=? AND resident_source=?`,account,socialOrigin(),origin,body.sourceId);
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
      const verified=await control(job,'check');
      if(!validPlanet(verified.planetId))problem('unavailable');
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
        store.run(`INSERT INTO friend_world_homes(account,issuer,world,planet,resident_source,visits) VALUES(?,?,?,?,?,'residents')
          ON CONFLICT(account,issuer,world) DO UPDATE SET planet=excluded.planet,resident_source=excluded.resident_source,revision=revision+1
          WHERE friend_world_homes.planet IS NULL OR friend_world_homes.planet=excluded.planet`,
          account,socialOrigin(),origin,verified.planetId,job.sourceId);
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
  function unpair(account){
    cancel(j=>j.account===account);
    store.run(`UPDATE friend_world_homes SET visits='closed',revision=revision+1
      WHERE account=? AND issuer=? AND world=? AND visits='residents'`,account,socialOrigin(),origin);
  }
  return {view,change,friendPlanet,issueTicket,redeemTicket,visits,shareVisits,unpair,
    endSession:d=>{if(d)cancel(j=>j.session===d);},close:()=>{closed=true;tickets.clear();cancel(()=>true);}};
}
module.exports={planetPublishers};
