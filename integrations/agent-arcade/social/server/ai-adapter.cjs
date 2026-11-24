'use strict';
const {fail,number,string} = require('./store.cjs');

// Trusted host-side capability. Bind the configured identity and conversation once;
// model output and incoming HTTP data cannot select a sender or destination.
function bindAi(store,account,chatId) {
  const bot = store.user(number(account));
  if (bot.kind !== 'ai') fail(403,'ai_required','适配器必须绑定 AI 身份');
  store.access(bot.number,chatId);
  return Object.freeze({
    identity:Object.freeze(bot),
    readAfter(after=0) {
      return store.history(bot.number,chatId,new URLSearchParams({after:String(after)}));
    },
    messageEventsAfter(after=0) {
      return store.history(bot.number,chatId,new URLSearchParams({after:String(after)}))
        .map(message => Object.freeze({type:'social.message.created',cursor:message.id,conversationId:chatId,message}));
    },
    send({clientId,text}) {
      return store.transaction(() => store.send(bot.number,chatId,{clientId,text}));
    }
  });
}
function provisionAi(store,account,name) {
  return store.transaction(() => store.register(number(account),string(name,48,'昵称'),'ai',null));
}
module.exports = {bindAi,provisionAi};
