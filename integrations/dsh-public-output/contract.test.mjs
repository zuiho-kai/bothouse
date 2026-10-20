import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { guard, finalRequest } from './output.mjs';
import { apply } from './plugin.mjs';

const options = {provider:'fixture', model:'test', sessionId:'same-session', messages:[
  {id:'user', role:'user', source:{kind:'user'}, content:[{type:'text', text:'报告成果'}]},
]};
const collect = async source => { const chunks=[]; for await (const chunk of source) chunks.push(chunk); return chunks; };
const terminal = chunks => chunks.findLast(c=>c.type==='finish').reason;
const text = chunks => chunks.filter(c=>c.type==='text-delta').map(c=>c.text).join('');
async function* empty() { yield {type:'finish', reason:{kind:'stop'}}; }

// DSH 0.1.5-rc.3 StreamChunk indexes correlate interleaved blocks. Its
// BlockAssembler.blocks() returns first-seen order, not block-end order.
export async function* interleavedReply() {
  yield {type:'block-start', index:8, blockType:'text'};
  yield {type:'text-delta', index:8, text:'{"reply":'};
  yield {type:'block-start', index:2, blockType:'text'};
  yield {type:'text-delta', index:2, text:'"已完成"}'};
  yield {type:'block-end', index:2, block:{type:'text', text:'"已完成"}'}};
  yield {type:'block-end', index:8, block:{type:'text', text:'{"reply":'}};
  yield {type:'usage', usage:{inputTokens:3,outputTokens:4}};
  yield {type:'finish', reason:{kind:'stop'}};
}

test('DSH interleaved reply blocks preserve first-seen order through actual guard', async()=>{
  let attempts=0;
  const chunks=await collect(guard(options,empty,()=>{attempts++;return interleavedReply();}));
  assert.equal(terminal(chunks).kind,'stop',JSON.stringify(terminal(chunks)));
  assert.equal(text(chunks),'已完成');
  assert.equal(attempts,1);
});

test('DSH delta-only text accepted by canonical assembler is not lost by guard',async()=>{
  const chunks=await collect(guard(options,empty,async function*(){
    yield {type:'text-delta',index:0,text:'{"reply":"已完成"}'};
    yield {type:'finish',reason:{kind:'stop'}};
  }));
  assert.equal(terminal(chunks).kind,'stop',JSON.stringify(terminal(chunks)));
  assert.equal(text(chunks),'已完成');
});

test('cancellation of original step cannot dispatch a late tool call',async()=>{
  const abort=new AbortController();let completions=0;
  const chunks=await collect(guard({...options,signal:abort.signal},async function*(){
    yield {type:'block-end',index:0,block:{type:'tool-call',id:'once',name:'write_file',arguments:'{}'}};
    abort.abort();
    yield {type:'finish',reason:{kind:'tool-calls'}};
  },()=>{completions++;return empty();}));
  assert.equal(terminal(chunks).kind,'aborted');
  assert.equal(chunks.some(c=>c.block?.type==='tool-call'||c.type==='tool-call-delta'),false);
  assert.equal(completions,0);
});

test('finalizer deadline settles guard even if iterator ignores cancellation',async t=>{
  const deadline=new AbortController();
  t.mock.method(AbortSignal,'timeout',()=>deadline.signal);
  let unblock,entered,returned=0,attempts=0;
  const started=new Promise(resolve=>entered=resolve);
  const blocked=new Promise(resolve=>unblock=resolve);
  const stalled={
    [Symbol.asyncIterator](){return this;},
    next(){entered();return blocked;},
    return(){returned++;return Promise.resolve({done:true});},
  };
  let settled=false;
  const result=collect(guard(options,empty,()=>{attempts++;return stalled;})).then(c=>{settled=true;return c;});
  try {
    await started;deadline.abort();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(settled,true,'guard must settle on the shared deadline without another provider chunk');
    const chunks=await result;
    assert.equal(terminal(chunks).kind,'error');assert.equal(text(chunks),'');
    assert.equal(returned,1);assert.equal(attempts,1);
  } finally { unblock({done:true});await result; }
});

