'use strict';
// Original, opt-in preparation for an independently obtained LLBot runtime.
// No bridge is downloaded, executed, logged in, updated or re-signed here.
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomBytes} = require('node:crypto');
const {execFile, spawnSync} = require('node:child_process');
const {validateQQOwner, validateQQUrl} = require('./qq.cjs');

const RELEASE = Object.freeze({
  name: 'LuckyLillia-CLI-macos-arm64.tar.xz', version: '8.3.2',
  sourceCommit: 'dc2b2b90092ef0f571b5546878288b83fff1e436',
  archiveBytes: 63920660,
  archiveSha256: '51de5ea81741b49302e0aadf740250edfe88c046bf33714cee3250d74a4bfb7b',
  files: Object.freeze({
    LuckyLillia: [1537536, 'd29b934ce570d801a065444dab0ae1567ab7d58c9b2b7452cb07d065354dbd53'],
    'bin/llbot/node': [117675408, '6f2e835e57feb7a29ffcd53a4d4eb60224ec264a1e002c3ba6d99999ea29807d'],
    'bin/llbot/llbot.js': [2561912, '83707ca9764d5fba040db52cdfaf5ec91735e40bbb0857c41dd44dcb5c73e81c'],
    'bin/llbot/sign-proxy.darwin-arm64.node': [3497216, 'd5a5ab71f9eebf547049c9d1dcfc061dbdac3f8df2919ce1d3298dc94dc6b790'],
  }),
});
const NODE_REQUIREMENT = '=identifier "node" and anchor apple generic and certificate leaf[subject.OU] = "HX7739G8FX"';
const NEXT = Object.freeze({
  unsupported_platform: 'This checked runtime is macOS arm64 only; select a separately verified runtime for another platform.',
  runtime_incomplete: 'Choose the extracted LLBot folder containing LuckyLillia and bin/llbot. One of the pinned entrypoints is missing.',
  unsafe_path: 'Use a canonical absolute path without symbolic links. Existing data was not changed.',
  runtime_changed: 'Obtain the exact upstream v8.3.2 archive and verify its published SHA-256 before preparing it.',
  runtime_signature_unverified: 'The runtime signature could not be verified. Check the verification environment or obtain a valid upstream runtime; do not clear quarantine, disable protections or re-sign to hide this failure.',
  node_signature_unverified: 'The selected Node signature could not be verified. Keep its bytes unchanged and check the verifier permissions; obtain a valid upstream package or explicitly select an independently verified Node.js Foundation Node 24+ using --node.',
  node_not_executable: 'The signed Node file has no execute permission. Select a separate executable copy from the official Node.js distribution using --node.',
  node_version_unverified: 'The signed Node executable did not return a valid version of Node 24 or later. Select a working official Node.js executable using --node.',
  target_exists: 'Choose a new directory. Existing bridge configuration, sessions and tokens will not be overwritten.',
  invalid_configuration: 'Provide the dedicated AI QQ account number and an integer loopback port from 1024 to 65535.',
  preparation_failed: 'Configuration preparation did not complete. Retain the private directory for inspection; no bridge was started.',
  prepared_configuration_changed: 'The private preparation no longer matches this companion. Prepare a new directory or explicitly link a matching existing preparation; no bridge was started.',
});
class MacQQBridgeError extends Error {
  constructor(code) { super(NEXT[code] || 'Mac QQ bridge preparation failed.'); this.code = code; }
}
const fail = code => { throw new MacQQBridgeError(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const preparations = new WeakMap();
const PLAN_KEYS = ['schema','configurationOnly','bridgeStarted','loggedIn','runtimeRelease','executable','cwd','args','endpoint','configFile','remaining'];
const REMAINING = ['verify_full_runtime_contents','upstream_auth_token','verified_nonlogin_startup','owner_QQ_login','exact_account_and_group_acceptance'];
const exact = (value,keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key=>Object.hasOwn(value,key));

function safePath(value) {
  return typeof value === 'string' && value.isWellFormed() && path.isAbsolute(value) && path.normalize(value) === value &&
    Buffer.byteLength(value,'utf8') <= 4096 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}
function canonical(value, {directory = false, missingCode = 'unsafe_path'} = {}) {
  if (!safePath(value)) fail('unsafe_path');
  let current = path.parse(value).root;
  for (const part of value.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat; try { stat = fs.lstatSync(current); } catch(error) { fail(error?.code==='ENOENT'?missingCode:'unsafe_path'); }
    if (stat.isSymbolicLink()) fail('unsafe_path');
    if (current !== value && !stat.isDirectory()) fail('unsafe_path');
  }
  const stat = fs.lstatSync(value);
  if (directory ? !stat.isDirectory() : !stat.isFile()) fail('unsafe_path');
  if (fs.realpathSync(value) !== value) fail('unsafe_path');
  return stat;
}
function arm64(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(8); if (fs.readSync(fd, header, 0, 8, 0) !== 8) return false;
    return header.readUInt32LE(0) === 0xfeedfacf && header.readUInt32LE(4) === 0x0100000c;
  } finally { fs.closeSync(fd); }
}
const probeOptions={encoding:'utf8',timeout:10000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin',LANG:'C'}};
const codesign=file=>['/usr/bin/codesign',['--verify','--strict',file]];

function* inspectProbes(runtimeRoot,{nodeExecutable,platform=process.platform,arch=process.arch}={},release=RELEASE){
  if (platform !== 'darwin' || arch !== 'arm64') fail('unsupported_platform');
  canonical(runtimeRoot, {directory: true});
  const files = [];
  for (const [relative, [size, digest]] of Object.entries(release.files)) {
    const file = path.join(runtimeRoot, relative), stat = canonical(file,{missingCode:'runtime_incomplete'});
    if (stat.size !== size || hash(fs.readFileSync(file)) !== digest) fail('runtime_changed');
    if (relative !== 'bin/llbot/llbot.js' && !arm64(file)) fail('runtime_changed');
    files.push({path: relative, bytes: size, sha256: digest});
  }
  for (const relative of ['LuckyLillia', 'bin/llbot/sign-proxy.darwin-arm64.node']) {
    if ((yield codesign(path.join(runtimeRoot,relative))).status!==0) fail('runtime_signature_unverified');
  }
  const bundledNode = path.join(runtimeRoot, 'bin/llbot/node');
  const bundledNodeValid = (yield codesign(bundledNode)).status===0;
  if (!nodeExecutable && !bundledNodeValid) fail('node_signature_unverified');
  const selectedNode = nodeExecutable || bundledNode;
  canonical(selectedNode);
  if(!arm64(selectedNode))fail('node_signature_unverified');
  const trusted=yield ['/usr/bin/codesign',['--verify','--strict','-R',NODE_REQUIREMENT,selectedNode]];
  if(trusted.status!==0)fail('node_signature_unverified');
  if (typeof process.getuid === 'function' && !(canonical(selectedNode).mode & 0o111)) fail('node_not_executable');
  // Only a verified official Node executable receives this fixed argument.
  // llbot.js, the launcher and native sign-proxy are never executed by this API.
  const result=yield [selectedNode,['--version']];
  const version = result.status === 0 && /^v(\d+)\.(\d+)\.(\d+)\s*$/.exec(result.stdout || '');
  if (!version || Number(version[1]) < 24) fail('node_version_unverified');
  return {schema: 1, release: release.version, runtimeRoot, nodeExecutable: selectedNode,
    nodeVersion: version[0].trim(), bundledNodeValid, files,
    identityScope: 'pinned_entrypoints_only', allRuntimeFilesVerified: false,
    bridgeStarted: false, loggedIn: false, oneBotVerified: false,
    warning: bundledNodeValid ? null : 'bundled_node_rejected_explicit_node_override',
  };
}

function inspectMacQQBridge(runtimeRoot,options,{run=spawnSync,release=RELEASE}={}){
  const steps=inspectProbes(runtimeRoot,options,release);
  let step=steps.next();
  while(!step.done){
    const [file,args]=step.value;
    let result;
    try{result=run(file,args,{...probeOptions,stdio:['ignore','pipe','pipe']});}
    catch{result={status:-1};}
    step=steps.next(result);
  }
  return step.value;
}
async function inspectMacQQBridgeAsync(runtimeRoot,options){
  const steps=inspectProbes(runtimeRoot,options);
  let step=steps.next();
  while(!step.done){
    const [file,args]=step.value;
    const result=await new Promise(resolve=>execFile(file,args,probeOptions,(error,stdout)=>{
      resolve({status:error?-1:0,stdout});
    }));
    step=steps.next(result);
  }
  return step.value;
}

function prepareInput({runtimeRoot,nodeExecutable,targetDirectory,accountId,port=3001}={}){
  if(!Number.isSafeInteger(port)||port<1024||port>65535)fail('invalid_configuration');
  try{accountId=validateQQOwner(accountId);}catch{fail('invalid_configuration');}
  if(!safePath(targetDirectory))fail('unsafe_path');
  canonical(path.dirname(targetDirectory),{directory:true});
  if(fs.existsSync(targetDirectory))fail('target_exists');
  return {runtimeRoot,nodeExecutable,targetDirectory,accountId,port};
}
function prepareMacQQBridge(value,dependencies){
  const input=prepareInput(value);
  const inspected=inspectMacQQBridge(input.runtimeRoot,{nodeExecutable:input.nodeExecutable,
    platform:dependencies?.platform,arch:dependencies?.arch},dependencies);
  return writePreparation(input,inspected);
}
async function prepareMacQQBridgeAsync(value,beforeWrite){
  const input=prepareInput(value);
  const inspected=await inspectMacQQBridgeAsync(input.runtimeRoot,{nodeExecutable:input.nodeExecutable});
  beforeWrite();
  canonical(path.dirname(input.targetDirectory),{directory:true});
  return writePreparation(input,inspected);
}
function writePreparation({runtimeRoot,targetDirectory,accountId,port},inspected){
  const endpoint = validateQQUrl(`ws://127.0.0.1:${port}/`);
  const token = randomBytes(32).toString('base64url');
  const config = {
    webui: {enable: false, host: '127.0.0.1', port: 3080},
    ob11: {enable: true, connect: [{type: 'ws', enable: true, host: '127.0.0.1', port,
      token, messageFormat: 'array', heartInterval: 60000, reportSelfMessage: false,
      reportOfflineMessage: false, debug: false}]},
    satori: {enable: false, host: '127.0.0.1', port: 5600, token: ''},
    milky: {enable: false, reportSelfMessage: false},
    enableLocalFile2Url: false, log: false, logLevel: 'info', autoDeleteFile: false,
    autoDeleteFileSecond: 60, msgCacheExpire: 120, ffmpeg: '', musicSignUrl: '',
  };
  try {
    // mkdir is exclusive. No existing profile/config/session is adopted.
    fs.mkdirSync(targetDirectory, {mode: 0o700});
    fs.mkdirSync(path.join(targetDirectory, 'data'), {mode: 0o700});
    const write = (file, text) => fs.writeFileSync(path.join(targetDirectory, file), text, {mode: 0o600, flag: 'wx'});
    const configFile = `data/config_${accountId}.json`;
    const configuration = JSON.stringify(config, null, 2) + '\n';
    write(configFile, configuration);
    write('onebot-token.txt', token + '\n');
    const launchPlan = JSON.stringify({schema: 1, configurationOnly: true,
      bridgeStarted: false, loggedIn: false, runtimeRelease: inspected.release,
      executable: inspected.nodeExecutable, cwd: targetDirectory,
      args: [path.join(runtimeRoot, 'bin/llbot/llbot.js'), `--qq=${accountId}`, '--protocol=macos'],
      endpoint, configFile, remaining: REMAINING,
    }, null, 2) + '\n';
    write('launch-plan.json',launchPlan);
    const receipt = {prepared: true, configurationOnly: true, targetDirectory, endpoint,
      configFile: path.join(targetDirectory, configFile), tokenFile: path.join(targetDirectory, 'onebot-token.txt'),
      bridgeStarted: false, loggedIn: false, nodeVersion: inspected.nodeVersion,
      warning: inspected.warning};
    preparations.set(receipt,{accountId,endpoint,targetDirectory,configFile:receipt.configFile,tokenFile:receipt.tokenFile,
      configurationHash:hash(configuration),tokenHash:hash(token+'\n'),planSha256:hash(launchPlan)});
    return receipt;
  } catch (error) {
    if (error.code === 'EEXIST') fail('target_exists');
    fail('preparation_failed');
  }
}

function readPrivatePreparationFile(file, limit, missingCode) {
  const uid = process.getuid();
  const expected = canonical(file,{missingCode});
  if (expected.uid !== uid || (expected.mode & 0o077) || expected.nlink !== 1 || expected.size > limit) fail('prepared_configuration_changed');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino ||
        opened.uid !== uid || (opened.mode & 0o077) || opened.nlink !== 1 || opened.size !== expected.size) fail('prepared_configuration_changed');
    const data = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < data.length) {
      const read = fs.readSync(fd, data, size, data.length - size, null);
      if (!read) break;
      size += read;
    }
    if (size !== opened.size) fail('prepared_configuration_changed');
    return data.subarray(0,size);
  } finally {
    fs.closeSync(fd);
  }
}

