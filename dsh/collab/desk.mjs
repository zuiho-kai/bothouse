// #876 团队工作台：任务板事件流 → hub 事件、回放接口、桌面页挂载。
//
// 事件契约见 Issue #876：`board-events.jsonl` 与 board.jsonl 同目录（BOARD_DIR），
// 一行一个 JSON，只追加；这里只读不改，写入归 gate 的 board.py。
import { closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CollabError, publicMessage } from './store.mjs';
// #876 P: 回放消息的 @ 由这里解析，规则与 hub 路由同一套（mentions.mjs），页面不再自己猜文本。
import { mentions as mentionsOf } from './mentions.mjs';

export const BOARD_EVENTS_FILE = 'board-events.jsonl';
// 验收要求派活后「几秒内」光柱出现；每秒 stat 一次这个只追加的小文件足够便宜。
export const TAIL_INTERVAL_MS = 1000;
// 一次回放给一页历史，条数上限沿用消息分页的 200 条（store.mjs clampLimit）。
export const REPLAY_MAX = 200;

/** 读一行事件；空行跳过，坏行留一条 warn（写入方可能正写到一半）。 */
export function parseBoardEvent(line, logger) {
  const text = line.trim();
  if (text === '') return undefined;
  let entry;
  try { entry = JSON.parse(text); } catch { logger?.warn?.('conest-collab: bad board event line %s', text.slice(0, 200)); return undefined; }
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    logger?.warn?.('conest-collab: board event is not an object: %s', text.slice(0, 200));
    return undefined;
  }
  return entry;
}

/** 板目录里的全部事件（回放用）；文件不存在就是没有事件，不是错误。 */
export function readBoardEvents(boardDir) {
  if (!boardDir) return [];
  let raw;
  try { raw = readFileSync(join(boardDir, BOARD_EVENTS_FILE), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    const entry = parseBoardEvent(line);
    if (entry !== undefined) out.push(entry);
  }
  return out;
}

/**
 * 尾随 board-events.jsonl，把新增行作为 `{type:"task", …}` 推进 hub 事件流。
 * 启动时从文件末尾开始：启动前的事件属于回放素材，不该在启动瞬间补一屏光柱。
 */
export class DeskEvents {
  constructor(hub, { boardDir, logger, intervalMs = TAIL_INTERVAL_MS } = {}) {
    this.hub = hub;
    this.logger = logger;
    this.intervalMs = intervalMs;
    this.path = boardDir ? join(boardDir, BOARD_EVENTS_FILE) : undefined;
    this.offset = 0;
    this.timer = undefined;
  }

  start() {
    if (this.path === undefined || this.timer !== undefined) return;
    this.offset = this.size();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  size() {
    try { return statSync(this.path).size; } catch { return 0; }
  }

  /** 读 offset 之后新增的完整行；半行留到下次；文件被截断则从头再读。 */
  poll() {
    let size;
    try { size = statSync(this.path).size; } catch { return; }
    if (size < this.offset) this.offset = 0;
    if (size === this.offset) return;
    const length = size - this.offset;
    const buf = Buffer.allocUnsafe(length);
    let read = 0;
    const fd = openSync(this.path, 'r');
    try { read = readSync(fd, buf, 0, length, this.offset); } finally { closeSync(fd); }
    if (read <= 0) return;
    const chunk = buf.subarray(0, read);
    const end = chunk.lastIndexOf(0x0a);
    if (end < 0) return;
    this.offset += end + 1;
    for (const line of chunk.subarray(0, end).toString('utf8').split('\n')) {
      const entry = parseBoardEvent(line, this.logger);
      if (entry === undefined) continue;
      try { this.hub.emit({ ...entry, type: 'task' }); } catch (error) { this.logger?.warn?.('conest-collab: task event emit failed: %s', error?.message ?? error); }
    }
  }
}

/**
 * 把该时段的板事件与房间消息按时间合并。
 * 消息的 created_at 是秒（store.append 默认 Date.now()/1000），板事件是 ISO 时间。
 * members 是 hub 的成员（{id,name,mentionId?}）：消息里的 @ 用 mentions.mjs 解析成
 * 成员 id 放进 `message.mentions`，页面直接照着画，不再从文本猜（#876 P）。
 */
export function deskReplay({ store, boardDir, from, to, members = [] }) {
  const fromMs = Date.parse(String(from ?? ''));
  const toMs = Date.parse(String(to ?? ''));
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) throw new CollabError('invalid', 'from/to must be ISO timestamps');
  if (toMs < fromMs) throw new CollabError('invalid', 'to must not be earlier than from');

  const merged = [];
  for (const entry of readBoardEvents(boardDir)) {
    const ts = Date.parse(entry.ts ?? '');
    if (!Number.isFinite(ts) || ts < fromMs || ts > toMs) continue;
    merged.push({ ts, event: { ...entry, type: 'task' } });
  }
  const rows = store.db.prepare('SELECT * FROM messages WHERE deleted = 0 AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(fromMs / 1000, toMs / 1000, REPLAY_MAX);
  for (const row of rows.reverse()) {
    const message = publicMessage(row, store);
    const mentioned = members.length ? [...mentionsOf(String(message.text ?? ''), members)] : [];
    if (mentioned.length) message.mentions = mentioned;
    merged.push({ ts: row.created_at * 1000, event: { type: 'message', message } });
  }
  merged.sort((a, b) => a.ts - b.ts);
  const kept = merged.length > REPLAY_MAX ? merged.slice(-REPLAY_MAX) : merged;
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), events: kept.map(m => m.event) };
}

