// CLI 成员：把本机 claude / codex / gemini 通过 ACP 适配器接成群成员。
// 每个（成员, 房间）一个 ACP session；ask(text) 返回该轮 agent_message_chunk 拼接文本。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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

/** PATH 目录（Windows 的键名可能是 Path）；去掉引号。 */
function pathDirs(env) {
  return String(env.PATH || env.Path || '').split(path.delimiter).map(d => d.replace(/^"|"$/g, '')).filter(Boolean)
}

/** 按 PATH + PATHEXT 找可执行文件，返回绝对路径。 */
function findOnPath(name, env) {
  if (path.isAbsolute(name)) return existsSync(name) ? name : undefined
  const exts = String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  for (const dir of pathDirs(env)) {
    for (const ext of exts) {
      const candidate = path.join(dir, `${name}${ext}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Windows：`gemini` / `npx` 是 npm 写的 .cmd 外壳，外壳里再起 `node <脚本>`。经外壳启动时
 * spawn 出来的是 cmd.exe，close() 只杀外壳，真正的 CLI 和它起的进程全成孤儿（PR #1254 Windows 实测）。
 * 这里把外壳解析成它要跑的 node 脚本，直接 spawn：拿到的 pid 就是 CLI 自己。
 * 解析不出来（不是 node 脚本、脚本不存在）返回 null，调用方照旧经外壳启动，关闭时按进程树杀。
 */
export function resolveShim(cmd, env = process.env) {
  const file = findOnPath(cmd, env)
  if (!file) return null
  const lower = file.toLowerCase()
  if (lower.endsWith('.exe') || lower.endsWith('.com')) return { cmd: file, args: [], shell: false }
  if (!lower.endsWith('.cmd') && !lower.endsWith('.bat')) return null
  let body
  try { body = readFileSync(file, 'utf8') } catch { return null }
  // npm / pnpm 的 shim 结尾：「%_prog%」  「%dp0%\<脚本>」 %*（pnpm 用 %~dp0%）。
  const m = body.match(/"%(?:~)?dp0%\\?([^"%]+?)"\s*%\*/i)
  if (!m || !/\bnode(?:\.exe)?\b/i.test(body)) return null
  const script = path.resolve(path.dirname(file), m[1])
  if (!existsSync(script) || !/\.(?:m?js|cjs)$/i.test(script)) return null
  return { cmd: process.execPath, args: [script], shell: false }
}

/**
 * 关掉一个 CLI 进程。Windows 上按进程树杀：可能还隔着 cmd.exe 外壳或 npx，只杀 pid 会把真 CLI
 * 和它起的孙进程留下（PR #1254 Windows 实测）。非 Windows 保持原来的 proc.kill()。
 */
export function stopProcess(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return
  if (process.platform === 'win32' && proc.pid !== undefined) {
    try { spawnSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore' }) } catch {}
  }
  proc.kill()
}

// 去掉外层 Claude Code 会话的标记（CLAUDECODE、CLAUDE_CODE_ENTRYPOINT…），成员的 claude 才不会当成嵌套会话；
// 登录用的 CLAUDE_CODE_OAUTH_TOKEN 留着（ANTHROPIC_API_KEY 本来就不在过滤范围），只靠环境变量登录的用户才登得上。
const KEEP_ENV = new Set(['CLAUDE_CODE_OAUTH_TOKEN'])
export function cleanEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => KEEP_ENV.has(k) || (!k.startsWith('CLAUDECODE') && !k.startsWith('CLAUDE_CODE_'))))
}

function flattenOptions(options = []) { return options.flatMap(x => Array.isArray(x.options) ? flattenOptions(x.options) : [x]) }

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
    this.toolSince = new Set() // sessionId：上一段话之后有过工具调用
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
        if (u?.sessionUpdate === 'config_option_update' && Array.isArray(u.configOptions)) {
          const session = [...this.sessions.values()].find(x => x.sessionId === n.sessionId)
          if (session) session.configOptions = u.configOptions
        }
        if (u?.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text' && this.buffers.has(n.sessionId)) {
          // 工具调用隔开的两段话是两条消息：另起一段，[report]/[ask] 这类首行标记才落在行首（team-exit.mjs exitMark）。
          const prev = this.buffers.get(n.sessionId)
          const gap = this.toolSince.has(n.sessionId) && prev.trim() && !/\n\s*$/.test(prev) ? '\n\n' : ''
          this.toolSince.delete(n.sessionId)
          const full = prev + gap + u.content.text
          this.buffers.set(n.sessionId, full)
          this.onText.get(n.sessionId)?.(full)
        }
        if (u?.sessionUpdate === 'tool_call' && this.buffers.has(n.sessionId)) this.toolSince.add(n.sessionId)
        if ((u?.sessionUpdate === 'tool_call' || u?.sessionUpdate === 'tool_call_update' || u?.sessionUpdate === 'agent_thought_chunk') && this.buffers.has(n.sessionId)) this.onTool.get(n.sessionId)?.(u)
      },
    }
  }

  _start() {
    if (this.ready) return this.ready
    const a = ADAPTERS[this.cli]
    const { cmd, args } = a.pkg ? resolveBin(a.pkg) : { cmd: a.cmd, args: [] }
    // 已直接指到 node + 脚本（claude/codex 的包）就不必再解析；其余在 Windows 上先试着把 .cmd 外壳
    // 拆成 node + 脚本，拆不动才退回经外壳启动。
    const direct = cmd === process.execPath
    const shim = !direct && process.platform === 'win32' ? resolveShim(cmd, { ...cleanEnv(), ...this.extraEnv }) : null
    // shim 只替换命令入口；保留原命令参数（npx 的 -y + 包名），再由 spawn 追加适配器参数。
    const launch = shim ? { ...shim, args: [...shim.args, ...args] } : { cmd, args, shell: !direct && process.platform === 'win32' }
    const proc = spawn(launch.cmd, [...launch.args, ...a.args], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...cleanEnv(), ...this.extraEnv },
      // Windows 上拆不掉外壳时才用 shell：`gemini` / `npx` 是 .cmd，不经外壳 spawn 会 ENOENT
      //（.cmd 路径还会 EINVAL）。参数都是固定名字和开关，没有空格。
      shell: launch.shell,
    })
    this.proc = proc
    const client = this._client()
    const stream = acp.ndJsonStream(Writable.toWeb(proc.stdin), Readable.toWeb(proc.stdout))
    this.conn = new acp.ClientSideConnection(() => client, stream)
    const exited = new Promise((_, rej) => {
      proc.once('error', cause => {
        this.ready = null
        this.exited = null
        if (existsSync(this.cwd)) return rej(cause)
        const error = new Error(`CLI ${this.cli} 在目录 ${this.cwd} 无法启动：${cause.message}`, { cause })
        error.code = 'COLLAB_CLI_START'
        error.cwd = this.cwd
        error.cli = this.cli
        rej(error)
      })
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
    // Windows 上退回经外壳启动时，外壳即使找不到 CLI 或目录也会跑起来：ACP 流在进程报 exit/error 之前
    // 就断了，成员只会显示 "ACP connection closed"，而不是安装提示（或 COLLAB_CLI_START）。握手失败时
    // 按进程结束方式报错。
    const init = this.conn.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} })
      .catch(error => {
        stopProcess(proc)
        return exited.then(() => { throw error })
      })
    this.ready = Promise.race([
      init,
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
        const loaded = await Promise.race([this.conn.loadSession({ sessionId: prevId, cwd: this.cwd, mcpServers: [] }), this.exited])
        s = { sessionId: prevId, configOptions: loaded?.configOptions, defaultModel: loaded?.models?.currentModelId }
        this.sessions.set(room, s)
        return { ...s, resumed: true, lost: false }
      } catch (err) {
        if (!this.ready) throw err // 进程在 load 时退出：照常报错
      }
    }
    const r = await Promise.race([this.conn.newSession({ cwd: this.cwd, mcpServers: [] }), this.exited])
    s = { sessionId: r.sessionId, configOptions: r.configOptions, defaultModel: r.models?.currentModelId }
    this.sessions.set(room, s)
    return { ...s, resumed: false, lost: Boolean(prevId) }
  }

  // A fresh probe supplies current adapter defaults, including the selected model's effort default.
  // It never prompts and does not touch the existing conversation.
  async _options(model) {
    await this._start()
    const fresh = await Promise.race([this.conn.newSession({ cwd: this.cwd, mcpServers: [] }), this.exited])
    let options = fresh.configOptions || []
    const selector = (id) => options.find(o => o.id === id && o.type === 'select')
    if (model !== undefined) {
      const option = selector('model')
      if (!option) return []
      if (!flattenOptions(option.options).some(o => o.value === model)) { const error = new Error('Codex model is unavailable'); error.code = 'COLLAB_CONFIG_INVALID'; throw error }
      options = (await Promise.race([this.conn.setSessionConfigOption({ sessionId: fresh.sessionId, configId: 'model', value: model }), this.exited])).configOptions || []
      if (selector('model')?.currentValue !== model) throw new Error('Codex did not apply the model')
    }
    return options
  }

  async probeOptions(model) {
    const options = await this._options(model)
    const select = id => {
      const o = options.find(x => x.id === id && x.type === 'select')
      return o ? { current: o.currentValue ?? null, options: flattenOptions(o.options).map(x => ({ value: x.value, name: x.name })) } : null
    }
    const modelOption = select('model')
    return modelOption ? { supported: true, model: modelOption, reasoningEffort: select('reasoning_effort') } : { supported: false, model: null, reasoningEffort: null }
  }

  // Keep probe sessions in a short-lived process, not in the conversation adapter.
  async _defaultOptions(model) {
    const probe = new CliMember({ cli: this.cli, cwd: this.cwd, env: this.extraEnv })
    try { return await probe._options(model) } finally { probe.close() }
  }

  async _configure(s, desired) {
    const get = (opts, id) => opts?.find(o => o.id === id && o.type === 'select')
    const signature = JSON.stringify([desired?.model ?? null, desired?.reasoningEffort ?? null])
    const snapshot = s.appliedConfig
    if (snapshot?.signature === signature && snapshot.values.every(([id, value]) => get(s.configOptions, id)?.currentValue === value)) return
    const stored = [...this.sessions.values()].find(x => x.sessionId === s.sessionId)
    if (stored) stored.appliedConfig = undefined
    const defaults = await this._defaultOptions(desired?.model)
    const model = desired?.model ?? get(defaults, 'model')?.currentValue
    const effort = desired?.reasoningEffort ?? get(defaults, 'reasoning_effort')?.currentValue
    if (!model) throw new Error('Codex model selection is unsupported')
    let options = s.configOptions || []
    for (const [id, value] of [['model', model], ['reasoning_effort', effort]]) {
      if (value === undefined || value === null) continue
      const option = get(options, id)
      if (!option || !flattenOptions(option.options).some(o => o.value === value)) throw new Error(`Codex ${id} selection is unavailable`)
      if (option.currentValue !== value) {
        options = (await Promise.race([this.conn.setSessionConfigOption({ sessionId: s.sessionId, configId: id, value }), this.exited])).configOptions || []
        if (stored) stored.configOptions = options
      }
      if (get(options, id)?.currentValue !== value) throw new Error(`Codex ${id} did not apply`)
    }
    s.configOptions = options
    if (stored) {
      stored.configOptions = options
      stored.appliedConfig = { signature, values: [['model', model], ['reasoning_effort', effort]].filter(([, value]) => value != null) }
    }
  }

  async _configureClaude(s, model) {
    // Claude's ACP adapter exposes session/set_model, not Codex's config options.
    // Remember its initial selection so clearing an override also affects a live session.
    if (model == null && s.appliedModel === undefined) return
    const target = model ?? s.defaultModel
    if (!target) throw new Error('Claude default model is unavailable')
    if (s.appliedModel === target) return
    await Promise.race([this.conn.request('session/set_model', { sessionId: s.sessionId, modelId: target }), this.exited])
    const stored = [...this.sessions.values()].find(x => x.sessionId === s.sessionId)
    if (stored) stored.appliedModel = target
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

  async _ask(text, room, onText, onTool, { resumeId, onSession, attachments = [], onPermission, model, cliConfig, cliConfigManaged } = {}) {
    const s = await this._session(room, resumeId)
    if (this.cli === 'codex' && cliConfigManaged) await this._configure(s, cliConfig)
    if (this.cli === 'claude') await this._configureClaude(s, model)
    await onSession?.({ sessionId: s.sessionId, resumed: s.resumed, lost: s.lost })
    // persona 每轮都拼：续上的或新开的会话都不会丢人设。
    const body = this.persona ? `${this.persona}\n\n${text}` : text
    this.buffers.set(s.sessionId, '')
    this.toolSince.delete(s.sessionId)
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
      this.toolSince.delete(s.sessionId)
      this.onText.delete(s.sessionId)
      this.onTool.delete(s.sessionId)
      this.onPermission.delete(s.sessionId)
    }
  }

  close() {
    stopProcess(this.proc)
    this.sessions.clear()
    this.saved.clear()
    this.ready = null
  }
}

export function createCliMember(opts) { return new CliMember(opts) }
