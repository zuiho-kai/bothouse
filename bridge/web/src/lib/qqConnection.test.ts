import { describe, expect, it } from 'vitest';
import { qqConnectionState } from './qqConnection';

const qq = (connected: boolean) => [{ type: 'qq', connected }];

describe('QQ panel connection state', () => {
  it('says connected only when the running bridge reports QQ ready', () => {
    expect(qqConnectionState({ configured: true, platforms: qq(true) })).toBe('connected');
  });

  it('separates "restarted but not connected" from "not restarted yet"', () => {
    // QQ was started and failed or dropped: the readiness bit is there and false.
    expect(qqConnectionState({ configured: true, platforms: qq(false) })).toBe('offline');
    // QQ is in config.toml but the running process does not have it at all.
    expect(qqConnectionState({ configured: true, platforms: [{ type: 'feishu', connected: true }] })).toBe('restart');
  });

  it('treats a save that needs a restart as not restarted even if the old address still connects', () => {
    expect(qqConnectionState({ configured: true, platforms: qq(true), pendingRestart: true })).toBe('restart');
  });

  it('stays silent instead of guessing before the platform list loads', () => {
    expect(qqConnectionState({ configured: true })).toBe('unknown');
    expect(qqConnectionState({ configured: true, platforms: undefined, pendingRestart: true })).toBe('unknown');
    expect(qqConnectionState({ configured: false, platforms: qq(true) })).toBe('unknown');
  });
});