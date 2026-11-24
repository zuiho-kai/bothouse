'use strict';

// Only the trusted desktop strip calls this controller. Each fetch uses the
// already-open partition for its own origin. The game capability stays here.
const codeError=code=>Object.assign(new Error(code),{code});
const result=(state,connected=false)=>({state,connected});

function worldResidentControls({account,worldOrigin,socialOrigin,world,friends,current,onRollback=()=>{}}) {
  let busy=false;
  const check=()=>{if(!current())throw codeError('closed');};
  async function call(session,url,body){
    const response=await session.fetch(url,{
      method:body?'POST':'GET',credentials:'include',cache:'no-store',redirect:'error',
      signal:AbortSignal.timeout(body?.token?60000:7000),
      ...(body&&{headers:{'Content-Type':'application/json',Origin:new URL(url).origin},body:JSON.stringify(body)})
    });
    let data;
    try{data=await response.json();}catch{throw codeError('unavailable');}
    if(!response.ok)throw Object.assign(codeError(data?.error?.code||'unavailable'),{status:response.status});
    return data;
  }
  const game=body=>call(world,worldOrigin+'/api/app-residents',body);
  const service=body=>call(friends,socialOrigin+'/api/v1/planet-residents',body);
  const protectedService=body=>service({...body,expectedAccount:account});
  return async function act(action){
    if(!current()||busy)return result(busy?'busy':'closed');
    busy=true;
    let linked=false;
    try{
      const home=await game();
      check();
      if(!home.owned)return result('home');
      linked=home.connected===true;
      if(action==='disconnect'){
        if(linked){
          const serviceState=await service().catch(()=>null);
          check();
          if(serviceState && serviceState.account!==account)return result('login',true);
          await game({action:'disconnect',sourceId:home.sourceId});
          check();
          linked=false;
          // Revoking at the world already invalidated this slot's capability.
          // A stale service job cannot publish even if the service is offline.
          await protectedService({action:'disconnect',sourceId:home.sourceId}).catch(()=>{});
        }
        return result('disconnected');
      }
      const publisher=await service();
      check();
      if(publisher.account!==account)return result('login',linked);
      if(!publisher.available || publisher.worldOrigin!==worldOrigin)return result('configuration',linked);
      if(publisher.active){
        if(linked&&publisher.sourceId===home.sourceId)return result('connected',true);
        return result('other',linked);
      }
      if(action!=='connect' && !(action==='open'&&linked))return result(linked?'paused':'ready',linked);
      const issued=await game({action:'connect',account,socialOrigin});
      try{
        if(!/^[a-f0-9]{64}$/u.test(issued.token)||typeof issued.sourceId!=='string')throw codeError('unavailable');
        check();
        const after=await protectedService({action:'connect',worldOrigin,sourceId:issued.sourceId,token:issued.token});
        check();
        if(after.account!==account||after.active!==true||after.sourceId!==issued.sourceId)throw codeError('unavailable');
      }catch(error){
        // Only undo a first opt-in and only if it still has our capability.
        // Existing owners retain their choice across a temporary service outage.
        if(!linked && issued.token){
          onRollback(true);
          try{await game({action:'disconnect',ifToken:issued.token});}catch{}finally{onRollback(false);}
        }
        throw error;
      }
      return result('connected',true);
    }catch(error){
      if(!current())return result('closed');
      const known={planet_empty:'roles',planet_in_use:'other',planet_unavailable:'unavailable',
        planet_config:'configuration',planet_session:'login',planet_busy:'capacity',planet_binding:'session'};
      if(Object.hasOwn(known,error.code))return result(known[error.code],linked);
      if(error.status===401)return result('session',linked);
      if(error.status===403)return result('home',linked);
      if(error.status===409)return result('other',linked);
      return result('unavailable',linked);
    }finally{busy=false;}
  };
}
module.exports={worldResidentControls};
