import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Claude reports a provider-local reset clock; convert it using its IANA zone,
// including calendar dates for weekly limits. Missing deadlines stay unknown.
function resetClock(raw, now) {
  const match = /^(?:([A-Za-z]{3})\s+(\d+),?\s+)?(\d{1,2})(?::(\d{2}))?(am|pm)?\s+\(([^)]+)\)$/i.exec(raw);
  if (!match) return undefined;
  const [, month, day, hour, minute, period, timeZone] = match;
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
  const parts = at => Object.fromEntries(fmt.formatToParts(at).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  const current = parts(now);
  const h = period ? Number(hour) % 12 + (/pm/i.test(period) ? 12 : 0) : Number(hour);
  if (h > 23 || Number(minute ?? 0) > 59) return undefined;
  const m = month ? 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(month.toLowerCase()) + 1 : current.month;
  if (!m) return undefined;
  const local = Date.UTC(current.year, m - 1, Number(day ?? current.day), h, Number(minute ?? 0));
  const utc = local => {
    let at = local;
    for (let i = 0; i < 3; i++) {
      const p = parts(at);
      at += local - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    }
    return at;
  };
  let at = utc(local);
  if (at <= now) at = utc(month ? Date.UTC(current.year + 1, m - 1, Number(day), h, Number(minute ?? 0)) : local + 86400000);
  return at;
}

/** Same deadline and directory as bridge/core/quota_cooling.go. */
export function quotaDeadline(event, now = Date.now()) {
  const data = event?.data ?? event;
  const report = data?.usage ?? data?.quota;
  let until = 0;
  for (const bucket of report?.buckets ?? report?.Buckets ?? []) {
    for (const w of bucket.windows ?? bucket.Windows ?? []) {
      const used = w.usedPercent ?? w.used_percent ?? w.UsedPercent;
      const seconds = w.windowSeconds ?? w.window_seconds ?? w.WindowSeconds;
      // Only a reported limit counts: a window merely near its limit still has usable quota
      // (user 2026-10-28「或者报错再交接，提前量太多，有点浪费了」).
      if (!(bucket.limitReached || bucket.LimitReached || used >= 100)) continue;
      const at = (w.resetAtUnix ?? w.reset_at_unix ?? w.ResetAtUnix) * 1000 ||
        now + (w.resetAfterSeconds ?? w.reset_after_seconds ?? w.ResetAfterSeconds ?? 0) * 1000;
      if (at > now) until = Math.max(until, at);
    }
  }
  const reset = data?.metadata?.quota_exhausted;
  const text = [data?.reason?.error?.message, data?.error?.message, typeof data?.error === 'string' ? data.error : '', reset].filter(Boolean).join(' ');
  if (/quota|resource_exhausted|(?:usage|session) limit|hit your limit/i.test(text) || reset !== undefined) {
    const duration = /resets in (?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i.exec(text);
    const delay = duration && (Number(duration[1] ?? 0) * 3600 + Number(duration[2] ?? 0) * 60 + Number(duration[3] ?? 0)) * 1000;
    const raw = reset ?? /resets?\s+(.+?\([^)]+\))/i.exec(text)?.[1] ?? '';
    let absolute;
    try { absolute = /^\d{4}-\d\d-\d\dT/.test(raw) ? Date.parse(raw) : resetClock(raw, now); }
    catch (error) { if (!(error instanceof RangeError)) throw error; } // invalid external IANA zone stays unknown
    if (delay > 0) until = Math.max(until, now + delay);
    if (absolute > now) until = Math.max(until, absolute);
  }
  return until || undefined;
}

