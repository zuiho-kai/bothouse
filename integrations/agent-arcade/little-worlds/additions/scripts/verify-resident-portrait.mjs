// node scripts/verify-resident-portrait.mjs <fresh evidence directory>
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {promisify} from 'node:util';
import {crc32,deflateSync,inflateSync} from 'node:zlib';
import {planetResidents} from '../src/server/planet-residents.ts';
import {serveResidentArt,withResidentArt} from '../src/server/resident-art.ts';
import {residentPortrait} from '../src/shared/resident-portrait.ts';
import {jsonBody} from '../src/server/resident-http.ts';
const exec=promisify(execFile), out=resolve(process.argv[2]), sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(out); // preserve previous evidence
const servers=[];
async function local(handler){
  const server=createServer(handler);servers.push(server);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return 'http://127.0.0.1:'+server.address().port;
}
function chunk(id,data){
  const head=Buffer.alloc(8);head.writeUInt32BE(data.length);head.write(id,4);
  const tail=Buffer.alloc(4);tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4),data])));
  return Buffer.concat([head,data,tail]);
}
function portrait(color){
  const size=48,raw=Buffer.alloc(size*(1+4*size)),hdr=Buffer.alloc(13);
  hdr.writeUInt32BE(size);hdr.writeUInt32BE(size,4);hdr[8]=8;hdr[9]=6;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const pos=y*(1+4*size)+1+x*4;
    const face=(x-24)**2+(y-20)**2<15**2,shirt=y>30&&Math.abs(x-24)<(y-20);
    if(face||shirt)raw.set(face&&y>15?([16,32].includes(x)&&y===21?[55,35,30,255]:[244,205,169,255]):[...color,255],pos);
  }
  const start=Buffer.from('89504e470d0a1a0a','hex'),ihdr=chunk('IHDR',hdr),idat=chunk('IDAT',deflateSync(raw)),end=chunk('IEND',Buffer.alloc(0));
  return {original:Buffer.concat([start,ihdr,chunk('tEXt',Buffer.from('Note\0private fixture note')),idat,end]),public:Buffer.concat([start,ihdr,idat,end]),raw};
}
const looks=[portrait([214,92,56]),portrait([42,112,184]),portrait([59,160,97])];
const db=new DatabaseSync(':memory:');
db.exec("CREATE TABLE players(id TEXT PRIMARY KEY,planet_id TEXT,flight TEXT); CREATE TABLE planets(id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT)");
const planets=['p-'+randomUUID(),'p-'+randomUUID()];
for(const [i,p] of planets.entries()){
  db.prepare('INSERT INTO players VALUES(?,?,NULL)').run('owner'+i,p);
  db.prepare("INSERT INTO planets VALUES(?,?,'garden')").run(p,'owner'+i);
}
db.prepare("INSERT INTO players VALUES('visitor',?,NULL)").run(planets[0]);
const service=withResidentArt(db,planetResidents(db));
const slots=planets.map((p,i)=>service.connect('owner'+i,p)),trace=[];
const world=await local(async(req,res)=>{
  try{
    const path=req.url,viewer=req.headers.cookie==='world=fixture'?'visitor':'';
    if(await serveResidentArt(req,res,path,viewer,service)){
      if(req.method==='POST')trace.push({id:path.split('/').at(-2),sha256:path.split('/').at(-1)});return;
    }
    if(path==='/api/resident-feed'){
      const token=req.headers.authorization.slice(7);
      service.authorize(token);const payload=await jsonBody(req,1048576);
      const result=service.publish(token,payload);res.end(JSON.stringify(result));return;
    }
    const route=/^\/api\/planets\/(p-[a-f0-9-]{36})\/residents$/.exec(path);
    if(route&&viewer){res.end(JSON.stringify(service.read(viewer,route[1])));return;}
    res.writeHead(404).end();
  }catch(err){res.writeHead(err.status??500).end();}
});
const configs=[], state=[{look:0},{look:1}];
try{
  for(const [i,s] of state.entries()){
    s.slug='paper-lamp';s.pack='lamp-pack';s.license='CC-BY-4.0';s.author='Fixture artist '+i;s.downloads=0;
    const api=await local((req,res)=>{
      if(req.url==='/api/v1/library/avatar-image/paper-lamp'){
        assert.equal(req.headers.authorization,undefined);
        s.downloads++;res.writeHead(200,{'Content-Type':'image/png'}).end(looks[s.look].original);return;
      }
      if(req.headers.authorization!=='Bearer fixture'){res.writeHead(401).end();return;}
      if(req.url==='/api/v1/roles/events'){
        return res.end('event: snapshot\ndata: '+JSON.stringify({roles:[{source:'bridge',role_key:'bridge:lamp',name:'lamp',display_name:'小灯',status:'idle',online:true}]})+'\n\n');
      }
      let data;
      if(req.url==='/api/v1/setup/state')data={setup:{team:[{project:'lamp',avatar:s.slug}]}};
      else if(req.url==='/api/v1/projects/lamp/users')data={configured:s.restrict===true};
      else if(req.url==='/api/v1/library')data={avatars:[{slug:s.slug,pack:s.pack,hidden:false,url:'https://unrequested.invalid/picture'}],
        packs:[{id:s.pack,enabled:true,builtin:s.pack==='default',author:s.author,license:s.license}]};
      else {res.writeHead(404).end();return;}
      res.end(JSON.stringify({ok:true,data}));
    });
    const root=join(out,'synthetic-host-'+i);
    await mkdir(join(root,'identity'),{recursive:true});
    const key=randomBytes(32).toString('base64');s.instance=sha(key);
    await writeFile(join(root,'identity','signing.pub'),'bothouse-ed25519 '+key);
    const file=join(root,'config.toml');
    await writeFile(file,'[management]\nenabled=true\nport='+new URL(api).port+'\ntoken="fixture"\n');
    configs.push(file);
  }
  const python=String.raw`import sys,runpy
from pathlib import Path
sys.path.insert(0,"scripts")
from resident_portraits import publish_current
pub=runpy.run_path("scripts/publish-residents.py")
import os,json
publish_current(pub,Path(sys.argv[1]),set(),None,pub["origin"](sys.argv[2]),os.environ["FIXTURE_WORLD_SLOT"],approvals=json.loads(sys.argv[3]))`;
  const publish=(i,grants=[])=>exec('python',['-B','-c',python,configs[i],world,JSON.stringify(grants)],
    {env:{...process.env,FIXTURE_WORLD_SLOT:slots[i].token},windowsHide:true});
  const req=url=>fetch(world+url,{headers:{Cookie:'world=fixture'}});
  const read=async(i)=>{
    const response=await req('/api/planets/'+planets[i]+'/residents');assert.equal(response.status,200);
    return (await response.json()).residents[0];
  };
  const land=i=>db.prepare("UPDATE players SET planet_id=? WHERE id='visitor'").run(planets[i]);
  const received=[];
  async function see(i,look,filename){
    land(i);const resident=await read(i);
    const view=residentPortrait(planets[i],resident);assert.ok(view?.url);
    assert.equal(resident.appearanceKey,'default');assert.equal(resident.displayName,'小灯');
    const response=await req(view.url);assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/png');
    const image=Buffer.from(await response.arrayBuffer());assert.deepEqual(image,looks[look].public);
    const count=image.readUInt32BE(33),decoded=inflateSync(image.subarray(41,41+count));assert.deepEqual(decoded,looks[look].raw);
    assert(!image.includes(Buffer.from('private fixture note')));
    await writeFile(join(out,filename+'.png'),image);
    received.push({filename,id:resident.id,planet:planets[i],sha256:sha(image),rgbaScanlines:sha(decoded),size:[48,48],credit:view.credit});
    return view.url;
  }
  await publish(0);await publish(1);
  const a=await see(0,0,'visitor-A'),b=await see(1,1,'visitor-B');
  assert.notEqual(a,b);assert.notEqual(received[0].id,received[1].id);
  assert.equal((await req(a)).status,403);
  assert.equal((await req(a.replace(planets[0],planets[1]))).status,404);
  assert.equal((await fetch(world+b)).status,401);
  const [idA,digestA]=[received[0].id,received[0].sha256];
  const wrong=await fetch(world+'/api/resident-feed/art/'+idA+'/'+digestA,{method:'POST',
    headers:{Authorization:'Bearer '+slots[1].token,'Content-Type':'image/png'},body:looks[0].public});
  assert.equal(wrong.status,404);
  await publish(0);assert.equal(trace.length,2);
  state[0].look=2;await publish(0);const changed=await see(0,2,'visitor-A-updated');
  assert.equal((await req(a)).status,404);assert.equal(received[2].id,received[0].id);
  land(1);assert.equal((await req(b)).status,200);
  state[0].license='';const before=state[0].downloads;await publish(0);land(0);
  assert.equal(state[0].downloads,before);assert.equal(residentPortrait(planets[0],await read(0)),null);
  assert.equal((await req(changed)).status,404);
  const grant={instance:state[0].instance,project:'lamp',slug:'paper-lamp',pack:'lamp-pack',sha256:sha(looks[2].public),
    author:'Fixture artist 0',license:'Owner cleared for planet visitors'};
  await publish(0,[{...grant,instance:state[1].instance}]);assert.equal(residentPortrait(planets[0],await read(0)),null);
  await publish(0,[grant]);const exact=residentPortrait(planets[0],await read(0));
  assert.equal(exact.url,changed);assert.match(exact.credit,/Owner cleared/);
  state[0].look=0;await publish(0,[grant]);assert.equal(residentPortrait(planets[0],await read(0)),null);
  assert.equal((await req(changed)).status,404);
  state[0].slug='whale';state[0].pack='default';await publish(0);
  const builtin=await read(0);assert.equal(builtin.appearanceKey,'whale');assert.equal(residentPortrait(planets[0],builtin),undefined);
  state[0].slug='missing-resource';state[0].pack='lamp-pack';state[0].license='CC-BY-4.0';await publish(0);
  assert.equal(residentPortrait(planets[0],await read(0)),null);
  state[0].restrict=true;await publish(0);assert.equal(await read(0),undefined);
  service.disconnect('owner1',planets[1],slots[1].sourceId);land(1);assert.equal((await req(b)).status,404);
  assert.equal(trace.length,4);
  const receipt={passed:true,base:'real planetResidents SQL, publisher snapshot and new transport modules',
    fixtures:'two loopback Bothouse management servers, synthetic world sessions/landing, no running world UI or real accounts',
    received,uploads:trace.length,unchangedHeartbeatUploads:0,wrongSlot:wrong.status,wrongPlanet:403,rewrittenUrl:404,anonymous:401,
    replacedUrl:404,unlicensedFallback:true,explicitGrantOnlyForExactInstanceProjectAndImage:true,
    missingAvatarFallback:true,builtinUsesSprite:true,revokedSlot:404,removedAclClears:true};
  await writeFile(join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{for(const s of servers){s.closeAllConnections();s.close();}db.close();}
