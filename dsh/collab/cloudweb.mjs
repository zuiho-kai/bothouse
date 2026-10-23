// cc-connect cloud_web gateway (server side of bridge/platform/cloud-web, WS
// transport). Ported from role-household/rh/cloudweb.py so a cc-connect
// project configured for the role-household hub connects here unchanged:
//   ws(s)://<host>/cloud-web/ws?bot=<member id>&name=<display>&mention_id=<digits>
// Rooms are addressed as "room-<id>", messages as "hub-<id>".
import { forDisplay, forMember, mentions, nameCalled } from './mentions.mjs';
import { MAX_TEXT, publicMessage } from './store.mjs';
import { memberId, validateCredentials } from './identity.mjs';

export const WS_PATH = '/cloud-web/ws';
// Declared to cc-connect. Buttons/cards are not declared, so cc-connect
// degrades them to text (bridge docs/cloud-web.md "Handshake").
export const CAPABILITIES = ['text', 'reconstruct_reply', 'typing', 'preview', 'update_message', 'delete_message'];
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
// Messages a bot may still be running or queueing per room, recalled on stop.
// 来源：沿用 bridge/core/engine.go defaultMaxQueuedMessages = 5，加 1 条在跑
export const MAX_RECALLABLE = 6;
const MAX_NAME = 64;

export function roomKey(roomId) { return `room-${roomId}`; }

