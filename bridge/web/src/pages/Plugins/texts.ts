/** 插件 page copy. zh / en / ja, English otherwise — same rule as the 接入应用 page dozen
 * lines up (pages/Apps/texts.ts) and the library page (Setup/texts.ts libraryTexts). */

export interface PluginTexts {
  title: string
  subtitle: string
  refresh: string
  loading: string
  loadFailed: string
  empty: string
  emptyHint: string
  noDSH: string
  configureTitle: string
  configureHint: string
  configureOpen: string
  installTitle: string
  installHint: string
  installPlaceholder: string
  install: string
  /** first step: describe the spec (source, version, permissions) before anything runs */
  inspect: string
  inspecting: string
  confirmInstall: string
  confirmHint: string
  sourceLabel: string
  versionLabel: string
  publisherLabel: string
  compatLabel: string
  compatOk: string
  compatNo: string
  compatUnchecked: string
  permissionsLabel: string
  bundleYes: string
  bundleNo: string
  registryMiss: string
  /** a non-registry source needs this tick before the install button unlocks */
  nonRegistryWarn: string
  nonRegistryAck: string
  writesOff: string
  installing: string
  installed: string
  installedNoLayer: string
  installFailed: (why: string) => string
  specEmpty: string
  stateOn: string
  stateOff: string
  stateMissing: string
  stateShipped: string
  statePlain: string
  errFilesMissing: string
  errInvalidJSON: string
  on: string
  off: string
  restartNote: string
  shippedNote: string
  rowsTitle: (n: number) => string
  rowOff: string
  rowOn: string
  /** 每一行插件自己的 config：在面板里读出来、改完存回 profile 的 patch */
  rowConfig: string
  configHint: string
  configSecrets: string
  configSave: string
  configSaving: string
  configCancel: string
  configSaved: string
  configEmpty: string
  configNoneYet: string
  configFromBundle: string
  configFromProfile: string
  details: string
  failurePnpm: string
  failureNotFound: string
  failureNoVersion: string
  failureNetwork: string
  failurePermission: string
  failureDisk: string
  failureBuild: string
  failureIncompatible: string
  failureIntegrity: string
  failureTimeout: string
  failureUnknown: string
  switchFailed: string
}

