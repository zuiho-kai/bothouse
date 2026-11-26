'use strict';
// Original, request-only owner history projection. Media data and raw message
// fields never leave this boundary; this does not import SSQQ browser state.
const {validateQQOwner}=require('./qq.cjs');
const {capturePageImages}=require('./qq-history-image.cjs');
const LIMITS=Object.freeze({page:20,pages:10,segments:64,text:16000,pageText:65536});
const CODES=new Set(['invalid_request','invalid_response','response_too_large','unsupported_format','unavailable','changed','cancelled','closed','disconnected','account_changed','account_offline','status_unverified','owner_not_friend','stale_cursor',"cursor_session_mismatch","cursor_not_found","cursor_expired","history_sequence_missing","history_sequence_invalid","history_page_newer",'history_limit','history_unavailable','operation_in_progress','timeout','unconfigured','unauthorized','connect_failed','connect_timeout','login_required','heartbeat_timeout']);
class QQOwnerHistoryError extends Error{constructor(code){code=CODES.has(code)?code:'unavailable';super(`QQ owner history unavailable (${code}).`);this.code=code;}}
const fail=code=>{throw new QQOwnerHistoryError(code);};
const safeCode=e=>new QQOwnerHistoryError(({aborted:'cancelled',action_timeout:'timeout',request_limit:'operation_in_progress',action_failed:'history_unavailable'})[e?.code]||e?.code).code;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const exact=(v,keys)=>{if(!plain(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('invalid_request');};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const qq=v=>{try{return validateQQOwner(v);}catch{fail('invalid_response');}};
const msgId=v=>{const value=Number.isSafeInteger(v)?String(v):v;if(typeof value!=='string'||!/^(-[1-9]\d{0,9}|0|[1-9]\d{0,9})$/.test(value)||Number(value)<-2147483648||Number(value)>2147483647)fail('invalid_response');return value;};
const seq=v=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v)?v:null;
const clean=v=>v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Cf}]/gu,'');
const decode=v=>v.replace(/&#91;/g,'[').replace(/&#93;/g,']').replace(/&#44;/g,',').replace(/&amp;/g,'&');
const KINDS=new Set(['image','record','video','file','face','mface','reply','forward','json','xml','at','markdown','poke','dice','rps','contact','location','music']);
function segments(value){
 let rows=value;
 if(typeof value==='string'){
  if(value.length>LIMITS.pageText)fail('response_too_large');rows=[];let at=0;const pattern=/\[CQ:([a-z_]+)(?:,[^\]]*)?\]/g;let match;
  while((match=pattern.exec(value))){const preceding=value.slice(at,match.index);if(preceding.includes('[CQ:'))fail('unsupported_format');if(preceding)rows.push({type:'text',data:{text:decode(preceding)}});rows.push({type:match[1],data:{}});at=pattern.lastIndex;}
  const tail=value.slice(at);if(tail.includes('[CQ:'))fail('unsupported_format');if(tail)rows.push({type:'text',data:{text:decode(tail)}});
 }
 if(!Array.isArray(rows)||rows.length>LIMITS.segments)fail('unsupported_format');
 let textBytes=0;const parts=[];
 for(const row of rows){if(!plain(row)||typeof row.type!=='string'||!plain(row.data))fail('invalid_response');if(row.type==='text'){
   if(typeof row.data.text!=='string'||row.data.text.length>LIMITS.text)fail('response_too_large');const text=clean(row.data.text);textBytes+=text.length;if(textBytes>LIMITS.text)fail('response_too_large');parts.push({kind:'text',text});
  }else parts.push({kind:KINDS.has(row.type)?row.type:'other'});}
 return {parts,textBytes};
}
function projectPage(raw,{accountId,ownerId,anchor=null}){
 if(!plain(raw)||!Array.isArray(raw.messages))fail('invalid_response');if(raw.messages.length>LIMITS.page)fail('response_too_large');
 const seen=new Set();let textBytes=0;const rows=[];
 for(const r of raw.messages){
  if(!plain(r)||r.message_type!=='private'||r.sub_type!=='friend'||r.group_id!==undefined||qq(r.self_id)!==accountId||!plain(r.sender))fail('invalid_response');
  const sender=qq(r.sender.user_id);if(qq(r.user_id)!==sender||![ownerId,accountId].includes(sender))fail('invalid_response');
  const id=msgId(r.message_id);if(seen.has(id))fail('invalid_response');seen.add(id);
  if(!Number.isSafeInteger(r.time)||r.time<0)fail('invalid_response');const sequence=seq(r.real_seq);
  if(anchor&&!sequence)fail(r.real_seq===undefined||r.real_seq===null?'history_sequence_missing':'history_sequence_invalid');
  if(anchor&&BigInt(sequence)>BigInt(anchor.sequence))fail('history_page_newer');
  // Include-self APIs may repeat the anchor. Its content is deliberately not
  // projected again; matching the id is insufficient to invent an older row.
  if(anchor&&(id===anchor.messageId||BigInt(sequence)===BigInt(anchor.sequence)))continue;
  const parsed=segments(r.message);textBytes+=parsed.textBytes;if(textBytes>LIMITS.pageText)fail('response_too_large');
  // OneBot time is seconds. Pinned upstream may fall back to Date.now() when
  // native time is missing; do not guess that a large value is milliseconds.
  const time=r.time<=253402300799?r.time*1000:null;
  rows.push({messageId:id,sequence,direction:sender===accountId?'outgoing':'incoming',time,parts:parsed.parts});
 }
 // Pick one ordering for the whole observation. Mixed comparison by sequence
 // and time could otherwise be non-transitive when a row lacks a sequence.
 const allOrdered=rows.length>0&&rows.every(r=>r.sequence)&&new Set(rows.map(r=>r.sequence)).size===rows.length;
 if(allOrdered)rows.sort((a,b)=>BigInt(a.sequence)<BigInt(b.sequence)?-1:1);else if(rows.every(r=>r.time!==null))rows.sort((a,b)=>a.time-b.time);
 // The fixed action treats short id zero as a latest request, not a cursor.
 return {rows:rows.map(({sequence,...r})=>r),anchor:allOrdered&&rows[0].messageId!=='0'?{messageId:rows[0].messageId,sequence:rows[0].sequence}:null,source:'bridge-observed',completeHistory:false,mediaLoaded:false,rawCount:raw.messages.length};
}
function guard(binding,signal,assertCurrent){
 if(typeof assertCurrent!=='function'||typeof binding?.client?._request!=='function')fail('invalid_request');
 return()=>{if(signal?.aborted)fail('cancelled');const result=assertCurrent();if(result?.then){result.catch?.(()=>{});fail('invalid_request');}const c=binding.client;if(c.accountId!==binding.accountId||c.expectedAccountId!==binding.accountId||c.ownerId!==binding.ownerId)fail('account_changed');if(c.socket!==binding.socket||c.generation!==binding.clientGeneration||!c.ready||c.closed||c.socket?.readyState!==1)fail('disconnected');};
}
class QQOwnerHistoryTransport {
 async _identity(b,signal,check){check();const login=await b.client._request('get_login_info',{},signal);check();if(!plain(login)||qq(login.user_id)!==b.accountId)fail('account_changed');const status=await b.client._request('get_status',{},signal);check();if(!plain(status)||typeof status.online!=='boolean'||status.good!==undefined&&typeof status.good!=='boolean')fail('status_unverified');if(!status.online)fail('account_offline');if(status.good===false)fail('status_unverified');}
 async read(binding,{anchor=null,signal,assertCurrent}={}){
  const check=guard(binding,signal,assertCurrent);try{
   await this._identity(binding,signal,check);const friends=await binding.client._request('get_friend_list',{no_cache:false},signal);check();if(!Array.isArray(friends)||friends.length>10000)fail('invalid_response');const ids=new Set();for(const f of friends){if(!plain(f))fail('invalid_response');const id=qq(f.user_id);if(ids.has(id))fail('invalid_response');ids.add(id);}if(!ids.has(binding.ownerId))fail('owner_not_friend');
   const params={user_id:binding.ownerId,count:LIMITS.page,reverse_order:!!anchor,reverseOrder:!!anchor,disable_get_url:true,parse_mult_msg:false,quick_reply:false,...(anchor?{message_seq:msgId(anchor.messageId)}:{})};
   check();const raw=await binding.client._request('get_friend_msg_history',params,signal);check();const page=projectPage(raw,{accountId:binding.accountId,ownerId:binding.ownerId,anchor});await this._identity(binding,signal,check);check();return {...page,imageDescriptors:capturePageImages(raw,page,{accountId:binding.accountId,ownerId:binding.ownerId})};
  }catch(error){throw new QQOwnerHistoryError(safeCode(error));}
 }
}
module.exports={QQOwnerHistoryTransport,QQOwnerHistoryError,LIMITS,projectPage,segments,safeCode,plain,exact,uuid,fail};
