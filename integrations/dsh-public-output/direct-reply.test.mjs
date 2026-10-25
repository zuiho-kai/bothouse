import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {guard} from './output.mjs';
import {apply} from './plugin.mjs';

const name = 'conest_public_reply';
const options = {provider:'fixture',model:'fixture',messages:[],tools:[{name}]};
const data = args => ({type:'tool-call',id:'public',name,arguments:JSON.stringify(args)});
async function* stream(blocks, kind='stop') {
  for (const [index,block] of blocks.entries()) yield {type:'block-end',index,block};
  yield {type:'usage',usage:{inputTokens:3,outputTokens:2}};
  yield {type:'finish',reason:{kind}};
}
const collect = async source => {const rows=[];for await (const row of source) rows.push(row);return rows;};
const text = rows => rows.filter(row=>row.type==='text-delta').map(row=>row.text).join('');

test('valid original public data ends the turn without a second model call or data execution',async()=>{
  let finalizations=0;
  const rows=await collect(guard(options,()=>stream([
    {type:'text',text:'PRIVATE DRAFT'},{type:'reasoning',text:'PRIVATE REASONING'},data({reply:'你好。'}),
  ],'tool-calls'),()=>{finalizations++;return stream([data({reply:'unused'})],'tool-calls');},()=>{},true));
  assert.equal(text(rows),'你好。');
  assert.equal(finalizations,0);
  assert.equal(rows.at(-1).reason.kind,'stop');
  assert.equal(JSON.stringify(rows).includes('PRIVATE'),false);
  assert.equal(rows.some(row=>row.type==='tool-call-delta'),false);
  assert.deepEqual(rows.find(row=>row.type==='usage').usage,{inputTokens:3,outputTokens:2});
});

test('strict original JSON is an explicit public field too',async()=>{
  let finalized=0;
  const rows=await collect(guard(options,()=>stream([{type:'text',text:'{"reply":"你好。"}'}]),()=>{finalized++;return stream([data({reply:'unused'})],'tool-calls');},()=>{},true));
  assert.equal(text(rows),'你好。');assert.equal(finalized,0);
});

for(const [label,blocks,kind] of [
  ['ordinary text',[{type:'text',text:'PRIVATE DRAFT'}],'stop'],
  ['invalid data',[data({reply:''})],'tool-calls'],
  ['extra field',[data({reply:'unverified',analysis:'PRIVATE DRAFT'})],'tool-calls'],
  ['private marker',[data({reply:'<thinking>PRIVATE DRAFT'})],'tool-calls'],
  ['silent prose with invalid data',[{type:'text',text:'NO_REPLY'},data({reply:''})],'tool-calls'],
]) test('unpublishable original '+label+' uses the existing isolated finalizer',async()=>{
  let finalized=0;
  const rows=await collect(guard(options,()=>stream(blocks,kind),request=>{
    finalized++;
    assert.equal(JSON.stringify(request).includes('PRIVATE DRAFT'),false);
    assert.deepEqual(request.tools.map(tool=>tool.name),[name]);
    return stream([data({reply:'恢复回答。'})],'tool-calls');
  },()=>{},true));
  assert.equal(text(rows),'恢复回答。');assert.equal(finalized,1);
  assert.equal(rows.at(-1).reason.kind,'stop');
  assert.equal(rows.some(row=>row.type==='tool-call-delta'),false);
  assert.deepEqual(rows.find(row=>row.type==='usage').usage,{inputTokens:6,outputTokens:4});
});

test('format rejection retains both bounded recovery attempts, never reruns original execution',async()=>{
  let originals=0,finalized=0;
  const rows=await collect(guard(options,()=>{originals++;return stream([{type:'text',text:'PRIVATE'}]);},()=>{
    finalized++;return finalized===1?stream([{type:'text',text:'invalid'}]):stream([data({reply:'恢复回答。'})],'tool-calls');
  },()=>{},true));
  assert.equal(text(rows),'恢复回答。');assert.equal(originals,1);assert.equal(finalized,2);
});