const zh: PluginTexts = {
  configureTitle: '配置已装插件',
  configureHint: '打开 DSH 后，点左侧「插件」，选择插件，编辑并保存配置。配置表单由插件提供；未提供表单的插件需按其说明配置。',
  configureOpen: '打开 DSH 配置插件',
  title: '插件',
  subtitle: '这页管的是 DSH 自己那份 profile：已经装了哪些插件、开没开、装个新的。跟 DSH 侧栏的「插件」读写同一份文件，两边看到的一样。',
  refresh: '刷新',
  loading: '正在读 DSH 的 profile…',
  loadFailed: '读不到插件状态',
  empty: '这份 profile 还没有插件',
  emptyHint: '在下面填包名装一个；DSH 自己的面板层由安装自带，不算在这里。',
  noDSH: '这台电脑没找到 dsh，先装 DSH（npm i -g @deepseek-ai/dsh@latest）才能装插件。',
  installTitle: '装一个插件',
  installHint: '填 npm 包名或「包名@版本」，装完要重启一次 DSH 才会加载。',
  installPlaceholder: '@scope/plugin 或 plugin@1.2.3',
  install: '安装',
  inspect: '检查来源',
  inspecting: '正在查…',
  confirmInstall: '确认安装',
  confirmHint: '装之前先看清这三样：包从哪来、跟这份 DSH 合不合、装上后能做什么。',
  sourceLabel: '来源',
  versionLabel: '版本',
  publisherLabel: '发布者',
  compatLabel: 'DSH 兼容',
  compatOk: '符合这份 DSH',
  compatNo: '不符合这份 DSH，装上去也不会被加载',
  compatUnchecked: '这里没核对（版本范围写法这里不解析），装的时候 DSH 会核',
  permissionsLabel: '装上后能做',
  bundleYes: '声明了 dsh.bundle，DSH 会把它当插件层加载',
  bundleNo: '没声明 dsh.bundle：装得上，但 DSH 不会当插件加载',
  registryMiss: 'registry 这次没读成功。仍然可以装，装不上的原因是 pnpm 的原话。',
  nonRegistryWarn: '这不是 npm registry 的包：内容不是 registry 发布的那一份，来源和内容都没法在这里核对。只在你确知这个地址是什么的时候继续。',
  nonRegistryAck: '我知道这个地址是什么，继续。',
  writesOff: '管理 API 没设 token，这页只能看：装插件和开关插件都要先设 management token。',
  installing: '正在安装…',
  installed: '装好了，重启 DSH 后生效。',
  installedNoLayer: '装上了，但这个包没有声明 dsh.bundle，DSH 不会把它当插件加载。',
  installFailed: (why) => `没装成：${why}`,
  specEmpty: '先填要装的包名。',
  stateOn: '已启用',
  stateOff: '已停用',
  stateMissing: '文件缺失',
  stateShipped: 'DSH 自带',
  statePlain: '不是插件包',
  errFilesMissing: '文件不在了，重装一次这个插件。',
  errInvalidJSON: '这个包的 package.json 坏了，重装一次。',
  on: '启用',
  off: '停用',
  restartNote: '改了启用状态，重启 DSH 后生效。',
  shippedNote: '这一层是 DSH 面板自带的，停掉就没有界面了，所以这里不提供开关。',
  rowsTitle: (n) => `这个插件带来 ${n} 项`,
  rowOff: '已停用',
  rowOn: '',
  rowConfig: '配置',
  configHint: '这一行自己的配置，原样是 YAML；存回的是这份 profile 的 patch，改完重启 DSH 生效。留空保存就恢复插件默认。',
  configSecrets: '密钥显示为已设置占位（!bothouse/secret），保留原样会保留当前值；替换整个占位可设置新值，填空字符串或删除字段可清除。带锚点或别名的值也会隐藏。',
  configSave: '保存配置',
  configSaving: '正在存…',
  configCancel: '取消',
  configSaved: '已保存，重启 DSH 后生效。',
  configEmpty: '这段是空的：留空保存会删掉这里的覆盖，恢复插件默认。',
  configNoneYet: '这一行没配过东西，用的是插件自己的默认值。在这儿存的就是它整段 config。',
  configFromBundle: '现在的值来自插件自带的 patch。在这儿保存是整段替换这一行的 config，不是逐字段合并：框里没有的字段就没了。',
  configFromProfile: '现在的值来自这份 profile 的 patch，就是在这儿存的。',
  details: '安装日志',
  failurePnpm: '找不到 pnpm。先 npm i -g pnpm，或者在 DSH 的插件页里装。',
  failureNotFound: 'npm 上没有这个包（或这个版本），检查包名拼写。',
  failureNoVersion: '这个包没有你要的版本，换一个版本或去掉版本号。',
  failureNetwork: '连不上 npm。检查网络或代理后再试。',
  failurePermission: '没有写权限（profile 目录或 npm 缓存）。检查目录权限后再试。',
  failureDisk: '磁盘满了，清出空间再试。',
  failureBuild: '依赖里的构建脚本被 pnpm 拦下了。在 DSH 插件页里允许构建后再装。',
  failureIncompatible: '这个插件声明的要求跟这份 DSH 对不上，DSH 拒绝安装（怕崩或者坏数据）。装它要求的 DSH 版本，或者换一个兼容的插件版本。',
  failureIntegrity: '下到的包校验不对（可能是代理或镜像改过内容），换网络再试。',
  failureTimeout: '安装超时了。网络慢时先在终端跑一次 dsh plugin add，再来这里看状态。',
  failureUnknown: '装失败了，下面是 pnpm 的原始输出。',
  switchFailed: '改启用状态失败',
}

