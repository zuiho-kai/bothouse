'use strict';
const fs=require('node:fs'),path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {findCodexExecutable}=require('./codex-runner.cjs');
const {childEnvironment,commonDirectories}=require('../core/platform.cjs');
const run=promisify(execFile);
const PROVIDERS=new Set(['claude','codex']);
const STATUS_ARGS={claude:['auth','status','--json'],codex:['login','status']};
const LOGIN_ARGS={claude:['auth','login'],codex:['login']};
function checkProvider(provider){if(!PROVIDERS.has(provider))throw Error('Unsupported AI provider.');return provider;}
function claudeVersionCode(version){
  if(!version)return 'unknown_version';
  const [major,minor,patch]=version.split('.').map(Number);
  return major>2||major===2&&(minor>1||minor===1&&patch>=317)?null:'unsupported_version';
}
function loginEnvironment(source,provider,{platform=process.platform}={}){
  // Operating-system plumbing only; the allow-list lives in core/platform.cjs.
  const env=childEnvironment(source,{platform});
  // Codex's original runner also respects its selected native configuration
  // directory. Keep that location, never its credential file or any API token.
  if(provider==='codex'&&typeof source.CODEX_HOME==='string'&&path.isAbsolute(source.CODEX_HOME))env.CODEX_HOME=source.CODEX_HOME;
  return {...env,DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};
}
function executableValid(file,platform){return typeof file==='string'&&(platform==='win32'?path.win32:path.posix).isAbsolute(file)&&!/[\0\r\n]/.test(file)&&(platform!=='win32'||/\.exe$/i.test(file));}
function discoverExecutable(provider,{platform=process.platform,env=process.env,directories,isFile=file=>fs.statSync(file).isFile()}={}){
  checkProvider(provider);const paths=platform==='win32'?path.win32:path.posix,candidates=[];
  if(provider==='claude'&&platform==='win32'&&env.USERPROFILE)candidates.push(paths.join(env.USERPROFILE,'.local','bin','claude.exe'));
  if(provider==='codex')candidates.push(findCodexExecutable({platform,env}));
  const filename=provider+(platform==='win32'?'.exe':'');
  for(const folder of String(env.PATH||env.Path||'').split(platform==='win32'?';':':').filter(Boolean))candidates.push(paths.join(folder,filename));
  // A macOS or Linux desktop app can start with a short PATH, so the usual
  // install locations are searched as well. Windows has none: PATH only.
  for(const folder of directories||commonDirectories({platform,env}))candidates.push(paths.join(folder,filename));
  for(const file of candidates){if(!executableValid(file,platform))continue;try{if(isFile(file))return file;}catch{}}
  return null;
}
function psLiteral(text){return "'"+text.replaceAll("'","''")+"'";}
function buildWindowsLogin(executable,args){
  if(!executableValid(executable,'win32')||!Array.isArray(args)||!Object.values(LOGIN_ARGS).some(expected=>JSON.stringify(expected)===JSON.stringify(args)))throw Error('Invalid login command.');
  const script=`$ErrorActionPreference='Stop'; $loginProcess=Start-Process -FilePath ${psLiteral(executable)} -ArgumentList @(${args.map(psLiteral).join(',')}) -WindowStyle Normal -PassThru; [Console]::Out.Write($loginProcess.Id)`;
  return ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')];
}
async function launchOriginalLogin({executable,args,env,platform=process.platform,runImpl=run}){
  if(platform!=='win32')throw Object.assign(Error('Visible login launch is not implemented on this platform.'),{code:'unsupported_platform'});
  const systemRoot=env.SystemRoot||env.WINDIR;
  if(!systemRoot||!path.win32.isAbsolute(systemRoot))throw Error('Windows shell is unavailable.');
  const shell=path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const result=await runImpl(shell,buildWindowsLogin(executable,args),{env,windowsHide:true,shell:false,timeout:15000,maxBuffer:8192,encoding:'utf8'});
  if(!/^[1-9]\d{0,9}$/.test(String(result.stdout||'').trim()))throw Error('Login process startup was not confirmed.');
  return {opened:true};
}
function parseStatus(provider,result){
  const stdout=typeof result.stdout==='string'?result.stdout:'',stderr=typeof result.stderr==='string'?result.stderr:'';
  if(stdout.length+stderr.length>65536)return {state:'unknown',method:null,code:'invalid_status'};
  if(provider==='claude'){
    let data;try{data=JSON.parse(stdout);}catch{return {state:'unknown',method:null,code:'invalid_status'};}
    if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.loggedIn!=='boolean')return {state:'unknown',method:null,code:'invalid_status'};
    if(!data.loggedIn&&(result.exitCode===1||result.exitCode===0))return {state:'signed_out',method:null,code:null};
    if(!data.loggedIn||result.exitCode!==0)return {state:'unknown',method:null,code:'check_failed'};
    const method=data.authMethod==='claude.ai'?'claude.ai':['api_key','api_key_helper'].includes(data.authMethod)?'api_key':['oauth_token','third_party'].includes(data.authMethod)?'other':null;
    return method?{state:'signed_in',method,code:null}:{state:'unknown',method:null,code:'invalid_status'};
  }
  if(result.exitCode===0){
    // The official status command's zero exit means credentials are present.
    // Its output can contain private data: derive an enum, never return it.
    const text=stdout+'\n'+stderr;
    const method=/logged in using chatgpt/i.test(text)?'chatgpt':/api\s*key/i.test(text)?'api_key':'other';
    return {state:'signed_in',method,code:null};
  }
  if(result.exitCode===1&&/(?:^|\n)\s*not logged in[.!]?\s*(?:\n|$)/i.test(stdout+'\n'+stderr))return {state:'signed_out',method:null,code:null};
  return {state:'unknown',method:null,code:'check_failed'};
}
function createProviderLogin({platform=process.platform,env=process.env,runImpl=run,launchImpl,discoverImpl,now=Date.now,timeoutMs=10000,loginCooldownMs=30000}={}){
  const checks=new Map(),launches=new Map(),openedAt=new Map();
  const discover=async provider=>{
    checkProvider(provider);let executable;
    try{executable=await (discoverImpl?discoverImpl(provider):discoverExecutable(provider,{platform,env}));}catch{return {provider,installed:false,version:null,code:'discovery_failed'};}
    if(!executableValid(executable,platform))return {provider,installed:false,version:null,code:'not_installed'};
    let version=null;
    try{const result=await runImpl(executable,['--version'],{env:loginEnvironment(env,provider,{platform}),windowsHide:true,shell:false,timeout:timeoutMs,maxBuffer:8192,encoding:'utf8'});const output=typeof result.stdout==='string'?result.stdout:'';version=output.length<=8192?output.match(/\b\d{1,5}\.\d{1,5}\.\d{1,5}\b/)?.[0]||null:null;}catch{}
    return {provider,installed:true,version,code:null,executable};
  };
  const check=async provider=>{
    const found=await discover(provider),checkedAt=now();
    if(!found.installed)return {provider,installed:false,state:found.code==='not_installed'?'not_installed':'unknown',method:null,version:null,checkedAt,code:found.code};
    let result;
    try{result={...await runImpl(found.executable,STATUS_ARGS[provider],{env:loginEnvironment(env,provider,{platform}),windowsHide:true,shell:false,timeout:timeoutMs,maxBuffer:65536,encoding:'utf8'}),exitCode:0};}
    catch(error){result={stdout:error?.stdout,stderr:error?.stderr,exitCode:Number.isInteger(error?.code)?error.code:null};}
    const parsed=parseStatus(provider,result);if(parsed.state==='signed_in')openedAt.delete(provider);
    // Native login presence and program-runner compatibility are separate.
    // This version floor matches the runner's required permission protocol.
    if(provider==='claude'&&!parsed.code)parsed.code=claudeVersionCode(found.version);
    return {provider,installed:true,...parsed,version:found.version,checkedAt};
  };
  const status=provider=>{
    checkProvider(provider);if(checks.has(provider))return checks.get(provider);
    const operation=check(provider);checks.set(provider,operation);
    return operation.finally(()=>{if(checks.get(provider)===operation)checks.delete(provider);});
  };
  const login=provider=>{
    checkProvider(provider);if(launches.has(provider))return launches.get(provider);
    const operation=(async()=>{
      const current=await status(provider);
      if(current.state==='signed_in')return {provider,opened:false,code:'already_signed_in',status:current};
      if(!current.installed)return {provider,opened:false,code:current.code||'not_installed',status:current};
      if(platform!=='win32')return {provider,opened:false,code:'unsupported_platform',status:current};
      const opened=openedAt.get(provider);if(opened!==undefined&&now()-opened<loginCooldownMs)return {provider,opened:false,code:'login_in_progress',status:current};
      const found=await discover(provider);
      if(!found.installed)return {provider,opened:false,code:found.code||'not_installed',status:current};
      try{
        const result=await (launchImpl||launchOriginalLogin)({provider,executable:found.executable,args:[...LOGIN_ARGS[provider]],env:loginEnvironment(env,provider,{platform}),platform,runImpl});
        if(result?.opened!==true)throw Error('Login startup was not confirmed.');
        openedAt.set(provider,now());return {provider,opened:true,code:'opened',status:current};
      }catch{return {provider,opened:false,code:'launch_failed',status:current};}
    })();launches.set(provider,operation);
    return operation.finally(()=>{if(launches.get(provider)===operation)launches.delete(provider);});
  };
  return {status,login,discover:async provider=>{const {executable,...result}=await discover(provider);return result;}};
}
module.exports={createProviderLogin,discoverExecutable,loginEnvironment,parseStatus,buildWindowsLogin,launchOriginalLogin};
