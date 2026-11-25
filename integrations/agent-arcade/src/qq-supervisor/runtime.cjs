'use strict';
const fs=require('node:fs'),path=require('node:path'),P=require('./policy.cjs'),O=require('./ownership.cjs');
const {QQRuntimeManager,createWindowsProcessHost}=require('../bot/qq-runtime.cjs');
const {readManagedShellInstallation}=require('../bot/qq-managed-setup.cjs');
const PENDING_OWNER_ISSUES=new Set(['pending_upstream_update','pending_update_recovery_required']);
function declaredHost(port){const host=createWindowsProcessHost();host.allocatePort=async()=>{const server=require('node:net').createServer(socket=>socket.destroy());await new Promise((resolve,reject)=>{server.once('error',()=>reject(new P.SupervisorError('start_failed')));server.listen({host:'127.0.0.1',port,exclusive:true},()=>server.close(e=>e?reject(new P.SupervisorError('cleanup_unconfirmed')):resolve()));});return port;};return host;}
class SupervisorRuntime{
 constructor(config,{managerFactory=options=>new QQRuntimeManager(options)}={}){this.config=config;const i=config.installation;this.manager=managerFactory({root:path.join(config.stateDir,'runtime'),componentStoreRoot:i.componentStoreRoot,lockRoot:i.lockRoot,...(i.webuiPort!==undefined?{processHost:declaredHost(i.webuiPort)}:{}),managedInstallation:()=>readManagedShellInstallation({root:i.componentStoreRoot,setupId:i.setupId})});this.binding=null;this.closed=false;}
 async observe(){
  if(this.closed)P.fail('closed');let layout;
  try{layout=await this.manager.componentSelection().resolve();}
  catch(error){
   if(!PENDING_OWNER_ISSUES.has(error?.code)||typeof this.manager.inspectOwnerControl!=='function')throw error;
   const observed=await this.manager.inspectOwnerControl(this.config.expectedQQ,{assertCurrent:()=>{if(this.closed)P.fail('closed');}});
   if(observed?.configured!==false||!PENDING_OWNER_ISSUES.has(observed.componentIssue)||observed.row?.accountId!==this.config.expectedQQ||observed.row.canStart!==false||typeof observed.binding!=='string'||!/^[a-f0-9]{64}$/.test(observed.binding))P.fail('runtime_failed');
   return {status:P.project(observed.row,false),binding:P.hash(JSON.stringify({kind:'pending-owner',componentIssue:observed.componentIssue,binding:observed.binding}))};
  }
  if(layout.kind!=='prepared'||layout.version!==P.VERSION)P.fail('unsupported_version');const layoutBinding=P.hash(JSON.stringify(layout));if(this.binding&&this.binding!==layoutBinding)P.fail('changed');this.binding=layoutBinding;const d=await this.manager.discover(),row=d.instances.find(r=>r.accountId===this.config.expectedQQ);if(!row)P.fail('invalid_account');const file=this.manager._lockPath(this.config.expectedQQ);let lease=null;try{const bytes=O.read(file,65536),proof=O.file(file,65536);lease={proof,sha256:P.hash(bytes)};}catch(e){if(e.code!=='ENOENT')throw e;}const run=this.manager.runs.get(this.config.expectedQQ);const binding=P.hash(JSON.stringify({layoutBinding,lease,run:run?{token:run.lease?.token,instance:run.lease?.instance,proof:run.proof,tree:run.lease?.runtimeTree}:null}));return {status:P.project(row,d.configured),binding};
 }
 async execute(action,assertCurrent){if(!['start','stop','recover'].includes(action))P.fail('invalid_request');assertCurrent();const row=await this.manager[action](this.config.expectedQQ,{assertCurrent});if(row?.accountId!==this.config.expectedQQ)P.fail('runtime_failed');return {result:P.project(row,row.configured!==false),recovery:['adopted','cleared'].includes(row.recovery)?row.recovery:null};}
 async close(){if(this.closed)return {closed:true};const result=await this.manager.close();if(result?.closed!==true)P.fail('cleanup_unconfirmed');this.closed=true;return {closed:true};}
}
module.exports={SupervisorRuntime};
