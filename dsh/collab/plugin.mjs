// CoNest collab: Discord-style channels inside a DSH Web host. Load it by
// absolute path from a --patch overlay (see dsh/README.md):
//   - insert:
//       - id: conest-collab
//         name: /abs/path/dsh/collab/plugin.mjs
//         config: { dataDir, workspacePath, leadFile?, fallbackLead?, botTokenEnv?, ownerName?, rooms?, dshMembers?, maxRelay? }
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store, CollabError, publicMessage } from './store.mjs';
import { Hub } from './hub.mjs';
import { TeamExit } from './team-exit.mjs';
import { CloudWebGateway, WS_PATH } from './cloudweb.mjs';
import { DshMembers } from './dsh-member.mjs';
import { Roster } from './roster.mjs';
import { Tasks, WORKING } from './tasks.mjs';
import { createCliMember } from './cli-member.mjs';
import { avatarImage, checkAvatar } from './avatars.mjs';
import { handler as clisHandler } from './clis.mjs';
import { LeadState } from './lead-state.mjs';
import { Attachments, INLINE_IMAGE } from './attachments.mjs';
import { Later, registerLater } from './later.mjs';

export const name = 'conest-collab';
export const inject = [
  'attachments', 'webServer', 'connection', 'llm', 'agents', 'agentDefaultModel', 'agentPresets', 'permissionPresets', 'sessionTitle', 'workspaceRegistry',
  'sessionPersistence',
];

const PAGE = readFileSync(new URL('./page.html', import.meta.url), 'utf8');
const MAX_BODY = 256 * 1024;
// #144: a message POST may carry base64 attachments. Same cap as the bot WebSocket
// maxPayload below (8 MiB), so a message that is accepted here still fits in the frame
// that forwards it to a bot.
const MAX_MESSAGE_BODY = 8 * 1024 * 1024;
const OWNER = 'owner';

/** Validate the overlay config; misconfiguration fails at load. */
export function resolveConfig(config, env = process.env) {
  const c = config ?? {};
  for (const field of ['dataDir', 'workspacePath']) {
    if (typeof c[field] !== 'string' || !isAbsolute(c[field])) throw Error(`conest-collab: ${field} must be an absolute path`);
  }
  const rooms = c.rooms ?? [{ id: 1, name: 'general' }];
  if (!Array.isArray(rooms) || rooms.length === 0 || rooms.some(r => !Number.isSafeInteger(r?.id) || r.id <= 0 || typeof r.name !== 'string' || !r.name.trim())) {
    throw Error('conest-collab: rooms must be [{ id: positive integer, name }]');
  }
  const members = c.dshMembers ?? [];
  const ids = new Set();
  for (const m of members) {
    if (typeof m?.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(m.id) || ['user', 'system', OWNER].includes(m.id) || ids.has(m.id)) {
      throw Error(`conest-collab: dshMembers id ${JSON.stringify(m?.id)} must be unique lowercase [a-z0-9_-]`);
    }
    if (typeof m.name !== 'string' || !m.name.trim()) throw Error(`conest-collab: dshMembers ${m.id} needs a name`);
    if (m.model !== undefined && (typeof m.model?.provider !== 'string' || typeof m.model?.model !== 'string')) {
      throw Error(`conest-collab: dshMembers ${m.id} model must be { provider, model }`);
    }
    if (m.persona !== undefined && typeof m.persona !== 'string') throw Error(`conest-collab: dshMembers ${m.id} persona must be text`);
    try { checkAvatar(m.avatar); } catch (error) { throw Error(`conest-collab: dshMembers ${m.id} ${error.message}`); }
    ids.add(m.id);
  }
  const maxRelay = c.maxRelay ?? 6;
  if (!Number.isSafeInteger(maxRelay) || maxRelay < 0) throw Error('conest-collab: maxRelay must be a non-negative integer');
  const botTokenEnv = c.botTokenEnv ?? 'CONEST_COLLAB_BOT_TOKEN';
  const botToken = env[botTokenEnv] ?? '';
  const leadFile = c.leadFile ?? join(env.BOTHOUSE_DATA_DIR ?? join(env.HOME ?? '.', '.bothouse'), 'lead.json');
  if (!isAbsolute(leadFile)) throw Error('conest-collab: leadFile must be an absolute path');
  const fallbackLead = String(c.fallbackLead ?? env.CONEST_FALLBACK_LEAD ?? '').trim();
  return { dataDir: c.dataDir, workspacePath: c.workspacePath, leadFile, fallbackLead, rooms, dshMembers: members, maxRelay, botTokenEnv, botToken, ownerName: c.ownerName ?? '我' };
}

