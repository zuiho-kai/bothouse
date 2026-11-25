'use strict';

const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {RELEASE,MacQQBridgeError,inspectMacQQBridgeAsync,prepareMacQQBridgeAsync,readPreparedMacQQ,readMacQQLaunch,linkMacQQLaunch}=require('./mac-qq-bridge.cjs');
const {DEFAULT_QQ_URL,validateQQOwner}=require('./qq.cjs');

const RELEASE_URL=`https://github.com/LuckyLilliaDev/LuckyLilliaBot/releases/tag/v${RELEASE.version}`;
const AUTH_URL='https://auth.luckylillia.com/';
const SETUP_CODES=new Set([
  'unsupported_platform','changed','invalid_request','operation_in_progress','stale_ticket',
  'unsafe_path','runtime_incomplete','runtime_changed','runtime_signature_unverified','node_signature_unverified',
  'node_not_executable','node_version_unverified','target_exists','invalid_configuration','preparation_failed',
  'stale_preparation','prepared_configuration_changed','existing_connection','save_failed','credentials_locked','credentials_busy','port_in_use',
  'launch_missing','launch_changed','launch_unavailable',
]);
const cancel=()=>({ok:true,cancelled:true});
const fail=code=>{throw new MacQQBridgeError(code);};
const NODE_ERRORS=new Set(['node_signature_unverified','node_not_executable','node_version_unverified']);
const hasFields=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===fields.length&&fields.every(key=>Object.hasOwn(value,key));
const sameScope=(left,right)=>left.profileId===right.profileId&&left.service===right.service&&
  left.generation===right.generation&&left.mode===right.mode&&left.revision===right.revision;
const pickedPath=value=>typeof value==='string'&&path.isAbsolute(value)&&path.normalize(value)===value&&value.length<=4096&&!/[\p{Cc}\p{Cf}]/u.test(value);
const defaultPort=Number(new URL(DEFAULT_QQ_URL).port);
function recommendPort(configured){
  let port=defaultPort;
  while(configured.has(port))port++;
  return port;
}

async function runMacQQSetup(operation,args,beforeWrite){
  if(operation==='inspect')return inspectMacQQBridgeAsync(args.runtimeRoot,{nodeExecutable:args.nodeExecutable});
  return prepareMacQQBridgeAsync(args,beforeWrite);
}

