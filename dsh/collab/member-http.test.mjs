import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { startHost } from './desk-e2e/host.mjs';

const root = mkdtempSync(join(tmpdir(), 'bothouse-member-http-'));
process.env.HOME = root; process.env.USERPROFILE = root; process.env.BOTHOUSE_DATA_DIR = root;
process.env.CONEST_COLLAB_BOT_TOKEN = ''; process.env.CONEST_COLLAB_BOT_PORT = '';
for (const k of ['BOARD_DIR','CONEST_TEAM_STATUS_DIR','CONEST_WIKI_DIR']) delete process.env[k];
if (!process.env.DSH_REQUIRE_BASE) throw Error('Set DSH_REQUIRE_BASE to the local DSH lib/bin.js');
const dataDir=join(root,'data'), workspacePath=join(root,'workspace');
mkdirSync(dataDir); mkdirSync(workspacePath);
const host=await startHost({dataDir,workspacePath,leadFile:join(root,'lead.json'),dshMembers:[{id:'configured',name:'Configured'}]});
async function call(method,path,body) {
 const r=await fetch(host.url+path,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 return {status:r.status, data:await r.json()};
}
if (process.argv.includes('--serve')) {
 const upstream = new URL(host.url);
 const proxy=createServer((req,res)=>{
  if (req.url.startsWith('/?token=')) { res.writeHead(303, {'set-cookie':'session=isolated; Path=/','location':'/'}); return res.end(); }
  if (!req.headers.cookie?.includes('session=isolated')) { res.writeHead(401); return res.end(); }
  const out=request({hostname:upstream.hostname,port:upstream.port,path:req.url,method:req.method,headers:req.headers}, reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
  out.on('error',()=>{res.writeHead(502);res.end();});req.pipe(out);
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 console.log(`http://127.0.0.1:${proxy.address().port}`);
} else try {
 let r=await call('POST','/collab/api/panel/members',{name:'Native'}); assert.equal(r.status,200); const id=r.data.member.id;
 r=await call('GET','/collab/api/panel/members'); assert.equal(r.data.members.find(m=>m.id===id).can_edit,true); assert.equal(r.data.members.find(m=>m.id==='configured').can_edit,false);
 r=await call('POST','/collab/api/panel/members',{name:'Native'}); assert.equal(r.status,409);
 r=await call('PATCH','/collab/api/panel/members/configured',{name:'Illegal'}); assert.equal(r.status,403);
 r=await call('PATCH',`/collab/api/panel/members/${id}`,{persona:'changed'}); assert.equal(r.status,200); assert.equal(r.data.member.persona,'changed');
 r=await call('DELETE',`/collab/api/panel/members/${id}`); assert.equal(r.status,200);
 r=await call('GET','/collab/api/panel/members'); assert.equal(r.data.members.some(m=>m.id===id),false);
 console.log('PASS real collab routes + isolated SQLite: CRUD, duplicate, read-only');
} finally { await host.close(); }
