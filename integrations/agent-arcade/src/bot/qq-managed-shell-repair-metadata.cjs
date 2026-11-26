'use strict';
// Fixed Shell recovery metadata only. Account configuration and QQ data are
// neither opened nor enumerated; normal code integrity readers stay unchanged.
const fs=require('node:fs'),path=require('node:path');
const F=require('./qq-node-repair-fs.cjs');
const VERSION='4.18.42',RELEASE_ID='napcat-shell-4.18.42-02e5ff0f79916c1e';
const SOURCE=Object.freeze({tag:'v4.18.42',assetId:691263446,sha256:'02e5ff0f79916c1e04c81c1b4590056406fb4293f1f1300c955e71fd08b2829d',size:35967555});
const REQUIRED=Object.freeze(['NapCatWinBootHook.dll','NapCatWinBootMain.exe','napcat.mjs','qqnt.json']);
function paths(root,setupId){
 root=F.local(root);if(setupId!==undefined&&!F.UUID.test(setupId))F.fail('invalid_request');
 const versionRoot=path.join(root,'qq-component-versions','napcat-shell',RELEASE_ID),recoveryRoot=path.join(root,'qq-shell-code-recovery',RELEASE_ID),base=path.join(root,'qq-installations'),installationRoot=setupId?path.join(base,setupId):null;
 return {root,versionRoot,codeRoot:path.join(versionRoot,'code'),manifestPath:path.join(versionRoot,'prepared.json'),recoveryRoot,pending:path.join(recoveryRoot,'pending.json'),operationsRoot:path.join(recoveryRoot,'operations'),retirementsRoot:path.join(recoveryRoot,'retirements'),...(installationRoot?{base,installationRoot,descriptor:path.join(installationRoot,'installation.json'),workDir:path.join(installationRoot,'work'),configDir:path.join(installationRoot,'work','config'),qqDataDir:path.join(installationRoot,'qq-data')}:{})};
}
function manifestValue(value){
 if(!F.keys(value,['schema','component','versionId','version','source','preparedAt','requiredFiles','directories','files'])||value.schema!=='qq_component_prepared_v1'||value.component!=='napcat-shell'||value.versionId!==RELEASE_ID||value.version!==VERSION||!F.equal(value.source,SOURCE)||typeof value.preparedAt!=='string'||value.preparedAt.length>64||!Number.isFinite(Date.parse(value.preparedAt))||!F.equal(value.requiredFiles,REQUIRED)||!Array.isArray(value.directories)||!Array.isArray(value.files)||!value.files.length||value.files.length>F.LIMITS.maxEntries||value.directories.length>F.LIMITS.maxEntries)F.fail('manifest_invalid');
 const names=new Map(),dirs=new Set();let total=0,last='';
 for(const row of value.files){
  if(!F.keys(row,['path','size','sha256'])||!Number.isSafeInteger(row.size)||row.size<0||row.size>F.LIMITS.maxFileBytes||!F.HEX.test(row.sha256))F.fail('manifest_invalid');F.relative(row.path);if(row.path<=last)F.fail('manifest_invalid');last=row.path;
  const key=row.path.toLowerCase();if(names.has(key))F.fail('manifest_invalid');names.set(key,false);total+=row.size;if(total>F.LIMITS.maxTreeBytes)F.fail('manifest_invalid');
 }
 last='';for(const dir of value.directories){F.relative(dir);if(dir<=last||names.has(dir.toLowerCase()))F.fail('manifest_invalid');last=dir;names.set(dir.toLowerCase(),true);dirs.add(dir);}
 for(const name of [...value.files.map(x=>x.path),...value.directories]){const parts=name.split('/');for(let i=1;i<parts.length;i++)if(!dirs.has(parts.slice(0,i).join('/')))F.fail('manifest_invalid');}
 for(const name of REQUIRED)if(!value.files.some(row=>row.path===name&&row.size>0))F.fail('manifest_invalid');
 if(!value.files.some(row=>row.path.startsWith('static/')&&row.size>0))F.fail('manifest_invalid');return structuredClone(value);
}
function strictDescriptor(value){
 if(!F.keys(value,['schema','setupId','installationId','engine','dataPolicy','createdAt','publication','qq','current','previous'])||!F.keys(value.publication,['method','temporaryFile'])||!F.keys(value.current,['kind','version','versionId','manifestSha256'])||!F.keys(value.qq,['file','architecture','size','sha256','identity','version','productName','companyName','signature','observedAt'])||!F.keys(value.qq.identity,['dev','ino','size','mtimeMs'])||!F.keys(value.qq.signature,['status','subject','thumbprint']))F.fail('shell_repair_unavailable');
}
function readManagedShellRepairMetadata({root,setupId,descriptorSha256,io=fs}={}){
 const p=paths(root,setupId);if(!setupId||descriptorSha256!==undefined&&!F.HEX.test(descriptorSha256))F.fail('invalid_request');
 const installation=F.directory(p.installationRoot,io),work=F.directory(p.workDir,io),config=F.directory(p.configDir,io),data=F.directory(p.qqDataDir,io),parent=F.directory(p.versionRoot,io);
 const raw=F.read(p.descriptor,{max:12288,io});if(descriptorSha256!==undefined&&raw.sha256!==descriptorSha256)F.fail('managed_installation_changed');
 try{strictDescriptor(JSON.parse(raw.bytes));}catch(error){if(error.code)throw error;F.fail('shell_repair_unavailable');}
 // Reuse the authoritative signed QQ/program descriptor validation. It is
 // metadata-only and does not open QQ.exe, config files or component code.
 const {readManagedShellInstallation}=require('./qq-managed-setup.cjs');
 const descriptor=readManagedShellInstallation({root:p.root,setupId,io});
 if(descriptor.descriptorSha256!==raw.sha256)F.fail('managed_installation_changed');
 if(!F.equal(F.names(p.installationRoot,8,io),['installation.json','qq-data','work']))F.fail('shell_repair_unavailable');
 const prepared=F.read(p.manifestPath,{max:F.LIMITS.maxManifestBytes,io});if(prepared.sha256!==descriptor.current.manifestSha256)F.fail('manifest_invalid');
 let manifest;try{manifest=manifestValue(JSON.parse(prepared.bytes));}catch(error){if(error.code)throw error;F.fail('manifest_invalid');}
 const versionNames=F.names(p.versionRoot,4,io);if(!F.equal(versionNames,['code','prepared.json'])&&!F.equal(versionNames,['prepared.json']))F.fail('manifest_invalid');
 const present=F.exists(p.codeRoot,io);if(present)F.directory(p.codeRoot,io);
 const lastDescriptor=F.read(p.descriptor,{max:12288,io});if(lastDescriptor.sha256!==raw.sha256||!F.sameIdentity(raw,lastDescriptor))F.fail('managed_installation_changed');
 for(const [file,proof]of [[p.versionRoot,parent],[p.installationRoot,installation],[p.workDir,work],[p.configDir,config],[p.qqDataDir,data]])if(!F.sameIdentity(proof,F.directory(file,io)))F.fail('shell_repair_changed');
 return {...descriptor,...p,verification:'repair-metadata-only',manifest,manifestBytes:prepared.bytes,repairMetadata:{manifestSha256:prepared.sha256,manifestIdentity:F.identity(prepared),descriptorIdentity:F.identity(raw),versionParentIdentity:F.identity(parent),installationIdentity:F.identity(installation),workIdentity:F.identity(work),configIdentity:F.identity(config),qqDataIdentity:F.identity(data),codePresence:present?'present':'absent'}};
}
function assertManagedShellRepairReady({root,io=fs}={}){
 const p=paths(root);if(!F.exists(p.recoveryRoot,io))return;F.directory(p.recoveryRoot,io);if(F.exists(p.pending,io))F.fail('shell_repair_recovery_required');
 if(F.exists(p.operationsRoot,io))for(const id of F.names(p.operationsRoot,F.LIMITS.maxHistoryRecords,io)){
  if(!F.UUID.test(id))F.fail('shell_repair_recovery_required');const dir=path.join(p.operationsRoot,id);F.directory(dir,io);const intent=path.join(dir,'intent.json');if(!F.exists(intent,io))continue;
  try{const terminal=JSON.parse(F.read(path.join(dir,'terminal.json'),{max:4096,io}).bytes);if(!F.keys(terminal,['schema','operationId','intentSha256','outcome','at'])||terminal.schema!=='qq_shell_code_terminal_v1'||terminal.operationId!==id||!F.HEX.test(terminal.intentSha256)||!['completed','restored','abandoned'].includes(terminal.outcome)||!Number.isSafeInteger(terminal.at)||terminal.at<0||F.read(intent,{max:32*1024*1024,bytes:false,io}).sha256!==terminal.intentSha256)F.fail();}catch{F.fail('shell_repair_recovery_required');}
 }
}
module.exports={readManagedShellRepairMetadata,assertManagedShellRepairReady,paths,manifestValue,SOURCE,REQUIRED,RELEASE_ID,VERSION};
