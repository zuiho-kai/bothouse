import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleList from './RoleList';
import DSHAdd from '@/pages/Setup/DSHAdd';
import type { DSHCliOptions, DSHManagedMember, DSHModelRoute } from '@/api/dsh';
// @ts-expect-error The project intentionally does not depend on Node type declarations.
import { readFileSync } from 'node:fs';
declare const process: { env: Record<string, string | undefined> };

const mocks = vi.hoisted(() => ({ roles: vi.fn(), members: vi.fn(), routes: vi.fn(), options: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), status: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key }) }));
vi.mock('@/api/roles', () => ({ listRoles: mocks.roles, restartRole: vi.fn(), setRolePaused: vi.fn() }));
vi.mock('@/api/dsh', () => ({ listDSHMembers: mocks.members, getDSHModelRoutes: mocks.routes, getDSHCliOptions: mocks.options, createDSHMember: mocks.create, updateDSHMember: mocks.update, deleteDSHMember: mocks.remove }));
vi.mock('@/api/wizard', async original => ({ ...await original<object>(), getDSHStatus: mocks.status }));
vi.mock('@/pages/Setup/DSHSetup', () => ({ default: () => <div>INSTALL WIZARD</div> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let container: HTMLDivElement;
const role = (id: string) => ({ name: `dsh:${id}`, display_name: id, agent_type: 'dsh', model: '', online: true, busy: false, current_task: '', paused: false, platforms: [], sessions_count: 0, source: 'dsh' });
const member = (id: string, source: 'ui' | 'external' = 'ui') => ({ id, name: id, source, can_edit: source === 'ui', can_delete: source === 'ui', persona: '', cli: null, model: null, cliConfig: null, apply: { timing: 'next_turn', status: 'not_configured' } });
const options = (effort = 'high') => ({ supported: true, model: { current: 'm1', options: [{ value: 'm1', name: 'Model 1' }, { value: 'm2', name: 'Model 2' }] }, reasoningEffort: { current: effort, options: [{ value: effort, name: effort }] } });
const flush = async () => { await act(async () => {}); };
async function render(node: React.ReactNode) { container = document.createElement('div'); document.body.append(container); root = createRoot(container); await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>)); await flush(); }
async function clickText(text: string, within: ParentNode = document) { const el = [...within.querySelectorAll('button')].find(e => e.textContent === text); expect(el, text).toBeTruthy(); await act(async () => el!.click()); }
async function change(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) { await act(async () => { const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }); }
function select(label: string) { return [...document.querySelectorAll('label')].find(x => x.textContent?.startsWith(label))!.querySelector('select')!; }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.roles.mockResolvedValue({ roles: [role('managed'), role('external')], dsh: { status: 'running' } });
  mocks.members.mockResolvedValue({ members: [member('managed'), member('external', 'external')] });
  mocks.routes.mockResolvedValue({ routes: [{ provider: 'relay', name: 'Relay', models: [{ id: 'native', name: 'Native' }] }] });
  mocks.options.mockResolvedValue(options()); mocks.create.mockResolvedValue({ member: member('new') }); mocks.update.mockResolvedValue({ member: member('managed') }); mocks.remove.mockResolvedValue({ id: 'managed' });
  mocks.status.mockResolvedValue({ found: true, plugin_installed: true });
});

