import { CollabError } from './store.mjs';
import { rowToMember } from './roster.mjs';
import { createCliMember } from './cli-member.mjs';

const fields = new Set(['name', 'persona', 'cli', 'model', 'cliConfig']);
function check(body, create = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !fields.has(k))) throw new CollabError('invalid', 'invalid member fields');
  if (create && (typeof body.name !== 'string' || !body.name.trim())) throw new CollabError('invalid', 'name is required');
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) throw new CollabError('invalid', 'name is required');
  if (body.persona !== undefined && typeof body.persona !== 'string') throw new CollabError('invalid', 'persona must be a string');
}
function view(m, source = m.source) {
  return { id: m.id, name: m.name, source, can_edit: source === 'ui', can_delete: source === 'ui', persona: m.persona ?? '',
    cli: m.cli ?? null, model: m.model ?? null, cliConfig: m.cliConfig ?? null,
    apply: { timing: 'next_turn', status: m.cliConfigManaged ? 'pending' : 'not_configured' } };
}
export function managementMembers(roster, hub) {
  const rows = roster.store.members().map(rowToMember);
  const seen = new Set(rows.map(m => m.id));
  return [...rows.map(m => view(m)), ...hub.memberList().filter(m => m.kind !== 'human' && !seen.has(m.id)).map(m => view(m, 'external'))];
}
async function validateChoices(roster, member, probe, id) {
  const config = member.cliConfig;
  if (!config || !Object.keys(config).length) return;
  const result = await probe({ cli: 'codex', ...(id ? { memberId: id } : {}), ...(config.model ? { model: config.model } : {}) });
  if (!result.supported) throw new CollabError('invalid', 'Codex configuration is unsupported');
  if (config.model && !result.model?.options.some(x => x.value === config.model)) throw new CollabError('invalid', 'Codex model is unavailable');
  if (config.reasoningEffort && !result.reasoningEffort?.options.some(x => x.value === config.reasoningEffort)) throw new CollabError('invalid', 'Codex reasoning effort is unavailable');
}
export async function managementCreate(roster, body, probe) {
  check(body, true);
  if (body.cli === null) body = { ...body, cli: undefined };
  if (probe && body.cliConfig != null) await validateChoices(roster, await roster.validate(body), probe);
  return view(await roster.create(body));
}
export async function managementUpdate(roster, id, body, probe) {
  check(body);
  const row = roster.store.member(id);
  if (!row || row.removed) throw new CollabError('member-missing', 'member not found');
  if (row.source !== 'ui') throw new CollabError('read-only', 'member is read-only');
  const old = rowToMember(row);
  if (Object.hasOwn(body, 'cli') && body.cli !== (old.cli ?? null) && roster.store.openJobs().some(j => j.member_id === id && j.state === 'sent')) throw new CollabError('member-busy', 'member is busy');
  const merged = { ...old, ...body };
  if (Object.hasOwn(body, 'cliConfig') && body.cliConfig != null && merged.cli !== 'codex') throw new CollabError('invalid', 'cliConfig requires a Codex member');
  if (Object.hasOwn(body, 'cli') && body.cli !== old.cli) {
    if (!Object.hasOwn(body, 'model')) merged.model = null;
    if (!Object.hasOwn(body, 'cliConfig')) merged.cliConfig = null;
  }
  if (body.cliConfig && typeof body.cliConfig === 'object' && !Array.isArray(body.cliConfig)) {
    merged.cliConfig = { ...(old.cliConfig || {}), ...body.cliConfig };
    for (const k of Object.keys(merged.cliConfig)) if (merged.cliConfig[k] === null) delete merged.cliConfig[k];
  }
  if (merged.cli == null) { merged.cli = undefined; merged.cliConfig = undefined; }
  if (probe && Object.hasOwn(body, 'cliConfig') && merged.cliConfig != null) await validateChoices(roster, await roster.validate(merged, id), probe, old.cli === 'codex' ? id : undefined);
  return view(await roster.update(id, merged));
}
export function managementDelete(roster, id) {
  const row = roster.store.member(id);
  if (!row || row.removed) throw new CollabError('member-missing', 'member not found');
  if (row.source !== 'ui') throw new CollabError('read-only', 'member is read-only');
  if (roster.store.openJobs().some(j => j.member_id === id && j.state === 'sent')) throw new CollabError('member-busy', 'member is busy');
  roster.remove(id);
}
export async function managementOptions(roster, body, cwd) {
  if (!body || body.cli !== 'codex' || Object.keys(body).some(k => !['cli','memberId','model'].includes(k)) || (body.model !== undefined && (typeof body.model !== 'string' || !body.model))) throw new CollabError('invalid', 'invalid capability request');
  if (body.memberId !== undefined) {
    const row = roster.store.member(body.memberId);
    if (!row || row.removed) throw new CollabError('member-missing', 'member not found');
    if (row.source !== 'ui' || row.cli !== 'codex') throw new CollabError('read-only', 'member cannot be probed');
  }
  const probe = createCliMember({ cli: 'codex', cwd });
  try { return await probe.probeOptions(body.model); }
  catch (error) { throw new CollabError(error.code === 'COLLAB_CONFIG_INVALID' ? 'invalid' : 'offline', error.code === 'COLLAB_CONFIG_INVALID' ? 'Codex model is unavailable' : 'Codex capability probe failed'); }
  finally { probe.close(); }
}
