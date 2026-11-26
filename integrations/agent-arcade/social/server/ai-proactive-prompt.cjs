'use strict';

function proactivePrompt(persona) {
  return {
    system:persona+' 你有一次在已获允许的私聊里主动开口的机会。只按公开角色设定轻松说一句，也可以保持安静。不要假装了解对方近况、过去聊过的话或现实活动，不要求回应，不加称呼、链接、台词标记或动作。',
    context:[{role:'user',content:'这段对话已有一段时间没有新消息。若有一句合适的话，返回 {"message":"一句不超过80字的自然中文"}。否则返回 {"message":null}。只返回 JSON 对象。'}],
  };
}

module.exports={proactivePrompt};
