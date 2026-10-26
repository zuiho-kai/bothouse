// Wrap tsdown's CJS lib/client.js into DSH's browser plugin format and inline lib/style.css.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = join(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const file = join(root, 'lib/client.js')
const body = readFileSync(file, 'utf8')
if (body.includes('window.__ModuleLoader__.load(')) process.exit(0)
const cssFile = join(root, 'lib/style.css')

// The embedded copy under bridge/core/dsh_bundle ships this file as-is; a source
// change that skips a rebuild would otherwise stay invisible. Record a digest of
// src/ at build time so bridge/core/dsh_bundle_sync_test.go can tell whether the
// mirror was rebuilt after the last source edit (#521).
function sourceDigest(dir) {
  const hash = createHash('sha256')
  const walk = (current, base) => {
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full, base)
        continue
      }
      const rel = relative(base, full).split(sep).join('/')
      hash.update(rel)
      hash.update('\0')
      hash.update(readFileSync(full))
      hash.update('\0')
    }
  }
  walk(dir, dir)
  return hash.digest('hex')
}
const tag = pkg.name.replace(/^@[^/]+\//, '')
const css = existsSync(cssFile)
  ? `(function(){var s=document.createElement('style');s.setAttribute('data-dsh-plugin',${JSON.stringify(tag)});s.textContent=${JSON.stringify(readFileSync(cssFile, 'utf8'))};document.head.appendChild(s)})();\n`
  : ''
writeFileSync(file, `// dsh-client-source-sha256: ${sourceDigest(join(root, 'src'))}
window.__ModuleLoader__.load({
 id: ${JSON.stringify(pkg.name)},
 factory: (require) => {
 var module = { exports: {} };
 var exports = module.exports;
${css}${body}
 return module.exports;
 }
});
`)
