import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { guard } from './output.mjs';

const options={provider:'fixture',model:'test',messages:[],sessionId:'original'};
const call={type:'tool-call',id:'once',name:'write_file',arguments:'{}'};
const text=value=>({type:'text',text:value});
async function* stream(blocks=[],kind='stop') {
  for(const [index,block] of blocks.entries()) yield {type:'block-end',index,block};
  yield {type:'usage',usage:{inputTokens:2,outputTokens:3}};
  yield {type:'finish',reason:{kind,failure:{code:'PRIVATE_CODE',message:'PRIVATE_BODY'}}};
}
const collect=async source=>{const chunks=[];for await(const c of source)chunks.push(c);return chunks;};
const finish=chunks=>chunks.findLast(c=>c.type==='finish');
const toolBlocks=chunks=>chunks.filter(c=>c.type==='block-end'&&c.block.type==='tool-call');

test('format failure has bounded safe attempt diagnostics and combined usage',async()=>{
  const diagnostics=[];let requests=0;
  const chunks=await collect(guard(options,()=>stream(),()=>{requests++;return stream([text('PRIVATE invalid JSON')]);},d=>diagnostics.push(d)));
  assert.equal(requests,2);
  assert.deepEqual(diagnostics,[1,2].map(attempt=>({stage:'finalize',attempt,cause:'invalid_reply'})));
  assert.deepEqual(chunks.find(c=>c.type==='usage').usage,{inputTokens:6,outputTokens:9});
  assert.equal(finish(chunks).reason.failure.code,'PUBLIC_ANSWER_UNAVAILABLE');
  assert.equal(JSON.stringify({chunks,diagnostics}).includes('PRIVATE'),false);
});

test('terminal and transport failures never retry or log provider payloads',async()=>{
  for(const [kind,cause] of [['error','provider_error'],['aborted','provider_aborted'],['max-tokens','max_tokens'],['__proto__','unexpected_finish'],['PRIVATE_KIND','unexpected_finish'],['throw','transport']]){
    const diagnostics=[];let requests=0;
    const chunks=await collect(guard(options,()=>stream(),()=>{
      requests++;
      if(kind==='throw')throw Error('PRIVATE_TRANSPORT');
      return stream([text('PRIVATE_TEXT')],kind);
    },d=>diagnostics.push(d)));
    assert.equal(requests,1);
    assert.deepEqual(diagnostics,[{stage:'finalize',attempt:1,cause}]);
    assert.equal(finish(chunks).reason.kind,'error');
    assert.equal(JSON.stringify({chunks,diagnostics}).includes('PRIVATE'),false);
  }
});

test('diagnostic sink failure cannot change the public failure boundary',async()=>{
  const chunks=await collect(guard(options,()=>stream([], 'error'),()=>{throw Error('must not finalize');},()=>{throw Error('PRIVATE logger');}));
  assert.equal(finish(chunks).reason.kind,'error');
  assert.equal(JSON.stringify(chunks).includes('PRIVATE'),false);
});

test('pre-cancelled request starts neither original work nor finalization',async()=>{
  const abort=new AbortController();abort.abort();let requests=0;const diagnostics=[];
  const unexpected=()=>{requests++;return stream([call],'tool-calls');};
  const chunks=await collect(guard({...options,signal:abort.signal},unexpected,unexpected,d=>diagnostics.push(d)));
  assert.equal(requests,0);assert.equal(finish(chunks).reason.kind,'aborted');
  assert.deepEqual(diagnostics,[{stage:'original',attempt:0,cause:'cancelled'}]);
});

test('original cancellation exception is aborted and not a public generation error',async()=>{
  const abort=new AbortController();const diagnostics=[];
  const chunks=await collect(guard({...options,signal:abort.signal},()=>{abort.abort();throw Error('PRIVATE abort');},()=>stream(),d=>diagnostics.push(d)));
  assert.equal(finish(chunks).reason.kind,'aborted');
  assert.deepEqual(diagnostics,[{stage:'original',attempt:0,cause:'cancelled'}]);
});

