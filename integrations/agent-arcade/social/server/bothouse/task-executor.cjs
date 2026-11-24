'use strict';
const {execFile,spawn}=require('node:child_process');
const path=require('node:path');
const {textTask}=require('./text-delivery.cjs');

function callBoard(board,action,text,claim){
  return new Promise((resolve,reject)=>{
    const env={};
    for(const key of ['SystemRoot','WINDIR','PATH','TMP','TEMP','TMPDIR','LANG','LC_ALL'])
      if(process.env[key])env[key]=process.env[key];
    const proc=execFile(board.python,['-I','-B','-X','utf8',path.join(__dirname,'work_board.py'),
      board.gate,board.scope,board.role,board.key,action],{windowsHide:true,timeout:6000,maxBuffer:65536,env},(err,stdout)=>{
      if(err)return reject(Error('Bothouse work board unavailable'));
      try{resolve(JSON.parse(stdout));}catch{reject(Error('Invalid board receipt'));}
    });
    proc.stdin.on('error',()=>{});
    proc.stdin.end(JSON.stringify({sender:board.sender,location:board.location,text,claim}));
  });
}

// The claim holder talks only to the role and the local board. Only Friends
// can publish into a conversation, after checking the live permission scope.
async function executeClaim(board,claim,text,run,controller){
  const transform=textTask(text);
  if(!transform)throw Error('Unsupported board task');
  const renew=()=>callBoard(board,'renew',undefined,claim);
  await renew();
  let renewing=false;
  const timer=setInterval(async()=>{
    if(renewing)return;
    renewing=true;
    try{await renew();}catch{controller.abort();}finally{renewing=false;}
  },25000).unref();
  try{
    let action='fail',result;
    try{
      if(controller.signal.aborted)return;
      const answer=await run(transform.prompt,controller.signal);
      if(answer?.error==='receipt_unknown')action='uncertain';
      else {result=transform.render(answer?.text);action='return';}
    }catch{}
    if(!controller.signal.aborted)await callBoard(board,action,result,claim);
  }finally{clearInterval(timer);}
}

function launchBoardTask(data,socketPath){
  // A systemd stop kills the entire Friends cgroup, including detached children.
  // Socket activation gives each claim its own unit under the same service account.
  if(socketPath){
    const socket=require('node:net').createConnection(socketPath);
    return new Promise((resolve,reject)=>{
      let connected=false;
      socket.on('error',error=>{if(!connected)error.beforeDispatch=true;reject(error);});
      socket.once('connect',()=>{connected=true;socket.end(JSON.stringify(data));});
      socket.once('close',resolve);
      socket.unref();
    });
  }
  const env={};
  for(const key of ['PATH','SystemRoot','WINDIR','HOME','USERPROFILE','LOCALAPPDATA','APPDATA','TMP','TEMP','TMPDIR','LANG','LC_ALL','BOTHOUSE_DATA_DIR','CONEST_COLLAB_DATA'])
    if(process.env[key])env[key]=process.env[key];
  if(process.versions.electron)env.ELECTRON_RUN_AS_NODE='1';
  const child=spawn(process.execPath,[__filename],{detached:true,windowsHide:true,env,stdio:['pipe','ignore','ignore']});
  child.stdin.on('error',()=>{});
  child.stdin.end(JSON.stringify(data));
  child.unref();
  return new Promise((resolve,reject)=>{
    child.once('error',error=>{error.beforeDispatch=true;reject(error);});
    child.once('exit',resolve);
  });
}

if(require.main===module)(async()=>{
  let input='';
  process.stdin.setEncoding('utf8');
  for await(const chunk of process.stdin){
    input+=chunk;
    if(input.length>131072)throw Error('Invalid board claim input');
  }
  const {board,claim,text,request,settings}=JSON.parse(input);
  const {localInstance}=require('./directory.cjs');
  const transport=localInstance(process.env,settings);
  await executeClaim(board,claim,text,(prompt,signal)=>transport({...request,text:prompt},{signal}),new AbortController());
})().catch(()=>{process.exitCode=1;});

module.exports={callBoard,executeClaim,launchBoardTask};
