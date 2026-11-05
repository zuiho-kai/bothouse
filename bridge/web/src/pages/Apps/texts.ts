/** 接入应用 page copy. zh / en / ja follow the library page's rule (Setup/texts.ts
 * libraryTexts): the three languages the panel ships copy for, English otherwise. */

export interface AppTexts {
  title: string
  subtitle: string
  refresh: string
  loading: string
  loadFailed: string
  configuredCount: (n: number) => string
  stateEnabled: string
  stateDisabled: string
  stateMissing: string
  add: string
  addAnother: string
  dshConfigure: string
  usedBy: string
  noProjects: string
  dshOwner: string
  resumeWith: string
  qqHint: string
  dshHint: string
  otherHint: string
}

const zh: AppTexts = {
  title: '接入应用',
  subtitle: 'QQ、Discord、飞书这些外面的应用，各接了几个角色、现在开没开，都在这页看；要加就进添加平台。',
  refresh: '刷新',
  loading: '正在读配置…',
  loadFailed: '读不到接入状态',
  configuredCount: (n) => `已接 ${n} 个应用`,
  stateEnabled: '已启用',
  stateDisabled: '已停用',
  stateMissing: '未接入',
  add: '添加',
  addAnother: '再加一个角色',
  dshConfigure: '去配置',
  usedBy: '用在',
  noProjects: '没有角色在用',
  dshOwner: 'DSH 自己就是宿主，不挂在某个角色上',
  resumeWith: '重新打开：',
  qqHint: 'QQ 走本机 NapCat / OneBot 的 WebSocket，接之前先在 NapCat 里开一个 WS 服务器。',
  dshHint: 'DSH 不是聊天平台，是跑插件的宿主；它的插件在 DSH 自己的「插件」页里装、开、停。',
  otherHint: 'Discord 和飞书用各自的机器人凭据；停用只把配置里的段落标成 disabled，凭据和设置都留着。',
}

const en: AppTexts = {
  title: 'Connected apps',
  subtitle: 'QQ, Discord and Feishu from the outside: how many roles each one reaches and whether it is on. Add one through the setup wizard.',
  refresh: 'Refresh',
  loading: 'Reading config…',
  loadFailed: 'Could not read the app states',
  configuredCount: (n) => `${n} app${n === 1 ? '' : 's'} connected`,
  stateEnabled: 'Enabled',
  stateDisabled: 'Disabled',
  stateMissing: 'Not connected',
  add: 'Add',
  addAnother: 'Add another role',
  dshConfigure: 'Configure',
  usedBy: 'Used by',
  noProjects: 'no role uses it',
  dshOwner: 'DSH is the host itself; it does not belong to one role',
  resumeWith: 'Turn it back on with',
  qqHint: 'QQ goes through a local NapCat / OneBot WebSocket; start that WS server in NapCat first.',
  dshHint: 'DSH is not a chat platform but the host that runs plugins; its own Plugins page installs, enables and stops them.',
  otherHint: 'Discord and Feishu use their own bot credentials. Disabling only marks the config section disabled: credentials and options stay.',
}

const ja: AppTexts = {
  title: '接続アプリ',
  subtitle: 'QQ・Discord・飛書などの外部アプリごとに、いくつのロールが使っているか、いま有効かをここで確認します。追加はプラットフォーム追加から。',
  refresh: '更新',
  loading: '設定を読み込み中…',
  loadFailed: '接続状態を読めません',
  configuredCount: (n) => `${n} 件接続済み`,
  stateEnabled: '有効',
  stateDisabled: '停止中',
  stateMissing: '未接続',
  add: '追加',
  addAnother: 'ロールを追加',
  dshConfigure: '設定へ',
  usedBy: '利用',
  noProjects: '利用中のロールなし',
  dshOwner: 'DSH 自身がホストで、特定のロールには属しません',
  resumeWith: '再開するには',
  qqHint: 'QQ はローカルの NapCat / OneBot WebSocket 経由です。先に NapCat で WS サーバーを起動してください。',
  dshHint: 'DSH はチャットプラットフォームではなく、プラグインを動かすホストです。プラグインは DSH 自身の「プラグイン」ページで導入・有効化・停止します。',
  otherHint: 'Discord と飛書はそれぞれのボット認証情報を使います。停止は設定セクションに disabled を付けるだけで、認証情報と設定は残ります。',
}

const all: Record<string, AppTexts> = { zh, en, ja }

/** Copy for the 接入应用 page; unknown languages get English. */
export const appTexts = (lang: string): AppTexts => all[(lang || '').toLowerCase().split('-')[0]] ?? en
