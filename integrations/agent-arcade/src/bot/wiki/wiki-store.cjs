'use strict';
/*
 * The owner's memory wiki of one profile: a small folder of Markdown files with fixed layers
 * and budgets, structural checks, and deterministic line-level changes.
 *
 * Adapted from bothouse, https://github.com/zuiho-kai/bothouse
 * Upstream paths:
 * - bridge/contrib/wiki/llmwiki/lint.py (budgets, front matter, orphan pages, allowed
 *   sections, line length, the 80 % warnings);
 * - bridge/contrib/wiki/template/schema/CLAUDE.zh-CN.md (the layered schema and page format).
 * Upstream revision: 218051eccbb31923aa2b0d837801cf4d82c4799f
 * License: Apache-2.0, Copyright (c) 2026 zuiho-kai and bothouse contributors
 *
 * Re-implemented and modified for Agent Arcade (AGPL-3.0) on 2026-11-13:
 * - Node CommonJS; no git, no model and no script ever edits a page here: the only writers
 *   are the owner (any editor) and `applyChange` / `createDomain` / `createPage`, which the
 *   owner triggers one change at a time;
 * - one level of domains (no sub-domains); `scope` is a top-level front-matter key (an indented
 *   `metadata:` block as upstream writes it is accepted when reading);
 * - every path is resolved inside the wiki root and symbolic links are refused; the wiki is
 *   bounded to 500 pages and 2 MiB; unreadable or oversized files are reported, never followed;
 * - upstream's annotation-word and unanswered-proposal checks are not ported (they police a
 *   model writing pages, which does not happen here).
 *
 * Layout (all text UTF-8):
 *   MEMORY.md             index: one `- [domain](domain/README.md) — what it covers` line per
 *                         domain; at most 8 domains plus `misc`, each line at most 80 characters
 *   <domain>/README.md    one `- [topic](topic.md) — one line` per topic; at most 15 topics,
 *                         each line at most 120 characters
 *   <domain>/<topic>.md   front matter (name, description, scope), then only these four
 *                         sections, in this order, each optional (a date suffix is allowed):
 *                           ## 现状        current state (rewritten, not appended)
 *                           ## 关键事实    key facts
 *                           ## 决策与踩坑  decisions and pitfalls
 *                           ## 待办        to-do
 *                           ## 历史        optional owner-maintained archive, read-only in App
 *                         at most 60 lines, 4000 characters, 300 characters per line
 *   log.md                append-only, one line per applied change
 */
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');

const SECTIONS = Object.freeze(['现状', '关键事实', '决策与踩坑', '待办']);
const LIMITS = Object.freeze({domains: 8, indexLine: 80, topics: 15, readmeLine: 120, pageLines: 60, pageChars: 4000, bodyLine: 300,
  pages: 500, bytes: 2 * 1024 * 1024, name: 40, fileBytes: 256 * 1024, logBytes: 512 * 1024, warn: 0.8, findings: 100, description: 100});
const SPECIAL = 'misc';
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,39}$/u;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|readme|memory|log|bin|schema)$/i;
const ENTRY = /^- \[([^\]]*)\]\(([^)]*)\)(.*)$/;
const TOP_FILES = new Set(['MEMORY.md', 'log.md', 'log.1.md']);
const CODES = new Set(['wiki_path_invalid', 'wiki_path_refused', 'wiki_not_found', 'wiki_unavailable', 'wiki_invalid_request', 'wiki_name_invalid', 'wiki_exists', 'wiki_domains_full', 'wiki_topics_full',
  'wiki_full', 'wiki_line_too_long', 'wiki_section_invalid', 'wiki_target_invalid', 'wiki_text_invalid', 'wiki_lint_failed', 'wiki_page_changed', 'wiki_file_too_large']);
