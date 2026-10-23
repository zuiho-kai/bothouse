// cc-connect cloud_web gateway (server side of bridge/platform/cloud-web, WS
// transport). Ported from role-household/rh/cloudweb.py so a cc-connect
// project configured for the role-household hub connects here unchanged:
//   ws(s)://<host>/cloud-web/ws?bot=<member id>&name=<display>&mention_id=<digits>&avatar=<slug|http(s) URL>
// Rooms are addressed as "room-<id>", messages as "hub-<id>".
import { forDisplay, forMember, mentions, nameCalled } from './mentions.mjs';
import { checkAvatar } from './avatars.mjs';
import { CollabError, MAX_TEXT, publicMessage } from './store.mjs';

export const WS_PATH = '/cloud-web/ws';
// Declared to cc-connect. 'buttons' is declared so permission prompts arrive as
// a `buttons` frame (bridge platform/cloud-web SendWithButtons) instead of plain
// text (#120); cards are not declared, so cc-connect degrades them to text
// (bridge docs/cloud-web.md "Handshake").
export const CAPABILITIES = ['text', 'reconstruct_reply', 'typing', 'preview', 'update_message', 'delete_message', 'reply_in_place', 'buttons'];
// Permission decisions the Channel page and text replies may send. Values are the
// button data cc-connect's sendPermissionPrompt uses (bridge core/engine.go).
export const PERM_DECISIONS = { allow: 'perm:allow', deny: 'perm:deny', allow_all: 'perm:allow_all' };
const PERM_STATES = { allow: 'allowed', deny: 'denied', allow_all: 'allowed_all' };
// Same vocabularies and order as bridge core/engine.go approveAllPhrases /
// approveAllSingleTokens / allowKeywords / denyKeywords, so a text reply and a
// button click resolve to the same decision.
const APPROVE_ALL_PHRASES = ['allow all', 'approve all', 'yes all'];
const APPROVE_ALL_TOKENS = ['allowall', '允许所有', '允许全部', '全部允许', '所有允许', '都允许', '全部同意'];
const ALLOW_TOKENS = ['allow', 'yes', 'y', 'ok', 'approve', '允许', '同意', '可以', '好', '好的', '是', '确认'];
const DENY_TOKENS = ['deny', 'no', 'n', 'reject', 'cancel', '拒绝', '不允许', '不行', '不', '否', '取消'];
const REGISTER_TIMEOUT_MS = 10_000;
const WS_BAD_REGISTER = 4002;
const WS_REPLACED = 4003;
// cc-connect status notices that teammates never see (discord.go isBotNotice).
const NOTICE_PREFIXES = ['📬', '✅', '↪', '⏳', '🔄', '⏹', '⏸'];
// "model · usage" footer cc-connect appends (discord.go botFooter).
const FOOTER = /(?:^|\n+)\*[^*\n]*·[^*]*\*\s*$/s;
const BARE_MENTION = '（只 @ 了你，没写内容：看上面的频道消息判断要你做什么；看不出来就问）';
export const PROGRESS_PREFIX = '__cc_connect_progress_card_v1__:';
const CARD_STATES = { running: '处理中', completed: '已完成', failed: '失败' };
const RESERVED_IDS = new Set(['user', 'system']);
const MAX_NAME = 64;

export function roomKey(roomId) { return `room-${roomId}`; }

/** Room id from a frame's reply_ctx or session_key ("<platform>:room-<id>"), or undefined. */
export function roomOf(frame, store) {
  const sk = frame.session_key;
  const candidates = [frame.reply_ctx, typeof sk === 'string' && sk.includes(':') ? sk.split(':')[1] : undefined];
  for (let raw of candidates) {
    if (typeof raw !== 'string') continue;
    if (raw.startsWith('room-')) raw = raw.slice(5);
    if (/^\d+$/.test(raw) && store.room(Number(raw)) !== undefined) return Number(raw);
  }
  return undefined;
}

