'use strict';

// One bounded native operation with retained exact process handles. The Node
// supervisor exits before workers are terminated; no PID is reopened for kill.
// A successful receipt covers these known processes, not unknown descendants.
const path=require('node:path');
const {execFile}=require('node:child_process');
const STAMP=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/;
const validPid=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
function failure({terminationAttempted=false,terminationUnconfirmed=false}={}){const error=Object.assign(new Error('The verified Node runtime could not be confirmed stopped.'),{code:'stop_failed'});if(terminationAttempted)error.terminationAttempted=true;if(terminationUnconfirmed)error.terminationUnconfirmed=true;return error;}
function validProofs(proofs){
  if(!Array.isArray(proofs)||!proofs.length||proofs.length>64||proofs.some(row=>!row||!validPid(row.pid)||typeof row.createdAt!=='string'||!STAMP.test(row.createdAt)||!Number.isFinite(Date.parse(row.createdAt))||typeof row.executable!=='string'||row.executable.length>1500||!path.isAbsolute(row.executable)||/^[/\\]{2}/.test(row.executable)||/[\p{Cc}\p{Cf}]/u.test(row.executable)||row.executable.slice(2).includes(':'))||new Set(proofs.map(row=>row.pid)).size!==proofs.length)throw failure();
  return proofs.map(({pid,createdAt,executable})=>({pid,createdAt,executable}));
}
function stopScript(proofs,{residual=false}={}){
  if(typeof residual!=='boolean')throw failure();const rows=validProofs(proofs),encoded=Buffer.from(JSON.stringify(rows)).toString('base64');
  const missingRoot=residual?'':`if($proof.pid -eq ${rows[0].pid}){throw 'root absent'}`;
  return `$ErrorActionPreference='Stop'
$proofs=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))
$opened=New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$events=New-Object System.Collections.Generic.List[object]
$success=$false;$attempted=$false;$watch=[Diagnostics.Stopwatch]::StartNew()
try {
  foreach($proof in $proofs) {
    if($watch.ElapsedMilliseconds -ge 15000){throw 'deadline'}
    $p=Get-Process -Id $proof.pid -ErrorAction SilentlyContinue
    if(!$p){${missingRoot};continue}
    $opened.Add($p)
    $null=$p.Handle
    if($p.HasExited){${missingRoot};continue}
    $ticks=$p.StartTime.ToUniversalTime().Ticks;$microTicks=$ticks-($ticks%10)
    if($microTicks -ne ([DateTimeOffset]::Parse($proof.createdAt,[Globalization.CultureInfo]::InvariantCulture)).UtcDateTime.Ticks -or ![string]::Equals($p.MainModule.FileName,$proof.executable,[StringComparison]::OrdinalIgnoreCase)){throw 'identity mismatch'}
    $null=$p.HasExited
    $events.Add([pscustomobject]@{step='opened';pid=$p.Id;hostAt=[DateTime]::UtcNow.ToString('o')})
  }
  foreach($p in $opened) {
    if(!$p.HasExited) {
      $remaining=15000-[int]$watch.ElapsedMilliseconds
      if($remaining -le 0){throw 'deadline'}
      $attempted=$true
      $events.Add([pscustomobject]@{step='terminate';pid=$p.Id;hostAt=[DateTime]::UtcNow.ToString('o')})
      $p.Kill()
      $exited=$p.WaitForExit($remaining)
      $events.Add([pscustomobject]@{step='wait_complete';pid=$p.Id;exited=$exited;hostAt=[DateTime]::UtcNow.ToString('o')})
      if(!$exited -or !$p.HasExited){throw 'not exited'}
    }
  }
  $success=$true
} catch {} finally {foreach($p in $opened){try{$p.Dispose()}catch{}}}
ConvertTo-Json -InputObject ([pscustomobject]@{stopped=$success;terminationAttempted=$attempted;results=$events.ToArray()}) -Depth 4 -Compress`;
}
function receipt(value,proofs){
  const known=new Set(proofs.map(row=>row.pid));
  if(!value||typeof value.stopped!=='boolean'||typeof value.terminationAttempted!=='boolean'||!Array.isArray(value.results)||value.results.length>192)throw failure({terminationUnconfirmed:true});
  const results=[];for(const row of value.results){if(!row||!['opened','terminate','wait_complete'].includes(row.step)||!validPid(row.pid)||!known.has(row.pid)||row.step==='wait_complete'&&typeof row.exited!=='boolean'||row.hostAt!==undefined&&(typeof row.hostAt!=='string'||!STAMP.test(row.hostAt)||!Number.isFinite(Date.parse(row.hostAt))))throw failure({terminationUnconfirmed:true});results.push({step:row.step,pid:row.pid,...(row.step==='wait_complete'?{exited:row.exited}:{}),...(row.hostAt?{hostAt:row.hostAt}:{})});}
  return {stopped:value.stopped,terminationAttempted:value.terminationAttempted,results};
}
function createWindowsNodeProcessHost(){
  const base=require('./qq-runtime.cjs').createWindowsProcessHost();
  return {...base,async stop(proofs,{onTrace,residual=false}={}){
    const rows=validProofs(proofs),script=stopScript(rows,{residual}),exe=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    let value;
    try{value=await new Promise((resolve,reject)=>execFile(exe,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:20000,maxBuffer:128*1024},(error,stdout)=>{if(error)return reject(error);try{if(typeof stdout!=='string'||Buffer.byteLength(stdout)>128*1024)throw Error('invalid output');resolve(JSON.parse(stdout.replace(/^\uFEFF/,'')));}catch(error){reject(error);}}));}
    catch(error){throw failure({terminationUnconfirmed:!['ENOENT','EACCES'].includes(error?.code)});}
    const result=receipt(value,rows);
    if(typeof onTrace==='function')for(const row of result.results)try{onTrace(row);}catch{/* Diagnostics never change termination outcomes. */}
    if(!result.stopped)throw failure({terminationAttempted:result.terminationAttempted});
    return {stopped:true,terminationAttempted:result.terminationAttempted};
  }};
}
module.exports={createWindowsNodeProcessHost,stopScript};
