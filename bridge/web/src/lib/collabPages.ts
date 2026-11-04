import { BASE_PATH } from './basePath';

/** Collab host pages this panel can show: the wiki galaxy and the team desk. */
export type CollabPage = 'wiki-galaxy' | 'desk';

/** Prefix the DSH sidebar entry mounts the panel under (dsh/collab/panel.mjs PANEL_PREFIX). */
const PANEL_MOUNT = '/collab/panel';

/**
 * URL of a collab host page as seen from this panel (#145).
 *
 * Two mounts exist. Inside a DSH sidebar entry the panel runs at `/collab/panel/`, so the
 * collab pages are this origin's `/collab/*` and the DSH base is whatever precedes the mount
 * (`/dsh` when the panel is reached through the management server's DSH proxy). Opened
 * directly on the management server the panel is at `/`, and DSH pages come through `/dsh/`.
 *
 * @param page - collab page name.
 * @param basePath - panel mount path; defaults to the page's own base.
 * @param token - panel token to trade for the /dsh/-only cookie when the page goes through the
 *   DSH proxy (same hop as the setup wizard's channels link, bridge/core/management_dsh_proxy.go).
 * @returns absolute path the browser should request.
 */
export function collabPageUrl(
  page: CollabPage,
  basePath: string = BASE_PATH,
  token: string = '',
): string {
  const base = basePath.replace(/\/+$/, '');
  const embedded = base === PANEL_MOUNT || base.endsWith(PANEL_MOUNT);
  const dshBase = embedded ? base.slice(0, -PANEL_MOUNT.length) : `${base}/dsh`;
  const query = !embedded && token ? `?token=${encodeURIComponent(token)}` : '';
  return `${dshBase}/collab/${page}${query}`;
}
