'use strict';

window.mountAppUpdate = function (tr) {
  const get = name => document.getElementById('app-update-'+name);
  const section = get('panel'), title = get('title'), version = get('version'), status = get('status');
  const check = get('check'), apply = get('apply'), openStore = get('open-store');
  if (!window.arcade?.appUpdateCheck) return () => {};
  const source = get('source'), sourceInfo = get('source-info'), sourceCommit = get('source-commit');
  const sourceSave = get('source-save'), sourceStatus = get('source-status');
  if (source && window.arcade.appReleaseSource) {
    source.hidden = false;
    sourceSave.textContent = tr('保存本版 Windows 源码 ZIP','Save this Windows build’s source ZIP');
    void window.arcade.appReleaseSource().catch(()=>null).then(release => {
      sourceInfo.textContent = release
        ? tr('Windows 客户端源码 · GNU AGPL-3.0 · ','Windows client source · GNU AGPL-3.0 · ')+release.version
        : tr('此包未包含对应源码归档。','This package does not include its source archive.');
      if (!release) return;
      sourceCommit.textContent = release.commit;
      sourceSave.hidden = false;
    });
    sourceSave.addEventListener('click', async () => {
      sourceSave.disabled = true;
      try {
        const result = await window.arcade.appReleaseSourceSave();
        sourceStatus.textContent = result==='saved' ? tr('已保存源码 ZIP。','Source ZIP saved.')
          : result==='cancelled' ? '' : tr('未能保存源码 ZIP。','Could not save the source ZIP.');
      } catch { sourceStatus.textContent = tr('未能保存源码 ZIP。','Could not save the source ZIP.'); }
      finally { sourceSave.disabled = false; }
    });
  }
  let state, clickPending = false, notification = 0;
  function paint() {
    if (!state) return;
    if (state.channel === 'store') {
      const copy = {
        idle: ['', ''],
        test_build: ['此试包没有正式商店身份，暂不能检查商店更新。','This test build has no Microsoft Store identity for updates.'],
        checking: ['正在向 Microsoft Store 检查更新…','Checking Microsoft Store for updates…'],
        current: ['Microsoft Store 当前没有提供新版。','Microsoft Store is not offering an update right now.'],
        available: ['Microsoft Store 有新版。请先保存草稿，安装时应用可能会关闭。','An update is available. Save drafts first. The app may close during installation.'],
        installing: ['请按 Windows 提示确认下载和安装。','Follow the Windows prompts to confirm the download and installation.'],
        completed: ['Microsoft Store 已报告安装完成。重新打开后可查看运行版本。','Microsoft Store reported that installation completed. Reopen the app to check the running version.'],
        cancelled: ['已取消更新。可以继续使用当前版本。','Update canceled. You can keep using this version.'],
        power: ['电量不足，接通电源后可再检查。','Battery is low. Connect to power and check again.'],
        network: ['Microsoft Store 需要合适的网络连接。连上 Wi-Fi 后再检查。','Microsoft Store needs a suitable connection. Connect to Wi-Fi and check again.'],
        unavailable: ['暂时无法在应用内更新。请重试，或到 Microsoft Store 检查。','Updates are temporarily unavailable in the app. Retry or check in Microsoft Store.'],
        store_opened: ['已请求打开商店更新页。请在商店确认或安装更新。','Requested the Store updates page. Check or install updates in Microsoft Store.'],
        store_open_failed: ['无法打开商店更新页。请从开始菜单打开 Microsoft Store，进入更新页。','Could not open Store updates. Open Microsoft Store from Start, then go to updates.'],
      };
      title.textContent = tr('应用更新','App updates');
      version.textContent = tr('当前版本：','Running version: ')+state.current;
      check.textContent = tr('检查更新','Check for updates');
      apply.textContent = tr('下载并安装','Download and install');
      openStore.textContent = tr('打开 Microsoft Store 更新页','Open Microsoft Store updates');
      status.textContent = tr(...(copy[state.status] || copy.unavailable));
      const working = clickPending || ['checking','installing'].includes(state.status);
      check.disabled = working || state.status === 'test_build';
      apply.hidden = !['available','cancelled','installing'].includes(state.status);
      apply.disabled = working;
      openStore.hidden = !['unavailable','power','network','store_opened','store_open_failed'].includes(state.status);
      openStore.disabled = working;
      return;
    }
    const target = state.target?.split('.').at(-1);
    const current = /^.+-preview\.\d+\.personal\.(\d+)$/.exec(state.current);
    title.textContent = tr('应用更新','App updates');
    version.textContent = tr('当前版本：','Running version: ')+(current ? 'RC'+current[1]+' · '+state.current : state.current);
    check.textContent = tr('检查更新','Check for updates');
    apply.textContent = tr('更新并重启','Update and restart');
    const copy = {
      idle: ['', ''],
      checking:['正在核对已交付的版本…','Checking delivered releases…'],
      current:['当前已是本机登记的最新版。','You are on the latest registered local release.'],
      available:['可更新到 RC'+target+'。','RC'+target+' is ready to install.'],
      cancelled:['已取消，继续使用当前版本。','Update cancelled. You can keep using this version.'],
      preparing:['正在重新校验更新包…','Rechecking the update package…'],
      restarting:['正在正常退出，并将在同一档案中打开新版。','Quitting normally, then opening the new version in the same profile.'],
      quit_failed:['退出未完成，更新尚未开始。请查看窗口中的退出提示，再重试。','Quit did not finish. Check the app’s quit message before retrying.'],
      invalid_package:['更新包缺失或校验失败。请等待重新交付，再检查更新。','The package could not be verified. Check again once a replacement is delivered.'],
      changed:['发行登记有变化，请重新检查更新。','The registered release changed. Check for updates again.'],
      busy:['已有一次更新正在准备，请稍后再检查。','An update is already being prepared. Check again shortly.'],
      unavailable:['当前无法从本机日用发行入口更新。确认日用版已交付后再试。','Updates are unavailable through the local daily release entry. Try again after the daily release is delivered.'],
    };
    status.textContent = tr(...(copy[state.status] || copy.unavailable));
    const working = ['checking','preparing','restarting'].includes(state.status) || clickPending;
    check.disabled = working;
    apply.hidden = !state.target || !['available','cancelled','quit_failed','preparing','restarting'].includes(state.status);
    apply.disabled = working;
  }
  async function act(fn) {
    if (clickPending) return;
    clickPending = true;
    paint();
    const revision = notification;
    try {
      const result = await fn();
      if (notification === revision) state = result;
    }
    catch { if (notification === revision) state = {...state,status:'unavailable'}; }
    finally { clickPending = false; paint(); }
  }
  check.addEventListener('click', () => act(() => window.arcade.appUpdateCheck()));
  apply.addEventListener('click', () => act(() => window.arcade.appUpdateStart(state.target)));
  openStore?.addEventListener('click', () => act(() => window.arcade.appUpdateOpenStore()));
  window.arcade.onAppUpdate?.(value => { notification++; state = value; paint(); });
  return initial => {
    if (initial) {
      section.hidden = false;
      state ??= initial;
    }
    paint();
  };
};
