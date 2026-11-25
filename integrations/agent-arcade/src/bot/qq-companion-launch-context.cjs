'use strict';
// Original selected-companion adapter. Private configuration stays in this closure.
const {createHash}=require('node:crypto');
const {QQCompanionLaunch}=require('./qq-companion-launch.cjs');
const {validateQQOwner,validateQQUrl}=require('./qq.cjs');
const fail=code=>{throw Object.assign(Error('QQ companion launch unavailable.'),{code});};
function digest(value){const text=JSON.stringify(value);if(typeof text!=='string'||Buffer.byteLength(text)>65536)fail('unconfigured');return createHash('sha256').update(text).digest('hex');}
function createQQCompanionLaunch({current,connectIntent,onChange,...timing}={}){
  if(typeof current!=='function'||typeof connectIntent!=='function')fail('invalid_request');
  const contexts=new WeakMap();
  function capture({accountId}){
    const initial=current(),{accounts:manager,console:qq,window:win,stopping}=initial;
    if(initial.quitting||!manager||manager.selectedId!==accountId||!win?.isVisible()||win.isMinimized()||win.isDestroyed?.())fail('changed');
    const service=manager.get(accountId),runtime=qq?.runtime,installation=qq?.installationSettings?.current,epoch=qq?.epoch;
    if(!runtime||!installation||qq.closed||qq.selectionIssue)fail('unconfigured');qq.check(runtime,epoch);
    service.assertNotForgetting();
    const config=service.config,secret=service.secret,generation=service.generation;
    let qqAccountId,ownerId,url;
    try{qqAccountId=validateQQOwner(config.qqAccountId);ownerId=validateQQOwner(config.qqOwnerId);url=validateQQUrl(config.qqUrl);}catch{fail('unconfigured');}
    if(config.channel!=='qq'||qqAccountId===ownerId||config.mode==='native'||!Number.isSafeInteger(generation))fail('unconfigured');
    const initialState=service.snapshot(),social=initialState.social?.config?.enabled===true&&initialState.social.supported===true;
    if(initialState.credentialState==='locked')fail('credentials_locked');
    if(initialState.credentialState!=='ready'||!initialState.paired||!social&&!initialState.workspace||['api','gpt','deepseek','gemini','doubao'].includes(config.mode)&&!initialState.hasKey)fail('unconfigured');
    if(!['api','gpt','deepseek','gemini','doubao','claude','codex'].includes(config.mode)||initialState.social?.config?.enabled&&!social)fail('unconfigured');
    if(service.status!=='disconnected'||qq.busy.size||stopping?.has(qqAccountId))fail('operation_in_progress');
    let originalConnection;
    try{originalConnection=qq.profiles(runtime).connection(qqAccountId);}catch{fail('unconfigured');}
    if(originalConnection.accountId!==qqAccountId||validateQQUrl(originalConnection.url)!==url||typeof secret?.qqToken!=='string'||originalConnection.token!==secret.qqToken)fail('unconfigured');
    const privateDigest=digest([config,secret,installation,originalConnection]);
    const character=()=>{const {proactiveMessages,qzonePosts,...settings}=service.socialStore.config();return digest([settings,service.personaOptions()]);};
    const characterDigest=character();let starting=false,ownedConnection=null;
    function assertCurrent({phase='preflight',connection}={}){
      service.assertNotForgetting();
      const live=current();
      if(live.quitting||live.accounts!==manager||live.console!==qq||live.window!==win||manager.selectedId!==accountId||manager.get(accountId)!==service||!win.isVisible()||win.isMinimized()||win.isDestroyed?.()||qq.closed||qq.runtime!==runtime||qq.epoch!==epoch||qq.installationSettings?.current!==installation||service.config!==config||service.secret!==secret)fail('changed');
      qq.check(runtime,epoch);
      if(live.stopping?.has(qqAccountId)||[...qq.busy].some(key=>!starting||key!==qqAccountId))fail('operation_in_progress');
      const rows=manager.snapshot().accounts;
      const candidates=rows.filter(row=>row.channel==='qq'&&[row.accountId,row.expectedQQAccountId,row.qqBinding?.source==='last_verified'?row.qqBinding.accountId:''].includes(qqAccountId));
      const entry=candidates.length===1?candidates[0]:null;
      if(!entry||entry.id!==accountId||entry.expectedQQAccountId!==qqAccountId||entry.qqOwnerId!==ownerId||entry.credentialState!=='ready'||entry.credentialMigration||[entry.accountId,entry.qqBinding?.source==='last_verified'?entry.qqBinding.accountId:''].filter(Boolean).some(id=>id!==qqAccountId))fail('changed');
      let connectionNow;try{connectionNow=qq.profiles(runtime).connection(qqAccountId,originalConnection.serverName);}catch{fail('changed');}
      if(digest([config,secret,installation,connectionNow])!==privateDigest||character()!==characterDigest)fail('changed');
      if(phase==='preflight'){
        if(ownedConnection||service.generation!==generation||service.status!=='disconnected')fail('changed');
      }else if(phase==='connecting'){
        if(!connection||connection.phase!=='connecting'||connection.generation!==generation+1||service.generation!==connection.generation||!connection.controller||service.controller!==connection.controller||connection.controller.signal.aborted||!['connecting','connected'].includes(service.status))fail('changed');
        if(!ownedConnection)ownedConnection={generation:connection.generation,controller:connection.controller};
        if(ownedConnection.generation!==connection.generation||ownedConnection.controller!==connection.controller)fail('changed');
      }else fail('changed');
    }
    assertCurrent();
    const value={accountId,qqAccountId,contextKey:digest([accountId,qqAccountId,ownerId,privateDigest,characterDigest,epoch,generation]),assertCurrent};
    contexts.set(value,{qq,runtime,manager,service,setStarting:value=>{starting=value;}});return value;
  }
  const context=value=>{const result=contexts.get(value);if(!result)fail('changed');return result;};
  return new QQCompanionLaunch({capture,onChange,...timing,
    async refresh(value,options){const {qq}=context(value);options.assertCurrent();const result=await qq.refresh();options.assertCurrent();return result;},
    async start(value,options){const state=context(value);options.assertCurrent();state.setStarting(true);try{return await state.qq.perform('start',{accountId:value.qqAccountId},undefined,options);}finally{state.setStarting(false);}},
    async connect(value,options){
      const {manager,service}=context(value);options.assertCurrent();
      await connectIntent({accountId:value.accountId,qqAccountId:value.qqAccountId,runtimeRevision:options.runtimeRevision},{assertCurrent:options.assertCurrent});
      const entry=manager.snapshot().accounts.find(item=>item.id===value.accountId);
      if(service.status!=='connected'||entry?.status!=='connected'||entry.accountId!==value.qqAccountId||entry.qqBinding?.accountId!==value.qqAccountId)fail('connection_unverified');
      return {accountId:value.accountId,qqAccountId:value.qqAccountId,status:'connected'};
    }
  });
}
module.exports={createQQCompanionLaunch};