/** Room id from a frame's reply_ctx or session_key ("<platform>:room-<id>"), or undefined. */
export function roomOf(frame, store) {
  const sk = frame.session_key;
  const candidates = [frame.reply_ctx, typeof sk === 'string' && sk.includes(':') ? sk.split(':')[1] : undefined];
  for (let raw of candidates) {
    if (typeof raw !== 'string') continue;
    if (raw.startsWith('room-')) raw = raw.slice(5).replace(/(?::epoch-[0-9]+)?(?::acl-[0-9]+-[0-9]+)?$/, '');
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
   * @param options - { token: legacy shared bot token, tokens: Map<token, memberId>, logger }.
   *   `tokens` gives each bot its own credential, so a presented token identifies the bot.
   *   The legacy shared token only reads public HTTP history; it cannot register a writer.
   */
  constructor(hub, { token, tokens, logger }) {
    this.hub = hub;
    this.token = token;
    this.tokens = tokens ?? new Map();
    validateCredentials(this.tokens, token, new Set([...hub.store.members().map(m => m.id), ...hub.routable().filter(m => m.kind === 'dsh').map(m => m.id)]));
    hub.reservedBotIds = new Set(this.tokens.values());
    hub.store.reservedBotIds = hub.reservedBotIds;
    this.logger = logger;
    /** member id -> { ws, member } */
    this.bots = new Map();
    /** member id -> (room id -> newest msg_ids sent to that bot, oldest first, at most MAX_RECALLABLE) */
    this.delivered = new Map();
    hub.onPlan(message => {
      const grants = new Map([...this.bots.values()].filter(bot => this.mayAccess(bot, message.room_id))
        .map(bot => [bot.member.id, this.hub.store.accessStamp(bot.member.id, message.room_id)]));
      return () => this.onNew(message, grants);
    });
  }

  /**
   * Who is calling, from the credential alone. Bots present it in a header; the query
   * string is deliberately not read, so tokens stay out of URLs, logs and proxies.
   * Returns { memberId, shared } or undefined when no configured credential matches.
   */
  identify(headers) {
    const authorization = headers?.authorization ?? '';
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const presented = bearer ?? headers?.['x-cloud-web-token'];
    if (typeof presented !== 'string' || presented === '') return undefined;
    for (const [secret, memberId] of this.tokens) {
      if (timingSafeEqualString(presented, secret)) return { memberId, shared: false };
    }
    if (this.token && timingSafeEqualString(presented, this.token)) return { memberId: undefined, shared: true };
    return undefined;
  }

  authorized(req) {
    return this.identify(req.headers) !== undefined;
  }

  /** WebSocket writers always carry a dedicated credential. */
  mayAccess(bot, roomId) {
    return this.hub.store.canAccess(bot.member.id, roomId);
  }

  /** Own one upgraded socket: register handshake, then frames until close. */
  accept(ws, url, headers) {
    const credential = this.identify(headers);
    let bot;
    const timer = setTimeout(() => ws.close(WS_BAD_REGISTER, 'register timeout'), REGISTER_TIMEOUT_MS);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let frame;
      try { frame = JSON.parse(String(data)); } catch { return; }
      if (frame === null || typeof frame !== 'object') return;
      if (bot === undefined) {
        clearTimeout(timer);
        bot = this.register(ws, url, frame, credential);
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
        this.delivered.delete(bot.member.id);
        this.hub.setOnline(bot.member.id, false);
      }
    });
    ws.on('error', (error) => { this.logger.warn('collab: cloud-web socket error: %s', error?.message ?? error); });
  }

  register(ws, url, frame, credential) {
    if (!credential || credential.shared) {
      send(ws, { type: 'register_ack', ok: false, error: 'dedicated credential required' });
      ws.close(WS_BAD_REGISTER, 'unauthorized');
      return undefined;
    }
    // Only ?bot= is an identity claim. `project` is a cc-connect project name and says
    // nothing about which bot is calling, so it must not be compared with a credential.
    const claimedParam = url.searchParams.get('bot') ?? '';
    // The token fixes identity; project is only a project label and the URL may only agree.
    if (claimedParam !== '' && claimedParam !== credential.memberId) {
      send(ws, { type: 'register_ack', ok: false, error: 'credential mismatch' });
      ws.close(WS_BAD_REGISTER, 'credential mismatch');
      return undefined;
    }
    const id = credential.memberId;
    try { memberId(id); } catch {
      send(ws, { type: 'register_ack', ok: false, error: 'bad register' });
      ws.close(WS_BAD_REGISTER, 'bad register');
      return undefined;
    }
    const existing = this.hub.members.get(id);
    if (frame.type !== 'register' || !id || this.hub.store.member(id) !== undefined || (existing !== undefined && existing.kind !== 'bot')) {
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
    const member = { id, name, kind: 'bot', mentionId: /^\d+$/.test(mentionId) ? mentionId : '', online: true };
    const bot = { ws, member, contexts: new Map(this.hub.store.rooms().map(r => [r.id, this.replyContext(r.id, id)])) };
    const old = this.bots.get(id);
    this.bots.set(id, bot);
    if (old !== undefined) old.ws.close(WS_REPLACED, 'replaced by new connection');
    send(ws, { type: 'register_ack', ok: true, capabilities: CAPABILITIES, server: { name: 'conest-dsh-collab' } });
    this.hub.setMember(member);
    // A reconnect means a restarted cc-connect; its last typing_stop may be lost.
    for (const room of this.hub.thinking.keys()) this.hub.setThinking(room, id, false);
    return bot;
  }

  /** Forward one new channel message to every connected bot except its author. */
  onNew(msg, grants) {
    if (msg.author_kind === 'system' || msg.card !== null || this.bots.size === 0 || !this.hub.canDispatch(msg)) return;
    const fromAgent = msg.author_kind === 'role';
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
    for (const bot of this.bots.values()) {
      const { ws, member } = bot;
      if (fromAgent && msg.author === member.id) continue;
      // A bot that may not read this room never hears about it: no frame, no metadata leak.
      if (!this.mayAccess(bot, msg.room_id)) continue;
      if (grants && grants.get(member.id) !== this.hub.store.accessStamp(member.id, msg.room_id)) continue;
      let content = forMember(text, member, members);
      const hit = mentioned.has(member.id) || (fromAgent && nameCalled(text, member.name));
      if (fromAgent && !content) continue;
      if (fromAgent) content = `【${msg.name}】${content}`;
      else if (hit && !content) content = BARE_MENTION;
      const frame = {
        type: 'message', msg_id: `hub-${msg.id}`, chat_id: roomKey(msg.room_id), chat_type: 'group',
        user_id: msg.author, user_name: msg.name, content, reply_ctx: this.replyContext(msg.room_id, member.id),
        mentioned: hit, from_bot: fromAgent,
      };
      if (room !== undefined) frame.chat_name = room.name.replace(/\s+/g, ' ');
      if (author?.mentionId) frame.user_mention_id = author.mentionId;
      send(ws, frame);
      bot.contexts.set(msg.room_id, frame.reply_ctx);
      this.remember(member.id, msg.room_id, frame.msg_id);
    }
  }

  /** Keep the newest MAX_RECALLABLE msg_ids sent to a bot in a room, so stop can recall them. */
  remember(botId, roomId, msgId) {
    let rooms = this.delivered.get(botId);
    if (rooms === undefined) this.delivered.set(botId, rooms = new Map());
    const ids = rooms.get(roomId) ?? [];
    ids.push(msgId);
    if (ids.length > MAX_RECALLABLE) ids.splice(0, ids.length - MAX_RECALLABLE);
    rooms.set(roomId, ids);
  }

  async fromBot(bot, d) {
    const { member } = bot;
    const mutations = ['reply', 'typing_start', 'typing_stop', 'preview_start', 'update_message', 'delete_message'];
    if (!mutations.includes(d.type)) { if (d.type === 'ping') send(bot.ws, { type: 'pong' }); return; }
    const room = roomOf(d, this.hub.store);
    // Handle mutations use the stored room/author, never a caller-supplied reply_ctx.
    if (d.type !== 'update_message' && d.type !== 'delete_message') {
      if (room === undefined || !this.mayAccess(bot, room)) return this.forbidden(bot, d);
      const c = this.hub.store.control(room);
      const current = this.replyContext(room, member.id);
      const stamp = this.hub.store.accessStamp(member.id, room);
      // Once policy has changed, no legacy/missing context can prove fresh authorization.
      if (stamp !== '0:0' && d.reply_ctx !== current) return this.forbidden(bot, d);
      const proactive = d.type === 'reply' && d.agent !== true;
      const stale = proactive
        ? d.reply_ctx !== undefined && c.epoch > 0 && d.reply_ctx !== current
        : c.stopped === 1 || (c.epoch > 0 && d.reply_ctx !== current);
      if (stale) return this.forbidden(bot, d);
    }
    switch (d.type) {
      case 'ping': send(bot.ws, { type: 'pong' }); return;
      case 'reply': {
        const room = roomOf(d, this.hub.store);
        if (typeof d.content !== 'string' || room === undefined) return;
        const text = forDisplay(d.content, this.hub.routable()).trim();
        if (!text || text.length > MAX_TEXT) return;
        this.hub.post(room, { authorKind: 'role', author: member.id, name: member.name, text, fromTurn: d.agent === true });
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
          const { message } = this.hub.store.append(room, {
            authorKind: 'role', author: member.id, name: member.name, text: body.text, card: body.card,
            clientKey: `preview:${member.id}:${this.replyContext(room, member.id)}:${d.ref_id}`,
          });
          this.hub.store.stampMessage(message.id, this.messageStamp(member.id, room));
          this.hub.emit({ type: 'message', message: publicMessage(message) });
          handle = String(message.id);
        }
        // Always ack, or cc-connect waits out its 10 s timeout.
        send(bot.ws, { type: 'preview_ack', ref_id: d.ref_id, preview_handle: handle });
        return;
      }
      case 'update_message':
      case 'delete_message': {
        const h = d.preview_handle;
        if (typeof h !== 'string' || !/^\d+$/.test(h)) return this.forbidden(bot, d);
        const message = this.hub.store.message(Number(h));
        if (!message || message.author_kind !== 'role' || message.author !== member.id
          || !this.mayAccess(bot, message.room_id)
          || message.access_stamp !== this.messageStamp(member.id, message.room_id)
          || !this.hub.canDispatch(message)) return this.forbidden(bot, d);
        if (d.type === 'delete_message') { this.hub.remove(Number(h), 'role', member.id); return; }
        const body = this.body(d.content);
        if (body.text) this.hub.edit(Number(h), 'role', member.id, body.text, body.card);
        return;
      }
      default:
    }
  }

  forbidden(bot, frame) {
    send(bot.ws, { type: 'error', code: 'forbidden', error: 'forbidden', ...(typeof frame.ref_id === 'string' ? { ref_id: frame.ref_id } : {}) });
    if (frame.type === 'preview_start' && typeof frame.ref_id === 'string') send(bot.ws, { type: 'preview_ack', ref_id: frame.ref_id, preview_handle: '' });
  }

  messageStamp(memberId, roomId) {
    return `${this.hub.store.accessStamp(memberId, roomId)}/${this.hub.store.control(roomId).epoch}`;
  }

  replyContext(roomId, memberId) {
    const epoch = this.hub.store.control(roomId).epoch;
    const stamp = this.hub.store.accessStamp(memberId, roomId);
    return roomKey(roomId) + (epoch ? `:epoch-${epoch}` : '') + (stamp !== '0:0' ? `:acl-${stamp.replace(':', '-')}` : '');
  }

  reconcileRoom(roomId) {
    for (const bot of this.bots.values()) {
      const ids = this.delivered.get(bot.member.id)?.get(roomId);
      if (!this.mayAccess(bot, roomId) || bot.contexts.get(roomId) !== this.replyContext(roomId, bot.member.id)) {
        for (const id of ids ?? []) send(bot.ws, { type: 'message_recall', msg_id: id, chat_id: roomKey(roomId) });
        this.delivered.get(bot.member.id)?.delete(roomId);
        this.hub.setThinking(roomId, bot.member.id, false);
      }
      bot.contexts.set(roomId, this.replyContext(roomId, bot.member.id));
    }
  }

  /**
   * Stop a room for every connected bot: recall the messages it may still be running or
   * queueing (cc-connect stops the running turn or drops the queued one; it sends no ack),
   * and clear thinking. outputOnly = bots that were thinking; recalled = bots sent a recall.
   */
  stopRoom(roomId) {
    const outputOnly = [...this.bots.keys()].filter(id => this.hub.thinking.get(roomId)?.has(id));
    const recalled = [];
    for (const { ws, member } of this.bots.values()) {
      this.hub.setThinking(roomId, member.id, false);
      const rooms = this.delivered.get(member.id);
      const ids = rooms?.get(roomId);
      if (ids === undefined || ids.length === 0) continue;
      for (const msgId of ids) send(ws, { type: 'message_recall', msg_id: msgId, chat_id: roomKey(roomId) });
      rooms.delete(roomId);
      recalled.push(member.id);
    }
    return { outputOnly, recalled };
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
