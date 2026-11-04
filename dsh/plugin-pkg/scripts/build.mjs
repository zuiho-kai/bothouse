// Stage the npm package: copy the collab host plugin and the prebuilt channels UI next to package.json.
// engines.dsh in package.json is pinned to 0.2.1-rc.2 because the UI is compiled against that DSH
// release (dsh/upstream.pin.json, client-ui-discord devDependencies); bump all three together.
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = join(import.meta.dirname, '..')
const collabSrc = join(root, '../collab')
const uiSrc = join(root, '../packages/client-ui-discord')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

for (const dir of ['collab', 'client']) rmSync(join(root, dir), { recursive: true, force: true })
mkdirSync(join(root, 'collab/avatars'), { recursive: true })
mkdirSync(join(root, 'client'))
for (const f of readdirSync(collabSrc)) {
  if ((f.endsWith('.mjs') && !f.endsWith('.test.mjs')) || f === 'page.html') cpSync(join(collabSrc, f), join(root, 'collab', f))
}
for (const f of readdirSync(join(collabSrc, 'avatars'))) {
  if (f.endsWith('.png')) cpSync(join(collabSrc, 'avatars', f), join(root, 'collab/avatars', f))
}
// Files the plugin reads next to its modules at run time (new URL('./…', import.meta.url)); a missing one
// breaks the installed plugin (0.1.45 shipped without personas.json and failed to load at all).
for (const f of ['personas.json', 'team-exit-rules.json', 'team-mode-rules.md', 'desk/index.html', 'devices.html', 'wiki-galaxy/index.html']) {
  mkdirSync(join(root, 'collab', dirname(f)), { recursive: true })
  cpSync(join(collabSrc, f), join(root, 'collab', f))
}
// The handoff rules live in the bridge (contrib/lead); a checkout reads them from there, a package needs its own copy.
cpSync(join(root, '../../bridge/contrib/lead/handoff-rules.json'), join(root, 'collab/handoff-rules.json'))

const run = (cmd) => execSync(cmd, { cwd: uiSrc, stdio: 'inherit' })
run('npx -y pnpm@10 install --ignore-workspace --config.confirmModulesPurge=false')
run('npx -y pnpm@10 run bundle')
// DSH loads a package's browser half under the package name; the UI is built as its own package, so re-key it.
const uiPkg = JSON.parse(readFileSync(join(uiSrc, 'package.json'), 'utf8'))
let client = readFileSync(join(uiSrc, 'lib/client.js'), 'utf8')
const oldId = `id: ${JSON.stringify(uiPkg.name)},`
if (!client.includes(oldId)) throw Error(`build: ${oldId} not found in client-ui-discord lib/client.js`)
client = client.replace(oldId, `id: ${JSON.stringify(pkg.name)},`)
  .replace(`'data-dsh-plugin',${JSON.stringify(uiPkg.name.replace(/^@[^/]+\//, ''))}`, `'data-dsh-plugin',${JSON.stringify(pkg.name)}`)
writeFileSync(join(root, 'client/client.js'), client)
console.log(`build: staged ${pkg.name}@${pkg.version}`)
