'use strict';

const {isDeepStrictEqual}=require('node:util');
const {settings:groupSettings,MAX_GROUPS}=require('./group-companion-route.cjs');
const qqNumber=value=>typeof value==='string'&&/^[1-9]\d{4,14}$/.test(value);

// RC21 can edit the ordinary group list and QQ number without touching this
// newer binding. Persist the intersection the first time such an edit is seen.
function normalizeLocalGateBinding(config){
  const hasLegacy=Object.hasOwn(config,'qqLocalGateAccount');
  if(!hasLegacy&&!Object.hasOwn(config,'qqLocalGateGroups'))return config;
  const {qqAccountId,qqLocalGateGroups:binding}=config;
  let groups=[];
  try{groups=groupSettings(config.qqGroups).groupIds;}catch{/* A damaged allowlist grants no local decisions. */}
  let normalized;
  if(qqNumber(qqAccountId)&&groups.every(qqNumber)){
    if(binding===undefined&&config.qqLocalGateAccount===qqAccountId){
      normalized={accountId:qqAccountId,groupIds:groups};
    }else if(binding?.accountId===qqAccountId&&Array.isArray(binding.groupIds)){
      const ids=binding.groupIds;
      if(ids.length<=MAX_GROUPS&&new Set(ids).size===ids.length&&ids.every(qqNumber)){
        normalized={accountId:qqAccountId,groupIds:ids.filter(id=>groups.includes(id))};
      }
    }
  }
  if(!normalized?.groupIds.length)normalized=undefined;
  if(!hasLegacy&&isDeepStrictEqual(binding,normalized))return config;
  const next={...config};
  delete next.qqLocalGateAccount;
  if(normalized)next.qqLocalGateGroups=normalized;
  else delete next.qqLocalGateGroups;
  return next;
}

module.exports={normalizeLocalGateBinding};
