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
  async function step(action,job,text,permitted,progress){
    const member=await identity(job.human,job.ai);
    if(!member||member!==job.identity||!permitted())throw Error('Bothouse role binding changed');
    const receipt=await call(action,job,text);
    if(action!=='status'||!runTextTask||receipt.state!=='accepted')return receipt;
    const transform=textTask(text);
    if(!transform||!permitted())return receipt;
    const claim=await call('claim',job);
    if(!claim.claimed)return claim;
    try{
      progress(claim);
      if(!permitted()||await identity(job.human,job.ai)!==job.identity)throw Error('Role access revoked');
      const answer=await runTextTask({account:job.human,number:job.ai,chat:job.chat,direct:job.direct,
        messageId:job.request+'-'+job.attempt,scope:[job.chat,job.scope,job.request],text:transform.prompt});
      if(!permitted()||await identity(job.human,job.ai)!==job.identity)throw Error('Role access revoked');
      return await call('return',job,transform.render(answer?.text),claim.claimed);
    }catch{return call('fail',job,undefined,claim.claimed);}
  }
  return {identity,step};
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
