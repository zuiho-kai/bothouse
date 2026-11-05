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

for (const dir of ['collab', 'client', 'locale', 'node_modules']) rmSync(join(root, dir), { recursive: true, force: true })
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
// #1044: each page is its own bundled package (one browser half per package), one Plugins-page row each.
// Channels: the client-ui-discord build re-keyed to its package name.
const pagesDir = join(root, 'node_modules')
const uiPkg = JSON.parse(readFileSync(join(uiSrc, 'package.json'), 'utf8'))
const channels = { name: 'bothouse-dsh-channels', dir: join(pagesDir, 'bothouse-dsh-channels') }
let client = readFileSync(join(uiSrc, 'lib/client.js'), 'utf8')
const oldId = `id: ${JSON.stringify(uiPkg.name)},`
if (!client.includes(oldId)) throw Error(`build: ${oldId} not found in client-ui-discord lib/client.js`)
client = client.replace(oldId, `id: ${JSON.stringify(channels.name)},`)
  .replace(`'data-dsh-plugin',${JSON.stringify(uiPkg.name.replace(/^@[^/]+\//, ''))}`, `'data-dsh-plugin',${JSON.stringify(channels.name)}`)
mkdirSync(channels.dir, { recursive: true })
writeFileSync(join(channels.dir, 'client.js'), client)
writeFileSync(join(channels.dir, 'index.js'), '// Host half: nothing; the channels page lives entirely in ./client.js.\nexport function apply() {}\n')
cpSync(join(uiSrc, 'locale'), join(channels.dir, 'locale'), { recursive: true })
writeFileSync(join(channels.dir, 'package.json'), JSON.stringify({
  name: channels.name,
  version: pkg.dependencies[channels.name],
  description: uiPkg.description,
  type: 'module',
  main: './index.js',
  exports: { '.': './index.js', './client': './client.js', './locale/*.json': './locale/*.json', './package.json': './package.json' },
  license: 'Apache-2.0',
  dsh: { client: uiPkg.dsh.client },
}, null, 2) + '\n')
// Desk, panel, other computers: the committed generated packages (dsh/packages/bothouse-embeds).
for (const name of ['bothouse-dsh-desk', 'bothouse-dsh-panel', 'bothouse-dsh-devices']) {
  cpSync(join(root, '../packages', name), join(pagesDir, name), { recursive: true })
  const version = JSON.parse(readFileSync(join(pagesDir, name, 'package.json'), 'utf8')).version
  if (version !== pkg.dependencies[name]) throw Error(`build: ${name} is ${version}, package.json depends on ${pkg.dependencies[name]}`)
}
// The bundle's own title and description on the Plugins page.
cpSync(join(collabSrc, 'locale'), join(root, 'locale'), { recursive: true })
console.log(`build: staged ${pkg.name}@${pkg.version}`)