/** Resolve a package from the running DSH installation, never a second copy. */
function dshRequire() {
  return createRequire(realpathSync(process.argv[1]));
}

/**
 * #557: a channel-started turn asks in its room. Prepended so a DSH Web UI tab
 * or another plugin's answerer (e.g. auto review) never takes a hidden Session's ask.
 */
export function installApprovalAnswerer(ctx, dsh) {
  ctx.on('approval/request', (request, next) => dsh.onApprovalRequest(request, next), { prepend: true });
}

export function roomSettingsRoute(req, res, path, { store, hub }) {
  const match = /^\/collab\/api\/rooms\/(\d+)\/settings$/.exec(path);
  if (match === null || !['GET', 'PATCH'].includes(req.method)) return undefined;
  const roomId = Number(match[1]);
  if (store.room(roomId) === undefined) return json(res, 404, { error: 'room not found' });
  const view = () => ({ dispatch_mode: store.dispatchMode(roomId), ...store.relaySetting(roomId) });
  if (req.method === 'GET') return json(res, 200, view());
  return withBody(req, res, body => {
    store.transaction(() => {
      if (body?.dispatch_mode !== undefined) store.setDispatchMode(roomId, body.dispatch_mode);
      if (body?.max_relay !== undefined) store.setMaxRelay(roomId, body.max_relay);
    });
    hub.emit({ type: 'rooms', rooms: store.roomsView() });
    return view();
  });
}

