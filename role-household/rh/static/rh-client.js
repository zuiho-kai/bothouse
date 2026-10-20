// 频道页（/）和表盘页（/dial）共用的连接 + 设备代码：WebSocket 收推送，token、开声音、按角色播放和回执。
// 页面在加载本文件前定义 window.rhHooks：
//   render()            消息或成员变了，重画
//   status(text)        连接状态文字（"已连接"、"断开了…"）
//   needToken(why)      没有 token 或 token 不对
//   deviceRoles()       点了"开声音"后本页当哪些角色的设备（角色 id 列表）
//   onDevice(e)         可选：收到设备事件后调用（表盘用来切"在说"动画）
//   onConnectFail()     可选：连不上 / 断线（表盘用来进演示模式）
//   onMic(on)           可选：闭麦开关变了（频道页用来改按钮）
//   onConn(state)       可选：连接状态 "connecting"（第一次连）/ "open" / "lost"（断过、正在重连）
//   onReady(d, merged)  可选：连上了（merged=true 是断线重连只补了缺的，msgs 里原有的更早消息还在）
//   onRead(lastRead)    可选：已读位置变了（别的页面读过了）
//   multiRoom           可选：true = 本页能切频道（频道页），记住上次在哪个频道，下次连上直接进它；
//                       不设的页面（表盘）总是连默认频道（语音在那里）
// 全局变量（验收脚本和测试直接读）：members, msgs, rooms, room, ws, players, logAudio, window.rhAudioLog, bots, botThinking。
'use strict';
const RETRY_MIN = 1000, RETRY_MAX = 30000;  // 重连等待毫秒，翻倍。来源：实现者定，和 rh/host.py 一致。
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const hooks = () => window.rhHooks || {};

// ---------- 设备：每个角色一台设备，用户点“开声音”后才登记（浏览器不让没点过的页面自动出声） ----------
// 事件定义见 rh/device.py：start 开始说 / audio 音频块 / stop 停止；播完、被停、失败都回执给主机。
let soundOn = false;
const players = new Map();   // 角色 id -> {player, audio, turn, sent, urls}
window.rhAudioLog = [];      // 播放事件记录（验收脚本读）：{role, play_id, ev, t}
// 记录最多留多少条，旧的丢掉。来源：一个话题最多 6 轮（roles.toml），每轮约 10 条事件，约 15 个话题。
const AUDIO_LOG_MAX = 1000;
function logAudio(x) {
  window.rhAudioLog.push(x);
  if (window.rhAudioLog.length > AUDIO_LOG_MAX) window.rhAudioLog.splice(0, window.rhAudioLog.length - AUDIO_LOG_MAX);
}
// 44 字节的空 WAV（16 kHz 单声道 16 位、0 帧）：点“开声音”时让每个 Audio 在点击里播一次，iOS Safari 才允许它之后出声。
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

