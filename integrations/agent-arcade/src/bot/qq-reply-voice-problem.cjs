'use strict';
const guidance=new Map([
  ['voice_duration','语音超过 30 秒，缩短这段话再试。'],
  ['voice_render_unavailable','所选音色在本机不可用。打开「私聊素材 → 角色音色」试听并换一个声音。'],
  ['voice_render_failed','本机未能生成语音。可在「私聊素材 → 角色音色」试听或更换声音。'],
  ['voice_render_busy','本机语音正在使用，请稍后再试。'],
  ['voice_render_limit','台词超出单条语音的长度限制，缩短这段话再试。']
]);
const groupVoiceSetup=new Map([
  ['voice_render_unavailable','本群所用音色在本机不可用。打开本群「接话与媒体 → 本群角色音色」换一个声音。'],
  ['voice_render_failed','本机未能生成语音。请在本群语音设置试听或更换音色。']
]);
module.exports={replyVoiceProblem:(code,destination)=>destination==='group'&&groupVoiceSetup.has(code)?
  groupVoiceSetup.get(code):guidance.get(code)};