export async function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const require = dshRequire();
  const { createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
  // ws is CommonJS; its WebSocketServer is not a statically detectable named export.
  const { WebSocketServer } = require('ws');
  if (typeof createUserMessage !== 'function' || typeof WebSocketServer !== 'function') throw Error('conest-collab: unsupported DSH runtime');

  const store = new Store(join(config.dataDir, 'collab.sqlite3'));
  for (const room of config.rooms) {
    store.ensureRoom(room.id, room.name.trim());
    store.ensureRoomSettings(room.id);
  }
  const leadState = new LeadState(config.leadFile, ctx.logger);
  const hub = new Hub(store, ctx.logger, leadState, config.fallbackLead);
  hub.teamExit = new TeamExit(hub);
  hub.setMember({ id: OWNER, name: config.ownerName, kind: 'human', online: true });
  const files = new Attachments(join(config.dataDir, 'attachments'));
  const gateway = new CloudWebGateway(hub, { token: config.botToken, logger: ctx.logger, files });
  const later = new Later(hub, join(config.dataDir, 'collab.sqlite3'), (id, msg) => dsh.nudge(id, msg) || gateway.nudge(id, msg), { start: false });
  gateway.later = later;
  const dsh = new DshMembers(hub, { files, later, ctx, createUserMessage, createCliMember, workspacePath: config.workspacePath, logger: ctx.logger }, [], { maxRelay: config.maxRelay });
  const roster = new Roster(hub, dsh, ctx.llm);
  // #139 B: dispatched tasks; a reminder wakes its owner whichever kind of member it is.
  // Started after dsh.recover(): a reminder due during the downtime must not look like a leftover job.
  const tasks = new Tasks(hub, { start: false });
  hub.tasks = tasks;
  gateway.tasks = tasks;
  tasks.onWake((memberId, message) => dsh.nudge(memberId, message) || gateway.nudge(memberId, message));
  // A workspace released after its last task shows up free in the room list. Its sessions are
  // cleared when a new claim takes it (store.resetSessions: DSH members rebind from the store; local
  // CLI members drop their ACP session), not on release, so a rework goes on in them (#597 G35).
  tasks.onRelease(() => hub.emit({ type: 'rooms', rooms: hub.store.roomsView() }));
  hub.store.onSessionsReset(roomId => dsh.resetRoom(roomId));
  // Config members are seeds; UI-created members persist in the store. Both must be routable before recovery.
  roster.load(config.dshMembers);
  const wizard = await roster.importWizard(join(config.dataDir, 'wizard-members.json'), ctx.logger);
  if (wizard.length) ctx.logger.info('conest-collab: added wizard members %s', wizard.join(', '));
  ctx.on('session/event', (session, event) => dsh.onSessionEvent(session, event));
  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => dsh.onClaimed(agent.session.id, message.id, turn));
  ctx.on('agent/inbox/discarded', ({ agent, message }) => dsh.onDiscarded(agent.session.id, message.id));
  installApprovalAnswerer(ctx, dsh);
  // Queue leftover jobs before any route can add new ones, so both share one order.
  dsh.recover();
  tasks.start();
  later.start();
  if (!config.botToken) ctx.logger.warn(`conest-collab: ${config.botTokenEnv} is unset; cc-connect bots cannot connect`);

  const owner = req => ctx.connection.requestRejection(req) === undefined;
  const wss = new WebSocketServer({ noServer: true, maxPayload: BOT_WS_MAX_PAYLOAD });
  const streams = new Set();

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/collab', handler: (req, res) => browserRoute(req, res) }), 'conest-collab: /collab');
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/api/rooms', handler: (req, res) => historyRoute(req, res) }), 'conest-collab: /api/rooms');
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: WS_PATH,
    handler: (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://collab.invalid');
      later.origin ??= localOrigin(req);
      if (!gateway.authorized(req, url)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      wss.handleUpgrade(req, socket, head, ws => gateway.accept(ws, url));
    },
  }), 'conest-collab: cloud-web upgrade');
  ctx.effect(() => async () => {
    later.close();
    tasks.close();
    gateway.closeAll();
    for (const end of streams) end();
    wss.close();
    // Drain DSH jobs first: a job still awaiting its Agent must not touch a closed store.
    await dsh.close();
    store.close();
  }, 'conest-collab: teardown');

  ctx.logger.info('conest-collab: %d room(s), %d DSH member(s), cloud-web %s', config.rooms.length, config.dshMembers.length, config.botToken ? 'on' : 'off');

  /** cc-connect ChannelHistory: GET /api/rooms/{id}/messages?before=&limit= (bot token or owner). */
  function historyRoute(req, res) {
    const url = new URL(req.url ?? '/', 'http://collab.invalid');
    later.origin ??= localOrigin(req);
    const m = /^\/api\/rooms\/(\d+)\/messages$/.exec(url.pathname);
    if (req.method !== 'GET' || m === null) return json(res, 404, { error: 'not found' });
    if (!gateway.authorized(req, url) && !owner(req)) return json(res, 401, { error: 'unauthorized' });
    if (store.room(Number(m[1])) === undefined) return json(res, 404, { error: 'room not found' });
    const before = url.searchParams.get('before');
    const rows = store.page(Number(m[1]), before === null ? undefined : Number(before), url.searchParams.get('limit'));
    return json(res, 200, { messages: rows.map(r => publicMessage(r, store)) });
  }

  async function browserRoute(req, res) {
    const url = new URL(req.url ?? '/', 'http://collab.invalid');
    const path = url.pathname.replace(/\/+$/, '');
    later.origin ??= localOrigin(req);
    const scheduled = laterRoute(req, res, url, { hub, gateway, owner, later });
    if (scheduled !== undefined) return scheduled;
    const routed = tasksRoute(req, res, url, { tasks, gateway, owner });
    if (routed !== undefined) return routed;
    const opened = workspacesRoute(req, res, url, { store, hub, gateway, owner, later, tasks, dsh });
    if (opened !== undefined) return opened;
    if (!owner(req)) {
      if (path === '/collab' && req.method === 'GET') return text(res, 401, 'text/plain; charset=utf-8', '请先在同一个浏览器打开 DSH 网页登录，再回到 /collab。');
      return refuse(req, res);
    }
    if (path === '/collab' && req.method === 'GET') return text(res, 200, 'text/html; charset=utf-8', PAGE);
    if (path === '/collab/api/state' && req.method === 'GET') {
      return json(res, 200, { me: OWNER, lead_id: hub.selectedPrimaryMember()?.id ?? null,
        effective_lead_id: hub.primaryMember()?.id ?? null,
        rooms: store.roomsView().map(r => ({ ...r, dispatch_mode: store.dispatchMode(r.id) })), members: hub.memberView(),
        thinking: Object.fromEntries([...hub.thinking].map(([k, v]) => [k, [...v]])) });
    }
    if (path === '/collab/api/events' && req.method === 'GET') return events(req, res);
    if (path === '/collab/api/lead' && req.method === 'GET') {
      return json(res, 200, { lead_id: hub.selectedPrimaryMember()?.id ?? null,
        effective_lead_id: hub.primaryMember()?.id ?? null });
    }
    if (path === '/collab/api/lead' && req.method === 'PATCH') {
      return withBody(req, res, body => {
        const id = String(body?.lead_id ?? '').trim();
        const member = hub.members.get(id);
        if (member === undefined || member.kind === 'human') throw new CollabError('member-missing', `member ${id} is not a routable role`);
        leadState.set(id, member.name);
        hub.emit({ type: 'lead', lead_id: id, effective_lead_id: hub.primaryMember()?.id ?? null });
        return { lead_id: id, effective_lead_id: hub.primaryMember()?.id ?? null };
      });
    }
    const att = /^\/collab\/api\/attachments\/([0-9a-f-]{36})$/.exec(path);
    if (att !== null && req.method === 'GET') {
      const row = store.attachmentMeta(att[1]);
      const bytes = row === undefined ? undefined : files.read(att[1]);
      if (bytes === undefined) return json(res, 404, { error: 'attachment not found' });
      return sendAttachment(req, res, row, bytes);
    }
    const av = /^\/collab\/avatars\/([a-z0-9_-]+)\.png$/.exec(path);
    if (av !== null && req.method === 'GET') {
      const png = avatarImage(av[1]);
      if (png === undefined) return json(res, 404, { error: 'avatar not found' });
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=86400' });
      return res.end(png);
    }
    const m = /^\/collab\/api\/rooms\/(\d+)\/messages$/.exec(path);
    if (m !== null && req.method === 'GET') {
      const roomId = Number(m[1]);
      if (store.room(roomId) === undefined) return json(res, 404, { error: 'room not found' });
      const after = url.searchParams.get('after');
      const before = url.searchParams.get('before');
      const rows = after !== null ? store.since(roomId, Number(after), url.searchParams.get('limit'))
        : store.page(roomId, before === null ? undefined : Number(before), url.searchParams.get('limit'));
      return json(res, 200, { messages: rows.map(r => publicMessage(r, store)) });
    }
    const settings = roomSettingsRoute(req, res, path, { store, hub });
    if (settings !== undefined) return settings;
    const mode = /^\/collab\/api\/rooms\/(\d+)\/mode$/.exec(path);
    if (mode !== null && req.method === 'GET') {
      const roomId = Number(mode[1]);
      if (store.room(roomId) === undefined) return json(res, 404, { error: 'room not found' });
      return json(res, 200, { dispatch_mode: store.dispatchMode(roomId) });
    }
    if (mode !== null && req.method === 'PATCH') {
      const roomId = Number(mode[1]);
      if (store.room(roomId) === undefined) return json(res, 404, { error: 'room not found' });
      return withBody(req, res, body => {
        store.setDispatchMode(roomId, body?.dispatch_mode);
        hub.emit({ type: 'rooms', rooms: store.roomsView() });
        return store.dispatchSetting(roomId);
      });
    }
    if (m !== null && req.method === 'POST') {
      return withBody(req, res, (body) => {
        const clientKey = typeof body?.client_key === 'string' && body.client_key ? `web:${body.client_key.slice(0, 64)}` : undefined;
        const roomId = Number(m[1]);
        if (store.room(roomId) === undefined) throw new CollabError('room-missing', `room ${roomId} does not exist`);
        const attachments = files.save(body?.attachments);
        const { message } = hub.post(roomId, { authorKind: 'user', author: OWNER, name: config.ownerName, text: String(body?.text ?? ''), clientKey,
          replyTo: Number.isInteger(body?.reply_to) ? body.reply_to : undefined, attachments });
        return { message: publicMessage(message, store) };
      }, true, MAX_MESSAGE_BODY);
    }
    const edited = ownMessageRoute(req, res, path, { store, hub, gateway, dsh });
    if (edited !== undefined) return edited;
    // #120/#557: owner-only (checked above) decision on a permission card (cloud-web bot or DSH member).
    const pm = /^\/collab\/api\/messages\/(\d+)\/permission$/.exec(path);
    if (pm !== null && req.method === 'POST') {
      return withBody(req, res, body => ({ message: hub.approvals.decide(Number(pm[1]), String(body?.decision ?? '')) }));
    }
    // #146: owner-only (checked above) retry on a failed message or error card.
    const rm = /^\/collab\/api\/messages\/(\d+)\/retry$/.exec(path);
    if (rm !== null && req.method === 'POST') {
      return withBody(req, res, () => {
        const messageId = Number(rm[1]);
        const message = store.message(messageId);
        if (message === undefined) throw new CollabError('not-found', 'message not found');
        let card;
        if (message.card) {
          try { card = JSON.parse(message.card); } catch {}
        }
        let memberId = card?.member_id;
        let triggerId = card?.trigger_id;
        if (!memberId && typeof message.client_key === 'string') {
          const jm = /^dsh-job-(\d+)/.exec(message.client_key);
          if (jm !== null) {
            const job = store.job(Number(jm[1]));
            if (job !== undefined) {
              memberId = job.member_id;
              triggerId = job.trigger_id;
            }
          }
        }
        if (!memberId && message.author_kind === 'role') {
          memberId = message.author;
          triggerId = message.from_turn ?? store.lastUserMessage(message.room_id, message.id)?.id;
        }
        if (!memberId || triggerId == null) {
          throw new CollabError('invalid', 'cannot determine member or trigger message for retry');
        }
        const trigger = store.message(triggerId);
        if (trigger === undefined) {
          throw new CollabError('invalid', 'trigger message not found');
        }
        const member = hub.members.get(memberId);
        if (member === undefined) {
          throw new CollabError('invalid', `member ${memberId} not found`);
        }
        if (member.online === false) {
          throw new CollabError('offline', `${member.name} 当前不在线，无法重试`);
        }
        hub.setError(memberId, undefined);
        hub.setThinking(message.room_id, memberId, true);
        const retried = dsh.retry(memberId, trigger) || gateway.retry(memberId, trigger);
        if (!retried) {
          hub.setThinking(message.room_id, memberId, false);
          throw new CollabError('failed', 'failed to dispatch retry');
        }
        // The card is settled once the retry is dispatched: the outcome arrives as the
        // member's reply or as a new error card with its own retry button. A transient
        // 'retrying' state here was never cleared, so the card stayed "retrying" forever.
        if (card && (card.state === 'failed' || card.action === 'configure-model')) {
          hub.edit(message.id, message.author_kind, message.author, message.text, JSON.stringify({ ...card, state: 'retried' }));
        }
        return { ok: true, member_id: memberId, trigger_id: triggerId };
      }, false);
    }
    if (path === '/collab/api/clis') return clisHandler(req, res);
    if (path === '/collab/api/models' && req.method === 'GET') return json(res, 200, { routes: await roster.models() });
    if (path === '/collab/api/rooms' && req.method === 'POST') {
      return withBody(req, res, (body) => {
        const name = String(body?.name ?? '').trim().replace(/^#/, '');
        if (!name || name.length > 32 || /\s/.test(name)) throw new CollabError('invalid', 'room name must be 1-32 characters without spaces');
        const room = store.createRoom(name);
        hub.emit({ type: 'rooms', rooms: store.roomsView() });
        return { room };
      });
    }
    if (path === '/collab/api/members' && req.method === 'POST') {
      return withBody(req, res, async body => ({ member: await roster.create(body) }));
    }
    const mm = /^\/collab\/api\/members\/([^/]+)$/.exec(path);
    if (mm !== null && req.method === 'PATCH') {
      return withBody(req, res, async body => ({ member: await roster.update(decodeURIComponent(mm[1]), body) }));
    }
    if (mm !== null && req.method === 'DELETE') {
      return withBody(req, res, () => { roster.remove(decodeURIComponent(mm[1])); return { ok: true }; }, false);
    }
    return json(res, 404, { error: 'not found' });
  }

  function events(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': connected\n\n');
    const unsubscribe = hub.subscribe(event => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    const end = () => { clearInterval(ping); unsubscribe(); streams.delete(end); res.end(); };
    streams.add(end);
    req.on('close', end);
  }
}