test('two format attempts share one deadline; late rejection and cleanup cannot leak',async t=>{
  const deadline=new AbortController();let timers=0,attempts=0,returned=0,entered,rejectLate,requestSignal;
  t.mock.method(AbortSignal,'timeout',ms=>{assert.equal(ms,60000);timers++;return deadline.signal;});
  const started=new Promise(resolve=>entered=resolve);
  const blocked=new Promise((_,reject)=>rejectLate=reject);
  const diagnostics=[];
  const stalled={
    [Symbol.asyncIterator](){return this;},
    next(){entered();return blocked;},
    return(){returned++;return Promise.reject(Error('PRIVATE cleanup'));},
  };
  const result=collect(guard(options,()=>stream(),request=>{
    attempts++;requestSignal=request.signal;
    return attempts===1?stream([text('PRIVATE malformed')]):stalled;
  },d=>diagnostics.push(d)));
  await started;deadline.abort();
  const chunks=await result;
  rejectLate(Error('PRIVATE late rejection'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(timers,1);assert.equal(attempts,2);assert.equal(returned,1);
  assert.equal(getEventListeners(requestSignal,'abort').length,0);
  assert.deepEqual(diagnostics,[{stage:'finalize',attempt:1,cause:'invalid_reply'},{stage:'finalize',attempt:2,cause:'timeout'}]);
  assert.equal(finish(chunks).reason.kind,'error');
  assert.equal(JSON.stringify({chunks,diagnostics}).includes('PRIVATE'),false);
});

test('original stalled iterator releases guard on cancellation',async()=>{
  const abort=new AbortController();let entered,returned=0,resolveLate;
  const started=new Promise(resolve=>entered=resolve);
  const blocked=new Promise(resolve=>resolveLate=resolve);
  const stalled={
    [Symbol.asyncIterator](){return this;},
    next(){entered();return blocked;},
    return(){returned++;return Promise.resolve({done:true});},
  };
  const result=collect(guard({...options,signal:abort.signal},()=>stalled,()=>{throw Error('must not finalize');}));
  await started;abort.abort();const chunks=await result;resolveLate({done:true});
  assert.equal(finish(chunks).reason.kind,'aborted');assert.equal(returned,1);
  assert.equal(getEventListeners(abort.signal,'abort').length,0);
});

test('duplicate or partial tool blocks fail closed without dispatch',async()=>{
  for(const source of [
    async function*(){yield {type:'block-end',index:0,block:call};yield {type:'block-end',index:0,block:call};yield {type:'finish',reason:{kind:'tool-calls'}};},
    ()=>stream([call,call],'tool-calls'),
    async function*(){yield {type:'tool-call-delta',index:0,id:'once',name:'write_file',argumentsDelta:'{'};yield {type:'finish',reason:{kind:'tool-calls'}};},
  ]){
    let attempts=0;const chunks=await collect(guard(options,source,()=>{attempts++;return stream();}));
    assert.equal(toolBlocks(chunks).length,0);assert.equal(attempts,0);
    assert.equal(finish(chunks).reason.kind,'error');
  }
});

test('completed side effect executes once even when both public attempts fail',async()=>{
  let originalCalls=0,finalCalls=0,effects=0;
  const toolStep=await collect(guard(options,()=>{originalCalls++;return stream([text('PRIVATE plan'),call],'tool-calls');},()=>{throw Error('must not finalize a tool step');}));
  for(const chunk of toolBlocks(toolStep)){assert.deepEqual(chunk.block,call);effects++;}
  const history=[
    {id:'a',role:'assistant',source:{kind:'model',provider:'fixture',model:'test'},content:[call]},
    {id:'t',role:'user',source:{kind:'tool',callId:call.id},content:[{type:'tool-result',toolCallId:call.id,content:[text('Saved')],isError:false}]},
  ];
  const finalStep=await collect(guard({...options,messages:history},()=>{originalCalls++;return stream([text('PRIVATE draft')]);},request=>{
    finalCalls++;assert.equal(request.tools,undefined);
    assert.equal(request.messages.find(m=>m.source.kind==='tool').content[0].toolCallId,call.id);
    return stream([call]);
  }));
  effects+=toolBlocks(finalStep).length;
  assert.equal(effects,1);assert.equal(originalCalls,2);assert.equal(finalCalls,2);
  assert.equal(finish(finalStep).reason.kind,'error');
});

test('chunks after terminal finish remain rejected without another request',async()=>{
  const diagnostics=[];let requests=0;
  const chunks=await collect(guard(options,async function*(){yield* stream();yield {type:'text-delta',index:0,text:'PRIVATE'};},()=>{requests++;return stream();},d=>diagnostics.push(d)));
  assert.equal(requests,0);assert.equal(finish(chunks).reason.kind,'error');
  assert.deepEqual(diagnostics,[{stage:'original',attempt:0,cause:'stream_after_finish'}]);
});

test('provider failure with a partial tool retains the original terminal kind',async()=>{
  for(const [kind,cause] of [['error','provider_error'],['aborted','provider_aborted'],['max-tokens','max_tokens']]){
    const diagnostics=[];
    const chunks=await collect(guard(options,async function*(){
      yield {type:'tool-call-delta',index:0,id:'once',name:'write_file',argumentsDelta:'{'};
      yield {type:'finish',reason:{kind,failure:{code:'PRIVATE',message:'PRIVATE'}}};
    },()=>{throw Error('must not finalize');},d=>diagnostics.push(d)));
    assert.equal(finish(chunks).reason.kind,kind);assert.equal(toolBlocks(chunks).length,0);
    assert.deepEqual(diagnostics,[{stage:'original',attempt:0,cause,...(kind==='error'?{providerCode:'PROVIDER_REQUEST_FAILED'}:{})}]);
  }
});
