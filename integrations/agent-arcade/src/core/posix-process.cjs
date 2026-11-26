'use strict';

// Only use a separately created, currently owned process group. The optional
// verifier checks that identity again immediately before each real signal.
async function terminateProcessGroup(groupId,{timeoutMs=2000,killImpl=process.kill.bind(process),beforeSignal=()=>true,isGone}={}){
  if(!Number.isSafeInteger(groupId)||groupId<=1||groupId===process.pid)return false;
  const signal=value=>{
    try{killImpl(-groupId,value);return true;}
    catch(error){if(error.code==='ESRCH')return false;throw error;}
  };
  const checkGone=isGone||(()=>!signal(0));
  const gone=async()=>{
    const until=Date.now()+timeoutMs;
    do{if(await checkGone())return true;await new Promise(resolve=>setTimeout(resolve,20));}while(Date.now()<until);
    return checkGone();
  };
  if(!await beforeSignal()||!signal('SIGTERM'))return true;
  if(await gone())return true;
  if(!await beforeSignal()||!signal('SIGKILL'))return true;
  return gone();
}

module.exports={terminateProcessGroup};