const en: PluginTexts = {
  configureTitle: 'Configure installed plugins',
  configureHint: 'Open DSH, choose Plugins in the sidebar, then select a plugin to edit and save its settings. Forms are provided by plugins; plugins without a form follow their own setup instructions.',
  configureOpen: 'Open DSH to configure plugins',
  title: 'Plugins',
  subtitle: 'This page manages the DSH profile itself: what is installed, what is switched on, and installing something new. It reads and writes the same files as DSH’s own Plugins page, so both show the same thing.',
  refresh: 'Refresh',
  loading: 'Reading the DSH profile…',
  loadFailed: 'Could not read the plugin state',
  empty: 'No plugin in this profile yet',
  emptyHint: 'Install one by package name below; the DSH panel layers ship with the installation and are not listed here.',
  noDSH: 'dsh is not on this machine. Install DSH (npm i -g @deepseek-ai/dsh@latest) before installing plugins.',
  installTitle: 'Install a plugin',
  installHint: 'A package name or name@version. DSH loads it after one restart.',
  installPlaceholder: '@scope/plugin or plugin@1.2.3',
  install: 'Install',
  inspect: 'Check source',
  inspecting: 'Checking…',
  confirmInstall: 'Install it',
  confirmHint: 'Before it runs, see three things: where the package comes from, whether it fits this DSH, and what it may do once loaded.',
  sourceLabel: 'Source',
  versionLabel: 'Version',
  publisherLabel: 'Publisher',
  compatLabel: 'DSH compatibility',
  compatOk: 'fits this DSH',
  compatNo: "does not fit this DSH; it would not be loaded",
  compatUnchecked: 'not checked here (this range form is left to DSH), DSH checks it at install',
  permissionsLabel: 'What it may do',
  bundleYes: 'declares dsh.bundle, so DSH loads it as a plugin layer',
  bundleNo: 'no dsh.bundle: it installs, but DSH never loads it as a plugin',
  registryMiss: 'The registry read failed this time. The install can still be tried; pnpm will say why if it fails.',
  nonRegistryWarn: 'This is not an npm registry package: the bytes are not the ones the registry published, so neither the source nor the contents can be checked here. Continue only if you know what that address is.',
  nonRegistryAck: 'I know what that address is; continue.',
  writesOff: 'The management API has no token, so this page is read-only: installing and switching need one.',
  installing: 'Installing…',
  installed: 'Installed. Restart DSH to load it.',
  installedNoLayer: 'Installed, but the package declares no dsh.bundle, so DSH will not load it as a plugin.',
  installFailed: (why) => `Install failed: ${why}`,
  specEmpty: 'Type the package to install first.',
  stateOn: 'On',
  stateOff: 'Off',
  stateMissing: 'Files missing',
  stateShipped: 'Ships with DSH',
  statePlain: 'Not a plugin',
  errFilesMissing: 'Its files are gone. Reinstall it.',
  errInvalidJSON: 'Its package.json is damaged. Reinstall it.',
  on: 'Turn on',
  off: 'Turn off',
  restartNote: 'Changed. Restart DSH for it to take effect.',
  shippedNote: 'This layer ships with the DSH panel; switching it off would remove the UI, so there is no switch here.',
  rowsTitle: (n) => `This plugin brings ${n} item${n === 1 ? '' : 's'}`,
  rowOff: 'off',
  rowOn: '',
  rowConfig: 'Configure',
  configHint: 'This row’s own config, as YAML. Saving writes this profile’s patch; it takes effect after a DSH restart. Save empty to go back to the plugin’s default.',
  configSecrets: 'Secrets appear as set placeholders (!bothouse/secret). Leave them unchanged to keep the current value, replace the whole placeholder to set a new value, or use an empty string or remove the field to clear it. Anchored values and aliases are hidden too.',
  configSave: 'Save config',
  configSaving: 'Saving…',
  configCancel: 'Cancel',
  configSaved: 'Saved; takes effect after a DSH restart.',
  configEmpty: 'This is empty: saving it removes the override here and goes back to the plugin’s default.',
  configNoneYet: 'Nothing is set for this row; it runs on the plugin’s own defaults.',
  configFromBundle: 'The current value comes from the plugin’s own patch. Saving here replaces this row’s whole config — it is not merged field by field, so a field you leave out is gone.',
  configFromProfile: 'The current value comes from this profile’s patch — that is what saving here writes.',
  details: 'Install log',
  failurePnpm: 'pnpm was not found. Run npm i -g pnpm, or install from DSH’s own Plugins page.',
  failureNotFound: 'npm has no such package (or version). Check the spelling.',
  failureNoVersion: 'That version does not exist. Pick another one or drop the version.',
  failureNetwork: 'Could not reach npm. Check the network or proxy and retry.',
  failurePermission: 'No write permission (profile directory or npm cache). Check the permissions and retry.',
  failureDisk: 'The disk is full. Free some space and retry.',
  failureBuild: 'pnpm blocked a dependency’s build script. Allow builds in DSH’s Plugins page, then retry.',
  failureIncompatible: 'This plugin declares requirements this DSH does not satisfy, so DSH refused to install it (crash or data-loss risk). Install the DSH version it asks for, or a compatible plugin version.',
  failureIntegrity: 'The downloaded package failed its integrity check (a proxy or mirror altered it). Retry on another network.',
  failureTimeout: 'The install timed out. On a slow network, run dsh plugin add in a terminal once, then come back for the state.',
  failureUnknown: 'The install failed; pnpm’s own output is below.',
  switchFailed: 'Could not change the switch',
}

