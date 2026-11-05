import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionList from './SessionList';
import type { Session } from '@/api/sessions';

const state: { deleted: string[] } = { deleted: [] };

const dict: Record<string, string> = { 'common.delete': '删除', 'common.cancel': '取消', 'common.close': '关闭' };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: any) => dict[key] ?? (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

const session = (over: Partial<Session>): Session => ({
  id: 's1',
  session_key: 'telegram:1',
  name: '和肥鱼聊天',
  platform: 'telegram',
  agent_type: 'codex',
  active: true,
  live: true,
  created_at: '2026-11-03T10:00:00Z',
  updated_at: '2026-11-03T12:00:00Z',
  history_count: 3,
  last_message: { role: 'user', content: '帮我看下构建日志', timestamp: '2026-11-03T12:00:00Z' },
  ...over,
});

vi.mock('@/api/projects', async () => {
  const actual = await vi.importActual<typeof import('@/api/projects')>('@/api/projects');
  return {
    ...actual,
    listProjects: async () => ({
      projects: [
        { name: 'coder', display_name: '鲸鱼娘', agent_type: 'codex', platforms: [], sessions_count: 1, heartbeat_enabled: false },
        { name: 'writer', display_name: '写字机', agent_type: 'claudecode', platforms: [], sessions_count: 1, heartbeat_enabled: false },
      ],
    }),
  };
});

vi.mock('@/api/sessions', async () => {
  const actual = await vi.importActual<typeof import('@/api/sessions')>('@/api/sessions');
  return {
    ...actual,
    listSessions: async (project: string) => ({
      sessions: project === 'coder' ? [session({ id: 'a', name: '和肥鱼聊天' })] : [session({ id: 'b', name: '写周报', live: false })],
      active_keys: {},
    }),
    deleteSession: async (project: string, id: string) => {
      state.deleted.push(`${project}/${id}`);
      return { message: 'ok' };
    },
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  state.deleted = [];
  localStorage.clear();
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

const render = async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={['/sessions']}>
        <Routes>
          <Route path="/sessions" element={<SessionList />} />
          <Route path="/sessions/:project/:id" element={<div>chat page</div>} />
        </Routes>
      </MemoryRouter>
    );
  });
  await act(async () => {});
};

const cards = () => [...container.querySelectorAll('article')];

const search = async (value: string) => {
  const input = container.querySelector('input[type="search"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('SessionList', () => {
  it('lists sessions from every project with their project label', async () => {
    await render();
    expect(cards()).toHaveLength(2);
    expect(container.textContent).toContain('和肥鱼聊天');
    expect(container.textContent).toContain('写周报');
    expect(container.textContent).toContain('鲸鱼娘');
    expect(container.textContent).toContain('写字机');
    // The count says what it counts: not a bare number at the left of the filter row.
    expect(container.textContent).toContain('sessions.countAll'); // zh: 共 2 条
  });

  it('previews the last message from the other side of the conversation', async () => {
    await render();
    expect(container.textContent).toContain('帮我看下构建日志');
  });

  it('filters down to the searched session', async () => {
    await render();
    await search('周报');
    expect(cards()).toHaveLength(1);
    expect(container.textContent).toContain('写周报');
    expect(container.textContent).not.toContain('和肥鱼聊天');
  });

  it('filters by the online chip', async () => {
    await render();
    const liveChip = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('在线'))!;
    await act(async () => liveChip.click());
    expect(cards()).toHaveLength(1);
    expect(container.textContent).toContain('和肥鱼聊天');
  });

  it('reveals the bulk bar after selecting a session', async () => {
    await render();
    const bar = () => container.querySelector('[data-testid="session-bulk-bar"]');
    expect(bar()!.getAttribute('aria-hidden')).toBe('true');

    const box = [...container.querySelectorAll('[role="checkbox"]')][0] as HTMLButtonElement;
    await act(async () => box.click());
    expect(bar()!.getAttribute('aria-hidden')).toBe('false');
  });

  it('deletes the selected session through the confirmation dialog', async () => {
    await render();
    const box = [...container.querySelectorAll('[role="checkbox"]')][0] as HTMLButtonElement;
    await act(async () => box.click());

    const bulkDelete = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === '删除')!;
    await act(async () => bulkDelete.click());

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('删除会话');
    const confirm = [...dialog.querySelectorAll('button')].filter((b) => b.textContent?.trim() === '删除').pop()!;
    await act(async () => confirm.click());
    await act(async () => {});

    expect(state.deleted).toEqual(['coder/a']);
  });

  it('opens the session drawer with the full last message', async () => {
    await render();
    const preview = container.querySelector('article button[aria-label^="预览"]') as HTMLButtonElement;
    expect(preview).toBeTruthy();
    await act(async () => preview.click());
    await act(async () => {});

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain('帮我看下构建日志');
    expect(cards()).toHaveLength(2);
  });
});
