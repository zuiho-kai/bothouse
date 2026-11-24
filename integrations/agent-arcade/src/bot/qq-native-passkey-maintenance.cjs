'use strict';

// Original draft. No upstream code is copied. This is an offline maintenance
// component, not a route supplied by NapCat or a WebUI file-editor shortcut.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const VERSION = '4.18.42';
const DIR = '.agent-arcade-passkey-maintenance';
const MAX_BYTES = 1024 * 1024, MAX_ROWS = 256, MAX_HISTORY = 64, TTL = 60000;
const hash = v => createHash('sha256').update(v).digest('hex');
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function keys(v, required, optional = []) { if (!plain(v) || required.some(k => !Object.hasOwn(v,k)) || Object.keys(v).some(k => !required.includes(k) && !optional.includes(k))) fail('invalid_request'); }
function canonical(value, max) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) fail('unsupported_store'); const b=Buffer.from(value,'base64url'); if (!b.length || b.length>max || b.toString('base64url')!==value) fail('unsupported_store'); }
function parse(bytes) {
  if (bytes.length > MAX_BYTES || !Buffer.from(bytes.toString('utf8')).equals(bytes)) fail('unsupported_store');
  let value; try { value = JSON.parse(bytes); } catch { fail('unsupported_store'); }
  if (!plain(value) || Object.keys(value).some(k=>k!=='napcat-user')) fail('unsupported_store');
  const rows = value['napcat-user'] ?? [];
  if (!Array.isArray(rows) || rows.length>MAX_ROWS) fail('unsupported_store');
  const ids=new Set();
  for (const row of rows) {
    try { keys(row,['id','publicKey','counter'],['transports']); } catch { fail('unsupported_store'); }
    canonical(row.id,1024); canonical(row.publicKey,2048);
    if (!Number.isSafeInteger(row.counter) || row.counter<0 || row.counter>4294967295 || ids.has(row.id)) fail('unsupported_store');
    ids.add(row.id);
    if (row.transports!==undefined && (!Array.isArray(row.transports) || row.transports.length>8 || new Set(row.transports).size!==row.transports.length || row.transports.some(t=>!['usb','nfc','ble','internal','hybrid','smart-card','cable'].includes(t)))) fail('unsupported_store');
  }
  return { value, rows };
}
const identity = st => ({dev:String(st.dev),ino:String(st.ino),size:String(st.size),mtime:String(st.mtimeNs),ctime:String(st.ctimeNs),birth:String(st.birthtimeNs),links:String(st.nlink)});
const node = st => ({dev:String(st.dev),ino:String(st.ino)});
function safe(file, directory=false, max=MAX_BYTES) {
  if (!path.isAbsolute(file) || /^[/\\]{2}/.test(file) || path.resolve(file)!==file || /[\0\r\n]/.test(file)) fail('unsafe_store');
  let cursor=file, target;
  for (;;) {
    const st=fs.lstatSync(cursor,{bigint:true});
    if (st.isSymbolicLink() || (cursor===file ? directory ? !st.isDirectory() : !st.isFile() || st.nlink!==1n || st.size>BigInt(max) : !st.isDirectory())) fail('unsafe_store');
    if (cursor===file) target=st;
    const parent=path.dirname(cursor); if (parent===cursor) break; cursor=parent;
  }
  if (fs.realpathSync(file).toLowerCase()!==file.toLowerCase()) fail('unsafe_store');
  return target;
}
function exists(file) { try { fs.lstatSync(file); return true; } catch(e) { if(e.code==='ENOENT') return false; throw e; } }
function read(file,max=MAX_BYTES) {
  const before=safe(file,false,max), fd=fs.openSync(file,'r');
  try {
    if (!same(identity(before),identity(fs.fstatSync(fd,{bigint:true})))) fail('store_changed');
    const bytes=Buffer.alloc(Number(before.size)); let offset=0;
    while (offset<bytes.length) { const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset); if(!n) fail('store_changed'); offset+=n; }
    if (!same(identity(before),identity(fs.fstatSync(fd,{bigint:true}))) || !same(identity(before),identity(safe(file,false,max)))) fail('store_changed');
    return {bytes,identity:identity(before),sha256:hash(bytes)};
  } finally { fs.closeSync(fd); }
}
function writeNew(file,bytes) {
  const fd=fs.openSync(file,'wx',0o600); let observed;
  try { fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); observed=identity(fs.fstatSync(fd,{bigint:true})); } finally { fs.closeSync(fd); }
  const saved=read(file); if (!same(saved.identity,observed)||saved.sha256!==hash(bytes)) fail('store_changed'); return saved;
}
function ready(configDir) { if (exists(path.join(configDir,DIR,'pending.json'))) fail('passkey_maintenance_required'); }

