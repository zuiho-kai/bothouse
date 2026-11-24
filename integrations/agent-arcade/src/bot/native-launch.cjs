'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {atomicJSON}=require('../core/files.cjs');
const {findExecutable}=require('../core/platform.cjs');
const run=promisify(execFile);
function psLiteral(value){return `'${value.replace(/'/g,"''")}'`;}
// Windows: `node` and `claude` come from the user's PATH, as they always did.
// macOS and Linux: an app started from Finder, the Dock or a desktop launcher can
// have a PATH without the user's tools, so PATH is searched first and then the
// usual install locations (core/platform.cjs). No shell is started.
async function discoverNative({platform=process.platform,env=process.env,runImpl=run,exists=fs.existsSync,find=findExecutable}={}){
  const windows=platform==='win32',nodeCommand=windows?'node':find('node',{platform,env});
  if(!nodeCommand)throw Error('Install Node.js 22.13+ and restart the app.');
  const runtime=JSON.parse((await runImpl(nodeCommand,['-p','JSON.stringify({path:process.execPath,version:process.versions.node})'],{timeout:5000,windowsHide:true})).stdout.trim());
  const node=runtime.path,parts=runtime.version?.split('.').map(Number);
  if(!path.isAbsolute(node)||!parts||parts[0]<22||parts[0]===22&&parts[1]<13)throw Error('Install Node.js 22.13+ and restart the app.');
  let cli;
  if(windows){
    const local=path.join(env.USERPROFILE||'','.local','bin','claude.exe');
    if(exists(local))cli=local;
    else{const found=(await runImpl('where.exe',['claude.exe'],{timeout:5000,windowsHide:true})).stdout.split(/\r?\n/).find(p=>path.isAbsolute(p)&&exists(p));cli=found;}
  }else cli=find('claude',{platform,env});
  if(!cli||!path.isAbsolute(cli))throw Error('Install the native Claude Code CLI and log in through its own terminal.');
  const version=(await runImpl(cli,['--version'],{timeout:10000,windowsHide:true})).stdout;
  const numbers=version.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
  if(!numbers||numbers[0]<2||(numbers[0]===2&&numbers[1]===1&&numbers[2]<317)||numbers[0]===2&&numbers[1]<1)throw Object.assign(Error('Claude Code 2.1.317+ is required for this native preview.'),{code:'unsupported_version',version:numbers?.join('.')||''});
  return {node,cli};
}
// POSIX single-quote literal: nothing inside is expanded; an embedded quote
// closes the literal, adds an escaped quote and reopens it.
function shLiteral(value){return `'${String(value).replace(/'/g,"'\\''")}'`;}
function createNativeLaunch({root,workspace,url,token,node,cli,sourceDir,persona={enabled:true,selection:'default'},resumeSessionId,platform=process.platform}){
  if(resumeSessionId!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resumeSessionId))throw Error('Resume requires an exact session UUID.');
  const sessionId=resumeSessionId||crypto.randomUUID();
  const script=path.join(sourceDir,'native-channel.cjs').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
  if(!fs.existsSync(script))throw Error('The native channel script is missing from the application package.');
  const folder=path.join(root,'native-launch',crypto.randomUUID()),file=path.join(folder,'mcp.json');
  atomicJSON(file,{mcpServers:{'agent-arcade-wechat':{command:node,args:[script],env:{ARCADE_BRIDGE_URL:url,ARCADE_BRIDGE_TOKEN:token,
    ARCADE_PERSONA_VOICE:persona?.enabled === undefined || persona.enabled === true ? '1' : '0',
    ARCADE_PERSONA_SELECTION:persona?.selection === 'sprout' ? 'sprout' : 'default'}}}});
  let command;
  const options='--allowedTools mcp__agent-arcade-wechat__reply --permission-mode default --strict-mcp-config';
  const sessionFlag=resumeSessionId?'--resume':'--session-id';
  const args=['--allowedTools','mcp__agent-arcade-wechat__reply','--permission-mode','default','--strict-mcp-config',sessionFlag,sessionId,'--mcp-config',file,'--dangerously-load-development-channels','server:agent-arcade-wechat'];
  const env={CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF:'1'};
  if(platform==='win32')command=`Set-Location -LiteralPath ${psLiteral(workspace)}\n$arcadePreviousHandoff=$env:CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF\ntry { $env:CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF='1'; & ${psLiteral(cli)} ${options} ${sessionFlag} ${psLiteral(sessionId)} --mcp-config ${psLiteral(file)} --dangerously-load-development-channels server:agent-arcade-wechat } finally { $env:CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF=$arcadePreviousHandoff }`;
  else{const quote=shLiteral;command=`cd -- ${quote(workspace)}\nCLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF=1 ${quote(cli)} ${options} ${sessionFlag} ${quote(sessionId)} --mcp-config ${quote(file)} --dangerously-load-development-channels server:agent-arcade-wechat`;}
  return {command,file,cli,args,workspace:path.resolve(workspace),env,sessionId,resume:!!resumeSessionId,cleanup:()=>{try{fs.unlinkSync(file);fs.rmdirSync(folder);}catch{/* Another process may still have a read handle. The broker capability is already revoked. */}}};
}
module.exports={discoverNative,createNativeLaunch,psLiteral,shLiteral};
