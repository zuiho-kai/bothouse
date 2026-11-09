// 插件卸载 (#1377): the removal half of POST /api/v1/plugins/uninstall.
//
// The bridge holds the profile's package.json.lock and runs this script inside that hold, so the
// three refusal checks, pnpm's write and the bridge's post-check are one critical section. It calls
// DSH's own `runProfilePnpm` — the function `dsh plugin` calls *while it holds the same lock* — and
// therefore must not take the lock itself: `runPluginCommand` would wait on the bridge's hold while
// the bridge waits on this process. Running `dsh plugin remove` from the bridge has exactly that
// shape, which is why the removal is no longer a CLI invocation.
//
// Parameters arrive through the environment, not argv: paths go verbatim, no shell is involved and
// no argument can be read as a flag. BOTHOUSE_UNINSTALL_ANCHOR is the DSH installation's
// package.json (inside app.asar on a desktop-only install, where only the app's own Node can read
// it), and it is what resolves `@deepseek-ai/dsh-plugin-manager/operations`.
// BOTHOUSE_UNINSTALL_PNPM_NODE / _PNPM are set when the profile belongs to the Desktop app: its
// bundled Node runs its bundled pnpm, the same pair the app passes to `dsh plugin`.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const read = (key) => process.env[key] || '';
const dir = read('BOTHOUSE_UNINSTALL_DIR');
const anchor = read('BOTHOUSE_UNINSTALL_ANCHOR');
const name = read('BOTHOUSE_UNINSTALL_NAME');
const profile = read('BOTHOUSE_UNINSTALL_PROFILE') || 'web';
const say = (line) => process.stderr.write(line);

if (!dir || !anchor || !name) {
  say('dsh: the uninstall helper needs a profile directory, an install anchor and a package name\n');
  process.exit(2);
}

let runProfilePnpm;
try {
  const entry = createRequire(pathToFileURL(anchor)).resolve('@deepseek-ai/dsh-plugin-manager/operations');
  ({ runProfilePnpm } = await import(pathToFileURL(entry).href));
} catch (error) {
  say('dsh: this DSH installation does not expose @deepseek-ai/dsh-plugin-manager/operations: '
    + String((error && error.message) || error) + '\n');
  process.exit(2);
}

const pnpmNode = read('BOTHOUSE_UNINSTALL_PNPM_NODE');
const pnpm = read('BOTHOUSE_UNINSTALL_PNPM');
let result;
try {
  result = await runProfilePnpm(
    { profile, dir, installAnchor: anchor, cwd: dir },
    ['remove', '--', name],
    {
      // 'cli' inherits this process's descriptors, exactly as `dsh plugin` runs pnpm: the bridge's
      // process group owns the tree, so its timeout reaches pnpm and anything pnpm started.
      execution: 'cli',
      // 来源：DSH 安装流程的 collectTail 用 64KB 截尾；这里的回调只是把子进程的输出原样转给
      // 桥的日志缓冲，同样的上限，避免一次坏掉的 pnpm 把整段输出堆在内存里。
      outputBytes: 16384,
      onOutput: (text, stream) => { process[stream === 'stderr' ? 'stderr' : 'stdout'].write(text); },
      ...(pnpmNode ? { command: pnpmNode } : {}),
      ...(pnpm ? { args: [pnpm] } : {}),
    },
  );
} catch (error) {
  // A spawn failure (no pnpm on PATH, an unreadable profile) rejects instead of returning a status.
  say('dsh: could not start pnpm for the removal: ' + String((error && error.message) || error) + '\n');
  process.exit(1);
}
if (result.timedOut) say('dsh: pnpm printed nothing for too long and was terminated\n');
if (result.exitCode !== 0) say('dsh: plugin command failed; diagnostics: ' + result.logPath + '\n');
process.exit(result.exitCode ?? 1);