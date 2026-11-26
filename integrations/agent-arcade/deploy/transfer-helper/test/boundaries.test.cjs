'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {fixture,P}=require('./fixture.cjs');
test('multiple roots use independent explicit staging; state can live on another drive',async t=>{
  const f=await fixture(t);await f.close();const parent=path.resolve(__dirname,'../../../work');
  // work/ is untracked, so a fresh checkout (CI) does not have it. It is left in place: it may be a developer's own folder.
  fs.mkdirSync(parent,{recursive:true});const extra=fs.mkdtempSync(path.join(parent,'transfer-cross-volume-'));t.after(()=>fs.rmSync(extra,{recursive:true,force:true}));const target=path.join(extra,'files'),stage=path.join(extra,'stage');fs.mkdirSync(target);fs.mkdirSync(stage);f.config.roots.push({rootId:'second',label:'Second volume fixture',path:target,read:true,upload:true,stagingDir:stage});await f.start();
  if(path.parse(f.dirs.state).root!==path.parse(target).root)assert.notEqual(fs.statSync(f.dirs.state).dev,fs.statSync(target).dev);
  const list=await f.request('POST','/v1/list',{json:{rootId:'second',directoryId:null}});const bytes=Buffer.from('second root bytes'),metadata={clientJobId:randomUUID(),rootId:'second',directoryId:list.json.directory.directoryId,name:'result.bin',sha256:P.hash(bytes)};
  const encoded=Object.entries(metadata).map(([k,v])=>k+' '+Buffer.from(v).toString('base64')).join(',');const created=await f.request('POST','/v1/uploads',{headers:{'Tus-Resumable':'1.0.0','Upload-Length':String(bytes.length),'Upload-Metadata':encoded,'Content-Length':'0'}});assert.equal(created.status,201);const u={url:created.headers.location,clientJobId:metadata.clientJobId};await f.patch(u,bytes);assert.equal((await f.finalize(u)).json.job.published,true);assert.deepEqual(fs.readFileSync(path.join(target,'result.bin')),bytes);assert.equal(fs.readdirSync(stage).length,1);assert.equal(fs.readdirSync(f.dirs.staging).length,0);
  await f.close();await f.start();assert.equal((await f.job(u)).job.published,true);await f.close();
});
test('symlink/junction roots and exported links are refused without following their contents',async t=>{
  const f=await fixture(t);fs.mkdirSync(path.join(f.root,'outside'));fs.writeFileSync(path.join(f.root,'outside','secret.bin'),'synthetic outside');fs.symlinkSync(path.join(f.root,'outside'),path.join(f.dirs.files,'link'),'junction');assert.equal((await f.list()).code,'unsupported');assert.equal(fs.readFileSync(path.join(f.root,'outside','secret.bin'),'utf8'),'synthetic outside');
});
test('snapshot source change produces no ready representation; private failed blob stays queryable',async t=>{
  let modify;const f=await fixture(t,{hook:async phase=>{if(phase==='snapshot-flushed')modify();}});const file=path.join(f.dirs.files,'source');fs.writeFileSync(file,'before');modify=()=>fs.writeFileSync(file,'after');const l=await f.list(),clientJobId=randomUUID();const r=await f.request('POST','/v1/snapshots',{json:{clientJobId,rootId:'files',entryIds:[l.entries[0].entryId]}});assert.equal(r.json.code,'source_changed');const job=(await f.request('GET','/v1/jobs/'+clientJobId)).json.job;assert.equal(job.state,'failed');assert.equal(job.published,false);assert.equal((await f.request('DELETE','/v1/snapshots/'+job.snapshotId)).json.job.cleanupVerified,true);
});
test('store quotas reject new jobs without evicting retained data',async t=>{
  const f=await fixture(t);for(let i=0;i<8;i++){const list=await f.list();await f.service.store.createUpload({id:randomUUID(),length:67108864,metadata:{clientJobId:randomUUID(),rootId:'files',directoryId:list.directory.directoryId,name:'quota-'+i,sha256:'0'.repeat(64)}});}const r=await f.createUpload(Buffer.from('new'),'over-quota');assert.equal(r.response.status,507);assert.equal(fs.readdirSync(f.dirs.staging).length,8);
});
test('malformed tus extensions, metadata and excessive chunks do not advance offset',async t=>{
  const f=await fixture(t),u=await f.createUpload(Buffer.from('12'));const r=await f.request('PATCH',u.url,{bytes:Buffer.from('1'),headers:{'Tus-Resumable':'1.0.0','Upload-Offset':'0','Content-Type':'application/offset+octet-stream','Upload-Checksum':'sha256 fake'}});assert.equal(r.status,400);assert.equal((await f.head(u)).headers['upload-offset'],'0');
  const bad=await f.request('PATCH',u.url,{bytes:Buffer.from('123'),headers:{'Tus-Resumable':'1.0.0','Upload-Offset':'0','Content-Type':'application/offset+octet-stream'}});assert.equal(bad.status,413);assert.equal((await f.head(u)).headers['upload-offset'],'0');
});
test('unconfirmed file close retains owned handle and service close retries it',async t=>{
  const f=await fixture(t),fd=await f.service.store._createFile(path.join(f.dirs.staging,'synthetic-close-test'));const original=fd.close.bind(fd);let calls=0;fd.close=async()=>{calls++;if(calls===1)throw new Error('synthetic close error');return original();};await assert.rejects(()=>f.service.store._closeFile(fd),e=>e.code==='cleanup_unconfirmed');assert.equal(f.service.store.fds.has(fd),true);await f.close();assert.equal(fd.fd,-1);assert.equal(calls,2);
});
test('invalid TLS configuration fails before acquiring a store owner',async t=>{
  const f=await fixture(t);await f.close();const {createService}=require('../../../src/transfer-helper/server.cjs');await assert.rejects(()=>createService({config:f.config,tls:{key:'synthetic invalid',cert:'synthetic invalid'}}));await f.start();assert.equal((await f.request('GET','/v1/capabilities')).status,200);
});

