/** 记忆论坛页 (#1143) copy; zh / en / ja like the 闸门 page (Gate/texts.ts), English otherwise. */
export interface ForumTexts {
  title: string
  subtitle: string
  refresh: string
  loading: string
  loadFailed: string
  notRunning: string
  noData: string
  summary: (n: number, rounds: number, ups: number, downs: number, cited: number, last: string) => string
  howRanked: string
  search: string
  hits: (n: number) => string
  posts: string
  gone: (n: number) => string
  score: string
  folded: string
  stats: (pushed: number, cited: number, last: string) => string
  outcome: string
  self: (who: string) => string
  copy: string
  copied: string
  noText: string
  threadsSummary: (threads: number, floors: number, rounds: number, ups: number, downs: number, last: string) => string
  threadStats: (pushed: number, last: string) => string
  floors: (n: number) => string
  floorNo: (n: number) => string
  back: string
  latest: string
  best: string
  disagree: string
  threadMissing: string
}

const zh: ForumTexts = {
  title: '记忆论坛',
  subtitle: '角色每轮收到的记忆：问同一件事的归成一个帖子，下面每楼一个回答，按用户反应排序',
  refresh: '刷新',
  loading: '正在读记忆论坛…',
  loadFailed: '读不到记忆论坛',
  notRunning: '记忆论坛没在跑：它跟着闸门服务一起跑，去「闸门」页启动后再回来看。',
  noData: '还没有推送记录。角色开始聊天、收到记忆以后，这里就会有帖子。',
  summary: (n, rounds, ups, downs, cited, last) =>
    `${n} 条记忆在榜 · 推送 ${rounds} 轮 · 计分票 赞 ${ups} / 踩 ${downs} · 角色自报引用 ${cited} 次 · 最近一票 ${last || '—'}`,
  howRanked: '排序照论坛本身：Reddit best（Wilson 下界），只有用户反应计分（被引用那轮用户下一句不是纠正记赞、是纠正记踩），低分折叠沉底。橙色 [#编号] 点一下复制，拿去 bothouse ctx 编号 取原文。',
  search: '搜记忆：关键词、页名或编号',
  hits: (n) => `命中 ${n} 条记忆`,
  posts: '帖子',
  gone: (n) => `页里已改动或删掉的 ${n} 条（显示推送时的原文）`,
  score: '分',
  folded: '低分·已折叠',
  stats: (pushed, cited, last) => `被推 ${pushed} 次 · 引用 ${cited} 次 · 最近 ${last || '—'}`,
  outcome: '用户反应（夜里打分）',
  self: (who) => `${who || '角色'} 自报`,
  copy: '点一下复制编号',
  copied: '已复制',
  noText: '（原文没找到）',
  threadsSummary: (t, f, rounds, ups, downs, last) =>
    `${t} 个帖子 · ${f} 楼回答 · 推送 ${rounds} 轮 · 计分票 赞 ${ups} / 踩 ${downs} · 最近一票 ${last || '—'}`,
  threadStats: (pushed, last) => `各楼共被推 ${pushed} 次 · 最近 ${last || '—'}`,
  floors: (n) => `${n} 楼`,
  floorNo: (n) => `${n} 楼`,
  back: '← 回帖子列表',
  latest: '最新',
  best: '最高分',
  disagree: '最新一楼不是最高分那楼',
  threadMissing: '这个帖子不在了，回列表看看',
}

const en: ForumTexts = {
  title: 'Memory forum',
  subtitle: 'Memories your roles get each turn: one thread per question, one answer per reply, ranked by how the user reacted',
  refresh: 'Refresh',
  loading: 'Reading the memory forum…',
  loadFailed: 'Could not read the memory forum',
  notRunning: 'The memory forum is not running: it runs with the gate service. Start it on the Gate page, then come back.',
  noData: 'No pushes yet. Posts show up once your roles start chatting and receive memories.',
  summary: (n, rounds, ups, downs, cited, last) =>
    `${n} memories ranked · ${rounds} pushes · votes ▲${ups} / ▼${downs} · ${cited} self-reported uses · last vote ${last || '—'}`,
  howRanked: 'Ranked like the forum itself: Reddit best (Wilson lower bound). Only the user\'s reaction counts (the next message after a cited turn is not a correction: up; is a correction: down). Low scores fold to the bottom. Click an orange [#id] to copy it for bothouse ctx <id>.',
  search: 'Search memories: keyword, page or id',
  hits: (n) => `${n} memories match`,
  posts: 'Posts',
  gone: (n) => `${n} edited or removed from their page (shown as pushed)`,
  score: 'score',
  folded: 'low score · folded',
  stats: (pushed, cited, last) => `pushed ${pushed} · cited ${cited} · last ${last || '—'}`,
  outcome: 'user reaction (scored at night)',
  self: (who) => `${who || 'role'} self-report`,
  copy: 'Click to copy the id',
  copied: 'Copied',
  noText: '(original text not found)',
  threadsSummary: (t, f, rounds, ups, downs, last) =>
    `${t} threads · ${f} answers · ${rounds} pushes · votes ▲${ups} / ▼${downs} · last vote ${last || '—'}`,
  threadStats: (pushed, last) => `answers pushed ${pushed} · last ${last || '—'}`,
  floors: (n) => `${n} ${n === 1 ? 'answer' : 'answers'}`,
  floorNo: (n) => `#${n}`,
  back: '← Back to threads',
  latest: 'latest',
  best: 'top',
  disagree: 'the latest answer is not the top one',
  threadMissing: 'This thread is gone; go back to the list',
}

const ja: ForumTexts = {
  ...en,
  title: '記憶フォーラム',
  subtitle: 'ロールが毎ターン受け取る記憶。1 件 1 投稿、ユーザーの反応で並べ替え',
  refresh: '更新',
  search: '記憶を検索：キーワード・ページ名・番号',
  posts: '投稿',
}

const all: Record<string, ForumTexts> = { zh, en, ja }

export const forumTexts = (lang: string): ForumTexts => all[(lang || '').toLowerCase().split('-')[0]] ?? en
