// Fails when bridge/core/dsh_bundle has drifted from the dsh sources it ships.
// Without this, a channel change that forgets the mirror installs an old plugin and
// nothing reports it (#150; #133, #138, #141 were each re-typed by hand).
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'
import {
  BUILT_PAIRS,
  BUNDLE_WRAPPER_MARKER,
  COPY_PAIRS,
  walk,
} from './dsh-bundle-pairs.mjs'

const root = process.cwd()

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// Two-sided: a file missing from the mirror means the installer never gets it, and a
// file left in the mirror after the source moved away means the installer gets a file
// nobody edits any more.
export function compareTree(rootDir, pair) {
  const problems = []
  if (pair.file) {
    const src = join(rootDir, pair.from)
    const mirror = join(rootDir, pair.to)
    if (!existsSync(mirror)) {
      problems.push({ kind: 'missing', path: pair.to, from: pair.from })
    } else if (sha256(src) !== sha256(mirror)) {
      problems.push({ kind: 'differs', path: pair.to, from: pair.from })
    }
    return problems
  }
  const srcFiles = walk(join(rootDir, pair.from))
  const mirrorFiles = walk(join(rootDir, pair.to))
  const srcSet = new Set(srcFiles)
  const mirrorSet = new Set(mirrorFiles)
  for (const rel of srcFiles) {
    const src = join(rootDir, pair.from, rel)
    const mirror = join(rootDir, pair.to, rel)
    if (!mirrorSet.has(rel)) {
      problems.push({ kind: 'missing', path: `${pair.to}/${rel}`, from: `${pair.from}/${rel}` })
      continue
    }
    if (sha256(src) !== sha256(mirror)) {
      problems.push({ kind: 'differs', path: `${pair.to}/${rel}`, from: `${pair.from}/${rel}` })
    }
  }
  for (const rel of mirrorFiles) {
    if (!srcSet.has(rel)) problems.push({ kind: 'stale', path: `${pair.to}/${rel}` })
  }
  return problems
}

// The frontend lib/ is build output, so the content check cannot compare it with
// src/. Instead: it must carry the wrapper the installer's loader expects, and a
// commit that edits src/ must also touch the mirror.
export function checkBuiltPair(rootDir, pair) {
  const problems = []
  const dir = join(rootDir, pair.to)
  if (!existsSync(dir)) {
    problems.push({ kind: 'missing', path: pair.to })
    return problems
  }
  // Only the browser export is wrapped (wrap-client.mjs); index.js is the host half
  // and stays plain ESM.
  const manifestPath = join(rootDir, `${pair.to}/../package.json`)
  let browser = 'lib/client.js'
  let name = ''
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    name = manifest.name ?? ''
    const exported = manifest.exports?.['./client']
    if (typeof exported === 'string') browser = exported.replace(/^\.\//, '')
  }
  const browserPath = join(rootDir, pair.to, browser.replace(/^lib\//, ''))
  if (!existsSync(browserPath)) {
    problems.push({ kind: 'missing', path: `${pair.to}/${browser}` })
    return problems
  }
  const body = readFileSync(browserPath, 'utf8')
  if (!body.includes(BUNDLE_WRAPPER_MARKER)) {
    problems.push({ kind: 'unwrapped', path: `${pair.to}/${browser}` })
  } else if (name && !body.includes(`id: ${JSON.stringify(name)}`)) {
    // A bundle registered under another id never attaches to this package.
    problems.push({ kind: 'wrong-id', path: `${pair.to}/${browser}`, from: name })
  }
  return problems
}

// Only meaningful over a commit range; a plain working-tree run cannot tell whether
// src/ moved since the mirror was last written.
export function checkBuiltStaleness(rootDir, pair, changed) {
  const srcTouched = changed.filter((p) => p.startsWith(`${pair.src}/`))
  if (srcTouched.length === 0) return []
  const mirrorTouched = changed.filter((p) => p.startsWith(`${pair.to}/`))
  if (mirrorTouched.length > 0) return []
  return [{ kind: 'unsynced', path: pair.to, from: pair.src, sample: srcTouched.slice(0, 3) }]
}

function changedFiles(rootDir, base) {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    cwd: rootDir,
    encoding: 'utf8',
  })
  return out.split('\n').filter(Boolean)
}

export function check(rootDir, options = {}) {
  const problems = []
  const changed = options.base ? changedFiles(rootDir, options.base) : null
  for (const pair of COPY_PAIRS) problems.push(...compareTree(rootDir, pair))
  for (const pair of BUILT_PAIRS) {
    problems.push(...checkBuiltPair(rootDir, pair))
    if (changed) problems.push(...checkBuiltStaleness(rootDir, pair, changed))
  }
  return problems
}

function describe(problem) {
  switch (problem.kind) {
    case 'missing':
      return `missing in mirror: ${problem.path}` + (problem.from ? ` (from ${problem.from})` : '')
    case 'differs':
      return `differs: ${problem.path} != ${problem.from}`
    case 'stale':
      return `stale in mirror (source gone): ${problem.path}`
    case 'unwrapped':
      return `not wrapped for the plugin loader: ${problem.path}`
    case 'wrong-id':
      return `bundle registers another id (expected ${problem.from}): ${problem.path}`
    case 'unsynced':
      return `src changed without the mirror: ${problem.from} -> ${problem.path}` +
        (problem.sample ? ` (e.g. ${problem.sample.join(', ')})` : '')
    default:
      return `${problem.kind}: ${problem.path}`
  }
}

function main() {
  const args = process.argv.slice(2)
  const baseAt = args.indexOf('--base')
  const base = baseAt >= 0 ? args[baseAt + 1] : null
  const problems = check(root, { base })
  if (problems.length === 0) {
    console.log('dsh bundle in sync with dsh/ sources')
    return
  }
  console.error(`dsh bundle out of sync (${problems.length} problem(s)):`)
  for (const problem of problems) console.error(`  - ${describe(problem)}`)
  console.error('')
  console.error('Fix with: node scripts/sync-dsh-bundle.mjs')
  console.error('If only the frontend lib/ moved, build it first:')
  console.error('  cd dsh/packages/client-ui-discord && npx -y pnpm@10 install --frozen-lockfile && npx -y pnpm@10 run build')
  process.exit(1)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main()
