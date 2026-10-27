// Wrap tsdown's CJS lib/client.js into DSH's browser plugin format and inline lib/style.css.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const file = join(root, 'lib/client.js')
const cssFile = join(root, 'lib/style.css')
const manifestFile = join(root, 'lib/build.json')

// Everything that changes the generated bundle. bridge/core/dsh_bundle_sync_test.go
// computes the same list and must stay in sync with it.
const fixedInputs = ['package.json', 'tsdown.config.ts', 'scripts/wrap-client.mjs', 'pnpm-lock.yaml']

function walk(dir, prefix, files) {
  const entries = readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    const rel = `${prefix}/${entry.name}`
    if (entry.isDirectory()) walk(join(dir, entry.name), rel, files)
    else files.push(rel)
  }
}

function buildInputs() {
  const files = []
  walk(join(root, 'src'), 'src', files)
  files.push(...fixedInputs)
  return files.sort()
}

function sourceDigest() {
  const hash = createHash('sha256')
  for (const rel of buildInputs()) {
    hash.update(rel)
    hash.update('\0')
    hash.update(readFileSync(join(root, rel)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function styleDigest() {
  return createHash('sha256').update(readFileSync(cssFile)).digest('hex')
}

function bundleStamps() {
  const lines = readFileSync(file, 'utf8').split('\n', 3)
  const sourcePrefix = '// dsh-client-source-sha256: '
  const stylePrefix = '// dsh-style-sha256: '
  if (!lines[0]?.startsWith(sourcePrefix) || !lines[1]?.startsWith(stylePrefix)) {
    throw new Error(`${file}: missing build stamps`)
  }
  return { source: lines[0].slice(sourcePrefix.length), style: lines[1].slice(stylePrefix.length) }
}

const mode = process.argv[2]
if (mode === '--print-source-digest') {
  console.log(sourceDigest())
  process.exit(0)
}
if (mode === '--check') {
  try {
    const stamps = bundleStamps()
    const source = sourceDigest()
    const style = styleDigest()
    if (stamps.source !== source || stamps.style !== style) {
      console.error(`bundle is stale: source ${stamps.source} (want ${source}), style ${stamps.style} (want ${style})`)
      process.exit(1)
    }
    console.log('bundle matches source')
    process.exit(0)
  } catch (err) {
    console.error(String(err.message || err))
    process.exit(1)
  }
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
let body = readFileSync(file, 'utf8')
if (body.includes('window.__ModuleLoader__.load(')) process.exit(0)
// tsdown/rolldown labels each bundled dependency with its source path. When the package
// is installed through a hoisted node_modules, that label leaks the checkout location and
// makes byte-identical rebuilds impossible. The labels are diagnostics only.
body = body.replace(/^\/\/ .*node_modules\/.*(?:\r?\n|$)/gm, '')

const css = readFileSync(cssFile, 'utf8')
const source = sourceDigest()
const style = styleDigest()
const tag = pkg.name.replace(/^@[^/]+\//, '')
writeFileSync(file, `// dsh-client-source-sha256: ${source}
// dsh-style-sha256: ${style}
window.__ModuleLoader__.load({
 id: ${JSON.stringify(pkg.name)},
 factory: (require) => {
 var module = { exports: {} };
 var exports = module.exports;
(function(){var s=document.createElement('style');s.setAttribute('data-dsh-plugin',${JSON.stringify(tag)});s.textContent=${JSON.stringify(css)};document.head.appendChild(s)})();
${body}
 return module.exports;
 }
});
`)
writeFileSync(manifestFile, JSON.stringify({ format: 1, sourceDigest: source, styleSha256: style }, null, 2) + '\n')