/**
 * #148: the owner edits or withdraws a message they wrote (callers check the
 * owner). An edit changes the text only; members that already read it are not
 * asked again. Withdrawing also stops the work it started: cloud-web bots get a
 * recall (their bridge stops that turn or drops it from its queue), DSH jobs end
 * and a DSH turn already running is cancelled.
 *   PATCH  /collab/api/messages/{id}  { text }
 *   DELETE /collab/api/messages/{id}  -> { recalled: [bot ids], stopped: [names], still_running: [names] }
 */
export function ownMessageRoute(req, res, path, { store, hub, gateway, dsh }) {
  const m = /^\/collab\/api\/messages\/(\d+)$/.exec(path);
  if (m === null) return undefined;
  const id = Number(m[1]);
  if (req.method === 'PATCH') {
    return withBody(req, res, (body) => {
      const row = store.editUser(id, OWNER, body?.text);
      if (row === undefined) throw new CollabError('forbidden', 'only your own plain messages can be edited');
      const message = publicMessage(row, store); // with the store, so a reply keeps its quote
      hub.emit({ type: 'message', message });
      return { message };
    });
  }
  if (req.method === 'DELETE') {
    return withBody(req, res, () => {
      const row = hub.remove(id, 'user', OWNER);
      if (row === undefined) throw new CollabError('forbidden', 'only your own messages can be withdrawn');
      const recalled = gateway.recall(row.id);
      const name = who => hub.members.get(who)?.name ?? who;
      const { stopped, running } = dsh.recall(row.id);
      return { ok: true, recalled, stopped: stopped.map(name), still_running: running.map(name) };
    }, false);
  }
  return undefined;
}

