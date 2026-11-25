'use strict';

const {dueFromLocalTime}=require('../../src/bot/followup-time.cjs');
const DAY_MS=86_400_000;
const digits='零一二三四五六七八九';
const periodName='凌晨|早上|上午|中午|下午|傍晚|晚上|晚间|晚';
const numeral='[0-9０-９零一二两三四五六七八九十]{1,3}';
const clock=String.raw`(?:(?<period>${periodName})\s*)?(?<hour>${numeral})\s*(?:(?<colon>[:：])\s*(?<digitalMinute>[0-9０-９]{2})|(?:点|时)\s*(?<minute>半|一刻|三刻|${numeral}(?:分钟?|$))?)`;
const periodOnly=new RegExp('^(?:'+periodName+')(?:\\s+|$|(?=[^0-9０-９零一二两三四五六七八九十]))','u');
const calendar=String.raw`(?<date>\d{4}[-/]\d{1,2}[-/]\d{1,2}|今天|今晚|今早|明天|明晚|明早|后天|(?:下)?(?:周|星期)[一二三四五六日天])`;
const timePrefix=new RegExp(String.raw`^(?:${calendar}(?:\s*(?:T|[，,])?\s*)?)?(?:${clock})?`,'u');
const structured=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u;
const pad=value=>String(value).padStart(2,'0');

function timeZone(value){
  if(typeof value!=='string'||value.length>80||!/^[A-Za-z][A-Za-z0-9_+\-/]*$/u.test(value))return null;
  try{return new Intl.DateTimeFormat('en-CA',{timeZone:value}).resolvedOptions().timeZone;}
  catch{return null;}
}

function localClock(zone){
  const format=new Intl.DateTimeFormat('en-CA',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'2-digit',
    day:'2-digit',hour:'2-digit',minute:'2-digit'});
  return instant=>{
    const parts=Object.fromEntries(format.formatToParts(instant).map(({type,value})=>[type,value]));
    return parts.year+'-'+parts.month+'-'+parts.day+'T'+parts.hour+':'+parts.minute;
  };
}

function exactTime(wall,zone){
  if(!structured.test(wall)||!zone)return NaN;
  const approximate=dueFromLocalTime(wall+'Z');
  if(!Number.isFinite(approximate))return NaN;
  const at=localClock(zone);
  const candidates=new Set();
  // Observe the offsets on both sides of a transition. Only a unique
  // round-trip is safe to schedule, including at a DST overlap or gap.
  for(const delta of [-DAY_MS,0,DAY_MS]){
    const sample=approximate+delta;
    const wallSample=dueFromLocalTime(at(sample)+'Z');
    if(!Number.isFinite(wallSample))continue;
    const due=approximate+sample-wallSample;
    if(at(due)===wall)candidates.add(due);
  }
  return candidates.size===1?[...candidates][0]:NaN;
}

function chineseInt(word){
  word=word.normalize('NFKC');
  if(/^\d+$/u.test(word))return Number(word);
  if(word==='两')return 2;
  if(word.length===1&&word!=='十')return digits.indexOf(word);
  const parts=word.split('十');
  if(parts.length!==2||parts.some(part=>part.length>1||part&&!digits.includes(part)))return -1;
  return (parts[0]?digits.indexOf(parts[0]):1)*10+(parts[1]?digits.indexOf(parts[1]):0);
}

function dayFor(token,zone,now){
  if(!token||!zone)return null;
  if(/^\d/u.test(token)){
    const [year,month,day]=token.split(/[-/]/u);
    return year+'-'+pad(month)+'-'+pad(day);
  }
  const today=dueFromLocalTime(localClock(zone)(now).slice(0,10)+'T00:00Z');
  const delta={今天:0,今晚:0,今早:0,明天:1,明晚:1,明早:1,后天:2}[token];
  if(delta!==undefined)return new Date(today+delta*DAY_MS).toISOString().slice(0,10);
  const weekday='日一二三四五六'.indexOf(token.at(-1).replace('天','日'));
  const todayMondayIndex=(new Date(today).getUTCDay()+6)%7;
  const offset=(weekday+6)%7-todayMondayIndex;
  return new Date(today+(token.startsWith('下')?offset+7:offset<0?offset+7:offset)*DAY_MS).toISOString().slice(0,10);
}

function readTime(text,zone,now,priorDay){
  const source=text.trimStart(), match=timePrefix.exec(source);
  const {date,period,hour,colon,digitalMinute,minute}=match.groups;
  const day=date?dayFor(date,zone,now):priorDay??null;
  const rest=source.slice(match[0].length).replace(/^[\s,，:：、]+/u,'');
  const matched=Boolean(date||hour);
  if(!hour||!day)return {day,matched,rest:date&&!hour?rest.replace(periodOnly,'').trimStart():rest};
  const suffix=(minute||'').replace(/分钟?$/u,'');
  const min=colon?Number(digitalMinute.normalize('NFKC')):suffix==='半'?30:suffix==='一刻'?15:suffix==='三刻'?45:suffix?chineseInt(suffix):0;
  let hours=chineseInt(hour);
  const nightDate=date?.endsWith('晚');
  const part=period||(nightDate?'晚上':date?.endsWith('早')?'早上':null);
  const nighttime=/^(?:晚上|晚间|晚)$/u.test(part);
  if(hours<0||hours>23||min<0||min>59||(!colon&&!part&&hours>=1&&hours<=12))return {day,matched,rest};
  if((nightDate&&period&&!nighttime&&period!=='傍晚')||(part==='傍晚'&&hours===12))return {day,matched,rest};
  let wallDay=day;
  if(nighttime&&(hours===0||hours===12)){
    // Advance the civil date before resolving it in the user's zone.
    const midnight=dueFromLocalTime(day+'T00:00Z');
    if(!Number.isFinite(midnight))return {day,matched,rest};
    wallDay=new Date(midnight+DAY_MS).toISOString().slice(0,10);
    hours=0;
  }else if(part){
    if(hours<1||hours>12)return {day,matched,rest};
    if(/^(?:下午|傍晚|晚上|晚间|晚|中午)$/u.test(part)&&hours<12)hours+=12;
    if(/^(?:凌晨|早上|上午)$/u.test(part)&&hours===12)hours=0;
  }
  const wall=wallDay+'T'+pad(hours)+':'+pad(min);
  return {day,matched,wall,due:exactTime(wall,zone),rest};
}

module.exports={DAY_MS,timeZone,exactTime,readTime};
