import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectList from './ProjectList';
import type { ProjectSummary } from '@/api/projects';

const state: { projects: ProjectSummary[]; deleted: string[] } = { projects: [], deleted: [] };

const dict: Record<string, string> = { 'common.delete': '删除', 'common.cancel': '取消', 'common.close': '关闭' };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: any) => dict[key] ?? (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/api/projects', async () => {
  const actual = await vi.importActual<typeof import('@/api/projects')>('@/api/projects');
  return {
    ...actual,
    listProjects: async () => ({ projects: state.projects }),
    getProject: async (name: string) => ({
      ...state.projects.find((p) => p.name === name),
      platforms: [{ type: 'telegram', connected: true }],
      active_session_keys: [],
      settings: { admin_from: '', language: 'zh', disabled_commands: [] },
      heartbeat: { enabled: false, paused: false, interval_mins: 0, session_key: '' },
    }),
    deleteProject: async (name: string) => {
      state.deleted.push(name);
      return { message: 'ok', restart_required: false };
    },
  };
});
vi.mock('@/api/providers', () => ({
  listProviders: async () => ({ providers: [], active_provider: '' }),
  addProvider: vi.fn(), removeProvider: vi.fn(), activateProvider: vi.fn(),
  listGlobalProviders: async () => ({ providers: [] }), saveProviderRefs: vi.fn(),
}));
vi.mock('@/api/heartbeat', () => ({
  getHeartbeat: async () => null, pauseHeartbeat: vi.fn(), resumeHeartbeat: vi.fn(),
  triggerHeartbeat: vi.fn(), setHeartbeatInterval: vi.fn(),
}));
vi.mock('@/api/status', () => ({ restartSystem: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

const seed = () => {
  state.projects = [
    { name: 'coder', display_name: '鲸鱼娘', agent_type: 'codex', platforms: ['telegram', 'discord'], sessions_count: 3, heartbeat_enabled: true },
    { name: 'writer', display_name: '写字机', agent_type: 'claudecode', platforms: [], sessions_count: 0, heartbeat_enabled: false },
  ];
  state.deleted = [];
};

beforeEach(() => {
  seed();
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
      <MemoryRouter initialEntries={['/projects']}>
        <Routes>
          <Route path="/projects" element={<ProjectList />} />
          <Route path="/projects/:name" element={<div>detail page</div>} />
          <Route path="/setup" element={<div>setup page</div>} />
        </Routes>
      </MemoryRouter>
    );
  });
  await act(async () => {});
};

const cards = () => [...container.querySelectorAll('article')];
const buttonContaining = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

const search = async (value: string) => {
  const input = container.querySelector('input[type="search"]') as HTMLInputElement;
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('ProjectList', () => {
  it('renders every project with its display name and agent type', async () => {
    await render();
    expect(cards()).toHaveLength(2);
    expect(container.textContent).toContain('鲸鱼娘');
    expect(container.textContent).toContain('写字机');
    expect(container.textContent).toContain('codex');
  });

  it('narrows the grid to the search term', async () => {
    await render();
    await search('鲸鱼');
    expect(cards()).toHaveLength(1);
    expect(container.textContent).toContain('鲸鱼娘');
    expect(container.textContent).not.toContain('写字机');
  });

  it('shows a distinct empty state when filters match nothing', async () => {
    await render();
    await search('不存在的项目');
    expect(cards()).toHaveLength(0);
    expect(container.textContent).toContain('没有符合筛选的项目');
    expect(container.textContent).not.toContain('尚未配置项目');
  });

  it('reveals the bulk bar only after a card is selected', async () => {
    await render();
    const bulkBar = () => container.querySelector('[data-testid="project-bulk-bar"]');
    expect(bulkBar()!.getAttribute('aria-hidden')).toBe('true');

    const selectBox = [...container.querySelectorAll('[role="checkbox"]')][0] as HTMLButtonElement;
    expect(selectBox).toBeTruthy();
    await act(async () => selectBox.click());

    expect(selectBox.getAttribute('aria-checked')).toBe('true');
    expect(bulkBar()!.getAttribute('aria-hidden')).toBe('false');
    expect(bulkBar()!.textContent).toContain('已选中的项目可批量删除');
  });

  it('deletes the selected project after confirmation', async () => {
    await render();
    const selectBox = [...container.querySelectorAll('[role="checkbox"]')][0] as HTMLButtonElement;
    await act(async () => selectBox.click());

    const bulkDelete = buttonContaining('删除');
    expect(bulkDelete).toBeTruthy();
    await act(async () => bulkDelete!.click());

    // 确认框走 portal 挂在 body 上，不在卡片容器里。
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain('删除项目');

    const confirm = [...dialog!.querySelectorAll('button')]
      .filter((b) => b.textContent?.trim() === '删除')
      .pop();
    await act(async () => confirm!.click());
    await act(async () => {});

    expect(state.deleted).toEqual(['coder']);
  });

  it('opens the detail drawer from a card without leaving the list', async () => {
    await render();
    const preview = container.querySelector('article button[aria-label^="预览"]') as HTMLButtonElement;
    expect(preview).toBeTruthy();
    await act(async () => preview.click());
    await act(async () => {});

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain('鲸鱼娘');
    expect(cards()).toHaveLength(2);
  });

  it('switches to the compact list view and keeps every project', async () => {
    await render();
    const listToggle = container.querySelector('button[aria-label="列表视图"]') as HTMLButtonElement;
    await act(async () => listToggle.click());

    expect(cards()).toHaveLength(0);
    expect(container.textContent).toContain('鲸鱼娘');
    expect(container.textContent).toContain('写字机');
  });
});