const fail = (code, details) => Object.assign(new Error(`The wiki refused this operation (${code}).`), {code, ...(details ? {details} : {})});
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const pad = value => String(value).padStart(2, '0');
const stamp = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const splitLines = text => { const lines = text.split(/\r?\n/); if (lines.at(-1) === '') lines.pop(); return lines; };
// Bothouse main@8ec73a8f32573b5307922df3c79675a934cdefb7:
// lint.py (optional 历史) and ctxsvc.py (_sections, OLD_HEADS).
const HISTORY_SECTION = '历史';
const canonical = heading => heading.replace(/[（(].*$/, '').trim() === HISTORY_SECTION
  ? HISTORY_SECTION : SECTIONS.find(name => heading.startsWith(name)) || null;
const isHistoryLine = (sections, line) => sections.some(section => section.name === HISTORY_SECTION && line >= section.line && line <= section.end);
const oneLine = (value, max, code = 'wiki_text_invalid') => {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value) || !value.trim() || value.trim().length > max) throw fail(code);
  return value.trim();
};

/** Front matter and sections of a page's lines. Tolerates any content. */
function parsePage(lines) {
  let start = 0;
  const front = {};
  if (lines[0] === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] !== '---') continue;
      for (const line of lines.slice(1, i)) { const match = /^[ \t]*(\w+):[ \t]*(.+)$/.exec(line); if (match && !Object.hasOwn(front, match[1])) front[match[1]] = match[2].trim(); }
      start = i + 1;
      break;
    }
  }
  const sections = [];
  for (let i = start; i < lines.length; i++) {
    const closes = lines[i].startsWith('## ') || lines[i].startsWith('# ');
    if (closes && sections.length && sections.at(-1).end === null) sections.at(-1).end = i; // 1-based number of the last line of the section
    if (lines[i].startsWith('## ')) sections.push({heading: lines[i].slice(3).trim(), name: canonical(lines[i].slice(3).trim()), line: i + 1, end: null});
  }
  if (sections.length && sections.at(-1).end === null) sections.at(-1).end = lines.length;
  return {front, hasFront: start > 0, bodyStart: start, sections};
}

/** Page-level checks of lint.py. Returns `[{code, path, detail}]` errors and warnings. */
function lintPage(rel, text) {
  const errors = [], warnings = [];
  const lines = splitLines(text), parsed = parsePage(lines), chars = text.length;
  if (!parsed.hasFront || !['name', 'description', 'scope'].every(key => parsed.front[key])) errors.push({code: 'front_matter', path: rel, detail: 'front matter needs name, description, scope'});
  if (lines.length > LIMITS.pageLines || chars > LIMITS.pageChars) errors.push({code: 'page_budget', path: rel, detail: `${lines.length}/${LIMITS.pageLines} lines, ${chars}/${LIMITS.pageChars} chars`});
  if (Math.max(lines.length / LIMITS.pageLines, chars / LIMITS.pageChars) >= LIMITS.warn) warnings.push({code: 'page_near_budget', path: rel, detail: `${lines.length}/${LIMITS.pageLines} lines, ${chars}/${LIMITS.pageChars} chars`});
  for (const section of parsed.sections) if (!section.name) errors.push({code: 'section_illegal', path: rel, detail: `line ${section.line}`});
  const body = lines.slice(parsed.bodyStart);
  if (!parsed.sections.length && body.length > 8) errors.push({code: 'no_sections', path: rel, detail: SECTIONS.join('/')});
  body.forEach((line, index) => { if (line.length > LIMITS.bodyLine) errors.push({code: 'line_too_long', path: rel, detail: `line ${parsed.bodyStart + index + 1}: ${line.length}/${LIMITS.bodyLine}`}); });
  return {errors, warnings, links: [...body.join('\n').matchAll(/\[\[([^\]\n]{1,80})\]\]/g)].map(match => match[1])};
}

