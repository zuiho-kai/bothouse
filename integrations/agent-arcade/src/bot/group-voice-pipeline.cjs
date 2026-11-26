'use strict';
const {InboundVoiceError,ScopedVoicePipeline}=require('./qq-inbound-voice.cjs');

const policy=Object.freeze({
 capture(message,b,acceptAfter){
  const voice=message?.voice;
  if(message?.route!=='group'||voice?.kind!=='qq-group-voice'||message.accountId!==b.accountId||
   voice.accountId!==b.accountId||message.groupId!==b.groupId||voice.groupId!==b.groupId||
   message.from!==b.memberId||voice.senderId!==b.memberId||voice.createdAt!==message.createdAt||
   !Number.isSafeInteger(voice.createdAt)||voice.createdAt<Math.max(acceptAfter,b.client.acceptAfter||0)||message.id!==`group:${b.groupId}:${voice.id}`){
   throw new InboundVoiceError('wrong_scope');
  }
  return message;
 },
 matches(a,b){
  return a.clientGeneration===b?.client?.generation&&a.socket===b?.client?.socket&&
   ['client','dispatcher','scopeId','generation','accountId','groupId','memberId'].every(key=>a[key]===b[key]);
 },
 read:(reader,message,b,signal,assertCurrent)=>reader.read(b.client,message,{signal,assertCurrent}),
 speaker:b=>({groupId:b.groupId,memberId:b.memberId}),
 source:'qq-group-voice',target:'group-companion-only',
});
class GroupVoicePipeline extends ScopedVoicePipeline{
 constructor(options){super({...options,keepWarm:false},policy);}
}
module.exports={GroupVoicePipeline};
