'use strict';
// Independent service policy. No NapCat, QQ, shell or desktop credential access.
const path = require('node:path');
const {createHash} = require('node:crypto');
const LIMITS = Object.freeze({uploadMaxBytes: 67108864, downloadMaxBytes: 134217728,
  quotaBytes: 536870912, chunkMaxBytes: 4194304, jobTtlMs: 86400000,
  maxActiveJobs: 64, maxRecords: 1024, listMaxEntries: 4096, selectionMax: 20,
  treeMaxEntries: 4096, treeMaxDepth: 32, handleTtlMs: 600000});
const CODES = new Set(['invalid_request','unauthorized','instance_mismatch','not_found',
  'expired','busy','limit','quota','unsupported','source_changed','target_exists',
  'scope_changed','integrity_failed','offset_conflict','job_exists','not_complete',
  'already_finalized','recovery_required','cleanup_unconfirmed','storage_failed',
  'range_invalid','validator_mismatch','closed']);
class TransferError extends Error {
  constructor(code, status = 400) { super(CODES.has(code) ? code : 'storage_failed'); this.code = this.message; this.status = status; }
}
function fail(code, status) { throw new TransferError(code, status); }
function plain(v) { return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype; }
function keys(v, required, optional = []) { if (!plain(v) || required.some(k => !Object.hasOwn(v,k)) || Object.keys(v).some(k => !required.includes(k) && !optional.includes(k))) fail('invalid_request'); }
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const sha = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
function text(v, max) { return typeof v === 'string' && v.length <= max && !/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u.test(v); }
function name(v) {
  if (!text(v,255) || !v || Buffer.byteLength(v)>255 || v==='.' || v==='..' || /[\\/:*?"<>|]/.test(v) || /[. ]$/.test(v) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(v)) fail('unsupported');
  return v;
}
function absolute(v) { if (!text(v,4096) || !path.isAbsolute(v) || /^\\\\/.test(v) || path.resolve(v)!==v) fail('invalid_request'); return v; }
const hash = v => createHash('sha256').update(v).digest('hex');
function identity(s) { if(typeof s.dev!=='string'||typeof s.ino!=='string'||!/^\d{1,32}$/.test(s.dev)||!/^\d{1,32}$/.test(s.ino))fail('integrity_failed');return {dev:s.dev,ino:s.ino}; }
// Never convert native file identifiers through Number: NTFS IDs may exceed 2^53.
function fileStats(s) {
  if(typeof s.dev!=='bigint'||typeof s.ino!=='bigint'||s.dev<0n||s.ino<0n||typeof s.size!=='bigint'||s.size<0n||s.size>BigInt(Number.MAX_SAFE_INTEGER)||typeof s.nlink!=='bigint'||s.nlink<0n||s.nlink>BigInt(Number.MAX_SAFE_INTEGER)||typeof s.mtimeNs!=='bigint'||typeof s.ctimeNs!=='bigint')fail('integrity_failed');
  return {dev:s.dev.toString(),ino:s.ino.toString(),size:Number(s.size),nlink:Number(s.nlink),mtimeNs:s.mtimeNs.toString(),ctimeNs:s.ctimeNs.toString(),isFile:()=>s.isFile(),isDirectory:()=>s.isDirectory(),isSymbolicLink:()=>s.isSymbolicLink()};
}
function same(a,b) { return !!a && !!b && a.dev===b.dev && a.ino===b.ino; }
function info(s) { return {...identity(s),size:s.size,mtimeNs:s.mtimeNs,ctimeNs:s.ctimeNs}; }
function sameInfo(a,b) { return same(a,b) && a.size===b.size && a.mtimeNs===b.mtimeNs && a.ctimeNs===b.ctimeNs; }
function inside(parent, child) { const r=path.relative(parent,child); return !r || (!r.startsWith('..'+path.sep) && r!=='..' && !path.isAbsolute(r)); }
function config(value) {
  keys(value,['instanceId','stateDir','token','roots']);
  if (!uuid(value.instanceId) || typeof value.token!=='string' || !/^[A-Za-z0-9_-]{43,256}$/.test(value.token) || !Array.isArray(value.roots) || value.roots.length<1 || value.roots.length>16) fail('invalid_request');
  absolute(value.stateDir); const ids=new Set(), dirs=[value.stateDir];
  const roots=value.roots.map(r=>{ keys(r,['rootId','label','path','read','upload'],['stagingDir']);
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(r.rootId) || ids.has(r.rootId) || !text(r.label,64) || !r.label || typeof r.read!=='boolean' || typeof r.upload!=='boolean' || !r.read&&!r.upload) fail('invalid_request');
    ids.add(r.rootId); absolute(r.path); dirs.push(r.path);
    if (r.upload) { absolute(r.stagingDir); dirs.push(r.stagingDir); } else if (Object.hasOwn(r,'stagingDir')) fail('invalid_request');
    return {...r};
  });
  for(let i=0;i<dirs.length;i++)for(let j=0;j<i;j++)if(inside(dirs[i],dirs[j])||inside(dirs[j],dirs[i]))fail('invalid_request');
  return {...value,roots};
}
function proof(p){keys(p,['dev','ino']);for(const v of Object.values(p))if(typeof v!=='string'||!/^\d{1,32}$/.test(v))fail('recovery_required');}
function record(j){
  keys(j,['clientJobId','resourceId','kind','rootId','name','length','sha256','archive','reserved','offset','prefixSha','createdAt','expiresAt','authority','state','published','cleanupVerified','code','blobProof'],['directory','metadata']);
  if(!uuid(j.clientJobId)||!uuid(j.resourceId)||!['upload','download'].includes(j.kind)||!/^[a-z][a-z0-9-]{0,31}$/.test(j.rootId)||!sha(j.prefixSha)||!sha(j.authority)||typeof j.archive!=='boolean'||typeof j.cleanupVerified!=='boolean'||![true,false,null].includes(j.published)||j.code!==null&&!CODES.has(j.code))fail('recovery_required');
  name(j.name);for(const key of ['createdAt','expiresAt','reserved','offset'])if(!Number.isSafeInteger(j[key])||j[key]<0)fail('recovery_required');
  if(j.expiresAt!==j.createdAt+LIMITS.jobTtlMs||j.expiresAt>8640000000000000||j.reserved>LIMITS.downloadMaxBytes||j.offset>LIMITS.downloadMaxBytes)fail('recovery_required');
  if(j.blobProof!==null)proof(j.blobProof);
  const states=j.kind==='upload'?['allocating','receiving','uploaded','publishing','published','failed','expired','discarded','recovery_required']:['preparing','ready','failed','expired','discarded','recovery_required'];if(!states.includes(j.state))fail('recovery_required');
  if(j.length!==null&&(!Number.isSafeInteger(j.length)||j.length<0||j.length>LIMITS.downloadMaxBytes||j.offset>j.length))fail('recovery_required');
  if(j.sha256!==null&&!sha(j.sha256))fail('recovery_required');
  if(j.kind==='upload'){
    if(j.archive||!Number.isSafeInteger(j.length)||j.length>LIMITS.uploadMaxBytes||j.reserved!==j.length||!sha(j.sha256))fail('recovery_required');
    keys(j.directory,['relative','proof']);proof(j.directory.proof);if(typeof j.directory.relative!=='string'||j.directory.relative.length>4096||j.directory.relative.includes('\\')||j.directory.relative.startsWith('/')||j.directory.relative.endsWith('/'))fail('recovery_required');if(j.directory.relative)for(const n of j.directory.relative.split('/'))name(n);
    keys(j.metadata,['clientJobId','rootId','directoryId','name','sha256']);if(!uuid(j.metadata.directoryId)||['clientJobId','rootId','name','sha256'].some(k=>j.metadata[k]!==j[k]))fail('recovery_required');
    if(j.state==='uploaded'&&j.offset!==j.length||['publishing','published'].includes(j.state)&&(j.offset!==j.length||j.prefixSha!==j.sha256)||j.state==='published'&&j.published!==true)fail('recovery_required');
  }else{
    if(Object.hasOwn(j,'directory')||Object.hasOwn(j,'metadata')||j.published!==false||j.length!==null&&j.reserved<j.length||j.state==='ready'&&(!sha(j.sha256)||!Number.isSafeInteger(j.length)||j.offset!==j.length||j.reserved!==j.length))fail('recovery_required');
  }
  if(['receiving','uploaded','publishing','published','ready'].includes(j.state)&&j.blobProof===null)fail('recovery_required');
  return j;
}
module.exports={LIMITS,CODES,TransferError,fail,keys,plain,uuid,sha,text,name,absolute,hash,identity,fileStats,same,info,sameInfo,inside,config,record};
