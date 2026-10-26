// DSH member management for one owner: config members are seeds (read-only
// in the UI), UI members are created, edited and removed here. Names must be
// unique across every channel member (DSH members and cc-connect bots alike)
// because @-mentions are matched by name.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { CollabError } from './store.mjs';
import { checkAvatar } from './avatars.mjs';
import { PERMISSION_PRESETS } from './cli-member.mjs';

const MAX_NAME = 32;
const MAX_PERSONA = 4000;
const RESERVED = new Set(['owner', 'user', 'system']);
const MODEL_LIST_TIMEOUT_MS = 5_000;
/** Local CLI agents a member may run as (task spec 2026-10-23: cli: 'claude' | 'codex' | 'gemini'). */
export const CLIS = ['claude', 'codex', 'gemini'];

/** Store row → the member shape DshMembers and the hub use. */
export function rowToMember(row) {
  return {
    id: row.id,
    name: row.name,
    ...(row.name_customized == null ? {} : { nameCustomized: Boolean(row.name_customized) }),
    ...(row.provider && row.model ? { model: { provider: row.provider, model: row.model } } : {}),
    ...(row.cli ? { cli: row.cli } : {}),
    ...(row.cli && row.permission_preset ? { permissionPreset: row.permission_preset } : {}),
    persona: row.persona ?? '',
    ...(row.avatar ? { avatar: row.avatar } : {}),
    ...(row.rooms && row.rooms !== '[]' ? { rooms: JSON.parse(row.rooms) } : {}),
    source: row.source,
  };
}

export class Roster {
  /**
   * @param hub - Hub instance (member registry for uniqueness).
   * @param dsh - DshMembers (runtime routing).
   * @param llm - DSH `ctx.llm` service, or undefined to skip model checks.
   */
  constructor(hub, dsh, llm) {
    this.hub = hub;
    this.store = hub.store;
    this.dsh = dsh;
    this.llm = llm;
  }

  /** Write config members as seeds, then publish every active member. */
  load(configMembers) {
    this.store.transaction(() => { for (const m of configMembers) this.store.seedMember(m); });
    // The members table has no preset columns: a config member's agentPreset and
    // permissionPreset come from the config itself, or they never reach its Sessions.
    const presets = new Map(configMembers.map(m => [m.id, {
      ...(m.agentPreset === undefined ? {} : { agentPreset: m.agentPreset }),
      ...(m.permissionPreset === undefined ? {} : { permissionPreset: m.permissionPreset }),
    }]));
    for (const row of this.store.members()) this.dsh.putMember({ ...rowToMember(row), ...(row.source === 'ui' ? {} : presets.get(row.id)) });
  }

  /**
   * Add the roles the setup wizard wrote (bridge core/setup_dsh_configure.go: {"members":[{name,cli?,persona?}]})
   * as UI members, once: names already in the channel are skipped, then the file becomes *.imported.json with
   * each role's member id (the new one, or the one already holding the name), so bothouse names the role's wiki
   * after the id the member really has (bridge core/setup_dsh_wiki.go). Returns the names added.
   */
  async importWizard(path, logger) {
    if (!existsSync(path)) return [];
    let members = [];
    try {
      members = JSON.parse(readFileSync(path, 'utf8'))?.members ?? [];
    } catch (error) {
      logger?.warn?.('conest-collab: cannot read %s: %s', path, error?.message ?? error);
      return [];
    }
    const added = [];
    const imported = [];
    for (const m of Array.isArray(members) ? members : []) {
      const name = String(m?.name ?? '').trim();
      const same = this.hub.memberList().find(x => x.name.toLowerCase() === name.toLowerCase());
      // A default-named role may become Codex-2 when Codex is already there; custom and legacy
      // names stay idempotent (a re-import must not duplicate them).
      if (same !== undefined && m?.name_customized !== false) {
        imported.push({ ...m, id: same.id });
        continue;
      }
      try {
        const avatar = m?.avatar && ['orange', 'whale', 'dragon', 'rainbow', 'lanxi'].includes(m.avatar) ? m.avatar : undefined;
        const member = await this.create({ name, persona: m?.persona ?? '', ...(m?.cli ? { cli: m.cli } : {}), ...(m?.name_customized === undefined ? {} : { nameCustomized: Boolean(m.name_customized) }), ...(avatar ? { avatar } : {}) });
        imported.push({ ...m, id: member.id });
        added.push(member.name);
      } catch (error) {
        imported.push(m);
        logger?.warn?.('conest-collab: wizard member %s not added: %s', name, error?.message ?? error);
      }
    }
    writeFileSync(path.replace(/\.json$/, '') + '.imported.json', JSON.stringify({ members: imported }, null, 2), { mode: 0o600 });
    unlinkSync(path);
    return added;
  }

  /** Provider routes and their models, for the add-member picker. Slow or failing routes are reported, not fatal. */
  async models() {
    if (this.llm === undefined) return [];
    const routes = this.llm.listProviders();
    return Promise.all(routes.map(async (route) => {
      try {
        const models = await withTimeout(this.llm.listModels(route.id), MODEL_LIST_TIMEOUT_MS);
        return { provider: route.id, name: route.name, models: models.map(m => ({ id: m.id, name: m.name })) };
      } catch (error) {
        return { provider: route.id, name: route.name, models: [], error: error?.message ?? String(error) };
      }
    }));
  }

  async create(input) {
    const m = await this.validate(input);
    const id = this.newId(m.name);
    const row = this.store.addMember({ id, ...m });
    const member = rowToMember(row);
    this.dsh.putMember(member);
    return member;
  }

