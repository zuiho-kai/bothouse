import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {guard} from './output.mjs';
import {apply} from './plugin.mjs';

const tool={name:'conest_public_reply',description:'public data',parameters:{}};
const options={provider:'fixture',model:'fixture',messages:[],tools:[tool]};
const collect=async stream=>{const rows=[];for await(const row of stream)rows.push(row);return rows;};
const text=rows=>rows.filter(row=>row.type==='text-delta').map(row=>row.text).join('');
const data=reply=>({type:'tool-call',id:'public',name:tool.name,arguments:JSON.stringify({reply})});
async function* reply(){
  yield {type:'block-end',index:0,block:{type:'text',text:'PRIVATE DRAFT'}};
  yield {type:'block-end',index:1,block:data('你好。')};
  yield {type:'usage',usage:{inputTokens:3,outputTokens:4}};
  yield {type:'finish',reason:{kind:'tool-calls'}};
}

test('original public field completes in one model request without publishing the draft or executing data',async()=>{
  let finalizations=0;
  const rows=await collect(guard(options,reply,()=>{finalizations++;return reply();},()=>{},true,true));
  assert.equal(text(rows),'你好。');
  assert.equal(finalizations,0,'a structured original reply must not trigger another generation');
  assert.equal(rows.at(-1).reason.kind,'stop');
  assert.equal(rows.some(row=>row.type==='tool-call-delta'),false);
  assert.equal(JSON.stringify(rows).includes('PRIVATE'),false);
  assert.deepEqual(rows.find(row=>row.type==='usage').usage,{inputTokens:3,outputTokens:4});
});

test('single request releases the public first character while its remainder is paused',async()=>{
  const gate=Promise.withResolvers();
  async function* original(){
    yield {type:'reasoning-delta',index:0,text:'PRIVATE'};
    yield {type:'tool-call-delta',index:1,id:'public',name:tool.name,argumentsDelta:'{"reply":"你'};
    await gate.promise;
    yield {type:'tool-call-delta',index:1,id:'public',argumentsDelta:'好。"}'};
    yield {type:'block-end',index:1,block:data('你好。')};
    yield {type:'finish',reason:{kind:'tool-calls'}};
  }
  let finalized=0;const rows=[];
  const stream=guard(options,original,()=>{finalized++;return reply();},()=>{},true,true)[Symbol.asyncIterator]();
  let timer;
  try{
    await Promise.race([(async()=>{while(text(rows)!=='你'){const row=await stream.next();assert.equal(row.done,false);rows.push(row.value);}})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('original public field remained buffered')),500);})]);
  }finally{clearTimeout(timer);gate.resolve();}
  while(true){const row=await stream.next();if(row.done)break;rows.push(row.value);}
  assert.equal(text(rows),'你好。');assert.equal(finalized,0);
  assert.equal(rows.at(-1).reason.kind,'stop');
  assert.equal(JSON.stringify(rows).includes('PRIVATE'),false);
});

test('execution calls keep original identity and dispatch once, without a public generation',async()=>{
  const call={type:'tool-call',id:'once',name:'write_file',arguments:'{"path":"fixture"}'};
  async function* original(){
    yield {type:'text-delta',index:0,text:'PRIVATE PLAN'};
    yield {type:'tool-call-delta',index:1,id:call.id,name:call.name,argumentsDelta:call.arguments};
    yield {type:'block-end',index:1,block:call};
    yield {type:'finish',reason:{kind:'tool-calls'}};
  }
  let finalized=0;const rows=await collect(guard(options,original,()=>{finalized++;return reply();},()=>{},true,true));
  assert.equal(text(rows),'');assert.equal(finalized,0);
  assert.deepEqual(rows.filter(row=>row.type==='block-end'&&row.block.type==='tool-call').map(row=>row.block),[call]);
  assert.equal(rows.at(-1).reason.kind,'tool-calls');
});

for(const publicFirst of [true,false]){
  test('a public reply mixed with execution calls is terminal and dispatches neither: '+publicFirst,async()=>{
    async function* original(){
      const blocks=[data('已完成。'),{type:'tool-call',id:'write',name:'write_file',arguments:'{}'}];
      if(!publicFirst)blocks.reverse();
      for(const [index,block] of blocks.entries())yield {type:'block-end',index,block};
      yield {type:'finish',reason:{kind:'tool-calls'}};
    }
    let finalized=0;const rows=await collect(guard(options,original,()=>{finalized++;return reply();},()=>{},true,true));
    assert.equal(rows.at(-1).reason.kind,'error');assert.equal(finalized,0);
    assert.equal(rows.some(row=>row.type==='tool-call-delta'),false);
    if(!publicFirst)assert.equal(text(rows),'');
  });
}