/**
 * #597 G26: a later ticket only opens workspaces (and later). Sent anywhere else, say where to go
 * instead of a bare 401, so a member does not give up; the route's own auth is unchanged.
 */
export const TICKET_WRONG_ROUTE = '这个接口不认 X-Later-Ticket 票据。建工作区请用 POST /collab/api/rooms/{id}/workspaces（同一个票据头，JSON: title, owner, reason），任务和十分钟看门会自动开，不用再调 /tasks。';
function refuse(req, res) {
  if (req.headers?.['x-later-ticket'] !== undefined) return json(res, 403, { error: TICKET_WRONG_ROUTE });
  return json(res, 401, { error: 'unauthorized' });
}

/**
 * #139 B task API, for the owner's browser and for cloud-web bots. The browser
 * always acts as the owner. Under the shared bot token a bot names itself in
 * body.actor, which is unverified (Tasks.perform: no owner, no review); a bot
 * acts as itself verified with a `task` frame on its cloud-web socket.
 *   GET  /collab/api/rooms/{id}/tasks           board of the room's chat channel and its workspaces
 *   POST /collab/api/rooms/{id}/tasks           { title, owner, ref, base?, parent_task?, message_id?, reason?, force? } dispatch
 *     (ref: file:line or 无（新建）; base required when the title says 共改文件/多人改)
 *   GET  /collab/api/tasks/{id}
 *   POST /collab/api/tasks/{id}/stance          { stance: 接|问|退|升, note? }  (task owner)
 *   POST /collab/api/tasks/{id}/return          { message_id }                  (task owner)
 *   POST /collab/api/tasks/{id}/review          { verdict: done|rework, note } (the dispatcher; note required for rework)
 * Returns undefined when the request is not for this route, else a Promise of the reply.
 */