export class QuotaCooling {
  constructor(hub, tasks, wake, directory, { now = Date.now } = {}) {
    this.hub = hub; this.tasks = tasks; this.wake = wake; this.directory = directory; this.now = now;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  read(id, receipt = false) {
    try { return JSON.parse(readFileSync(join(this.directory, `${id}${receipt ? '.takeover' : ''}.json`), 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') this.hub.logger?.warn?.('quota: cannot read %s: %s', id, error.message);
      return {};
    }
  }
  save(id, state, receipt = false) {
    const path = join(this.directory, `${id}${receipt ? '.takeover' : ''}.json`), temp = `${path}.tmp-${process.pid}`;
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600 }); renameSync(temp, path);
  }
  cooling(id) { return Date.parse(this.read(id).cooling_until ?? '') > this.now(); }
  observe(id, room, event) {
    // Bridge-backed roles own their cooldown file in Go; the host only reads it.
    if (this.hub.members.get(id)?.kind !== 'dsh') return;
    const until = quotaDeadline(event, this.now());
    if (!until) return;
    const state = this.read(id);
    if (Date.parse(state.cooling_until ?? '') >= until) return;
    state.cooling_until = new Date(until).toISOString();
    state.session = `cloud_web:room-${room}`;
    this.save(id, state);
  }
  candidate(room, title, from, reserved) {
    const code = /代码|编译|修复|code|\bPR\b/i.test(title);
    const rank = m => code ? /longniang|龙娘/.test(m.id + m.name) ? 0 : 1 : /jingyu|鲸鱼/.test(m.id + m.name) ? 0 : 1;
    const chat = this.hub.store.settingsRoom(room);
    const busy = id => [...this.hub.thinking].some(([r, ids]) => ids.has(id) && this.hub.store.settingsRoom(r) === chat) ||
      this.tasks.activeTasksOf(id).some(t => this.hub.store.settingsRoom(t.room_id) === chat);
    return this.hub.routableIn(room).filter(m => m.id !== from && m.online !== false && !this.cooling(m.id) &&
      !busy(m.id) && !reserved.has(m.id))
      .sort((a,b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0];
  }
  notice(room, key, text) {
    return this.hub.post(room, { authorKind: 'system', author: 'system', name: '额度交接', clientKey: key, text }).message;
  }
  tick() {
    for (const member of this.hub.routable()) {
      const quota = this.read(member.id);
      let state = this.read(member.id, true);
      if (!quota.cooling_until && !state.until) continue;
      if (!this.cooling(member.id)) {
        for (const [room, lead] of Object.entries(state.leads ?? {})) {
          if (this.hub.primaryIn(Number(room))?.id === lead.to) {
            this.hub.store.setLead(Number(room), member.id);
            this.notice(Number(room), `${member.id}-${state.until}-restore-${room}`, `${member.name} 额度恢复，主角色已切回。`);
          }
        }
        if (state.until) {
          this.save(member.id, {}, true);
          this.hub.emit({ type: 'rooms', rooms: this.hub.store.roomsView() });
        }
        continue;
      }
      // Extending a cooldown retains its receipts; a recovered generation starts fresh.
      if (!state.until) state = { until: quota.cooling_until, leads: {}, transfers: {} };
      const key = `${member.id}-${state.until}`;
      const reserved = new Set(Object.values(state.transfers).filter(t => !t.woken).map(t => t.to));
      for (const room of this.hub.store.rooms().filter(r => r.kind !== 'workspace')) {
        if (state.leads[room.id] || this.hub.primaryIn(room.id)?.id !== member.id) continue;
        const target = this.candidate(room.id, '', member.id, reserved);
        if (!target) continue;
        state.leads[room.id] = { to: target.id, woken: false };
        this.save(member.id, state, true);
        this.hub.store.setLead(room.id, target.id);
        this.hub.emit({ type: 'rooms', rooms: this.hub.store.roomsView() });
      }
      for (const [room, lead] of Object.entries(state.leads)) {
        if (lead.woken || this.cooling(lead.to)) continue;
        // Replay a crash between persisting intent and changing the selection.
        if (this.hub.primaryIn(Number(room))?.id === member.id) this.hub.store.setLead(Number(room), lead.to);
        if (this.hub.primaryIn(Number(room))?.id !== lead.to) continue;
        const msg = this.notice(Number(room), `${key}-lead-${room}`, `${member.name} 额度冷却，主角色交给 ${this.tasks.nameOf(lead.to)}。请接着推进未完成任务。`);
        if (this.wake(lead.to, msg)) { lead.woken = true; this.save(member.id, state, true); }
      }
      for (const task of this.tasks.activeTasksOf(member.id)) {
        if (state.transfers[task.id] || this.tasks.awaitingUser(task)) continue;
        // These rows mirror bridge-owned cards/workspaces. Go moves the original
        // journal and wakes its replacement; the next card update mirrors ownership.
        if (member.kind === 'bot' && ['card', 'workspace'].includes(task.source)) continue;
        const target = this.candidate(task.room_id, task.title, member.id, reserved);
        if (!target) continue;
        state.transfers[task.id] = { to: target.id, room: task.room_id, title: task.title, reason: task.reason, ref: task.ref, base: task.base, woken: false };
        this.save(member.id, state, true);
        this.tasks.reassignForQuota(task, target.id);
        reserved.add(target.id);
      }
      for (const [id, transfer] of Object.entries(state.transfers)) {
        if (transfer.woken || this.cooling(transfer.to)) continue;
        const task = this.tasks.q.get.get(Number(id));
        if (task?.owner === member.id) this.tasks.reassignForQuota(task, transfer.to);
        if (this.tasks.q.get.get(Number(id))?.owner !== transfer.to) continue;
        const msg = this.notice(transfer.room, `${key}-task-${id}`, `接手 #${id}「${transfer.title}」。原交接：${transfer.reason ?? ''}\n参照：${transfer.ref ?? ''}\n底分支：${transfer.base ?? ''}`);
        if (this.wake(transfer.to, msg)) { transfer.woken = true; this.save(member.id, state, true); }
      }
    }
  }
  start() { this.tick(); this.timer = setInterval(() => this.tick(), 2000); this.timer.unref(); }
  close() { clearInterval(this.timer); }
}

export const quotaDirectory = leadFile => join(dirname(leadFile), 'quota-cooling');
