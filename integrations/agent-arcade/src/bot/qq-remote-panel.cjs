'use strict';
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash,X509Certificate}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const exact=(value,keys)=>plain(value)&&Object.keys(value).every(key=>keys.includes(key));
const fail=code=>{const error=new Error(`Remote panel: ${code}`);error.code=code;throw error;};
const SAFE_CODES=new Set(['invalid_request','changed','closed','operation_in_progress','remote_not_found','registration_changed','origin_registered','registration_limit','invalid_registration','invalid_rotation','rotation_unresolved','credentials_locked','encryption_unavailable','storage_limit','storage_write_unknown','unsafe_storage','invalid_origin','invalid_trust','invalid_ca','invalid_pin','ca_selection_expired','file_invalid','file_too_large','picker_unavailable','scope_unavailable']);
const METHODS=Object.freeze({
  Read:'read',Preview:'preview',Confirm:'confirm',Dismiss:'dismiss',Close:'closeOwned',
  Generate2FA:'generate2FA',PickCertificate:'pickCertificate',ResolveCredential:'resolveCredential',FinishCredentialRecovery:'finishCredentialRecovery',
  LoginOpen:'loginOpen',LoginObserve:'loginObserve',LoginQRCode:'loginQRCode',
  LoginPreview:'loginPreview',LoginConfirm:'loginConfirm',LoginDismiss:'loginDismiss',LoginClose:'loginClose',
  PasskeyAvailability:'passkeyAvailability',PasskeyPreview:'passkeyPreview',PasskeyConfirm:'passkeyConfirm',
  PasskeyAuthenticate:'passkeyAuthenticate',PasskeyDismiss:'passkeyDismiss',
  FilesOpen:'filesOpen',FilesList:'filesList',FilesRead:'filesRead',FilesPickUpload:'filesPickUpload',
  FilesPreview:'filesPreview',FilesConfirm:'filesConfirm',FilesDownload:'filesDownload',
  FilesDismiss:'filesDismiss',FilesCancel:'filesCancel',FilesClose:'filesClose',
});
for(const code of ['invalid_config','address_rejected','file_cleanup_unconfirmed'])SAFE_CODES.add(code);
function readCA(file){
  if(typeof file!=='string'||!path.isAbsolute(file))fail('file_invalid');let fd;
  try{
    const before=fs.lstatSync(file,{bigint:true});
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n)fail('file_invalid');if(before.size>65536n)fail('file_too_large');
    fd=fs.openSync(file,'r');const own=fs.fstatSync(fd,{bigint:true});
    if(!own.isFile()||own.dev!==before.dev||own.ino!==before.ino||own.nlink!==1n||own.size!==before.size)fail('file_invalid');
    const buffer=Buffer.alloc(Number(own.size)+1);let length=0;
    while(length<buffer.length){const count=fs.readSync(fd,buffer,length,buffer.length-length,null);if(!count)break;length+=count;}
    const end=fs.fstatSync(fd,{bigint:true}),after=fs.lstatSync(file,{bigint:true});
    if(length!==Number(own.size)||[end,after].some(stat=>stat.dev!==own.dev||stat.ino!==own.ino||stat.nlink!==1n||stat.size!==own.size||stat.mtimeNs!==own.mtimeNs))fail('file_invalid');
    const bytes=buffer.subarray(0,length);if(bytes.includes(0)||!Buffer.from(bytes.toString('utf8')).equals(bytes))fail('file_invalid');return bytes;
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}