function createMacQQSetup({getScope,getLaunchScope=getScope,getConfiguredPorts=()=>new Set(),openDialog,saveDialog,run=runMacQQSetup,
  readConnection=readPreparedMacQQ,readLaunch=readMacQQLaunch,linkLaunch=linkMacQQLaunch,openRelease,reveal,copy,now=Date.now}){
  let ticket,prepared,failedRuntime,revision=0,busy=false;
  const capture=(launch=false)=>({...(launch?getLaunchScope():getScope()),revision});
  const current=(scope,launch=false)=>{if(!sameScope(scope,capture(launch)))fail('changed');};
  const checkPort=(scope,port)=>{
    const configured=getConfiguredPorts(scope.profileId);
    if(configured.has(port))throw Object.assign(new MacQQBridgeError('port_in_use'),{recommendedPort:recommendPort(configured)});
  };
  const attempt=async(action,{exclusive=true}={})=>{
    if(exclusive&&busy)return {ok:false,code:'operation_in_progress'};
    if(exclusive)busy=true;
    try{return await action();}
    catch(error){
      if(error?.code==='port_in_use'&&Number.isInteger(error.recommendedPort))return {ok:false,code:'port_in_use',recommendedPort:error.recommendedPort};
      return {ok:false,code:SETUP_CODES.has(error?.code)?error.code:'preparation_failed'};
    }
    finally{if(exclusive)busy=false;}
  };
  const openPath=async(kind,scope,launch=false)=>{
    const picked=await openDialog(kind);
    current(scope,launch);
    if(picked?.canceled===true)return null;
    if(!Array.isArray(picked?.filePaths)||picked.filePaths.length!==1||!pickedPath(picked.filePaths[0]))fail('unsafe_path');
    return picked.filePaths[0];
  };
  function scopedLaunch(value,{offline=false}={}){
    if(!hasFields(value,['profileId'])||typeof value.profileId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(value.profileId))fail('invalid_request');
    const scope=capture(true);
    if(value.profileId!==scope.profileId||offline&&scope.service.status!=='disconnected')fail('changed');
    return scope;
  }
  function launchStatus(scope){
    if(scope.service.credentialState==='locked')return {state:'locked'};
    const connection=scope.service.currentQQLaunchConnection();
    if(!connection)return {state:'not_configured'};
    const launch=scope.service.config.qqMacLaunch;
    return launch?readLaunch(launch,connection):{state:'unlinked'};
  }
  function launchAction(value,{offline=false,action}){
    return attempt(async()=>{
      const scope=scopedLaunch(value,{offline}), status=launchStatus(scope);
      if(status.state!=='ready')fail(status.state==='missing'?'launch_missing':status.state==='changed'?'launch_changed':'launch_unavailable');
      current(scope,true);
      await action(status);
      return {ok:true};
    });
  }
  return {
    invalidate:()=>{revision++;ticket=null;prepared=null;failedRuntime=null;},
    inspect:value=>attempt(async()=>{
      const retry=hasFields(value,['withNode','reuseRuntime'])&&value.withNode===true&&value.reuseRuntime===true;
      if(!retry&&(!hasFields(value,['withNode'])||typeof value.withNode!=='boolean'))fail('invalid_request');
      const scope=capture();
      if(retry&&(!failedRuntime||!sameScope(failedRuntime.scope,scope)))fail('stale_ticket');
      const runtimeRoot=retry?failedRuntime.runtimeRoot:await openPath('runtime',scope);
      if(!runtimeRoot)return cancel();
      let nodeExecutable;
      if(value.withNode){
        nodeExecutable=await openPath('node',scope);
        if(!nodeExecutable)return cancel();
      }
      ticket=null;
      failedRuntime=null;
      let result;
      try{result=await run('inspect',{runtimeRoot,nodeExecutable});}
      catch(error){
        current(scope);
        if(NODE_ERRORS.has(error?.code))failedRuntime={scope,runtimeRoot};
        throw error;
      }
      current(scope);
      ticket={id:randomUUID(),scope,runtimeRoot,nodeExecutable,expiresAt:now()+10*60*1000};
      return {ok:true,ticketId:ticket.id,release:result.release,nodeVersion:result.nodeVersion,
        filesChecked:result.files.length,warning:result.warning,recommendedPort:recommendPort(getConfiguredPorts(scope.profileId))};
    }),
    prepare:value=>attempt(async()=>{
      if(!hasFields(value,['ticketId','accountId','port'])||typeof value.ticketId!=='string')fail('invalid_request');
      if(typeof value.accountId!=='string'||!Number.isSafeInteger(value.port)||value.port<1024||value.port>65535)fail('invalid_configuration');
      let accountId;
      try{accountId=validateQQOwner(value.accountId);}catch{fail('invalid_configuration');}
      const scope=capture(),checked=ticket;
      if(accountId===scope.service.config?.qqOwnerId)fail('invalid_configuration');
      if(!checked||value.ticketId!==checked.id||now()>=checked.expiresAt||!sameScope(checked.scope,scope))fail('stale_ticket');
      checkPort(scope,value.port);
      const picked=await saveDialog();
      current(scope);
      if(picked?.canceled===true)return cancel();
      if(!pickedPath(picked?.filePath))fail('unsafe_path');
      const assertWritable=()=>{
        current(scope);
        if(now()>=checked.expiresAt)fail('stale_ticket');
        if(accountId===scope.service.config?.qqOwnerId)fail('invalid_configuration');
        checkPort(scope,value.port);
      };
      assertWritable();
      const result=await run('prepare',{runtimeRoot:checked.runtimeRoot,nodeExecutable:checked.nodeExecutable,
        targetDirectory:picked.filePath,accountId,port:value.port},assertWritable);
      ticket=null;
      current(scope);
      prepared={id:randomUUID(),scope,result,port:value.port};
      return {ok:true,prepared:true,preparedId:prepared.id,accountId,targetDirectory:result.targetDirectory,endpoint:result.endpoint,
        configFile:result.configFile,tokenFile:result.tokenFile};
    }),
    usePrepared:value=>attempt(async()=>{
      if(!hasFields(value,['preparedId'])||typeof value.preparedId!=='string')fail('invalid_request');
      const choice=prepared;
      if(!choice||value.preparedId!==choice.id)fail('stale_preparation');
      current(choice.scope);
      checkPort(choice.scope,choice.port);
      const connection=readConnection(choice.result);
      try{choice.scope.service.usePreparedQQ(connection);}
      catch(error){fail(SETUP_CODES.has(error?.code)?error.code:'save_failed');}
      prepared=null;
      return {ok:true,saved:true};
    }),
    launchStatus:value=>attempt(async()=>{
      const {state,targetDirectory,authorization}=launchStatus(scopedLaunch(value));
      return {ok:true,state,...(targetDirectory?{targetDirectory}:{}),...(authorization?{authorization}:{})};
    },{exclusive:false}),
    launchReveal:value=>launchAction(value,{action:status=>reveal(path.join(status.targetDirectory,'launch-plan.json'))}),
    launchCopy:value=>launchAction(value,{offline:true,action:status=>{
      if(!status.command)fail('launch_unavailable');
      return copy(status.command);
    }}),
    launchAuth:value=>launchAction(value,{action:()=>openRelease(AUTH_URL)}),
    launchRelink:value=>attempt(async()=>{
      const scope=scopedLaunch(value,{offline:true}), connection=scope.service.currentQQLaunchConnection();
      if(!connection)fail('launch_unavailable');
      const directory=await openPath('prepared',scope,true);
      if(!directory)return cancel();
      const linked=await linkLaunch(directory,connection);
      current(scope,true);
      try{scope.service.linkPreparedQQ(connection,linked);}
      catch(error){fail(SETUP_CODES.has(error?.code)?error.code:'save_failed');}
      return {ok:true};
    }),
    guide:async()=>{
      await openRelease(RELEASE_URL);
      return {ok:true};
    },
  };
}

module.exports={createMacQQSetup};
