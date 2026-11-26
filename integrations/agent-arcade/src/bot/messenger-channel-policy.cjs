'use strict';
const {createHash}=require('node:crypto');
const FATAL=new Set(['page_changed','relay_changed','invalid_response','requires_reauthorization','permission_denied','redirect_rejected','body_too_large','ack_required','ack_unknown','stale_batch','durable_claim_required','send_unknown','send_limit','closed','changed','invalid_config','invalid_input','owner_required']);
function validateId(value){if(typeof value!=='string'||!/^[1-9]\d{0,19}$/.test(value))throw Error('Use a Messenger App, Page or owner ID of 1–20 decimal digits without leading zeroes.');return value;}
function validateToken(value,{relay=false}={}){if(typeof value!=='string'||!new RegExp(`^[\\x21-\\x7e]{${relay?32:8},4096}$`).test(value))throw Error(`Enter a Messenger ${relay?'relay':'Page'} token of ${relay?32:8}–4096 printable ASCII characters without spaces.`);return value;}
function validateOrigin(value){let url;try{if(typeof value!=='string'||value.length>2048)throw Error();url=new URL(value);}catch{throw Error('Use the HTTPS origin of your configured Messenger relay.');}if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Use an HTTPS relay origin without a path, credentials, query or fragment.');return url.origin;}
function messageKey(value){if(typeof value!=='string'||!/^[\x21-\x7e]{1,512}$/.test(value))throw Object.assign(Error('Messenger message identity is invalid.'),{code:'invalid_response'});return `messenger-mid:${createHash('sha256').update(value).digest('hex')}`;}
function namespace(appId,pageId,ownerId){return `messenger:${createHash('sha256').update(JSON.stringify([validateId(appId),validateId(pageId),validateId(ownerId)])).digest('hex')}`;}
function codeOf(error){return FATAL.has(error?.code)||['rate_limited','timeout','connection_failed','response_window_closed','aborted','operation_in_progress','already_attempted'].includes(error?.code)?error.code:'connection_failed';}
function retryAt(error,now=Date.now()){return Number.isSafeInteger(error?.retryAt)&&error.retryAt>now&&error.retryAt<=now+86400000?error.retryAt:now+5000;}
function problem(code){
  if(code==='rate_limited')return 'Messenger 接收检查正在等待允许时间，可随时断开；不会重发上一条消息。';
  if(code==='requires_reauthorization')return 'Messenger Page 或中继授权已失效，已停止接收。请核对并更新对应令牌后手动连接。';
  if(code==='permission_denied')return 'Messenger API 未允许此操作，已停止接收。请核对 Page 权限、应用审核与中继设置。';
  if(code==='page_changed'||code==='relay_changed')return 'Messenger Page 或中继身份与配置不一致，已停止接收。请核对 App、Page 和指定主人后手动连接。';
  if(code==='ack_unknown')return 'Messenger 中继交付确认结果不明，本批消息未执行；记录已保留，不会自动重放。请检查中继后手动连接。';
  if(code==='send_unknown')return 'Messenger 发送结果未确认，已停止接收且不会自动重发。请先在 Messenger 查看结果。';
  if(code==='response_window_closed')return 'Messenger 的普通回复时间窗口已结束，本条未提交；请主人先向 Page 发送一条新消息。';
  if(FATAL.has(code))return 'Messenger 消息身份或响应无法核实，已停止接收。请检查 Page 和中继配置，再手动连接。';
  return 'Messenger 连接未能完成，已停止接收。请检查网络、Page 和中继后手动连接；旧消息不会自动重发。';
}
module.exports={validateId,validateToken,validateOrigin,messageKey,namespace,codeOf,retryAt,problem,FATAL};
