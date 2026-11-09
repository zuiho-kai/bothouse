// bothouse-role-webhook: post a line to a chat webhook when a bound role finishes or fails.
//
// Why: the owner is not always watching the channel; a Discord / Slack / Feishu group webhook on
// the phone tells them a role is done or stuck without opening the bridge.
import { followRoles, roleLabel, statusFilter } from './lib/bothouse.mjs';

export const name = 'bothouse-role-webhook';

const WORDS = {
  idle: '空闲了', working: '开始干活', thinking: '在思考', celebrate: '交活了', error: '出错了', speech: '说',
};

/** The line a person reads. */
export function lineFor(ev) {
  const who = roleLabel(ev);
  if (ev.type === 'speech') return `${who}：${ev.text ?? ''}`;
  return `${who} ${WORDS[ev.type] ?? ev.type}`;
}

/** Request body per webhook flavour. */
export function bodyFor(format, ev) {
  const text = lineFor(ev);
  switch (format) {
    case 'discord': return { content: text };
    case 'slack': return { text };
    case 'feishu': return { msg_type: 'text', content: { text } };
    default: return { text, event: ev };
  }
}

export function apply(ctx, config = {}) {
  if (!config.url) {
    ctx.logger.warn(`${name}: no url configured; set it in 插件 → 配置`);
    return;
  }
  const want = statusFilter(config.statuses);
  const roles = followRoles({
    bridge: config.bridge,
    token: config.token,
    pluginId: name,
    logger: ctx.logger,
    async onEvent(ev) {
      if (!want.has(ev.type)) return;
      // A speech draft is re-sent on every edit; only the settled reply goes out.
      if (ev.type === 'speech' && ev.draft) return;
      const res = await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyFor(config.format, ev)),
      });
      if (!res.ok) ctx.logger.warn(`${name}: webhook answered HTTP ${res.status}`);
    },
  });
  ctx.effect(() => () => roles.stop());
}
