'use strict';

const {MAX_FOLLOWUPS_PER_SCOPE, MAX_PENDING_FOLLOWUPS_PER_SCOPE} = require('./social-continuity-store.cjs');
const {displayCode} = require('./social-flow.cjs');
const {cleanText} = require('../sources/event.cjs');

const PAGE_SIZE = 6;
const LIST_COMMAND = /^(?:查看回访|回访列表)(?:\s+([\s\S]+))?$/u;
const HISTORY_COMMAND = /^历史(?:\s+([\s\S]+))?$/u;
const NUMERIC_ARGUMENT = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/iu;
const LABELS = {
  pending: '等待',
  attempting: '已尝试，结果未定',
  sent: '平台已受理',
  unknown: '结果未确认，不重发',
  failed: '未发送，不重发',
  cancelled: '已取消',
  missed: '已错过，不补发',
};

function pageRequest(body) {
  if (typeof body !== 'string') return null;
  const command = LIST_COMMAND.exec(body.trim());
  if (!command) return null;
  const argument = command[1]?.normalize('NFKC').trim() || '';
  const history = HISTORY_COMMAND.exec(argument);
  const requested = (history ? history[1] : argument) || '1';
  // Only bare commands and numeric arguments are deterministic. A question
  // after the same words remains ordinary group conversation.
  return NUMERIC_ARGUMENT.test(requested) ? {history: !!history, requested} : null;
}

const isGroupAppointmentList = body => pageRequest(body) !== null;

function groupAppointmentPage(body, readRows, emptyPendingHint) {
  const request = pageRequest(body);
  if (!request) return null;
  const {history, requested} = request;
  const command = history ? '查看回访 历史' : '查看回访';
  const maxRows = history ? MAX_FOLLOWUPS_PER_SCOPE : MAX_PENDING_FOLLOWUPS_PER_SCOPE;
  const maxPages = Math.ceil(maxRows / PAGE_SIZE);
  const page = /^[1-9]\d?$/u.test(requested) ? Number(requested) : 0;
  if (!page || page > maxPages) return `页码须为 1 到 ${maxPages}。请发“${command}”或“${command} 2”。`;

  const allRows = readRows();
  const sort = history
    ? (left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt
    : (left, right) => left.dueAt - right.dueAt || left.createdAt - right.createdAt;
  const matching = allRows.filter(item => history ? item.state !== 'pending' : item.state === 'pending')
    .sort(sort).slice(0, maxRows);
  const otherList = history ? '发“查看回访”看待进行的回访。' : '发“查看回访 历史”看历史。';
  if (!matching.length) {
    const empty = `你在本群${history ? '还没有回访历史' : '目前没有待进行的回访'}。${otherList}`;
    return !history && emptyPendingHint ? empty + '\n' + emptyPendingHint() : empty;
  }

  const total = Math.ceil(matching.length / PAGE_SIZE);
  if (page > total) return `没有第 ${page} 页，目前共 ${total} 页。请发“${command}”回到第一页。${otherList}`;

  const start = (page - 1) * PAGE_SIZE;
  const rows = matching.slice(start, start + PAGE_SIZE).map(item => {
    const code = displayCode(allRows, item.id);
    const time = item.localTime ?? new Date(item.dueAt).toISOString();
    const label = Object.hasOwn(LABELS, item.state) ? LABELS[item.state] : '状态不明';
    return [code, time, label, cleanText(item.text, 80)].filter(Boolean).join(' · ');
  });
  const navigation = [];
  if (page > 1) navigation.push(`上一页“${command} ${page - 1}”`);
  if (page < total) navigation.push(`下一页“${command} ${page + 1}”`);
  const title = history ? '你的群内回访历史' : '你在本群待进行的回访';
  return [
    `${title}（第 ${page}/${total} 页 · 共 ${matching.length} 条）：`,
    ...rows,
    navigation.length ? navigation.join('，') + '。' : '',
    history ? '' : '可发“改期回访 编号 新时间”或“取消回访 编号”。',
    otherList + '这条回复在本群可见。',
  ].filter(Boolean).join('\n');
}

module.exports = {groupAppointmentPage, isGroupAppointmentList};
