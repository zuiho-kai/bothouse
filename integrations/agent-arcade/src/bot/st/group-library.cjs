'use strict';
// On-disk library of group chats for the App conversation: several library characters in one
// conversation. Each group is one file <root>/<id>.json holding the normalized group
// (vendor/sillytavern/group-chat.cjs `normalizeGroup`) plus id, timestamps and a per-member
// talkativeness map. A group is the owner's own configuration and holds only character
// library ids, never card text. Groups exist only in the App conversation, never on QQ.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {atomicJSON} = require('../../core/files.cjs');
const {normalizeGroup, TALKATIVENESS_DEFAULT} = require('../../vendor/sillytavern/group-chat.cjs');

const MAX_GROUPS = 100;
const MAX_GROUP_BYTES = 64 * 1024;
const ID = /^[0-9a-f]{16}$/;
const FILE = /^([0-9a-f]{16})\.json$/;
const INPUT_KEYS = ['id', 'name', 'members', 'mutedMembers', 'disabledMembers', 'talkativeness', 'activationStrategy', 'allowSelfResponses', 'generationMode', 'autoMode', 'warnings', 'addedAt', 'updatedAt', 'dispatcher'];
const PATCH_KEYS = ['name', 'members', 'mutedMembers', 'disabledMembers', 'talkativeness', 'activationStrategy', 'allowSelfResponses', 'generationMode', 'dispatcher'];
const fail = (message, code) => Object.assign(new Error(message), {code});
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isFile = file => { try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink() ? stat : null; } catch { return null; } };

// Strict: anything normalizeGroup would silently drop, cut or replace is refused instead.
function checked(value) {
  if (!isObject(value) || Object.keys(value).some(key => !INPUT_KEYS.includes(key))) throw fail('Invalid group.', 'group_invalid');
  if (value.mutedMembers !== undefined && value.disabledMembers !== undefined && JSON.stringify(value.mutedMembers) !== JSON.stringify(value.disabledMembers)) throw fail('Invalid muted members.', 'group_invalid');
  const muted = value.mutedMembers ?? value.disabledMembers ?? [];
  if (!Array.isArray(value.members) || !Array.isArray(muted) || muted.some(id => !value.members.includes(id)) || new Set(muted).size !== muted.length) throw fail('Invalid group members.', 'group_invalid');
  if (new Set(value.members).size !== value.members.length || !value.members.length) throw fail('Invalid group members.', 'group_invalid');
  if (value.allowSelfResponses !== undefined && typeof value.allowSelfResponses !== 'boolean') throw fail('Invalid group.', 'group_invalid');
  // A normalizeGroup result may be passed as it is; auto mode itself does not exist here.
  if (value.autoMode !== undefined && value.autoMode !== false) throw fail('Auto mode is not supported.', 'group_invalid');
  if (typeof value.name !== 'string' || /[\x00-\x1f\x7f]/.test(value.name)) throw fail('The group needs a name.', 'group_invalid');
  let group;
  try { group = normalizeGroup({name: value.name, members: value.members, disabledMembers: muted, activationStrategy: value.activationStrategy, allowSelfResponses: value.allowSelfResponses, generationMode: value.generationMode}); }
  catch { throw fail('Invalid group.', 'group_invalid'); }
  if (group.warnings.length || group.members.length !== value.members.length) throw fail('Invalid group.', 'group_invalid');
  const talk = value.talkativeness ?? {};
  if (!isObject(talk) || Object.keys(talk).some(id => !group.members.includes(id))) throw fail('Invalid talkativeness.', 'group_invalid');
  const talkativeness = {};
  for (const member of group.members) {
    const item = talk[member] === undefined ? TALKATIVENESS_DEFAULT : talk[member];
    if (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 1) throw fail('Invalid talkativeness.', 'group_invalid');
    talkativeness[member] = item;
  }
  // dispatcher: whether the model-assisted speaker choice (group-dispatcher.cjs) may run for this
  // group. Off by default; a file written before it existed simply reads as off.
  const dispatcher = value.dispatcher ?? {enabled: false};
  if (!isObject(dispatcher) || Object.keys(dispatcher).some(key => key !== 'enabled') || typeof dispatcher.enabled !== 'boolean') throw fail('Invalid dispatcher setting.', 'group_invalid');
  return {name: group.name, members: [...group.members], mutedMembers: [...group.disabledMembers], talkativeness,
    activationStrategy: group.activationStrategy, allowSelfResponses: group.allowSelfResponses, generationMode: group.generationMode, dispatcher: {enabled: dispatcher.enabled}};
}