function sendJSON(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function deviceHello() {
  if (soundOn) sendJSON({type: "device_hello", roles: (hooks().deviceRoles || (() => []))()});
}
function receipt(role, d, result) {
  if (!d.turn || d.sent) return;
  d.sent = true;
  logAudio({role, play_id: d.turn.id, ev: "receipt:" + result, t: Date.now()});
  // started：有没有真的播出声。一句都没播出来就失败时，主机改用本机喇叭，不静默交棒。
  sendJSON({type: "receipt", play_id: d.turn.id, result, started: d.started});
}
function deviceFor(role) {
  if (!players.has(role)) {
    const audio = new Audio();
    const d = {audio, turn: null, sent: false, started: false, urls: [], playing: false};
    d.player = new VoiceQueuePlayer(audio, {baseURL: location.href, onState: (state) => {
      if (!d.turn) return;
      if (state === "playing") d.started = true;
      d.playing = state === "playing" || state === "loading" || state === "buffering" || state === "waiting";
      if (state === "playing" || state === "completed" || state === "failed")
        logAudio({role, play_id: d.turn.id, ev: state, t: Date.now()});
      if (state === "completed") receipt(role, d, "done");
      else if (state === "failed") receipt(role, d, "failed");
      else if (state === "paused") receipt(role, d, "stopped");
    }});
    players.set(role, d);
  }
  return players.get(role);
}
function onDevice(e) {
  const d = deviceFor(e.role);
  if (e.event === "start") {
    if (d.turn && !d.sent) { d.player.stop(); receipt(e.role, d, "stopped"); }
    d.urls.forEach(u => URL.revokeObjectURL(u));
    d.turn = {id: e.play_id, status: "synthesizing", audio_chunks: [], audio_complete: false};
    d.sent = false; d.started = false; d.urls = [];
    logAudio({role: e.role, play_id: e.play_id, ev: "start", t: Date.now()});
    d.player.select(d.turn);
    d.player.start();
  } else if (!d.turn || d.turn.id !== e.play_id || d.sent) {
    return;   // 旧播放或已停：停了就不续播
  } else if (e.event === "audio") {
    if (e.data) {   // 不带 data 的是结束标记（最后几句合成出 0 秒被主机跳过时）
      const bin = atob(e.data), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([buf], {type: e.mime || "audio/wav"}));
      d.urls.push(url);
      d.turn.audio_chunks.push({index: e.index, audio_url: url, duration_seconds: e.duration});
    }
    if (e.last) { d.turn.status = "ready"; d.turn.audio_complete = true; }
    d.player.update({...d.turn, audio_chunks: [...d.turn.audio_chunks]});
  } else if (e.event === "stop") {
    d.player.stop();
    logAudio({role: e.role, play_id: e.play_id, ev: "stop", t: Date.now()});
    receipt(e.role, d, "stopped");
  }
}
function stopAllDevices() {   // 断线：本页不再是设备，正在播的停掉（hub 会替我们回执 lost）
  for (const d of players.values()) { d.player.stop(); d.sent = true; d.playing = false; }
}
// 必须在用户点击的回调里调用：给要当设备的每个角色建好 Audio 并播一次空音频解锁（iOS 要求每个媒体元素先在用户手势里 play 过）。
function enableSound() {
  soundOn = true;
  for (const id of (hooks().deviceRoles || (() => []))()) {
    const a = deviceFor(id).audio;
    a.src = SILENT_WAV;
    Promise.resolve(a.play()).catch(() => {});
    // 马上停下并清掉：解锁只要“在点击里 play 过”，这样它的 pause 等事件在点击后立刻派发完，
    // 不会晚到、被播放器误当成真正播放被暂停。
    a.pause(); a.removeAttribute("src"); a.load();
  }
  deviceHello();
}

// ---------- 连接 ----------
let token = "", room = null, roomName = "", members = [], msgs = new Map(), ws = null, retry = RETRY_MIN, timer = null;
let everOpen = false;   // 连上过一次以后再断，算“断线”（页面顶部出横幅）；第一次连接中不算
let started = false;    // 页面调过 connect() 才自动重连（表盘演示页不连云端）
// 经 WebSocket 收到过的最大消息 id。重连的 since 用它，不用 HTTP 回应里自己那条的 id：
// 推送断着时自己发成的那条 id 更大，用它会跳过断线期间别人的消息。
let lastSeenId = 0;
const onConn = (state) => { if (hooks().onConn) hooks().onConn(state); };
let micOn = true, thinkingRole = null;   // 云端的闭麦开关；主机说谁在想（rh/hub.py）
let volumes = {};   // 角色 -> 她的小智板子音量 0-100（只有在线的板子，rh/hub.py）
// cc-connect 的 bot（rh/cloudweb.py）：连过的都在 [{id, name, online}]；botThinking 是这个频道里正在干活的 bot id
let bots = [], botThinking = [];
let readId = 0;     // 这个频道读到哪条（存在云端，rh/hub.py 的 reads 表）
let rooms = [];     // 全部频道，含已归档的（archived_at 不为 null），按 id 排（rh/hub.py「多频道」）
const savedRoom = () => hooks().multiRoom ? Number(localStorage.getItem("rh_room")) || null : null;
const tokenMatch = location.hash.match(/token=([^&]+)/);
if (tokenMatch) {
  localStorage.setItem("rh_token", decodeURIComponent(tokenMatch[1]));
  history.replaceState(null, "", location.pathname + location.search);
}
token = localStorage.getItem("rh_token") || "";

