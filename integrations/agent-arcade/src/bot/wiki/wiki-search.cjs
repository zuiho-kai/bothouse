'use strict';
/*
 * Line-level BM25 search with bounded Chinese question matching (no model).
 *
 * Adapted from bothouse, https://github.com/zuiho-kai/bothouse
 * Upstream paths:
 * - bridge/contrib/gate/wiki_search.py (`toks`, `age_days`, `decay`, `Index`, `Index.search`);
 * - bridge/contrib/gate/ctxsvc.py (`_index` rebuild interval, `match_wiki` folding of the top
 *   lines into the top pages).
 * Upstream revision: 218051eccbb31923aa2b0d837801cf4d82c4799f
 * License: Apache-2.0, Copyright (c) 2026 zuiho-kai and bothouse contributors
 *
 * Re-implemented and modified for Agent Arcade (AGPL-3.0) on 2026-11-13:
 * - Node CommonJS over page texts handed in by wiki-store.cjs (which owns every path check);
 * - "today" is injectable; ties are broken by line order so results are deterministic;
 * - the settled-line markers are our own (see PIN);
 * - the index is rebuilt when the page list or any page's mtime / size changes, or after 300 s.
 */
const {parsePage, isHistoryLine} = require('./wiki-store.cjs');
const {questionKey, factKeys, anchors, matchesAnchors, distinguishingText, lexicalSubject} = require('./wiki-question.cjs');
const TOP = 10, TOP_PAGES = 3, MIN_LINE = 6, K1 = 1.2, B = 0.75;
const GRACE = 7, HALF = 14, FLOOR = 0.3, TTL_MS = 300 * 1000, DESC_CHARS = 120, QUERY_CHARS = 2000, LINE_CHARS = 300;
const DATE = /(?<![\d-])(?:(20\d\d)-)?(1[0-2]|0?[1-9])-([0-2]?\d|3[01])(?![\d-])/g;
// A line carrying one of these markers is a settled decision and never loses score with age.
const PIN = /定案|已定|常驻|\[settled\]|\[pinned\]/i;
const DAY_MS = 86400000;
// Conversational glue alone must not recall private notebook pages. Keep domain
// words and numbers (including short queries such as SSH or 2222).
const STOP = new Set(('the a an and or of on in to for from with is are was were be been it its this that these those i me my we our you your he she they their please what which who where when why how do does did can could would should tell about again now today hello hi thanks '
  + '今天 现在 什么 怎么 么样 可以 以吗 你好 好吗 谢谢 一下 请问 告诉 诉我 我的 你的 我们 你们 这个 那个 这是 那是 的吗 了呢 了吗 记得 还记 么安 安排 哪里 哪儿 去哪 在哪 几点 何时 开始 出发').split(/\s+/));
const MIN_RELEVANCE = 0.25;

/** Chinese runs as overlapping two-character pieces; Latin words of 2+ characters; numbers of 3+ digits. */
function tokens(text) {
  const lower = String(text ?? '').toLowerCase(), out = [];
  for (const run of lower.match(/[一-鿿]+/g) || []) for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  for (const word of lower.match(/[a-z][a-z0-9_.-]{1,}|\d{3,}/g) || []) out.push(word);
  return out;
}

const dayNumber = (year, month, day) => Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
function today(now) { const d = new Date(now); return {year: d.getFullYear(), number: dayNumber(d.getFullYear(), d.getMonth() + 1, d.getDate())}; }

/** Days between the newest date written on the line and today; null without a date. A month-day without a year is this year's, or last year's when that would be in the future. */
function ageDays(line, now = Date.now()) {
  const current = today(now);
  let best = null;
  for (const match of String(line).matchAll(DATE)) {
    const month = Number(match[2]), day = Number(match[3]);
    let year = match[1] ? Number(match[1]) : current.year;
    const real = y => { const d = new Date(Date.UTC(y, month - 1, day)); return d.getUTCMonth() === month - 1 && d.getUTCDate() === day; };
    if (!real(year)) continue;
    if (!match[1] && dayNumber(year, month, day) > current.number) { year -= 1; if (!real(year)) continue; }
    const age = current.number - dayNumber(year, month, day);
    if (age >= 0 && (best === null || age < best)) best = age;
  }
  return best;
}

/** Score factor of a line: 1 within 7 days or without a date or when settled; then halving every 14 days down to 0.3. */
function decay(line, now = Date.now()) {
  if (PIN.test(line)) return 1;
  const age = ageDays(line, now);
  if (age === null || age <= GRACE) return 1;
  return Math.max(FLOOR, 0.5 ** ((age - GRACE) / HALF));
}

