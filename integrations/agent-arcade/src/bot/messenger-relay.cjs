'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {MessengerError,fail,id,mid,uuid,secret,equalSecret,json,projectWebhook,readRequest,MAX_BODY,TTL}=require('./messenger-transport.cjs');
const RETAIN=26*60*60*1000,hash=value=>createHash('sha256').update(value).digest('hex');
class MessengerRelay{
  constructor({databaseFile,appId,pageId,ownerId,appSecret,verifyToken,authToken,now=Date.now}={}){
    if(!id(appId)||!id(pageId)||!id(ownerId)||pageId===ownerId||typeof databaseFile!=='string'||!path.isAbsolute(databaseFile))fail('invalid_config');
    const parent=path.dirname(databaseFile);if(fs.realpathSync(parent)!==path.resolve(parent))fail('unsafe_store');
    if(fs.existsSync(databaseFile)){const stat=fs.lstatSync(databaseFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>8*1024*1024)fail('unsafe_store');}
    this.appId=appId;this.pageId=pageId;this.ownerId=ownerId;this.appSecret=secret(appSecret);this.verifyToken=secret(verifyToken);this.authToken=secret(authToken);
    this.now=now;this.sessionId=randomUUID();this.closed=false;this.activeRequests=0;this.db=new DatabaseSync(databaseFile);
    try{
      fs.chmodSync(databaseFile,0o600);
      this.db.exec(`PRAGMA page_size=4096; PRAGMA max_page_count=2048; PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; PRAGMA busy_timeout=1000;
        CREATE TABLE IF NOT EXISTS binding (id INTEGER PRIMARY KEY CHECK(id=1), scope TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, at INTEGER NOT NULL, keep_until INTEGER NOT NULL, expires_at INTEGER NOT NULL, payload TEXT);
        CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, session TEXT NOT NULL, expires_at INTEGER NOT NULL, ids TEXT NOT NULL);`);
      if(this.db.prepare('PRAGMA page_size').get().page_size!==4096||this.db.prepare('PRAGMA max_page_count').get().max_page_count>2048)fail('unsafe_store');
      const scope=hash(JSON.stringify([appId,pageId,ownerId])),saved=this.db.prepare('SELECT scope FROM binding WHERE id=1').get();
      if(saved&&saved.scope!==scope)fail('scope_changed');if(!saved)this.db.prepare('INSERT INTO binding VALUES (1,?)').run(scope);
      this.db.prepare('DELETE FROM batches WHERE session != ?').run(this.sessionId);
    }catch(error){this.db.close();throw error;}
  }
  _check(){if(this.closed)fail('closed');}
  _transaction(fn){this._check();this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){try{this.db.exec('ROLLBACK');}catch{}throw error;}}
  _prune(){const now=this.now();this.db.prepare('UPDATE inbox SET payload=NULL WHERE expires_at<=?').run(now);this.db.prepare('DELETE FROM inbox WHERE keep_until<=?').run(now);this.db.prepare('DELETE FROM batches WHERE expires_at<=?').run(now);}
  prune(){return this._transaction(()=>{this._prune();return {pruned:true};});}
  receive(bytes,signature){
    this._check();const now=this.now(),rows=projectWebhook(bytes,signature,{appSecret:this.appSecret,pageId:this.pageId,ownerId:this.ownerId,now});
    return this._transaction(()=>{
      this._prune();let accepted=0;const pending=new Map();
      for(const row of rows){const payload=JSON.stringify(row),fingerprint=hash(payload),old=this.db.prepare('SELECT fingerprint FROM inbox WHERE id=?').get(row.id)||pending.get(row.id);
        if(old){if(old.fingerprint!==fingerprint)fail('event_conflict');continue;}
        pending.set(row.id,{row,payload,fingerprint});}
      const current=this.db.prepare('SELECT COUNT(*) AS total,SUM(CASE WHEN payload IS NOT NULL THEN 1 ELSE 0 END) AS pending,COALESCE(SUM(LENGTH(CAST(payload AS BLOB))),0) AS bytes FROM inbox').get();
      const live=[...pending.values()].filter(item=>item.row.createdAt+TTL>now);
      if(current.total+pending.size>10000||current.pending+live.length>100||current.bytes+live.reduce((n,item)=>n+Buffer.byteLength(item.payload),0)>MAX_BODY-8192)fail('queue_full');
      const insert=this.db.prepare('INSERT INTO inbox (id,fingerprint,at,keep_until,expires_at,payload) VALUES (?,?,?,?,?,?)');
      for(const item of pending.values()){const {row,payload,fingerprint}=item,isLive=row.createdAt+TTL>now;
        insert.run(row.id,fingerprint,row.createdAt,now+RETAIN,row.createdAt+TTL,isLive?payload:null);if(isLive)accepted++;}
      return {accepted};
    });
  }
  status(){this._check();return {schema:'messenger_relay_v1',sessionId:this.sessionId,appId:this.appId,pageId:this.pageId,ownerId:this.ownerId};}
  pull({sessionId,after,limit=50}={}){
    if(sessionId!==this.sessionId)fail('changed');if(!Number.isSafeInteger(after)||after<0||after>this.now()+30000||!Number.isInteger(limit)||limit<1||limit>50)fail('invalid_request');
    return this._transaction(()=>{
      this._prune();if(this.db.prepare('SELECT COUNT(*) AS n FROM batches').get().n>=32)fail('operation_in_progress');
      const items=this.db.prepare('SELECT payload FROM inbox WHERE payload IS NOT NULL AND at>=? ORDER BY at,id LIMIT ?').all(after,limit).map(row=>JSON.parse(row.payload));
      const deliveryId=items.length?randomUUID():null,expiresAt=this.now()+30000;
      if(deliveryId)this.db.prepare('INSERT INTO batches VALUES (?,?,?,?)').run(deliveryId,this.sessionId,expiresAt,JSON.stringify(items.map(row=>row.id)));
      return {sessionId:this.sessionId,deliveryId,expiresAt,items};
    });
  }
  acknowledge({sessionId,deliveryId,ids}={}){
    if(sessionId!==this.sessionId)fail('changed');if(!uuid(deliveryId)||!Array.isArray(ids)||!ids.length||ids.length>50||ids.some(value=>!mid(value))||new Set(ids).size!==ids.length)fail('invalid_request');
    return this._transaction(()=>{
      this._prune();const batch=this.db.prepare('SELECT * FROM batches WHERE id=? AND session=?').get(deliveryId,this.sessionId);
      if(!batch||batch.ids!==JSON.stringify(ids))fail('stale_batch');
      const update=this.db.prepare('UPDATE inbox SET payload=NULL WHERE id=?');for(const value of ids)update.run(value);
      this.db.prepare('DELETE FROM batches WHERE id=?').run(deliveryId);return {acknowledged:true,sessionId:this.sessionId,deliveryId};
    });
  }
  handler(){return async(req,res)=>{
    const send=(status,value,type='application/json')=>{if(!res.destroyed){res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(type==='application/json'?JSON.stringify(value):value);}};
    if(this.activeRequests>=16){res.setHeader('connection','close');send(503,{code:'operation_in_progress'});return;}
    this.activeRequests++;
    try{
      this._check();if(typeof req.url!=='string'||req.url.length>4096)fail('invalid_request');const url=new URL(req.url,'https://relay.invalid');
      if(req.method==='GET'&&url.pathname==='/webhook'){
        for(const key of ['hub.mode','hub.verify_token','hub.challenge'])if(url.searchParams.getAll(key).length!==1)fail('invalid_request');
        const challenge=url.searchParams.get('hub.challenge');if(url.searchParams.get('hub.mode')!=='subscribe'||!equalSecret(url.searchParams.get('hub.verify_token'),this.verifyToken)||!/^[A-Za-z0-9_-]{1,256}$/.test(challenge||''))fail('unauthorized');
        send(200,challenge,'text/plain');return;
      }
      if(req.method==='POST'&&url.pathname==='/webhook'&&!url.search){this.receive(await readRequest(req),req.headers['x-hub-signature-256']);send(200,{received:true});return;}
      if(url.search||!equalSecret(req.headers.authorization,`Bearer ${this.authToken}`))fail('unauthorized');
      if(req.method==='GET'&&url.pathname==='/v1/status'){send(200,this.status());return;}
      if(req.method==='POST'&&['/v1/pull','/v1/ack'].includes(url.pathname)){const value=json(await readRequest(req));send(200,url.pathname==='/v1/pull'?this.pull(value):this.acknowledge(value));return;}
      send(404,{code:'not_found'});
    }catch(error){const code=error instanceof MessengerError?error.code:'storage_unavailable';send(['unauthorized','invalid_signature'].includes(code)?403:code==='changed'?409:['queue_full','storage_unavailable'].includes(code)?503:400,{code});}
    finally{this.activeRequests--;}
  };}
  close(){if(this.closed)return;this.closed=true;this.appSecret='';this.authToken='';this.verifyToken='';this.db.close();}
}
module.exports={MessengerRelay};
