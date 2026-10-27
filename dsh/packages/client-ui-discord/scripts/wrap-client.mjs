// Wrap tsdown's CJS lib/client.js into DSH's browser plugin format and inline lib/style.css.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const file = join(root, 'lib/client.js')
const body = readFileSync(file, 'utf8')
if (body.startsWith('window.__ModuleLoader__')) process.exit(0)
// Bind the built client to the source inputs so stale packaged assets fail CI.
const inputs = ['package.json', 'tsdown.config.ts', 'scripts/wrap-client.mjs', ...readdirSync(join(root, 'src'), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => 'src/' + join(entry.parentPath, entry.name).slice(join(root, 'src').length + 1))].sort()
const hash = createHash('sha256')
for (const path of inputs) hash.update(path).update('\0').update(readFileSync(join(root, path))).update('\0')
writeFileSync(join(root, 'lib/source-stamp.txt'), hash.digest('hex') + '\n')
const cssFile = join(root, 'lib/style.css')
const tag = pkg.name.replace(/^@[^/]+\//, '')
const css = existsSync(cssFile)
  ? `(function(){var s=document.createElement('style');s.setAttribute('data-dsh-plugin',${JSON.stringify(tag)});s.textContent=${JSON.stringify(readFileSync(cssFile, 'utf8'))};document.head.appendChild(s)})();\n`
  : ''
writeFileSync(file, `window.__ModuleLoader__.load({
 id: ${JSON.stringify(pkg.name)},
 factory: (require) => {
 var module = { exports: {} };
 var exports = module.exports;
${css}${body}
 return module.exports;
 }
});
`)
