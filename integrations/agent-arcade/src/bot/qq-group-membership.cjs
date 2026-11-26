'use strict';

// The legacy qqGroups schema holds the saved list and account-wide policy.
// Per-group exceptions are scoped to the verified QQ account beside it.
function membership(config,groups){
  const saved=config.qqGroupMembership;
  const own=saved&&saved.accountId===config.qqAccountId?saved.pausedGroupIds:[];
  const paused=groups.enabled&&Array.isArray(own)?groups.groupIds.filter(id=>own.includes(id)):[...groups.groupIds];
  const active=groups.groupIds.filter(id=>!paused.includes(id));
  const permissions={enabled:active.length>0,groupIds:active,proactive:groups.proactive};
  for(const field of ['imageGroupIds','voiceGroupIds','localGateGroupIds']){
    if(groups[field])permissions[field]=groups[field].filter(id=>active.includes(id));
  }
  return {paused,permissions,proactiveGroupIds:groups.proactive?[...active]:[]};
}

function saveExceptions(config,paused){
  if(paused.length){
    config.qqGroupMembership={accountId:config.qqAccountId,pausedGroupIds:paused};
  }else delete config.qqGroupMembership;
}

module.exports={membership,saveExceptions};
