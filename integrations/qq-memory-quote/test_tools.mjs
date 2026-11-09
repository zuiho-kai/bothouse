// Real installed QQ DSH tools, no model, network chat, or production writes.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { memoryRequest, shellQuote } from './client.mjs';
const installed = process.env.QQ_TEST_DSH_MODULES;
const load = name => import(pathToFileURL(join(installed, name, 'lib/index.js')));
const { Context } = await load('cordis');
const ctx = new Context();
const workspace = process.env.QQ_TEST_WORKSPACE;
await ctx.plugin((await load('dsh-system-prompt')).default);
await ctx.plugin((await load('dsh-tools')).default);
await ctx.plugin((await load('dsh-fs-local')).default, { cwd: workspace });
await ctx.plugin((await load('dsh-subprocess-local')).default);
await ctx.plugin((await load('dsh-bash-local')).default, { cwd: workspace });
await ctx.plugin((await load('dsh-session-projection')).default);
await ctx.plugin((await load('dsh-working-directory')).default, { defaultDirectory: workspace });
await ctx.plugin(await load('dsh-shell-env'));
await ctx.plugin(await load('dsh-tool-str-replace-editor'));
await ctx.plugin(await load('dsh-tool-bash'), { enableRunInBackground: false });
const signal = new AbortController().signal;
const path = join(process.env.QQ_MEMORY_ROOT, '101.md');
const execute = (name, arguments_) => ctx.tools.execute({ name, callId: name, arguments: arguments_, signal });
const shell = command => execute('bash', { description: 'Isolated QQ memory boundary verification', command, timeoutMs: 5000 });
const results = [];
try {
  const { renderPrompt } = await load('dsh-system-prompt');
  assert.match(renderPrompt({ sections: [], variables: {} }), /client\.mjs.*sources/);
  await assert.rejects(memoryRequest({ op: 'sources' }, 'other-conversation'), /capability/);
  const sources = await memoryRequest({ op: 'sources' });
  assert.deepEqual(sources.map(source => source.text), ['我喜欢喝乌龙茶', '她说：「我讨厌喝红茶」', '我喜欢吃苹果']);
  const source = sources.find(source => source.text === '我喜欢喝乌龙茶');
  const body = `- 偏好乌龙茶；原话：「我喜欢喝乌龙茶」；来源：${source.id}\n`;
  const query = await shell(`${shellQuote(process.execPath)} ${shellQuote(fileURLToPath(new URL('./client.mjs', import.meta.url)))} sources`);
  assert.equal(query.value.exitCode, 0, JSON.stringify(query));
  assert.deepEqual(JSON.parse(query.value.stdout.text).map(record => record.id), sources.map(record => record.id));
  results.push('shell-source-query-scoped-and-authenticated');
  const editor = await execute('str_replace_editor', { command: 'create', path, file_text: body });
  assert.equal(editor.isError ?? false, false, JSON.stringify(editor));
  assert.equal(await readFile(path, 'utf8'), body);
  results.push('human-match-persisted');
  for (const [name, after] of [
    ['changed-character', body.replace('原话：「我喜欢喝乌龙茶」', '原话：「我喜欢喝乌龙花」')],
    ['bot-only', body.replace('原话：「我喜欢喝乌龙茶」', '原话：「我喜欢喝咖啡」')],
    ['quoted-other-speaker', `- 偏好红茶；原话：「我讨厌喝红茶」；来源：${sources[1].id}\n`],
    ['other-person', `- 喜欢水果；原话：「我喜欢吃苹果」；来源：${sources[2].id}\n`],
  ]) {
    const rejected = await execute('str_replace_editor', { command: 'str_replace', path, old_str: body.trimEnd(), new_str: after.trimEnd() });
    assert.equal(rejected.isError, true, name + ': ' + JSON.stringify(rejected));
    assert.equal(await readFile(path, 'utf8'), body, name);
    results.push(name + '-rejected-unchanged');
  }
  // The same bypass that succeeded against the old editor-only guard.
  for (const [name, command] of [
    ['shell-redirection', `printf unverified > ${shellQuote(path)}`],
    ['node-child', `${shellQuote(process.execPath)} -e ${shellQuote("require('fs').writeFileSync(" + JSON.stringify(path) + ", 'unverified')")}`],
    ['rename-file', `printf unverified > ${shellQuote(join(workspace, 'staged'))} && mv ${shellQuote(join(workspace, 'staged'))} ${shellQuote(path)}`],
    ['rename-directory', `mv ${shellQuote(process.env.QQ_MEMORY_ROOT)} ${shellQuote(join(workspace, 'moved-memory'))}`],
    ['symlink', `ln -s ${shellQuote(path)} ${shellQuote(join(workspace, 'alias'))} && printf unverified > ${shellQuote(join(workspace, 'alias'))}`],
    ['hardlink', `ln ${shellQuote(path)} ${shellQuote(join(workspace, 'hardlink'))} && printf unverified > ${shellQuote(join(workspace, 'hardlink'))}`],
    ['forge-source', `printf forged > ${shellQuote(join(process.env.QQ_TEST_PEOPLE, 'qq-101.jsonl'))}`],
  ]) {
    const rejected = await shell(command);
    assert.ok(rejected.value, name + ': shell process was not observed');
    assert.equal(rejected.value.timedOut, false, name);
    assert.equal(rejected.value.aborted, false, name);
    assert.equal(rejected.value.signal, null, name);
    assert.notEqual(rejected.value.exitCode, 0, name + ': ' + JSON.stringify(rejected));
    assert.equal(await readFile(path, 'utf8'), body, name);
    results.push(name + '-blocked');
  }
  // Shell remains usable for ordinary files; a blanket shell ban cannot pass.
  const ordinary = join(workspace, 'ordinary.txt');
  const allowed = await shell(`printf permitted > ${shellQuote(ordinary)}`);
  assert.equal(allowed.isError ?? false, false, JSON.stringify(allowed));
  assert.equal(allowed.value.exitCode, 0, JSON.stringify(allowed));
  assert.equal(await readFile(ordinary, 'utf8'), 'permitted');
  results.push('ordinary-shell-write-allowed');
  const inserted = await execute('str_replace_editor', { command: 'insert', path, insert_line: 1, new_str: body.trimEnd() });
  assert.equal(inserted.isError ?? false, false, JSON.stringify(inserted));
  assert.equal((await readFile(path, 'utf8')).split(source.id).length, 3);
  results.push('editor-insert-checked-and-persisted');
  await writeFile(join(workspace, 'result.json'), JSON.stringify({ acceptancePassed: true, results }, null, 2));
  console.log(JSON.stringify({ acceptancePassed: true, results }));
} finally {
  await ctx.fiber.dispose();
}
