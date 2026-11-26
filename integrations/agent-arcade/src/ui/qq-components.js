'use strict';
(() => {
  const drawer=el('dialog','qq-components');drawer.id='qq-components';drawer.setAttribute('aria-labelledby','qq-components-title');document.body.append(drawer);
  const VERSION='4.18.42';
  let context=null,language='zh',state=null,release=null,preview=null,previewKind='',feedback='',failed=false,waiting=false,cancelWaiting=false,epoch=0,binding='',returnFocus=null,lockTarget='',lockPreview=null,lockOpen=false;
  let repairPreview=null,repairOpen=false,repairAction='',repairTimer=null,repairRevision=0;
  let preparationPreview=null,preparationOpen=false,preparationAction='',preparationTimer=null,preparationId='',preparationListed=false;
  let pendingPreview=null,pendingOpen=false,pendingAction='',pendingTimer=null,pendingId='',pendingListed=false,pendingCancelled=false;
  let nodeClosing=null;
  const nodeRepair=window.ArcadeQQNodeRepair?.create({getLanguage:()=>language,getContext:()=>context,redraw:()=>{if(drawer.open)draw();},beforeAction:async()=>{
    const dismiss=[];if(repairPreview)dismiss.push('repair-dismiss');if(preparationPreview)dismiss.push('preparation-dismiss');if(pendingPreview)dismiss.push('pending-dismiss');
    clearRepair();clearPreparation();clearPending();preview=null;previewKind='';lockPreview=null;
    for(const action of dismiss){const r=await window.arcade.qqComponents({action});if(r?.ok!==true)throw Error('Component preview dismissal failed.');}
  }});
  const tr=(zh,en)=>language==='zh'?zh:en;
  const key=value=>JSON.stringify([value?.runtime?.installationKind,value?.runtime?.desktopDataRoot,value?.runtime?.componentsRoot,value?.runtime?.managedSetupId,value?.runtime?.installation?.current?.kind,value?.runtime?.installation?.current?.setupId,value?.selectedCompanionId]);
  const selectionKey=value=>JSON.stringify([value?.component,...[value?.current,value?.previous].map(choice=>choice?[choice.kind,choice.version,choice.versionId]:null)]);
  const lockTargets={component:['组件操作记录','Component operation record'],recovery:['上次恢复记录','Previous recovery record'],configuration:['配置编辑标记','Configuration edit marker']};
  const lockName=target=>Object.hasOwn(lockTargets,target)?tr(...lockTargets[target]):tr('记录类型未确认','Record type unconfirmed');
  const issues={
    invalid_request:['请选择受支持的组件版本。','Choose a supported component version.'],
    operation_in_progress:['另一项组件或账号操作正在进行，请等待结束。','Another component or account operation is in progress. Wait for it to finish.'],
    changed:['管理目录或版本状态已变化，请重新打开并预览。','The folder or selection changed. Reopen and preview it again.'],
    selection_changed:['组件状态已变化，请重新预览。','The component selection changed. Preview it again.'],
    runtime_running:['请先停止此目录下的所有 QQ 后台，再切换组件。','Stop all QQ runtimes in this installation before switching components.'],
    desktop_running:['请先退出 NapCat Desktop，避免两个管理器同时修改组件。','Quit NapCat Desktop before changing components.'],
    operation_locked:['组件目录仍有管理锁，请先检查原管理进程。','The component directory is locked. Check its original manager.'],
    pending_update:['原组件存在待执行更新。请先处理原更新记录，再切换版本。','The original installation has a pending update. Resolve it before switching versions.'],
    network_failed:['暂时无法获取官方组件，请检查网络后重试。','The official component could not be retrieved. Check the network and retry.'],
    timeout:['组件请求超时，请稍后重试。','The component request timed out. Retry shortly.'],
    cancelled:['操作已取消。请重新检查后再继续。','Operation cancelled. Inspect again before continuing.'],
    metadata_invalid:['官方发布信息与已核实版本不符，已停止下载。','Official release metadata differs from the verified version. Download stopped.'],
    digest_mismatch:['文件校验未通过，未用于启动。请保留文件供检查。','The file hash check failed. It was not selected for startup. Keep it for inspection.'],
    package_not_staged:['请先下载并准备这个版本。','Download and prepare this version first.'],
    version_exists:['这个版本目录已经存在，正在保留原文件。请刷新并核验已有版本。','This version directory already exists and was preserved. Refresh and verify it.'],
    no_previous:['没有可回退的组件选择。','There is no previous component selection to restore.'],
    rollback_unavailable:['没有可回退的组件选择。','There is no previous component selection to restore.'],
    unsafe_directory:['组件目录无法安全读取，原文件已保留。请检查目录。','The component directory cannot be read safely. Existing files were preserved.'],
    prepared_invalid:['准备目录未通过完整性检查。请保留原文件并检查，未用于启动。','The prepared directory failed integrity checks. Keep and inspect the files; it was not selected for startup.'],
    archive_invalid:['归档内容或布局无法通过检查，未用于启动。请检查已下载文件。','The archive contents or layout failed checks. Inspect the downloaded file; it was not selected for startup.'],
    archive_unsafe:['归档包含不安全或冲突的路径，已停止准备。','Preparation stopped because the archive contains unsafe or conflicting paths.'],
    archive_limit:['归档超过大小或条目限制，已停止准备。','Preparation stopped because archive size or entry limits were exceeded.'],
    prepare_failed:['组件准备未完成，现有安装未改变。请检查磁盘空间后重试。','Preparation did not complete. The existing installation is unchanged. Check available disk space and retry.'],
    pending_upstream_update:['原组件存在待执行更新。请先处理原更新记录，再切换版本。','The original installation has a pending update. Resolve it before switching versions.'],
    version_change_not_supported:['当前只支持同版本独立目录的切换与回退，尚未支持跨版本升级。','Only switching between separate directories of the same version is supported. Cross-version upgrades are not available yet.'],
    installed_version_unverified:['无法确认原安装版本，请先检查组件目录。','The original installed version could not be verified. Check its component directory.'],
    already_selected:['已选择这个组件目录，无需再次保存。','This component directory is already selected. No further save is needed.'],
    list_limit:['仅显示前 32 个准备目录，请先检查本机组件记录。','Only the first 32 prepared directories are shown. Inspect the local component records.'],
    component_locked:['另一项组件操作持有管理锁。请等待原管理进程结束；未知锁会保留，不会自动删除。','Another component operation holds the management lock. Wait for its manager; unknown locks are kept, not automatically deleted.'],
    runtime_locked:['此安装仍有 QQ 运行锁。请停止全部 QQ 后台；若进程已退出，请先恢复对应实例的管理。','This installation still has QQ runtime locks. Stop every QQ runtime; if its process exited, recover management of that instance first.'],
    unsafe_lock:['无法确认原管理锁的身份。锁文件已保留，请检查原管理器和运行状态。','The management lock identity could not be verified. The lock is preserved; inspect the original manager and running processes.'],
    component_lock_changed:['操作期间管理锁发生变化。请保留原文件并重新检查管理状态。','The management lock changed during the operation. Keep the original files and recheck management status.'],
    process_check_failed:['无法核实全部 QQ 后台已停止，未继续切换。请检查后台状态后刷新。','It could not be verified that all QQ runtimes stopped. The switch did not continue. Check runtime status and refresh.'],
    component_changed:['组件文件与已核实记录不一致。请保留原文件，重新检查准备目录。','Component files differ from the verified record. Preserve the files and inspect the prepared directory.'],
    qq_component_changed:['QQ 客户端文件发生变化，请先核实当前安装；本页不会替换 QQ。','QQ client files changed. Verify the current installation; this view does not replace QQ.'],
    manifest_invalid:['组件清单无法核实，请保留原文件并检查准备记录。','The component manifest could not be verified. Keep the original files and inspect the preparation record.'],
    selection_invalid:['保存的组件选择无法读取。请保留原记录并检查，不要直接覆盖。','The saved component selection cannot be read. Keep and inspect the original record rather than overwriting it.'],
    selection_history_full:['组件选择历史已达到上限。请保留历史并检查后再切换。','The component selection history reached its limit. Preserve and inspect it before switching again.'],
    unsafe_path:['组件路径包含不支持的链接或文件，未继续操作。请检查目录。','The component path contains an unsupported link or file. The operation did not continue. Inspect the directory.'],
    invalid_installation:['组件安装目录不完整，请回到 QQ 账号页重新核实目录。','The component installation is incomplete. Verify its directory on QQ accounts.'],
    component_missing:['所需组件文件不存在，请检查当前或准备目录。','Required component files are missing. Inspect the current or prepared directory.'],
    component_io_failed:['组件记录读写未完成。请保留当前文件并核实状态，不要重复覆盖。','Component record I/O did not complete. Preserve current files and verify state rather than repeatedly overwriting them.'],
    preview_required:['请重新检查所选记录，再确认解除。旧确认不能重复使用。','Inspect the selected record again before confirming. A previous confirmation cannot be reused.'],
    owner_alive:['原操作进程仍在运行。请等待它结束，或在原应用正常退出；当前记录保留。','The original operation is still running. Wait for it to finish or exit its application normally. The record is retained.'],
    owner_identity_changed:['进程身份已改变，不能据此判断原操作已结束。记录保留，未强制接管。','The process identity changed, so the original operation cannot be proved ended. The record is retained; no takeover was forced.'],
    lock_proof_unavailable:['组件操作记录缺少可核实的身份信息，可能是旧格式或损坏记录。已保留，不能在此自动解除。','The component operation record lacks verifiable identity information and may be legacy or damaged. It is retained and cannot be automatically cleared here.'],
    recovery_guard_proof_unavailable:['上次恢复记录的身份信息无法核实。记录保留，不能在此自动解除。','The previous recovery record identity cannot be verified. It is retained and cannot be automatically cleared here.'],
    configuration_proof_unavailable:['配置编辑标记缺少可核实的身份信息，可能是旧格式或损坏记录。已保留，配置内容未恢复或覆盖。','The configuration edit marker lacks verifiable identity information and may be legacy or damaged. It is retained; configuration contents were not restored or overwritten.'],
    configuration_link_changed:['配置编辑标记与原组件操作记录的关联已变化。请保留记录并重新检查。','The configuration edit marker no longer matches its component operation record. Keep the records and inspect again.'],
    component_lock_missing:['未找到所选组件操作记录。本次没有解除记录，请刷新状态。','The selected component operation record is absent. This request did not clear a record; refresh status.'],
    recovery_guard_missing:['未找到所选恢复记录。本次没有解除记录，请刷新状态。','The selected recovery record is absent. This request did not clear a record; refresh status.'],
    configuration_lock_missing:['未找到所选配置编辑标记。本次没有解除记录，请刷新状态。','The selected configuration edit marker is absent. This request did not clear a record; refresh status.'],
    recovery_in_progress:['另一项恢复仍在进行，请等待原操作结束。不会强制接管恢复入口。','Another recovery is still in progress. Wait for it to finish; its recovery gate will not be forcibly taken over.'],
    recovery_gate_unsupported:['当前平台不支持所需的本机恢复机制，记录已保留。','This platform does not support the required local recovery mechanism. The records are retained.'],
    lock_recovery_failed:['恢复结果未能确认。请保留记录并重新检查，不要复用旧确认。','The recovery result could not be verified. Keep the records and inspect again; do not reuse the previous confirmation.'],
    recovery_readback_failed:['记录操作后的最终核验未完成，请刷新并重新检查。','The final check after the record operation did not complete. Refresh and inspect again.'],
    recovery_handle_close_failed:['恢复操作的本机文件句柄未能确认关闭，请重新检查记录状态。','A recovery file handle could not be confirmed closed. Recheck record status.'],
    recovery_guard_retained:['恢复操作记录仍保留，需要单独重新检查。','The recovery record remains and needs a separate inspection.'],
    recovery_guard_state_unverified:['恢复操作记录是否仍在尚未确认，请重新检查。','The recovery record presence is unconfirmed. Inspect again.'],
    recovery_gate_close_failed:['本机恢复入口的收尾未能确认，请重新检查记录状态。','Final cleanup of the local recovery gate could not be verified. Recheck record status.'],
    configuration_handle_close_failed:['配置编辑操作的文件句柄未能确认关闭，请检查记录；不会重新执行配置修改。','The configuration edit handle could not be confirmed closed. Inspect the record; the configuration edit is not replayed.'],
    configuration_marker_retained:['配置编辑标记仍保留，需要单独重新检查；配置内容不会因此恢复。','The configuration edit marker remains and needs a separate inspection; configuration contents are not restored.'],
    configuration_cleanup_unverified:['配置编辑记录的清理未确认。请单独检查；这不表示配置内容已恢复。','Configuration edit-record cleanup is unconfirmed. Inspect it separately; this does not mean configuration contents were restored.'],
    component_lock_handle_close_failed:['组件操作记录的文件句柄未能确认关闭。请检查记录，不要重复已完成的操作。','The component operation record handle could not be confirmed closed. Inspect the record; do not repeat the completed operation.'],
    component_lock_retained:['组件操作记录仍保留。请单独检查，不要重复已完成的操作。','The component operation record remains. Inspect it separately; do not repeat the completed operation.'],
    component_lock_state_unverified:['组件操作记录的清理未确认。请单独检查，不要重复已完成的操作。','Component operation record cleanup is unconfirmed. Inspect it separately; do not repeat the completed operation.'],
    preparation_proof_unavailable:['缺少可核验的写入记录，原文件保留，不能在此隔离。','No verifiable writer record is available. Files are retained and cannot be quarantined here.'],
    preparation_publishing:['这份准备已进入发布阶段，不能按未完成解压处理。原文件保留。','This preparation entered publication and cannot be handled as incomplete extraction. Files are retained.'],
    preparation_complete:['目录已包含发布清单，不能作为未完成准备隔离。','The directory contains a publication manifest and cannot be quarantined as incomplete preparation.'],
    preparation_selected:['该目录已被安装或组件选择引用，未执行隔离。','An installation or selection references this directory. It was not quarantined.'],
    preparation_changed:['准备记录或文件已变化，请重新检查。','The preparation record or files changed. Inspect again.'],
    preparation_busy:['组件准备或恢复正在进行，请等待结束。','Component preparation or recovery is in progress. Wait for it to finish.'],
    preparation_unsafe:['目录无法安全核验，原文件保留。','The directory could not be safely verified. Files are retained.'],
    preparation_limit:['准备记录超过检查上限，原文件保留。','Preparation records exceed the inspection limit. Files are retained.'],
    preparation_record_missing:['这份准备记录已不存在，请重新读取列表。','This preparation record is no longer present. Read the list again.'],
    preparation_already_quarantined:['该目录已隔离保留，请重新读取列表，勿重复确认。','This directory is already quarantined and retained. Read the list again; do not confirm again.'],
    preparation_commit_unconfirmed:['隔离结果尚未确认。请重新检查，勿复用旧确认或自动重试。','The quarantine outcome is unconfirmed. Inspect again; do not reuse the old confirmation or retry automatically.'],
    preparation_readback_failed:['隔离已写入，但完整核验尚未完成。请重新检查，勿重复提交。','Quarantine was written, but full verification is incomplete. Inspect again rather than submitting again.'],
    preparation_recovery_failed:['未能完成本次隔离检查。请保留文件并重新检查。','This quarantine inspection could not finish. Keep the files and inspect again.'],
    preparation_recovery_unavailable:['当前版本不提供未完成准备恢复，请保留原文件。','Incomplete-preparation recovery is unavailable in this version. Keep existing files.'],
    reference_unverified:['无法确认目录是否被已有安装引用，未执行隔离。','References from existing installations could not be verified. No quarantine was performed.'],
    preview_expired:['本次预览已过期，请重新检查。','This preview expired. Inspect again.'],
    preview_required:['请先检查并核对本次预览。','Inspect and review a fresh preview first.'],
    repair_unavailable:['当前没有可检查的同版本历史选择。仅支持从损坏的 Shell 独立版本恢复到已记录的上一选择。','No recorded same-version recovery target is available. This recovery supports only a damaged separate Shell selection with a recorded predecessor.'],
    repair_not_needed:['当前组件未发现这类完整性损坏，无需恢复历史选择。','This integrity check did not find the supported damage. Restoring a previous selection is unnecessary.'],
    repair_target_invalid:['已记录的上一组件未通过核验，未启用恢复。请保留当前目录和记录。','The recorded previous component failed verification. Recovery is not enabled. Preserve the current directories and records.'],
    repair_commit_unconfirmed:['恢复结果尚未确认。请重新检查当前选择，不要复用旧确认。','The recovery result is unconfirmed. Inspect the current selection; do not reuse the previous confirmation.'],
    repair_preview_expired:['本次恢复预览已过期，请重新检查后确认。','This recovery preview expired. Inspect again before confirming.'],
    pending_update_unsupported:['此安装不能在这里停用待更新记录。只有经过完整清单核验的独立组件受支持；原安装的四文件检查不够。','This installation cannot deactivate a pending update here. A separate component with full-manifest verification is required; the original installation’s four-file check is insufficient.'],
    pending_update_missing:['未找到这份待更新记录，请重新检查列表。','This pending update record was not found. Inspect the list again.'],
    pending_update_changed:['记录或组件选择已变化，请重新检查并预览。','The record or component selection changed. Inspect and preview it again.'],
    pending_update_busy:['另一项组件操作仍在进行，请等它结束后重新检查。','Another component operation is in progress. Wait for it to finish and inspect again.'],
    pending_update_unsafe:['这份记录无法安全核验，原文件保留，未启用停用操作。','This record could not be safely verified. Its files are retained and deactivation is unavailable.'],
    pending_update_history_full:['保留记录已达上限，未继续处理。请检查现有保留记录。','Retained records reached the limit. No further handling was attempted; inspect the existing records.'],
    pending_update_recovery_required:['上次操作结果待核查。请重新检查并预览核查，不会重复停用。','The previous outcome needs review. Inspect and preview that review; deactivation will not be repeated.'],
    pending_update_preview_required:['请先检查并核对新的待更新记录预览。','Inspect and review a fresh pending-update preview first.'],
    pending_update_expired:['本次预览已过期，请重新检查。','This preview expired. Inspect again.'],
    pending_update_failed:['待更新记录未能处理。请保留原文件并重新检查。','The pending update could not be handled. Keep its original files and inspect again.'],
    pending_update_unconfirmed:['本次记录操作结果尚未确认。请重新检查并预览核查，不会自动重试。','This record operation is unconfirmed. Inspect and preview a review; it will not retry automatically.'],
    pending_update_readback_failed:['记录操作已提交，但后续核验未完成。请重新检查，不要重复确认。','The record operation committed, but its follow-up verification is incomplete. Inspect again rather than confirming twice.'],
    pending_update_cleanup_unconfirmed:['记录操作的收尾未确认。请重新检查；已提交的更改不会重复执行。','Cleanup of the record operation is unconfirmed. Inspect again; committed changes are not repeated.'],
  };
  const issue=code=>issues[code]?tr(...issues[code]):tr('本次操作未完成。请刷新组件状态后重试。','This operation did not complete. Refresh component status and retry.');
  const phase=()=>({checking:tr('正在读取组件状态…','Reading component status…'),inspecting:tr('正在核对官方发布信息…','Checking the official release…'),downloading:tr('正在下载并校验组件…','Downloading and verifying…'),preparing:tr('正在解压并校验每个文件…','Extracting and verifying every file…'),previewing:tr('正在核对当前与候选版本…','Checking current and candidate versions…'),activating:tr('正在保存组件选择…','Saving the component selection…'),rolling_back:tr('正在恢复上一次选择…','Restoring the previous selection…'),checking_lock:tr('正在核对中断操作记录…','Inspecting the interrupted operation record…'),recovering_lock:tr('正在解除已核验的记录…','Clearing the verified record…'),listing_preparations:tr('正在读取未完成准备记录…','Reading incomplete preparation records…'),checking_preparation:tr('正在核验未完成准备…','Verifying incomplete preparation…'),recovering_preparation:tr('正在隔离保留未完成目录…','Quarantining and retaining the incomplete directory…'),checking_repair:tr('正在核验损坏组件与历史选择…','Checking the damaged component and its predecessor…'),repairing:tr('正在恢复组件选择…','Restoring the component selection…'),cancelling:tr('正在取消当前操作…','Cancelling the current operation…')})[state?.phase]|| (cancelWaiting?tr('正在请求取消…','Requesting cancellation…'):waiting?tr('正在读取组件状态…','Reading component status…'):'');
  const title=value=>value?`${value.version||'—'} · ${value.kind==='original'?tr('原安装目录','Original installation'):value.kind==='prepared'?tr('独立版本目录','Separate version directory'):tr('目录类型未确认','Directory type unverified')}`:tr('尚未读取','Not read yet');
  const btn=(id,text,fn,disabled=false,primary=false)=>{const b=el('button',primary?'primary':'secondary',text);b.id=id;b.disabled=disabled;b.onclick=fn;return b;};
  function clearRepair(){clearTimeout(repairTimer);repairTimer=null;repairPreview=null;}
  function clearPreparation(){clearTimeout(preparationTimer);preparationTimer=null;preparationPreview=null;}
  function clearPending(){clearTimeout(pendingTimer);pendingTimer=null;pendingPreview=null;}
  function finishClose(){const dismiss=!!repairPreview||!!repairAction,dismissPreparation=!!preparationPreview||!!preparationAction,dismissPending=!!pendingPreview||!!pendingAction;epoch++;clearRepair();repairAction='';clearPreparation();preparationAction='';preparationId='';preparationListed=false;clearPending();pendingAction='';pendingId='';pendingListed=false;preview=null;previewKind='';lockPreview=null;lockTarget='';feedback='';waiting=false;cancelWaiting=false;if(drawer.open)drawer.close();document.documentElement.classList.remove('qq-components-open');if(dismiss)void window.arcade.qqComponents({action:'repair-dismiss'}).catch(()=>{});if(dismissPreparation)void window.arcade.qqComponents({action:'preparation-dismiss'}).catch(()=>{});if(dismissPending)void window.arcade.qqComponents({action:'pending-dismiss'}).catch(()=>{});if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});else $('qq-components-open')?.focus({preventScroll:true});}
  function close(){
    if(nodeClosing)return nodeClosing;
    if(!nodeRepair?.isActive()){finishClose();return Promise.resolve(true);}
    nodeClosing=nodeRepair.close().then(ok=>{nodeClosing=null;if(ok)finishClose();else{failed=true;feedback=tr('组件修复的收尾尚未确认。请再次关闭以重试收尾；不会重复修复。','Component repair cleanup is unconfirmed. Close again to retry cleanup; repair will not be repeated.');if(drawer.open)draw();}return ok;});return nodeClosing;
  }
  drawer.addEventListener('cancel',event=>{event.preventDefault();close();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&drawer.open)close();});
  const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  const repairAvailable=()=>state?.component==='napcat-shell'&&state?.current?.kind==='prepared'&&!!state?.previous;
  function repairChoice(value){
    if(!value||!['original','prepared'].includes(value.kind)||value.version!==VERSION)return null;
    if(value.kind==='prepared'&&(typeof value.versionId!=='string'||!/^napcat-shell-4\.18\.42-[a-f0-9]{16}$/.test(value.versionId)))return null;
    return {kind:value.kind,version:VERSION,...(value.kind==='prepared'?{versionId:value.versionId}:{})};
  }
  const sameChoice=(a,b)=>!!a&&!!b&&a.kind===b.kind&&a.version===b.version&&(a.kind!=='prepared'||a.versionId===b.versionId);
  function readRepairPreview(value,current,previous){
    const from=repairChoice(value?.current),target=repairChoice(value?.target),expiry=value?.expiresAt;
    if(value?.operation!=='repair'||typeof value.ticketId!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.ticketId)||!digest(value.expectedDigest)||!Number.isSafeInteger(expiry)||expiry<=Date.now()||expiry>Date.now()+301000||from?.kind!=='prepared'||!sameChoice(from,current)||!sameChoice(target,previous)||value.damage!=='code_integrity_mismatch'||value.preservesDamagedDirectory!==true||value.clearsRollback!==true||value.automaticStart!==false||value.target.verification!==(target.kind==='original'?'mandatory-files-only':'full-manifest'))return null;
    return {operation:'repair',ticketId:value.ticketId,expectedDigest:value.expectedDigest,expiresAt:expiry,current:from,target:{...target,verification:value.target.verification}};
  }
  function repairOutcome(value,expected){
    const unknown={committed:null,changeAttempted:true,code:'repair_commit_unconfirmed',automaticStart:false};
    if(value?.committed===null&&value.changeAttempted===true)return unknown;
    if(value?.committed!==true)return null;
    if(typeof value.repaired!=='boolean'||value.damagedDirectoryPreserved!==true||value.automaticStart!==false)return unknown;
    const raw=value.selection,current=repairChoice(raw?.current),valid=current&&raw.previous===null&&raw.canRollback===false&&digest(raw.digest)&&raw.scope==='napcat-only'&&raw.automaticStart===false&&(!expected||sameChoice(current,expected.target));
    const selection=valid?{current,previous:null,canRollback:false,digest:raw.digest,scope:'napcat-only',automaticStart:false}:null;
    return {committed:true,repaired:value.repaired&&!!selection,selection,damagedDirectoryPreserved:true,automaticStart:false,...(typeof value.refreshIssue==='string'?{refreshIssue:value.refreshIssue}:{}),...(typeof value.lockRecoveryIssue==='string'?{lockRecoveryIssue:value.lockRecoveryIssue}:{})};
  }
  function rememberRepair(value){
    state={...state,lastRepair:value};repairOpen=true;
    if(value.committed!==true){failed=true;feedback=issue('repair_commit_unconfirmed');return;}
    failed=!value.repaired;feedback=value.repaired?tr('健康组件选择已保存。QQ 尚未启动。','Healthy component selection saved. QQ has not been started.'):tr('恢复选择已写入，但完整恢复尚未核实。请重新检查状态，不要重复提交。','The recovery selection was written, but the complete recovery is unverified. Inspect its state rather than submitting again.');
    if(value.selection)state={...state,current:value.selection.current,previous:null};
    if(value.refreshIssue)feedback+=tr(' 后续状态读取未完成。',' The follow-up status reading is incomplete.');
  }
  const preparationUUID=value=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  const preparationVersion=(id,component)=>typeof id==='string'&&['napcat-shell','napcat-node'].includes(component)&&/^napcat-(?:shell|node)-4\.18\.42-[a-f0-9]{16}$/.test(id)&&id.startsWith(`${component}-`);
  function readPreparationEntries(values){
    if(!Array.isArray(values)||values.length>256)return null;
    const rows=[];for(const v of values){if(!preparationUUID(v?.preparationId)||v.component!==state?.component||v.version!==VERSION||!preparationVersion(v.versionId,v.component)||v.state!=='recorded-incomplete'||v.verification!=='not-checked'||rows.some(r=>r.preparationId===v.preparationId))return null;rows.push({preparationId:v.preparationId,component:v.component,version:VERSION,versionId:v.versionId,state:'recorded-incomplete',verification:'not-checked'});}return rows;
  }
  function readPreparationPreview(v,entry){
    if(!entry||v?.operation!=='preparation-recovery'||!preparationUUID(v.ticketId)||!digest(v.expectedDigest)||!Number.isSafeInteger(v.expiresAt)||v.expiresAt<=Date.now()||v.expiresAt>Date.now()+301000||v.preparationId!==entry.preparationId||v.component!==entry.component||v.versionId!==entry.versionId||v.version!==VERSION||v.preservesDirectory!==true||v.automaticRetry!==false||v.automaticStart!==false)return null;
    if(![v.fileCount,v.directoryCount,v.totalBytes].every(Number.isSafeInteger)||v.fileCount<0||v.fileCount>10000||v.directoryCount<0||v.directoryCount>10000||v.totalBytes<0||v.totalBytes>512*1024*1024)return null;
    return {operation:'preparation-recovery',ticketId:v.ticketId,expectedDigest:v.expectedDigest,expiresAt:v.expiresAt,preparationId:entry.preparationId,component:entry.component,versionId:entry.versionId,version:VERSION,fileCount:v.fileCount,directoryCount:v.directoryCount,totalBytes:v.totalBytes,preservesDirectory:true,automaticRetry:false,automaticStart:false};
  }
  function preparationOutcome(v,expected){
    const unknown={committed:null,changeAttempted:true,recovered:false,automaticStart:false,automaticRetry:false};
    if(v?.committed===null&&v.changeAttempted===true)return unknown;if(v?.committed!==true)return null;
    if(typeof v.recovered!=='boolean'||v.preserved!==true||v.automaticStart!==false||v.automaticRetry!==false||v.selectionChanged!==false||!preparationVersion(v.versionId,v.component)||v.component!==state?.component||(expected&&(expected.component!==v.component||expected.versionId!==v.versionId)))return unknown;
    const validId=preparationUUID(v.quarantineId)&&(!expected||v.quarantineId===expected.preparationId);
    return {committed:true,recovered:v.recovered&&validId,component:v.component,versionId:v.versionId,...(validId?{quarantineId:v.quarantineId}:{}),preserved:true,automaticStart:false,automaticRetry:false,selectionChanged:false,...(typeof v.recoveryIssue==='string'?{recoveryIssue:v.recoveryIssue}:{}),...(typeof v.refreshIssue==='string'?{refreshIssue:v.refreshIssue}:{})};
  }
  function rememberPreparation(value){
    state={...state,lastPreparationRecovery:value};preparationOpen=true;preparationListed=false;failed=value.committed!==true||!value.recovered;
    feedback=value.committed!==true?issue('preparation_commit_unconfirmed'):value.recovered?tr('未完成目录已隔离保留。没有重新准备或启动 QQ。','The incomplete directory was quarantined and retained. Preparation was not retried and QQ was not started.'):issue('preparation_readback_failed');
  }
  function readPendingList(v,component){
    if(typeof v?.supported!=='boolean'||v.component!==component||!['napcat-shell','napcat-node'].includes(component)||v.verification!=='not-checked'||!Array.isArray(v.records)||v.records.length>32||!(v.issue===null||typeof v.issue==='string'))return null;
    const records=[];for(const r of v.records){if(!digest(r?.recordId)||!['pending-update','review-required'].includes(r.state)||!(r.bytes===null||Number.isSafeInteger(r.bytes)&&r.bytes>=0&&r.bytes<=2097152)||records.some(item=>item.recordId===r.recordId))return null;records.push({recordId:r.recordId,state:r.state,bytes:r.bytes});}
    return {supported:v.supported,component,verification:'not-checked',records,issue:v.issue};
  }
  function readPendingPreview(v,entry,component){
    if(!entry||!['disable-pending-update','reconcile-pending-update'].includes(v?.operation)||v.operation!==(entry.state==='review-required'?'reconcile-pending-update':'disable-pending-update')||v.recordId!==entry.recordId||!preparationUUID(v.ticketId)||!digest(v.expectedDigest)||!Number.isSafeInteger(v.expiresAt)||v.expiresAt<=Date.now()||v.expiresAt>Date.now()+301000||v.component!==component||v.version!==VERSION||v.verification!=='full-manifest'||!Number.isSafeInteger(v.bytes)||v.bytes<0||v.bytes>2097152||v.disablesPlan!==(v.operation==='disable-pending-update')||v.preservesOriginal!==true||v.rollsBackCode!==false||v.automaticStart!==false)return null;
    return {operation:v.operation,recordId:v.recordId,ticketId:v.ticketId,expectedDigest:v.expectedDigest,expiresAt:v.expiresAt,component,version:VERSION,verification:'full-manifest',bytes:v.bytes,disablesPlan:v.disablesPlan,preservesOriginal:true,rollsBackCode:false,automaticStart:false};
  }
  function pendingOutcome(v,expected){
    const unknown={committed:null,disabled:null,retained:null,recordId:expected?.recordId||null,operationId:null,automaticStart:false,rollsBackCode:false,code:'pending_update_unconfirmed'};
    if(!v||!digest(v.recordId)||expected&&v.recordId!==expected.recordId||v.operationId!==undefined&&v.operationId!==null&&!preparationUUID(v.operationId)||![true,false,null].includes(v.committed)||![true,false,null].includes(v.disabled)||![true,false,null].includes(v.retained)||v.automaticStart!==false||v.rollsBackCode!==false)return unknown;
    if(v.committed===false&&(v.disabled!==false||v.retained!==false)||v.disabled===true&&(v.committed!==true||v.retained!==true)||v.committed===null&&(v.disabled!==null||v.retained!==null)||expected?.operation==='disable-pending-update'&&v.committed===true&&v.disabled===false)return unknown;
    return {committed:v.committed,disabled:v.disabled,retained:v.retained,recordId:v.recordId,operationId:v.operationId||null,automaticStart:false,rollsBackCode:false,...(typeof v.code==='string'?{code:v.code}:{}),...(typeof v.refreshIssue==='string'?{refreshIssue:v.refreshIssue}:{})};
  }
  function rememberPending(value){state={...state,lastPendingUpdate:value};pendingOpen=true;pendingListed=false;pendingId='';failed=value.committed!==true||!!value.code;feedback=value.committed===null?issue('pending_update_unconfirmed'):value.committed===false?tr('本次未提交记录更改。请重新检查后决定下一步。','No record change was committed by this request. Inspect again before choosing the next step.'):value.disabled===true&&value.retained===true?tr('待更新记录已保留并停用，QQ 未启动。','The pending update record was retained and deactivated. QQ was not started.'):value.disabled===false&&value.retained===false?tr('已记录核查结果：原待更新记录仍在，尚未停用。','Review recorded: the original pending update remains active. It was not deactivated.'):issue('pending_update_readback_failed');if(value.code&&value.committed!==null&&!feedback.includes(issue(value.code)))feedback+=' '+issue(value.code);}
  async function run(action,options={}){
    if(!drawer.open||waiting||cancelWaiting||nodeRepair?.isBusy()||nodeClosing)return;
    if(nodeRepair?.isActive()){if(!await nodeRepair.close())return;if(!drawer.open)return;nodeRepair.reset();}
    if(action==='repair'&&(!repairPreview||repairPreview.expiresAt<=Date.now()||options.ticketId!==repairPreview.ticketId||options.expectedDigest!==repairPreview.expectedDigest)){clearRepair();failed=true;feedback=issue('repair_preview_expired');draw();return;}
    if(action==='preparation-recover'&&(!preparationPreview||preparationPreview.expiresAt<=Date.now()||options.ticketId!==preparationPreview.ticketId||options.expectedDigest!==preparationPreview.expectedDigest)){clearPreparation();failed=true;feedback=issue('preview_expired');draw();return;}
    if(action==='pending-confirm'&&(!pendingPreview||pendingPreview.expiresAt<=Date.now()||options.ticketId!==pendingPreview.ticketId||options.expectedDigest!==pendingPreview.expectedDigest)){clearPending();failed=true;feedback=issue('pending_update_expired');draw();return;}
    const pendingExpected=pendingPreview,pendingEntry=state?.pendingUpdates?.records?.find(row=>row.recordId===options.recordId),pendingComponent=state?.component;
    const preparationExpected=preparationPreview,preparationEntry=(state?.preparationEntries||[]).find(row=>row.preparationId===options.preparationId);
    const repairExpected=repairPreview,currentChoice=repairChoice(state?.current),previousChoice=repairChoice(state?.previous),selectionRevision=repairRevision;
    const ticket=++epoch;waiting=true;feedback='';failed=false;repairAction=['repair-preview','repair'].includes(action)?action:'';clearRepair();preparationAction=['preparation-preview','preparation-recover'].includes(action)?action:'';clearPreparation();pendingAction=['pending-list','pending-preview','pending-confirm'].includes(action)?action:'';pendingCancelled=false;clearPending();
    preview=null;previewKind='';lockPreview=null;
    draw();
    try{
      const result=await window.arcade.qqComponents({action,...options});
      if(ticket!==epoch||!drawer.open)return;
      if(action==='pending-confirm'&&(result?.ok===true||result?.pendingUpdateResult)){rememberPending(pendingOutcome(result.pendingUpdateResult,pendingExpected));}
      else if(action==='preparation-recover'&&(result?.ok===true||result?.committed===true||result?.changeAttempted===true)){rememberPreparation(preparationOutcome(result,preparationExpected)||{committed:null,changeAttempted:true,recovered:false,automaticStart:false,automaticRetry:false});}
      else if(action==='repair'&&(result?.ok===true||result?.committed===true||result?.changeAttempted===true)){rememberRepair(repairOutcome(result,repairExpected)||{committed:null,changeAttempted:true,code:'repair_commit_unconfirmed',automaticStart:false});}
      else if(result?.ok!==true){failed=result?.code!=='cancelled';feedback=issue(result?.code);}
      else{
        if(result.state)state=result.state;
        if(result.release)release=result.release;
        if(result.preview){preview=result.preview;previewKind=options.operation==='rollback'?'rollback':'activate';}
        if(action==='pending-list'){
          pendingOpen=true;if(selectionRevision!==repairRevision){failed=true;feedback=issue('selection_changed');return;}
          const list=readPendingList(result.pendingUpdates,pendingComponent);pendingListed=!!list;state={...state,pendingUpdates:list};pendingId=list?.records.length===1?list.records[0].recordId:'';
          if(!list){failed=true;feedback=tr('待更新记录的读取结果无法核实，请重新检查。','The pending-update reading could not be verified. Inspect again.');}
        }
        if(action==='pending-preview'){
          pendingOpen=true;if(selectionRevision!==repairRevision||pendingCancelled){failed=!pendingCancelled;feedback=issue(pendingCancelled?'cancelled':'selection_changed');void window.arcade.qqComponents({action:'pending-dismiss'}).catch(()=>{});return;}
          pendingPreview=readPendingPreview(result.pendingUpdatePreview,pendingEntry,pendingComponent);
          if(!pendingPreview){failed=true;feedback=tr('待更新记录的预览无法核实，未启用确认。','The pending-update preview could not be verified. Confirmation is disabled.');void window.arcade.qqComponents({action:'pending-dismiss'}).catch(()=>{});}
          else{const expected=pendingPreview;pendingTimer=setTimeout(()=>{if(pendingPreview!==expected)return;clearPending();failed=true;feedback=issue('pending_update_expired');void window.arcade.qqComponents({action:'pending-dismiss'}).catch(()=>{});if(drawer.open)draw();},Math.max(0,expected.expiresAt-Date.now()));}
        }
        if(action==='preparation-list'){
          const entries=readPreparationEntries(result.preparationEntries);
          if(!entries||!Array.isArray(result.preparationIssues)||result.preparationIssues.length>32){failed=true;feedback=tr('准备记录无法核实，请重新检查。','Preparation records could not be verified. Inspect again.');state={...state,preparationEntries:[]};preparationListed=false;}
          else{state={...state,preparationEntries:entries,preparationIssues:result.preparationIssues.filter(code=>typeof code==='string')};preparationListed=true;preparationId=entries.length===1?entries[0].preparationId:'';}preparationOpen=true;
        }
        if(action==='preparation-preview'){
          preparationOpen=true;if(selectionRevision!==repairRevision){failed=true;feedback=issue('selection_changed');return;}
          preparationPreview=readPreparationPreview(result.preparationPreview,preparationEntry);
          if(!preparationPreview){failed=true;feedback=tr('未完成准备的预览无法核实，未启用隔离。','The incomplete-preparation preview could not be verified. Quarantine is disabled.');void window.arcade.qqComponents({action:'preparation-dismiss'}).catch(()=>{});}
          else{const expected=preparationPreview;preparationTimer=setTimeout(()=>{if(preparationPreview!==expected)return;clearPreparation();failed=true;feedback=issue('preview_expired');void window.arcade.qqComponents({action:'preparation-dismiss'}).catch(()=>{});if(drawer.open)draw();},Math.max(0,expected.expiresAt-Date.now()));}
        }
        if(action==='repair-preview'){
          if(selectionRevision!==repairRevision){failed=true;feedback=issue('selection_changed');return;}
          repairOpen=true;repairPreview=readRepairPreview(result.repairPreview,currentChoice,previousChoice);
          if(!repairPreview){failed=true;feedback=tr('恢复预览无法核实，未启用确认。请重新检查。','The recovery preview could not be verified. Confirmation is disabled; inspect again.');}
          else{const expected=repairPreview;repairTimer=setTimeout(()=>{if(repairPreview!==expected)return;clearRepair();failed=true;feedback=issue('repair_preview_expired');if(drawer.open)draw();},Math.max(0,expected.expiresAt-Date.now()));}
        }
        if(action==='lock-preview'){
          const value=result.lockPreview;
          if(value?.target===options.target&&value.target===lockTarget&&typeof value.expectedDigest==='string'&&/^[a-f0-9]{64}$/.test(value.expectedDigest)&&value.automaticStart===false&&value.selectionChanged===false&&value.configurationRestored===false&&typeof value.componentLockRemaining==='boolean'&&typeof value.recoveryGuardRemaining==='boolean')lockPreview={target:value.target,expectedDigest:value.expectedDigest,componentLockRemaining:value.componentLockRemaining,recoveryGuardRemaining:value.recoveryGuardRemaining};
          else{failed=true;feedback=tr('所选记录的核验回执不完整，未启用解除。请重新检查。','The selected record inspection receipt is incomplete. Clearing is not enabled; inspect again.');}
        }
        if(result.preparationCommitted===true){if(result.prepared)state={...state,prepared:[result.prepared]};failed=true;feedback=tr('准备结果已发布，但操作收尾未确认。请重新检查状态，不要再次点击准备；组件选择未改变。','The preparation was published, but final cleanup is unconfirmed. Inspect its state instead of preparing again; the component selection is unchanged.');if(!result.prepared)feedback+=tr(' 文件完整性尚未重新核实。',' File integrity has not been reverified.');}
        else if(result.prepared){state={...state,prepared:[result.prepared]};feedback=tr('组件已准备好。查看切换预览后，才会改变下次启动使用的版本。','Component prepared. Review the switch before changing the version used at the next start.');}
        if(action==='lock-recover'){
          const receipt=result.target===options.target?recoveryReceipt(result):null;
          if(receipt){state={...state,lastRecovery:receipt};lockOpen=true;feedback=receipt.recovery?tr('本次记录处理结果已保留在下方。没有自动处理其他记录或启动 QQ。','The record outcome is shown below. No other record was handled and QQ was not started.'):tr('已发生文件更改，但完整结果未核实。请查看下方记录并重新检查，不要复用旧确认。','A file change occurred, but the complete outcome is unverified. Review the record below and inspect again; do not reuse the previous confirmation.');failed=!receipt.recovery;}
          else{failed=true;feedback=issue('lock_recovery_failed');}
        }else if(result.committed){preview=null;feedback=tr('组件选择已保存。请回到 QQ 账号页，按需启动账号。','Component selection saved. Return to QQ accounts and start an account when ready.');if(result.refreshIssue)feedback+=tr(' 状态刷新暂未完成；已保存的选择不会重复执行。',' Status refresh is pending; the saved selection is not repeated.');if(typeof result.lockRecoveryIssue==='string')feedback+=tr(' 操作记录的清理未确认。请展开“中断操作恢复”检查，不要再次保存同一选择。',' Operation-record cleanup is unconfirmed. Inspect Interrupted operation recovery instead of saving the same selection again.');}
      }
    }catch{if(ticket===epoch&&drawer.open){if(action==='pending-confirm')rememberPending(pendingOutcome(null,pendingExpected));else if(action==='preparation-recover')rememberPreparation({committed:null,changeAttempted:true,recovered:false,automaticStart:false,automaticRetry:false});else if(action==='repair')rememberRepair({committed:null,changeAttempted:true,code:'repair_commit_unconfirmed',automaticStart:false});else{failed=true;feedback=action==='lock-recover'?issue('lock_recovery_failed'):tr('组件管理暂不可用，请重新打开。','Component management is unavailable. Reopen this view.');}}}
    finally{if(ticket===epoch&&drawer.open){waiting=false;repairAction='';preparationAction='';pendingAction='';draw();}}
  }
  async function cancel(){
    if(cancelWaiting||state?.phase==='cancelling')return;
    const ticket=epoch;cancelWaiting=true;pendingCancelled=true;clearRepair();clearPreparation();clearPending();lockPreview=null;preview=null;previewKind='';draw();
    try{const result=await window.arcade.qqComponents({action:'cancel'});if(ticket!==epoch||!drawer.open)return;if(result?.state)state=result.state;if(result?.ok!==true){failed=true;feedback=issue(result?.code);}else if(result.cancelRequested&&(waiting||state?.busy)){feedback=tr('已请求取消，正在等待当前步骤结束。','Cancellation requested; waiting for the current step to end.');}}
    catch{if(ticket===epoch&&drawer.open){failed=true;feedback=tr('取消请求未确认。请刷新状态检查正在进行的步骤。','Cancellation was not confirmed. Refresh status to check the active step.');}}
    finally{if(ticket===epoch&&drawer.open){cancelWaiting=false;draw();}}
  }
  function recoveryReceipt(value){
    if(value?.committed!==true||typeof value.target!=='string'||!Object.hasOwn(lockTargets,value.target))return null;
    const raw=value.recovery,valid=raw&&raw.target===value.target&&raw.recovered===true&&raw.automaticStart===false&&raw.selectionChanged===false&&raw.configurationRestored===false&&[raw.componentLockRemaining,raw.recoveryGuardRemaining].every(field=>field===undefined||field===null||typeof field==='boolean');
    const recovery=valid?{target:raw.target,recovered:true,automaticStart:false,selectionChanged:false,configurationRestored:false,...(raw.componentLockRemaining!==undefined?{componentLockRemaining:raw.componentLockRemaining}:{}),...(raw.recoveryGuardRemaining!==undefined?{recoveryGuardRemaining:raw.recoveryGuardRemaining}:{})}:null;
    return {target:value.target,committed:true,recovery,...(typeof value.recoveryIssue==='string'?{recoveryIssue:value.recoveryIssue}:{}),...(typeof value.refreshIssue==='string'?{refreshIssue:value.refreshIssue}:{})};
  }
  function recoveryControls(content,busy){
    const details=el('details','qq-components-section qq-components-recovery');details.id='qq-components-recovery';details.open=lockOpen;details.ontoggle=()=>{if(details.isConnected)lockOpen=details.open;};details.append(el('summary','',tr('中断操作恢复','Interrupted operation recovery')));
    details.append(el('p','social-hint',tr('这是此安装下所有 QQ 共用的管理记录。先停止所有 QQ 并退出 NapCat Desktop。旧格式、损坏或来源不明的记录会保留，不会强制解除。','These records are shared by the QQ accounts in this installation. Stop all QQ runtimes and quit NapCat Desktop first. Legacy, damaged and unknown records are retained, never forcibly cleared.')));
    const label=el('label','',tr('这次检查哪类记录','Record to inspect')),select=el('select');label.htmlFor='qq-components-lock-target';select.id=label.htmlFor;select.disabled=busy;
    const empty=el('option','',tr('选择一类记录','Choose one record type'));empty.value='';select.append(empty);for(const target of Object.keys(lockTargets)){const option=el('option','',lockName(target));option.value=target;select.append(option);}select.value=lockTarget;
    select.onchange=()=>{epoch++;lockTarget=select.value;lockPreview=null;preview=null;previewKind='';feedback='';failed=false;draw();};details.append(label,select);
    const descriptions={component:['只解除已核验的组件操作记录，不改变组件版本选择。','Clear only the verified component operation record, without changing the selected version.'],recovery:['只解除上次恢复操作留下的记录。其他组件操作记录需要另行检查和确认。','Clear only the record left by the previous recovery. Other component operation records need a separate inspection and confirmation.'],configuration:['只解除配置编辑标记，不恢复、不回退，也不核验配置文件内容。','Clear only the configuration edit marker. Configuration contents are not restored, rolled back or verified.']};
    if(Object.hasOwn(descriptions,lockTarget))details.append(el('p','social-hint',tr(...descriptions[lockTarget])));
    details.append(btn('qq-components-lock-inspect',tr('检查这类记录','Inspect this record'),()=>void run('lock-preview',{target:lockTarget}),busy||!Object.hasOwn(lockTargets,lockTarget)));
    if(lockPreview){
      const value=lockPreview,box=el('section','qq-components-preview');box.id='qq-components-lock-preview';box.setAttribute('aria-label',tr('核对中断操作记录','Review interrupted operation record'));
      box.append(el('h3','',lockName(value.target)),el('p','',tr('已核验原操作进程退出。本次仅处理这一个记录。','The original operation owner was verified absent. This action handles only this record.')),el('p','social-hint',tr('账号数据和配置内容保留，不切换版本，不启动 QQ。不会自动继续处理其他记录。','Account data and configuration contents are retained. No version switch, QQ start or automatic next recovery follows.')));
      if(value.target!=='component'&&value.componentLockRemaining)box.append(el('p','social-hint',tr('组件操作记录仍在，处理本项后需另行检查。','A component operation record remains and needs a separate inspection afterward.')));
      if(value.target==='configuration'&&value.recoveryGuardRemaining)box.append(el('p','social-hint',tr('上次恢复记录也仍在，处理本项后需另行检查。','A previous recovery record also remains and needs a separate inspection afterward.')));
      const actions=el('div','qq-components-actions');actions.append(btn('qq-components-lock-cancel',tr('取消','Cancel'),async()=>{lockPreview=null;preview=null;previewKind='';await cancel();$('qq-components-lock-inspect')?.focus({preventScroll:true});},busy),btn('qq-components-lock-confirm',tr(`解除这项${lockName(value.target)}`,`Clear this ${lockName(value.target).toLowerCase()}`),()=>void run('lock-recover',{target:value.target,expectedDigest:value.expectedDigest}),busy,true));box.append(actions);details.append(box);
    }
    const receipt=recoveryReceipt(state?.lastRecovery);
    if(receipt){const box=el('section','qq-components-preview');box.id='qq-components-lock-receipt';box.setAttribute('role','status');box.append(el('h3','',tr('最近一次记录处理','Last record operation')),el('p','',lockName(receipt.target)));
      if(receipt.recovery){box.append(el('p','',tr('这项记录已解除。未更改组件选择或配置内容，也未启动 QQ。','This record was cleared. Component selection and configuration contents were not changed, and QQ was not started.')));
        if(receipt.recovery.componentLockRemaining===true)box.append(el('p','social-hint',tr('组件操作记录仍在，需要单独检查。','A component operation record remains and needs a separate inspection.')));
        if(receipt.recovery.recoveryGuardRemaining===true)box.append(el('p','social-hint',tr('上次恢复记录仍在，需要单独检查。','A previous recovery record remains and needs a separate inspection.')));
        if(receipt.recovery.recoveryGuardRemaining===null||receipt.recovery.recoveryGuardRemaining===undefined)box.append(el('p','social-hint',issue('recovery_guard_state_unverified')));
        if(receipt.recovery.componentLockRemaining===null||receipt.recovery.componentLockRemaining===undefined)box.append(el('p','social-hint',tr('组件操作记录是否仍在尚未确认，请重新检查。','The component operation record presence is unconfirmed. Inspect again.')));
      }else box.append(el('p','problem',tr('已发生文件更改，但完整回执未核实，不能确认这类记录已全部处理。请保留记录并重新检查，不要复用旧确认。','A file change occurred, but the complete receipt was not verified. This record type cannot be declared fully handled. Keep the records and inspect again; do not reuse the previous confirmation.')));
      if(receipt.recoveryIssue)box.append(el('p','social-hint',issue(receipt.recoveryIssue)));
      if(receipt.refreshIssue)box.append(el('p','social-hint',tr('后续状态刷新未完成。已发生的记录操作不会重复执行，请刷新后核对。','The follow-up status refresh did not complete. The record operation is not repeated; refresh and inspect its state.')));details.append(box);
    }
    content.append(details);
  }
  function repairControls(content,busy){
    const receipt=repairOutcome(state?.lastRepair);if(!repairAvailable()&&!receipt&&!repairOpen)return;
    const details=el('details','qq-components-section qq-components-repair');details.id='qq-components-repair';details.open=repairOpen;details.ontoggle=()=>{if(details.isConnected)repairOpen=details.open;};details.append(el('summary','',tr('恢复健康组件','Restore healthy components')));
    details.append(el('p','social-hint',tr('适用于当前独立组件损坏、且保留了同版本历史选择的情况。先停止此安装下的所有 QQ；检查不会下载、替换损坏文件或启动账号。','For a damaged separate component with a recorded same-version predecessor. Stop every QQ runtime in this installation first. Inspection does not download, replace damaged files or start an account.')));
    details.append(btn('qq-components-repair-inspect',tr('检查可恢复的组件','Inspect a recoverable component'),()=>void run('repair-preview'),busy||!repairAvailable()));
    if(repairPreview){const value=repairPreview,box=el('section','qq-components-preview');box.id='qq-components-repair-preview';box.setAttribute('aria-label',tr('核对组件恢复','Review component recovery'));
      box.append(el('h3','',tr('确认下次启动使用的组件','Confirm the component used at the next start')),el('p','',tr(`当前损坏选择：${title(value.current)}`,`Current damaged selection: ${title(value.current)}`)),el('code','qq-components-repair-id',value.current.versionId),el('p','',tr(`恢复目标：${title(value.target)}`,`Recovery target: ${title(value.target)}`)));
      if(value.target.versionId)box.append(el('code','qq-components-repair-id',value.target.versionId));
      box.append(el('p','social-hint',value.target.verification==='mandatory-files-only'?tr('目标为原安装目录，只核验了四个启动所需文件，并非全部代码。','The target is the original installation. Only four mandatory startup files were checked, not every code file.'):tr('目标独立版本已按完整准备清单核验。','The target separate version was checked against its complete preparation manifest.')));
      box.append(el('p','social-hint',tr('损坏目录、账号配置和 QQ 数据保留。恢复后清除回退选择，不再提供回退到这个损坏版本；不会自动启动 QQ。','The damaged directory, account configuration and QQ data are retained. Recovery clears the rollback selection so the damaged version is not offered for rollback. QQ is not started automatically.')));
      box.append(el('p','social-hint',tr('关闭此页会撤销尚未提交的修复确认；已提交的更改不会撤回。','Closing dismisses an unsubmitted recovery confirmation; committed changes are not undone.')));
      const actions=el('div','qq-components-actions');actions.append(btn('qq-components-repair-dismiss',tr('暂不恢复','Keep current selection'),async()=>{clearRepair();await window.arcade.qqComponents({action:'repair-dismiss'}).catch(()=>{});if(drawer.open)draw();},busy),btn('qq-components-repair-confirm',tr('恢复到此组件','Use this healthy component'),()=>void run('repair',{ticketId:value.ticketId,expectedDigest:value.expectedDigest}),busy||value.expiresAt<=Date.now(),true));box.append(actions);details.append(box);
    }
    if(receipt){const box=el('section','qq-components-preview');box.id='qq-components-repair-receipt';box.setAttribute('role','status');box.append(el('h3','',tr('最近一次组件恢复','Last component recovery')));
      if(receipt.committed!==true)box.append(el('p','problem',issue('repair_commit_unconfirmed')));
      else{
        box.append(el('p','',receipt.repaired?tr('健康组件选择已保存。','Healthy component selection saved.'):tr('恢复选择已写入，但完整恢复尚未核实。请重新检查，不要重复提交。','The recovery selection was written, but the complete recovery is unverified. Inspect again rather than submitting again.')));
        if(receipt.selection)box.append(el('p','',title(receipt.selection.current)));
        box.append(el('p','social-hint',tr('损坏目录和账号数据保留；QQ 未自动启动。','The damaged directory and account data were retained; QQ was not started automatically.')));
        if(receipt.selection)box.append(el('p','social-hint',tr('当前不提供回退到损坏版本。','Rollback to the damaged version is not offered.')));
        if(receipt.refreshIssue)box.append(el('p','social-hint',tr('后续状态读取未完成。已提交的恢复不会重复执行。','The follow-up state reading is incomplete. The committed recovery is not repeated.')));
        if(receipt.lockRecoveryIssue)box.append(el('p','social-hint',tr('操作记录的清理未确认，请在“中断操作恢复”中检查。','Operation-record cleanup is unconfirmed. Inspect Interrupted operation recovery.')));
      }
      details.append(box);
    }
    content.append(details);
  }
  function preparationControls(content,busy){
    const details=el('details','qq-components-section qq-components-preparation');details.id='qq-components-preparation';details.open=preparationOpen;details.ontoggle=()=>{if(details.isConnected)preparationOpen=details.open;};details.append(el('summary','',tr('未完成的组件准备','Incomplete component preparation')));
    details.append(el('p','social-hint',tr('准备中断后，可检查本应用留下的写入记录。仅处理尚未发布、未被安装引用的目录；旧格式或来源不明的文件保留。','After interrupted preparation, inspect this app’s writer records. Only unpublished, unreferenced directories are eligible; legacy or unknown files are retained.')));
    details.append(btn('qq-components-preparation-list',tr('检查未完成准备','Inspect incomplete preparation'),()=>void run('preparation-list'),busy));
    const entries=readPreparationEntries(state?.preparationEntries||[])||[];
    if(preparationListed){
      for(const code of state?.preparationIssues||[])details.append(el('p','social-hint',issue(code)));
      if(!entries.length)details.append(el('p','social-hint',tr('未发现可列出的未完成准备记录。未认领来源不明的目录。','No recorded incomplete preparation was found. Unknown directories were not claimed.')));
      else{const label=el('label','',tr('本次检查的准备记录','Preparation record to inspect')),select=el('select');label.htmlFor='qq-components-preparation-select';select.id=label.htmlFor;select.disabled=busy;const empty=el('option','',tr('选择一份记录','Choose a record'));empty.value='';select.append(empty);for(const entry of entries){const row=el('option','',`${entry.component==='napcat-node'?'Node':'Shell'} ${entry.version} · ${entry.preparationId.slice(0,8)}`);row.value=entry.preparationId;select.append(row);}select.value=preparationId;select.onchange=()=>{preparationId=select.value;clearPreparation();void window.arcade.qqComponents({action:'preparation-dismiss'}).catch(()=>{});feedback='';failed=false;draw();};details.append(label,select,el('p','social-hint',tr('这里只显示记录，尚未核验原写入进程是否退出。','This is a record listing; the original writer’s exit has not yet been verified.')),btn('qq-components-preparation-preview',tr('核验并预览隔离','Verify and preview quarantine'),()=>void run('preparation-preview',{preparationId}),busy||!entries.some(row=>row.preparationId===preparationId)));}
    }
    if(preparationPreview){const v=preparationPreview,box=el('section','qq-components-preview');box.id='qq-components-preparation-preview-box';box.append(el('h3','',tr('隔离保留这份未完成目录','Quarantine and retain this incomplete directory')),el('code','qq-components-repair-id',v.versionId),el('p','social-hint',tr(`准备记录 ${v.preparationId.slice(0,8)} · ${v.fileCount} 个文件 · ${v.directoryCount} 个目录 · ${(v.totalBytes/1024/1024).toFixed(1)} MiB`,`Record ${v.preparationId.slice(0,8)} · ${v.fileCount} files · ${v.directoryCount} directories · ${(v.totalBytes/1024/1024).toFixed(1)} MiB`)),el('p','',tr('已核验原写入进程退出。将这份目录移入本机隔离区，原文件全部保留。','The original writer was verified absent. This directory will be moved into local quarantine with its files retained.')),el('p','social-hint',tr('不改变已选组件、账号配置或登录数据。不会自动重新下载、准备或启动 QQ。之后是否重新准备，由你另行选择。','The selected component, account configuration and login data are unchanged. No automatic download, preparation retry or QQ start follows. A new preparation requires a separate choice.')));
      const actions=el('div','qq-components-actions');actions.append(btn('qq-components-preparation-dismiss',tr('暂不处理','Not now'),async()=>{clearPreparation();await window.arcade.qqComponents({action:'preparation-dismiss'}).catch(()=>{});if(drawer.open)draw();},busy),btn('qq-components-preparation-confirm',tr('隔离并保留文件','Quarantine and keep files'),()=>void run('preparation-recover',{ticketId:v.ticketId,expectedDigest:v.expectedDigest}),busy||v.expiresAt<=Date.now(),true));box.append(actions);details.append(box);
    }
    const receipt=preparationOutcome(state?.lastPreparationRecovery);
    if(receipt){const box=el('section','qq-components-preview');box.id='qq-components-preparation-receipt';box.setAttribute('role','status');box.append(el('h3','',tr('最近一次准备恢复','Last preparation recovery')));
      if(receipt.committed!==true)box.append(el('p','problem',issue('preparation_commit_unconfirmed')));
      else{box.append(el('p',receipt.recovered?'':'problem',receipt.recovered?tr('未完成目录已隔离，文件保留。','The incomplete directory was quarantined and its files retained.'):issue('preparation_readback_failed')),el('p','social-hint',tr('已选组件与账号数据未改变，未重新准备或启动 QQ。','The selected component and account data are unchanged. No preparation retry or QQ start occurred.')));if(receipt.quarantineId)box.append(el('code','qq-components-repair-id',tr(`隔离记录 ${receipt.quarantineId}`,`Quarantine record ${receipt.quarantineId}`)));if(receipt.recoveryIssue)box.append(el('p','social-hint',issue(receipt.recoveryIssue)));if(receipt.refreshIssue)box.append(el('p','social-hint',tr('后续列表读取未完成，请手动重新检查；不会重复隔离。','The follow-up list could not be read. Inspect again manually; quarantine is not repeated.')));}
      details.append(box);
    }
    content.append(details);
  }
  function pendingControls(content,busy){
    const details=el('details','qq-components-section qq-components-pending');details.id='qq-components-pending';details.open=pendingOpen;details.ontoggle=()=>{if(details.isConnected)pendingOpen=details.open;};details.append(el('summary','',tr('待更新记录','Pending update records')));
    details.append(el('p','social-hint',tr('更新中断留下的记录可能阻止启动。可先检查，再将符合条件的记录保留并停用；这不会修复或回滚已经改变的组件文件。','A record left by an interrupted update can block startup. Inspect it before retaining and deactivating an eligible record. This does not repair or roll back changed component files.')));
    if(!pendingPreview){
      details.append(btn('qq-components-pending-list',tr('检查待更新记录','Inspect pending update records'),()=>void run('pending-list'),busy));
      const list=pendingListed?readPendingList(state?.pendingUpdates,state?.component):null;
      if(list){
        if(list.issue)details.append(el('p','social-hint',issue(list.issue)));
        if(!list.supported&&!list.issue)details.append(el('p','social-hint',issue('pending_update_unsupported')));
        if(list.supported&&!list.records.length&&!list.issue)details.append(el('p','social-hint',tr('本次未发现待更新记录，无需处理。','No pending update record was found in this inspection. Nothing needs handling.')));
        if(list.records.length){
          const label=el('label','',tr('本次检查的记录','Record to inspect')),select=el('select');label.htmlFor='qq-components-pending-select';select.id=label.htmlFor;select.disabled=busy;const none=el('option','',tr('选择一份记录','Choose a record'));none.value='';select.append(none);
          for(const r of list.records){const option=el('option','',`${r.recordId.slice(0,12)} · ${r.state==='review-required'?tr('上次结果待核查','Previous outcome needs review'):tr('待更新','Pending update')}${r.bytes===null?'':` · ${r.bytes} B`}`);option.value=r.recordId;select.append(option);}select.value=pendingId;select.onchange=()=>{pendingId=select.value;clearPending();feedback='';failed=false;void window.arcade.qqComponents({action:'pending-dismiss'}).catch(()=>{});draw();};
          const chosen=list.records.find(r=>r.recordId===pendingId);details.append(label,select,el('p','social-hint',tr('列表只发现记录；预览前还会完整核验组件，并确认此安装下的 QQ 全部退出。','This list only discovers records. Preview also verifies the complete component and confirms all QQ runtimes in this installation have exited.')),btn('qq-components-pending-preview',chosen?.state==='review-required'?tr('预览结果核查','Preview outcome review'):tr('核验并预览停用','Verify and preview deactivation'),()=>void run('pending-preview',{recordId:pendingId}),busy||!list.supported||!chosen));
        }
      }
    }
    if(pendingPreview){const v=pendingPreview,reconcile=v.operation==='reconcile-pending-update',box=el('section','qq-components-preview');box.id='qq-components-pending-preview-box';box.append(el('h3','',reconcile?tr('核查上次记录操作','Review the previous record operation'):tr('保留并停用这份记录','Retain and deactivate this record')),el('p','',`${v.component==='napcat-node'?'Node':'Shell'} ${v.version} · ${v.bytes} B`),el('code','qq-components-repair-id',v.recordId),el('p','social-hint',tr('当前独立组件已按完整准备清单核验。','The current separate component was verified against its complete preparation manifest.')),el('p','',reconcile?tr('只核查并记录上次操作的实际状态，不会再次移动或停用记录。','Review and record the actual outcome of the previous attempt. The record will not be moved or deactivated again.'):tr('原记录文件将保留到本机历史中，不再作为待更新计划使用。','The original record file will be retained in local history and will no longer act as a pending update plan.')),el('p','social-hint',tr('不回滚或修复组件代码，不改变账号配置或登录数据，不会自动启动 QQ。','No component code is rolled back or repaired, no account configuration or login data is changed, and QQ is not started automatically.')));
      const actions=el('div','qq-components-actions');actions.append(btn('qq-components-pending-dismiss',tr('暂不处理','Not now'),async()=>{clearPending();const own=epoch;await window.arcade.qqComponents({action:'pending-dismiss'}).catch(()=>{});if(own===epoch&&drawer.open)draw();},busy),btn('qq-components-pending-confirm',reconcile?tr('记录核查结果','Record reviewed outcome'):tr('保留并停用','Retain and deactivate'),()=>void run('pending-confirm',{ticketId:v.ticketId,expectedDigest:v.expectedDigest}),busy||v.expiresAt<=Date.now(),true));box.append(actions);details.append(box);
    }
    if(state?.lastPendingUpdate){const v=pendingOutcome(state.lastPendingUpdate),box=el('section','qq-components-preview');box.id='qq-components-pending-receipt';box.setAttribute('role','status');box.append(el('h3','',tr('最近一次待更新记录处理','Last pending-update record operation')));
      if(v.committed===null)box.append(el('p','problem',issue('pending_update_unconfirmed')));
      else if(v.committed===false)box.append(el('p','',tr('本次未提交记录更改。','No record change was committed by this request.')));
      else if(v.disabled===true&&v.retained===true)box.append(el('p','',tr('待更新记录已停用，原文件已核验保留。','The pending update record is inactive and its original file was verified retained.')),el('p','social-hint',tr('这是本次操作的核验回执，不代表组件已经修复，也不是对历史文件的持续检查。','This is the verification receipt for this operation. It does not mean the component was repaired or that retained history is continuously rechecked.')));
      else if(v.disabled===false&&v.retained===false)box.append(el('p','',tr('核查结果已记录：原待更新记录仍在，尚未停用。','Review recorded: the original pending update remains active and was not deactivated.')));
      else box.append(el('p','problem',issue('pending_update_readback_failed')));
      if(v.recordId)box.append(el('code','qq-components-repair-id',v.recordId));if(v.code&&v.code!=='pending_update_unconfirmed'&&!(v.disabled===null&&v.code==='pending_update_readback_failed'))box.append(el('p','social-hint',issue(v.code)));if(v.refreshIssue)box.append(el('p','social-hint',tr('后续状态读取未完成，请重新检查；不会重复本次操作。','The follow-up state reading is incomplete. Inspect again; this operation is not repeated.')));
      box.append(el('p','social-hint',tr('未自动启动 QQ，未回滚组件代码。','QQ was not started automatically and component code was not rolled back.')));details.append(box);
    }
    content.append(details);
  }
  function draw(){
    const previousRecovery=drawer.querySelector('#qq-components-recovery');if(previousRecovery)lockOpen=previousRecovery.open;
    const focused=document.activeElement?.id,scroll=drawer.querySelector('.qq-components-content')?.scrollTop||0;
    const busy=waiting||cancelWaiting||!!state?.busy||!!nodeRepair?.isBusy()||!!nodeClosing,isNode=state?.component==='napcat-node'||context?.runtime?.installationKind==='managed-node',head=el('div','qq-components-heading'),heading=el('div');
    const h=el('h2','',tr('组件版本','Component versions'));h.id='qq-components-title';heading.append(h,el('p','',isNode?tr('当前独立安装使用的 QQ 运行组件','QQ runtime components for this separate installation'):tr('QQ 账号共用的 NapCat 接入组件','The NapCat component shared by QQ accounts')));head.append(heading,btn('qq-components-close',tr('关闭','Close'),close));
    const content=el('div','qq-components-content');
    const current=el('section','qq-components-section');current.append(el('h3','',tr('下次启动使用','Used on the next start')),el('p','qq-components-current',title(state?.current)));
    current.append(el('p','social-hint',tr('配置与登录数据仍使用现有目录。切换前须停止该安装下的所有 QQ；不会自动启动账号。','Configuration and login data stay in their existing directories. Stop every QQ runtime in this installation before switching. Accounts are not started automatically.')));
    current.append(btn('qq-components-refresh',tr('刷新状态','Refresh status'),()=>void run('status'),busy));
    if(state?.previous)current.append(btn('qq-components-preview-rollback',tr('查看回退预览','Preview rollback'),()=>void run('preview',{operation:'rollback'}),busy));content.append(current);
    nodeRepair?.render(content,{busy:waiting||cancelWaiting||!!nodeClosing||!!state?.busy&&!nodeRepair.isBusy()});
    pendingControls(content,busy);preparationControls(content,busy);repairControls(content,busy);recoveryControls(content,busy);
    const available=el('section','qq-components-section');available.append(el('h3','',`NapCat ${VERSION}`),el('p','social-hint',isNode?tr('官方 Windows Node 发布包。使用独立账号数据目录，不更改已有 QQ 安装。','Official Windows Node release. Uses separate account data directories and preserves existing QQ installations.'):tr('官方 Shell 发布包。只下载明确核实的版本，不替换 QQ 客户端。','Official Shell release. Downloads only the verified version; the QQ client is not replaced.')));
    const actions=el('div','qq-components-actions');actions.append(btn('qq-components-inspect',tr('核对官方版本','Check official release'),()=>void run('inspect',{version:VERSION}),busy),btn('qq-components-prepare',tr('下载并准备','Download and prepare'),()=>void run('prepare',{version:VERSION}),busy,true));available.append(actions);
    if(release){available.append(el('p','qq-components-meta',`${release.name} · ${(release.size/1024/1024).toFixed(1)} MiB`));const hashes=el('details','qq-components-hashes');hashes.append(el('summary','',tr('查看校验值','View checksum')),el('code','',`SHA-256 ${release.sha256}`));available.append(hashes);}
    for(const item of state?.prepared||[]){const row=el('div','qq-components-prepared');row.append(el('strong','',tr(`已准备 ${item.version}`,`${item.version} prepared`)),el('p','social-hint',tr(`${item.fileCount} 个文件 · ${(item.totalBytes/1024/1024).toFixed(1)} MiB，尚未因此启动或验证登录。`,`${item.fileCount} files · ${(item.totalBytes/1024/1024).toFixed(1)} MiB. This does not start QQ or verify login.`)));if(item.verified===false)row.append(el('p','social-hint',tr('当前显示准备记录，文件完整性将在预览与启动前重新核验。','Showing the preparation record. File integrity is rechecked before preview and startup.')));if(isNode&&item.versionId===state?.current?.versionId)row.append(el('p','social-hint',tr('当前安装已选用此组件。其他安装可在“准备 QQ”中选择。','This installation already selects these components. Choose another installation in Prepare QQ.')));else row.append(btn('qq-components-preview',tr('查看切换预览','Preview switch'),()=>void run('preview',{versionId:item.versionId}),busy));available.append(row);}
    content.append(available);
    if(preview){const box=el('section','qq-components-preview');box.append(el('h3','',previewKind==='rollback'?tr('回退预览','Rollback preview'):tr('切换预览','Switch preview')),el('p','',`${title(preview.current)} → ${title(preview.candidate||preview.previous)}`),el('p','social-hint',tr('只更改 NapCat 程序选择。已有账号、连接配置与 QQ 数据目录保留。','Only the NapCat program selection changes. Accounts, connection configuration and QQ data directories are retained.')));box.append(btn('qq-components-commit',previewKind==='rollback'?tr('回退到上一次选择','Restore previous selection'):tr('保存组件选择','Save component selection'),()=>void run(previewKind==='rollback'?'rollback':'activate',{...(previewKind==='rollback'?{}:{versionId:preview.candidate.versionId}),expectedDigest:preview.digest}),busy,true));content.append(box);}
    const warning=!feedback&&state?.lastCode,isProblem=failed||!!(warning&&warning!=='cancelled'),foot=el('div','qq-components-footer'),status=el('p',isProblem?'problem':'','');status.id='qq-components-status';status.setAttribute('role',isProblem?'alert':'status');status.textContent=pendingAction&&waiting?(cancelWaiting?tr('正在请求取消…','Requesting cancellation…'):pendingAction==='pending-list'?tr('正在检查待更新记录…','Inspecting pending update records…'):pendingAction==='pending-preview'?tr('正在完整核验组件与记录…','Verifying the complete component and record…'):tr('正在处理并核验记录结果…','Handling and verifying the record outcome…')):phase()||feedback||(warning?issue(warning):'');foot.append(status);
    if(pendingAction&&waiting||state?.busy&&['inspecting','downloading','preparing','checking_lock','recovering_lock','checking_repair','repairing','listing_preparations','checking_preparation','recovering_preparation','listing_pending_updates','checking_pending_update','disabling_pending_update','cancelling'].includes(state.phase))foot.append(btn('qq-components-cancel',pendingAction||['checking_lock','recovering_lock','checking_repair','repairing','checking_preparation','recovering_preparation'].includes(state?.phase)?tr('请求取消','Request cancellation'):tr('取消操作','Cancel operation'),()=>void cancel(),cancelWaiting||state?.phase==='cancelling'));
    drawer.replaceChildren(head,content,foot);content.scrollTop=scroll;const restore=focused&&$(focused);if(restore&&drawer.contains(restore)&&!restore.disabled)restore.focus({preventScroll:true});
  }
  window.openQQComponents=async()=>{if(typeof window.arcade.qqComponents!=='function')return;if(nodeClosing&&!await nodeClosing)return;if(nodeRepair?.isActive()&&!await nodeRepair.close())return;nodeRepair?.reset();returnFocus=document.activeElement;binding=key(context);preview=null;lockPreview=null;lockTarget='';clearRepair();repairAction='';repairOpen=!!repairOutcome(state?.lastRepair);clearPreparation();preparationAction='';preparationId='';preparationListed=false;preparationOpen=!!preparationOutcome(state?.lastPreparationRecovery);clearPending();pendingAction='';pendingId='';pendingListed=false;pendingOpen=!!state?.lastPendingUpdate;release=null;feedback='';failed=false;waiting=false;cancelWaiting=false;draw();document.documentElement.classList.add('qq-components-open');drawer.showModal();$('qq-components-close').focus();void run('status');};
  window.renderQQComponents=next=>{const changed=key(next)!==key(context),selectionChanged=!!next.state&&selectionKey(next.state)!==selectionKey(state);if(next.language!==language){feedback='';failed=false;}context=next;language=next.language||'en';if(next.state||changed)state=next.state||null;if(selectionChanged)repairRevision++;if(drawer.open){if(view!=='qq-runtime'||key(next)!==binding){close();release=null;return;}if(selectionChanged&&(preparationPreview||preparationAction==='preparation-preview')){clearPreparation();failed=true;feedback=issue('selection_changed');void window.arcade.qqComponents({action:'preparation-dismiss'}).catch(()=>{});}if(selectionChanged&&(repairPreview||repairAction==='repair-preview')){clearRepair();failed=true;feedback=issue('selection_changed');void window.arcade.qqComponents({action:'repair-dismiss'}).catch(()=>{});}if(selectionChanged){pendingListed=false;if(pendingPreview||pendingAction==='pending-preview'){clearPending();failed=true;feedback=issue('selection_changed');void window.arcade.qqComponents({action:'pending-dismiss'}).catch(()=>{});}}draw();}};
  if(typeof data!=='undefined'&&data)window.renderQQRuntime?.(data);
})();
