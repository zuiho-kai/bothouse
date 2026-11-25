'use strict';

const {fail}=require('./store.cjs');
const {providerForRole}=require('./ai-roles.cjs');
const {aiBudget,GLOBAL_CONCURRENCY}=require('./ai-budget.cjs');
const CHECK_MS=60_000;
const IDLE_MS=6*60*60_000;
const MIN_INTERVAL_MS=20*60*60_000;
const SCAN_LIMIT=100;
const scopeQuery=`SELECT g.chat,g.human,g.ai,p.enabled,p.start_minute,p.end_minute,p.time_zone,p.revision,
    coalesce(cloud.enabled,1) AS cloud_enabled,coalesce(cloud.revision,0) AS cloud_revision,
    coalesce((SELECT max(t.started) FROM ai_proactive_turns t WHERE t.chat=g.chat),-1) AS last_started
  FROM ai_direct_grants g
  JOIN chats c ON c.id=g.chat AND c.type='direct' AND c.first_user=min(g.human,g.ai) AND c.second_user=max(g.human,g.ai)
  JOIN users sender ON sender.number=g.ai AND sender.kind='ai'
  JOIN users recipient ON recipient.number=g.human AND recipient.kind='human'
  JOIN members a ON a.chat=g.chat AND a.account=g.human
  JOIN members b ON b.chat=g.chat AND b.account=g.ai
  LEFT JOIN ai_direct_permissions cloud ON cloud.chat=g.chat
  LEFT JOIN ai_direct_proactive p ON p.chat=g.chat`;
const clocks=new Map();

function localClock(timeZone) {
  let clock=clocks.get(timeZone);
  if(!clock) {
    clock=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    clocks.set(timeZone,clock);
  }
  return clock;
}

function windowDay(prefs,now) {
  const parts=Object.fromEntries(localClock(prefs.time_zone).formatToParts(now).map(part=>[part.type,part.value]));
  const minute=Number(parts.hour)*60+Number(parts.minute);
  const start=prefs.start_minute, end=prefs.end_minute;
  const overnight=start>end;
  if(overnight?minute>=end&&minute<start:minute<start||minute>=end)return null;
  const date=parts.year+'-'+parts.month+'-'+parts.day;
  if(!overnight||minute>=start)return date;
  const midnight=Date.parse(date+'T00:00:00Z');
  return new Date(midnight-86400000).toISOString().slice(0,10);
}

function greeting(raw) {
  const decision=JSON.parse(raw);
  if(!decision||Object.keys(decision).length!==1||!Object.hasOwn(decision,'message'))
    throw Error('Invalid proactive decision');
  if(decision.message===null)return null;
  if(typeof decision.message!=='string')throw Error('Invalid proactive message');
  const text=decision.message.trim();
  if(!text||Array.from(text).length>80||/[\x00-\x1f\x7f]|https?:\/\/|www\./iu.test(text))
    throw Error('Invalid proactive message');
  return text;
}

