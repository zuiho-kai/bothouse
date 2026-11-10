// #591: the overview's 「Wiki 星河」 card had 1.1-ish contrast when measured against the canvas,
// because its text colour was tuned for the gradient and the gradient's light end is semi-transparent.
// The card now carries a solid accent base under the gradient and keeps the subtitle at full opacity.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : k, i18n: { language: 'zh' } }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let container: HTMLDivElement;

async function renderDashboard() {
  const responses: Record<string, unknown> = {
    '/status': { version: 'test', uptime_seconds: 1, projects_count: 0, connected_platforms: [], bridge_adapters: [] },
    '/projects': { projects: [] },
    '/dsh/summary': { running: true, status: 'running', members: [], channels: [] },
    '/roles': { roles: [], dsh: { status: 'running' } },
    '/modules': { modules: [], configured: 0 },
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const key = String(input).replace('/api/v1', '').split('?')[0];
    if (!(key in responses)) throw new Error(`Unexpected endpoint ${key}`);
    return { status: 200, json: async () => ({ ok: true, data: responses[key] }) };
  }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/']}><Routes><Route path="/" element={<Dashboard />} /></Routes></MemoryRouter>);
  });
  await act(async () => {});
  return container;
}

afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.unstubAllGlobals(); });

describe('overview Wiki 星河 card contrast', () => {
  it('puts a solid accent under the gradient instead of letting the canvas show through', async () => {
    const el = await renderDashboard();
    const card = el.querySelector<HTMLAnchorElement>('a[href="/wiki-galaxy"]');
    expect(card).not.toBeNull();
    const cls = card!.className.split(/\s+/);
    expect(cls).toContain('bg-accent');
    // the gradient keeps its look; only the see-through light end is gone
    expect(cls).toContain('bg-gradient-to-br');
    expect(cls.some((c) => /^from-accent\/\d+$/.test(c))).toBe(true);
  });

  it('keeps the subtitle at full opacity so its own contrast is not docked again', async () => {
    const el = await renderDashboard();
    const card = el.querySelector<HTMLAnchorElement>('a[href="/wiki-galaxy"]');
    const subtitle = card!.querySelectorAll('p')[1];
    expect(subtitle.className.split(/\s+/)).not.toContain('opacity-85');
  });
});