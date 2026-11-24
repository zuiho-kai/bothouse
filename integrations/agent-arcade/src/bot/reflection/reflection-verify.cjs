'use strict';
/*
 * Deterministic acceptance of the reflection model's output: structure, quotes, counting and
 * promotion. A model item becomes at most a "seen once" note or a rule CANDIDATE here; nothing
 * in this file can make a rule take effect.
 *
 * Adapted from bothouse, https://github.com/zuiho-kai/bothouse
 * Upstream path: bridge/contrib/wiki/llmwiki/ingest.py (`misquotes()`: quotes must be in the
 *   owner's own lines of the cited session; `dream_counts()`: "appeared N times" must equal the
 *   number of distinct sessions listed; the promotion rule R4 of `SOP_DREAM`: only a second
 *   occurrence makes a candidate, a rejected one is not proposed again).
 * Current condition (b) is verified against the same SOP_DREAM at upstream main
 * 8ec73a8f32573b5307922df3c79675a934cdefb7 (requires the preceding assistant reply).
 * Upstream revision: 218051eccbb31923aa2b0d837801cf4d82c4799f
 * License: Apache-2.0, Copyright (c) 2026 zuiho-kai and bothouse contributors
 *
 * Re-implemented and modified for Agent Arcade (AGPL-3.0) on 2026-11-13:
 * - works on JSON items and stored message ids instead of wiki lines and session ids;
 * - `count` is the number of distinct LOCAL CALENDAR DAYS covered by verified evidence. The App
 *   conversation is one long conversation per character and has no sessions, so a day stands in
 *   for upstream's session: several corrections on one day count once;
 * - the count is computed here from the evidence, never taken from the model.
 */
const {verifyEvidence, flat} = require('../wiki/quote-verify.cjs');
const {redact} = require('./reflection-collector.cjs');

const KINDS = Object.freeze(['correction', 'preference', 'rule_violated']);
const ITEM_KEYS = ['kind', 'ruleDraft', 'evidence', 'sameAs', 'ruleId'];
const DRAFT_CHARS = 200, MAX_EVIDENCE = 10, PROMOTE_DAYS = 2;
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
/** Rule drafts are compared without whitespace, punctuation and case. */
const normalise = text => flat(text).slice(0, 400);

/**
 * @param {object} input
 * @param {object[]} input.items parsed model output
 * @param {Map<string, {role: string, text: string, day: string, reply: string}>} input.messages exact exchanges offered to the model
 * @param {{id: string, kind: string, ruleDraft: string, state: 'seen'|'pending', evidence: object[], ruleId: string|null}[]} [input.existing]
 *   this character's open candidates
 * @param {string[]} [input.rejected] rule drafts the owner rejected
 * @param {{id: string, text: string, enabled: boolean}[]} [input.rules] this character's approved rules
 * @returns {{operations: {type: 'create'|'merge', id?: string, kind: string, ruleDraft: string, evidence: object[],
 *   count: number, state: 'seen'|'pending', ruleId: string|null}[], dropped: {reason: string}[]}}
 */
function verifyCandidates({items, messages, existing = [], rejected = [], rules = []} = {}) {
  const dropped = [], refused = new Set(rejected.map(normalise)), ruleIds = new Set(rules.filter(rule => rule.enabled !== false).map(rule => rule.id));
  // Working copies: several items of one run may land on the same candidate.
  const open = existing.filter(item => item.state === 'seen' || item.state === 'pending').map(item => ({...item, norm: normalise(item.ruleDraft), evidence: [...item.evidence], touched: false, created: false}));
  for (const item of Array.isArray(items) ? items : []) {
    if (!plain(item) || Object.keys(item).some(key => !ITEM_KEYS.includes(key)) || !KINDS.includes(item.kind)) { dropped.push({reason: 'malformed'}); continue; }
    const draft = typeof item.ruleDraft === 'string' ? item.ruleDraft.trim() : '';
    if (!draft || draft.length > DRAFT_CHARS || /[\x00-\x1f\x7f]/.test(draft) || redact(draft) !== draft) { dropped.push({reason: 'malformed'}); continue; }
    if (!Array.isArray(item.evidence) || !item.evidence.length || item.evidence.length > 5 || item.evidence.some(entry => !plain(entry) || Object.keys(entry).some(key => !['messageId', 'quote'].includes(key)))) { dropped.push({reason: 'malformed'}); continue; }
    const norm = normalise(draft);
    if (!norm || refused.has(norm)) { dropped.push({reason: 'rejected_before'}); continue; }
    const {verified} = verifyEvidence(item.evidence, messages);
    if (!verified.length) { dropped.push({reason: 'quote_not_found'}); continue; }
    // With no preceding reply available to the model, a genuine quote can
    // support a preference but cannot establish that the companion did something.
    const contextual = item.kind === 'preference' ? verified : verified.filter(entry => messages.get(entry.messageId).reply);
    if (!contextual.length) { dropped.push({reason: 'missing_companion_reply'}); continue; }
    const evidence = contextual.map(entry => ({messageId: entry.messageId, quote: entry.quote, day: messages.get(entry.messageId).day}));
    const ruleId = item.kind === 'rule_violated' && typeof item.ruleId === 'string' && ruleIds.has(item.ruleId) ? item.ruleId : null;
    // A preference may be valid without an earlier reply. Keep its evidence
    // separate from corrections and from changes to a particular approved rule.
    const sameCategory = candidate => candidate.kind === item.kind && (candidate.ruleId ?? null) === ruleId;
    let target = typeof item.sameAs === 'string' ? open.find(candidate => candidate.id === item.sameAs && sameCategory(candidate)) : null;
    target ||= open.find(candidate => candidate.norm === norm && sameCategory(candidate)) || null;
    if (!target) { target = {id: null, kind: item.kind, ruleDraft: draft, norm, state: 'seen', evidence: [], ruleId, touched: true, created: true}; open.push(target); }
    for (const entry of evidence) if (target.evidence.length < MAX_EVIDENCE && !target.evidence.some(known => known.messageId === entry.messageId)) target.evidence.push(entry);
    target.touched = true;
  }
  const operations = [];
  for (const candidate of open) {
    if (!candidate.touched) continue;
    const count = new Set(candidate.evidence.map(entry => entry.day)).size;
    const promoted = candidate.state === 'pending' || count >= PROMOTE_DAYS || (candidate.kind === 'rule_violated' && !!candidate.ruleId);
    operations.push({type: candidate.created ? 'create' : 'merge', ...(candidate.created ? {} : {id: candidate.id}), kind: candidate.kind, ruleDraft: candidate.ruleDraft, evidence: candidate.evidence, count, state: promoted ? 'pending' : 'seen', ruleId: candidate.ruleId || null});
  }
  return {operations, dropped};
}

module.exports = {verifyCandidates, normalise, KINDS, DRAFT_CHARS, PROMOTE_DAYS, MAX_EVIDENCE};
