import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectDetail from './ProjectDetail';

// #636: the providers tab said "No providers configured for this project" while the add dialog said
// "All global providers are already linked". Both are explained by agent_types: a global provider only serves
// the CLIs it lists (config.go ResolveProviderRefs), and provider_refs keeps the name after the backend starts
// skipping it. The two views must tell the same story.
const state: {
  project: Record<string, unknown>;
  providers: unknown[];
  globals: unknown[];
  savedRefs: string[][];
} = { project: {}, providers: [], globals: [], savedRefs: [] };

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key, i18n: { language: 'zh', changeLanguage: vi.fn() } }) }));
vi.mock('@/api/projects', () => ({
  getProject: async () => state.project,
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  listAgentTypes: async () => ({ agents: ['codex', 'claudecode'], platforms: [] }),
  shownName: (p?: { display_name?: string; name?: string } | null) => p?.display_name || p?.name || '',
}));
vi.mock('@/api/providers', () => ({
  listProviders: async () => ({ providers: state.providers, active_provider: '' }),
  addProvider: vi.fn(), removeProvider: vi.fn(), activateProvider: vi.fn(),
  listGlobalProviders: async () => ({ providers: state.globals }),
  saveProviderRefs: async (_name: string, refs: string[]) => { state.savedRefs.push(refs); return { message: 'ok' }; },
}));
vi.mock('@/api/heartbeat', () => ({
  getHeartbeat: async () => null, pauseHeartbeat: vi.fn(), resumeHeartbeat: vi.fn(),
  triggerHeartbeat: vi.fn(), setHeartbeatInterval: vi.fn(),
}));
vi.mock('@/api/status', () => ({ restartSystem: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project = (agentType: string, providerRefs: string[]) => ({
  name: 'deepseek-DSH', display_name: 'deepseek-DSH', name_customized: false, agent_type: agentType,
  work_dir: '/tmp/work', agent_mode: 'default', provider_refs: providerRefs, platforms: [], sessions_count: 0,
  active_session_keys: [], platform_configs: [],
  settings: { admin_from: '', language: 'zh', disabled_commands: [] },
});

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
beforeEach(() => {
  state.project = project('codex', []);
  state.providers = [];
  state.globals = [];
  state.savedRefs = [];
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
});

const render = async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(
    <MemoryRouter initialEntries={['/projects/deepseek-DSH']}>
      <Routes><Route path="/projects/:name" element={<ProjectDetail />} /></Routes>
    </MemoryRouter>,
  ));
  await act(async () => {});
};
// The add-provider dialog is a createPortal into document.body, so query the whole document.
const clickText = async (text: string) => {
  const el = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  expect(el).toBeTruthy();
  await act(async () => el!.click());
};
const text = () => document.body.textContent || '';

describe('project providers vs "link global" dialog (#636)', () => {
  it('says there are no global providers instead of claiming all are linked', async () => {
    await render();
    await clickText('projects.tabs.providers');
    expect(text()).toContain('No providers configured for this project.');
    await clickText('providers.add');
    expect(text()).toContain('No global providers yet. Create one on the Providers page first.');
    expect(text()).not.toContain('All global providers are already linked.');
  });

  it('explains that the linked providers do not fit the agent type instead of calling the project empty', async () => {
    // The reported state: the ref is still linked, but the provider only serves claudecode, so the project's
    // resolved provider list is empty while the dialog used to say everything was linked.
    state.project = project('codex', ['gpt5']);
    state.globals = [{ name: 'gpt5', model: 'gpt-5', agent_types: ['claudecode'] }];
    await render();
    await clickText('projects.tabs.providers');
    expect(text()).toContain('Linked global providers do not match this project\'s agent type.');
    expect(text()).not.toContain('No providers configured for this project.');
    await clickText('providers.add');
    expect(text()).toContain('Linked global providers do not match this project\'s agent type.');
    expect(text()).not.toContain('All global providers are already linked.');
  });

  it('still says all linked when every global provider really is linked', async () => {
    state.project = project('codex', ['gpt5']);
    state.globals = [{ name: 'gpt5', model: 'gpt-5', agent_types: ['codex'] }];
    state.providers = [{ name: 'gpt5', active: true, model: 'gpt-5', base_url: '' }];
    await render();
    await clickText('projects.tabs.providers');
    expect(text()).toContain('gpt5');
    await clickText('providers.add');
    expect(text()).toContain('All global providers are already linked.');
    expect(text()).not.toContain('No global provider matches this project\'s agent type.');
  });

  it('offers a compatible unlinked global provider and links it', async () => {
    state.globals = [{ name: 'gpt5', model: 'gpt-5', agent_types: ['codex'] }];
    await render();
    await clickText('projects.tabs.providers');
    await clickText('providers.add');
    expect(text()).not.toContain('No global providers yet.');
    await clickText('gpt5');
    expect(state.savedRefs).toEqual([['gpt5']]);
  });
});
