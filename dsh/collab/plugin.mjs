// CoNest collab: Discord-style channels inside a DSH Web host. Load it by
// absolute path from a --patch overlay (see dsh/README.md):
//   - insert:
//       - id: conest-collab
//         name: /abs/path/dsh/collab/plugin.mjs
//         config: { dataDir, workspacePath, leadFile?, fallbackLead?, botTokenEnv?, botPort?, ownerName?, rooms?, dshMembers?, maxRelay?, boardDir?, teamStatusDir?, wikiDir?, bridgeConfig? }
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { Store, CollabError, MAX_TEXT, publicMessage } from './store.mjs';
import { LOCK_FILE, acquireLockWithOwner, clearLockOwner } from './instance-lock.mjs';
import { localConnection, isLocalOwner, mountSharedHost, refuse } from './local-host.mjs';
import { startBotPort } from './bot-port.mjs';
import { Hub } from './hub.mjs';
import { CloudWebGateway, WS_PATH, roomKey } from './cloudweb.mjs';
import { Bridge, botToken } from './bridge.mjs';
import { Roster, rowToMember } from './roster.mjs';
import { managementMembers, managementCreate, managementUpdate, managementDelete, managementOptions } from './member-management.mjs';
import { avatarImage, checkAvatar } from './avatars.mjs';
import { AvatarUploads } from './avatar-uploads.mjs';
import { handler as clisHandler } from './clis.mjs';
import { LeadState } from './lead-state.mjs';
import { Attachments, DEFAULT_MAX_UPLOAD_BYTES, INLINE_IMAGE, MAX_BOT_ATTACHMENT_BYTES, formatBytes } from './attachments.mjs';
import { DeskEvents, DESK_NAMES_FILE, deskRoute } from './desk.mjs';
import { wikiGalaxyRoute } from './wiki-galaxy.mjs';
import { defaultBridgeConfig, panelRoute } from './panel.mjs';
import { TeamStatus } from './team-status.mjs';
import { ALIVE_EVERY_MS, PairClient, PairHost, PairListener, PAIR_PORT, REMOTE_OWNER, hostHandler, isLoopback, pairApiRoute, remoteProxyRoute, tailnetAddress } from './pairing.mjs';
import { homedir, hostname } from 'node:os';
import { migratePageRows } from './pages-migrate.mjs';

export const name = 'conest-collab';
export const inject = [
  'attachments', 'webServer', 'connection', 'llm', 'agents', 'agentDefaultModel', 'agentPresets', 'permissionPresets', 'sessionTitle', 'workspaceRegistry',
  'sessionPersistence',
];

