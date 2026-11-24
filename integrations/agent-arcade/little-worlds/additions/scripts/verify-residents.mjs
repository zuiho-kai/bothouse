// Real world routes and publisher process, synthetic loopback Bothouse and Friends transports.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {crc32,deflateSync} from 'node:zlib';
import {residentPortrait} from '../src/shared/resident-portrait.ts';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {portPoint} from '../src/shared/ports.ts';
const exec=promisify(execFile),dir=await mkdtemp(join(tmpdir(),'resident-loopback-'));
const dbfile=join(dir,'test.sqlite'),slug='custom-shadow',privateMarker='PRIVATE-ROOM-DO-NOT-PUBLISH';
const listen=async(s)=>{s.listen(0,'127.0.0.1');await once(s,'listening');return s.address().port;};
const probe=createServer();const port=await listen(probe);await new Promise(r=>probe.close(r));
const world='http://127.0.0.1:'+port;
const baseEnv=Object.fromEntries(['PATH','SystemRoot','TEMP','TMP','HOME','USERPROFILE','LOCALAPPDATA'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const app=spawn(process.execPath,['src/server/index.ts'],{env:{...baseEnv,HOST:'127.0.0.1',PORT:String(port),DATABASE_PATH:dbfile,NODE_ENV:'test',TEST_LEGACY_WORLD:'1'},windowsHide:true,stdio:['ignore','ignore','inherit']});
let db,browser,dshPage;
let mood='thinking',name='小岚🐳（一号）',added=false,restricted=true,online=true,allowed=[],activeAccount='owner_test';
const role=(project,display_name,status,source='bridge')=>({role_key:source+':'+project,name:project,display_name,online,status,source,sessions:[{session_key:privateMarker}]});
function pixel(rgb){
  const chunk=(tag,data)=>{
    const typeAndData=Buffer.concat([Buffer.from(tag),data]);
    const size=Buffer.alloc(4),crc=Buffer.alloc(4);
    size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([size,typeAndData,crc]);
  };
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),
    chunk('IHDR',Buffer.from('00000001000000010802000000','hex')),
    chunk('IDAT',deflateSync(Buffer.from([0,...rgb]))),chunk('IEND',Buffer.alloc(0))]);
}
const pictures=[pixel([255,0,0]),pixel([0,0,255])];
let shareLibrary=false,engineBusy=false;
let nativeName='站内角色',nativeState='working',nativeLook='rainbow',nativeOnline=true,dshReads=0;
const makeUpstream=(index)=>createServer((req,res)=>{
  const send=value=>res.end(JSON.stringify(value));
  if(req.url==='/api/v1/me')return activeAccount?send({user:{number:activeAccount}}):res.writeHead(401).end();
  if(req.url==='/api/v1/ai-contacts')return send({contacts:allowed.map(number=>({source:'bothouse',number}))});
  if(req.url==='/api/v1/library/avatar-image/'+slug){
    assert.equal(req.headers.authorization,undefined);
    res.setHeader('Content-Type','image/png');return res.end(pictures[index]);
  }
  if(req.url==='/collab/api/state'){
    assert.equal(req.headers['x-collab-local'],'synthetic-dsh-owner');
    assert.equal(req.headers.authorization,undefined);
    dshReads++;
    return send({members:[
      {id:'role-1',name:nativeName,kind:'dsh',online:nativeOnline,avatar:nativeLook,persona:privateMarker},
      {id:'human',kind:'human',name:'Synthetic owner',avatar:'orange'},
    ],rooms:[{name:privateMarker}]});
  }
  if(req.headers.authorization!=='Bearer synthetic-management')return res.writeHead(401).end();
  if(req.url==='/api/v1/roles')return send({ok:true,data:{roles:[{
    name:'role-1',display_name:nativeName,source:'bridge',agent_type:'dsh',online:true,paused:false,
    platforms:[{name:'cloud_web',ready:true}],busy:engineBusy,current_task:privateMarker,
  }]}});
  if(req.url==='/api/v1/roles/events'){
    const roles=[role('role-1',name,mood),role('acl','限制角色','idle'),{...role('role-1',nativeName,nativeState,'dsh'),online:nativeOnline}];
    for(let i=0;i<34;i++)roles.push(role('extra-'+i,'第'+i+'位','idle'));
    if(added)roles.push(role('new','新来客','idle'));
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    return res.end('event: snapshot\ndata: '+JSON.stringify({roles})+'\n\nevent: speech\ndata: '+JSON.stringify({text:privateMarker})+'\n\n');
  }
  if(req.url==='/api/v1/library'&&shareLibrary)return send({ok:true,data:{
    packs:[{enabled:true,id:'studio',author:'Artist '+index,license:'CC0-1.0'}],
    avatars:[{slug,pack:'studio',url:'/api/v1/library/avatar-image/'+slug}]
  }});
  if(req.url==='/api/v1/setup/state')return send({ok:true,data:{setup:{team:[{project:'role-1',avatar:slug}],secret:privateMarker}}});
  if(/^\/api\/v1\/projects\/[^/]+\/users$/.test(req.url))return send({ok:true,data:{configured:restricted&&req.url.includes('/acl/')}});
  return res.writeHead(404).end();
});
const instances=[makeUpstream(0),makeUpstream(1)];
const ports=await Promise.all(instances.map(listen)),upstream='http://127.0.0.1:'+ports[0];
const configurations=[];
for(let i=0;i<2;i++){
  const root=join(dir,'instance'+i),publicKey=randomBytes(32).toString('base64');
  await mkdir(join(root,'identity'),{recursive:true});await writeFile(join(root,'identity','signing.pub'),'bothouse-ed25519 '+publicKey);
  await mkdir(join(root,'conest-collab'));
  await writeFile(join(root,'conest-collab','collab.owner.json'),JSON.stringify({
    pid:process.pid,local:{origin:'http://127.0.0.1:'+ports[i],token:'synthetic-dsh-owner'},
  }));
  const config=join(root,'config.toml');await writeFile(config,'[management]\nenabled=true\nport='+ports[i]+'\ntoken="synthetic-management"\n');configurations.push(config);
}
async function api(cookie,path,body){
  return fetch(world+path,{headers:{...(cookie&&{Cookie:cookie}),'Content-Type':'application/json'},method:body?'POST':'GET',body:body&&JSON.stringify(body)});
}
async function ok(r){assert.equal(r.status,200,await r.clone().text());return r.json();}
async function actor(){const r=await api(null,'/api/state');await ok(r);return r.headers.get('set-cookie').split(';')[0];}
async function publish(index,token,shared=false){
  await exec(process.env.PYTHON||'python',['-I','-B','scripts/publish-residents.py','--config',configurations[index],'--world',world,'--once',
    ...(shared?['--friends-origin',upstream,'--friend-account','owner_test']:[])],
    {windowsHide:true,env:{...baseEnv,LITTLE_WORLDS_PUBLISHER_TOKEN:token,LITTLE_WORLDS_FRIENDS_COOKIE:'fixture=same-session'}});
}
try{
  for(let i=0;i<300;i++){
    if(app.exitCode!==null)throw Error('Test world failed to start');
    try{if((await(await fetch(world+'/healthz')).json()).profile==='legacy-test')break;}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  const a=await actor(),b=await actor(),visitor=await actor();
  db=new DatabaseSync(dbfile);
  const gardens=(await ok(await api(a,'/api/universe'))).planets.filter(p=>p.kind==='garden').map(p=>p.id);
  const [p,q]=gardens;
  for(const [owner,planetId] of [[a,p],[b,q]])await ok(await api(owner,'/api/planets/claim',{planetId}));
  const route=id=>'/api/planets/'+id+'/residents';
  const settings=await fetch(world+'/resident-settings',{headers:{Cookie:a}});
  assert.ok((await settings.text()).includes('连接我的 Bothouse'));
  const formed=await fetch(world+'/resident-settings',{method:'POST',headers:{Cookie:a,Origin:world,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({planet:p,action:'connect'})});
  const html=await formed.text();assert.equal(formed.status,200);const tokenA=html.match(/<textarea[^>]*>([a-f0-9]{64})</)[1];
  const slotA=db.prepare('SELECT id FROM planet_resident_sources WHERE planet=?').get(p).id;
  const slotB=await ok(await api(b,route(q)+'/connect',{}));
  assert.equal((await api(b,route(p)+'/connect',{})).status,403);
  assert.equal((await api(null,route(p))).status,401);
  assert.equal((await api(visitor,route(p))).status,403);
  const viewerId=createHash('sha256').update(visitor.split('=')[1]).digest('hex');
  // Same initial dock fixture as spec/auto-trip.test.ts; travel itself is HTTP.
  db.prepare('UPDATE players SET position=? WHERE id=?').run(JSON.stringify(portPoint('hub')),viewerId);
  db.prepare('DELETE FROM ground_states WHERE player_id=?').run(viewerId);
  const travel=async id=>{
    const state=await ok(await api(visitor,'/api/state'));
    const {player}=await ok(await api(visitor,'/api/trip/start',{targetId:id,journey:state.flight.journey,requestId:randomUUID()}));
    assert.equal((await api(visitor,route(state.planetId))).status,403);
    await ok(await api(visitor,'/api/trip/finish',{tripId:player.trip.id,revision:player.trip.revision}));
  };
  const roster=async id=>(await ok(await api(visitor,route(id)))).residents;
  await publish(0,tokenA);await publish(1,slotB.token);
  await travel(p);
  const first=await roster(p),resident=first.find(r=>r.displayName===name);
  assert.equal(first.length,36);assert.equal(resident.displayName,name);assert.equal(resident.activity,'thinking');
  assert.deepEqual(Object.keys(resident).sort(),['activity','appearanceKey','displayName','id','portrait']);
  assert.equal(resident.portrait,null);  // No public library record for this custom slug.
  assert(!JSON.stringify(first).includes(privateMarker));
  mood='working';name='同名·新昵称🎨';added=true;
  await publish(0,tokenA);const next=await roster(p);
  assert.equal(next.length,37);assert.equal(next.find(r=>r.id===resident.id).activity,'working');
  assert.equal(next.find(r=>r.id===resident.id).displayName,name);
  online=false;await publish(0,tokenA);assert.equal((await roster(p))[0].activity,'offline');online=true;
  db.prepare('UPDATE planet_resident_sources SET sampled=sampled-30001 WHERE id=?').run(slotA);
  assert((await roster(p)).every(r=>r.activity==='unknown'));
  const native=first.find(r=>r.displayName===nativeName);
  assert.equal(native.activity,'working');assert.equal(native.appearanceKey,'rainbow');
  assert.notEqual(native.id,resident.id); // Bridge and DSH intentionally share a raw ID.
  assert(!JSON.stringify(first).includes('Synthetic owner'));
  const beforeShared=dshReads;
  allowed=[resident.id];await publish(0,tokenA,true);assert.deepEqual((await roster(p)).map(r=>r.id),allowed);
  assert.equal(dshReads,beforeShared,'No native profile read when the owner has not authorized it');
  const dshEvidence=process.argv[2];
  if(dshEvidence){
    const {chromium,expect}=await import('@playwright/test');
    await mkdir(dshEvidence,{recursive:true});
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const context=await browser.newContext({baseURL:world,viewport:{width:1136,height:795}});
    await context.route('**/*',route=>route.request().url().startsWith(world+'/')?route.continue():route.abort());
    await context.addCookies([{name:visitor.split('=')[0],value:visitor.split('=')[1],url:world}]);
    await context.addInitScript(()=>{
      localStorage.setItem('little-worlds:language:v1','zh');
      localStorage.setItem('little-worlds:core-guide:v1','skipped');
      localStorage.setItem('little-worlds:first-visit:v1','hidden');
    });
    dshPage=await context.newPage();
    await dshPage.goto('/?measure=1');
    await dshPage.waitForFunction(()=>!document.querySelector('#welcome-start')?.disabled,{},{timeout:60000});
    if(await dshPage.locator('#welcome-start').isVisible())await dshPage.locator('#welcome-start').click();
    await expect(dshPage.locator('#bothouse-residents')).toContainText(name,{timeout:30000});
    await expect(dshPage.locator('#bothouse-residents')).not.toContainText('站内角色');
  }
  allowed=[native.id];nativeState='idle';engineBusy=true;
  const conf=await readFile(configurations[0],'utf8');
  const binding=bot=>'\n[[projects]]\nname="role-1"\n[[projects.platforms]]\ntype="cloud_web"\n'+
    '[projects.platforms.options]\nws_url="ws://127.0.0.1:'+ports[0]+'/cloud-web/ws?bot='+bot+'"\n';
  await appendFile(configurations[0],binding('other'));
  await publish(0,tokenA,true);assert.equal((await roster(p))[0].activity,'idle');
  await writeFile(configurations[0],conf+binding('role-1'));
  await publish(0,tokenA,true);assert.equal((await roster(p))[0].activity,'working');
  nativeOnline=false;await publish(0,tokenA,true);assert.equal((await roster(p))[0].activity,'offline');nativeOnline=true;
  allowed=[];await publish(0,tokenA,true);assert.deepEqual(await roster(p),[]);
  engineBusy=false;await writeFile(configurations[0],conf);
  allowed=[resident.id,native.id];
  nativeName='同名·新昵称🎨';nativeState='thinking';nativeLook='whale';
  await publish(0,tokenA,true);
  const updatedNative=(await roster(p)).find(r=>r.id===native.id);
  assert.equal(updatedNative.displayName,nativeName);
  assert.equal(updatedNative.activity,'thinking');
  assert.equal(updatedNative.appearanceKey,'whale');
  assert.equal((await roster(p)).filter(r=>r.displayName===nativeName).length,2);
  if(dshPage){
    const {expect}=await import('@playwright/test');
    await expect(dshPage.locator('#bothouse-residents')).toContainText(nativeName+' · 思考中',{timeout:15000});
    const bodies=()=>dshPage.locator('#world canvas').first().evaluate(canvas=>JSON.parse(canvas.dataset.companions||'[]'));
    await expect.poll(async()=>(await bodies()).find(r=>r.id===native.id)?.model).toBe('bothouse-whale');
    await dshPage.screenshot({path:join(dshEvidence,'visitor-dsh-thinking.png')});
  }
  nativeState='unrecognized';
  nativeLook='upload:private.png';
  await publish(0,tokenA,true);
  const privateNative=(await roster(p)).find(r=>r.id===native.id);
  assert.equal(privateNative.activity,'unknown');
  assert.equal(privateNative.appearanceKey,'default');
  assert.equal(privateNative.portrait ?? null,null);
  nativeOnline=false;await publish(0,tokenA,true);
  assert.equal((await roster(p)).find(r=>r.id===native.id).activity,'offline');
  nativeOnline=true;nativeState='idle';await publish(0,tokenA,true);
  assert.equal((await roster(p)).find(r=>r.id===native.id).activity,'idle');
  allowed=[resident.id];await publish(0,tokenA,true);
  assert.deepEqual((await roster(p)).map(r=>r.id),allowed);
  if(dshPage){
    const {expect}=await import('@playwright/test');
    await expect(dshPage.locator('#bothouse-residents')).not.toContainText('思考中',{timeout:15000});
    await expect.poll(async()=>dshPage.locator('#world canvas').first().evaluate((canvas,id)=>
      JSON.parse(canvas.dataset.companions||'[]').some(r=>r.id===id),native.id)).toBe(false);
    await dshPage.screenshot({path:join(dshEvidence,'visitor-dsh-revoked.png')});
    await browser.close();browser=null;
  }
  activeAccount='someone_else';await publish(0,tokenA,true);assert.equal((await roster(p)).length,0);
  activeAccount='owner_test';await publish(0,tokenA,true);assert.equal((await roster(p)).length,1);
  activeAccount=null;await publish(0,tokenA,true);assert.equal((await roster(p)).length,0);
  shareLibrary=true;
  await publish(0,tokenA);await publish(1,slotB.token);
  const pathFor=(planet,row)=>residentPortrait(planet,row).url;
  const sourceA=()=>roster(p).then(rows=>rows.find(r=>r.id===resident.id));
  const red=await sourceA(),redPath=pathFor(p,red);
  async function readPng(path,expected){
    const reply=await api(visitor,path);
    assert.equal(reply.status,200);assert.equal(reply.headers.get('content-type'),'image/png');
    assert.deepEqual(Buffer.from(await reply.arrayBuffer()),expected);
  }
  await readPng(redPath,pictures[0]);assert.equal((await api(null,redPath)).status,401);
  assert.equal(red.portrait.author,'Artist 0');
  pictures[0]=pixel([0,255,0]);await publish(0,tokenA);
  const greenPath=pathFor(p,await sourceA());
  assert.equal((await api(visitor,redPath)).status,404);await readPng(greenPath,pictures[0]);
  shareLibrary=false;await publish(0,tokenA);
  assert.equal((await sourceA()).portrait,null);assert.equal((await api(visitor,greenPath)).status,404);
  shareLibrary=true;await publish(0,tokenA);await travel(q);
  const other=(await roster(q)).find(r=>r.displayName===name);
  const bluePath=pathFor(q,other);
  await readPng(bluePath,pictures[1]);assert.equal(other.portrait.author,'Artist 1');
  assert.equal((await api(visitor,greenPath)).status,403);
  assert.equal((await api(visitor,greenPath.replace(p,q))).status,404);
  assert.equal(other.displayName,name);assert.notEqual(other.id,resident.id);
  assert.equal((await api(visitor,route(p))).status,403);
  assert.equal((await api(visitor,route(q)+'/disconnect',{sourceId:slotB.sourceId})).status,403);
  await ok(await api(b,route(q)+'/disconnect',{sourceId:slotB.sourceId}));
  assert.equal((await roster(q)).length,0);assert.equal((await api(visitor,bluePath)).status,404);await assert.rejects(()=>publish(1,slotB.token));
  await travel(p);assert.equal((await roster(p)).length,37);
  const audit=await readFile(dbfile+'.business.jsonl','utf8');
  for(const hidden of [tokenA,slotB.token,privateMarker,'synthetic-management'])assert(!audit.includes(hidden));
  console.log(JSON.stringify({passed:true,transport:'real world HTTP + Python publisher, synthetic Bothouse SSE/ACL/setup and Friends directory',
    owners:2,visitors:1,rosterBefore:36,rosterAfter:37,states:['thinking','working','offline','unknown'],
    sourcePngSHA256:pictures.map(png=>createHash('sha256').update(png).digest('hex')),
    originalPixels:true,oldUrlRevoked:true,neighborDenied:true,customAppearanceRemoved:true,
    nativeDSH:{sameIdAfterRename:true,sharedConsentRevoked:true,readBeforeConsent:false,visitorBrowserChecked:Boolean(dshEvidence),states:['working','thinking','unknown','offline','idle'],privatePortraitExcluded:true},
    nativeForm:true,customArtKey:true,emojiRenameSameId:true,separateInstances:true,sharedAccountSwitchClears:true,
    revokedPublisherRejected:true,noPrivateFields:true,visitAndInFlightChecks:true}));
}finally{await browser?.close();db?.close();for(const api of instances){api.closeAllConnections();api.close();}app.kill();}