function needToken(why) {
  token = ""; localStorage.removeItem("rh_token");
  (hooks().needToken || (() => {}))(why);
}
function setToken(t) { token = t; localStorage.setItem("rh_token", t); connect(); }

function connect() {
  started = true;
  if (!token) return needToken("需要 token");
  // 同一时间只留一条连接：取消还在等的重连，关掉旧连接（先摘掉 onclose，免得它再排一次重连）。
  clearTimeout(timer); timer = null; clearTimeout(pingTimer);
  if (ws) {   // 旧连接的 onclose 摘掉了，它该做的“停播”在这里做（还没关完的连接上可能还有在播的）
    if (ws.readyState !== 3) stopAllDevices();
    ws.onclose = null; ws.onmessage = null; ws.close();
  }
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
  let sent = null;   // 这条连接发出的 hello（ready 回来时看它带没带 since）
  // 频道页连记住的频道（多频道），表盘连默认频道；since 只在手上的消息就是这个频道时才带（helloFrame）
  ws.onopen = () => { sent = helloFrame(savedRoom() || room); ws.send(JSON.stringify(sent)); };
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.type === "ready") {
      // 只认 hello 换回来的第一个 ready；之后同一条连接上的 ready（切频道的 join）都按新频道重来。
      const since = sent ? sent.since : null;
      sent = null;
      // 云端库被清空过（最新 id 比本地已有的小）：本地的都作废，整表重新取
      if (since != null && room === d.room.id && d.last_id < Math.max(0, ...msgs.keys())) {
        msgs = new Map(); lastSeenId = 0; return connect();
      }
      // 断线重连且还是这个频道：只补缺的，已经往上翻出来的更早消息留着。
      const merged = since != null && room === d.room.id;
      room = d.room.id; roomName = d.room.name; rooms = d.rooms || [d.room];
      if (hooks().multiRoom) localStorage.setItem("rh_room", room);
      interruptedUntilClear();
      if (!merged) { msgs = new Map(); lastSeenId = 0; }
      for (const x of d.messages) gotMessage(x, true);
      // 断线期间改过的进度卡片（rh/hub.py cards_upto）：只换已经加载的，不往上补老消息
      if (merged) for (const x of d.cards || []) if (msgs.has(x.id)) gotMessage(x, true);
      members = d.members; retry = RETRY_MIN; everOpen = true; readId = d.last_read || 0;
      if (hooks().onReady) hooks().onReady(d, merged);
      micOn = d.mic !== false; thinkingRole = d.thinking || null; volumes = d.volumes || {};
      bots = d.bots || []; botThinking = d.bots_thinking || [];
      if (hooks().onMic) hooks().onMic(micOn);
      hooks().status("已连接"); onConn("open");
      hooks().render(); deviceHello();
    } else if (d.type === "rooms") {
      rooms = d.rooms || [];
      const me = rooms.find(r => r.id === room);
      if (me) roomName = me.name;
      hooks().render();
    } else if (d.type === "message") {
      if (d.message.room_id !== room) return;   // 切频道途中还在路上的旧频道消息
      const old = msgs.get(d.message.id);
      if (old && old.status === "speaking" && d.message.status === "interrupted") markInterrupted(d.message.author);
      gotMessage(d.message, true); hooks().render();
    } else if (d.type === "pong") {
      clearTimeout(pingTimer);
    } else if (d.type === "read") {
      if (d.room === room && d.last_read > readId) { readId = d.last_read; if (hooks().onRead) hooks().onRead(readId); }
    } else if (d.type === "deleted") {   // 用户删了自己的消息（可能在别的设备上删的）
      if (!msgs.has(d.id)) return;      // 别的频道的、还没加载到的
      msgs.delete(d.id); hooks().render();
      if (hooks().onDeleted) hooks().onDeleted(d.id);
    } else if (d.type === "mic") {
      micOn = d.on !== false;
      if (hooks().onMic) hooks().onMic(micOn);
    } else if (d.type === "volumes") {
      volumes = d.volumes || {}; hooks().render();
    } else if (d.type === "thinking") {
      if (d.room == null || d.room === room) { thinkingRole = d.role || null; hooks().render(); }
    } else if (d.type === "bots") {
      bots = d.bots || []; hooks().render();
    } else if (d.type === "bot_thinking") {
      if (d.room === room) { botThinking = d.bots || []; hooks().render(); }
    } else if (d.type === "members") {
      members = d.members; hooks().render(); deviceHello();
    } else if (d.type === "device") {
      onDevice(d);
      if (hooks().onDevice) hooks().onDevice(d);
    }
  };
  ws.onclose = (e) => {
    stopAllDevices();
    if (e.code === 4001) { onConn("connecting"); return needToken("token 不对，请重新输入"); }
    if (e.code === 4002 && sent && sent.room != null) {   // 要回的频道没了（换了云端库）：回默认频道，马上重连
      localStorage.removeItem("rh_room"); room = null; msgs = new Map(); lastSeenId = 0; retry = RETRY_MIN; return connect();
    }
    hooks().status(`断开了，${Math.round(retry/1000)} 秒后重连…`);
    onConn(everOpen ? "lost" : "connecting");
    if (hooks().onConnectFail) hooks().onConnectFail();
    timer = setTimeout(connect, retry); retry = Math.min(retry * 2, RETRY_MAX);
  };
}

