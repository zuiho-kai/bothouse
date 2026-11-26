'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {atomicJSON} = require('../../core/files.cjs');
const {publicCatalog} = require('../../core/personas.cjs');
const settings = require('./local-settings.cjs');

// Only migrated conversations own overrides. The original profile settings and
// their on-disk format continue to serve the owner's other characters and groups.
class MigratedLorebooks {
  constructor(localRoot) {
    this.root = path.join(localRoot, 'migrated-lorebooks');
    this.cache = new Map();
  }
  key({characterId, builtinPersonaId, groupId}) {
    return groupId ? null : characterId || builtinPersonaId || null;
  }
  file(id) {
    if (!/^[0-9a-f]{16}$/.test(id) && !publicCatalog().some(role => role.id === id)) throw Error('Invalid role ID.');
    return path.join(this.root, id + '.json');
  }
  get(id) {
    if (!id) return null;
    if (this.cache.has(id)) return this.cache.get(id);
    let record = null;
    try {
      const file = this.file(id), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > 2048) throw Error('Invalid migrated lorebook settings.');
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (value.version !== 1 || value.roleId !== id || typeof value.pending !== 'boolean' ||
          !Array.isArray(value.lorebookIds) || typeof value.useCharacterBook !== 'boolean') throw Error('Invalid migrated lorebook settings.');
      const {lorebookIds, useCharacterBook} = settings.validate({lorebookIds:value.lorebookIds, useCharacterBook:value.useCharacterBook});
      record = {lorebookIds, useCharacterBook, pending:value.pending};
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.cache.set(id, record);
    return record;
  }
  write(id, {lorebookIds, useCharacterBook}, pending) {
    const record = {lorebookIds:[...lorebookIds], useCharacterBook, pending};
    atomicJSON(this.file(id), {version:1, roleId:id, ...record});
    this.cache.set(id, record);
  }
  import(id, selection, pending) {
    const existing = this.get(id);
    if (!existing || existing.pending) this.write(id, selection, pending);
  }
  effective(raw) {
    const override = this.get(this.key(raw));
    return override ? {...raw, lorebookIds:override.lorebookIds, useCharacterBook:override.useCharacterBook} : raw;
  }
}

module.exports = {MigratedLorebooks};