const PAGE = readFileSync(new URL('./page.html', import.meta.url), 'utf8');
// #131: 「其他电脑」page — pair this DSH with another one by a one-time number.
const DEVICES_PAGE = readFileSync(new URL('./devices.html', import.meta.url), 'utf8');
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
  for (const room of rooms) {
    if (room.workspacePath != null && room.workspacePath !== '' && (typeof room.workspacePath !== 'string' || !isAbsolute(room.workspacePath))) {
      throw Error('conest-collab: rooms[].workspacePath must be an absolute path or empty');
    }
  }
  const members = c.dshMembers ?? [];
  const ids = new Set();
  for (const m of members) {
    if (typeof m?.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(m.id) || ['user', 'system', OWNER].includes(m.id) || ids.has(m.id)) {
      throw Error(`conest-collab: dshMembers id ${JSON.stringify(m?.id)} must be unique lowercase [a-z0-9_-]`);
    }
    if (typeof m.name !== 'string' || !m.name.trim()) throw Error(`conest-collab: dshMembers ${m.id} needs a name`);
    if (m.model !== undefined && (m.cli === 'claude' ? typeof m.model !== 'string' || !m.model.trim()
      : typeof m.model?.provider !== 'string' || typeof m.model?.model !== 'string')) {
      throw Error(`conest-collab: dshMembers ${m.id} model must be ${m.cli === 'claude' ? 'a non-empty model id' : '{ provider, model }'}`);
    }
    if (m.rooms !== undefined && (!Array.isArray(m.rooms) || m.rooms.some(id => !rooms.some(r => r.id === id)))) {
      throw Error(`conest-collab: dshMembers ${m.id} rooms must contain configured chat channel ids`);
    }
    if (m.persona !== undefined && typeof m.persona !== 'string') throw Error(`conest-collab: dshMembers ${m.id} persona must be text`);
    try { checkAvatar(m.avatar); } catch (error) { throw Error(`conest-collab: dshMembers ${m.id} ${error.message}`); }
    ids.add(m.id);
  }
  const maxRelay = c.maxRelay ?? 6;
  if (!Number.isSafeInteger(maxRelay) || maxRelay < 0) throw Error('conest-collab: maxRelay must be a non-negative integer');
  // #197: the cap of one streamed channel upload, in bytes. The overlay's maxUploadBytes
  // (README) wins so a slower machine or a small disk can lower it; otherwise the
  // measured default in attachments.mjs applies (#228's 8 MiB only fit a ~6 MB file).
  const maxUploadBytes = c.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0) throw Error('conest-collab: maxUploadBytes must be a positive integer');
  const botTokenEnv = c.botTokenEnv ?? 'CONEST_COLLAB_BOT_TOKEN';
  const botToken = env[botTokenEnv] ?? '';
  // #142 桌面版宿主端口每次随机：给一个固定端口另开 bot 接入（bot-port.mjs）。配置或 CONEST_COLLAB_BOT_PORT，都没给就不开。
  const botPortRaw = c.botPort ?? (String(env.CONEST_COLLAB_BOT_PORT ?? '').trim() || undefined);
  const botPort = botPortRaw === undefined ? undefined : Number(botPortRaw);
  if (botPort !== undefined && !(Number.isSafeInteger(botPort) && botPort > 0 && botPort < 65536)) throw Error('conest-collab: botPort must be a TCP port number');
  const leadFile = c.leadFile ?? join(env.BOTHOUSE_DATA_DIR ?? join(env.HOME || homedir(), '.bothouse'), 'lead.json');
  if (!isAbsolute(leadFile)) throw Error('conest-collab: leadFile must be an absolute path');
  const fallbackLead = String(c.fallbackLead ?? env.CONEST_FALLBACK_LEAD ?? '').trim();
  // #876: board events sit next to board.jsonl; BOARD_DIR is the same switch gate/board.py reads,
  // and an explicit config value wins so tests never point at the live board.
  const boardDir = String(c.boardDir ?? env.BOARD_DIR ?? '').trim() || undefined;
  if (boardDir !== undefined && !isAbsolute(boardDir)) throw Error('conest-collab: boardDir must be an absolute path');
  // #876 K: busy/idle and board events share one team directory; an explicit value or
  // CONEST_TEAM_STATUS_DIR wins, and boardDir is the fallback so one setting covers both.
  const teamStatusRaw = c.teamStatusDir ?? (String(env.CONEST_TEAM_STATUS_DIR ?? '').trim() || boardDir);
  const teamStatusDir = teamStatusRaw == null ? undefined : String(teamStatusRaw).trim() || undefined;
  if (teamStatusDir !== undefined && !isAbsolute(teamStatusDir)) throw Error('conest-collab: teamStatusDir must be an absolute path');
  // Wiki 星河读的 wiki 目录：配置或 CONEST_WIKI_DIR，都没给就是 ~/wiki（只读）。
  const wikiDir = String(c.wikiDir ?? env.CONEST_WIKI_DIR ?? '').trim() || join(env.HOME || homedir(), 'wiki');
  if (wikiDir !== undefined && !isAbsolute(wikiDir)) throw Error('conest-collab: wikiDir must be an absolute path');
  // #105 侧栏「bothouse」：读这份主桥配置的 [management] 段，在服务端转发管理面板（令牌不进浏览器）。
  const bridgeConfig = String(c.bridgeConfig ?? '').trim() || defaultBridgeConfig(env);
  if (!isAbsolute(bridgeConfig)) throw Error('conest-collab: bridgeConfig must be an absolute path');
  return { dataDir: c.dataDir, workspacePath: c.workspacePath, leadFile, fallbackLead, boardDir, teamStatusDir, wikiDir, bridgeConfig, rooms, dshMembers: members, maxRelay, maxUploadBytes, botTokenEnv, botToken, botPort, ownerName: c.ownerName ?? '我' };
}

