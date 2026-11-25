'use strict';
// macOS has no pidfd. Keep evidence only for the ChildProcess just spawned,
// recheck the detached group at each signal, and never stop by process name.
const fs=require('node:fs'),path=require('node:path');
const {ChildProcess,execFile}=require('node:child_process');
const {terminateProcessGroup}=require('../core/posix-process.cjs');
const MAX_ROWS=16384,MAX_GROUP=32,PS_LIMIT=2*1024*1024;
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PREFIX=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([A-Z?][A-Za-z0-9+<>-]*)\s*/;
const STAMP=/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d\d):(\d\d):(\d\d)\s+(\d{4})\s+(.+)$/;
const failure=()=>Object.assign(Error('The owned speech process exit could not be confirmed.'),{code:'asr_exit_unconfirmed'});
const integer=value=>Number.isSafeInteger(value)&&value>=0&&value<=0xffffffff;
const validPid=value=>integer(value)&&value>1&&value<=0x7fffffff;
const live=value=>value&&!value.state.startsWith('Z');
const unknownState=value=>value.state.startsWith('?');
const exited=child=>child.exitCode!=null||child.signalCode!=null;

function local(value){
 if(typeof value!=='string'||value.length>1500||!path.isAbsolute(value)||value.startsWith('//')||/[\p{Cc}\p{Cf}]/u.test(value)||value.trim()!==value)throw failure();
 return path.resolve(value);
}
function executable(file){
 const full=fs.realpathSync.native(local(file)),stat=fs.statSync(full,{bigint:true});
 if(!stat.isFile()||!(stat.mode&0o111n))throw failure();
 return {file:full,id:[stat.dev,stat.ino,stat.size,stat.ctimeNs].join(':')};
}
function configuredExecutables(pythonPath){
 const python=executable(pythonPath),at=path.dirname(path.dirname(python.file)),versions=path.dirname(at);
 const result=[python];
 // macOS framework Python's bin launcher execs this sibling bundle binary.
 // The exact framework version and resolved installation must both match.
 if(path.basename(path.dirname(python.file))==='bin'&&/^python(?:\d+(?:\.\d+)*)?$/.test(path.basename(python.file))&&
    path.basename(versions)==='Versions'&&path.basename(path.dirname(versions))==='Python.framework'&&/^\d+\.\d+$/.test(path.basename(at))){
  const framework=path.join(at,'Resources','Python.app','Contents','MacOS','Python');
  try{const identity=executable(framework);if(identity.file===framework)result.push(identity);}
  catch(error){if(error?.code!=='ENOENT')throw error;}
 }
 return result;
}
function coordinates(value){
 if(!value||![value.pid,value.parentPid,value.groupId,value.uid].every(integer)||
    typeof value.state!=='string'||!/^[A-Z?][A-Za-z0-9+<>-]*$/.test(value.state))throw failure();
 return value;
}
const matchingCoords=(a,b)=>a.pid===b.pid&&a.parentPid===b.parentPid&&a.groupId===b.groupId&&a.uid===b.uid;
const sameBirth=(a,b)=>a.pid===b.pid&&a.groupId===b.groupId&&a.uid===b.uid&&a.createdAt===b.createdAt;
const sameInstance=(a,b)=>sameBirth(a,b)&&a.executable===b.executable;

function parseRows(output,details=false){
 if(typeof output!=='string'||Buffer.byteLength(output)>PS_LIMIT)throw failure();
 const lines=output.trimEnd().split('\n');if(lines.length===1&&!lines[0])return [];
 if(lines.length>MAX_ROWS)throw failure();
 return lines.map(line=>{
  const prefix=PREFIX.exec(line);if(!prefix)throw failure();
  const row=coordinates({pid:Number(prefix[1]),parentPid:Number(prefix[2]),groupId:Number(prefix[3]),uid:Number(prefix[4]),state:prefix[5]});
  const extra=line.slice(prefix[0].length);
  if(!details){if(extra)throw failure();return row;}
  const stamp=STAMP.exec(extra);if(!stamp)throw failure();
  const [,month,day,hour,minute,second,year,file]=stamp,mon=MONTHS.indexOf(month);
  if(mon<0||+year<1970||+day<1||+day>31||+hour>23||+minute>59||+second>59)throw failure();
  const createdAt=Date.UTC(+year,mon,+day,+hour,+minute,+second);
  if(new Date(createdAt).getUTCMonth()!==mon)throw failure();
  return {...row,createdAt,executable:local(file)};
 });
}

