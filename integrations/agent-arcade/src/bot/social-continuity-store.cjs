'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {TIME_PATTERN,dueFromLocalTime}=require('./followup-time.cjs');
const {parseGroupRelativeFollowup}=require('./group-relative-followup.cjs');
const {preferredNameValue,preferredNameFromFact,groupPreferredNameFact,PREFERRED_NAME_KEY}=require('./group-natural-memory.cjs');
const {clean}=require('./dispatcher.cjs');

const invalid=message=>Object.assign(Error(message),{code:'social_invalid_input'});
const STALE_FOLLOWUP_EDIT=Symbol('stale follow-up edit');
const bounded=(value,max,label,empty=false)=>{
  if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||/[\x00-\x08\x0b-\x1f\x7f]/.test(value))throw invalid(`Invalid ${label}.`);
  return value;
};
const timestamp=(value,label)=>{if(!Number.isSafeInteger(value)||value<0)throw invalid(`Invalid ${label}.`);return value;};
const identifiers=(value,label)=>{
  if(!Array.isArray(value)||value.length>8||new Set(value).size!==value.length)throw invalid(`Invalid ${label}.`);
  return value.map(id=>bounded(id,180,label));
};
const timeZone=value=>{
  bounded(value,80,'time zone');
  try{return new Intl.DateTimeFormat('en',{timeZone:value}).resolvedOptions().timeZone;}catch{throw invalid('Choose a valid IANA time zone.');}
};
function validateLocalTime(localTime,dueAt){
  if(localTime===undefined)return null;
  if(dueFromLocalTime(localTime)!==dueAt)throw invalid('The local follow-up time must match its due instant.');
  return localTime;
}
const limit=(value,max)=>{if(!Number.isInteger(value)||value<1||value>max)throw invalid('Invalid record limit.');return value;};
const factRow=row=>row?{id:row.id,key:row.fact_key,text:row.text,sourceIds:JSON.parse(row.source_ids),sourceAt:row.source_at,createdAt:row.created_at,updatedAt:row.updated_at,revision:row.revision}:null;
function followupRow(row){
  if(!row)return null;
  const localTime=row.text&&dueFromLocalTime(row.local_time)===row.due_at?row.local_time:null;
  return {id:row.id,text:row.text,dueAt:row.due_at,expiresAt:row.expires_at,timeZone:row.time_zone,
    ...(localTime?{localTime}:{}),...(row.last_edit_posted_at!=null?{lastEditPostedAt:row.last_edit_posted_at}:{}),
    state:row.state,sourceIds:JSON.parse(row.source_ids),factIds:JSON.parse(row.fact_ids),
    createdAt:row.created_at,updatedAt:row.updated_at,receipt:row.receipt,revision:row.revision};
}
const publicRow=row=>row?{id:row.id,text:row.text,at:row.at,updatedAt:row.updated_at,state:row.state,postId:row.post_id,receipt:row.post_id}:null;
const noticeRow=row=>row?{id:row.id,source:row.source,kind:row.kind,importance:row.importance,payload:row.payload,at:row.at,expiresAt:row.expires_at,state:row.state,batch:row.batch,createdAt:row.created_at,updatedAt:row.updated_at}:null;
const MAX_FACTS_PER_SCOPE=100, MAX_FOLLOWUPS_PER_SCOPE=100, MAX_PENDING_FOLLOWUPS_PER_SCOPE=30;
const NOTICE_PENDING=30,NOTICE_ROWS=300,NOTICE_RETENTION=7*86400000;
const NOTICE_RESULTS={
  app:new Set(['not_attempted','unknown','shown','failed']),
  qq:new Set(['not_attempted','unknown','bridge_accepted','failed'])
};
const NATIVE_GROUP_SOURCE=/^in:group:[1-9]\d{4,14}:-?\d{1,20}$/u;
const ABSOLUTE_GROUP_CREATION=new RegExp('^回访\\s+('+TIME_PATTERN+')\\s*\\|\\s*([\\s\\S]+)$','u');
const MEMORY_REFERENCE=/(?:这件事|那件事|这个事|那个事|(?:这|那|上一|前一)(?:条|段|则)(?:记忆|记录|消息|偏好|约定)|(?:刚才|刚刚|上次|之前|前面)(?:说|提|记|聊)(?:的|过|到)|(?:按|照|根据)(?:你|我)?(?:的)?(?:记忆|记得|偏好)|记忆(?:里|中)|(?:^|[，。！？!?,.\s])(?:这条|那条|这个|那个)[。！？!?.\s]*$|\b(?:that (?:thing|note|memory|conversation)|(?:as|what) (?:you|i) (?:remember|mentioned|said))\b)/iu;
const NO_MEMBER_PROOF='unverified';