// Only receipts issued in this main process are accepted. The renderer never
// supplies paths, endpoints, token data or the dedicated account to this step.
function readPreparedMacQQ(receipt) {
  try {
    const expected = preparations.get(receipt);
    if (!expected || receipt.targetDirectory !== expected.targetDirectory || receipt.configFile !== expected.configFile ||
        receipt.tokenFile !== expected.tokenFile) fail('prepared_configuration_changed');
    for (const folder of [receipt.targetDirectory,path.join(receipt.targetDirectory,'data')]) {
      const stat = canonical(folder,{directory:true});
      if (stat.uid !== process.getuid() || (stat.mode & 0o077)) fail('prepared_configuration_changed');
    }
    const configuration = readPrivatePreparationFile(receipt.configFile,16384);
    const tokenFile = readPrivatePreparationFile(receipt.tokenFile,44);
    if (hash(configuration) !== expected.configurationHash || hash(tokenFile) !== expected.tokenHash) fail('prepared_configuration_changed');
    const connection = {accountId:expected.accountId,endpoint:expected.endpoint,token:tokenFile.toString('ascii').trimEnd()};
    const launch = {schema:1,targetDirectory:expected.targetDirectory,planSha256:expected.planSha256};
    readLaunchPreparation(launch.targetDirectory,connection,launch.planSha256);
    return {...connection,launch};
  } catch {
    fail('prepared_configuration_changed');
  }
}


