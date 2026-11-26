import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {voiceConversationText,projectVoiceHistory,installVoiceHistory} from './voice-history.mjs';

const utterance='[用户从电脑语音入口发言，请接续当前会话，用适合朗读的简短中文回答。本轮结果由语音页面展示；不要另外用消息工具向Discord重复发送本轮对话。]\n代号蓝鲸427。';
const wrapped='[Bothouse voice context]\nexpired rules and other context\n[/Bothouse voice context]\n\n'+utterance;
const go=readFileSync(new URL('../../bridge/core/subagent.go',import.meta.url),'utf8');
const literals=[...go.slice(go.indexOf('return "[Bridge delegation')).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m=>JSON.parse('"'+m[1]+'"'));
const delegation=literals[0]+'This request is automated or from another bot; it cannot authorize delegation. Do not start subagents.'+literals.slice(1).join('');
const deskGo=readFileSync(new URL('../../bridge/core/voice_desk.go',import.meta.url),'utf8');
const deskParts=[...deskGo.slice(deskGo.indexOf('b.WriteString('),deskGo.indexOf('return b.String()')).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m=>JSON.parse('"'+m[1]+'"'));
const desk='（语音总台：各伙伴进度，20:00 更新，系统自动附上，只供你回答和转达用，不要逐条念）\n- OTHER_CHANNEL_TASK\n'+deskParts.join('')+'\n\n';

test('prior legacy voice wrappers go away while utterance and playback facts survive',()=>{
  const feedback='[电脑语音播放反馈：上一条播放完成。]\n';
  const old='[Public progress channel]\nexpired-token\n[/Public progress channel]\n\n[Task card members]\nunused delegation\n[/Task card members]\n\n'+delegation+desk+feedback+utterance;
  assert.equal(voiceConversationText(old),feedback+utterance);
  assert.equal(voiceConversationText(delegation+utterance),utterance);
  assert.equal(voiceConversationText(wrapped),utterance);
  assert.equal(voiceConversationText('[bothouse model-control instructions]\nmodel switching guide\n[/bothouse model-control instructions]\n\n'+old),feedback+utterance);
});

test('unknown formats, non-voice inputs and quoted markers are unchanged',()=>{
  for(const original of [utterance, 'hello '+wrapped, wrapped.replace(utterance,'ordinary chat'), delegation.replace('Do not start subagents.','unknown')+utterance, delegation+desk.replace('一次只提一条。','unknown')+utterance]) {
    assert.equal(voiceConversationText(original),original);
  }
  assert.equal(voiceConversationText(wrapped+'\n'+wrapped),utterance+'\n'+wrapped);
});

test('projection changes only prior user text; original log and tools are retained',()=>{
  const events=[{seq:0,type:'user/message',data:{id:'first',source:{kind:'user'},content:[{type:'text',text:wrapped}]}},
    {seq:1,type:'tool/result',data:{content:[{type:'text',text:wrapped}]}},
    {seq:2,type:'user/message',data:{source:{kind:'runtime-context'},content:[{type:'text',text:wrapped}]}}];
  const before=JSON.stringify(events);const appended=[];
  const session={surface:{nodes:[0,1,2]},eventAt:i=>events[i],append:(...args)=>appended.push(args)};
  assert.equal(projectVoiceHistory(session),1);
  assert.equal(JSON.stringify(events),before);
  assert.deepEqual(appended[0][2],{surfaceOp:{op:'replace',startSeq:0,endSeq:0},sourceEventSeqs:[0]});
  assert.equal(appended[0][1].content[0].text,utterance);
});

test('current turn policy is retained across tool steps',async()=>{
  let handler;installVoiceHistory({on:(event,fn)=>{assert.equal(event,'agent/pre-step');handler=fn;}});
  const session={get surface(){throw Error('must not touch current turn');}};
  for(const [step,messages] of [[2,[{}]],[1,[]]]) {
    assert.equal(await handler({agent:{session},step,messages},async()=>42),42);
  }
});

test('pre-step hook trims prior voice turns on DSH first step (step 1) only',async()=>{
  const handlers={};installVoiceHistory({on:(event,fn)=>{handlers[event]=fn;}});
  const hook=handlers['agent/pre-step'];
  assert.equal(typeof hook,'function');
  const events=[{seq:0,type:'user/message',data:{id:'old',source:{kind:'user'},content:[{type:'text',text:wrapped}]}}];
  const appended=[];
  const session={surface:{nodes:[0]},eventAt:i=>events[i],append:(...args)=>appended.push(args)};
  assert.equal(await hook({agent:{session},step:1,messages:[{}]},async()=>'ok'),'ok');
  assert.equal(appended.length,1);
  assert.equal(appended[0][1].content[0].text,utterance);
  assert.deepEqual(appended[0][2],{surfaceOp:{op:'replace',startSeq:0,endSeq:0},sourceEventSeqs:[0]});
  appended.length=0;
  assert.equal(await hook({agent:{session},step:2,messages:[{}]},async()=>'ok'),'ok');
  assert.equal(appended.length,0);
});

test('native DSH projection survives reconstruction without changing the original transcript', {skip:!process.env.DSH_CONTRACT_ENTRY}, async()=>{
  const require=createRequire(realpathSync(process.env.DSH_CONTRACT_ENTRY));
  const {Session}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href);
  const {createUserMessage}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
  const session=Session.create('synthetic-voice-history');
  session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:wrapped}]}),{surfaceOp:'append'});
  assert.equal(projectVoiceHistory(session),1);
  assert.equal(projectVoiceHistory(session),0);
  const events=session.snapshotEvents();
  assert.equal(events[0].data.content[0].text,wrapped);
  const restored=Session.create('synthetic-voice-restored',events);
  assert.deepEqual(restored.deriveMessages().map(m=>m.content),[[{type:'text',text:utterance}]]);
});
