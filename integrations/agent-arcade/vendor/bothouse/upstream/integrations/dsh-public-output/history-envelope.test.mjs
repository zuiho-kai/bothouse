import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guard,finalRequest} from './output.mjs';
import {apply} from './plugin.mjs';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const options={provider:'fixture',model:'test',messages:[]};
const collect=async source=>{const rows=[];for await(const row of source)rows.push(row);return rows;};
async function* response(text){yield {type:'text-delta',index:0,text};yield {type:'finish',reason:{kind:'stop'}};}

test('model history retains a canonical reply while live deltas contain only public prose',async()=>{
  const reply='你好。\n路径 C:\\tmp，名称 "demo"。';
  const rows=await collect(guard(options,()=>response(JSON.stringify({reply})),()=>{throw Error('unexpected finalizer');},()=>{},true,true,true));
  assert.equal(rows.filter(c=>c.type==='text-delta').map(c=>c.text).join(''),reply);
  assert.deepEqual(JSON.parse(rows.find(c=>c.type==='block-end').block.text),{reply});
  assert.equal(rows.at(-1).reason.kind,'stop');
});

test('history mode uses the same JSON protocol for recovery and never carries execution tools',()=>{
  for(const retry of [false,true]){
    const request=finalRequest(options,undefined,retry,true);
    assert.deepEqual(request.tools,[]);
    assert.match(request.system,/唯一的 reply/);
    assert.doesNotMatch(request.system,/只通过 conest_public_reply/);
  }
});

test('paired plugin keeps JSON in the actual DSH assembler, not in public deltas', {skip:!process.env.DSH_CONTRACT_ENTRY}, async()=>{
  const entry=realpathSync(process.env.DSH_CONTRACT_ENTRY);
  const require=createRequire(entry);
  const {BlockAssembler,markAgentLoopRequest}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
  const handlers=new Map();
  const ctx={get:()=>({}),logger:{info(){},warn(){}},on:(event,handler)=>handlers.set(event,handler),llm:{stream(){throw Error('unexpected finalizer');}}};
  const previous=process.argv[1];
  try {process.argv[1]=entry;await apply(ctx,{providers:['fixture'],directReply:true,historyEnvelope:true,streamPublic:true});}
  finally {process.argv[1]=previous;}
  const tools=[{name:'read_file',parameters:{type:'object'}}];
  const original={variables:{provider:'fixture'},tools,sections:[{name:'persona',text:'SYNTHETIC_PERSONA'}]};
  const assembly=await handlers.get('system-prompt/assemble')(null,null,async()=>original);
  assert.equal(assembly.tools,tools);
  assert.equal(assembly.sections[0],original.sections[0]);
  assert.match(assembly.sections.at(-1).text,/唯一的 reply/);
  const rows=await collect(handlers.get('llm/stream')(markAgentLoopRequest({...options,tools}),()=>response('{"reply":"你好。"}')));
  const assembler=new BlockAssembler();
  for(const row of rows)assembler.push(row);
  assert.deepEqual(assembler.blocks(),[{type:'text',text:'{"reply":"你好。"}'}]);
  assert.equal(rows.filter(row=>row.type==='text-delta').map(row=>row.text).join(''),'你好。');
});

for(const failure of ['transport','mixed-tool','rewrite','extra-field','unfinished']){
  test('published original JSON cannot retry or execute after '+failure,async()=>{
    let retries=0;
    async function* broken(){
      yield {type:'text-delta',index:0,text:'{"reply":"公开。'};
      if(failure==='transport') throw Error('PRIVATE fixture');
      if(failure==='mixed-tool') yield {type:'block-end',index:1,block:{type:'tool-call',name:'write_file',id:'once',arguments:'{}'}};
      if(failure==='rewrite') yield {type:'block-end',index:0,block:{type:'text',text:'{"reply":"改写。"}'}};
      if(failure==='extra-field') yield {type:'text-delta',index:0,text:'","other":1}'};
      if(failure!=='unfinished') yield {type:'finish',reason:{kind:'stop'}};
    }
    const rows=await collect(guard(options,broken,()=>{retries++;return response('{"reply":"不该出现"}');},()=>{},true,true,true));
    assert.equal(rows.filter(row=>row.type==='text-delta').map(row=>row.text).join(''),'公开。');
    assert.equal(rows.at(-1).reason.failure.code,'PUBLIC_ANSWER_UNAVAILABLE');
    assert.equal(retries,0);
    assert.equal(rows.some(row=>row.block?.type==='tool-call'||row.type==='tool-call-delta'),false);
  });
}
