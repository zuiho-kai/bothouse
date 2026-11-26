import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guard,finalRequest} from './output.mjs';

const options={provider:'fixture',model:'fixture',sessionId:'same',messages:[],tools:[{name:'write_file'}]};
const name='conest_public_reply';
const call=(args={reply:'已完成检查。\n尚未部署。'},tool=name)=>({type:'tool-call',id:'output-only',name:tool,arguments:typeof args==='string'?args:JSON.stringify(args)});
async function* stream(blocks=[],kind='stop'){
  for(const [index,block] of blocks.entries())yield {type:'block-end',index,block};
  yield {type:'finish',reason:{kind}};
}
const collect=async source=>{const out=[];for await(const c of source)out.push(c);return out;};
const reply=chunks=>chunks.filter(c=>c.type==='text-delta').map(c=>c.text).join('');

test('finalizer advertises only a closed public reply schema, never execution tools',()=>{
  const request=finalRequest(options);
  assert.deepEqual(request.tools?.map(t=>t.name),[name]);
  const schema=request.tools[0].parameters;
  assert.equal(schema.type,'object');
  assert.equal(schema.additionalProperties,false);
  assert.deepEqual(schema.required,['reply']);
  assert.equal(schema.properties.reply.type,'string');
  assert.equal(request.provider,options.provider);
  assert.equal(request.model,options.model);
  assert.equal(request.sessionId,options.sessionId);
});

test('12:10 format failure then timeout is avoided when the provider receives a reply schema',async()=>{
  const nativeTimeout=AbortSignal.timeout;
  AbortSignal.timeout=()=>nativeTimeout(25);
  const keep=setTimeout(()=>{},1000);
  let originals=0,finals=0;
  try{
    const out=await collect(guard(options,()=>{originals++;return stream();},async function*(request){
      finals++;
      if(request.tools?.length===1&&request.tools[0].name===name){
        yield* stream([call()],'tool-calls');
      }else if(finals===1){
        yield* stream([{type:'text',text:'ordinary prose, not JSON'}]);
      }else{
        await new Promise(resolve=>request.signal.addEventListener('abort',resolve,{once:true}));
      }
    }));
    assert.equal(out.at(-1).reason.kind,'stop');
    assert.equal(reply(out),'已完成检查。\n尚未部署。');
    assert.equal(finals,1);assert.equal(originals,1);
    assert.equal(out.some(c=>c.type==='block-end'&&c.block.type==='tool-call'),false);
  }finally{clearTimeout(keep);AbortSignal.timeout=nativeTimeout;}
});

test('structured reply discards accompanying private text and reasoning',async()=>{
  const out=await collect(guard(options,()=>stream(),()=>stream([
    {type:'text',text:'PRIVATE draft'},{type:'reasoning',text:'PRIVATE reasoning'},call(),
  ],'tool-calls')));
  assert.equal(out.at(-1).reason.kind,'stop');
  assert.equal(reply(out),'已完成检查。\n尚未部署。');
  assert.equal(JSON.stringify(out).includes('PRIVATE'),false);
});

for(const [label,blocks] of [
  ['wrong name',[call({reply:'bad'},'write_file')]],
  ['extra tool',[call(),{...call({},'shell'),id:'other'}]],
  ['empty',[call({reply:' '})]],
  ['extra field',[call({reply:'answer',analysis:'private'})]],
  ['private marker',[call({reply:'<thinking>private</thinking>'})]],
  ['invalid arguments',[call('not-an-object')]],
])test('structured reply rejects '+label+' without dispatching tools',async()=>{
  const out=await collect(guard(options,()=>stream(),()=>stream(blocks,'tool-calls')));
  assert.equal(out.at(-1).reason.kind,'error');
  assert.equal(reply(out),'');
  assert.equal(out.some(c=>c.type==='block-end'&&c.block.type==='tool-call'),false);
});
