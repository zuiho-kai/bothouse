'use strict';
const {randomUUID}=require('node:crypto');
const {prepareInbound}=require('./weixin.cjs');
const {MessengerError,fail,plain,id,mid,uuid,text,secret,requestJSON,WINDOW,TTL}=require('./messenger-transport.cjs');
const GRAPH='https://graph.facebook.com/v26.0',POLL=5000;
function prepareMessengerInbound(message){if(message.unsupported)return {...message,text:'',rejection:'Messenger Page 渠道只处理指定主人的私聊文字；附件和混合内容不作为任务或授权。'};return prepareInbound(message);}
class MessengerClient{
  constructor({appId,pageId,ownerId,pageAccessToken,relayOrigin,relayToken,fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=15000}={}){
    if(!id(appId)||!id(pageId)||!id(ownerId)||ownerId===pageId||typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail('invalid_config');
    let origin;try{origin=new URL(relayOrigin);}catch{fail('invalid_config');}
    if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)fail('invalid_config');
    this.appId=appId;this.pageId=pageId;this.ownerId=ownerId;this.pageToken=secret(pageAccessToken,8);this.relayToken=secret(relayToken);this.relayOrigin=origin.origin;
    this.fetch=fetchImpl;this.now=now;this.timeoutMs=timeoutMs;this.acceptAfter=now();this.closed=false;this.ready=false;this.connecting=false;this.polling=false;this.sending=false;this.acking=false;
    this.accountId='';this.contextToken=null;this.sessionId=null;this.pending=null;this.attempted=new Set();this.windowUntil=0;this.nextPollAt=0;this.life=new AbortController();
  }
  _base(signal){if(this.closed)fail('closed');if(signal?.aborted)fail('aborted');}
  _guard(context,signal){this._base(signal);if(!this.ready||!context||this.contextToken!==context)fail('changed');}
  _signal(signal){return AbortSignal.any([this.life.signal,...(signal?[signal]:[])]);}
  async _me(signal,guard){const value=await requestJSON(this.fetch,`${GRAPH}/me?fields=id`,{token:this.pageToken,signal,assertCurrent:guard,timeoutMs:this.timeoutMs});guard();if(value.id!==this.pageId)fail('page_changed');return value.id;}
  async _relay(path,body,signal,guard,write=false){try{return await requestJSON(this.fetch,this.relayOrigin+path,{method:body?'POST':'GET',token:this.relayToken,body,signal,assertCurrent:guard,timeoutMs:this.timeoutMs,write});}catch(error){if(error.code==='changed')fail('relay_changed');throw error;}}
  _problem(error){const code=error instanceof MessengerError?error.code:'connection_failed';if(['page_changed','relay_changed','invalid_response','requires_reauthorization','permission_denied'].includes(code)){this.ready=false;this.contextToken=null;}return new MessengerError(code,{retryAt:error?.retryAt});}
  async connect(signal){
    this._base(signal);if(this.ready)return {accountId:this.accountId,pageId:this.pageId,ownerId:this.ownerId};if(this.connecting)fail('operation_in_progress');this.connecting=true;
    const combined=this._signal(signal),guard=()=>this._base(combined);
    try{await this._me(combined,guard);const status=await this._relay('/v1/status',null,combined,guard);guard();
      if(status.schema!=='messenger_relay_v1'||status.appId!==this.appId||status.pageId!==this.pageId||status.ownerId!==this.ownerId||!uuid(status.sessionId))fail('relay_changed');
      await this._me(combined,guard);guard();this.acceptAfter=this.now();this.accountId=this.pageId;this.sessionId=status.sessionId;this.contextToken=randomUUID();this.ready=true;return {accountId:this.accountId,pageId:this.pageId,ownerId:this.ownerId};
    }catch(error){throw this._problem(error);}finally{this.connecting=false;}
  }
  async getUpdates(cursor='',signal){
    if(cursor!=='')fail('invalid_cursor');this._base(signal);if(this.polling)fail('operation_in_progress');if(this.pending)fail('ack_required');if(this.nextPollAt>this.now())throw new MessengerError('rate_limited',{retryAt:this.nextPollAt});
    const combined=this._signal(signal),context=this.contextToken,guard=()=>this._guard(context,combined);guard();this.polling=true;this.nextPollAt=this.now()+POLL;
    try{
      const batch=await this._relay('/v1/pull',{sessionId:this.sessionId,after:this.acceptAfter,limit:50},combined,guard);guard();
      if(batch.sessionId!==this.sessionId)fail('relay_changed');if(!Array.isArray(batch.items)||batch.items.length>50||!Number.isSafeInteger(batch.expiresAt)||batch.expiresAt<=this.now()||batch.expiresAt>this.now()+30000||
        (batch.items.length?!uuid(batch.deliveryId):batch.deliveryId!==null))fail('invalid_response');
      const ids=new Set(),messages=[];
      for(const row of batch.items){
        if(!plain(row)||!mid(row.id)||ids.has(row.id)||row.from!==this.ownerId||!Number.isSafeInteger(row.createdAt)||row.createdAt<this.acceptAfter||row.createdAt>this.now()+30000||row.createdAt+TTL<=this.now()||
          Object.keys(row).some(key=>!['id','from','text','createdAt','unsupported','quote'].includes(key)))fail('invalid_response');
        if(row.unsupported!==undefined?row.unsupported!=='messenger_nontext'||row.text!=='':!text(row.text))fail('invalid_response');
        if(row.quote!==undefined&&(!plain(row.quote)||Object.keys(row.quote).some(key=>!['id','title','text'].includes(key))||row.quote.id!==null||row.quote.text!==''||row.quote.title!=='Messenger referenced content (not fetched)'))fail('invalid_response');
        ids.add(row.id);messages.push({...row,contextToken:context});
      }
      if(messages.length){await this._me(combined,guard);guard();
        this.windowUntil=Math.max(this.windowUntil,...messages.map(row=>Math.min(row.createdAt,this.now())+WINDOW));
        this.pending={deliveryId:batch.deliveryId,ids:[...ids],context,expiresAt:batch.expiresAt,attempted:false};}
      return {cursor:'',deliveryId:batch.deliveryId,messages};
    }catch(error){throw this._problem(error);}finally{this.polling=false;}
  }
  async acknowledge(deliveryId,{durablyClaimed,signal}={}){
    const pending=this.pending,combined=this._signal(signal);if(!pending||pending.deliveryId!==deliveryId||pending.attempted||this.acking)fail('stale_batch');
    const guard=()=>{this._guard(pending.context,combined);if(this.pending!==pending||pending.expiresAt<=this.now())fail('stale_batch');};guard();
    if(typeof durablyClaimed!=='function'||!pending.ids.every(value=>durablyClaimed(value)===true))fail('durable_claim_required');
    this.acking=true;
    try{const value=await this._relay('/v1/ack',{sessionId:this.sessionId,deliveryId,ids:pending.ids},combined,()=>{guard();pending.attempted=true;},true);guard();
      if(value.acknowledged!==true||value.sessionId!==this.sessionId||value.deliveryId!==deliveryId)fail('ack_unknown');this.pending=null;return {acknowledged:true};
    }catch(error){if(pending.attempted)throw new MessengerError('ack_unknown');throw this._problem(error);}finally{this.acking=false;}
  }
  async sendText(to,body,contextToken,clientId=randomUUID(),signal){
    if(to!==this.ownerId)fail('owner_required');if(!text(body)||typeof clientId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(clientId))fail('invalid_input');
    if(this.sending)fail('operation_in_progress');if(this.attempted.has(clientId))fail('already_attempted');if(this.attempted.size>=1000)fail('send_limit');
    const combined=this._signal(signal),guard=()=>{this._guard(contextToken,combined);if(this.windowUntil<=this.now())fail('response_window_closed');};guard();this.sending=true;let submitted=false;
    try{await this._me(combined,guard);guard();const result=await requestJSON(this.fetch,`${GRAPH}/${this.pageId}/messages`,{method:'POST',token:this.pageToken,
      body:{recipient:{id:this.ownerId},messaging_type:'RESPONSE',message:{text:body}},signal:combined,timeoutMs:this.timeoutMs,write:true,
      assertCurrent:()=>{guard();this.attempted.add(clientId);submitted=true;}});
      if(result.recipient_id!==this.ownerId||!mid(result.message_id))fail('send_unknown');
      return {id:result.message_id,accountId:this.pageId,pageId:this.pageId,ownerId:this.ownerId,contextToken,clientId};
    }catch(error){if(submitted||error?.submitted)throw new MessengerError('send_unknown',{submitted:true});throw this._problem(error);}finally{this.sending=false;}
  }
  close(){if(this.closed)return;this.closed=true;this.ready=false;this.contextToken=null;this.pending=null;this.windowUntil=0;this.pageToken='';this.relayToken='';this.life.abort();}
}
module.exports={MessengerClient,MessengerError,prepareMessengerInbound,GRAPH,POLL};
