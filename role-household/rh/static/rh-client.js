// 频道页（/）和表盘页（/dial）共用的连接 + 设备代码：WebSocket 收推送，token、开声音、按角色播放和回执。
// 页面在加载本文件前定义 window.rhHooks：
//   render()            消息或成员变了，重画
//   status(text)        连接状态文字（"已连接"、"断开了…"）
//   needToken(why)      没有 token 或 token 不对
//   deviceRoles()       点了"开声音"后本页当哪些角色的设备（角色 id 列表）
//   onDevice(e)         可选：收到设备事件后调用（表盘用来切"在说"动画）
//   onConnectFail()     可选：连不上 / 断线（表盘用来进演示模式）
//   onMic(on)           可选：闭麦开关变了（频道页用来改按钮）
// 全局变量（验收脚本和测试直接读）：members, msgs, ws, players, logAudio, window.rhAudioLog。
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
let micOn = true, thinkingRole = null;   // 云端的闭麦开关；主机说谁在想（rh/hub.py）
let volumes = {};   // 角色 -> 她的小智板子音量 0-100（只有在线的板子，rh/hub.py）
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
  if (!token) return needToken("需要 token");
  // 同一时间只留一条连接：取消还在等的重连，关掉旧连接（先摘掉 onclose，免得它再排一次重连）。
  clearTimeout(timer); timer = null;
  if (ws) { ws.onclose = null; ws.close(); }
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
  ws.onopen = () => ws.send(JSON.stringify({type: "hello", token, kind: "web", since: null}));
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.type === "ready") {
      room = d.room.id; roomName = d.room.name;
      members = d.members; msgs = new Map(d.messages.map(x => [x.id, x])); retry = RETRY_MIN;
      micOn = d.mic !== false; thinkingRole = d.thinking || null; volumes = d.volumes || {};
      if (hooks().onMic) hooks().onMic(micOn);
      hooks().status("已连接");
      hooks().render(); deviceHello();
    } else if (d.type === "message") {
      const old = msgs.get(d.message.id);
      if (old && old.status === "speaking" && d.message.status === "interrupted") markInterrupted(d.message.author);
      msgs.set(d.message.id, d.message); hooks().render();
    } else if (d.type === "mic") {
      micOn = d.on !== false;
      if (hooks().onMic) hooks().onMic(micOn);
    } else if (d.type === "volumes") {
      volumes = d.volumes || {}; hooks().render();
    } else if (d.type === "thinking") {
      thinkingRole = d.role || null; hooks().render();
    } else if (d.type === "members") {
      members = d.members; hooks().render(); deviceHello();
    } else if (d.type === "device") {
      onDevice(d);
      if (hooks().onDevice) hooks().onDevice(d);
    }
  };
  ws.onclose = (e) => {
    stopAllDevices();
    if (e.code === 4001) return needToken("token 不对，请重新输入");
    hooks().status(`断开了，${Math.round(retry/1000)} 秒后重连…`);
    if (hooks().onConnectFail) hooks().onConnectFail();
    timer = setTimeout(connect, retry); retry = Math.min(retry * 2, RETRY_MAX);
  };
}

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

async function postMessage(text) {   // 返回错误文字，成功为 ""
  try {
    const r = await fetch(`/api/rooms/${room}/messages`, {method: "POST",
      headers: {"Content-Type": "application/json", "Authorization": "Bearer " + token}, body: JSON.stringify({text})});
    if (r.status === 401) { if (ws) ws.close(); needToken("token 不对，请重新输入"); return "token 不对"; }
    if (!r.ok) return r.status === 413 ? "消息太长，没发出去" : `没发出去（${r.status} ${(await r.text()).slice(0, 60)}）`;
    return "";
  } catch (e) { return "没发出去：连不上云端"; }
}

// ---------- 每个角色现在的状态：speaking / thinking / interrupted / idle ----------
// 被打断：看到某角色的消息从“在说”变成“被打断”后亮这么久（毫秒）。来源：实现者定，够看清一眼。
const INTERRUPTED_MS = 2500;
const interruptedUntil = {};
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
