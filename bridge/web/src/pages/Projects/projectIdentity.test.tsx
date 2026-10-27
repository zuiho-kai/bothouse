import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectDetail from './ProjectDetail';

const updateProject = vi.fn(async (_name: string, _body: unknown) => ({ message: 'ok' }));
const project = {
  name: 'coder', display_name: 'Codex', name_customized: false, agent_type: 'codex',
  work_dir: '/tmp/work', agent_mode: 'default', provider_refs: [], platforms: [], sessions_count: 0,
  active_session_keys: [], platform_configs: [],
  settings: { admin_from: '', language: 'zh', disabled_commands: [] },
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key, i18n: { language: 'zh', changeLanguage: vi.fn() } }) }));
vi.mock('@/api/projects', () => ({
  getProject: async () => project,
  updateProject: (name: string, body: unknown) => updateProject(name, body),
  deleteProject: vi.fn(),
  listAgentTypes: async () => ({ agents: ['codex', 'claudecode'], platforms: [] }),
  shownName: (p?: { display_name?: string; name?: string } | null) => p?.display_name || p?.name || '',
}));
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
beforeEach(() => { updateProject.mockClear(); });
afterEach(() => { act(() => root?.unmount()); container?.remove(); });

const render = async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(
    <MemoryRouter initialEntries={['/projects/coder']}>
      <Routes><Route path="/projects/:name" element={<ProjectDetail />} /></Routes>
    </MemoryRouter>,
  ));
  await act(async () => {});
};
const clickText = async (text: string) => {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  expect(el).toBeTruthy();
  await act(async () => el!.click());
};
const setInput = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const setSelect = async (el: HTMLSelectElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('project detail settings naming', () => {
  it('shows the new backend label and leaves the name to the backend when the CLI changes', async () => {
    await render();
    await clickText('projects.tabs.settings');
    const name = [...container.querySelectorAll('input')].find((i) => i.value === 'Codex')!;
    expect(name).toBeTruthy();
    const agent = [...container.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'claudecode'))!;
    await setSelect(agent, 'claudecode');
    expect([...container.querySelectorAll('input')].some((i) => i.value === 'Claude Code')).toBe(true);
    expect(container.querySelector('h2')?.textContent).toBe('Claude Code');
    await clickText('common.save');
    expect(updateProject).toHaveBeenCalledWith('coder', expect.objectContaining({ agent_type: 'claudecode' }));
    const body = updateProject.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.display_name).toBeUndefined();
    expect(body.name_customized).toBeUndefined();
  });

  it('keeps an edited name across the CLI switch and saves it as customized', async () => {
    await render();
    await clickText('projects.tabs.settings');
    const name = [...container.querySelectorAll('input')].find((i) => i.value === 'Codex')!;
    await setInput(name, '小码');
    const agent = [...container.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'claudecode'))!;
    await setSelect(agent, 'claudecode');
    expect(name.value).toBe('小码');
    expect(container.querySelector('h2')?.textContent).toBe('小码·Claude Code');
    await clickText('common.save');
    expect(updateProject).toHaveBeenCalledWith('coder', expect.objectContaining({ display_name: '小码', name_customized: true, agent_type: 'claudecode' }));
  });
});
