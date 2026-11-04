/** 生图 page copy. zh / en / ja, English otherwise — same rule as pages/Plugins/texts.ts. */

export interface ImageGenTexts {
  title: string
  subtitle: string
  notConfigured: string
  notConfiguredHint: string
  providersHint: string
  restartNote: string
  promptLabel: string
  promptPlaceholder: string
  draw: string
  drawing: string
  drawAgain: string
  costNote: string
  failed: (why: string) => string
  emptySaved: string
  emptySavedHint: string
  recent: string
  fileLabel: string
  copyPath: string
  copied: string
  sendLabel: string
  sendHint: string
  modelLabel: string
  apiKeyMissing: string
}

const zh: ImageGenTexts = {
  title: '生图',
  subtitle: '让配置好的生图服务画一张图，写入本机文件。不会自动发到任何频道。',
  notConfigured: '生图还没配置',
  notConfiguredHint: '在 config.toml 里加上 [image_gen]，填好 API 密钥后重启 bothouse，这个页面就能用了。',
  providersHint: '只支持 OpenAI 兼容的 /images/generations 接口，一次画一张。',
  restartNote: '改完配置要重启 bothouse 才生效（管理面板「系统 → 重启」）。',
  promptLabel: '提示词',
  promptPlaceholder: '例如：一只戴眼镜的橘猫，像素头像，纯色背景',
  draw: '生成一张',
  drawing: '正在画…',
  drawAgain: '再画一张',
  costNote: '每画一张会用掉一次生图 API 调用（可能计费）；上一张没画完时不会再发新的请求。',
  failed: (why) => `生成失败：${why}`,
  emptySaved: '还没有生成过图片',
  emptySavedHint: '画好的图会存在本机目录里，这里能看到最近的几张。',
  recent: '最近生成',
  fileLabel: '文件路径',
  copyPath: '复制路径',
  copied: '已复制',
  sendLabel: '要发出去就自己发',
  sendHint: '这个页面只写文件。决定发给谁之后，用命令发送：',
  modelLabel: '模型',
  apiKeyMissing: '没填 API 密钥，画不了。在 [image_gen.openai] api_key 里填。',
}

const en: ImageGenTexts = {
  title: 'Images',
  subtitle: 'Have the configured image service draw one picture into a local file. Nothing is sent anywhere.',
  notConfigured: 'Image generation is not configured',
  notConfiguredHint: 'Add [image_gen] to config.toml with an API key, restart bothouse, and this page works.',
  providersHint: 'Only OpenAI-compatible /images/generations endpoints are supported; one picture at a time.',
  restartNote: 'Config changes need a restart of bothouse (System → Restart in this panel).',
  promptLabel: 'Prompt',
  promptPlaceholder: 'e.g. an orange cat with glasses, pixel avatar, flat background',
  draw: 'Draw one',
  drawing: 'Drawing…',
  drawAgain: 'Draw another',
  costNote: 'Each picture is one image-API call (it may be billed); a new request is refused while one is still drawing.',
  failed: (why) => `Generation failed: ${why}`,
  emptySaved: 'No pictures yet',
  emptySavedHint: 'Finished pictures are written to the local directory and listed here.',
  recent: 'Recent pictures',
  fileLabel: 'File path',
  copyPath: 'Copy path',
  copied: 'Copied',
  sendLabel: 'Sending is your call',
  sendHint: 'This page only writes files. Once you decide who gets it, send it with:',
  modelLabel: 'Model',
  apiKeyMissing: 'No API key set, so it cannot draw. Fill [image_gen.openai] api_key.',
}

const ja: ImageGenTexts = {
  title: '画像生成',
  subtitle: '設定した画像サービスで 1 枚描き、ローカルファイルに保存します。どこにも自動送信しません。',
  notConfigured: '画像生成が未設定です',
  notConfiguredHint: 'config.toml に [image_gen] と API キーを書いて bothouse を再起動すると、このページが使えます。',
  providersHint: 'OpenAI 互換の /images/generations のみ対応。一度に 1 枚です。',
  restartNote: '設定の変更は bothouse の再起動が必要です（「システム → 再起動」）。',
  promptLabel: 'プロンプト',
  promptPlaceholder: '例：眼鏡をかけたオレンジ色の猫、ピクセルアバター、無地の背景',
  draw: '1 枚描く',
  drawing: '描画中…',
  drawAgain: 'もう 1 枚',
  costNote: '1 枚ごとに画像 API を 1 回呼びます（課金される場合があります）。描画中は新しいリクエストを受け付けません。',
  failed: (why) => `生成に失敗しました：${why}`,
  emptySaved: 'まだ画像がありません',
  emptySavedHint: '描いた画像はローカルに保存され、ここに最近の数枚が並びます。',
  recent: '最近の画像',
  fileLabel: 'ファイルパス',
  copyPath: 'パスをコピー',
  copied: 'コピーしました',
  sendLabel: '送信はご自身で',
  sendHint: 'このページはファイルを書くだけです。送り先を決めたらコマンドで送ります：',
  modelLabel: 'モデル',
  apiKeyMissing: 'API キーが無いため描けません。[image_gen.openai] api_key に記入してください。',
}

export function imageGenTexts(lang: string): ImageGenTexts {
  switch ((lang || '').toLowerCase().split('-')[0]) {
    case 'zh':
      // zh-TW gets the same short labels rather than falling back to English.
      return zh;
    case 'ja':
      return ja;
    default:
      return en;
  }
}