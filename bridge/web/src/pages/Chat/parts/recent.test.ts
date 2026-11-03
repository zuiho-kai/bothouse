import { describe, expect, it } from 'vitest';
import { pushRecent, readRecent } from './recent';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  };
  return storage as unknown as Storage;
}

describe('recent command list', () => {
  it('starts empty', () => {
    expect(readRecent(fakeStorage())).toEqual([]);
  });

  it('puts the newest first and de-duplicates', () => {
    const s = fakeStorage();
    pushRecent('/model', s);
    pushRecent('/new', s);
    pushRecent('/model', s);
    expect(readRecent(s)).toEqual(['/model', '/new']);
  });

  it('keeps at most five', () => {
    const s = fakeStorage();
    ['/a', '/b', '/c', '/d', '/e', '/f'].forEach((c) => pushRecent(c, s));
    expect(readRecent(s)).toEqual(['/f', '/e', '/d', '/c', '/b']);
  });

  it('survives junk in storage', () => {
    expect(readRecent(fakeStorage({ cc_cmd_recent: 'not json' }))).toEqual([]);
    expect(readRecent(fakeStorage({ cc_cmd_recent: '{"a":1}' }))).toEqual([]);
  });
});
