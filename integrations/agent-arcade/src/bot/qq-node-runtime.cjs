'use strict';

// Independent managed Node process rules. Shell's launcher/QQ proof is not used
// to own a bundled Node supervisor, its workers, or another system Node process.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {atomicJSON}=require('../core/files.cjs');
const QCE=require('./qq-qce-managed-process.cjs');
const {QQRuntimeManager,QQRuntimeError,classifyLogLine,runtimeSupport}=require('./qq-runtime.cjs');
const {identity,matches,validProof,readObject,privateEndpoint,possibleDescendantIds,nodeObservationPids,validNodeObservation}=runtimeSupport;
const {QQNodeSelection,directory,bytes,same,hash}=require('./qq-node-selection.cjs');
const {QQManagedNodeLayout}=require('./qq-managed-node-layout.cjs');
const {createWindowsNodeProcessHost}=require('./qq-node-host.cjs');
const {createConfigurationMarker}=require('./qq-component-lock-recovery.cjs');
const {seedLocalWebUI,readLocalWebUI,assertSameWebUI}=require('./qq-node-webui.cjs');
const account=value=>typeof value==='string'&&/^[1-9]\d{4,11}$/.test(value);
const fail=code=>{throw new QQRuntimeError(code);};
const nodeProof=row=>({...identity(row),parentPid:row.parentPid});
const parentMatches=(row,proof)=>matches(row,proof)&&row.parentPid===proof.parentPid;
const consoleExe=path.join(process.env.SystemRoot||'C:\\Windows','System32','conhost.exe');
function directChild(row,root,nodeExe){
  if(!validProof(identity(row))||!validProof(root)||row.parentPid!==root.pid||Date.parse(row.createdAt)<Date.parse(root.createdAt))return false;
  // Windows creates this console directly for the supervisor. Persist its exact
  // identity like a worker; never accept a name-only or worker-parented console.
  return same(row.executable,nodeExe)||(same(row.executable,consoleExe)&&(row.name===undefined||typeof row.name==='string'&&row.name.toLowerCase()==='conhost.exe'));
}
class QQNodeRuntimeManager extends QQRuntimeManager{
  constructor(options){
    const nodeLayout=new QQManagedNodeLayout({read:options.managedNodeInstallation}),initial=nodeLayout.read();
    super({...options,managedNodeInstallation:undefined,managedInstallation:undefined,componentsRoot:initial.installationRoot,processHost:options.processHost||createWindowsNodeProcessHost()});
    this.nodeLayout=nodeLayout;this.managed=nodeLayout;this.componentsRoot=initial.installationRoot;this._componentSelection=null;
  }
  componentSelection(){if(!this._componentSelection){const options={root:this.componentStoreRoot,read:()=>this.nodeLayout.read(),lockRoot:this.lockRoot,processHost:this.host};this._componentSelection=this.componentSelectionFactory?this.componentSelectionFactory(options):new QQNodeSelection(options);}return this._componentSelection;}
  _accounts(){
    const value=this.nodeLayout.read(),names=fs.readdirSync(value.instancesRoot);if(names.length>32)fail('invalid_installation');const paths={};
    for(const name of names){if(!/^[a-f0-9]{64}$/.test(name))fail('invalid_installation');const root=path.join(value.instancesRoot,name);directory(root);const config=path.join(root,'work','config');if(!fs.existsSync(config))continue;directory(config);const files=fs.readdirSync(config);if(files.length>4096)fail('invalid_installation');
      for(const file of files){const id=/^onebot11_([1-9]\d{4,11})\.json$/.exec(file)?.[1];if(!id)continue;if(hash(id)!==name||Object.hasOwn(paths,id))fail('invalid_installation');bytes(path.join(config,file),2*1024*1024);paths[id]=path.join(config,file);}
    }return paths;
  }
  _installation(){
    try{const value=this.nodeLayout.read(),accountConfigPaths=this._accounts(),plan=this.componentSelection().layout(),exe=path.join(value.codeRoot,'node.exe');return {runtimeDir:value.codeRoot,workDir:value.instancesRoot,configDir:null,qqExe:exe,launcher:exe,core:path.join(value.codeRoot,'napcat','napcat.mjs'),entry:path.join(value.codeRoot,'index.js'),accounts:Object.keys(accountConfigPaths).sort(),accountConfigPaths,available:true,componentSelectionKind:'prepared',selectedNapcatVersion:'4.18.42',napcatVersion:'4.18.42',qqVersion:value.qq.version,qqVersionSource:'official-node-bundle-metadata',installationKind:'managed-node',selectionDigest:plan.selectionDigest};}
    catch(error){return {runtimeDir:null,workDir:null,configDir:null,qqExe:null,launcher:null,accounts:[],accountConfigPaths:{},available:false,installationKind:'managed-node',componentIssue:error.code||'invalid_installation'};}
  }
  _instance(accountId,{create=false}={}){
    if(!account(accountId))fail('invalid_account');const install=this._installation();if(!install.available)fail(install.componentIssue||'missing_components');if(!create&&!install.accounts.includes(accountId))fail('invalid_account');const scoped=this.nodeLayout.instance(accountId);
    if(create){if(!install.accounts.includes(accountId)&&install.accounts.length>=32)fail('invalid_account');for(const dir of [scoped.instanceRoot,scoped.workDir,scoped.configDir,scoped.qqDataDir])directory(dir,true);}else for(const dir of [scoped.instanceRoot,scoped.workDir,scoped.configDir,scoped.qqDataDir])directory(dir);
    this.nodeLayout.read();return {...install,...scoped,accountId,onebotConfigPath:path.join(scoped.configDir,`onebot11_${accountId}.json`),webuiConfigPath:path.join(scoped.configDir,'webui.json'),logPath:null};
  }
  instance(accountId){return this._instance(accountId);}
  async discover(options){const result=await super.discover(options);let nodeVersion=null;try{nodeVersion=this.nodeLayout.read().node.version;}catch(error){result.configured=false;result.issue=result.issue||error.code||'invalid_installation';result.instances=result.instances.map(row=>({...row,canStart:false,canStop:false,canRecover:false,reason:result.issue}));}return {...result,installationKind:'managed-node',desktopDataRoot:null,components:{...result.components,nodeVersion,qqVersionSource:'official-node-bundle-metadata'}};}
  _validLease(value,accountId){
    const current=this.nodeLayout.read(),nodeExe=path.join(current.codeRoot,'node.exe');return account(accountId)&&!!value&&value.version===2&&value.engine==='managed-node'&&value.installationId===current.installationId&&value.descriptorSha256===current.descriptorSha256&&value.manifestSha256===current.current.manifestSha256&&value.accountId===accountId&&typeof value.instance==='string'&&typeof value.token==='string'&&validProof(value.manager)&&validProof(value.spawnManager)&&(!value.runtime||(validProof(value.runtime)&&Number.isSafeInteger(value.runtime.parentPid)&&value.runtime.parentPid===value.spawnManager.pid&&Date.parse(value.runtime.createdAt)>=Date.parse(value.spawnManager.createdAt)&&same(value.runtime.executable,nodeExe)))&&Array.isArray(value.runtimeTree)&&value.runtimeTree.length<=64&&new Set(value.runtimeTree.map(p=>p.pid)).size===value.runtimeTree.length&&(!value.runtimeTree.length||value.runtimeTree.filter(p=>parentMatches(p,value.runtime)).length===1)&&value.runtimeTree.every(p=>validProof(p)&&Number.isSafeInteger(p.parentPid)&&(parentMatches(p,value.runtime)||directChild(p,value.runtime,nodeExe)));
  }
  _acquire(accountId,rows){
    this._secureDirectory(this.lockRoot);const file=this._lockPath(accountId),manager=rows.find(row=>row.pid===process.pid),value=this.nodeLayout.read();if(!validProof(identity(manager)))fail('process_check_failed');if(fs.existsSync(`${file}.recover`)||fs.existsSync(this._configurationLockPath()))fail('operation_in_progress');
    const lease={version:2,engine:'managed-node',installationId:value.installationId,descriptorSha256:value.descriptorSha256,manifestSha256:value.current.manifestSha256,instance:this.id,token:randomUUID(),accountId,manager:identity(manager),spawnManager:identity(manager),runtime:null,runtimeTree:[]};let fd;
    try{fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(lease));fs.fsyncSync(fd);}catch(error){fail(error.code==='EEXIST'?'runtime_locked':'unsafe_lock');}finally{if(fd!==undefined)fs.closeSync(fd);}return {file,...lease};
  }
  _tree(rows,proof,install){
    if(!validProof(proof)||!same(proof.executable,install.launcher))fail('ownership_lost');const root=rows.find(row=>row.pid===proof.pid);if(!parentMatches(root,proof))fail('ownership_lost');const ids=possibleDescendantIds(rows,[proof]),tree=[root];
    for(const row of rows)if(row.pid!==root.pid&&ids.has(row.pid)){if(!directChild(row,proof,install.launcher))fail('ownership_lost');tree.push(row);}if(tree.length>64)fail('process_check_failed');return [root,...tree.slice(1).sort((a,b)=>a.pid-b.pid)];
  }
  async _checkedTree(lease,install,rows,origin='background'){
    if(!this._validLease(lease,lease.accountId))fail('ownership_lost');const first=this._tree(rows,lease.runtime,install),after=await this._processes(origin),second=this._tree(after,lease.runtime,install);
    if(first.length!==second.length||first.some(row=>!second.some(other=>parentMatches(other,nodeProof(row)))))fail('process_check_failed');
    const proofs=[lease.runtime,...lease.runtimeTree,...second.map(nodeProof)],pids=[...new Set(proofs.map(row=>row.pid))],direct=await this._inspect(pids,origin);
    for(const old of lease.runtimeTree){const a=rows.find(row=>row.pid===old.pid),b=after.find(row=>row.pid===old.pid),c=direct.find(row=>row.pid===old.pid);if([a,b,c].some(row=>row&&!parentMatches(row,old)))fail('ownership_lost');if(!!a!==!!b||!!b!==!!c)fail('process_check_failed');}
    if(second.some(row=>!parentMatches(direct.find(other=>other.pid===row.pid),nodeProof(row))))fail('process_check_failed');return second;
  }
  _observedTree(lease,install,observation){
    if(!this._validLease(lease,lease.accountId))fail('ownership_lost');const {before,after,inspected}=observation,first=this._tree(before,lease.runtime,install),second=this._tree(after,lease.runtime,install);
    if(first.length!==second.length||first.some(row=>!second.some(other=>parentMatches(other,nodeProof(row)))))fail('process_check_failed');
    for(const old of lease.runtimeTree){const a=before.find(row=>row.pid===old.pid),b=after.find(row=>row.pid===old.pid),c=inspected.find(row=>row.pid===old.pid);if([a,b,c].some(row=>row&&!parentMatches(row,old)))fail('ownership_lost');if(!!a!==!!b||!!b!==!!c)fail('process_check_failed');}
    if(second.some(row=>!parentMatches(inspected.find(other=>other.pid===row.pid),nodeProof(row))))fail('process_check_failed');return second;
  }
  async _connectionObservation(contexts){
    const request={roots:[...new Set(contexts.map(({run})=>run.proof.pid))],retainedPids:[...new Set(contexts.flatMap(({run})=>run.lease.runtimeTree.map(row=>row.pid)))]};
    if(typeof this.host.observeNode==='function')return validNodeObservation(await this.host.observeNode(request),request);
    // Injected/older hosts retain the same fully verified protocol. A failed
    // native batch never enters this path or falls back to a weaker check.
    const before=await this._processes(),after=await this._processes(),pids=nodeObservationPids(request,before,after),inspected=[];
    for(let i=0;i<pids.length;i+=128)inspected.push(...await this._inspect(pids.slice(i,i+128)));
    return validNodeObservation({before,after,inspected,listeners:await this.host.listeners()},request);
  }
  _rememberTree(run,tree){const {file,...expected}=run.lease;let current;try{current=JSON.parse(bytes(file,32768).value);}catch{fail('runtime_locked');}if(JSON.stringify(current)!==JSON.stringify(expected))fail('runtime_locked');const proofs=tree.map(nodeProof);if(JSON.stringify(run.lease.runtimeTree)!==JSON.stringify(proofs)){run.lease.runtimeTree=proofs;this._writeLease(run.lease);}}
  _external(rows,install,accountId,proof=this.runs.get(accountId)?.proof){
    const registered=[];if(fs.existsSync(this.lockRoot)){const names=fs.readdirSync(this.lockRoot);if(names.length>4096)return 'process_check_failed';for(const name of names)if(/^[a-f0-9]{64}\.json$/.test(name)){const lease=readObject(path.join(this.lockRoot,name));if(!this._validLease(lease,lease?.accountId)||name!==`${hash(lease.accountId)}.json`||!lease.runtime)continue;if(lease.accountId===accountId&&!matches(lease.runtime,proof))continue;registered.push(lease.runtime);}}
    for(const row of rows){if(row.name.toLowerCase()==='node.exe'&&!path.isAbsolute(row.executable))return 'process_check_failed';if(!same(row.executable,install.launcher))continue;
      const root=registered.find(p=>parentMatches(row,p));if(root)continue;
      const parent=registered.find(p=>p.pid===row.parentPid);if(parent&&parentMatches(rows.find(p=>p.pid===parent.pid),parent)&&validProof(identity(row))&&Date.parse(row.createdAt)>=Date.parse(parent.createdAt))continue;
      return 'external_qq_unknown';
    }return null;
  }
  async _withConfigurationLock(accountId,{create=false}={},operation,assertComponentOwned){
    if(this.platform!=='win32')fail('unsupported_platform');if(this.closing)fail('manager_closing');if(!account(accountId)||typeof operation!=='function')fail('invalid_account');
    const metadata=this._installation();if(!metadata.available)fail(metadata.componentIssue||'missing_components');if(!metadata.accounts.includes(accountId)&&!create)fail('invalid_account');this._begin(accountId);let marker,result,failure,issue;
    try{
      const assertStopped=async()=>{assertComponentOwned();marker?.assertOwned();this.nodeLayout.instance(accountId);const rows=await this._processes();if(this.runs.has(accountId))fail('runtime_running');this._guard(rows,metadata,accountId);if(fs.existsSync(this._lockPath(accountId)))fail('runtime_locked');if(fs.existsSync(`${this._lockPath(accountId)}.recover`))fail('operation_in_progress');this.nodeLayout.instance(accountId);assertComponentOwned();marker?.assertOwned();};
      await assertStopped();this._secureDirectory(this.lockRoot);marker=await createConfigurationMarker({selection:this.componentSelection(),processHost:this.host});await assertStopped();const install=this._instance(accountId,{create});if(create)seedLocalWebUI(install.webuiConfigPath);result=await operation({...install,assertStopped});
    }catch(error){failure=error;}finally{if(marker)issue=marker.close().issue;this._end(accountId);}
    if(failure){if(issue)failure.configurationRecoveryIssue=issue;throw failure;}return issue?{...result,configurationRecoveryIssue:issue}:result;
  }
  async _startWithComponentLock(accountId,plan,assertOwned,beforeStart=assertOwned){
    beforeStart();
    const install=this.instance(accountId),value=this.nodeLayout.read();if(!same(plan.codeRoot,install.runtimeDir)||plan.installationKind!=='managed-node')fail('component_changed');let lease,started=false;
    this._assertPluginDeploymentReady(install);
    if(QCE.installedVersion(install)===QCE.VERSION)fail('qce_version_unsupported');
    try{
      const webui=readLocalWebUI(install.webuiConfigPath);
      let rows=await this._processes();beforeStart();await this._reconcile(accountId,install,rows);beforeStart();if(this.runs.has(accountId))fail('runtime_locked');this._guard(rows,install,accountId);lease=this._acquire(accountId,rows);rows=await this._processes();beforeStart();this._guard(rows,install,accountId);
      const env={},allowed=/^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|APPDATA|LOCALAPPDATA|PROGRAMDATA|USERPROFILE|HOMEDRIVE|HOMEPATH|USERNAME|USERDOMAIN|USERDNSDOMAIN|SESSIONNAME|OS|PROCESSOR_ARCHITECTURE|PROCESSOR_IDENTIFIER|NUMBER_OF_PROCESSORS|PROGRAMFILES(?:\(X86\))?|COMMONPROGRAMFILES(?:\(X86\))?)$/i;for(const [key,item]of Object.entries(process.env))if(allowed.test(key))env[key]=item;
      const preferred=await this.host.allocatePort();beforeStart();if(!Number.isInteger(preferred)||preferred<1||preferred>65535)fail('start_failed');Object.assign(env,{NAPCAT_WORKDIR:install.workDir,NAPCAT_QQ_DATA_DIR:install.qqDataDir,NAPCAT_WEBUI_PREFERRED_PORT:String(preferred)});
      const current=this.instance(accountId);if(!same(current.workDir,install.workDir)||!same(current.qqDataDir,install.qqDataDir)||this.nodeLayout.read().descriptorSha256!==value.descriptorSha256)fail('managed_installation_changed');assertSameWebUI(webui,readLocalWebUI(current.webuiConfigPath));assertOwned();this.endpoints.delete(accountId);this.endpointIssues.delete(accountId);this.outputOwners.set(accountId,lease.token);
      this._assertPluginDeploymentReady(install);beforeStart();const child=await this.host.start({file:install.launcher,args:[install.entry,'-q',accountId],cwd:install.workDir,env,beforeSpawn:beforeStart,onOutput:line=>{if(this.outputOwners.get(accountId)!==lease.token)return;const endpoint=privateEndpoint(line);if(endpoint){this.endpoints.set(accountId,endpoint);this._changed();}const event=classifyLogLine(line);if(event)this._event(accountId,event);},onExit:()=>{if(this.outputOwners.get(accountId)!==lease.token)return;this.endpoints.delete(accountId);this._changed();}});started=true;
      const first=await this._processes(),a=first.find(row=>row.pid===child.pid),after=await this._processes(),b=after.find(row=>row.pid===child.pid);if(!validProof(identity(a))||a.parentPid!==process.pid||!same(a.executable,install.launcher)||!parentMatches(b,nodeProof(a)))fail('start_unverified');
      lease.runtime=nodeProof(a);const run={lease,proof:lease.runtime};this.runs.set(accountId,run);this._writeLease(lease);assertOwned();this._rememberTree(run,await this._checkedTree(lease,install,after));this._event(accountId,{type:'launcher_started',time:new Date().toISOString()});return (await this.discover({settledAccount:accountId})).instances.find(row=>row.accountId===accountId);
    }catch(error){if(lease&&!started)this._release(lease);else if(lease&&!this.runs.has(accountId))this.runs.set(accountId,{lease,proof:null});if(error instanceof QQRuntimeError)throw error;if(['webui_config_not_local','node_repair_busy','node_repair_changed','node_repair_unavailable','node_repair_recovery_required','node_repair_cleanup_unconfirmed'].includes(error.code))fail(error.code);fail('start_failed');}
  }
  async getConnections(accountIds){
    if(!Array.isArray(accountIds)||accountIds.length>32)fail('invalid_account');const result=new Map(),contexts=[];
    const failed=(accountId,error)=>result.set(accountId,{error:{code:error?.code==='webui_config_not_local'?'webui_config_not_local':'webui_unavailable',message:'The current managed Node endpoint could not be verified.'},endpointRecoveryIssue:this.endpointIssues.get(accountId)||null});
    const current=context=>{
      const {accountId,run,proof,token,install}=context;if(this.closing||this.runs.get(accountId)!==run||!parentMatches(run.proof,proof)||run.lease.token!==token)fail('webui_unavailable');
      const saved=readObject(run.lease.file);if(saved?.token!==token||saved?.instance!==this.id||!this._validLease(saved,accountId)||!parentMatches(saved.runtime,proof))fail('webui_unavailable');
      const fresh=this.instance(accountId);if(fresh.descriptorSha256!==install.descriptorSha256||!same(fresh.workDir,install.workDir))fail('webui_unavailable');
    };
    for(const accountId of new Set(accountIds))try{const install=this.instance(accountId),run=this.runs.get(accountId);if(!run?.proof)fail('webui_unavailable');const context={accountId,install,run,proof:{...run.proof},token:run.lease.token};current(context);contexts.push(context);}catch(error){failed(accountId,error);}
    const duplicateRoots=new Set(contexts.filter((row,index)=>contexts.some((other,i)=>i!==index&&other.proof.pid===row.proof.pid)).map(row=>row.proof.pid));
    for(let i=contexts.length-1;i>=0;i--)if(duplicateRoots.has(contexts[i].proof.pid)){failed(contexts[i].accountId);contexts.splice(i,1);}
    if(!contexts.length)return result;
    let first;try{first=await this._connectionObservation(contexts);}catch(error){for(const {accountId}of contexts)failed(accountId,error);return result;}
    const pending=[];
    for(const context of contexts)try{
      current(context);const {accountId,run,install}=context,tree=this._observedTree(run.lease,install,first);this._rememberTree(run,tree);let endpoint=this.endpoints.get(accountId),source='owned-runtime-output',saved;
      if(!endpoint&&this.vault)try{saved=this._endpointStore().load(accountId,run.proof);endpoint=saved.endpoint;source='encrypted-runtime-record';}catch{this._endpointIssue(accountId);}if(!endpoint)fail('webui_unavailable');
      const ids=new Set(tree.filter(row=>same(row.executable,install.launcher)).map(row=>row.pid)),bound=first.listeners.filter(row=>ids.has(row.pid)&&row.port===endpoint.port);
      if(bound.some(row=>!['127.0.0.1','::1'].includes(row.address)))fail('webui_config_not_local');if(bound.length!==1)fail('webui_unavailable');const listener=bound[0],listenerProof=nodeProof(tree.find(row=>row.pid===listener.pid));
      pending.push({...context,endpoint:{...endpoint},source,saved,listener,listenerProof});
    }catch(error){failed(context.accountId,error);}
    if(!pending.length)return result;
    let second;try{second=await this._connectionObservation(pending);}catch(error){for(const {accountId}of pending)failed(accountId,error);return result;}
    for(const context of pending)try{
      current(context);const {accountId,run,install,endpoint,source,saved,listener,listenerProof}=context,tree=this._observedTree(run.lease,install,second);
      if(!tree.some(row=>parentMatches(row,listenerProof)))fail('webui_unavailable');const ids=new Set(tree.filter(row=>same(row.executable,install.launcher)).map(row=>row.pid)),bound=second.listeners.filter(row=>ids.has(row.pid)&&row.port===endpoint.port);
      if(bound.some(row=>!['127.0.0.1','::1'].includes(row.address)))fail('webui_config_not_local');if(bound.length!==1||bound[0].pid!==listener.pid||bound[0].address!==listener.address||saved&&!matches(listenerProof,saved.listener))fail('webui_unavailable');
      const latest=this.endpoints.get(accountId);if(source==='owned-runtime-output'&&(!latest||latest.port!==endpoint.port||latest.token!==endpoint.token))fail('webui_unavailable');if(latest&&(latest.port!==endpoint.port||latest.token!==endpoint.token))fail('webui_unavailable');
      if(this.vault)try{this._endpointStore().save(accountId,{runtime:run.proof,listener:listenerProof,endpoint});this.endpointIssues.delete(accountId);}catch{this._endpointIssue(accountId);}
      result.set(accountId,{connection:{...endpoint,endpointId:hash(JSON.stringify([listenerProof,endpoint.port,endpoint.token])),ownershipVerified:true,listenAddress:listener.address,loopbackOnly:true,source,endpointRecoveryIssue:this.endpointIssues.get(accountId)||null}});
    }catch(error){failed(context.accountId,error);}return result;
  }
  async recover(accountId){
    if(this.platform!=='win32')fail('unsupported_platform');if(this.closing)fail('manager_closing');const install=this.instance(accountId);this._begin(accountId);let fd,file,guardIdentity;const guardToken=randomUUID();
    try{
      if(this.runs.has(accountId))fail('runtime_locked');this._secureDirectory(this.lockRoot);const leaseFile=this._lockPath(accountId);file=`${leaseFile}.recover`;if(fs.existsSync(this._configurationLockPath()))fail('operation_in_progress');try{fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,guardToken);fs.fsyncSync(fd);guardIdentity=fs.fstatSync(fd);}catch{fail('operation_in_progress');}const lease=readObject(leaseFile);if(!this._validLease(lease,accountId)||!validProof(lease.runtime))fail('ownership_lost');
      const check=async()=>{const old=(await this._inspect([lease.manager.pid])).find(row=>row.pid===lease.manager.pid);if(old&&!validProof(identity(old)))fail('process_check_failed');if(matches(old,lease.manager))fail('owner_alive');const current=readObject(leaseFile);if(current?.token!==lease.token||current?.instance!==lease.instance)fail('runtime_locked');const guard=bytes(file);if(guard.stat.ino!==guardIdentity.ino||guard.stat.dev!==guardIdentity.dev||guard.value.toString()!==guardToken)fail('runtime_locked');this.instance(accountId);if(fs.existsSync(this._configurationLockPath()))fail('operation_in_progress');};
      await check();const rows=await this._processes();if(this._desktop(rows))fail('desktop_running');const direct=(await this._inspect([lease.runtime.pid])).find(row=>row.pid===lease.runtime.pid);let recovery;
      if(!direct){if(!await this._treeDead(lease,install,rows))fail('process_check_failed');await check();fs.unlinkSync(leaseFile);recovery='cleared';}
      else{if(!parentMatches(direct,lease.runtime))fail('ownership_lost');const tree=await this._checkedTree(lease,install,rows);if(this._external(rows,install,accountId,lease.runtime))fail('external_qq_unknown');await check();const owner=(await this._inspect([process.pid])).find(row=>row.pid===process.pid);if(!validProof(identity(owner)))fail('process_check_failed');const next={...lease,instance:this.id,token:randomUUID(),manager:identity(owner),runtimeTree:tree.map(nodeProof)};atomicJSON(leaseFile,next);this.runs.set(accountId,{lease:{...next,file:leaseFile},proof:next.runtime});recovery='adopted';}
      this._event(accountId,{type:`ownership_${recovery}`,time:new Date().toISOString()});return {...(await this.discover({settledAccount:accountId})).instances.find(row=>row.accountId===accountId),recovery};
    }finally{if(fd!==undefined){fs.closeSync(fd);try{const guard=bytes(file);if(guard.stat.ino===guardIdentity.ino&&guard.stat.dev===guardIdentity.dev&&guard.value.toString()===guardToken)fs.unlinkSync(file);}catch{}}this._end(accountId);}
  }
  async _orphanPlan(accountId,install,file,{allowEmpty=false}={}){
    const saved=this._orphanLease(file,accountId),lease=saved.lease,rows=await this._processes();if(this._desktop(rows))fail('desktop_running');const proofs=lease.runtimeTree,direct=await this._inspect([lease.manager.pid,...proofs.map(row=>row.pid)]),aOwner=rows.find(row=>row.pid===lease.manager.pid),bOwner=direct.find(row=>row.pid===lease.manager.pid);if([aOwner,bOwner].some(row=>row&&!validProof(identity(row))))fail('process_check_failed');if(matches(aOwner,lease.manager)||matches(bOwner,lease.manager))fail('owner_alive');if(!!aOwner!==!!bOwner||aOwner&&!matches(aOwner,identity(bOwner)))fail('orphan_cleanup_changed');
    const root=lease.runtime,candidates=[];for(const proof of proofs){const a=rows.find(row=>row.pid===proof.pid),b=direct.find(row=>row.pid===proof.pid);if(a&&!parentMatches(a,proof)||b&&!parentMatches(b,proof))fail('ownership_lost');if(!!a!==!!b)fail('orphan_cleanup_changed');if(b&&proof.pid===root.pid)fail('orphan_cleanup_unavailable');if(b){if(!directChild(b,root,install.launcher))fail('orphan_cleanup_unverified');candidates.push(b);}}
    const ids=possibleDescendantIds(rows,proofs);if(rows.some(row=>ids.has(row.pid)&&!proofs.some(proof=>parentMatches(row,proof))))fail('orphan_cleanup_unverified');if(this._external(rows.filter(row=>!ids.has(row.pid)),install,accountId))fail('orphan_cleanup_unverified');if(!candidates.length&&!allowEmpty)fail('orphan_cleanup_unavailable');if(this._orphanLease(file,accountId).fingerprint!==saved.fingerprint)fail('orphan_cleanup_changed');candidates.sort((a,b)=>a.pid-b.pid);return {lease,fingerprint:saved.fingerprint,candidates,digest:hash(JSON.stringify({lease:saved.fingerprint,processes:candidates.map(nodeProof)}))};
  }
  async cleanupOrphans(accountId,{expectedDigest,assertCurrent=()=>{},beforeStop=async()=>{}}={}){
    if(typeof expectedDigest!=='string'||!/^[a-f0-9]{64}$/.test(expectedDigest)||typeof assertCurrent!=='function'||typeof beforeStop!=='function')fail('orphan_cleanup_changed');
    return this._withOrphanGuard(accountId,async({install,file,assertGuard})=>{
      assertCurrent();const first=await this._orphanPlan(accountId,install,file);if(first.digest!==expectedDigest)fail('orphan_cleanup_changed');assertGuard();await beforeStop();const current=await this._orphanPlan(accountId,install,file);if(current.digest!==expectedDigest)fail('orphan_cleanup_changed');assertGuard();assertCurrent();
      try{await this.host.stop(current.candidates.map(nodeProof),{residual:true});const remaining=await this._orphanPlan(accountId,install,file,{allowEmpty:true});if(remaining.candidates.length||remaining.fingerprint!==current.fingerprint)fail('orphan_cleanup_incomplete');assertGuard();assertCurrent();if(this._orphanLease(file,accountId).fingerprint!==current.fingerprint)fail('orphan_cleanup_changed');fs.unlinkSync(file);}catch{const error=new QQRuntimeError('orphan_cleanup_incomplete');error.cleanupAttempted=true;throw error;}
      this.endpoints.delete(accountId);this.outputOwners.delete(accountId);this.endpointIssues.delete(accountId);this._event(accountId,{type:'ownership_orphans_cleared',time:new Date().toISOString()});return {recovery:'orphans-cleared',accountId,terminatedCount:current.candidates.length,automaticStart:false};
    });
  }
}
module.exports={QQNodeRuntimeManager};