export function tasksRoute(req, res, url, { tasks, gateway, owner }) {
  const path = url.pathname.replace(/\/+$/, '');
  const board = /^\/collab\/api\/rooms\/(\d+)\/tasks$/.exec(path);
  const one = /^\/collab\/api\/tasks\/(\d+)(?:\/(stance|return|review))?$/.exec(path);
  if (board === null && one === null) return undefined;
  const human = owner(req);
  if (!human && !gateway.authorized(req, url)) return Promise.resolve(refuse(req, res));
  // The browser is the owner; the shared bot token says nothing about which bot, so body.actor is unverified.
  const sender = body => (human ? { actor: OWNER, verified: true } : { actor: body?.actor, verified: false });
  const id = Number((board ?? one)[1]);
  if (req.method === 'GET' && board !== null) return withBody(req, res, () => ({ tasks: tasks.list(id), chat_id: tasks.chatOf(id) }), false);
  if (req.method === 'GET' && one !== null && one[2] === undefined) {
    return withBody(req, res, () => {
      const t = tasks.task(id);
      if (t === undefined) throw new CollabError('task-missing', `task ${id} does not exist`);
      return { task: tasks.view(t) };
    }, false);
  }
  if (req.method !== 'POST') return Promise.resolve(json(res, 404, { error: 'not found' }));
  if (board !== null) return withBody(req, res, body => ({ task: tasks.perform('assign', { roomId: id, body }, sender(body)) }));
  return withBody(req, res, body => ({ task: tasks.perform(one[2], { id, body }, sender(body)) }));
}

