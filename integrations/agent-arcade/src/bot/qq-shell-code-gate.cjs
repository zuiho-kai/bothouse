'use strict';

// Main-only serialization for the one fixed Shell code path shared by managed
// installations. A capability proves this lock, never permission to bypass a
// pending repair or integrity check. No child process or account is controlled.
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {withRecoveryGate}=require('./qq-component-lock-recovery.cjs');
const VERSION_ID='napcat-shell-4.18.42-02e5ff0f79916c1e';
const capabilities=new WeakMap();
const canonical=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
class QQShellCodeGateError extends Error{
  constructor(code){super(`Managed Shell code access failed (${code}).`);this.code=code;}
}
const fail=code=>{throw new QQShellCodeGateError(code);};
function localRoot(root){
  if(typeof root!=='string'||!path.isAbsolute(root)||/^[/\\]{2}/.test(root)||/[\p{Cc}\p{Cf}]/u.test(root)||root.length>4096)fail('invalid_request');
  return path.resolve(root);
}
function shellCodeRoot(root){return path.join(localRoot(root),'qq-component-versions','napcat-shell',VERSION_ID,'code');}
const identity=st=>({dev:String(st.dev),ino:String(st.ino),birthtimeNs:String(st.birthtimeNs)});
const sameIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs;
function parents(root){
  const target=path.dirname(shellCodeRoot(root)),base=path.parse(target).root;
  let cursor=base;const rows=[];
  for(const part of ['',...target.slice(base.length).split(path.sep).filter(Boolean)]){
    if(part)cursor=path.join(cursor,part);let st;
    try{st=fs.lstatSync(cursor,{bigint:true});}catch(error){if(error.code==='ENOENT')break;fail('shell_repair_unavailable');}
    if(!st.isDirectory()||st.isSymbolicLink())fail('shell_repair_unavailable');
    let actual;try{actual=fs.realpathSync.native(cursor);}catch{fail('shell_repair_unavailable');}
    if(canonical(actual)!==canonical(cursor))fail('shell_repair_unavailable');
    rows.push({path:cursor,...identity(st)});
  }
  if(!rows.length)fail('shell_repair_unavailable');return rows;
}
function checkSignal(signal){if(signal?.aborted)fail('cancelled');}
function sanitized(error,result,returned){
  const mapped={recovery_in_progress:'shell_repair_busy',recovery_gate_unsupported:'shell_repair_unavailable',recovery_gate_unavailable:'shell_repair_unavailable',recovery_gate_lost:'shell_repair_changed',recovery_gate_close_failed:'shell_repair_cleanup_unconfirmed'};
  // An operation's own fixed error/result belongs to its caller. Only errors
  // from the shared OS gate are translated; raw filesystem errors never escape
  // the parent proof functions above.
  const out=mapped[error?.code]?new QQShellCodeGateError(mapped[error.code]):error;
  if(error?.committed===true)out.committed=true;
  if(returned){out.result=result;if(result?.committed===true)out.committed=true;}
  return out;
}
async function withShellCodeGate({root,signal,gate}={},operation){
  if(typeof operation!=='function'||signal!==undefined&&(!signal||typeof signal.aborted!=='boolean'))fail('invalid_request');
  const codeRoot=canonical(shellCodeRoot(root));checkSignal(signal);
  if(gate!==undefined){
    const held=typeof gate==='function'&&capabilities.get(gate);
    if(!held||!held.active||held.codeRoot!==codeRoot)fail('shell_repair_changed');
    const state={active:true,codeRoot};
    const nested=()=>{if(!state.active)fail('shell_repair_changed');gate();checkSignal(signal);};
    capabilities.set(nested,state);
    try{nested();return await operation(nested);}finally{state.active=false;}
  }
  const captured=parents(root),key=createHash('sha256').update(JSON.stringify(['qq-shell-code-v1',codeRoot])).digest('hex');
  let result,returned=false;
  try{return await withRecoveryGate(key,async assertOS=>{
    const state={active:true,codeRoot};
    const assertGate=()=>{
      if(!state.active)fail('shell_repair_changed');assertOS();checkSignal(signal);
      const observed=new Map(parents(root).map(row=>[canonical(row.path),row]));
      for(const before of captured){const after=observed.get(canonical(before.path));if(!after||!sameIdentity(before,after))fail('shell_repair_changed');}
    };
    capabilities.set(assertGate,state);
    try{assertGate();result=await operation(assertGate);returned=true;return result;}
    finally{state.active=false;}
  });}catch(error){throw sanitized(error,result,returned);}
}
module.exports={withShellCodeGate,shellCodeRoot,QQShellCodeGateError};