test('finalRequest retains typed tool evidence and replaces loop-only settings',()=>{
  const original=structuredClone(options);
  original.system='PRIVATE system';original.stop=['}'];original.maxTokens=32;
  original.messages.push(
    {id:'system',role:'system',source:{kind:'plugin',plugin:'system'},content:[{type:'text',text:'PRIVATE system'}]},
    {id:'assistant',role:'assistant',source:{kind:'model',provider:'fixture',model:'test',replayState:{private:'PRIVATE replay'}},content:[
      {type:'reasoning',text:'PRIVATE reasoning'},
      {type:'tool-call',id:'once',name:'write_file',arguments:'{}'},
    ]},
    {id:'result',role:'user',source:{kind:'tool',callId:'once'},content:[{type:'tool-result',toolCallId:'once',isError:false,content:[{type:'text',text:'Saved fixture'}]}]},
  );
  const before=structuredClone(original);const request=finalRequest(original);
  assert.deepEqual(original,before);
  assert.equal(JSON.stringify(request).includes('PRIVATE'),false);
  assert.equal(request.tools,undefined);assert.equal(request.stop,undefined);
  assert.equal(request.sessionId,'same-session');
  assert.deepEqual(request.messages.find(m=>m.source.kind==='tool').content,original.messages.at(-1).content);
  assert.equal(request.messages.find(m=>m.role==='assistant').content[0].id,'once');
});

test('installed DSH assembler and actual plugin middleware agree offline', {skip:!process.env.DSH_CONTRACT_ENTRY && 'set DSH_CONTRACT_ENTRY to an installed dsh bin.js'}, async()=>{
  // Import only the pure LLM vocabulary; never launch DSH or a provider.
  const entry=realpathSync(process.env.DSH_CONTRACT_ENTRY);
  const require=createRequire(entry);
  const {BlockAssembler,markAgentLoopRequest,isAgentLoopRequest}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
  for(const source of [interleavedReply(),(async function*(){
    yield {type:'text-delta',index:0,text:'{"reply":"已完成"}'};
    yield {type:'finish',reason:{kind:'stop'}};
  })()]){
    const assembler=new BlockAssembler();for await(const chunk of source)assembler.push(chunk);
    assert.deepEqual(JSON.parse(assembler.blocks().map(b=>b.text).join('')),{reply:'已完成'});
  }
  let handler,finalCalls=0;const warnings=[];
  const ctx={
    logger:{info(){},warn(...args){warnings.push(args);}},
    on(event,callback){assert.equal(event,'llm/stream');handler=callback;},
    llm:{stream(request){
      finalCalls++;assert.equal(isAgentLoopRequest(request),false);
      assert.equal(request.tools,undefined);assert.equal(request.sessionId,options.sessionId);
      return handler(request,interleavedReply);
    }},
  };
  const previous=process.argv[1];
  try {process.argv[1]=entry;await apply(ctx,{providers:['fixture']});}
  finally {process.argv[1]=previous;}
  const chunks=await collect(handler(markAgentLoopRequest({...options}),empty));
  assert.equal(text(chunks),'已完成');assert.equal(terminal(chunks).kind,'stop');
  assert.equal(finalCalls,1);assert.equal(warnings.length,0);
  const passthrough=empty();
  assert.equal(handler({...options,purpose:'session-title'},()=>passthrough),passthrough);
  assert.equal(handler(markAgentLoopRequest({...options,provider:'other'}),()=>passthrough),passthrough);
  ctx.llm.stream=async function*(){throw Error('PRIVATE provider response');};
  const failed=await collect(handler(markAgentLoopRequest({...options}),empty));
  assert.equal(terminal(failed).kind,'error');
  assert.deepEqual(JSON.parse(warnings[0][1]),{stage:'finalize',attempt:1,cause:'transport'});
  assert.equal(JSON.stringify({failed,warnings}).includes('PRIVATE'),false);
});
