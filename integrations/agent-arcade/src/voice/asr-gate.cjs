'use strict';
// One app-wide recognition owner, optionally retaining one clean idle
// model host. No model creation, audio storage, microphone or network access.
const {performance}=require('node:perf_hooks');
const IDLE_MS=30000;
const failure=code=>Object.assign(new Error(code==='busy'?'本机语音识别正在使用中。请结束桌面语音，或稍后重发 QQ 语音。':code==='asr_exit_unconfirmed'?'尚未确认上一次语音识别进程已退出，请稍后重试。':code==='manager_closing'?'本机语音正在关闭，请完成退出后重新打开应用。':'本次语音识别已经结束或发生变化，请重新开始。'),{code});
const key=value=>typeof value==='string'&&value.length>0&&value.length<=1024;
function signalCheck(signal){if(signal!=null&&(typeof signal.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))throw failure('invalid_config');if(signal?.aborted)throw failure('cancelled');}
function resourceCheck(resource){if(!resource||typeof resource!=='object'||typeof resource.close!=='function'||typeof resource.closed!=='boolean'||typeof resource.busy!=='boolean')throw failure('invalid_config');}
class AsrGate{
  constructor({now=()=>performance.now(),schedule=setTimeout,unschedule=clearTimeout}={}){
    if([now,schedule,unschedule].some(value=>typeof value!=='function'))throw failure('invalid_config');
    this.owner=null;this.closed=false;this.sequence=0;this.now=now;this.schedule=schedule;this.unschedule=unschedule;
  }
  _open(){if(this.closed)throw failure('manager_closing');}
  _clearTimer(owner){if(owner.timer!==null){this.unschedule(owner.timer);owner.timer=null;}}
  _validateAcquire({scopeId,jobId,signal,reuseKey}={}){
    if(typeof scopeId!=='string'||!scopeId||scopeId.length>512||typeof jobId!=='string'||!jobId||jobId.length>80||reuseKey!==undefined&&!key(reuseKey))throw failure('invalid_config');signalCheck(signal);this._open();
  }
  acquire(options={}){
    this._validateAcquire(options);const {scopeId,jobId,signal,reuseKey}=options;let resource=null;
    if(this.owner){const old=this.owner;
      if(old.state!=='idle'||reuseKey===undefined||old.reuseKey!==reuseKey||old.scopeId!==scopeId||old.deadline<=this.now())throw failure('busy');
      resourceCheck(old.resource);if(old.resource.closed||old.resource.busy)throw failure('asr_exit_unconfirmed');
      this._clearTimer(old);resource=old.resource;old.state='transferred';old.resource=null;old.closeIdle=null;old.recovery=null;
    }
    const owner={scopeId,jobId,reuseKey,resource,state:'active',generation:++this.sequence,recovery:null,retry:null,cleanup:null,timer:null,deadline:null,closeIdle:null};this.owner=owner;let ended=false;
    const assertCurrent=()=>{if(ended||this.owner!==owner||owner.state!=='active')throw failure('wrong_scope');};
    const attachResource=value=>{assertCurrent();resourceCheck(value);if(value.closed||owner.resource&&owner.resource!==value)throw failure('wrong_scope');owner.resource=value;};
    return Object.freeze({
      get resource(){return owner.resource;},assertCurrent,
      attachResource,
      retainRecovery:cleanup=>{assertCurrent();if(typeof cleanup!=='function')throw failure('invalid_config');owner.recovery=cleanup;},
      release:()=>{
        // A parked lease has ended, but its process still belongs to the gate.
        // Neither this call nor a stale release from a previous job frees it.
        if(ended)return;assertCurrent();if(owner.resource&&owner.resource.closed!==true)throw failure('asr_exit_unconfirmed');
        this.owner=null;owner.recovery=null;owner.resource=null;owner.state='released';ended=true;
      },
      park:({reuseKey:parkKey,resource:host,closeIdle}={})=>{
        assertCurrent();signalCheck(signal);this._open();if(!key(parkKey)||parkKey!==owner.reuseKey||typeof closeIdle!=='function')throw failure('invalid_config');resourceCheck(host);
        if(host.closed||host.busy||owner.resource&&owner.resource!==host||owner.recovery)throw failure('wrong_scope');
        owner.resource=host;owner.closeIdle=closeIdle;owner.state='idle';owner.deadline=this.now()+IDLE_MS;ended=true;
        const generation=owner.generation;
        owner.timer=this.schedule(()=>{
          // Ownership is captured, not looked up by key. A later job using the
          // same scope/key cannot be closed by this old timer or old pipeline.
          if(this.owner!==owner||owner.generation!==generation||owner.state!=='idle')return;
          void this._closeOwner(owner).catch(()=>{});
        },IDLE_MS);owner.timer?.unref?.();
        return {parked:true,retained:true,idleMs:IDLE_MS};
      },
      closeIdle:()=>this._closeExactIdle(owner),
    });
  }
  async prepare({reuseKey,signal}={}){
    this._open();if(reuseKey!==undefined&&!key(reuseKey))throw failure('invalid_config');signalCheck(signal);
    const owner=this.owner;if(!owner)return {ready:true};
    if(owner.state==='active')throw failure('busy');
    if(owner.state==='idle'&&reuseKey!==undefined&&owner.reuseKey===reuseKey&&owner.deadline>this.now()){
      resourceCheck(owner.resource);if(!owner.resource.closed&&!owner.resource.busy)return {ready:true};
    }
    // Closing an idle host is not a reservation. Another caller may acquire
    // after this await; the following synchronous acquire then returns busy.
    await this._closeOwner(owner);signalCheck(signal);this._open();return {ready:true};
  }
  async _closeExactIdle(owner){
    if(this.owner!==owner||!['idle','closing','failed'].includes(owner.state))return {closed:false,stale:true};
    return this._closeOwner(owner);
  }
  async closeIdle({reuseKey}={}){
    if(reuseKey!==undefined&&!key(reuseKey))throw failure('invalid_config');const owner=this.owner;
    if(!owner||reuseKey!==undefined&&owner.reuseKey!==reuseKey)return {closed:false,stale:true};
    if(owner.state==='active')throw failure('busy');return this._closeOwner(owner);
  }
  _closeOwner(owner){
    if(this.owner!==owner)return Promise.resolve({closed:false,stale:true});if(owner.cleanup)return owner.cleanup;
    if(!['idle','closing','failed'].includes(owner.state))return Promise.reject(failure('busy'));
    this._clearTimer(owner);owner.state='closing';
    const operation=Promise.resolve().then(async()=>{
      if(this.owner!==owner)throw failure('wrong_scope');const result=await owner.closeIdle();
      // A resolved callback or a kill request is not evidence of exit.
      if(result?.closed!==true||owner.resource?.closed!==true)throw failure('asr_exit_unconfirmed');
      if(this.owner!==owner)throw failure('wrong_scope');this.owner=null;owner.state='released';owner.resource=null;owner.recovery=null;owner.closeIdle=null;return {closed:true};
    }).catch(()=>{
      if(this.owner===owner){owner.state='failed';owner.recovery=()=>this._closeOwner(owner);}
      throw failure('asr_exit_unconfirmed');
    }).finally(()=>{if(owner.cleanup===operation)owner.cleanup=null;});
    owner.cleanup=operation;return operation;
  }
  async retryCleanup(){
    const owner=this.owner;if(!owner?.recovery)return;if(owner.retry)return owner.retry;
    owner.retry=Promise.resolve().then(()=>{if(this.owner!==owner||!owner.recovery)return;return owner.recovery();}).finally(()=>{owner.retry=null;});return owner.retry;
  }
  async close(){this.closed=true;const owner=this.owner;if(!owner)return {closed:true};if(owner.state==='active')throw failure('busy');await this._closeOwner(owner);return {closed:true};}
}
module.exports={AsrGate,IDLE_MS};
