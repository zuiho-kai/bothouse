/** 功能开关页 (#1861) copy. zh / en / ja like the 闸门设置 page (Gate/texts.ts); English otherwise.
 * The switches' own names and descriptions come from the bridge's registry. */

export interface FeatureTexts {
  title: string
  subtitle: string
  refresh: string
  loading: string
  loadFailed: string
  globalTitle: string
  globalHint: string
  rolesTitle: string
  rolesHint: string
  switchCol: string
  on: string
  off: string
  defaultOn: string
  defaultOff: string
  needsRestart: string
  pending: string
  pendingBanner: (n: number) => string
  saved: string
  savedRestart: string
  saveFailed: string
  reloadError: string
  inverted: string
}

const zh: FeatureTexts = {
  title: '功能开关',
  subtitle: '桥里所有能开能关的功能都在这一页。点一下就写进配置；角色被问到某个功能开没开，看的也是这张表。',
  refresh: '重新读一遍',
  loading: '正在读开关…',
  loadFailed: '读不到开关',
  globalTitle: '全局',
  globalHint: '对所有角色都生效。',
  rolesTitle: '各角色',
  rolesHint: '每个角色各管各的，一列一个角色。',
  switchCol: '功能',
  on: '开',
  off: '关',
  defaultOn: '默认开',
  defaultOff: '默认关',
  needsRestart: '改后要重启',
  pending: '待重启',
  pendingBanner: (n) => `有 ${n} 项已经写进配置，但运行中的桥还是旧值，重启桥以后才生效（系统页右上角可以重启）。`,
  saved: '已保存，马上生效。',
  savedRestart: '已保存。这一项要重启桥以后才生效。',
  saveFailed: '没存上',
  reloadError: '配置存上了，但运行中的角色没读进去：',
  inverted: '配置里反着写',
}

const en: FeatureTexts = {
  title: 'Feature switches',
  subtitle: 'Every feature of the bridge that can be turned on or off. A click writes config.toml; a role asked whether a feature is on reads this same list.',
  refresh: 'Reload',
  loading: 'Reading the switches…',
  loadFailed: 'Could not read the switches',
  globalTitle: 'Global',
  globalHint: 'Apply to every role.',
  rolesTitle: 'Per role',
  rolesHint: 'Each role has its own; one column per role.',
  switchCol: 'Feature',
  on: 'On',
  off: 'Off',
  defaultOn: 'default on',
  defaultOff: 'default off',
  needsRestart: 'needs a restart',
  pending: 'restart pending',
  pendingBanner: (n) => `${n} switch${n === 1 ? ' is' : 'es are'} written to config.toml but the running bridge still has the old value: restart it to apply (System page, top right).`,
  saved: 'Saved, in effect now.',
  savedRestart: 'Saved. This one takes effect after a restart.',
  saveFailed: 'Not saved',
  reloadError: 'Saved, but the running roles did not reload:',
  inverted: 'inverted in config',
}

const ja: FeatureTexts = {
  title: '機能スイッチ',
  subtitle: 'ブリッジのオン・オフできる機能はすべてこのページにあります。クリックすると設定に書き込まれ、ロールが機能の状態を聞かれたときも同じ一覧を見ます。',
  refresh: '再読み込み',
  loading: 'スイッチを読み込み中…',
  loadFailed: 'スイッチを読み込めません',
  globalTitle: '全体',
  globalHint: 'すべてのロールに適用されます。',
  rolesTitle: 'ロールごと',
  rolesHint: 'ロールごとに別々です。1 列が 1 ロール。',
  switchCol: '機能',
  on: 'オン',
  off: 'オフ',
  defaultOn: '既定オン',
  defaultOff: '既定オフ',
  needsRestart: '変更後は再起動が必要',
  pending: '再起動待ち',
  pendingBanner: (n) => `${n} 件は設定に書き込み済みですが、動作中のブリッジは古い値のままです。再起動後に有効になります（システムページ右上）。`,
  saved: '保存しました。すぐ有効です。',
  savedRestart: '保存しました。再起動後に有効になります。',
  saveFailed: '保存できません',
  reloadError: '保存しましたが、動作中のロールが再読み込みできません：',
  inverted: '設定では逆に書く',
}

const all: Record<string, FeatureTexts> = { zh, en, ja }

/** Copy for the 功能开关 page; unknown languages get English. */
export const featureTexts = (lang: string): FeatureTexts => all[(lang || '').toLowerCase().split('-')[0]] ?? en
