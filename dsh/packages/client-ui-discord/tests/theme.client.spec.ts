import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { color, PALETTE } from '../src/client/theme.ts'

const clientSrcDir = fileURLToPath(new URL('../src/client', import.meta.url))

function findCssFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...findCssFiles(full))
    } else if (entry.endsWith('.css')) {
      out.push(full)
    }
  }
  return out
}

describe('theme closeout (PR1 / Issue #5)', () => {
  it('contains no hex colors in any CSS files under client-ui-discord', () => {
    const cssFiles = findCssFiles(clientSrcDir)
    expect(cssFiles.length).toBeGreaterThan(0)

    const hexColorRegex = /#([0-9a-fA-F]{3,8})\b/g
    const violations: { file: string; line: number; text: string; match: string }[] = []

    for (const file of cssFiles) {
      const content = readFileSync(file, 'utf-8')
      // Strip comments to avoid false-flagging documentation notes
      const cleanContent = content.replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length))
      const lines = cleanContent.split('\n')

      lines.forEach((lineText, idx) => {
        const matches = lineText.match(hexColorRegex)
        if (matches) {
          for (const m of matches) {
            violations.push({
              file,
              line: idx + 1,
              text: lineText.trim(),
              match: m,
            })
          }
        }
      })
    }

    expect(violations, `Disallowed hex colors in CSS: ${JSON.stringify(violations, null, 2)}`).toEqual([])
  })

  it('avatar PALETTE uses DSH semantic alias tokens and contains no hex colors', () => {
    expect(PALETTE.length).toBeGreaterThanOrEqual(4)
    const hexColorRegex = /#([0-9a-fA-F]{3,8})\b/

    for (const token of PALETTE) {
      expect(token).not.toMatch(hexColorRegex)
      expect(token.startsWith('var(--dsw-alias-')).toBe(true)
    }

    // Deterministic hashing returns a palette member
    const colorA = color('member-alpha')
    const colorB = color('member-beta')
    expect(PALETTE).toContain(colorA)
    expect(PALETTE).toContain(colorB)
  })
})