function initializeContinuity(db,now,{branches=false,groupFollowupGraceMs=0,ordinaryGroupFollowups=false}={}){
  // All additions share SocialStore's transaction. No shadow copy of private
  // memory is retained that could outlive a later correction or erasure.
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version>6)throw invalid('This character memory was created by a newer app.');
  // Version 5 adds the conversation-branch tables, created by SocialStore only for a store
  // opened with branches:true (the App conversation). Any other store keeps the number it
  // found, so the QQ companion database stays at 4 and readable by an earlier build.
  // Version 6 adds the speaker columns of group conversations to messages, again only for the
  // App conversation's store (see SocialStore's constructor).
  const target=branches?6:Math.max(4,version);
  db.exec(`CREATE TABLE IF NOT EXISTS facts (
    scope TEXT NOT NULL,id TEXT NOT NULL,fact_key TEXT NOT NULL,text TEXT NOT NULL,
    source_ids TEXT NOT NULL,source_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,revision INTEGER NOT NULL,
    PRIMARY KEY(scope,id),UNIQUE(scope,fact_key));
    CREATE TABLE IF NOT EXISTS followups (
    scope TEXT NOT NULL,id TEXT NOT NULL,text TEXT NOT NULL,due_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,time_zone TEXT NOT NULL,
    state TEXT NOT NULL,source_ids TEXT NOT NULL,fact_ids TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,receipt TEXT NOT NULL,revision INTEGER NOT NULL,
    local_time TEXT,PRIMARY KEY(scope,id));
    CREATE INDEX IF NOT EXISTS followup_due ON followups(scope,state,due_at);
    CREATE TABLE IF NOT EXISTS public_journal (
    scope TEXT NOT NULL,id TEXT NOT NULL,text TEXT NOT NULL,at INTEGER NOT NULL,updated_at INTEGER NOT NULL,state TEXT NOT NULL,post_id TEXT NOT NULL,
    PRIMARY KEY(scope,id));
    CREATE INDEX IF NOT EXISTS public_journal_order ON public_journal(scope,at);
    CREATE TABLE IF NOT EXISTS source_notices (
    id TEXT PRIMARY KEY,source TEXT NOT NULL,kind TEXT NOT NULL,importance TEXT NOT NULL,payload TEXT NOT NULL,at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
    state TEXT NOT NULL,batch TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS source_notice_state ON source_notices(state,created_at);
    CREATE TABLE IF NOT EXISTS source_notice_delivery (
    batch TEXT PRIMARY KEY,at INTEGER NOT NULL,app TEXT NOT NULL,qq TEXT NOT NULL);
    PRAGMA user_version=${target};`);
  // Older builds name their write columns and continue to read these rows.
  // Ignore stale annotations on read if an older build changes the due instant.
  const followupColumns=new Set(db.prepare('PRAGMA table_info(followups)').all().map(column=>column.name));
  if(!followupColumns.has('local_time')){
    db.exec('ALTER TABLE followups ADD COLUMN local_time TEXT');
  }
  // Ordinary QQ group stores opt in through their existing offline grace. Do not
  // change App/private databases or the schema version an earlier build can read.
  if(groupFollowupGraceMs>0&&!followupColumns.has('last_edit_posted_at')){
    db.exec('ALTER TABLE followups ADD COLUMN last_edit_posted_at INTEGER');
  }
  if(ordinaryGroupFollowups&&!followupColumns.has('member_direct')){
    db.exec('ALTER TABLE followups ADD COLUMN member_direct TEXT');
  }
  if(ordinaryGroupFollowups){
    db.exec('CREATE TABLE IF NOT EXISTS group_preferred_name_order (scope TEXT PRIMARY KEY,posted_at INTEGER NOT NULL)');
  }
  db.prepare("UPDATE followups SET state='unknown',updated_at=? WHERE state='attempting'").run(now);
  db.prepare("UPDATE public_journal SET state='unknown',updated_at=? WHERE state='attempting'").run(now);
  // An offline deadline is shown for review, not replayed on the next launch.
  db.prepare("UPDATE followups SET state='missed',updated_at=? WHERE state='pending' AND (due_at<? OR expires_at<=?)").run(now,now-groupFollowupGraceMs,now);
  // Version 3: owner-enabled source notices. They are not relationship memory,
  // so they carry no scope. An interrupted attempt is ambiguous and is never
  // replayed; a pending notice survives a restart until its own expiry.
  db.exec(`UPDATE source_notices SET state='pending',batch='' WHERE state='attempting' AND EXISTS
    (SELECT 1 FROM source_notice_delivery d WHERE d.batch=source_notices.batch AND d.app='not_attempted' AND d.qq='not_attempted');
    UPDATE source_notices SET state=COALESCE((SELECT CASE
      WHEN d.app='shown' OR d.qq='bridge_accepted' THEN 'sent'
      WHEN d.app='unknown' OR d.qq='unknown' THEN 'unknown'
      WHEN d.app='failed' OR d.qq='failed' THEN 'failed' ELSE 'unknown' END
      FROM source_notice_delivery d WHERE d.batch=source_notices.batch),'unknown'),payload='' WHERE state='attempting';`);
}

function savePreferredNameOrder(db,scope,postedAt){
  if(postedAt===undefined)return;
  db.prepare(`INSERT INTO group_preferred_name_order(scope,posted_at) VALUES(?,?)
    ON CONFLICT(scope) DO UPDATE SET posted_at=max(posted_at,excluded.posted_at)`).run(scope,postedAt);
}

function stalePreferredNameRequest(db,scope,postedAt){
  if(postedAt===undefined)return false;
  const last=db.prepare('SELECT posted_at FROM group_preferred_name_order WHERE scope=?').get(scope)?.posted_at;
  return last!==undefined&&postedAt<last;
}

function checkedGroupPreferredName(store,{name,sourceId,postedAt}){
  const valid=preferredNameValue(name);
  if(!store.ordinaryGroupFollowups||!valid||!NATIVE_GROUP_SOURCE.test(sourceId))throw invalid('Invalid group name preference.');
  if(postedAt!==undefined&&(!Number.isSafeInteger(postedAt)||postedAt<=0||postedAt%1000!==0||postedAt>store.now()+60000)){
    throw invalid('Invalid group name sending time.');
  }
  return valid;
}

function storedGroupPreferredNames(rows){
  const preferences=rows.filter(row=>preferredNameFromFact(row.text));
  return {preferences,current:preferences.find(row=>row.fact_key===PREFERRED_NAME_KEY)||preferences[0]};
}

function sources(db,scope,ids,now){
  identifiers(ids,'source identifiers');
  const rows=ids.map(id=>db.prepare("SELECT id,at FROM messages WHERE scope=? AND id=? AND role='user'").get(scope,id));
  if(rows.some(row=>!row))throw invalid('Memory sources must be retained owner messages in this relationship.');
  return {sourceIds:ids,sourceAt:rows.length?Math.min(...rows.map(row=>row.at)):now};
}

const factText=text=>text.replace(/[\p{P}\s]/gu,'');
const directDigest=(scope,id,text)=>createHash('sha256').update(JSON.stringify(['member_direct',scope,id,text])).digest('hex');

function independentTopic(text){
  return !!text.trim()&&text.length<=600&&text.isWellFormed()&&/[\p{L}\p{N}]/u.test(text)&&
    !/[|｜\p{Cc}\u2028-\u202e\u2066-\u2069]/u.test(text)&&clean(text,600)===text&&!MEMORY_REFERENCE.test(text);
}

