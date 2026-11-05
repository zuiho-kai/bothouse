/**
 * DSH rows in the panel are named "dsh:<member id>" (bridge/core/management_roles_dsh.go) so they never
 * collide with a bridge role's name. `<id>` is what DSH itself calls the member — for a bot that
 * registered into DSH it is the bridge project name (`/collab/api/state`, cloudweb.mjs registers
 * `{ id: <project> }`).
 */
const DSH_PREFIX = 'dsh:';

/** Member id behind a DSH row name, or '' when the row is not a DSH one. */
export function dshMemberId(name: string): string {
  return name.startsWith(DSH_PREFIX) ? name.slice(DSH_PREFIX.length) : '';
}

export interface NamedRow {
  name: string;
  display_name?: string;
}

/**
 * The DSH members that are not already on the page as a bridge project.
 *
 * DSH lists the bots that registered into it as `kind: "bot"` members, and on a machine where those
 * bots are this bridge's projects the same five agents arrive twice: once from the engines, once from
 * DSH. Counts (概览「项目」) and lists (项目卡片、会话页顶部计数) merge the two sources, so they must
 * drop the second copy — the bridge row is the one with sessions, model and controls.
 */
export function dshOnlyRows<T extends NamedRow>(dshRows: readonly T[], bridgeNames: readonly string[]): T[] {
  const taken = new Set(bridgeNames);
  return dshRows.filter((row) => {
    const id = dshMemberId(row.name);
    return id === '' || !taken.has(id);
  });
}
