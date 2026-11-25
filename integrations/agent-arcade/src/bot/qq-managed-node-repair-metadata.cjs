'use strict';
// Narrow metadata-only recovery capture. Normal installation readers are not
// relaxed, and this module never reads account configuration or chat data.
const fs=require('node:fs'),path=require('node:path');
const F=require('./qq-node-repair-fs.cjs');
const {RELEASE_ID,VERSION,NODE_FILES}=require('./qq-managed-node-setup.cjs');
const SOURCE=Object.freeze({tag:'v4.18.42',assetId:691263447,sha256:'77397ac38d66f46383e48f08f35d5f9d37ec575c22069f62d6c600e73b4521ed',size:124162399});
const REQUIRED=Object.freeze(['node.exe','index.js','wrapper.node','package.json','config.json','QQNT.dll','napcat/napcat.mjs']);
function paths(root,setupId){root=F.local(root);if(setupId!==undefined&&!F.UUID.test(setupId))F.fail('invalid_request');const versionRoot=path.join(root,'qq-component-versions','napcat-node',RELEASE_ID),recoveryRoot=path.join(root,'qq-node-code-recovery',RELEASE_ID),installationRoot=setupId?path.join(root,'qq-node-installations',setupId):null;return {root,versionRoot,codeRoot:path.join(versionRoot,'code'),manifestPath:path.join(versionRoot,'prepared.json'),recoveryRoot,pending:path.join(recoveryRoot,'pending.json'),operationsRoot:path.join(recoveryRoot,'operations'),retirementsRoot:path.join(recoveryRoot,'retirements'),...(installationRoot?{installationRoot,descriptor:path.join(installationRoot,'installation.json'),instancesRoot:path.join(installationRoot,'instances')}:{})};}
function metadataValues(){const value=file=>({file,...NODE_FILES[file]});return {node:{version:'22.11.0',architecture:'x64',...value('node.exe'),versionSource:'official-release-recipe'},qq:{version:'9.9.31-49738',versionSource:'root-package-and-config'},entry:value('index.js'),native:{wrapper:value('wrapper.node'),package:value('package.json'),config:value('config.json'),qqnt:value('QQNT.dll'),napcat:value('napcat/napcat.mjs')}};}
function manifestValue(value){
 if(!F.keys(value,['schema','component','versionId','version','source','preparedAt','requiredFiles','directories','files'])||value.schema!=='qq_node_component_prepared_v1'||value.component!=='napcat-node'||value.versionId!==RELEASE_ID||value.version!==VERSION||!F.equal(value.source,SOURCE)||typeof value.preparedAt!=='string'||value.preparedAt.length>64||!Number.isFinite(Date.parse(value.preparedAt))||!F.equal(value.requiredFiles,REQUIRED)||!Array.isArray(value.directories)||!Array.isArray(value.files)||!value.files.length||value.files.length>F.LIMITS.maxEntries||value.directories.length>F.LIMITS.maxEntries)F.fail('manifest_invalid');
 const names=new Map(),dirs=new Set();let total=0;
 for(const row of value.files){if(!F.keys(row,['path','size','sha256'])||!Number.isSafeInteger(row.size)||row.size<0||row.size>F.LIMITS.maxFileBytes||!F.HEX.test(row.sha256))F.fail('manifest_invalid');F.relative(row.path);const key=row.path.toLowerCase();if(names.has(key))F.fail('manifest_invalid');names.set(key,false);total+=row.size;if(total>F.LIMITS.maxTreeBytes)F.fail('manifest_invalid');}
 for(const dir of value.directories){F.relative(dir);if(names.has(dir.toLowerCase()))F.fail('manifest_invalid');names.set(dir.toLowerCase(),true);dirs.add(dir);}
 for(const name of [...value.files.map(x=>x.path),...value.directories]){const parts=name.split('/');for(let i=1;i<parts.length;i++)if(!dirs.has(parts.slice(0,i).join('/')))F.fail('manifest_invalid');}
 for(const file of REQUIRED){const entries=value.files.filter(x=>x.path===file),pin=NODE_FILES[file];if(entries.length!==1||entries[0].size!==pin.size||entries[0].sha256!==pin.sha256)F.fail('manifest_invalid');}
 if(!value.files.some(x=>x.path.startsWith('napcat/static/')))F.fail('manifest_invalid');return structuredClone(value);
}
function descriptorValue(value,p,setupId){
 if(!F.keys(value,['schema','setupId','installationId','engine','dataPolicy','createdAt','publication','node','qq','entry','native','current','previous'])||value.schema!=='qq_managed_node_v1'||value.setupId!==setupId||value.installationId!==F.sha(p.installationRoot.toLowerCase())||value.engine!=='managed-node'||value.dataPolicy!=='isolated-new'||value.previous!==null||typeof value.createdAt!=='string'||value.createdAt.length>64||!Number.isFinite(Date.parse(value.createdAt)))F.fail('node_repair_unavailable');
 if(!F.keys(value.publication,['method','temporaryFile'])||value.publication.method!=='exclusive-link-v1'||typeof value.publication.temporaryFile!=='string'||!/^installation\.[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.part$/.test(value.publication.temporaryFile))F.fail('node_repair_unavailable');
 if(!F.keys(value.current,['kind','version','versionId','manifestSha256'])||value.current.kind!=='prepared'||value.current.version!==VERSION||value.current.versionId!==RELEASE_ID||!F.HEX.test(value.current.manifestSha256))F.fail('node_repair_unavailable');
 for(const [name,expected]of Object.entries(metadataValues()))if(!F.equal(value[name],expected))F.fail('node_repair_unavailable');return structuredClone(value);
}
function readManagedNodeRepairMetadata({root,setupId,descriptorSha256,io=fs}={}){
 const p=paths(root,setupId);if(!setupId||descriptorSha256!==undefined&&!F.HEX.test(descriptorSha256))F.fail('invalid_request');
 const install=F.directory(p.installationRoot,io),instances=F.directory(p.instancesRoot,io),parent=F.directory(p.versionRoot,io),raw=F.read(p.descriptor,{max:12288,io});if(descriptorSha256!==undefined&&raw.sha256!==descriptorSha256)F.fail('managed_installation_changed');
 let descriptor,manifest;try{descriptor=descriptorValue(JSON.parse(raw.bytes),p,setupId);}catch(e){if(e.code)throw e;F.fail('node_repair_unavailable');}
 if(!F.equal(F.names(p.installationRoot,8,io),['installation.json','instances']))F.fail('node_repair_unavailable');
 const prepared=F.read(p.manifestPath,{max:F.LIMITS.maxManifestBytes,io});if(prepared.sha256!==descriptor.current.manifestSha256)F.fail('manifest_invalid');try{manifest=manifestValue(JSON.parse(prepared.bytes));}catch(e){if(e.code)throw e;F.fail('manifest_invalid');}
 const versionNames=F.names(p.versionRoot,4,io);if(!F.equal(versionNames,['code','prepared.json'])&&!F.equal(versionNames,['prepared.json']))F.fail('manifest_invalid');const present=F.exists(p.codeRoot,io);if(present)F.directory(p.codeRoot,io);
 if(!F.sameIdentity(parent,F.directory(p.versionRoot,io))||!F.sameIdentity(install,F.directory(p.installationRoot,io))||!F.sameIdentity(instances,F.directory(p.instancesRoot,io)))F.fail();
 return {...descriptor,...p,prepared:{...descriptor.current},descriptorSha256:raw.sha256,verification:'repair-metadata-only',manifest,manifestBytes:prepared.bytes,repairMetadata:{manifestSha256:prepared.sha256,manifestIdentity:F.identity(prepared),descriptorIdentity:F.identity(raw),versionParentIdentity:F.identity(parent),installationIdentity:F.identity(install),instancesIdentity:F.identity(instances),codePresence:present?'present':'absent'}};
}
function assertManagedNodeRepairReady({root,io=fs}={}){
 const p=paths(root);if(!F.exists(p.recoveryRoot,io))return;F.directory(p.recoveryRoot,io);if(F.exists(p.pending,io))F.fail('node_repair_recovery_required');
 // A durable live-mutation intent without its terminal settlement also blocks
 // start if a crash interrupted pending publication or cleanup.
 if(F.exists(p.operationsRoot,io))for(const id of F.names(p.operationsRoot,F.LIMITS.maxHistoryRecords,io)){if(!F.UUID.test(id))F.fail('node_repair_recovery_required');const dir=path.join(p.operationsRoot,id);F.directory(dir,io);const intent=path.join(dir,'intent.json');if(F.exists(intent,io)){try{const terminal=JSON.parse(F.read(path.join(dir,'terminal.json'),{max:4096,io}).bytes);if(!F.keys(terminal,['schema','operationId','intentSha256','outcome','at'])||terminal.schema!=='qq_node_code_terminal_v1'||terminal.operationId!==id||!F.HEX.test(terminal.intentSha256)||!['completed','restored','abandoned'].includes(terminal.outcome)||!Number.isSafeInteger(terminal.at)||terminal.at<0||F.read(intent,{max:32*1024*1024,bytes:false,io}).sha256!==terminal.intentSha256)F.fail();}catch{F.fail('node_repair_recovery_required');}}}
}
module.exports={readManagedNodeRepairMetadata,assertManagedNodeRepairReady,paths,manifestValue,descriptorValue,metadataValues,SOURCE,REQUIRED,RELEASE_ID,VERSION};
