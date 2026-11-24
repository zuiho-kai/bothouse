'use strict';
(() => {
  const section=el('section','view qq-runtime-panel');section.id='qq-runtime-view';section.hidden=true;document.querySelector('main').append(section);
  const nav=el('button','nav');nav.dataset.view='qq-runtime';
  const symbol=document.createElementNS('http://www.w3.org/2000/svg','svg');symbol.setAttribute('viewBox','0 0 24 24');symbol.setAttribute('width','22');symbol.setAttribute('height','22');symbol.setAttribute('fill','none');symbol.setAttribute('stroke','currentColor');symbol.setAttribute('stroke-width','1.6');symbol.setAttribute('aria-hidden','true');
  for(const [name,attributes] of [['rect',{x:4,y:4,width:16,height:16,rx:4}],['path',{d:'M8 9h8M8 13h8M8 17h3'}]]){const node=document.createElementNS(symbol.namespaceURI,name);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,value);symbol.append(node);}
  const navText=el('span');nav.append(symbol,navText);document.querySelector('nav [data-view="settings"]').before(nav);nav.onclick=()=>switchView('qq-runtime');
  const compact=el('option');compact.value='qq-runtime';$('view-picker').append(compact);
  let selectedAccount='',accountRevision=0;const loginAdvancedOpen=new Map(),loginMoreOpen=new Map();
  let latest,language='zh',cached=null,busy=false,started=false,feedback='',failed=false,fingerprint='',qrAccount='',qrImage='',qrRevision='',logsAccount='',logs=[];
  let pollTimer=null,pollInFlight=false,pollProblem=false,operationRevision=0,pollVisible=false,closed=false;
  let formRoot='',installationRevision=0,installationChanged=false,addAccount='',addOpen=false,installationOpen=false,navigationAccount=null,navigationIntent='manage';const formDrafts=new Map(),backupViews=new Map(),orphanViews=new Map();
  const aiConnecting=new Map(),aiFeedback=new Map();
  let conversationOpening=null,conversationManagementRevision=0;
  let diagnosticReport=null,logsScope=null,orphanGeneration=0,settledFeedback=null;const discardedOrphans=new WeakSet(),orphanConfirmations=new Map();
  function diagnosticScope(accountId){
    const runtime=cached||latest?.qqRuntime,row=runtime?.instances?.find(item=>item.accountId===accountId);
    return row?JSON.stringify([orphanRoot(runtime),installationRevision,accountRevision,latest?.accounts?.selectedId,accountId,row.runtimeRevision||null,!!row.processRunning]):null;
  }
  const tr=(zh,en)=>language==='zh'?zh:en;
  const issues={
    desktop_running:['NapCat Desktop 正在管理这些账号。迁移前请在原管理器停止对应 Bot，再退出 Desktop。现有登录数据保留。','NapCat Desktop manages these accounts. Stop the Bots there and quit Desktop before transferring control. Login data is retained.'],
    external_process:['此账号由其他进程管理，请先在原管理器停止。','This account is managed externally. Stop it in its original manager first.'],
    external_qq_unknown:['无法确认现有 QQ 进程属于哪个账号，未接管。','The existing QQ process could not be assigned to an account; it was not taken over.'],
    missing_components:['未找到完整 QQ / NapCat 组件。请选择已安装组件的数据目录。','QQ / NapCat components are incomplete. Choose their installed data folder.'],
    process_check_failed:['无法核实后台进程，未执行启停。稍后重试。','Could not verify background processes. No process was changed; retry later.'],
    start_failed:['QQ 后台未能完成启动。请检查组件文件、Windows 权限和运行诊断，再决定是否重试。','QQ did not finish starting. Check component files, Windows permissions and runtime diagnostics before retrying.'],
    start_unverified:['已尝试启动 QQ，但未能核实新进程身份，自动控制已停用。请查看运行诊断并核对旧进程，不要重复启动。','QQ startup was attempted, but the new process identity could not be verified. Automatic control is disabled. Inspect runtime diagnostics and existing processes before starting again.'],
    stop_failed:['已尝试停止 QQ，但未能确认全部进程停止。管理记录保留；请刷新状态、查看运行诊断，不要另开一份 QQ。','Stopping QQ was attempted, but not all processes were confirmed stopped. The ownership record is retained. Refresh status and inspect runtime diagnostics before starting another instance.'],
    unsafe_lock:['管理记录目录无法安全访问，现有记录保留。请检查目录权限和原管理进程，不要删除记录或重复启动。','The ownership-record folder cannot be accessed safely. Existing records are kept. Check folder permissions and the original manager; do not delete records or start another instance.'],
    invalid_installation:['当前安装不完整或无法核实。请在“准备 QQ”读取安装状态；导入已有安装时，选择包含 components 的 NapCat 数据目录。','The current installation is incomplete or could not be verified. Read its state in Prepare QQ; when importing an existing installation, choose the NapCat data folder containing components.'],
    prepared_invalid:['组件目录与准备记录不一致，已停止启动。请打开“管理组件版本”检查；现有文件保留。','The component directory differs from its preparation record. Startup stopped. Inspect Manage component versions; existing files are preserved.'],
    component_changed:['组件文件在核验后发生变化，未继续启动。请检查组件版本。','Component files changed after verification. Startup did not continue. Inspect the component version.'],
    component_locked:['组件切换尚未结束，请等待原操作完成后再启动 QQ。','A component switch is still in progress. Wait for it to finish before starting QQ.'],
    passkey_maintenance_required:['通行密钥维护尚未收尾，启动暂不可用。请由该安装管理员核查维护记录；不要重复提交撤销。','Passkey maintenance is unsettled and startup is blocked. Have this installation’s administrator reconcile the maintenance record; do not repeat revocation.'],
    shell_repair_busy:['共享组件正被维护，请等待本次操作结束。','The shared component is under maintenance. Wait for this operation to finish.'],
    shell_repair_changed:['共享组件已变化，请重新检查当前状态。','The shared component changed. Inspect its current state again.'],
    shell_repair_unavailable:['组件记录无法核实，请先检查原安装。','Component records could not be verified. Inspect the original installation first.'],
    shell_repair_recovery_required:['上次组件修复尚未收尾，请在原修复入口核实后再启动 QQ。','The previous component repair is unsettled. Reconcile it in the original repair entry before starting QQ.'],
    shell_repair_cleanup_unconfirmed:['组件修复资源尚未确认收尾，请核查原操作，不要重复启动。','Component repair cleanup is unconfirmed. Inspect the original operation; do not start another instance.'],
    pending_upstream_update:['原组件存在待执行更新，请先处理原更新记录再启动。','The original component has a pending update. Resolve its update record before starting.'],
    pending_update_recovery_required:['待更新记录尚需核查，启动暂不可用。已有进程的停止或恢复管理以可用按钮为准。','The update record still needs review, so startup is unavailable. Use any available Stop or Recover control for existing processes.'],
    runtime_locked:['此账号仍有运行归属记录，需要先核实旧进程。','This account has an existing ownership record. Its previous process must be checked.'],
    recovery_required:['上次管理记录仍在，请先恢复管理；不会新开一份 QQ。','A previous management record remains. Recover management without starting another QQ instance.'],
    deployment_recovery_required:['插件文件变更尚未恢复，请在“本机组件 → 插件文件与安装”检查并恢复；不会自动启动。','Plugin file changes need recovery. Inspect and restore them in Local components → Plugin files and installation. Nothing will start automatically.'],
    owner_alive:['另一个 Agent Arcade 仍在管理此账号，请先关闭原应用。','Another Agent Arcade is managing this account. Close that application first.'],
    orphaned_children:['旧 QQ 的子进程仍在，无法直接恢复管理。可以先检查残留进程；当前未启动新实例。','Child processes from the previous QQ runtime remain. Inspect them before deciding whether to clear them; no new instance was started.'],
    orphan_cleanup_changed:['残留进程或管理记录已变化，旧确认已失效。请重新检查。','The remaining processes or ownership record changed. The previous confirmation expired; inspect again.'],
    orphan_cleanup_unverified:['无法核实全部残留进程的身份和归属，本次没有停止进程。请保留记录并检查原管理器。','The remaining process identities and ownership could not all be verified. Nothing was stopped. Keep the record and inspect the original manager.'],
    orphan_cleanup_unavailable:['当前不能核实可清理的残留进程，请刷新状态或查看运行诊断。','No eligible remaining processes could be verified. Refresh status or inspect runtime diagnostics.'],
    orphan_cleanup_incomplete:['部分进程未能确认停止，管理记录已保留。请重新检查，不要启动另一份 QQ。','Some processes could not be confirmed stopped. The ownership record was kept. Inspect again before starting another QQ instance.'],
    preview_required:['请先检查当前残留进程，再确认清理。旧确认不能重复使用。','Inspect the current remaining processes before confirming cleanup. A previous confirmation cannot be reused.'],
    manager_closing:['QQ 管理器正在关闭，请等待结束后再操作。','The QQ manager is closing. Wait for it to finish.'],
    cleanup_unconfirmed:['管理资源收尾尚未确认，请查看运行诊断；尚不能据此确认已停止或可以重新启动。','Management cleanup is unconfirmed. Inspect runtime diagnostics; this does not confirm that processes stopped or can be restarted.'],
    ownership_lost:['进程身份已变化，自动管理已停止。','The process identity changed; automatic management stopped.'],
    not_owned:['当前应用没有启动这个进程，不能直接停止它。','This application did not start that process and cannot stop it.'],
    endpoint_unverified:['管理接口尚未与此 QQ 进程匹配，请刷新状态。','The management endpoint is not yet matched to this QQ process. Refresh status.'],
    endpoint_recheck_unavailable:['暂时无法再次核实本机管理接口，在线状态待核实。请稍后刷新；这不代表已确认账号或目录改变。','The local management endpoint could not be rechecked. Online status is unverified; refresh shortly. An account or folder change has not been confirmed.'],
    webui_unavailable:['本机管理接口尚未就绪，请先恢复管理或启动 QQ，再刷新状态。','The local management endpoint is not ready. Recover management or start QQ, then refresh status.'],
    webui_config_not_local:['这份运行组件的管理配置无法确认为仅本机使用，现有设置未改动。可先停止或恢复管理，再在“准备 QQ”创建独立环境。','This runtime’s management configuration is not verified as local-only. Existing settings are preserved. Stop or recover management, then create an independent environment in Prepare QQ.'],
    invalid_config:['本机管理配置不完整，请检查组件安装。','Local management configuration is incomplete. Check the installation.'],
    unauthorized:['本机管理认证已失效，请刷新状态；应用不会修改认证设置。','Local management authentication expired. Refresh status; authentication settings are not changed.'],
    two_factor_required:['此管理接口需要双重认证，当前尚不能在应用内完成。','This management endpoint requires two-factor authentication, which is not yet supported here.'],
    account_changed:['登录账号与所选账号不同，连接已阻止。请核对登录身份。','The signed-in account differs from the selected account. Check the login identity.'],
    qr_unavailable:['二维码尚未准备好，请稍后刷新。','The QR code is not ready. Refresh shortly.'],
    already_logged_in:['账号已经登录，请刷新状态。','The account is already signed in. Refresh status.'],
    rate_limited:['本机管理接口限制了认证频率，请稍后重试。','Local management authentication is rate limited. Retry later.'],
    connection_failed:['暂时无法连接 QQ 管理接口，请检查后台状态。','Cannot reach the QQ management endpoint. Check the background runtime.'],
    timeout:['本机管理接口未及时响应，请刷新状态。','The local management endpoint timed out. Refresh status.'],
    unsupported_platform:['本机 QQ 后台管理当前支持 Windows。','Local QQ runtime management currently supports Windows.'],
    qce_version_unsupported:['当前 QQ 运行方式不支持所装 QCE 版本。请保留原版本；QCE 6.4.2 仅支持应用管理的 Shell 组件。','This QQ runtime does not support the installed QCE version. Retain the previous version; QCE 6.4.2 requires the app-managed Shell component.'],
    qce_startup_unverified:['无法核对 QCE 的配置和旧导出目录，本次未启动 QQ。请保留现有文件并检查 QCE 配置。','QCE configuration and legacy export folders could not be verified, so QQ was not started. Keep the existing files and check QCE configuration.'],
    qce_startup_migration_required:['QCE 新版可能移动旧导出文件，本次未启动 QQ。请先保留旧版本和导出文件；数据迁移尚不支持。','This QCE version may move legacy exports, so QQ was not started. Retain the previous version and exported files; data migration is not supported yet.'],
    qce_startup_changed:['QCE 配置或旧导出目录在检查后发生变化，本次未启动 QQ。请重新核对后再启动。','QCE configuration or legacy folders changed after inspection, so QQ was not started. Check them again before starting.'],
    qce_port_unavailable:['QCE 的端口正被占用或无法核实。请检查正在运行的 QCE 实例，再决定是否启动这个 QQ。','A QCE port is in use or could not be verified. Check the running QCE instances before starting this QQ account.'],
    qce_process_unverified:['无法核实 QCE 后台服务属于这次 QQ 运行。请保留现状并查看诊断，不要重复启动。','The QCE service could not be linked to this QQ runtime. Keep its current state and inspect diagnostics before starting again.'],
    operation_in_progress:['此账号的操作尚未结束。','An operation for this account is still running.'],
    changed:['管理目录或账号状态已变化，请重新操作。','The management folder or account changed. Retry from its current state.'],
    config_invalid:['连接配置无法读取，请检查已有配置；未覆盖原文件。','The connection configuration is unreadable. Check the existing file; it was not overwritten.'],
    config_changed:['配置刚刚发生变化，请刷新后重新选择。','The configuration changed. Refresh and select it again.'],
    profile_exists:['这个 QQ 账号已经存在，请在对应卡片中配置。','This QQ account already exists. Configure its card below.'],
    server_ambiguous:['存在多个连接，请明确选择要使用的连接。','Several connections exist. Select the one to use.'],
    server_missing:['所选连接已不存在，请刷新后重新选择。','The selected connection no longer exists. Refresh and select again.'],
    server_invalid:['请先准备本机连接：启用回环地址并保存连接凭据。','Prepare the local connection first: enable its loopback address and connection credentials.'],
    invalid_server_name:['连接名称无效，请从现有列表中重新选择。','The connection name is invalid. Select it from the existing list.'],
    invalid_port:['请输入 1024–65535 之间的有效端口，或留空自动选择。','Enter a valid port from 1024–65535, or leave it blank for automatic selection.'],
    port_conflict:['这个端口已被另一份配置使用，请换一个或留空自动选择。','Another configuration uses this port. Choose another or leave it blank.'],
    port_unavailable:['这个端口当前不可用，请换一个或留空自动选择。','This port is unavailable. Choose another or leave it blank.'],
    backup_failed:['原配置备份失败，本次未保存。请检查目录是否可写。','The original configuration could not be backed up. Check that the folder is writable.'],
    write_failed:['配置未能保存，请检查目录权限后重试。','The configuration could not be saved. Check folder permissions and retry.'],
    runtime_running:['请先停止这个 QQ 的后台进程，再修改连接配置。','Stop this QQ runtime before changing its connection configuration.'],
    account_connected:['请先在“管理搭档”中断开这位 AI，再保存绑定。','Disconnect this AI in Manage companions before saving its binding.'],
    invalid_owner:['请输入有效的主人 QQ 号。','Enter a valid owner QQ number.'],
    owner_is_agent_account:['主人 QQ 不能是 AI 自己的账号，请填写你的 QQ。','The owner cannot be the AI account. Enter your own QQ number.'],
    credentials_locked:['这位搭档的凭据尚未解锁，请先完成凭据迁移。','This companion’s credentials are locked. Complete credential migration first.'],
    configuration_save_failed:['绑定未保存，原连接凭据已恢复。请检查配置后重试。','The binding was not saved. The previous connection credentials were restored. Check the configuration and retry.'],
    configuration_rollback_failed:['保存失败，原连接的恢复状态未确认。请保留当前文件并重新检查这位搭档的配置。','Saving failed and restoration of the previous connection is unconfirmed. Keep the current files and recheck this companion’s configuration.'],
    backup_invalid:['所选备份缺失、损坏、过大或包含链接，无法恢复。','The selected backup is missing, invalid, too large or linked; it cannot be restored.'],
    backup_changed:['备份内容已变化，请重新列出并预览。','The backup changed. List and preview it again.'],
    backup_selection_required:['请先选择一份有效备份并查看变更预览。','Select a valid backup and review its changes first.'],
    backup_directory_unsafe:['备份目录不可安全读取，请保留原文件并检查目录。','The backup directory cannot be read safely. Keep the original files and check the folder.'],
  };
  const issue=code=>issues[code]?tr(...issues[code]):tr('本次操作未完成，请检查后台状态。','The operation did not finish. Check the runtime status.');
  const cleanupWarning=result=>result&&(typeof result.configurationRecoveryIssue==='string'||typeof result.lockRecoveryIssue==='string')?tr(' 操作记录的清理未确认。请打开“本机组件 → 管理组件版本 → 中断操作恢复”检查；不要重复刚才已完成的操作。',' Operation-record cleanup is unconfirmed. Open Local components → Manage component versions → Interrupted operation recovery. Do not repeat the completed operation.') : '';
  // Presentation only: keep service error codes and retry policy unchanged.
  window.qqConnectionGuidance=(problem,locale=language)=>{
    const text=typeof problem==='string'?problem:'',say=(zh,en)=>locale==='zh'?zh:en;
    if(text.startsWith('QQ 报告当前登录已失效'))return say('QQ 登录已失效。打开“QQ 登录与运行”，核对对应账号后显示二维码并本人确认登录，再连接搭档。','QQ sign-in expired. Open QQ sign-in & runtime, check the account and display its QR code. Confirm sign-in yourself, then reconnect the companion.');
    if(text.startsWith('QQ 当前离线'))return text.includes('正在等待')?say('QQ 当前离线，应用正在等待恢复并重新检查。可以打开“QQ 登录与运行”核对状态；只有显示需要登录时才需扫码。','QQ is offline; the app is waiting for recovery and checking again. Open QQ sign-in & runtime to inspect it. Scan only if sign-in is required.'):say('QQ 当前离线，自动连接已暂停。打开“QQ 登录与运行”核对状态；恢复后再连接搭档，只有显示需要登录时才需扫码。','QQ is offline and automatic connection is paused. Check QQ sign-in & runtime, then reconnect the companion after recovery. Scan only if sign-in is required.');
    if(text.startsWith('尚未核实 QQ 在线状态'))return text.includes('正在重新检查')?say('尚未核实 QQ 在线状态，应用正在重新检查。可以打开“QQ 登录与运行”查看对应账号。','QQ online status is unverified and the app is checking again. Inspect the account in QQ sign-in & runtime.'):say('尚未核实 QQ 在线状态，未启动消息接收。请打开“QQ 登录与运行”核对账号状态和“连接配置与搭档”，再连接。','QQ online status is unverified; message receiving has not started. Open QQ sign-in & runtime and inspect the account and Connection and companion before reconnecting.');
    return null;
  };
  window.openQQRuntime=({accountId}={})=>{
    navigationIntent='manage';navigationAccount=typeof accountId==='string'&&/^[1-9][0-9]{4,14}$/.test(accountId)?accountId:null;switchView('qq-runtime');requestAnimationFrame(focusRequestedAccount);
  };
  window.openQQAccountLoginDialog=({accountId}={})=>{
    navigationIntent='login';navigationAccount=typeof accountId==='string'&&/^[1-9][0-9]{4,14}$/.test(accountId)?accountId:null;switchView('qq-runtime');requestAnimationFrame(focusRequestedAccount);
  };
  function focusRequestedAccount(){
    if(!navigationAccount||view!=='qq-runtime'||busy)return;
    const target=navigationAccount,intent=navigationIntent;navigationAccount=null;navigationIntent='manage';if((cached||latest?.qqRuntime)?.instances?.some(row=>row.accountId===target)){openAccountDialog(target,intent);document.getElementById('qq-runtime-account-'+target)?.focus({preventScroll:true});return;}if(selectedAccount!==target){selectLoginAccount(target);}const card=document.getElementById(`qq-runtime-account-${target}`);
    if(card){card.scrollIntoView({block:'center',behavior:'auto'});card.focus({preventScroll:true});}
    else{feedback=tr(`当前数据目录未找到 QQ ${target}，请核对所选数据目录或添加这个账号。`,`QQ ${target} was not found in this data folder. Check the selected folder or add this account.`);failed=false;draw();section.scrollIntoView({block:'start',behavior:'auto'});}
  }
  const label=state=>({online:tr('QQ 已登录','QQ online'),login_required:tr('需要登录','Sign-in needed'),offline:tr('QQ 离线','QQ offline'),reconnecting:tr('正在恢复','Reconnecting'),initializing:tr('登录确认中','Finishing sign-in'),stopped:tr('未启动','Stopped'),unknown:tr('状态待核实','Status unverified')})[state]||tr('状态待核实','Status unverified');
  const events={session_expired:['QQ 登录已失效','QQ login expired'],account_kicked:['QQ 下线通知','QQ disconnected by service'],worker_restart:['QQ 后台进程重启','QQ worker restarted'],qr_expired:['二维码已过期','QR code expired'],login_required:['需要重新登录','Sign-in required'],runtime_started:['QQ 接入组件启动','QQ bridge started'],bridge_listening:['消息接口已监听','Message endpoint listening'],launcher_started:['应用已启动 QQ','QQ started by this app'],launcher_stopped:['应用已停止 QQ','QQ stopped by this app']};
  function clearQR(){qrImage='';qrAccount='';qrRevision='';}
  const orphanKey=(state,accountId)=>{
    const row=state?.instances?.find(item=>item.accountId===accountId);
    return row?JSON.stringify([latest?.accounts?.selectedId,state.desktopDataRoot,state.componentsRoot,!!state.desktopRunning,row.accountId,row.management,row.processRunning,!!row.canRecover,!!row.canInspectOrphanCleanup,!!row.canSettleOrphanInspection,!!row.recoveryRequired,row.reason,row.runtimeRevision,row.login?.state]):'';
  };
  const orphanRoot=state=>JSON.stringify([state?.installationKind,state?.desktopDataRoot,state?.componentsRoot,state?.managedSetupId,state?.installation?.current?.kind,state?.installation?.current?.setupId]);
  function discardOrphan(ticket){
    if(!ticket||discardedOrphans.has(ticket))return;discardedOrphans.add(ticket);
    const warn=()=>window.toast?.(tr('旧预览撤销尚未确认，请重新检查；关闭页面不能撤回已开始的清理。','Preview revocation is unconfirmed. Inspect again; closing the page cannot undo cleanup already started.'));
    try{const result=window.arcade.qqRuntimeOrphanDiscard({accountId:ticket.accountId,expectedDigest:ticket.expectedDigest});Promise.resolve(result).then(value=>{if(value?.ok!==true||typeof value.discarded!=='boolean')warn();},warn);}catch{warn();}
  }
  function retireOrphanState(state,keep=null){
    const ticket=state.preview;if(ticket&&ticket!==keep){discardOrphan(ticket);clearTimeout(ticket.timer);}state.preview=null;
  }
  function clearOrphanPreviews(keep=null){orphanGeneration++;for(const state of orphanViews.values())retireOrphanState(state,keep);for(const [id,ticket]of orphanConfirmations)if(ticket!==keep){discardOrphan(ticket);clearTimeout(ticket.timer);orphanConfirmations.delete(id);}}
  function discardLateOrphan(result,accountId){const p=result?.preview;if(result?.ok===true&&p?.accountId===accountId&&/^[a-f0-9]{64}$/.test(p.expectedDigest||''))discardOrphan({accountId,expectedDigest:p.expectedDigest});}
  function orphanPreviewOK(p,accountId){
    if(p?.kind==='pending-shell-inspection-resources'){
      const keys=['kind','action','accountId','expectedDigest','expiresAt','automaticStart'],expiry=typeof p.expiresAt==='string'?Date.parse(p.expiresAt):NaN;
      return !Array.isArray(p)&&Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k))&&p.action==='settle-resources'&&p.accountId===accountId&&/^[a-f0-9]{64}$/.test(p.expectedDigest||'')&&Number.isFinite(expiry)&&new Date(expiry).toISOString()===p.expiresAt&&expiry>Date.now()&&expiry<=Date.now()+61000&&p.automaticStart===false;
    }
    const row=(cached||latest?.qqRuntime)?.instances?.find(item=>item.accountId===accountId),legacyKeys=['accountId','count','expectedDigest','automaticStart'];
    if(row&&row.canInspectOrphanCleanup!==true&&!['pending_upstream_update','pending_update_recovery_required'].includes(row.reason)&&p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===legacyKeys.length&&legacyKeys.every(k=>Object.hasOwn(p,k)))return p.accountId===accountId&&Number.isSafeInteger(p.count)&&p.count>=1&&p.count<=64&&/^[a-f0-9]{64}$/.test(p.expectedDigest||'')&&p.automaticStart===false;
    const keys=['accountId','kind','action','count','expectedDigest','expiresAt','automaticStart'],expiry=typeof p?.expiresAt==='string'?Date.parse(p.expiresAt):NaN;
    return p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k))&&p.accountId===accountId&&p.kind==='verified-orphan-cleanup'&&['terminate','settle'].includes(p.action)&&Number.isSafeInteger(p.count)&&(p.action==='terminate'?p.count>=1&&p.count<=64:p.count===0)&&/^[a-f0-9]{64}$/.test(p.expectedDigest||'')&&Number.isFinite(expiry)&&new Date(expiry).toISOString()===p.expiresAt&&expiry>Date.now()&&expiry<=Date.now()+61000&&p.automaticStart===false;
  }
  function orphanCleanupOK(c,accountId,preview){
    if(c?.kind==='pending-shell-inspection-resources'){
      const keys=['kind','accountId','resources','processControlAttempted','leaseMutationAttempted','pendingUpdateRecordsModified','automaticStart'];
      return (!preview||preview.action==='settle-resources')&&!Array.isArray(c)&&Object.keys(c).length===keys.length&&keys.every(k=>Object.hasOwn(c,k))&&c.accountId===accountId&&['closed','unconfirmed'].includes(c.resources)&&keys.slice(3).every(k=>c[k]===false);
    }
    if(preview?.action==='settle-resources')return false;
    const keys=['kind','accountId','selectedCount','confirmedAbsentCount','terminationAttempted','processes','lease','resources','automaticStart','pendingUpdateRecoveryRequired'];
    return c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).length===keys.length&&keys.every(k=>Object.hasOwn(c,k))&&c.kind==='pending-shell-orphan-cleanup'&&c.accountId===accountId&&Number.isSafeInteger(c.selectedCount)&&c.selectedCount>=1&&c.selectedCount<=64&&(!preview||preview.action!=='terminate'||c.selectedCount===preview.count)&&typeof c.terminationAttempted==='boolean'&&(!preview||preview.action!=='settle'||c.terminationAttempted===false)&&['confirmed-absent','remaining','unverified'].includes(c.processes)&&(c.processes==='unverified'?c.confirmedAbsentCount===null:Number.isSafeInteger(c.confirmedAbsentCount)&&c.confirmedAbsentCount>=0&&(c.processes==='confirmed-absent'?c.confirmedAbsentCount===c.selectedCount:c.confirmedAbsentCount<c.selectedCount))&&['cleared','retained','unverified'].includes(c.lease)&&(c.lease!=='cleared'||c.processes==='confirmed-absent')&&['closed','unconfirmed'].includes(c.resources)&&c.automaticStart===false&&c.pendingUpdateRecoveryRequired===true;
  }
  function orphanCleanupText(c){
    if(c.kind==='pending-shell-inspection-resources')return c.resources==='closed'?tr('上次检查已收尾。此次仅关闭检查占用的资源，未处理 QQ 进程或待更新记录；请刷新状态继续检查。','The previous inspection is settled. Only its held resources were closed; QQ processes and update records were not handled. Refresh the state to continue.'):tr('上次检查的收尾仍未确认，可以重新预览后重试。此次没有启停 QQ，也没有处理管理记录或待更新记录。','Inspection settlement is still unconfirmed. Preview again before retrying. This action did not start or stop QQ or handle ownership or update records.');
    const processes=c.processes==='confirmed-absent'?tr(`已确认原选中的 ${c.selectedCount} 个进程均不在运行。`,`All ${c.selectedCount} originally selected processes are confirmed absent.`):c.processes==='remaining'?tr(`已确认 ${c.confirmedAbsentCount} / ${c.selectedCount} 个原进程退出，仍有进程尚在。`,`Confirmed ${c.confirmedAbsentCount} of ${c.selectedCount} original processes absent; others remain.`):tr('进程停止结果尚未核实。','The process-stop result remains unverified.');
    const lease=c.lease==='cleared'?tr('原管理记录已清除。','The original ownership record was cleared.'):c.lease==='retained'?tr('原管理记录仍在。','The original ownership record remains.'):tr('管理记录状态尚未核实。','The ownership-record state remains unverified.');
    const resources=c.resources==='closed'?tr('本次管理资源已收尾。','Management resources for this operation were closed.'):tr('管理资源收尾仍待核查。','Management cleanup remains unconfirmed.');
    const complete=c.processes==='confirmed-absent'&&c.lease==='cleared'&&c.resources==='closed';
    return [processes,lease,resources,complete?tr('QQ 未自动启动，待更新记录须单独处理。','QQ was not started automatically. Handle the update record separately.'):tr('QQ 未自动启动，待更新记录须单独处理。请明确重新检查，不自动重试。','QQ was not started automatically. Handle the update record separately. Inspect explicitly; no operation is retried automatically.')].join(' ');
  }
  function installOrphanPreview(state,p){
    const ticket={accountId:p.accountId,kind:p.kind,action:p.action||'terminate',count:p.count,expectedDigest:p.expectedDigest,expiresAt:p.expiresAt?Date.parse(p.expiresAt):null};state.eligible=true;state.preview=ticket;
    if(ticket.expiresAt===null)return;
    ticket.timer=setTimeout(()=>{if(state.preview!==ticket&&orphanConfirmations.get(ticket.accountId)!==ticket)return;discardOrphan(ticket);if(state.preview===ticket){state.preview=null;feedback=tr('预览已过期，请重新检查。','The preview expired. Inspect again.');failed=true;draw();}},Math.max(1,ticket.expiresAt-Date.now()));
  }
  function orphanState(accountId){
    const key=orphanKey(cached||latest?.qqRuntime,accountId);if(!key)return null;
    let state=orphanViews.get(accountId);if(!state||state.key!==key){if(state)retireOrphanState(state);state={key,eligible:false,preview:null};orphanViews.set(accountId,state);}return state;
  }
  const inspectionSettled=accountId=>orphanViews.get(accountId)?.key===orphanKey(cached||latest?.qqRuntime,accountId)&&orphanViews.get(accountId)?.settledResources===true;
  function clearSettledInspections(){
    let changed=false;for(const [id,state]of orphanViews)if(state.settledResources){orphanViews.delete(id);changed=true;}
    // A genuinely fresh observation can have identical row fields (another
    // inspection may have retained resources). Redraw even in that case.
    if(changed){fingerprint='';if(settledFeedback!==null&&feedback===settledFeedback){feedback='';failed=false;}settledFeedback=null;}
  }
  function acceptState(next,{preserveFeedback=false}={}){
    const nextRoot=orphanRoot(next);
    if(nextRoot!==formRoot){
      dismissAccountDialog(false);formRoot=nextRoot;selectedAccount='';accountRevision++;loginAdvancedOpen.clear();loginMoreOpen.clear();installationRevision++;operationRevision++;installationChanged=true;fingerprint='';
      clearQR();logsAccount='';logs=[];formDrafts.clear();backupViews.clear();orphanViews.clear();aiConnecting.clear();aiFeedback.clear();
      addAccount='';addOpen=false;installationOpen=false;navigationAccount=null;feedback='';failed=false;pollProblem=false;
    }
    const after=next?.instances?.find(row=>row.accountId===dialogAccount);
    if(dialogAccount&&after&&dialogRuntimeKey!==dialogRuntimeScope(after)){dialogRuntimeKey=dialogRuntimeScope(after);dialogRuntimeRevision++;clearQR();clearOrphanPreviews(orphanConfirmations.get(dialogAccount));if(!preserveFeedback){feedback='';failed=false;}}
    cached=next;invalidateAIIntents(next);
    if(conversationOpening&&!conversationOpening.current())conversationOpening.invalidated=true;
    if(diagnosticReport&&diagnosticReport.scope!==diagnosticScope(diagnosticReport.accountId))diagnosticReport=null;
    if(logsScope&&logsScope!==diagnosticScope(logsAccount))logsScope=null;
    for(const [id,value]of orphanViews)if(value.key!==orphanKey(next,id)){retireOrphanState(value);orphanViews.delete(id);}
    window.renderQQDirectory?.({runtime:cached,accounts:latest?.accounts,language});
    window.renderQQFriendRequests?.({accounts:latest?.accounts,runtime:cached,language});
    window.renderQQSelfProfile?.({accounts:latest?.accounts,runtime:cached,language});
    window.renderQQOwnerHistory?.({accounts:latest?.accounts,runtime:cached,language});
    if(!qrImage)return;
    const item=next?.instances?.find(row=>row.accountId===qrAccount);
    if(!item||!item.processRunning||item.login?.state==='online'||!item.runtimeRevision||item.runtimeRevision!==qrRevision)clearQR();
  }
  function drawChanged(){const key=JSON.stringify([language,cached,latest?.accounts,pollProblem,!!window.canOpenQQPluginAdmin?.(),!!window.canOpenQQPluginPackage?.(),!!window.canOpenQQSSQQClient?.(),!!window.canOpenQQRemote?.()]);if(key!==fingerprint){fingerprint=key;draw();}}
  function pollPageVisible(){return !closed&&view==='qq-runtime'&&!document.hidden&&typeof window.arcade.qqRuntimeRefresh==='function';}
  function canPoll(){return pollPageVisible()&&!document.getElementById('qq-directory')?.open;}
  function syncPolling(){
    if(dialogAccount&&(view!=='qq-runtime'||document.hidden))dismissAccountDialog(false);
    const visible=pollPageVisible();
    if(!visible){navigationAccount=null;if(pollVisible){operationRevision++;clearOrphanPreviews();draw();}pollVisible=false;if(pollTimer!==null)clearTimeout(pollTimer);pollTimer=null;return;}
    pollVisible=true;
    // Inspecting contacts must not start periodic management checks. A check
    // already in flight still applies its result and can invalidate the drawer.
    if(!canPoll()){if(pollTimer!==null)clearTimeout(pollTimer);pollTimer=null;return;}
    if(pollTimer===null&&!pollInFlight)pollTimer=setTimeout(()=>{pollTimer=null;void poll();},10000);
  }
  async function poll(){
    if(!canPoll())return;
    if(busy||pollInFlight){syncPolling();return;}
    pollInFlight=true;const revision=operationRevision;
    try{
      const result=await window.arcade.qqRuntimeRefresh();
      if(revision!==operationRevision||!pollPageVisible())return;
      pollProblem=result?.ok===false||!result?.state;
      if(!pollProblem){clearSettledInspections();acceptState(result.state);}
      drawChanged();
    }catch{if(revision===operationRevision&&pollPageVisible()){pollProblem=true;drawChanged();}}
    finally{pollInFlight=false;syncPolling();}
  }
  document.addEventListener('visibilitychange',syncPolling);
  const directoryVisibility=new MutationObserver(changes=>{if(changes.some(change=>change.target.id==='qq-directory'))syncPolling();});
  directoryVisibility.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
  window.addEventListener('pagehide',()=>{clearOrphanPreviews();closed=true;operationRevision++;directoryVisibility.disconnect();syncPolling();});
  async function run(method,value){
    if(busy)return;let orphanTicket=null;
    if(method==='qqRuntimeOrphanCleanup'){const state=orphanState(value.accountId);orphanTicket=state?.preview;if(!orphanTicket||orphanTicket.expectedDigest!==value.expectedDigest||orphanTicket.expiresAt!==null&&orphanTicket.expiresAt<=Date.now()){if(state)retireOrphanState(state);feedback=tr('预览已失效，请重新检查。','The preview expired or changed. Inspect again.');failed=true;draw();return;}}
    busy=true;feedback='';failed=false;pollProblem=false;operationRevision++;
    const requestInstallationRevision=installationRevision,requestAccountRevision=accountRevision,requestQRRevision=dialogRuntimeRevision;
    const requestLogsScope=method==='qqRuntimeLogs'?diagnosticScope(value.accountId):null;
    const exporting=method==='qqRuntimeExportDiagnostics',report=exporting?{accountId:value.accountId,scope:diagnosticScope(value.accountId),state:'preparing'}:null;
    if(exporting)diagnosticReport=report;
    const reportCurrent=()=>!closed&&view==='qq-runtime'&&!document.hidden&&dialogAccount===value?.accountId&&diagnosticReport===report&&report?.scope===diagnosticScope(value?.accountId);
    const orphanOperation=['qqRuntimeOrphanPreview','qqRuntimeOrphanCleanup'].includes(method),revision=operationRevision,requestKey=orphanOperation?orphanKey(cached||latest?.qqRuntime,value.accountId):'',requestRoot=orphanRoot(cached||latest?.qqRuntime);
    let requestOrphanGeneration;
    const orphanObsolete=()=>view!=='qq-runtime'||document.hidden||revision!==operationRevision||requestRoot!==orphanRoot(cached||latest?.qqRuntime)||!orphanKey(cached||latest?.qqRuntime,value.accountId)||(method==='qqRuntimeOrphanPreview'&&(requestOrphanGeneration!==orphanGeneration||requestKey!==orphanKey(cached||latest?.qqRuntime,value.accountId)));
    // A cleanup confirmation is one use in the UI, including uncertain and
    // partial outcomes. A new inspection is required before trying again.
    if(orphanOperation){clearOrphanPreviews(orphanTicket);if(orphanTicket)orphanConfirmations.set(value.accountId,orphanTicket);requestOrphanGeneration=orphanGeneration;}
    else if(!['qqRuntimeRefresh','qqRuntimeLogs','qqRuntimeBackups','qqRuntimeBackupPreview','qqRuntimeExportDiagnostics'].includes(method))clearOrphanPreviews();
    // A refresh can fail or identify a different account. Never leave the
    // previous login image visible while requesting its replacement.
    if(method==='qqRuntimeQR')clearQR();
    if(['qqRuntimeBackups','qqRuntimeBackupPreview','qqRuntimeBackupRestore'].includes(method)){
      const state=backupViews.get(value.accountId);if(state){state.preview=null;state.receipt='';if(method==='qqRuntimeBackups'){state.rows=[];state.loaded=false;state.selected='';}}
    }
    draw();
    try{
      const result=await window.arcade[method](value);
      if(closed||requestInstallationRevision!==installationRevision||requestAccountRevision!==accountRevision||(method==='qqRuntimeQR'&&requestQRRevision!==dialogRuntimeRevision)||orphanOperation&&orphanObsolete()){if(method==='qqRuntimeOrphanPreview')discardLateOrphan(result,value.accountId);return;}
      if(exporting){
        if(!reportCurrent())return;
        report.state=result?.ok===true&&result.accountId===value.accountId&&result.saved===true&&result.schema==='arcade_qq_diagnostic_v1'?'saved':result?.ok===true&&result.accountId===value.accountId&&result.saved===false&&result.cancelled===true?'cancelled':result?.ok===false&&result.saved===false&&(!result.accountId||result.accountId===value.accountId)?'failed':'unknown';
        report.code=typeof result?.code==='string'?result.code:'';return;
      }
      if(result?.ok===false){
        failed=true;feedback=method==='qqRuntimeBackupRestore'&&result.code==='write_failed'?tr('恢复结果未能确认。请保留当前文件和备份，检查后再决定下一步。','The restoration result could not be verified. Keep the current file and backups and inspect them before proceeding.'):issue(result.code);
        if(method==='qqRuntimeOrphanCleanup'&&result.cleanupAttempted===true)feedback=orphanCleanupOK(result.cleanup,value.accountId,orphanTicket)?orphanCleanupText(result.cleanup):tr('清理结果尚未确认。请保留现有管理记录并重新检查，旧确认不会自动重试。','Cleanup is unconfirmed. Keep any existing ownership record and inspect again; the previous confirmation is not retried automatically.');
        if(value?.accountId&&(result.code==='orphaned_children'||result.code==='orphan_cleanup_changed'||result.code==='orphan_cleanup_incomplete')){const state=orphanState(value.accountId);if(state)state.eligible=true;}
      }
      else if(method==='qqRuntimeOrphanPreview'){
        const preview=result?.preview,state=orphanState(value.accountId);
        if(state&&orphanPreviewOK(preview,value.accountId))installOrphanPreview(state,preview);
        else{discardLateOrphan(result,value.accountId);failed=true;feedback=issue('orphan_cleanup_unverified');}
      }
      else if(method==='qqRuntimeOrphanCleanup'){
        const detail=result?.cleanup,completeDetail=detail===undefined||orphanCleanupOK(detail,value.accountId,orphanTicket)&&detail.processes==='confirmed-absent'&&detail.lease==='cleared'&&detail.resources==='closed';
        if(orphanTicket.action==='settle-resources'&&result?.recovery==='inspection-resources-settled'&&result.accountId===value.accountId&&result.automaticStart===false&&Object.keys(result).length===5&&['ok','recovery','accountId','automaticStart','cleanup'].every(k=>Object.hasOwn(result,k))&&orphanCleanupOK(detail,value.accountId,orphanTicket)&&detail.resources==='closed'){
          const settled=orphanState(value.accountId);if(settled){settled.settledResources=true;settled.eligible=false;settled.preview=null;}feedback=orphanCleanupText(detail);settledFeedback=feedback;
        }else if(orphanTicket.action!=='settle-resources'&&result?.recovery==='orphans-cleared'&&(result.accountId===undefined||result.accountId===value.accountId)&&result.automaticStart===false&&Number.isSafeInteger(result.terminatedCount)&&result.terminatedCount>=0&&result.terminatedCount<=64&&(orphanTicket.action!=='settle'||result.terminatedCount===0)&&completeDetail){
          orphanViews.delete(value.accountId);feedback=detail?orphanCleanupText(detail):orphanTicket.action==='settle'?tr('本次清理的收尾已完成，没有再次停止进程。QQ 未启动，待更新记录须单独处理。','Cleanup settlement is complete; no further process stop was issued. QQ was not started. Handle the update record separately.'):tr(`QQ ${value.accountId} 的 ${result.terminatedCount} 个残留进程已清理。登录数据保留，尚未启动 QQ。`,`Cleared ${result.terminatedCount} remaining processes for QQ ${value.accountId}. Login data was kept; QQ was not started.`);
          if(result.refreshIssue)feedback+=tr(' 清理已完成，但状态暂未刷新；请刷新状态后再操作。',' Cleanup finished, but status refresh failed. Refresh status before proceeding.');
        }else{failed=true;feedback=tr('清理结果未能确认，旧确认已失效。请保留管理记录并重新检查。','The cleanup result could not be verified. The previous confirmation expired. Keep the ownership record and inspect again.');}
      }
      else if(method==='qqRuntimeBackups'){
        const state=backupViews.get(value.accountId);if(state){state.rows=result?.backups||[];state.loaded=true;state.hasMore=!!result?.hasMore;state.scanLimited=!!result?.scanLimited;}
      }
      else if(method==='qqRuntimeBackupPreview'){
        const state=backupViews.get(value.accountId);if(state&&state.selected===value.backupId)state.preview=result;
      }
      else if(method==='qqRuntimeBackupRestore'&&result?.restored){
        feedback=tr('配置已恢复，恢复前的文件已另存备份。请重新核对连接并按需保存搭档绑定；QQ 登录状态未因此验证。','Configuration restored; the previous file was backed up. Recheck the connection and save the companion binding if needed. QQ login was not verified.');
        if(result.refreshIssue)feedback+=tr(' 文件已恢复，但状态暂未刷新；请稍后刷新状态。',' The file was restored, but status refresh failed. Refresh status shortly.');
        feedback+=cleanupWarning(result);
        const state=backupViews.get(value.accountId);if(state){state.receipt=feedback;state.rows=[];state.loaded=false;state.selected='';}
        const draft=formDrafts.get(value.accountId);if(draft)draft.configDirty=false;
      }
      else if(method==='qqRuntimeQR'){const row=(cached||latest?.qqRuntime)?.instances?.find(item=>item.accountId===value.accountId);if(!row?.processRunning||row.login?.state==='online'||!row.runtimeRevision||row.runtimeRevision!==result?.runtimeRevision){clearQR();feedback=tr('运行状态已变化，请重新检查登录。','The runtime changed. Check sign-in again.');return;}qrAccount=value.accountId;qrImage=result?.image||'';qrRevision=result?.runtimeRevision||'';feedback=qrImage?tr('用这个 AI 的手机 QQ 扫码，并在手机确认。','Scan with this AI account’s mobile QQ and confirm on your phone.'):tr('后台正在恢复，稍后刷新二维码。','The runtime is recovering. Refresh the QR code shortly.');}
      else if(method==='qqRuntimeLogs'){if(requestLogsScope!==diagnosticScope(value.accountId))return;logsAccount=value.accountId;logs=result?.events||[];logsScope=requestLogsScope;diagnosticReport=null;}
      else if(method==='qqRuntimeQuickLogin')feedback=tr('已请求使用现有登录；以刷新后的实际状态为准。','Requested the saved login. Refresh to check the actual result.');
      else if(method==='qqRuntimeConfigure'&&result?.configured){
        if(value.create)addAccount='';else{const draft=formDrafts.get(value.accountId);if(draft)draft.configDirty=!result.state;}
        feedback=value.create?tr('QQ 账号已添加，尚未登录。','QQ account added. It is not signed in yet.'):tr('本机连接已保存，可以继续绑定搭档。','Local connection saved. You can now bind a companion.');
        if(result.refreshIssue)feedback+=tr(' 配置已写入，但状态暂未刷新；请稍后刷新状态。',' The configuration was written, but status refresh failed. Refresh status shortly.');
        feedback+=cleanupWarning(result);
      }
      else if(method==='qqRuntimeStart'&&cleanupWarning(result))feedback=tr('QQ 启动请求已完成，登录状态仍以实际检查为准。','QQ startup completed; sign-in still depends on the actual status check.')+cleanupWarning(result);
      else if(method==='qqRuntimeLink'&&result?.linked)feedback=tr('绑定已保存，AI 尚未自动连接。QQ 在线且关联已核实时，可点击卡片上的“连接 AI”；否则打开“管理搭档”检查并选择。','Binding saved. The AI was not connected automatically. When QQ is online and the association is verified, use Connect AI on its card; otherwise open Manage companions to check and choose.');
      if(method==='qqRuntimeRefresh'&&result?.ok!==false&&result?.state)clearSettledInspections();
      if(result?.state)acceptState(result.state,{preserveFeedback:true});
      if(method==='qqRuntimeRefresh'&&result?.ok!==false&&result?.state)aiFeedback.clear();
      if(!['qqRuntimeLogs','qqRuntimeQR','qqRuntimeRefresh','qqRuntimeBackups','qqRuntimeBackupPreview','qqRuntimeExportDiagnostics'].includes(method))clearQR();
    }catch{
      if(closed||requestInstallationRevision!==installationRevision||requestAccountRevision!==accountRevision||(method==='qqRuntimeQR'&&requestQRRevision!==dialogRuntimeRevision))return;
      if(orphanOperation&&orphanObsolete())return;
      if(exporting){if(reportCurrent()){report.state='unknown';report.code='';}return;}
      failed=true;feedback=method==='qqRuntimeOrphanCleanup'?tr('清理结果未能确认，旧确认已失效。请保留管理记录并重新检查。','The cleanup result could not be verified. The previous confirmation expired. Keep the ownership record and inspect again.'):tr('本机管理暂不可用，请检查组件后重试。','Local management is unavailable. Check the components and retry.');
    }
    finally{if(orphanTicket){clearTimeout(orphanTicket.timer);if(orphanConfirmations.get(value.accountId)===orphanTicket)orphanConfirmations.delete(value.accountId);}busy=false;draw();syncPolling();}
  }
  const button=(text,method,value,{disabled=false,primary=false}={})=>{const node=el('button',primary?'primary':'secondary',text),scope=installationRevision;node.dataset.runtimeAction=method;node.disabled=busy||disabled;node.onclick=()=>{if(node.isConnected&&scope===installationRevision)void run(method,value);};return node;};
  function aiAssociation(item,rows=latest?.accounts?.accounts||[]){
    const candidates=rows.filter(row=>row.channel==='qq'&&[row.accountId,row.expectedQQAccountId,row.qqBinding?.source==='last_verified'?row.qqBinding.accountId:''].includes(item.accountId));
    const profile=candidates.length===1?candidates[0]:null;
    const proof=!!profile&&(profile.accountId===item.accountId||!profile.accountId&&profile.qqBinding?.source==='last_verified'&&profile.qqBinding.accountId===item.accountId);
    const conflict=!!profile&&[profile.accountId,profile.expectedQQAccountId,profile.qqBinding?.source==='last_verified'?profile.qqBinding.accountId:''].filter(Boolean).some(id=>id!==item.accountId);
    const ownerValid=!!profile&&/^[1-9]\d{4,14}$/.test(profile.qqOwnerId)&&profile.qqOwnerId!==item.accountId;
    return {candidates,profile,clear:proof&&!conflict&&ownerValid};
  }
  function aiContext(item,profile,state=cached||latest?.qqRuntime){return JSON.stringify([orphanRoot(state),item.accountId,item.runtimeRevision,profile?.id,profile?.channel,profile?.expectedQQAccountId,profile?.qqOwnerId,profile?.qqBinding?.accountId]);}
  async function openConnectedConversation(accountId,companionId){
    if(conversationOpening||busy||closed||view!=='qq-runtime'||document.hidden||aiConnecting.has(accountId))return;
    const state=cached||latest?.qqRuntime,item=state?.instances?.find(row=>row.accountId===accountId),association=item&&aiAssociation(item);
    const eligible=(row,match)=>!!row&&row.processRunning===true&&row.login?.state==='online'&&!row.recoveryRequired&&match?.clear&&match.profile.id===companionId&&match.profile.status==='connected'&&match.profile.accountId===accountId;
    if(!eligible(item,association))return;
    const context=(row,profile,currentState)=>JSON.stringify([aiContext(row,profile,currentState),profile.root,profile.mode,profile.characterId,profile.qqBinding?.source,profile.qqBinding?.verifiedAt]);
    const request={key:context(item,association.profile,state),revision:operationRevision,managementRevision:conversationManagementRevision,selectedId:latest?.accounts?.selectedId,selected:latest?.accounts?.selectedId===companionId,invalidated:false};
    request.current=()=>{
      const nextState=cached||latest?.qqRuntime,next=nextState?.instances?.find(row=>row.accountId===accountId),match=next&&aiAssociation(next),selectedId=latest?.accounts?.selectedId;
      if(selectedId===companionId)request.selected=true;
      return !request.invalidated&&!closed&&!document.hidden&&view==='qq-runtime'&&request.revision===operationRevision&&request.managementRevision===conversationManagementRevision&&conversationOpening===request&&(selectedId===companionId||!request.selected&&selectedId===request.selectedId)&&eligible(next,match)&&context(next,match.profile,nextState)===request.key;
    };
    conversationOpening=request;draw();
    try{
      // Keep main's selection and resource cleanup ordering. Navigation alone
      // neither reconnects an account nor turns a saved preset into identity.
      await window.arcade.accountSelect(companionId);
      if(request.current()&&latest?.accounts?.selectedId===companionId)switchView('bot');
    }finally{if(conversationOpening===request)conversationOpening=null;draw();}
  }
  function canConnectAI(item,association){const p=association.profile;return association.clear&&p.status==='disconnected'&&p.credentialState==='ready'&&!p.credentialMigration&&item.processRunning&&item.login?.state==='online'&&!item.recoveryRequired;}
  // Expected-only configuration permits an explicit verification intent; it is
  // never promoted into aiAssociation.clear or used as identity proof.
  function expectedAIIdentity(item,association){
    const p=association?.profile,b=p?.qqBinding;
    return !!p&&association.candidates.length===1&&p.expectedQQAccountId===item?.accountId&&(!p.accountId||p.accountId===item.accountId)&&(!b||b.source==='last_verified'&&b.accountId===item.accountId)&&/^[1-9]\d{4,14}$/.test(p.qqOwnerId)&&p.qqOwnerId!==item.accountId;
  }
  function expectedAIRuntime(item,state){return !!item&&state?.configured===true&&state.desktopRunning!==true&&item.management==='owned'&&item.processRunning===true&&!item.recoveryRequired&&!item.reason&&typeof item.runtimeRevision==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(item.runtimeRevision)&&item.login?.state==='online'&&item.login.identityVerified===true&&item.login.accountId===item.accountId&&item.login.online===true;}
  function expectedAIContext(item,p,state){return JSON.stringify([orphanRoot(state),item?.accountId,item?.runtimeRevision,item?.management,item?.processRunning,item?.recoveryRequired,item?.reason,item?.login?.state,item?.login?.identityVerified,item?.login?.accountId,item?.login?.online,state?.desktopRunning,p?.id,p?.channel,p?.mode,p?.characterId,p?.expectedQQAccountId,p?.qqOwnerId,p?.credentialState,!!p?.credentialMigration,item?.bridges||[]]);}
  function canVerifyAI(item,association,state){const p=association?.profile;return !!p&&!association.clear&&!p.accountId&&!p.qqBinding&&expectedAIIdentity(item,association)&&expectedAIRuntime(item,state)&&p.status==='disconnected'&&p.credentialState==='ready'&&!p.credentialMigration&&typeof window.arcade.accountConnect==='function';}
  function expectedAICurrent(request,item,association,state){return !request.invalidated&&!!item&&expectedAIIdentity(item,association)&&expectedAIRuntime(item,state)&&association.profile.id===request.id&&['disconnected','connecting','checking','connected'].includes(association.profile.status)&&expectedAIContext(item,association.profile,state)===request.key;}
  function invalidateAIIntents(state){for(const [id,request]of aiConnecting){if(!request.expected)continue;const item=state?.instances?.find(row=>row.accountId===id),association=item&&aiAssociation(item);if(latest?.accounts?.selectedId!==request.selectedId||!expectedAICurrent(request,item,association,state))request.invalidated=true;}}
  function aiFailure(profile,error){
    const guidance=window.qqConnectionGuidance?.(profile?.problem,language);if(guidance)return guidance;
    const source=typeof error?.message==='string'?error.message.slice(0,1600):'',code=String(error?.code||'').toLowerCase();
    if(profile?.credentialState==='locked'||code==='credentials_locked'||/credentials are locked/.test(source))return tr('凭据无法在当前应用读取。请打开“管理搭档”完成迁移后再连接。','Credentials cannot be read in this app. Open Manage companions and complete migration before connecting.');
    if(code==='account_in_use'||/already connected by another companion/.test(source)||/already connected by another companion/.test(profile?.problem||''))return tr('这个 QQ 或连接已被另一位搭档使用。请在“管理搭档”检查重复绑定。','This QQ account or bridge is already in use by another companion. Check duplicate bindings in Manage companions.');
    if(/Save the selected provider.*API key/.test(source))return tr('请先在这位搭档的连接设置中保存所选 AI 的 API key，再连接。','Save the selected AI provider’s API key in this companion’s connection settings before connecting.');
    if(code==='operation_in_progress'||/QQ account is stopping/.test(source))return tr('QQ 正在停止，请等后台操作结束并核对登录状态后再连接。','QQ is stopping. Wait for the runtime operation and recheck sign-in before connecting.');
    return tr('连接未完成。请打开“管理搭档”检查这位搭档的 AI 设置、QQ 绑定和凭据；尚未确认连接成功。','Connection did not finish. Check this companion’s AI settings, QQ binding and credentials in Manage companions; success is unconfirmed.');
  }
  async function connectAI(accountId,companionId,expected=false){
    const state=cached||latest?.qqRuntime,item=state?.instances?.find(row=>row.accountId===accountId),association=item&&aiAssociation(item);
    if(busy||aiConnecting.has(accountId)||aiFeedback.get(accountId)?.kind==='unconfirmed'||!item||association.profile?.id!==companionId||!(expected?canVerifyAI(item,association,state):canConnectAI(item,association))||view!=='qq-runtime'||document.hidden)return;
    const request={id:companionId,expected,key:expected?expectedAIContext(item,association.profile,state):aiContext(item,association.profile,state),revision:operationRevision,selectedId:latest?.accounts?.selectedId,accountRevision,invalidated:false};aiConnecting.set(accountId,request);aiFeedback.delete(accountId);draw();
    const matches=(row,match,currentState)=>expected?expectedAICurrent(request,row,match,currentState):!!row&&match?.clear&&match.profile.id===companionId&&aiContext(row,match.profile,currentState)===request.key;
    const current=()=>{
      const nextState=cached||latest?.qqRuntime,next=nextState?.instances?.find(row=>row.accountId===accountId),nextAssociation=next&&aiAssociation(next);
      return request.accountRevision===accountRevision&&!closed&&view==='qq-runtime'&&!document.hidden&&aiConnecting.get(accountId)===request&&request.revision===operationRevision&&latest?.accounts?.selectedId===request.selectedId&&matches(next,nextAssociation,nextState);
    };
    const remember=(kind,extra={})=>aiFeedback.set(accountId,{key:request.key,expected,kind,...extra});
    let error;
    try{
      try{await window.arcade.accountConnect(expected?{accountId:companionId,qqAccountId:accountId,runtimeRevision:item.runtimeRevision}:companionId);}catch(caught){error=caught;}
      const fresh=await window.arcade.snapshot();if(!current())return;
      const freshItem=fresh?.qqRuntime?.instances?.find(row=>row.accountId===accountId);
      if(!freshItem){remember('unconfirmed');return;}
      const checked=aiAssociation(freshItem,fresh?.accounts?.accounts||[]),profile=checked.profile;
      if(!matches(freshItem,checked,fresh.qqRuntime)||fresh.accounts?.selectedId!==request.selectedId){remember('changed');return;}
      // Only an independent full snapshot proves connection; resolving either
      // accountConnect form is not evidence of successful identity or AI login.
      latest=fresh;acceptState(fresh.qqRuntime);
      if(checked.clear&&profile.status==='connected'&&profile.accountId===accountId)remember('connected');
      else if(['connecting','checking','disconnecting'].includes(profile.status))remember('pending');
      else remember('failed',{message:aiFailure(profile,error)});
    }catch{if(current())remember('unconfirmed');}
    finally{if(aiConnecting.get(accountId)===request)aiConnecting.delete(accountId);draw();}
  }
  function aiControls(item,card,actions,state){
    const association=aiAssociation(item),profile=association.profile,pending=aiConnecting.has(item.accountId);
    let result=aiFeedback.get(item.accountId);
    if(result&&(result.expected?(!expectedAIIdentity(item,association)||!expectedAIRuntime(item,state)||result.key!==expectedAIContext(item,profile,state)):result.key!==aiContext(item,profile,state))){aiFeedback.delete(item.accountId);result=null;}
    if(result&&!pending){
      const connected=association.clear&&profile?.status==='connected'&&profile.accountId===item.accountId;
      // Operation feedback must not outlive the independently observed state.
      // A later disconnect clears success, and an external successful connection
      // clears an earlier failure rather than showing contradictory instructions.
      if(result.kind==='connected'&&!connected||connected&&!['connected','pending'].includes(result.kind)){aiFeedback.delete(item.accountId);result=null;}
      else if(result.kind==='pending'&&connected)result.kind='connected';
      else if(result.kind==='pending'&&profile?.status==='disconnected'){result.kind='failed';result.message=aiFailure(profile);}
    }
    const manage=()=>window.openCompanionManager?window.openCompanionManager({accountId:association.candidates.length===1?profile?.id:undefined}):switchView('accounts');
    if(association.candidates.length){
      if(association.clear&&profile.status==='connected'&&profile.accountId===item.accountId){
        const open=el('button','secondary',tr('打开对话','Open conversation'));open.id=`qq-ai-open-${item.accountId}`;open.disabled=busy||pending||!!conversationOpening||!item.processRunning||item.login?.state!=='online'||!!item.recoveryRequired;
        open.onclick=()=>{if(open.isConnected)void action(()=>openConnectedConversation(item.accountId,profile.id));};actions.append(open);
      }else if(association.clear&&['connecting','checking','disconnecting'].includes(profile.status)||pending||result?.expected&&result.kind==='pending'){const label=el('button','secondary',profile?.status==='disconnecting'?tr('正在断开 AI…','Disconnecting AI…'):aiConnecting.get(item.accountId)?.expected||result?.expected?tr('正在核对并连接 AI…','Checking and connecting AI…'):tr('正在连接 AI…','Connecting AI…'));label.id=`qq-ai-connect-${item.accountId}`;label.disabled=true;actions.append(label);}
      else if(association.clear&&profile.status==='disconnected'&&profile.credentialState==='ready'&&!profile.credentialMigration){
        const connect=el('button','secondary',tr('连接 AI','Connect AI'));connect.id=`qq-ai-connect-${item.accountId}`;connect.disabled=busy||!canConnectAI(item,association)||aiFeedback.get(item.accountId)?.kind==='unconfirmed';connect.setAttribute('aria-label',tr(`连接 AI：${profile.name}`,`Connect AI: ${profile.name}`));connect.title=tr('使用已有配置连接，不发送测试消息。','Connect using saved settings, without a test message.');connect.onclick=()=>void connectAI(item.accountId,profile.id);actions.append(connect);
        if(!canConnectAI(item,association))card.append(el('p','social-hint',tr('先完成这个 QQ 的登录并刷新状态，再连接 AI；已有绑定会保留。','Complete this QQ account’s sign-in and refresh its state before connecting the AI. The existing binding is kept.')));
      }
      if(canVerifyAI(item,association,state)&&!pending){const connect=el('button','secondary',tr('核对并连接 AI','Verify and connect AI'));connect.id=`qq-ai-connect-${item.accountId}`;connect.disabled=busy||result?.kind==='unconfirmed';connect.setAttribute('aria-label',tr(`核对并连接 AI：${profile.name}`,`Verify and connect AI: ${profile.name}`));connect.title=tr('先核对当前 QQ 身份，再使用已保存配置连接；不会发送测试消息。','Verify the current QQ identity, then connect using saved settings without a test message.');const intentKey=expectedAIContext(item,profile,state),intentRevision=accountRevision;connect.onclick=()=>{const live=(cached||latest?.qqRuntime)?.instances?.find(row=>row.accountId===item.accountId),match=live&&aiAssociation(live);if(connect.isConnected&&intentRevision===accountRevision&&live&&match?.profile?.id===profile.id&&expectedAIContext(live,match.profile,cached||latest?.qqRuntime)===intentKey)void connectAI(item.accountId,profile.id,true);};actions.append(connect);}
      const choose=el('button','plain',association.candidates.length>1?tr('选择搭档','Choose companion'):tr('管理搭档','Manage companion'));choose.id=`qq-ai-manage-${item.accountId}`;choose.disabled=busy||pending;choose.onclick=manage;actions.append(choose);
      if(association.candidates.length>1)card.append(el('p','social-hint',tr('这个 QQ 关联了多位搭档，请在管理页明确选择；不会自动连接其中一位。','Several companions are associated with this QQ. Choose one in Manage companions; none is connected automatically.')));
      else if(!association.clear&&!canVerifyAI(item,association,state)&&!pending&&!result?.expected)card.append(el('p','social-hint',tr('已有配置尚不能唯一核实这位搭档的 QQ 关联，请先检查绑定。','The saved settings do not yet establish an unambiguous verified QQ association. Check the binding first.')));
      else if(profile.credentialState==='locked'||profile.credentialMigration)card.append(el('p','social-hint',profile.credentialMigration?tr('这位搭档正在迁移凭据，请等待迁移完成。','This companion’s credentials are being migrated. Wait for it to finish.'):aiFailure(profile)));
    }
    if(result){
      const kind=result.kind;
      const text=kind==='connected'?tr('AI 连接已建立，可以打开对话查看。此操作没有发送测试消息。','The AI connection is established. Open the conversation to view it. This action sent no test message.'):kind==='pending'?tr('连接正在核验，以后续实际状态为准。','The connection is being checked. Wait for its actual state.'):kind==='changed'?tr('搭档关联已变化，请刷新状态后重新检查。','The companion association changed. Refresh and check it again.'):kind==='unconfirmed'?tr('连接结果暂未确认。请刷新状态，不要重复点击连接。','The connection result is unconfirmed. Refresh its state before connecting again.'):result.message||aiFailure(profile);
      const notice=el('p',['connected','pending'].includes(kind)?'social-hint':'problem',text);notice.id=`qq-ai-feedback-${item.accountId}`;notice.setAttribute('role',['connected','pending'].includes(kind)?'status':'alert');card.append(notice);
    }
  }
  function orphanControls(item,card,current){
    if(!window.arcade.qqRuntimeOrphanPreview||!window.arcade.qqRuntimeOrphanCleanup||!window.arcade.qqRuntimeOrphanDiscard)return;
    const state=orphanState(item.accountId);if(!state||!(item.canSettleOrphanInspection===true||item.canInspectOrphanCleanup===true||state.eligible||item.reason==='orphaned_children'||item.login?.issue==='orphaned_children'))return;
    if(state.settledResources){
      const area=el('div','qq-orphan-controls'),refresh=button(tr('刷新状态','Refresh status'),'qqRuntimeRefresh');refresh.id=`qq-orphan-refresh-${item.accountId}`;area.append(refresh);card.append(area);return;
    }
    const resourceOnly=item.canSettleOrphanInspection===true,area=el('div','qq-orphan-controls'),inspect=button(resourceOnly?tr('收尾上次检查','Settle previous inspection'):tr('检查残留进程','Inspect remaining processes'),'qqRuntimeOrphanPreview',{accountId:item.accountId},{disabled:!resourceOnly&&current?.desktopRunning});inspect.id=`qq-orphan-inspect-${item.accountId}`;area.append(inspect);
    if(state.preview){
      const preview=state.preview,box=el('div','qq-backup-preview qq-orphan-preview');box.setAttribute('role','region');box.setAttribute('aria-label',tr('核对残留进程','Review remaining processes'));
      if(preview.action==='settle-resources'){
        box.setAttribute('aria-label',tr('收尾上次检查','Settle previous inspection'));
        box.append(el('h3','',tr('完成上次检查的收尾','Finish the previous inspection')),el('p','',`QQ ${item.accountId}`),el('p','social-hint',tr('只关闭上次检查仍占用的本机资源。无需重启应用，不会停止其他搭档，也不会清除 QQ 管理记录或待更新记录。','Close only the local resources still held by the previous inspection. No app restart is needed. Other companions are not stopped, and QQ ownership and update records are not cleared.')));
        const actions=el('div','qq-runtime-actions'),confirm=button(tr('完成收尾','Finish settlement'),'qqRuntimeOrphanCleanup',{accountId:item.accountId,expectedDigest:preview.expectedDigest},{primary:true}),cancel=el('button','secondary',tr('取消','Cancel'));
        confirm.id=`qq-orphan-clean-${item.accountId}`;cancel.id=`qq-orphan-cancel-${item.accountId}`;cancel.disabled=busy;cancel.onclick=()=>{clearOrphanPreviews();draw();document.getElementById(inspect.id)?.focus();};actions.append(cancel,confirm);box.append(actions);area.append(box);card.append(area);return;
      }
      const settle=preview.action==='settle';box.append(el('h3','',settle?tr('完成本次清理的收尾','Finish cleanup settlement'):tr('核对后再清理','Review before clearing')),el('p','',settle?`QQ ${item.accountId}`:tr(`QQ ${item.accountId} · 已核验 ${preview.count} 个旧进程`,`QQ ${item.accountId} · ${preview.count} verified old processes`)),el('p','social-hint',settle?tr('仅核对原进程并重试本次管理记录与资源的收尾，不会再次停止进程。账号数据与待更新记录保留，QQ 不会自动启动。','Only recheck the original processes and retry ownership-record and resource settlement. No further process stop is issued. Account data and update records are kept; QQ will not start automatically.'):tr('仅停止这份旧管理记录中核验过的残留进程，相关 AI 和语音连接可能中断。登录数据、账号配置与待更新记录会保留；清理后不会自动启动 QQ。','Stop only the verified remaining processes from this ownership record. Related AI and voice connections may be interrupted. Login data, account configuration and update records are kept; QQ will not start automatically.')));
      const actions=el('div','qq-runtime-actions'),confirm=button(settle?tr('完成收尾','Finish settlement'):tr(`清理这 ${preview.count} 个残留进程`,`Clear these ${preview.count} remaining processes`),'qqRuntimeOrphanCleanup',{accountId:item.accountId,expectedDigest:preview.expectedDigest},{disabled:current?.desktopRunning,primary:true}),cancel=el('button','secondary',tr('取消','Cancel'));
      confirm.id=`qq-orphan-clean-${item.accountId}`;cancel.id=`qq-orphan-cancel-${item.accountId}`;cancel.disabled=busy;cancel.onclick=()=>{clearOrphanPreviews();draw();document.getElementById(inspect.id)?.focus();};actions.append(cancel,confirm);box.append(actions);area.append(box);
    }
    card.append(area);
  }
  function field(form,title,id,kind='input'){
    const wrap=el('label','qq-runtime-field'),caption=el('span','',title),input=el(kind);input.id=id;wrap.htmlFor=id;input.disabled=busy;wrap.append(caption,input);form.append(wrap);return input;
  }
  function qqInput(input){input.type='text';input.inputMode='numeric';input.pattern='[1-9][0-9]{4,14}';input.maxLength=15;input.required=true;input.autocomplete='off';input.spellcheck=false;}
  function serverOptions(select,bridges,value){
    const empty=el('option','',bridges.length?tr('选择一个连接','Choose a connection'):tr('新建本机连接','New local connection'));empty.value='';select.append(empty);select.required=bridges.length>0;
    for(const row of bridges){const option=el('option','',`${row.serverName} · ${row.port||'—'}${row.enabled&&row.loopbackOnly&&row.hasToken?'':tr(' · 需准备',' · preparation needed')}`);option.value=row.serverName;select.append(option);}select.value=value;
  }
  function addForm(current,target=section){
    if(!window.arcade.qqRuntimeConfigure)return;
    const details=el('details','qq-runtime-create');details.open=addOpen;details.ontoggle=()=>{if(details.isConnected)addOpen=details.open;};details.append(el('summary','',tr('添加 QQ 账号','Add a QQ account')));
    const form=el('form','qq-runtime-form');const input=field(form,tr('AI 的 QQ 号','AI QQ number'),'qq-runtime-add-id');qqInput(input);input.value=addAccount;input.oninput=()=>{addAccount=input.value;};
    form.append(el('p','social-hint',tr('使用独立 QQ 账号。端口自动选择；此操作只准备账号，不登录、不连接 AI。','Use a separate QQ account. The port is selected automatically; this only prepares the account, without signing in or connecting an AI.')));
    const submit=el('button','primary',tr('添加账号','Add account'));submit.type='submit';submit.disabled=busy||!current?.configured||current?.desktopRunning;form.append(submit);
    const scope=installationRevision;form.onsubmit=event=>{event.preventDefault();if(!form.isConnected||scope!==installationRevision||submit.disabled||!form.reportValidity())return;void run('qqRuntimeConfigure',{accountId:input.value.trim(),create:true});};details.append(form);target.append(details);
  }
  function connectionForms(item,card,linked,current){
    if(!window.arcade.qqRuntimeConfigure||!window.arcade.qqRuntimeLink)return;
    const accounts=latest?.accounts?.accounts||[],bridges=(item.bridges||[]).slice(0,100),suggested=linked||accounts.find(row=>row.expectedQQAccountId===item.accountId);
    let draft=formDrafts.get(item.accountId);
    if(!draft){draft={open:false,configDirty:false,configServer:bridges.length===1?bridges[0].serverName:'',port:'',companionId:suggested?.id||'',ownerId:suggested?.qqOwnerId||'',linkServer:bridges.length===1?bridges[0].serverName:''};formDrafts.set(item.accountId,draft);}
    if(!draft.configDirty){if(!bridges.some(row=>row.serverName===draft.configServer))draft.configServer=bridges.length===1?bridges[0].serverName:'';draft.port=String(bridges.find(row=>row.serverName===draft.configServer)?.port||'');}
    if(!draft.linkServer&&bridges.length===1)draft.linkServer=bridges[0].serverName;
    const details=el('details','qq-runtime-configuration');details.open=draft.open;details.ontoggle=()=>{if(details.isConnected)draft.open=details.open;};details.append(el('summary','',tr('连接配置与搭档','Connection and companion')));
    const configure=el('form','qq-runtime-form');configure.append(el('h3','',tr('本机连接','Local connection')));
    const server=field(configure,tr('现有连接','Existing connection'),`qq-config-server-${item.accountId}`,'select');serverOptions(server,bridges,draft.configServer);server.onchange=()=>{draft.configServer=server.value;draft.port=String(bridges.find(row=>row.serverName===server.value)?.port||'');draft.configDirty=true;draw();};
    const port=field(configure,tr('端口（留空自动选择）','Port (blank for automatic)'),`qq-config-port-${item.accountId}`);port.type='number';port.min='1024';port.max='65535';port.step='1';port.placeholder=tr('自动','Automatic');port.value=draft.port;port.oninput=()=>{draft.port=port.value;draft.configDirty=true;};
    const prepare=el('button','secondary',tr('准备本机连接','Prepare local connection'));prepare.type='submit';prepare.disabled=busy||item.processRunning||item.recoveryRequired||current?.desktopRunning;configure.append(prepare);
    configure.append(el('p','social-hint',prepare.disabled&&!busy?tr('先停止对应 QQ，再准备连接；原配置会保留备份。','Stop this QQ runtime before preparing its connection. The original configuration is backed up.'):tr('仅配置本机连接。已有多个连接时，需要明确选择；凭据不会显示在页面。','Configure a local connection only. Explicitly select among multiple existing connections; credentials are never displayed.')));
    const scope=installationRevision;configure.onsubmit=event=>{event.preventDefault();if(!configure.isConnected||scope!==installationRevision||prepare.disabled||!configure.reportValidity())return;void run('qqRuntimeConfigure',{accountId:item.accountId,...(server.value?{serverName:server.value}:{}),...(port.value?{port:Number(port.value)}:{})});};details.append(configure);
    const link=el('form','qq-runtime-form');link.append(el('h3','',tr('绑定搭档','Bind a companion')));
    const companion=field(link,tr('AI 搭档','AI companion'),`qq-link-companion-${item.accountId}`,'select');const blank=el('option','',tr('选择已添加的搭档','Choose an existing companion'));blank.value='';companion.append(blank);for(const row of accounts){const option=el('option','',row.name||row.id);option.value=row.id;companion.append(option);}companion.required=true;companion.value=draft.companionId;
    companion.onchange=()=>{draft.companionId=companion.value;draft.ownerId=accounts.find(row=>row.id===companion.value)?.qqOwnerId||'';draw();};
    const owner=field(link,tr('你的 QQ 号（主人）','Your QQ number (owner)'),`qq-link-owner-${item.accountId}`);qqInput(owner);owner.value=draft.ownerId;owner.oninput=()=>{draft.ownerId=owner.value;};
    const linkServer=field(link,tr('使用哪个连接','Connection to use'),`qq-link-server-${item.accountId}`,'select');serverOptions(linkServer,bridges,draft.linkServer);linkServer.required=true;linkServer.onchange=()=>{draft.linkServer=linkServer.value;draw();};
    const selected=accounts.find(row=>row.id===draft.companionId),chosen=bridges.find(row=>row.serverName===draft.linkServer),disconnected=selected?.status==='disconnected',ready=chosen?.enabled&&chosen?.loopbackOnly&&chosen?.hasToken;
    const save=el('button','secondary',tr('保存绑定','Save binding'));save.type='submit';save.disabled=busy||!selected||!disconnected||!ready;link.append(save);
    link.append(el('p','social-hint',selected&&!disconnected?issue('account_connected'):!ready?tr('先准备并选择已启用的本机连接。','First prepare and select an enabled local connection.'):tr('只保存绑定。不会自动连接 AI、登录 QQ 或发送消息。','Save only. This does not connect the AI, sign in to QQ or send messages.')));
    link.onsubmit=event=>{event.preventDefault();if(!link.isConnected||scope!==installationRevision||save.disabled||!link.reportValidity())return;if(owner.value.trim()===item.accountId){owner.setCustomValidity(issue('owner_is_agent_account'));owner.reportValidity();owner.oninput=()=>{owner.setCustomValidity('');draft.ownerId=owner.value;};return;}void run('qqRuntimeLink',{accountId:item.accountId,companionId:companion.value,ownerId:owner.value.trim(),serverName:linkServer.value});};details.append(link);card.append(details);
  }
  function backupControls(item,card,current){
    if(!window.arcade.qqRuntimeBackups||!window.arcade.qqRuntimeBackupPreview||!window.arcade.qqRuntimeBackupRestore)return;
    let state=backupViews.get(item.accountId);if(!state){state={open:false,loaded:false,rows:[],selected:'',preview:null,receipt:''};backupViews.set(item.accountId,state);}
    const details=el('details','qq-runtime-backups');details.open=state.open;details.ontoggle=()=>{if(details.isConnected)state.open=details.open;};details.append(el('summary','',tr('配置备份','Configuration backups')));
    const body=el('div','qq-runtime-form');body.append(el('p','social-hint',tr('只恢复本机连接配置，不恢复 QQ 登录。备份含连接凭据，内容不会显示或导出。','Restore local connection configuration only, not QQ login. Backups contain bridge credentials; their contents are not displayed or exported.')),
      button(tr('列出备份','List backups'),'qqRuntimeBackups',{accountId:item.accountId,limit:30}));
    if(state.loaded){
      if(!state.rows.length)body.append(el('p','social-hint',tr('这个账号还没有可列出的配置备份。','No configuration backups are listed for this account.')));
      else{
        const select=field(body,tr('选择要预览的备份','Backup to preview'),`qq-backup-select-${item.accountId}`,'select'),blank=el('option','',tr('请选择一份备份','Select one backup'));blank.value='';select.append(blank);
        for(const row of state.rows){const choice=el('option','',`${new Date(row.createdAt).toLocaleString(language==='zh'?'zh-CN':'en')} · ${row.valid?`${row.size} B`:tr('不可恢复','Unavailable')}`);choice.value=row.id;choice.disabled=!row.valid;select.append(choice);}select.value=state.selected;
        select.onchange=()=>{state.selected=select.value;state.preview=null;state.receipt='';draw();};
        const selected=state.rows.find(row=>row.id===state.selected&&row.valid);
        body.append(button(tr('预览变更','Preview changes'),'qqRuntimeBackupPreview',{accountId:item.accountId,backupId:selected?.id,sha256:selected?.sha256},{disabled:!selected}));
      }
      if(state.hasMore)body.append(el('p','social-hint',state.scanLimited?tr('备份数量较多，仅扫描了有限条目；当前列表不保证包含最新一份。','The scan limit was reached; this list may not include the newest backup.'):tr('这里只显示最近 30 份备份，其他文件仍保留。','Showing the latest 30 backups; other files are retained.')));
    }
    const preview=state.preview;
    if(preview){
      const change=preview.changes||{},previewBox=el('div','qq-backup-preview');previewBox.setAttribute('role','status');
      previewBox.append(el('h3','',tr('恢复前请核对','Review before restoring')),
        el('p','social-hint',preview.unchanged?tr('备份与当前文件的字节完全相同。','The backup and current file have identical bytes.'):tr('将用所选备份替换当前配置，并先原样保存当前文件。','The selected backup will replace the configuration after the current file is preserved byte for byte.')));
      if(!change.currentValid)previewBox.append(el('p','social-hint',tr('当前 JSON 已损坏，无法逐项比较；仍会保留原文件。','Current JSON is invalid, so individual fields cannot be compared; the original file will still be preserved.')));
      const names={name:['名称','name'],enable:['启用状态','enabled state'],host:['监听地址','listen address'],port:['端口','port'],token:['连接凭据','bridge credentials'],messagePostFormat:['消息格式','message format'],reportSelfMessage:['自身消息','self messages'],enableForcePushEvent:['事件推送','event delivery'],debug:['调试','debug'],heartInterval:['心跳','heartbeat']};
      for(const group of change.groups||[])for(const row of group.rows||[]){
        const fields=(row.changedFields||[]).filter(key=>names[key]).map(key=>tr(...names[key]));if(row.otherFieldsChanged)fields.push(tr('其他字段','other fields'));
        previewBox.append(el('p','social-hint',`${group.kind} #${row.index+1}: ${fields.join(' / ')}`));
        if(row.before?.port!==row.after?.port)previewBox.append(el('p','social-hint',`${tr('端口','Port')}: ${row.before?.port??'—'} → ${row.after?.port??'—'}`));
        if(row.after&&!row.after.loopbackOnly)previewBox.append(el('p','problem',tr('此备份中的连接不只监听回环地址。','This backup contains a connection that is not limited to loopback.')));
        if(row.after?.enabled&&!row.after.hasToken)previewBox.append(el('p','problem',tr('此备份中的已启用连接没有凭据。','An enabled connection in this backup has no credentials.')));
      }
      if(change.otherNetworkFieldsChanged||change.otherTopLevelFieldsChanged)previewBox.append(el('p','social-hint',tr('其他配置字段也有变化；名称与内容已隐藏。','Other configuration fields also change; their names and contents are hidden.')));
      if(change.credentialsMayChange)previewBox.append(el('p','social-hint',tr('连接凭据可能变化。不会生成新凭据，也不会自动更新搭档绑定。','Bridge credentials may change. No new credential is generated and companion bindings are not updated automatically.')));
      previewBox.append(el('p','qq-backup-hash',`SHA-256: ${preview.sha256}`));
      const active=(latest?.accounts?.accounts||[]).some(account=>{const ids=[account.accountId,account.expectedQQAccountId,account.qqBinding?.accountId].filter(Boolean);return account.channel==='qq'&&account.status!=='disconnected'&&(ids.includes(item.accountId)||!ids.length);});
      const blocked=item.processRunning||item.recoveryRequired||current?.desktopRunning||active;
      if(blocked)previewBox.append(el('p','social-hint',tr('先断开对应 AI、停止这个 QQ，并退出 NapCat Desktop，才能恢复。','Disconnect the AI, stop this QQ runtime and close NapCat Desktop before restoring.')));
      previewBox.append(button(tr('恢复这份配置','Restore this configuration'),'qqRuntimeBackupRestore',{accountId:item.accountId,backupId:preview.backupId,sha256:preview.sha256,currentSha256:preview.currentSha256},{disabled:blocked||preview.unchanged,primary:true}));body.append(previewBox);
    }
    if(state.receipt){const receipt=el('p','social-hint qq-backup-receipt',state.receipt);receipt.setAttribute('role','status');body.append(receipt);}
    details.append(body);card.append(details);
  }
  function draw(){
    const observed=(cached||latest?.qqRuntime)?.instances||[];
    if(selectedAccount&&!observed.some(row=>row.accountId===selectedAccount))resetLoginSelection(observed[0]?.accountId||'');
    if(!installationChanged)for(const card of section.querySelectorAll('.qq-runtime-card')){const advanced=card.querySelector('.qq-login-advanced'),more=card.querySelector('.qq-login-more');if(advanced)loginAdvancedOpen.set(card.dataset.accountId,advanced.open);if(more)loginMoreOpen.set(card.dataset.accountId,more.open);}
    fingerprint=JSON.stringify([language,cached,latest?.accounts,pollProblem,!!window.canOpenQQPluginAdmin?.(),!!window.canOpenQQPluginPackage?.(),!!window.canOpenQQSSQQClient?.(),!!window.canOpenQQRemote?.()]);
    // Native details toggle events are queued. Read the live state before a
    // status repaint so a just-opened form cannot collapse during that gap.
    if(!installationChanged){
      const previousAdd=section.querySelector('.qq-runtime-create');if(previousAdd)addOpen=previousAdd.open;
      const previousInstallation=section.querySelector('.qq-runtime-installation');if(previousInstallation)installationOpen=previousInstallation.open;
      for(const details of section.querySelectorAll('.qq-runtime-configuration')){const draft=formDrafts.get(details.closest('.qq-runtime-card')?.dataset.accountId);if(draft)draft.open=details.open;}
      for(const details of section.querySelectorAll('.qq-runtime-backups')){const state=backupViews.get(details.closest('.qq-runtime-card')?.dataset.accountId);if(state)state.open=details.open;}
    }
    const active=!installationChanged&&(section.contains(document.activeElement)||accountDialog.contains(document.activeElement))?document.activeElement:null,focusId=active?.id,selection=active&&typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;installationChanged=false;
    const current=cached||latest?.qqRuntime;section.replaceChildren();section.setAttribute('aria-busy',String(busy));
    const visibleIds=new Set((current?.instances||[]).map(row=>row.accountId));for(const map of [formDrafts,backupViews,orphanViews])for(const key of map.keys())if(!visibleIds.has(key))map.delete(key);
    const heading=el('div','page-heading');const title=el('div');title.append(el('h1','',tr('QQ 账号','QQ accounts')),el('p','subtitle',tr('登录、运行和 AI 连接，都在这一个窗口。','Sign-in, runtime and AI connections in one window.')));heading.append(title,button(tr('刷新状态','Refresh status'),'qqRuntimeRefresh',undefined));if(window.canOpenQQRemote?.()){const remote=el('button','secondary',tr('远程实例','Remote instances'));remote.id='qq-remote-open';remote.onclick=()=>void window.openQQRemote?.();heading.append(remote);}section.append(heading);
    if(!window.arcade.qqRuntimeRefresh){section.append(el('p','problem',tr('这个预览未接入本机 QQ 管理。','This preview does not provide local QQ management.')));return;}
    // No observation is not a missing installation. Do not flash setup actions
    // while the first bounded runtime read is pending or has failed.
    if(!current){
      const message=feedback||(pollProblem?tr('尚未取得本机账号状态，请手动刷新重试。','The local account state is unavailable. Refresh to retry.'):tr('正在核对本机账号，请稍候…','Checking the local account. Please wait…'));
      const notice=el('p',failed?'problem':'social-hint',message);notice.setAttribute('role',failed?'alert':'status');notice.setAttribute('aria-live','polite');section.append(notice);return;
    }
    if(busy&&diagnosticReport?.state!=='preparing'){const pending=el('p','social-hint',tr('正在核对本机账号，请稍候…','Checking the local account. Please wait…'));pending.setAttribute('role','status');pending.setAttribute('aria-live','polite');section.append(pending);}
    else if(pollProblem){const notice=el('p','social-hint',tr('状态刷新未完成，当前显示上次结果。可以稍后手动刷新。','Status refresh did not finish. Showing the previous result; you can retry manually.'));notice.setAttribute('role','status');section.append(notice);}
    if(feedback){const notice=el('p',failed?'problem':'social-hint',feedback);notice.setAttribute('role',failed?'alert':'status');section.append(notice);}
    const retainedInspection=current.instances?.some(row=>row.canSettleOrphanInspection===true&&!inspectionSettled(row.accountId)),settledInspection=current.instances?.some(row=>inspectionSettled(row.accountId));
    const pendingOwnerControl=current.configured===false&&current.installationKind==='managed-shell'&&current.instances?.some(row=>['pending_upstream_update','pending_update_recovery_required'].includes(row.reason)&&row.canStart===false&&(row.canStop===true||row.canRecover===true||row.canInspectOrphanCleanup===true||row.canSettleOrphanInspection===true));
    const toolbar=el('div','qq-runtime-toolbar'),installation=el('details','qq-runtime-installation');installation.open=installationOpen||!current?.configured;installation.ontoggle=()=>{if(installation.isConnected)installationOpen=installation.open;};
    const installationSummary=el('summary');installationSummary.append(el('strong','',tr('本机组件','Local components')),el('span','qq-runtime-installation-version',retainedInspection?tr('检查待收尾','Inspection pending'):settledInspection?tr('等待刷新','Refresh needed'):current?.configured?`QQ ${current.components.qqVersion||'—'} · NapCat ${current.components.napcatVersion||'—'}`:pendingOwnerControl?tr('启动受阻','Startup blocked'):tr('需要选择','Choose a folder')));installation.append(installationSummary);
    const installationBody=el('div','qq-runtime-installation-body');
    if(retainedInspection){
      installationBody.append(el('p','social-hint',tr('上次检查的收尾尚未完成。可以从对应账号卡片收尾，无需重启应用；之后再刷新状态核对组件与进程。','A previous inspection still needs settlement. Use its account card without restarting the app, then refresh to check components and processes.')));
    }else if(settledInspection){
      installationBody.append(el('p','social-hint',tr('上次检查已收尾。刷新状态后，再核对组件与进程。','The previous inspection is settled. Refresh to check components and processes.')));
    }else if(pendingOwnerControl){
      installationBody.append(el('p','social-hint',tr('待更新记录阻止启动。请在账号卡片检查已有进程，无需重新选择组件。待更新记录仍须单独检查。','A pending-update record blocks startup. Inspect the existing processes from the account card; the component folder does not need to be selected again. Inspect the update record separately.')));
    }else if(!current?.configured){
      installationBody.append(el('p','social-hint',window.arcade.qqFirstSetup?tr('在“准备 QQ”中使用已有 QQ 程序，或准备完整运行组件。已有 NapCat 安装可直接选择其数据目录，保留现有登录。','In Prepare QQ, use an installed QQ program or prepare complete runtime components. You can also select an existing NapCat data folder and retain its saved login.'):tr('已有安装时，请选择包含 components 的 NapCat 数据目录。尚未安装时，先按官方说明独立安装 QQ / NapCat，再回到这里选择目录。当前版本管理不会替你安装 QQ。','For an existing installation, choose the NapCat data folder containing components. Otherwise, install QQ / NapCat using the official guide, then return here and select its folder. Component version management does not install QQ.')));
      if(window.arcade.botQQOpenGuide)installationBody.append(button(tr('打开官方安装说明','Open official installation guide'),'botQQOpenGuide','download'));
    }
    if(current?.desktopDataRoot)installationBody.append(el('p','qq-runtime-path',current.desktopDataRoot));
    installationBody.append(button(tr('选择数据目录…','Choose data folder…'),'qqRuntimeChoose',undefined));
    if(window.arcade.qqComponents){const versions=el('button','secondary',tr('管理组件版本','Manage component versions'));versions.id='qq-components-open';versions.disabled=busy||!(current?.configured||current?.canInspectNodeRepair===true);versions.onclick=()=>window.openQQComponents?.();installationBody.append(versions);}
    if(window.arcade.qqPluginAdminRead){const plugins=el('button','secondary',tr('管理插件','Manage plugins'));plugins.id='qq-plugin-admin-open';plugins.disabled=busy||!window.canOpenQQPluginAdmin?.();plugins.onclick=()=>window.openQQPluginAdmin?.();installationBody.append(plugins);if(!window.canOpenQQPluginAdmin?.())installationBody.append(el('p','social-hint',tr('管理插件前，请选中与在线 QQ 对应的已绑定搭档。','To manage plugins, select the bound companion matching an online QQ account.')));}
    if(window.arcade.qqPluginPackageRead){const files=el('button','secondary',tr('插件文件与安装','Plugin files and installation'));files.id='qq-plugin-package-open';files.disabled=busy||!window.canOpenQQPluginPackage?.();files.onclick=()=>void window.openQQPluginPackage?.();installationBody.append(files);if(!window.canOpenQQPluginPackage?.())installationBody.append(el('p','social-hint',tr('请选择已绑定 QQ 的搭档与本机安装；无需先启动 QQ。','Select a QQ-bound companion and a local installation; QQ does not need to be running.')));}
    if(window.arcade.qqSSQQRead){const client=el('button','secondary',tr('手动 QQ 客户端','Manual QQ client'));client.id='qq-ssqq-client-open';client.disabled=busy||!window.canOpenQQSSQQClient?.();client.onclick=()=>void window.openQQSSQQClient?.();installationBody.append(client);if(!window.canOpenQQSSQQClient?.())installationBody.append(el('p','social-hint',tr('请先选中已登录的本机 QQ；无需启用 SSQQ 插件。','Select a signed-in local QQ account. The SSQQ plugin does not need to be enabled.')));}
    if(window.arcade.qqFirstSetup){const setup=el('button','secondary',tr('准备 QQ','Set up QQ'));setup.id='qq-first-setup-open';setup.disabled=busy||!latest?.accounts?.selectedId;setup.onclick=()=>window.openQQFirstSetup?.();installationBody.append(setup);}
    installation.append(installationBody);toolbar.append(installation);addForm(current,toolbar);section.append(toolbar);
    if(current?.desktopRunning)section.append(el('p','social-hint',issue('desktop_running')));
    if(current?.issue)section.append(el('p','problem',issue(current.issue)));
    const grid=el('div','qq-runtime-grid');
    for(const item of current?.instances||[]){
      const accounts=latest?.accounts?.accounts||[];
      const activeMatches=accounts.filter(row=>row.channel==='qq'&&row.accountId===item.accountId),activeLinked=activeMatches.length===1?activeMatches[0]:null;
      // Historical bindings identify the profile after a restart, not an
      // online session. A different current identity always takes precedence.
      const historicalMatches=accounts.filter(row=>row.channel==='qq'&&!row.accountId&&row.qqBinding?.source==='last_verified'&&row.qqBinding.accountId===item.accountId);
      const linked=activeLinked||(historicalMatches.length===1?historicalMatches[0]:null);
      // A unique saved expectation may decorate an unverified account, but is
      // never used as the linked identity, AI association or connection proof.
      const expectedMatches=accounts.filter(row=>row.channel==='qq'&&row.expectedQQAccountId===item.accountId);
      const expected=expectedMatches.length===1?expectedMatches[0]:null;
      const preset=!activeMatches.length&&!historicalMatches.length&&expected&&!expected.accountId&&(!expected.qqBinding?.accountId||expected.qqBinding.accountId===item.accountId)?expected:null;
      const displayProfile=activeMatches.length>1?null:linked||preset,historical=Boolean(displayProfile&&linked&&!activeLinked),persona=latest?.personas?.find(row=>row.id===displayProfile?.characterId);
      const card=el('article','qq-runtime-card');card.dataset.accountId=item.accountId;card.dataset.identitySource=preset?'preset':historical?'historical':displayProfile?'current':'unknown';card.id=`qq-runtime-account-${item.accountId}`;card.tabIndex=-1;
      const identity=el('div','qq-runtime-identity');if(persona){const img=el('img','connection-avatar');img.src=persona.portrait;img.alt='';identity.append(img);}
      const name=el('div');name.append(el('h2','',displayProfile?.name||tr('QQ 账号','QQ account')),el('p','social-hint',`QQ ${item.accountId}${historical?` · ${tr('上次关联','Last linked')}`:preset?` · ${tr('预设角色 · 未验证','Configured role · unverified')}`:''}`));identity.append(name);card.append(identity);
      const state=item.login?.state||(item.processRunning||item.canSettleOrphanInspection===true?'unknown':'stopped');const status=el('p','qq-runtime-state',label(state));status.dataset.state=state;status.setAttribute('role','status');card.append(status);
      const pendingOrphan=item.canSettleOrphanInspection===true||item.canInspectOrphanCleanup===true&&['pending_upstream_update','pending_update_recovery_required'].includes(item.reason);
      card.append(el('p','social-hint',inspectionSettled(item.accountId)?tr('上次检查已收尾，请刷新状态','The previous inspection is settled. Refresh its state.'):item.canSettleOrphanInspection===true?tr('上次检查仍有资源需要收尾','The previous inspection still holds resources.'):pendingOrphan?tr('旧管理记录保留，可检查残留进程','The previous ownership record is retained. Inspect the remaining processes.'):item.management==='owned'?tr('由 Agent Arcade 管理','Managed by Agent Arcade'):item.management==='external'?tr('目前由外部管理器运行','Currently run by another manager'):item.management==='recoverable'?tr('上次管理记录仍在，可核实后恢复','Previous management can be recovered after verification'):tr('后台进程尚未由应用接管','The app has not taken control of this runtime')));
      const actions=el('div','qq-runtime-actions');
      if(item.canRecover)actions.append(button(tr('恢复管理','Recover management'),'qqRuntimeRecover',{accountId:item.accountId},{primary:true}));
      actions.append(button(tr('启动 QQ','Start QQ'),'qqRuntimeStart',{accountId:item.accountId},{disabled:!item.canStart,primary:!item.processRunning}),button(tr('停止 QQ','Stop QQ'),'qqRuntimeStop',{accountId:item.accountId},{disabled:!item.canStop}));
      if(state!=='online'&&!pendingOrphan)actions.append(button(tr('显示二维码','Show QR code'),'qqRuntimeQR',{accountId:item.accountId,refresh:false},{disabled:!item.processRunning}),button(tr('刷新二维码','Refresh QR'),'qqRuntimeQR',{accountId:item.accountId,refresh:true},{disabled:!item.canStop}),button(tr('尝试已有登录','Try saved sign-in'),'qqRuntimeQuickLogin',{accountId:item.accountId},{disabled:!item.canStop}));
      actions.append(button(tr('查看诊断','View diagnostics'),'qqRuntimeLogs',{accountId:item.accountId}));
      if(window.arcade.qqRuntimeDirectory){const directory=el('button','secondary',tr('好友与群组','Friends and groups'));directory.disabled=busy||!item.processRunning;directory.onclick=()=>window.openQQDirectory?.({accountId:item.accountId,name:linked?.name});actions.append(directory);}
      if(window.arcade.qqSelfProfileRead){const profile=el('button','secondary',tr('QQ 资料','QQ profile'));profile.id=`qq-self-profile-open-${item.accountId}`;profile.disabled=busy||!window.canOpenQQSelfProfile?.(item.accountId);profile.onclick=()=>{if(!profile.isConnected||profile.disabled)return;const id=item.accountId;dismissAccountDialog(false);window.openQQSelfProfile?.({accountId:id,returnFocusId:`qq-overview-more-${id}`,onBack:()=>openAccountDialog(id,'manage')});};actions.append(profile);}
      if(window.arcade.qqOwnerHistoryRead){const history=el('button','secondary',tr('QQ 消息记录','QQ message history'));history.id=`qq-owner-history-open-${item.accountId}`;history.disabled=busy||!window.canOpenQQOwnerHistory?.(item.accountId);history.onclick=()=>{if(!history.isConnected||history.disabled)return;const id=item.accountId;dismissAccountDialog(false);window.openQQOwnerHistory?.({accountId:id,returnFocusId:`qq-overview-more-${id}`});};actions.append(history);}
      aiControls(item,card,actions,current);
      card.append(actions);
      orphanControls(item,card,current);
      if(item.login?.issue)card.append(el('p','social-hint',pendingOrphan&&item.login.issue==='webui_unavailable'?tr('本机管理接口尚未就绪，请先检查残留进程；待更新记录须另行处理。','The local management endpoint is not ready. Inspect the remaining processes; handle the update record separately.'):issue(item.login.issue)));
      if(item.endpointRecoveryIssue==='endpoint_recovery_unavailable')card.append(el('p','social-hint',tr('管理连接的加密恢复记录不可用，已有记录会保留。已验证的连接仍可继续使用；如登录状态无法显示，请停止这个 QQ 再启动以重建当前连接。这不会修复旧加密记录。','The encrypted management recovery record is unavailable; existing records are kept. A verified connection remains usable. If sign-in status is unavailable, stop this QQ runtime and start it again to rebuild the current connection. This does not repair the old encrypted record.')));
      if(item.reason&&!['desktop_running','external_process'].includes(item.reason))card.append(el('p','social-hint',issue(item.reason)));
      if(qrAccount===item.accountId&&qrImage&&state!=='online'){const img=el('img','qq-runtime-qr');img.src=qrImage;img.width=240;img.height=240;img.alt=tr('此 QQ 账号的登录二维码','Login QR code for this QQ account');card.append(img);}
      if(logsAccount===item.accountId){const diagnostics=el('section','qq-runtime-diagnostics'),log=el('div','qq-runtime-log');diagnostics.append(log);log.setAttribute('role','log');log.append(el('h3','',tr('最近的运行事件','Recent runtime events')));if(!logs.length)log.append(el('p','social-hint',tr('尚无可显示的运行事件。','No runtime events to display.')));for(const entry of logs){const row=el('p');row.append(el('time','',entry.time||'—'),el('span','',events[entry.type]?tr(...events[entry.type]):tr('后台状态变化','Runtime state changed')));log.append(row);}
        if(window.arcade.qqRuntimeExportDiagnostics){
          const tools=el('div','qq-diagnostic-export');diagnostics.append(tools);
          const exportButton=button(tr('导出脱敏报告…','Export redacted report…'),'qqRuntimeExportDiagnostics',{accountId:item.accountId},{disabled:logsScope!==diagnosticScope(item.accountId)});exportButton.id=`qq-diagnostics-export-${item.accountId}`;
          const current=diagnosticReport?.accountId===item.accountId&&diagnosticReport.scope===diagnosticScope(item.accountId)?diagnosticReport:null;
          if(current?.state==='preparing')exportButton.textContent=tr('正在准备报告…','Preparing report…');
          tools.append(el('p','social-hint',tr('仅保存版本、状态和有限的分类事件；不包含 QQ 号、消息、凭据、路径或原始日志。文件只保存到本机，不会上传。','Saves versions, status and bounded classified events. No QQ numbers, messages, credentials, paths or raw logs. The file stays on this device and is not uploaded.')),exportButton);
          if(!current&&logsScope!==diagnosticScope(item.accountId))tools.append(el('p','social-hint',tr('请重新查看诊断，再导出当前记录。','Open diagnostics again before exporting the current record.')));
          if(current){
            const text=current.state==='saved'?tr('脱敏报告已保存到本机，未上传。','Redacted report saved on this device. Nothing was uploaded.'):current.state==='cancelled'?tr('已取消保存报告。','Report save cancelled.'):current.state==='preparing'?tr('正在准备报告，请在保存窗口选择位置；也可以取消。','Preparing the report. Choose a location in the save dialog, or cancel.'):current.state==='failed'?tr('未能保存报告。请重新查看诊断后再试。','Could not save the report. Open diagnostics again, then retry.'):tr('报告保存结果尚未确认，请先检查你选择的位置。','The report save result is unconfirmed. Check your chosen location first.');
            const status=el('p','social-hint qq-diagnostic-export-status',text);status.setAttribute('role','status');status.setAttribute('aria-live','polite');tools.append(status);
          }
        }
        card.append(diagnostics);}
      connectionForms(item,card,linked,current);
      backupControls(item,card,current);
      grid.append(card);
    }
    if(current&&!current.instances?.length)grid.append(el('p','social-hint',tr('这个数据目录中尚未发现 QQ 实例。','No QQ instances were found in this data folder.')));section.append(grid);
    arrangeLogin();arrangeOverview();
    if(focusId){const next=document.getElementById(focusId);if(next&&!next.disabled&&!next.closest('[hidden]')){next.focus({preventScroll:true});if(selection&&typeof next.setSelectionRange==='function')next.setSelectionRange(...selection);}}
    if(navigationAccount&&!busy&&view==='qq-runtime')requestAnimationFrame(focusRequestedAccount);
  }
  // Local management selection is distinct from the selected AI companion.
  const accountDialog=el('dialog','qq-account-dialog');accountDialog.id='qq-account-dialog';accountDialog.setAttribute('aria-labelledby','qq-account-dialog-title');document.body.append(accountDialog);
  let dialogAccount='',dialogIntent='',dialogReturnFocus=null,dialogRuntimeKey='',dialogRuntimeRevision=0;
  const dialogRuntimeScope=row=>JSON.stringify([row?.runtimeRevision,!!row?.processRunning,row?.login?.state]);
  function dismissAccountDialog(redraw=true){
    if(!dialogAccount&&!accountDialog.open)return;
    conversationManagementRevision++;
    diagnosticReport=null;dialogAccount='';dialogIntent='';dialogRuntimeKey='';accountRevision++;clearQR();clearOrphanPreviews();feedback='';failed=false;for(const value of backupViews.values())value.preview=null;
    if(accountDialog.open)accountDialog.close();accountDialog.replaceChildren();
    const previous=dialogReturnFocus;dialogReturnFocus=null;if(redraw)draw();
    const target=(previous&&document.getElementById(previous))||(view==='qq-runtime'&&document.getElementById('qq-overview-refresh'));if(target?.isConnected&&!target.disabled)target.focus({preventScroll:true});
  }
  accountDialog.addEventListener('cancel',event=>{event.preventDefault();dismissAccountDialog();});
  accountDialog.addEventListener('close',()=>{if(dialogAccount&&!accountDialog.open)dismissAccountDialog();});
  function openAccountDialog(accountId,intent='manage',dispatch=null){
    const row=(cached||latest?.qqRuntime)?.instances?.find(item=>item.accountId===accountId);
    if(!row||closed||view!=='qq-runtime'||document.hidden)return;
    conversationManagementRevision++;
    if(selectedAccount!==accountId)resetLoginSelection(accountId);
    dialogReturnFocus=document.activeElement?.id||null;dialogAccount=accountId;dialogIntent=intent;dialogRuntimeKey=dialogRuntimeScope(row);draw();
    if(dispatch==='qr'&&row.processRunning&&row.login?.state==='login_required')void run('qqRuntimeQR',{accountId,refresh:false});
    else if(dispatch==='start'&&row.canStart&&!row.processRunning)void run('qqRuntimeStart',{accountId});
    else if(dispatch==='recover'&&row.canRecover)void run('qqRuntimeRecover',{accountId});
    else if(dispatch==='ai'||dispatch==='conversation'){
      const button=document.getElementById(`qq-ai-${dispatch==='ai'?'connect':'open'}-${accountId}`);
      if(button?.isConnected&&!button.disabled)button.click();
    }
  }
  function arrangeOverview(){
    const helpOpen=accountDialog.querySelector('.qq-login-help')?.open===true;
    const state=cached||latest?.qqRuntime,layout=section.querySelector('.qq-login-layout');if(!state||!layout)return;
    const cards=[...layout.querySelectorAll('.qq-runtime-card')],side=layout.querySelector('.qq-login-sidebar'),content=layout.querySelector('.qq-login-content');
    const title=el('div','qq-overview-heading'),heading=el('div');heading.append(el('h1','',tr('QQ 账号','QQ accounts')),el('p','',tr('让搭档拥有自己的聊天账号。','A chat account of each companion’s own.')));title.append(heading);
    const tools=el('div','qq-overview-tools');const add=side.querySelector('.qq-runtime-create'),installation=side.querySelector('.qq-runtime-installation'),refresh=side.querySelector('.qq-login-sidebar-head button');if(refresh){refresh.id='qq-overview-refresh';tools.append(refresh);}const remote=side.querySelector('#qq-remote-open');if(remote)tools.append(remote);if(add)tools.append(add);if(installation)tools.append(installation);title.append(tools);
    const grid=el('div','qq-overview-grid'),stash=el('div');stash.hidden=true;
    for(const card of cards){
      const id=card.dataset.accountId,row=state.instances.find(item=>item.accountId===id),identity=card.querySelector('.qq-runtime-identity'),status=card.querySelector('.qq-runtime-state');
      const tile=el('article','qq-overview-card');tile.dataset.accountId=id;
      const photo=identity.querySelector('img');
      tile.dataset.character=photo?.src.includes('claude-ju')?'ju':photo?.src.includes('codex-dragon')?'dragon':photo?.src.includes('deepseek-whale')?'whale':'other';
      const art=el('div','qq-overview-art');art.setAttribute('aria-hidden','true');tile.append(art);
      const top=el('div','qq-overview-identity'),crop=el('div','qq-overview-avatar');
      crop.setAttribute('aria-hidden','true');
      const showPlaceholder=()=>{crop.textContent='QQ';};
      if(photo){
        const avatar=el('img');
        avatar.alt='';
        avatar.addEventListener('error',showPlaceholder,{once:true});
        avatar.src=photo.getAttribute('src');
        crop.append(avatar);
      }else showPlaceholder();
      const name=el('div');name.append(el('h2','',identity.querySelector('h2').textContent),el('p','qq-overview-number',card.dataset.identitySource==='preset'?`QQ ${id} · ${tr('预设角色','Configured role')}`:identity.querySelector('p').textContent));if(status)name.append(status.cloneNode(true));top.append(crop,name);tile.append(top);
      const more=el('button','qq-overview-more',tr('更多','More'));more.id=`qq-overview-more-${id}`;more.setAttribute('aria-label',tr(`管理 ${identity.querySelector('h2').textContent}`,`Manage ${identity.querySelector('h2').textContent}`));more.onclick=()=>{if(more.isConnected)openAccountDialog(id,'manage');};tile.append(more);
      let text=tr('查看状态','Check status'),dispatch=null,intent='manage';
      const login=row.login?.state,ai=card.querySelector(`#qq-ai-connect-${id}`),conversation=card.querySelector(`#qq-ai-open-${id}`);
      if(inspectionSettled(row.accountId))text=tr('查看收尾结果','View settlement');
      else if(row.canSettleOrphanInspection===true)text=tr('收尾上次检查','Settle previous inspection');
      else if(row.canInspectOrphanCleanup===true||row.reason==='orphaned_children')text=tr('检查上次运行','Inspect previous runtime');
      else if(row.canRecover){text=tr('恢复管理','Recover management');dispatch='recover';}
      else if(!row.processRunning&&row.canStart){text=tr('启动 QQ','Start QQ');dispatch='start';intent='login';}
      else if(row.processRunning&&login==='login_required'){text=tr('登录 QQ','Sign in to QQ');dispatch='qr';intent='login';}
      else if(login==='online'&&conversation){text=tr('打开对话','Open conversation');dispatch='conversation';}
      else if(login==='online'&&ai){text=ai.textContent;dispatch='ai';}
      const actions=el('div','qq-overview-actions'),primary=el('button','primary',text);primary.id=`qq-overview-action-${id}`;primary.disabled=busy||(dispatch==='ai'&&ai.disabled)||(dispatch==='conversation'&&conversation.disabled);primary.onclick=()=>{if(!primary.isConnected)return;if(dispatch==='conversation'){const association=aiAssociation(row);void action(()=>openConnectedConversation(id,association.profile?.id));}else openAccountDialog(id,intent,dispatch);};actions.append(primary);
      const actual=(latest?.accounts?.accounts||[]).filter(item=>item.channel==='qq'&&item.accountId===id);const unique=actual.length===1?actual[0]:null;
      const aiState=aiConnecting.has(id)||ai?.textContent.includes(tr('正在连接','Connecting'))||ai?.textContent.includes(tr('正在核对','Checking and connecting'))?tr('AI 正在连接','AI is connecting'):unique?.status==='connected'?tr('AI 已连接','AI connected'):tr('AI 尚未连接','AI not connected');
      actions.append(el('span','qq-overview-ai-state',aiState));tile.append(actions);grid.append(tile);stash.append(card);
    }
    const notices=[...content.children].filter(n=>!n.classList.contains('qq-runtime-card'));layout.remove();section.replaceChildren(title,grid);
    if(!cards.length){for(const n of notices)section.append(n);}else for(const n of notices)if(n.classList.contains('qq-login-notice'))section.append(n);
    section.append(stash);section.classList.add('qq-account-overview');
    if(cards.length>0&&cards.length<=3){const ornament=el('div','qq-overview-corner');ornament.setAttribute('aria-hidden','true');section.append(ornament);}
    if(dialogAccount&&!state.instances.some(item=>item.accountId===dialogAccount))dismissAccountDialog(false);
    if(!dialogAccount){if(accountDialog.open)accountDialog.close();accountDialog.replaceChildren();return;}
    const selected=cards.find(card=>card.dataset.accountId===dialogAccount);if(!selected){dismissAccountDialog(false);return;}
    selected.hidden=false;
    const close=el('button','qq-account-dialog-close','×');close.setAttribute('aria-label',tr('关闭','Close'));close.id='qq-account-dialog-close';close.onclick=()=>dismissAccountDialog();
    const titleNode=el('h2','sr-only',tr('QQ 账号管理','QQ account management'));titleNode.id='qq-account-dialog-title';
    accountDialog.replaceChildren(titleNode,close,...notices.filter(n=>n.classList.contains('qq-login-notice')),selected);accountDialog.dataset.intent=dialogIntent;accountDialog.dataset.character=grid.querySelector(`[data-account-id="${dialogAccount}"]`)?.dataset.character||'other';
    const inlineMore=selected.querySelector('.qq-login-more');if(inlineMore)inlineMore.hidden=dialogIntent!=='manage'||!inlineMore.querySelector('.qq-login-more-body')?.children.length;
    if(dialogIntent==='login'){const manage=el('button','plain',tr('管理这个账号','Manage this account'));manage.id='qq-account-dialog-manage';manage.onclick=()=>{dialogIntent='manage';draw();};selected.querySelector('.qq-login-links')?.append(manage);}
    if(dialogIntent==='manage'){const advanced=selected.querySelector('.qq-login-advanced');if(advanced){advanced.open=true;loginAdvancedOpen.set(dialogAccount,true);}}
    if(dialogIntent==='login'){const help=el('details','qq-login-help');help.open=helpOpen;help.append(el('summary','',tr('遇到问题','Need help?')));for(const node of selected.querySelectorAll(':scope>.qq-login-links,:scope>.qq-login-advanced'))help.append(node);selected.append(help);}
    let focusIndex=0;for(const node of selected.querySelectorAll('button,summary,input,select,textarea')){if(!node.id)node.id=`qq-dialog-${dialogAccount}-${node.dataset.runtimeAction||node.tagName.toLowerCase()}-${focusIndex}`;focusIndex++;}
    if(!accountDialog.open)accountDialog.showModal();
  }

  function resetLoginSelection(accountId){
    diagnosticReport=null;selectedAccount=accountId;accountRevision++;for(const node of section.querySelectorAll('.qq-login-more'))node.open=false;loginMoreOpen.clear();clearQR();logsAccount='';logs=[];
    feedback='';failed=false;aiFeedback.clear();clearOrphanPreviews();for(const value of backupViews.values())value.preview=null;
  }
  function selectLoginAccount(accountId){
    if(selectedAccount===accountId)return;
    resetLoginSelection(accountId);draw();
  }
  function arrangeLogin(){
    if(!cached&&!latest?.qqRuntime)return;
    const current=cached||latest.qqRuntime,cards=[...section.querySelectorAll('.qq-runtime-card')];
    if(!cards.some(card=>card.dataset.accountId===selectedAccount))selectedAccount=cards[0]?.dataset.accountId||'';
    const heading=section.querySelector('.page-heading'),toolbar=section.querySelector('.qq-runtime-toolbar'),grid=section.querySelector('.qq-runtime-grid');
    if(!heading||!toolbar||!grid)return;
    section.classList.add('qq-login-workspace');
    const shell=el('div','qq-login-layout'),side=el('div','qq-login-sidebar'),sideHead=el('div','qq-login-sidebar-head');
    sideHead.append(el('h1','',tr('QQ 账号','QQ accounts')));
    const refresh=heading.querySelector('button');if(refresh){refresh.textContent=tr('刷新','Refresh');refresh.className='plain';refresh.setAttribute('aria-label',tr('刷新 QQ 账号状态','Refresh QQ account state'));sideHead.append(refresh);}const remote=heading.querySelector('#qq-remote-open');if(remote)sideHead.append(remote);side.append(sideHead);
    const accountList=el('div','qq-login-account-list');accountList.setAttribute('aria-label',tr('选择 QQ 账号','Choose QQ account'));
    for(const card of cards){
      const id=card.dataset.accountId,item=current.instances.find(row=>row.accountId===id),identity=card.querySelector('.qq-runtime-identity'),status=card.querySelector('.qq-runtime-state');
      const row=el('button','qq-login-account');row.type='button';row.id=`qq-login-select-${id}`;row.dataset.accountId=id;row.setAttribute('aria-pressed',String(id===selectedAccount));row.setAttribute('aria-controls',card.id);
      const avatar=identity?.querySelector('img');if(avatar){const crop=el('span','qq-login-avatar-crop');crop.append(avatar.cloneNode());row.append(crop);}else row.append(el('span','qq-login-avatar-empty','QQ'));
      const text=el('span','qq-login-account-copy');text.append(el('strong','',identity?.querySelector('h2')?.textContent||'QQ'),el('small','',status?.textContent||label('unknown')));row.append(text);
      const dot=el('span','qq-login-status-dot');dot.dataset.state=item?.login?.state||'stopped';dot.setAttribute('aria-hidden','true');row.append(dot);
      row.onclick=()=>{if(row.isConnected)selectLoginAccount(id);};accountList.append(row);
      card.hidden=id!==selectedAccount;
    }
    side.append(accountList);
    const sideFoot=el('div','qq-login-sidebar-foot');const add=toolbar.querySelector('.qq-runtime-create'),installation=toolbar.querySelector('.qq-runtime-installation');
    if(add)sideFoot.append(add);if(installation)sideFoot.append(installation);side.append(sideFoot);
    const content=el('div','qq-login-content');
    const notices=[...section.children].filter(node=>node!==heading&&node!==toolbar&&node!==grid);for(const notice of notices){
      // The QR area already contains this exact instruction; preserve errors.
      if(!failed&&qrImage&&notice.textContent===tr('用这个 AI 的手机 QQ 扫码，并在手机确认。','Scan with this AI account’s mobile QQ and confirm on your phone.')){notice.remove();continue;}
      notice.classList.add('qq-login-notice');content.append(notice);
    }
    if(!cards.length){
      const empty=el('div','qq-login-empty');empty.append(el('h2','',current.configured?tr('添加一个 QQ 账号','Add a QQ account'):tr('先准备 QQ','Set up QQ first')),el('p','',current.configured?tr('为搭档准备独立账号，再完成登录。','Prepare a separate account for your companion, then sign in.'):tr('使用已有程序，或准备独立运行组件。','Use an installed program or prepare separate runtime components.')));
      if(current.configured&&add){const create=el('button','primary',tr('添加 QQ 账号','Add a QQ account'));create.disabled=busy||current.desktopRunning;create.onclick=()=>{addOpen=true;add.open=true;document.getElementById('qq-runtime-add-id')?.focus();};empty.append(create);}
      else if(window.arcade.qqFirstSetup){const setup=el('button','primary',tr('准备 QQ','Set up QQ'));setup.onclick=()=>window.openQQFirstSetup?.();empty.append(setup);}
      content.append(empty);
    }
    for(const card of cards){
      const id=card.dataset.accountId,item=current.instances.find(row=>row.accountId===id),state=item.login?.state||(item.processRunning||item.canSettleOrphanInspection===true?'unknown':'stopped');
      const identity=card.querySelector('.qq-runtime-identity'),status=card.querySelector('.qq-runtime-state'),actions=card.querySelector('.qq-runtime-actions'),qr=card.querySelector('.qq-runtime-qr');
      const originalChildren=[...card.children];card.replaceChildren();
      const head=el('div','qq-login-detail-head');if(identity){const image=identity.querySelector('img');if(image){const crop=el('span','qq-login-avatar-crop');image.replaceWith(crop);crop.append(image);}head.append(identity);}if(status)head.append(status);
      const more=el('details','qq-login-more');more.open=loginMoreOpen.get(id)===true;more.ontoggle=()=>{if(more.isConnected)loginMoreOpen.set(id,more.open);};const moreSummary=el('summary','',tr('更多','More'));moreSummary.id=`qq-login-more-${id}`;more.append(moreSummary);const moreBody=el('div','qq-login-more-body');more.append(moreBody);head.append(more);card.append(head);
      const stage=el('div','qq-login-stage'),main=el('div','qq-login-primary'),secondary=el('div','qq-login-secondary'),links=el('div','qq-login-links');
      const advanced=el('details','qq-login-advanced');advanced.open=loginAdvancedOpen.get(id)===true;advanced.ontoggle=()=>{if(advanced.isConnected)loginAdvancedOpen.set(id,advanced.open);};const advancedSummary=el('summary','',tr('连接与运行详情','Connection and runtime details'));advancedSummary.id=`qq-login-details-${id}`;advanced.append(advancedSummary);const advancedBody=el('div','qq-login-advanced-body');advanced.append(advancedBody);
      const allButtons=[...(actions?.querySelectorAll(':scope > button')||[])];
      const find=method=>allButtons.find(b=>b.dataset.runtimeAction===method);
      const start=find('qqRuntimeStart'),stop=find('qqRuntimeStop'),recover=find('qqRuntimeRecover'),show=find('qqRuntimeQR'),qrs=allButtons.filter(b=>b.dataset.runtimeAction==='qqRuntimeQR'),refreshQR=qrs[1],saved=find('qqRuntimeQuickLogin'),diagnose=find('qqRuntimeLogs');
      let primary=null,title=label(state),copy='';
      if(inspectionSettled(item.accountId)){title=tr('上次检查已收尾','The inspection is settled');copy=tr('刷新状态，继续核对 QQ。','Refresh the state to continue checking QQ.');}
      else if(item.canSettleOrphanInspection===true){title=tr('收尾上次检查','Settle previous inspection');copy=tr('完成这次检查的收尾，其他搭档继续运行。','Finish this inspection while other companions keep running.');}
      else if(originalChildren.some(node=>node.classList.contains('qq-orphan-controls'))){title=tr('检查上次 QQ 运行','Inspect the previous QQ runtime');copy=tr('先核实残留进程，再决定是否清理。','Verify the remaining processes before deciding whether to clear them.');}
      else if(item.canRecover){primary=recover;title=tr('恢复这个 QQ 的管理','Recover this QQ account');copy=current.configured===false&&current.installationKind==='managed-shell'&&item.canStart===false&&['pending_upstream_update','pending_update_recovery_required'].includes(item.reason)?tr('核实并接管已有进程，不会启动 QQ 或确认登录。','Verify and take over existing processes without starting QQ or confirming sign-in.'):tr('核实上次运行后，继续使用原有登录。','Verify the previous runtime before continuing with its saved login.');}
      else if(!item.processRunning&&item.canStart){primary=start;title=tr('启动 QQ','Start QQ');copy=tr('启动后会检查现有登录。需要时再扫码。','The saved sign-in will be checked after startup. Scan only if needed.');}
      else if(state==='login_required'&&item.processRunning){primary=qr?refreshQR:show;title=tr('登录 QQ','Sign in to QQ');copy=tr('用这个账号的手机 QQ 扫码','Scan with this account’s mobile QQ');}
      else if(state==='online'){title=tr('QQ 已登录','QQ is signed in');copy=tr('聊天账号已在线。AI 连接单独确认。','The chat account is online. AI connection is checked separately.');primary=allButtons.find(b=>b.id===`qq-ai-connect-${id}`)||allButtons.find(b=>b.id===`qq-ai-open-${id}`&&!b.disabled);}
      else if(state==='initializing'){title=tr('正在确认登录','Confirming sign-in');copy=tr('请完成手机上的确认，稍后查看最新状态。','Complete confirmation on your phone, then check the latest state.');}
      else if(state==='reconnecting'){title=tr('正在恢复连接','Restoring the connection');copy=tr('先等待当前恢复，不重复启动。','Wait for the current recovery before starting again.');}
      else {title=state==='offline'?tr('QQ 暂时离线','QQ is offline'):tr('核对当前状态','Check the current state');copy=tr('尚未确认需要重新登录。先刷新查看结果。','A new sign-in has not been confirmed necessary. Refresh to check.');primary=button(tr('刷新状态','Refresh status'),'qqRuntimeRefresh');}
      stage.append(el('h3','',title),el('p','qq-login-instruction',copy));
      if(qr&&state==='login_required')stage.append(qr);
      if(primary&&(!primary.disabled||primary.id===`qq-ai-connect-${id}`)){primary.className='primary';main.append(primary);}stage.append(main);
      if(saved&&!saved.disabled&&state==='login_required'){saved.className='plain';secondary.append(saved);}stage.append(secondary);
      if(stop&&!stop.disabled)moreBody.append(stop);
      if(diagnose){diagnose.className='plain';links.append(diagnose);}
      for(const node of allButtons){
        if([primary,start,stop,recover,show,refreshQR,saved,diagnose].includes(node))continue;
        if(node.disabled){advancedBody.append(node);continue;}
        node.classList.remove('primary');node.classList.add('plain');links.append(node);
      }
      // Exceptional legacy capabilities remain available, without competing with
      // the one foreground state action. Hidden/disabled controls are not fake.
      for(const node of [start,recover,show,refreshQR,saved])if(node&&node!==primary&&node.parentElement!==secondary&&!node.disabled)advancedBody.append(node);
      const visibleReasons=new Set([item.login?.issue,item.reason].filter(code=>code&&!['desktop_running','external_process'].includes(code)).map(issue));
      for(const node of originalChildren){
        if([identity,status,actions,qr].includes(node))continue;
        if(node.classList.contains('problem')||visibleReasons.has(node.textContent)){stage.append(node);continue;}
        if(node.classList.contains('qq-orphan-controls')){if(!node.querySelector('.qq-orphan-preview'))node.querySelector('button')?.classList.replace('secondary','primary');stage.append(node);continue;}
        advancedBody.append(node);
      }
      if(qr&&state!=='login_required')advancedBody.append(qr);
      if(!moreBody.children.length)more.hidden=true;
      card.append(stage,links,advanced);content.append(card);
    }
    heading.remove();toolbar.remove();grid.remove();shell.append(side,content);section.append(shell);
  }
  window.renderQQRuntime=next=>{
    if(latest?.accounts?.selectedId!==next.accounts?.selectedId){if(latest){clearOrphanPreviews();accountRevision++;}diagnosticReport=null;logsScope=null;}
    latest=next;const nextLanguage=next.config?.language||'en';if(nextLanguage!==language){feedback='';failed=false;aiFeedback.clear();}language=nextLanguage;navText.textContent=compact.textContent=tr('QQ 账号','QQ accounts');nav.title=navText.textContent;nav.setAttribute('aria-label',navText.textContent);nav.hidden=compact.hidden=window.arcade?.platform?.managedQQ===false||!(next.qqRuntime?.instances?.length||next.bot?.channel==='qq'||typeof document!=='undefined'&&document.body?.dataset.view==='qq-runtime'); // ordinary QQ is optional: shown once an account exists or the page is open; never where local QQ management does not exist (macOS, Linux)
    if(next.qqRuntime)acceptState(next.qqRuntime);else invalidateAIIntents(null);
    window.renderQQSSQQClient?.({runtime:next.qqRuntime,accounts:next.accounts,language});
    window.renderQQPluginAdmin?.({runtime:next.qqRuntime,accounts:next.accounts,language});
    window.renderQQPluginPackage?.({runtime:next.qqRuntime,accounts:next.accounts,language});
    window.renderQQRemote?.({accounts:next.accounts,language});
    if(conversationOpening&&!conversationOpening.current())conversationOpening.invalidated=true;
    drawChanged();syncPolling();
    window.renderQQDirectory?.({runtime:cached,accounts:latest?.accounts,language});
    window.renderQQFriendRequests?.({accounts:latest?.accounts,runtime:cached,language});
    window.renderQQSelfProfile?.({accounts:latest?.accounts,runtime:cached,language});
    window.renderQQOwnerHistory?.({accounts:latest?.accounts,runtime:cached,language});
    window.renderQQComponents?.({runtime:cached,state:latest?.qqComponents,language,selectedCompanionId:latest?.accounts?.selectedId});
    window.renderQQFirstSetup?.({runtime:cached,language,selectedCompanionId:latest?.accounts?.selectedId});
    if(view==='qq-runtime'&&!started&&window.arcade.qqRuntimeRefresh){started=true;void run('qqRuntimeRefresh');}
  };
  if(data)window.renderQQRuntime(data);
})();
