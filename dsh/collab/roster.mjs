// DSH member management for one owner: config members are seeds (read-only
// in the UI), UI members are created, edited and removed here. Names must be
// unique across every channel member (DSH members and cc-connect bots alike)
// because @-mentions are matched by name.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { CollabError } from './store.mjs';
import { checkAvatar } from './avatars.mjs';
import { PERMISSION_PRESETS } from './cli-member.mjs';
import { personaLibrary } from './personas.mjs';

const MAX_NAME = 32;
/** The preset a plugin-only install starts with: 鲸鱼娘, the DeepSeek character, matching DSH's own model. */
const DEFAULT_ROLE = 'jingyu';
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
    ...(row.cli === 'claude' && row.model ? { model: row.model }
      : row.provider && row.model ? { model: { provider: row.provider, model: row.model } } : {}),
    ...(row.cli ? { cli: row.cli } : {}),
    ...(row.cli_config ? { cliConfig: JSON.parse(row.cli_config) } : {}),
    ...(row.cli_config_managed ? { cliConfigManaged: true } : {}),
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
  constructor(hub, dsh, llm, avatars) {
    this.avatars = avatars;
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
   * A default-named role (name_customized false) reuses a DSH member a former run made for it — same CLI,
   * still automatic, named the role's name or name-N — so re-running the wizard does not add Codex-2, Codex-3…
   * (11-05 Windows report); the one named exactly the role's name goes first, then the oldest. Each member
   * serves one role per run, so two default Codex roles still get two members. The imported entry carries the
   * member's real name, which the bridge writes into gate-team.json and lead.json.
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
    const claimed = new Set();
    for (const m of Array.isArray(members) ? members : []) {
      const name = String(m?.name ?? '').trim();
      // Custom and legacy names stay idempotent by name (a re-import must not duplicate them).
      const same = m?.name_customized === false ? this.reusableWizardMember(name, m?.cli, claimed)
        : this.hub.memberList().find(x => x.name.toLowerCase() === name.toLowerCase());
      if (same !== undefined) {
        claimed.add(same.id);
        imported.push({ ...m, name: same.name, id: same.id });
        continue;
      }
      try {
        const avatar = m?.avatar && ['orange', 'whale', 'dragon', 'rainbow', 'lanxi', 'grok'].includes(m.avatar) ? m.avatar : undefined;
        const base = { name, persona: m?.persona ?? '', ...(m?.cli ? { cli: m.cli } : {}), ...(m?.name_customized === undefined ? {} : { nameCustomized: Boolean(m.name_customized) }), ...(avatar ? { avatar } : {}) };
        // The wizard pins a DSH-model role to the route its key belongs to (#1173); a host without that model
        // still gets the role, on its default model.
        const model = !m?.cli && m?.model?.provider && m?.model?.model ? { provider: String(m.model.provider), model: String(m.model.model) } : undefined;
        const member = model === undefined ? await this.create(base)
          : await this.create({ ...base, model }).catch(() => this.create(base));
        claimed.add(member.id);
        imported.push({ ...m, name: member.name, id: member.id });
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

  /** A UI member an earlier wizard run made for the default-named role `name` (see importWizard), or undefined. */
  reusableWizardMember(name, cli, claimed) {
    const stem = name.toLowerCase();
    // The exact name is the same role whatever its flag says: members seeded on the plugin's first start
    // (seedDefaults) and those made before name_customized was stored carry none, and skipping them
    // made every re-run add 鲸鱼娘-2 / DSH-2. A suffixed name (Codex-2) is reused only when it is marked automatic.
    const fits = this.store.members().filter(r => r.source === 'ui' && !claimed.has(r.id) && (r.cli ?? '') === (cli ?? '')
      && (r.name.toLowerCase() === stem
        || (r.name_customized != null && !Boolean(r.name_customized) && r.name.toLowerCase().replace(/-\d+$/, '') === stem)));
    const pick = fits.find(r => r.name.toLowerCase() === stem) ?? fits[0];
    return pick === undefined ? undefined : rowToMember(pick);
  }

  /**
   * Plugin-only installs (`dsh plugin add bothouse-dsh`) have no setup wizard: on the very first start,
   * with no member ever stored, add one preset role (鲸鱼娘) as a DSH member on DSH's own default model, so
   * the channel can be used right away; it becomes the primary role. Runs once (marker file); a channel that ever
   * had members, or the wizard's roles, is left alone. Returns the names added.
   */
  async seedDefaults(markerPath, lang, logger) {
    if (existsSync(markerPath)) return [];
    const added = [];
    if (this.store.db.prepare('SELECT COUNT(*) AS n FROM members').get().n === 0) {
      let lead;
      // One role on DSH's one model is the default (user 11-03: 单模型单角色开箱就用); more are added from the UI.
      for (const p of personaLibrary(lang).filter(x => x.slug === DEFAULT_ROLE)) {
        try {
          const member = await this.create({ name: p.name, persona: p.text, avatar: p.avatar });
          lead ??= member;
          added.push(member.name);
        } catch (error) {
          logger?.warn?.('conest-collab: default member %s not added: %s', p.name, error?.message ?? error);
        }
      }
      // Workspaces open only through a channel's primary role; the default role takes channels that have none, so「交给工作区」works without a trip to the channel settings.
      if (lead !== undefined) {
        for (const room of this.store.rooms()) if (room.kind === 'chat' && this.store.leadId(room.id) === null) this.store.setLead(room.id, lead.id);
      }
    }
    writeFileSync(markerPath, JSON.stringify({ added, at: new Date().toISOString() }) + '\n', { mode: 0o600 });
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
    // Both PATCH endpoints preserve omitted fields. A backend change drops the old backend's model/config.
    const old = rowToMember(existing);
    const changedCli = Object.hasOwn(input, 'cli') && (input.cli ?? undefined) !== old.cli;
    input = { ...old, ...(changedCli ? { model: undefined, cliConfig: undefined, permissionPreset: undefined } : {}), ...input };
    const m = await this.validate({ ...input, rooms: input?.rooms === undefined ? JSON.parse(existing.rooms ?? '[]') : input.rooms }, id);
    if (input?.cliConfig === undefined && existing.cli === m.cli) {
      m.cliConfig = existing.cli_config ? JSON.parse(existing.cli_config) : undefined;
      m.cliConfigManaged = Boolean(existing.cli_config_managed);
    }
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
    this.avatars?.remove(id);
    this.store.removeMember(id);
    // #176: a dead id must not linger as a channel's primary role.
    for (const roomId of this.store.clearLeadOf(id)) this.hub.emit({ type: 'room-settings', room_id: this.store.settingsRoom(roomId), lead_id: null, effective_lead_id: this.hub.defaultReplyIn(roomId)?.id ?? null });
    this.dsh.dropMember(id);
  }

  setAvatar(id, png) {
    const existing = this.store.member(id);
    if (existing === undefined || existing.removed) throw new CollabError('member-missing', `member ${id} does not exist`);
    if (existing.source !== 'ui') throw new CollabError('read-only', '配置文件中的成员不能在这里修改头像');
    let avatar = '';
    if (png === undefined) this.avatars.remove(id);
    else avatar = this.avatars.save(id, png);
    const row = this.store.updateMember(id, { ...rowToMember(existing), avatar });
    const member = rowToMember(row);
    this.dsh.putMember(member);
    return member;
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
    // A private chat holds exactly its one member (hub.membersInRoom), so listing it here would
    // store a membership the room never honours: the extra member shows nowhere, cannot be
    // dispatched to, and the add-member dialog is the only thing that creates it.
    if (!Array.isArray(rooms) || rooms.some(id => !Number.isSafeInteger(id) || this.store.room(id)?.kind !== 'chat' || this.store.dmMember(id) !== undefined)) {
      throw new CollabError('invalid', 'rooms must contain existing chat channel ids');
    }
    const clash = this.hub.memberList().find(m => m.id !== selfId && (!rooms.length || !m.rooms?.length || rooms.some(id => m.rooms.includes(id))) && (m.name.toLowerCase() === name.toLowerCase() || m.id.toLowerCase() === name.toLowerCase()));
    // #366: 这条会原样显示在成员对话框的错误条里，和同页的成员名校验一样说中文。
    if (clash !== undefined) throw new CollabError('conflict', `名字 ${name} 已被 ${clash.name} 使用`);
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
      let cliConfig;
      if (input.cliConfig != null) {
        if (cli !== 'codex' || typeof input.cliConfig !== 'object' || Array.isArray(input.cliConfig)) throw new CollabError('invalid', 'cliConfig requires a Codex member');
        cliConfig = {};
        for (const [key, value] of Object.entries(input.cliConfig)) {
          if (!['model', 'reasoningEffort'].includes(key) || (value !== null && (typeof value !== 'string' || !value.trim()))) throw new CollabError('invalid', 'invalid cliConfig');
          if (value !== null) cliConfig[key] = value;
        }
        if (!Object.keys(cliConfig).length) cliConfig = undefined;
      }
      let model;
      if (input.model != null) {
        if (cli !== 'claude') throw new CollabError('invalid', 'CLI members cannot use a DSH model route');
        if (typeof input.model !== 'string' || !input.model.trim()) throw new CollabError('invalid', 'Claude model must be a non-empty model id');
        model = input.model.trim();
      }
      return { name, persona, avatar, nameCustomized, rooms, cli, model, cliConfig, cliConfigManaged: input.cliConfig !== undefined, ...(preset === undefined ? {} : { permissionPreset: preset }) };
    }
    if (input?.cliConfig != null) throw new CollabError('invalid', 'cliConfig requires a Codex member');
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
