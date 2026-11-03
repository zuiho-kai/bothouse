/** Recently used slash commands, newest first, kept in localStorage.
    Small enough to live on the page; no store needed. */
const KEY = 'cc_cmd_recent';
const LIMIT = 5;

export function readRecent(storage: Storage = localStorage): string[] {
  try {
    const raw = storage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string').slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function pushRecent(cmd: string, storage: Storage = localStorage): string[] {
  const next = [cmd, ...readRecent(storage).filter((c) => c !== cmd)].slice(0, LIMIT);
  try {
    storage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A full or blocked storage only costs the shortcut list, never the command itself.
  }
  return next;
}
