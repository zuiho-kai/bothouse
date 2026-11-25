import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from '../src/client/uuid.ts'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('randomUUID', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('uses crypto.randomUUID when the page is a secure context', () => {
    expect(randomUUID()).toMatch(V4)
  })

  it('falls back to getRandomValues on a plain-http page without crypto.randomUUID', () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })
    const ids = new Set(Array.from({ length: 50 }, () => randomUUID()))
    for (const id of ids) expect(id).toMatch(V4)
    expect(ids.size).toBe(50)
  })
})
