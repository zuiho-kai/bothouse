'use strict';
const {execFile}=require('node:child_process');
const {textTask}=require('./text-delivery.cjs');
const path=require('node:path');
const {createHash}=require('node:crypto');

// The binding is provided by the already-connected Bothouse directory. Only deployment
// code supplies these paths. Chat callers can supply neither a board nor an executable.
function scopeDirectory(root,number,chat){
  return path.join(root,createHash('sha256').update(JSON.stringify([number,chat])).digest('hex'));
}

function boardReceiver({resolveMember,runTextTask,gate,boardDir,python=process.platform==='win32'?'python':'python3'}){
  if(typeof resolveMember!=='function'||!path.isAbsolute(gate)||!path.isAbsolute(boardDir))
    throw Error('Bothouse work requires the connected role directory and absolute board paths');
  const workers=new Map();
  async function identity(account,number){
    const member=await resolveMember(account,number);
    return member?.number===number&&member.configured===true&&typeof member.id==='string'&&member.id||undefined;
  }
  function call(action,job,text,claim){
    const member=job.identity;
    return new Promise((resolve,reject)=>{
      const env={};
      for(const key of ['SystemRoot','WINDIR','PATH','TMP','TEMP','TMPDIR','LANG','LC_ALL'])
        if(process.env[key])env[key]=process.env[key];
      const proc=execFile(python,['-I','-B','-X','utf8',path.join(__dirname,'work_board.py'),
        gate,scopeDirectory(boardDir,job.ai,job.chat),member,job.request,action],{windowsHide:true,timeout:6000,maxBuffer:65536,env},
      (err,stdout)=>{
        if(err)return reject(Error('Bothouse work board unavailable'));
        try{resolve(JSON.parse(stdout));}catch{reject(Error('Invalid board receipt'));}
      });
      proc.stdin.on('error',()=>{});
      proc.stdin.end(JSON.stringify({sender:job.human,location:'arcade:'+job.chat+'/messages/'+job.prompt,text,claim}));
    });
  }
  function run(job,transform,claim,permitted){
    const controller=new AbortController();
    const {signal}=controller;
    let renewing=false;
    const renewable=setInterval(async()=>{
      if(!permitted()){controller.abort();return;}
      if(renewing)return;
      renewing=true;
      try{await call('renew',job,undefined,claim);}catch{controller.abort();}
      finally{renewing=false;}
    },25000).unref();
    const execute=async()=>{
      let action='fail',result;
      try{
        if(!permitted()||await identity(job.human,job.ai)!==job.identity||!permitted())return;
        const answer=await runTextTask({account:job.human,number:job.ai,chat:job.chat,direct:job.direct,
          messageId:job.request+'-'+job.attempt,scope:[job.chat,job.scope,job.request],text:transform.prompt},signal);
        if(signal.aborted||!permitted())return;
        if(answer?.error==='receipt_unknown')action='uncertain';
        else {result=transform.render(answer?.text);action='return';}
      }catch{}
      if(!signal.aborted&&permitted())await call(action,job,result,claim);
    };
    workers.set(job.request,controller);
    void execute().catch(()=>{}).finally(()=>{
      clearInterval(renewable);
      workers.delete(job.request);
    });
  }
  async function step(action,job,text,permitted){
    const member=await identity(job.human,job.ai);
    if(!member||member!==job.identity||!permitted())throw Error('Bothouse role binding changed');
    const receipt=await call(action,job,text);
    if(receipt.state!=='accepted')return receipt;
    const transform=runTextTask&&textTask(text);
    if(!transform)return {...receipt,awaitingWorker:true};
    if(action!=='status'||workers.size>=4||workers.has(job.request)||!permitted())return receipt;
    const claim=await call('claim',job);
    if(!claim.claimed)return claim;
    run(job,transform,claim.claimed,permitted);
    return claim;
  }
  return {
    identity,step,
    stop(){for(const controller of workers.values())controller.abort();},
    cancel(request){workers.get(request)?.abort();}
  };
}
function directoryBoardReceiver(directory,filename,env=process.env){
  if(!directory)return;
  const {existsSync}=require('node:fs');
  const home=require('node:os').homedir();
  const current=path.join(home,'.bothouse'),legacy=path.join(home,'.cc-connect');
  const installed=env.BOTHOUSE_DATA_DIR||(existsSync(current)||!existsSync(legacy)?current:legacy);
  const gate=env.SOCIAL_BOTHOUSE_GATE||path.join(installed,'gate');
  const boardDir=env.SOCIAL_BOTHOUSE_WORK_DIR||(filename&&path.join(path.dirname(filename),'bothouse-work'));
  if(!boardDir||!existsSync(path.join(gate,'board.py')))return;
  return boardReceiver({runTextTask:directory.runTextTask?.bind(directory),async resolveMember(account,number){
    const role=await directory.resolveMember(account,number);
    if(role&&!role.configured)throw Error('Bothouse role offline');
    if(!role&&directory.list&&(await directory.list(account,number)).directoryStatus==='offline')
      throw Error('Bothouse instance offline');
    return role;
  },
    gate,boardDir,python:env.SOCIAL_BOTHOUSE_PYTHON});
}
module.exports={boardReceiver,scopeDirectory,directoryBoardReceiver};