/**
 * 现在还在进行中的任务：按任务 id 取最后一条板事件，最后一条是 created/assigned 就算在做。
 * 页面刷新或第一次打开时用它把工位上的任务和「进行中」计数补回来，不必等下一个事件。
 */
export function deskActiveTasks({ boardDir }) {
  const last = new Map();
  for (const entry of readBoardEvents(boardDir)) {
    const id = String(entry.id ?? '').trim();
    if (id && entry.kind) last.set(id, entry);
  }
  return [...last.values()].filter(entry => entry.kind === 'created' || entry.kind === 'assigned');
}

/** 交回了、还没验收的任务（最后一条是 returned，且在 24 小时内）：桌面页在主角色桌上叠成一摞文件。 */
export function deskReturnedTasks({ boardDir, now = Date.now() } = {}) {
  const last = new Map();
  for (const entry of readBoardEvents(boardDir)) {
    const id = String(entry.id ?? '').trim();
    if (id && entry.kind) last.set(id, entry);
  }
  return [...last.values()].filter(entry => entry.kind === 'returned' && now - Date.parse(entry.ts) < 24 * 3600 * 1000);
}

/** 桌面页：C 路提供的 dsh/collab/desk/index.html；还没落地时给一个能看事件流的占位页。 */
export function deskPage() {
  try { return readFileSync(new URL('./desk/index.html', import.meta.url), 'utf8'); } catch { return PLACEHOLDER_PAGE; }
}

// 名牌自定义名：成员 id → 名字，存插件数据目录，刷新、换设备都还在；空名 = 恢复默认（roster.name）。
export const DESK_NAMES_FILE = 'desk-names.json';
export const DESK_NAME_MAX = 24;

export function readDeskNames(file) {
  if (!file) return {};
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

/** 改一个成员的名牌名；name 去空白后为空就删掉，回到默认名。返回改后的全表。 */
export function setDeskName(file, id, name) {
  const key = String(id ?? '').trim();
  if (!key) throw new CollabError('invalid', 'id is required');
  const value = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (Array.from(value).length > DESK_NAME_MAX) throw new CollabError('invalid', `name must be at most ${DESK_NAME_MAX} characters`);
  const names = readDeskNames(file);
  if (value) names[key] = value; else delete names[key];
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(names, null, 2) + '\n');
  renameSync(tmp, file);
  return names;
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function namesRoute(req, res, namesFile) {
  if (!namesFile) return sendJson(res, 404, { error: 'desk names are not configured' });
  if (req.method === 'GET') return sendJson(res, 200, { names: readDeskNames(namesFile) });
  let raw = '';
  try {
    for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return sendJson(res, 413, { error: 'body too large' }); }
    const body = JSON.parse(raw || '{}');
    return sendJson(res, 200, { names: setDeskName(namesFile, body?.id, body?.name) });
  } catch (error) {
    if (error instanceof CollabError) return sendJson(res, 400, { error: error.message, code: error.code });
    if (error instanceof SyntaxError) return sendJson(res, 400, { error: 'invalid JSON body' });
    return sendJson(res, 500, { error: 'save failed' });
  }
}

/** /collab/desk、/collab/api/desk/replay、/collab/api/desk/state、/collab/api/desk/names；返回 true（或 Promise）表示已处理，未匹配返回 undefined。 */
export function deskRoute(req, res, url, { store, boardDir, members = [], namesFile } = {}) {
  if (url.pathname.replace(/\/+$/, '') === '/collab/api/desk/names' && (req.method === 'GET' || req.method === 'PUT')) return namesRoute(req, res, namesFile);
  if (url.pathname.replace(/\/+$/, '') === '/collab/api/desk/state' && req.method === 'GET') {
    sendJson(res, 200, { tasks: deskActiveTasks({ boardDir }), returned: deskReturnedTasks({ boardDir }) });
    return true;
  }
  if (url.pathname.replace(/\/+$/, '') !== '/collab/desk' && url.pathname.replace(/\/+$/, '') !== '/collab/api/desk/replay') return undefined;
  if (req.method !== 'GET') return undefined;
  if (url.pathname.replace(/\/+$/, '') === '/collab/desk') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(deskPage());
    return true;
  }
  try {
    const body = deskReplay({ store, boardDir, members, from: url.searchParams.get('from'), to: url.searchParams.get('to') });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  } catch (error) {
    const status = error instanceof CollabError ? 400 : 500;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(error instanceof CollabError ? { error: error.message, code: error.code } : { error: 'replay failed' }));
  }
  return true;
}

const PLACEHOLDER_PAGE = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>团队工作台</title>
<style>body{font:14px/1.6 system-ui,sans-serif;margin:0;padding:24px;background:#0f1115;color:#e6e8eb}
h1{font-size:18px;margin:0 0 8px}p{color:#8b949e;margin:0 0 16px}
ol{padding-left:20px;font-family:ui-monospace,monospace;font-size:12px}</style></head>
<body>
<h1>团队工作台</h1>
<p>办公室地图页由前端路补充；这里是占位页，只接真实事件流，不造假光柱。</p>
<ol id="events"></ol>
<script>
const list = document.getElementById('events');
const add = text => { const li = document.createElement('li'); li.textContent = text; list.prepend(li); };
const source = new EventSource('/collab/api/events');
source.onmessage = message => {
  let event;
  try { event = JSON.parse(message.data); } catch { return; }
  if (event.type === 'task') add([event.ts, event.kind, event.from, '→', event.to, event.title].filter(Boolean).join(' '));
};
</script>
</body>
</html>
`;