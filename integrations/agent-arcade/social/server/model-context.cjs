'use strict';

const {privateReactionRequest}=require('./public-reactions.cjs');
const {markPrivateWebLookup}=require('./web-search-privacy.cjs');
const attachmentAddress=/\/api\/v1\/conversations\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\/messages\/[1-9]\d*\/(?:image(?:\/download)?|voice)\b/iu;

const normalized=value=>value.normalize('NFKC').toLowerCase();
const compact=value=>normalized(value).replace(/[^\p{L}\p{N}]/gu,'');
const credentials=/\b[a-z0-9_-]*\d{5,}[a-z0-9_-]*\b|\b(?:https?:\/\/|file:\/\/)[^\s，。；、\]」』”]+|[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}/giu;
const quotation=/「([^」]+)」|『([^』]+)』|“([^”]+)”|‘([^’]+)’|"([^"\n]+)"|〔([^〕]+)〕|【([^】]+)】/gu;
const credentialLabel=/(?:密语|暗号|密码|口令|验证码|凭据|密钥|令牌|门禁(?:口令)?|\b(?:pin|otp|secret|password|token|api[ _-]?key)\b)/iu;
const labeled=new RegExp(credentialLabel.source+
  String.raw`\s*(?:[：:=是为]\s*)?([a-z\d][a-z\d_.-]{3,95}|[\p{Script=Han}]{4,40}?(?=写[在上]|印[在上]|放[到进]|[\s，。；、！!？?]|$))`,'giu');

function protectedPhrases(body){
  const text=normalized(body);
  const values=[text,...(text.match(credentials)??[]),...(text.match(/\d{5,}/gu)??[])];
  for(const quote of text.matchAll(quotation)){
    const value=quote.slice(1).find(Boolean);
    if(credentialLabel.test(value)||credentialLabel.test(text.slice(Math.max(0,quote.index-24),quote.index)))values.push(value);
  }
  for(const match of text.matchAll(labeled))values.push(match[1]);
  return values.map(compact).filter(value=>[...value].length>=4);
}

function indexPrivateReactions(store,chat){
  const start=store.one('SELECT last_message FROM local_reaction_scan WHERE chat=?',chat)?.last_message??0;
  const rows=store.db.prepare('SELECT id,body FROM messages WHERE chat=? AND id>? ORDER BY id').iterate(chat,start);
  const mark=store.db.prepare('INSERT OR IGNORE INTO local_reaction_messages(message) VALUES(?)');
  let last=start;
  // Backfill old snapshots lazily. Publishing the watermark only after the
  // scan leaves an interrupted scan safe to retry, even across processes.
  for(const row of rows){
    if(privateReactionRequest(row.body))mark.run(row.id);
    last=row.id;
  }
  if(last!==start)store.run(`INSERT INTO local_reaction_scan VALUES(?,?) ON CONFLICT(chat)
    DO UPDATE SET last_message=max(local_reaction_scan.last_message,excluded.last_message)`,chat,last);
}

function modelContext(store,chat){
  indexPrivateReactions(store,chat);
  const protectedRows=store.all(`SELECT m.id,m.body FROM local_reaction_messages privacy
    JOIN messages m ON m.id=privacy.message WHERE m.chat=?`,chat);
  const privateIds=new Set(protectedRows.map(row=>row.id));
  const appointmentMessage=store.db.prepare('SELECT 1 FROM ai_appointment_messages WHERE message=?');
  const privateWebMessage=store.db.prepare('SELECT 1 FROM local_web_search_messages WHERE message=?');
  function webPrivate({id,text,sender}){
    // An old message may have been stored when no provider was configured.
    // Check it locally at the read boundary even if it has no privacy marker.
    return id&&(privateWebMessage.get(id)||sender?.kind!=='ai'&&markPrivateWebLookup(store,chat,id,text));
  }
  const phrases=[...new Set(protectedRows.flatMap(row=>protectedPhrases(row.body)))];
  const numbers=new Set(phrases.filter(value=>/^\d+$/u.test(value)));
  const literalPhrases=phrases.filter(value=>!numbers.has(value));
  function allows(row){
    const {id,text,removed}=row;
    if(removed||privateIds.has(id)||id&&appointmentMessage.get(id)||attachmentAddress.test(text)||webPrivate(row))return false;
    if(!phrases.length)return true;
    const collapsed=compact(text);
    if(literalPhrases.some(phrase=>collapsed.includes(phrase)))return false;
    return !(normalized(text).match(/\d+(?:[._-]\d+)*/gu)??[]).some(value=>numbers.has(compact(value)));
  }
  function allowsHistory(row){
    if(row.webResults||row.imageQuestion||row.sender.kind==='ai'&&/^ai-image-\d+$/u.test(row.clientId)||!allows(row))return false;
    const cause=row.sender.kind==='ai'&&/^ai-reply-(\d+)$/u.exec(row.clientId)?.[1];
    if(!cause)return true;
    const prompt=store.one('SELECT id,body AS text,removed FROM messages WHERE chat=? AND id=?',chat,Number(cause));
    // Generated replies inherit a local-only prompt's visibility, even if the
    // words in an old generated response do not match an extracted literal.
    return !prompt||(phrases.length?allows(prompt):!webPrivate(prompt));
  }
  return {allows,allowsHistory};
}

function modelHistoryAfter(store,account,chat,after){
  let page=store.history(account,chat,new URLSearchParams({after:String(after)}));
  const privacy=modelContext(store,chat);
  const allowed=[];
  while(page.length){
    allowed.push(...page.filter(row=>row.removed||privacy.allowsHistory(row)));
    if(allowed.length>=50||page.length<50)break;
    page=store.history(account,chat,new URLSearchParams({after:String(page.at(-1).id)}));
  }
  return allowed.slice(0,50);
}

module.exports={attachmentAddress,modelContext,modelHistoryAfter};
