'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFile}=require('node:child_process');
const {MAX_VOICE_BYTES}=require('./qq-image-download.cjs');
const unavailable=()=>Object.assign(Error('The account recording cache is unavailable.'),{code:'source_unavailable'});
const changed=()=>Object.assign(Error('The recording changed.'),{code:'message_changed'});

function canonicalDosPath(value){
 if(typeof value!=='string'||value.length>4096||!value.isWellFormed())return null;
 const full=value.replaceAll('/','\\');
 if(!/^[a-z]:\\/i.test(full)||path.win32.normalize(full)!==full)return null;
 const names=full.slice(3).split('\\');
 if(names.length>64||names.some(name=>!name||name.length>255||/[ .]$|[<>:"|?*\x00-\x1f\x7f]/u.test(name)||
    /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[0-9¹²³])(?:\.|$)/iu.test(name)))return null;
 return full;
}

// The account and Documents location come from the host, never the record.
function selectCachePath(documents,accountId,reported){
 const docs=canonicalDosPath(documents),candidate=canonicalDosPath(reported);
 if(!docs||!candidate||!/^[1-9]\d{4,14}$/.test(accountId))throw unavailable();
 const root=path.win32.join(docs,'Tencent Files',accountId,'nt_qq','nt_data','Ptt');
 const prefix=root+'\\';
 if(!candidate.toLowerCase().startsWith(prefix.toLowerCase()))throw unavailable();
 // Reconstruct the trusted prefix, also on case-sensitive Windows directories.
 return {root,file:prefix+candidate.slice(prefix.length)};
}

const BOOT="$ErrorActionPreference='Stop'; try { $code=[Console]::ReadLine(); Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($code))); exit [ArcadePttOriginal]::Read() } catch { exit 2 }";
function readCacheFile(target,{sourceBytes,sha1,signal}){
 if(process.platform!=='win32'||!Number.isSafeInteger(sourceBytes)||sourceBytes<1||sourceBytes>MAX_VOICE_BYTES||
    !/^[0-9a-f]{40}$/.test(sha1)||signal?.aborted)throw unavailable();
 const win=canonicalDosPath(process.env.SystemRoot);if(!win)throw unavailable();
 const shell=path.win32.join(win,'System32','WindowsPowerShell','v1.0','powershell.exe');
 try{
  if(!fs.lstatSync(shell).isFile()||fs.realpathSync.native(shell).toLowerCase()!==shell.toLowerCase())throw unavailable();
 }catch{throw unavailable();}
 const code=fs.readFileSync(path.join(__dirname,'qq-group-ptt-reader.cs')).toString('base64');
 const field=value=>Buffer.from(value,'utf8').toString('base64');
 const input=[code,field(target.root),field(target.file),sourceBytes,sha1,''].join('\n');
 return new Promise((resolve,reject)=>{
  const child=execFile(shell,['-NoLogo','-NoProfile','-NonInteractive','-Command',BOOT],{
   cwd:path.win32.dirname(shell),windowsHide:true,encoding:'buffer',timeout:7000,maxBuffer:MAX_VOICE_BYTES,signal
  },(error,stdout,stderr)=>{
   stderr?.fill(0);
   if(error||stdout.length!==sourceBytes){stdout?.fill(0);reject(error?.code===3?changed():unavailable());}
   else resolve(stdout);
  });
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}

module.exports={selectCachePath,readCacheFile};