export async function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  // ws is declared by this package and resolved from this file, so the server never borrows a
  // transitive copy from the surrounding DSH runtime. It is CommonJS; its WebSocketServer is
  // not a statically detectable named export.
  const { WebSocketServer } = createRequire(import.meta.url)('ws');
  if (typeof WebSocketServer !== 'function') throw Error('conest-collab: unsupported DSH runtime');

  // #1019: a second DSH on the same data directory refuses to start the plugin instead of
  // sharing collab.sqlite3 (the panel's 「打开 DSH」 used to start one beside a running host).
  const lockPath = join(config.dataDir, LOCK_FILE);
  // #216: the holder records who it is, so a second DSH can repeat the truth instead of
  // telling the user to go and configure a service that is in fact running.
  // #227: taking the lock and writing that record are one step: if the record cannot be
  // written the lock is released before the error travels on. This DSH stays alive with the
  // plugin stopped, and a lock nobody releases would shut the data directory to every later
  // DSH while its page says "another DSH is using it".
  const local = localConnection(ctx.webServer);
  const lock = acquireLockWithOwner(lockPath, { pid: process.pid, startedAt: Date.now(), dataDir: config.dataDir, host: hostname(), local });
  if (lock === undefined) {
    // #216: this instance is a client of the holder, not a second data writer. Keep scoped
    // routes alive rather than throwing out of apply; unloading the plugin removes them.
    // #227: the two routes live in local-host.mjs so this branch can be tested without the
    // DSH runtime (审稿 F2: nothing ever called it in a test).
    mountSharedHost(ctx, lockPath);
    ctx.logger.info('conest-collab: using the existing channel host for %s', config.dataDir);
    return;
  }
  // Teardown is registered before anything is opened, so a startup that fails half-way still
  // stops whatever it started; the lock is released last, after the store and the background
  // writers are closed, so no second host gets in while this one can still write.
  const r = {};
  ctx.effect(() => async () => {
    r.teamStatus?.stop();
    r.desk?.stop();
    r.bridge?.close();
    r.gateway?.closeAll();
    clearInterval(r.pairSweep);
    clearInterval(r.aliveSweep);
    await r.pairListener?.close();
    for (const end of r.streams ?? []) end();
    r.wss?.close();
    r.store?.close();
    lock.release();
    // #216: the record goes with the lock, so a DSH that opens later is not told about a
    // holder that already quit.
    clearLockOwner(lockPath);
  }, 'conest-collab: teardown');

  // #1044: an install from before had the desk, panel and other-computers pages; checked before Store creates the file.
  const collabExisted = existsSync(join(config.dataDir, 'collab.sqlite3'));
  // #445: the instance maxRelay stays the default for channels that never set their own cap.
  const store = r.store = new Store(join(config.dataDir, 'collab.sqlite3'), { maxRelay: config.maxRelay });
  for (const room of config.rooms) {
    store.ensureRoom(room.id, store.room(room.id)?.name ?? room.name.trim(), room.workspacePath);
    store.ensureRoomSettings(room.id);
  }
  store.migrateMemberRooms();
  const leadState = new LeadState(config.leadFile, ctx.logger);
  const hub = new Hub(store, ctx.logger, leadState, config.fallbackLead);
  hub.workspacePath = config.workspacePath;
  hub.setMember({ id: OWNER, name: config.ownerName, kind: 'human', online: true });
  const files = new Attachments(join(config.dataDir, 'attachments'));
  // #1662: every member is a bothouse role dialling in here, so the gateway is always on.
  const token = botToken(config.botToken, config.dataDir);
  const gateway = r.gateway = new CloudWebGateway(hub, { token, logger: ctx.logger, files });
  const bridge = r.bridge = new Bridge({ dataDir: config.dataDir, token, logger: ctx.logger,
    origin: () => ctx.webServer.getOrigin(), members: () => store.members().map(rowToMember), lead: () => leadState.selected() });
  // #1797: someone called a member whose role is not connected: apply again (starts a stopped bridge, picks up
  // a key saved since) and say in the channel what is missing; the card's 重试 sends the message again.
  gateway.onOfflineMember = (m, msg) => {
    bridge.sync();
    const text = bridge.noKey
      ? `${m.name} 还没法回话：还没填模型密钥。点「去填密钥」（或 设置 → 模型）填 DeepSeek API Key，保存后点「重试」。`
      : `${m.name} 现在不在线：后台服务没在运行，正在重新启动。十几秒后点「重试」。`;
    hub.post(msg.room_id, { authorKind: 'system', author: 'system', name: '系统', text,
      card: JSON.stringify({ title: '成员出错', state: 'failed', ...(bridge.noKey ? { action: 'configure-model' } : {}), member_id: m.id, trigger_id: msg.id }) });
  };
  const avatarUploads = new AvatarUploads(join(config.dataDir, 'avatars'));
  // A stored member (kind 'dsh': defined in this channel host) is shown at once, offline until its bothouse
  // role connects, and handed to the bridge.
  const members = {
    putMember: (m) => { const edited = hub.members.has(m.id); hub.setMember({ ...m, kind: 'dsh', online: gateway.bots.has(m.id) }); bridge.sync(undefined, edited); },
    dropMember: (id) => { hub.removeMember(id); bridge.sync(id); },
    // #321: an external chat bot is a member of the channel only; no bothouse role stands behind it, so the bridge is not told.
    putExternal: (m) => hub.setMember({ ...m, online: gateway.bots.has(m.id) }),
    dropConnection: (id) => gateway.disconnect(id, 'credential replaced'),
    dropExternal: (id) => { gateway.disconnect(id, 'member removed'); hub.removeMember(id); },
  };
  const roster = new Roster(hub, members, ctx.llm, avatarUploads);
  roster.load(config.dshMembers);
  const wizard = await roster.importWizard(join(config.dataDir, 'wizard-members.json'), ctx.logger);
  if (wizard.length) ctx.logger.info('conest-collab: added wizard members %s', wizard.join(', '));
  bridge.sync();
  // Same catalog the add-member picker shows (GET /collab/api/personas defaults to zh): the bridge's, so on
  // a machine without bothouse this waits for the install — in the background, the channels open meanwhile.
  roster.seedDefaults(join(config.dataDir, 'default-members.json'), () => bridge.personas('zh'), ctx.logger)
    .then(seeded => { if (seeded.length) ctx.logger.info('conest-collab: added default members %s', seeded.join(', ')); })
    .catch(error => ctx.logger.warn('conest-collab: default members not added: %s', error?.message ?? error));
  // #876: only the plugin's own tail touches board-events.jsonl; board.py writes it.
  const desk = r.desk = new DeskEvents(hub, { boardDir: config.boardDir, logger: ctx.logger });
  desk.start();
  // #876 K: read-only busy/idle from the shared team directory; no bridge change.
  const teamStatus = r.teamStatus = config.teamStatusDir === undefined ? undefined : new TeamStatus(hub, config.teamStatusDir, { logger: ctx.logger });
  teamStatus?.start();

  // #131: a request the tailnet pairing listener authenticated with a device credential acts as
  // the owner; everything else still needs this DSH's own sign-in.
  const owner = req => req[REMOTE_OWNER] === true || isLocalOwner(req, local) || ctx.connection.requestRejection(req) === undefined;
  // Test-only overrides (same-machine two-instance check): address and port of the pairing listener.
  const pairAddr = String(process.env.CONEST_COLLAB_PAIR_ADDR ?? '').trim();
  const pairPort = Number(process.env.CONEST_COLLAB_PAIR_PORT) || PAIR_PORT;
  const pairHost = new PairHost({ file: join(config.dataDir, 'pair-devices.json') });
  const pairClient = new PairClient({ file: join(config.dataDir, 'pair-links.json'), port: pairPort });
  const pairListener = r.pairListener = new PairListener({
    host: pairHost, port: pairPort, logger: ctx.logger,
    address: pairAddr === '' ? () => tailnetAddress() : async () => pairAddr,
    handler: hostHandler({ host: pairHost, name: hostname(), route: (req, res) => browserRoute(req, res), allowLoopback: isLoopback(pairAddr) }),
  });
  if (pairHost.list().length > 0) pairListener.ensure().catch(err => ctx.logger.warn('conest-collab: pairing listener: %s', err.message));
  // 来源：码有效期按分钟计（pairing.mjs CODE_TTL_MS），每分钟收一次没人用的配对监听。
  const pairSweep = r.pairSweep = setInterval(() => { pairListener.settle().catch(() => {}); }, 60_000);
  pairSweep.unref?.();
  // 「直到我断开」: drop links whose DSH window stopped beating (same cadence as the beat).
  const aliveSweep = r.aliveSweep = setInterval(() => { pairClient.sweep().catch(() => {}); }, ALIVE_EVERY_MS);
  aliveSweep.unref?.();
  const wss = r.wss = new WebSocketServer({ noServer: true, maxPayload: BOT_WS_MAX_PAYLOAD });
  const streams = r.streams = new Set();

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/collab', handler: (req, res) => browserRoute(req, res) }), 'conest-collab: /collab');
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/api/rooms', handler: (req, res) => historyRoute(req, res) }), 'conest-collab: /api/rooms');
  // #1044: keep the pages an existing install had (once). Deferred: the plugin manager reloads rows,
  // which must not run inside this plugin's own activation.
  const pagesTimer = setTimeout(() => {
    migratePageRows(ctx.get('pluginManager'), { markerFile: join(config.dataDir, 'pages-migrated-1044'), beforeFile: join(config.dataDir, 'pages-before-1044.json'), existed: collabExisted, logger: ctx.logger })
      .catch(err => ctx.logger.warn('conest-collab: keep pages: %s', err.message));
  }, 3000);
  ctx.effect(() => () => clearTimeout(pagesTimer), 'conest-collab: keep pages');
  const botUpgrade = (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://collab.invalid');
    const auth = gateway.authorize(req, url);
    if (auth === undefined) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => gateway.accept(ws, url, auth));
  };
  ctx.effect(() => ctx.webServer.registerUpgrade({ path: WS_PATH, handler: botUpgrade }), 'conest-collab: cloud-web upgrade');
  if (config.botPort !== undefined) {
    const listening = startBotPort({ port: config.botPort, path: WS_PATH, upgrade: botUpgrade, history: (req, res) => historyRoute(req, res), logger: ctx.logger })
      .then(l => { ctx.logger.info('conest-collab: bot port 127.0.0.1:%d', l.port); return l; },
        err => { ctx.logger.warn('conest-collab: bot port %d not opened: %s', config.botPort, err.message); return undefined; });
    ctx.effect(() => async () => { (await listening)?.close(); }, 'conest-collab: bot port');
  }

  ctx.logger.info('conest-collab: %d room(s), %d member(s)', config.rooms.length, store.members().length);

  /** cc-connect ChannelHistory: GET /api/rooms/{id}/messages?before=&limit= (bot token or owner). */
  function historyRoute(req, res) {
    const url = new URL(req.url ?? '/', 'http://collab.invalid');
    const m = /^\/api\/rooms\/(\d+)\/messages$/.exec(url.pathname);
    if (req.method !== 'GET' || m === null) return json(res, 404, { error: 'not found' });
    const auth = gateway.authorize(req, url);
    if (auth === undefined && !owner(req)) return json(res, 401, { error: 'unauthorized' });
    if (store.room(Number(m[1])) === undefined) return json(res, 404, { error: 'room not found' });
    // #321: an external member reads only its own channel.
    if (auth?.member !== undefined && !JSON.parse(auth.member.rooms).includes(store.settingsRoom(Number(m[1])))) return json(res, 404, { error: 'room not found' });
    const before = url.searchParams.get('before');
    const rows = store.page(Number(m[1]), before === null ? undefined : Number(before), url.searchParams.get('limit'));
    return json(res, 200, { messages: rows.map(r => publicMessage(r, store)) });
  }

  async function browserRoute(req, res) {
    const url = new URL(req.url ?? '/', 'http://collab.invalid');
    const path = url.pathname.replace(/\/+$/, '');
    if (!owner(req)) {
      if ((path === '/collab' || path === '/collab/desk' || path === '/collab/wiki-galaxy') && req.method === 'GET') return text(res, 401, 'text/plain; charset=utf-8', '请先在同一个浏览器打开 DSH 网页登录，再回到 /collab。');
      return refuse(req, res);
    }
    // #876 P: 回放里的 @ 用 hub 的成员表解析（routable = 真实角色，不含主人）。
    const deskHandled = deskRoute(req, res, url, { store, boardDir: config.boardDir, members: hub.routable(), namesFile: join(config.dataDir, DESK_NAMES_FILE) });
    if (deskHandled !== undefined) return deskHandled;
    const galaxyHandled = wikiGalaxyRoute(req, res, url, { wikiDir: config.wikiDir });
    if (galaxyHandled !== undefined) return galaxyHandled;
    const panelHandled = panelRoute(req, res, url, { bridgeConfig: config.bridgeConfig });
    if (panelHandled !== undefined) return panelHandled;
    // #131: pairing (this machine lets others in) and remote links (this machine drives others).
    if (!req[REMOTE_OWNER]) {
      if (path === '/collab/devices' && req.method === 'GET') return text(res, 200, 'text/html; charset=utf-8', DEVICES_PAGE);
      const paired = pairApiRoute(req, res, url, { host: pairHost, client: pairClient, listener: pairListener });
      if (paired !== undefined) return paired;
      const remote = remoteProxyRoute(req, res, url, { client: pairClient });
      if (remote !== undefined) return remote;
    }
    if (path === '/collab' && req.method === 'GET') return text(res, 200, 'text/html; charset=utf-8', PAGE);
    if (path === '/collab/api/personas' && req.method === 'GET') return r.bridge.personas(url.searchParams.get('lang') ?? 'zh').then(list => json(res, 200, list));
    if (path === '/collab/api/state' && req.method === 'GET') {
      return json(res, 200, { me: OWNER, lead_id: hub.selectedPrimaryMember()?.id ?? null,
        effective_lead_id: hub.primaryMember()?.id ?? null,
        rooms: store.roomsView().map(r => ({ ...r, lead_id: store.leadId(r.id), effective_lead_id: hub.defaultReplyIn(r.id)?.id ?? null,
          workspace_path: store.workspacePath(r.id, config.workspacePath) })), members: hub.memberView(),
        thinking: Object.fromEntries([...hub.thinking].map(([k, v]) => [k, [...v]])),
        queued: Object.fromEntries([...hub.queued.keys()].map(r => [r, hub.queueView(r)])),
        max_upload_bytes: config.maxUploadBytes,
        // #1445: the text cap in the unit the store compares (characters), so the panel checks a
        // typed message against the same number instead of keeping a second copy of it.
        max_text_chars: MAX_TEXT });
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
        bridge.sync();
        hub.emit({ type: 'lead', lead_id: id, effective_lead_id: hub.primaryMember()?.id ?? null });
        return { lead_id: id, effective_lead_id: hub.primaryMember()?.id ?? null };
      });
    }
    // #197: one attachment streams straight to disk instead of riding base64 in the
    // message JSON, so its cap no longer comes from MAX_MESSAGE_BODY. The bytes are
    // the raw request body; the name and type travel in the query string because a
    // header can not carry 中文. The browser posts the message with the returned
    // metadata once every file of that message has arrived.
    const streamed = streamUploadRoute(req, res, url, { files, maxBytes: config.maxUploadBytes });
    if (streamed !== undefined) return streamed;
    const att = /^\/collab\/api\/attachments\/([0-9a-f-]{36})$/.exec(path);
    if (att !== null && req.method === 'GET') {
      const row = store.attachmentMeta(att[1]);
      const bytes = row === undefined ? undefined : files.read(att[1]);
      if (bytes === undefined) return json(res, 404, { error: 'attachment not found' });
      return sendAttachment(req, res, row, bytes);
    }
    const uploaded = /^\/collab\/avatars\/uploads\/([a-z0-9-]+\.png)$/.exec(path);
    if (uploaded !== null && req.method === 'GET') {
      const png = avatarUploads.read(uploaded[1]);
      if (png === undefined) return json(res, 404, { error: 'avatar not found' });
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      return res.end(png);
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
    const settings = roomSettingsRoute(req, res, path, { store, hub, gateway, workspacePath: config.workspacePath });
    if (settings !== undefined) return settings;
    const renamed = renameRoomRoute(req, res, path, { store, hub });
    if (renamed !== undefined) return renamed;
    const deleted = deleteWorkspaceRoute(req, res, path, { store, bridge: r.bridge });
    if (deleted !== undefined) return deleted;
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
        // #197: ids from the streamed upload endpoint, or base64 from an older client/bot.
        const attachments = files.receive(body?.attachments);
        const { message } = hub.post(roomId, { authorKind: 'user', author: OWNER, name: config.ownerName, text: String(body?.text ?? ''), clientKey,
          replyTo: Number.isInteger(body?.reply_to) ? body.reply_to : undefined, attachments });
        return { message: publicMessage(message, store) };
      }, true, MAX_MESSAGE_BODY);
    }
    const edited = ownMessageRoute(req, res, path, { store, hub, gateway });
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
        const retried = gateway.retry(memberId, trigger);
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
    if (path === '/collab/api/panel/members' && req.method === 'GET') return json(res, 200, { members: managementMembers(roster, hub) });
    if (path === '/collab/api/panel/members' && req.method === 'POST') return withBody(req, res, async body => ({ member: await managementCreate(roster, body, b => managementOptions(roster, b, config.workspacePath)) }));
    const panelMember = /^\/collab\/api\/panel\/members\/([^/]+)$/.exec(path);
    if (panelMember && req.method === 'PATCH') return withBody(req, res, async body => ({ member: await managementUpdate(roster, decodeURIComponent(panelMember[1]), body, b => managementOptions(roster, b, config.workspacePath)) }));
    if (panelMember && req.method === 'DELETE') return withBody(req, res, () => { const id = decodeURIComponent(panelMember[1]); managementDelete(roster, id); hub.emit({ type: 'rooms', rooms: store.roomsView() }); return { id }; }, false);
    if (path === '/collab/api/panel/cli-options' && req.method === 'POST') return withBody(req, res, body => managementOptions(roster, body, config.workspacePath));
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
    // #1023: open (or reopen) the private chat with one agent member.
    if (path === '/collab/api/dms' && req.method === 'POST') {
      return withBody(req, res, (body) => {
        const id = String(body?.member ?? '');
        const member = hub.members.get(id);
        if (member === undefined || member.kind === 'human') throw new CollabError('invalid', 'member must be an agent in this channel list');
        const room = store.openDm(id, member.name);
        hub.emit({ type: 'rooms', rooms: store.roomsView() });
        return { room };
      });
    }
    // #155: close a private chat (hidden from the list, history kept; opening it again restores it).
    const dmm = /^\/collab\/api\/dms\/(\d+)$/.exec(path);
    if (dmm !== null && req.method === 'DELETE') {
      return withBody(req, res, () => {
        store.closeDm(Number(dmm[1]));
        hub.emit({ type: 'rooms', rooms: store.roomsView() });
        return { ok: true };
      }, false);
    }
    if (path === '/collab/api/members' && req.method === 'POST') {
      // #321: { type: 'external', name, rooms: [channel id], mentionId? } adds an external chat bot and answers { member, credential }.
      return withBody(req, res, async body => (body?.type === 'external' ? roster.createExternal(body) : { member: await roster.create(body) }));
    }
    const credentialOf = /^\/collab\/api\/members\/([^/]+)\/credential$/.exec(path);
    if (credentialOf !== null && req.method === 'POST') {
      return withBody(req, res, () => roster.rotateExternal(decodeURIComponent(credentialOf[1])), false);
    }
    const avatarResult = memberAvatarRoute(req, res, path, { roster, owner });
    if (avatarResult !== undefined) return avatarResult;
    const mm = /^\/collab\/api\/members\/([^/]+)$/.exec(path);
    if (mm !== null && req.method === 'PATCH') {
      return withBody(req, res, async body => ({ member: await roster.update(decodeURIComponent(mm[1]), body) }));
    }
    if (mm !== null && req.method === 'DELETE') {
      return withBody(req, res, () => {
        roster.remove(decodeURIComponent(mm[1]));
        hub.emit({ type: 'rooms', rooms: store.roomsView() }); // #155: its private chat leaves the list too.
        return { ok: true };
      }, false);
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

/** Owner-only channel settings; workspaces inherit their parent channel. */
export function roomSettingsRoute(req, res, path, { store, hub, gateway, workspacePath }) {
  const match = /^\/collab\/api\/rooms\/(\d+)\/(settings|renew)$/.exec(path);
  if (match === null) return undefined;
  const roomId = Number(match[1]);
  if (store.room(roomId) === undefined) return Promise.resolve(json(res, 404, { error: '频道不存在' }));
  const view = () => ({ lead_id: store.leadId(roomId), effective_lead_id: hub.defaultReplyIn(roomId)?.id ?? null,
    workspace_path: store.workspacePath(roomId, workspacePath), max_relay: store.relaySetting(roomId).max_relay });
  if (match[2] === 'renew' && req.method === 'POST') {
    // Each role starts a fresh conversation: the bridge's own /new, sent to every bot in the room.
    return withBody(req, res, () => ({ members: gateway.renew(roomId) }), false);
  }
  if (match[2] !== 'settings') return undefined;
  if (req.method === 'GET') return Promise.resolve(json(res, 200, view()));
  if (req.method !== 'PATCH') return undefined;
  return withBody(req, res, body => {
    // The settings dialog's「未选择（按原配置）」option sends the select's empty value: clear the
    // channel's own choice so the primary falls back to the instance-wide one, exactly like null.
    const leadId = body?.lead_id === '' ? null : body?.lead_id;
    if (leadId !== undefined && leadId !== null && !hub.routableIn(roomId).some(m => m.id === leadId && !m.external)) {
      throw new CollabError('invalid', '请选择本频道的主角色');
    }
    if (body?.workspace_path !== undefined) {
      const path = body.workspace_path;
      if (typeof path !== 'string' || !isAbsolute(path)) throw new CollabError('invalid', '工作目录必须是绝对路径');
      let stat;
      try { stat = statSync(path); } catch { throw new CollabError('invalid', '工作目录不存在或无法访问'); }
      if (!stat.isDirectory()) throw new CollabError('invalid', '工作目录必须是目录，不能是文件');
    }
    store.transaction(() => {
      if (leadId !== undefined) store.setLead(roomId, leadId);
      if (body?.workspace_path !== undefined) store.setWorkspacePath(roomId, body.workspace_path, workspacePath);
      // #445: 6–20 only; an invalid value rolls the whole PATCH back.
      if (body?.max_relay !== undefined) store.setMaxRelay(roomId, body.max_relay);
    });
    hub.emit({ type: 'room-settings', room_id: store.settingsRoom(roomId), ...view() });
    return view();
  });
}

/** Owner-only upload endpoint, also callable in isolated HTTP regressions. */
export function memberAvatarRoute(req, res, path, { roster, owner }) {
  const match = /^\/collab\/api\/members\/([^/]+)\/avatar$/.exec(path);
  if (match === null || !['POST', 'DELETE'].includes(req.method)) return undefined;
  if (!owner(req)) { json(res, 401, { error: 'unauthorized' }); return Promise.resolve(); }
  return withBody(req, res, body => {
    if (req.method === 'POST' && typeof body?.png !== 'string') throw new CollabError('invalid', '请提供 PNG base64 头像数据');
    return { member: roster.setAvatar(decodeURIComponent(match[1]), req.method === 'POST' ? body.png : undefined) };
  }, req.method === 'POST', 512 * 1024);
}

/**
 * #197: one attachment streams straight to disk instead of riding base64 in the message
 * JSON, so its cap no longer comes from MAX_MESSAGE_BODY. The bytes are the raw request
 * body; the name and type travel in the query string because a header can not carry 中文.
 * The browser posts the message with the returned metadata once every file of that message
 * has arrived.
 *   POST /collab/api/attachments?name=…&mime=…  -> 201 { attachment } | 413/400 { error, code, max_upload_bytes }
 * Owner authentication is checked by browserRoute before this handler, like ownMessageRoute.
 */
export function streamUploadRoute(req, res, url, { files, maxBytes }) {
  // browserRoute normalizes trailing slashes before routing; do the same here so a stray one still lands.
  if (url.pathname.replace(/\/+$/, '') !== '/collab/api/attachments' || req.method !== 'POST') return undefined;
  const name = url.searchParams.get('name') ?? '';
  const mime = url.searchParams.get('mime') ?? String(req.headers?.['content-type'] ?? '');
  return files.saveStream(req, { name, mime, maxBytes }).then(
    attachment => json(res, 201, { attachment }),
    (error) => {
      if (!(error instanceof CollabError)) throw error;
      // Past the cap the rest of the body is drained, not cut, so the browser sees this reply
      // rather than a reset connection (same trade as readBody).
      return json(res, error.code === 'too-large' ? 413 : 400,
        { error: error.message, code: error.code, max_upload_bytes: maxBytes });
    });
}

/**
 * #1904: the owner deletes an idle workspace (DELETE /collab/api/rooms/{id}). The bridge keeps the tasks, so
 * it is asked (bridge.deleteWorkspace): it refuses a workspace with a task in work or a paused task waiting
 * there, and removes the room itself (cloudweb.mjs op delete). Owner authentication is checked by browserRoute.
 */
export function deleteWorkspaceRoute(req, res, path, { store, bridge }) {
  const match = /^\/collab\/api\/rooms\/(\d+)$/.exec(path);
  if (match === null || req.method !== 'DELETE') return undefined;
  const roomId = Number(match[1]);
  return withBody(req, res, async () => {
    const room = store.room(roomId);
    if (room === undefined) throw new CollabError('room-missing', `频道 ${roomId} 不存在`);
    if (room.kind !== 'workspace') throw new CollabError('not-workspace', '只有工作区可以删除');
    if (store.workspaceOwner(roomId) != null) throw new CollabError('workspace-busy', `${room.name} 还有活在做，做完才能删`);
    const r = await bridge.deleteWorkspace(roomKey(roomId));
    if (r.deleted === true) return { ok: true };
    if (r.reason === 'working') throw new CollabError('workspace-busy', `${room.name} 还有活在做，做完才能删`);
    if (r.reason === 'paused') throw new CollabError('workspace-paused', `${room.name} 里有暂停的活，继续或结束它之后才能删`);
    throw new CollabError('bridge-unreachable', `没有删除：问不到 bothouse（${String(r.error ?? '').slice(0, 200)}）`);
  }, false);
}

/** Owner authentication is checked by browserRoute before this handler, like ownMessageRoute. */
export function renameRoomRoute(req, res, path, { store, hub }) {
  const match = /^\/collab\/api\/rooms\/(\d+)$/.exec(path);
  if (match === null || req.method !== 'PATCH') return undefined;
  const roomId = Number(match[1]);
  if (store.room(roomId) === undefined) return json(res, 404, { error: 'room not found' });
  return withBody(req, res, async body => {
    // #176: create strips a leading '#' (the channel list shows names with one), so rename must too,
    // or '#general' gets past checkRoomName as a second "general".
    const room = store.renameRoom(roomId, typeof body?.name === 'string' ? body.name.trim().replace(/^#/, '') : body?.name);
    hub.emit({ type: 'rooms', rooms: store.roomsView() });
    return { room };
  });
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
export function ownMessageRoute(req, res, path, { store, hub, gateway }) {
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
      return { ok: true, recalled: gateway.recall(row.id), stopped: [], still_running: [] };
    }, false);
  }
  return undefined;
}

const ERROR_STATUS = { 'room-missing': 404, 'member-missing': 404, 'task-missing': 404, conflict: 409, 'read-only': 403, forbidden: 403, offline: 503, 'member-busy': 409,
  'workspace-busy': 409, 'workspace-paused': 409, 'bridge-unreachable': 503 };

/** Parse a JSON body (unless `parse` is false), run fn, and map CollabError codes to HTTP statuses. */
class BodyTooLarge extends Error {}

// A bot frame carries attachments base64-encoded (x4/3) plus JSON fields; 1 MiB of
// headroom covers those. A smaller cap makes ws close the bot with 1009 after the
// sender already reported success. MAX_BOT_ATTACHMENT_BYTES lives in attachments.mjs
// because #197 also uses it to decide which files are too big to send at all.
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
  // #1023: a delivered web page (`?view=page`) opens inline for the delivery card's frame. The CSP
  // sandbox gives it an opaque origin even when opened in its own tab, so its scripts never act
  // with the owner's sign-in on this origin.
  const page = /[?&]view=page(?:&|$)/.test(req.url ?? '') && (/^text\/html\b/i.test(row.mime) || /\.html?$/i.test(row.name));
  const headers = { 'content-type': page ? 'text/html; charset=utf-8' : row.mime, 'accept-ranges': 'bytes',
    'content-disposition': `${page || INLINE_IMAGE.test(row.mime) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=86400',
    ...(page ? { 'content-security-policy': 'sandbox allow-scripts allow-forms allow-popups allow-modals' } : {}) };
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