function createAiProactive(store,directProviders) {
  const providers=new Map(directProviders.filter(([role,provider])=>providerForRole.has(role)&&
    provider?.provider===providerForRole.get(role)&&typeof provider.generate==='function'&&
    typeof provider.generateProactiveGreeting==='function'));
  const roles=[...providers.keys()];
  const active=new Map();
  let timer,scanning=false,rescan=false,stopped=false;
  // The call might already have reached the provider. Do not replay it.
  store.run("UPDATE ai_proactive_turns SET state='failed' WHERE state='pending'");

  const load=chat=>store.one(scopeQuery+' WHERE g.chat=?',chat);
  function own(account,chat) {
    const prefs=load(chat);
    if(prefs?.human!==account||!providerForRole.has(prefs.ai))fail(404,'proactive_unavailable','没有找到这位角色的私聊');
    return prefs;
  }
  function view(account,chat) {
    const prefs=own(account,chat);
    return {account,settings:{available:providers.has(prefs.ai),cloudEnabled:Boolean(prefs.cloud_enabled),enabled:Boolean(prefs.enabled),
      startMinute:prefs.start_minute??18*60,endMinute:prefs.end_minute??21*60,
      timeZone:prefs.time_zone??null,revision:prefs.revision??0}};
  }
  function cancelPending(chat) {
    return Boolean(store.run("UPDATE ai_proactive_turns SET state='cancelled' WHERE chat=? AND state='pending'",chat).changes);
  }
  function abort(chat) {
    active.get(chat)?.abort();
  }
  function save(account,chat,body) {
    if(body.expectedAccount!==account)fail(409,'proactive_session','账号已切换，请重新打开角色私聊');
    const current=own(account,chat);
    const {enabled}=body, revision=current.revision??0;
    let {startMinute,endMinute,timeZone}=body;
    if(body.revision!==revision) {
      if(enabled!==false||!Number.isInteger(body.revision)||body.revision<0||body.revision>revision)
        fail(409,'proactive_revision','主动联系设置已变化');
      if(!current.enabled)return view(account,chat);
      // A stale dialog may stop delivery without overwriting newer hours.
      startMinute=current.start_minute;
      endMinute=current.end_minute;
      timeZone=current.time_zone;
    }
    if(typeof enabled!=='boolean'||![startMinute,endMinute].every(value=>Number.isInteger(value)&&value>=0&&value<1440)||
       startMinute===endMinute||typeof timeZone!=='string'||!timeZone||timeZone.length>80)
      fail(400,'proactive_hours','请填写有效的联系时段与时区');
    let zone;
    try {zone=new Intl.DateTimeFormat('en-CA',{timeZone}).resolvedOptions().timeZone;}
    catch {fail(400,'proactive_hours','请填写有效的联系时区');}
    if(enabled&&(!providers.has(current.ai)||!current.cloud_enabled))fail(409,'proactive_unavailable','请先开启角色云聊天');
    if(Boolean(current.enabled)===enabled&&current.start_minute===startMinute&&
       current.end_minute===endMinute&&current.time_zone===zone)return view(account,chat);
    store.run(`INSERT INTO ai_direct_proactive(chat,enabled,start_minute,end_minute,time_zone,revision)
      VALUES(?,?,?,?,?,?) ON CONFLICT(chat) DO UPDATE SET enabled=excluded.enabled,start_minute=excluded.start_minute,
      end_minute=excluded.end_minute,time_zone=excluded.time_zone,revision=excluded.revision`,
    chat,Number(enabled),startMinute,endMinute,zone,revision+1);
    const cancelled=cancelPending(chat);
    return {...view(account,chat),...(cancelled&&{abortProactive:true})};
  }
  function idle(chat,now) {
    const last=store.one('SELECT created FROM messages WHERE chat=? ORDER BY id DESC LIMIT 1',chat);
    return !last||now-Date.parse(last.created)>=IDLE_MS;
  }
  function claim(row,now,day) {
    return store.transaction(()=>{
      const current=load(row.chat);
      if(!current?.enabled||current.ai!==row.ai||!current.cloud_enabled||current.revision!==row.revision||
         current.cloud_revision!==row.cloud_revision||!idle(row.chat,now)||
         store.one('SELECT 1 FROM ai_proactive_turns WHERE chat=? AND (local_day=? OR started>?)',
           row.chat,day,now-MIN_INTERVAL_MS)||aiBudget(store,row.chat,now))return false;
      store.run("INSERT INTO ai_proactive_turns(chat,local_day,started,state) VALUES(?,?,?,'pending')",row.chat,day,now);
      return true;
    });
  }
  async function deliver(row,day) {
    const controller=new AbortController();
    active.set(row.chat,controller);
    try {
      let text,state='quiet';
      try {text=greeting(await providers.get(row.ai).generateProactiveGreeting({signal:controller.signal}));}
      catch {state='failed';}
      if(stopped)return;
      store.transaction(()=>{
        if(store.one('SELECT state FROM ai_proactive_turns WHERE chat=? AND local_day=?',row.chat,day)?.state!=='pending')return;
        const current=load(row.chat),now=Date.now();
        if(controller.signal.aborted||!current?.enabled||current.ai!==row.ai||!current.cloud_enabled||current.revision!==row.revision||
           current.cloud_revision!==row.cloud_revision||windowDay(current,now)!==day||!idle(row.chat,now))state='cancelled';
        else if(text) {
          store.send(row.ai,row.chat,{clientId:'ai-proactive-'+day,text});
          state='sent';
        }
        store.run('UPDATE ai_proactive_turns SET state=? WHERE chat=? AND local_day=?',state,row.chat,day);
      });
    } finally {
      active.delete(row.chat);
      wake();
    }
  }
  async function tick() {
    let lastStarted=-1, lastChat='';
    const cutoff=Date.now()-MIN_INTERVAL_MS;
    while(!stopped&&active.size<GLOBAL_CONCURRENCY&&!aiBudget(store,undefined,Date.now())) {
      // Start with the people least recently offered a chance. A fixed chat
      // ordering would repeatedly favor the same people when capacity runs out.
      const rows=store.all(`WITH opted AS (${scopeQuery}
        WHERE g.ai IN (${roles.map(()=>'?').join(',')}) AND p.enabled=1 AND coalesce(cloud.enabled,1)=1)
        SELECT * FROM opted WHERE last_started<=? AND (last_started,chat)>(?,?)
        ORDER BY last_started,chat LIMIT ?`,...roles,cutoff,lastStarted,lastChat,SCAN_LIMIT);
      for(const row of rows) {
        if(stopped||active.size>=GLOBAL_CONCURRENCY)return;
        lastStarted=row.last_started;
        lastChat=row.chat;
        if(active.has(row.chat))continue;
        const now=Date.now();
        const day=windowDay(row,now);
        if(!day)continue;
        if(aiBudget(store,undefined,now))return;
        if(claim(row,now,day))void deliver(row,day).catch(logFailure);
      }
      if(rows.length<SCAN_LIMIT)return;
      // Let regular requests run between batches, including revocation.
      await new Promise(resolve=>setImmediate(resolve));
    }
  }
  const logFailure=error=>console.error('AI proactive check failed',error.code||error.name);
  function wake() {
    if(stopped||!timer)return;
    if(scanning) {rescan=true;return;}
    scanning=true;
    void tick().catch(logFailure).finally(()=>{
      scanning=false;
      if(rescan) {
        rescan=false;
        wake();
      }
    });
  }
  function start() {
    if(!roles.length||timer)return;
    stopped=false;
    timer=setInterval(wake,CHECK_MS);
    timer.unref();
    wake();
  }
  function stop() {
    stopped=true;
    clearInterval(timer);
    timer=undefined;
    for(const controller of active.values())controller.abort();
  }
  return {view,save,cancelPending,abort,start,stop,wake};
}

module.exports={createAiProactive};