/**
 * POST /collab/api/rooms/{id}/workspaces: the owner or any cc-connect bot (shared bot
 * token; collab has no per-room membership, so every connected bot is in every room)
 * opens the next 工作区<n+1> under that chat channel. Anyone else gets 401.
 * Returns undefined when the request is not for this route, else a Promise of the reply.
 */
export function workspacesRoute(req, res, url, { store, hub, gateway, owner, later, tasks, dsh }) {
  const m = /^\/collab\/api\/rooms\/(\d+)\/workspaces\/?$/.exec(url.pathname);
  if (m === null || req.method !== 'POST') return undefined;
  if (!owner(req) && !gateway.authorized(req, url)) {
    if (req.headers['x-later-ticket'] === undefined || !later || !tasks) return Promise.resolve(json(res, 401, { error: 'unauthorized' }));
    return ticketWorkspace(req, res, Number(m[1]), { store, hub, gateway, later, tasks, dsh });
  }
  return withBody(req, res, () => {
    const workspace = store.createWorkspace(Number(m[1]));
    hub.emit({ type: 'rooms', rooms: store.roomsView() });
    return { workspace };
  }, false);
}

/**
 * #597 G24: a DSH member's (member, room) later ticket opens a workspace and hands the job over in
 * one step. Only the primary role at request time may do it (tickets never expire, so a ticket of a
 * former primary is refused here). The task is opened directly (owner defaults to the primary itself),
 * the handoff line is a system message (no chat parsing, so an earlier @ dispatch is not opened twice)
 * and the owner is woken explicitly. A ticket pasted into the channel is useless to anyone but the
 * primary. An open chat-side task of the same owner from the primary is handed over and closed.
 */
function ticketWorkspace(req, res, roomId, { store, hub, gateway, later, tasks, dsh }) {
  const claims = later.verify(req.headers['x-later-ticket']);
  if (!claims) return Promise.resolve(json(res, 401, { error: 'unauthorized' }));
  if (claims.room !== roomId) return Promise.resolve(json(res, 403, { error: 'ticket is for another room' }));
  if (hub.selectedPrimaryMember()?.id !== claims.member) return Promise.resolve(json(res, 403, { error: 'only the primary role opens workspaces' }));
  return withBody(req, res, body => {
    const lead = claims.member;
    const taskOwner = body?.owner === undefined || body.owner === '' ? lead : String(body.owner);
    if (!hub.routable().some(r => r.id === taskOwner)) throw new CollabError('member-missing', 'unknown owner');
    const title = String(body?.title ?? '').trim();
    if (!title) throw new CollabError('invalid', 'workspace handoff requires a title');
    if (store.room(roomId) === undefined) throw new CollabError('room-missing', `room ${roomId} does not exist`);
    const workspace = store.createWorkspace(roomId);
    hub.emit({ type: 'rooms', rooms: store.roomsView() });
    const name = hub.members.get(taskOwner)?.name ?? taskOwner;
    const reason = typeof body?.reason === 'string' ? body.reason : undefined;
    const { message } = hub.post(workspace.id, { authorKind: 'system', author: 'system', name: '交接',
      text: `【交接】${name}：${title}${reason ? `\n${reason}` : ''}` });
    const task = tasks.assign({ roomId: workspace.id, owner: taskOwner, actor: lead, title, reason, messageId: message.id, force: true });
    tasks.q.setSource.run('workspace', task.id);
    const chat = workspace.parent_id ?? roomId;
    const open = tasks.q.openChat.get(chat, taskOwner, lead, ...WORKING);
    if (open !== undefined) {
      tasks.handBack(open.id, { actor: open.owner, messageId: message.id });
      tasks.review(open.id, { actor: lead, verdict: 'done', note: `转到${workspace.name} #${task.id}` });
    }
    if (!dsh?.nudge(taskOwner, message)) gateway.nudge?.(taskOwner, message);
    return { workspace, task: tasks.task(task.id) };
  });
}

const ERROR_STATUS = { 'room-missing': 404, 'member-missing': 404, 'task-missing': 404, conflict: 409, 'read-only': 403, forbidden: 403, offline: 503, 'member-busy': 409 };

/** Parse a JSON body (unless `parse` is false), run fn, and map CollabError codes to HTTP statuses. */
class BodyTooLarge extends Error {}

