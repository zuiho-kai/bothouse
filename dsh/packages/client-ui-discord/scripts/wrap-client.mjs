// Wrap tsdown's CJS lib/client.js into DSH's browser plugin format and inline lib/style.css.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const file = join(root, 'lib/client.js')
const body = readFileSync(file, 'utf8')
if (body.startsWith('window.__ModuleLoader__')) process.exit(0)
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
