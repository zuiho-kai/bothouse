'use strict';

// One ordinary QQ group can be observed by more than one of this household's
// connected companions. A peer reply never replenishes their shared budget.
const MAX_PEER_TURNS=2;
const TOPIC_WINDOW=5*60*1000;
const MAX_GROUPS=32;
const MAX_EVENTS=128;
const MAX_COMMAND_RECEIPTS=256;
const validKey=key=>typeof key==='string'&&/^[0-9a-f]{64}$/.test(key);
const validMessageId=id=>(typeof id==='string'||Number.isSafeInteger(id))&&/^-?\d{1,20}$/.test(id);
const replyScope=(groupId,sender)=>JSON.stringify([groupId,sender]);
const receiptKey=(scope,id)=>JSON.stringify([scope,id]);
function remember(cache,key){
  cache.add(key);
  if(cache.size>MAX_EVENTS)cache.delete(cache.values().next().value);
}

class GroupPeerTurns {
  constructor(now=Date.now){
    this.now=now;
    this.groups=new Map();
    this.pendingCommandReplies=new Map();
    this.commandReceipts=new Map();
  }
  beginCommandReply(groupId,sender){
    const scope=replyScope(groupId,sender),pending=this.pendingCommandReplies.get(scope)||new Set();
    let settle;
    const finished=new Promise(resolve=>{settle=resolve;});
    pending.add(finished);
    this.pendingCommandReplies.set(scope,pending);
    return id=>{
      if(!pending.delete(finished))return;
      if(!pending.size)this.pendingCommandReplies.delete(scope);
      if(validMessageId(id)){
        const key=receiptKey(scope,`group:${groupId}:${id}`);
        this.commandReceipts.delete(key);
        this.commandReceipts.set(key,this.now());
        if(this.commandReceipts.size>MAX_COMMAND_RECEIPTS)this.commandReceipts.delete(this.commandReceipts.keys().next().value);
      }
      settle();
    };
  }
  commandEcho({groupId,from,id,unsupported,image,voice,attachments}){
    const prefix=`group:${groupId}:`;
    if(typeof id!=='string'||!id.startsWith(prefix)||!validMessageId(id.slice(prefix.length)))return false;
    const scope=replyScope(groupId,from),key=receiptKey(scope,id);
    const confirmed=()=>{
      const at=this.commandReceipts.get(key);
      if(at===undefined)return false;
      if(this.now()-at<TOPIC_WINDOW)return true;
      this.commandReceipts.delete(key);
      return false;
    };
    if(confirmed())return true;
    const pending=this.pendingCommandReplies.get(scope);
    if(!pending?.size||unsupported||image||voice||attachments)return false;
    // The second socket may observe a message before the first socket gets
    // its action receipt. Wait only on in-flight submissions in this scope.
    const finishing=[...pending];
    return ()=>Promise.all(finishing).then(confirmed);
  }
  observeHuman({groupId,createdAt,groupEventKey}){
    const now=this.now();
    if(!Number.isSafeInteger(createdAt)||createdAt<now-TOPIC_WINDOW||createdAt>now+60000||
       !validKey(groupEventKey))return;
    const previous=this.groups.get(groupId);
    if(previous&&(createdAt<previous.topic.at||previous.humanEvents.has(groupEventKey)))return;
    const humanEvents=previous?.humanEvents||new Set(),peerEvents=previous?.peerEvents||new Set();
    remember(humanEvents,groupEventKey);
    this.groups.delete(groupId);
    this.groups.set(groupId,{topic:{at:createdAt,remaining:MAX_PEER_TURNS},humanEvents,peerEvents});
    if(this.groups.size>MAX_GROUPS)this.groups.delete(this.groups.keys().next().value);
  }
  peerTurn({groupId,createdAt,groupEventKey,quote},receiver){
    const state=this.groups.get(groupId),topic=state?.topic;
    const reference=typeof quote?.id==='string'?quote.id:'';
    const key=validKey(groupEventKey)?JSON.stringify([receiver,groupEventKey,reference]):null;
    let spent=false;
    const current=()=>!!topic&&this.groups.get(groupId)?.topic===topic&&
      Number.isSafeInteger(createdAt)&&createdAt>=topic.at&&this.now()-topic.at<TOPIC_WINDOW;
    return {
      current,
      spend:()=>{
        if(spent||!key||!current()||topic.remaining===0||state.peerEvents.has(key))return false;
        spent=true;
        topic.remaining--;
        remember(state.peerEvents,key);
        return true;
      },
    };
  }
}

module.exports={GroupPeerTurns};
