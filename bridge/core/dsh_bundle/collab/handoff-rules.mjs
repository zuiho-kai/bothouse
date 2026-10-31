// Handoff checks driven by handoff-rules.json, the single copy of the rules (its source is
// bridge/contrib/lead/handoff-rules.json; the bridge copies it next to this file when it unpacks or
// refreshes the DSH plugin, core/setup_dsh_embed.go). ws-handoff runs the same rules in Python
// (contrib/lead/_handoff_rules.py); contrib/lead/test_handoff_rules.py runs both on one set of fixtures.
// No section names, patterns or messages live here. A missing or broken rules file throws: a handoff is
// refused, never let through unchecked.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = new URL('./', import.meta.url);
// Installed: next to this file. The repo paths are for running from a checkout (dsh/collab and the
// bundle copy bridge/core/dsh_bundle/collab); an installed plugin has no checkout around it.
const CANDIDATES = ['handoff-rules.json', '../../bridge/contrib/lead/handoff-rules.json', '../../../contrib/lead/handoff-rules.json']
  .map(p => fileURLToPath(new URL(p, HERE)));

export class HandoffRulesError extends Error {}

/** Reads the rules (every call, so an edited file applies without a restart). */
export function loadRules(path) {
  const file = path ?? CANDIDATES.find(p => existsSync(p));
  if (file === undefined) throw new HandoffRulesError(`交接规则文件读不到：${CANDIDATES[0]}（重新运行 bothouse 让它解包 DSH 插件）`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new HandoffRulesError(`交接规则文件读不到：${file}（${e.message}）`);
  }
}

const head = l => l.trimStart().startsWith('#');
const stripLead = (l, lead) => { let i = 0; while (i < l.length && lead.includes(l[i])) i++; return l.slice(i); };
// Python's s.rsplit(':', 1)[0]: the whole string when it has no colon.
const beforeColon = s => (s.includes(':') ? s.slice(0, s.lastIndexOf(':')) : s);
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sections(lines, name, lead, inline = false) {
  const out = [];
  lines.forEach((l, i) => {
    if (!((head(l) && l.includes(name)) || (inline && stripLead(l, lead).startsWith(name)))) return;
    const seg = [l];
    for (const x of lines.slice(i + 1)) { if (head(x)) break; seg.push(x); }
    out.push(seg);
  });
  return out;
}

const missing = (c, names) => c.msg.replaceAll('{missing}', names.map(n => (c.item ?? '{}').replace('{}', n)).join(c.sep ?? '、'));
const captures = (segs, rx, lead) => segs.flatMap(seg => seg.slice(1)).map(x => rx.exec(stripLead(x, lead))?.[1]).filter(v => v !== undefined);

function run(c, lines, lead, key = 'msg') {
  switch (c.type) {
    case 'headings': {
      const miss = c.names.filter(n => !lines.some(l => head(l) && l.includes(n)));
      return miss.length ? missing(c, miss) : null;
    }
    case 'ref': {
      const none = new RegExp(c.none_re), path = new RegExp(c.path_re);
      for (const seg of sections(lines, c.section, lead, Boolean(c.inline))) {
        if (seg.some(x => none.test(x))) return null;
        if (seg.some(x => [...x.matchAll(new RegExp(c.ref_re, 'g'))].some(m => path.test(beforeColon(m[0]))))) return null;
      }
      return c[key];
    }
    case 'kinds': {
      const found = captures(sections(lines, c.section, lead), new RegExp(c.line_re), lead);
      const got = new Set(found);
      const mx = c.max, n = mx ? found.filter(k => k === mx.kind).length : 0;
      if (mx && n > mx.n) return mx.msg.replace('{n}', String(n));
      const miss = c.need.filter(k => !got.has(k));
      return miss.length ? missing(c, miss) : null;
    }
    case 'values': {
      const ok = new RegExp(c.ok_re), alt = new RegExp(c.or_re);
      const vals = captures(sections(lines, c.section, lead), new RegExp(c.line_re), lead).map(v => v.trim());
      if (!vals.length) return c.msg;
      return vals.some(v => !ok.test(v) && !alt.test(v)) ? c.bad_msg : null;
    }
    case 'heading_needs_field': {
      if (!lines.some(l => head(l) && c.headings.some(h => l.includes(h)))) return null;
      const rx = new RegExp(`^${escape(c.field)}\\s*[:：]\\s*\\S`);
      return lines.some(l => rx.test(stripLead(l, lead))) ? null : c[key];
    }
    default: throw new HandoffRulesError(`交接规则文件里有不认识的检查类型：${c.type}`);
  }
}

// Same lines as Python's str.splitlines for \n, \r\n and \r (no trailing empty line).
const split = text => { const a = String(text ?? '').split(/\r\n|\r|\n/); if (a.at(-1) === '') a.pop(); return a; };

/** A full handoff body (ws-handoff file, workspace handoff reason): the first failing check's message, or null. */
export function checkHandoff(text, rules = loadRules()) {
  const lines = split(text);
  for (const c of rules.checks) {
    const err = run(c, lines, rules.lead);
    if (err) return err;
  }
  return null;
}

/**
 * A field-only dispatch (/tasks: title, ref, base): the fields become a small handoff (title as its
 * heading, ref as the reference section, base as the base-branch line) and only the checks listed in
 * rules.dispatch.checks run, with their dispatch_msg.
 */
export function checkDispatch(fields, rules = loadRules()) {
  const byId = new Map(rules.checks.map(c => [c.id, c]));
  const lines = [`# ${String(fields.title ?? '').trim()}`];
  for (const [id, field] of Object.entries(rules.dispatch.fields)) {
    const c = byId.get(id), v = String(fields[field] ?? '').trim();
    if (c?.type === 'ref') lines.push(`## ${c.section}`, ...(v ? split(v) : []));
    else if (c?.type === 'heading_needs_field' && v) lines.push(`${c.field}：${v}`);
  }
  for (const id of rules.dispatch.checks) {
    const c = byId.get(id);
    if (c === undefined) throw new HandoffRulesError(`交接规则文件 dispatch 里的检查不存在：${id}`);
    const err = run(c, lines, rules.lead, 'dispatch_msg');
    if (err) return err;
  }
  return null;
}

/** Section names a handoff must carry, in order, for prompts that tell a member how to write one. */
export function requiredSections(rules = loadRules()) {
  return rules.checks.flatMap(c => (c.type === 'headings' ? c.names : c.type === 'ref' ? [c.section] : []));
}
