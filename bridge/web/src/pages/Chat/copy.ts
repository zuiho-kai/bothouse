/* Copy for the chat page.
   New strings live here instead of src/i18n/locales/*.json so this page never collides with the
   other UI tracks editing locale files. Two languages only (zh/en), matching the product's own
   copy sheet; zh-TW falls back to zh. */
import { useTranslation } from 'react-i18next';

export interface ChatCopy {
  listTitle: string;
  listSubtitle: string;
  search: string;
  onlineOnly: string;
  onlineNow: string;
  noMatch: string;
  noMatchHint: string;
  emptyList: string;
  emptyListHint: string;
  welcomeTitle: string;
  welcomeBody: string;
  pickOne: string;
  latest: string;
  backToLatest: string;
  newMessages: (n: number) => string;
  thinking: string;
  thinkingHint: string;
  copy: string;
  copied: string;
  today: string;
  yesterday: string;
  justNow: string;
  minutes: (n: number) => string;
  hours: (n: number) => string;
  days: (n: number) => string;
  selectChat: string;
  members: (n: number) => string;
  messages: (n: number) => string;
  startChat: string;
  quickInsert: string;
  emoji: string;
  attachHint: string;
  sending: string;
  sendFailed: string;
  scrollLatest: string;
  filterAll: string;
  showingCount: (shown: number, all: number) => string;
  recentCommands: string;
  matches: string;
}

const zh: ChatCopy = {
  listTitle: '对话',
  listSubtitle: '选一个会话接着聊',
  search: '搜索会话',
  onlineOnly: '只看在线',
  onlineNow: '在线',
  noMatch: '没有匹配的会话',
  noMatchHint: '换个关键词，或关掉「只看在线」',
  emptyList: '还没有会话',
  emptyListHint: '在项目里发起一次对话后，这里会列出所有会话',
  welcomeTitle: '选一个会话开始',
  welcomeBody: '左边是按最近活动排好的会话，头像和在线状态一眼就能认出来，点进任何一个就能接着聊。',
  pickOne: '从左侧选择',
  latest: '最新',
  backToLatest: '回到最新',
  newMessages: (n) => `${n} 条新消息`,
  thinking: '正在思考',
  thinkingHint: '正在思考…',
  copy: '复制',
  copied: '已复制',
  today: '今天',
  yesterday: '昨天',
  justNow: '刚刚',
  minutes: (n) => `${n} 分钟`,
  hours: (n) => `${n} 小时`,
  days: (n) => `${n} 天`,
  selectChat: '选择会话',
  members: (n) => `${n} 位成员`,
  messages: (n) => `${n} 条`,
  startChat: '开始对话',
  quickInsert: '快捷输入',
  emoji: '表情',
  attachHint: '附件',
  sending: '发送中',
  sendFailed: '发送失败',
  scrollLatest: '回到最新消息',
  filterAll: '全部',
  showingCount: (shown, all) => `显示 ${shown} / ${all}`,
  recentCommands: '最近使用',
  matches: '匹配结果',
};

const en: ChatCopy = {
  listTitle: 'Chats',
  listSubtitle: 'Pick a conversation and keep going',
  search: 'Search chats',
  onlineOnly: 'Online only',
  onlineNow: 'online',
  noMatch: 'No matching chat',
  noMatchHint: 'Try another keyword, or turn off "Online only"',
  emptyList: 'No conversations yet',
  emptyListHint: 'Once you chat in a project, every conversation shows up here',
  welcomeTitle: 'Pick a conversation',
  welcomeBody: 'Recent chats are on the left, sorted by activity — avatars and presence make them easy to spot. Open any one to continue.',
  pickOne: 'Choose on the left',
  latest: 'Latest',
  backToLatest: 'Back to latest',
  newMessages: (n) => `${n} new message${n === 1 ? '' : 's'}`,
  thinking: 'Thinking',
  thinkingHint: 'Thinking…',
  copy: 'Copy',
  copied: 'Copied',
  today: 'Today',
  yesterday: 'Yesterday',
  justNow: 'just now',
  minutes: (n) => `${n}m`,
  hours: (n) => `${n}h`,
  days: (n) => `${n}d`,
  selectChat: 'Select chat',
  members: (n) => `${n} member${n === 1 ? '' : 's'}`,
  messages: (n) => `${n} msg`,
  startChat: 'Start chatting',
  quickInsert: 'Quick insert',
  emoji: 'Emoji',
  attachHint: 'Attach',
  sending: 'Sending',
  sendFailed: 'Send failed',
  scrollLatest: 'Back to latest',
  filterAll: 'All',
  showingCount: (shown, all) => `${shown} of ${all}`,
  recentCommands: 'Recent',
  matches: 'Matches',
};

export const chatCopy: Record<'zh' | 'en', ChatCopy> = { zh, en };

export function pickChatCopy(language: string | undefined): ChatCopy {
  return (language || '').toLowerCase().startsWith('zh') ? zh : en;
}

export function useChatCopy(): ChatCopy {
  const { i18n } = useTranslation();
  return pickChatCopy(i18n.language);
}

/** Short relative time for list rows and bubbles: 刚刚 / 12 分钟 / 3 小时 / 2 天 / 9月12日. */
export function formatRelative(iso: string, copy: ChatCopy, now: number = Date.now()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return copy.justNow;
  if (mins < 60) return copy.minutes(mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return copy.hours(hours);
  const days = Math.floor(hours / 24);
  if (days < 7) return copy.days(days);
  const d = new Date(then);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** Day separator label: 今天 / 昨天 / 9月12日. */
export function formatDayLabel(iso: string, copy: ChatCopy, now: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(new Date(now)) - startOfDay(d)) / 86400000);
  if (dayDiff <= 0) return copy.today;
  if (dayDiff === 1) return copy.yesterday;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** Wall clock for bubble meta. */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
