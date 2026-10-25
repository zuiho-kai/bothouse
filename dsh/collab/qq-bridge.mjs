// QQ ↔ DSH 频道（conest-collab）双向桥接。
//
// 工作方式：
//   1. 以 cc-connect 兼容的「cloud_web bot」身份连上本机 DSH 的 /cloud-web/ws，
//      用它的 `reply` 帧把 QQ 里的消息发进频道（以成员「QQ」的身份）。
//   2. 直接读频道 SQLite 里已提交的消息，等频道里的 AI 回复后，把回复作为
//      QQ 被动回复发回去（被动回复不受主动消息额度限制）。
//   3. 可选 mirror：频道里别人/AI 的新消息主动推到 QQ（受 QQ 主动消息额度限制，
//      失败会让路，不打断对话）。

import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';
import { QQBot } from '@tencent-connect/qqbot-nodejs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.QQ_BRIDGE_CONFIG || join(HERE, 'config.json');
const LOG_PATH = process.env.QQ_BRIDGE_DATA ? join(process.env.QQ_BRIDGE_DATA, 'bridge.log') : join(HERE, 'logs', 'bridge.log');
const DB_PATH = process.env.CONEST_COLLAB_DATA
  ? join(process.env.CONEST_COLLAB_DATA, 'collab.sqlite3')
  : join(homedir(), '.conest-collab', 'collab.sqlite3');
const execFileP = promisify(execFile);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const room = cfg.roomId;
const roomKey = `room-${room}`;

mkdirSync(dirname(LOG_PATH), { recursive: true });

function log(...args) {
  const line = `${new Date().toISOString()} ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  console.log(line);
  try {
    if (statSync(LOG_PATH).size > 2 * 1024 * 1024) renameSync(LOG_PATH, `${LOG_PATH}.1`);
  } catch { /* 日志还不存在，正常 */ }
  appendFileSync(LOG_PATH, line + '\n');
}

function saveConfig() {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

// ── 频道数据库（只读）────────────────────────────────────────────────────────
function openDb() {
  return new DatabaseSync(DB_PATH, { readOnly: true });
}

function maxMessageId(db) {
  const row = db.prepare('select coalesce(max(id), 0) as id from messages').get();
  return row.id;
}

function memberNames(db) {
  const names = db.prepare('select name from members where removed = 0').all().map(r => r.name);
  if (cfg.defaultMember && !names.includes(cfg.defaultMember)) names.push(cfg.defaultMember);
  return names;
}

// ── 找到本机 DSH 的端口 ──────────────────────────────────────────────────────
let cachedPort = cfg.port || 0;

async function probe(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/collab/api/state`, { signal: AbortSignal.timeout(1500) });
    return res.status === 401 || res.status === 200;
  } catch {
    return false;
  }
}

async function discoverPort() {
  if (cachedPort && (await probe(cachedPort))) return cachedPort;
  const found = new Set();
  try {
    const { stdout } = await execFileP('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']);
    for (const line of stdout.split('\n')) {
      if (!/DeepSeek|dsh|Electron/i.test(line)) continue;
      const m = line.match(/127\.0\.0\.1:(\d+)\s+\(LISTEN\)/);
      if (m) found.add(Number(m[1]));
    }
  } catch (error) {
    log('lsof 失败', error.message);
  }
  for (const port of found) {
    if (await probe(port)) {
      cachedPort = port;
      log('找到 DSH 端口', port);
      return port;
    }
  }
  throw new Error('没有找到本机 DSH 的端口');
}

// ── 频道 WS（以 bot 身份收发）───────────────────────────────────────────────
let ws;
let online = false;
let reconnectDelay = 1000;

function connectCollab() {
  discoverPort()
    .then(port => {
      const url = `ws://127.0.0.1:${port}/cloud-web/ws?bot=${encodeURIComponent(cfg.botId)}`
        + `&name=${encodeURIComponent(cfg.botName)}&token=${encodeURIComponent(cfg.collabToken)}`;
      ws = new WebSocket(url);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'register' })));
      ws.on('message', data => {
        let frame;
        try { frame = JSON.parse(String(data)); } catch { return; }
        if (frame?.type !== 'register_ack') return;
        if (frame.ok) {
          online = true;
          reconnectDelay = 1000;
          log('已加入频道', roomKey);
        } else {
          log('加入频道被拒绝', frame.error);
        }
      });
      ws.on('close', () => {
        if (online) log('与频道的连接断开');
        online = false;
        setTimeout(connectCollab, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      });
      ws.on('error', error => log('频道连接错误', error.message));
    })
    .catch(error => {
      log('连接频道失败', error.message);
      setTimeout(connectCollab, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    });
}

