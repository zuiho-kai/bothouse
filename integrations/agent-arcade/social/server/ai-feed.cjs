'use strict';

const {fail}=require('./store.cjs');
const {AI_NUMBER,providerForRole}=require('./ai-roles.cjs');
const {aiBudget}=require('./ai-budget.cjs');
const CHECK_INTERVAL_MS=60_000;
const OPEN_UTC_HOUR=8;
const CLOSE_UTC_HOUR=11;
const isOpen=time=>time.getUTCHours()>=OPEN_UTC_HOUR&&time.getUTCHours()<CLOSE_UTC_HOUR;

function postText(raw) {
  const value=JSON.parse(raw);
  if(!value||Object.keys(value).length!==1||!Object.hasOwn(value,'post'))throw Error('Invalid AI feed decision');
  if(value.post===null)return null;
  if(typeof value.post!=='string')throw Error('Invalid AI feed post');
  const text=value.post.trim();
  if(!text||Array.from(text).length>120||/[\x00-\x1f\x7f]|https?:\/\/|www\./iu.test(text))
    throw Error('Invalid AI feed post');
  return text;
}

function createAiFeed(store,providers,clock=()=>new Date()) {
  const catalog=new Map(providers.filter(([role,provider])=>
    provider?.provider===providerForRole.get(role)&&typeof provider.generateFriendPost==='function'));
  let timer, active, stopped=false;
  // An interrupted provider call may have cost money. Its day is already used.
  store.run("UPDATE ai_feed_turns SET state='failed' WHERE state='pending'");

  function subscription(account,number=AI_NUMBER) {
    const author=store.one("SELECT number,name AS displayName,kind FROM users WHERE number=? AND kind='ai'",number);
    if(!author)return null;
    return {...author,available:catalog.has(number),
      following:Boolean(store.one('SELECT 1 FROM ai_feed_follows WHERE account=? AND role=?',account,number))};
  }
  const subscriptions=account=>Array.from(providerForRole.keys(),role=>subscription(account,role)).filter(Boolean);
  function follow(account,body) {
    if(body.expectedAccount!==account)fail(409,'feed_session','账号已切换，请重新打开好友动态');
    const {role,enabled}=body;
    if(!providerForRole.has(role)||typeof enabled!=='boolean'||store.user(account).kind!=='human')
      fail(400,'feed_follow','关注请求无效');
    if(enabled){
      if(!subscription(account,role)?.available)fail(409,'feed_role_unavailable','这位角色暂时无法发表新动态');
      store.run('INSERT OR IGNORE INTO ai_feed_follows(account,role) VALUES(?,?)',account,role);
    }else store.run('DELETE FROM ai_feed_follows WHERE account=? AND role=?',account,role);
    return {account,role:subscription(account,role),roles:subscriptions(account)};
  }
  const hasFollowers=role=>Boolean(store.one('SELECT 1 FROM ai_feed_follows WHERE role=? LIMIT 1',role));

  async function publish(role,provider,now,signal) {
    const day=now.toISOString().slice(0,10), started=now.getTime();
    const claimed=store.transaction(()=>{
      if(!hasFollowers(role)||store.one('SELECT 1 FROM ai_feed_turns WHERE role=? AND day=?',role,day)||
         aiBudget(store,null,started))return false;
      store.run("INSERT INTO ai_feed_turns(role,day,started,state) VALUES(?,?,?,'pending')",role,day,started);
      return true;
    });
    if(!claimed)return;
    let text, state='quiet';
    try {text=postText(await provider.generateFriendPost(day,{signal}));}
    catch {state='failed';}
    if(stopped)return;
    store.transaction(()=>{
      if(store.one('SELECT state FROM ai_feed_turns WHERE role=? AND day=?',role,day)?.state!=='pending')return;
      const completed=clock();
      if(text&&isOpen(completed)&&completed.toISOString().startsWith(day)&&hasFollowers(role)){
        store.run('INSERT INTO friend_posts(author,nonce,body,created) VALUES(?,?,?,?)',
          role,'ai-feed-'+day,text,completed.toISOString());
        state='published';
      }
      store.run('UPDATE ai_feed_turns SET state=? WHERE role=? AND day=?',state,role,day);
    });
  }
  async function tick(){
    if(stopped||active)return;
    const controller=new AbortController();
    active=controller;
    try{
      for(const [role,provider] of catalog){
        const now=clock();
        if(stopped||!isOpen(now))break;
        await publish(role,provider,now,controller.signal);
      }
    }finally{active=undefined;}
  }
  function start() {
    if(!catalog.size||timer)return;
    stopped=false;
    const wake=()=>void tick().catch(error=>console.error('AI feed check failed',error.code||error.name));
    timer=setInterval(wake,CHECK_INTERVAL_MS);
    timer.unref();
    wake();
  }
  function stop() {
    stopped=true;
    clearInterval(timer);
    timer=undefined;
    active?.abort();
  }
  return {subscription,subscriptions,follow,start,stop};
}
module.exports={createAiFeed};