const ja: PluginTexts = {
  configureTitle: 'インストール済みプラグインの設定',
  configureHint: 'DSH を開き、左側の「プラグイン」で対象を選んで設定を編集・保存します。設定フォームは各プラグインが提供します。フォームがない場合はプラグインの説明に従ってください。',
  configureOpen: 'DSH でプラグインを設定',
  title: 'プラグイン',
  subtitle: 'このページは DSH 自身の profile を管理します。何が入っているか、有効か、新しく入れるか。DSH 側の「プラグイン」ページと同じファイルを読み書きするので、表示は一致します。',
  refresh: '更新',
  loading: 'DSH の profile を読んでいます…',
  loadFailed: 'プラグインの状態を読めません',
  empty: 'この profile にはまだプラグインがありません',
  emptyHint: '下の欄にパッケージ名を入れて入れてください。DSH のパネル層は製品に同梱されます。',
  noDSH: 'この PC に dsh が見つかりません。先に DSH を入れてください（npm i -g @deepseek-ai/dsh@latest）。',
  installTitle: 'プラグインを入れる',
  installHint: 'npm のパッケージ名か「名前@バージョン」。DSH を一度再起動すると読み込まれます。',
  installPlaceholder: '@scope/plugin または plugin@1.2.3',
  install: 'インストール',
  inspect: '入手元を確認',
  inspecting: '確認中…',
  confirmInstall: 'インストールする',
  confirmHint: '実行前に三つを確認してください：どこから来るか、この DSH に合うか、入れた後に何ができるか。',
  sourceLabel: '入手元',
  versionLabel: 'バージョン',
  publisherLabel: '公開したアカウント',
  compatLabel: 'DSH 互換性',
  compatOk: 'この DSH に適合',
  compatNo: 'この DSH に適合しません。入れても読み込まれません',
  compatUnchecked: 'ここでは照合していません（この範囲表記は DSH がインストール時に確認します）',
  permissionsLabel: '入れた後にできること',
  bundleYes: 'dsh.bundle を宣言しているので、DSH はプラグイン層として読み込みます',
  bundleNo: 'dsh.bundle がないため、入っても DSH はプラグインとして読み込みません',
  registryMiss: '今回は registry を読めませんでした。インストールは試せます。失敗したら pnpm の出力が理由です。',
  nonRegistryWarn: 'これは npm registry のパッケージではありません。registry が公開した内容と同一か確認できないため、入手元も中身もここでは照合できません。そのアドレスが何か分かっている場合だけ続けてください。',
  nonRegistryAck: 'このアドレスが何か分かっています。続行します。',
  writesOff: '管理 API に token がないため、このページは閲覧のみです。インストールと切り替えには token が必要です。',
  installing: 'インストール中…',
  installed: '入りました。DSH を再起動すると有効になります。',
  installedNoLayer: '入りましたが dsh.bundle を宣言していないため、DSH はプラグインとして読み込みません。',
  installFailed: (why) => `入りませんでした：${why}`,
  specEmpty: '入れるパッケージ名を先に入力してください。',
  stateOn: '有効',
  stateOff: '無効',
  stateMissing: 'ファイル欠落',
  stateShipped: 'DSH 同梱',
  statePlain: 'プラグインではない',
  errFilesMissing: 'ファイルがありません。入れ直してください。',
  errInvalidJSON: 'package.json が壊れています。入れ直してください。',
  on: '有効にする',
  off: '無効にする',
  restartNote: '変更しました。DSH を再起動すると反映されます。',
  shippedNote: 'この層は DSH のパネルに同梱されています。無効にすると画面自体が消えるため、ここに切り替えはありません。',
  rowsTitle: (n) => `このプラグインが持つ項目：${n}`,
  rowOff: '無効',
  rowOn: '',
  rowConfig: '設定',
  configHint: 'この行自身の設定です。中身はそのまま YAML で、保存するとこの profile の patch に書き込みます。DSH の再起動後に反映されます。空で保存するとプラグイン既定に戻ります。',
  configSecrets: '秘密情報は設定済みの印（!bothouse/secret）で表示します。そのまま保存すると現在値を保持し、印全体を新しい値に置き換えると更新します。空文字列または項目の削除で消去します。アンカーや別名の値も非表示です。',
  configSave: '設定を保存',
  configSaving: '保存中…',
  configCancel: 'キャンセル',
  configSaved: '保存しました。DSH の再起動後に反映されます。',
  configEmpty: '空です。空で保存するとここの上書きを消し、プラグイン既定に戻します。',
  configNoneYet: 'この行は何も設定されておらず、プラグイン既定で動いています。',
  configFromBundle: '今の値はプラグイン同梱の patch 由来です。ここで保存するとこの行の config を丸ごと置き換えます（項目ごとのマージではありません）。書かなかった項目は消えます。',
  configFromProfile: '今の値はこの profile の patch 由来で、ここで保存したものです。',
  details: 'インストールログ',
  failurePnpm: 'pnpm が見つかりません。npm i -g pnpm を実行するか、DSH のプラグイン画面から入れてください。',
  failureNotFound: 'npm にそのパッケージ（またはバージョン）がありません。名前を確認してください。',
  failureNoVersion: 'そのバージョンはありません。別のバージョンにするか、バージョンを外してください。',
  failureNetwork: 'npm に接続できません。ネットワークかプロキシを確認して再試行してください。',
  failurePermission: '書き込み権限がありません（profile ディレクトリか npm キャッシュ）。権限を確認してください。',
  failureDisk: 'ディスクがいっぱいです。空けてから再試行してください。',
  failureBuild: '依存のビルドスクリプトが pnpm に止められました。DSH のプラグイン画面で許可してから再試行してください。',
  failureIncompatible: 'このプラグインの要求はこの DSH を満たさないため、DSH がインストールを拒否しました（クラッシュやデータ破損の恐れ）。指定された DSH 版か、互換のあるプラグイン版を入れてください。',
  failureIntegrity: 'ダウンロードしたパッケージの検証が合いません（プロキシやミラーが内容を変えた可能性）。別の回線で再試行してください。',
  failureTimeout: 'インストールがタイムアウトしました。遅い回線では端末で一度 dsh plugin add を実行し、ここで状態を確認してください。',
  failureUnknown: 'インストールに失敗しました。下は pnpm の生の出力です。',
  switchFailed: '有効・無効の切り替えに失敗しました',
}

const TEXTS: Record<string, PluginTexts> = { zh, en, ja };
export const pluginTexts = (lang: string): PluginTexts => TEXTS[(lang || '').toLowerCase().split('-')[0]] ?? en;

/** The readable line for a failed install, keyed by the classifier kind the API sent. */
export function failureText(T: PluginTexts, kind?: string): string {
  switch (kind) {
    case 'pnpm-missing': return T.failurePnpm;
    case 'not-found': return T.failureNotFound;
    case 'no-matching-version': return T.failureNoVersion;
    case 'network': return T.failureNetwork;
    case 'permission': return T.failurePermission;
    case 'disk-full': return T.failureDisk;
    case 'build-blocked': return T.failureBuild;
    case 'incompatible': return T.failureIncompatible;
    case 'integrity': return T.failureIntegrity;
    case 'timeout': return T.failureTimeout;
    default: return T.failureUnknown;
  }
}
/** The readable line for a row whose files could not be read (the API sends a code, not prose). */
export function rowErrorText(T: PluginTexts, code?: string): string {
  if (code === 'files-missing') return T.errFilesMissing;
  if (code === 'invalid-json') return T.errInvalidJSON;
  return code || '';
}