class OfflineNativePasskeys {
  constructor({selection,origin,enabled=false,recoveryRouteDeclared=false,now=Date.now,monotonic=()=>performance.now(),hook=()=>{}}={}) {
    if (typeof selection?.withPendingUpdateRecovery!=='function' || typeof selection?.pendingUpdateRecoveryContext!=='function') fail('invalid_request');
    const url=new URL(origin); if (url.protocol!=='https:' || url.origin!==origin || url.username || url.password || !url.hostname || require('node:net').isIP(url.hostname.startsWith('[')?url.hostname.slice(1,-1):url.hostname)) fail('invalid_request');
    Object.assign(this,{selection,origin,enabled,recoveryRouteDeclared,now,monotonic,hook,inspection:null,ticket:null,recoveryTicket:null,busy:false,closed:false,epoch:0});
  }
  capability() { return {supported:true,enabled:this.enabled===true,version:VERSION,mode:'offline-native-store',scope:'shared-webui-store',requiresStoppedInstallation:true,automaticStop:false,automaticStart:false}; }
  _check(options={}) { if(this.closed) fail('closed'); if(!this.enabled) fail('maintenance_disabled'); if(options.signal?.aborted) fail('cancelled'); const r=options.assertCurrent?.(); if(r?.then) fail('invalid_request'); }
  _context() {
    const c=this.selection.pendingUpdateRecoveryContext();
    if(c.component!=='napcat-shell'||c.version!==VERSION||!hex(c.installationId)||!hex(c.selectionDigest)||!Array.isArray(c.configDirs)||c.configDirs.length!==1) fail('unsupported_installation');
    safe(c.configDirs[0],true); return {...c,origin:this.origin};
  }
  async _gate(fn,options={}) {
    this._check(options); if(this.busy) fail('busy'); this.busy=true;const epoch=this.epoch;
    try { return await this.selection.withPendingUpdateRecovery(async gate=>{
      const context=this._context(), fingerprint=JSON.stringify(context), parent=node(safe(context.configDirs[0],true));
      const check=()=>{this._check(options);if(this.epoch!==epoch)fail('changed');gate.assertOwned();if(JSON.stringify(this._context())!==fingerprint||!same(node(safe(context.configDirs[0],true)),parent))fail('store_changed');};
      check();await gate.assertStopped();check();await gate.verify(options.signal);check();await gate.assertStopped();check();
      return fn({context,check,assertStopped:async()=>{check();await gate.assertStopped();check();}});
    }); } finally { this.busy=false; }
  }
  _paths(context) { const config=context.configDirs[0],root=path.join(config,DIR);return {config,root,file:path.join(config,'passkey.json'),pending:path.join(root,'pending.json')}; }
  _snapshot(context) {
    const p=this._paths(context);ready(p.config);
    if(!exists(p.file))return {paths:p,bytes:null,identity:null,sha256:null,rows:[],value:null,digest:hash(JSON.stringify({context,missing:true}))};
    const f=read(p.file),parsed=parse(f.bytes);return {paths:p,...f,...parsed,digest:hash(JSON.stringify({context,identity:f.identity,sha256:f.sha256}))};
  }
  _rows(s) { return s.rows.map((row,index)=>({credentialHandle:hash(s.digest+'\0'+row.id),fingerprint:hash(row.id).slice(0,20),position:index+1,transports:row.transports??[],currentDeviceKnown:false,label:null})); }
  async list(options={}) { return this._gate(async({context,check})=>{
    const s=this._snapshot(context);check();const id=randomUUID();this.inspection={id,digest:s.digest,deadline:this.monotonic()+TTL};this.ticket=null;
    return {observationId:id,expiresAt:this.now()+TTL,origin:this.origin,scope:'shared-webui-store',version:VERSION,state:s.bytes===null?'missing':'read',credentials:this._rows(s),canRevoke:s.rows.length>0,recoveryRouteDeclared:this.recoveryRouteDeclared===true,currentCredentialKnown:false};
  },options); }
  async preview(input,options={}) {
    keys(input,['observationId','credentialHandle']);if(!uuid(input.observationId)||!hex(input.credentialHandle))fail('invalid_request');this.ticket=null;
    return this._gate(async({context,check})=>{const seen=this.inspection;if(!seen||seen.id!==input.observationId||this.monotonic()>=seen.deadline)fail('observation_expired');const s=this._snapshot(context);if(s.digest!==seen.digest)fail('store_changed');const i=this._rows(s).findIndex(r=>r.credentialHandle===input.credentialHandle);if(i<0)fail('credential_missing');if(s.rows.length===1&&!this.recoveryRouteDeclared)fail('last_credential_recovery_required');check();
      const id=randomUUID(),digest=hash(JSON.stringify({id,origin:this.origin,store:s.digest,handle:input.credentialHandle}));this.ticket={id,digest,store:s.digest,handle:input.credentialHandle,index:i,deadline:this.monotonic()+TTL};
      return {ticketId:id,expectedDigest:digest,credentialHandle:input.credentialHandle,fingerprint:this._rows(s)[i].fingerprint,expiresAt:this.now()+TTL,origin:this.origin,effects:{sharedWebUIStore:true,removesLastCredential:s.rows.length===1,recoveryRouteDeclared:this.recoveryRouteDeclared===true,recoveryRouteVerified:false,automaticStart:false,automaticStop:false,localAuthenticatorRemoved:false,issuedWebUISessionsRevoked:false}};
    },options);
  }
  async confirm(input,options={}) {
    keys(input,['ticketId','expectedDigest','operationId']);if(!uuid(input.ticketId)||!hex(input.expectedDigest)||!uuid(input.operationId))fail('invalid_request');
    const t=this.ticket;this.ticket=null;if(!t||t.id!==input.ticketId||t.digest!==input.expectedDigest)fail('stale_ticket');
    return this._gate(async gate=>{
      if(this.monotonic()>=t.deadline)fail('preview_expired');const s=this._snapshot(gate.context);if(s.digest!==t.store||this._rows(s)[t.index]?.credentialHandle!==t.handle)fail('store_changed');
      const value=structuredClone(s.value);value['napcat-user'].splice(t.index,1);if(!value['napcat-user'].length)delete value['napcat-user'];
      const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');parse(bytes);const p=s.paths;let journalStarted=false,renamed=false;
      const result={operationId:input.operationId,credentialHandle:t.handle,origin:this.origin,scope:'shared-webui-store',outcome:'not_submitted',persistentReadback:false,automaticStart:false,automaticStop:false,localAuthenticatorRemoved:false,issuedWebUISessionsRevoked:false};
      try {
        gate.check();if(!exists(p.root))fs.mkdirSync(p.root,{mode:0o700});safe(p.root,true);const names=fs.readdirSync(p.root);if(names.some(n=>!uuid(n))||names.length>=MAX_HISTORY)fail('history_full');
        const op=path.join(p.root,input.operationId);fs.mkdirSync(op,{mode:0o700});const opNode=node(safe(op,true));
        const original=writeNew(path.join(op,'original.json'),s.bytes),replacement=writeNew(path.join(op,'replacement.json'),bytes);
        const intent={schema:1,operationId:input.operationId,origin:this.origin,installationId:gate.context.installationId,selectionDigest:gate.context.selectionDigest,credentialHandle:t.handle,configNode:node(safe(p.config,true)),rootNode:node(safe(p.root,true)),operationNode:opNode,before:{sha256:s.sha256,identity:s.identity},after:{sha256:replacement.sha256,node:{dev:replacement.identity.dev,ino:replacement.identity.ino}},original:{sha256:original.sha256,node:{dev:original.identity.dev,ino:original.identity.ino}},createdAt:this.now()};
        const intentBytes=Buffer.from(JSON.stringify(intent));writeNew(path.join(op,'intent.json'),intentBytes);journalStarted=true;writeNew(p.pending,intentBytes);this.hook('intent-recorded');
        await gate.assertStopped();gate.check();if(this.monotonic()>=t.deadline)fail('preview_expired');const before=read(p.file);if(!same(before.identity,s.identity)||before.sha256!==s.sha256)fail('store_changed');
        const prepared=read(path.join(op,'replacement.json'));if(prepared.sha256!==intent.after.sha256||!same({dev:prepared.identity.dev,ino:prepared.identity.ino},intent.after.node))fail('store_changed');
        this.hook('before-replace');gate.check();const finalBefore=read(p.file);if(!same(finalBefore.identity,s.identity)||finalBefore.sha256!==s.sha256)fail('store_changed');fs.renameSync(path.join(op,'replacement.json'),p.file);renamed=true;this.hook('after-replace');
        const after=read(p.file);if(after.sha256!==intent.after.sha256||!same({dev:after.identity.dev,ino:after.identity.ino},intent.after.node))fail('readback_failed');
        Object.assign(result,{outcome:'revoked-from-store',persistentReadback:true});this.hook('before-finalize');gate.check();
        writeNew(path.join(op,'result.json'),Buffer.from(JSON.stringify(result)));const pending=read(p.pending,16384);if(pending.sha256!==hash(intentBytes))fail('store_changed');gate.check();fs.unlinkSync(p.pending);this.inspection=null;return result;
      } catch(error) {
        return {...result,outcome:journalStarted?'unknown':'not_submitted',persistentReadback:false,code:journalStarted?'maintenance_reconciliation_required':error.code||'maintenance_failed',replacementMayHaveOccurred:renamed};
      }
    },options);
  }
  _pending(context) {
    const p=this._paths(context);const pending=read(p.pending,16384);let intent;try{intent=JSON.parse(pending.bytes);}catch{fail('unsafe_journal');}
    keys(intent,['schema','operationId','origin','installationId','selectionDigest','credentialHandle','configNode','rootNode','operationNode','before','after','original','createdAt']);
    if(intent.schema!==1||!uuid(intent.operationId)||intent.origin!==this.origin||intent.installationId!==context.installationId||intent.selectionDigest!==context.selectionDigest||!hex(intent.credentialHandle)||!same(node(safe(p.config,true)),intent.configNode)||!same(node(safe(p.root,true)),intent.rootNode))fail('unsafe_journal');
    const op=path.join(p.root,intent.operationId);if(!same(node(safe(op,true)),intent.operationNode)||read(path.join(op,'intent.json'),16384).sha256!==pending.sha256)fail('unsafe_journal');
    const original=read(path.join(op,'original.json'));if(original.sha256!==intent.original.sha256||!same({dev:original.identity.dev,ino:original.identity.ino},intent.original.node)||original.sha256!==intent.before.sha256)fail('unsafe_journal');parse(original.bytes);
    const current=read(p.file);parse(current.bytes);let outcome;
    if(current.sha256===intent.before.sha256&&same(current.identity,intent.before.identity))outcome='not-submitted';
    else if(current.sha256===intent.after.sha256&&same({dev:current.identity.dev,ino:current.identity.ino},intent.after.node))outcome='revoked-from-store';
    else fail('unknown_store_outcome');
    return {p,op,intent,pending,current,outcome,digest:hash(JSON.stringify({context,pending:pending.sha256,current:current.identity,sha256:current.sha256,outcome}))};
  }
  async recoveryPreview(options={}) { this.recoveryTicket=null;return this._gate(async({context,check})=>{const r=this._pending(context);check();const id=randomUUID();this.recoveryTicket={id,digest:r.digest,deadline:this.monotonic()+TTL};return {ticketId:id,expectedDigest:r.digest,operationId:r.intent.operationId,outcome:r.outcome,expiresAt:this.now()+TTL,storeWrite:false,automaticStart:false};},options); }
  async recoveryConfirm(input,options={}) {
    keys(input,['ticketId','expectedDigest']);if(!uuid(input.ticketId)||!hex(input.expectedDigest))fail('invalid_request');const t=this.recoveryTicket;this.recoveryTicket=null;if(!t||t.id!==input.ticketId||t.digest!==input.expectedDigest)fail('stale_ticket');
    return this._gate(async({context,check,assertStopped})=>{if(this.monotonic()>=t.deadline)fail('preview_expired');const r=this._pending(context);if(r.digest!==t.digest)fail('store_changed');await assertStopped();check();const fresh=this._pending(context);if(fresh.digest!==r.digest)fail('store_changed');const result={operationId:r.intent.operationId,credentialHandle:r.intent.credentialHandle,origin:this.origin,scope:'shared-webui-store',outcome:r.outcome,persistentReadback:r.outcome==='revoked-from-store',automaticStart:false,automaticStop:false,localAuthenticatorRemoved:false,issuedWebUISessionsRevoked:false,reconciled:true};const resultFile=path.join(r.op,'reconciliation.json');if(exists(resultFile)){if(read(resultFile,16384).sha256!==hash(Buffer.from(JSON.stringify(result))))fail('unsafe_journal');}else writeNew(resultFile,Buffer.from(JSON.stringify(result)));check();if(this._pending(context).digest!==r.digest)fail('store_changed');fs.unlinkSync(r.p.pending);return result;},options);
  }
  discard() { this.epoch++;this.ticket=null;this.recoveryTicket=null;return {discarded:true}; }
  close() { if(this.busy)fail('busy');this.closed=true;this.discard();return {closed:true}; }
}
module.exports={OfflineNativePasskeys,assertPasskeyMaintenanceReady:ready,parsePasskeyStore:parse,VERSION,DIR};
