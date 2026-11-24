'use strict';
// Independent OS-encrypted remote management records. Never opens a companion vault.
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const MAX_BYTES=2*1024*1024,MAX_ENTRIES=16;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const copy=value=>structuredClone(value);
const fail=code=>{const error=new Error(`Remote registry: ${code}`);error.code=code;throw error;};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const exact=(value,keys)=>plain(value)&&Object.keys(value).every(key=>keys.includes(key));
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const token=value=>typeof value==='string'&&value.length>=6&&value.length<=1024&&!/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u.test(value);
const label=value=>typeof value==='string'&&value.trim()===value&&value.length>=1&&value.length<=64&&!/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u.test(value);
const profile=value=>value===null||typeof value==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(value);
const identity=stat=>`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

class RemoteNapCatRegistry {
  constructor({root,vault,validateOrigin,validateTrust}={}) {
    if(typeof root!=='string'||!path.isAbsolute(root)||typeof validateOrigin!=='function'||typeof validateTrust!=='function')fail('invalid_registry_options');
    this.root=path.resolve(root);this.file=path.join(this.root,'qq-remote-registry.json');
    this.vault=vault;this.validateOrigin=validateOrigin;this.validateTrust=validateTrust;
    this.state='ready';this.entries=[];this.fingerprint=null;this.rootIdentity=null;this.leases=new Map();
    try {
      if(!fs.existsSync(this.root))fs.mkdirSync(this.root,{recursive:true,mode:0o700});
      const stat=fs.lstatSync(this.root);if(!stat.isDirectory()||stat.isSymbolicLink())fail('unsafe_storage');
      this.root=fs.realpathSync(this.root);this.file=path.join(this.root,'qq-remote-registry.json');this.rootIdentity=identity(stat);
      const bytes=this._bytes();this.fingerprint=bytes===null?null:digest(bytes);
      if(bytes!==null){
        if(!vault?.isEncryptionAvailable())fail('credentials_locked');
        const envelope=JSON.parse(bytes.toString('utf8'));
        if(!exact(envelope,['version','data'])||envelope.version!==1||typeof envelope.data!=='string'||!envelope.data||!/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.data))fail('invalid_storage');
        const decoded=vault.decryptString(Buffer.from(envelope.data,'base64'));
        if(typeof decoded!=='string'||Buffer.byteLength(decoded)>MAX_BYTES)fail('invalid_storage');
        const stored=JSON.parse(decoded);
        if(!exact(stored,['version','entries'])||stored.version!==1||!Array.isArray(stored.entries)||stored.entries.length>MAX_ENTRIES)fail('invalid_storage');
        const entries=stored.entries.map(entry=>this._entry(entry));
        if(new Set(entries.map(entry=>entry.remoteId)).size!==entries.length||new Set(entries.map(entry=>entry.origin)).size!==entries.length)fail('invalid_storage');
        this.entries=entries;
      }
    }catch{this.state='locked';this.entries=[];}
  }
  _entry(value){
    if(!exact(value,['remoteId','label','origin','expectedQQ','version','revision','trustRevision','credentialRevision','associatedProfileId','trust','token','pendingRotation'])||
      !uuid(value.remoteId)||!label(value.label)||typeof value.expectedQQ!=='string'||! /^[1-9]\d{4,14}$/.test(value.expectedQQ)||value.version!=='4.18.42'||
      !uuid(value.revision)||!uuid(value.trustRevision)||!uuid(value.credentialRevision)||!profile(value.associatedProfileId)||!token(value.token))fail('invalid_registration');
    const origin=this.validateOrigin(value.origin),trust=this.validateTrust(value.trust);
    if(origin!==value.origin)fail('invalid_registration');
    const pending=value.pendingRotation;
    if(pending!==null&&(!exact(pending,['id','oldToken','candidateToken','outcome','selected'])||!uuid(pending.id)||!token(pending.oldToken)||!token(pending.candidateToken)||pending.oldToken===pending.candidateToken||
      !['prepared','acknowledged','rejected','unknown'].includes(pending.outcome)||!['current','candidate'].includes(pending.selected)||value.token!==(pending.selected==='current'?pending.oldToken:pending.candidateToken)))fail('invalid_registration');
    return {...copy(value),origin,trust:copy(trust)};
  }
  _bytes(){
    const root=fs.lstatSync(this.root);
    if(!root.isDirectory()||root.isSymbolicLink()||identity(root)!==this.rootIdentity)fail('unsafe_storage');
    let stat;try{stat=fs.lstatSync(this.file,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n||stat.size>BigInt(MAX_BYTES))fail('unsafe_storage');
    let fd;try{
      fd=fs.openSync(this.file,'r');const own=fs.fstatSync(fd,{bigint:true});
      if(!own.isFile()||own.dev!==stat.dev||own.ino!==stat.ino||own.size!==stat.size||own.nlink!==1n)fail('unsafe_storage');
      const buffer=Buffer.alloc(Number(own.size)+1);let length=0;
      while(length<buffer.length){const count=fs.readSync(fd,buffer,length,buffer.length-length,null);if(!count)break;length+=count;}
      const end=fs.fstatSync(fd,{bigint:true}),after=fs.lstatSync(this.file,{bigint:true});
      if(length!==Number(own.size)||[end,after].some(s=>s.dev!==own.dev||s.ino!==own.ino||s.size!==own.size||s.nlink!==1n||s.mtimeNs!==own.mtimeNs))fail('unsafe_storage');
      return buffer.subarray(0,length);
    }finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  _current(){
    if(this.state!=='ready')fail('credentials_locked');
    try{const bytes=this._bytes();if((bytes===null?null:digest(bytes))!==this.fingerprint)throw Error();}
    catch{this.state='locked';this.entries=[];fail('credentials_locked');}
  }
  _find(remoteId){this._current();if(!uuid(remoteId))fail('invalid_request');const value=this.entries.find(entry=>entry.remoteId===remoteId);if(!value)fail('remote_not_found');return value;}
  _match(remoteId,revision){const value=this._find(remoteId);if(value.revision!==revision)fail('registration_changed');return value;}
  _public(entry){
    const {token:secret,pendingRotation,trust,...meta}=entry;
    return {...copy(meta),trust:{privateCA:!!trust.caPem,spkiSha256:trust.spkiSha256||null},credentialState:'saved',pendingRotation:pendingRotation?{id:pendingRotation.id,outcome:pendingRotation.outcome,selected:pendingRotation.selected}:null};
  }
  list(){try{this._current();return {state:'ready',items:this.entries.map(entry=>this._public(entry))};}catch{return {state:'locked',items:[]};}}
  capture(remoteId){return copy(this._find(remoteId));}
  _commit(entries){
    this._current();const next=entries.map(entry=>this._entry(entry));
    if(next.length>MAX_ENTRIES||new Set(next.map(entry=>entry.origin)).size!==next.length)fail('registration_limit');
    if(!this.vault?.isEncryptionAvailable())fail('encryption_unavailable');
    let bytes;try{
      const encoded=this.vault.encryptString(JSON.stringify({version:1,entries:next}));
      if(!Buffer.isBuffer(encoded)||!encoded.length)throw Error();
      bytes=Buffer.from(JSON.stringify({version:1,data:encoded.toString('base64')}));
      if(bytes.length>MAX_BYTES)fail('storage_limit');
    }catch(error){if(error.code==='storage_limit')throw error;fail('encryption_unavailable');}
    const fingerprint=digest(bytes),staged=path.join(this.root,`.qq-remote-${randomUUID()}.pending`);
    try{
      this._current();const fd=fs.openSync(staged,'wx',0o600);
      try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      this._current();fs.renameSync(staged,this.file);
      const observed=this._bytes();if(!observed||digest(observed)!==fingerprint)throw Error();
    }catch{
      // A rename can report uncertainty after committing. Accept only exact readback.
      let observed;try{observed=this._bytes();}catch{}
      if(!observed||digest(observed)!==fingerprint){this.state='locked';this.entries=[];fail('storage_write_unknown');}
    }
    this.entries=next;this.fingerprint=fingerprint;
  }
  create(input){
    this._current();if(!exact(input,['label','origin','expectedQQ','token','trust','associatedProfileId']))fail('invalid_request');
    if(this.entries.length>=MAX_ENTRIES)fail('registration_limit');
    const entry=this._entry({...input,origin:this.validateOrigin(input.origin),associatedProfileId:input.associatedProfileId??null,trust:input.trust??{},remoteId:randomUUID(),version:'4.18.42',revision:randomUUID(),trustRevision:randomUUID(),credentialRevision:randomUUID(),pendingRotation:null});
    if(this.entries.some(item=>item.origin===entry.origin))fail('origin_registered');
    this._commit([...this.entries,entry]);return this._public(entry);
  }
  update(input){
    if(!exact(input,['remoteId','revision','patch'])||!exact(input.patch,['label','origin','expectedQQ','token','trust','associatedProfileId'])||!Object.keys(input.patch).length)fail('invalid_request');
    const old=this._match(input.remoteId,input.revision);if(this.leases.has(old.remoteId))fail('operation_in_progress');
    if(old.pendingRotation&&['token','origin','trust'].some(key=>Object.hasOwn(input.patch,key)))fail('rotation_unresolved');
    const next=this._entry({...old,...input.patch,...('origin'in input.patch?{origin:this.validateOrigin(input.patch.origin)}:{}),revision:randomUUID(),trustRevision:('origin'in input.patch||'trust'in input.patch)?randomUUID():old.trustRevision,credentialRevision:'token'in input.patch?randomUUID():old.credentialRevision});
    if(this.entries.some(item=>item.remoteId!==old.remoteId&&item.origin===next.origin))fail('origin_registered');
    this._commit(this.entries.map(item=>item.remoteId===old.remoteId?next:item));return this._public(next);
  }
  forget(input){
    if(!exact(input,['remoteId','revision']))fail('invalid_request');const old=this._match(input.remoteId,input.revision);
    if(this.leases.has(old.remoteId))fail('operation_in_progress');
    this._commit(this.entries.filter(item=>item.remoteId!==old.remoteId));return {forgotten:true};
  }
  async withOperation(input,operation){
    if(!exact(input,['remoteId','revision'])||typeof operation!=='function')fail('invalid_request');
    let current=this._match(input.remoteId,input.revision);if(this.leases.has(current.remoteId))fail('operation_in_progress');
    const key={},id=current.remoteId;this.leases.set(id,key);
    const assertCurrent=()=>{if(this.leases.get(id)!==key)fail('operation_closed');const latest=this._match(id,current.revision);if(!equal(latest,current))fail('registration_changed');return latest;};
    const save=next=>{assertCurrent();this._commit(this.entries.map(item=>item.remoteId===id?next:item));current=this._find(id);return copy(current);};
    const lease={assertCurrent,capture:()=>copy(assertCurrent()),prepareRotation:newToken=>{
      assertCurrent();if(current.pendingRotation)fail('rotation_unresolved');if(!token(newToken)||newToken===current.token)fail('invalid_token');
      return save({...current,revision:randomUUID(),credentialRevision:randomUUID(),pendingRotation:{id:randomUUID(),oldToken:current.token,candidateToken:newToken,outcome:'prepared',selected:'current'}});
    },recordRotation:outcome=>{
      assertCurrent();if(!current.pendingRotation||!['acknowledged','rejected','unknown'].includes(outcome))fail('invalid_rotation');
      return save({...current,revision:randomUUID(),pendingRotation:{...current.pendingRotation,outcome}});
    },selectCredential:choice=>{
      assertCurrent();if(!current.pendingRotation||!['current','candidate'].includes(choice))fail('invalid_rotation');
      return save({...current,revision:randomUUID(),credentialRevision:randomUUID(),token:choice==='current'?current.pendingRotation.oldToken:current.pendingRotation.candidateToken,pendingRotation:{...current.pendingRotation,selected:choice}});
    },clearRotation:()=>{
      // Called only by the session's explicit, fresh authenticated recovery ticket.
      assertCurrent();if(!current.pendingRotation)fail('invalid_rotation');
      return save({...current,revision:randomUUID(),credentialRevision:randomUUID(),pendingRotation:null});
    }};
    try{return await operation(lease);}finally{if(this.leases.get(id)===key)this.leases.delete(id);}
  }
}
module.exports={RemoteNapCatRegistry,MAX_ENTRIES};