function createPosixPythonProcessHost({run=execFile,kill=process.kill.bind(process)}={}){
 const invoke=(args,details)=>new Promise((resolve,reject)=>{
  run('/bin/ps',args,{encoding:'utf8',timeout:2000,maxBuffer:PS_LIMIT,env:{LC_ALL:'C',TZ:'UTC'}},(error,out,stderr)=>{
   try{
    if(stderr||error&&!(details&&error.code===1&&!out))throw failure();
    resolve(parseRows(out,details));
   }catch{reject(failure());}
  });
 });
 const columns='pid=,ppid=,pgid=,uid=,stat=';
 return {
  snapshot:()=>invoke(['-A','-w','-w','-o',columns],false),
  inspect:pids=>{
   if(!Array.isArray(pids)||pids.length>MAX_GROUP||!pids.every(validPid))throw failure();
   return pids.length?invoke(['-w','-w','-p',pids.join(','),'-o',columns+',lstart=,comm='],true):Promise.resolve([]);
  },
  kill,
 };
}

class PosixPythonProcessProof{
 #configured;#executables;#host;#parent;#uid;#now;#child=null;#pid;#startedAt;#initial=null;#known=new Map();
 #proving=false;#ready=false;#closed=false;#closing=null;
 constructor({pythonPath,parentPid=process.pid,processHost,now=Date.now,uid=process.getuid?.()}={}){
  if(!validPid(parentPid)||!integer(uid)||typeof now!=='function'||(!processHost&&(process.platform!=='darwin'||uid!==process.geteuid())))throw failure();
  try{this.#configured=local(pythonPath);this.#executables=configuredExecutables(this.#configured);}catch{throw failure();}
  this.#host=processHost||createPosixPythonProcessHost();
  if(!['snapshot','inspect','kill'].every(key=>typeof this.#host[key]==='function'))throw failure();
  this.#parent=parentPid;this.#uid=uid;this.#now=now;
 }
 bind({pid,startedAt,child}={}){
  const now=this.#now();
  if(this.#child||this.#closed||this.#closing||!(child instanceof ChildProcess)||!validPid(pid)||pid===this.#parent||pid===process.pid||
     child.pid!==pid||child.spawnfile!==this.#configured||exited(child)||!Number.isSafeInteger(startedAt)||startedAt>now||now-startedAt>10000)throw failure();
  this.#child=child;this.#pid=pid;this.#startedAt=startedAt;
  this.#initial=this.#observe(true);this.#initial.catch(()=>{});
  return {bound:true};
 }
 async #observe(requireLeader=false){
  if(this.#child.pid!==this.#pid)throw failure();
  const pid=this.#pid,rows=await this.#host.snapshot();
  if(!Array.isArray(rows)||rows.length>MAX_ROWS)throw failure();
  const processes=new Map();
  for(const value of rows){const row=coordinates(value);if(processes.has(row.pid))throw failure();processes.set(row.pid,row);}
  const group=rows.filter(row=>row.groupId===pid),members=group.filter(live).sort((a,b)=>a.pid-b.pid);
  // Darwin ps can report "?" and keep the process coordinates. Keep unrelated
  // rows for ancestry checks, while requiring known state in the owned group.
  if(group.length>MAX_GROUP||group.some(row=>row.uid!==this.#uid||unknownState(row)))throw failure();
  for(const known of this.#known.values()){
   const observed=processes.get(known.pid);
   if(live(observed)&&observed.groupId!==pid)throw failure();
  }
  const root=processes.get(pid),leader=live(root)&&root.groupId===pid&&root.parentPid===this.#parent&&!exited(this.#child);
  if(requireLeader&&!leader||live(root)&&root.groupId===pid&&!leader||live(root)&&!exited(this.#child)&&!leader)throw failure();
  const within=row=>{
   let here=row,depth=0;
   while(here&&here.pid!==pid){if(++depth>MAX_GROUP)return false;here=processes.get(here.parentPid);}
   return here?.pid===pid;
  };
  // A child that deliberately leaves its group cannot be covered by a group
  // signal. Refuse to claim successful cleanup while it is still identifiable.
  if(leader&&(rows.some(row=>row.groupId!==pid&&within(row))||members.some(row=>!within(row))))throw failure();
  if(!members.length)return {group,leader:null};
  const observed=await this.#host.inspect(members.map(row=>row.pid));
  if(!Array.isArray(observed)||observed.length!==members.length||new Set(observed.map(value=>value?.pid)).size!==members.length)throw failure();
  let provenLeader=null,retained=false;
  for(const value of observed){
   const row=coordinates(value),expected=members.find(m=>m.pid===row.pid);
   if(!expected||!matchingCoords(row,expected)||!live(row)||unknownState(row)||!Number.isSafeInteger(row.createdAt)||
      row.createdAt<Math.floor(this.#startedAt/1000)*1000||row.createdAt>this.#now()+1000)throw failure();
   local(row.executable);
   const recorded=this.#known.get(row.pid);
   // A framework launcher may exec its pinned sibling before ready while
   // retaining the same kernel group, PID and creation stamp.
   if(recorded&&!sameInstance(row,recorded)&&!(leader&&row.pid===pid&&!this.#ready&&sameBirth(row,recorded)))throw failure();
   if(recorded)retained=true;
   if(leader&&row.pid===pid){
    if(!root.state.includes('s')||!row.state.includes('s'))throw failure();
    const identity=executable(row.executable);
    if(!this.#executables.some(known=>known.file===identity.file&&known.id===identity.id))throw failure();
    provenLeader=row;
   }
  }
  if(leader?!provenLeader:!retained)throw failure();
  // Known descendants can reparent when the original leader closes, but
  // must still match at least one recorded process instance to signal again.
  for(const row of observed)this.#known.set(row.pid,Object.freeze({...row}));
  return {group,leader:provenLeader};
 }
 async proveReady({pid,parentPid}={}){
  if(!this.#child||this.#closed||this.#closing||this.#proving||this.#ready||pid!==this.#pid||parentPid!==this.#parent)throw failure();
  this.#proving=true;
  try{
   const initial=await this.#initial,final=await this.#observe(true);
   if(!sameBirth(initial.leader,final.leader)||this.#closed||this.#closing||exited(this.#child))throw failure();
   this.#ready=true;return {verified:true};
  }catch{throw failure();}finally{this.#proving=false;}
 }
 async #close(){
  if(!this.#child){this.#closed=true;return {closed:true};}
  await this.#initial.catch(()=>{});
  const pid=this.#pid,killImpl=this.#host.kill.bind(this.#host);
  const probe=()=>{
   try{killImpl(-pid,0);return 'present';}
   catch(error){if(error?.code==='ESRCH')return 'absent';if(error?.code==='EPERM')return 'unknown';throw error;}
  };
  const absent=async()=>{
   if(!exited(this.#child)||probe()!=='absent')return false;
   const after=await this.#observe();
   return after.group.length===0&&exited(this.#child)&&probe()==='absent';
  };
  const beforeSignal=async()=>{
   try{
    const {group}=await this.#observe();
    if(group.some(live))return true;
   }catch(error){
    // An exact lookup may lose a process to reaping between the scalar and
    // detailed observations. Only an independently empty group can close.
    if(await absent())return false;
    throw error;
   }
   if(await absent())return false;
   throw failure();
  };
  if(!await terminateProcessGroup(pid,{killImpl,beforeSignal,isGone:absent})||!await absent())throw failure();
  this.#closed=true;return {closed:true};
 }
 close(){
  if(this.#closed)return Promise.resolve({closed:true});if(this.#closing)return this.#closing;
  const task=this.#close().catch(()=>{throw failure();}).finally(()=>{if(this.#closing===task)this.#closing=null;});
  this.#closing=task;return task;
 }
}

module.exports={PosixPythonProcessProof,createPosixPythonProcessHost,parseRows};
