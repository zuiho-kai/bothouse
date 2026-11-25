'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {pipeline}=require('node:stream/promises');

function loadPublicSource(root){
  const metadata=path.join(root,'source-release.json');
  const file=path.join(root,'source.zip');
  if(!fs.existsSync(metadata)&&!fs.existsSync(file))return null;
  if(!fs.lstatSync(metadata).isFile()||!fs.lstatSync(file).isFile())throw Error('Invalid source release files');
  const {version,commit,sha256,bytes}=JSON.parse(fs.readFileSync(metadata,'utf8'));
  if(!/^[1-9]\d{0,4}(?:\.\d{1,5}){2}\.0$/u.test(version)||!/^[a-f0-9]{40}$/u.test(commit)||
      !/^[a-f0-9]{64}$/u.test(sha256)||!Number.isSafeInteger(bytes)||bytes<=0)throw Error('Invalid source release metadata');
  const input=fs.openSync(file,'r');
  let stat;
  try{
    stat=fs.fstatSync(input);
    if(stat.size!==bytes)throw Error('Frozen source size mismatch');
    const hash=createHash('sha256'),buffer=Buffer.alloc(256*1024);
    let length;
    while((length=fs.readSync(input,buffer))>0)hash.update(buffer.subarray(0,length));
    if(hash.digest('hex')!==sha256)throw Error('Frozen source digest mismatch');
  }finally{fs.closeSync(input);}
  return {version,commit,sha256,bytes,file,stat,route:'/source/'+commit+'/'+sha256+'.zip'};
}

function sourceDetails(source){
  if(!source)return '<p>此部署尚未提供可下载的对应版本源码。</p>';
  return '<p>当前好友服务版本 '+source.version+' · <code>'+source.commit+'</code></p>'+
    '<p><a href="'+source.route+'">下载本版好友服务对应源码 ZIP</a></p>'+
    '<p>SHA-256 <code>'+source.sha256+'</code></p>';
}

async function sendPublicSource(req,res,source){
  const input=await fs.promises.open(source.file,'r').catch(()=>null);
  if(!input){res.writeHead(404);res.end();return;}
  try{
    const stat=await input.stat();
    if(stat.ino!==source.stat.ino||stat.size!==source.bytes||
        stat.mtimeMs!==source.stat.mtimeMs||stat.ctimeMs!==source.stat.ctimeMs){
      res.writeHead(404);res.end();return;
    }
    res.setHeader('Content-Type','application/zip');
    res.setHeader('Content-Length',source.bytes);
    res.setHeader('Content-Disposition','attachment; filename="AgentArcade-Service-'+source.version+'-'+source.commit+'.zip"');
    if(req.method==='HEAD')res.end();
    else await pipeline(input.createReadStream({autoClose:false}),res);
  }finally{await input.close();}
}

module.exports={loadPublicSource,sourceDetails,sendPublicSource};