// cc-connect send accepts attachments up to 50 MiB by default (DefaultMaxAttachmentSize in
// bridge/core/api.go). Bot frames carry them base64-encoded (x4/3) plus JSON fields; 1 MiB of
// headroom covers those. A smaller cap makes ws close the bot with 1009 after the sender
// already reported success.
const MAX_BOT_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const BOT_WS_MAX_PAYLOAD = Math.ceil(MAX_BOT_ATTACHMENT_BYTES / 3) * 4 + 1024 * 1024;

/** Parses a single `bytes=` range against size: undefined = serve whole body, null = unsatisfiable. */
export function parseRange(header, size) {
  if (typeof header !== 'string') return undefined;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/.exec(header);
  if (m === null || (m[1] === '' && m[2] === '')) return undefined;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0 || size === 0) return null;
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  if (m[2] !== '' && Number(m[2]) < start) return undefined;
  if (start >= size) return null;
  return { start, end: m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1) };
}

/** Serves a stored attachment; honours single byte ranges so iOS Safari can play audio. */
export function sendAttachment(req, res, row, bytes) {
  const headers = { 'content-type': row.mime, 'accept-ranges': 'bytes',
    'content-disposition': `${INLINE_IMAGE.test(row.mime) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=86400' };
  const range = parseRange(req.headers?.range, bytes.length);
  if (range === null) {
    res.writeHead(416, { ...headers, 'content-range': `bytes */${bytes.length}`, 'content-length': 0 });
    return res.end();
  }
  if (range === undefined) {
    res.writeHead(200, { ...headers, 'content-length': bytes.length });
    return res.end(bytes);
  }
  const part = bytes.subarray(range.start, range.end + 1);
  res.writeHead(206, { ...headers, 'content-length': part.length,
    'content-range': `bytes ${range.start}-${range.end}/${bytes.length}` });
  return res.end(part);
}

export async function withBody(req, res, fn, parse = true, limit = MAX_BODY) {
  let body;
  if (parse) {
    let raw;
    try { raw = await readBody(req, limit); } catch (error) {
      if (!(error instanceof BodyTooLarge)) return json(res, 400, { error: 'request body aborted' });
      res.setHeader('connection', 'close');
      return json(res, 413, { error: `request body exceeds ${limit / 1024 / 1024} MiB`, code: 'too-large' });
    }
    try { body = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'invalid JSON body' }); }
  }
  try {
    return json(res, 200, await fn(body));
  } catch (error) {
    if (error instanceof CollabError) return json(res, ERROR_STATUS[error.code] ?? 400, { error: error.message, code: error.code });
    throw error;
  }
}

/** Loopback origin of the server that accepted req, for the local later command. */
function localOrigin(req) {
  const port = req.socket?.localPort;
  return Number.isInteger(port) ? `http://127.0.0.1:${port}` : undefined;
}
function json(res, status, value) { text(res, status, 'application/json; charset=utf-8', JSON.stringify(value)); }

function text(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    // Past the limit, keep reading but drop the bytes: destroying the socket here
    // makes the browser see a network error ("Failed to fetch") instead of the 413.
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { chunks.length = 0; return; }
      chunks.push(chunk);
    });
    req.on('end', () => (size > limit ? reject(new BodyTooLarge()) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

/** Authenticated one-shot scheduling for local and external channel members. */
export function laterRoute(req, res, url, { hub, gateway, owner, later }) {
  const path = url.pathname.replace(/\/+$/, '');
  const laterMatch = /^\/collab\/api\/rooms\/(\d+)\/later$/.exec(path);
  if (laterMatch && req.method === 'POST') {
    // Only a (member, room) ticket from later.instructions() registers; owner and the shared bot token do not.
    const claims = later.verify(req.headers['x-later-ticket']);
    if (!claims) return json(res, 401, { error: 'unauthorized' });
    if (claims.room !== Number(laterMatch[1])) return json(res, 403, { error: 'ticket is for another room' });
    return withBody(req, res, body => {
      if (body?.member !== undefined && body.member !== claims.member) throw new CollabError('forbidden', 'ticket is for another member');
      if (body?.room !== undefined && Number(body.room) !== claims.room) throw new CollabError('forbidden', 'ticket is for another room');
      if (!hub.routable().some(m => m.id === claims.member)) throw new CollabError('member-missing', 'unknown member');
      const reminder = registerLater(hub.store.db, { ...body, member: claims.member, room: claims.room });
      later.tick();
      return { reminder };
    });
  }
  return undefined;
}
