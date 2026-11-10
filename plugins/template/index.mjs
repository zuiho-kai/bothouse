// bothouse plugin template: the host half DSH loads (cordis.patch.yml names this package).
//
// DSH calls apply(ctx, config) when the row is on, and runs what ctx.effect returned when the row
// is switched off, reconfigured or the plugin is removed. config is the row's `config:` from
// cordis.patch.yml, or whatever was saved in the panel's 插件 → 配置 editor.
import { followRoles, roleLabel, statusFilter } from './lib/bothouse.mjs';

// The name DSH lists for this plugin, and the plugin_id roles are bound with.
export const name = 'bothouse-plugin-template';

export function apply(ctx, config = {}) {
  const want = statusFilter(config.statuses);
  const roles = followRoles({
    bridge: config.bridge,
    token: config.token,
    pluginId: name,
    logger: ctx.logger,
    onSnapshot(bound) {
      ctx.logger.info(`${name}: ${bound.length} role(s) bound: ${bound.map((r) => r.role_key).join(', ') || '(none)'}`);
    },
    onEvent(ev) {
      if (!want.has(ev.type)) return;
      // Replace this line with what your plugin does.
      ctx.logger.info(`${name}: ${roleLabel(ev)} → ${ev.type}${ev.text ? `: ${ev.text.slice(0, 80)}` : ''}`);
    },
  });
  ctx.effect(() => () => roles.stop());
}