// `disabledMembers` mirrors `mutedMembers` so a record can be handed to pickSpeakers /
// groupCardFields as it is.
const record = (id, {dispatcher, ...group}, addedAt, updatedAt) => ({id, ...group, disabledMembers: [...group.mutedMembers], addedAt, updatedAt, dispatcher});

class GroupLibrary {
  constructor({root, now = Date.now, maxGroups = 30} = {}) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw fail('The group library needs an absolute directory.', 'group_library_invalid');
    if (!Number.isInteger(maxGroups) || maxGroups < 1 || maxGroups > MAX_GROUPS) throw fail('Invalid group limit.', 'group_library_invalid');
    this.root = root; this.now = now; this.maxGroups = maxGroups;
  }

  #file(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw fail('Invalid group id.', 'group_id_invalid');
    return path.join(this.root, `${id}.json`);
  }

  #ids() {
    let entries;
    try { entries = fs.readdirSync(this.root, {withFileTypes: true}); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return entries.filter(entry => entry.isFile() && FILE.test(entry.name)).map(entry => FILE.exec(entry.name)[1]);
  }

  #read(id) {
    const file = this.#file(id);
    const stat = isFile(file);
    if (!stat) return null;
    if (stat.size > MAX_GROUP_BYTES) throw fail('The stored group is oversized.', 'group_library_corrupt');
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (stored.id !== id || !Number.isSafeInteger(stored.addedAt) || !Number.isSafeInteger(stored.updatedAt)) throw Error('metadata');
      const {id: _id, addedAt, updatedAt, ...group} = stored;
      return record(id, checked(group), addedAt, updatedAt);
    } catch { throw fail('The stored group cannot be read.', 'group_library_corrupt'); }
  }

  #write(id, group, addedAt, updatedAt) {
    const value = checked(group);
    fs.mkdirSync(this.root, {recursive: true});
    atomicJSON(this.#file(id), {id, ...value, addedAt, updatedAt});
    return record(id, value, addedAt, updatedAt);
  }

  /** Full records sorted by name. Corrupt or foreign files are skipped. */
  list() {
    const result = [];
    for (const id of this.#ids()) {
      try { const item = this.#read(id); if (item) result.push(item); } catch { /* skip corrupt entry */ }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /**
   * `{id, name, members, mutedMembers, disabledMembers, talkativeness, activationStrategy,
   * allowSelfResponses, generationMode, addedAt, updatedAt}`, or null. Throws for a corrupt file.
   */
  get(id) { return this.#read(id); }

  add(group) {
    const value = checked(group);
    const existing = new Set(this.#ids());
    if (existing.size >= this.maxGroups) throw fail(`The library holds at most ${this.maxGroups} groups.`, 'group_library_full');
    let id;
    do id = crypto.randomBytes(8).toString('hex'); while (existing.has(id));
    const at = this.now();
    return this.#write(id, value, at, at);
  }

  /** Patch any of name, members, mutedMembers, talkativeness, activationStrategy, allowSelfResponses, generationMode. */
  update(id, patch) {
    if (!isObject(patch) || Object.keys(patch).some(key => !PATCH_KEYS.includes(key))) throw fail('Invalid group update.', 'group_invalid');
    const current = this.#read(id);
    if (!current) throw fail('No such group.', 'group_not_found');
    const {id: _id, addedAt, updatedAt: _updatedAt, disabledMembers: _mirror, ...stored} = current;
    const next = {...stored, ...patch};
    if (patch.disabledMembers !== undefined && patch.mutedMembers === undefined) { next.mutedMembers = patch.disabledMembers; }
    delete next.disabledMembers;
    // A member that left the group takes its mute flag and talkativeness with it unless the
    // same patch says otherwise.
    if (patch.members !== undefined && Array.isArray(patch.members)) {
      if (patch.mutedMembers === undefined && patch.disabledMembers === undefined) next.mutedMembers = stored.mutedMembers.filter(member => patch.members.includes(member));
      if (patch.talkativeness === undefined) next.talkativeness = Object.fromEntries(Object.entries(stored.talkativeness).filter(([member]) => patch.members.includes(member)));
    }
    return this.#write(id, next, addedAt, this.now());
  }

  /** Deletes only this group's own file. */
  remove(id) {
    const file = this.#file(id);
    if (!isFile(file)) return {removed: false, reason: 'not_found'};
    fs.unlinkSync(file);
    return {removed: true};
  }
}

module.exports = {GroupLibrary, MAX_GROUPS};