test('native BigInt stat preserves NTFS identifiers and nanosecond proofs without Number rounding',async t=>{
  const f=await fixture(t),O=require('../../../src/transfer-helper/ownership.cjs');let rounded=0;
  for(let i=0;i<20;i++){
    const file=path.join(f.dirs.files,'identity-'+i);fs.writeFileSync(file,'synthetic identity');
    const exact=fs.lstatSync(file,{bigint:true}),legacy=fs.lstatSync(file);if(BigInt(legacy.ino)!==exact.ino)rounded++;
    const sync=O.lstatSync(file),asyncStat=await O.lstat(file),fd=await f.service.store._openExact(file,P.identity(sync));
    try{for(const s of [sync,asyncStat,await O.stat(fd)]){
      assert.equal(s.ino,exact.ino.toString());assert.equal(s.dev,exact.dev.toString());assert.equal(s.mtimeNs,exact.mtimeNs.toString());assert.equal(s.ctimeNs,exact.ctimeNs.toString());assert.equal(s.size,Number(exact.size));
    }}finally{await f.service.store._closeFile(fd);}
    assert.throws(()=>P.fileStats(legacy),e=>e.code==='integrity_failed');
  }
  t.diagnostic(JSON.stringify({realFiles:20,numberStatRoundedInodes:rounded}));
  const bytes=Buffer.from('exact durable proof'),u=await f.createUpload(bytes),j=f.service.store._load(u.clientJobId);
  assert.deepEqual(j.blobProof,P.identity(O.lstatSync(f.service.store._blob(j))));assert.deepEqual(j.directory.proof,O.directory(f.dirs.files));
  const wrong={...j.blobProof,ino:(BigInt(j.blobProof.ino)+1n).toString()};
  await assert.rejects(()=>f.service.store._openExact(f.service.store._blob(j),wrong),e=>e.code==='source_changed');
  assert.equal(fs.existsSync(f.service.store._blob(j)),true);
});

test('distinct 64-bit IDs that alias as Number and one-nanosecond changes remain unequal',()=>{
  const synthetic={dev:1n,ino:9007199254740992n,size:1n,nlink:1n,mtimeNs:1700000000000000000n,ctimeNs:1700000000000000000n,isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false};
  const other={...synthetic,ino:synthetic.ino+1n};assert.equal(Number(synthetic.ino),Number(other.ino));
  assert.equal(P.same(P.identity(P.fileStats(synthetic)),P.identity(P.fileStats(other))),false);
  assert.equal(P.sameInfo(P.info(P.fileStats(synthetic)),P.info(P.fileStats({...synthetic,mtimeNs:synthetic.mtimeNs+1n}))),false);
  assert.equal(P.sameInfo(P.info(P.fileStats(synthetic)),P.info(P.fileStats({...synthetic,ctimeNs:synthetic.ctimeNs+1n}))),false);
  assert.throws(()=>P.fileStats({...synthetic,size:9007199254740992n}),e=>e.code==='integrity_failed');
  assert.throws(()=>P.identity({dev:1,ino:Number(synthetic.ino)}),e=>e.code==='integrity_failed');
});

test('publication reconciliation rejects a named target replaced while its old inode is hashed',async t=>{
  const f=await fixture(t),O=require('../../../src/transfer-helper/ownership.cjs'),bytes=Buffer.from('original bytes'),u=await f.createUpload(bytes);await f.patch(u,bytes);
  const j=f.service.store._load(u.clientJobId),target=path.join(f.dirs.files,'new.bin');j.state='publishing';j.published=null;f.service.store._save(j);fs.linkSync(f.service.store._blob(j),target);
  const digest=O.digest;let replaced=false;O.digest=async(...args)=>{const result=await digest(...args);if(!replaced){replaced=true;fs.renameSync(target,path.join(f.dirs.files,'retained-original'));fs.writeFileSync(target,'external bytes');}return result;};
  try{const result=await f.service.store.job(u.clientJobId);assert.equal(result.published,null);assert.equal(result.state,'publishing');assert.equal(result.code,'recovery_required');assert.equal(fs.readFileSync(target,'utf8'),'external bytes');assert.deepEqual(fs.readFileSync(path.join(f.dirs.files,'retained-original')),bytes);}finally{O.digest=digest;}
});
