// Uses the real HTTP server, SQLite, and home preparation worker. The one-time
// Friends authority below represents an already authenticated service session.
import assert from 'node:assert/strict';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {defaultAppearance} from '../src/shared/appearance.ts';

const dir=await mkdtemp(join(tmpdir(),'friends-world-'));
const database=join(dir,'world.sqlite');
const pending=new Map(), instanceId=randomUUID(), account='owner_a';
const authority=createServer(async(req,res)=>{
  assert.equal(req.url,'/api/v1/world-session-ticket/redeem');
  assert.equal(req.headers.cookie,undefined);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks));
  const value=pending.get(body.ticket);
  if (!value || body.worldOrigin!==worldOrigin) { res.writeHead(403).end();return; }
  pending.delete(body.ticket);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
});
async function listen(server) { server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port; }
const socialOrigin='http://127.0.0.1:'+await listen(authority);
const probe=createServer();const port=await listen(probe);await new Promise(r=>probe.close(r));
const worldOrigin='http://127.0.0.1:'+port;
const summary={};
let processWorld;
async function start(cwd) {
  const env=Object.fromEntries(['PATH','SystemRoot','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  processWorld=spawn(process.execPath,['src/server/index.ts'],{cwd,windowsHide:true,stdio:['ignore','ignore','inherit'],
    env:{...env,...(process.argv.includes('--home-sample') && {HOME_SAMPLE:'1',HOME_SAMPLE_PORT:String(port)}),DATABASE_PATH:database,HOST:'127.0.0.1',PORT:String(port),LITTLE_WORLDS_FRIENDS_ORIGIN:socialOrigin,LITTLE_WORLDS_PUBLIC_ORIGIN:worldOrigin}});
  await until(async()=>{try{return (await fetch(worldOrigin+'/healthz')).ok;}catch{return false;}});
}
async function stop(){if(processWorld && processWorld.exitCode===null){const exit=once(processWorld,'exit');processWorld.kill();await exit;}processWorld=null;}
async function until(fn){const end=Date.now()+90000;do{const v=await fn();if(v)return v;await delay(100);}while(Date.now()<end);throw Error('Fixture timed out');}
function ticket(overrides={}){const token=randomBytes(32).toString('hex');pending.set(token,{account,worldOrigin,instanceId,legacy:null,...overrides});return token;}
async function call(path,body,cookie,extra={}) {
  const res=await fetch(worldOrigin+'/api/'+path,{method:body?'POST':'GET',headers:{...(body&&{'Content-Type':'application/json'}),...(cookie&&{Cookie:cookie}),...extra},body:body&&JSON.stringify(body)});
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
}
async function ok(path,body,cookie,extra){const result=await call(path,body,cookie,extra);assert.equal(result.status,200,path+' '+JSON.stringify(result.data));return result;}
function verify(path,subject,proof,cookie){return call(path,{ticket:proof,expectedAccount:subject},cookie);}
function withDb(fn){const db=new DatabaseSync(database);try{return fn(db);}finally{db.close();}}
function players(){return withDb(db=>db.prepare('SELECT COUNT(*) AS n FROM players').get().n);}
async function getHome(cookie){return until(async()=>(await ok('universe',undefined,cookie)).data.ownedPlanetId);}
const baseline=resolve(process.argv[2]??'.');
try {
  await start(baseline);
  const first=(await ok('state')).cookie;
  const planet=await getHome(first);
  await ok('appearance',{expectedRevision:0,appearance:defaultAppearance('sky')},first);
  const owner=createHash('sha256').update(first.split('=')[1]).digest('hex');
  // Put only this synthetic traveller at the door to configure residents. All
  // identity, source, roster, progress and home reads/writes use product routes.
  withDb(db=>db.prepare('UPDATE players SET planet_id=? WHERE id=?').run(planet,owner));
  const slot=(await ok('app-residents',{action:'connect',account,socialOrigin},first)).data;
  const legacy={sourceId:slot.sourceId,planetId:planet};
  await ok('resident-feed/check',{sourceId:slot.sourceId,account,socialOrigin},undefined,{Authorization:'Bearer '+slot.token});
  await ok('resident-feed',{instance:'a'.repeat(64),residents:[{source:'dsh',project:'lantern',displayName:'Test lantern',activity:'working',appearanceKey:'default'}]},undefined,{Authorization:'Bearer '+slot.token});
  const legacyRoster=(await ok('planets/'+planet+'/residents',undefined,first)).data;
  const fresh=(await ok('state')).cookie;
  const otherPlanet=await getHome(fresh);
  assert.notEqual(planet,otherPlanet);
  summary.oldWorld={original:planet,clean:otherPlanet,players:players()};
  await stop();await start(process.cwd());
  const before=players();
  assert.equal((await verify('friends-session',account,ticket())).status,409);
  assert.equal((await verify('friends-session',account,ticket({legacy:{...legacy,planetId:otherPlanet}}))).status,409);
  assert.equal((await verify('friends-session',account,ticket({legacy}),fresh)).status,409);
  const proof=ticket({legacy});
  const resumed=await verify('friends-session',account,proof);
  assert.equal(resumed.status,200);
  assert.equal((await verify('friends-session',account,proof)).status,403);
  assert.equal((await getHome(resumed.cookie)),planet);
  assert.equal((await ok('state',undefined,resumed.cookie)).data.appearance.options.coat,'sky');
  assert.deepEqual((await ok('planets/'+planet+'/residents',undefined,resumed.cookie)).data,legacyRoster);
  assert.equal((await verify('friends-session',account,ticket(),first)).status,200);
  assert.equal((await verify('friends-session',account,ticket(),resumed.cookie)).cookie,undefined);
  assert.equal(players(),before);
  summary.resumed={planet,coat:'sky',resident:legacyRoster.residents[0].displayName,players:before,replay:403,unverifiedLegacy:409};

  // Same unbound old garden, now enrolled with both its owner cookie and a
  // signed-in Friends identity. An unbound local game stays independently usable.
  const secondAccount='owner_b';
  assert.equal((await verify('friends-session',secondAccount,ticket({account:secondAccount}),fresh)).status,200);
  const second=await verify('friends-session',secondAccount,ticket({account:secondAccount}));
  assert.equal(await getHome(second.cookie),otherPlanet);
  assert.equal((await verify('friends-session',secondAccount,ticket({account:secondAccount}),first)).status,409);
  assert.equal((await verify('friends-session',secondAccount,ticket())).status,403);
  assert.equal((await verify('friends-session',account,ticket({worldOrigin:socialOrigin}))).status,403);
  assert.equal((await verify('friends-session',account,ticket({instanceId:randomUUID()}),resumed.cookie)).status,409);
  const newcomer='owner_c';
  const open=()=>verify('friends-session',newcomer,ticket({account:newcomer}));
  const [dev1,dev2]=await Promise.all([open(),open()]);
  assert.deepEqual([dev1.status,dev2.status],[200,200]);assert(dev1.cookie && dev2.cookie && dev1.cookie!==dev2.cookie);
  assert.equal(players(),before+1);
  const garden=await getHome(dev1.cookie);assert.equal(await getHome(dev2.cookie),garden);
  summary.concurrent={responses:[200,200],playersAdded:1,planet:garden,independentDeviceCookies:true};
  await stop();await start(process.cwd());
  const reopen=await verify('friends-session',newcomer,ticket({account:newcomer}));
  assert.equal(await getHome(reopen.cookie),garden);
  const location=await verify('friends-home',newcomer,ticket({account:newcomer}));
  assert.deepEqual(location.data,{ok:true,account:newcomer,planetId:garden});assert(!location.cookie);
  assert.equal((await verify('friends-home',newcomer,ticket({account:newcomer,instanceId:randomUUID()}))).data.planetId,null);
  assert.equal((await verify('friends-home',newcomer,'0'.repeat(64))).status,403);
  assert.equal(players(),before+1);
  summary.reopened={planet:garden,homeAvailableWithoutPublisher:true,unrelatedInstance:null,playersAddedByLookup:0};
  console.log(JSON.stringify({passed:true,...summary},null,2));
} finally {await stop();authority.closeAllConnections();await new Promise(r=>authority.close(r));}
