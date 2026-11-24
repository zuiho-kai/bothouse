'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const { serviceOrigin } = require('./endpoint.cjs');
const { releaseContact } = require('./support.cjs');

const testName = 'AgentArcade.Social.PackagingTest';
const unsignedOID = 'OID.2.25.311729368913984317654407730594956997722=1';
const testPublisher = 'CN=Agent Arcade Social Packaging Test';
const testIdentity = { name: testName, publisher: testPublisher + ', ' + unsignedOID,
    displayName: 'Agent Arcade (Packaging Test)', publisherDisplayName: 'Agent Arcade local test' };
const packageRoot = path.resolve(__dirname, '../..');

const sdk = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
const defaultPackager = path.join(sdk, 'Windows Kits/10/bin/10.0.26100.0/x64/makeappx.exe');
const esc = str => str.replace(/[<>&"']/gu, char => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[char]));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const localClaudePackage = /(?:^|\/)(?:@|%40)anthropic-ai\/claude-agent-sdk(?:-[^/]+)?(?:\/|$)/iu;

function auditPackageContents(input) {
  const items = fs.statSync(input).isDirectory()
    ? fs.readdirSync(input,{recursive:true})
    : execFileSync('tar.exe',['-tf',input],{windowsHide:true,encoding:'utf8',maxBuffer:32*1024*1024}).split(/\r?\n/u);
  const entries = new Set(items.map(item=>item.replaceAll('\\','/').toLowerCase()));
  const excluded = [...entries].filter(item=>localClaudePackage.test(item) || /(?:^|\/)claude(?:\.exe)?$/u.test(item));
  assert(!excluded.length, 'Local-only Claude Agent runtime in package: '+excluded.slice(0,5).join(', '));
  const app = 'social/resources/app/';
  for (const name of ['src/bot/runner.cjs','license','third_party_notices.md']) {
    assert(entries.has(app+name), 'Missing required package entry: '+app+name);
  }
  const sdk = 'anthropic-ai/sdk/package.json';
  assert(entries.has(app+'node_modules/@'+sdk)||entries.has(app+'node_modules/%40'+sdk),
    'Missing the required Anthropic API SDK.');
  return { cloudApiSdk:true, localClaudeAgentRuntime:false };
}

function identityFor(mode, identityFile) {
  if (['test', 'test-signed'].includes(mode)) {
    assert(!identityFile, 'Use the isolated test identity without a Partner Center file.');
    return mode==='test' ? testIdentity : { ...testIdentity, publisher: testPublisher };
  }
  assert.equal(mode, 'store');
  assert(identityFile, 'Store builds need the reserved identity from Partner Center.');
  const identity = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
  assert.deepEqual(Object.keys(identity).sort(), Object.keys(testIdentity).sort());
  assert(Object.values(identity).every(value => typeof value === 'string' && value.trim() === value &&
    value.length > 0 && !value.startsWith('COPY_') && !/[\u0000-\u001f]/u.test(value)));
  assert(/^[a-zA-Z0-9.-]{3,50}$/u.test(identity.name));
  assert(identity.publisher.startsWith('CN=') && !identity.publisher.includes(unsignedOID) &&
    identity.name.toLowerCase() !== testName.toLowerCase(), 'A test identity cannot be used for Store uploads.');
  return identity;
}

function pngAsset(PNG, logo, size) {
  const canvas = new PNG({ width: size, height: size });
  const scale = size * 0.8 / Math.max(logo.width, logo.height);
  const width = Math.round(logo.width * scale), height = Math.round(logo.height * scale);
  const left = Math.floor((size - width) / 2), top = Math.floor((size - height) / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (Math.floor(y * logo.height / height) * logo.width + Math.floor(x * logo.width / width)) * 4;
      const dest = ((top + y) * size + left + x) * 4;
      logo.data.copy(canvas.data, dest, source, source + 4);
    }
  }
  return PNG.sync.write(canvas);
}

function copyProductionDependencies(destination, source) {
  const {packages}=JSON.parse(fs.readFileSync(path.join(packageRoot,'package-lock.json'),'utf8'));
  let count=0;
  for (const [name, record] of Object.entries(packages)) {
    // Match the desktop electron-builder exclusion, even when npm installed
    // the optional Agent SDK and one or more of its platform distributions.
    if (!name.startsWith('node_modules/') || record.dev || localClaudePackage.test(name)) continue;
    const folder=path.join(source,name), manifest=path.join(folder,'package.json');
    if (record.optional && !fs.existsSync(manifest)) continue;
    assert(fs.existsSync(manifest), 'Install the locked runtime dependency: '+name);
    assert(!fs.lstatSync(folder).isSymbolicLink(), 'Linked dependencies cannot enter the MSIX: '+name);
    assert.equal(JSON.parse(fs.readFileSync(manifest,'utf8')).version,record.version,'Dependency version mismatch: '+name);
    const output=path.join(destination,name);
    fs.cpSync(folder,output,{
      recursive:true,
      filter:(entry)=>entry===folder || (path.basename(entry)!=='node_modules'&&!fs.lstatSync(entry).isSymbolicLink()),
    });
    count++;
  }
  return count;
}

function build(args) {
  const { values } = parseArgs({ args, options: {
    mode: { type: 'string' }, origin: { type: 'string' }, 'world-origin': { type: 'string' }, version: { type: 'string' },
    identity: { type: 'string' }, 'dependency-root': { type: 'string' }, 'production-root': { type: 'string' }, makeappx: { type: 'string' },
    'source-handoff': { type: 'string' },
    'operator-name': { type: 'string' }, support: { type: 'string' },
  } });
  const { mode, version } = values;
  assert(process.platform === 'win32', 'This package builder requires Windows.');
  assert(typeof version === 'string' && /^\d+\.\d+\.\d+\.0$/u.test(version) &&
    version.split('.').every(part => Number(part) <= 65535 && String(Number(part)) === part) &&
    Number(version.split('.')[0]) > 0, 'Use a four-part MSIX version with nonzero major and fourth part 0.');
  const origin = serviceOrigin(values.origin, mode);
  const littleWorldsOrigin = values['world-origin'] === undefined ? undefined : serviceOrigin(values['world-origin'], mode);
  const identity = identityFor(mode, values.identity);
  const offlineSupport = mode==='store' ? releaseContact({
    mode,origin,operatorName:values['operator-name'],support:values.support,
  }) : undefined;
  assert(mode!=='store'||values['source-handoff'], 'Store builds need the frozen source handoff.');
  const dependencyRoot = path.resolve(values['dependency-root'] ?? packageRoot);
  const electronPackage = require.resolve('electron/package.json', { paths: [dependencyRoot] });
  const electron = JSON.parse(fs.readFileSync(electronPackage, 'utf8'));
  const runtime = path.join(path.dirname(electronPackage), 'dist');
  const bin = fs.readFileSync(path.join(runtime, 'electron.exe'));
  assert.equal(bin.readUInt16LE(bin.readUInt32LE(0x3c) + 4), 0x8664, 'Expected official x64 Electron.');
  const { PNG } = require(require.resolve('pngjs', { paths: [dependencyRoot] }));
  const makeappx = values.makeappx ? path.resolve(values.makeappx) : defaultPackager;
  assert(fs.statSync(makeappx).isFile());
  const out = path.join(__dirname, 'out');
  fs.mkdirSync(out, { recursive: true });
  const run = fs.mkdtempSync(path.join(out, mode+'-'));
  const staged = path.join(run, 'stage'), executable = path.join(staged, 'Social');
  // Copy the bare Electron runtime and construct the application payload below.
  const ship = new Set(['chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll','dxcompiler.dll',
    'dxil.dll','electron_wer.dll','ffmpeg.dll','icudtl.dat','libEGL.dll','libGLESv2.dll','LICENSE',
    'LICENSES.chromium.html','resources.pak','snapshot_blob.bin','v8_context_snapshot.bin','vk_swiftshader.dll',
    'vk_swiftshader_icd.json','vulkan-1.dll','version','locales']);
  fs.mkdirSync(executable, { recursive: true });
  for (const name of fs.readdirSync(runtime)) {
    if (ship.has(name)) fs.cpSync(path.join(runtime, name), path.join(executable, name), { recursive: true });
  }
  fs.writeFileSync(path.join(executable, 'AgentArcadeSocial.exe'), bin);
  const app = path.join(executable, 'resources', 'app');
  fs.mkdirSync(app, { recursive: true });
  let releaseSource;
  if(values['source-handoff']){
    execFileSync('python',[path.join(packageRoot,'social/deploy/stage-release-source.py'),'desktop',packageRoot,
      path.resolve(values['source-handoff']),app,'--version',version],{windowsHide:true,stdio:'inherit'});
    releaseSource=JSON.parse(fs.readFileSync(path.join(app,'source-release.json'),'utf8'));
  }
  const storeUpdateBinary = path.join(app,'store-update.node');
  try {
    execFileSync('cl.exe', ['/nologo','/std:c++20','/EHsc','/O2','/MT','/LD',path.join(__dirname,'store-update.cpp'),
      '/link','/MACHINE:X64','/OUT:'+storeUpdateBinary,'windowsapp.lib','ole32.lib','user32.lib'],
    {cwd:run,windowsHide:true});
  } catch (error) {
    throw new Error('Could not build the Store update bridge. Use x64 Visual Studio Developer PowerShell with the Windows SDK.\n'+
      String(error.stdout || error.message).trim(),{cause:error});
  }
  fs.copyFileSync(path.join(__dirname,'main.cjs'),path.join(app,'store-main.cjs'));
  for (const name of ['endpoint.cjs','social-view.cjs','social-host.cjs','privacy-preload.cjs'])
    fs.copyFileSync(path.join(__dirname,name),path.join(app,name));
  fs.cpSync(path.join(__dirname,'chat-capture'),path.join(app,'chat-capture'),{recursive:true});
  for (const name of ['src','LICENSE','LICENSE-MIT-HISTORICAL','THIRD_PARTY_NOTICES.md','LICENSES'])
    fs.cpSync(path.join(packageRoot,name),path.join(app,name),{recursive:true});
  const sourcePackage=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));
  assert.equal(electron.version, sourcePackage.devDependencies.electron, 'Use the locked Electron runtime.');
  const dependencies=copyProductionDependencies(app,path.resolve(values['production-root'] ?? packageRoot));
  fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({
    name:'agent-arcade-store',productName:'Agent Arcade',main:'store-main.cjs',
    version:version.split('.').slice(0,3).join('.'),license:sourcePackage.license,storeEdition:true,
  }));
  fs.writeFileSync(path.join(app, 'service.json'), JSON.stringify({ origin, littleWorldsOrigin, mode, desktopVersion: version, releaseSource, offlineSupport }));
  const logo = PNG.sync.read(fs.readFileSync(path.join(packageRoot, 'src/assets/brand/ribbon-simple-v1.png')));
  const assets = path.join(staged, 'Assets');
  fs.mkdirSync(assets);
  for (const [name, size] of [['Square150x150Logo',150], ['Square44x44Logo',44], ['StoreLogo',50]]) {
    fs.writeFileSync(path.join(assets, name + '.png'), pngAsset(PNG, logo, size));
  }
  const fields = { ...identity, version };
  const xml = fs.readFileSync(path.join(__dirname, 'manifest.xml'), 'utf8')
    .replace(/\{\{(\w+)\}\}/gu, (_, key) => esc(fields[key]));
  fs.writeFileSync(path.join(staged, 'AppxManifest.xml'), xml);
  auditPackageContents(staged);
  const file = path.join(run, 'AgentArcadeSocial-' + version + '-x64.msix');
  try {
    execFileSync(makeappx, ['pack','/d',staged,'/p',file], {windowsHide:true,maxBuffer:32*1024*1024});
  } catch (error) {
    const tail=String(error.stdout || '').trim().split(/\r?\n/u).slice(-8).join('\n');
    throw new Error('MakeAppx failed'+(tail?'\n'+tail:''),{cause:error});
  }
  const runtimeContents = auditPackageContents(file);
  const receipt = { mode, version, identity: identity.name, publisher: identity.publisher, origin, littleWorldsOrigin,
    packagingOnly: mode !== 'store', electron: electron.version, productionDependencies:dependencies, runtimeSha256: hash(bin),
    executable: 'Social/AgentArcadeSocial.exe', manifestSha256: hash(xml), storeUpdateSha256:hash(fs.readFileSync(storeUpdateBinary)),
    file, sha256: hash(fs.readFileSync(file)), releaseSource, offlineSupport, runtimeContents };
  fs.writeFileSync(path.join(run, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const result = args[0]==='--audit' && args.length===2 ? auditPackageContents(path.resolve(args[1])) : build(args);
    console.log(JSON.stringify(result, null, 2));
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { identityFor, escapeXml: esc, auditPackageContents };
