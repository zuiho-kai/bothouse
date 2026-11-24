'use strict';
// Original durable helper store. Paths are server configuration/owned records, never wire paths.
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {Readable,Transform}=require('node:stream');
const {pipeline,finished}=require('node:stream/promises');
const P=require('./policy.cjs'),O=require('./ownership.cjs');
const TERMINAL=new Set(['failed','expired','discarded']);
const emptyHash=P.hash(Buffer.alloc(0));
class TransferStore {
  static async open(config,options={}) {const store=new TransferStore(config,options);try{await store._open();return store;}catch(e){try{await store.close();}catch{}throw e;}}
  constructor(config,{now=Date.now,hook=async()=>{},yazl}={}) {
    this.config=P.config(config);this.now=now;this.hook=hook;this.yazl=yazl;this.roots=new Map();
    this.handles=new Map();this.fds=new Set();this.busy=new Set();this.pending=new Set();this.closed=false;this.closing=null;
  }
  async _open() {
    this.stateProof=O.directory(this.config.stateDir);this.owner=await O.lock(this.config.stateDir);
    this.snapshotDir=path.join(this.config.stateDir,'snapshots');
    try{fs.mkdirSync(this.snapshotDir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
    this.snapshotProof=O.directory(this.snapshotDir);
    for(const root of this.config.roots){
      const r={...root,proof:O.directory(root.path),stagingProof:root.upload?O.directory(root.stagingDir):null};
      if(r.upload&&r.proof.dev!==r.stagingProof.dev)P.fail('unsupported');
      r.authority=P.hash(JSON.stringify({rootId:r.rootId,path:r.path,proof:r.proof,read:r.read,upload:r.upload,stagingDir:r.stagingDir,stagingProof:r.stagingProof}));
      this.roots.set(r.rootId,r);
    }
    this.dbPath=path.join(this.config.stateDir,'jobs.sqlite');
    if(fs.existsSync(this.dbPath)){const s=O.lstatSync(this.dbPath);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)P.fail('recovery_required');}
    this.db=new DatabaseSync(this.dbPath);this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,resource TEXT UNIQUE NOT NULL,record TEXT NOT NULL);');
    this.dbProof=P.identity(O.lstatSync(this.dbPath));
    const meta=this.db.prepare('SELECT value FROM meta WHERE key=?').get('instance');
    if(meta&&meta.value!==this.config.instanceId)P.fail('instance_mismatch');
    if(!meta)this.db.prepare('INSERT INTO meta VALUES (?,?)').run('instance',this.config.instanceId);
    if(this.db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n>P.LIMITS.maxRecords)P.fail('recovery_required');
    for(const row of this.db.prepare('SELECT record FROM jobs').all()) {
      const j=this._parse(row.record);
      try{await this._recover(j);}catch(e){j.state='recovery_required';j.code=P.CODES.has(e.code)?e.code:'recovery_required';j.published=j.kind==='download'?false:j.published===true?true:null;this._save(j);}
    }
    await this.cleanup();
  }
  async _openExact(filename,proof,flags='r') {
    const fd=await fs.promises.open(filename,flags);this.fds.add(fd);
    try{const s=await O.stat(fd),l=await O.lstat(filename);if(!s.isFile()||l.isSymbolicLink()||!P.same(P.identity(s),P.identity(l))||proof&&!P.same(proof,P.identity(s)))P.fail('source_changed');return fd;}
    catch(e){await this._closeFile(fd);throw e;}
  }
  async _createFile(filename){const fd=await fs.promises.open(filename,'wx+',0o600);this.fds.add(fd);return fd;}
  async _closeFile(fd){try{await fd.close();}catch(e){if(fd.fd!==-1)throw new P.TransferError('cleanup_unconfirmed',500);}if(fd.fd!==-1)P.fail('cleanup_unconfirmed',500);this.fds.delete(fd);}
  _assert() {if(this.closed)P.fail('closed');this.owner.assert();O.checkDirectory(this.config.stateDir,this.stateProof);if(!P.same(this.dbProof,P.identity(O.lstatSync(this.dbPath))))P.fail('recovery_required');}
  _parse(raw){if(typeof raw!=='string'||Buffer.byteLength(raw)>65536)P.fail('recovery_required');let j;try{j=JSON.parse(raw);P.record(j);}catch{P.fail('recovery_required');}return j;}
  _save(j){this._assert();P.record(j);const raw=JSON.stringify(j);if(Buffer.byteLength(raw)>65536)P.fail('limit');this.db.prepare('INSERT INTO jobs(id,resource,record) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(j.clientJobId,j.resourceId,raw);}
  _load(id){this._assert();if(!P.uuid(id))P.fail('invalid_request');const row=this.db.prepare('SELECT record FROM jobs WHERE id=?').get(id);if(!row)P.fail('not_found',404);return this._parse(row.record);}
  _resource(id,kind){this._assert();if(!P.uuid(id))P.fail('invalid_request');const row=this.db.prepare('SELECT record FROM jobs WHERE resource=?').get(id);if(!row)P.fail('not_found',404);const j=this._parse(row.record);if(j.kind!==kind)P.fail('not_found',404);return j;}
  _root(id,permission){const r=this.roots.get(id);if(!r||permission&&!r[permission])P.fail('unauthorized',403);O.checkDirectory(r.path,r.proof);if(r.upload)O.checkDirectory(r.stagingDir,r.stagingProof);return r;}
  _jobRoot(j){const r=this._root(j.rootId);if(j.authority!==r.authority)P.fail('scope_changed');return r;}
  _blob(j){const r=this._jobRoot(j);if(j.kind==='upload')return path.join(r.stagingDir,j.resourceId+'.part');O.checkDirectory(this.snapshotDir,this.snapshotProof);return path.join(this.snapshotDir,j.resourceId+'.snapshot');}
  _live(j){if(this.now()>=j.expiresAt||j.state==='expired')P.fail('expired',410);if(TERMINAL.has(j.state))P.fail('not_found',410);if(j.state==='recovery_required')P.fail('recovery_required',409);}
  _target(j){const r=this._jobRoot(j);if(!j.directory||typeof j.directory.relative!=='string'||j.directory.relative.split('/').some(x=>x==='..'||x==='.')||path.isAbsolute(j.directory.relative))P.fail('recovery_required');const parent=path.join(r.path,...j.directory.relative.split('/').filter(Boolean));if(!P.inside(r.path,parent))P.fail('scope_changed');O.checkDirectory(parent,j.directory.proof);return path.join(parent,P.name(j.name));}
  public(j){return {clientJobId:j.clientJobId,kind:j.kind,state:j.state,createdAt:new Date(j.createdAt).toISOString(),expiresAt:new Date(j.expiresAt).toISOString(),rootId:j.rootId,name:j.name,length:j.length,sha256:j.sha256,offset:j.offset,uploadId:j.kind==='upload'?j.resourceId:null,snapshotId:j.kind==='download'?j.resourceId:null,etag:j.kind==='download'&&j.sha256?'"sha256-'+j.sha256+'"':null,archive:j.archive,sourceAtomic:false,published:j.published,cleanupVerified:j.cleanupVerified,code:j.code};}
  async exclusive(id,fn){if(this.busy.has(id))P.fail('busy',409);this.busy.add(id);const promise=Promise.resolve().then(fn);this.pending.add(promise);try{return await promise;}finally{this.pending.delete(promise);this.busy.delete(id);}}
  _capacity(size){const rows=this.db.prepare('SELECT record FROM jobs').all().map(r=>this._parse(r.record));if(rows.length>=P.LIMITS.maxRecords)P.fail('limit');if(rows.filter(j=>!j.cleanupVerified).length>=P.LIMITS.maxActiveJobs)P.fail('quota',507);const reserved=rows.reduce((n,j)=>n+(j.cleanupVerified?0:j.reserved),0);if(reserved+size>P.LIMITS.quotaBytes)P.fail('quota',507);}
  _new(id,kind,rootId,name,length,sha256,archive,reserved){if(!P.uuid(id))P.fail('invalid_request');if(this.db.prepare('SELECT 1 FROM jobs WHERE id=?').get(id))P.fail('job_exists',409);this._capacity(reserved);const r=this._root(rootId,kind==='upload'?'upload':'read');return {clientJobId:id,resourceId:randomUUID(),kind,rootId,name,length,sha256,archive,reserved,offset:0,prefixSha:emptyHash,createdAt:this.now(),expiresAt:this.now()+P.LIMITS.jobTtlMs,authority:r.authority,state:kind==='upload'?'allocating':'preparing',published:false,cleanupVerified:false,code:null,blobProof:null};}
  rootsList(){this._assert();return [...this.roots.values()].map(r=>({rootId:r.rootId,label:r.label,read:r.read,upload:r.upload}));}
  _handle(r,filename,parentId=null){for(const [id,h]of this.handles)if(this.now()>=h.expiresAt)this.handles.delete(id);if(this.handles.size>=8192)P.fail('limit');const s=O.lstatSync(filename);if(s.isSymbolicLink()||!s.isFile()&&!s.isDirectory())P.fail('unsupported');const id=randomUUID();this.handles.set(id,{rootId:r.rootId,path:filename,proof:P.info(s),parentProof:O.directory(path.dirname(filename)),kind:s.isDirectory()?'directory':'file',expiresAt:this.now()+P.LIMITS.handleTtlMs,parentId});return id;}
  _selection(rootId,id,kind){const r=this._root(rootId);const h=this.handles.get(id);if(!h||h.rootId!==rootId||this.now()>=h.expiresAt||kind&&h.kind!==kind)P.fail('scope_changed');O.checkDirectory(path.dirname(h.path),h.parentProof);const s=O.lstatSync(h.path);if(s.isSymbolicLink()||!P.sameInfo(h.proof,P.info(s)))P.fail('source_changed');return {r,h};}
  list(input){P.keys(input,['rootId','directoryId']);const r=this._root(input.rootId);if(input.directoryId!==null&&!P.uuid(input.directoryId))P.fail('invalid_request');let id=input.directoryId;if(id===null)id=this._handle(r,r.path);const {h}=this._selection(r.rootId,id,'directory');const entries=[];
    for(const n of O.names(h.path)){P.name(n);const filename=path.join(h.path,n),s=O.lstatSync(filename);if(s.isSymbolicLink()||!s.isFile()&&!s.isDirectory())P.fail('unsupported');const entryId=this._handle(r,filename,id);entries.push({entryId,name:n,kind:s.isDirectory()?'directory':'file',size:s.isFile()?s.size:null});}
    if(!P.sameInfo(h.proof,P.info(O.lstatSync(h.path))))P.fail('source_changed');
    return {directory:{directoryId:id,rootId:r.rootId,name:h.path===r.path?r.label:path.basename(h.path),parentId:h.parentId},entries};
  }
  async createUpload({id,metadata,length}) {
    P.keys(metadata,['clientJobId','rootId','directoryId','name','sha256']);
    if(!P.uuid(id)||!P.uuid(metadata.directoryId)||!P.sha(metadata.sha256)||!Number.isSafeInteger(length)||length<0||length>P.LIMITS.uploadMaxBytes)P.fail('invalid_request');P.name(metadata.name);
    const {r,h}=this._selection(metadata.rootId,metadata.directoryId,'directory');if(!r.upload)P.fail('unauthorized',403);
    await this.cleanup();const j=this._new(metadata.clientJobId,'upload',r.rootId,metadata.name,length,metadata.sha256,false,length);j.resourceId=id;
    j.directory={relative:path.relative(r.path,h.path).split(path.sep).join('/'),proof:P.identity(O.lstatSync(h.path))};j.metadata={...metadata};
    const target=this._target(j);if(fs.existsSync(target))P.fail('target_exists',409);this._save(j);await this.hook('upload-intent',j);
    let fd;try{fd=await this._createFile(this._blob(j));j.blobProof=P.identity(await O.stat(fd));await fd.sync();j.state=length===0?'uploaded':'receiving';this._save(j);await this.hook('upload-created',j);return this.public(j);}
    catch(e){j.state='recovery_required';j.code='storage_failed';this._save(j);throw e;}finally{if(fd)await this._closeFile(fd);}
  }
  async uploadInfo(id){const j=this._resource(id,'upload');this._live(j);if(!['receiving','uploaded'].includes(j.state))P.fail('already_finalized',409);await this._verifyPrefix(j);return j;}
  async _verifyPrefix(j){const fd=await this._openExact(this._blob(j),j.blobProof,'r+');try{const s=await O.stat(fd);if(s.size<j.offset||s.nlink!==1)P.fail('integrity_failed');if(await O.digest(fd,j.offset)!==j.prefixSha)P.fail('integrity_failed');if(s.size>j.offset){await fd.truncate(j.offset);await fd.sync();}return true;}finally{await this._closeFile(fd);}}
  async writeUpload(id,stream,offset){const j=await this.uploadInfo(id);if(j.offset!==offset)P.fail('offset_conflict',409);if(j.state!=='receiving'&&j.length!==0)P.fail('not_complete');
    const fd=await this._openExact(this._blob(j),j.blobProof,'r+');let written=0,error;
    try{try{for await(const chunk of stream){this._assert();this._live(j);const b=Buffer.from(chunk);if(written+b.length>P.LIMITS.chunkMaxBytes||offset+written+b.length>j.length)P.fail('limit');let n=0;while(n<b.length){const w=await fd.write(b,n,b.length-n,offset+written+n);if(!w.bytesWritten)P.fail('storage_failed');n+=w.bytesWritten;}written+=b.length;await this.hook('upload-bytes',j);}}catch(e){error=e;}
      // Even an interrupted chunk may commit an exact contiguous prefix; never acknowledge an unflushed tail.
      await fd.sync();await this.hook('upload-flushed',j);const digest=await O.digest(fd,offset+written);j.offset=offset+written;j.prefixSha=digest;j.state=j.offset===j.length?'uploaded':'receiving';this._save(j);await this.hook('upload-offset',j);if(error)throw error;return j.offset;
    }finally{await this._closeFile(fd);}
  }
  async finalize(id,clientJobId){const j=this._resource(id,'upload');if(j.clientJobId!==clientJobId)P.fail('invalid_request');this._live(j);
    if(['published','publishing'].includes(j.state))P.fail('already_finalized',409);if(j.state!=='uploaded'||j.offset!==j.length)P.fail('not_complete',409);
    await this._verifyPrefix(j);const fd=await this._openExact(this._blob(j),j.blobProof);try{if(await O.digest(fd,j.length)!==j.sha256)P.fail('integrity_failed');}finally{await this._closeFile(fd);}
    const target=this._target(j);if(fs.existsSync(target))P.fail('target_exists',409);j.state='publishing';j.published=null;this._save(j);await this.hook('publish-intent',j);
    try{this._live(j);this._target(j);const s=O.lstatSync(this._blob(j));if(!P.same(j.blobProof,P.identity(s))||s.nlink!==1)P.fail('source_changed');
      await fs.promises.link(this._blob(j),target);await this.hook('publish-linked',j);await this._reconcile(j);await this.hook('publish-recorded',j);return this.public(j);
    }catch(e){j.code=P.CODES.has(e.code)?e.code:e.code==='EEXIST'?'target_exists':'recovery_required';this._save(j);throw e;}
  }
  async _reconcile(j){if(j.kind!=='upload'||j.state!=='publishing')return j;let target;try{target=this._target(j);}catch{j.code='scope_changed';this._save(j);return j;}
    let s;try{s=O.lstatSync(target);}catch(e){if(e.code==='ENOENT'){j.code='recovery_required';this._save(j);return j;}throw e;}
    if(s.isSymbolicLink()||!s.isFile()||!P.same(j.blobProof,P.identity(s))||s.size!==j.length){j.code='recovery_required';this._save(j);return j;}
    const before=P.info(s),fd=await this._openExact(target,j.blobProof);try{if(await O.digest(fd,j.length)!==j.sha256){j.code='integrity_failed';this._save(j);return j;}}finally{await this._closeFile(fd);}
    // Hashing and close both yield; an old open file must not prove a replacement path.
    try{this._target(j);const after=O.lstatSync(target);if(after.isSymbolicLink()||!after.isFile()||!P.sameInfo(before,P.info(after)))P.fail('source_changed');}catch{j.code='recovery_required';this._save(j);return j;}
    j.state='published';j.published=true;j.code=null;this._save(j);return j;
  }
  async job(id){const j=this._load(id);await this._reconcile(j);return this.public(j);}
  async _recover(j){this._jobRoot(j);if(j.state==='publishing'){await this._reconcile(j);return;}if(j.cleanupVerified)return;
    if(j.kind==='upload'&&['receiving','uploaded'].includes(j.state)){await this._verifyPrefix(j);return;}
    if(j.kind==='download'&&j.state==='ready'){const fd=await this._openExact(this._blob(j),j.blobProof);try{if((await O.stat(fd)).size!==j.length||await O.digest(fd,j.length)!==j.sha256)P.fail('integrity_failed');}finally{await this._closeFile(fd);}return;}
    if(['preparing','allocating'].includes(j.state)){j.state='recovery_required';j.code='recovery_required';this._save(j);}
  }
  async _deleteBlob(j){if(j.cleanupVerified)return;if(!j.blobProof)P.fail('cleanup_unconfirmed');const filename=this._blob(j);const fd=await this._openExact(filename,j.blobProof);try{const s=await O.stat(fd);if(j.kind==='upload'&&j.published===true){if(s.nlink<2)P.fail('cleanup_unconfirmed');}else if(s.nlink!==1)P.fail('cleanup_unconfirmed');const expected=j.kind==='upload'?j.prefixSha:j.sha256;if(expected&&await O.digest(fd,j.kind==='upload'?j.offset:j.length)!==expected)P.fail('integrity_failed');}finally{await this._closeFile(fd);}
    const s=O.lstatSync(filename);if(!P.same(j.blobProof,P.identity(s)))P.fail('cleanup_unconfirmed');await fs.promises.unlink(filename);j.cleanupVerified=true;this._save(j);
  }
  async discard(id,kind){const j=this._resource(id,kind);if(j.published!==false||j.state==='publishing')P.fail('already_finalized',409);await this._deleteBlob(j);j.state='discarded';j.code=null;this._save(j);return this.public(j);}
  async cleanup(){this._assert();for(const row of this.db.prepare('SELECT record FROM jobs').all()){const observed=this._parse(row.record);if(this.busy.has(observed.clientJobId))continue;
    await this.exclusive(observed.clientJobId,async()=>{const j=this._load(observed.clientJobId);
      if(j.expiresAt<=this.now()&&!j.cleanupVerified&&j.state!=='publishing'&&j.state!=='recovery_required'){
        try{await this._deleteBlob(j);if(j.state!=='published')j.state='expired';j.code=null;this._save(j);}catch{j.code='cleanup_unconfirmed';this._save(j);}
      }
      if(j.cleanupVerified&&j.expiresAt+7*86400000<this.now())this.db.prepare('DELETE FROM jobs WHERE id=?').run(j.clientJobId);
    });
  }}
  async snapshot(input){P.keys(input,['clientJobId','rootId','entryIds']);if(!Array.isArray(input.entryIds)||!input.entryIds.length||input.entryIds.length>P.LIMITS.selectionMax||new Set(input.entryIds).size!==input.entryIds.length||input.entryIds.some(x=>!P.uuid(x)))P.fail('invalid_request');
    const selected=input.entryIds.map(id=>this._selection(input.rootId,id).h),r=this._root(input.rootId,'read');
    for(let i=0;i<selected.length;i++)for(let n=0;n<i;n++)if(P.inside(selected[i].path,selected[n].path)||P.inside(selected[n].path,selected[i].path))P.fail('invalid_request');
    const archive=selected.length!==1||selected[0].kind==='directory';const rows=[],seen=new Set();let bytes=0;
    const walk=(filename,rel,depth)=>{if(depth>P.LIMITS.treeMaxDepth||rows.length>=P.LIMITS.treeMaxEntries)P.fail('limit');const st=O.lstatSync(filename);if(st.isSymbolicLink()||!st.isFile()&&!st.isDirectory())P.fail('unsupported');for(const part of rel.split('/'))P.name(part);if(seen.has(rel.toLowerCase()))P.fail('unsupported');seen.add(rel.toLowerCase());const row={filename,relative:rel,kind:st.isDirectory()?'directory':'file',proof:P.info(st),parentProof:O.directory(path.dirname(filename))};rows.push(row);if(st.isFile()){bytes+=st.size;if(bytes>P.LIMITS.downloadMaxBytes)P.fail('limit');}else{for(const n of O.names(filename))walk(path.join(filename,n),rel+'/'+n,depth+1);}};
    for(const h of selected)walk(h.path,path.basename(h.path),0);
    const name=archive?(selected.length===1?path.basename(selected[0].path):'selection')+'.zip':path.basename(selected[0].path);
    await this.cleanup();const j=this._new(input.clientJobId,'download',r.rootId,name,null,null,archive,archive?P.LIMITS.downloadMaxBytes:bytes);this._save(j);await this.hook('snapshot-intent',j);let fd;const inputs=new Set(),settlements=[];
    try{fd=await this._createFile(this._blob(j));j.blobProof=P.identity(await O.stat(fd));this._save(j);
      const hash=createHash('sha256');let count=0;const output=new Transform({transform(chunk,_enc,cb){count+=chunk.length;if(count>P.LIMITS.downloadMaxBytes)return cb(new P.TransferError('limit'));hash.update(chunk);cb(null,chunk);}});
      const sink=fs.createWriteStream(this._blob(j),{fd:fd.fd,autoClose:false});let source;
      const owner=this;const streamFor=async row=>{
        const input=Readable.from((async function*(){let inputFd;try{
          O.checkDirectory(path.dirname(row.filename),row.parentProof);
          inputFd=await owner._openExact(row.filename,row.proof);const st=await O.stat(inputFd);if(!P.sameInfo(row.proof,P.info(st)))P.fail('source_changed');
          const b=Buffer.allocUnsafe(262144);let pos=0;while(pos<st.size){const {bytesRead}=await inputFd.read(b,0,Math.min(b.length,st.size-pos),pos);if(!bytesRead)P.fail('source_changed');pos+=bytesRead;yield Buffer.from(b.subarray(0,bytesRead));}
          if(!P.sameInfo(row.proof,P.info(await O.stat(inputFd))))P.fail('source_changed');
        }finally{if(inputFd)await owner._closeFile(inputFd);}})());
        inputs.add(input);settlements.push(finished(input).catch(()=>{}));input.once('close',()=>inputs.delete(input));return {stream:input};
      };
      if(archive){if(!this.yazl)P.fail('unsupported');const zip=new this.yazl.ZipFile();zip.on('error',e=>zip.outputStream.destroy(e));
        for(const row of rows){const opts={mtime:new Date(0),mode:row.kind==='directory'?0o40755:0o100644,compress:false,size:row.proof.size};if(row.kind==='directory')zip.addEmptyDirectory(row.relative,{mtime:opts.mtime,mode:opts.mode});else zip.addReadStreamLazy(row.relative,opts,cb=>{streamFor(row).then(x=>cb(null,x.stream),cb);});}zip.end();source=zip.outputStream;
      }else source=(await streamFor(rows[0])).stream;
      await pipeline(source,output,sink);await fd.sync();await this.hook('snapshot-flushed',j);
      for(const row of rows){const s=O.lstatSync(row.filename);if(s.isSymbolicLink()||!P.sameInfo(row.proof,P.info(s)))P.fail('source_changed');}
      this._jobRoot(j);if((await O.stat(fd)).size!==count)P.fail('integrity_failed');j.length=count;j.sha256=hash.digest('hex');if(await O.digest(fd,count)!==j.sha256)P.fail('integrity_failed');j.offset=count;j.reserved=count;j.state='ready';this._save(j);return this.public(j);
    }catch(e){j.state='failed';j.code=P.CODES.has(e.code)?e.code:'storage_failed';if(fd&&j.blobProof){try{const s=await O.stat(fd);if(s.size<=P.LIMITS.downloadMaxBytes){j.length=s.size;j.offset=s.size;j.sha256=await O.digest(fd,s.size);await fd.sync();}}catch{j.state='recovery_required';j.code='recovery_required';}}this._save(j);throw e;}finally{for(const input of inputs)input.destroy();await Promise.allSettled(settlements);if(fd)await this._closeFile(fd);}
  }
  async snapshotFile(id){const j=this._resource(id,'download');this._live(j);if(j.state!=='ready')P.fail('not_complete');const fd=await this._openExact(this._blob(j),j.blobProof);try{const s=await O.stat(fd);if(s.size!==j.length||s.nlink!==1||await O.digest(fd,j.length)!==j.sha256)P.fail('integrity_failed');return {job:j,fd};}catch(e){await this._closeFile(fd);throw e;}}
  async close(){if(this.closed)return {closed:true};if(this.closing)return this.closing;this.closing=(async()=>{await Promise.allSettled([...this.pending]);for(const fd of [...this.fds])await this._closeFile(fd);if(this.db){this.db.close();this.db=null;}if(this.owner)await this.owner.close();this.closed=true;return {closed:true};})();try{return await this.closing;}finally{this.closing=null;}}
}
module.exports={TransferStore};