// 连哪个频道就带哪个频道（target 为 null 时 hub 给默认频道）。手上的消息就是这个频道的才带 since 只补缺的，
// 不是（换了频道）就 since=null 拿最新一页。多频道分支在 connect 里把 target 换成记住的频道（savedRoom()）。
function helloFrame(target) {
  const h = {type: "hello", token, kind: "web", since: target != null && target === room ? resumeSince() : null};
  if (target != null) h.room = target;
  return h;
}

// 重连时从哪条之后补：经 WebSocket 收到过的最大 id（lastSeenId，不用 HTTP 回应里自己那条的 id：推送断着时自己发成的
// 那条 id 更大，用它会跳过断线期间别人的消息）；还在“在说”的要重新拿（断线期间可能说完或被打断了）。第一次连为 null（给最近一页）。
function resumeSince() {
  if (room == null || !msgs.size || !lastSeenId) return null;
  let since = lastSeenId;
  for (const x of msgs.values()) if (x.status === "speaking") since = Math.min(since, x.id - 1);
  return since;
}

function gotMessage(m, viaWS) {
  msgs.set(m.id, m);
  if (viaWS) lastSeenId = Math.max(lastSeenId, m.id);
  if (m.client_key && pending.has(m.client_key)) pending.delete(m.client_key);   // 自己发的那条到了，撤掉“发送中”
}

// 网络恢复、页面回到前台（手机解锁、切回浏览器）：没连上就马上重连，不等退避计时（正卡在“连接中”的那次也不等）。
// 看着连着的，发 ping 探一下：手机锁屏后连接常常已经死了浏览器却还不知道，等不到 pong 就重连。
// 等 pong 最多多少毫秒。来源：实现者定（本地实测 pong 几毫秒内回来，手机网络留足余量）。
const PONG_TIMEOUT_MS = 4000;
let pingTimer = null;
function reconnectNow() {
  if (!started || !token) return;
  if (ws && ws.readyState === 1) {
    clearTimeout(pingTimer);
    pingTimer = setTimeout(() => {   // 连接已死：和断线一样出横幅、通知表盘，然后马上重连
      hooks().status("断开了，正在重连…"); onConn("lost");
      if (hooks().onConnectFail) hooks().onConnectFail();
      retry = RETRY_MIN; connect();
    }, PONG_TIMEOUT_MS);
    ws.send(JSON.stringify({type: "ping"}));
    return;
  }
  retry = RETRY_MIN; connect();
}
window.addEventListener("online", reconnectNow);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reconnectNow(); });
// 系统报断网：连接多半已经死了但浏览器要很久才发现，直接当断线处理（出横幅，停掉播放），等 online 再连。
window.addEventListener("offline", () => { if (ws && ws.readyState === 1) ws.close(); });

