'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {fixture,P,dependencies}=require('./fixture.cjs');
test('real HTTPS tus bytes resume from durable offset and finalize exactly once',async t=>{
  const f=await fixture(t),bytes=Buffer.from([0,255,8,0,65,4,7,9]);const u=await f.createUpload(bytes);assert.equal(u.response.status,201);assert.equal(u.response.headers['tus-resumable'],'1.0.0');assert.match(u.url,/^\/v1\/uploads\/[a-f0-9-]+$/);
  assert.equal((await f.patch(u,bytes.subarray(0,3))).status,204);assert.equal((await f.head(u)).headers['upload-offset'],'3');
  assert.equal((await f.patch(u,bytes.subarray(3),0)).status,409);assert.equal((await f.head(u)).headers['upload-offset'],'3');
  await f.close();await f.start();assert.equal((await f.head(u)).headers['upload-offset'],'3');assert.equal((await f.patch(u,bytes.subarray(3),3)).status,204);
  const receipt=await f.finalize(u);assert.equal(receipt.status,200);assert.equal(receipt.json.job.published,true);assert.equal(receipt.json.job.sha256,P.hash(bytes));assert.deepEqual(fs.readFileSync(path.join(f.dirs.files,'new.bin')),bytes);
  assert.equal((await f.finalize(u)).status,409);assert.equal((await f.job(u)).job.state,'published');assert.equal((await f.request('DELETE',u.url,{headers:{'Tus-Resumable':'1.0.0'}})).status,409);
});
test('single file immutable snapshot supports exact 206 after restart and refuses validator fallback',async t=>{
  const f=await fixture(t),bytes=Buffer.from('original\0bytes');fs.writeFileSync(path.join(f.dirs.files,'source.bin'),bytes);const list=await f.list();const created=await f.request('POST','/v1/snapshots',{json:{clientJobId:randomUUID(),rootId:'files',entryIds:[list.entries[0].entryId]}});assert.equal(created.status,200);const j=created.json.job;assert.equal(j.archive,false);
  fs.writeFileSync(path.join(f.dirs.files,'source.bin'),'later different source');await f.close();await f.start();
  const url='/v1/snapshots/'+j.snapshotId+'/content';const r=await f.request('GET',url,{headers:{Range:'bytes=3-', 'If-Range':j.etag}});assert.equal(r.status,206);assert.equal(r.headers['content-range'],`bytes 3-${bytes.length-1}/${bytes.length}`);assert.deepEqual(r.bytes,bytes.subarray(3));
  assert.equal((await f.request('GET',url,{headers:{Range:'bytes=3-', 'If-Range':'"wrong"'}})).status,412);
  assert.equal((await f.request('GET',url,{headers:{Range:'bytes=999-', 'If-Range':j.etag}})).status,416);
  const h=await f.request('HEAD',url);assert.equal(h.headers['x-content-sha256'],P.hash(bytes));assert.equal(h.bytes.length,0);
});
test('directory and batch ZIP snapshots preserve observed empty directories and raw bytes',async t=>{
  const f=await fixture(t);fs.mkdirSync(path.join(f.dirs.files,'folder'));fs.mkdirSync(path.join(f.dirs.files,'folder','empty'));fs.writeFileSync(path.join(f.dirs.files,'folder','file.bin'),Buffer.from([0,255,1]));fs.writeFileSync(path.join(f.dirs.files,'second.txt'),'two');const list=await f.list();
  const r=await f.request('POST','/v1/snapshots',{json:{clientJobId:randomUUID(),rootId:'files',entryIds:list.entries.map(e=>e.entryId)}});assert.equal(r.status,200);const j=r.json.job;assert.equal(j.archive,true);assert.equal(j.sourceAtomic,false);const zip=(await f.request('GET','/v1/snapshots/'+j.snapshotId+'/content')).bytes;assert.equal(P.hash(zip),j.sha256);
  const yauzl=require('../../../node_modules/yauzl');const reader=await yauzl.fromBufferPromise(zip,{lazyEntries:true});const names=[];for await(const entry of reader.eachEntry()){names.push(entry.fileName);}assert.deepEqual(names,['folder/','folder/empty/','folder/file.bin','second.txt']);
});
test('independent auth/instance and metadata boundaries never create unauthenticated state',async t=>{
  const f=await fixture(t);assert.equal((await f.request('GET','/v1/roots',{headers:{Authorization:'Bearer synthetic_wrong'}})).status,401);
  assert.equal((await f.request('GET','/v1/roots',{headers:{'X-Transfer-Instance':randomUUID()}})).status,409);
  assert.equal((await f.request('OPTIONS','/v1/uploads',{headers:{Authorization:'Bearer synthetic_wrong'}})).status,401);
  assert.equal((await f.request('GET','/v1/roots',{headers:{Origin:'https://external.invalid'}})).status,400);
  assert.equal((await f.request('GET','/v1/roots?token=synthetic')).status,400);
  assert.throws(()=>P.name('../outside'));assert.throws(()=>P.name('CON'));assert.throws(()=>P.config({...f.config,stateDir:f.dirs.files}));
  assert.equal(f.service.store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,0);
});
test('full SHA mismatch and concurrent destination creation prevent publication',async t=>{
  const f=await fixture(t),bytes=Buffer.from('safe');const u=await f.createUpload(bytes);await f.patch(u,Buffer.from('evil'));assert.equal((await f.finalize(u)).json.code,'integrity_failed');assert.equal(fs.existsSync(path.join(f.dirs.files,'new.bin')),false);
  const v=await f.createUpload(bytes,'collision.bin');await f.patch(v,bytes);fs.writeFileSync(path.join(f.dirs.files,'collision.bin'),'original');assert.equal((await f.finalize(v)).json.code,'target_exists');assert.equal(fs.readFileSync(path.join(f.dirs.files,'collision.bin'),'utf8'),'original');
});
test('replaced partial is neither adopted nor truncated during restart recovery',async t=>{
  const f=await fixture(t),u=await f.createUpload(Buffer.from('12345'));await f.patch(u,Buffer.from('12'));const j=f.service.store._load(u.clientJobId),filename=f.service.store._blob(j);await f.close();fs.renameSync(filename,filename+'.original');fs.writeFileSync(filename,'replacement');await f.start();assert.equal((await f.job(u)).job.state,'recovery_required');assert.equal(fs.readFileSync(filename,'utf8'),'replacement');assert.equal(fs.readFileSync(filename+'.original','utf8'),'12');
});
test('expiry cleans only exact private objects and never deletes originals/published target',async t=>{
  let clock=Date.now();const f=await fixture(t,{now:()=>clock}),bytes=Buffer.from('publish');const u=await f.createUpload(bytes);await f.patch(u,bytes);await f.finalize(u);clock+=P.LIMITS.jobTtlMs+1;await f.service.store.cleanup();assert.equal((await f.job(u)).job.cleanupVerified,true);assert.equal(fs.readFileSync(path.join(f.dirs.files,'new.bin'),'utf8'),'publish');
});
test('second store process ownership and changed root identity fail closed',async t=>{
  const f=await fixture(t);const {TransferStore}=require('../../../src/transfer-helper/store.cjs');await assert.rejects(()=>TransferStore.open(f.config),e=>e.code==='busy');
  fs.renameSync(f.dirs.files,f.dirs.files+'-old');fs.mkdirSync(f.dirs.files);assert.equal((await f.list()).code,'scope_changed');
});
test('zero bytes are uploaded but not published until explicit finalization',async t=>{
  const f=await fixture(t),u=await f.createUpload(Buffer.alloc(0));assert.equal(u.response.status,201);assert.equal((await f.job(u)).job.state,'uploaded');assert.equal(fs.existsSync(path.join(f.dirs.files,'new.bin')),false);assert.equal((await f.finalize(u)).json.job.published,true);
});
