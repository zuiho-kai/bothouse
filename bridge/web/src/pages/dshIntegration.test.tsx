// Node's test-only fixture reader; browser builds do not import this test module.
// @ts-expect-error The project intentionally does not depend on Node type declarations.
import { readFileSync } from 'node:fs';
declare const process: { env: Record<string, string | undefined> };
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dshChannelsUrl } from '@/lib/collabPages';
import api from '@/api/client';
import Dashboard from './Dashboard';
import RoleList from './Roles/RoleList';
import SessionList from './Sessions/SessionList';
import BridgeAdapters from './Bridge/BridgeAdapters';
import ProjectList from './Projects/ProjectList';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : k, i18n: { language: 'zh' } }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let container: HTMLDivElement;
const role = { name: 'alice', display_name: 'Alice', agent_type: 'codex', model: 'gpt-test', online: true, busy: false, current_task: '', paused: false, platforms: [], sessions_count: 0, source: 'dsh' };
const channel = { id: 'c1', name: 'general', kind: 'chat', updated_at: '2026-11-05T00:00:00Z', last_message: { name: 'Alice', content: 'hello from DSH', role: 'assistant', timestamp: '2026-11-05T00:00:00Z' } };
const running = { running: true, status: 'running', members: [role], channels: [channel] };
let responses: Record<string, unknown>;
async function render(path: string) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method).toBe('GET');
    const key = String(input).replace('/api/v1', '').split('?')[0];
    if (!(key in responses)) throw new Error(`Unexpected endpoint ${key}`);
    const data = responses[key];
    if (data instanceof Error) throw data;
    return { status: 200, json: async () => ({ ok: true, data }) };
  }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/" element={<Dashboard />} /><Route path="/roles" element={<RoleList />} /><Route path="/sessions" element={<SessionList />} /><Route path="/bridge" element={<BridgeAdapters />} /><Route path="/projects" element={<ProjectList />} /><Route path="/setup" element={<div>SETUP PAGE</div>} />
  </Routes></MemoryRouter>); });
  await act(async () => {});
  return container;
}
function setup(summary: unknown = running) {
  responses = { '/status': { version: 'test', uptime_seconds: 1, projects_count: 0, connected_platforms: [], bridge_adapters: [] }, '/projects': { projects: [] }, '/dsh/summary': summary, '/roles': { roles: [role], dsh: { status: 'running' } }, '/bridge/adapters': { adapters: [] }, '/setup/dsh/status': { found: true, plugin_installed: true } };
}
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.unstubAllGlobals(); });
describe('DSH API to pages', () => {
  it('displays real members and channels without counting them as projects', async () => {
    setup(); let el = await render('/'); expect(el.textContent).toContain('Alice'); expect(el.textContent).toContain('hello from DSH'); expect(el.textContent).toContain('dashboard.projects0');
    act(() => root.unmount()); el.remove(); el = await render('/roles'); expect(el.textContent).toContain('Alice'); expect(el.textContent).toContain('gpt-test');
    act(() => root.unmount()); el.remove(); el = await render('/sessions'); expect(el.textContent).toContain('#general'); expect(el.textContent).toContain('hello from DSH'); expect(el.textContent).toContain('0 projects.title');
  });
  it('counts running DSH once even when empty and already listed', async () => {
    setup({ running: true, status: 'running', members: [], channels: [] });
    let el = await render('/bridge'); expect(el.textContent).toContain('1 bridge.platform'); expect(el.textContent?.toLowerCase()).toContain('dsh');
    act(() => root.unmount()); el.remove(); (responses['/status'] as { connected_platforms: string[] }).connected_platforms = ['DSH'];
    el = await render('/bridge'); expect(el.textContent).toContain('1 bridge.platform');
  });
  it('shows DSH errors alongside bridge data and channel read errors', async () => {
    setup({ running: false, status: 'error', error: 'source failed', members: [], channels: [] }); responses['/roles'] = { roles: [role], dsh: { status: 'error', error: 'source failed' } };
    let el = await render('/roles'); expect(el.textContent).toContain('Alice'); expect(el.textContent).toContain('source failed');
    act(() => root.unmount()); el.remove(); el = await render('/sessions'); expect(el.textContent).toContain('source failed');
  });
  it('retains bridge data alongside DSH and keeps project counts separate', async () => {
    setup(); const bridgeRole = { ...role, name: 'bridge', display_name: 'Bridge Role', source: 'bridge' };
    responses['/roles'] = { roles: [bridgeRole, role], dsh: { status: 'running' } };
    responses['/projects'] = { projects: [{ name: 'bridge', display_name: 'Bridge Role', agent_type: 'codex', platforms: ['discord'], sessions_count: 0, heartbeat_enabled: false }] };
    responses['/projects/bridge/sessions'] = { sessions: [], active_keys: {} };
    (responses['/status'] as { connected_platforms: string[]; projects_count: number }).connected_platforms = ['discord'];
    (responses['/status'] as { projects_count: number }).projects_count = 1;
    let el = await render('/roles'); expect(el.textContent).toContain('Bridge Role'); expect(el.textContent).toContain('Alice');
    act(() => root.unmount()); el.remove(); el = await render('/'); expect(el.textContent).toContain('dashboard.projects1'); expect(el.textContent).toContain('dashboard.platforms2'); expect(el.textContent).toContain('Bridge Role'); expect(el.textContent).toContain('Alice');
    act(() => root.unmount()); el.remove(); el = await render('/projects'); expect(el.textContent).toContain('Bridge Role'); expect(el.textContent).not.toContain('SETUP PAGE');
  });
  it('deduplicates a DSH bot matching a bridge project while keeping its bridge controls', async () => {
    const bot = { ...role, name: 'dsh:bridge', display_name: 'Duplicate Bot', source: 'dsh' };
    const bridgeRole = { ...role, name: 'bridge', display_name: 'Bridge Role', source: 'bridge' };
    setup({ ...running, members: [bot, role] });
    responses['/roles'] = { roles: [bridgeRole, bot, role], dsh: { status: 'running' } };
    responses['/projects'] = { projects: [{ name: 'bridge', display_name: 'Bridge Role', agent_type: 'codex', platforms: ['discord'], sessions_count: 0, heartbeat_enabled: false }] };
    responses['/projects/bridge/sessions'] = { sessions: [], active_keys: {} };
    (responses['/status'] as { projects_count: number }).projects_count = 1;
    let el = await render('/roles');
    expect(el.textContent).toContain('Bridge Role'); expect(el.textContent).toContain('Alice'); expect(el.textContent).not.toContain('Duplicate Bot');
    act(() => root.unmount()); el.remove(); el = await render('/');
    expect(el.textContent).toContain('dashboard.projects1'); expect(el.textContent).toContain('Alice'); expect(el.textContent).not.toContain('Duplicate Bot');
  });
  it('shows channel message failures separately from empty channels', async () => {
    setup({ ...running, channels: [{ ...channel, last_message: null, error: 'message read failed' }, { ...channel, id: 'c2', name: 'empty', last_message: null, error: undefined }] });
    // 对话页的 DSH 频道行只显示中文短提示，不再拼后端英文原文（SessionList.tsx:299 用 dsh.messagesError 替换了 ch.error）。
    const el = await render('/sessions'); expect(el.textContent).toContain('消息读取失败'); expect(el.textContent).not.toContain('message read failed'); expect(el.textContent).toContain('还没有消息');
  });
  // #226 11:38 用户截图：两行红字说的是同一个原因，角色管理页读不到成员时先说清插件没启动。
  it('explains an unreadable DSH once instead of repeating it as a roster error', async () => {
    const why = '频道插件没有启动——dsh web 在跑，但 conest-collab 没挂上 /collab 路由（HTTP 404）。';
    setup({ running: false, status: 'error', error: why, members: [], channels: [] });
    responses['/roles'] = { roles: [], dsh: { status: 'error', error: why } };
    responses['/dsh/members'] = new Error(why);
    const el = await render('/roles');
    expect(el.textContent).toContain('DSH 读取失败');
    expect(el.textContent).toContain(why);
    expect(el.textContent).not.toContain('dshManage.rosterError');
  });
  it('keeps the roster error when DSH runs but only the member list fails', async () => {
    setup();
    responses['/roles'] = { roles: [], dsh: { status: 'running' } };
    responses['/dsh/members'] = new Error('invalid DSH response');
    const el = await render('/roles');
    expect(el.textContent).toContain('dshManage.rosterError');
    expect(el.textContent).toContain('invalid DSH response');
  });
  it('shows request rejection and preserves bridge source', async () => {
    setup(new Error('network failed')); (responses['/status'] as { connected_platforms: string[] }).connected_platforms = ['discord'];
    const el = await render('/bridge'); expect(el.textContent).toContain('network failed'); expect(el.textContent).toContain('discord');
  });
  it('keeps configured or unreadable DSH on projects, but routes a confirmed fresh install', async () => {
    setup(); let el = await render('/projects'); expect(el.textContent).not.toContain('SETUP PAGE'); expect(el.querySelector('[data-testid="open-setup-wizard"]')).toBeTruthy(); expect(el.textContent).toContain('暂无桥接项目'); expect(el.textContent).toContain('DSH 已接入'); expect(el.querySelector('a[href]')?.getAttribute('href')).toBe(dshChannelsUrl(undefined, api.getToken()));
    await act(async () => window.dispatchEvent(new Event('cc:refresh'))); expect(el.textContent).toContain('暂无桥接项目');
    responses['/setup/dsh/status'] = new Error('refresh failed'); await act(async () => window.dispatchEvent(new Event('cc:refresh'))); expect(el.textContent).toContain('refresh failed'); expect(el.textContent).not.toContain('DSH 已接入');
    act(() => root.unmount()); el.remove(); setup({ running: false, status: 'stopped', members: [], channels: [] }); el = await render('/projects'); expect(el.textContent).not.toContain('SETUP PAGE'); expect(el.textContent).toContain('DSH 未运行'); expect(el.textContent).toContain('DSH 已安装'); expect(el.textContent).toContain('暂无桥接项目'); expect(el.querySelector('a[href]')?.getAttribute('href')).toBe(dshChannelsUrl(undefined, api.getToken()));
    act(() => root.unmount()); el.remove(); setup(new Error('network failed')); el = await render('/projects'); expect(el.textContent).toContain('network failed'); expect(el.textContent).not.toContain('SETUP PAGE');
    act(() => root.unmount()); el.remove(); setup(); responses['/setup/dsh/status'] = new Error('install detection failed'); el = await render('/projects'); expect(el.textContent).toContain('install detection failed'); expect(el.textContent).not.toContain('SETUP PAGE'); expect(el.textContent).not.toContain('接入第一个');
    act(() => root.unmount()); el.remove(); setup({ running: false, status: 'stopped', members: [], channels: [] }); responses['/setup/dsh/status'] = { found: true, plugin_installed: false }; el = await render('/projects'); expect(el.textContent).toContain('SETUP PAGE');
  });
});

