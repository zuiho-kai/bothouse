// bothouse-role-journal: append every event of a bound role to a JSON Lines file, one file a day.
//
// Why: the bridge keeps no event history. A plain file per day is what a daily report, a
// post-mortem or a spreadsheet can read back: who worked when, what failed, what was said.
import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { followRoles, statusFilter } from './lib/bothouse.mjs';

export const name = 'bothouse-role-journal';

/** journal-YYYY-MM-DD.jsonl, by the event's own UTC date. */
export function fileFor(dir, ev) {
  const day = String(ev.time || new Date().toISOString()).slice(0, 10);
  return join(dir, `journal-${day}.jsonl`);
}

/** The line written: the event without the role snapshot (the role_key names it). */
export function recordFor(ev) {
  const { role, ...rest } = ev;
  return { ...rest, name: role?.display_name || role?.name };
}

export function apply(ctx, config = {}) {
  const dir = config.dir || join(homedir(), '.bothouse', 'plugins', name);
  const want = statusFilter(config.statuses);
  const roles = followRoles({
    bridge: config.bridge,
    token: config.token,
    pluginId: name,
    logger: ctx.logger,
    async onEvent(ev) {
      if (!want.has(ev.type)) return;
      if (ev.type === 'speech' && ev.draft) return;
      await mkdir(dir, { recursive: true });
      await appendFile(fileFor(dir, ev), JSON.stringify(recordFor(ev)) + '\n');
    },
  });
  ctx.logger.info(`${name}: writing to ${dir}`);
  ctx.effect(() => () => roles.stop());
}