// 闭麦/开麦：存在云端，主机收到闭麦就停掉正在说的、不再收音。返回错误文字，成功为 ""。
async function setMic(on) {
  try {
    const r = await fetch("/api/mic", {method: "POST",
      headers: {"Content-Type": "application/json", "Authorization": "Bearer " + token}, body: JSON.stringify({on})});
    if (r.status === 401) { if (ws) ws.close(); needToken("token 不对，请重新输入"); return "token 不对"; }
    return r.ok ? "" : `没切成（${r.status}）`;
  } catch (e) { return "没切成：连不上云端"; }
}

// 调某个角色板子的音量（0-100）。hub 转给主机，主机经 MCP 调板子，调好后推回 volumes。返回错误文字，成功为 ""。
async function setVolume(role, volume) {
  try {
    const r = await fetch("/api/volume", {method: "POST",
      headers: {"Content-Type": "application/json", "Authorization": "Bearer " + token}, body: JSON.stringify({role, volume})});
    if (r.status === 401) { if (ws) ws.close(); needToken("token 不对，请重新输入"); return "token 不对"; }
    return r.ok ? "" : r.status === 503 ? "没调成：角色主机没连上" : `没调成（${r.status}）`;
  } catch (e) { return "没调成：连不上云端"; }
}

// 切频道：同一条连接换订阅（不断线，开了声音的设备照旧），hub 回新频道的 ready。
function joinRoom(id) { if (id !== room) sendJSON({type: "join", room: id}); }

// 频道接口（rh/hub.py「多频道」）：返回 {err, room}，成功时 err 为 ""。建好、改好后 hub 会推 rooms，列表自己会更新。
async function roomApi(method, path, body) {
  try {
    const r = await fetch(path, {method, headers: {"Content-Type": "application/json", "Authorization": "Bearer " + token},
                                 body: body === undefined ? undefined : JSON.stringify(body)});
    if (r.status === 401) { if (ws) ws.close(); needToken("token 不对，请重新输入"); return {err: "token 不对"}; }
    if (!r.ok) return {err: r.status === 409 || r.status === 400 ? (await r.text()).slice(0, 60) : `没成（${r.status}）`};
    return {err: "", room: await r.json()};
  } catch (e) { return {err: "没成：连不上云端"}; }
}
const createRoom = (name) => roomApi("POST", "/api/rooms", {name});
const renameRoom = (id, name) => roomApi("PATCH", `/api/rooms/${id}`, {name});
const archiveRoom = (id) => roomApi("DELETE", `/api/rooms/${id}`);   // 删除 = 归档，消息留着
const restoreRoom = (id) => roomApi("PATCH", `/api/rooms/${id}`, {archived: false});

