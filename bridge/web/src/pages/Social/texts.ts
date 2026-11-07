/** QQ 说说 / 头像 page copy. zh / en / ja, English otherwise — same rule as pages/Plugins/texts.ts. */

export interface SocialTexts {
  title: string
  subtitle: string
  off: string
  offHint: string
  unsupported: string
  unsupportedHint: string
  errorTitle: string
  postLabel: string
  postPlaceholder: string
  post: string
  posting: string
  postNote: string
  posted: string
  failed: (why: string) => string
  listTitle: string
  empty: string
  emptyHint: string
  privateLabel: string
  replace: string
  replacing: string
  replaceLabel: string
  replaceConfirm: string
  replaced: string
  replaceCancel: string
  delete: string
  deleting: string
  deleteConfirm: string
  deleted: string
  avatarTitle: string
  avatarHint: string
  avatarPick: string
  avatarChange: string
  avatarChanging: string
  avatarConfirm: string
  avatarChanged: string
  avatarTooBig: string
  refresh: string
  gotoConfig: string
}

const zh: SocialTexts = {
  title: '说说与头像',
  subtitle: '用这个 QQ 号发说说、删说说、换头像。三个动作都要先在配置里打开，而且点之前会再问一次。',
  off: '这两个能力还没打开',
  offHint: '在项目的 QQ 配置里加上 allow_qzone = true（说说）和 allow_avatar = true（头像），重启 bothouse 之后这里就能用了。',
  unsupported: '这个项目没有 QQ 连接',
  unsupportedHint: '说说和改头像目前只有 QQ（NapCat）能做。别的平台照常用，只是没有这一页的功能。',
  errorTitle: '读取说说列表失败',
  postLabel: '说点什么',
  postPlaceholder: '今天想说的一句话……',
  post: '发出去',
  posting: '正在发…',
  postNote: '发出去所有人都能看见（除非你在 QQ 里自己改权限）。这里不会定时发，也不会替你发。',
  posted: '发出去了',
  failed: (why) => `失败：${why}`,
  listTitle: '已有的说说',
  empty: '还没有说说',
  emptyHint: '这个号还没发过，或者上游没返回列表。',
  privateLabel: '仅部分人可见',
  replace: '换一条',
  replacing: '正在换…',
  replaceLabel: '改成什么',
  replaceConfirm: '换掉这一条的说法？会先发新的，成功了再删旧的；中间失败不会把原来的弄丢。',
  replaced: '换好了',
  replaceCancel: '取消',
  delete: '删掉',
  deleting: '正在删…',
  deleteConfirm: '删掉这一条？删了就没了，QQ 空间里也看不到了。',
  deleted: '删掉了',
  avatarTitle: '换头像',
  avatarHint: '选一张图（PNG/JPEG，2 MB 以内）换成这个号的头像。换完所有地方都变。',
  avatarPick: '选图片',
  avatarChange: '换成这个',
  avatarChanging: '正在换…',
  avatarConfirm: '换掉这个号的头像？换完立刻生效，旧头像不会留在这台机器上。',
  avatarChanged: '换好了',
  avatarTooBig: '图片超过 2 MB，先压一下再传。',
  refresh: '刷新',
  gotoConfig: '去项目设置',
}

