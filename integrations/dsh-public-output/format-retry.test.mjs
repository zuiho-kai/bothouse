import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guard,finalRequest,parseReply} from './output.mjs';

const options={provider:'fixture',model:'fixture',sessionId:'same-session',messages:[
  {id:'task',role:'user',source:{kind:'user'},content:[{type:'text',text:'报告已经完成的工作'}]},
]};
async function* stream(text) {
  if(text!==undefined)yield {type:'block-end',index:0,block:{type:'text',text}};
  yield {type:'finish',reason:{kind:'stop'}};
}
const collect=async source=>{const chunks=[];for await(const c of source)chunks.push(c);return chunks;};

test('172: finalizer specifies valid escaping before a multiline answer',()=>{
  const request=finalRequest(options);
  // A real JSON example, including newline, quote and backslash, must reach
  // the model as encoded characters rather than an invalid multiline string.
  const example=JSON.stringify({reply:'第一行\n第二行含"引号"与反斜线\\。'});
  assert.ok(request.system.includes(example),'missing valid JSON escaping example');
  assert.equal(request.tools,undefined);
});

test('172: malformed multiline final answer gets corrective retry without replaying tools or private draft',async()=>{
  const bad='{"reply":"PRIVATE first line\nPRIVATE second line"}';
  assert.equal(parseReply(bad),null);
  const requests=[];let originalCalls=0;
  const chunks=await collect(guard(options,()=>{originalCalls++;return stream('PRIVATE original draft');},request=>{
    requests.push(request);
    const correction=request.messages.at(-1).content[0].text;
    // Model boundary reproduces the incident until the retry tells it that
    // the prior JSON failed and newline characters need encoding.
    return stream(correction.includes('上一次')&&correction.includes('转义')
      ? JSON.stringify({reply:'已完成检查。\n尚未部署。'}) : bad);
  }));
  assert.equal(chunks.at(-1).reason.kind,'stop','malformed output must recover through a corrected request');
  assert.equal(chunks.filter(c=>c.type==='text-delta').map(c=>c.text).join(''),'已完成检查。\n尚未部署。');
  assert.equal(originalCalls,1);assert.equal(requests.length,2);
  for(const request of requests){
    assert.equal(request.tools,undefined);assert.equal(request.sessionId,options.sessionId);
    assert.equal(JSON.stringify(request).includes('PRIVATE'),false);
  }
  assert.equal(requests[0].signal,requests[1].signal,'retry shares the same deadline');
  assert.deepEqual(requests[0].messages.slice(0,-1).map(m=>m.content),requests[1].messages.slice(0,-1).map(m=>m.content));
});
