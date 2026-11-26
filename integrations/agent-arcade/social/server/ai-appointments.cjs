'use strict';

const {randomUUID}=require('node:crypto');
const {AI_NUMBER,fail}=require('./store.cjs');
const {DAY_MS,timeZone,exactTime,readTime}=require('./appointment-time.cjs');

const LATE_MS=5*60_000;
const PENDING_LIMIT=12;
const lead=String.raw`(?:(?:请|你|能不能|可以|麻烦你?|记得|到时候?|帮我)\s*)*提醒我(?:一下)?\s*`;
const reminderFirst=new RegExp('^'+lead,'u');
const timeFirst=new RegExp('^(.{1,44}?)\\s*[,，]?\\s*'+lead,'u');
const cancelledRequest=/[，,。；;]\s*(?:先)?(?:暂时)?(?:算了|不用(?:提醒(?:我)?)?|不要提醒(?:我)?|别提醒(?:我)?)(?:了|吧)?[。！!?？\s]*$/u;
const taskText=value=>typeof value==='string'?value.trim().replace(/^[\s,，:：、]+|[\s。！!？?]+$/gu,''):'';
const later=due=>Number.isFinite(due);
const eligibleTask=task=>!!task&&[...task].length<=180&&!/[\u0000-\u001f\u007f]/u.test(task);
const displayTime=row=>row.wall.replace('T',' ')+'（'+row.time_zone+'）';

function parseRequest(text,zone,now){
  const reminder=reminderFirst.exec(text);
  if(reminder){
    const remainder=text.slice(reminder[0].length).trim();
    // A capability question alone is an ordinary conversation.
    if(!remainder||/^(?:吗|么|可以吗)[？?。]*$/u.test(remainder))return null;
    const timing=readTime(remainder,zone,now);
    return {...timing,task:taskText(timing.rest),withdrawn:cancelledRequest.test(text)};
  }
  const agreement=/^(?:我们|咱们)约好[\s：:,，]*/u.exec(text);
  const timed=agreement?text.slice(agreement[0].length):
    text.replace(/^(?:请你?|能不能(?:帮我)?|可以(?:帮我)?|麻烦你?)[\s：:,，]*/u,'');
  const prefix=timeFirst.exec(timed);
  if(!prefix){
    if(!agreement)return null;
    const timing=readTime(timed,zone,now);
    if(!timing.matched)return null;
    const task=taskText(timing.rest.replace(/[，,。]\s*到(?:时|时候)(?:请)?来找我[。！!]*$/u,''));
    return {...timing,task,withdrawn:cancelledRequest.test(text)};
  }
  const timing=readTime(prefix[1],zone,now);
  // With a time-first request, reject prose before the reminder verb.
  if(!timing.matched||timing.rest)return null;
  return {...timing,task:taskText(timed.slice(prefix[0].length)),withdrawn:cancelledRequest.test(text)};
}

