'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {ClaudeSessionMonitor,workspacePath}=require('./bot/claude-sessions.cjs');
const {BackgroundSessions}=require('./bot/background-sessions.cjs');
const {createLocalExtensions,MAX_TEXT,MAX_BYTES}=require('./mcp/extensions.cjs');

// The desktop selects files/directories via native dialogs. No renderer-supplied
// path, executable, command line, resource HTML or tool name crosses this API.
class Workbench {
  constructor({root,discover,onChange=()=>{}}){
    this.root=root;this.discover=discover;this.onChange=onChange;this.workspace='';this.observing=false;
    this.monitor=null;this.background=null;this.starting=null;this.extensions=null;this.inspections=[];this.labels=new Map();this.closed=false;this.lastCheck=0;this.polling=null;this.error='';this.lifecycle=false;this.inspectionRevision=0;
  }
  snapshot(){return {workspace:this.workspace,observing:this.observing,sessions:this.monitor?.snapshot()||null,background:this.background?.snapshot()||null,inspections:this.inspections,error:this.error};}
  reconcile(tasks){return this.workspace&&this.monitor?this.monitor.reconcile(tasks):tasks;}
  async ready(){
    if(this.closed)throw Error('The workbench is closed.');
    if(this.background)return;
    if(!this.starting)this.starting=(async()=>{const cli=await this.discover();if(this.closed)throw Error('The workbench is closed.');this.monitor=new ClaudeSessionMonitor({cli});this.background=new BackgroundSessions({root:this.root,cli});})().finally(()=>{this.starting=null;});
    return this.starting;
  }
  choose(workspace){if(this.polling||this.starting||this.lifecycle||this.background?.pending)throw Error('Wait for the current session operation before changing project.');this.workspace=workspacePath(workspace);this.observing=false;this.monitor=null;this.background=null;this.lastCheck=0;this.error='';this.onChange();return this.snapshot();}
  async refresh(){
    if(!this.workspace)throw Error('Choose a project first.');
    if(this.polling)return this.polling;
    this.lastCheck=Date.now();
    this.polling=(async()=>{try{await this.ready();await this.monitor.refresh(this.workspace);await this.background.refresh(this.workspace);this.error='';}catch{this.error='Cannot check local Claude Code. Confirm the native CLI is installed and the project is accessible.';}finally{this.onChange();}return this.snapshot();})().finally(()=>{this.polling=null;});
    return this.polling;
  }
  observe(enabled){if(typeof enabled!=='boolean')throw Error('Expected an observation setting.');if(!this.workspace)throw Error('Choose a project first.');this.observing=enabled;this.onChange();return enabled?this.refresh():this.snapshot();}
  tick(){if(this.closed)return;if(this.observing&&Date.now()-this.lastCheck>=15000&&!this.polling)void this.refresh();}
  async create(prompt){if(!this.workspace)throw Error('Choose a project first.');if(this.lifecycle)throw Error('Wait for the current session operation.');this.lifecycle=true;const workspace=this.workspace;try{await this.ready();this.background.setEnabled(true);return await this.background.create({workspace,prompt});}finally{this.lifecycle=false;this.onChange();}}
  async change(id,method){if(!['stop','resume'].includes(method))throw Error('Unknown session operation.');if(this.lifecycle)throw Error('Wait for the current session operation.');this.lifecycle=true;try{await this.ready();this.background.setEnabled(true);return await this.background[method](id);}finally{this.lifecycle=false;this.onChange();}}
  async localExtensions(){
    if(this.closed)throw Error('The result viewer is closed.');
    if(!this.extensions)this.extensions=createLocalExtensions({onChange:()=>{void this.updateInspections();}});
    return this.extensions;
  }
  async updateInspections(){
    if(this.closed||!this.extensions)return;
    const revision=++this.inspectionRevision;
    try{const extensions=await this.extensions,tasks=await extensions.list();if(revision!==this.inspectionRevision||this.closed)return;this.inspections=tasks.map(t=>({...t,label:this.labels.get(t.taskId)||'Text artifact'})).reverse();
      for(const id of this.labels.keys())if(!this.inspections.some(t=>t.taskId===id))this.labels.delete(id);
      this.onChange();
    }catch{/* Closing an MCP transport does not become a model failure. */}
  }
  async inspect(text,label){
    if(typeof text!=='string'||text.length>MAX_TEXT||Buffer.byteLength(text,'utf8')>MAX_BYTES)throw Error('Choose UTF-8 text of at most 256 KiB / 65,536 characters.');
    const extensions=await this.localExtensions(),task=await extensions.inspect({text,label});this.labels.set(task.taskId,label);await this.updateInspections();return task;
  }
  async inspectFile(file){
    const handle=await fs.promises.open(file,'r');let bytes;
    try{const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_BYTES)throw Error('Choose a text file of at most 256 KiB.');
      const buffer=Buffer.alloc(MAX_BYTES+1);let offset=0;
      while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,null);if(!bytesRead)break;offset+=bytesRead;}
      if(offset>MAX_BYTES)throw Error('The file grew beyond the 256 KiB limit.');bytes=buffer.subarray(0,offset);
    }finally{await handle.close();}
    let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw Error('Choose a valid UTF-8 text file. Binary files are not supported.');}
    if(!Buffer.from(text,'utf8').equals(bytes))throw Error('The selected text cannot be inspected without changing its bytes.');
    return this.inspect(text,path.basename(file).slice(0,100));
  }
  sample(){return this.inspect('{"sample":"Agent Arcade","purpose":"Local artifact inspection; no model task"}\n','Local sample / 本地样例');}
  async cancel(id){if(typeof id!=='string'||!this.inspections.some(t=>t.taskId===id))throw Error('Unknown inspection.');const result=await(await this.localExtensions()).cancel(id);await this.updateInspections();return result;}
  async result(id){if(typeof id!=='string'||!this.inspections.some(t=>t.taskId===id&&t.status==='completed'))throw Error('This inspection is not complete or has expired.');return(await this.localExtensions()).result(id);}
  async resource(){return(await this.localExtensions()).resource();}
  async close(){this.closed=true;this.observing=false;if(this.extensions)await(await this.extensions).close();}
}
module.exports={Workbench};
