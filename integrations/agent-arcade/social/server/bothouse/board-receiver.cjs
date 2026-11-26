'use strict';
const {callBoard,executeClaim}=require('./task-executor.cjs');
const {requiresExternalWorker,legacyBoardTask}=require('./text-delivery.cjs');
const path=require('node:path');
const {createHash}=require('node:crypto');

// The binding is provided by the already-connected Bothouse directory. Only deployment
// code supplies these paths. Chat callers can supply neither a board nor an executable.
function scopeDirectory(root,number,chat){
  return path.join(root,createHash('sha256').update(JSON.stringify([number,chat])).digest('hex'));
}

function boardReceiver({resolveMember,runTextTask,startBoardTask,textTaskCapability,gate,boardDir,python=process.platform==='win32'?'python':'python3'}){
  if(typeof resolveMember!=='function'||!path.isAbsolute(gate)||!path.isAbsolute(boardDir))
    throw Error('Bothouse work requires the connected role directory and absolute board paths');
  const workers=new Map();
  async function identity(account,number){
    const member=await resolveMember(account,number);
    return member?.number===number&&member.configured===true&&typeof member.id==='string'&&member.id||undefined;
  }
  function boardFor(job){
    return {python,gate,scope:scopeDirectory(boardDir,job.ai,job.chat),role:job.identity,key:job.request,
      sender:job.human,location:'arcade:'+job.chat+'/messages/'+job.prompt};
  }
  async function step(action,job,text,permitted){
    const member=await identity(job.human,job.ai);
    if(!member||member!==job.identity||!permitted())throw Error('Bothouse role binding changed');
    const board=boardFor(job);
    const receipt=await callBoard(board,action,text);
    if(receipt.state!=='accepted')return receipt;
    if(action!=='status'||workers.size>=4||workers.has(job.request)||!permitted())return receipt;
    const turn={account:job.human,number:job.ai,project:job.identity,chat:job.chat,direct:job.direct,
      messageId:job.request+'-'+job.attempt,scope:[job.chat,job.scope,job.request]};
    const capability=runTextTask&&textTaskCapability ? await textTaskCapability(turn) : {defer:'backend'};
    if(!permitted()||await identity(job.human,job.ai)!==job.identity||!permitted())return receipt;
    if(!capability?.available&&capability?.defer!=='backend')throw Error('Executor unavailable');
    if(capability.defer==='backend'&&capability.legacyNative&&legacyBoardTask(text))turn.executor='legacy';
    else turn.executor=capability.executor;
    const handoff=!turn.executor?'backend':
      turn.executor==='native'&&requiresExternalWorker(text)?'external':undefined;
    const claim=await callBoard(board,'claim');
    if(!claim.claimed||!permitted())return claim;
    if(handoff)return callBoard(board,'defer',handoff,claim.claimed);
    // An installed native receiver owns its connection beyond this service process.
    // Embedded receivers keep their existing abortable in-process lifecycle.
    const controller=startBoardTask?null:new AbortController();
    workers.set(job.request,controller);
    const execution=startBoardTask?startBoardTask(turn,{board,claim:claim.claimed,text})
      :executeClaim(board,claim.claimed,text,(prompt,signal)=>runTextTask({...turn,text:prompt},signal),controller);
    void execution.catch(error=>{
      if(error.beforeDispatch)return callBoard(board,'fail',undefined,claim.claimed).catch(()=>{});
    }).finally(()=>workers.delete(job.request));
    return claim;
  }
  return {
    identity,step,
    stop(){for(const controller of workers.values())controller?.abort();},
    cancel(request,job){
      workers.get(request)?.abort();
      if(job?.board_id)void callBoard(boardFor(job),'cancel').catch(()=>{});
    }
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
  return boardReceiver({runTextTask:directory.runTextTask?.bind(directory),startBoardTask:directory.startBoardTask?.bind(directory),
    textTaskCapability:directory.textTaskCapability?.bind(directory),async resolveMember(account,number){
    const role=await directory.resolveMember(account,number);
    if(role&&!role.configured)throw Error('Bothouse role offline');
    if(!role&&directory.list&&(await directory.list(account,number)).directoryStatus==='offline')
      throw Error('Bothouse instance offline');
    return role;
  },
    gate,boardDir,python:env.SOCIAL_BOTHOUSE_PYTHON});
}
module.exports={boardReceiver,scopeDirectory,directoryBoardReceiver};
