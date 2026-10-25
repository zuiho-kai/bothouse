// CLI 成员：把本机 claude / codex / gemini 通过 ACP 适配器接成群成员。
// 每个（成员, 房间）一个 ACP session；ask(text) 返回该轮 agent_message_chunk 拼接文本。
import { spawn } from 'node:child_process'
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
    this.sessions = new Map() // room -> { sessionId }（当前 ACP 进程里活着的会话）
    this.saved = new Map() // room -> sessionId：进程退出后留着，下次用 loadSession 续上
    this.onPermission = new Map() // sessionId -> (request) => Promise<outcome>：转成频道审批卡
    this.buffers = new Map() // sessionId -> string
    this.onText = new Map() // sessionId -> (textSoFar) => void（#121 流式）
    this.onTool = new Map() // sessionId -> (update) => void：tool_call / tool_call_update / agent_thought_chunk，给进度卡
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
      // 不再自动放行：交给本轮的 onPermission（频道审批卡）。没有人接（不在某一轮里）就按取消处理。
      requestPermission: async (r) => {
        const handler = this.onPermission.get(r.sessionId)
        if (!handler) return { outcome: { outcome: 'cancelled' } }
        return { outcome: await handler(r) }
      },
      sessionUpdate: async (n) => {
        const u = n.update
        if (u?.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text' && this.buffers.has(n.sessionId)) {
          const full = this.buffers.get(n.sessionId) + u.content.text
          this.buffers.set(n.sessionId, full)
          this.onText.get(n.sessionId)?.(full)
        }
        if ((u?.sessionUpdate === 'tool_call' || u?.sessionUpdate === 'tool_call_update' || u?.sessionUpdate === 'agent_thought_chunk') && this.buffers.has(n.sessionId)) this.onTool.get(n.sessionId)?.(u)
      },
    }
    const stream = acp.ndJsonStream(Writable.toWeb(proc.stdin), Readable.toWeb(proc.stdout))
    this.conn = new acp.ClientSideConnection(() => client, stream)
    const exited = new Promise((_, rej) => {
      proc.once('error', rej)
      proc.once('exit', (code) => {
        this.ready = null
        // 会话 id 留到 saved，新进程起来后用 loadSession 续上（不支持时由调用方提示频道）。
        for (const [room, s] of this.sessions) this.saved.set(room, s.sessionId)
        this.sessions.clear()
        rej(new Error(`${this.cli} acp exited: ${code}`))
      })
    })
    exited.catch(() => {})
    this.exited = exited
    this.ready = Promise.race([
      this.conn.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} }),
      exited,
    ]).then((init) => { this.canLoad = init?.agentCapabilities?.loadSession === true; return init })
    return this.ready
  }

  /**
   * 房间的 ACP 会话。resumeId 是上次存下的 sessionId（bindings 里的）：CLI 声明了
   * agentCapabilities.loadSession 就用 session/load 续上；不支持或续失败就开新会话，
   * 返回 lost: true，由调用方在频道里说明上下文没了。
   */
  async _session(room, resumeId) {
    let s = this.sessions.get(room)
    if (s) return { ...s, resumed: false, lost: false }
    await this._start()
    const prevId = resumeId || this.saved.get(room)
    this.saved.delete(room)
    if (prevId && this.canLoad) {
      try {
        await Promise.race([this.conn.loadSession({ sessionId: prevId, cwd: this.cwd, mcpServers: [] }), this.exited])
        s = { sessionId: prevId }
        this.sessions.set(room, s)
        return { ...s, resumed: true, lost: false }
      } catch (err) {
        if (!this.ready) throw err // 进程在 load 时退出：照常报错
      }
    }
    const r = await Promise.race([this.conn.newSession({ cwd: this.cwd, mcpServers: [] }), this.exited])
    s = { sessionId: r.sessionId }
    this.sessions.set(room, s)
    return { ...s, resumed: false, lost: Boolean(prevId) }
  }

  /**
   * onText(textSoFar) 在每个公开文字分片到达时调用（#121）；onTool(update) 在每个工具调用开始/更新和每个思考分片到达时调用。
   * opts.resumeId：要续上的 sessionId；opts.onSession({ sessionId, resumed, lost })：会话就绪后、发提示词前调用；
   * opts.onPermission(request)：CLI 的 session/request_permission，返回 ACP outcome（{ outcome: 'selected', optionId } 或 { outcome: 'cancelled' }）。
   */
  ask(text, room = 'default', onText, onTool, opts = {}) {
    const prev = this.queue.get(room) || Promise.resolve()
    const run = prev.catch(() => {}).then(() => this._ask(text, room, onText, onTool, opts))
    this.queue.set(room, run)
    return run
  }

  async _ask(text, room, onText, onTool, { resumeId, onSession, onPermission } = {}) {
    const s = await this._session(room, resumeId)
    await onSession?.(s)
    // persona 每轮都拼：续上的或新开的会话都不会丢人设。
    const body = this.persona ? `${this.persona}\n\n${text}` : text
    this.buffers.set(s.sessionId, '')
    if (onText) this.onText.set(s.sessionId, onText)
    if (onTool) this.onTool.set(s.sessionId, onTool)
    if (onPermission) this.onPermission.set(s.sessionId, onPermission)
    try {
      await Promise.race([
        this.conn.prompt({ sessionId: s.sessionId, prompt: [{ type: 'text', text: body }] }),
        this.exited,
      ])
      return this.buffers.get(s.sessionId)
    } finally {
      this.buffers.delete(s.sessionId)
      this.onText.delete(s.sessionId)
      this.onTool.delete(s.sessionId)
      this.onPermission.delete(s.sessionId)
    }
  }

  close() {
    this.proc?.kill()
    this.sessions.clear()
    this.saved.clear()
    this.ready = null
  }
}

export function createCliMember(opts) { return new CliMember(opts) }
