// service worker：页面不在前台时收 hub 的推送、弹通知；点通知回到那个频道（rh/hub.py「手机通知」）。
// 不做离线缓存（用户没要）：所有请求照旧走网络。
'use strict';
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {body: e.data ? e.data.text() : ""}; }
  // 每条推送都要弹出来：苹果对收到推送却不弹通知的网页会撤掉推送权限
  e.waitUntil(self.registration.showNotification(d.title || "角色小家", {
    body: d.body || "", tag: d.tag, icon: "/icons/icon-192.png", data: {room: d.room, id: d.id}}));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const room = e.notification.data && e.notification.data.room;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({type: "window", includeUncontrolled: true});
    const w = wins.find(c => new URL(c.url).pathname === "/");
    if (w) {   // 网页开着：切到前台，换到那个频道（rh-push.js 收这条）
      await w.focus();
      if (room) w.postMessage({type: "open-room", room});
      return;
    }
    await self.clients.openWindow(room ? "/?room=" + room : "/");
  })());
});
