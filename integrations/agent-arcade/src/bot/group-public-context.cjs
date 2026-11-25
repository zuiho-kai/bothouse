'use strict';
// A bounded projection of this group's public conversation, never a union of
// member fact stores. Receipts authorize recording an AI turn, not its content.
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {atomicJSON}=require('../core/files.cjs');
const MAX_ROWS=32,MAX_BYTES=49152,MAX_AGE=7*86400000;
const problem=()=>Object.assign(Error('Group public context unavailable.'),{code:'group_storage_unavailable'});
const MAX_NATIVE_MENTION_SLOTS=12;
const ROW_ID=/^[a-f0-9]{64}$/;
const isGroupMemberAlias=value=>typeof value==='string'&&/^[a-f0-9]{16}$/.test(value);
const groupMemberAlias=(platform,accountId,groupId,memberId)=>
 createHash('sha256').update(JSON.stringify([platform,accountId,groupId,memberId])).digest('hex').slice(0,16);
function valid(row){
 return row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).every(k=>['id','kind','speaker','replyTo','text','at','postedAt','worldInfoRevision','groupWikiRevision','groupReflectionRevision'].includes(k))&&
  ROW_ID.test(row.id)&&['member','character'].includes(row.kind)&&typeof row.speaker==='string'&&
  (row.kind==='member'?isGroupMemberAlias(row.speaker):/^[a-z0-9-]{1,50}$/.test(row.speaker))&&
  (row.worldInfoRevision===undefined||row.kind==='character'&&typeof row.worldInfoRevision==='string'&&/^[a-f0-9]{64}$/.test(row.worldInfoRevision))&&
  (row.groupWikiRevision===undefined||row.kind==='character'&&typeof row.groupWikiRevision==='string'&&ROW_ID.test(row.groupWikiRevision))&&
  (row.groupReflectionRevision===undefined||row.kind==='character'&&typeof row.groupReflectionRevision==='string'&&ROW_ID.test(row.groupReflectionRevision))&&
  (row.postedAt===undefined||row.kind==='member'&&Number.isSafeInteger(row.postedAt)&&row.postedAt>0&&row.postedAt%1000===0&&row.postedAt<=row.at+60000)&&
  (row.replyTo===null||isGroupMemberAlias(row.replyTo))&&typeof row.text==='string'&&row.text.trim()&&row.text.length<=2000&&
  !/[\x00-\x08\x0b-\x1f\x7f]/.test(row.text)&&Number.isSafeInteger(row.at)&&row.at>=0;
}
class GroupPublicContext{
 #pendingRecall=new Set();
 #idleTopicIds=new Set();

 constructor({file,scope,now=Date.now}){
  this.file=file;this.scope=scope;this.now=now;this.rows=[];
  try{
   const st=fs.lstatSync(file);
   if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)throw problem();
   const saved=JSON.parse(fs.readFileSync(file,'utf8'));
   if(!saved||Object.keys(saved).some(k=>!['schema','scope','rows'].includes(k))||saved.schema!==1||saved.scope!==scope||!Array.isArray(saved.rows)||saved.rows.length>MAX_ROWS||!saved.rows.every(valid)||new Set(saved.rows.map(r=>r.id)).size!==saved.rows.length)throw problem();
   this.rows=saved.rows;
  }catch(error){if(error.code!=='ENOENT')throw problem();}
 }
 view(){
  const cutoff=this.now()-MAX_AGE;
  return this.rows.filter(row=>row.at>=cutoff&&!this.#pendingRecall.has(row.id)).map(row=>structuredClone(row));
 }
 idleTopics(){
  // Only seed idle outreach from human turns whose native audience this
  // connection observed. Legacy text cannot identify its original addressee.
  return this.view().filter(row=>this.#idleTopicIds.has(row.id));
 }
 hasMemberRow(rowId,speaker){
  return typeof rowId==='string'&&ROW_ID.test(rowId)&&isGroupMemberAlias(speaker)&&
   this.rows.some(row=>row.id===rowId&&row.kind==='member'&&row.speaker===speaker);
 }
 recallMember(rowId,speaker){
  if(!this.hasMemberRow(rowId,speaker))return false;
  return this.#recall(rowId);
 }
 characterReceipt(matches){
  const cutoff=this.now()-MAX_AGE;
  const candidates=this.rows.filter(row=>row.kind==='character'&&row.at>=cutoff&&matches(row));
  return candidates.length===1?candidates[0].id:null;
 }
 recallCharacter(rowId){
  if(typeof rowId!=='string'||!ROW_ID.test(rowId)||!this.rows.some(row=>row.kind==='character'&&row.id===rowId))return false;
  return this.#recall(rowId);
 }
 #recall(rowId){
  // Keep the exact identity for retry, while hiding the recalled text even
  // if the file could not be replaced. A later successful write seals it.
  this.#pendingRecall.add(rowId);
  this.#write(this.rows.filter(row=>!this.#pendingRecall.has(row.id)));
  return true;
 }
 #write(rows){
  try{atomicJSON(this.file,{schema:1,scope:this.scope,rows});}catch{throw problem();}
  this.rows=rows;
  this.#idleTopicIds=new Set(rows.filter(row=>this.#idleTopicIds.has(row.id)).map(row=>row.id));
  this.#pendingRecall.clear();
 }
 save(rows){
  const cutoff=this.now()-MAX_AGE;
  const next=rows.filter(row=>row.at>=cutoff&&!this.#pendingRecall.has(row.id)).slice(-MAX_ROWS);
  while(Buffer.byteLength(JSON.stringify({schema:1,scope:this.scope,rows:next},null,2))>MAX_BYTES)next.shift();
  this.#write(next);
 }
 append(row,{idleTopic=false}={}){
  if(!valid(row))throw problem();
  if(this.rows.some(r=>r.id===row.id))return;
  this.save([...this.rows,structuredClone(row)]);
  if(idleTopic)this.#idleTopicIds.add(row.id);
 }
 // A paraphrase can occur in any later human/AI turn. Reset this bounded
 // shared projection instead of claiming semantic removal by string matching.
 // Member fact stores and audit histories are separate and remain untouched.
 reset(){this.save([]);}
}
module.exports={GroupPublicContext,groupMemberAlias,isGroupMemberAlias,MAX_NATIVE_MENTION_SLOTS,MAX_ROWS,MAX_BYTES,MAX_AGE};