function memberDirectProof(db,scope,id,text,sourceIds){
  if(!independentTopic(text)||sourceIds.length!==1||!NATIVE_GROUP_SOURCE.test(sourceIds[0]))return null;
  const source=db.prepare("SELECT text FROM messages WHERE scope=? AND id=? AND role='user'").get(scope,sourceIds[0]);
  if(!source)return null;
  const body=source.text.trim();
  const relative=parseGroupRelativeFollowup(body);
  if(relative)return !relative.operation&&!relative.error&&relative.topic===text?directDigest(scope,id,text):null;
  const absolute=ABSOLUTE_GROUP_CREATION.exec(body);
  return absolute&&Number.isFinite(dueFromLocalTime(absolute[1]))&&absolute[2].trim()===text?directDigest(scope,id,text):null;
}

function prepareFollowupCleanup(store,db,scope){
  const now=store.now();
  db.prepare("UPDATE followups SET state='missed',updated_at=? WHERE scope=? AND state='pending' AND expires_at<=?").run(now,scope,now);
  const rows=db.prepare('SELECT * FROM followups WHERE scope=?').all(scope),proofs=new Map();
  for(const row of rows){
    if(row.state!=='pending'||!independentTopic(row.text))continue;
    const expected=directDigest(scope,row.id,row.text);
    const proof=row.member_direct===null?memberDirectProof(db,scope,row.id,row.text,JSON.parse(row.source_ids)):
      row.member_direct===expected?expected:null;
    if(proof)proofs.set(row.id,proof);
  }
  return {rows,proofs,now};
}

function discardDerived(store,db,scope,fact,preservedIds=[],otherPreferredNames=false){
  // A reply may paraphrase a fact without repeating its exact value. Drop the
  // complete recent conversation, including earlier mentions, rather than
  // pretending text matching can find every derivative. Independent structured
  // facts remain available; records containing this exact old fact do not.
  const suffix=db.prepare('SELECT id FROM messages WHERE scope=?').all(scope);
  const group=store.ordinaryGroupFollowups?prepareFollowupCleanup(store,db,scope):null;
  for(const row of suffix)if(!preservedIds.includes(row.id))db.prepare('DELETE FROM messages WHERE scope=? AND id=?').run(scope,row.id);
  db.prepare('DELETE FROM scoped_notes WHERE scope=?').run(scope);
  // Version 4 (table created by SocialStore): lorebook timing state is derived
  // from the conversation that was just removed.
  db.prepare('DELETE FROM scope_state WHERE scope=?').run(scope);
  // Version 5: every branch of this conversation is a copy that may hold the same derived
  // text, so their conversations and lorebook state go in the same transaction.
  if(store.branchesEnabled)for(const branch of db.prepare('SELECT scope FROM branches WHERE root=?').all(scope)){
    for(const row of db.prepare('SELECT id FROM messages WHERE scope=?').all(branch.scope))if(!preservedIds.includes(row.id))db.prepare('DELETE FROM messages WHERE scope=? AND id=?').run(branch.scope,row.id);
    db.prepare('DELETE FROM scope_state WHERE scope=?').run(branch.scope);
  }
  db.prepare("UPDATE actions SET text='' WHERE scope=? AND kind IN ('reply','message','decision')").run(scope);
  const previousText=fact.text.trim().replace(/\s+/g,' ');
  const duplicates=db.prepare('SELECT id,text FROM facts WHERE scope=? AND id<>?').all(scope,fact.id)
    .filter(row=>row.text.trim().replace(/\s+/g,' ').includes(previousText)||otherPreferredNames&&preferredNameFromFact(row.text));
  const removedFacts=new Set([fact.id,...duplicates.map(row=>row.id)]);
  for(const row of duplicates)db.prepare('DELETE FROM facts WHERE scope=? AND id=?').run(scope,row.id);
  const deletedIds=new Set(suffix.filter(row=>!preservedIds.includes(row.id)).map(row=>row.id));
  const retainedIds=group?new Set(suffix.filter(row=>!deletedIds.has(row.id)).map(row=>row.id)):null;
  const removedText=group?[fact,...duplicates].map(row=>factText(row.text)).filter(Boolean):null;
  const followups=group?.rows??db.prepare('SELECT * FROM followups WHERE scope=?').all(scope);
  const counts=group?{cancelledFollowups:0,preservedPendingFollowups:0,unknownFollowups:0}:null;
  for(const row of followups){
    const sourceIds=JSON.parse(row.source_ids),normalized=group?factText(row.text):null;
    const confirmed=JSON.parse(row.fact_ids).some(id=>removedFacts.has(id))||
      (group?removedText.some(text=>normalized.includes(text)):row.text.includes(fact.text));
    const proof=group?.proofs.get(row.id);
    if(!confirmed&&proof){
      const kept=sourceIds.filter(id=>retainedIds.has(id));
      if(kept.length!==sourceIds.length||proof!==row.member_direct){
        db.prepare('UPDATE followups SET source_ids=?,member_direct=? WHERE scope=? AND id=?').run(JSON.stringify(kept),proof,scope,row.id);
      }
      counts.preservedPendingFollowups++;
      continue;
    }
    const dependent=confirmed||sourceIds.some(id=>deletedIds.has(id))||row.created_at>=fact.sourceAt;
    if(!dependent){
      if(counts&&row.state==='pending')counts.preservedPendingFollowups++;
      continue;
    }
    const state=row.state==='attempting'?'unknown':row.state==='pending'?'cancelled':row.state;
    if(counts){
      if(row.state==='pending')counts.cancelledFollowups++;
      if(row.state==='attempting')counts.unknownFollowups++;
    }
    const clearProof=group?',member_direct=NULL':'';
    db.prepare(`UPDATE followups SET state=?,text='',local_time=NULL,source_ids='[]',fact_ids='[]',updated_at=?,revision=revision+1${clearProof} WHERE scope=? AND id=?`)
      .run(state,group?.now??store.now(),scope,row.id);
  }
  return counts;
}