function privateDirectory(directory) {
  const stat = canonical(directory,{directory:true,missingCode:'prepared_launch_missing'});
  if (stat.uid !== process.getuid() || (stat.mode & 0o077)) fail('prepared_configuration_changed');
}

function readLaunchPreparation(directory,connection,planSha256) {
  const changed = () => fail('prepared_configuration_changed');
  if (!connection || validateQQOwner(connection.accountId) !== connection.accountId ||
      typeof connection.token !== 'string' || !/^[\w-]{43}$/u.test(connection.token)) changed();
  const endpoint = validateQQUrl(connection.endpoint);
  if (endpoint !== connection.endpoint) changed();
  const address = new URL(endpoint);
  if (address.protocol !== 'ws:' || address.hostname !== '127.0.0.1' || address.pathname !== '/' ||
      address.search || address.hash || Number(address.port) < 1024) changed();
  privateDirectory(directory);
  privateDirectory(path.join(directory,'data'));
  const bytes = readPrivatePreparationFile(path.join(directory,'launch-plan.json'),16384,'prepared_launch_missing');
  if (planSha256 !== undefined && (!/^[a-f0-9]{64}$/u.test(planSha256) || hash(bytes) !== planSha256)) changed();
  const plan = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if (!exact(plan,PLAN_KEYS) || plan.schema !== 1 || plan.configurationOnly !== true || plan.bridgeStarted !== false ||
      plan.loggedIn !== false || typeof plan.runtimeRelease !== 'string' || !plan.runtimeRelease || plan.runtimeRelease.length > 64 ||
      plan.cwd !== directory || plan.endpoint !== endpoint || plan.configFile !== `data/config_${connection.accountId}.json` ||
      JSON.stringify(plan.remaining) !== JSON.stringify(REMAINING) || !Array.isArray(plan.args) || plan.args.length !== 3 ||
      typeof plan.args[0] !== 'string' || plan.args[1] !== `--qq=${connection.accountId}` || plan.args[2] !== '--protocol=macos') changed();
  const runtimeRoot = path.dirname(path.dirname(path.dirname(plan.args[0])));
  if (plan.args[0] !== path.join(runtimeRoot,'bin/llbot/llbot.js')) changed();
  for (const file of new Set([plan.executable,...Object.keys(RELEASE.files).map(relative=>path.join(runtimeRoot,relative))])) {
    const stat = canonical(file,{missingCode:'prepared_launch_missing'});
    if (stat.nlink !== 1 || (file === plan.executable && !(stat.mode & 0o111))) changed();
  }
  const token = readPrivatePreparationFile(path.join(directory,'onebot-token.txt'),44,'prepared_launch_missing');
  if (!token.equals(Buffer.from(connection.token+'\n'))) changed();
  const configBytes = readPrivatePreparationFile(path.join(directory,plan.configFile),65536,'prepared_launch_missing');
  const config = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(configBytes));
  const peers = config?.ob11?.connect;
  const expected = {type:'ws',enable:true,host:'127.0.0.1',port:Number(address.port),token:connection.token,
    messageFormat:'array',heartInterval:60000,reportSelfMessage:false,reportOfflineMessage:false,debug:false};
  if (config?.ob11?.enable !== true || !Array.isArray(peers) || peers.length !== 1 ||
      !peers[0] || Object.entries(expected).some(([key,value])=>peers[0][key] !== value)) changed();
  return {plan,runtimeRoot,planSha256:hash(bytes)};
}