function createAiAppointments(store,now=Date.now){
  let timer;
  const validTarget=(human,chat)=>store.one(`SELECT 1 FROM chats c
    JOIN members a ON a.chat=c.id AND a.account=?
    JOIN members b ON b.chat=c.id AND b.account=?
    JOIN users u ON u.number=b.account AND u.kind='ai'
    WHERE c.id=? AND c.type='direct' AND c.first_user=min(a.account,b.account) AND c.second_user=max(a.account,b.account)`,
  human,AI_NUMBER,chat)&&(store.directAiConsent(human,chat)||store.connectedAi(human,chat)===AI_NUMBER);

  function own(human,chat){
    if(!validTarget(human,chat))fail(404,'appointments_unavailable','没有找到这段角色私聊');
  }
  function localReply(chat,nonce,text){
    const reply=store.send(AI_NUMBER,chat,{clientId:nonce,text});
    store.run('INSERT OR IGNORE INTO ai_appointment_messages(message) VALUES(?)',reply.id);
    return reply;
  }
  function replyFor(prompt){
    const reply=store.one(`SELECT m.* FROM ai_appointment_messages own
      JOIN messages m ON m.id=own.reply WHERE own.message=?`,prompt);
    return reply?store.message(reply):null;
  }
  function recordReply(message,text){
    const reply=localReply(message.conversationId,'appointment-reply-'+message.id,text);
    store.run('INSERT INTO ai_appointment_messages(message,reply) VALUES(?,?)',message.id,reply.id);
  }
  function stage(human,message,zoneInput){
    const chat=message.conversationId, text=message.text.trim();
    const zone=timeZone(zoneInput);
    const request=parseRequest(text,zone,now());
    const stops=/^(?:取消提醒|取消约定|不用提醒了|别提醒了)[。！!]*$/u.test(text);
    const draft=store.one('SELECT * FROM ai_appointment_drafts WHERE chat=? AND human=? AND until>?',chat,human,now());
    if(!request&&!draft&&!stops)return false;
    if(!validTarget(human,chat))return false;
    if(stops){
      store.run('DELETE FROM ai_appointment_drafts WHERE chat=?',chat);
      recordReply(message,countPending(chat)?'打开「约定提醒」，可以选中那件事并取消。':'好，目前没有待提醒的约定。');
      return true;
    }
    if(request?.withdrawn){
      store.run('DELETE FROM ai_appointment_drafts WHERE chat=?',chat);
      recordReply(message,'好，这次先不安排新提醒。');
      return true;
    }
    const draftZone=draft?.time_zone||zone;
    const clarification=!request&&readTime(text.replace(/[。！!？?]+$/u,''),draftZone,now(),draft.day);
    if(!request&&(!clarification||clarification.rest||!clarification.matched))return false;
    const chosen=request||{...clarification,task:draft.task};
    const chosenZone=request?zone:draftZone;
    const {task,day,wall,due}=chosen;
    let answer;
    if(!eligibleTask(task)){
      store.run('DELETE FROM ai_appointment_drafts WHERE chat=?',chat);
      answer=task?'请把要提醒的一件事缩短到 180 字以内。':'到时候要我提醒你什么？请把时间和事项一起告诉我。';
    }else if(!later(due)||due<=now()||due>now()+366*DAY_MS){
      const detail=!chosenZone?'我还不知道你的时区。打开「约定提醒」，按本地时间选择日期和时刻。':
        '你想哪天几点提醒？可以说“明天下午 3 点”。';
      answer=later(due)&&due<=now()?'这个时间已经过了。你想改到哪天几点？':detail;
      store.run(`INSERT INTO ai_appointment_drafts(chat,human,task,day,time_zone,until) VALUES(?,?,?,?,?,?)
        ON CONFLICT(chat) DO UPDATE SET task=excluded.task,day=excluded.day,time_zone=excluded.time_zone,until=excluded.until`,
      chat,human,task,day??null,chosenZone,now()+DAY_MS);
    }else if(countPending(chat)>=PENDING_LIMIT){
      answer='这段聊天已有 12 条待提醒。可以先在「约定提醒」取消一条。';
    }else{
      const row=insert(human,chat,task,wall,chosenZone,due);
      answer='记好了，'+displayTime(row)+'提醒你：'+task+'。';
    }
    recordReply(message,answer);
    return true;
  }
  function countPending(chat){
    return store.one("SELECT count(*) AS n FROM ai_appointments WHERE chat=? AND state='pending'",chat).n;
  }
  function insert(human,chat,task,wall,zone,due,id=randomUUID()){
    const result=store.run(`INSERT INTO ai_appointments (id,chat,human,task,wall,time_zone,due,updated)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,id,chat,human,task,wall,zone,due,now());
    if(!result.changes)fail(409,'appointment_id','此约定编号已使用，请重新打开');
    store.run('DELETE FROM ai_appointment_drafts WHERE chat=?',chat);
    return find(human,chat,id);
  }
  const find=(human,chat,id)=>store.one('SELECT * FROM ai_appointments WHERE id=? AND chat=? AND human=?',id,chat,human);
  const viewRow=row=>({id:row.id,task:row.task,wall:row.wall,timeZone:row.time_zone,dueAt:row.due,
    state:row.state,revision:row.revision});
  function view(human,chat){
    own(human,chat);
    const rows=store.all(`SELECT * FROM ai_appointments WHERE chat=? AND human=?
      ORDER BY state!='pending',CASE WHEN state='pending' THEN due ELSE -updated END LIMIT 24`,chat,human);
    return {appointments:rows.map(viewRow)};
  }
  function parseFields(body){
    const zone=timeZone(body.timeZone), wall=typeof body.wall==='string'?body.wall:'';
    const due=exactTime(wall,zone);
    if(!later(due))fail(400,'appointment_clock','请填写有效的本地日期和时刻。若遇到夏令时切换，请改选一个明确的时间。');
    if(due<=now()||due>now()+366*DAY_MS)fail(400,'appointment_future','请选择未来一年内的时间');
    return {zone,wall,due};
  }
  function save(human,chat,body){
    own(human,chat);
    if(body.expectedAccount!==human)fail(409,'appointment_session','账号已切换，请重新打开这段私聊');
    if(typeof body.id!=='string'||!/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/u.test(body.id))
      fail(400,'appointment_id','约定编号有误');
    const row=find(human,chat,body.id);
    if(body.action==='create'){
      if(row)return {appointment:viewRow(row)};
      const task=taskText(body.task);
      if(!eligibleTask(task))fail(400,'appointment_task','请填写一件 180 字以内的事项');
      if(countPending(chat)>=PENDING_LIMIT)fail(409,'appointment_limit','这段聊天已有 12 条待提醒');
      const {zone,wall,due}=parseFields(body);
      const created=insert(human,chat,task,wall,zone,due,body.id);
      localReply(chat,'appointment-created-'+created.id,'记好了，'+displayTime(created)+'提醒你：'+task+'。');
      return {appointment:viewRow(created)};
    }
    if(!row)fail(404,'appointment_missing','没有找到这条约定');
    if(body.action==='cancel'&&row.state==='cancelled')return {appointment:viewRow(row)};
    if(row.state!=='pending'||row.due<=now()||row.revision!==body.revision)
      fail(409,'appointment_changed','这条约定已经到期或有变化，请重新打开');
    const revision=row.revision+1;
    if(body.action==='cancel'){
      store.run("UPDATE ai_appointments SET state='cancelled',revision=?,updated=? WHERE id=?",revision,now(),row.id);
      localReply(chat,'appointment-cancelled-'+row.id,'已取消提醒：'+row.task+'。');
    }else if(body.action==='move'){
      const {zone,wall,due}=parseFields(body);
      store.run('UPDATE ai_appointments SET wall=?,time_zone=?,due=?,revision=?,updated=? WHERE id=?',wall,zone,due,revision,now(),row.id);
      localReply(chat,'appointment-moved-'+row.id+'-'+revision,'给你改到 '+displayTime({wall,time_zone:zone})+'：'+row.task+'。');
    }else fail(400,'appointment_action','无法识别这个约定操作');
    return {appointment:viewRow(find(human,chat,row.id))};
  }

  function tick(){
    try{
      const time=now();
      if(!store.one("SELECT 1 FROM ai_appointments WHERE state='pending' AND due<=?",time)&&
         !store.one('SELECT 1 FROM ai_appointment_drafts WHERE until<=?',time))return;
      store.transaction(()=>{
        store.run('DELETE FROM ai_appointment_drafts WHERE until<=?',time);
        const rows=store.all("SELECT * FROM ai_appointments WHERE state='pending' AND due<=? ORDER BY due LIMIT 32",time);
        for(const row of rows){
          let state='cancelled';
          if(validTarget(row.human,row.chat)){
            const late=time-row.due;
            state=late>LATE_MS?'missed':'sent';
            if(state==='sent'){
              const opening=late>=60_000?'补上 '+displayTime(row)+' 的约定，提醒你：':'到我们约好的时间啦，提醒你：';
              localReply(row.chat,'appointment-due-'+row.id,opening+row.task+'。');
            }
          }
          store.run('UPDATE ai_appointments SET state=?,revision=revision+1,updated=? WHERE id=?',state,time,row.id);
        }
      });
    }catch(error){console.error('Social appointment check failed',error.code||error.name);}
  }
  function start(){
    if(timer)return;
    timer=setInterval(tick,1000);
    timer.unref();
    tick();
  }
  function stop(){clearInterval(timer);timer=undefined;}

  return {stage,replyFor,view,save,start,stop};
}

module.exports={createAiAppointments};
