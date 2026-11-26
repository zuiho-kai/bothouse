'use strict';
// One profile's memory wiki and nightly reflection, as used by the App conversation
// (local-companion.cjs). This module only wires the parts in ./wiki and ./reflection together:
// lazy files, the per-character switches, one model run at a time, and the schedule check.
// Everything here is off until the owner switches it on, and nothing here lets a model's text
// change a wiki page or a rule: models only add pending proposals / candidates, and each one is
// applied by a separate owner decision. This file holds no bothouse code.
const fs = require('node:fs');
const path = require('node:path');
const {WikiStore} = require('./wiki/wiki-store.cjs');
const {WikiSearch} = require('./wiki/wiki-search.cjs');
const {WikiRecall} = require('./wiki/wiki-recall.cjs');
const {WikiProposals, CHARACTER} = require('./wiki/wiki-proposals.cjs');
const {proposeFromConversation} = require('./wiki/wiki-propose.cjs');
const {ReflectionStore} = require('./reflection/reflection-store.cjs');
const {runReflection} = require('./reflection/reflection-runner.cjs');
const {localDay} = require('./reflection/reflection-collector.cjs');

const fail = code => Object.assign(new Error(`Companion knowledge unavailable (${code}).`), {code});
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => { if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) throw fail('invalid_request'); return value; };
const characterOf = value => { if (!plain(value) || typeof value.characterId !== 'string' || !CHARACTER.test(value.characterId)) throw fail('invalid_request'); return value.characterId; };

