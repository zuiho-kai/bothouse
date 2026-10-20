// 频道页（/）的消息列表：增量渲染、滚到顶加载更早、搜索、未读（分割线 / 新消息浮条 / 标题未读数）。
// 用户 2026-10-20「你可以去修一下自建平台，那边感觉还是很垃圾」；差距：只看得到最近 200 条、不能翻页搜索、
// 每来一条整块重建（选中的字被冲掉）、上翻时来新消息没提示。接口见 rh/hub.py 开头。
// 依赖 rh-client.js 的全局（msgs, room, roomName, token, readId, members, $, esc）和 hub.html 的 msgHTML(x, prev, color)、colorOf()、fmt()。
'use strict';
const BASE_TITLE = document.title;
// 离底部多少像素内算“在底部”（自动跟到最新、标为已读）。来源：沿用原 renderLog 的判断。
const BOTTOM_PX = 30;
// 搜索结果点过去后高亮多久（毫秒）。来源：同 rh-client.js 的 INTERRUPTED_MS，够看清一眼。
const FLASH_MS = 2500;
const shown = new Map();   // 消息 id -> {el, sig}：画在页面上的消息节点；sig 不变就不动它
let hasMore = true;        // 云端还有没有更早的消息
let loadingOlder = null;   // 正在加载更早消息的 Promise（同一时间只发一个）
let dividerId = null;      // 未读分割线画在这条消息前面
let unreadHidden = 0;      // 未读里还没加载到页面上的条数（离开太久、未读超过一页时）：云端给的未读数减掉已加载的未读，往上加载一页减一次
let sentRead = 0;          // 已经报给云端的已读位置
let firstPaint = true;     // 连上后第一次画：有未读就停在分割线，没有就到底
let olderErr = "";         // 加载更早的失败了：提示留在顶上，重画不冲掉
let olderRetryAt = 0, olderBackoff = RETRY_MIN;   // 失败后多久才再试，翻倍。来源：沿用 rh-client.js 的重连等待 RETRY_MIN/RETRY_MAX
let searchSeq = 0;         // 搜索请求序号：回来的不是最新一次就丢掉

const logEl = () => $("log");
const authHeaders = () => ({"Authorization": "Bearer " + token});
function atBottom() { const l = logEl(); return l.scrollTop + l.clientHeight >= l.scrollHeight - BOTTOM_PX; }
function maxId() { let m = 0; for (const id of msgs.keys()) if (id > m) m = id; return m; }
function minId() { let m = Infinity; for (const id of msgs.keys()) if (id < m) m = id; return m; }

