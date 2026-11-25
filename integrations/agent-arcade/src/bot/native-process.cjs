'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {atomicJSON}=require('../core/files.cjs');
const runDefault=promisify(execFile);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normal=p=>path.resolve(p).toLowerCase();
const identity=r=>r&&Number.isSafeInteger(r.pid)&&r.pid>0&&typeof r.startedAt==='string'&&/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(r.startedAt)&&Number.isFinite(Date.parse(r.startedAt))&&typeof r.exe==='string'&&path.isAbsolute(r.exe);
// Start-Process joins ArgumentList itself. Supply one correctly quoted native
// command line, never PowerShell expressions assembled from user text.
function quoteWindowsArgument(value){return '"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';}

class NativeProcess {
  constructor({root,workspace,cli,node,run=runDefault,platform=process.platform}){
    if(!path.isAbsolute(workspace)||!path.isAbsolute(cli))throw Error('Native launch requires absolute paths.');
    this.workspace=path.resolve(workspace);this.cli=path.resolve(cli);this.node=node;this.run=run;this.platform=platform;
    const key=crypto.createHash('sha256').update(normal(workspace)).digest('hex');
    this.file=path.join(root,'native-process',`${key}.json`);this.record=null;this.owned=false;this.busy=false;this.status='idle';this.reason='';
    try{
      if(fs.statSync(this.file).size>4096)throw Error('oversize');
      const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(saved.version!==1||normal(saved.workspace)!==normal(this.workspace)||!UUID.test(saved.sessionId))throw Error('invalid');
      this.record={sessionId:saved.sessionId,...(identity(saved)?{pid:saved.pid,startedAt:saved.startedAt,exe:saved.exe}:{})};
      this.status=['stopped','exited'].includes(saved.status)?saved.status:'unknown';
      this.reason=this.status==='unknown'?'previous_process_not_checked':'';
    }catch(error){if(error.code!=='ENOENT'){this.status='unknown';this.reason='invalid_process_record';}}
  }
  snapshot(){return {status:this.status,owned:this.owned,pid:this.record?.pid||null,startedAt:this.record?.startedAt||null,sessionId:this.record?.sessionId||null,
    canResume:!!this.record?.sessionId&&['stopped','exited'].includes(this.status),reason:this.reason,
    externalJobsVerifiedStopped:false};}
  getResumeSessionId(){return this.record?.sessionId||null;}
  save(){if(this.record)atomicJSON(this.file,{version:1,workspace:this.workspace,...this.record,status:this.status});}
  async command(operation,payload){
    if(this.platform!=='win32')throw Error('Managed native terminals currently require Windows.');
    const marker=`ARCADE_PROCESS_${crypto.randomBytes(12).toString('hex')}:`;
    const encoded=Buffer.from(JSON.stringify(payload),'utf8').toString('base64');
    const prelude=`# ARCADE_PROCESS_${operation.toUpperCase()}\n$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\n[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)\n$data=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json\nfunction Result($value) { [Console]::WriteLine('${marker}'+($value | ConvertTo-Json -Compress)) }\n`;
    let body;
    if(operation==='start')body=`try {\n  [Environment]::SetEnvironmentVariable('CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF','1','Process')\n  $created=Start-Process -FilePath $data.cli -ArgumentList $data.arguments -WorkingDirectory $data.workspace -WindowStyle Normal -PassThru\n  $held=$created.Handle\n  Result @{pid=$created.Id;startedAt=$created.StartTime.ToUniversalTime().ToString('o');exe=$created.MainModule.FileName}\n} catch { Result @{error='launch_unconfirmed'} }`;
    else body=`$target=$null\ntry {\n  $target=Get-Process -Id $data.pid -ErrorAction SilentlyContinue\n  if($null -eq $target) { Result @{state='gone'}; exit }\n  $held=$target.Handle\n  $matches=($target.StartTime.ToUniversalTime().ToString('o') -ceq $data.startedAt) -and [String]::Equals($target.MainModule.FileName,$data.exe,[StringComparison]::OrdinalIgnoreCase)\n  if(-not $matches) { Result @{state='identity_changed'}; exit }\n  ${operation==='stop'?`# Keep the verified process handle open while targeting its exact tree.\n  & ([IO.Path]::Combine($env:SystemRoot,'System32','taskkill.exe')) /PID $data.pid /T /F 2>&1 | Out-Null\n  $gone=$target.WaitForExit(5000)\n  if($gone) { Result @{state='gone'} } else { Result @{state='still_running'} }`:`Result @{state='running'}`}\n} catch { Result @{state='unconfirmed'} } finally { if($null -ne $target) { $target.Dispose() } }`;
    const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const result=await this.run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(prelude+body,'utf16le').toString('base64')],
      {windowsHide:true,shell:false,encoding:'utf8',timeout:15000,maxBuffer:65536});
    const rows=String(result.stdout||'').split(/\r?\n/).filter(line=>line.startsWith(marker));
    if(rows.length!==1)throw Error('Native process result was not confirmed.');
    return JSON.parse(rows[0].slice(marker.length));
  }
  async refresh(){
    if(this.busy)return this.snapshot();
    if(!identity(this.record))return this.snapshot();
    this.busy=true;
    try{
      const observed=await this.command('probe',this.record);
      if(observed.state==='gone'||observed.state==='identity_changed'){this.status='exited';this.owned=false;this.reason='';}
      else if(observed.state==='running'){this.status='running';this.reason=this.owned?'':'process_owned_by_previous_app_instance';}
      else{this.status='unknown';this.reason='process_state_unconfirmed';}
      this.save();
    }catch{this.status='unknown';this.reason='process_state_unconfirmed';}
    finally{this.busy=false;}
    return this.snapshot();
  }
  async start(launch){
    if(this.busy)throw Error('A native process operation is already running.');
    if(!launch||normal(launch.cli)!==normal(this.cli)||normal(launch.workspace)!==normal(this.workspace)||!UUID.test(launch.sessionId)||
      !Array.isArray(launch.args)||launch.args.length>100||launch.args.some(a=>typeof a!=='string'||a.includes('\0')||a.length>32000))throw Error('Invalid native launch.');
    const flag=launch.resume?'--resume':'--session-id',at=launch.args.indexOf(flag);
    if(at<0||launch.args[at+1]!==launch.sessionId)throw Error('Native launch has no exact session identity.');
    if(launch.resume&&launch.sessionId!==this.record?.sessionId)throw Error('Resume requires this project’s recorded session UUID.');
    await this.refresh();
    if(this.busy)throw Error('A native process operation is already running.');
    if(['running','unknown','starting'].includes(this.status))throw Error('The previous native process must be confirmed stopped before starting another.');
    this.busy=true;this.owned=false;this.record={sessionId:launch.sessionId};this.status='starting';this.reason='';
    try{
      this.save(); // Record uncertainty before any external side effect.
      const created=await this.command('start',{cli:this.cli,workspace:this.workspace,arguments:launch.args.map(quoteWindowsArgument).join(' ')});
      if(!identity(created)||normal(created.exe)!==normal(this.cli))throw Error('identity');
      this.record={sessionId:launch.sessionId,pid:created.pid,startedAt:created.startedAt,exe:created.exe};this.owned=true;this.status='running';this.save();return this.snapshot();
    }catch{this.status='unknown';this.reason='launch_not_confirmed';this.save();throw Error('Native terminal launch was not confirmed. Check the original terminal before retrying.');}
    finally{this.busy=false;}
  }
  async stop(){
    if(this.busy)throw Error('A native process operation is already running.');
    if(!this.owned||!identity(this.record))throw Error('This app instance does not own a verified native process. Stop it in its original terminal.');
    this.busy=true;
    try{
      const result=await this.command('stop',this.record);
      if(result.state!=='gone'){
        this.status='unknown';this.reason=result.state==='identity_changed'?'process_identity_changed':'stop_not_confirmed';
        if(result.state==='identity_changed')this.owned=false;
        this.save();throw Error('The native process identity or exit could not be confirmed. No unrelated process was targeted.');
      }
      this.status='stopped';this.reason='';this.owned=false;this.save();return this.snapshot();
    }catch{if(!this.reason){this.status='unknown';this.reason='stop_not_confirmed';this.save();}throw Error('The native process identity or exit could not be confirmed. No unrelated process was targeted.');}
    finally{this.busy=false;}
  }
}
module.exports={NativeProcess,quoteWindowsArgument};
