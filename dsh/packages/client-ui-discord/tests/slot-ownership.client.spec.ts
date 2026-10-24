// @vitest-environment jsdom
// DSH slot names are global: SlotCore throws `slot "<name>" is already declared` when a second
// entry declares a child slot another plugin already owns, and the throwing plugin's whole tree
// fails to mount. Declaring `settings.section` here once took down the settings shell (account
// menu, Cmd+, settings, connection state, update badge). These checks keep every slot this
// plugin declares inside its own namespace and clear of every slot built-in plugins declare.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { NS } from '../src/client/locales.ts'
import upstream from './helpers/upstream-slots.json' with { type: 'json' }

vi.mock('../src/client/ChannelsIcon.tsx', () => ({ ChannelsIcon: () => null }))

const builtIn = new Set(upstream.slots)

function assertOwned(declared: string[], where: string) {
  expect(new Set(declared).size, `${where}: duplicate declarations`).toBe(declared.length)
  for (const name of declared) {
    expect(builtIn.has(name), `${where}: "${name}" is declared by a built-in DSH plugin`).toBe(false)
    expect(name.startsWith(`${NS}.`), `${where}: "${name}" is outside the ${NS}.* namespace`).toBe(true)
  }
}

it('the upstream slot list itself has no duplicates and includes the settings shell slots', () => {
  expect(builtIn.size).toBe(upstream.slots.length)
  expect(builtIn.has('settings.section')).toBe(true)
})

it('source: every child slot the channel plugin declares is its own', () => {
  const declared: string[] = []
  const cleanups: (() => void)[] = []
  const ctx = {
    effect: (effect: () => (() => void)) => { cleanups.push(effect()) },
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    slots: {
      inject: (_slot: string, register: () => (() => void)) => { cleanups.push(register()) },
      register: (definition: { children?: Record<string, unknown> }) => {
        declared.push(...Object.keys(definition.children ?? {}))
        return () => {}
      },
      registerFactory: (definition: { children?: Record<string, unknown> }) => {
        declared.push(...Object.keys(definition.children ?? {}))
        return () => {}
      },
    },
    layout: { selectPanel: vi.fn() },
  }
  try {
    apply(ctx as unknown as Parameters<typeof apply>[0])
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup()
  }
  assertOwned(declared, 'src')
})

it('bundle: the shipped client build declares only its own child slots', () => {
  // The bundle is a generated copy; a stale build would still carry a removed declaration.
  const bundle = readFileSync(join(import.meta.dirname, '../../../../bridge/core/dsh_bundle/packages/client-ui-discord/lib/client.js'), 'utf8')
  const declared: string[] = []
  for (const table of bundle.matchAll(/children:\s*\{((?:\s*["'][^"']+["']:\s*\{\s*kind:[^}]*\},?)+)\s*\}/g)) {
    for (const name of table[1].matchAll(/["']([^"']+)["']:\s*\{\s*kind/g)) declared.push(name[1])
  }
  assertOwned(declared, 'bundle')
})
