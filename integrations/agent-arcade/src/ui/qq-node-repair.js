'use strict';
// A fixed-version repair task inside the existing component drawer.
(() => {
  const VERSION='4.18.42',VERSION_ID='napcat-node-4.18.42-77397ac38d66f463',ARCHIVE_BYTES=124162399;
  const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
  const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  const count=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
  const text=(v,max=160)=>typeof v==='string'&&v.length<=max&&!/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(v);
  const tri=v=>v===true||v===false||v===null;
  const code=v=>v===null||typeof v==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(v);
  const decisions=['abandon-prepared','complete-prepared','restore-original','acknowledge-complete'];
  const limits={maxInstallations:32,maxInstancesPerInstallation:32,maxProcesses:4096,maxEntries:10000,maxDepth:16,maxFileBytes:134217728,maxTreeBytes:536870912,maxManifestBytes:2097152,maxHistoryRecords:16,maxHistoryBytes:8589934592,previewTTL:300000};
  function scopeOK(v){
    return v?.enumeration==='component-store'&&typeof v.allWithinStoreVerified==='boolean'&&v.outsideStoreMetadataEnumerated===false&&
      Array.isArray(v.installations)&&v.installations.length<=32&&new Set(v.installations.map(r=>r?.installationId)).size===v.installations.length&&
      v.installations.every(r=>digest(r?.installationId)&&uuid(r.setupId)&&count(r.instanceDirectoryCount,32))&&
      Array.isArray(v.knownRegisteredProfiles)&&v.knownRegisteredProfiles.length<=32&&new Set(v.knownRegisteredProfiles.map(r=>r?.profileId)).size===v.knownRegisteredProfiles.length&&
      v.knownRegisteredProfiles.every(r=>typeof r?.profileId==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(r.profileId)&&text(r.label,120)&&r.label.length>0);
  }
  function inspectionOK(v){
    return uuid(v?.observationId)&&v.component==='napcat-node'&&v.version===VERSION&&v.versionId===VERSION_ID&&
      ['healthy','damaged','missing','unsupported','recovery_required','unverified'].includes(v.state)&&scopeOK(v.scope)&&
      ['verified-cache','not-staged','unverified'].includes(v.source?.state)&&v.source.archiveBytes===ARCHIVE_BYTES&&
      ['verified','running','unverified'].includes(v.stopped)&&typeof v.metadata?.descriptorVerified==='boolean'&&typeof v.metadata?.manifestVerified==='boolean'&&
      typeof v.canPrepare==='boolean'&&code(v.reason)&&(!v.canPrepare||['damaged','missing'].includes(v.state)&&v.stopped==='verified'&&v.scope.installations.length>0&&v.scope.allWithinStoreVerified&&v.metadata.descriptorVerified&&v.metadata.manifestVerified)&&
      Array.isArray(v.pending)&&v.pending.length<=16&&v.pending.every(r=>uuid(r?.operationId)&&['prepared_only','interrupted','blocked'].includes(r.state)&&Array.isArray(r.decisions)&&r.decisions.length<=4&&new Set(r.decisions).size===r.decisions.length&&r.decisions.every(x=>decisions.includes(x)))&&
      Array.isArray(v.history)&&v.history.length<=16&&v.history.every(r=>uuid(r?.operationId)&&count(r.endedAt)&&count(r.retainedBytes,8589934592)&&['completed','restored','abandoned','retiring','blocked'].includes(r.state)&&typeof r.canRetire==='boolean'&&typeof r.canResumeRetirement==='boolean'&&!(r.canRetire&&r.canResumeRetirement)&&(!r.canResumeRetirement||r.state==='retiring')&&code(r.reason))&&
      count(v.retention?.records,16)&&count(v.retention?.bytes,8589934592)&&v.retention.maxRecords===16&&v.retention.maxBytes===8589934592&&Object.entries(limits).every(([k,n])=>v.limits?.[k]===n);
  }
  const ticketOK=v=>uuid(v?.operationId)&&uuid(v.ticketId)&&digest(v.expectedDigest)&&Number.isSafeInteger(v.expiresAt)&&v.expiresAt>Date.now()&&v.expiresAt<=Date.now()+301000;
  function effectsOK(v){return v?.replacesCode===true&&v.retainsOriginalTreeIfPresent===true&&['changesDescriptors','changesPreparedManifest','writesAccountData','changesWorkPaths','versionChange','automaticStop','automaticStart'].every(k=>v[k]===false);}
  function repairPreviewOK(v,baseline){
    return ticketOK(v)&&v.operation==='node-code-repair'&&v.component==='napcat-node'&&v.version===VERSION&&v.versionId===VERSION_ID&&scopeOK(v.scope)&&v.scope.allWithinStoreVerified&&
      baseline&&JSON.stringify(v.scope)===JSON.stringify(baseline.scope)&&['code_integrity_mismatch','code_missing'].includes(v.damage)&&v.damage===(baseline.state==='missing'?'code_missing':'code_integrity_mismatch')&&
      v.source?.verification==='full-pinned-archive-and-manifest'&&v.source.archiveBytes===ARCHIVE_BYTES&&count(v.source.fileCount,10000)&&v.source.fileCount>0&&count(v.source.totalBytes,536870912)&&
      v.previousTree===(baseline.state==='missing'?'absent':'present')&&effectsOK(v.effects);
  }
  function reconcilePreviewOK(v,record,decision,baseline){
    if(!ticketOK(v)||v.operation!=='node-code-reconcile'||v.operationId!==record?.operationId||v.decision!==decision||!record.decisions.includes(decision)||v.component!=='napcat-node'||v.version!==VERSION||v.versionId!==VERSION_ID||!scopeOK(v.scope)||!v.scope.allWithinStoreVerified||JSON.stringify(v.scope)!==JSON.stringify(baseline?.scope)||!['original','absent','prepared'].includes(v.before?.live)||!['live','retained','absent'].includes(v.before?.original)||!['verified','absent'].includes(v.before?.staged))return false;
    if(!['changesDescriptors','changesPreparedManifest','writesAccountData','changesWorkPaths','versionChange','automaticStop','automaticStart'].every(k=>v.effects?.[k]===false))return false;
    const flags={publishesPreparedCode:'complete-prepared',restoresOriginalCode:'restore-original',settlesExistingPublication:'acknowledge-complete'};
    if(v.effects.removesOwnedDisposableStage!==false||!Object.entries(flags).every(([k,d])=>v.effects[k]===(decision===d)))return false;
    if(decision==='complete-prepared')return v.before.live==='absent'&&['retained','absent'].includes(v.before.original)&&v.before.staged==='verified';
    if(decision==='restore-original')return v.before.live==='absent'&&v.before.original==='retained';
    if(decision==='acknowledge-complete')return v.before.live==='prepared'&&['retained','absent'].includes(v.before.original)||v.before.staged==='verified'&&(v.before.live==='original'&&v.before.original==='live'||v.before.live==='absent'&&v.before.original==='absent');
    return ['original','absent'].includes(v.before.live)&&['live','absent'].includes(v.before.original)&&v.before.staged==='verified';
  }
  function retirementPreviewOK(v,record){return ticketOK(v)&&v.operation==='node-code-history-retirement'&&v.operationId===record?.operationId&&typeof v.resume==='boolean'&&v.resume===record.canResumeRetirement&&(record.canRetire||record.canResumeRetirement)&&count(v.retainedBytes,8589934592)&&count(v.retainedFileCount,20000)&&v.removesRetainedCode===true&&v.reversible===false&&['currentCodeTouched','originalManifestTouched','descriptorsTouched','accountDataTouched','automaticStart'].every(k=>v[k]===false);}
  function repairResult(v,expected){
    const matches=v?.operationId===expected?.operationId&&v?.operation===expected?.operation&&['node-code-repair','node-code-reconcile'].includes(v?.operation);
    const fallback={operationId:expected?.operationId||null,operation:expected?.operation==='node-code-repair'?'node-code-repair':'node-code-reconcile',committed:matches&&v.committed===true?true:null,liveCode:'unverified',oldTreeRetained:null,readback:'unavailable',recoveryRequired:true,cleanupVerified:false,descriptorBytesUnchanged:null,manifestBytesUnchanged:null,dataPathsUnchanged:null,accountDataVerification:'not-read',automaticStart:false,automaticStop:false,versionChange:false,code:'node_repair_unconfirmed'};
    if(!matches||!tri(v.committed)||!['same-version-verified','original-restored','unchanged','unverified'].includes(v.liveCode)||!tri(v.oldTreeRetained)||!['full-manifest','original-proof','unavailable'].includes(v.readback)||typeof v.recoveryRequired!=='boolean'||typeof v.cleanupVerified!=='boolean'||!['descriptorBytesUnchanged','manifestBytesUnchanged','dataPathsUnchanged'].every(k=>tri(v[k]))||v.accountDataVerification!=='not-read'||v.automaticStart!==false||v.automaticStop!==false||v.versionChange!==false||!code(v.code))return fallback;
    if(v.liveCode==='same-version-verified'&&(v.committed!==true||v.readback!=='full-manifest')||v.liveCode==='original-restored'&&(v.committed!==true||v.readback!=='original-proof')||v.committed===null&&v.liveCode!=='unverified'||v.committed===false&&v.liveCode!=='unchanged')return fallback;
    return v;
  }
  function retirementResult(v,expected){
    const fallback={operation:'node-code-history-retirement',operationId:expected?.operationId||null,committed:v?.operation==='node-code-history-retirement'&&v.operationId===expected?.operationId&&v.committed===true?true:null,retired:null,cleanupRequired:true,cleanupVerified:false,code:'node_repair_retirement_unconfirmed'};
    if(v?.operation!=='node-code-history-retirement'||v.operationId!==expected?.operationId||!tri(v.committed)||!tri(v.retired)||typeof v.cleanupRequired!=='boolean'||typeof v.cleanupVerified!=='boolean'||!['currentCodeTouched','originalManifestTouched','descriptorsTouched','accountDataTouched','automaticStart'].every(k=>v[k]===false)||!code(v.code)||v.committed!==v.retired||v.retired===true&&(!v.cleanupVerified||v.cleanupRequired))return fallback;
    return v;
  }
  const fixedErrors={
    node_repair_unavailable:['无法核实这份受管 Node 安装。请检查安装记录，原文件保留。','This managed Node installation could not be verified. Inspect its record; existing files are retained.'],
    node_repair_not_needed:['当前组件核验通过，无需修复。','The components passed verification. No repair is needed.'],
    node_repair_scope_unverified:['无法核实所有共享安装，未启用修复。请检查安装记录。','The complete set of shared installations could not be verified. Check the installation records.'],
    node_repair_source_unavailable:['同版修复源尚未准备好，请重新检查固定官方组件。','The same-version repair source is unavailable. Check the fixed official components again.'],
    node_repair_changed:['安装或组件已变化，请重新检查并预览。','The installation or components changed. Inspect and preview again.'],
    node_repair_busy:['另一项组件操作正在进行，请等待结束。','Another component operation is in progress. Wait for it to finish.'],
    node_repair_history_full:['保留空间已满。可检查并明确删除不再需要的保留代码，再重新准备。','Retained repair storage is full. Review and explicitly remove eligible retained code before preparing again.'],
    node_repair_failed:['本次组件检查未完成。请保留文件并重新检查。','This component inspection did not complete. Keep the files and inspect again.'],
    node_repair_readback_failed:['组件更改已写入，最终核验尚未完成。请核查本次操作。','The component change was written, but final verification is incomplete. Inspect this operation.'],
    node_repair_unconfirmed:['本次修复结果尚未确认。请核查上次操作，不会自动重试。','This repair is unconfirmed. Inspect the previous operation; it will not retry automatically.'],
    node_repair_recovery_required:['存在未完成修复，请先核查上次操作。QQ 不会自动启动。','An unfinished repair needs inspection. QQ will not start automatically.'],
    node_repair_cleanup_unconfirmed:['本次操作的收尾尚未确认，请重新核查；不会重复修复。','Final cleanup is unconfirmed. Inspect the operation; repair will not be repeated.'],
    node_repair_retirement_unavailable:['这份保留代码尚不能安全删除，请保留并核查。','This retained code cannot currently be removed safely. Keep it and inspect its state.'],
    node_repair_retirement_unconfirmed:['保留代码的删除结果尚未确认，请核查剩余记录。','Removal of the retained code is unconfirmed. Inspect the remaining record.'],
    runtime_running:['请先停止所有使用这份组件的 QQ，再重新检查。','Stop every QQ runtime using these components, then inspect again.'],
    desktop_running:['请先退出 NapCat Desktop，再重新检查。','Quit NapCat Desktop, then inspect again.'],
    process_check_failed:['无法确认所有共享 QQ 已停止。请检查后台状态后重试检查。','Not all shared QQ runtimes could be verified stopped. Check runtime state and inspect again.'],
    runtime_locked:['仍有 QQ 运行记录。请先停止对应后台，或核查其管理状态。','QQ runtime records remain. Stop those runtimes or inspect their management state first.'],
    component_locked:['另一项组件操作正在使用这些文件，请等待结束。','Another component operation is using these files. Wait for it to finish.'],
    preview_expired:['本次预览已过期，请重新检查。','This preview expired. Inspect again.'],
    preview_required:['请重新检查并预览；旧确认不能重复使用。','Inspect and preview again; the old confirmation cannot be reused.'],
    cancelled:['已请求取消，请以本次结果为准。','Cancellation was requested. Check this operation’s result.'],
    network_failed:['无法下载固定官方组件。检查网络后可重新准备。','The fixed official components could not be downloaded. Check the connection before preparing again.'],
    digest_mismatch:['下载文件未通过校验，未用于修复。请保留文件并重新检查。','The downloaded file failed verification and was not used for repair. Keep it and inspect again.'],
    unsafe_path:['组件路径无法安全核验，原文件保留。','The component path could not be verified safely. Existing files are retained.'],
  };
  function create({getLanguage,getContext,redraw,beforeAction}){
    let active=false,busy=false,cancelling=false,expanded=false,info=null,preview=null,expected=null,result=null,retired=null,message='',failed=false,epoch=0,timer=null,closing=null,panelId=null,boundScope='',lastDecision='';
    const tr=(zh,en)=>getLanguage()==='zh'?zh:en;
    const errorText=c=>fixedErrors[c]?tr(...fixedErrors[c]):tr('本次操作未完成。请重新检查组件状态。','This operation did not complete. Inspect component state again.');
    const bytes=n=>n<1048576?`${n.toLocaleString()} B`:`${(n/1048576).toFixed(1)} MiB`;
    const clearTicket=()=>{clearTimeout(timer);timer=null;preview=null;};
    const scopeKey=()=>{const c=getContext();return JSON.stringify([c?.selectedCompanionId,c?.runtime?.installationKind,c?.runtime?.managedSetupId,c?.runtime?.componentsRoot,c?.runtime?.installation?.current?.setupId]);};
    const eligible=()=>getContext()?.runtime?.canInspectNodeRepair===true;
    const button=(id,label,fn,disabled=false,primary=false)=>{const b=el('button',primary?'primary':'secondary',label);b.type='button';b.id=id;b.disabled=disabled;b.onclick=fn;return b;};
    function restoreOwnFocus(){if(document.hidden||!active)return;const focused=document.activeElement;if(focused!==document.body&&focused?.id!=='qq-components')return;document.getElementById(preview?'qq-node-repair-back':'qq-node-repair-inspect')?.focus({preventScroll:true});}
    function arm(value,owner){clearTicket();preview=value;const current=value;timer=setTimeout(()=>{if(preview!==current)return;clearTicket();info=null;message=errorText('preview_expired');failed=true;void requestDismiss(owner);redraw();},Math.max(0,value.expiresAt-Date.now()));}
    async function requestDismiss(owner){if(!owner)return true;try{const r=await window.arcade.qqComponents({action:'node-repair-dismiss',panelId:owner});if(r?.ok!==true)throw Error();return true;}catch{return false;}}
    async function perform(action,payload={}){
      if(!active||busy||closing||!eligible()||scopeKey()!==boundScope)return;
      const prior=preview,baseline=info,record=info?.history.find(r=>r.operationId===payload.operationId),pending=info?.pending.find(r=>r.operationId===payload.operationId),key=scopeKey(),owner=panelId;
      const commit=['node-repair-confirm','node-repair-reconcile-confirm','node-repair-retire-confirm'].includes(action);
      if(commit&&(!prior||prior.expiresAt<=Date.now()||payload.ticketId!==prior.ticketId||payload.expectedDigest!==prior.expectedDigest)){clearTicket();info=null;failed=true;message=errorText('preview_expired');void requestDismiss(owner);redraw();return;}
      const own=++epoch;expected=prior;clearTicket();if(action!=='node-repair-inspect'){result=null;retired=null;}busy=true;cancelling=false;expanded=true;message='';failed=false;redraw();
      try{
        await beforeAction?.();if(own!==epoch||!active||scopeKey()!==key)return;
        const r=await window.arcade.qqComponents({action,panelId:owner,...payload});if(own!==epoch||!active||scopeKey()!==key)return;
        if(commit){
          info=null;lastDecision=prior?.decision||'';
          if(action==='node-repair-retire-confirm'){result=null;retired=retirementResult(r?.nodeRepairRetireResult,prior);}
          else{retired=null;result=repairResult(r?.nodeRepairResult,prior);}
          return;
        }
        if(r?.ok!==true){info=null;failed=true;message=errorText(r?.code);return;}
        if(action==='node-repair-inspect'){
          info=inspectionOK(r.nodeRepair)?r.nodeRepair:null;
          if(!info){failed=true;message=tr('检查回执无法核实，未启用修复。','The inspection receipt could not be verified. Repair is not enabled.');}
        }else if(action==='node-repair-preview'){
          if(repairPreviewOK(r.nodeRepairPreview,baseline))arm(r.nodeRepairPreview,owner);
          else{info=null;failed=true;message=tr('修复预览无法核实，未启用确认。','The repair preview could not be verified. Confirmation is disabled.');await requestDismiss(owner);}
        }else if(action==='node-repair-reconcile-preview'){
          if(reconcilePreviewOK(r.nodeRepairPreview,pending,payload.decision,baseline))arm(r.nodeRepairPreview,owner);
          else{info=null;failed=true;message=tr('上次操作的核查预览无法核实，未启用确认。','The previous operation’s recovery preview could not be verified. Confirmation is disabled.');await requestDismiss(owner);}
        }else if(action==='node-repair-retire-preview'){
          if(retirementPreviewOK(r.nodeRepairRetirePreview,record))arm(r.nodeRepairRetirePreview,owner);
          else{info=null;failed=true;message=tr('保留代码的删除预览无法核实，未启用确认。','The retained-code removal preview could not be verified. Confirmation is disabled.');await requestDismiss(owner);}
        }
      }catch{
        if(own!==epoch||!active||scopeKey()!==key)return;
        if(commit){info=null;lastDecision=prior?.decision||'';if(action==='node-repair-retire-confirm'){result=null;retired=retirementResult(null,prior);}else{retired=null;result=repairResult(null,prior);}}
        else{info=null;failed=true;message=tr('未取得本次检查结果，请重新检查。','This inspection result is unavailable. Inspect again.');}
      }finally{if(own===epoch&&active){busy=false;cancelling=false;expected=null;redraw();restoreOwnFocus();}}
    }
    async function dismiss(){if(busy)return;clearTicket();busy=true;redraw();const own=epoch,owner=panelId,ok=await requestDismiss(owner);if(own!==epoch||!active)return;busy=false;info=null;if(!ok){failed=true;message=errorText('node_repair_cleanup_unconfirmed');}redraw();restoreOwnFocus();}
    async function cancel(){if(!busy||cancelling)return;cancelling=true;clearTicket();info=null;redraw();const own=epoch,owner=panelId;const ok=await requestDismiss(owner);if(own===epoch&&active){cancelling=false;if(!ok){failed=true;message=tr('取消或收尾未确认，请等待结果并重新核查。','Cancellation or cleanup is unconfirmed. Wait for the result and inspect again.');}redraw();}}
    function shared(box,s){
      box.append(el('p','',tr(`共用组件：${s.installations.length} 份受管安装`,`Shared components: ${s.installations.length} managed installations`)));
      if(s.knownRegisteredProfiles.length)box.append(el('p','',tr('已登记搭档：','Registered companions: ')+s.knownRegisteredProfiles.map(r=>r.label).join('、')));
      box.append(el('p','social-hint',tr('影响本组件库内所有共用这份代码的安装；未枚举其他组件库。','Affects all installations sharing this code in this component store. Other component stores were not enumerated.')));
    }
    function details(label){const n=el('details','qq-node-repair-details');n.append(el('summary','',label));return n;}
    function decisionName(d){return ({'abandon-prepared':tr('放弃这次修复','Abandon this repair'),'complete-prepared':tr('继续完成修复','Complete this repair'),'restore-original':tr('恢复原代码','Restore original code'),'acknowledge-complete':tr('核验已完成的操作并收尾','Verify completed operation and finish')})[d];}
    function drawPreview(box,blocked){
      const v=preview;if(!v)return;
      const retire=v.operation==='node-code-history-retirement',reconcile=v.operation==='node-code-reconcile',review=el('section','qq-components-preview');review.id='qq-node-repair-preview';
      review.append(el('h3','',retire?(v.resume?tr('继续清理这份保留代码','Finish removing this retained code'):tr('删除这份保留代码','Remove this retained code')):reconcile?decisionName(v.decision):tr('修复此版本的运行组件','Repair this component version')));
      if(retire){review.append(el('p','',tr(`将删除 ${bytes(v.retainedBytes)} 保留代码（${v.retainedFileCount} 个文件），不可撤销。`,`Remove ${bytes(v.retainedBytes)} of retained code (${v.retainedFileCount} files). This cannot be undone.`)),el('p','',tr('不删除当前运行组件、账号配置或登录数据。','Current components, account configuration and login data are not deleted.')));}
      else if(reconcile){
        review.append(el('p','qq-components-current',`NapCat ${VERSION} · Node`));shared(review,v.scope);
        const copy={
          'abandon-prepared':[ '放弃这次修复，当前代码保持原状。准备副本会保留，可随后单独检查并清理；已有损坏不会因此修复。','Abandon this repair and leave current code unchanged. The prepared copy is retained for separate review and removal; existing damage is not repaired.'],
          'complete-prepared':['使用已核验的准备文件，继续完成这次同版代码修复。','Use the verified prepared files to finish this same-version code repair.'],
          'restore-original':['将保留的原代码放回原位。原代码可能仍有损坏，这不是修复完成；新准备的文件保留。','Put the retained original code back in place. It may still be damaged; this is not a completed repair. Prepared replacement files are retained.'],
          'acknowledge-complete':['核验上次已完成的操作并收尾，不会再次替换代码。原操作若为恢复或放弃，不代表损坏已修复。','Verify and finish the previous completed operation without replacing code again. An original restoration or abandoned repair does not mean damaged code was repaired.'],
        };review.append(el('p','',tr(...copy[v.decision])),el('p','',tr('不迁移或写入账号数据，不会自动停止或启动 QQ。','No account data migration or writes, and no automatic QQ stop or start.')));
      }
      else{
        review.append(el('p','qq-components-current',`NapCat ${VERSION} · Node`));shared(review,v.scope);
        review.append(el('p','',tr('同版修复源已完整核验。只替换运行代码，原有代码保留供核查。','The same-version source passed full verification. Only runtime code is replaced; the old code is retained for inspection.')),el('p','',tr('保留账号数据目录、连接配置及原组件清单。不会自动停止或启动 QQ。','Account data directories, connection configuration and the original component manifest are retained. QQ is not stopped or started automatically.')));
        const more=details(tr('核验与保留范围','Verification and retention'));more.append(el('p','',`${v.source.fileCount.toLocaleString()} ${tr('个文件','files')} · ${bytes(v.source.totalBytes)}`),el('p','',v.previousTree==='absent'?tr('原代码目录缺失，因此没有原代码树可保留。','The original code directory was missing, so there is no old tree to retain.'):tr('原代码将作为本次历史保留，不会自动删除。','Original code is retained in this operation’s history and is not deleted automatically.')),el('p','',tr('保留数据路径不等于核验全部账号数据；本次不迁移或修复 QQ 数据库。','Retaining data paths is not an audit of all account data. QQ databases are not migrated or repaired.')));for(const installation of v.scope.installations)more.append(el('p','',tr(`安装 ${installation.setupId} · ${installation.instanceDirectoryCount} 个账号目录`,`Installation ${installation.setupId} · ${installation.instanceDirectoryCount} account directories`)));review.append(more);
      }
      const actions=el('div','qq-components-actions');actions.append(button('qq-node-repair-back',tr('暂不处理','Not now'),()=>void dismiss(),blocked),button('qq-node-repair-confirm',retire?(v.resume?tr('继续清理保留代码','Finish removing retained code'):tr('删除这份保留代码','Remove retained code')):reconcile?decisionName(v.decision):tr('修复此版本','Repair this version'),()=>void perform(retire?'node-repair-retire-confirm':reconcile?'node-repair-reconcile-confirm':'node-repair-confirm',{ticketId:v.ticketId,expectedDigest:v.expectedDigest}),blocked||v.expiresAt<=Date.now(),true));review.append(actions);box.append(review);
    }
    function drawResult(box){
      if(!result&&!retired)return;const out=el('section','qq-components-preview');out.id='qq-node-repair-result';out.setAttribute('role','status');
      if(retired){out.append(el('h3','',tr('保留代码处理结果','Retained-code result')),el('p',retired.retired===true?'':'problem',retired.retired===true?tr('这份保留代码已删除并核查。当前组件与账号数据未改动。','This retained code was removed and verified. Current components and account data were not changed.'):retired.committed===false?tr('本次没有删除保留代码。请重新检查原因。','No retained code was removed by this operation. Inspect its reason.'):retired.committed===true?tr('保留代码清理已提交，但完整结果尚未核实。请重新检查记录。','Retained-code cleanup committed, but its complete outcome is unverified. Inspect the record again.'):errorText('node_repair_retirement_unconfirmed')));}
      else{
        const verified=result.committed===true&&result.liveCode==='same-version-verified'&&result.readback==='full-manifest'&&result.cleanupVerified&&!result.recoveryRequired&&['descriptorBytesUnchanged','manifestBytesUnchanged','dataPathsUnchanged'].every(k=>result[k]===true);
        const abandoned=result.committed===true&&lastDecision==='abandon-prepared'&&result.liveCode==='unchanged'&&result.cleanupVerified&&!result.recoveryRequired;
        const recordedUnchanged=result.committed===true&&result.liveCode==='unchanged'&&['abandon-prepared','acknowledge-complete'].includes(lastDecision);
        const settledUnchanged=result.committed===true&&lastDecision==='acknowledge-complete'&&result.liveCode==='unchanged'&&result.readback==='original-proof'&&result.cleanupVerified&&!result.recoveryRequired&&['descriptorBytesUnchanged','manifestBytesUnchanged','dataPathsUnchanged'].every(k=>result[k]===true);
        out.append(el('h3','',tr('本次组件修复','This component repair')),el('p',verified||abandoned||settledUnchanged?'':'problem',verified?tr('同版组件已修复并核验。QQ 尚未启动。','The same-version components were repaired and verified. QQ has not been started.'):abandoned?tr('已放弃这次修复，当前代码保持原状。准备副本保留，可随后单独清理。','This repair was abandoned. Current code is unchanged and the prepared copy is retained for separate removal.'):settledUnchanged?tr('上次操作已核验并完成收尾，当前代码保持原状。准备副本仍保留，可单独清理。','The previous operation was verified and its cleanup completed. Current code is unchanged; the prepared copy remains available for separate removal.'):recordedUnchanged?tr('操作记录已写入，当前代码保持原状。收尾尚未确认，请核查上次操作。','The operation record was saved and current code is unchanged. Cleanup is unconfirmed; inspect the previous operation.'):result.liveCode==='original-restored'?tr('原代码已恢复到原位，可能仍有损坏；这不表示修复完成。','The original code is back in place and may still be damaged. This is not a completed repair.'):result.committed===true?errorText('node_repair_readback_failed'):result.committed===false?tr('本次没有替换运行代码。请重新检查原因。','This operation did not replace runtime code. Inspect its reason.'):errorText('node_repair_unconfirmed')));
        if(result.oldTreeRetained===true)out.append(el('p','',tr('原代码已核验保留。','Retention of the original code was verified.')));
        if(result.dataPathsUnchanged===true)out.append(el('p','',tr('账号数据目录保持原位，本次未迁移或写入账号数据。','Account data directories remain in place. This repair did not migrate or write account data.')));
        if(result.recoveryRequired)out.append(el('p','',tr('需要核查未完成操作，恢复前仍不能启动 QQ。','Inspect the unfinished operation. QQ startup remains blocked until recovery is resolved.')));
        if(!result.cleanupVerified&&result.committed===true){const more=details(tr('操作收尾','Operation cleanup'));more.append(el('p','',errorText('node_repair_cleanup_unconfirmed')));out.append(more);}
      }
      const c=(retired||result).code;if(c&&!out.textContent.includes(errorText(c)))out.append(el('p','social-hint',errorText(c)));if(retired||!result.recoveryRequired)out.append(el('p','social-hint',tr('不会自动重试或启动 QQ。','No automatic retry or QQ startup.')));box.append(out);
    }
    function render(content,{busy:parentBusy=false}={}){
      if(!eligible()&&!active)return;const blocked=parentBusy||busy||!!closing||scopeKey()!==boundScope;
      const section=el('details','qq-components-section qq-node-repair');section.id='qq-node-repair';section.open=expanded;section.ontoggle=()=>{if(section.isConnected)expanded=section.open;};section.append(el('summary','',tr('修复同版运行组件','Repair this version')));
      section.append(el('p','',tr('修复受管 Node 的运行代码，保留现有账号数据目录。先检查，再决定是否准备修复。','Repair managed Node runtime code while retaining account data directories. Inspect first, then decide whether to prepare a repair.')));
      section.append(button('qq-node-repair-inspect',tr('检查修复条件','Check repair requirements'),()=>{active=true;void perform('node-repair-inspect');},blocked||!eligible()));
      if(info&&!preview){
        const label={healthy:tr('当前组件核验通过，无需修复。','The components passed verification. No repair is needed.'),damaged:tr('运行代码未通过完整性检查。','Runtime code failed integrity verification.'),missing:tr('运行代码目录缺失，安装记录仍可核实。','Runtime code is missing; the installation record can still be verified.'),unsupported:tr('当前安装不能按此方式修复。','This installation cannot use this repair.'),recovery_required:tr('存在未完成修复，请先核查下方记录。','An unfinished repair needs inspection below.'),unverified:tr('当前状态尚未核实，未启用修复。','Current state is unverified. Repair is not enabled.')};section.append(el('p','',label[info.state]));shared(section,info.scope);
        if(info.reason)section.append(el('p','social-hint',errorText(info.reason)));
        if(info.stopped!=='verified')section.append(el('p','',errorText(info.stopped==='running'?'runtime_running':'process_check_failed')));
        if(info.canPrepare){section.append(el('p','social-hint',tr(`准备会检查固定官方包；本机没有已核验缓存时，将下载 ${bytes(ARCHIVE_BYTES)}。准备不会替换当前代码。`,`Preparation checks the fixed official package and may download ${bytes(ARCHIVE_BYTES)} if no verified cache is available. It does not replace current code.`)));section.append(button('qq-node-repair-prepare',tr('下载并检查同版组件','Download and check this version'),()=>void perform('node-repair-preview',{observationId:info.observationId}),blocked,true));}
        if(info.pending.length){const pending=el('div','qq-node-repair-records');pending.append(el('h3','',tr('未完成修复','Unfinished repairs')));for(const r of info.pending){const row=el('div','qq-node-repair-record');row.append(el('p','',tr(`修复记录 ${r.operationId.slice(0,8)}`,`Repair record ${r.operationId.slice(0,8)}`)));if(!r.decisions.length)row.append(el('p','social-hint',tr('尚不能核实可恢复状态，原文件保留。请检查组件记录。','A recoverable state could not be verified. Files are retained; inspect the component record.')));const actions=el('div','qq-components-actions');for(const decision of r.decisions)actions.append(button(`qq-node-repair-${decision}-${r.operationId}`,decisionName(decision)+tr('预览',' — preview'),()=>void perform('node-repair-reconcile-preview',{operationId:r.operationId,decision}),blocked));row.append(actions);pending.append(row);}section.append(pending);}
        if(info.history.length){const history=details(tr('保留代码与空间','Retained code and storage'));history.append(el('p','',tr(`${info.retention.records} / 16 份记录 · ${bytes(info.retention.bytes)} / 8 GiB`,`${info.retention.records} / 16 records · ${bytes(info.retention.bytes)} / 8 GiB`)));for(const r of info.history){const row=el('div','qq-node-repair-record');row.append(el('p','',tr(`记录 ${r.operationId.slice(0,8)} · ${bytes(r.retainedBytes)}`,`Record ${r.operationId.slice(0,8)} · ${bytes(r.retainedBytes)}`)),button(`qq-node-repair-retire-${r.operationId}`,r.canResumeRetirement?tr('查看继续清理预览','Review remaining cleanup'):tr('查看删除预览','Review removal'),()=>void perform('node-repair-retire-preview',{operationId:r.operationId}),blocked||!(r.canRetire||r.canResumeRetirement)));if(!r.canRetire&&!r.canResumeRetirement&&r.reason)row.append(el('p','social-hint',errorText(r.reason)));history.append(row);}section.append(history);}
      }
      drawPreview(section,blocked);drawResult(section);
      if(message){const p=el('p',failed?'problem':'social-hint',message);p.setAttribute('role',failed?'alert':'status');section.append(p);}
      if(busy){const status=el('p','',cancelling?tr('已请求取消，正在等待本次结果…','Cancellation requested. Waiting for this result…'):expected?tr('正在处理并核验本次操作…','Processing and verifying this operation…'):tr('正在检查或准备组件，请稍候…','Checking or preparing components. Please wait…'));status.setAttribute('role','status');section.append(status,button('qq-node-repair-cancel',tr('请求取消','Request cancellation'),()=>void cancel(),cancelling));}
      content.append(section);
    }
    async function close(){
      if(closing)return closing;if(!active)return true;epoch++;clearTicket();info=null;result=null;retired=null;expected=null;busy=false;cancelling=false;message='';failed=false;
      const owner=panelId;closing=(async()=>{const ok=await requestDismiss(owner);closing=null;if(ok){active=false;expanded=false;panelId=null;}else{active=true;expanded=true;failed=true;message=errorText('node_repair_cleanup_unconfirmed');}redraw();return ok;})();return closing;
    }
    function reset(){if(active||closing)return false;epoch++;clearTicket();panelId=crypto.randomUUID();boundScope=scopeKey();info=null;result=null;retired=null;expected=null;lastDecision='';message='';failed=false;expanded=false;return true;}
    return {render,isBusy:()=>busy||!!closing,isActive:()=>active,close,reset};
  }
  window.ArcadeQQNodeRepair={create};
})();
