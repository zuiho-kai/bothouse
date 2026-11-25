'use strict';

const TIME_PATTERN=String.raw`\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)`;
const timePattern=new RegExp('^'+TIME_PATTERN+'$');

function fixedOffset(localTime){
  return localTime.endsWith('Z')?'Z':localTime.slice(-6);
}

function offsetMilliseconds(offset){
  if(offset==='Z')return 0;
  const minutes=Number(offset.slice(1,3))*60+Number(offset.slice(4));
  return (offset[0]==='-'?-1:1)*minutes*60000;
}

function dueFromLocalTime(localTime){
  if(typeof localTime!=='string'||timePattern.exec(localTime)?.[0]!==localTime)return NaN;
  const dueAt=Date.parse(localTime);
  if(!Number.isFinite(dueAt))return NaN;
  const offset=fixedOffset(localTime);
  const clock=localTime.slice(0,-offset.length);
  // Date.parse can normalize an absent calendar date. Round-trip the clock
  // using only the given fixed offset, without the host time zone or DST.
  const restored=new Date(dueAt+offsetMilliseconds(offset)).toISOString().slice(0,clock.length);
  return restored===clock?dueAt:NaN;
}

function formatFollowupTime(dueAt,previousLocalTime){
  const offset=typeof previousLocalTime==='string'&&timePattern.test(previousLocalTime)?fixedOffset(previousLocalTime):'Z';
  return new Date(dueAt+offsetMilliseconds(offset)).toISOString().replace(/(?:\.000)?Z$/u,offset);
}

function followupModelTime({dueAt,localTime,timeZone}){
  return {dueAt,...(localTime?{localTime}:{timeZone})};
}

module.exports={TIME_PATTERN,dueFromLocalTime,formatFollowupTime,followupModelTime};
