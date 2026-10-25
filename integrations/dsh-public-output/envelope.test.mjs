import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guard} from './output.mjs';

const options={provider:'fixture',model:'fixture',messages:[],tools:[{name:'conest_public_reply'}]};
const open='<conest_public_reply>',close='</conest_public_reply>';
const collect=async stream=>{const rows=[];for await(const row of stream)rows.push(row);return rows;};
const text=rows=>rows.filter(row=>row.type==='text-delta').map(row=>row.text).join('');
function run(source,stream=true,signal){
  let calls=0;
  return {rows:guard({...options,signal},source,()=>{calls++;throw Error('unexpected second generation');},()=>{},stream,true),calls:()=>calls};
}
function source(raw,extra=[]){return async function*(){
  for(let i=0;i<raw.length;i++)yield {type:'text-delta',index:0,text:raw[i]};
  yield {type:'block-end',index:0,block:{type:'text',text:raw}};
  yield* extra;
  yield {type:'finish',reason:{kind:extra.length?'tool-calls':'stop'}};
};}

test('public field streams literal paths, quotes, newlines and split Unicode without JSON encoding',async()=>{
  const answer='路径 C:'+String.fromCharCode(92)+'Temp，名字是“肥鱼”。'+String.fromCharCode(10)+'"你好" 😀。';
  for(const stream of [true,false]){
    const attempt=run(source(open+answer+close),stream);
    const rows=await collect(attempt.rows);
    assert.equal(text(rows),answer);assert.equal(rows.at(-1).reason.kind,'stop');assert.equal(attempt.calls(),0);
  }
});

test('public text first character arrives before the model finishes',async()=>{
  const gate=Promise.withResolvers();let released=false;
  async function* original(){
    yield {type:'reasoning-delta',index:0,text:'PRIVATE'};
    yield {type:'text-delta',index:1,text:open+'你'};
    await gate.promise;
    yield {type:'text-delta',index:1,text:'好。'+close};
    yield {type:'finish',reason:{kind:'stop'}};
  }
  const attempt=run(original);const iterator=attempt.rows[Symbol.asyncIterator]();const rows=[];let timer;
  try{
    await Promise.race([(async()=>{while(!text(rows)){const row=await iterator.next();assert.equal(row.done,false);rows.push(row.value);}released=true;})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('first character buffered')),300);})]);
  }finally{clearTimeout(timer);gate.resolve();}
  for await(const row of {[Symbol.asyncIterator]:()=>iterator})rows.push(row);
  assert.equal(released,true);assert.equal(text(rows),'你好。');assert.equal(attempt.calls(),0);assert.equal(JSON.stringify(rows).includes('PRIVATE'),false);
});

for(const raw of ['PRIVATE', 'PRIVATE'+open+'你好'+close,open+'你好',open+'你好'+close+'extra',open+'你好'+close+open+'其他'+close,open+'<think>PRIVATE</think>'+close,open+close]){
  test('invalid public text fails without a replacement generation: '+raw.length,async()=>{
    const attempt=run(source(raw));const rows=await collect(attempt.rows);
    assert.equal(rows.at(-1).reason.kind,'error');assert.equal(attempt.calls(),0);assert.equal(text(rows).includes('PRIVATE'),false);
  });
}

test('public envelope mixed with an execution call does not dispatch a tool',async()=>{
  const tool={type:'block-end',index:1,block:{type:'tool-call',id:'one',name:'write_file',arguments:'{}'}};
  const attempt=run(source(open+'完成。'+close,[tool]));const rows=await collect(attempt.rows);
  assert.equal(rows.at(-1).reason.kind,'error');assert.equal(rows.some(row=>row.type==='block-end'&&row.block.type==='tool-call'),false);assert.equal(attempt.calls(),0);
});

test('cancellation after a public text prefix does not replace the answer',async()=>{
  const abort=new AbortController();const attempt=run(source(open+'你好。'+close),true,abort.signal);const rows=[];
  for await(const row of attempt.rows){rows.push(row);if(row.type==='text-delta')abort.abort();}
  assert.equal(text(rows),'你');assert.equal(rows.at(-1).reason.kind,'aborted');assert.equal(attempt.calls(),0);
});
