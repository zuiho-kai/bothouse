'use strict';

const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {publicCatalog}=require('../core/personas.cjs');
const {OPENAI,CLOUDFLARE,validImageProvider,defaultImageModel}=require('./image-providers.cjs');
const {dimensions,validateImagePayload}=require('./qq-media.cjs');

const cloudPolicyTable='CREATE TABLE IF NOT EXISTS cloud_policy(account TEXT, grp TEXT, role TEXT, revision TEXT, provider TEXT, enabled INTEGER NOT NULL, portrait_sha TEXT, PRIMARY KEY(account,grp))';
const hasTable=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name);
const personas=new Map(publicCatalog().map(role=>[role.id,role]));
const MAX_PNG=4*1024*1024, MAX_BYTES=128*1024*1024, MAX_NAMES=64, MAX_EVENTS=65536, MAX_POLICIES=4096;
const hash=value=>createHash('sha256').update(value).digest('hex');
const failed=code=>Object.assign(Error('QQ group drawing: '+code),{drawingCode:code,code});
const qqId=id=>typeof id==='string'&&/^[1-9]\d{4,14}$/u.test(id);
const receiptId=id=>typeof id==='string'&&/^-?\d{1,20}$/u.test(id);
const keyOf=scope=>[scope.accountId,scope.groupId];
const validScope=s=>s&&qqId(s.accountId)&&qqId(s.groupId)&&typeof s.roleId==='string'&&
  (personas.has(s.roleId)||/^card-[0-9a-f]{16}$/u.test(s.roleId));
const text=(s,max)=>typeof s==='string'&&s.length<=max*2&&!!s.trim()&&[...s].length<=max&&!/[\p{Cc}\p{Cf}]/u.test(s);
const notSent=code=>({outcome:'not_sent',code});
const sendReasons=new Set(['scope_changed','group_drawing_changed','group_delivery_limit','group_stopped','group_context_changed',
  'changed','stale_context','group_unavailable','account_mismatch','account_changed','disconnected','account_offline',
  'status_unverified','bridge_unhealthy','cancelled','closed','media_unavailable','media_failed','invalid_request',
  'image_invalid','image_too_large','send_rejected']);
const sendReason=code=>sendReasons.has(code)?code:'send_rejected';
const schema=[
  'CREATE TABLE IF NOT EXISTS policy(account TEXT, grp TEXT, role TEXT, enabled INTEGER, daily_limit INTEGER, revision TEXT, PRIMARY KEY(account,grp))',
  'CREATE TABLE IF NOT EXISTS event(account TEXT, grp TEXT, id TEXT, day TEXT, state TEXT, receipt TEXT, PRIMARY KEY(account,grp,id))',
  'CREATE INDEX IF NOT EXISTS event_budget ON event(account,grp,day)',
  'CREATE TABLE IF NOT EXISTS art(account TEXT, grp TEXT, role TEXT, name_key TEXT, name TEXT, brief_hash TEXT, creator TEXT, png BLOB, sha TEXT, dispatch TEXT, PRIMARY KEY(account,grp,role,name_key))'
].join(';');