const contractPath = process.env.BOTHOUSE_MEMBER_CONTRACT_IN;
const contractTest = contractPath ? it : it.skip;
contractTest('uses Go member, route and CLI capability fixture in the role forms', async () => {
  const fixture = JSON.parse(readFileSync(contractPath!, 'utf8')) as {
    members: { members: DSHManagedMember[] }; routes: { routes: DSHModelRoute[] }; cliOptions: DSHCliOptions;
  };
  const editable = fixture.members.members.find(m => m.source === 'ui' && m.can_edit);
  const route = fixture.routes.routes.find(r => !r.error && r.models.length);
  expect(editable, 'fixture needs an editable member').toBeTruthy();
  expect(route, 'fixture needs an available native model').toBeTruthy();
  expect(fixture.cliOptions.supported, 'fixture needs supported Codex options').toBe(true);
  expect(fixture.cliOptions.model?.options.length).toBeGreaterThan(0);
  mocks.members.mockResolvedValue(fixture.members);
  mocks.roles.mockResolvedValue({ roles: fixture.members.members.map(m => role(m.id)), dsh: { status: 'running' } });
  mocks.routes.mockResolvedValue(fixture.routes);
  mocks.options.mockResolvedValue(fixture.cliOptions);
  await render(<RoleList />);
  const card = [...container.querySelectorAll('article')].find(c => c.textContent?.includes(editable!.id));
  expect(card).toBeTruthy(); await clickText('dshManage.edit', card!);
  expect(document.querySelector<HTMLInputElement>('input[aria-label="dshManage.name"]')!.value).toBe(editable!.name);
  await change(select('dshManage.type'), '');
  await change(select('dshManage.provider'), route!.provider); await change(select('dshManage.model'), route!.models[0].id);
  await clickText('common.save');
  expect(mocks.update).toHaveBeenCalledWith(editable!.id, expect.objectContaining({ model: { provider: route!.provider, model: route!.models[0].id } }));
  await clickText('dshManage.add');
  await change(document.querySelector<HTMLInputElement>('input[aria-label="dshManage.name"]')!, 'contract-codex');
  await change(select('dshManage.type'), 'codex'); await flush();
  const cliModel = fixture.cliOptions.model!.options[0];
  await change(select('dshManage.model'), cliModel.value); await flush();
  const effort = fixture.cliOptions.reasoningEffort?.options[0];
  if (effort) await change(select('dshManage.effort'), effort.value);
  await clickText('common.save');
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ cli: 'codex', cliConfig: { model: cliModel.value, reasoningEffort: effort?.value ?? null } }));
});
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers(); });

