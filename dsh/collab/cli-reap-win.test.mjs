// PR #1254 回归：Windows 上 gemini / npx 是 npm 写的 .cmd 外壳，CLI 起在外壳底下。
// 经外壳启动时 close() 只杀外壳，真 CLI 和它起的孙进程都留成孤儿（真 Windows 实测）。
// 这里用真进程复现：假 ACP CLI + 一个孙进程 + .cmd 外壳，close() 后按命令行里的标记数残留。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
// 命名空间导入：修复前的 cli-member.mjs 还没有这两个导出，这份测试也要能对着老代码跑出红。
import * as member from './cli-member.mjs';

const { CliMember, resolveShim } = member;

// npm 写的 .cmd 外壳（cmd-shim 模板，与真实 gemini.cmd / npx.cmd 同构）。
const NPM_SHIM = (script) => `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${script}" %*
`;

// 一个真 ACP 服务：应答 initialize 就够 _start() 成功，然后挂住等 close()。
const FAKE_ACP = (script, marker) => `
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const path = require('node:path');
// 孙进程：真 CLI 自己起的子进程，也就是实测里跟 CLI 一起变孤儿的那一层。
spawn(process.execPath, [path.join(__dirname, '${script}'), '${marker}-grandchild'], { stdio: 'ignore' });
const send = frame => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\\n');
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') send({ id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  else if (request.id !== undefined) send({ id: request.id, result: {} });
});
setInterval(() => {}, 1000);
`;

// 文件查找按 PATHEXT 拼扩展名，Windows 的大小写不敏感、其它平台敏感，扩展名按平台给。
const PATHEXT = process.platform === 'win32' ? '.CMD;.COM;.EXE' : '.cmd';

test('resolveShim 把 npm .cmd 外壳解析成 node + 脚本，认不出的返回 null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-shim-'));
  writeFileSync(join(dir, 'cli.js'), 'setInterval(() => {}, 1000)\n');
  writeFileSync(join(dir, 'gemini.cmd'), NPM_SHIM('cli.js'));
  writeFileSync(join(dir, 'notes.txt'), 'x');
  const env = { PATH: dir, PATHEXT };

  assert.deepEqual(resolveShim('gemini', env), { cmd: process.execPath, args: [join(dir, 'cli.js')], shell: false });
  // 外壳指向的脚本不在：拆不动，调用方退回经外壳启动（关闭时按进程树杀）。
  writeFileSync(join(dir, 'broken.cmd'), NPM_SHIM('missing.js'));
  assert.equal(resolveShim('broken', env), null);
  // 不是 .cmd / .bat：不是这里的事。
  assert.equal(resolveShim('notes.txt', env), null);
  assert.equal(resolveShim('not-installed', env), null);
});

/** 按命令行里的标记列出还活着的进程，返回 ['<pid> <name>', …]。 */
function aliveWith(marker) {
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    // $PID 就是这条 powershell 自己：它的命令行里也有标记，排除掉。
    `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${marker}*' } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`,
  ], { encoding: 'utf8' });
  return String(ps.stdout ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

/** 收掉带标记的残留（红的时候跑出来的孤儿；它们攥着本进程的管道，不清会挂住整个 runner）。 */
function killMarked(marker) {
  for (const line of aliveWith(marker)) {
    const pid = line.split(' ')[0];
    spawnSync('taskkill', ['/T', '/F', '/PID', pid], { stdio: 'ignore' });
  }
}

// 只有 Windows 会经过外壳；其余平台本来就 shell:false，没有这条路径。
test('Windows: close() 之后经 .cmd 外壳起的 CLI 和它的孙进程都不留', { timeout: 30000, skip: process.platform !== 'win32' }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-reap-tree-'));
  // 每次跑一个独立标记，避免撞上别的测试或机器上残留的进程；脚本名里带标记，
  // CLI 和孙进程的命令行才都能按标记数出来。
  const marker = `reap${process.pid}${Date.now()}`;
  const script = `fake-acp-${marker}.js`;
  writeFileSync(join(dir, 'grandchild.js'), 'setInterval(() => {}, 1000)\n');
  writeFileSync(join(dir, script), FAKE_ACP('grandchild.js', marker));
  writeFileSync(join(dir, 'gemini.cmd'), NPM_SHIM(script));

  // gemini 走裸命令名 → 经 PATH 找到外壳，和真实安装同一条路径。PATH 前置本目录、保留系统目录：
  // 外壳里调的是裸 `node`，同时保留修复前那条「经 cmd.exe 启动」的老路径。
  const m = new CliMember({ cli: 'gemini', cwd: dir, env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ''}` } });
  t.after(() => { m.close(); killMarked(marker); });
  await m._start();
  // 来源：handoff #282 —— 起满 3 秒再 close，留够时间让 CLI 把孙进程起起来。
  await new Promise(r => setTimeout(r, 3000));

  const before = aliveWith(marker);
  assert.ok(before.length >= 2, `起完应至少看到 CLI 和孙进程两个进程，实际 ${JSON.stringify(before)}`);

  m.close();
  // 来源：handoff #282 —— close() 后等 3 秒再数，给 taskkill 一点时间。
  await new Promise(r => setTimeout(r, 3000));
  // 先断言这一点：修复前经 cmd.exe 启动，close() 只杀掉外壳，CLI 和孙进程都还在这份列表里。
  assert.deepEqual(aliveWith(marker), [], 'close() 后不该留下任何进程');
  // 外壳拆成 node + 脚本后，m.proc.pid 就是 CLI 自己，不再是中间那层 cmd.exe。
  assert.ok(before.some(l => l.startsWith(`${m.proc.pid} `)), `CLI 自己应是 node.exe 进程，实际 ${JSON.stringify(before)}`);
});
