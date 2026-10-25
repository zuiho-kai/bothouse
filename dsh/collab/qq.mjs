/**
 * QQ bot bridge: config + process management for the local QQ ↔ channel relay.
 *
 * The bridge itself is `qq-bridge.mjs` (an official QQ Bot SDK client that joins a
 * channel as a cc-connect style bot and relays messages both ways). This module
 * owns the config file, validates it, and starts/stops the child process, so the
 * channels page can offer the whole flow as a form instead of hand-edited JSON.
 */
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The bridge entry point shipped with this package. */
const SCRIPT = join(HERE, 'qq-bridge.mjs');
/** Log lines kept in memory for the panel (the file on disk keeps everything). */
const LOG_TAIL = 40;

/** Config defaults; the store row keeps whatever the user saved. */
const DEFAULTS = { appId: '', appSecret: '', roomId: 1, botName: 'QQ', defaultMember: '', mirror: true, allowSenders: [] };

/** QQ's app-token endpoint (the same one the bridge uses). */
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';

/** Masked secret for the panel: never echo the full value back. */
function maskSecret(secret) {
  if (typeof secret !== 'string' || secret === '') return '';
  return secret.length <= 4 ? '••••' : `••••${secret.slice(-4)}`;
}

/** Config file path for a data directory. */
export function qqConfigPath(dataDir) {
  return join(dataDir, 'qq-bridge', 'config.json');
}

/**
 * Owns the QQ bridge config and child process.
 */
export class QqBridge {
  /**
   * @param store - collab store (rooms for validation).
   * @param options - { dataDir, logger }.
   */
  constructor(store, { dataDir, logger }) {
    this.store = store;
    this.dataDir = dataDir;
    this.dir = join(dataDir, 'qq-bridge');
    this.logger = logger;
    this.child = null;
    this.lines = [];
    this.startedAt = undefined;
    this.lastError = undefined;
    this.exitCode = undefined;
  }

  /** The saved config, or defaults when the file is missing or unreadable. */
  read() {
    try {
      const parsed = JSON.parse(readFileSync(qqConfigPath(this.dataDir), 'utf8'));
      return { ...DEFAULTS, ...parsed, allowSenders: Array.isArray(parsed?.allowSenders) ? parsed.allowSenders : [] };
    } catch {
      return { ...DEFAULTS };
    }
  }

  /** What the panel sees: config without the secret, plus process state. */
  view() {
    const cfg = this.read();
    return {
      configured: cfg.appId !== '' && cfg.appSecret !== '',
      appId: cfg.appId,
      appSecretMasked: maskSecret(cfg.appSecret),
      roomId: cfg.roomId,
      botName: cfg.botName,
      defaultMember: cfg.defaultMember,
      mirror: cfg.mirror,
      allowSenders: cfg.allowSenders,
      running: this.running(),
      pid: this.child?.pid ?? null,
      startedAt: this.startedAt ?? null,
      exitCode: this.exitCode ?? null,
      lastError: this.lastError ?? null,
      log: this.lines.slice(-LOG_TAIL),
    };
  }

  running() {
    return this.child !== null && this.child.exitCode === null && this.child.killed === false;
  }

  /** Validate and persist; an empty appSecret keeps the stored one (the mask round-trips). */
  save(input) {
    const cfg = this.read();
    const appId = String(input?.appId ?? cfg.appId).trim();
    if (appId === '') throw new Error('AppID 不能为空');
    const secretInput = input?.appSecret;
    const appSecret = typeof secretInput === 'string' && secretInput !== '' && !secretInput.startsWith('••••')
      ? secretInput.trim()
      : cfg.appSecret;
    if (appSecret === '') throw new Error('AppSecret 不能为空');
    const roomId = Number(input?.roomId ?? cfg.roomId);
    if (!Number.isSafeInteger(roomId) || this.store.room(roomId) === undefined) throw new Error(`频道 ${roomId} 不存在`);
    const next = {
      ...cfg,
      appId,
      appSecret,
      roomId,
      botName: String(input?.botName ?? cfg.botName ?? 'QQ').trim() || 'QQ',
      defaultMember: String(input?.defaultMember ?? cfg.defaultMember ?? '').trim(),
      mirror: input?.mirror === undefined ? cfg.mirror : Boolean(input.mirror),
      allowSenders: Array.isArray(input?.allowSenders)
        ? [...new Set(input.allowSenders.map(v => String(v).trim()).filter(Boolean))]
        : cfg.allowSenders,
    };
    mkdirSync(this.dir, { recursive: true });
    const path = qqConfigPath(this.dataDir);
    if (path === '') throw new Error('dataDir 未配置');
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    try { chmodSync(path, 0o600); } catch { /* best effort on odd filesystems */ }
    this.logger?.info?.('conest-collab: saved QQ bridge config for room %d', next.roomId);
    return this.view();
  }

  /** Ask QQ whether these credentials mint an access token. */
  async test(input) {
    const cfg = this.read();
    const appId = String(input?.appId ?? cfg.appId).trim();
    const secretInput = input?.appSecret;
    const appSecret = typeof secretInput === 'string' && secretInput !== '' && !secretInput.startsWith('••••')
      ? secretInput.trim()
      : cfg.appSecret;
    if (appId === '' || appSecret === '') throw new Error('先填 AppID 和 AppSecret');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId, clientSecret: appSecret }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || typeof body?.access_token !== 'string') {
      throw new Error(`QQ 拒绝了这组凭据（HTTP ${res.status}${body?.message ? `：${body.message}` : ''}）`);
    }
    return { ok: true, expiresIn: body.expires_in ?? null };
  }

  /** Start the bridge; a second start restarts it so saved changes take effect. */
  start() {
    this.stop();
    const path = qqConfigPath(this.dataDir);
    if (!existsSync(path)) throw new Error('还没有保存 QQ 配置');
    if (!existsSync(SCRIPT)) throw new Error('找不到 qq-bridge.mjs');
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: this.dir,
      env: {
        ...process.env,
        QQ_BRIDGE_CONFIG: path,
        QQ_BRIDGE_DATA: this.dir,
        CONEST_COLLAB_DATA: this.dataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const push = line => {
      const text = String(line).trim();
      if (text === '') return;
      this.lines.push(text);
      if (this.lines.length > 200) this.lines.splice(0, this.lines.length - 200);
    };
    child.stdout?.on('data', chunk => String(chunk).split('\n').forEach(push));
    child.stderr?.on('data', chunk => {
      String(chunk).split('\n').forEach(push);
      this.lastError = String(chunk).trim().split('\n').at(-1) ?? this.lastError;
    });
    child.on('exit', (code, signal) => {
      this.exitCode = code;
      this.startedAt = undefined;
      if (this.child === child) this.child = null;
      this.lastError = signal ? `桥接被信号 ${signal} 结束` : `桥接退出（code ${code}）`;
      this.logger?.warn?.('conest-collab: QQ bridge exited code=%s signal=%s', code, signal);
    });
    child.on('error', error => { this.lastError = error.message; });
    this.child = child;
    this.exitCode = undefined;
    this.lastError = undefined;
    this.startedAt = Date.now();
    this.logger?.info?.('conest-collab: QQ bridge started pid=%s', child.pid);
    return this.view();
  }

  /** Stop the child (idempotent). */
  stop() {
    const child = this.child;
    this.child = null;
    this.startedAt = undefined;
    if (child !== null && child.exitCode === null) {
      child.kill('SIGTERM');
      // Give it a moment, then insist: the bridge holds both a WebSocket and a QQ session.
      setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 3000).unref?.();
    }
    return this.view();
  }
}
