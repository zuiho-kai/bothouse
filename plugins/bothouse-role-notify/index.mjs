// bothouse-role-notify: a desktop notification on this computer when a bound role finishes or fails.
//
// Why: roles run long jobs in the background; the person at the machine sees "龙娘 交活了" in the
// corner of the screen instead of checking the channel. macOS uses osascript, Linux notify-send.
import { execFile } from 'node:child_process';
import { followRoles, roleLabel, statusFilter } from './lib/bothouse.mjs';

export const name = 'bothouse-role-notify';

const WORDS = { idle: '空闲了', working: '开始干活', thinking: '在思考', celebrate: '交活了', error: '出错了', speech: '说' };

/** [command, args] that shows title/body on this platform, or undefined where none is known. */
export function notifyCommand(platform, title, body) {
  if (platform === 'darwin') {
    const q = (s) => JSON.stringify(String(s));
    return ['osascript', ['-e', `display notification ${q(body)} with title ${q(title)}`]];
  }
  if (platform === 'linux') return ['notify-send', [title, body]];
  return undefined;
}

export function apply(ctx, config = {}) {
  const want = statusFilter(config.statuses);
  const roles = followRoles({
    bridge: config.bridge,
    token: config.token,
    pluginId: name,
    logger: ctx.logger,
    onEvent(ev) {
      if (!want.has(ev.type)) return;
      if (ev.type === 'speech' && ev.draft) return;
      const title = `${roleLabel(ev)} ${WORDS[ev.type] ?? ev.type}`;
      const cmd = notifyCommand(process.platform, title, ev.text || 'bothouse');
      if (!cmd) return ctx.logger.warn(`${name}: no notifier on ${process.platform}`);
      execFile(cmd[0], cmd[1], (err) => err && ctx.logger.warn(`${name}: ${cmd[0]} failed: ${err.message}`));
    },
  });
  ctx.effect(() => () => roles.stop());
}
