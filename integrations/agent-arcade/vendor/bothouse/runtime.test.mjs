import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { randomUUID } from './upstream/dsh/packages/client-ui-discord/src/client/uuid.ts'

const require = createRequire(import.meta.url)

test('vendored UI UUID works with and without crypto.randomUUID', t => {
  const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  assert.match(randomUUID(), v4)
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
  t.after(() => Object.defineProperty(globalThis, 'crypto', original))
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } })
  const fallback = new Set(Array.from({ length: 16 }, () => randomUUID()))
  assert.equal(fallback.size, 16)
  for (const uuid of fallback) assert.match(uuid, v4)
})

test('the original queue plays out-of-order chunks in order and drops late playback', () => {
  const QueuePlayer = require('./upstream/role-household/rh/static/queue-player.js')
  const listeners = new Map()
  const played = []
  const audio = {
    src: '', duration: 3, currentTime: 0, paused: true, ended: false,
    load() { this.ended = false },
    pause() { this.paused = true },
    play() {
      this.paused = false
      played.push(this.src)
      listeners.get('playing')?.()
      return Promise.resolve()
    },
    addEventListener(name, callback) { listeners.set(name, callback) },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name)
    },
    finish() { this.ended = true; listeners.get('ended')?.() },
  }
  const player = new QueuePlayer(audio, { baseURL: 'https://fixture.invalid/audio/' })
  const chunk = index => ({ index, duration_seconds: 1, audio_url: index + '.wav' })
  const turn = (id, chunks, done = false) =>
    ({ id, status: done ? 'ready' : 'running', audio_chunks: chunks, audio_complete: done })
  player.select(turn('first', [chunk(1)]))
  player.start()
  assert.deepEqual(played, [])
  player.update(turn('first', [chunk(0), chunk(1)], true))
  audio.finish()
  audio.finish()
  assert.deepEqual(played, ['https://fixture.invalid/audio/0.wav', 'https://fixture.invalid/audio/1.wav'])
  player.select(turn('next', [chunk(0)]))
  player.start()
  const late = listeners.get('ended')
  player.stop()
  late()
  player.update(turn('next', [chunk(1)], true))
  player.select(turn('other-origin', [{ ...chunk(0), audio_url: 'https://other.invalid/a.wav' }]))
  player.start()
  assert.equal(audio.paused, true)
  assert.equal(played.length, 3)
})

test('the direct Wiki templates and 56 collaboration cases retain their source contracts', () => {
  const read = source => readFileSync(new URL('./upstream/' + source, import.meta.url), 'utf8')
  const templates = 'bridge/contrib/wiki/template/'
  assert.match(read(templates + 'LICENSE'), /^MIT License/u)
  assert.match(read(templates + 'SOURCE'), /llm-wiki @ 51452dc, MIT/u)
  for (const schema of ['CLAUDE.md', 'CLAUDE.zh-CN.md']) {
    const text = read(templates + 'schema/' + schema)
    for (const classification of ['亲验', '转述', '原话']) assert(text.includes(classification))
  }
  const root = 'bridge/core/team_rules/'
  const cases = JSON.parse(read(root + 'testdata/team-exit-cases.json'))
  const rules = JSON.parse(read(root + 'team-exit-rules.json'))
  const rows = Object.entries(cases).filter(([key, value]) => key !== '_doc' && Array.isArray(value))
  assert.equal(rows.reduce((count, [, value]) => count + value.length, 0), 56)
  for (const { want } of cases.evidence) {
    for (const key of want) assert.equal(typeof key.split('.').reduce((value, part) => value?.[part], rules), 'string')
  }
})
