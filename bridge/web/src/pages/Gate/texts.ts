/** 闸门设置页 (#217) copy. zh / en / ja follow the 接入应用 page's rule (Apps/texts.ts):
 * the three languages the panel ships copy for, English otherwise. */

export interface GateTexts {
  title: string
  subtitle: string
  refresh: string
  loading: string
  loadFailed: string
  save: string
  saving: string
  saved: string
  savedRestart: string
  saveFailed: string
  nothingChanged: string
  modeTitle: string
  modeQuestion: string
  modeSmart: string
  modeSmartHint: string
  modeAddressed: string
  modeAddressedHint: string
  modeOff: string
  modeOffHint: string
  modeMixed: string
  modeMixedHint: string
  botsTitle: string
  botsHint: string
  joinGate: string
  nowSmart: string
  nowAddressed: string
  nowOff: string
  onlyLead: string
  leadBadge: string
  listens: string
  hearsAll: string
  hearsAddressed: string
  customGate: string
  customGateHint: string
  restartNeeded: string
  reloadError: string
  serviceTitle: string
  statusRunning: string
  statusStarting: string
  statusOff: string
  statusPythonMissing: string
  statusPythonTooOld: string
  start: string
  starting: string
  started: string
  startFailed: string
  startNotManaged: string
  jevTitle: string
  jevHint: string
  jevURL: string
  jevKey: string
  jevModel: string
  jevTest: string
  jevTesting: string
  jevOK: string
  jevFail: string
  jevSave: string
  jevSaved: string
  jevInUse: string
  jevNoKey: string
  jevNeedTest: string
}

const zh: GateTexts = {
  title: '闸门设置',
  subtitle: '改谁在什么时候接话，不用重装。选一种方式、打开要参与的角色，存下就生效。',
  refresh: '重新读一遍',
  loading: '正在读闸门配置…',
  loadFailed: '读不到闸门配置',
  save: '保存并生效',
  saving: '正在保存…',
  saved: '存好了，已经在起作用。',
  savedRestart: '存好了；标出来的几项要重启才生效。',
  saveFailed: '没存上',
  nothingChanged: '跟现在一样，不用存。',
  modeTitle: '谁在什么时候接话',
  modeQuestion: '选一种就行，三个按钮任选一个：',
  modeSmart: '智能判断',
  modeSmartHint: '每条消息先问一下小模型该谁回：没人点名时由主角色兜底，所以不会没人接话。',
  modeAddressed: '只在被叫到时回',
  modeAddressedHint: '只有被 @ 或被点名才回，其余消息一律不理。不用模型，也不会有角色抢话。',
  modeOff: '关掉',
  modeOffHint: '不判断、不兜底：群里没人点名时谁都不回，各角色按平台原来的设置走。',
  modeMixed: '现在各个角色不一样',
  modeMixedHint: '下面的角色有的开、有的关。选一个按钮会统一改上面勾着的角色。',
  botsTitle: '哪些角色参与',
  botsHint: '勾上的按上面选的方式接话；取消勾选等于把这个角色的闸门关掉。',
  joinGate: '参与闸门',
  nowSmart: '现在：智能判断',
  nowAddressed: '现在：只在被叫到时回',
  nowOff: '现在：关着',
  onlyLead: '只在被叫到时回',
  leadBadge: '主角色',
  listens: '接话范围',
  hearsAll: '群里都会看到',
  hearsAddressed: '只看到有人 @ 或点名它的消息',
  customGate: '自己接的闸门',
  customGateHint: '这个角色的 gate_url 是手写的，关掉时不动它，只记一笔。',
  restartNeeded: '这几项要重启才生效：',
  reloadError: '配置写好了，但热加载报错（重启一次就好）：',
  serviceTitle: '闸门服务',
  statusRunning: '在跑',
  statusStarting: '正在启动',
  statusOff: '没在跑',
  statusPythonMissing: '缺 Python 3.12',
  statusPythonTooOld: 'Python 版本太旧',
  start: '一键启动',
  starting: '正在启动…',
  started: '起来了。',
  startFailed: '没起来',
  startNotManaged: '当前进程没管这个闸门，请用启动 cc-connect 的方式把它带起来。',
  jevTitle: '判断用的模型 API',
  jevHint: '智能判断要一个能返回概率的模型。先测试，通了才能存：存一个不能用的模型不如不存。',
  jevURL: 'Base URL',
  jevKey: 'Key',
  jevModel: '模型',
  jevTest: '测试',
  jevTesting: '测试中…',
  jevOK: '能用。',
  jevFail: '不能用',
  jevSave: '存下',
  jevSaved: '存好了。',
  jevInUse: '正在用',
  jevNoKey: '没填 Key',
  jevNeedTest: '先测试通了再存。',
}