// Optional cross-stack contract: data payloads exported by the Go management-route test.
// Run: BOTHOUSE_PANEL_CONTRACT_IN=<path> npm test -- src/pages/dshIntegration.test.tsx
const contractPath = process.env.BOTHOUSE_PANEL_CONTRACT_IN;
const contractTest = contractPath ? it : it.skip;
contractTest('renders Go management route contract scenarios through the API client', async () => {
  type Scenario = {
    roles: { roles: typeof role[]; dsh?: { status: string; error?: string } };
    summary: typeof running & { error?: string };
    projects: { projects: { name: string }[] };
    status: unknown;
  };
  const { scenarios } = JSON.parse(readFileSync(contractPath!, 'utf8')) as { scenarios: Record<string, Scenario> };
  async function page(name: string, path: string) {
    const fixture = scenarios[name];
    expect(fixture, `missing scenario ${name}`).toBeTruthy();
    responses = { '/roles': fixture.roles, '/dsh/summary': fixture.summary, '/projects': fixture.projects, '/status': fixture.status, '/setup/dsh/status': { found: name !== 'fresh', plugin_installed: name !== 'fresh' }, '/bridge/adapters': { adapters: [] } };
    for (const project of fixture.projects.projects || []) responses[`/projects/${project.name}/sessions`] = { sessions: [], active_keys: {} };
    return render(path);
  }
  function close() { act(() => root.unmount()); container.remove(); }
  let el = await page('bridge_only', '/roles');
  const onlyBridge = scenarios.bridge_only.roles.roles[0]; expect(el.textContent).toContain(onlyBridge.display_name || onlyBridge.name); close();
  el = await page('dsh_only', '/roles');
  const member = scenarios.dsh_only.roles.roles.find((item) => item.source === 'dsh');
  expect(member).toBeTruthy(); expect(el.textContent).toContain(member!.display_name || member!.name);
  const noModel = scenarios.dsh_only.roles.roles.find((item) => item.model === ''); expect(noModel).toBeTruthy();
  const noModelCard = [...el.querySelectorAll('article')].find((card) => card.textContent?.includes(noModel!.display_name || noModel!.name));
  expect(noModelCard?.textContent).toContain('未知'); close();
  el = await page('dsh_only', '/sessions');
  const channel = scenarios.dsh_only.summary.channels[0]; expect(channel).toBeTruthy(); expect(el.textContent).toContain(channel.name);
  if (channel.last_message) expect(el.textContent).toContain(channel.last_message.content); close();
  el = await page('mixed', '/roles');
  const bridgeRole = scenarios.mixed.roles.roles.find((item) => item.source !== 'dsh'); expect(bridgeRole).toBeTruthy(); expect(el.textContent).toContain(bridgeRole!.display_name || bridgeRole!.name);
  const dshRole = scenarios.mixed.roles.roles.find((item) => item.source === 'dsh'); expect(dshRole).toBeTruthy(); expect(el.textContent).toContain(dshRole!.display_name || dshRole!.name); close();
  el = await page('error', '/roles'); expect(scenarios.error.roles.dsh?.status).toBe('error'); expect(el.textContent).toContain('DSH 读取失败');
  if (scenarios.error.roles.dsh?.error) expect(el.textContent).toContain(scenarios.error.roles.dsh.error); close();
  el = await page('stopped_configured', '/projects'); expect(el.textContent).not.toContain('SETUP PAGE'); expect(el.textContent).toContain('DSH 未运行'); close();
  el = await page('fresh', '/projects'); expect(el.textContent).toContain('SETUP PAGE'); close();
  el = await page('partial', '/sessions');
  const failed = scenarios.partial.summary.channels.find((item) => 'error' in item && item.error); expect(failed).toBeTruthy(); expect(el.textContent).toContain('消息读取失败');
});
