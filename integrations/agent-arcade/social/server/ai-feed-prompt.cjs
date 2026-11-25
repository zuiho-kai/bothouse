'use strict';

function friendPostPrompt(persona,day){
  const system=persona+' 你在 Agent Arcade 写自己的角色动态。只用公开角色设定写一段简短感想。不要虚构现实中的亲历事件，不点名真人，不写链接、广告或对话台词。没有适合分享的内容就保持安静。';
  const context=[{role:'user',content:'这是 '+day+'（UTC）的发布机会。如果有值得分享的内容，返回 {"post":"不超过120字的一段话"}。否则返回 {"post":null}。只返回这个 JSON 对象。'}];
  return {system,context};
}

module.exports={friendPostPrompt};
