// Exercise the packaged renderer through the normal visitor and publication routes.
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { createServer } from 'node:net';
import { crc32, deflateSync } from 'node:zlib';
import { once } from 'node:events';
import { openStore } from '../src/server/store.ts';
import { portPoint } from '../src/shared/ports.ts';

function flatPortrait(rgb) {
  const integer=value=>{const b=Buffer.alloc(4);b.writeUInt32BE(value);return b;};
  const chunk=(name,value)=>{
    const bytes=Buffer.concat([Buffer.from(name),value]);
    return Buffer.concat([integer(value.length),bytes,integer(crc32(bytes))]);
  };
  const header=Buffer.concat([integer(48),integer(48),Buffer.from([8,2,0,0,0])]);
  const row=Buffer.from([0,...Array.from({length:48},()=>rgb).flat()]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),
    chunk('IDAT',deflateSync(Buffer.concat(Array(48).fill(row)))),chunk('IEND',Buffer.alloc(0))]);
}
const [build,evidence]=process.argv.slice(2);
if(!build||!evidence)throw Error('Pass the built game directory and an evidence output directory.');
await mkdir(evidence,{recursive:true});
const db=join(await mkdtemp(join(tmpdir(),'world-residents-')),'world.sqlite');
const store=openStore(db,{integratedWorld:true});
const token=randomBytes(32).toString('hex'),hash=s=>createHash('sha256').update(s).digest('hex');
const owners=[randomBytes(32).toString('hex'),randomBytes(32).toString('hex')];
const planets=owners.map(t=>store.create(hash(t)).planetId);
store.db.prepare('INSERT INTO players(id,position,moved_at,planet_id) VALUES(?,?,?,?)').run(hash(token),JSON.stringify(portPoint(planets[0])),Date.now(),planets[0]);
store.close();
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
const port=probe.address().port;await new Promise(r=>probe.close(r));
const api='http://127.0.0.1:'+port;
const backend=spawn(process.execPath,['src/server/index.ts'],{windowsHide:true,stdio:['ignore','pipe','pipe'],
  env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HOST:'127.0.0.1',PORT:String(port),DATABASE_PATH:db}});
