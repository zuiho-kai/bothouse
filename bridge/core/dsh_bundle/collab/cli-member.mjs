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

// DSH 原生权限档位：与 DSH 预设同名（@deepseek-ai/dsh-base cordis.patch.yml:264-276 预设表；
// UI 名见 @deepseek-ai/dsh-client-ui-permission-presets README.zh.md:32）。默认档 = DSH 默认
// workspace-write（dsh-base cordis.patch.yml:243-262：DSH_PERMISSION_MODE ?? 'workspace-write'）。
// collab 运行时拿不到 DSH 包里的常量（DSH 由宿主提供），故照抄。
export const PERMISSION_PRESETS = ['read-only', 'workspace-write', 'danger-full-access']
export const DEFAULT_PERMISSION_PRESET = 'workspace-write'

/**
 * 按档位决定一条 ACP 权限请求：返回 { optionId }（直接答）或 'ask'（发审批卡）。
 * danger-full-access = DSH approval never：不弹窗直接放行；workspace-write = approval ask：问用户；
 * read-only：只读档下 CLI 的工具调用（ACP 只在要动手时才来问）一律拒。
 */
export function presetDecision(preset, options) {
  const p = PERMISSION_PRESETS.includes(preset) ? preset : DEFAULT_PERMISSION_PRESET
  if (p === 'workspace-write') return 'ask'
  const want = p === 'danger-full-access' ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always']
  const o = want.map((k) => options.find((x) => x.kind === k)).find(Boolean)
  return o ? { optionId: o.optionId } : null
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

// 去掉外层 Claude Code 会话的标记（CLAUDECODE、CLAUDE_CODE_ENTRYPOINT…），成员的 claude 才不会当成嵌套会话；
// 登录用的 CLAUDE_CODE_OAUTH_TOKEN 留着（ANTHROPIC_API_KEY 本来就不在过滤范围），只靠环境变量登录的用户才登得上。
const KEEP_ENV = new Set(['CLAUDE_CODE_OAUTH_TOKEN'])
export function cleanEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => KEEP_ENV.has(k) || (!k.startsWith('CLAUDECODE') && !k.startsWith('CLAUDE_CODE_'))))
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
    this.buffers = new Map() // sessionId -> string
    this.onText = new Map() // sessionId -> (textSoFar) => void（#121 流式）
    this.onTool = new Map() // sessionId -> (update) => void：tool_call / tool_call_update / agent_thought_chunk，给进度卡
    this.onPermission = new Map() // sessionId -> async (request) => ACP outcome：本轮的审批处理器
    this.queue = new Map() // room -> Promise（同房间串行）
    this.ready = null
  }

  /** ACP Client 回调（单独拆出来便于测试）。 */
  _client() {
    return {
      requestPermission: async (r) => {
        // 没有处理器（不在某一轮里）就没有地方问：按 DSH 无应答者的处理当取消（dsh-acp lib/index.js:1202-1228）。
        const h = this.onPermission.get(r.sessionId)
        return { outcome: h ? await h(r) : { outcome: 'cancelled' } }
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
    const client = this._client()
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
   * opts.resumeId：要续上的 sessionId；opts.onSession({ sessionId, resumed, lost })：会话就绪后、发提示词前调用。
   * opts.attachments：随提示词发给 CLI 的 ACP 内容块（图片/音频/资源）。
   * opts.onPermission(request)：本轮的 ACP session/request_permission 处理器，返回 ACP outcome。
   */
  ask(text, room = 'default', onText, onTool, opts = {}) {
    const prev = this.queue.get(room) || Promise.resolve()
    const run = prev.catch(() => {}).then(() => this._ask(text, room, onText, onTool, opts))
    this.queue.set(room, run)
    return run
  }

  async _ask(text, room, onText, onTool, { resumeId, onSession, attachments = [], onPermission } = {}) {
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
        this.conn.prompt({ sessionId: s.sessionId, prompt: [{ type: 'text', text: body }, ...attachments] }),
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