test('failure after one-pass public prefix never retries or runs a finalizer',async()=>{
  async function* original(){
    yield {type:'tool-call-delta',index:0,id:'public',name:tool.name,argumentsDelta:'{"reply":"你好'};
    yield {type:'finish',reason:{kind:'error',failure:{code:'TRANSPORT',message:'PRIVATE'}}};
  }
  let finalized=0;const rows=await collect(guard(options,original,()=>{finalized++;return reply();},()=>{},true,true));
  assert.equal(text(rows),'你好');assert.equal(finalized,0);
  assert.equal(rows.at(-1).reason.kind,'error');assert.equal(JSON.stringify(rows).includes('PRIVATE'),false);
});

test('legacy mode still requires an isolated public generation',async()=>{
  async function* original(){yield {type:'text-delta',index:0,text:'PRIVATE'};yield {type:'finish',reason:{kind:'stop'}};}
  let finalized=0;const rows=await collect(guard(options,original,()=>{finalized++;return reply();},()=>{},true,false));
  assert.equal(text(rows),'你好。');assert.equal(finalized,1);
  assert.equal(JSON.stringify(rows).includes('PRIVATE'),false);
});

test('single pass without its public schema fails before either model generation',async()=>{
  for(const tools of [undefined,[],[{name:'write_file'}]]){
    let original=0,finalized=0;const diagnostics=[];
    const rows=await collect(guard({...options,tools},()=>{original++;return reply();},()=>{finalized++;return reply();},row=>diagnostics.push(row),true,true));
    assert.equal(original,0,'missing public schema must not issue an unpublishable model request');
    assert.equal(finalized,0,'single pass must never silently fall back to a second generation');
    assert.equal(text(rows),'');assert.equal(rows.at(-1).reason.kind,'error');
    assert.equal(diagnostics[0].cause,'public_schema_missing');
  }
});

test('cancellation of an original public prefix stops without a replacement answer',async()=>{
  const controller=new AbortController();
  async function* original(){
    yield {type:'tool-call-delta',index:0,id:'public',name:tool.name,argumentsDelta:'{"reply":"你好'};
    yield {type:'block-end',index:0,block:data('你好。')};
    yield {type:'finish',reason:{kind:'tool-calls'}};
  }
  const rows=[];let finalized=0;
  for await(const row of guard({...options,signal:controller.signal},original,()=>{finalized++;return reply();},()=>{},true,true)){
    rows.push(row);if(row.type==='text-delta')controller.abort();
  }
  assert.equal(text(rows),'你好');assert.equal(finalized,0);assert.equal(rows.at(-1).reason.kind,'aborted');
});

test('invalid original data cannot fall through to execution or a second generation',async()=>{
  for(const args of ['{"reply":"<thinking>PRIVATE"}','{"reply":""}','{"reply":"你好","extra":1}']){
    async function* original(){
      yield {type:'block-end',index:0,block:{...data('unused'),arguments:args}};
      yield {type:'finish',reason:{kind:'tool-calls'}};
    }
    let finalized=0;const rows=await collect(guard(options,original,()=>{finalized++;return reply();},()=>{},false,true));
    assert.equal(text(rows),'');assert.equal(finalized,0);assert.equal(rows.at(-1).reason.kind,'error');
    assert.equal(rows.some(row=>row.type==='tool-call-delta'),false);
  }
});

test('actual plugin adds the schema before request logging only for the configured provider',
  {skip:!process.env.DSH_CONTRACT_ENTRY&&'set DSH_CONTRACT_ENTRY'},async()=>{
    const entry=realpathSync(process.env.DSH_CONTRACT_ENTRY);
    const require=createRequire(entry);
    const {markAgentLoopRequest}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
    const handlers=new Map();let finalized=0;
    const ctx={logger:{info(){},warn(){}},get:key=>key==='systemPrompt'?{}:undefined,
      on:(event,callback)=>handlers.set(event,callback),
      llm:{stream(){finalized++;throw Error('unexpected second generation');}},
    };
    const previous=process.argv[1];
    try{process.argv[1]=entry;await apply(ctx,{providers:['fixture'],streamPublic:true,singlePass:true});}
    finally{process.argv[1]=previous;}
    const assembly=Object.freeze({variables:{provider:'fixture'},tools:Object.freeze([]),sections:Object.freeze([]),contexts:[]});
    const assembled=await handlers.get('system-prompt/assemble')(assembly,{},async()=>assembly);
    assert.deepEqual(assembly.tools,[]);assert.deepEqual(assembly.sections,[]);
    assert.equal(assembled.tools[0].name,tool.name);
    assert.equal(assembled.sections[0].name,'conest:public-reply');
    const other={...assembly,variables:{provider:'other'}};
    assert.equal(await handlers.get('system-prompt/assemble')(other,{},async()=>other),other);
    const rows=await collect(handlers.get('llm/stream')(markAgentLoopRequest({...options,tools:assembled.tools}),reply));
    assert.equal(text(rows),'你好。');assert.equal(rows.at(-1).reason.kind,'stop');assert.equal(finalized,0);
    await assert.rejects(handlers.get('system-prompt/assemble')(assembled,{},async()=>assembled),/duplicate public schema/);
  });