// ---------- 增量渲染 ----------
// 判断一条消息要不要重画：它自己的状态 + 前一条是谁（决定合不合并成一组）+ 成员表（名字、颜色、头像）。
function membersSig() {
  return members.map(m => `${m.id}\u0001${m.name}\u0001${(m.avatar || "").length}\u0001${(m.avatar || "").slice(-16)}`).join("\u0002")
    + "\u0003" + bots.map(b => `${b.id}\u0001${b.name}`).join("\u0002");   // bot 的头像、颜色跟同名角色走（hub.html twinOf）
}
function msgSig(x, prev, color, mem) {
  const p = prev ? `${prev.id}:${prev.author_kind}:${prev.author}:${prev.created_at}` : "";
  // 归档与否决定有没有编辑/删除按钮（hub.html msgHTML）；头上的「今天/昨天」过了午夜会变（hub.html shortTime）
  return `${x.status}|${x.spoken}|${x.updated_at}|${x.text.length}|${color[x.author] || ""}|${p}|${mem}|${x.local ? x.local.state : ""}|${roomArchived()}|${shortTime(x.created_at)}`;
}
const shownKey = (k) => /^\d+$/.test(k) ? Number(k) : k;   // data-id：消息是数字 id，本页没发成的是 "p:<key>"
function toEl(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

function syncLog() {
  const l = logEl(), wasBottom = atBottom();
  // 锚点：视野里最上面那条消息。改完页面后把它放回原处（往上加载更早消息时视野不跳）。
  // 按 id 记：它自己可能被重画（前面接上了更早的消息，合不合并成一组会变）。
  const lt = l.getBoundingClientRect().top;
  let anchorId = null, anchorTop = 0;
  for (const el of l.querySelectorAll(":scope > .msg")) {
    const r = el.getBoundingClientRect();
    if (r.bottom > lt) { anchorId = shownKey(el.dataset.id); anchorTop = r.top; break; }
  }

  // 本页发送中/没发出去的（rh-client.js pending）排在最后，键是 "p:<client_key>"，不算未读、不参与翻页
  // 只画这个频道的（切到别的频道再切回来，没发出去的还在原频道里）
  const local = [...pending.values()].filter(p => p.room === room).map(p => ({id: "p:" + p.key, author_kind: "user",
    author: "user", name: "用户", text: p.text, created_at: p.t, status: "user", local: p}));
  const localIds = new Set(local.map(x => x.id));
  for (const [id, v] of shown) if (typeof id === "number" ? !msgs.has(id) : !localIds.has(id)) { v.el.remove(); shown.delete(id); }
  const list = [...msgs.values()].sort((a, b) => a.id - b.id);
  const color = colorOf(), mem = membersSig();
  pickDivider(list);
  let prev = null, ref = $("logtop");
  for (const x of list.concat(local)) {
    const p = x.id === dividerId ? null : prev;   // 分割线后的第一条重新带头像和名字（同 Discord）
    const sig = msgSig(x, p, color, mem), cur = shown.get(x.id);
    if (!cur || cur.sig !== sig) {
      const el = toEl(msgHTML(x, p, color));
      el.dataset.id = x.id;
      if (cur) { if (cur.el.classList.contains("flash")) el.classList.add("flash"); cur.el.replaceWith(el); }
      else ref.after(el);
      shown.set(x.id, {el, sig});
    }
    ref = shown.get(x.id).el; prev = x;
  }
  placeDays(list.concat(local));
  placeDivider();
  setTop(loadingOlder ? "正在加载更早的消息…" : "");

  if (firstPaint && list.length) {
    firstPaint = false;
    if (unreadHidden > 0) catchUpUnread();   // 第一条未读还没加载到：往上加载到它，再停在分割线
    else if (!scrollToDivider()) l.scrollTop = l.scrollHeight;
  } else if (wasBottom) {
    l.scrollTop = l.scrollHeight;
  } else if (anchorId != null && shown.has(anchorId)) {
    l.scrollTop += shown.get(anchorId).el.getBoundingClientRect().top - anchorTop;
  }
  afterMove();
}

// ---------- 未读 ----------
// 把分割线停在视野顶上（浮条下面，不被盖住）。没有分割线返回 false。
function scrollToDivider() {
  const l = logEl(), d = l.querySelector(".newdiv");
  if (!d) return false;
  updateUnread();   // 先把浮条摆出来，量得到它的高度
  l.scrollTop += d.getBoundingClientRect().top - l.getBoundingClientRect().top - $("newbar").offsetHeight;
  return true;
}
async function catchUpUnread() {
  const r0 = room;
  while (unreadHidden > 0 && hasMore && room === r0) {
    const n = msgs.size;
    await loadOlder();
    if (msgs.size === n) return;   // 没加载出来（失败在退避），停在原处，提示在顶上
  }
  if (room === r0) { scrollToDivider(); afterMove(); }
}
function unreadCount() {
  let n = unreadHidden;
  for (const x of msgs.values()) if (x.id > readId && x.author_kind !== "user") n++;
  return n;
}
function pickDivider(list) {
  // 有未读时分割线在第一条未读前；上一段未读都读完了、又来新的，就挪到新的这段前。读完了线留着，看得出从哪开始是新的。
  // 第一条未读还没加载到（unreadHidden > 0）就先不画，加载到了再放上去。
  if (unreadHidden === 0 && unreadCount() > 0 && (dividerId == null || readId >= dividerId)) {
    const first = list.find(x => x.id > readId && x.author_kind !== "user");
    if (first) dividerId = first.id;
  }
}
// 日期分隔线：每天第一条前面一条（照 Discord）。按日期认已有的线，只增删挪动不重建；未读分割线紧贴消息，日期线在它上面。
function placeDays(list) {
  const want = new Map();
  let prevDay = null;
  for (const x of list) {
    const k = dayKey(x.created_at), v = shown.get(x.id);
    if (k !== prevDay && v) want.set(k, {el: v.el, t: x.created_at});
    prevDay = k;
  }
  const have = new Map();
  for (const d of logEl().querySelectorAll(":scope > .daydiv")) {
    if (want.has(d.dataset.day) && !have.has(d.dataset.day)) have.set(d.dataset.day, d); else d.remove();
  }
  for (const [k, {el, t}] of want) {
    let d = have.get(k);
    if (!d) { d = toEl(`<div class="daydiv" role="separator"><span>${dayLabel(t)}</span></div>`); d.dataset.day = k; }
    let at = el;
    if (at.previousElementSibling && at.previousElementSibling.classList.contains("newdiv")) at = at.previousElementSibling;
    if (at.previousElementSibling !== d) at.before(d);
  }
}
function placeDivider() {
  let d = logEl().querySelector(".newdiv");
  const at = dividerId != null && shown.get(dividerId);
  if (!at) { if (d) d.remove(); return; }
  if (!d) d = toEl(`<div class="newdiv"><span>新消息</span></div>`);
  if (at.el.previousElementSibling !== d) at.el.before(d);
}
// 页面在前台、有焦点、看到底了才算读过（桌面网页开着人走开不算），报给云端（换设备接着算）。
function maybeRead() {
  if (room == null || document.visibilityState !== "visible" || !document.hasFocus() || !atBottom()) return;
  const m = maxId();
  if (m > readId) { readId = m; unreadHidden = 0; }
  if (readId > sentRead) {
    const prev = sentRead, v = readId;
    sentRead = v;
    const undo = () => { if (sentRead === v) sentRead = prev; };   // 没报成：退回去，下次滚动、获得焦点时再报
    fetch(`/api/rooms/${room}/read`, {method: "POST", headers: {"Content-Type": "application/json", ...authHeaders()},
      body: JSON.stringify({last_read: v})}).then(r => { if (!r.ok) undo(); }, undo);
  }
}
function updateUnread() {
  const n = unreadCount();
  document.title = (n ? `(${n}) ` : "") + BASE_TITLE;
  const bar = $("newbar");
  bar.style.top = logEl().offsetTop + "px";   // 贴着消息列表顶（手机顶栏更高、断线横幅出现时都往下挪）
  bar.hidden = !n;
  if (n) bar.querySelector("b").textContent = `${n} 条新消息`;
}
function afterMove() { maybeRead(); updateUnread(); maybeLoadOlder(); }
function jumpToLatest() { const l = logEl(); l.scrollTop = l.scrollHeight; afterMove(); }

// rh-client.js 连上时调：不是断线重连补缺，就当重新打开（停在分割线、重新数未读）。
function historyReady(d, merged) {
  if (merged) { sentRead = Math.max(sentRead, readId); return; }
  sentRead = readId;   // 可能换了频道：按这个频道的已读位置重来
  // 换了频道：上一个频道的搜索结果作废（点它会在新频道里一路往上加载找一条不存在的消息）
  $("results").hidden = true; $("q").value = ""; searchSeq++;
  for (const v of shown.values()) v.el.remove();
  shown.clear();
  firstPaint = true; dividerId = null; hasMore = d.has_more === true;
  olderErr = ""; olderRetryAt = 0; olderBackoff = RETRY_MIN;
  let loaded = 0;
  for (const x of d.messages) if (x.id > readId && x.author_kind !== "user") loaded++;
  unreadHidden = Math.max(0, (d.unread || 0) - loaded);
}
function historyRead() { if (readId >= minId() - 1) unreadHidden = 0; updateUnread(); }

// ---------- 往上加载更早的 ----------
function setTop(text) {
  const t = $("logtop");
  t.textContent = text || olderErr || (hasMore ? "" : `这是 #${roomName || "频道"} 的开头`);
}
function loadOlder() {
  if (loadingOlder || !hasMore || room == null || Date.now() < olderRetryAt) return loadingOlder;
  const r0 = room, min = minId();
  const failed = (why) => {   // 退避：这段时间里滚到顶也不再发
    olderErr = `没加载出来（${why}），${Math.round(olderBackoff / 1000)} 秒后滚到顶再试`;
    olderRetryAt = Date.now() + olderBackoff; olderBackoff = Math.min(olderBackoff * 2, RETRY_MAX);
    setTop();
  };
  loadingOlder = (async () => {
    setTop("正在加载更早的消息…");
    try {
      const r = await fetch(`/api/rooms/${r0}/messages` + (isFinite(min) ? `?before=${min}` : ""), {headers: authHeaders()});
      if (!r.ok) return failed(r.status);
      const d = await r.json();
      if (room !== r0) return;
      let got = 0;
      for (const x of d.messages) if (!msgs.has(x.id)) { msgs.set(x.id, x); if (x.id > readId && x.author_kind !== "user") got++; }
      unreadHidden = d.has_more ? Math.max(0, unreadHidden - got) : 0;   // 到头了，未读一定都加载到了
      hasMore = d.has_more;
      olderErr = ""; olderBackoff = RETRY_MIN;
    } catch (e) { return failed("连不上云端"); }
    finally { loadingOlder = null; }
    renderLog();
  })();
  return loadingOlder;
}
// 离顶部不到一屏就加载（同 Discord，滚到顶之前已经接上）。
function maybeLoadOlder() { const l = logEl(); if (l.scrollTop < l.clientHeight) loadOlder(); }

// ---------- 搜索 ----------
let searchQ = "", searchBefore = null, searchN = 0;
function highlight(text, q) {
  const lo = text.toLowerCase(), ql = q.toLowerCase();
  let out = "", i = 0, j;
  while ((j = lo.indexOf(ql, i)) >= 0) { out += esc(text.slice(i, j)) + "<mark>" + esc(text.slice(j, j + q.length)) + "</mark>"; i = j + q.length; }
  return out + esc(text.slice(i));
}
// 搜索结果的正文：bot 的尾注同消息区一样单独画成淡色小字（hub.html splitFoot），不露星号；别人 @用户 同消息区显示成 @你
function hitText(x) {
  const [main, foot] = x.card ? [x.text, null] : splitFoot(x, x.text);
  const shown = x.author_kind === "user" ? main : main.replace(new RegExp("@(?:" + ME.aliases.join("|") + ")(?![A-Za-z0-9_])", "g"), "@" + ME.shown);
  return highlight(shown.trimEnd(), searchQ) + (foot ? `<div class="foot">${highlight(foot, searchQ).replace(/\n/g, "<br>")}</div>` : "");
}
async function search(q, more) {
  const box = $("results"), list = box.querySelector(".list"), moreBtn = box.querySelector(".more");
  const seq = ++searchSeq;
  if (!more) {
    searchQ = q.trim(); searchBefore = null; searchN = 0; list.innerHTML = "";
    if (!searchQ) { box.hidden = true; return; }
  }
  // 结果面板贴着消息列表顶；手机上搜索框是顶栏下面单独一行（hub.html），面板接在它下面，不盖住它
  const qEl = $("q"), qBottom = qEl.offsetParent && getComputedStyle(qEl).position === "absolute" ? qEl.offsetTop + qEl.offsetHeight + 8 : 0;   // 8：hub.html 里 #q 的底色外扩
  box.hidden = false; moreBtn.hidden = true; box.style.top = Math.max(logEl().offsetTop, qBottom) + "px";
  box.querySelector(".sum").textContent = "搜索中…";
  const qs = new URLSearchParams({q: searchQ});
  if (searchBefore) qs.set("before", searchBefore);
  let d;
  const stale = () => seq !== searchSeq;   // 这之后又搜了别的：这次的结果丢掉
  try {
    const r = await fetch(`/api/rooms/${room}/messages?${qs}`, {headers: authHeaders()});
    if (stale()) return;
    if (!r.ok) { box.querySelector(".sum").textContent = `没搜成（${r.status}）`; return; }
    d = await r.json();
  } catch (e) { if (!stale()) box.querySelector(".sum").textContent = "没搜成：连不上云端"; return; }
  if (stale()) return;
  const color = colorOf();
  list.insertAdjacentHTML("beforeend", d.messages.map(x =>
    `<div class="hit" data-id="${x.id}"><div class="hdr"><span class="who" style="color:${color[x.author] || "var(--head)"}">${esc(shownName(x))}</span>` +
    `${isBot(x.author) ? `<span class="tag">BOT</span>` : ""}<span class="t">${fmt(x.created_at)}</span></div><div class="text">${hitText(x)}</div></div>`).join(""));
  searchN += d.messages.length;
  if (d.messages.length) searchBefore = d.messages[d.messages.length - 1].id;
  box.querySelector(".sum").textContent = searchN ? `${searchN}${d.has_more ? "+" : ""} 条结果` : "没找到";
  moreBtn.hidden = !d.has_more;
}
// 点搜索结果：往上加载到那条为止，滚过去高亮。
async function jumpTo(id) {
  const r0 = room;
  while (!msgs.has(id) && hasMore && room === r0) {
    const n = msgs.size;
    await loadOlder();
    if (msgs.size === n) break;   // 加载失败，别死循环
  }
  const v = shown.get(id);
  if (!v) return;
  v.el.scrollIntoView({block: "center"});
  v.el.classList.add("flash");
  setTimeout(() => { const w = shown.get(id); if (w) w.el.classList.remove("flash"); }, FLASH_MS);
  afterMove();
}

logEl().addEventListener("scroll", afterMove);
window.addEventListener("focus", afterMove);
document.addEventListener("visibilitychange", afterMove);
$("newbar").onclick = jumpToLatest;
$("q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); search($("q").value); }
  else if (e.key === "Escape") { $("q").value = ""; $("results").hidden = true; searchSeq++; }
});
$("results").querySelector(".close").onclick = () => { $("results").hidden = true; searchSeq++; };
$("results").querySelector(".more").onclick = () => search(searchQ, true);
$("results").querySelector(".list").addEventListener("click", (e) => {
  const hit = e.target.closest(".hit");
  if (!hit) return;
  if (window.matchMedia("(max-width: 900px)").matches) $("results").hidden = true;   // 手机上结果盖住了消息
  jumpTo(Number(hit.dataset.id));
});