const continuityMethods={
  facts(scope,count=MAX_FACTS_PER_SCOPE){
    const key=this.scope(scope);limit(count,MAX_FACTS_PER_SCOPE);
    return this.withDb(db=>db.prepare('SELECT * FROM facts WHERE scope=? ORDER BY updated_at DESC,rowid DESC LIMIT ?').all(key,count).map(factRow));
  },
  remember(scope,{id=randomUUID(),key:factKey=id,text,sourceIds=[]}={}){
    const key=this.scope(scope);bounded(id,180,'fact identifier');bounded(factKey,120,'fact key');bounded(text,600,'fact');identifiers(sourceIds,'source identifiers');
    return this.withDb(db=>{
      this.ensureScope(db,key);const origin=sources(db,key,sourceIds,this.now());
      const existing=db.prepare('SELECT * FROM facts WHERE scope=? AND (id=? OR fact_key=?)').get(key,id,factKey);
      if(existing){if(existing.text===text&&existing.id===id)return factRow(existing);throw invalid('This fact already exists; correct it explicitly.');}
      const duplicate=db.prepare('SELECT * FROM facts WHERE scope=? AND text=?').get(key,text);
      if(duplicate)return factRow(duplicate);
      if(db.prepare('SELECT count(*) AS count FROM facts WHERE scope=?').get(key).count>=MAX_FACTS_PER_SCOPE)throw invalid(`The relationship has ${MAX_FACTS_PER_SCOPE} facts. Forget one before adding another.`);
      const now=this.now();db.prepare('INSERT INTO facts(scope,id,fact_key,text,source_ids,source_at,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,1)').run(key,id,factKey,text,JSON.stringify(sourceIds),origin.sourceAt,now,now);
      return factRow(db.prepare('SELECT * FROM facts WHERE scope=? AND id=?').get(key,id));
    });
  },
  upsertFact(scope,value={}){
    if(!value||typeof value!=='object'||Array.isArray(value))throw invalid('Invalid fact.');
    const existing=value.id?this.facts(scope).find(fact=>fact.id===value.id):value.key?this.facts(scope).find(fact=>fact.key===value.key):null;
    if(existing){if(existing.text===value.text)return existing;return this.correctFact(scope,existing.id,value);}
    return this.remember(scope,value);
  },
  saveGroupPreferredName(scope,{name,sourceId,factId,revision,postedAt}={}){
    const key=this.scope(scope), valid=checkedGroupPreferredName(this,{name,sourceId,postedAt});
    const text=groupPreferredNameFact(valid);
    return this.withDb(db=>{
      const origin=sources(db,key,[sourceId],this.now());
      const known=db.prepare('SELECT * FROM facts WHERE scope=? ORDER BY updated_at DESC,rowid DESC').all(key);
      const {preferences,current}=storedGroupPreferredNames(known);
      if(factId&&(current?.id!==factId||revision!==undefined&&current.revision!==revision)){
        throw invalid('The preferred name changed. Review the current value.');
      }
      if(stalePreferredNameRequest(db,key,postedAt))return {stale:true};
      if(!current&&known.length>=MAX_FACTS_PER_SCOPE)throw invalid('The relationship has reached its fact limit.');
      const now=this.now(), id=current?.id||randomUUID();
      // A new preference supersedes only recognized name facts for this
      // member and role. The original messages and appointments are retained.
      for(const row of preferences){
        if(row.id!==id)db.prepare('DELETE FROM facts WHERE scope=? AND id=?').run(key,row.id);
      }
      if(!current){
        db.prepare('INSERT INTO facts(scope,id,fact_key,text,source_ids,source_at,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,1)')
          .run(key,id,PREFERRED_NAME_KEY,text,JSON.stringify([sourceId]),origin.sourceAt,now,now);
      }else if(current.text!==text||current.fact_key!==PREFERRED_NAME_KEY){
        db.prepare('UPDATE facts SET fact_key=?,text=?,source_ids=?,source_at=?,updated_at=?,revision=revision+1 WHERE scope=? AND id=?')
          .run(PREFERRED_NAME_KEY,text,JSON.stringify([sourceId]),origin.sourceAt,now,key,id);
      }
      savePreferredNameOrder(db,key,postedAt);
      return {fact:factRow(db.prepare('SELECT * FROM facts WHERE scope=? AND id=?').get(key,id))};
    });
  },
  withdrawGroupPreferredName(scope,{name,sourceId,postedAt}={}){
    const key=this.scope(scope), valid=checkedGroupPreferredName(this,{name,sourceId,postedAt});
    return this.withDb(db=>{
      sources(db,key,[sourceId],this.now());
      if(stalePreferredNameRequest(db,key,postedAt))return {stale:true};
      const rows=db.prepare('SELECT id,fact_key,text FROM facts WHERE scope=? ORDER BY updated_at DESC,rowid DESC').all(key);
      const {preferences,current}=storedGroupPreferredNames(rows);
      if(!current||preferredNameFromFact(current.text)!==valid)return {withdrawn:false};
      // Remove superseded legacy name facts too so they cannot become the
      // active preference again. Conversation and unrelated facts stay intact.
      const remove=db.prepare('DELETE FROM facts WHERE scope=? AND id=?');
      for(const row of preferences)remove.run(key,row.id);
      savePreferredNameOrder(db,key,postedAt);
      return {withdrawn:true};
    });
  },
  // keepIds: messages to retain besides the sources (a correction typed in a branch, whose
  // message is not in this scope and so cannot be one of the fact's sources).
  correctFact(scope,id,{text,sourceIds=[],revision,keepIds=[]}={}){
    const key=this.scope(scope);bounded(id,180,'fact identifier');bounded(text,600,'fact');identifiers(sourceIds,'source identifiers');identifiers(keepIds,'message identifiers');
    return this.withDb(db=>{
      const previous=factRow(db.prepare('SELECT * FROM facts WHERE scope=? AND id=?').get(key,id));
      if(!previous)throw invalid('The fact was not found.');
      if(revision!==undefined&&revision!==previous.revision)throw invalid('The fact changed; review the current value.');
      const origin=sources(db,key,sourceIds,this.now());
      const preferred=!!(this.ordinaryGroupFollowups&&preferredNameFromFact(previous.text));
      const followupImpact=discardDerived(this,db,key,previous,[...sourceIds,...keepIds],preferred);
      const factKey=preferred&&previous.key===PREFERRED_NAME_KEY&&!preferredNameFromFact(text)?previous.id:previous.key;
      db.prepare('UPDATE facts SET fact_key=?,text=?,source_ids=?,source_at=?,updated_at=?,revision=revision+1 WHERE scope=? AND id=?')
        .run(factKey,text,JSON.stringify(sourceIds),origin.sourceAt,this.now(),key,id);
      const updated=factRow(db.prepare('SELECT * FROM facts WHERE scope=? AND id=?').get(key,id));
      return {...updated,...followupImpact};
    });
  },
  forgetFact(scope,id,{revision,preferredNamePostedAt}={}){
    const key=this.scope(scope);bounded(id,180,'fact identifier');
    return this.withDb(db=>{
      const previous=factRow(db.prepare('SELECT * FROM facts WHERE scope=? AND id=?').get(key,id));
      if(!previous)throw invalid('The fact was not found.');
      // A confirmation shown for an older value must not erase its correction.
      if(revision!==undefined&&revision!==previous.revision)throw invalid('The fact changed; review the current value.');
      const preferred=!!(this.ordinaryGroupFollowups&&preferredNameFromFact(previous.text));
      const impact=discardDerived(this,db,key,previous,[],preferred);
      db.prepare('DELETE FROM facts WHERE scope=? AND id=?').run(key,id);
      // Keep only the validated order marker. The forgotten name is never
      // written here, so a delayed request cannot resurrect it.
      if(preferred&&Number.isSafeInteger(preferredNamePostedAt)&&preferredNamePostedAt>0&&
         preferredNamePostedAt%1000===0&&preferredNamePostedAt<=this.now()+60000)savePreferredNameOrder(db,key,preferredNamePostedAt);
      return {forgotten:true,clearedConversation:true,clearedNotes:true,...impact};
    });
  },
  scheduleFollowup(scope,{id=randomUUID(),text,dueAt,timeZone:zone,localTime,expiresAt=dueAt+86400000,sourceIds=[],factIds=[],memberDirect=false}={}){
    const key=this.scope(scope);bounded(id,180,'follow-up identifier');bounded(text,600,'follow-up');timestamp(dueAt,'due time');timestamp(expiresAt,'expiry');zone=timeZone(zone);identifiers(sourceIds,'source identifiers');identifiers(factIds,'fact identifiers');
    if(typeof memberDirect!=='boolean'||memberDirect&&!this.ordinaryGroupFollowups)throw invalid('Invalid group follow-up source.');
    const local=validateLocalTime(localTime,dueAt);
    if(dueAt<this.now()||dueAt>this.now()+366*86400000||expiresAt<=dueAt||expiresAt>dueAt+7*86400000)throw invalid('Choose a future follow-up within one year and an expiry within seven days.');
    return this.withDb(db=>{
      this.ensureScope(db,key);sources(db,key,sourceIds,this.now());
      if(factIds.some(factId=>!db.prepare('SELECT 1 FROM facts WHERE scope=? AND id=?').get(key,factId)))throw invalid('Follow-up facts must belong to this relationship.');
      if(db.prepare('SELECT 1 FROM followups WHERE scope=? AND id=?').get(key,id))throw invalid('This follow-up identifier was already recorded.');
      if(db.prepare("SELECT count(*) AS count FROM followups WHERE scope=? AND state IN ('pending','attempting')").get(key).count>=MAX_PENDING_FOLLOWUPS_PER_SCOPE)throw invalid(`There are already ${MAX_PENDING_FOLLOWUPS_PER_SCOPE} pending follow-ups.`);
      const count=db.prepare('SELECT count(*) AS count FROM followups WHERE scope=?').get(key).count;
      if(count>=MAX_FOLLOWUPS_PER_SCOPE){
        // Keep uncertain send identifiers for seven days to avoid accidental
        // recreation by a stale caller; remove only older terminal receipts.
        const old=db.prepare("SELECT id FROM followups WHERE scope=? AND state NOT IN ('pending','attempting') AND updated_at<? ORDER BY updated_at LIMIT 1").get(key,this.now()-7*86400000);
        if(!old)throw invalid('Follow-up history is full. Wait for old receipts to retire.');
        db.prepare('DELETE FROM followups WHERE scope=? AND id=?').run(key,old.id);
      }
      const now=this.now(),group=this.ordinaryGroupFollowups;
      const proof=memberDirect?memberDirectProof(db,key,id,text,sourceIds):null;
      const proofColumn=group?',member_direct':'',proofValue=group?',?':'';
      db.prepare(`INSERT INTO followups(scope,id,text,due_at,expires_at,time_zone,state,source_ids,fact_ids,created_at,updated_at,receipt,revision,local_time${proofColumn}) VALUES(?,?,?,?,?,?,'pending',?,?,?,?,?,1,?${proofValue})`)
        .run(key,id,text,dueAt,expiresAt,zone,JSON.stringify(sourceIds),JSON.stringify(factIds),now,now,'',local,...(group?[proof??NO_MEMBER_PROOF]:[]));
      return followupRow(db.prepare('SELECT * FROM followups WHERE scope=? AND id=?').get(key,id));
    });
  },
  followups(scope,{state,status,dueBefore,count=MAX_FOLLOWUPS_PER_SCOPE,limit:requestedLimit}={}){
    const key=this.scope(scope);count=requestedLimit??count;limit(count,MAX_FOLLOWUPS_PER_SCOPE);state=state??status;
    if(state!==undefined&&!['pending','attempting','sent','cancelled','unknown','failed','missed'].includes(state))throw invalid('Invalid follow-up state.');
    if(dueBefore!==undefined)timestamp(dueBefore,'due filter');
    return this.withDb(db=>{
      db.prepare("UPDATE followups SET state='missed',updated_at=? WHERE scope=? AND state='pending' AND expires_at<=?").run(this.now(),key,this.now());
      return db.prepare('SELECT * FROM followups WHERE scope=? ORDER BY due_at,rowid').all(key).filter(row=>(state===undefined||row.state===state)&&(dueBefore===undefined||row.due_at<=dueBefore)).slice(0,count).map(followupRow);
    });
  },
  updateFollowup(scope,id,patch={}){
    const key=this.scope(scope);bounded(id,180,'follow-up identifier');
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['text','dueAt','expiresAt','timeZone','localTime','revision','editPostedAt'].includes(k)))throw invalid('Invalid follow-up change.');
    const ordered=Object.hasOwn(patch,'editPostedAt'),postedAt=patch.editPostedAt;
    if(ordered&&(!Number.isSafeInteger(postedAt)||postedAt<=0||postedAt>8640000000000000))throw invalid('Invalid follow-up edit time.');
    const updated=this.withDb(db=>{
      const row=db.prepare('SELECT * FROM followups WHERE scope=? AND id=?').get(key,id),previous=followupRow(row);
      if(!previous||previous.state!=='pending')throw invalid('Only a pending follow-up can change.');
      if(ordered){
        if(!Object.hasOwn(row,'last_edit_posted_at'))throw invalid('Verified edit ordering is unavailable for this follow-up.');
        if(previous.lastEditPostedAt!==undefined&&postedAt<previous.lastEditPostedAt)return STALE_FOLLOWUP_EDIT;
      }
      if(patch.revision!==undefined&&patch.revision!==previous.revision)throw invalid('The follow-up changed; review its current time.');
      const next={...previous,...patch};bounded(next.text,600,'follow-up');timestamp(next.dueAt,'due time');next.timeZone=timeZone(next.timeZone);
      const timeChanged=next.dueAt!==previous.dueAt||next.timeZone!==previous.timeZone;
      let localTime=patch.localTime;
      if(localTime===undefined&&!timeChanged)localTime=previous.localTime;
      const local=validateLocalTime(localTime,next.dueAt);
      if(patch.dueAt!==undefined&&patch.expiresAt===undefined)next.expiresAt=next.dueAt+86400000;
      timestamp(next.expiresAt,'expiry');
      if(next.dueAt<this.now()||next.dueAt>this.now()+366*86400000||next.expiresAt<=next.dueAt||next.expiresAt>next.dueAt+7*86400000)throw invalid('Invalid follow-up time or expiry.');
      const orderColumn=ordered?',last_edit_posted_at=?':'';
      const downgraded=this.ordinaryGroupFollowups&&next.text!==previous.text;
      const proofColumn=downgraded?',member_direct=?':'';
      db.prepare(`UPDATE followups SET text=?,due_at=?,expires_at=?,time_zone=?,local_time=?,updated_at=?,revision=revision+1${orderColumn}${proofColumn} WHERE scope=? AND id=?`)
        .run(next.text,next.dueAt,next.expiresAt,next.timeZone,local,this.now(),...(ordered?[postedAt]:[]),...(downgraded?[NO_MEMBER_PROOF]:[]),key,id);
      return followupRow(db.prepare('SELECT * FROM followups WHERE scope=? AND id=?').get(key,id));
    });
    // The stale decision was made under the write lock, with no changes to commit.
    // Report it separately so withDb does not classify it as a storage failure.
    if(updated===STALE_FOLLOWUP_EDIT)throw Object.assign(Error('The follow-up has a newer verified edit.'),{code:'social_stale_followup_edit'});
    return updated;
  },
  claimFollowup(scope,id,{revision}={}){
    const key=this.scope(scope);bounded(id,180,'follow-up identifier');
    return this.withDb(db=>{
      const previous=followupRow(db.prepare('SELECT * FROM followups WHERE scope=? AND id=?').get(key,id));
      if(!previous||previous.state!=='pending'||previous.dueAt>this.now()||previous.expiresAt<=this.now()||(revision!==undefined&&revision!==previous.revision))return null;
      db.prepare("UPDATE followups SET state='attempting',updated_at=? WHERE scope=? AND id=? AND state='pending'").run(this.now(),key,id);
      return {...previous,state:'attempting',updatedAt:this.now()};
    });
  },
  finishFollowup(scope,id,{state,receipt=''}={}){
    const key=this.scope(scope);bounded(id,180,'follow-up identifier');bounded(receipt,300,'receipt',true);
    if(!['sent','unknown','cancelled','failed'].includes(state))throw invalid('Invalid final follow-up state.');
    return this.withDb(db=>{
      const previous=followupRow(db.prepare('SELECT * FROM followups WHERE scope=? AND id=?').get(key,id));
      if(!previous||previous.state!=='attempting')throw invalid('Only an attempted follow-up can finish; finished and unknown sends cannot retry.');
      db.prepare('UPDATE followups SET state=?,receipt=?,updated_at=? WHERE scope=? AND id=?').run(state,receipt,this.now(),key,id);
      return {...previous,state,receipt,updatedAt:this.now()};
    });
  },
  cancelFollowup(scope,id,{reason,revision}={}){
    const key=this.scope(scope);bounded(id,180,'follow-up identifier');
    return this.withDb(db=>{
      const previous=followupRow(db.prepare('SELECT * FROM followups WHERE scope=? AND id=?').get(key,id));
      if(!previous)throw invalid('The follow-up was not found.');
      if(revision!==undefined&&(previous.state!=='pending'||previous.revision!==revision))return previous;
      if(!['pending','attempting'].includes(previous.state))return previous;
      const state=previous.state==='attempting'?'unknown':reason==='missed'?'missed':'cancelled';
      db.prepare('UPDATE followups SET state=?,updated_at=?,revision=revision+1 WHERE scope=? AND id=?').run(state,this.now(),key,id);
      return {...previous,state,updatedAt:this.now(),revision:previous.revision+1};
    });
  },
  publicEntries(scope,count=30){
    const key=this.scope(scope);limit(count,100);
    return this.withDb(db=>db.prepare('SELECT * FROM public_journal WHERE scope=? ORDER BY at DESC,rowid DESC LIMIT ?').all(key,count).map(publicRow));
  },
  journal(scope,count=30){
    const key=this.scope(scope);limit(count,100);
    // Drafts and uncertain attempts must neither enter public context nor hide
    // the published history that still exists inside the bounded store.
    return this.withDb(db=>db.prepare("SELECT * FROM public_journal WHERE scope=? AND state='published' ORDER BY at DESC,rowid DESC LIMIT ?").all(key,count).map(publicRow));
  },
  addPublicEntry(scope,{id=randomUUID(),text,at=this.now(),postId='',receipt=postId,state='draft'}={}){
    const key=this.scope(scope);bounded(id,180,'public entry identifier');bounded(text,1000,'public entry');timestamp(at,'public entry time');bounded(receipt,300,'post receipt',true);
    if(!['draft','published'].includes(state)||(state==='published'&&!receipt))throw invalid('Published public entries require a real post receipt.');
    return this.withDb(db=>{
      this.ensureScope(db,key);
      const existing=db.prepare('SELECT * FROM public_journal WHERE scope=? AND id=?').get(key,id);
      if(existing){if(existing.text===text&&existing.post_id===receipt&&existing.state===state)return publicRow(existing);throw invalid('This public entry identifier was already used.');}
      const now=this.now();db.prepare('INSERT INTO public_journal(scope,id,text,at,updated_at,state,post_id) VALUES(?,?,?,?,?,?,?)').run(key,id,text,at,now,state,receipt);
      db.prepare("DELETE FROM public_journal WHERE scope=? AND id<>? AND state<>'attempting' AND rowid NOT IN (SELECT rowid FROM public_journal WHERE scope=? ORDER BY at DESC,rowid DESC LIMIT 100)").run(key,id,key);
      return {id,text,at,updatedAt:now,state,postId:receipt,receipt};
    });
  },
  appendJournal(scope,value={}){return this.addPublicEntry(scope,{...value,state:'published'});},
  claimPublicEntry(scope,id){
    const key=this.scope(scope);bounded(id,180,'public entry identifier');
    return this.withDb(db=>{
      const previous=db.prepare('SELECT * FROM public_journal WHERE scope=? AND id=?').get(key,id);
      if(!previous||previous.state!=='draft')return null;
      db.prepare("UPDATE public_journal SET state='attempting',updated_at=? WHERE scope=? AND id=?").run(this.now(),key,id);
      return {...publicRow(previous),state:'attempting',updatedAt:this.now()};
    });
  },
  finishPublicEntry(scope,id,{state,postId='',receipt=postId}={}){
    const key=this.scope(scope);bounded(id,180,'public entry identifier');bounded(receipt,300,'post receipt',true);
    if(!['published','unknown','failed','cancelled'].includes(state)||(state==='published'&&!receipt))throw invalid('Invalid public publication result.');
    return this.withDb(db=>{
      const previous=db.prepare('SELECT * FROM public_journal WHERE scope=? AND id=?').get(key,id);
      if(!previous||previous.state!=='attempting')throw invalid('Only an attempted public entry can finish. Unknown and finished publications cannot retry.');
      db.prepare('UPDATE public_journal SET state=?,post_id=?,updated_at=? WHERE scope=? AND id=?').run(state,receipt,this.now(),key,id);
      return {...publicRow(previous),state,postId:receipt,receipt,updatedAt:this.now()};
    });
  },
  publishPublicEntry(scope,id,{postId}={}){return this.finishPublicEntry(scope,id,{state:'published',postId});},
  // Source notices: bounded, deduplicated by event id, one attempt per batch.
  // Finished rows keep only identity/state for the duplicate barrier and limits.
  addNotice({id,source,kind,importance,payload,at,expiresAt}={}){
    bounded(id,128,'notice identifier');bounded(source,64,'notice source');bounded(kind,40,'notice kind');bounded(payload,4000,'notice payload');timestamp(at,'notice time');timestamp(expiresAt,'notice expiry');
    if(!['low','normal','high'].includes(importance))throw invalid('Invalid notice importance.');
    return this.withDb(db=>{
      const now=this.now();
      if(db.prepare('SELECT 1 FROM source_notices WHERE id=?').get(id))return {accepted:false,reason:'duplicate'};
      if(expiresAt<=now)return {accepted:false,reason:'expired'};
      db.prepare("UPDATE source_notices SET state='missed',payload='',updated_at=? WHERE state='pending' AND expires_at<=?").run(now,now);
      db.prepare("DELETE FROM source_notices WHERE state NOT IN ('pending','attempting') AND updated_at<?").run(now-NOTICE_RETENTION);
      if(db.prepare("SELECT count(*) AS count FROM source_notices WHERE state IN ('pending','attempting')").get().count>=NOTICE_PENDING){
        const old=db.prepare("SELECT id FROM source_notices WHERE state='pending' AND importance='low' ORDER BY created_at,rowid LIMIT 1").get();
        if(!old)return {accepted:false,reason:'full'};
        db.prepare("UPDATE source_notices SET state='dropped',payload='',updated_at=? WHERE id=?").run(now,old.id);
      }
      const extra=db.prepare('SELECT count(*) AS count FROM source_notices').get().count-NOTICE_ROWS+1;
      if(extra>0)db.prepare("DELETE FROM source_notices WHERE rowid IN (SELECT rowid FROM source_notices WHERE state NOT IN ('pending','attempting') ORDER BY updated_at,rowid LIMIT ?)").run(extra);
      db.prepare("INSERT INTO source_notices(id,source,kind,importance,payload,at,expires_at,state,batch,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'pending','',?,?)").run(id,source,kind,importance,payload,at,expiresAt,now,now);
      return {accepted:true};
    });
  },
  pendingNotices(){
    return this.withDb(db=>{
      const now=this.now();
      // An expired notice is recorded as missed. It is never delivered late.
      db.prepare("UPDATE source_notices SET state='missed',payload='',updated_at=? WHERE state='pending' AND expires_at<=?").run(now,now);
      return db.prepare("SELECT * FROM source_notices WHERE state='pending' ORDER BY created_at,rowid").all().map(noticeRow);
    });
  },
  noticeAttempts(){
    return this.withDb(db=>db.prepare("SELECT batch,max(updated_at) AS at,max(state='sent') AS sent FROM source_notices WHERE batch<>'' AND state IN ('attempting','sent','failed','unknown') GROUP BY batch ORDER BY at").all().map(row=>({batch:row.batch,at:row.at,sent:!!row.sent})));
  },
  latestNoticeAttempt(){
    return this.withDb(db=>{
      const row=db.prepare(`WITH newest AS (SELECT at,app,qq,rowid AS seq FROM source_notice_delivery ORDER BY rowid DESC LIMIT 1)
        SELECT at,app,qq FROM (
        SELECT at,app,qq,1 AS detailed,seq FROM newest
        UNION ALL SELECT n.updated_at,'unrecorded','unrecorded',0,n.rowid FROM source_notices n
        WHERE n.batch<>'' AND n.state IN ('attempting','sent','failed','unknown')
        AND NOT EXISTS (SELECT 1 FROM source_notice_delivery d WHERE d.batch=n.batch)
      ) ORDER BY at DESC,detailed DESC,seq DESC LIMIT 1`).get();
      if(!row||!Number.isSafeInteger(row.at)||row.at<0)return null;
      return {at:row.at,app:NOTICE_RESULTS.app.has(row.app)?row.app:'unrecorded',qq:NOTICE_RESULTS.qq.has(row.qq)?row.qq:'unrecorded'};
    });
  },
  claimNotices(ids,batch,{trackDelivery=false}={}){
    if(!Array.isArray(ids)||!ids.length||ids.length>NOTICE_PENDING||new Set(ids).size!==ids.length)throw invalid('Invalid notice batch.');
    ids.forEach(id=>bounded(id,128,'notice identifier'));bounded(batch,128,'notice batch');
    return this.withDb(db=>{
      const now=this.now();
      if(db.prepare('SELECT 1 FROM source_notices WHERE batch=?').get(batch))return null;
      const rows=ids.map(id=>db.prepare("SELECT * FROM source_notices WHERE id=? AND state='pending' AND expires_at>?").get(id,now));
      if(rows.some(row=>!row))return null;
      if(trackDelivery){
        // Released batches can be retried with a new ticket. Their receipts
        // contain no source payload, URL, owner identity or bridge message ID.
        db.prepare(`DELETE FROM source_notice_delivery WHERE batch NOT IN (SELECT batch FROM source_notices WHERE state='attempting')
          AND (at<? OR rowid IN (SELECT rowid FROM source_notice_delivery ORDER BY rowid DESC LIMIT -1 OFFSET ?))`).run(now-NOTICE_RETENTION,NOTICE_ROWS-1);
        db.prepare("INSERT INTO source_notice_delivery(batch,at,app,qq) VALUES(?,?,'not_attempted','not_attempted')").run(batch,now);
      }
      for(const id of ids)db.prepare("UPDATE source_notices SET state='attempting',batch=?,updated_at=? WHERE id=?").run(batch,now,id);
      return rows.map(row=>({...noticeRow(row),state:'attempting',batch,updatedAt:now}));
    });
  },
  recordNoticeOutcome(batch,sink,result){
    bounded(batch,128,'notice batch');
    if(!Object.hasOwn(NOTICE_RESULTS,sink)||!NOTICE_RESULTS[sink].has(result))throw invalid('Invalid notice delivery outcome.');
    const previous=result==='unknown'?'not_attempted':'unknown';
    return this.withDb(db=>db.prepare(`UPDATE source_notice_delivery SET ${sink}=? WHERE batch=? AND ${sink}=?
      AND EXISTS (SELECT 1 FROM source_notices WHERE batch=? AND state='attempting')`).run(result,batch,previous,batch).changes===1);
  },
  finishNotices(batch,{state}={}){
    bounded(batch,128,'notice batch');
    if(!['sent','failed','unknown'].includes(state))throw invalid('Invalid final notice state.');
    return this.withDb(db=>Number(db.prepare("UPDATE source_notices SET state=?,payload='',updated_at=? WHERE batch=? AND state='attempting'").run(state,this.now(),batch).changes));
  },
  // Only for an attempt that verifiably produced nothing (owner interrupted it).
  releaseNotices(batch){
    bounded(batch,128,'notice batch');
    return this.withDb(db=>Number(db.prepare(`UPDATE source_notices SET state='pending',batch='',updated_at=? WHERE batch=? AND state='attempting'
      AND NOT EXISTS (SELECT 1 FROM source_notice_delivery WHERE batch=? AND (app<>'not_attempted' OR qq<>'not_attempted'))`).run(this.now(),batch,batch).changes));
  },
  updatePublicEntry(scope,id,{text}={}){
    const key=this.scope(scope);bounded(id,180,'public entry identifier');bounded(text,1000,'public entry');
    return this.withDb(db=>{
      const previous=db.prepare('SELECT * FROM public_journal WHERE scope=? AND id=?').get(key,id);
      if(!previous)throw invalid('The public entry was not found.');
      if(previous.state==='attempting')throw invalid('Wait for the current publication result before editing.');
      db.prepare('UPDATE public_journal SET text=?,updated_at=? WHERE scope=? AND id=?').run(text,this.now(),key,id);
      return {...publicRow(previous),text,updatedAt:this.now(),externalPostUnchanged:previous.state==='published'};
    });
  },
  deletePublicEntry(scope,id){
    const key=this.scope(scope);bounded(id,180,'public entry identifier');
    return this.withDb(db=>{
      const previous=db.prepare('SELECT * FROM public_journal WHERE scope=? AND id=?').get(key,id);
      if(!previous)throw invalid('The public entry was not found.');
      if(previous.state==='attempting')throw invalid('Wait for the current publication result before deleting.');
      db.prepare('DELETE FROM public_journal WHERE scope=? AND id=?').run(key,id);
      return {deleted:true,externalPostUnchanged:previous.state==='published'};
    });
  }
};
module.exports={initializeContinuity,continuityMethods,MAX_FACTS_PER_SCOPE,MAX_FOLLOWUPS_PER_SCOPE,MAX_PENDING_FOLLOWUPS_PER_SCOPE};