const en: GateTexts = {
  title: 'Gate settings',
  subtitle: 'Change who answers when, without reinstalling. Pick a way, tick the roles that take part, save — it applies at once.',
  refresh: 'Reload',
  loading: 'Reading gate settings…',
  loadFailed: 'Could not read the gate settings',
  save: 'Save and apply',
  saving: 'Saving…',
  saved: 'Saved, and already in effect.',
  savedRestart: 'Saved; the keys listed need a restart to take effect.',
  saveFailed: 'Not saved',
  nothingChanged: 'Same as now — nothing to save.',
  modeTitle: 'Who answers, and when',
  modeQuestion: 'Pick one of the three:',
  modeSmart: 'Smart routing',
  modeSmartHint: 'Each message first asks a small model who should answer; when nobody is named the lead takes it, so nothing goes unanswered.',
  modeAddressed: 'Only when addressed',
  modeAddressedHint: 'Answer only when @-mentioned or named; ignore everything else. No model, and no role talks over another.',
  modeOff: 'Off',
  modeOffHint: 'No routing and no fallback: in a group nobody answers unless named, and each role keeps its platform defaults.',
  modeMixed: 'The roles differ right now',
  modeMixedHint: 'Some of the roles below are on, some off. Picking a button applies it to every role you ticked.',
  botsTitle: 'Roles that take part',
  botsHint: 'A ticked role answers the way chosen above; unticking turns its gate off.',
  joinGate: 'Takes part',
  nowSmart: 'Now: smart routing',
  nowAddressed: 'Now: only when addressed',
  nowOff: 'Now: off',
  onlyLead: 'Only when addressed',
  leadBadge: 'lead',
  listens: 'Reaches it',
  hearsAll: 'sees everything in the group',
  hearsAddressed: 'sees only messages that @ it or name it',
  customGate: 'hand-written gate',
  customGateHint: 'This role’s gate_url was written by hand; turning it off leaves it alone and only notes it.',
  restartNeeded: 'These need a restart to take effect:',
  reloadError: 'Config written, but the live reload failed (one restart fixes it):',
  serviceTitle: 'Gate service',
  statusRunning: 'Running',
  statusStarting: 'Starting',
  statusOff: 'Not running',
  statusPythonMissing: 'Python 3.12 missing',
  statusPythonTooOld: 'Python too old',
  start: 'Start it',
  starting: 'Starting…',
  started: 'Up.',
  startFailed: 'Did not start',
  startNotManaged: 'This process does not run the gate for this data dir; start it the way you start cc-connect.',
  jevTitle: 'Model API for routing',
  jevHint: 'Smart routing needs a model that returns probabilities. Test first — it is only saved once the test passes.',
  jevURL: 'Base URL',
  jevKey: 'Key',
  jevModel: 'Model',
  jevTest: 'Test',
  jevTesting: 'Testing…',
  jevOK: 'Works.',
  jevFail: 'Does not work',
  jevSave: 'Save',
  jevSaved: 'Saved.',
  jevInUse: 'In use',
  jevNoKey: 'no key',
  jevNeedTest: 'Test it first, then save.',
}

const ja: GateTexts = {
  title: 'ゲート設定',
  subtitle: '入れ直さずに、誰がいつ答えるかを変えます。方式を選び、参加するロールを入れて保存すればすぐ効きます。',
  refresh: '読み直す',
  loading: 'ゲート設定を読み込み中…',
  loadFailed: 'ゲート設定を読めません',
  save: '保存して反映',
  saving: '保存中…',
  saved: '保存しました。もう効いています。',
  savedRestart: '保存しました。印を付けた項目は再起動で効きます。',
  saveFailed: '保存できません',
  nothingChanged: '今と同じなので保存する必要はありません。',
  modeTitle: '誰がいつ答えるか',
  modeQuestion: '三つのうち一つを選んでください：',
  modeSmart: 'スマート判定',
  modeSmartHint: '各メッセージをまず小型モデルに聞いて誰が答えるか決めます。誰も指名されていない時はメインが受け持つので、無視されません。',
  modeAddressed: '呼ばれた時だけ',
  modeAddressedHint: '@ か指名された時だけ返信し、それ以外は無視します。モデル不要で、ロール同士が割り込みません。',
  modeOff: 'オフ',
  modeOffHint: '判定も受け持ちもしません。グループで指名がなければ誰も答えず、各ロールはプラットフォーム既定のままです。',
  modeMixed: '今はロールごとに違います',
  modeMixedHint: '下のロールはオンとオフが混ざっています。ボタンを選ぶとチェックした全ロールに適用されます。',
  botsTitle: '参加するロール',
  botsHint: 'チェックしたロールは上の方式で答えます。外すとそのロールのゲートはオフになります。',
  joinGate: '参加する',
  nowSmart: '現在：スマート判定',
  nowAddressed: '現在：呼ばれた時だけ',
  nowOff: '現在：オフ',
  onlyLead: '呼ばれた時だけ',
  leadBadge: 'メイン',
  listens: '届く範囲',
  hearsAll: 'グループの全部が見える',
  hearsAddressed: '@ か指名されたメッセージだけ見える',
  customGate: '手書きのゲート',
  customGateHint: 'このロールの gate_url は手書きです。オフにしてもそのまま残し、記録だけ残します。',
  restartNeeded: '再起動で効く項目：',
  reloadError: '設定は書けましたが、ホットリロードでエラー（再起動一回で直ります）：',
  serviceTitle: 'ゲートサービス',
  statusRunning: '稼働中',
  statusStarting: '起動中',
  statusOff: '停止中',
  statusPythonMissing: 'Python 3.12 がありません',
  statusPythonTooOld: 'Python が古い',
  start: '起動する',
  starting: '起動中…',
  started: '起動しました。',
  startFailed: '起動しません',
  startNotManaged: 'このプロセスはこのデータディレクトリのゲートを管理していません。cc-connect の起動方法で立ち上げてください。',
  jevTitle: '判定に使うモデル API',
  jevHint: 'スマート判定には確率を返すモデルが要ります。先にテストし、通ってから保存します。',
  jevURL: 'Base URL',
  jevKey: 'Key',
  jevModel: 'モデル',
  jevTest: 'テスト',
  jevTesting: 'テスト中…',
  jevOK: '使えます。',
  jevFail: '使えません',
  jevSave: '保存',
  jevSaved: '保存しました。',
  jevInUse: '使用中',
  jevNoKey: 'キー無し',
  jevNeedTest: '先にテストを通してから保存してください。',
}

const all: Record<string, GateTexts> = { zh, en, ja }

/** Copy for the 闸门设置 page; unknown languages get English. */
export const gateTexts = (lang: string): GateTexts => all[(lang || '').toLowerCase().split('-')[0]] ?? en
