'use strict';
// Original bounded local metadata. No message body, path, media or vision data.
const {createHash}=require('node:crypto');
const RETENTION=7*86400000,MAX_RECORDS=40,MAX_CONTEXT=6,MAX_BUDGET=800;
const mediaKinds=new Set(['text','image','voice']),states={accepted:'sent',unknown:'unknown',not_submitted:'failed'},outcomes={sent:'accepted',unknown:'unknown',failed:'not_submitted'};
const invalid=()=>Object.assign(Error('Invalid manual QQ receipt.'),{code:'social_invalid_input'});
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const messageId=value=>typeof value==='string'&&/^-?\d{1,20}$/.test(value)?value:null;
function scope(context){
  if(!plain(context)||Object.keys(context).sort().join()!=='accountId,characterId,ownerId'||typeof context.accountId!=='string'||typeof context.ownerId!=='string'||!/^[1-9]\d{4,14}$/.test(context.accountId)||!/^[1-9]\d{4,14}$/.test(context.ownerId)||context.accountId===context.ownerId||typeof context.characterId!=='string'||!context.characterId||context.characterId.length>128||/[\p{Cc}\p{Cf}]/u.test(context.characterId))throw invalid();
  return createHash('sha256').update(JSON.stringify(['qq',context.accountId,context.ownerId,context.characterId])).digest('hex');
}
function record(value,now){
  if(!plain(value)||Object.keys(value).some(key=>!['id','media','outcome','messageId'].includes(key))||typeof value.id!=='string'||!/^[a-f0-9-]{36}$/.test(value.id)||!mediaKinds.has(value.media)||!Object.hasOwn(states,value.outcome)||!Number.isSafeInteger(now)||now<0)throw invalid();
  if(value.outcome==='accepted'&&!messageId(value.messageId)||value.outcome!=='accepted'&&value.messageId!==undefined&&value.messageId!==null)throw invalid();
  return {id:`manual:${value.id}`,kind:'manual',state:states[value.outcome],text:JSON.stringify({v:1,origin:'manual_app',media:value.media}),receipt:value.outcome==='accepted'?value.messageId:'',at:now,updatedAt:now};
}
function decode(row,now){
  if(!row||row.kind!=='manual'||!Object.hasOwn(outcomes,row.state)||!Number.isSafeInteger(row.at)||row.at>now||row.at<now-RETENTION||!row.text)return null;
  let meta;try{meta=JSON.parse(row.text);}catch{return null;}
  if(!plain(meta)||Object.keys(meta).sort().join()!=='media,origin,v'||meta.v!==1||meta.origin!=='manual_app'||!mediaKinds.has(meta.media)||row.state==='sent'&&!messageId(row.receipt)||row.state!=='sent'&&row.receipt!=='')return null;
  return {media:meta.media,outcome:outcomes[row.state],at:row.at,messageId:row.receipt||null};
}
function project(rows,{quoteIds=[],now=Date.now(),budget=MAX_BUDGET}={}){
  const ids=new Set(Array.isArray(quoteIds)?quoteIds.filter(messageId).slice(-6):[]),decoded=rows.map(row=>decode(row,now)).filter(Boolean);
  // Reference IDs are lookup hints within this exact scope, never authority.
  decoded.sort((a,b)=>Number(ids.has(b.messageId))-Number(ids.has(a.messageId))||b.at-a.at);
  const result=[];for(const row of decoded){if(result.length>=MAX_CONTEXT)break;const item={origin:'manual_app',media:row.media,outcome:row.outcome,at:row.at,contentObserved:false,recipientObserved:false,...(ids.has(row.messageId)?{matchesCurrentQuote:true}:{})};result.push(item);if(JSON.stringify(result).length>Math.min(MAX_BUDGET,Math.max(2,budget))){result.pop();break;}}
  return result;
}
const methods={
  captureManualQQ(scopeId){
    const key=this.scope(scopeId),epoch=this.manualQQEpochs?.get(key)||0;
    return value=>{if((this.manualQQEpochs?.get(key)||0)!==epoch)return {recorded:false,forgotten:true};return this.recordManualQQ(scopeId,value);};
  },
  recordManualQQ(scopeId,value){
    const key=this.scope(scopeId),entry=record(value,this.now());
    return this.withDb(db=>{
      this.ensureScope(db,key);
      db.prepare("DELETE FROM actions WHERE scope=? AND kind='manual' AND at<?").run(key,this.now()-RETENTION);
      const previous=db.prepare('SELECT kind,state,text,receipt FROM actions WHERE scope=? AND id=?').get(key,entry.id);
      if(previous){if(previous.kind!==entry.kind||previous.state!==entry.state||previous.text!==entry.text||previous.receipt!==entry.receipt)throw invalid();return {recorded:true,duplicate:true};}
      db.prepare('INSERT INTO actions(scope,id,kind,state,text,at,updated_at,receipt) VALUES(?,?,?,?,?,?,?,?)').run(key,entry.id,entry.kind,entry.state,entry.text,entry.at,entry.updatedAt,entry.receipt);
      db.prepare("DELETE FROM actions WHERE scope=? AND kind='manual' AND rowid NOT IN (SELECT rowid FROM actions WHERE scope=? AND kind='manual' ORDER BY at DESC,rowid DESC LIMIT ?)").run(key,key,MAX_RECORDS);
      return {recorded:true,duplicate:false};
    });
  },
  manualQQActions(scopeId){const key=this.scope(scopeId);return this.withDb(db=>{db.prepare("DELETE FROM actions WHERE scope=? AND kind='manual' AND at<?").run(key,this.now()-RETENTION);return db.prepare("SELECT kind,state,text,at,receipt FROM actions WHERE scope=? AND kind='manual' ORDER BY at DESC,rowid DESC LIMIT ?").all(key,MAX_RECORDS).map(row=>({...row}));});}
};
module.exports={scope,record,decode,project,methods,RETENTION,MAX_RECORDS,MAX_BUDGET};