describe('DSH member management', () => {
  it('shows saved Codex settings separately from the current model and labels the native route', async () => {
    mocks.members.mockResolvedValue({ members: [
      { ...member('managed'), cli: 'codex', cliConfig: { model: 'saved-model', reasoningEffort: 'high' }, apply: { timing: 'next_turn', status: 'pending' } },
      { ...member('native'), model: { provider: 'relay', model: 'native-model' } },
    ] });
    mocks.roles.mockResolvedValue({ roles: [role('managed'), role('native')], dsh: { status: 'running' } });
    await render(<RoleList />);
    const cards = [...container.querySelectorAll('article')];
    expect(cards[0].textContent).toContain('当前模型未知');
    expect(cards[0].textContent).toContain('dshManage.savedConfigNextTurn');
    expect(cards[0].textContent).toContain('dshManage.model: saved-model');
    expect(cards[0].textContent).toContain('dshManage.effort: high');
    expect(cards[0].textContent).toContain('dshManage.apply_pending');
    expect(cards[1].textContent).toContain('dshManage.savedRoute');
    expect(cards[1].textContent).toContain('dshManage.provider: relay');
    expect(cards[1].textContent).toContain('dshManage.model: native-model');
  });
  it('limits edit and delete to roster members, patches the stable id and deletes only after confirmation', async () => {
    await render(<RoleList />);
    const cards = [...container.querySelectorAll('article')];
    expect(cards[0].textContent).toContain('dshManage.edit'); expect(cards[1].textContent).not.toContain('dshManage.edit');
    await clickText('dshManage.edit', cards[0]);
    await change(document.querySelector<HTMLInputElement>('input[aria-label="dshManage.name"]')!, 'renamed');
    await clickText('common.save');
    expect(mocks.update).toHaveBeenCalledWith('managed', expect.objectContaining({ name: 'renamed', cli: null, model: null }));
    await clickText('dshManage.delete', cards[0]); expect(mocks.remove).not.toHaveBeenCalled();
    await clickText('dshManage.delete', document.querySelector('[role=dialog]')!); expect(mocks.remove).toHaveBeenCalledWith('managed');
  });
  it('adds through the installed path with a selected native route without invoking setup', async () => {
    await render(<DSHAdd lang="en" onBack={() => {}} />);
    expect(container.textContent).not.toContain('INSTALL WIZARD');
    await change(document.querySelector<HTMLInputElement>('input[aria-label="dshManage.name"]')!, 'new');
    await change(select('dshManage.provider'), 'relay'); await change(select('dshManage.model'), 'native');
    await clickText('common.save');
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'new', cli: null, model: { provider: 'relay', model: 'native' } }));
  });
  it('probes Codex after model changes and persists model and effort separately from native routes', async () => {
    mocks.options.mockImplementation(async (input: { model?: string }) => options(input.model === 'm2' ? 'low' : 'high'));
    await render(<DSHAdd lang="en" onBack={() => {}} />);
    await change(document.querySelector<HTMLInputElement>('input[aria-label="dshManage.name"]')!, 'coder');
    await change(select('dshManage.type'), 'codex'); await flush();
    await change(select('dshManage.model'), 'm2'); await flush();
    expect(mocks.options).toHaveBeenLastCalledWith({ cli: 'codex', model: 'm2' });
    await change(select('dshManage.effort'), 'low'); await clickText('common.save');
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ cli: 'codex', cliConfig: { model: 'm2', reasoningEffort: 'low' } }));
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('model');
  });
  it('shows route and duplicate-name errors without closing the draft', async () => {
    mocks.routes.mockResolvedValue({ routes: [{ provider: 'broken', name: 'Broken', models: [], error: 'route failed' }] });
    mocks.create.mockRejectedValue(new Error('name conflict'));
    await render(<DSHAdd lang="en" onBack={() => {}} />);
    expect(document.body.textContent).toContain('route failed');
    const input = document.querySelector<HTMLInputElement>('input[aria-label="dshManage.name"]')!;
    await change(input, 'duplicate'); await clickText('common.save');
    expect(document.body.textContent).toContain('name conflict'); expect(input.value).toBe('duplicate');
  });
  it('shows unsupported Codex options without offering invented values', async () => {
    mocks.options.mockResolvedValue({ supported: false, model: null, reasoningEffort: null });
    await render(<DSHAdd lang="en" onBack={() => {}} />);
    await change(select('dshManage.type'), 'codex');
    expect(document.body.textContent).toContain('dshManage.unsupported');
    expect(select('dshManage.model').disabled).toBe(true);
    expect(select('dshManage.model').options).toHaveLength(1);
  });
  it('keeps the draft through background refresh and ignores an older role response', async () => {
    await render(<RoleList />); await clickText('dshManage.edit');
    const input = document.querySelector<HTMLInputElement>('input[aria-label="dshManage.name"]')!;
    await change(input, 'draft');
    let resolve!: (x: unknown) => void;
    mocks.roles.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValueOnce({ roles: [role('latest')], dsh: { status: 'running' } });
    await act(async () => window.dispatchEvent(new Event('cc:refresh')));
    await act(async () => window.dispatchEvent(new Event('cc:refresh')));
    await act(async () => resolve({ roles: [role('stale')], dsh: { status: 'running' } }));
    expect(container.textContent).toContain('latest'); expect(container.textContent).not.toContain('stale'); expect(input.value).toBe('draft');
  });
  it('pauses periodic refresh while hidden and refreshes when visible', async () => {
    vi.useFakeTimers(); await render(<RoleList />); const n = mocks.roles.mock.calls.length;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => { vi.advanceTimersByTime(30000); }); expect(mocks.roles).toHaveBeenCalledTimes(n);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => document.dispatchEvent(new Event('visibilitychange'))); expect(mocks.roles).toHaveBeenCalledTimes(n + 1);
  });
  it('keeps the empty state during a background refresh and cleans up polling', async () => {
    vi.useFakeTimers(); mocks.roles.mockResolvedValue({ roles: [], dsh: { status: 'running' } }); mocks.members.mockResolvedValue({ members: [] });
    await render(<RoleList />); expect(container.textContent).toContain('暂无角色配置');
    mocks.roles.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => window.dispatchEvent(new Event('cc:refresh')));
    expect(container.textContent).toContain('暂无角色配置'); expect(container.querySelector('[aria-hidden=true]')).toBeNull();
    act(() => root.unmount()); const n = mocks.roles.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(30000); }); expect(mocks.roles).toHaveBeenCalledTimes(n);
    root = undefined as unknown as Root;
  });
});