function postToChannel(text) {
  if (!online || ws?.readyState !== WebSocket.OPEN) throw new Error('频道还没连上');
  ws.send(JSON.stringify({ type: 'reply', content: text, reply_ctx: roomKey }));
}

// ── QQ 侧 ───────────────────────────────────────────────────────────────────
const queue = [];
let pumping = false;
// pump 正在等这一轮的回复：mirror 此时不推送，避免同一条回复被发两遍。
let awaitingReply = false;
const answered = new Set();
let mirrorCursor = 0;
let mirrorFailures = 0;
let mirrorLastSent = 0;
let lastSender = cfg.allowSenders[0] || '';

function splitText(text, limit = 1800) {
  const out = [];
  let rest = String(text ?? '');
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest.trim()) out.push(rest);
  return out;
}

async function sendToQQ(target, text) {
  for (const chunk of splitText(text)) {
    await qq.sendText(target, chunk);
  }
}

function toChannelText(names, raw) {
  const text = String(raw ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if (!text) return '';
  // 已经 @ 了某个成员：统一成正式名字。
  const at = /^[@＠]([^\s，,：:]{1,24})/.exec(text);
  if (at) {
    const hit = names.find(n => n.toLowerCase() === at[1].toLowerCase());
    if (hit) return `@${hit}${text.slice(at[0].length)}`;
  }
  // 开头直接写成员名字：也算点名，补上 @。
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (!text.toLowerCase().startsWith(name.toLowerCase())) continue;
    const rest = text.slice(name.length).replace(/^[，,：:、\s]+/, '');
    return `@${name} ${rest}`.trim();
  }
  return `@${cfg.defaultMember} ${text}`;
}

async function waitForReply(db, afterId, startedAt, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const query = db.prepare(`select id, author, author_kind, name, text, created_at from messages
    where room_id = ? and id > ? and draft = 0 and deleted = 0 order by id`);
  // 频道里的最终回复（role），以及系统提示（例如权限、超时、接力上限），都带回 QQ，
  // 不然用户只看到消息发出去、没有任何下文。
  const pick = () => query.all(room, afterId)
    .filter(r => r.author !== cfg.botId && (r.author_kind === 'role' || r.author_kind === 'system') && r.created_at >= startedAt - 1);
  while (Date.now() < deadline) {
    const rows = pick();
    if (rows.length > 0) {
      // 先登记再等：这条已经归 pump 发了，mirror 不该再推一遍。
      for (const r of rows) answered.add(r.id);
      await sleep(1200); // 收一下同一轮里的后续消息
      const more = pick();
      for (const r of more) answered.add(r.id);
      return more.length ? more : rows;
    }
    await sleep(700);
  }
  return [];
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        const db = openDb();
        const before = maxMessageId(db);
        const startedAt = Date.now() / 1000;
        postToChannel(item.channelText);
        log('发进频道', item.channelText.slice(0, 80));
        // 等待期间 mirrorLoop 必须让路：这一轮的回复由 pump 负责发，否则同一条会推两遍。
        awaitingReply = true;
        let replies;
        try {
          replies = await waitForReply(db, before, startedAt, cfg.replyTimeoutMs);
        } finally {
          awaitingReply = false;
        }
        db.close();
        if (replies.length === 0) {
          await sendToQQ(item.target, '（频道里还没有回复。可以过一会儿到电脑上看，或者再发一句试试）');
          continue;
        }
        const text = replies.map(r => r.author_kind === 'system' ? `【系统】${r.text}` : `【${r.name}】${r.text}`).join('\n\n');
        await sendToQQ(item.target, text);
        log('已回复 QQ', replies.map(r => r.id).join(','));
      } catch (error) {
        log('处理失败', error.message);
        try { await sendToQQ(item.target, `（转发到频道失败：${error.message}）`); } catch { /* 忽略 */ }
      }
    }
  } finally {
    pumping = false;
  }
}

const MEDIA_DIR = process.env.QQ_BRIDGE_DATA ? join(process.env.QQ_BRIDGE_DATA, 'media') : join(HERE, 'media');
mkdirSync(MEDIA_DIR, { recursive: true });