// ---------- 发消息：先在本页显示“发送中”，没发出去的留在原处可重试 ----------
// pending: client_key -> {key, text, t, room, state: "sending"|"failed"}。client_key 让重试不会重复建消息（rh/hub.py create）。
const pending = new Map();
// 等 hub 回应最多多少毫秒，超时就显示“没发出去·重试”（重试带同一个 client_key，不会重复）。来源：实现者定。
const SEND_TIMEOUT_MS = 15000;
function newKey() {   // http 页面没有 crypto.randomUUID（要 https），用 getRandomValues
  const b = crypto.getRandomValues(new Uint8Array(16));
  return "web-" + [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}
// 发一条（或重试一条）。返回 {err, keep}：err 为错误文字（成功 ""）；keep 为真时这条留在消息里可重试，
// 为假时（消息太长、格式不对这类重试也没用的）撤掉这条，由页面把文字放回输入框。
async function postMessage(text, key) {
  key = key || newKey();
  // room：发到哪个频道（切走再切回来还在那个频道里显示、重试也发回那里）
  const p = pending.get(key) || {key, text, t: Date.now() / 1000, room};
  p.state = "sending"; pending.set(key, p); hooks().render();
  const fail = (err, keep) => {
    if (!pending.has(key)) return {err: "", keep: false};   // 推送先到了：其实发成了
    if (keep) p.state = "failed"; else pending.delete(key);
    hooks().render(); return {err, keep};
  };
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS);
  try {
    const r = await fetch(`/api/rooms/${p.room}/messages`, {method: "POST", signal: ctl.signal,
      headers: {"Content-Type": "application/json", "Authorization": "Bearer " + token}, body: JSON.stringify({text, client_key: key})});
    if (r.status === 401) { pending.delete(key); hooks().render(); if (ws) ws.close(); needToken("token 不对，请重新输入"); return {err: "token 不对", keep: false}; }
    if (r.status === 413) return fail("消息太长，没发出去", false);
    if (r.status === 409) return fail("频道已归档，恢复后才能发", false);
    if (r.status >= 400 && r.status < 500) return fail(`没发出去（${r.status} ${(await r.text()).slice(0, 60)}）`, false);
    if (!r.ok) return fail(`没发出去（${r.status}）`, true);
    pending.delete(key); gotMessage(await r.json()); hooks().render();
    return {err: "", keep: false};
  } catch (e) { return fail("没发出去：连不上云端", true); }
  finally { clearTimeout(t); }
}
function dropPending(key) { pending.delete(key); hooks().render(); }

// 改 / 删用户自己发的消息（hub 推回同 id 的 message 或 deleted）。返回错误文字，成功为 ""。
async function editMessage(id, text) { return msgRequest("PATCH", id, {text}, "没改成"); }
async function deleteMessage(id) { return msgRequest("DELETE", id, null, "没删成"); }
async function msgRequest(method, id, body, fail) {
  try {
    const r = await fetch(`/api/messages/${id}`, {method,
      headers: {"Content-Type": "application/json", "Authorization": "Bearer " + token}, body: body ? JSON.stringify(body) : undefined});
    if (r.status === 401) { if (ws) ws.close(); needToken("token 不对，请重新输入"); return "token 不对"; }
    if (r.status === 404) return fail + "：消息已经不在了";
    if (r.status === 409) return fail + "：频道已归档，恢复后才能改、删";
    return r.ok ? "" : r.status === 413 ? fail + "：太长了" : `${fail}（${r.status}）`;
  } catch (e) { return fail + "：连不上云端"; }
}

// ---------- 每个角色现在的状态：speaking / thinking / interrupted / idle ----------
// 被打断：看到某角色的消息从“在说”变成“被打断”后亮这么久（毫秒）。来源：实现者定，够看清一眼。
const INTERRUPTED_MS = 2500;
const interruptedUntil = {};
function interruptedUntilClear() { for (const k in interruptedUntil) delete interruptedUntil[k]; }   // 换频道时清掉
function markInterrupted(role) {
  interruptedUntil[role] = Date.now() + INTERRUPTED_MS;
  setTimeout(() => hooks().render(), INTERRUPTED_MS + 50);
}
// 思考中：主机推来的 thinkingRole（rh/meeting.py 每轮生成前报一次，说话、不说话、话题结束时清掉）。
function roleStates() {
  const roles = members.filter(x => x.kind === "role");
  const out = Object.fromEntries(roles.map(r => [r.id, {state: "idle", msg: null}]));
  const list = [...msgs.values()].sort((a, b) => a.id - b.id);
  let sp = null;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].status === "speaking") { sp = list[i]; break; }
  const now = Date.now();
  for (const r of roles) if ((interruptedUntil[r.id] || 0) > now) out[r.id].state = "interrupted";
  if (sp && out[sp.author]) { out[sp.author] = {state: "speaking", msg: sp}; return out; }
  if (thinkingRole && out[thinkingRole] && out[thinkingRole].state === "idle") out[thinkingRole].state = "thinking";
  return out;
}