/** cc-connect progress card payload → { text, card } or undefined. */
export function progressCard(content) {
  if (!content.startsWith(PROGRESS_PREFIX)) return undefined;
  let p;
  try { p = JSON.parse(content.slice(PROGRESS_PREFIX.length)); } catch { return undefined; }
  if (p === null || typeof p !== 'object') return undefined;
  const state = p.state in CARD_STATES ? p.state : 'running';
  const steps = Number.isInteger(p.steps) ? p.steps : 0;
  const sec = Number.isInteger(p.elapsed_sec) ? p.elapsed_sec : 0;
  const lines = [`第 ${steps} 步 · ${sec >= 60 ? `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒` : `${sec}秒`}`];
  const items = Array.isArray(p.items) ? p.items : (p.entries ?? []).filter(e => typeof e === 'string').map(text => ({ text }));
  for (const it of items) {
    const text = String(it?.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const tool = String(it.tool ?? '').trim();
    lines.push(`${it.kind === 'tool_use' ? '🔧' : it.kind === 'error' ? '❌' : '•'} ${tool ? tool + ' — ' : ''}${text.slice(0, 120)}`);
  }
  const agent = String(p.agent ?? 'Agent').trim() || 'Agent';
  return { text: lines.join('\n'), card: JSON.stringify({ title: `${agent} · ${CARD_STATES[state]}`, state, steps, elapsed_sec: sec }) };
}

export class CloudWebGateway {
  /**
   * @param hub - Hub instance.
   * @param options - { token: shared bot token (empty disables the gateway), logger }.
   */
  constructor(hub, { token, logger }) {
    this.hub = hub;
    this.token = token;
    this.logger = logger;
    /** member id -> { ws, member } */
    this.bots = new Map();
    /** permission prompt message id -> { bot, room, sessionKey, replyCtx } while undecided */
    this.pendingPerms = new Map();
    hub.onMessage(message => this.onNew(message));
  }

  authorized(req, url) {
    if (!this.token) return false;
    const header = req.headers.authorization ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : undefined;
    const presented = bearer ?? req.headers['x-cloud-web-token'] ?? url.searchParams.get('token');
    return typeof presented === 'string' && timingSafeEqualString(presented, this.token);
  }

  /** Own one upgraded socket: register handshake, then frames until close. */
  accept(ws, url) {
    let bot;
    const timer = setTimeout(() => ws.close(WS_BAD_REGISTER, 'register timeout'), REGISTER_TIMEOUT_MS);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let frame;
      try { frame = JSON.parse(String(data)); } catch { return; }
      if (frame === null || typeof frame !== 'object') return;
      if (bot === undefined) {
        clearTimeout(timer);
        bot = this.register(ws, url, frame);
        return;
      }
      if (this.bots.get(bot.member.id) !== bot) return;
      this.fromBot(bot, frame).catch((error) => {
        this.logger.warn('collab: cloud-web frame from %s failed: %s', bot.member.id, error?.message ?? error);
      });
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (bot !== undefined && this.bots.get(bot.member.id) === bot) {
        this.bots.delete(bot.member.id);
        this.hub.setOnline(bot.member.id, false);
        // #121: a cc-connect that drops mid-stream never commits or deletes its preview.
        this.hub.dropDrafts('role', bot.member.id);
      }
    });
    ws.on('error', (error) => { this.logger.warn('collab: cloud-web socket error: %s', error?.message ?? error); });
  }

  register(ws, url, frame) {
    const project = typeof frame.project === 'string' ? frame.project : '';
    const id = clean(url.searchParams.get('bot') || project).slice(0, MAX_NAME);
    const existing = this.hub.members.get(id);
    if (frame.type !== 'register' || !id || RESERVED_IDS.has(id) || (existing !== undefined && existing.kind !== 'bot')) {
      send(ws, { type: 'register_ack', ok: false, error: 'bad register' });
      ws.close(WS_BAD_REGISTER, 'bad register');
      return undefined;
    }
    const name = clean(url.searchParams.get('name') ?? '').slice(0, MAX_NAME) || existing?.name || id;
    // @-mentions resolve by name, so a bot may not reuse another member's name.
    if (this.hub.memberList().some(m => m.id !== id && m.name.toLowerCase() === name.toLowerCase())) {
      send(ws, { type: 'register_ack', ok: false, error: `name ${name} is already used by another member` });
      ws.close(WS_BAD_REGISTER, 'name taken');
      return undefined;
    }
    const mentionId = url.searchParams.get('mention_id') ?? '';
    // avatar=<built-in slug> or an http(s) image URL (cc-connect's own library); anything else falls back to the initial badge.
    let avatar = '';
    try { avatar = checkAvatar(url.searchParams.get('avatar'), { allowUrl: true }); } catch { avatar = ''; }
    const member = { id, name, kind: 'bot', mentionId: /^\d+$/.test(mentionId) ? mentionId : '', online: true, ...(avatar ? { avatar } : {}) };
    const bot = { ws, member };
    const old = this.bots.get(id);
    this.bots.set(id, bot);
    if (old !== undefined) old.ws.close(WS_REPLACED, 'replaced by new connection');
    send(ws, { type: 'register_ack', ok: true, capabilities: CAPABILITIES, server: { name: 'conest-dsh-collab' } });
    this.hub.setMember(member);
    // A reconnect means a restarted cc-connect; its last typing_stop may be lost.
    for (const room of this.hub.thinking.keys()) this.hub.setThinking(room, id, false);
    // ...and its half-streamed text previews (also those left by a hub restart) will never be committed.
    this.hub.dropDrafts('role', id);
    // ...and its pending permission requests are gone with the old process.
    for (const [msgId, p] of this.pendingPerms) if (p.bot === id) this.closePerm(msgId, 'expired');
    return bot;
  }

  /** Forward one new channel message to every connected bot except its author. */
  onNew(msg) {
    if (msg.author_kind === 'system' || msg.card !== null || this.bots.size === 0) return;
    const fromAgent = msg.author_kind === 'role';
    // The owner's text reply to a pending permission prompt goes the same way as a button click.
    const answered = msg.author_kind === 'user' ? this.answerByText(msg) : new Set();
    let text = msg.text;
    if (fromAgent) {
      if (NOTICE_PREFIXES.some(p => text.trimStart().startsWith(p))) return;
      text = text.replace(FOOTER, '').trim();
      if (!text) return;
    }
    const members = this.hub.routable();
    const mentioned = mentions(text, members);
    const room = this.hub.store.room(msg.room_id);
    const author = this.hub.members.get(msg.author);
    for (const { ws, member } of this.bots.values()) {
      if (fromAgent && msg.author === member.id) continue;
      if (answered.has(member.id)) continue;
      let content = forMember(text, member, members);
      const hit = mentioned.has(member.id) || (fromAgent && nameCalled(text, member.name));
      if (fromAgent && !content) continue;
      if (fromAgent) content = `【${msg.name}】${content}`;
      else if (hit && !content) content = BARE_MENTION;
      const frame = {
        type: 'message', msg_id: `hub-${msg.id}`, chat_id: roomKey(msg.room_id), chat_type: 'group',
        user_id: msg.author, user_name: msg.name, content, reply_ctx: roomKey(msg.room_id),
        mentioned: hit, from_bot: fromAgent,
      };
      if (room !== undefined) frame.chat_name = room.name.replace(/\s+/g, ' ');
      if (author?.mentionId) frame.user_mention_id = author.mentionId;
      send(ws, frame);
    }
  }

  async fromBot(bot, d) {
    const { member } = bot;
    switch (d.type) {
      case 'ping': send(bot.ws, { type: 'pong' }); return;
      case 'reply': {
        const room = roomOf(d, this.hub.store);
        if (typeof d.content !== 'string' || room === undefined) return;
        const text = forDisplay(d.content, this.hub.routable()).trim();
        if (!text || text.length > MAX_TEXT) return;
        // reply_in_place (#121): the streamed preview becomes this reply; fall back to a new row if it is gone.
        const h = d.preview_handle;
        if (typeof h === 'string' && /^\d+$/.test(h) && this.hub.commit(Number(h), 'role', member.id, text, d.agent === true) !== undefined) return;
        this.hub.post(room, { authorKind: 'role', author: member.id, name: member.name, text, fromTurn: d.agent === true });
        return;
      }
      case 'buttons': {
        const room = roomOf(d, this.hub.store);
        if (typeof d.content !== 'string' || room === undefined || typeof d.session_key !== 'string' || !d.session_key) return;
        const text = forDisplay(d.content, this.hub.routable()).trim().slice(0, MAX_TEXT);
        const buttons = (Array.isArray(d.buttons) ? d.buttons.flat() : [])
          .map(b => ({ label: String(b?.Text ?? b?.text ?? ''), data: String(b?.Data ?? b?.data ?? '') }))
          .filter(b => b.label && b.data);
        const decisions = Object.entries(PERM_DECISIONS).filter(([, data]) => buttons.some(b => b.data === data));
        if (!text) return;
        if (decisions.length === 0) {
          // Not a permission prompt: keep the old text fallback.
          this.hub.post(room, { authorKind: 'role', author: member.id, name: member.name, text });
          return;
        }
        // cc-connect keeps one pending permission per session: a new prompt supersedes older ones.
        for (const [msgId, p] of this.pendingPerms) if (p.bot === member.id && p.sessionKey === d.session_key) this.closePerm(msgId, 'expired');
        const card = {
          kind: 'permission', title: '权限请求', state: 'pending',
          actions: decisions.map(([decision, data]) => ({ decision, label: buttons.find(b => b.data === data).label })),
        };
        const { message } = this.hub.post(room, { authorKind: 'role', author: member.id, name: member.name, text, card: JSON.stringify(card) });
        this.pendingPerms.set(message.id, { bot: member.id, room, sessionKey: d.session_key, replyCtx: typeof d.reply_ctx === 'string' ? d.reply_ctx : roomKey(room) });
        return;
      }
      case 'typing_start':
      case 'typing_stop': {
        const room = roomOf(d, this.hub.store);
        if (room !== undefined) this.hub.setThinking(room, member.id, d.type === 'typing_start');
        return;
      }
      case 'preview_start': {
        if (typeof d.ref_id !== 'string') return;
        const room = roomOf(d, this.hub.store);
        const body = this.body(d.content);
        let handle = '';
        if (room !== undefined && body.text) {
          const { message } = this.hub.draft(room, {
            authorKind: 'role', author: member.id, name: member.name, text: body.text, card: body.card,
            clientKey: `preview:${member.id}:${d.ref_id}`,
          });
          handle = String(message.id);
        }
        // Always ack, or cc-connect waits out its 10 s timeout.
        send(bot.ws, { type: 'preview_ack', ref_id: d.ref_id, preview_handle: handle });
        return;
      }
      case 'update_message':
      case 'delete_message': {
        const h = d.preview_handle;
        if (typeof h !== 'string' || !/^\d+$/.test(h)) return;
        if (d.type === 'delete_message') { this.hub.remove(Number(h), 'role', member.id); return; }
        const body = this.body(d.content);
        if (body.text) this.hub.edit(Number(h), 'role', member.id, body.text, body.card);
        return;
      }
      default:
    }
  }

  /**
   * Resolve permission prompt `msgId` with `decision` (a PERM_DECISIONS key) on
   * behalf of the Channel owner (callers check that). Throws CollabError when the
   * prompt is not a permission request, already decided, expired, or its bot is offline.
   */
  decidePermission(msgId, decision, by = 'button') {
    if (!Object.hasOwn(PERM_DECISIONS, decision)) throw new CollabError('invalid', `unknown decision ${decision}`);
    const row = this.hub.store.message(msgId);
    const card = row === undefined ? undefined : parseCard(row.card);
    if (card?.kind !== 'permission') throw new CollabError('not-permission', '这条消息不是权限请求');
    if (card.state !== 'pending') throw new CollabError('conflict', card.state === 'expired' ? '这个权限请求已过期' : '这个权限请求已经处理过了');
    const p = this.pendingPerms.get(msgId);
    if (p === undefined) {
      // Pending in the store but not in memory: collab restarted, cc-connect's side is unknown.
      this.closePerm(msgId, 'expired', row);
      throw new CollabError('conflict', '这个权限请求已过期');
    }
    const bot = this.bots.get(p.bot);
    if (bot === undefined) throw new CollabError('offline', `${row.name} 已断线，权限请求还在等待，重连后会失效`);
    this.closePerm(msgId, PERM_STATES[decision], row, by);
    send(bot.ws, { type: 'card_action', session_key: p.sessionKey, reply_ctx: p.replyCtx, action: PERM_DECISIONS[decision] });
    return publicMessage(this.hub.store.message(msgId));
  }

  /** Mark a permission prompt decided/expired and update it for browsers. */
  closePerm(msgId, state, row = this.hub.store.message(msgId), by) {
    this.pendingPerms.delete(msgId);
    const card = row === undefined ? undefined : parseCard(row.card);
    if (card?.kind !== 'permission' || card.state !== 'pending') return;
    const next = { ...card, state, ...(by ? { decided_by: by } : {}), decided_at: Math.floor(Date.now() / 1000) };
    this.hub.edit(row.id, 'role', row.author, row.text, JSON.stringify(next));
  }

  /**
   * Owner text reply → decision on the room's pending prompts; returns the ids of the
   * bots that must not also get the text (prompt answered, or withheld from them).
   *
   * cc-connect checks a pending permission before its gate and before any mention rule
   * (bridge core/engine.go handleMessage → handlePendingPermission, ahead of applyGate),
   * and hub bots run with group_reply_all (core/setup_wizard.go), so every bot with a
   * pending prompt that receives an allow/deny word acts on it. Hence: no @ → the
   * decision applies to every pending prompt in the room; an @ → only the @'d bots', and
   * the other pending bots are not sent the text so their prompts stay open.
   */
  answerByText(msg) {
    const answered = new Set();
    const members = this.hub.routable();
    const inRoom = [...this.pendingPerms].filter(([, p]) => p.room === msg.room_id && this.bots.has(p.bot));
    if (inRoom.length === 0) return answered;
    const mentioned = mentions(msg.text, members);
    for (const [msgId, p] of inRoom) {
      const decision = textDecision(forMember(msg.text, this.bots.get(p.bot).member, members));
      if (decision === undefined) continue;
      if (mentioned.size > 0 && !mentioned.has(p.bot)) {
        answered.add(p.bot); // addressed to someone else: withhold it so this bot's bridge doesn't approve
        continue;
      }
      try { this.decidePermission(msgId, decision, 'text'); } catch { continue; }
      answered.add(p.bot);
    }
    return answered;
  }

  body(content) {
    if (typeof content !== 'string') return { text: '', card: null };
    const card = progressCard(content);
    if (card !== undefined) return card;
    return { text: forDisplay(content, this.hub.routable()).trim().slice(0, MAX_TEXT), card: null };
  }

  closeAll() {
    for (const { ws } of this.bots.values()) ws.close(1001, 'server shutdown');
  }
}