function dayAt(time){
  const d=new Date(time);
  if(!Number.isFinite(d.getTime()))throw failed('storage_unavailable');
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
function policyFor(db,scope){
  const key=keyOf(scope),row=db.prepare('SELECT * FROM policy WHERE account=? AND grp=?').get(...key);
  const sameRole=row?.role===scope.roleId;
  const local=sameRole&&row.enabled===0&&hasTable(db,'local_policy')&&
    db.prepare('SELECT enabled FROM local_policy WHERE account=? AND grp=? AND role=? AND revision=?')
      .get(...key,scope.roleId,row.revision);
  const cloud=sameRole&&hasTable(db,'cloud_policy')&&
    db.prepare('SELECT provider,enabled,portrait_sha FROM cloud_policy WHERE account=? AND grp=? AND role=? AND revision=?')
      .get(...key,scope.roleId,row.revision);
  const enabled=!!(sameRole&&(cloud?cloud.enabled===1:row.enabled===1));
  return {enabled,canResend:enabled||local?.enabled===1,localRetired:!!local,
    dailyLimit:sameRole?row.daily_limit:1,provider:cloud?.provider||(sameRole&&!local?OPENAI:CLOUDFLARE),
    referenceHash:cloud?.portrait_sha??null,revision:row?.revision??''};
}
function state(db,scope,day){
  const usedToday=db.prepare('SELECT count(*) AS n FROM event WHERE account=? AND grp=? AND day=?').get(...keyOf(scope),day).n;
  return {...policyFor(db,scope),usedToday};
}
function active(db,scope,revision,action){
  const policy=policyFor(db,scope);
  if(!(action==='resend'?policy.canResend:policy.enabled)||policy.revision!==revision)throw failed('changed');
  return policy;
}
function storedBytes(db,key,name){
  const row=db.prepare('SELECT name,png,sha FROM art WHERE account=? AND grp=? AND role=? AND name_key=? AND length(png) BETWEEN 1 AND ?').get(...key,MAX_PNG);
  if(!row||row.name!==name)throw failed('storage_unavailable');
  const bytes=Buffer.from(row.png);
  if(hash(bytes)!==row.sha)throw failed('storage_unavailable');
  try{validateImagePayload(bytes);}catch{throw failed('storage_unavailable');}
  return bytes;
}
function withdraw(db,where,args){
  // Finished artwork belongs to this exact QQ scope. Withdraw access and
  // release unfinished reservations, without losing paid pixels or event IDs.
  db.prepare('DELETE FROM art WHERE '+where+' AND sha IS NULL').run(...args);
  db.prepare('UPDATE art SET dispatch=NULL WHERE '+where+' AND dispatch IS NOT NULL').run(...args);
}
function drawingPrompt(scope,roleName,brief){
  const role=personas.get(scope.roleId);
  // Imported cards contribute only the public display name supplied by the QQ route.
  const character=role?{name:role.name.zh,appearance:role.visual}:{name:text(roleName,40)?roleName:'本群角色'};
  return 'Create one illustration for this fictional character using only the supplied public character and scene.\n'+
    JSON.stringify({character,scene:brief});
}

class GroupDrawingStore{
  constructor({root,now=Date.now}){
    this.file=path.join(root,'qq-group-drawings.sqlite');this.now=now;
  }
  database(mode,missing,run){
    let db;
    try{
      const write=mode!=='read';
      const stat=fs.lstatSync(this.file,{throwIfNoEntry:false});
      if(stat&&(!stat.isFile()||stat.nlink!==1))throw failed('storage_unavailable');
      if(!stat&&(mode==='read'||mode==='revoke'))return missing;
      if(!stat&&mode!=='create')throw failed('storage_unavailable');
      if(!stat)fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});
      const {DatabaseSync}=require('node:sqlite');
      db=new DatabaseSync(path.toNamespacedPath(this.file),{readOnly:!write,allowExtension:false});
      db.exec('PRAGMA busy_timeout=1000; PRAGMA trusted_schema=OFF;');
      if(write){
        // New stores use SQLite's 4 KiB pages. The database bound leaves space for event tombstones.
        db.exec('PRAGMA max_page_count=65536; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
        if(!stat)db.exec(schema+'; PRAGMA application_id=1363625042; PRAGMA user_version=1;');
      }
      if(db.prepare('PRAGMA application_id').get().application_id!==1363625042||
        db.prepare('PRAGMA user_version').get().user_version!==1||
        db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name IN ('art','policy','event')").get().n!==3)throw failed('storage_unavailable');
      const result=run(db);
      if(write)db.exec('COMMIT');
      return result;
    }catch(error){
      if(error?.drawingCode)throw error;
      throw failed('storage_unavailable');
    }finally{db?.close();}
  }
  view(scope){
    if(!validScope(scope))throw failed('invalid_request');
    return this.database('read',{enabled:false,dailyLimit:1,usedToday:0,revision:'',provider:CLOUDFLARE,canResend:false,localRetired:false,referenceHash:null},db=>state(db,scope,dayAt(this.now())));
  }
  configure(scope,{expectedRevision,enabled,dailyLimit,provider,referenceHash=null}={}){
    if(!validScope(scope)||typeof expectedRevision!=='string'||typeof enabled!=='boolean'||
      !Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>10||provider!==undefined&&!validImageProvider(provider)||
      referenceHash!==null&&(typeof referenceHash!=='string'||!/^[a-f0-9]{64}$/u.test(referenceHash)||!scope.roleId.startsWith('card-')))throw failed('invalid_request');
    return this.database(expectedRevision===''?'create':'write',null,db=>{
      const key=keyOf(scope),day=dayAt(this.now()),before=state(db,scope,day);
      if(before.revision!==expectedRevision)throw failed('changed');
      const previous=db.prepare('SELECT role FROM policy WHERE account=? AND grp=?').get(...key);
      if(before.localRetired&&enabled&&provider===undefined)throw failed('invalid_request');
      const chosen=provider??before.provider;
      if(previous?.role===scope.roleId&&!before.localRetired&&before.enabled===enabled&&before.dailyLimit===dailyLimit&&
        before.provider===chosen&&before.referenceHash===referenceHash)return before;
      if(!previous&&db.prepare('SELECT count(*) AS n FROM policy').get().n>=MAX_POLICIES)throw failed('storage_full');
      if(!enabled||previous?.role!==scope.roleId||before.provider!==chosen||before.referenceHash!==referenceHash)withdraw(db,'account=? AND grp=?',key);
      // A limit change also cancels unfinished work from the previous revision.
      else db.prepare('DELETE FROM art WHERE account=? AND grp=? AND sha IS NULL').run(...key);
      const revision=randomUUID();
      db.prepare('INSERT OR REPLACE INTO policy VALUES(?,?,?,?,?,?)').run(...key,scope.roleId,Number(chosen===OPENAI&&enabled),dailyLimit,revision);
      // Older builds see a Cloudflare choice as disabled. A rollback edit
      // rotates the main revision and cannot revive a prior cloud grant.
      db.exec(cloudPolicyTable);
      db.prepare('INSERT OR REPLACE INTO cloud_policy VALUES(?,?,?,?,?,?,?)')
        .run(...key,scope.roleId,revision,chosen,Number(enabled),referenceHash);
      return state(db,scope,day);
    });
  }
  revoke(accountId,groupId){
    if(!qqId(accountId)||(groupId!==undefined&&!qqId(groupId)))throw failed('invalid_request');
    const where=groupId===undefined?'account=?':'account=? AND grp=?',args=groupId===undefined?[accountId]:[accountId,groupId];
    this.database('revoke',null,db=>{
      db.prepare('UPDATE policy SET enabled=0, revision=? WHERE '+where).run(randomUUID(),...args);
      for(const table of ['local_policy','cloud_policy']){
        if(hasTable(db,table))db.prepare('DELETE FROM '+table+' WHERE '+where).run(...args);
      }
      withdraw(db,where,args);
    });
  }
  has(scope,name){
    if(!validScope(scope)||!text(name,40))return false;
    const title=name.trim().normalize('NFC');
    try{return this.database('read',false,db=>policyFor(db,scope).canResend&&!!db.prepare(
      'SELECT 1 FROM art WHERE account=? AND grp=? AND role=? AND name_key=? AND name=? AND sha IS NOT NULL'
    ).get(...keyOf(scope),scope.roleId,title.toLowerCase(),title));}catch{return false;}
  }
  async handle({scope,expectedRevision,eventId,action,name,brief='',roleName,signal,assertCurrent,verifyTarget,generate,prepare,send,isReady}={}){
    if(!validScope(scope)||!text(name,40)||!['create','resend'].includes(action)||typeof expectedRevision!=='string'||
      typeof eventId!=='string'||!/^[\w:.-]{1,160}$/u.test(eventId)||typeof send!=='function'||typeof assertCurrent!=='function'||
      (action==='create'&&!text(brief,500))||(action==='resend'&&brief!==''))return notSent('invalid_request');
    scope={accountId:scope.accountId,groupId:scope.groupId,roleId:scope.roleId};
    const title=name.trim().normalize('NFC'),scene=brief.trim().normalize('NFC'),briefHash=hash(scene);
    const target=keyOf(scope),art=[...target,scope.roleId,title.toLowerCase()],id=hash(eventId),event=[...target,id];
    const checkRoute=()=>{
      if(signal?.aborted)throw failed('changed');
      try{
        const result=assertCurrent();
        if(result===false||result?.then)throw failed('changed');
      }catch{throw failed('changed');}
    };
    const check=()=>{
      checkRoute();
      if(!this.database('read',false,db=>{active(db,scope,expectedRevision,action);return true;}))throw failed('changed');
    };
    let claimed=false,enteredSend=false,reused=false,raw,bytes;
    const finish=(state,receipt=null)=>this.database('write',null,db=>{
      db.prepare('UPDATE event SET state=?,receipt=? WHERE account=? AND grp=? AND id=?').run(state,receipt,...event);
      db.prepare('DELETE FROM art WHERE account=? AND grp=? AND role=? AND name_key=? AND creator=? AND sha IS NULL').run(...art,id);
      db.prepare('UPDATE art SET dispatch=NULL WHERE account=? AND grp=? AND role=? AND name_key=? AND dispatch=?').run(...art,id);
    });
    try{
      check();
      if(verifyTarget){try{if(await verifyTarget(signal)===false)throw failed('changed');}catch{throw failed('changed');}}
      checkRoute();
      const reservation=this.database('write',null,db=>{
        active(db,scope,expectedRevision,action);
        if(db.prepare('SELECT 1 FROM event WHERE account=? AND grp=? AND id=?').get(...event))return 'duplicate';
        // No new event can be journaled here, so do not trigger a repeatable group notice.
        if(db.prepare('SELECT count(*) AS n FROM event').get().n>=MAX_EVENTS)return 'storage_unavailable';
        const row=db.prepare('SELECT name,brief_hash,sha,dispatch FROM art WHERE account=? AND grp=? AND role=? AND name_key=?').get(...art);
        let result;
        if(row){
          if(row.name!==title||(action==='create'&&row.brief_hash!==briefHash))result='name_conflict';
          else result=row.sha&&!row.dispatch?'reuse':'in_progress';
        }else if(action==='resend')result='not_found';
        else if(typeof generate!=='function'||typeof prepare!=='function'||(isReady&&isReady()!==true))result='credentials_missing';
        else{
          const today=dayAt(this.now()),policy=state(db,scope,today);
          const count=db.prepare('SELECT count(*) AS n FROM art WHERE account=? AND grp=?').get(...target).n;
          const reserved=db.prepare('SELECT coalesce(sum(coalesce(length(png),?)),0) AS bytes FROM art').get(MAX_PNG).bytes;
          if(policy.usedToday>=policy.dailyLimit)result='quota';
          else if(count>=MAX_NAMES||reserved+MAX_PNG>MAX_BYTES)result='storage_full';
          else{
            db.prepare('INSERT INTO art(account,grp,role,name_key,name,brief_hash,creator,dispatch) VALUES(?,?,?,?,?,?,?,?)').run(...art,title,briefHash,id,id);
            db.prepare('INSERT INTO event VALUES(?,?,?,?,?,NULL)').run(...event,today,'generating');
            return 'create';
          }
        }
        if(result==='reuse')db.prepare('UPDATE art SET dispatch=? WHERE account=? AND grp=? AND role=? AND name_key=?').run(id,...art);
        db.prepare('INSERT INTO event VALUES(?,?,?,NULL,?,NULL)').run(...event,result==='reuse'?'sending':result);
        return result;
      });
      if(reservation!=='create'&&reservation!=='reuse')return notSent(reservation);
      claimed=true;reused=reservation==='reuse';
      if(reused)bytes=this.database('read',null,db=>storedBytes(db,art,title));
      else{
        check();
        const policy=this.database('read',null,db=>active(db,scope,expectedRevision,action));
        try{raw=await generate({model:defaultImageModel(policy.provider),prompt:drawingPrompt(scope,roleName,scene),signal});}
        catch(error){
          const codes=['credentials_missing','image_auth','image_forbidden','image_provider_failed','image_timeout','image_rate_limited',
            'image_cancelled','image_too_large','image_invalid_response','image_model_unavailable','image_request_rejected',
            'image_reference_rejected','image_content_rejected','image_quota_exceeded','image_network'];
          throw failed(codes.includes(error?.code)?error.code:'image_provider_failed');
        }
        check();
        try{dimensions(raw,'.png');bytes=prepare(raw);validateImagePayload(bytes);}
        catch(error){throw failed(error?.code==='image_too_large'?'image_too_large':'image_invalid_response');}
        this.database('write',null,db=>{
          active(db,scope,expectedRevision,action);
          if(db.prepare('UPDATE art SET png=?,sha=? WHERE account=? AND grp=? AND role=? AND name_key=? AND creator=? AND png IS NULL')
            .run(bytes,hash(bytes),...art,id).changes!==1)throw failed('changed');
          db.prepare("UPDATE event SET state='sending' WHERE account=? AND grp=? AND id=?").run(...event);
        });
      }
      check();
      enteredSend=true;
      const result=await send(bytes,check,signal);
      if(result?.outcome==='accepted'&&receiptId(result.messageId)){
        finish('accepted',result.messageId);return {outcome:'accepted',messageId:result.messageId,reused};
      }
      const known=result?.outcome==='not_sent';
      finish(known?'not_sent':'unknown');return {outcome:known?'not_sent':'unknown',code:known?sendReason(result.code):'send_unknown',reused};
    }catch(error){
      const uncertain=enteredSend&&error?.deliveryNotSubmitted!==true;
      if(claimed){try{finish(uncertain?'unknown':'not_sent');}catch{/* The reservation remains non-replayable. */}}
      const code=uncertain?'send_unknown':error?.drawingCode||(enteredSend?sendReason(error?.code):'drawing_failed');
      return {outcome:uncertain?'unknown':'not_sent',code};
    }finally{if(Buffer.isBuffer(raw))raw.fill(0);if(Buffer.isBuffer(bytes))bytes.fill(0);}
  }
}
module.exports={GroupDrawingStore};
