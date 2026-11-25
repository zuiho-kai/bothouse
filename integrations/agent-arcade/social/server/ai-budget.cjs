'use strict';

const GLOBAL_DAILY_LIMIT=100;
const CHAT_DAILY_LIMIT=12;
const GLOBAL_CONCURRENCY=4;

// The current transaction owns reservation across the AI routes.
function aiBudget(store,chat,started){
  const pending=store.all(`SELECT chat FROM ai_direct_turns WHERE state='pending'
    UNION ALL SELECT chat FROM ai_group_turns WHERE state='pending'
    UNION ALL SELECT chat FROM ai_image_turns WHERE state='pending'
    UNION ALL SELECT NULL AS chat FROM ai_feed_turns WHERE state='pending'
    UNION ALL SELECT chat FROM ai_proactive_turns WHERE state='pending' LIMIT ?`,GLOBAL_CONCURRENCY);
  if(pending.length>=GLOBAL_CONCURRENCY||chat!==undefined&&pending.some(row=>row.chat===chat))return 'busy';
  const day=new Date(started).setUTCHours(0,0,0,0);
  const counts=store.one(`SELECT count(*) AS total,sum(chat=?) AS mine FROM (
    SELECT chat FROM ai_direct_turns WHERE started>=?
    UNION ALL SELECT chat FROM ai_group_turns WHERE started>=?
    UNION ALL SELECT chat FROM ai_image_turns WHERE started>=?
    UNION ALL SELECT NULL AS chat FROM ai_feed_turns WHERE started>=?

    UNION ALL SELECT chat FROM ai_proactive_turns WHERE started>=?
  )`,chat??null,day,day,day,day,day);
  return counts.total>=GLOBAL_DAILY_LIMIT||counts.mine>=CHAT_DAILY_LIMIT?'daily_limit':null;
}
module.exports={aiBudget,GLOBAL_CONCURRENCY};
