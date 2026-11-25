'use strict';
(() => {
  if (window.arcade?.platform?.os !== 'darwin') return;

  const setup = $('bot-qq-mac-setup'), first = $('bot-qq-mac-first');
  const manual = el('details', 'bot-help'), summary = el('summary');
  manual.id = 'bot-qq-manual';
  manual.append(summary, $('bot-qq-connection-fields'), $('bot-qq-identity-fields'));
  const advanced = manual.querySelector('#bot-qq-advanced'), title = $('bot-qq-mac-title'), nodeChoice = $('bot-qq-mac-with-node');
  const account = $('bot-qq-mac-account'), port = $('bot-qq-mac-port'), status = $('bot-qq-mac-status');
  const portSuggestion = $('bot-qq-mac-port-suggestion'), usePort = $('bot-qq-mac-use-port');
  const usePrepared = $('bot-qq-mac-use-prepared'), owner = manual.querySelector('#bot-qq-owner');
  const inspectWithNode = $('bot-qq-mac-inspect-with-node');
  const launch = name => $('bot-qq-mac-launch' + (name ? '-' + name : ''));
  setup.classList.add('qq-setup-part');
  setup.insertBefore(manual, first);
  for (const item of document.querySelectorAll('[data-qq-windows]')) item.hidden = true;
  const methods = {inspect:'botQQMacInspect', prepare:'botQQMacPrepare', release:'botQQMacOpenRelease', use:'botQQMacUsePrepared'};
  const launchMethods = {status:'botQQMacLaunchStatus', reveal:'botQQMacLaunchReveal', copy:'botQQMacLaunchCopy',
    relink:'botQQMacLaunchRelink', auth:'botQQMacLaunchAuth'};
  const ready = [methods.inspect, methods.prepare, methods.release].every(name => typeof window.arcade[name] === 'function');
  const canUsePrepared = typeof window.arcade[methods.use] === 'function';
  const canShowLaunch = Object.values(launchMethods).every(name => typeof window.arcade[name] === 'function');
  const launchStates = {ready:'launchReady', missing:'launchMissing', changed:'launchChanged', unlinked:'launchUnlinked', locked:'launchLocked'};
  const authStates = {missing:'launchAuthMissing', present:'launchAuthPresent', unverified:'launchAuthUnverified'};
  const retryableNodeErrors = new Set(['node_not_executable', 'node_version_unverified', 'node_signature_unverified']);
  const messages = {
    title: ['在 Mac 上连接 QQ 群聊', 'Connect QQ group chat on Mac'],
    intro: ['可接入现有 OneBot 桥接。首次准备 LLBot 需要 Apple Silicon Mac。', 'Use an existing OneBot connection, or prepare LLBot on an Apple Silicon Mac.'],
    existing: ['使用已有 OneBot 桥接', 'Use an existing OneBot connection'],
    address: ['OneBot 地址与 Token', 'OneBot address and token'],
    first: ['首次准备 LLBot', 'Prepare LLBot for the first time'],
    download: ['打开 LLBot v8.3.2 官方发布页，下载 macOS arm64 CLI 压缩包并解压到新文件夹。LLBot 独立于 App。', 'Open the official LLBot v8.3.2 release, download its macOS arm64 CLI archive and extract it to a new folder. LLBot runs separately from the app.'],
    release: ['打开 LLBot v8.3.2 发布页', 'Open LLBot v8.3.2 release'],
    withNode: ['另外选择已签名的 Apple Silicon Node.js 24 或更新版本', 'Select a separate signed Apple Silicon Node.js 24 or later'],
    node: ['默认检查压缩包内的 Node。如果无法核验或运行，可以选择来自 Node.js 官方发行版的可执行文件。', 'Leave unchecked to use the bundled Node. If it cannot be verified or run, select a separate executable from the official Node.js distribution.'],
    inspect: ['选择解压后的 LLBot 文件夹并检查', 'Choose extracted LLBot folder and inspect'],
    retryWithNode: ['改用已签名的 Node.js 重新检查', 'Retry with signed Node.js'],
    account: ['搭档专用 QQ 号', 'Dedicated companion QQ number'],
    accountNote: ['填写专门给搭档使用的账号。只接收你的私聊时，主人填写你自己的 QQ 号。', 'Use the account you intend to dedicate to the companion. Your own QQ number is the private-chat owner.'],
    port: ['本机 OneBot 端口（1024–65535）', 'Local OneBot port (1024–65535)'],
    suggestedPort: ['建议端口 {port}。按其他搭档已保存的本机连接计算，系统端口是否空闲需另行核对。', 'Suggested port {port}, based on other companions’ saved local connections. Check OS port availability separately.'],
    usePort: ['改用建议端口 {port}', 'Use suggested port {port}'],
    preparePortConflict: ['另一位搭档已保存此端口。请选择其他端口，再准备配置。', 'Another companion’s saved local connection uses this port. Choose a different port, then prepare again.'],
    usePortConflict: ['另一位搭档已保存此端口。请重新检查后选择其他端口，并在新目录准备配置。', 'Another companion’s saved local connection uses this port. Inspect again, choose a different port and prepare in a new folder.'],
    prepare: ['选择一个新目录并准备私有配置', 'Choose a new private folder and prepare'],
    ready: ['已准备私有 OneBot 配置', 'Private OneBot configuration prepared'],
    saved: ['OneBot 连接已保存', 'OneBot connection saved'],
    folder: ['目录', 'Folder'],
    endpoint: ['OneBot 地址', 'OneBot address'],
    config: ['配置文件', 'Configuration file'],
    token: ['私有 Token 文件', 'Private token file'],
    saveNote: ['为当前搭档保存地址、搭档 QQ 号和 Token，保留已设置的私聊主人。', 'Save the address, companion QQ number and token for the current companion. The private-chat owner stays as configured.'],
    usePrepared: ['在 Agent Arcade 中保存此连接', 'Save this connection in Agent Arcade'],
    showExisting: ['打开 OneBot 手动连接字段', 'Show manual OneBot connection fields'],
    limits: ['准备时只写入新目录。启动桥接、QQ 登录和签名服务授权由你另行完成。桥接运行后，先点「测试连接」，再启用群聊。', 'Preparation writes to the new folder. Start the bridge, sign in to QQ and authorize the signing service separately. Once the bridge is running, use Test connection before enabling group chat.'],
    unavailable: ['此版本暂不能准备 LLBot。仍可接入已有 OneBot 桥接。', 'This build cannot prepare LLBot. You can still use an existing OneBot connection.'],
    inspecting: ['等待选择并检查 LLBot 文件…', 'Waiting for folder selection and LLBot inspection…'],
    preparing: ['等待选择新目录并写入配置…', 'Waiting for a new folder and preparing configuration…'],
    saving: ['正在保存当前搭档的 OneBot 连接…', 'Saving the current companion’s OneBot connection…'],
    savedPending: ['连接已保存，正在等待设置刷新。', 'Connection saved. Waiting for settings to refresh.'],
    savedOwner: ['连接已保存。填写你自己的 QQ 号并保存。桥接运行后，点「测试连接」。', 'Connection saved. Enter your own QQ number and save it. Once the bridge is running, use Test connection.'],
    savedTest: ['连接已保存。桥接运行后，点「测试连接」核对账号。', 'Connection saved. Once the bridge is running, use Test connection to check the account.'],
    launchTitle: ['LLBot 启动指引', 'LLBot startup guide'],
    launchReady: ['此搭档的准备目录和启动方案可用。启动与登录需要手动完成。', 'This companion’s preparation folder and startup plan are available. Start LLBot and sign in manually.'],
    launchMissing: ['找不到已关联的准备目录或启动方案。若移动或重命名过，请恢复到上方显示的原位置，再点「重新检查文件」。', 'The linked preparation folder or startup plan is missing. If you moved or renamed it, restore the original location shown above, then choose Check files again.'],
    launchChanged: ['已关联的准备文件发生变化。请核对文件后重新选择准备目录。', 'The linked preparation files changed. Check the files and select the preparation folder again.'],
    launchUnlinked: ['此连接尚未关联 LLBot 准备目录。若之前在 App 中准备过，可以选回原目录。', 'This connection has no linked LLBot preparation folder. If you prepared it in the app before, you can select that folder.'],
    launchLocked: ['系统凭据暂不可用。请先在此搭档的连接设置中恢复凭据访问。', 'System credentials are unavailable. Restore credential access in this companion’s connection settings first.'],
    launchVerify: ['核实完整的 LLBot 官方归档，并查看 macOS 的安全提示。', 'Verify the complete official LLBot archive and review macOS security prompts.'],
    launchAuthorization: ['将签名服务授权保存为此目录的 data/auth_token.txt，设置为仅当前 Mac 用户可读写（0600）。OneBot Token 单独保存。', 'Save the signing-service authorization as data/auth_token.txt in this folder. Set it to read/write for your Mac user only (0600). Keep the OneBot token separate.'],
    launchTerminal: ['复制启动命令，打开「终端」手动执行。按 LLBot 提示登录搭档专用 QQ。', 'Copy the startup command and run it yourself in Terminal. Follow LLBot’s prompts to sign in to the dedicated QQ account.'],
    launchTest: ['返回 Agent Arcade，点「测试连接」核对搭档 QQ 号。若提示未找到好友关系，先互加好友，再测试连接。之后核对并保存数字群号。', 'Return to Agent Arcade and choose Test connection to verify the companion’s QQ number. If the accounts are not friends, add each other and test again. Then check and save the numeric group ID.'],
    launchAuthMissing: ['尚未找到签名服务授权文件。', 'The signing-service authorization file is missing.'],
    launchAuthPresent: ['已找到签名服务授权文件。授权是否有效由 LLBot 确认。', 'The signing-service authorization file is present. LLBot checks whether it is valid.'],
    launchAuthUnverified: ['暂时无法核对签名服务授权文件。请确认只有当前 Mac 用户可读写（0600），再重新检查。', 'The signing-service authorization file could not be checked. Make sure only your Mac user can read or write it (0600), then check again.'],
    launchReveal: ['在 Finder 中显示', 'Show in Finder'],
    launchCopy: ['复制启动命令', 'Copy startup command'],
    launchAuth: ['打开签名服务说明', 'Open signing-service instructions'],
    launchRelink: ['选择现有准备目录', 'Choose existing preparation folder'],
    launchRefresh: ['重新检查文件', 'Check files again'],
    launchGoOwner: ['填写你的 QQ 号', 'Enter your QQ number'],
    launchGoTest: ['前往测试连接', 'Go to Test connection'],
    launchGoFriendCheck: ['前往复查 QQ 好友关系', 'Go to recheck QQ friendship'],
    launchGoGroup: ['前往填写群号', 'Go to group numbers'],
    launchChecking: ['正在检查此搭档的准备文件…', 'Checking this companion’s preparation files…'],
    launchRelinking: ['等待选择此搭档的准备目录…', 'Waiting for this companion’s preparation folder…'],
    launchUnavailable: ['暂时无法读取启动指引。', 'The startup guide is temporarily unavailable.'],
    launchRelinkFailed: ['无法关联这个目录。请选择为此搭档准备的原目录，并核对连接设置。', 'Could not link that folder. Choose the original folder prepared for this companion and check the connection settings.'],
    launchActionFailed: ['操作未完成，请重新检查准备文件。', 'The action did not complete. Check the preparation files again.'],
    launchCopied: ['已复制启动命令。请在「终端」手动执行。', 'Startup command copied. Run it yourself in Terminal.'],
    launchLinked: ['已关联此搭档的准备目录。', 'This companion’s preparation folder was linked.'],
    warning: ['已验证你另外选择的 Node。压缩包内的 Node 签名未核实。', 'The separately selected Node was verified. The bundled Node signature could not be verified.'],
    cancelled: ['已取消，操作未继续。', 'Cancelled. The operation did not continue.'],
    wrongAccount: ['填写 5–15 位搭档 QQ 号，并与保存的主人 QQ 号区分。', 'Enter the companion’s 5–15 digit QQ number. Use a different number from the saved owner.'],
    wrongPort: ['请输入 1024–65535 范围内的整数端口。', 'Enter an integer port between 1024 and 65535.'],
    releaseFailed: ['暂时无法打开 LLBot 发布页。', 'Could not open the LLBot release page.'],
    unsupported_platform: ['所检查的 LLBot 版本仅支持 Apple Silicon Mac。仍可在这里接入已有 OneBot。', 'The inspected LLBot release requires Apple Silicon. You can still use an existing OneBot connection.'],
    changed: ['当前搭档或连接已变化。请重新检查 LLBot 文件夹。', 'The companion or connection changed. Inspect the LLBot folder again.'],
    invalid_request: ['无法识别本次准备请求。请重开设置后重试。', 'The setup request was invalid. Reopen settings and try again.'],
    operation_in_progress: ['上一项操作还未完成，请稍候。', 'The previous operation is still finishing. Please wait.'],
    stale_ticket: ['检查结果已失效。请重新选择并检查 LLBot 文件夹。', 'The inspection expired. Select and inspect the LLBot folder again.'],
    unsafe_path: ['请输入本机原始目录或文件路径。请避开符号链接。', 'Choose an original local folder or file. Avoid symbolic links.'],
    runtime_incomplete: ['没有找到所需文件。请选择完整解压后的 LLBot v8.3.2 macOS arm64 CLI 文件夹。', 'Required files were missing. Choose the fully extracted LLBot v8.3.2 macOS arm64 CLI folder.'],
    runtime_changed: ['文件与固定的 LLBot v8.3.2 发行版不一致。请核对下载并重新解压。', 'The files differ from the pinned LLBot v8.3.2 release. Verify the download and extract it again.'],
    runtime_signature_unverified: ['无法核验 LLBot 组件签名。请核对官方归档后重试。', 'LLBot component signatures could not be verified. Check the official archive and try again.'],
    node_signature_unverified: ['无法核验 Node 签名。可另外选择已签名的 Apple Silicon 官方 Node.js。', 'The Node signature could not be verified. You can choose a separately signed Apple Silicon Node.js release.'],
    node_not_executable: ['选定的 Node 没有执行权限。可以改用已签名的 Apple Silicon 官方 Node.js 24 或更新版本。', 'The selected Node lacks execute permission. You can retry with a signed Apple Silicon Node.js 24 or later from the official distribution.'],
    node_version_unverified: ['未能核对选定 Node 的版本。请改用已签名的 Apple Silicon 官方 Node.js 24 或更新版本重试。', 'The selected Node could not report a verified version. Retry with a signed Apple Silicon Node.js 24 or later from the official distribution.'],
    target_exists: ['该目录已经存在。请选择一个尚未创建的新目录。', 'That folder already exists. Choose a new folder that has not been created.'],
    invalid_configuration: ['请核对搭档 QQ 号和本机端口。', 'Check the companion’s QQ number and local port.'],
    preparation_failed: ['操作未完成。请检查选择的文件夹后重试。', 'The operation did not complete. Check the selected folder and try again.'],
    stale_preparation: ['此次准备结果已失效。重新检查并准备新目录，或打开手动连接字段。', 'This preparation expired. Inspect and prepare a new folder, or open the manual connection fields.'],
    prepared_configuration_changed: ['准备后的文件已变动。重新检查并准备新目录，或打开手动连接字段。', 'The prepared files changed. Inspect and prepare a new folder, or open the manual connection fields.'],
    existing_connection: ['此搭档已有另一条 OneBot 连接。请在手动连接字段中核对已有设置，或切到另一位搭档。', 'This companion already has a different OneBot connection. Review it in the manual connection fields, or switch to another companion.'],
    save_failed: ['连接未能保存。请重试，或打开手动连接字段。', 'The connection could not be saved. Try again or open the manual connection fields.'],
    credentials_locked: ['系统凭据存储暂不可用。解锁后再保存此连接。', 'System credential storage is unavailable. Unlock it before saving this connection.'],
    credentials_busy: ['正在处理另一项凭据操作。稍候再保存此连接。', 'Another credential operation is in progress. Wait for it to finish, then save this connection.'],
  };

  let focusPending = false, nodeRetryAvailable = false, recommendedPort = null, portEdited = false;
  let latest, language = 'en', scope = '', revision = 0, operation = null, checked = null, result = null, feedback = '';
  let launchScope, launchStatus, launchRequest, launchOperation, launchFeedback = '';
  const currentLanguage = () => language === 'zh' ? 0 : 1;
  const tr = key => messages[key]?.[currentLanguage()] || '';
  const portText = key => tr(key).replace('{port}', String(recommendedPort));
  const visible = () => latest?.bot?.channel === 'qq';
  const offline = () => latest?.bot?.status === 'disconnected';
  const validAccount = value => /^[1-9]\d{4,14}$/.test(value) && value !== latest?.bot?.qq?.ownerId;
  const validPort = value => Number.isInteger(value) && value >= 1024 && value <= 65535;
  const normalPath = value => typeof value === 'string' && value.startsWith('/') && value.length <= 4096 && !/[\p{Cc}\p{Cf}]/u.test(value);
  const validCheck = value => typeof value.ticketId === 'string' && /^[0-9a-f-]{36}$/i.test(value.ticketId) &&
    value.release === '8.3.2' && /^v(?:2[4-9]|[3-9]\d|\d{3,})\.\d+\.\d+$/.test(value.nodeVersion) && value.filesChecked === 4 &&
    [null, 'bundled_node_rejected_explicit_node_override'].includes(value.warning) && validPort(value.recommendedPort);
  function validResult(value, input) {
    return value.prepared === true && value.endpoint === 'ws://127.0.0.1:' + input.port + '/' && normalPath(value.targetDirectory) &&
      [value.configFile, value.tokenFile].every(file => normalPath(file) && file.startsWith(value.targetDirectory + '/')) &&
      (!canUsePrepared || value.accountId === input.accountId && typeof value.preparedId === 'string' &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.preparedId));
  }
  function matchesSaved() {
    const qq = latest?.bot?.qq;
    return qq?.hasToken && qq.url === result?.endpoint && qq.expectedAccountId === result?.accountId;
  }
  function finishSaved() {
    if (operation || !result?.saved || !result.handoff || !offline() || !matchesSaved()) return;
    window.applyPreparedQQConnection?.({endpoint:result.endpoint, accountId:result.accountId, ownerDraft:result.handoff.ownerDraft});
    result.handoff = null;
    const hasOwner = !!latest.bot.qq.ownerId;
    feedback = hasOwner ? 'savedTest' : 'savedOwner';
    if (view === 'bot' && $('bot-setup-panel').open) {
      focusConnectionField(hasOwner ? $('bot-qq-test') : owner);
    }
  }
  function launchNext() {
    const qq = latest?.bot?.qq;
    if (!qq?.ownerId) return {control:owner, label:'launchGoOwner'};
    if (qq.check?.state === 'checked' && qq.check.accountId === qq.expectedAccountId) {
      if (qq.check.ownerIsFriend === false) return {control:$('bot-qq-test'), label:'launchGoFriendCheck'};
      return {control:$('bot-qq-group-ids'), label:'launchGoGroup'};
    }
    return {control:$('bot-qq-test'), label:'launchGoTest'};
  }
  function paintLaunch() {
    const state = launchStatus?.state, available = state === 'ready';
    const recovering = ['missing', 'changed', 'unlinked'].includes(state);
    const busy = !!launchOperation || !!launchRequest;
    const folder = launchStatus?.targetDirectory || '';
    launch().hidden = !launchScope || (!Object.hasOwn(launchStates, state) && state !== 'unavailable' && !launchRequest);
    launch().dataset.state = state === 'locked' || state === 'missing' || state === 'changed' ? 'attention' : 'empty';
    launch('state').textContent = tr(launchRequest ? 'launchChecking' : launchStates[state] || 'launchUnavailable');
    launch('account').textContent = launchScope?.accountId || '';
    launch('location').hidden = !folder;
    launch('folder').textContent = folder;
    launch('instructions').hidden = !available;
    launch('authorization').textContent = tr(authStates[launchStatus?.authorization] || 'launchAuthUnverified');
    for (const method of ['reveal', 'copy', 'auth', 'relink', 'refresh']) {
      const button = launch(method);
      button.hidden = method === 'relink' ? !recovering : method !== 'refresh' && !available;
      button.disabled = busy || !!operation || (method === 'relink' || method === 'copy') && !offline() ||
        method === 'copy' && launchStatus?.authorization !== 'missing' && launchStatus?.authorization !== 'present';
    }
    const next = launchNext();
    launch('next').textContent = tr(next.label);
    launch('next').hidden = !available;
    launch('next').disabled = next.control.disabled;
    launch('feedback').textContent = tr(launchOperation?.method === 'relink' ? 'launchRelinking' : launchFeedback);
  }
  async function refreshLaunch(afterSave = false) {
    const selected = launchScope;
    if (!selected || launchOperation || launchRequest && !afterSave) return;
    const request = launchRequest = {selected};
    const current = () => launchScope === selected && launchRequest === request;
    paintLaunch();
    try {
      const response = await window.arcade[launchMethods.status]({profileId:selected.profileId});
      if (!current()) return;
      if (response?.ok !== true || ![...Object.keys(launchStates), 'not_configured'].includes(response.state)) {
        launchStatus = {state:'unavailable'};
        return;
      }
      launchStatus = {state:response.state};
      if (['ready','missing','changed'].includes(response.state) && normalPath(response.targetDirectory)) {
        launchStatus.targetDirectory = response.targetDirectory;
      }
      if (Object.hasOwn(authStates, response.authorization)) launchStatus.authorization = response.authorization;
    } catch {
      if (current()) launchStatus = {state:'unavailable'};
    } finally {
      if (launchRequest === request) launchRequest = null;
      paintLaunch();
    }
  }
  function updateLaunchScope() {
    const profileId = latest?.accounts?.selectedId, qq = latest?.bot?.qq, accountId = qq?.expectedAccountId;
    const key = canShowLaunch && visible() && typeof profileId === 'string' && validAccount(accountId || '') &&
      (qq.hasToken || latest.bot.credentialState === 'locked')
      ? JSON.stringify([profileId, accountId, qq.url, qq.hasToken, latest.bot.credentialState]) : '';
    if (key === (launchScope?.key || '')) return;
    launchScope = key ? {key, profileId, accountId} : null;
    launchStatus = launchRequest = launchOperation = null;
    launchFeedback = '';
    void refreshLaunch();
  }
  async function launchAction(method) {
    const selected = launchScope, button = launch(method);
    if (!selected || operation || launchOperation || launchRequest || button.disabled || button.hidden) return;
    const action = launchOperation = {method};
    launchFeedback = '';
    paint();
    try {
      const response = await window.arcade[launchMethods[method]]({profileId:selected.profileId});
      if (launchScope !== selected) return;
      if (response?.ok !== true) launchFeedback = method === 'relink' ? 'launchRelinkFailed' : 'launchActionFailed';
      else if (response.cancelled) launchFeedback = 'cancelled';
      else if (method === 'copy') launchFeedback = 'launchCopied';
      else if (method === 'relink') launchFeedback = 'launchLinked';
    } catch {
      if (launchScope === selected) launchFeedback = method === 'relink' ? 'launchRelinkFailed' : 'launchActionFailed';
    } finally {
      if (launchOperation === action) launchOperation = null;
      if (launchScope === selected) void refreshLaunch();
      paint();
    }
  }
  function paint() {
    setup.hidden = !visible();
    const locked = !ready || !offline() || !!operation || !!launchOperation;
    nodeChoice.disabled = locked;
    for (const id of ['bot-qq-mac-inspect', 'bot-qq-mac-prepare']) $(id).disabled = locked;
    inspectWithNode.hidden = !nodeRetryAvailable;
    inspectWithNode.disabled = locked;
    $('bot-qq-mac-release').disabled = !ready || !!operation;
    account.disabled = port.disabled = locked;
    $('bot-qq-mac-inputs').hidden = !checked;
    portSuggestion.hidden = !checked || recommendedPort === null;
    portSuggestion.textContent = portSuggestion.hidden ? '' : portText('suggestedPort');
    usePort.hidden = portSuggestion.hidden || port.valueAsNumber === recommendedPort;
    usePort.disabled = locked;
    usePort.textContent = usePort.hidden ? '' : portText('usePort');
    const check = $('bot-qq-mac-checked');
    check.hidden = !checked;
    if (checked) {
      const {release, nodeVersion, filesChecked, warning} = checked;
      const summary = language === 'zh'
        ? '已检查 LLBot v' + release + ' 的 ' + filesChecked + ' 个固定入口文件 · Node ' + nodeVersion + '。'
        : 'Checked ' + filesChecked + ' pinned entry files for LLBot v' + release + ' · Node ' + nodeVersion + '.';
      check.textContent = summary + (warning ? ' ' + tr('warning') : '');
    } else check.textContent = '';
    $('bot-qq-mac-result').hidden = !result;
    $('bot-qq-mac-result-title').textContent = tr(result?.saved ? 'saved' : 'ready');
    usePrepared.hidden = $('bot-qq-mac-save-note').hidden = !canUsePrepared || !result?.preparedId || !!result.saved;
    usePrepared.disabled = locked;
    for (const [id, value] of Object.entries({account:result?.accountId,folder:result?.targetDirectory,endpoint:result?.endpoint,config:result?.configFile,token:result?.tokenFile})) {
      $('bot-qq-mac-result-' + id).textContent = value || '';
    }
    const statusText = !ready ? tr('unavailable') : operation?.action === 'inspect' ? tr('inspecting') :
      operation?.action === 'prepare' ? tr('preparing') : operation?.action === 'use' ? tr('saving') : tr(feedback);
    status.textContent = feedback === 'usePortConflict' && recommendedPort !== null ? statusText + ' ' + portText('suggestedPort') : statusText;
    paintLaunch();
  }
  function focusConnectionField(field) {
    if (manual.contains(field)) manual.open = true;
    field.scrollIntoView({block: 'center', behavior: 'auto'});
    field.focus({preventScroll: true});
  }
  function showExisting() {
    advanced.open = true;
    focusConnectionField($('bot-qq-url'));
  }
  async function run(action, reuseRuntime = false) {
    if (!ready || !visible() || operation || launchOperation || (action !== 'release' && !offline())) return;
    let input;
    if (action === 'inspect') input = {withNode: nodeChoice.checked, ...(reuseRuntime ? {reuseRuntime:true} : {})};
    if (action === 'prepare') {
      if (!checked) return;
      const accountId = account.value.trim(), selectedPort = port.valueAsNumber;
      const invalid = !validAccount(accountId) ? account : !validPort(selectedPort) ? port : null;
      if (invalid) {
        feedback = invalid === account ? 'wrongAccount' : 'wrongPort';
        invalid.setAttribute('aria-invalid', 'true'); invalid.focus(); paint(); return;
      }
      input = {ticketId: checked.ticketId, accountId, port: selectedPort};
    }
    if (action === 'use') {
      if (!canUsePrepared || !result?.preparedId || result.saved) return;
      input = {preparedId: result.preparedId};
      result.handoff = {ownerDraft:owner.value};
    }
    const active = {action, revision}; operation = active; feedback = ''; paint();
    const current = () => revision === active.revision && visible();
    try {
      const response = await window.arcade[methods[action]](input);
      if (!current()) return;
      if (response?.ok !== true) {
        if (response?.code === 'port_in_use' && (action === 'prepare' || action === 'use')) {
          recommendedPort = validPort(response.recommendedPort) ? response.recommendedPort : null;
          feedback = action === 'prepare' ? 'preparePortConflict' : 'usePortConflict';
          if (action === 'use') result.preparedId = null;
          return;
        }
        feedback = action === 'release' ? 'releaseFailed' : Object.hasOwn(messages, response?.code)
          ? response.code : action === 'use' ? 'save_failed' : 'preparation_failed';
        if (action === 'inspect' && response?.code !== 'operation_in_progress') {
          checked = null;
          nodeRetryAvailable = retryableNodeErrors.has(response?.code);
        }
        if (['stale_ticket', 'changed', 'runtime_changed'].includes(response?.code)) checked = null;
        if (action === 'use' && ['stale_preparation', 'prepared_configuration_changed', 'changed'].includes(response?.code)) {
          result.preparedId = null;
        }
        return;
      }
      if (response.cancelled) { feedback = 'cancelled'; return; }
      if (action === 'inspect') {
        nodeRetryAvailable = false;
        if (!validCheck(response)) { checked = null; feedback = 'preparation_failed'; return; }
        checked = response; result = null;
        recommendedPort = response.recommendedPort;
        if (!portEdited || !validPort(port.valueAsNumber)) {
          port.value = String(recommendedPort);
          portEdited = false;
          port.removeAttribute('aria-invalid');
        }
      }
      if (action === 'prepare') {
        checked = null;
        if (!validResult(response, input)) { feedback = 'preparation_failed'; return; }
        const {targetDirectory, endpoint, configFile, tokenFile, preparedId} = response;
        result = {targetDirectory, endpoint, configFile, tokenFile, preparedId, accountId:input.accountId};
      }
      if (action === 'use') {
        if (response.saved !== true) { feedback = 'save_failed'; return; }
        result.saved = true;
        feedback = 'savedPending';
        void refreshLaunch(true);
      }
    } catch {
      if (current()) feedback = action === 'release' ? 'releaseFailed' : action === 'use' ? 'save_failed' : 'preparation_failed';
    } finally {
      operation = null; finishSaved(); paint();
      if (current() && view === 'bot' && $('bot-setup-panel').open && first.open &&
          ['preparePortConflict', 'usePortConflict'].includes(feedback)) {
        status.scrollIntoView({block:'nearest', behavior:'auto'});
      }
    }
  }

  $('bot-qq-mac-inspect').onclick = () => void run('inspect');
  $('bot-qq-mac-prepare').onclick = () => void run('prepare');
  $('bot-qq-mac-release').onclick = () => void run('release');
  $('bot-qq-mac-show-existing').onclick = showExisting;
  usePrepared.onclick = () => void run('use');
  for (const method of ['reveal', 'copy', 'relink', 'auth']) launch(method).onclick = () => void launchAction(method);
  launch('refresh').onclick = () => {launchFeedback = ''; void refreshLaunch();};
  launch('next').onclick = () => {
    const {control} = launchNext();
    if (launchStatus?.state === 'ready' && !control.disabled) focusConnectionField(control);
  };
  inspectWithNode.onclick = () => { nodeChoice.checked = true; void run('inspect', true); };
  usePort.onclick = () => {
    if (usePort.disabled || usePort.hidden) return;
    port.value = String(recommendedPort);
    portEdited = true;
    port.removeAttribute('aria-invalid');
    if (feedback === 'preparePortConflict') feedback = '';
    port.focus(); paint();
  };
  owner.addEventListener('input', () => { if (result?.handoff) result.handoff.ownerDraft = owner.value; });
  nodeChoice.onchange = () => { checked = null; feedback = ''; paint(); };
  account.oninput = () => account.removeAttribute('aria-invalid');
  port.oninput = () => {
    port.removeAttribute('aria-invalid');
    portEdited = true;
    paint();
  };

  function focusMacSetup() {
    if (!focusPending || !visible()) return;
    focusPending = false;
    if (!ready || latest.bot.qq?.hasToken || view !== 'bot' || !$('bot-setup-panel').open) return;
    title.scrollIntoView({block: 'start', behavior: 'auto'});
    title.focus({preventScroll: true});
  }
  const open = window.openConversationSetup;
  window.openConversationSetup = value => {
    if (value?.mediaIssue) return open(value);
    open(value);
    focusPending = value?.section === 'qq-groups';
    focusMacSetup();
    if (value?.section === 'qq-groups') void refreshLaunch();
  };
  const previous = window.renderBot;
  window.renderBot = next => {
    previous?.(next);
    latest = next; language = next.config?.language === 'zh' ? 'zh' : 'en';
    summary.textContent = tr('existing');
    advanced.querySelector('summary').textContent = tr('address');
    for (const item of setup.querySelectorAll('[data-qq-mac]')) item.textContent = tr(item.dataset.qqMac);
    const nextScope = JSON.stringify([next.accounts?.selectedId, next.bot?.channel, next.bot?.mode, next.bot?.status]);
    if (nextScope !== scope) {
      scope = nextScope; revision++; checked = null; result = null; feedback = ''; nodeRetryAvailable = false;
      account.value = ''; port.value = ''; nodeChoice.checked = false;
      recommendedPort = null; portEdited = false;
      for (const input of [account, port]) input.removeAttribute('aria-invalid');
    }
    if (result?.saved && !result.handoff && !matchesSaved()) {
      result = null; feedback = '';
    }
    updateLaunchScope();
    finishSaved(); paint(); focusMacSetup();
  };
  if (typeof data !== 'undefined' && data) window.renderBot(data);
})();