function authorizationState(directory) {
  try {
    // This is metadata only. The upstream authorization credential is never
    // read, copied, logged or returned to the renderer.
    const stat = canonical(path.join(directory,'data/auth_token.txt'),{missingCode:'prepared_launch_missing'});
    return stat.uid === process.getuid() && !(stat.mode & 0o077) && stat.nlink === 1 && stat.size > 0 && stat.size <= 16384 ?
      'present' : 'unverified';
  } catch(error) { return error?.code === 'prepared_launch_missing' ? 'missing' : 'unverified'; }
}
const shellQuote = value => "'"+value.replaceAll("'", "'\"'\"'")+"'";

// A persisted binding belongs to the main-process profile, never renderer input.
// This read performs no probes and does not start the bridge or Node.
function readMacQQLaunch(launch,connection) {
  const targetDirectory = safePath(launch?.targetDirectory) ? launch.targetDirectory : null;
  try {
    if (!exact(launch,['schema','targetDirectory','planSha256']) || launch.schema !== 1 ||
        typeof launch.planSha256 !== 'string') fail('prepared_configuration_changed');
    const {plan} = readLaunchPreparation(targetDirectory,connection,launch.planSha256);
    const authorization = authorizationState(targetDirectory);
    const command = 'cd -- '+shellQuote(targetDirectory)+' && '+[plan.executable,...plan.args].map(shellQuote).join(' ');
    return {state:'ready',targetDirectory,authorization,...(authorization === 'unverified' ? {} : {command})};
  } catch(error) {
    return {state:error?.code === 'prepared_launch_missing' ? 'missing' : 'changed',targetDirectory,authorization:'unverified'};
  }
}

