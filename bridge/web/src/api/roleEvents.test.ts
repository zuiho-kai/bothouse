import { afterEach, expect, it, vi } from 'vitest';
import api from './client';
import { subscribeRoleEvents } from './roleEvents';

afterEach(() => { vi.unstubAllGlobals(); api.setToken(''); });

it('keeps business error events distinct from connection errors and closes on unmount', () => {
  class Stream extends EventTarget {
    static current: Stream;
    onerror: ((event: Event) => void) | null = null;
    close = vi.fn();
    constructor(public url: string) { super(); Stream.current = this; }
  }
  vi.stubGlobal('EventSource', Stream);
  api.setToken('test token&');
  const handlers = { snapshot: vi.fn(), event: vi.fn(), error: vi.fn() };
  const close = subscribeRoleEvents(handlers);
  expect(new URL(Stream.current.url, location.origin).searchParams.get('token')).toBe('test token&');
  const businessError = new MessageEvent('error', { data: JSON.stringify({ type: 'error', role_key: 'bridge:test' }) });
  Stream.current.dispatchEvent(businessError);
  Stream.current.onerror?.(businessError);
  expect(handlers.event).toHaveBeenCalledOnce();
  expect(handlers.error).not.toHaveBeenCalled();
  Stream.current.onerror?.(new Event('error'));
  expect(handlers.error).toHaveBeenCalledOnce();
  close();
  expect(Stream.current.close).toHaveBeenCalledOnce();
});
