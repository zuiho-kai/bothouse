import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guard} from './output.mjs';
import {PublicReplyStream} from './stream.mjs';

const options={provider:'fixture',model:'fixture',messages:[]};
async function* original(){yield {type:'finish',reason:{kind:'stop'}};}
const text=chunks=>chunks.filter(c=>c.type==='text-delta').map(c=>c.text).join('');

test('tool deltas without repeated ids retain the known public call identity',()=>{
  const stream=new PublicReplyStream();
  let answer=stream.push({type:'tool-call-delta',index:0,id:'reply',name:'conest_public_reply',argumentsDelta:'{"reply":"你'});
  answer+=stream.push({type:'tool-call-delta',index:0,argumentsDelta:'好。'});
  answer+=stream.push({type:'block-end',index:0,block:{type:'tool-call',id:'reply',name:'conest_public_reply',arguments:'{"reply":"你好。"}'}});
  assert.equal(answer,'你好。');
});

test('authoritative JSON normalization preserves the already published reply',()=>{
  const stream=new PublicReplyStream();
  const first=stream.push({type:'tool-call-delta',index:0,id:'reply',name:'conest_public_reply',argumentsDelta:'{ "reply": "你好。" }'});
  const last=stream.push({type:'block-end',index:0,block:{type:'tool-call',id:'reply',name:'conest_public_reply',arguments:JSON.stringify({reply:'你好。'})}});
  assert.equal(first+last,'你好。');
});

test('explicit public field forwards first character before finalizer completes, without exposing private blocks',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  async function* final(){
    yield {type:'block-end',index:0,block:{type:'reasoning',text:'PRIVATE'}};
    yield {type:'tool-call-delta',index:1,id:'reply',name:'conest_public_reply',argumentsDelta:'{"reply":"你'};
    await gate;
    yield {type:'tool-call-delta',index:1,id:'reply',argumentsDelta:'好。"}'};
    yield {type:'block-end',index:1,block:{type:'tool-call',id:'reply',name:'conest_public_reply',arguments:'{"reply":"你好。"}'}};
    yield {type:'finish',reason:{kind:'tool-calls'}};
  }
  const stream=guard(options,original,final,()=>{},false,true)[Symbol.asyncIterator]();
  const chunks=[];
  try{
    await Promise.race([(async()=>{while(text(chunks)!=='你'){const row=await stream.next();assert.equal(row.done,false);chunks.push(row.value);}})(),new Promise((_,reject)=>setTimeout(()=>reject(Error('public first character remained buffered')),1000))]);
  }finally{release();}
  while(true){const row=await stream.next();if(row.done)break;chunks.push(row.value);}
  assert.equal(text(chunks),'你好。');
  assert.equal(JSON.stringify(chunks).includes('PRIVATE'),false);
  assert.equal(chunks.at(-1).reason.kind,'stop');
  assert.equal(chunks.some(c=>c.type==='tool-call-delta'),false);
});

for (const second of [
  {type:'tool-call-delta',index:1,id:'other',name:'conest_public_reply',argumentsDelta:'{}'},
  {type:'tool-call-delta',index:0,id:'reply',name:'other',argumentsDelta:'{}'},
  {type:'tool-call-delta',index:0,id:'reply',argumentsDelta:'" ,"extra":1}'},
  {type:'block-end',index:0,block:{type:'tool-call',id:'reply',name:'conest_public_reply',arguments:'{"reply":"changed"}'}},
]) {
  test('invalid continuation cannot replace an already published reply: '+JSON.stringify(second),async()=>{
    let calls=0;const chunks=[];
    async function* final(){
      calls++;
      yield {type:'tool-call-delta',index:0,id:'reply',name:'conest_public_reply',argumentsDelta:'{"reply":"公开。'};
      yield second;
      yield {type:'finish',reason:{kind:'tool-calls'}};
    }
    for await(const chunk of guard(options,original,final,()=>{},false,true))chunks.push(chunk);
    assert.equal(text(chunks),'公开。');
    assert.equal(chunks.at(-1).reason.kind,'error');
    assert.equal(calls,1);
  });
}

test('cancellation interrupts a stuck finalizer after a published prefix',async()=>{
  const controller=new AbortController();
  let calls=0,returned=false;
  const final=()=>{calls++;let first=true;return {
    [Symbol.asyncIterator](){return this;},
    next(){if(first){first=false;return Promise.resolve({done:false,value:{type:'tool-call-delta',index:0,id:'reply',name:'conest_public_reply',argumentsDelta:'{"reply":"你'}});}return new Promise(()=>{});},
    return(){returned=true;return Promise.resolve({done:true});},
  };};
  const chunks=[];
  for await(const chunk of guard({...options,signal:controller.signal},original,final,()=>{},false,true)){
    chunks.push(chunk);
    if(chunk.type==='text-delta')controller.abort();
  }
  assert.equal(text(chunks),'你');
  assert.equal(chunks.at(-1).reason.kind,'aborted');
  assert.equal(calls,1);
  assert.equal(returned,true);
});

for (const reply of ['第一行\n第二行含"引号"和\\。', '😀你好。', 'NO_RE也可以回答', '  两个词 hello world  ']) {
  test('JSON string escapes remain correct across every chunk split: '+reply,()=>{
    const raw=JSON.stringify({reply});
    for(let cut=1;cut<raw.length;cut++){
      const stream=new PublicReplyStream();
      const first=stream.push({type:'tool-call-delta',index:0,id:'reply',name:'conest_public_reply',argumentsDelta:raw.slice(0,cut)});
      const second=stream.push({type:'tool-call-delta',index:0,id:'reply',argumentsDelta:raw.slice(cut)});
      assert.equal(first+second,reply.trim());
    }
  });
}

test('split private markers and ordinary reasoning never enter the live field',()=>{
  const stream=new PublicReplyStream();
  assert.equal(stream.push({type:'reasoning-delta',index:0,text:'PRIVATE'}),'');
  assert.equal(stream.push({type:'text-delta',index:1,text:'PRIVATE'}),'');
  assert.equal(stream.push({type:'tool-call-delta',index:2,id:'reply',name:'conest_public_reply',argumentsDelta:'{"reply":"<thi'}),'');
  assert.equal(stream.push({type:'tool-call-delta',index:2,id:'reply',argumentsDelta:'nking>PRIVATE"}'}),'');
});

test('failure after a public prefix is terminal and cannot generate a second answer',async()=>{
  let calls=0;const chunks=[];
  async function* final(){
    calls++;
    yield {type:'tool-call-delta',index:0,id:'reply',name:'conest_public_reply',argumentsDelta:'{"reply":"已确认。'};
    yield {type:'finish',reason:{kind:'error',failure:{code:'TRANSPORT',message:'PRIVATE'}}};
  }
  for await(const chunk of guard(options,original,final,()=>{},false,true))chunks.push(chunk);
  assert.equal(text(chunks),'已确认。');
  assert.equal(chunks.at(-1).reason.kind,'error');
  assert.equal(calls,1);
  assert.equal(JSON.stringify(chunks).includes('PRIVATE'),false);
});
