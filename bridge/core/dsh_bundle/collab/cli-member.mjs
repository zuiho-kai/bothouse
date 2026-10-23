// CLI 成员：把本机 claude / codex / gemini 通过 ACP 适配器接成群成员。
// 每个（成员, 房间）一个 ACP session；ask(text) 返回该轮 agent_message_chunk 拼接文本。
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
const TEAM_MODE_RULES = readFileSync(new URL('./team-mode-rules.md', import.meta.url), 'utf8').trim()
import { Readable, Writable } from 'node:stream'
import { createRequire } from 'node:module'
import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk'

const require = createRequire(import.meta.url)

// 适配器包名/命令来自用户派活原话（2026-10-23）
const ADAPTERS = {
  claude: { pkg: '@zed-industries/claude-code-acp', args: [] },
  codex: { pkg: '@agentclientprotocol/codex-acp', args: [] },
  gemini: { cmd: 'gemini', args: ['--acp'] },
}

function resolveBin(pkg) {
  try {
    const pj = require.resolve(`${pkg}/package.json`)
    const meta = require(pj)
    const bin = typeof meta.bin === 'string' ? meta.bin : Object.values(meta.bin || {})[0]
    if (bin) return { cmd: process.execPath, args: [path.join(path.dirname(pj), bin)] }
  } catch {}
  return { cmd: 'npx', args: ['-y', pkg] }
}

function cleanEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('CLAUDECODE') && !k.startsWith('CLAUDE_CODE_')))
}

export class CliMember {
  constructor({ cli, cwd, persona = '', env } = {}) {
    if (!ADAPTERS[cli]) throw new Error(`unknown cli: ${cli}`)
    this.cli = cli
    this.cwd = cwd || process.cwd()
    this.persona = persona
    this.extraEnv = env || {}
    this.sessions = new Map() // room -> { sessionId, first }
    this.buffers = new Map() // sessionId -> string
    this.onText = new Map() // sessionId -> (textSoFar) => void（#121 流式）
    this.queue = new Map() // room -> Promise（同房间串行）
    this.ready = null
  }

  _start() {
    if (this.ready) return this.ready
    const a = ADAPTERS[this.cli]
    const { cmd, args } = a.pkg ? resolveBin(a.pkg) : { cmd: a.cmd, args: [] }
    const proc = spawn(cmd, [...args, ...a.args], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...cleanEnv(), ...this.extraEnv },
    })
    this.proc = proc
    const client = {
      async requestPermission(r) {
        const o = r.options.find((x) => x.kind?.startsWith('allow')) || r.options[0]
        return { outcome: { outcome: 'selected', optionId: o.optionId } }
      },
      sessionUpdate: async (n) => {
        const u = n.update
        if (u?.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text' && this.buffers.has(n.sessionId)) {
          const full = this.buffers.get(n.sessionId) + u.content.text
          this.buffers.set(n.sessionId, full)
          this.onText.get(n.sessionId)?.(full)
        }
      },
    }
    const stream = acp.ndJsonStream(Writable.toWeb(proc.stdin), Readable.toWeb(proc.stdout))
    this.conn = new acp.ClientSideConnection(() => client, stream)
    const exited = new Promise((_, rej) => {
      proc.once('error', rej)
      proc.once('exit', (code) => { this.ready = null; rej(new Error(`${this.cli} acp exited: ${code}`)) })
    })
    exited.catch(() => {})
    this.exited = exited
    this.ready = Promise.race([
      this.conn.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} }),
      exited,
    ])
    return this.ready
  }

  async _session(room) {
    let s = this.sessions.get(room)
    if (s) return s
    await this._start()
    const r = await Promise.race([this.conn.newSession({ cwd: this.cwd, mcpServers: [] }), this.exited])
    s = { sessionId: r.sessionId, first: true }
    this.sessions.set(room, s)
    return s
  }

  /** onText(textSoFar) 在每个公开文字分片到达时调用（#121）。 */
  ask(text, room = 'default', onText) {
    const prev = this.queue.get(room) || Promise.resolve()
    const run = prev.catch(() => {}).then(() => this._ask(text, room, onText))
    this.queue.set(room, run)
    return run
  }

  async _ask(text, room, onText) {
    const s = await this._session(room)
    const body = s.first ? `${TEAM_MODE_RULES}\n\n${this.persona}\n\n${text}` : text
    s.first = false
    this.buffers.set(s.sessionId, '')
    if (onText) this.onText.set(s.sessionId, onText)
    try {
      await Promise.race([
        this.conn.prompt({ sessionId: s.sessionId, prompt: [{ type: 'text', text: body }] }),
        this.exited,
      ])
      return this.buffers.get(s.sessionId)
    } finally {
      this.buffers.delete(s.sessionId)
      this.onText.delete(s.sessionId)
    }
  }

  close() {
    this.proc?.kill()
    this.sessions.clear()
    this.ready = null
  }
}

export function createCliMember(opts) { return new CliMember(opts) }