class CompanionKnowledge {
  /**
   * @param {object} options
   * @param {string} options.root the profile's local-companion directory
   * @param {(characterId: string) => object[]} options.rowsFor that character's stored App conversation, oldest
   *   first; throws a coded error (character_missing, storage_unavailable) when there is none to read
   * @param {(prompt: string, signal: AbortSignal) => Promise<string>} options.ask one tool-less model reply
   * @param {(characterId: string) => {read: boolean, propose: boolean}} options.access the wiki switches
   * @param {() => number} [options.now]
   * @param {() => void} [options.onChange]
   */
  constructor({root, rowsFor, ask, access, now = Date.now, onChange = () => {}} = {}) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw fail('unavailable');
    Object.assign(this, {root, rowsFor, ask, access, now, onChange});
    this.wikiRoot = path.join(root, 'wiki'); this.proposalFile = path.join(root, 'wiki-proposals.sqlite'); this.reflectionFile = path.join(root, 'reflection.sqlite');
    this.parts = null; this.proposalStore = null; this.reflectionStore = null; this.running = null; this.schedule = null;
  }

  // No file is created by constructing these.
  #wiki() {
    if (!this.parts) { const store = new WikiStore({root: this.wikiRoot, now: this.now}), search = new WikiSearch({store, now: this.now}); this.parts = {store, search, recall: new WikiRecall({search})}; }
    return this.parts;
  }

  #proposals(create = false) {
    if (!this.proposalStore && (create || fs.existsSync(this.proposalFile))) this.proposalStore = new WikiProposals({file: this.proposalFile, store: this.#wiki().store, now: this.now});
    return this.proposalStore;
  }

  #reflection(create = false) {
    if (!this.reflectionStore && (create || fs.existsSync(this.reflectionFile))) this.reflectionStore = new ReflectionStore({file: this.reflectionFile, now: this.now});
    return this.reflectionStore;
  }

  #switches(characterId) { try { const value = this.access(characterId); return {read: value?.read === true, propose: value?.propose === true}; } catch { return {read: false, propose: false}; } }

  // One model run at a time for the whole profile (a proposal run or a reflection run).
  async #exclusive(kind, characterId, work) {
    if (this.running) throw fail('busy');
    const run = {kind, characterId, controller: new AbortController()};
    this.running = run; this.onChange();
    try { return await work(prompt => this.ask(prompt, run.controller.signal)); }
    finally { if (this.running === run) this.running = null; this.onChange(); }
  }

  /** Aborts a proposal or reflection run in flight (its outcome is then a failed run; nothing is stored). */
  cancel() { this.running?.controller.abort(); }

  // ---- Wiki ----

  /** The wiki outline plus the number of pending proposals. */
  wikiTree() { const proposals = this.#proposals(); return {...this.#wiki().store.tree(), pendingProposals: proposals ? proposals.pendingCount() : 0}; }

  /** One wiki file (bounded text, front matter, sections with line numbers, sha). */
  wikiPage(rel) { return this.#wiki().store.readPage(rel); }

  wikiLint() { return this.#wiki().store.lint(); }

  /** Owner-initiated: creates the domain when it does not exist yet, and the topic page when `topic` is given. */
  wikiCreate(value) {
    const {domain, topic, description = '', scope} = only(value, ['domain', 'topic', 'description', 'scope']);
    const {store} = this.#wiki(), exists = store.tree().domains.some(item => item.name === domain && item.hasReadme);
    if (topic === undefined || topic === null || topic === '') {
      if (exists) throw fail('wiki_exists');
      store.createDomain({name: domain, description});
    } else {
      if (!exists) store.createDomain({name: domain});
      store.createPage({domain, topic, description, ...(scope === undefined ? {} : {scope})});
    }
    this.onChange();
    return {tree: this.wikiTree()};
  }

  /** `{proposals}`: newest first, at most 100; `state` filters. */
  wikiProposals(value = {}) {
    const {state} = only(value ?? {}, ['state']), proposals = this.#proposals();
    return {proposals: proposals ? proposals.list(state === undefined || state === null ? {} : {state}) : []};
  }

  /**
   * The owner asks one character to read what the owner said since its last run and to propose
   * wiki changes. Needs that character's "can propose" switch. Resolves `{problem, read,
   * proposed, dropped}`; rejects with a coded error (busy, wiki_propose_off, character_missing,
   * credentials_missing, unsupported, ...).
   */
  async wikiPropose(value) {
    const characterId = characterOf(only(value, ['characterId']));
    if (!this.#switches(characterId).propose) throw fail('wiki_propose_off');
    const rows = this.rowsFor(characterId), {store, search} = this.#wiki();
    return this.#exclusive('wiki', characterId, ask => proposeFromConversation({characterId, rows, store, search, proposals: this.#proposals(true), ask, now: this.now()}));
  }

  /** The owner approves (optionally with their own wording) or rejects one pending proposal. */
  wikiDecide(value) {
    const {id, action, text, note} = only(value, ['id', 'action', 'text', 'note']), proposals = this.#proposals();
    if (!proposals) throw fail('wiki_proposal_not_found');
    if (action !== 'approve' && action !== 'reject' || (action === 'approve' ? note !== undefined : text !== undefined)) throw fail('invalid_request');
    const result = action === 'approve' ? proposals.approve(id, text === undefined ? {} : {text}) : proposals.reject(id, note === undefined ? '' : note);
    this.onChange();
    return {state: result.state, proposal: result.proposal};
  }

  /**
   * Wiki lines for one turn of one character, or [] (switch off, nothing found, any failure).
   * Each stateless request receives its own relevant lines; no earlier turn suppresses them.
   */
  recallFor(characterId, text) {
    try {
      if (typeof characterId !== 'string' || !this.#switches(characterId).read || !fs.existsSync(this.wikiRoot)) return [];
      return this.#wiki().recall.recall(text).pages;
    } catch { return []; }
  }

  // ---- Reflection ----

  #entries() {
    if (!this.schedule) { const store = this.#reflection(); this.schedule = store ? store.enabled().map(item => ({characterId: item.characterId, hour: item.hour, scheduledDay: item.scheduledDay})) : []; }
    return this.schedule;
  }

  /**
   * Characters whose scheduled run is due right now: switched on, the local hour is the chosen
   * hour, and no scheduled run was claimed for today. Memory only after the first call.
   */
  reflectionDue(now = this.now()) {
    try { const hour = new Date(now).getHours(), day = localDay(now); return this.#entries().filter(item => item.hour === hour && item.scheduledDay !== day).map(item => item.characterId); }
    catch { return []; }
  }

  /**
   * To be called from the app's poll. Starts at most one scheduled run (in the background) and
   * returns `{started: [characterId]}`. A day's run is claimed before the model is asked, so it
   * is not repeated that day whatever its outcome. Never throws.
   */
  reflectionTick(now = this.now()) {
    try {
      if (this.running) return {started: []};
      const characterId = this.reflectionDue(now)[0];
      if (!characterId) return {started: []};
      const store = this.#reflection(), day = localDay(now), entry = this.schedule.find(item => item.characterId === characterId);
      const claimed = store.claimScheduled(characterId, day);
      if (entry) entry.scheduledDay = day;
      if (!claimed) return {started: []};
      void this.#reflect(characterId, 'scheduled', now).catch(() => {});
      return {started: [characterId]};
    } catch { return {started: []}; }
  }

  async #reflect(characterId, kind, now) {
    const store = this.#reflection(true), day = localDay(now);
    let rows;
    try { rows = this.rowsFor(characterId); }
    catch (error) { if (kind === 'scheduled') { store.finishRun(characterId, {kind, day, outcome: 'unavailable'}); return {outcome: 'unavailable', read: 0, created: 0, merged: 0, pending: 0}; } throw error; }
    try { return await this.#exclusive('reflection', characterId, ask => runReflection({characterId, rows, store, ask, now, kind})); }
    catch (error) { if (kind === 'scheduled' && error?.code !== 'busy') { try { store.finishRun(characterId, {kind, day, outcome: 'failed'}); } catch { /* journal only */ } } throw error; }
    finally { this.schedule = null; }
  }

  /** `{characterId, enabled, hour, lastRunAt, lastOutcome, lastRead, missed, running}`. */
  reflectionStatus(value, now = this.now()) {
    const characterId = characterOf(only(value, ['characterId'])), store = this.#reflection();
    const settings = store ? store.settings(characterId) : {enabled: false, hour: 3, lastRunAt: null, lastOutcome: null, lastRead: null, scheduledDay: null};
    const today = localDay(now), ranToday = settings.scheduledDay === today || (settings.lastRunAt !== null && localDay(settings.lastRunAt) === today);
    return {characterId, enabled: settings.enabled, hour: settings.hour, lastRunAt: settings.lastRunAt, lastOutcome: settings.lastOutcome, lastRead: settings.lastRead,
      // The chosen hour went by today without a run (for example the app was closed): offered as a manual run, never started automatically.
      missed: settings.enabled && !ranToday && new Date(now).getHours() > settings.hour,
      running: this.running?.kind === 'reflection' && this.running.characterId === characterId};
  }

  /** The owner switches reflection on / off for one character and chooses the local hour (0-23). */
  reflectionConfigure(value) {
    const {enabled, hour} = only(value, ['characterId', 'enabled', 'hour']), characterId = characterOf(value);
    this.#reflection(true).configure(characterId, {...(enabled === undefined ? {} : {enabled}), ...(hour === undefined ? {} : {hour})});
    this.schedule = null; this.onChange();
    return this.reflectionStatus({characterId});
  }

  /** A manual run, in addition to the scheduled one. Needs the character's reflection switched on. */
  async reflectionRun(value) {
    const characterId = characterOf(only(value, ['characterId'])), store = this.#reflection();
    if (!store || !store.settings(characterId).enabled) throw fail('reflection_off');
    if (this.running) throw fail('busy');
    return this.#reflect(characterId, 'manual', this.now());
  }

  /** `{candidates, seenOnce, atCap}`: the pending rule candidates, how many single observations are kept, and whether the rule list is full. */
  reflectionCandidates(value) {
    const characterId = characterOf(only(value, ['characterId'])), store = this.#reflection();
    if (!store) return {candidates: [], seenOnce: 0, atCap: false};
    return {candidates: store.candidates(characterId, {states: ['pending']}), seenOnce: store.candidates(characterId, {states: ['seen']}).length, atCap: store.rules(characterId).atCap};
  }

  /** The owner approves (optionally with their own wording) or rejects one candidate. */
  reflectionDecide(value) {
    const {id, action, text} = only(value, ['id', 'action', 'text']), store = this.#reflection();
    if (!store) throw fail('reflection_candidate_not_found');
    const result = store.decide(id, action, text === undefined ? {} : {text});
    this.onChange();
    return result;
  }

  /** `{rules, count, chars, atCap, limits}` of one character. */
  reflectionRules(value) {
    const characterId = characterOf(only(value, ['characterId'])), store = this.#reflection();
    return store ? store.rules(characterId) : {rules: [], count: 0, chars: 0, atCap: false, limits: {rules: 20, chars: 1500, text: 200}};
  }

  /** The owner switches one rule on / off (`enabled`) or deletes it (`remove: true`). */
  reflectionRule(value) {
    const {id, enabled, remove} = only(value, ['id', 'enabled', 'remove']), store = this.#reflection();
    if (!store) throw fail('reflection_rule_not_found');
    const result = store.updateRule(id, {...(enabled === undefined ? {} : {enabled}), ...(remove === undefined ? {} : {remove})});
    this.onChange();
    return result;
  }

  /** Texts of the approved, enabled rules of one character for its prompt. Never throws; no file is created. */
  rulesFor(characterId) {
    try { const store = typeof characterId === 'string' && CHARACTER.test(characterId) ? this.#reflection() : null; return store ? store.activeRules(characterId) : []; }
    catch { return []; }
  }
}

module.exports = {CompanionKnowledge};
