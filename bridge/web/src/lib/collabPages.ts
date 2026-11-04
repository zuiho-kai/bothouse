import { BASE_PATH } from './basePath';

/** Collab host pages this panel can show: the wiki galaxy and the team desk. */
export type CollabPage = 'wiki-galaxy' | 'desk';

/** Prefix the DSH sidebar entry mounts the panel under (dsh/collab/panel.mjs PANEL_PREFIX). */
const PANEL_MOUNT = '/collab/panel';

/**
 * URL of a collab host page as seen from this panel (#145).
 *
 * Two mounts exist, and the panel's `<base href>` says which one it is:
 *   - inside the DSH sidebar entry the panel is at `/collab/panel/` on the DSH origin, so the
 *     collab pages are that same origin's `/collab/*` (the shell's sign-in already applies);
 *   - opened directly on the management server the panel is at `/`, and DSH pages come through
 *     the management server's `/dsh/` proxy, which trades the panel token for its own cookie.
 *
 * @param page - collab page name.
 * @param mountPath - panel mount path; defaults to the page's own base.
 * @param token - panel token, used only on the `/dsh/` proxy hop (bridge/core/management_dsh_proxy.go).
 * @returns absolute path the browser should request.
 */
export function collabPageUrl(
  page: CollabPage,
  mountPath: string = BASE_PATH,
  token: string = '',
): string {
  const base = mountPath.replace(/\/+$/, '');
  const embedded = base === PANEL_MOUNT || base.endsWith(PANEL_MOUNT);
  const dshBase = embedded ? base.slice(0, -PANEL_MOUNT.length) : `${base}/dsh`;
  const query = !embedded && token ? `?token=${encodeURIComponent(token)}` : '';
  return `${dshBase}/collab/${page}${query}`;
}