const en: SocialTexts = {
  title: 'Moments & avatar',
  subtitle: 'Post, delete and re-avatar as this QQ account. Both are off until you turn them on in config, and each press asks once more.',
  off: 'Both actions are off',
  offHint: 'Add allow_qzone = true (moments) and allow_avatar = true (avatar) to this project\'s qq options, restart bothouse, and this page works.',
  unsupported: 'This project has no QQ connection',
  unsupportedHint: 'Moments and avatar changes are QQ (NapCat) only for now. Other platforms work as before; they just do not have these.',
  errorTitle: 'Could not read the moment list',
  postLabel: 'Say something',
  postPlaceholder: 'One line you want to post…',
  post: 'Post it',
  posting: 'Posting…',
  postNote: 'Everyone who can see this account\'s timeline sees it (unless you change the audience in QQ). Nothing here posts on a schedule or on your behalf later.',
  posted: 'Posted',
  failed: (why) => `Failed: ${why}`,
  listTitle: 'Existing moments',
  empty: 'No moments yet',
  emptyHint: 'This account has not posted, or the upstream did not return a list.',
  privateLabel: 'Limited audience',
  replace: 'Replace',
  replacing: 'Replacing…',
  replaceLabel: 'New words',
  replaceConfirm: 'Replace this post? The new one goes out first, then the old one is removed; a failure in between never loses the original.',
  replaced: 'Replaced',
  replaceCancel: 'Cancel',
  delete: 'Delete',
  deleting: 'Deleting…',
  deleteConfirm: 'Delete this one? It is gone for good and disappears from QQ too.',
  deleted: 'Deleted',
  avatarTitle: 'Change the avatar',
  avatarHint: 'Pick a picture (PNG/JPEG, under 2 MB) and this account wears it. It changes everywhere at once.',
  avatarPick: 'Pick a picture',
  avatarChange: 'Use this one',
  avatarChanging: 'Changing…',
  avatarConfirm: 'Replace this account\'s avatar? It takes effect immediately; the old one is not kept on this machine.',
  avatarChanged: 'Changed',
  avatarTooBig: 'That picture is over 2 MB; shrink it first.',
  refresh: 'Refresh',
  gotoConfig: 'Project settings',
}

const ja: SocialTexts = {
  title: '申し送りとアイコン',
  subtitle: 'この QQ アカウントとして投稿・削除・アイコン変更を行います。どちらも設定で有効にするまで使えず、押す前にもう一度確認します。',
  off: 'どちらも無効です',
  offHint: 'このプロジェクトの QQ 設定に allow_qzone = true（投稿）と allow_avatar = true（アイコン）を追加し、bothouse を再起動してください。',
  unsupported: 'このプロジェクトに QQ 接続がありません',
  unsupportedHint: '投稿とアイコン変更は今のところ QQ（NapCat）だけです。他のプラットフォームは従来どおり動きます。',
  errorTitle: '投稿一覧を読めませんでした',
  postLabel: 'ひとこと',
  postPlaceholder: '投稿したい一言…',
  post: '投稿する',
  posting: '投稿中…',
  postNote: 'このアカウントのタイムラインが見える人全員に見えます（QQ 側で範囲を変えない限り）。ここから予約投稿はしません。',
  posted: '投稿しました',
  failed: (why) => `失敗：${why}`,
  listTitle: 'これまでの投稿',
  empty: '投稿はまだありません',
  emptyHint: 'まだ投稿していないか、上流が一覧を返しませんでした。',
  privateLabel: '公開範囲あり',
  replace: '差し替え',
  replacing: '差し替え中…',
  replaceLabel: '新しい本文',
  replaceConfirm: 'この投稿を差し替えますか？新しい投稿を先に出し、成功してから元を削除します。途中で失敗しても元は失われません。',
  replaced: '差し替えました',
  replaceCancel: 'キャンセル',
  delete: '削除',
  deleting: '削除中…',
  deleteConfirm: 'この投稿を削除しますか？元に戻せません。',
  deleted: '削除しました',
  avatarTitle: 'アイコンを変える',
  avatarHint: '画像（PNG/JPEG、2 MB 以内）を選ぶとこのアカウントのアイコンになります。どこでも一斉に変わります。',
  avatarPick: '画像を選ぶ',
  avatarChange: 'これにする',
  avatarChanging: '変更中…',
  avatarConfirm: 'このアカウントのアイコンを置き換えますか？すぐ反映され、元の画像はこの端末に残りません。',
  avatarChanged: '変更しました',
  avatarTooBig: '2 MB を超えています。縮小してから送ってください。',
  refresh: '再読み込み',
  gotoConfig: 'プロジェクト設定へ',
}

export function socialTexts(lang: string): SocialTexts {
  if (lang === 'zh' || lang === 'zh-TW') return zh
  if (lang === 'ja') return ja
  return en
}
