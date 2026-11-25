import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { guard } from './output.mjs';

const options = {provider:'fixture',model:'test',sessionId:'existing',messages:[]};
const collect = async source => { const out=[]; for await (const c of source) out.push(c); return out; };
const finish = chunks => chunks.findLast(c=>c.type==='finish').reason;
const noFinalizer = () => { throw Error('failed original step must not finalize'); };
async function* failed(code, extra={}) {
  yield {type:'text-delta',index:0,text:'PRIVATE draft'};
  yield {type:'finish',reason:{kind:'error',failure:{code,message:'PRIVATE response body',...extra}},replayState:{secret:'PRIVATE'}};
}
async function* success(text='unpublished draft') {
  yield {type:'text-delta',index:0,text};
  yield {type:'finish',reason:{kind:'stop'}};
}

for (const code of ['CONTEXT_WINDOW_EXCEEDED','EMPTY_RESPONSE','RATE_LIMIT','SERVER','TIMEOUT','TRANSPORT','AUTH','QUOTA','INVALID_REQUEST','INVALID_CREDENTIAL','PI_AI_ERROR','STREAM_CLOSED']) {
  test('original failure preserves safe recovery classification: '+code,async()=>{
    const diagnostics=[];
    const chunks=await collect(guard(options,()=>failed(code,{status:429,providerRetryAfterMs:123,requestId:'PRIVATE',body:'PRIVATE'}),noFinalizer,d=>diagnostics.push(d)));
    assert.equal(finish(chunks).failure.code,code);
    assert.equal(finish(chunks).failure.providerRetryAfterMs,123);
    assert.equal(finish(chunks).failure.status,429);
    assert.equal(diagnostics[0].providerCode,code);
    assert.equal(JSON.stringify({chunks,diagnostics}).includes('PRIVATE'),false);
    assert.equal(chunks.some(c=>c.type==='text-delta'),false);
  });
}

test('unknown original failure is distinct from finalization and cannot copy arbitrary metadata',async()=>{
  for (const code of ['PRIVATE', '__proto__', 'constructor', undefined]) {
    const chunks=await collect(guard(options,()=>failed(code,{status:'PRIVATE',providerRetryAfterMs:Infinity}),noFinalizer));
    assert.equal(finish(chunks).failure.code,'PROVIDER_REQUEST_FAILED');
    assert.equal(finish(chunks).failure.status,undefined);
    assert.equal(finish(chunks).failure.providerRetryAfterMs,undefined);
    assert.equal(JSON.stringify(chunks).includes('PRIVATE'),false);
    assert.match(finish(chunks).failure.message,/原模型请求/);
  }
});

test('typed thrown errors retain retry fields but never their cause or message',async()=>{
  const err=Object.assign(new Error('PRIVATE'),{code:'RATE_LIMIT',failure:{code:'RATE_LIMIT',message:'PRIVATE',providerRetryAfterMs:99},cause:Error('PRIVATE')});
  const chunks=await collect(guard(options,async function*(){throw err;},noFinalizer));
  assert.equal(finish(chunks).failure.code,'RATE_LIMIT');
  assert.equal(finish(chunks).failure.providerRetryAfterMs,99);
  assert.equal(JSON.stringify(chunks).includes('PRIVATE'),false);
});

test('cancellation overrides an otherwise retryable original failure',async()=>{
  const abort=new AbortController();
  const chunks=await collect(guard({...options,signal:abort.signal},async function*(){abort.abort();yield* failed('RATE_LIMIT');},noFinalizer));
  assert.equal(finish(chunks).kind,'aborted');
  assert.equal(finish(chunks).failure.code,'ABORTED');
});

test('finalizer failure never routes through original-step recovery',async()=>{
  let attempts=0;
  const chunks=await collect(guard(options,success,()=>{attempts++;return failed('RATE_LIMIT');}));
  assert.equal(finish(chunks).failure.code,'PUBLIC_ANSWER_UNAVAILABLE');
  assert.equal(attempts,1);
});

const installed={skip:!process.env.DSH_CONTRACT_ENTRY && 'set DSH_CONTRACT_ENTRY to installed dsh bin.js'};
async function runtime(name) {
  const require=createRequire(realpathSync(process.env.DSH_CONTRACT_ENTRY));
  return import(pathToFileURL(require.resolve('@deepseek-ai/'+name)).href);
}