class QQRemotePanel {
  constructor({registry,captureContext,pickCA,pickCertificateFiles,validateTrust,sessionFactory,sessionResult,now=Date.now,monotonic=()=>performance.now()}={}) {
    if(!registry||typeof captureContext!=='function'||typeof validateTrust!=='function'||typeof sessionFactory!=='function'||typeof sessionResult!=='function')fail('invalid_request');
    Object.assign(this,{registry,captureContext,pickCA,validateTrust,sessionResult,now,monotonic});
    this.panel=null;this.generation=0;this.pending=null;this.retiring=Promise.resolve();this.retiringPanelId=null;this.ca=null;this.closed=false;
    this.session=sessionFactory({registry,capture:value=>this._capture(value),pickCertificateFiles});
  }
  _request(input,keys){if(!exact(input,keys)||!uuid(input.panelId))fail('invalid_request');}
  _assert(input){
    if(this.closed)fail('closed');const panel=this.panel;
    if(!panel||panel.panelId!==input.panelId||panel.generation!==this.generation||panel.contextKey!==this.captureContext(null))fail('changed');
    return panel;
  }
  _capture(input){
    this._assert(input);const entry=this.registry.capture(input.remoteId);
    return {remoteId:input.remoteId,panelId:input.panelId,contextKey:`${this.generation}:${this.captureContext(entry)}`,entry};
  }
  async result(input,operation){
    try{return {ok:true,panelId:uuid(input?.panelId)?input.panelId:null,...await operation()};}
    catch(error){return {ok:false,panelId:uuid(input?.panelId)?input.panelId:null,code:SAFE_CODES.has(error?.code)?error.code:'remote_management_failed'};}
  }
  _busy(input,operation){
    const panel=this._assert(input);if(this.pending)fail('operation_in_progress');
    const current=()=>{if(this._assert(input)!==panel)fail('changed');};
    const work=Promise.resolve().then(()=>operation(current));this.pending=work;
    return work.finally(()=>{if(this.pending===work)this.pending=null;});
  }
  async list(input){
    this._request(input,['panelId']);if(this.closed)fail('closed');const contextKey=this.captureContext(null);
    if(this.pending)fail('operation_in_progress');
    if(!this.panel||this.panel.panelId!==input.panelId||this.panel.contextKey!==contextKey){
      this.ca=null;const generation=++this.generation;
      this.panel={panelId:input.panelId,contextKey,generation};
      const retiring=this.session.closeCurrent();this.retiring=Promise.allSettled([this.retiring,retiring]).then(results=>{if(results[1].status==='rejected')throw results[1].reason;});
      this.retiring.catch(()=>{});
      try{await this.retiring;}catch(error){if(this.generation===generation){this.panel=null;this.retiringPanelId=input.panelId;}throw error;}
      if(this.generation!==generation)fail('changed');
    }
    this._assert(input);return {registry:this.registry.list()};
  }
  _trust(value,input){
    if(!exact(value,['caSelectionId','spkiSha256']))fail('invalid_request');
    const trust={};
    if(value.caSelectionId!==undefined){
      if(!uuid(value.caSelectionId)||!this.ca||this.ca.selectionId!==value.caSelectionId||this.ca.panelId!==input.panelId||this.ca.generation!==this.generation||this.monotonic()>=this.ca.deadline)fail('ca_selection_expired');
      trust.caPem=this.ca.pem;
    }
    if(value.spkiSha256!==undefined)trust.spkiSha256=value.spkiSha256;
    return this.validateTrust(trust);
  }
  create(input){
    this._request(input,['panelId','value']);if(!exact(input.value,['label','origin','expectedQQ','token','trust','associatedProfileId']))fail('invalid_request');
    return this._busy(input,async assertCurrent=>{
      assertCurrent();await this.session.closeCurrent();assertCurrent();
      this.captureContext(input.value);
      const registration=this.registry.create({...input.value,trust:this._trust(input.value.trust??{},input)});
      this.ca=null;return {registration,registry:this.registry.list()};
    });
  }
  update(input){
    this._request(input,['panelId','remoteId','revision','patch']);
    if(!uuid(input.remoteId)||!uuid(input.revision)||!exact(input.patch,['label','origin','expectedQQ','token','trust','associatedProfileId'])||!Object.keys(input.patch).length)fail('invalid_request');
    return this._busy(input,async assertCurrent=>{
      assertCurrent();await this.session.closeCurrent();assertCurrent();const patch={...input.patch};
      if(Object.hasOwn(patch,'trust'))patch.trust=this._trust(patch.trust,input);
      this.captureContext({...this.registry.capture(input.remoteId),...patch});
      const registration=this.registry.update({remoteId:input.remoteId,revision:input.revision,patch});
      this.ca=null;return {registration,registry:this.registry.list()};
    });
  }
  forget(input){
    this._request(input,['panelId','remoteId','revision']);if(!uuid(input.remoteId)||!uuid(input.revision))fail('invalid_request');
    return this._busy(input,async assertCurrent=>{
      assertCurrent();await this.session.closeCurrent();assertCurrent();
      this.registry.forget({remoteId:input.remoteId,revision:input.revision});this.ca=null;return {forgotten:true,registry:this.registry.list()};
    });
  }
  pickCAFile(input){
    this._request(input,['panelId']);
    return this._busy(input,async assertCurrent=>{
      assertCurrent();this.ca=null;if(typeof this.pickCA!=='function')fail('picker_unavailable');
      const file=await this.pickCA({assertCurrent});assertCurrent();if(file===null)return {cancelled:true};
      const bytes=readCA(file),pem=bytes.toString('utf8');
      this.validateTrust({caPem:pem});const cert=new X509Certificate(pem),selectionId=randomUUID(),expiresAt=this.now()+300000;
      assertCurrent();this.ca={selectionId,panelId:input.panelId,generation:this.generation,pem,deadline:this.monotonic()+300000};
      return {ca:{selectionId,sha256:createHash('sha256').update(bytes).digest('hex'),subject:cert.subject.slice(0,512),expiresAt}};
    });
  }
  call(method,input){
    if(!Object.values(METHODS).includes(method))fail('invalid_request');
    return this.sessionResult(input,()=>{this._assert(input);if(this.pending)fail('operation_in_progress');return this.session[method](input);});
  }
  closeOwned(input){
    this._request(input,['panelId']);if(this.panel?.panelId!==input.panelId&&!(this.panel===null&&this.retiringPanelId===input.panelId))return Promise.resolve({closed:true});
    return this.closeCurrent();
  }
  closeCurrent(){
    const panelId=this.panel?.panelId??this.retiringPanelId;this.retiringPanelId=panelId;
    this.panel=null;this.ca=null;const generation=++this.generation,closing=this.session.closeCurrent();
    const work=Promise.allSettled([this.retiring,this.pending,closing]).then(results=>{
      if(results[2].status==='rejected')throw results[2].reason;
      if(this.generation===generation)this.retiringPanelId=null;return {closed:true};
    });work.catch(()=>{});this.retiring=work;return work;
  }
  observe(){if(this.panel)try{this._assert(this.panel);}catch{void this.closeCurrent();}this.session.observe();}
  async close(){
    this.closed=true;const work=this.closeCurrent();
    const results=await Promise.allSettled([work,this.session.close()]);
    const failed=results.find(row=>row.status==='rejected');if(failed)throw failed.reason;
    return {closed:true};
  }
}
module.exports={QQRemotePanel,METHODS};
