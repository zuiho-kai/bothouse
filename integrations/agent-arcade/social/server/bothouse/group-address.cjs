'use strict';

// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 zuiho-kai and bothouse contributors.
// Adapted from bothouse bridge/core/name_call.go at 8ec73a8f32573b5307922df3c79675a934cdefb7,
// blob 9f428fb963ce50b674250a771b60f462da593905. See THIRD_PARTY_NOTICES.md.
const callWords=['你','帮','来','看','快','给','过来','出来','有空','能帮','能不能','可以帮','可不可以','能否','可否',
  '请','麻烦','拜托','can you','could you','would you','will you','please'];
const conjunction=/^(?:以及|还有|和|跟|与|及|and\b|[&＆])[ \t]*/iu;

function callFollows(rest,separator){
  return !rest||/[ \t，,、]/u.test(separator)||':：!！?？~～.。'.includes(rest[0])||
    callWords.some(word=>rest.toLowerCase().startsWith(word));
}

// Use the same longest-name and boundary rule as NameCalled, with a target set
// because a Friends group may contain colliding display names. Only inspect the
// opening of the message, so pasted dialogue further down cannot address an AI.
function openingCall(text,members){
  const aliases=new Map();
  for(const {name,number,kind} of members){
    const short=kind==='ai'?name.replace(/^[\x00-\x7e]+/u,''):'';
    for(const alias of new Set([name,short].filter(Boolean))){
      if(!aliases.has(alias))aliases.set(alias,[]);
      aliases.get(alias).push(number);
    }
  }
  const names=[...aliases.keys()].sort((left,right)=>right.length-left.length);
  const targets=new Set();
  let rest=text.trimStart(),separator='';
  for(let name=names.find(alias=>rest.startsWith(alias));name;name=names.find(alias=>rest.startsWith(alias))){
    for(const target of aliases.get(name))targets.add(target);
    const after=rest.slice(name.length);
    const spaced=after.replace(/^[ \t，,、/]+/u,'');
    const joined=spaced.replace(conjunction,'');
    // A conjunction only joins another current member at the opening.
    // It never skips words like "你觉得" to find a name later in the question.
    rest=joined!==spaced&&names.some(alias=>joined.startsWith(alias))?joined:spaced;
    separator=after.slice(0,after.length-rest.length);
  }
  if(!targets.size||!callFollows(rest,separator))return null;
  return {targets,text:rest.replace(/^[:：!！?？~～.。\s]+/u,'')};
}

module.exports={openingCall};
