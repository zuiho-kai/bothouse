'use strict';
// Shared reviewed file operations for API runners. This is not an OS sandbox.
const fs = require('node:fs');
const path = require('node:path');
const MAX_READ = 32768, MAX_ARGUMENTS = 2600;
const string = description => ({type:'string', description});
const definition = (name, description, properties) => ({type:'function', function:{name, description,
  parameters:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}});
const TOOLS = Object.freeze([
  definition('Read','Read a UTF-8 text file in the selected project, at most 32 KiB. Explicit approval required.',{path:string('Project-relative file path.')}),
  definition('Write','Create a NEW UTF-8 file in an existing project directory. Never overwrite. Maximum 2000 UTF-8 bytes. Explicit approval required.',{path:string('Project-relative file path.'),content:string('Exact content; include a trailing newline only if wanted.')}),
  definition('Edit','Replace exactly one occurrence in an existing UTF-8 project file. Explicit approval required.',{path:string('Project-relative file path.'),old_text:string('Exact nonempty text occurring once.'),new_text:string('Replacement text.')}),
  definition('List','List at most 100 entries in one project directory, without recursion or following links. Explicit approval required.',{path:string('Project-relative directory path; use . for the project root.')}),
  definition('AskUserQuestion','Ask one short clarification question. An answer never approves a separate file action.',{question:string('One question, at most 1000 characters.')}),
]);
class SafeError extends Error { constructor(message, outcome='error', httpStatus) {super(message); this.outcome=outcome; this.httpStatus=httpStatus;} }
function checkAbort(signal) { if(signal.aborted) throw new SafeError('This turn was cancelled. Existing file changes were not rolled back.','cancelled'); }
function abortable(promise,signal) {
  return new Promise((resolve,reject)=>{
    const abort=()=>{cleanup();reject(new SafeError('This turn was cancelled.','cancelled'));};
    const cleanup=()=>signal.removeEventListener('abort',abort);
    if(signal.aborted)abort();
    else signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
  });
}
function boundedText(value, max, label, {empty=true}={}) {
  if(typeof value!=='string'||(!empty&&!value.length)||Buffer.byteLength(value,'utf8')>max||value.includes('\0')) throw new SafeError(`Invalid or oversized ${label}.`);
  return value;
}
function validArguments(name, raw) {
  if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>MAX_ARGUMENTS) throw new SafeError('Tool arguments exceeded the review limit. No action was performed.');
  let input; try {input=JSON.parse(raw);} catch {throw new SafeError('Malformed tool arguments. No action was performed.');}
  const schema=TOOLS.find(tool=>tool.function.name===name)?.function.parameters;
  if(!schema||!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).length!==schema.required.length||
    schema.required.some(key=>!Object.hasOwn(input,key))||Object.keys(input).some(key=>!schema.required.includes(key))) throw new SafeError('Unsupported tool or arguments. No action was performed.');
  for(const key of schema.required) boundedText(input[key],key==='question'?1000:key==='content'?2000:2000,key,{empty:!['path','old_text','question'].includes(key)});
  return input;
}
function projectPath(root, value, {create=false}={}) {
  // This is a restricted file interface, not an OS sandbox. Reject traversal,
  // Windows alternate streams/device names and links rather than following them.
  const rootStat=fs.lstatSync(root);
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink()) throw new SafeError('The selected project directory changed. Reconnect before continuing.');
  if(path.isAbsolute(value)||/^[A-Za-z]:|[\x00-\x1f:*?"<>|]/.test(value)) throw new SafeError('Use a project-relative path without device or stream syntax.');
  const parts=value.replace(/\\/g,'/').split('/');
  if(parts.some(part=>part==='..'||(/[. ]$/.test(part)&&part!=='.')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new SafeError('This path is not supported.');
  const target=path.resolve(root,...parts),relative=path.relative(root,target);
  if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)) throw new SafeError('The path is outside the selected project.');
  let current=root;
  const clean=relative?relative.split(path.sep):[];
  for(let index=0;index<clean.length;index++) {
    current=path.join(current,clean[index]);
    let stat; try {stat=fs.lstatSync(current);} catch(error) {
      if(create&&index===clean.length-1&&error.code==='ENOENT') return target;
      throw new SafeError('The requested file or parent directory does not exist.');
    }
    if(stat.isSymbolicLink()) throw new SafeError('Symbolic links and junctions are not supported by this file tool.');
    if(index<clean.length-1&&!stat.isDirectory()) throw new SafeError('A path component is not a directory.');
  }
  return target;
}
function readTextFile(target) {
  const stat=fs.lstatSync(target);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_READ) throw new SafeError('Only single-link text files up to 32 KiB are supported.');
  const fd=fs.openSync(target,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try {
    const opened=fs.fstatSync(fd);
    if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino||opened.nlink!==1||opened.size>MAX_READ) throw new SafeError('The file changed while opening. No action was performed.');
    const bytes=Buffer.alloc(MAX_READ+1),length=fs.readSync(fd,bytes,0,bytes.length,0);
    if(length>MAX_READ) throw new SafeError('The file exceeds the read limit.');
    let content; try {content=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));} catch {throw new SafeError('Only UTF-8 text files are supported.');}
    if(content.includes('\0')) throw new SafeError('Binary files are not supported.');
    return {content,stat:opened};
  } finally {fs.closeSync(fd);}
}
function fileTool(root,name,input) {
  const target=projectPath(root,input.path,{create:name==='Write'});
  if(name==='List') {
    if(!fs.statSync(target).isDirectory()) throw new SafeError('Choose a directory to list.');
    const directory=fs.opendirSync(target),entries=[];
    let more=false;
    try {let entry;while((entry=directory.readSync())) {if(entries.length===100){more=true;break;}entries.push({name:entry.name,type:entry.isSymbolicLink()?'link':entry.isDirectory()?'directory':entry.isFile()?'file':'other'});}}
    finally {directory.closeSync();}
    return {path:target,entries,truncated:more};
  }
  if(name==='Read') return {path:target,content:readTextFile(target).content};
  if(name==='Write') {
    const fd=fs.openSync(target,'wx',0o600);
    try {fs.writeFileSync(fd,input.content,'utf8');fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    return {path:target,bytes:Buffer.byteLength(input.content),created:true};
  }
  const {content,stat}=readTextFile(target),first=content.indexOf(input.old_text);
  if(first===-1||content.indexOf(input.old_text,first+input.old_text.length)!==-1) throw new SafeError('Edit requires exactly one occurrence of old_text. Nothing was changed.');
  const replacement=content.slice(0,first)+input.new_text+content.slice(first+input.old_text.length);
  if(Buffer.byteLength(replacement)>MAX_READ) throw new SafeError('The edited file would exceed 32 KiB.');
  const fd=fs.openSync(target,fs.constants.O_RDWR|(fs.constants.O_NOFOLLOW||0));
  try {
    const opened=fs.fstatSync(fd);
    if(!opened.isFile()||opened.nlink!==1||opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size||opened.mtimeMs!==stat.mtimeMs) throw new SafeError('The file changed before editing. Nothing was changed.');
    const bytes=Buffer.from(replacement,'utf8');fs.writeFileSync(fd,bytes);fs.ftruncateSync(fd,bytes.length);fs.fsyncSync(fd);
  } finally {fs.closeSync(fd);}
  return {path:target,bytes:Buffer.byteLength(replacement),edited:true};
}

module.exports={TOOLS,SafeError,checkAbort,abortable,boundedText,validArguments,projectPath,fileTool};