class WikiStore {
  /** @param {{root: string, now?: () => number}} options root: absolute directory of this profile's wiki (created on first write) */
  constructor({root, now = Date.now} = {}) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw fail('wiki_unavailable');
    this.root = path.resolve(root); this.now = now;
  }

  #rootState() {
    let stat;
    try { stat = fs.lstatSync(this.root); } catch (error) { if (error.code === 'ENOENT') return false; throw fail('wiki_unavailable'); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('wiki_unavailable');
    return true;
  }

  // Resolves a wiki-relative path ('a/b.md'); refuses traversal, hidden names and any link on the way.
  #resolve(rel) {
    if (typeof rel !== 'string' || !rel || rel.length > 200 || /[\x00-\x1f\x7f\\]/.test(rel)) throw fail('wiki_path_invalid');
    const parts = rel.split('/');
    if (parts.length > 3 || parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.') || /[:*?"<>|]/.test(part) || /[. ]$/.test(part))) throw fail('wiki_path_invalid');
    const full = path.join(this.root, ...parts), inside = path.relative(this.root, full);
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw fail('wiki_path_invalid');
    if (!this.#rootState()) return {full, exists: false};
    let cursor = this.root, exists = true;
    for (let i = 0; i < parts.length; i++) {
      cursor = path.join(cursor, parts[i]);
      let stat;
      try { stat = fs.lstatSync(cursor); } catch (error) { if (error.code === 'ENOENT') { exists = false; break; } throw fail('wiki_unavailable'); }
      if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw fail('wiki_path_refused');
    }
    if (exists) {
      let real, base;
      try { real = fs.realpathSync(full); base = fs.realpathSync(this.root); } catch { throw fail('wiki_unavailable'); }
      const within = path.relative(base, real);
      if (!within || within.startsWith('..') || path.isAbsolute(within)) throw fail('wiki_path_refused');
    }
    return {full, exists};
  }

  // Bounded text of a regular file, or null when it does not exist.
  #text(rel) {
    const {full, exists} = this.#resolve(rel);
    if (!exists) return null;
    let stat;
    try { stat = fs.lstatSync(full); } catch { return null; }
    if (stat.size > LIMITS.fileBytes) throw fail('wiki_file_too_large');
    try { return fs.readFileSync(full, 'utf8').replace(/^﻿/, ''); } catch { throw fail('wiki_unavailable'); }
  }

  #write(rel, text) {
    const {full} = this.#resolve(rel);
    fs.mkdirSync(path.dirname(full), {recursive: true});
    const tmp = path.join(path.dirname(full), `.${randomUUID()}.tmp`);
    try { fs.writeFileSync(tmp, text, {encoding: 'utf8', flag: 'wx'}); fs.renameSync(tmp, full); }
    finally { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* left for the owner to remove */ } }
  }

  #log(line) {
    try {
      const {full, exists} = this.#resolve('log.md');
      if (exists && fs.lstatSync(full).size > LIMITS.logBytes) { const old = this.#resolve('log.1.md'); if (old.exists) fs.unlinkSync(old.full); fs.renameSync(full, old.full); }
      fs.mkdirSync(this.root, {recursive: true});
      fs.appendFileSync(full, `- [${stamp(this.now())}] ${line.replace(/[\x00-\x1f\x7f]/g, ' ')}\n`, 'utf8');
      return true;
    } catch { return false; }
  }

  // Directory walk: index entries, domain directories, pages. Links and hidden names are never followed.
  #scan() {
    const result = {exists: false, index: {exists: false, lines: [], entries: []}, domains: new Map(), stray: [], refused: [], pages: 0, bytes: 0, overflow: false};
    if (!this.#rootState()) return result;
    result.exists = true;
    let top;
    try { top = fs.readdirSync(this.root, {withFileTypes: true}); } catch { throw fail('wiki_unavailable'); }
    const entriesOf = text => splitLines(text).map(line => ({line, match: ENTRY.exec(line)})).filter(item => item.match).map(item => ({line: item.line, label: item.match[1], target: item.match[2], rest: item.match[3]}));
    const readSmall = rel => { try { return this.#text(rel); } catch { return null; } };
    for (const entry of top.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) { result.refused.push(entry.name); continue; }
      if (entry.isFile()) {
        if (!/\.md$/i.test(entry.name)) continue;
        try { result.bytes += fs.lstatSync(path.join(this.root, entry.name)).size; } catch { /* vanished */ }
        if (!TOP_FILES.has(entry.name)) result.stray.push(entry.name);
        continue;
      }
      if (!entry.isDirectory() || result.domains.size >= 64) continue;
      const domain = {name: entry.name, readme: null, pages: [], subdirs: []};
      let inner;
      try { inner = fs.readdirSync(path.join(this.root, entry.name), {withFileTypes: true}); } catch { continue; }
      for (const item of inner.sort((a, b) => a.name.localeCompare(b.name))) {
        if (item.name.startsWith('.')) continue;
        if (item.isSymbolicLink()) { result.refused.push(`${entry.name}/${item.name}`); continue; }
        if (item.isDirectory()) { domain.subdirs.push(item.name); continue; }
        if (!item.isFile() || !/\.md$/i.test(item.name)) continue;
        let stat;
        try { stat = fs.lstatSync(path.join(this.root, entry.name, item.name)); } catch { continue; }
        result.bytes += stat.size;
        if (item.name === 'README.md') continue;
        if (result.pages >= LIMITS.pages) { result.overflow = true; continue; }
        result.pages += 1;
        domain.pages.push({file: item.name, rel: `${entry.name}/${item.name}`, size: stat.size, mtimeMs: stat.mtimeMs});
      }
      const readme = inner.some(item => item.name === 'README.md' && item.isFile()) ? readSmall(`${entry.name}/README.md`) : null;
      if (readme !== null) domain.readme = {entries: entriesOf(readme)};
      result.domains.set(entry.name, domain);
    }
    const index = top.some(entry => entry.name === 'MEMORY.md' && entry.isFile()) ? readSmall('MEMORY.md') : null;
    if (index !== null) result.index = {exists: true, lines: splitLines(index), entries: entriesOf(index)};
    return result;
  }

  /** Pages the search index may read: `<domain>/<topic>.md` of a domain that has a README.md. */
  pages() {
    let scan;
    try { scan = this.#scan(); } catch { return []; }
    const list = [];
    for (const domain of scan.domains.values()) if (domain.readme) for (const page of domain.pages) if (page.size <= LIMITS.fileBytes) list.push({rel: page.rel, size: page.size, mtimeMs: page.mtimeMs});
    return list;
  }

  /** Text of one page for the index, or null. Never throws. */
  pageText(rel) { try { return this.#text(rel); } catch { return null; } }

  /**
   * `{exists, domains: [{name, description, listed, topics: [{name, path, description, listed,
   * bytes}]}], pages, bytes, limits}`. Domains listed in MEMORY.md come first, in its order.
   */
  tree() {
    const scan = this.#scan();
    const listed = scan.index.entries.map(entry => ({name: entry.target.split('/')[0], description: entry.rest.replace(/^\s*[—–:-]\s*/, '').trim()}));
    const names = [...new Set([...listed.map(item => item.name), ...scan.domains.keys()])].filter(name => scan.domains.has(name));
    const domains = names.map(name => {
      const domain = scan.domains.get(name), entries = domain.readme?.entries || [];
      const describe = new Map(entries.map(entry => [entry.target, entry.rest.replace(/^\s*[—–:-]\s*/, '').trim()]));
      return {name, description: (listed.find(item => item.name === name)?.description || '').slice(0, 200), listed: listed.some(item => item.name === name), hasReadme: !!domain.readme,
        topics: domain.pages.map(page => ({name: page.file.replace(/\.md$/i, ''), path: page.rel, description: (describe.get(page.file) || '').slice(0, 200), listed: describe.has(page.file), bytes: page.size}))};
    });
    return {exists: scan.exists, domains, pages: scan.pages, bytes: scan.bytes, limits: {domains: LIMITS.domains, topics: LIMITS.topics, pages: LIMITS.pages, bytes: LIMITS.bytes, pageLines: LIMITS.pageLines, pageChars: LIMITS.pageChars, bodyLine: LIMITS.bodyLine}, sections: [...SECTIONS]};
  }

  /**
   * One file of the wiki: `{path, text, truncated, sha, front: {name, description, scope},
   * sections: [{name, heading, line, end}], lines, chars}`. `maxChars` bounds `text` only; `sha`
   * is of the whole file. Line numbers are 1-based.
   */
  readPage(rel, {maxChars = 16000} = {}) {
    const text = this.#text(rel);
    if (text === null) throw fail('wiki_not_found');
    const lines = splitLines(text), parsed = parsePage(lines);
    return {path: rel, text: text.slice(0, maxChars), truncated: text.length > maxChars, sha: sha(text),
      front: {name: (parsed.front.name || '').slice(0, 200), description: (parsed.front.description || '').slice(0, 300), scope: (parsed.front.scope || '').slice(0, 300)},
      sections: parsed.sections.map(section => ({name: section.name, heading: section.heading.slice(0, 80), line: section.line, end: section.end})), lines: lines.length, chars: text.length};
  }

  /** sha256 of a page's current text, or null when it does not exist or cannot be read. */
  pageSha(rel) { try { const text = this.#text(rel); return text === null ? null : sha(text); } catch { return null; } }

  /** Structural checks: `{ok, errors: [{code, path, detail}], warnings: [...], pages, bytes}`. Never throws for bad content. */
  lint() {
    const scan = this.#scan(), errors = [], warnings = [];
    const push = (list, code, at, detail = '') => { if (list.length < LIMITS.findings) list.push({code, path: at, detail: String(detail).slice(0, 160)}); };
    if (!scan.exists) return {ok: true, errors, warnings, pages: 0, bytes: 0};
    for (const name of scan.refused) push(errors, 'link_refused', name);
    for (const name of scan.stray) push(errors, 'top_level_page', name, 'move it into a domain');
    if (scan.overflow) push(errors, 'too_many_pages', '', `more than ${LIMITS.pages}`);
    if (scan.bytes > LIMITS.bytes) push(errors, 'wiki_too_large', '', `${scan.bytes}/${LIMITS.bytes} bytes`);
    const other = scan.index.lines.filter(line => line.trim() && !line.startsWith('- [')).length;
    if (other) push(errors, 'index_other_lines', 'MEMORY.md', `${other} lines that are not domain entries`);
    const linked = [...new Set(scan.index.entries.map(entry => entry.target.split('/')[0]))];
    if (linked.filter(name => name !== SPECIAL).length > LIMITS.domains) push(errors, 'too_many_domains', 'MEMORY.md', `${linked.filter(name => name !== SPECIAL).length}/${LIMITS.domains}`);
    for (const entry of scan.index.entries) if (entry.line.length > LIMITS.indexLine) push(errors, 'index_line_too_long', 'MEMORY.md', `${entry.line.length}/${LIMITS.indexLine}`);
    for (const name of scan.domains.keys()) if (!linked.includes(name)) push(errors, 'domain_unlisted', `${name}/`, 'not listed in MEMORY.md');
    const where = new Map(), links = [];
    for (const name of linked) {
      const domain = scan.domains.get(name);
      if (!domain?.readme) { push(errors, 'readme_missing', `${name}/README.md`); continue; }
      const tops = domain.readme.entries;
      if (tops.length > LIMITS.topics) push(errors, 'too_many_topics', `${name}/README.md`, `${tops.length}/${LIMITS.topics}`);
      else if (tops.length >= LIMITS.topics * LIMITS.warn) push(warnings, 'topics_near_budget', `${name}/README.md`, `${tops.length}/${LIMITS.topics}`);
      for (const entry of tops) if (entry.line.length > LIMITS.readmeLine) push(errors, 'readme_line_too_long', `${name}/README.md`, `${entry.line.length}/${LIMITS.readmeLine}`);
      for (const sub of domain.subdirs) push(warnings, 'subdirectory_ignored', `${name}/${sub}/`);
      const listed = new Set(tops.map(entry => entry.target)), files = new Set(domain.pages.map(page => page.file));
      for (const page of domain.pages) if (!listed.has(page.file)) push(errors, 'orphan_page', page.rel, `not listed in ${name}/README.md`);
      for (const target of listed) if (!files.has(target)) push(errors, 'missing_page', `${name}/README.md`, target.slice(0, 80));
      for (const page of domain.pages) {
        where.set(page.file, [...(where.get(page.file) || []), page.rel]);
        if (page.size > LIMITS.fileBytes) { push(errors, 'page_budget', page.rel, `${page.size} bytes`); continue; }
        const text = this.pageText(page.rel);
        if (text === null) { push(errors, 'page_unreadable', page.rel); continue; }
        const checked = lintPage(page.rel, text);
        for (const item of checked.errors) push(errors, item.code, item.path, item.detail);
        for (const item of checked.warnings) push(warnings, item.code, item.path, item.detail);
        for (const link of checked.links) links.push([page.rel, link]);
      }
    }
    for (const [file, rels] of where) if (rels.length > 1) push(errors, 'page_name_duplicate', rels.join(', ').slice(0, 160), file);
    for (const [rel, link] of links) if (!where.has(`${link}.md`)) push(warnings, 'link_without_page', rel, link);
    return {ok: errors.length === 0, errors, warnings, pages: scan.pages, bytes: scan.bytes};
  }

  #name(value) {
    if (typeof value !== 'string' || !NAME.test(value) || RESERVED.test(value)) throw fail('wiki_name_invalid');
    return value;
  }

  /** Owner-initiated: a new domain directory with an empty README.md, listed in MEMORY.md. */
  createDomain({name, description = ''} = {}) {
    const domain = this.#name(name), scan = this.#scan();
    const about = description === '' ? '' : oneLine(description, LIMITS.description);
    if ([...scan.domains.keys()].some(existing => existing.toLowerCase() === domain.toLowerCase())) throw fail('wiki_exists');
    const linked = new Set(scan.index.entries.map(entry => entry.target.split('/')[0]));
    if (domain !== SPECIAL && [...linked].filter(item => item !== SPECIAL).length >= LIMITS.domains) throw fail('wiki_domains_full');
    const line = `- [${domain}](${domain}/README.md)${about ? ` — ${about}` : ''}`;
    if (line.length > LIMITS.indexLine) throw fail('wiki_line_too_long');
    const index = scan.index.exists ? this.#text('MEMORY.md') || '' : '';
    this.#write(`${domain}/README.md`, '');
    this.#write('MEMORY.md', index + (index && !/\n$/.test(index) ? '\n' : '') + line + '\n');
    this.#log(`create | ${domain}/`);
    return {domain};
  }

  /** Owner-initiated: a new topic page with front matter and the four empty sections, listed in the domain README. */
  createPage({domain, topic, description, scope} = {}) {
    const dir = this.#name(domain), name = this.#name(topic), about = oneLine(description, LIMITS.description), covers = scope === undefined || scope === '' ? about : oneLine(scope, 200);
    const scan = this.#scan(), found = scan.domains.get(dir);
    if (!found?.readme) throw fail('wiki_not_found');
    if (found.pages.some(page => page.file.toLowerCase() === `${name}.md`.toLowerCase())) throw fail('wiki_exists');
    if (found.readme.entries.length >= LIMITS.topics) throw fail('wiki_topics_full');
    const line = `- [${name}](${name}.md) — ${about}`;
    if (line.length > LIMITS.readmeLine) throw fail('wiki_line_too_long');
    const text = `---\nname: ${name}\ndescription: ${about}\nscope: ${covers}\n---\n# ${name}\n\n${SECTIONS.map(section => `## ${section}\n`).join('\n')}`;
    if (scan.pages >= LIMITS.pages || scan.bytes + Buffer.byteLength(text) + Buffer.byteLength(line) > LIMITS.bytes) throw fail('wiki_full');
    const readme = this.#text(`${dir}/README.md`) || '';
    this.#write(`${dir}/${name}.md`, text);
    this.#write(`${dir}/README.md`, readme + (readme && !/\n$/.test(readme) ? '\n' : '') + line + '\n');
    this.#log(`create | ${dir}/${name}.md`);
    return {page: `${dir}/${name}.md`, sha: sha(text)};
  }

  /**
   * One deterministic change to one line of one section of an existing topic page:
   * add (a new `- text` bullet at the end of the section; a missing section is created in its
   * fixed place), replace or remove (the line numbered `targetLine`, which must be a content
   * line of that section). The new page text must pass the page checks or nothing is written
   * (`wiki_lint_failed` with `details`). The write is atomic; one line is appended to log.md.
   * `expectedSha`: refuse (`wiki_page_changed`) when the page is no longer that text.
   * @returns {{page: string, sha: string, line: number|null, logged: boolean}}
   */
  applyChange({page, section, op, text, targetLine = null, expectedSha} = {}) {
    if (typeof page !== 'string' || !/^[^/]+\/[^/]+\.md$/.test(page) || /\/README\.md$/i.test(page)) throw fail('wiki_path_invalid');
    if (!SECTIONS.includes(section)) throw fail('wiki_section_invalid');
    if (!['add', 'replace', 'remove'].includes(op)) throw fail('wiki_invalid_request');
    const before = this.#text(page);
    if (before === null) throw fail('wiki_not_found');
    if (expectedSha !== undefined && expectedSha !== sha(before)) throw fail('wiki_page_changed');
    let bullet = null;
    if (op !== 'remove') {
      const body = oneLine(typeof text === 'string' ? text.replace(/^\s*[-*]\s+/, '') : text, LIMITS.bodyLine - 2);
      if (/^(?:#|---|```)/.test(body)) throw fail('wiki_text_invalid');
      bullet = `- ${body}`;
    }
    const eol = before.includes('\r\n') ? '\r\n' : '\n', lines = splitLines(before);
    let parsed = parsePage(lines), target = parsed.sections.find(item => item.name === section), changed = null;
    if (op === 'add') {
      if (!target) {
        const order = SECTIONS.indexOf(section), later = parsed.sections.find(item => item.name === HISTORY_SECTION || item.name && SECTIONS.indexOf(item.name) > order);
        const at = later ? later.line - 1 : lines.length;
        const block = [...(at > 0 && lines[at - 1].trim() ? [''] : []), `## ${section}`, ...(later ? [''] : [])];
        lines.splice(at, 0, ...block);
        parsed = parsePage(lines); target = parsed.sections.find(item => item.name === section);
      }
      let at = target.end;
      while (at > target.line && !lines[at - 1].trim()) at--;
      lines.splice(at, 0, bullet);
      changed = at + 1;
    } else {
      if (!target || !Number.isInteger(targetLine) || targetLine <= target.line || targetLine > target.end || !lines[targetLine - 1].trim()) throw fail('wiki_target_invalid');
      if (op === 'replace') { lines[targetLine - 1] = /^\s*/.exec(lines[targetLine - 1])[0] + bullet; changed = targetLine; }
      else lines.splice(targetLine - 1, 1);
    }
    const after = lines.join(eol) + eol;
    const checked = lintPage(page, after);
    if (checked.errors.length) throw fail('wiki_lint_failed', checked.errors.slice(0, 10).map(item => ({code: item.code, detail: item.detail})));
    if (after.length > before.length) { const scan = this.#scan(); if (scan.bytes + Buffer.byteLength(after) - Buffer.byteLength(before) > LIMITS.bytes) throw fail('wiki_full'); }
    this.#write(page, after);
    const logged = this.#log(`${op} | ${page} | ${section}${bullet ? ` | ${bullet.slice(2, 122)}` : ''}`);
    return {page, sha: sha(after), line: changed, logged};
  }
}

module.exports = {WikiStore, SECTIONS, LIMITS, CODES, parsePage, isHistoryLine, lintPage, splitLines, sha};
