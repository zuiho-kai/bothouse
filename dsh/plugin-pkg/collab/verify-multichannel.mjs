#!/usr/bin/env node
// Developer checks, not independent acceptance or a live desktop/QQ test.
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const collab = dirname(fileURLToPath(import.meta.url));
const data = mkdtempSync(join(tmpdir(), 'bothouse-multichannel-'));
const env = { ...process.env, CONEST_COLLAB_DATA: data };
console.log(`Isolated CONEST_COLLAB_DATA: ${data}`);
const cases = [
  ['Legacy configuration', 'Automated coverage: default directory and global member scope'],
  ['Upgrade visibility', 'Automated coverage: global legacy scope and restart idempotence'],
  ['Channel routing and same-name bots', 'Automated coverage: channel routing and channel bots tests'],
  ['New channel retains global members', 'Automated coverage: legacy and explicitly global members remain visible'],
  ['Separate directories and workspace reuse', 'Automated coverage: native/CLI directory selection; real model file writes not exercised'],
  ['Rename/model edit retains room scope', 'Automated coverage: rename and reload retain scope; model edit needs a dedicated check'],
  ['Application shutdown', 'Automated coverage: late cleanup; real desktop shutdown not exercised'],
  ['Never-spoken legacy member survives upgrade', 'Automated coverage: global migration regression'],
  ['Post-upgrade new channel routes to primary', 'Automated coverage: plain message dispatch to the legacy primary'],
];
for (const [i, [name, status]] of cases.entries()) console.log(`${i + 1}. ${name}: ${status}`);
const serverTests = readdirSync(collab, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.test.mjs'))
  .map(entry => entry.name).sort();
if (!serverTests.length) throw new Error(`No collab test files found in ${collab}`);
console.log(`Server suite: ${serverTests.length} test files (${serverTests.join(', ')})`);
const commands = [
  [process.execPath, ['--test', ...serverTests], collab],
  ['pnpm', ['test'], resolve(collab, '..')],
];
for (const [command, args, cwd] of commands) {
  console.log(`\nRunning ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('\nAutomated suites passed. Acceptance remains incomplete: pending live checks and independent review above.');
console.log('Temporary data is retained for inspection; this script does not delete directories.');
process.exitCode = 2; // Distinguish partial verification from completed acceptance.
