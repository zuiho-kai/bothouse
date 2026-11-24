'use strict';

// One explicit foreground action. Runtime ownership and connection authority
// remain with the existing runtime and BotService guards, never this sequence.
const LAUNCH_LIMITS=Object.freeze({waitMs:60000,intervalMs:2000});
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const PROFILE=/^[a-zA-Z0-9-]{1,64}$/;
const QQ=/^[1-9]\d{4,14}$/;
const CODES=new Set(['invalid_request','changed','cancelled','operation_in_progress','manager_closing','launch_limit','invalid_response','connection_unconfirmed','login_timeout','clock_changed',
  'unconfigured','credentials_locked','credentials_empty','credentials_busy','unsupported_channel','unsupported_mode','workspace_required','account_connected','account_in_use','account_mismatch','account_changed','invalid_owner','unauthorized','login_required','status_unverified','connection_failed','connection_unverified','timeout',
  'installation_selection_invalid','installation_selection_changed','managed_installation_changed','component_changed','missing_components','invalid_installation','unsupported_platform','desktop_running','external_process','external_qq_unknown','runtime_locked','process_check_failed','ownership_lost','not_owned','recovery_required','owner_alive','orphaned_children','runtime_running','runtime_not_running','endpoint_unverified','webui_config_not_local','configuration_cleanup_unverified','component_lock_state_unverified',
  'start_failed','start_unverified','start_cancelled','start_context_changed','start_guard_invalid','node_repair_pending','node_repair_busy','deployment_recovery_required','pending_upstream_update','passkey_maintenance_required','operation_failed']);
