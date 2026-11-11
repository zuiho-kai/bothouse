// #610: the overview's left column ended after the roles and left half a screen empty, and every DSH
// channel row printed the backend's English read error. Sessions per project now sit under 正在发生, and
// failed channels collapse into one short note instead of one error per row.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : typeof fallback === 'object' && fallback && 'defaultValue' in fallback ? String((fallback as { defaultValue: string; count?: number }).defaultValue).replace('{{count}}', String((fallback as { count?: number }).count)) : k, i18n: { language: 'zh' } }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let container: HTMLDivElement;

const now = new Date().toISOString();
async function renderDashboard(channels: unknown[]) {
  const responses: Record<string, unknown> = {
    '/status': { version: 'test', uptime_seconds: 1, projects_count: 1, connected_platforms: ['discord'], bridge_adapters: [] },
    '/projects': { projects: [{ name: 'cjiang', sessions_count: 3 }] },
    '/dsh/summary': { running: true, status: 'running', members: [], channels },
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

describe('overview layout (#610)', () => {
  it('puts sessions per project in the left column, under 正在发生', async () => {
    const el = await renderDashboard([]);
    const aside = el.querySelector('aside')!;
    const sessionsHead = [...el.querySelectorAll('h2')].find((h) => h.textContent === '各项目会话数');
    expect(sessionsHead).toBeDefined();
    expect(aside.contains(sessionsHead!)).toBe(false);
    const leftCol = aside.previousElementSibling!;
    const heads = [...leftCol.querySelectorAll('h2')].map((h) => h.textContent);
    expect(heads.indexOf('正在发生')).toBeLessThan(heads.indexOf('各项目会话数'));
  });

  it('shows one short note for unreadable channels instead of the raw error on every row', async () => {
    const el = await renderDashboard([
      { id: '1', name: 'general', updated_at: now, error: 'DSH channel messages could not be read' },
      { id: '2', name: 'ws1', updated_at: now, error: 'DSH channel messages could not be read' },
      { id: '3', name: 'ws2', updated_at: now, last_message: { role: 'user', name: 'User', content: 'hi', timestamp: now } },
      { id: '4', name: 'ws3', updated_at: now },
    ]);
    expect(el.textContent).not.toContain('could not be read');
    expect(el.querySelector('[data-testid="dashboard-dsh-read-error"]')?.textContent).toBe('2 个频道的消息暂时读不到');
    expect(el.textContent).toContain('User：hi');
    expect(el.textContent).toContain('还没有消息');
  });
});
