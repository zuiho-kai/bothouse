// 手机通知和「添加到主屏幕」的网页这一半（rh/hub.py「手机通知」，sw.js 弹通知）。要在 rh-client.js 之前加载（?room= 要先记下）。
// 有人 @ 我、角色出错、等批准时，页面不在前台也弹通知。消息区顶上一行：
//   苹果手机在 Safari 网页里 → 引导先加到主屏幕（苹果只给主屏幕上的网页推送）；
//   还没开 → 一个「开通知」按钮（浏览器要点一下才让申请通知权限，苹果只认点击里申请的）；
//   开好、浏览器不支持、被拒了 → 不显示。
'use strict';
(function () {
  // 通知点开时网页没开着：sw.js 打开 /?room=频道。先记成上次的频道，rh-client.js 连上就进它，再把地址栏收拾干净。
  const q = new URLSearchParams(location.search);
  if (/^\d+$/.test(q.get("room") || "")) {
    localStorage.setItem("rh_room", q.get("room"));
    q.delete("room");
    history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash);
  }
  if (!("serviceWorker" in navigator)) return;   // http 打开时没有（要 https）
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  const canPush = "PushManager" in window && "Notification" in window;
  const reg = navigator.serviceWorker.register("/sw.js");

  navigator.serviceWorker.addEventListener("message", (e) => {   // 点了通知、网页本来就开着
    const room = e.data && e.data.type === "open-room" ? Number(e.data.room) : 0;
    if (room && typeof joinRoom === "function") joinRoom(room);
  });

  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
  async function api(method, body) {
    const r = await fetch("/api/push", {method, headers: {"Content-Type": "application/json",
      "Authorization": "Bearer " + (localStorage.getItem("rh_token") || "")}, body: body ? JSON.stringify(body) : undefined});
    if (!r.ok) throw new Error(r.status === 401 ? "token 不对" : "服务器回 " + r.status);
    return r.json();
  }
  // 订阅并登记到 hub。每次打开网页都登记一遍（同一 endpoint 只是覆盖）：hub 的库清过、浏览器换了 endpoint 都能接上。
  // 服务器换了钥匙（vapid_private.pem 丢了重新生成）：旧订阅推不过来，退订重订。
  async function sync() {
    if (!localStorage.getItem("rh_token")) return;
    const {key} = await api("GET");
    await reg;
    const pm = (await navigator.serviceWorker.ready).pushManager;   // 刚注册的还没激活时 subscribe 会报错，等它激活
    let sub = await pm.getSubscription();
    const old = sub && sub.options && sub.options.applicationServerKey;
    if (sub && old && b64u(old) !== key) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await pm.subscribe({userVisibleOnly: true, applicationServerKey: unb64u(key)});
    await api("POST", sub.toJSON());
  }

  const bar = document.createElement("div");
  bar.id = "pushbar"; bar.hidden = true; bar.setAttribute("role", "status");
  const css = document.createElement("style");
  css.textContent = `#pushbar { flex:none; background:var(--side,#2b2d31); color:var(--text,#dbdee1); font-size:13px; padding:6px 12px;
    display:flex; align-items:center; gap:8px; justify-content:center; text-align:center; }
    #pushbar[hidden] { display:none; }
    #pushbar button { border:none; border-radius:4px; padding:4px 10px; background:var(--blurple,#5865f2); color:#fff; font-weight:600; cursor:pointer; flex:none; }
    #pushbar .err { color:var(--red,#f23f43); }`;
  function show(html) { bar.innerHTML = html; bar.hidden = !html; }
  function render(err) {
    if (ios && !standalone && !canPush) {
      return show("苹果手机要先在 Safari 的分享菜单里点「添加到主屏幕」，从主屏幕图标打开才能收到通知");
    }
    if (!canPush || Notification.permission === "denied") return show("");
    if (Notification.permission === "granted" && !err) return show("");
    show(`<span>有人 @ 你、角色出错或等你批准时，在这台设备上弹通知</span><button type="button">开通知</button>` +
         (err ? `<span class="err">${String(err).replace(/[&<>]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c]))}</span>` : ""));
  }
  bar.addEventListener("click", async (e) => {
    if (!e.target.closest("button")) return;
    try {
      if (await Notification.requestPermission() !== "granted") return render();
      await sync();
      render();
    } catch (err) { render("没开成：" + (err.message || err)); }
  });
  function resync() {   // 已经给过权限：悄悄登记；失败（多半是还没登录）下次回到前台再试
    if (canPush && Notification.permission === "granted") sync().then(() => render(), (e) => console.warn("[push]", e));
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) resync(); });
  function mount() {
    document.head.appendChild(css);
    const anchor = document.getElementById("banner");
    if (anchor) anchor.after(bar); else document.body.prepend(bar);
    render();
    resync();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
