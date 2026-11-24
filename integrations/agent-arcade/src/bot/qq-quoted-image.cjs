'use strict';
// A fresh owner's explicit reply is authority to read that exact message, not
// a directory/history search or permission to execute the quoted content.
const {createHash}=require('node:crypto');
const {capture:captureHistoryImage}=require('./qq-history-image.cjs');
const {imageSource}=require('./qq-image-source.cjs');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=code=>{throw Object.assign(Error('Quoted message was not verified.'),{code});};
const qq=v=>typeof v==='string'&&/^[1-9]\d{4,11}$/.test(v);
const id=v=>{if(Number.isSafeInteger(v))v=String(v);if(typeof v!=='string'||!/^(-[1-9]\d{0,9}|[1-9]\d{0,9})$/.test(v)||Number(v)<-2147483648||Number(v)>2147483647)fail('invalid_response');return v;};
const text=v=>typeof v==='string'&&v.isWellFormed()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function parts(message){
 if(!Array.isArray(message)||message.length<1||message.length>40)fail('unsupported');
 let replyId,replyIndex=-1,caption='';const segments=[];
 for(const [index,part] of message.entries()){
  if(!object(part)||!object(part.data))fail('unsupported');
  if(part.type==='reply'&&replyIndex<0){replyId=id(part.data.id);replyIndex=index;segments.push(['reply',replyId]);}
  else if(part.type==='text'&&text(part.data.text)){caption+=part.data.text;segments.push(['text',part.data.text]);if(caption.length>2000)fail('unsupported');}
  else fail('unsupported');
 }
 if(replyIndex<0||!caption.trim())fail('unsupported');
 return {replyId,caption,segmentsDigest:digest(segments)};
}
function captureOwnerQuote(frame,{accountId,ownerId,companion,acceptAfter=0,now=Date.now()}={}){
 if(companion!==true||!qq(accountId)||!qq(ownerId)||accountId===ownerId||!object(frame)||frame.post_type!=='message'||frame.message_type!=='private'||frame.sub_type!=='friend'||frame.group_id!==undefined||String(frame.self_id)!==accountId||String(frame.user_id)!==ownerId||frame.sender?.user_id!==undefined&&String(frame.sender.user_id)!==ownerId)fail('wrong_scope');
 const createdAt=frame.time*1000;if(!Number.isSafeInteger(frame.time)||!Number.isSafeInteger(createdAt)||createdAt<0||!Number.isSafeInteger(now)||!Number.isSafeInteger(acceptAfter)||createdAt<acceptAfter||createdAt>now+60000)fail('invalid_response');
 const result={kind:'qq-owner-quote',accountId,ownerId,id:id(frame.message_id),createdAt,...parts(frame.message)};
 if(result.replyId===result.id)fail('unsupported');return Object.freeze(result);
}
function validateQuote(v){
 const keys=['kind','accountId','ownerId','id','createdAt','replyId','caption','segmentsDigest'];
 if(!object(v)||Object.keys(v).sort().join('|')!==keys.sort().join('|')||v.kind!=='qq-owner-quote'||!qq(v.accountId)||!qq(v.ownerId)||v.accountId===v.ownerId||id(v.id)!==v.id||id(v.replyId)!==v.replyId||v.id===v.replyId||!Number.isSafeInteger(v.createdAt)||v.createdAt<0||v.createdAt%1000||!text(v.caption)||!v.caption.trim()||v.caption.length>2000||typeof v.segmentsDigest!=='string'||!/^[a-f0-9]{64}$/.test(v.segmentsDigest))fail('invalid_config');return Object.freeze({...v});
}
function verifyQuote(row,d){
 if(!object(row)||id(row.message_id)!==d.id||row.message_type!=='private'||row.group_id!==undefined||row.sub_type!==undefined&&row.sub_type!=='friend'||String(row.user_id)!==d.ownerId||String(row.sender?.user_id)!==d.ownerId||row.self_id!==undefined&&String(row.self_id)!==d.accountId||!Number.isSafeInteger(row.time)||row.time*1000!==d.createdAt)fail('message_changed');
 const p=parts(row.message);if(['replyId','caption','segmentsDigest'].some(k=>p[k]!==d[k]))fail('message_changed');
}
function target(raw,d){
 if(!object(raw)||!Array.isArray(raw.messages)||raw.messages.length>20)fail('invalid_response');
 const matches=raw.messages.filter(row=>object(row)&&String(row.message_id)===d.replyId);if(matches.length!==1)fail('message_changed');
 const row=matches[0],sender=String(row.sender?.user_id);
 if(row.message_type!=='private'||row.sub_type!=='friend'||row.group_id!==undefined||String(row.self_id)!==d.accountId||![d.accountId,d.ownerId].includes(sender)||String(row.user_id)!==sender||typeof row.real_seq!=='string'||!/^[1-9]\d{0,19}$/.test(row.real_seq)||!Number.isSafeInteger(row.time)||row.time<0||row.time*1000>d.createdAt||!Array.isArray(row.message)||!row.message.length||row.message.length>64)fail('message_changed');
 // The old caption is compared but never enters the model, memory or task.
 if(row.message.every(p=>object(p)&&p.type==='text'&&object(p.data)&&text(p.data.text))){
  if(row.message.reduce((n,p)=>n+p.data.text.length,0)>16000)fail('unsupported');
  return {kind:'text-reference',fingerprint:digest([d.replyId,row.real_seq,row.time,sender,row.message.map(p=>p.data.text)])};
 }
 let image;try{image=captureHistoryImage(row,{accountId:d.accountId,ownerId:d.ownerId});}catch{fail('unsupported');}
 // Reject invalid UTF-16 in old text even though it is never submitted.
 if(row.message.some(p=>p.type==='text'&&!text(p.data.text)))fail('unsupported');
 const source=imageSource(row.message[image.imageIndex].data.url);
 return {kind:'image',fingerprint:digest(image),source};
}
function historyParams(d){return {user_id:d.ownerId,count:20,message_seq:d.replyId,reverse_order:true,reverseOrder:true,disable_get_url:false,parse_mult_msg:false,quick_reply:false};}
function verifyFriends(rows,d){if(!Array.isArray(rows)||rows.length>10000)fail('invalid_response');const seen=new Set();for(const row of rows){const value=String(row?.user_id);if(!object(row)||!qq(value)||seen.has(value))fail('invalid_response');seen.add(value);}if(!seen.has(d.ownerId))fail('wrong_scope');}
module.exports={captureOwnerQuote,validateQuote,verifyQuote,target,historyParams,verifyFriends};