/** Index over `[{rel, text}]`. Front matter is not indexed; its `description:` is kept per page. */
class Index {
  constructor(pages, now = Date.now()) {
    this.lines = []; this.desc = new Map();
    for (const page of pages) {
      const rows = String(page.text ?? '').split(/\r?\n/);
      let start = 0;
      if (rows[0] === '---') for (let j = 1; j < rows.length; j++) if (rows[j] === '---') { start = j + 1; break; }
      const described = /^description:\s*(.+)$/m.exec(rows.slice(0, start).join('\n'));
      this.desc.set(page.rel, described ? described[1].trim().replace(/^"|"$/g, '') : '');
      const {sections} = parsePage(rows);
      for (let k = start; k < rows.length; k++) {
        if (rows[k].trim().length < MIN_LINE || /^\s*#/.test(rows[k]) || isHistoryLine(sections, k + 1)) continue;
        this.lines.push({rel: page.rel, line: k + 1, text: rows[k], tokens: tokens(rows[k])});
      }
    }
    this.decay = this.lines.map(row => decay(row.text, now));
    const n = Math.max(this.lines.length, 1);
    this.avg = this.lines.reduce((sum, row) => sum + row.tokens.length, 0) / n || 1;
    const df = new Map();
    this.inv = new Map();
    this.byQuestion = new Map();
    this.lines.forEach((row, index) => {
      const keys = factKeys(row.text);
      if (keys.length) row.anchors = anchors(row.text);
      for (const key of keys) {
        if (!this.byQuestion.has(key)) this.byQuestion.set(key, new Set());
        this.byQuestion.get(key).add(index);
      }
      const counts = new Map();
      for (const token of row.tokens) counts.set(token, (counts.get(token) || 0) + 1);
      for (const [token, count] of counts) {
        df.set(token, (df.get(token) || 0) + 1);
        if (!this.inv.has(token)) this.inv.set(token, []);
        this.inv.get(token).push([index, count]);
      }
    });
    this.idf = new Map([...df].map(([token, count]) => [token, Math.log(1 + (n - count + 0.5) / (count + 0.5))]));
  }

  /** The best `k` lines: `[{rel, line, text, score}]`, best first. */
  search(query, k = TOP) {
    const text = String(query ?? '').slice(0, QUERY_CHARS), question = questionKey(text);
    const constraint = question ? anchors(text) : null;
    const eligible = question ? new Set([...(this.byQuestion.get(question.key) || [])]
      .filter(index => matchesAnchors(constraint, this.lines[index].anchors))) : null;
    const scores = new Map();
    let queryTokens = tokens(text);
    if (question?.allowAlias && eligible.size > 1) {
      // Shared wording for the requested topic, date and detail supplies no
      // evidence that one of several eligible activities is the intended one.
      queryTokens = tokens(distinguishingText(constraint)).filter(token => {
        const matching = (this.inv.get(token) || []).filter(([index]) => eligible.has(index));
        return matching.length > 0 && matching.length < eligible.size;
      });
    }
    const queryTerms = new Set(queryTokens.filter(token => !STOP.has(token)));
    // Normalise by the terms present in the notebook: a fixed raw BM25 cutoff
    // would reject precise terms repeated in a small notebook (low IDF).
    const possible = [...queryTerms].reduce((sum, token) => sum + (this.idf.get(token) || 0), 0);
    for (const token of queryTerms) {
      for (const [index, count] of this.inv.get(token) || []) {
        if (eligible && !eligible.has(index)) continue;
        const length = this.lines[index].tokens.length;
        scores.set(index, (scores.get(index) || 0) + this.idf.get(token) * count * (K1 + 1) / (count + K1 * (1 - B + B * length / this.avg)));
      }
    }
    // Keep BM25 ranking, including the requested detail, but require the same
    // line to share a subject term when no recognised topic anchors the query.
    const subject = question ? null : lexicalSubject(text);
    const subjectTerms = subject === null ? null : new Set(tokens(subject).filter(token => !STOP.has(token)));
    const ranked = [...scores].filter(([index, score]) => possible > 0 && score / possible >= MIN_RELEVANCE &&
      (!subjectTerms || this.lines[index].tokens.some(token => subjectTerms.has(token))));
    // A phrase match alone may introduce one answer. When several lines match
    // the topic and requested detail, require literal evidence to choose.
    if (!ranked.length && question?.allowAlias && eligible.size === 1) ranked.push([eligible.values().next().value, MIN_RELEVANCE]);
    return ranked.map(([index, score]) => [index, score * this.decay[index]]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, k)
      .map(([index, score]) => ({rel: this.lines[index].rel, line: this.lines[index].line, text: this.lines[index].text, score}));
  }
}

/** Folds line hits (best first) into at most `k` pages in order of first appearance: `[{page, desc, lines: [{line, text}]}]`. */
function foldPages(hits, desc, k = TOP_PAGES) {
  const pages = new Map();
  for (const hit of hits) {
    if (!pages.has(hit.rel)) {
      if (pages.size === k) continue;
      pages.set(hit.rel, {page: hit.rel, desc: String(desc.get(hit.rel) || '').slice(0, DESC_CHARS), lines: []});
    }
    pages.get(hit.rel).lines.push({line: hit.line, text: hit.text.trim().slice(0, LINE_CHARS)});
  }
  return [...pages.values()];
}

/** Cached index over a WikiStore; rebuilt when a page changed on disk or after 300 s. */
class WikiSearch {
  constructor({store, now = Date.now} = {}) { this.store = store; this.now = now; this.index = null; this.signature = ''; this.builtAt = 0; this.builds = 0; }

  #current() {
    const pages = this.store.pages(), signature = pages.map(page => `${page.rel}:${page.mtimeMs}:${page.size}`).join('|'), now = this.now();
    if (!this.index || signature !== this.signature || now - this.builtAt >= TTL_MS) {
      const texts = [];
      for (const page of pages) { const text = this.store.pageText(page.rel); if (text !== null) texts.push({rel: page.rel, text}); }
      this.index = new Index(texts, now); this.signature = signature; this.builtAt = now; this.builds += 1;
    }
    return this.index;
  }

  /** Top 10 lines folded to the top 3 pages. */
  search(query, {lines = TOP, pages = TOP_PAGES} = {}) {
    const index = this.#current();
    return foldPages(index.search(query, lines), index.desc, pages);
  }
}

module.exports = {tokens, ageDays, decay, Index, foldPages, WikiSearch, PIN, TOP, TOP_PAGES, MIN_LINE, TTL_MS};
