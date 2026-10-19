import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guard, finalRequest, parseReply } from './output.mjs';
const message = (role, content) => ({id: role + '-fixture', role, source: {kind: role === 'assistant' ? 'model' : 'user', provider: 'fixture', model: 'test'}, content});
const text = text => ({type: 'text', text});
const reasoning = text => ({type: 'reasoning', text});
const call = {type: 'tool-call', id: 'call-1', name: 'write_file', arguments: '{"path":"fixture"}'};
const options = {provider:'fixture', model:'test', sessionId:'original', messages:[message('user',[text('报告已完成的工作')])], tools:[{name:'write_file'}]};
async function* stream(blocks, kind='stop', usage={inputTokens:2,outputTokens:3}) {
  for (let index=0; index<blocks.length; index++) {
    const block=blocks[index];
    yield {type:'block-start', index, blockType:block.type};
    if (block.type==='text' || block.type==='reasoning') yield {type:block.type+'-delta', index, text:block.text};
    yield {type:'block-end', index, block};
  }
  yield {type:'usage', usage};
  yield {type:'finish', reason:{kind}, replayState:{response:'old',blocks:blocks.map(()=>({type:'text'}))}};
}
const collect = async iterable => {const chunks=[];for await (const c of iterable) chunks.push(c);return chunks;};
const publicText = chunks => chunks.filter(c=>c.type==='text-delta').map(c=>c.text).join('');
const finish = chunks => chunks.findLast(c=>c.type==='finish');
const accepted = () => stream([reasoning('PRIVATE_FINALIZER'),text('{"reply":"已完成，测试通过。"}')]);
for (const raw of ['<thinking>quote </thinking> PRIVATE tail', '<think">PRIVATE', 'PRIVATE unmarked planning']) {
  test('tool step never publishes raw text: '+raw.slice(0,10), async()=>{
    let finalCalls=0;
    const chunks=await collect(guard(options,()=>stream([reasoning('PRIVATE'),text(raw),call],'tool-calls'),()=>{finalCalls++;return accepted();}));
    assert.equal(publicText(chunks),'');assert.equal(finalCalls,0);
    assert.deepEqual(chunks.filter(c=>c.type==='block-end'&&c.block.type==='tool-call').map(c=>c.block),[call]);
    assert.equal(finish(chunks).replayState,undefined);
  });
}
for (const blocks of [[reasoning('PRIVATE only')],[text('<thinking>PRIVATE')],[],[text('PRIVATE unmarked final')]]) {
  test('terminal output requires validated public reply: '+JSON.stringify(blocks.map(b=>b.type)),async()=>{
    let calls=0;
    const chunks=await collect(guard(options,()=>stream(blocks),request=>{
      calls++;assert.equal(request.tools,undefined);assert.equal(request.sessionId,'original');return accepted();
    }));
    assert.equal(publicText(chunks),'已完成，测试通过。');assert.equal(calls,1);assert.equal(finish(chunks).reason.kind,'stop');
    assert.equal(finish(chunks).replayState,undefined);
    assert.deepEqual(chunks.find(c=>c.type==='usage').usage,{inputTokens:4,outputTokens:6});
  });
}
test('bounded validation retry cannot execute a tool',async()=>{
 let calls=0;
 const chunks=await collect(guard(options,()=>stream([reasoning('PRIVATE')]),request=>{
  assert.equal(request.tools,undefined);calls++;return stream([call]);
 }));
 assert.equal(calls,2);assert.equal(publicText(chunks),'');assert.equal(chunks.some(c=>c.type==='tool-call-delta'||c.block?.type==='tool-call'),false);
 assert.equal(finish(chunks).reason.kind,'error');assert.equal(finish(chunks).reason.failure.code,'PUBLIC_ANSWER_UNAVAILABLE');
});
test('first invalid structured answer is never streamed; second can recover',async()=>{
 let calls=0;
 const chunks=await collect(guard(options,()=>stream([text('PRIVATE')]),()=>++calls===1?stream([text('PRIVATE')]):accepted()));
 assert.equal(calls,2);assert.equal(publicText(chunks),'已完成，测试通过。');
});
test('failure and cancellation do not start answer generation',async()=>{
 for(const kind of ['error','aborted','max-tokens']){
  let calls=0;const chunks=await collect(guard(options,()=>stream([text('PRIVATE')],kind),()=>{calls++;return accepted();}));
  assert.equal(calls,0);assert.equal(publicText(chunks),'');assert.equal(finish(chunks).reason.kind,kind);
 }
});
test('intentional NO_REPLY needs no generation',async()=>{
 const chunks=await collect(guard(options,()=>stream([text('NO_REPLY')]),()=>{throw Error('must not call');}));
 assert.equal(publicText(chunks),'NO_REPLY');
});
test('finalization context is immutable, omits reasoning, keeps correlated tools',()=>{
 const original=structuredClone(options);original.messages.push(message('assistant',[reasoning('PRIVATE'),text('<thinking>PRIVATE'),call]));
 const before=JSON.stringify(original);const request=finalRequest(original);
 assert.equal(JSON.stringify(original),before);assert.equal(request.tools,undefined);
 assert.equal(JSON.stringify(request.messages).includes('PRIVATE'),false);
 assert.ok(request.messages.some(m=>m.content.some(b=>b.type==='tool-call'&&b.id===call.id)));
 assert.equal(request.messages.some(m=>m.source.replayState),false);
});
test('reply schema rejects malformed, marked, blank, or mixed output',()=>{
 for(const raw of ['','{}','{"reply":""}','{"reply":"<think\\\">PRIVATE"}','{"reply":"ok","analysis":"PRIVATE"}',String.fromCharCode(96).repeat(3)+'json\n{"reply":"ok"}','{"reply":"ok"}PRIVATE'])assert.equal(parseReply(raw),null);
 assert.equal(parseReply('{"reply":"ok"}'),'ok');
});
test('concurrent requests do not mix answers',async()=>{
 const results=await Promise.all(['甲','乙'].map(reply=>collect(guard(options,()=>stream([reasoning('PRIVATE')]),()=>stream([text(JSON.stringify({reply}))])))));
 assert.deepEqual(results.map(publicText),['甲','乙']);
});
test('streaming text is withheld until response validation completes',async()=>{
 let release;const barrier=new Promise(r=>release=r);let published=false;
 async function* delayed(){yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'PRIVATE'};await barrier;yield {type:'block-end',index:0,block:text('PRIVATE')};yield {type:'finish',reason:{kind:'stop'}};}
 const done=collect(guard(options,delayed,accepted)).then(c=>{published=true;return c;});
 await new Promise(r=>setTimeout(r,10));assert.equal(published,false);release();assert.equal(publicText(await done),'已完成，测试通过。');
});
test('missing finish and excessive response size fail before publishing',async()=>{
 for(const source of [async function*(){yield {type:'text-delta',index:0,text:'PRIVATE'};},async function*(){yield {type:'text-delta',index:0,text:'X'.repeat(2*1024*1024)};}]){
  let published=false;
  const chunks = await collect(guard(options,source,accepted));
  assert.equal(publicText(chunks),'');
  assert.equal(finish(chunks).reason.kind,'error');
 }
});
test('cancelled finalization does not retry or publish',async()=>{
 const abort=new AbortController();let calls=0;
 const chunks=await collect(guard({...options,signal:abort.signal},()=>stream([reasoning('PRIVATE')]),()=>{
  calls++;abort.abort();return stream([], 'aborted');
 }));
 assert.equal(calls,1);assert.equal(publicText(chunks),'');assert.equal(finish(chunks).reason.kind,'aborted');
});
test('finalizer transport errors do not leak error text or retry',async()=>{
 let calls=0;const chunks=await collect(guard(options,()=>stream([]),async function*(){calls++;throw Error('PRIVATE transport details');}));
 assert.equal(calls,1);assert.equal(JSON.stringify(chunks).includes('PRIVATE'),false);assert.equal(finish(chunks).reason.kind,'error');
});
test('upstream failure metadata cannot publish private payload',async()=>{
 async function* failed(){yield {type:'finish',reason:{kind:'error',failure:{code:'PRIVATE',message:'PRIVATE upstream content'}}};}
 const chunks=await collect(guard(options,failed,accepted));
 assert.equal(JSON.stringify(chunks).includes('PRIVATE'),false);
 assert.equal(finish(chunks).reason.kind,'error');
});
test('provider success arriving after cancellation is discarded',async()=>{
 const abort=new AbortController();let calls=0;
 const chunks=await collect(guard({...options,signal:abort.signal},()=>stream([]),()=>{
  calls++;abort.abort();return accepted();
 }));
 assert.equal(calls,1);assert.equal(publicText(chunks),'');assert.equal(finish(chunks).reason.kind,'aborted');
});