test('mixed public and execution calls dispatch neither and cannot claim completion',async()=>{
  let finalized=0;
  const rows=await collect(guard(options,()=>stream([data({reply:'已执行。'}),{type:'tool-call',id:'write',name:'write_file',arguments:'{}'}],'tool-calls'),()=>{finalized++;return stream([]);},()=>{},true));
  assert.equal(text(rows),'');assert.equal(finalized,0);
  assert.equal(rows.at(-1).reason.kind,'error');
  assert.equal(rows.some(row=>row.type==='tool-call-delta'),false);
});

test('ordinary execution remains one call with its original id and arguments',async()=>{
  const call={type:'tool-call',id:'write-once',name:'write_file',arguments:'{"path":"fixture"}'};
  let finalized=0;
  const rows=await collect(guard(options,()=>stream([{type:'text',text:'PRIVATE'},call],'tool-calls'),()=>{finalized++;return stream([]);},()=>{},true));
  assert.equal(text(rows),'');assert.equal(finalized,0);
  assert.deepEqual(rows.filter(row=>row.type==='block-end'&&row.block.type==='tool-call').map(row=>row.block),[call]);
});

test('direct mode without an assembled schema fails before making an unpublishable request',async()=>{
  let requested=0;
  const rows=await collect(guard({...options,tools:[]},()=>{requested++;return stream([]);},()=>{requested++;return stream([]);},()=>{},true));
  assert.equal(requested,0);assert.equal(rows.at(-1).reason.kind,'error');
});

test('public prefix remains buffered until the complete response has passed validation',async()=>{
  const controller=new AbortController();let finalized=0;
  async function* original(){
    yield {type:'tool-call-delta',index:0,id:'public',name,argumentsDelta:'{"reply":"你好'};
    controller.abort();
    yield {type:'block-end',index:0,block:data({reply:'你好。'})};
    yield {type:'finish',reason:{kind:'tool-calls'}};
  }
  const rows=await collect(guard({...options,signal:controller.signal},original,()=>{finalized++;return stream([]);},()=>{},true));
  assert.equal(text(rows),'');assert.equal(finalized,0);assert.equal(rows.at(-1).reason.kind,'aborted');
});

test('actual plugin assembles the schema for its provider and keeps finalizer requests out of the agent loop',
  {skip:!process.env.DSH_CONTRACT_ENTRY&&'set DSH_CONTRACT_ENTRY'},async()=>{
    const entry=realpathSync(process.env.DSH_CONTRACT_ENTRY);
    const require=createRequire(entry);
    const {markAgentLoopRequest,isAgentLoopRequest}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
    const handlers=new Map();let finalized=0;
    const ctx={logger:{info(){},warn(){}},get:key=>key==='systemPrompt'?{}:undefined,
      on:(event,callback)=>handlers.set(event,callback),
      llm:{stream(request){
        finalized++;assert.equal(isAgentLoopRequest(request),false);
        return handlers.get('llm/stream')(request,()=>stream([data({reply:'恢复。'})],'tool-calls'));
      }},
    };
    const previous=process.argv[1];
    try{process.argv[1]=entry;await apply(ctx,{providers:['fixture'],directReply:true});}
    finally{process.argv[1]=previous;}
    const assembly=Object.freeze({variables:{provider:'fixture'},tools:Object.freeze([{name:'read_file'}]),sections:Object.freeze([]),contexts:[]});
    const assembled=await handlers.get('system-prompt/assemble')(assembly,{},async()=>assembly);
    assert.equal(assembly.tools.length,1);assert.equal(assembly.sections.length,0);
    assert.deepEqual(assembled.tools.map(tool=>tool.name),['read_file',name]);
    assert.equal(assembled.sections[0].name,'conest:public-reply');
    const other={...assembly,variables:{provider:'other'}};
    assert.equal(await handlers.get('system-prompt/assemble')(other,{},async()=>other),other);
    await assert.rejects(handlers.get('system-prompt/assemble')(assembled,{},async()=>assembled),/duplicate public schema/);
    const request=()=>markAgentLoopRequest({...options,tools:assembled.tools});
    const rows=await collect(handlers.get('llm/stream')(request(),()=>stream([data({reply:'直接。'})],'tool-calls')));
    assert.equal(text(rows),'直接。');assert.equal(finalized,0);
    const recovered=await collect(handlers.get('llm/stream')(request(),()=>stream([{type:'text',text:'PRIVATE'}])));
    assert.equal(text(recovered),'恢复。');assert.equal(finalized,1);
  });
