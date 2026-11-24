'use strict';
const https=require('node:https'),path=require('node:path'),fs=require('node:fs');
const {createRequire}=require('node:module');
const {pathToFileURL}=require('node:url');
const {randomUUID,timingSafeEqual}=require('node:crypto');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const P=require('./policy.cjs'),{TransferStore}=require('./store.cjs');
async function dependencies(packagePath=path.resolve(__dirname,'../../deploy/transfer-helper/package.json')) {
  const req=createRequire(packagePath);
  const [server,utils]=await Promise.all([import(pathToFileURL(req.resolve('@tus/server')).href),import(pathToFileURL(req.resolve('@tus/utils')).href)]);
  return {Server:server.Server,DataStore:utils.DataStore,Upload:utils.Upload,yazl:req('yazl')};
}
function json(res,status,data){if(res.destroyed||res.writableEnded)return;const body=Buffer.from(JSON.stringify(data));res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);}
async function body(req){if(req.headers['content-type']!=='application/json')P.fail('invalid_request');const length=Number(req.headers['content-length']);if(!Number.isSafeInteger(length)||length<0||length>16384)P.fail('limit',413);const chunks=[];let n=0;for await(const b of req){n+=b.length;if(n>16384)P.fail('limit',413);chunks.push(b);}if(n!==length)P.fail('invalid_request');try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{P.fail('invalid_request');}}
function parseMetadata(value){if(typeof value!=='string'||Buffer.byteLength(value)>8192)P.fail('invalid_request');const result={};for(const part of value.split(',')){const match=/^([A-Za-z][A-Za-z0-9]*) ([A-Za-z0-9+/]*={0,2})$/.exec(part);if(!match||Object.hasOwn(result,match[1]))P.fail('invalid_request');const raw=Buffer.from(match[2],'base64');if(raw.toString('base64')!==match[2])P.fail('invalid_request');const text=raw.toString('utf8');if(!Buffer.from(text).equals(raw))P.fail('invalid_request');result[match[1]]=text;}P.keys(result,['clientJobId','rootId','directoryId','name','sha256']);return result;}
function decimal(value){if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value))P.fail('invalid_request');const n=Number(value);if(!Number.isSafeInteger(n))P.fail('invalid_request');return n;}
async function createService({config,tls,deps,now,hook}={}) {
  deps??=await dependencies();if(!tls||!tls.key||!tls.cert)P.fail('invalid_request');
  require('node:tls').createSecureContext({...tls,minVersion:'TLSv1.2'});
  const store=await TransferStore.open(config,{now,hook,yazl:deps.yazl});
  class DurableTusStore extends deps.DataStore {
    constructor(){super();this.extensions=['creation','termination','expiration'];}
    async create(upload){await store.createUpload({id:upload.id,metadata:upload.metadata,length:upload.size});return upload;}
    async getUpload(id){const j=await store.uploadInfo(id);return new deps.Upload({id:j.resourceId,size:j.length,offset:j.offset,metadata:j.metadata,creation_date:new Date(j.createdAt).toISOString()});}
    async write(stream,id,offset){return store.writeUpload(id,stream,offset);}
    async remove(id){await store.discard(id,'upload');}
    getExpiration(){return P.LIMITS.jobTtlMs;}
  }
  // Outer store.exclusive holds one exact request. Do not let a new HEAD cancel a PATCH.
  const locker={newLock(){return {async lock(signal){if(signal.aborted)P.fail('closed');},async unlock(){}};}};
  const tus=new deps.Server({path:'/v1/uploads',datastore:new DurableTusStore(),locker,maxSize:P.LIMITS.uploadMaxBytes,
    allowedOrigins:[],respectForwardedHeaders:false,relativeLocation:true,
    namingFunction:()=>randomUUID(),generateUrl:(_req,{id})=>'/v1/uploads/'+id,
    getFileIdFromRequest:(_req,id)=>P.uuid(id)?id:undefined,
    onResponseError:(_req,error)=>({status_code:error.status||error.status_code||500,body:(P.CODES.has(error.code)?error.code:'invalid_request')+'\n'})});
  const authHash=Buffer.from(P.hash(config.token),'hex'),active=new Set(),sockets=new Set();let closing=false,closePromise=null,maintenance=null,maintenanceFailed=false;
  const sweep=()=>{if(closing||maintenance)return maintenance;maintenance=store.cleanup().catch(()=>{maintenanceFailed=true;}).finally(()=>{maintenance=null;});return maintenance;};
  const timer=setInterval(sweep,60000);timer.unref();
  async function dispatch(req,res){
    if(closing)P.fail('closed',503);if(maintenanceFailed)P.fail('recovery_required',503);
    const auth=req.headers.authorization;if(typeof auth!=='string'||auth.length>280||!auth.startsWith('Bearer ')||!timingSafeEqual(authHash,Buffer.from(P.hash(auth.slice(7)),'hex')))P.fail('unauthorized',401);
    if(req.headers['x-transfer-instance']!==config.instanceId)P.fail('instance_mismatch',409);
    if(req.headers.origin||req.headers.cookie||req.headers['content-encoding']||req.headers['transfer-encoding']||/[?%#\\]/.test(req.url)||!/^\/v1\/[a-z0-9/.-]+$/.test(req.url))P.fail('invalid_request');
    if(active.size>8)P.fail('busy',429);store._assert();
    const ok=fields=>json(res,200,{ok:true,instanceId:config.instanceId,...fields});
    if(req.method==='GET'&&req.url==='/v1/capabilities'){ok({protocol:'agent-arcade-transfer/1',tusVersion:'1.0.0',limits:P.LIMITS});return;}
    if(req.method==='GET'&&req.url==='/v1/roots'){ok({roots:store.rootsList()});return;}
    if(req.method==='POST'&&req.url==='/v1/list'){ok(store.list(await body(req)));return;}
    if(req.method==='POST'&&req.url==='/v1/snapshots'){const input=await body(req);if(!P.uuid(input.clientJobId))P.fail('invalid_request');await store.exclusive(input.clientJobId,async()=>ok({job:await store.snapshot(input)}));return;}
    let match=/^\/v1\/jobs\/([a-f0-9-]+)$/.exec(req.url);
    if(req.method==='GET'&&match){const j=store._load(match[1]);await store.exclusive(j.clientJobId,async()=>ok({job:await store.job(match[1])}));return;}
    match=/^\/v1\/uploads\/([a-f0-9-]+)\/finalize$/.exec(req.url);
    if(req.method==='POST'&&match){const input=await body(req);P.keys(input,['clientJobId']);if(!P.uuid(input.clientJobId))P.fail('invalid_request');const j=store._resource(match[1],'upload');await store.exclusive(j.clientJobId,async()=>ok({job:await store.finalize(match[1],input.clientJobId)}));return;}
    match=/^\/v1\/snapshots\/([a-f0-9-]+)(\/content)?$/.exec(req.url);
    if(match){const id=match[1];if(!P.uuid(id))P.fail('invalid_request');
      const captured=store._resource(id,'download');
      if(req.method==='DELETE'&&!match[2]){await store.exclusive(captured.clientJobId,async()=>ok({job:await store.discard(id,'download')}));return;}
      if(['GET','HEAD'].includes(req.method)&&match[2]){await store.exclusive(captured.clientJobId,async()=>{
        const {job:j,fd}=await store.snapshotFile(id);try{const etag='"sha256-'+j.sha256+'"';let start=0,end=j.length-1,status=200;
          const headers={'Content-Type':j.archive?'application/zip':'application/octet-stream','Content-Length':j.length,'Accept-Ranges':'bytes','ETag':etag,'X-Content-SHA256':j.sha256,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
          if(req.headers.range!==undefined){if(req.headers['if-range']!==etag)P.fail('validator_mismatch',412);const r=/^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)?$/.exec(req.headers.range);if(!r)P.fail('range_invalid',400);start=Number(r[1]);end=r[2]===undefined?j.length-1:Number(r[2]);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=j.length||end<start||end>=j.length){res.setHeader('Content-Range','bytes */'+j.length);P.fail('range_invalid',416);}status=206;headers['Content-Range']=`bytes ${start}-${end}/${j.length}`;headers['Content-Length']=end-start+1;}
          res.writeHead(status,headers);if(req.method==='HEAD'||j.length===0){res.end();return;}
          const source=Readable.from((async function*(){const b=Buffer.allocUnsafe(262144);let pos=start;while(pos<=end){const {bytesRead}=await fd.read(b,0,Math.min(b.length,end-pos+1),pos);if(!bytesRead)P.fail('integrity_failed');pos+=bytesRead;yield Buffer.from(b.subarray(0,bytesRead));}})());await pipeline(source,res);
        }finally{await store._closeFile(fd);}
      });return;}
    }
    match=/^\/v1\/uploads(?:\/([a-f0-9-]+))?$/.exec(req.url);
    if(match){const id=match[1];if(id&&!P.uuid(id))P.fail('invalid_request');if(!['POST','PATCH','HEAD','DELETE','OPTIONS'].includes(req.method)||req.method==='POST'&&id||req.method!=='POST'&&req.method!=='OPTIONS'&&!id)P.fail('invalid_request');
      if(req.headers['upload-checksum']||req.headers['upload-concat']||req.headers['upload-defer-length'])P.fail('unsupported');
      let key=id?store._resource(id,'upload').clientJobId:'tus-options';
      if(req.method==='POST'){if(req.headers['content-type']||Number(req.headers['content-length']||0)!==0)P.fail('invalid_request');const metadata=parseMetadata(req.headers['upload-metadata']);if(!P.uuid(metadata.clientJobId))P.fail('invalid_request');decimal(req.headers['upload-length']);key=metadata.clientJobId;}
      if(req.method==='PATCH'){decimal(req.headers['upload-offset']);const length=decimal(req.headers['content-length']);if(length>P.LIMITS.chunkMaxBytes)P.fail('limit',413);}
      await store.exclusive(key,()=>tus.handle(req,res));return;
    }
    P.fail('not_found',404);
  }
  const server=https.createServer({...tls,minVersion:'TLSv1.2',maxHeaderSize:16384},(req,res)=>{
    const task=dispatch(req,res).catch(e=>{if(res.headersSent){res.destroy();return;}json(res,e.status||500,{ok:false,instanceId:config.instanceId,code:P.CODES.has(e.code)?e.code:'storage_failed'});});active.add(task);task.finally(()=>active.delete(task));
  });
  server.requestTimeout=120000;server.headersTimeout=15000;server.keepAliveTimeout=1000;server.maxConnections=16;
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  server.on('clientError',(_err,socket)=>socket.destroy());
  return {server,store,
    async listen({host='127.0.0.1',port=0}={}){try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});return server.address();}catch(e){await this.close();throw e;}},
    async close(){if(closePromise)return closePromise;closing=true;clearInterval(timer);closePromise=(async()=>{const stopped=server.listening?new Promise((resolve,reject)=>server.close(e=>e?reject(new P.TransferError('cleanup_unconfirmed')):resolve())):Promise.resolve();for(const socket of sockets)socket.destroy();await Promise.allSettled([...active]);if(maintenance)await maintenance;await stopped;return store.close();})();try{return await closePromise;}catch(e){closePromise=null;throw e;}}
  };
}
module.exports={createService,dependencies,parseMetadata};