// Use the real installed recovery policy/projection. Only storage, dispatch
// and provider responses are fixtures; never launch a provider or read config.
async function retryHarness(maxRetries=2) {
  const {apply}=await runtime('dsh-llm-retry');
  const {resolveRetryPolicy}=await runtime('dsh-llm');
  let recover,projection,state;const events=[],effects=[];
  const ctx={
    sessionProjections:{register(p){projection=p;state=p.init();},stateOf(){return state;}},
    on(name,fn){assert.equal(name,'agent/request-error');recover=fn;return ()=>{};},
    effect(fn){effects.push(fn);},logger:{warn(){throw Error('unexpected warning');}},
  };
  apply(ctx,{}, {random:()=>0.5});
  const agent={session:{append(type,data){events.push({type,data});state=projection.apply(state,{type,data});}}};
  const signal=new AbortController().signal;
  const policy=resolveRetryPolicy({mode:'normal',maxRetries,backoff:{initialDelayMs:1,maxDelayMs:10,jitterRatio:0}},'fixture');
  return {events,request:(failure)=>recover({agent,turn:1,step:2,provider:'fixture',failure,retryPolicy:policy,signal},async()=>undefined),
    close:async()=>{for(const effect of effects)await effect()();}};
}

test('installed DSH retries only the failed model step; prior tool stays executed once',installed,async()=>{
  const h=await retryHarness();let tools=0,requests=0,finalizers=0;
  try {
    const toolStep=await collect(guard(options,async function*(){
      yield {type:'block-end',index:0,block:{type:'tool-call',id:'once',name:'write',arguments:'{}'}};
      yield {type:'finish',reason:{kind:'tool-calls'}};
    },noFinalizer));
    for(const c of toolStep)if(c.type==='block-end'&&c.block.type==='tool-call')tools++;
    let result;
    for(let attempt=0;attempt<4;attempt++){
      result=await collect(guard(options,()=>++requests===1?failed('RATE_LIMIT',{providerRetryAfterMs:2}):success(),()=>{finalizers++;return success('{"reply":"已完成"}');}));
      if(finish(result).kind==='stop')break;
      const action=await h.request(finish(result).failure);
      assert.equal(action?.kind,'retry',JSON.stringify(finish(result)));
    }
    assert.equal(finish(result).kind,'stop');assert.equal(requests,2);assert.equal(tools,1);assert.equal(finalizers,1);
    assert.equal(h.events.filter(e=>e.type==='llm/retry').length,1);
    assert.equal(h.events[0].data.delayMs,2);
  } finally {await h.close();}
});

test('installed retry budget and nonretryable failures still stop',installed,async()=>{
  const h=await retryHarness(2);
  try {
    for(const code of ['AUTH','QUOTA','INVALID_REQUEST','PRIVATE']) {
      const r=finish(await collect(guard(options,()=>failed(code),noFinalizer)));
      assert.equal(await h.request(r.failure),undefined);
    }
    const r=finish(await collect(guard(options,()=>failed('SERVER'),noFinalizer)));
    assert.equal((await h.request(r.failure))?.kind,'retry');
    assert.equal((await h.request(r.failure))?.kind,'retry');
    assert.equal(await h.request(r.failure),undefined);
    assert.equal(h.events.filter(e=>e.type==='llm/retry').length,2);
  } finally {await h.close();}
});

test('installed context-overflow recovery receives classification and keeps its budget',installed,async()=>{
  const {BasicCompactionEngine}=await runtime('dsh-compaction-basic');
  // Register the actual engine recovery handlers without booting Cordis or
  // persistent sessions; stub only the expensive compaction operation.
  const engine=Object.create(BasicCompactionEngine.prototype);let handler,compactions=0;
  engine.ctx={on(name,fn){if(name==='agent/request-error')handler=fn;},logger:{info(){},warn(){}}};
  engine.config={modelPolicies:[],maxOverflowRetries:1};
  engine.overflowAgents=new WeakMap();engine.overflowRetries=new WeakMap();
  engine.compactIfNeeded=async(agent,trigger)=>{assert.equal(trigger,'context-overflow');compactions++;agent.session.surface.replaceGeneration++;return null;};
  engine._registerAutomaticCompaction();
  const agent={session:{surface:{replaceGeneration:0},requestHeader:()=>({config:{provider:'fixture',model:'test'}})}};
  const reason=finish(await collect(guard(options,()=>failed('CONTEXT_WINDOW_EXCEEDED'),noFinalizer)));
  const payload={agent,failure:reason.failure,signal:new AbortController().signal};
  assert.equal((await handler(payload,async()=>undefined))?.kind,'retry');
  assert.equal(compactions,1);
  assert.equal(await handler(payload,async()=>undefined),undefined);
  assert.equal(compactions,1);
});
