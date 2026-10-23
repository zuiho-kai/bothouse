// Copies the dsh sources into bridge/core/dsh_bundle so the one-click installer ships
// the same files the repo edits. Run after touching dsh/collab, dsh/install.sh, the
// plugin package.json, or the built frontend lib (#150).
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import process from 'node:process'
import { BUILT_PAIRS, COPY_PAIRS, walk } from './dsh-bundle-pairs.mjs'

const root = process.cwd()

function copyTree(from, to, log) {
  const files = walk(join(root, from))
  if (files.length === 0) {
    log(`skip ${from}: nothing to copy`)
    return
  }
  for (const rel of files) {
    const src = join(root, from, rel)
    const dst = join(root, to, rel)
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(src, dst)
  }
  log(`copied ${files.length} file(s) ${from} -> ${to}`)
}

// The mirror is generated: drop mirror files whose source is gone, so a deleted
// collab module does not keep shipping.
function pruneStale(from, to, log) {
  for (const rel of walk(join(root, to))) {
    if (!existsSync(join(root, from, rel))) {
      rmSync(join(root, to, rel))
      log(`removed stale ${to}/${rel}`)
    }
  }
}

function main() {
  const log = (message) => console.log(message)
  for (const pair of COPY_PAIRS) {
    if (pair.file) {
      mkdirSync(dirname(join(root, pair.to)), { recursive: true })
      copyFileSync(join(root, pair.from), join(root, pair.to))
      log(`copied ${pair.from} -> ${pair.to}`)
      continue
    }
    copyTree(pair.from, pair.to, log)
    pruneStale(pair.from, pair.to, log)
  }
  for (const pair of BUILT_PAIRS) {
    if (!existsSync(join(root, pair.from))) {
      log(`skip ${pair.from}: build it first (the mirror keeps the last built copy)`)
      continue
    }
    copyTree(pair.from, pair.to, log)
  }
  log('now run: node scripts/check-dsh-bundle-sync.mjs')
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main()