function parseCard(raw) {
  if (typeof raw !== 'string') return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

// Same rune set as bridge core/engine.go permissionTokenSeparator (whitespace plus these).
const PERM_TOKEN_SEPARATORS = /[\s@＠,，.。!！?？:：;；()（）[\]【】"'“”‘’、·]+/u;

/** Port of bridge core/engine.go isApproveAllResponse / isAllowResponse / isDenyResponse (checked in that order). */
export function textDecision(text) {
  const tokens = String(text).toLowerCase().trim().split(PERM_TOKEN_SEPARATORS).filter(Boolean);
  if (tokens.length === 0) return undefined;
  const joined = tokens.join(' ');
  if (APPROVE_ALL_PHRASES.some(ph => joined === ph || ` ${joined} `.includes(` ${ph} `))) return 'allow_all';
  if (tokens.some(t => APPROVE_ALL_TOKENS.includes(t))) return 'allow_all';
  if (tokens.some(t => ALLOW_TOKENS.includes(t))) return 'allow';
  if (tokens.some(t => DENY_TOKENS.includes(t))) return 'deny';
  return undefined;
}

function send(ws, frame) {
  try { ws.send(JSON.stringify(frame)); } catch { /* socket already closing; its close handler cleans up */ }
}

function clean(s) { return String(s ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim(); }

function timingSafeEqualString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
