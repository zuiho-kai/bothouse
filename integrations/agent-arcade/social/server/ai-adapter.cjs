'use strict';
const {fail,number,string} = require('./store.cjs');
const {modelHistoryAfter} = require('./model-context.cjs');

// Trusted host-side capability. Bind the configured identity and conversation once;
// model output and incoming HTTP data cannot select a sender or destination.
function bindAi(store,account,chatId) {
  const bot = store.user(number(account));
  if (bot.kind !== 'ai') fail(403,'ai_required','适配器必须绑定 AI 身份');
  store.access(bot.number,chatId);
  const readAfter=(after=0)=>modelHistoryAfter(store,bot.number,chatId,after);
  return Object.freeze({
    identity:Object.freeze(bot),
    readAfter,
    messageEventsAfter(after=0) {
      return readAfter(after)
        .map(message => Object.freeze({type:'social.message.created',cursor:message.id,conversationId:chatId,message}));
    },
    send({clientId,text},afterSend) {
      return store.transaction(() => {
        const message=store.send(bot.number,chatId,{clientId,text});
        afterSend?.(message);
        return message;
      });
    },
    sendSticker(clientId,image,afterSend) {
      return store.transaction(() => {
        const message=store.sendAiSticker(bot.number,chatId,clientId,image);
        afterSend?.(message);
        return message;
      });
    },
    sendDrawing(clientId,image,afterSend) {
      return store.transaction(() => {
        const message=store.sendAiDrawing(bot.number,chatId,clientId,image);
        afterSend?.(message);
        return message;
      });
    },
    sendVoice(clientId,voice,transcript,afterSend) {
      return store.transaction(() => {
        const message=store.sendAiVoice(bot.number,chatId,clientId,voice,transcript);
        afterSend?.(message);
        return message;
      });
    }
  });
}
function provisionAi(store,account,name) {
  return store.transaction(() => store.register(number(account),string(name,48,'昵称'),'ai',null));
}
module.exports = {bindAi,provisionAi};