// The caller must choose the directory through a native main-process dialog.
// Explicitly re-linking legacy preparation rechecks the pinned runtime trust;
// only the existing signed Node --version probe may execute.
async function linkMacQQLaunch(directory,connection,{inspect = inspectMacQQBridgeAsync} = {}) {
  let before;
  try { before = readLaunchPreparation(directory,connection); }
  catch(error) { fail(error?.code === 'prepared_launch_missing' ? 'preparation_failed' : 'prepared_configuration_changed'); }
  let inspected;
  try {
    if (typeof inspect !== 'function') fail('preparation_failed');
    inspected = await inspect(before.runtimeRoot,{nodeExecutable:before.plan.executable});
  } catch { fail('preparation_failed'); }
  if (inspected?.runtimeRoot !== before.runtimeRoot || inspected?.nodeExecutable !== before.plan.executable ||
      inspected?.release !== before.plan.runtimeRelease) fail('prepared_configuration_changed');
  try { readLaunchPreparation(directory,connection,before.planSha256); }
  catch(error) { fail(error?.code === 'prepared_launch_missing' ? 'preparation_failed' : 'prepared_configuration_changed'); }
  return {schema:1,targetDirectory:directory,planSha256:before.planSha256};
}

module.exports = {RELEASE, NODE_REQUIREMENT, MacQQBridgeError, inspectMacQQBridge, prepareMacQQBridge,
  inspectMacQQBridgeAsync,prepareMacQQBridgeAsync,readPreparedMacQQ,readMacQQLaunch,linkMacQQLaunch};
