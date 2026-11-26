'use strict';
// Original receipt adapter for the existing healthy Shell proof/stop path.
// It does not add process selection, retry, resource deletion or start authority.
const fs=require('node:fs'),path=require('node:path');
const fail=code=>{throw Object.assign(Error(code),{code});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function binding(r,accountId){
 const i=r.instance(accountId);
 if(!r.managed||r.closing||!i.available||i.installationKind!=='managed-shell'||r._ownerBlocker(i)||i.componentSelectionKind!=='prepared'||i.selectedNapcatVersion!=='4.18.42'||r.shellOrphanCleanup?.owns(accountId))fail('orphan_cleanup_changed');
 return JSON.stringify([r.id,r.root,r.lockRoot,r.componentsRoot,i.launcher,i.qqExe,i.workDir,i.componentSelectionKind,i.selectedNapcatVersion]);
}
function guardAbsent(r,accountId){
 // A returned _withOrphanGuard call has already closed its file descriptor.
 // Its old implementation can swallow unlink failure, so independently check
 // the fixed guard path. A replacement or unreadable path is not ours to remove.
 const root=fs.realpathSync(r.lockRoot),stat=fs.lstatSync(r.lockRoot);
 if(stat.isSymbolicLink()||!stat.isDirectory()||root.toLowerCase()!==path.resolve(r.lockRoot).toLowerCase())return false;
 try{fs.lstatSync(r._lockPath(accountId)+'.recover');return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}
}
async function cleanup(r,accountId,options){
 if(!exact(options,['expectedDigest','selectedCount','assertCurrent','beforeStop'])||typeof options.expectedDigest!=='string'||!/^[a-f0-9]{64}$/.test(options.expectedDigest)||!Number.isInteger(options.selectedCount)||options.selectedCount<1||options.selectedCount>64||typeof options.assertCurrent!=='function'||typeof options.beforeStop!=='function')fail('orphan_cleanup_changed');
 const captured=binding(r,accountId),current=()=>{options.assertCurrent();if(binding(r,accountId)!==captured)fail('orphan_cleanup_changed');};
 current();
 // Delegates to the unchanged local proof, guard, two fresh plans, precise stop,
 // post-stop observation and exact lease release. Its partial errors stay unknown.
 const result=await r.cleanupOrphans(accountId,{expectedDigest:options.expectedDigest,assertCurrent:current,beforeStop:options.beforeStop});
 if(!exact(result,['recovery','accountId','terminatedCount','automaticStart'])||result.recovery!=='orphans-cleared'||result.accountId!==accountId||result.automaticStart!==false||result.terminatedCount!==options.selectedCount)fail('invalid_response');
 let resources='unconfirmed';try{if(guardAbsent(r,accountId))resources='closed';}catch{/* Keep known process/lease effect separate from resource uncertainty. */}
 const detail={kind:'healthy-shell-orphan-cleanup',accountId,selectedCount:options.selectedCount,confirmedAbsentCount:options.selectedCount,terminationAttempted:true,processes:'confirmed-absent',lease:'cleared',resources,automaticStart:false};
 if(resources!=='closed')throw Object.assign(Error('cleanup_unconfirmed'),{code:'cleanup_unconfirmed',cleanupAttempted:true,cleanup:detail});
 return {...result,cleanup:detail};
}
module.exports={cleanup};