const codeOf=error=>CODES.has(error?.code)?error.code:'operation_failed';
const fail=code=>Object.assign(new Error('QQ companion launch unavailable.'),{code:CODES.has(code)?code:'operation_failed'});
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function qqCompanionLaunchRequest(value,action='launch'){
  const keys=action==='inspect'?['accountId']:['accountId','operationId'];
  if(!['inspect','launch','cancel'].includes(action)||!record(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key))||typeof value.accountId!=='string'||!PROFILE.test(value.accountId)||(action!=='inspect'&&(typeof value.operationId!=='string'||!UUID.test(value.operationId))))throw fail('invalid_request');
  return {accountId:value.accountId,...(action==='inspect'?{}:{operationId:value.operationId})};
}
async function qqCompanionLaunchResult(input,operation){
  try{return {ok:true,...await operation()};}catch(error){return {ok:false,accountId:typeof input?.accountId==='string'&&PROFILE.test(input.accountId)?input.accountId:null,code:codeOf(error)};}
}
function sync(fn,value){const result=fn(value);if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw fail('changed');}return result;}
function pause(ms,signal){return new Promise(resolve=>{if(signal.aborted)return resolve();const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();},timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});});}
class QQCompanionLaunch{
  constructor({capture,refresh,start,connect,onChange=()=>{},monotonic=()=>performance.now(),sleep=pause}={}){
    if([capture,refresh,start,connect,onChange,monotonic,sleep].some(fn=>typeof fn!=='function'))throw fail('invalid_request');
    Object.assign(this,{capture,refresh,start,connect,onChange,monotonic,sleep});this.active=null;this.closed=false;this.used=new Set();
  }
  _capture(input){
    const cap=sync(this.capture,input);
    if(!cap||cap.accountId!==input.accountId||typeof cap.qqAccountId!=='string'||!QQ.test(cap.qqAccountId)||typeof cap.contextKey!=='string'||!/^[a-f0-9]{64}$/.test(cap.contextKey)||typeof cap.assertCurrent!=='function')throw fail('changed');
    sync(cap.assertCurrent,{phase:'preflight'});return cap;
  }
  inspect(input){
    const value=qqCompanionLaunchRequest(input,'inspect');if(this.closed)throw fail('manager_closing');
    try{const cap=this._capture(value);return {...value,available:!this.active,qqAccountId:cap.qqAccountId,reason:this.active?'operation_in_progress':null,limits:{...LAUNCH_LIMITS},active:this.snapshot()};}
    catch(error){return {...value,available:false,qqAccountId:null,reason:codeOf(error),limits:{...LAUNCH_LIMITS},active:this.snapshot()};}
  }
  snapshot(){const op=this.active;return op?{accountId:op.accountId,operationId:op.operationId,qqAccountId:op.cap.qqAccountId,phase:op.phase}:null;}
  _changed(){try{this.onChange(this.snapshot());}catch{/* Optional display notification is not authority. */}}
  _phase(op,phase){op.phase=phase;this._changed();}
  _check(op,connection){
    if(this.closed||this.active!==op||op.controller.signal.aborted)throw fail('cancelled');
    sync(op.cap.assertCurrent,connection&&connection.phase!=='preflight'?{phase:'connecting',connection}:{phase:'preflight'});
  }
  _clock(op){const n=this.monotonic();if(!Number.isFinite(n)||n<0||op.clock!==null&&n<op.clock)throw fail('clock_changed');op.clock=n;return n;}
  _options(op){return {signal:op.controller.signal,assertCurrent:connection=>this._check(op,connection)};}
  _observe(op,result){
    const state=result?.state||result;
    if(!state||!Array.isArray(state.instances)||state.instances.length>32)throw fail('invalid_response');
    const rows=state.instances.filter(row=>row?.accountId===op.cap.qqAccountId);if(rows.length!==1)throw fail('changed');
    const row=rows[0];
    if(typeof row.processRunning!=='boolean'||typeof row.canStart!=='boolean'||typeof row.recoveryRequired!=='boolean'||!['owned','unknown','recoverable','external','stopped'].includes(row.management))throw fail('invalid_response');
    op.receipt.qqRunning=row.processRunning;
    const login=row.login;
    if(login&&typeof login==='object'&&['stopped','online','login_required','offline','reconnecting','initializing','unknown'].includes(login.state))op.receipt.loginState=login.state;
    else op.receipt.loginState='unknown';
    if(login?.accountId!==undefined&&login.accountId!==op.cap.qqAccountId||login?.issue==='account_mismatch')throw fail('account_mismatch');
    if(row.recoveryRequired)throw fail('recovery_required');
    if(row.reason)throw fail(CODES.has(row.reason)?row.reason:'status_unverified');
    if(state.desktopRunning===true)throw fail('desktop_running');
    if(row.management==='external')throw fail('external_process');
    if(row.processRunning&&row.management!=='owned')throw fail('ownership_lost');
    return row;
  }
  _finish(op,outcome,code=null){op.receipt.outcome=outcome;op.receipt.code=code;return {...op.receipt};}
  async _run(op){
    try{
      this._check(op);let row=this._observe(op,await this.refresh(op.cap,this._options(op)));this._check(op);
      if(!row.processRunning){
        if(row.management!=='stopped'||!row.canStart)throw fail('runtime_not_running');
        this._phase(op,'starting');this._check(op);op.receipt.startAttempted=true;op.receipt.qqRunning=null;
        const result=await this.start(op.cap,this._options(op));
        // Preserve a received runtime observation even when cancellation arrived
        // after spawn. No cancellation path calls stop or another start.
        row=this._observe(op,result);this._check(op);
      }
      const deadline=this._clock(op)+LAUNCH_LIMITS.waitMs;let observations=0;
      while(true){
        this._check(op);
        if(this._clock(op)>=deadline)return this._finish(op,'timed_out','login_timeout');
        if(!row.processRunning)throw fail('runtime_not_running');
        const login=row.login;
        if(login?.state==='login_required')return this._finish(op,'login_required','login_required');
        if(login?.state==='online'&&login.online===true&&login.identityVerified===true&&login.accountId===op.cap.qqAccountId){
          if(typeof row.runtimeRevision!=='string'||!UUID.test(row.runtimeRevision))throw fail('status_unverified');
          this._phase(op,'connecting');this._check(op);op.receipt.connectionAttempted=true;
          const value=await this.connect(op.cap,{...this._options(op),runtimeRevision:row.runtimeRevision});
          if(!value||value.accountId!==op.accountId||value.qqAccountId!==op.cap.qqAccountId||value.status!=='connected')throw fail('connection_unconfirmed');
          // A received positive connection receipt is not erased by a late local
          // cancellation. The renderer must still honor its own scope lifetime.
          op.receipt.connectionVerified=true;return this._finish(op,'connected');
        }
        const remaining=deadline-this._clock(op);if(remaining<=0||observations>=30)return this._finish(op,'timed_out','login_timeout');
        this._phase(op,'waiting_login');await this.sleep(Math.min(LAUNCH_LIMITS.intervalMs,remaining),op.controller.signal);this._check(op);
        if(this._clock(op)>=deadline)return this._finish(op,'timed_out','login_timeout');
        row=this._observe(op,await this.refresh(op.cap,this._options(op)));observations++;
      }
    }catch(error){
      const code=codeOf(error);
      if(['cancelled','start_cancelled','start_context_changed','changed','clock_changed'].includes(code))return this._finish(op,code==='cancelled'||code==='start_cancelled'?'cancelled':'blocked',code);
      if(code==='account_mismatch'||code==='account_changed')return this._finish(op,'account_mismatch',code);
      if(code==='login_required')return this._finish(op,'login_required',code);
      return this._finish(op,op.receipt.startAttempted||op.receipt.connectionAttempted?'unknown':'blocked',code);
    }
  }
  launch(input){
    const value=qqCompanionLaunchRequest(input);if(this.closed)throw fail('manager_closing');if(this.active)throw fail('operation_in_progress');if(this.used.has(value.operationId))throw fail('changed');if(this.used.size>=256)throw fail('launch_limit');
    const cap=this._capture(value),op={...value,cap,phase:'checking',clock:null,controller:new AbortController(),promise:null,
      receipt:{...value,qqAccountId:cap.qqAccountId,outcome:'unknown',code:null,startAttempted:false,qqRunning:null,loginState:'unknown',connectionAttempted:false,connectionVerified:false,qqStopped:false,testMessageSent:false}};
    this.used.add(value.operationId);this.active=op;
    op.promise=Promise.resolve().then(()=>this._run(op)).finally(()=>{if(this.active===op){this.active=null;this._changed();}});this._changed();return op.promise;
  }
  async cancel(input){
    const value=qqCompanionLaunchRequest(input,'cancel'),op=this.active;
    if(!op||op.accountId!==value.accountId||op.operationId!==value.operationId)return {...value,cancelled:false,settled:true,result:null};
    op.controller.abort();const result=await op.promise;return {...value,cancelled:true,settled:true,result};
  }
  async closeCurrent(){const op=this.active;if(op){op.controller.abort();await op.promise;}return {closed:true};}
  async close(){this.closed=true;return this.closeCurrent();}
}
module.exports={QQCompanionLaunch,qqCompanionLaunchRequest,qqCompanionLaunchResult,LAUNCH_LIMITS,launchCode:codeOf};