/** QQ 图片落盘，返回本机路径；频道里的 AI 可以直接按路径读取。 */
async function saveImage(att, sender) {
  try {
    const res = await fetch(att.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 20 * 1024 * 1024) throw new Error('图片超过 20MB');
    const type = String(att.content_type ?? 'image/jpeg');
    const ext = (type.split('/')[1] ?? 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg';
    const path = join(MEDIA_DIR, `${Date.now()}-${String(sender).slice(0, 8)}.${ext}`);
    writeFileSync(path, buf);
    log('已保存图片', path);
    return path;
  } catch (error) {
    log('图片下载失败', error.message);
    return '';
  }
}

/** 把 QQ 消息扩成频道里的一句话：文字 + 图片路径 + 语音转写。 */
async function composeText(msg, sender) {
  const parts = [String(msg.content ?? '').trim()];
  for (const att of msg.attachments ?? []) {
    const type = String(att?.content_type ?? '');
    if (type.startsWith('image/')) {
      const path = await saveImage(att, sender);
      parts.push(path ? `[图片已保存到本机] ${path}` : `[图片] ${att.url}`);
    } else if (att?.asr_refer_text) {
      parts.push(`[语音转文字] ${att.asr_refer_text}`);
    } else if (att?.voice_wav_url) {
      parts.push(`[语音] ${att.voice_wav_url}`);
    } else if (att?.url) {
      parts.push(`[文件] ${att.url}`);
    }
  }
  return parts.filter(Boolean).join('\n');
}

async function onQQMessage(ctx, msg) {
  if (msg.kind !== 'c2c') {
    log('忽略非私聊消息', msg.kind);
    return;
  }
  if (msg.senderIsBot) return;
  const sender = msg.senderId;
  if (cfg.allowSenders.length === 0) {
    cfg.allowSenders = [sender];
    saveConfig();
    log('已把第一个使用者加入白名单', sender);
  }
  if (!cfg.allowSenders.includes(sender)) {
    log('拒绝未授权用户', sender);
    return;
  }
  lastSender = sender;
  const db = openDb();
  const names = memberNames(db);
  db.close();
  const raw = await composeText(msg, sender);
  const channelText = toChannelText(names, raw);
  if (!channelText) return;
  queue.push({ target: msg.replyTarget, channelText });
  log('收到 QQ 消息', String(msg.content ?? '').slice(0, 80), `附件 ${msg.attachments?.length ?? 0}`);
  pump();
}

// 频道里别人的消息推到 QQ（主动消息；失败就放弃，不打扰对话）
async function mirrorLoop() {
  while (true) {
    await sleep(2000);
    if (!cfg.mirror || !lastSender || mirrorFailures >= 3) continue;
    // pump 正在等这一轮的回复：让它独占，避免同一条回复发两遍。
    if (awaitingReply) continue;
    if (Date.now() - mirrorLastSent < 4000) continue;
    let db;
    try {
      db = openDb();
      const rows = db.prepare(`select id, author, author_kind, name, text from messages
        where room_id = ? and id > ? and draft = 0 and deleted = 0 order by id`).all(room, mirrorCursor);
      for (const r of rows) {
        mirrorCursor = Math.max(mirrorCursor, r.id);
        if (r.author === cfg.botId || r.author_kind !== 'role' || answered.has(r.id)) continue;
        try {
          await sendToQQ({ scope: 'c2c', targetId: lastSender }, r.author_kind === 'system' ? `【系统】${r.text}` : `【${r.name}】${r.text}`);
          mirrorLastSent = Date.now();
          mirrorFailures = 0;
          log('同步到 QQ', r.id);
        } catch (error) {
          mirrorFailures += 1;
          log('同步到 QQ 失败，暂时只保留回复方向', error.message);
        }
      }
    } catch (error) {
      log('读取频道失败', error.message);
    } finally {
      db?.close();
    }
  }
}

// ── 启动 ────────────────────────────────────────────────────────────────────
const qq = new QQBot({ appId: cfg.appId, appSecret: cfg.appSecret, logger: console });
qq.on('message', (ctx, msg) => { onQQMessage(ctx, msg).catch(e => log('处理 QQ 消息出错', e.message)); });
qq.on('error', error => log('QQ 连接错误', error.message));
qq.on('ready', () => log('QQ 机器人已上线'));

const db0 = openDb();
mirrorCursor = maxMessageId(db0);
db0.close();

connectCollab();
mirrorLoop();
await qq.start();
log('桥接已启动');
