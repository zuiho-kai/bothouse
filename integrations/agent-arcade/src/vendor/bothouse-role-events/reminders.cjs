'use strict';
// Apache-2.0. Copyright (c) 2026 zuiho-kai and bothouse contributors.
// Extracted from bothouse 8ec73a8f32573b5307922df3c79675a934cdefb7.
// Modified for CommonJS and Agent Arcade's local reminder scope. See PROVENANCE.md.
const {join}=require('node:path');
const STATUSES=['idle','working','thinking','celebrate','error','speech'];

function fileFor(dir, ev) {
  const day = String(ev.time || new Date().toISOString()).slice(0, 10);
  return join(dir, `journal-${day}.jsonl`);
}
function recordFor(ev) {
  const { role, ...rest } = ev;
  return { ...rest, name: role?.display_name || role?.name };
}
function roleLabel(ev) {
  const r = ev.role || {};
  return r.display_name || r.name || ev.role_key;
}
function statusFilter(list) {
  const want = Array.isArray(list) ? list.filter((s) => STATUSES.includes(s)) : [];
  return want.length ? new Set(want) : new Set(STATUSES);
}
const want=statusFilter(['speech']);
function settledReminder(ev,scope) {
  if (!ev || !want.has(ev.type) || ev.type === 'speech' && ev.draft) return false;
  return typeof scope==='string' && !!scope && ev.session_key===scope;
}
function journalFor({day,scope,rows,roleFor}) {
  if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Invalid UTC date.');
  const start=Date.parse(day+'T00:00:00Z');
  if(!Number.isFinite(start)||new Date(start).toISOString().slice(0,10)!==day)throw Error('Invalid UTC date.');
  const records=[];
  for(const row of rows){
    if(row.role!=='assistant'||!row.id.startsWith('local-out:notice:')||row.at<start||row.at>=start+86400000)continue;
    const role=roleFor(row);if(!role)continue;
    const event={type:'speech',role_key:role.key,session_key:scope,message_id:row.id,time:new Date(row.at).toISOString(),text:row.text,
      role:{display_name:row.speakerName,name:role.name}};
    if(!settledReminder(event,scope))continue;
    event.role.display_name=roleLabel(event);
    records.push(recordFor(event));
  }
  return {filename:fileFor('',{time:day}),records};
}
module.exports={journalFor,settledReminder};