  async update(id, input) {
    const existing = this.store.member(id);
    if (existing === undefined || existing.removed) throw new CollabError('member-missing', `member ${id} does not exist`);
    if (existing.source !== 'ui') throw new CollabError('read-only', `member ${id} comes from the config file and cannot be edited here`);
    const m = await this.validate({ ...input, rooms: input?.rooms === undefined ? JSON.parse(existing.rooms ?? '[]') : input.rooms }, id);
    if (input?.nameCustomized === undefined && existing.name_customized != null) m.nameCustomized = Boolean(existing.name_customized);
    // An edit that leaves out the approval tier keeps the stored one instead of falling back to the default.
    if (m.cli !== undefined && input?.permissionPreset === undefined && existing.cli && existing.permission_preset) {
      m.permissionPreset = existing.permission_preset;
    }
    const row = this.store.updateMember(id, m);
    const member = rowToMember(row);
    this.dsh.putMember(member);
    return member;
  }

  remove(id) {
    const existing = this.store.member(id);
    if (existing === undefined || existing.removed) throw new CollabError('member-missing', `member ${id} does not exist`);
    if (existing.source !== 'ui') throw new CollabError('read-only', `member ${id} comes from the config file and cannot be removed here`);
    this.store.removeMember(id);
    this.dsh.dropMember(id);
  }

  async validate(input, selfId) {
    let name = String(input?.name ?? '').trim();
    const existing = selfId === undefined ? undefined : this.store.member(selfId);
    const nameCustomized = input?.nameCustomized ?? (existing?.name_customized == null ? undefined : Boolean(existing.name_customized));
    if (nameCustomized !== undefined && typeof nameCustomized !== 'boolean') throw new CollabError('invalid', 'nameCustomized must be boolean');
    const cli = input?.cli ?? existing?.cli;
    const backend = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini' }[cli] ?? 'DSH';
    const used = new Set(this.hub.memberList().filter(m => m.id !== selfId).map(m => m.name.toLowerCase()));
    const isNew = existing === undefined;
    if (!name || (nameCustomized === false && (isNew ? used.has(name.toLowerCase()) : existing.cli !== cli))) {
      if (isNew && name) {
        // Keep the requested automatic stem (Codex, Claude Code…) and only move past collisions.
        const stem = name.replace(/-\d+$/, '');
        for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem}-${n}`;
      } else {
        name = backend;
        for (let n = 2; used.has(name.toLowerCase()); n++) name = `${backend}-${n}`;
      }
    }
    if (!name || name.length > MAX_NAME || /[@<>\r\n\t]/.test(name) || (/\s/.test(name) && !/^Claude Code(?:-\d+)?$/.test(name))) {
      throw new CollabError('invalid', `name must be 1-${MAX_NAME} characters without spaces (except Claude Code), @ or <>`);
    }
    const rooms = input?.rooms ?? [];
    if (!Array.isArray(rooms) || rooms.some(id => !Number.isSafeInteger(id) || this.store.room(id)?.kind !== 'chat')) {
      throw new CollabError('invalid', 'rooms must contain existing chat channel ids');
    }
    const clash = this.hub.memberList().find(m => m.id !== selfId && (!rooms.length || !m.rooms?.length || rooms.some(id => m.rooms.includes(id))) && (m.name.toLowerCase() === name.toLowerCase() || m.id.toLowerCase() === name.toLowerCase()));
    if (clash !== undefined) throw new CollabError('conflict', `name ${name} is already used by ${clash.name}`);
    const persona = String(input?.persona ?? '');
    if (persona.length > MAX_PERSONA) throw new CollabError('invalid', `persona exceeds ${MAX_PERSONA} characters`);
    let avatar;
    try { avatar = checkAvatar(input?.avatar); } catch (error) { throw new CollabError('invalid', error.message); }
    if (input?.cli != null) {
      // A local CLI member brings its own model; no provider route to check.
      const cli = String(input.cli);
      if (!CLIS.includes(cli)) throw new CollabError('invalid', `cli must be one of ${CLIS.join(', ')}`);
      // Tool approval tier: one of DSH's permission presets; absent = DSH's default (cli-member.mjs).
      const preset = input.permissionPreset == null || input.permissionPreset === '' ? undefined : String(input.permissionPreset);
      if (preset !== undefined && !PERMISSION_PRESETS.includes(preset)) throw new CollabError('invalid', `permissionPreset must be one of ${PERMISSION_PRESETS.join(', ')}`);
      return { name, persona, avatar, nameCustomized, rooms, cli, ...(preset === undefined ? {} : { permissionPreset: preset }) };
    }
    let model;
    if (input?.model != null) {
      const provider = String(input.model.provider ?? '');
      const id = String(input.model.model ?? '');
      if (!provider || !id) throw new CollabError('invalid', 'model needs provider and model');
      if (this.llm !== undefined) {
        try {
          await this.llm.resolveModelInfo(provider, id);
        } catch (error) {
          throw new CollabError('invalid', `model ${provider}/${id} is not available: ${error?.message ?? error}`);
        }
      }
      model = { provider, model: id };
    }
    return { name, persona, avatar, nameCustomized, rooms, ...(model === undefined ? {} : { model }) };
  }

  /** A stable, unused member id derived from the name (ASCII) or a short random suffix. */
  newId(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    const taken = id => RESERVED.has(id) || this.store.member(id) !== undefined || this.hub.members.has(id);
    if (slug && /^[a-z0-9]/.test(slug) && !taken(slug)) return slug;
    for (;;) {
      const id = `m-${Math.random().toString(36).slice(2, 8)}`;
      if (!taken(id)) return id;
    }
  }
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out listing models')), ms); }),
  ]).finally(() => clearTimeout(timer));
}
