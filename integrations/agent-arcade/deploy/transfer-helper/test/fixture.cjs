'use strict';
// Only synthetic credentials, public test TLS material and newly created temporary trees.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),https=require('node:https');
const {randomUUID}=require('node:crypto');
const TLS=require('../../../test/helpers/qq-remote-tls-fixture.cjs');
const {createService,dependencies}=require('../../../src/transfer-helper/server.cjs');
const P=require('../../../src/transfer-helper/policy.cjs');
async function fixture(t,options={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-transfer-test-'));
  const dirs={state:path.join(root,'state'),files:path.join(root,'files'),staging:path.join(root,'staging')};for(const d of Object.values(dirs))fs.mkdirSync(d);
  const config={instanceId:randomUUID(),stateDir:dirs.state,token:'synthetic_transfer_only_not_a_real_credential_123456',roots:[{rootId:'files',label:'Synthetic files',path:dirs.files,read:true,upload:true,stagingDir:dirs.staging}]};
  const f={root,dirs,config,service:null,port:null,options};
  f.start=async()=>{f.service=await createService({config,tls:TLS,...options});f.port=(await f.service.listen()).port;};
  f.close=async()=>{if(f.service){await f.service.close();f.service=null;}};
  f.request=(method,url,{json,bytes,headers={}}={})=>new Promise((resolve,reject)=>{
    let data=bytes;if(json!==undefined){data=Buffer.from(JSON.stringify(json));headers={'Content-Type':'application/json',...headers};}if(data)headers={'Content-Length':data.length,...headers};
    const req=https.request({hostname:'127.0.0.1',port:f.port,servername:'remote.arcade.invalid',ca:TLS.caPem,method,path:url,agent:false,headers:{Authorization:'Bearer '+config.token,'X-Transfer-Instance':config.instanceId,...headers}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('error',reject);res.on('end',()=>{const body=Buffer.concat(chunks);let parsed;try{parsed=JSON.parse(body);}catch{}resolve({status:res.statusCode,headers:res.headers,bytes:body,json:parsed});});});req.on('error',reject);req.end(data);
  });
  f.list=()=>f.request('POST','/v1/list',{json:{rootId:'files',directoryId:null}}).then(r=>r.json);
  f.createUpload=async(bytes,name='new.bin')=>{const list=await f.list(),metadata={clientJobId:randomUUID(),rootId:'files',directoryId:list.directory.directoryId,name,sha256:P.hash(bytes)};
    const encoded=Object.entries(metadata).map(([k,v])=>k+' '+Buffer.from(v).toString('base64')).join(',');const r=await f.request('POST','/v1/uploads',{headers:{'Tus-Resumable':'1.0.0','Upload-Length':String(bytes.length),'Upload-Metadata':encoded,'Content-Length':'0'}});
    return {response:r,metadata,url:r.headers.location,clientJobId:metadata.clientJobId};};
  f.patch=(u,bytes,offset=0)=>f.request('PATCH',u.url,{bytes,headers:{'Tus-Resumable':'1.0.0','Upload-Offset':String(offset),'Content-Type':'application/offset+octet-stream'}});
  f.head=u=>f.request('HEAD',u.url,{headers:{'Tus-Resumable':'1.0.0'}});
  f.job=u=>f.request('GET','/v1/jobs/'+u.clientJobId).then(x=>x.json);
  f.finalize=u=>f.request('POST',u.url+'/finalize',{json:{clientJobId:u.clientJobId}});
  t.after(async()=>{await f.close();fs.rmSync(root,{recursive:true,force:true});});await f.start();return f;
}
module.exports={fixture,TLS,P,dependencies};