let serverLog='';backend.stderr.on('data',b=>serverLog+=b.toString());backend.stdout.on('data',b=>serverLog+=b.toString());
let web,browser;
try{
  await expect.poll(async()=>{if(backend.exitCode!==null)throw Error(serverLog);return fetch(api+'/healthz').then(r=>r.ok).catch(()=>false);},{timeout:60000}).toBe(true);
  const sources=[];
  for(let i=0;i<2;i++){
    const r=await fetch(api+'/api/planets/'+planets[i]+'/residents/connect',{method:'POST',headers:{cookie:'little_post='+owners[i],'content-type':'application/json'},body:'{}'});
    if(!r.ok)throw Error('Connect: '+r.status+' '+await r.text());sources.push((await r.json()).token);
  }
  const publish=async(i,roles)=>{
    const r=await fetch(api+'/api/resident-feed',{method:'POST',headers:{authorization:'Bearer '+sources[i],'content-type':'application/json'},body:JSON.stringify({instance:hash('fixture-'+i),residents:roles.map(r=>({source:'bridge',...r}))})});
    if(!r.ok)throw Error('Publish: '+r.status+' '+await r.text());
    return r.json();
  };
  const a={project:'one',displayName:'青禾',appearanceKey:'whale',activity:'working'};
  const b={project:'two',displayName:'青禾',appearanceKey:'dragon',activity:'thinking'};
  const c={project:'three',displayName:'陌生搭档',appearanceKey:'custom-uninstalled',activity:'waiting'};
  const colors=[[235,24,43],[19,106,239],[29,223,98]];
  const looks=colors.map(color=>{
    const bytes=flatPortrait(color);
    return {bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
  });
  const custom={project:'same-project',displayName:'同名试验',appearanceKey:'same-look',activity:'idle'};
  const customRoster=async(i,look,others)=>{
    const subject={...custom,portrait:{sha256:look.sha256,pack:'qa-pack',author:'Fixture',license:'CC0-1.0'}};
    const {missingArt}=await publish(i,[...others,subject]);
    for(const {id,sha256} of missingArt??[]){
      const response=await fetch(api+'/api/resident-feed/art/'+id+'/'+sha256,{method:'POST',
        headers:{authorization:'Bearer '+sources[i],'content-type':'image/png'},body:look.bytes});
      if(!response.ok)throw Error('Upload: '+response.status+' '+await response.text());
    }
  };
  await publish(0,[a,b]);
  const namedLanxi={project:'still',displayName:'岚汐',appearanceKey:'lanxi',activity:'unknown'};
  await customRoster(1,looks[1],[namedLanxi,c]);
  web=await preview({build:{outDir:resolve(build)},preview:{host:'127.0.0.1',port:0,proxy:{'/api':{target:api,changeOrigin:false,configure(proxy){proxy.on('proxyReq',(out,req)=>out.setHeader('host',req.headers.host));}}}},logLevel:'error'});
  const origin='http://127.0.0.1:'+web.httpServer.address().port;
  browser=await chromium.launch({channel:process.env.RESIDENT_BROWSER_CHANNEL||'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
  const ctx=await browser.newContext({baseURL:origin,viewport:{width:1040,height:720}});
  await ctx.addCookies([{name:'little_post',value:token,url:origin}]);
  await ctx.addInitScript(()=>{localStorage.setItem('little-worlds:quality:v1','smooth');localStorage.setItem('little-worlds:language:v1','zh');localStorage.setItem('little-worlds:core-guide:v1','skipped');localStorage.setItem('little-worlds:first-visit:v1','hidden');});
  const page=await ctx.newPage(),errors=[],assets=new Set();
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if((r.url().includes('/bothouse-art/')||r.url().includes('/art/'))&&r.status()===200)assets.add(new URL(r.url()).pathname);});
  await page.goto('/?measure=1');page.setDefaultTimeout(45000);
  await page.waitForFunction(()=>document.querySelector('#welcome-start:not(:disabled)')||document.querySelector('#welcome-panel')?.dataset.state==='failed',null,{timeout:90000});
  if(await page.locator('#welcome-start').isVisible())await page.locator('#welcome-start').click();
  const summary=page.locator('#bothouse-residents');
  await publish(0,[a,b]);
  const snap=()=>page.locator('#world canvas').first().evaluate(el=>JSON.parse(el.dataset.companions||'[]'));
  const photo=name=>page.screenshot({path:join(evidence,name+'.png')});
  const artSeen=look=>expect.poll(()=>[...assets].some(url=>url.endsWith('/'+look.sha256+'.png')),{timeout:20000}).toBe(true);
  await expect(summary).toContainText('工作中',{timeout:20000});await expect(summary).toContainText('思考中');
  await expect.poll(async()=>(await snap()).filter(v=>v.meshes>=5&&!v.sprites).length).toBe(2);
  const first=await snap();
  await photo('两位搭档-访客近景');
  // On the same two bodies, observe a real ground walk and turn after the host publishes idle.
  const idle={...a,activity:'idle'};
  const before=first.find(r=>r.look==='whale');
  await publish(0,[idle,b]);
  await expect(summary).toContainText('休息中',{timeout:12000});
  const frames=join(evidence,'turn');await mkdir(frames,{recursive:true});
  const series=[];
  for(let i=0;i<30;i++){
    const current=(await snap()).find(r=>r.look==='whale');
    if(current)series.push(current);
    await page.screenshot({path:join(frames,'f'+String(i).padStart(2,'0')+'.png')});
    if(i===12||i===24)await publish(0,[idle,b]);
    await page.waitForTimeout(90);
  }
  const dot=(p,q)=>Math.abs(p.reduce((sum,x,i)=>sum+x*q[i],0));
  const angle=Math.max(...series.map(s=>2*Math.acos(Math.min(1,dot(s.rotation,before.rotation)))*180/Math.PI));
  const metres=Math.max(...series.map(s=>Math.hypot(...s.position.map((x,i)=>x-before.position[i]))));
  expect(angle).toBeGreaterThan(45);expect(metres).toBeGreaterThan(.1);
  await customRoster(0,looks[0],[a,b]);
  const badge=async look=>{
    const match=async()=>(await snap()).find(r=>r.badge?.endsWith('/'+look.sha256+'.png'));
    await expect.poll(async()=>!!await match(),{timeout:18000}).toBe(true);
    return await match();
  };
  await artSeen(looks[0]);const red=await badge(looks[0]);await expect(summary).toContainText('qa-pack/same-look · Fixture · CC0-1.0',{timeout:14000});await photo('01-arrival');
  await customRoster(0,looks[2],[{...a,activity:'talking'},{...b,activity:'offline'}]);
  await artSeen(looks[2]);const green=await badge(looks[2]);expect(red.body).toBe(green.body);
  const oldAddress=[...assets].find(url=>url.endsWith('/'+looks[0].sha256+'.png'));
  expect((await page.request.get(oldAddress)).status()).toBe(404);
  await expect(summary).toContainText('说话中',{timeout:12000});await expect(summary).toContainText('离线');
  await photo('02-status');
  const gl=await page.locator('#world canvas').first().evaluate(c=>!!c.getContext('webgl2'));
  await page.locator('#board-ship').click();
  await page.locator('#trip-departure').selectOption(planets[1]);
  const startResponse=page.waitForResponse(r=>r.url().endsWith('/api/trip/start'));
  await page.locator('#confirm-flight').click();const trip=await startResponse;if(!trip.ok())throw Error(await trip.text());
  await page.locator('#flight-skip').click();
  await customRoster(1,looks[1],[namedLanxi,c]);
  await artSeen(looks[1]);const blue=await badge(looks[1]);expect(blue.id).not.toBe(green.id);
  const previousPlanetArt=[...assets].find(url=>url.endsWith('/'+looks[2].sha256+'.png'));
  const otherPlanetStatus=(await page.request.get(previousPlanetArt)).status();
  expect([403,404]).toContain(otherPlanetStatus);
  await expect(summary).toContainText('陌生搭档',{timeout:45000});await expect(summary).not.toContainText('青禾');
  await expect(summary).toContainText('状态未知');await photo('03-neighbour');
  const visited=await snap();
  const lanxi=visited.find(r=>r.look==='lanxi');
  const fallback=visited.find(r=>r.look==='custom-uninstalled');
  expect(lanxi?.model).toBe('bothouse-lanxi');
  expect(fallback?.model).toBe('bothouse-generic');
  for(const actor of [lanxi,fallback])expect(Math.max(...actor.center.map(Math.abs))).toBeLessThan(1);
  expect(lanxi?.meshes).toBeGreaterThan(4);expect(lanxi?.sprites).toBe(0);
  expect(fallback?.meshes).toBeGreaterThan(4);expect(fallback?.sprites).toBe(0);
  const quietInitial=lanxi;
  expect(quietInitial?.meshes).toBeGreaterThan(4);
  await page.waitForTimeout(450);
  const quietLater=(await snap()).find(r=>r.id===quietInitial.id);
  expect(quietLater.position).toEqual(quietInitial.position);expect(quietLater.rotation).toEqual(quietInitial.rotation);
  await publish(1,[{...custom,portrait:null},c]);
  await expect.poll(async()=>(await snap()).find(r=>r.id===blue.id)?.badge).toBe(null);
  await expect(summary).not.toContainText('Fixture');
  await ctx.setOffline(true);await expect(summary).toHaveText('',{timeout:10000});await photo('04-connection-lost');
  await ctx.setOffline(false);await publish(1,[{...c,activity:'idle'}]);await expect(summary).toContainText('休息中',{timeout:20000});
  // Another normal entry, this time with the visitor's reduced-motion preference.
  await page.emulateMedia({reducedMotion:'reduce'});await page.reload();
  await page.waitForFunction(()=>document.querySelector('#welcome-start:not(:disabled)')||document.querySelector('#welcome-panel')?.hidden);
  if(await page.locator('#welcome-start').isVisible())await page.locator('#welcome-start').click();
  await expect.poll(async()=>(await snap()).some(r=>r.activity==='idle')).toBe(true);
  const resting=(await snap()).find(r=>r.activity==='idle');
  await page.waitForTimeout(1400);
  const rested=(await snap()).find(r=>r.id===resting.id);
  expect(rested.position).toEqual(resting.position);expect(rested.rotation).toEqual(resting.rotation);
  await publish(1,[]);await expect(summary).toHaveText('',{timeout:12000});
  expect(gl).toBe(true);expect(errors).toEqual([]);
  expect(await page.locator('a[href="/resident-settings"]').evaluate(a=>a.hidden)).toBe(true);
  await writeFile(join(evidence,'receipt.json'),JSON.stringify({webgl2:gl,publicAssetResponses:[...assets],customPortraits:looks.map(({sha256},i)=>({sha256,color:colors[i]})),planetsVisited:planets.length,sameNameWorkingThinking:true,talkingAndOffline:true,departedUsingShip:true,visitorInitialGeometry:first,maximumTurnDegrees:angle,maximumWalkMetres:metres,bodySprites:0,portraitInCard:true,approvedBadgeTextures:[red.badge,green.badge,blue.badge],sameBodyAfterSwap:red.body===green.body,revokedBadgeRemoved:true,replacedPortraitOldUrl404:true,otherPlanetStatus,visitedModelNames:visited.map(({look,model})=>({look,model})),unknownStayedStill:true,reducedMotionStayedStill:true,disconnectCleared:true,reconnected:true,emptyAfterRemoval:true,errors},null,2));
  console.log('Passed resident scene, two planets, actual ship travel and connection recovery.');
}finally{await browser?.close();await web?.close();backend.kill();}
