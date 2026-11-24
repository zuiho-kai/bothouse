'use strict';

const {MAX_FACTS_PER_SCOPE} = require('./social-continuity-store.cjs');
const {findCode, displayCode} = require('./social-flow.cjs');
const {cleanText} = require('../sources/event.cjs');

const PAGE_SIZE = 6, PREVIEW_LIMIT = 160;
const MAX_PAGES = Math.ceil(MAX_FACTS_PER_SCOPE / PAGE_SIZE);
const LIST_COMMAND = /^(查看记忆|记忆列表|\/memory)(?:\s+([\s\S]+))?$/u;
const DETAIL_COMMAND = /^查看记忆详情(?:\s+([\s\S]+))?$/u;
const VISIBLE_REPLY = '这条回复在本群可见。';
const PAGE_LANGUAGE = /^(?:[+-]?(?:\d|\.\d)|第\s*\d|[上下](?:一)?页$)/u;

function pageRequest(body) {
  const command = LIST_COMMAND.exec(body);
  if (!command) return null;
  const requested = command[2]?.normalize('NFKC').trim() || '1';
  // A plain-language question about memory can use the same words. Bare
  // aliases and explicit page syntax are the deterministic commands.
  return command[1] === '/memory' || PAGE_LANGUAGE.test(requested) ? requested : null;
}

const isGroupMemoryControl = body => DETAIL_COMMAND.test(body) || pageRequest(body) !== null;

function groupMemoryReply(body, readFacts) {
  const detail = DETAIL_COMMAND.exec(body);
  if (detail) {
    const code = detail[1]?.trim();
    if (!code || !/^[\w-]{6,180}$/u.test(code)) return '请发“查看记忆详情 编号”。可用“查看记忆”查看编号。';
    const facts = readFacts();
    const fact = findCode(facts, code);
    if (!fact) return '没有找到这条记忆。请发“查看记忆”核对编号。';
    return `记忆详情 ${displayCode(facts, fact.id)}：\n${fact.text}\n${VISIBLE_REPLY}`;
  }
  const requested = pageRequest(body);
  if (requested === null) return null;
  const number = /^第\s*([1-9]\d?)\s*页$/u.exec(requested)?.[1] || requested;
  const page = /^[1-9]\d?$/u.test(number) ? Number(number) : 0;
  if (!page || page > MAX_PAGES) return `页码须为 1 到 ${MAX_PAGES}。请发“查看记忆”或“查看记忆 2”。`;

  const facts = readFacts();
  if (!facts.length) return '你在本群还没有长期记忆。可以发“记住：你希望我记下的事”。';
  const total = Math.ceil(facts.length / PAGE_SIZE);
  if (page > total) return `没有第 ${page} 页，目前共 ${total} 页。请发“查看记忆”回到第一页。`;

  const start = (page - 1) * PAGE_SIZE;
  let hasShortened = false;
  const rows = facts.slice(start, start + PAGE_SIZE).map(fact => {
    const preview = cleanText(fact.text, PREVIEW_LIMIT);
    const shortened = preview !== fact.text;
    hasShortened ||= shortened;
    return `${displayCode(facts, fact.id)} · ${preview}${shortened ? '（可看全文）' : ''}`;
  });
  const nav = [];
  if (page > 1) nav.push(`上一页“查看记忆 ${page - 1}”`);
  if (page < total) nav.push(`下一页“查看记忆 ${page + 1}”`);
  return [`你的群内记忆（第 ${page}/${total} 页 · 共 ${facts.length} 条）：`, ...rows,
    nav.length ? nav.join('，') + '。' : '',
    hasShortened ? '发“查看记忆详情 编号”可看一条全文。' : '',
    '可发“更正 编号：新内容”或“忘记 编号”。' + VISIBLE_REPLY,
  ].filter(Boolean).join('\n');
}

module.exports = {groupMemoryReply, isGroupMemoryControl};
