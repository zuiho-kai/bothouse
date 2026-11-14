#!/usr/bin/env node
// Generate the DSH plugin the bridge embeds: bridge/core/dsh_bundle/{collab,packages}. Those two
// directories are not in git; dsh_bundle/install.sh is, and is left alone. `make dshbundle` in
// bridge/ runs this, and `make build` / `make build-noweb` run that first (same shape as hubsrc).
//
//   collab/                      dsh/collab without tests, plus the team rules from bridge/core/team_rules
//   packages/bothouse-dsh-*/     dsh/packages/bothouse-dsh-* as committed
//   packages/client-ui-discord/  package.json, locale/ and lib/ (built here when its stamp does not match src)
//
// PNPM overrides the pnpm command (CI: PNPM="npx -y pnpm@10.34.7").
import { execSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'

const dsh = join(import.meta.dirname, '..')
const core = join(dsh, '../bridge/core')
const out = join(core, 'dsh_bundle')
const pnpm = process.env.PNPM || 'pnpm'

for (const dir of ['collab', 'packages']) rmSync(join(out, dir), { recursive: true, force: true })

// collab: everything the plugin runs or serves; tests, their fixtures and install leftovers stay out.
const skipDirs = new Set(['node_modules', 'test', 'ui-snap', 'desk-e2e'])
const skipFiles = new Set(['.npmrc', 'package-lock.json', '.DS_Store'])
cpSync(join(dsh, 'collab'), join(out, 'collab'), {
  recursive: true,
  filter: (src) => {
    const name = basename(src)
    return !skipDirs.has(name) && !skipFiles.has(name) && !name.endsWith('.test.mjs')
  },
})
for (const f of ['team-mode-rules.md', 'team-exit-rules.json']) cpSync(join(core, 'team_rules', f), join(out, 'collab', f))

for (const name of ['bothouse-dsh-desk', 'bothouse-dsh-panel', 'bothouse-dsh-devices']) {
  cpSync(join(dsh, 'packages', name), join(out, 'packages', name), { recursive: true, filter: (src) => basename(src) !== 'node_modules' })
}

// client-ui-discord: lib/ is a build product (tsdown + wrap-client.mjs). wrap-client.mjs --check
// compares the stamp in lib/client.js with a digest of the build inputs, so an up-to-date lib/ is reused.
const ui = join(dsh, 'packages/client-ui-discord')
const fresh = () => spawnSync(process.execPath, ['scripts/wrap-client.mjs', '--check'], { cwd: ui, stdio: 'ignore' }).status === 0
if (!fresh()) {
  console.log('dshbundle: building client-ui-discord')
  execSync(`${pnpm} install --frozen-lockfile --ignore-workspace`, { cwd: ui, stdio: 'inherit' })
  execSync(`${pnpm} run bundle`, { cwd: ui, stdio: 'inherit' })
  if (!fresh()) throw new Error('dshbundle: client-ui-discord lib/ still does not match its sources after the build')
}
const uiOut = join(out, 'packages/client-ui-discord')
mkdirSync(uiOut, { recursive: true })
cpSync(join(ui, 'package.json'), join(uiOut, 'package.json'))
for (const dir of ['locale', 'lib']) cpSync(join(ui, dir), join(uiOut, dir), { recursive: true })
for (const f of ['collab/plugin.mjs', 'packages/client-ui-discord/lib/client.js']) {
  if (!existsSync(join(out, f))) throw new Error(`dshbundle: ${f} missing from ${out}`)
}
console.log(`dshbundle: wrote ${out}`)
