import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PluginHubPage from './PluginHubPage';
import api from '@/api/client';
import { listRoles } from '@/api/roles';
import { listPlugins, switchPlugin } from '@/api/plugins';
import { fetchShowcasePack, listInstalledPetPacks } from '@/api/pets';
import { getRoleBindings, saveRoleBindings } from '@/api/roleBindings';
import { subscribeRoleEvents, type RoleState } from '@/api/roleEvents';
vi.mock('@/api/roles', () => ({ listRoles: vi.fn() }));
vi.mock('@/api/plugins', () => ({ listPlugins: vi.fn(), switchPlugin: vi.fn() }));
vi.mock('@/api/pets', () => ({ listInstalledPetPacks: vi.fn(), fetchShowcasePack: vi.fn() }));
vi.mock('@/api/roleBindings', () => ({ getRoleBindings: vi.fn(), saveRoleBindings: vi.fn() }));
vi.mock('@/api/roleEvents', () => ({ subscribeRoleEvents: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let handlers: Parameters<typeof subscribeRoleEvents>[0];
const close = vi.fn();
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const bridge: RoleState = { role_key: 'bridge:deep', source: 'bridge', name: 'deep', display_name: '肥鱼', online: true,
  status: 'working', busy_count: 2, sessions: [{ session_key: 'room1', status: 'working', busy: true }, { session_key: 'room2', status: 'thinking', busy: true }] };
const dsh: RoleState = { ...bridge, role_key: 'dsh:deep', source: 'dsh', status: 'idle', busy_count: 0, sessions: [] };
const time = '2026-11-09T01:00:00Z';
const action = (id: string) => ({ id, name: id, sources: { webp: 'spritesheet/' + id + '.webp' },
  spritesheet: { frameWidth: 20, frameHeight: 10, columns: 2, frameCount: 4, fps: 12 } });
const packs = { installed: [{ id: 'local-pack', name: '本机占位包', format: 'webp-sprite' as const,
  localPath: '/isolated/pets/local-pack', actionCount: 2, actions: [action('idle'), action('working')] }], baseDir: '/isolated/pets' };
const pluginState = { profile: 'test', profile_dir: '/isolated', can_install: false, writes_allowed: true,
  allow_non_registry: false, registry: 'npm', plugins: [{ name: 'installed-plugin', version: '1.0.0', layer: true, client_only: false, enabled: true, shipped: false }] };
beforeEach(() => {
  vi.resetAllMocks(); api.setToken('test-token');
  vi.mocked(listRoles).mockResolvedValue({ roles: [] });
  vi.mocked(listPlugins).mockResolvedValue(pluginState);
  vi.mocked(listInstalledPetPacks).mockResolvedValue(packs);
  vi.mocked(getRoleBindings).mockResolvedValue({ bindings: { 'bridge:deep': [{ plugin_id: 'dsh-pet', enabled: true, avatar_pack: 'local-pack' }] } });
  vi.mocked(saveRoleBindings).mockImplementation(async bindings => ({ bindings }));
  vi.mocked(subscribeRoleEvents).mockImplementation(callbacks => { handlers = callbacks; return close; });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); api.setToken(''); });
async function render() {
  await act(async () => { root.render(<MemoryRouter><PluginHubPage /></MemoryRouter>); });
  await act(async () => handlers.snapshot({ roles: [bridge, dsh], time, dsh: { status: 'running' } }));
}
const find = (id: string) => container.querySelector('[data-testid="' + id + '"]') as HTMLElement;
async function click(id: string) { await act(async () => find(id).click()); }
async function select(id: string, value: string) {
  await act(async () => { const e = find(id) as HTMLSelectElement; e.value = value; e.dispatchEvent(new Event('change', { bubbles: true })); });
}
describe('plugin page backend integration', () => {
  it('downloads only on click and makes the verified pack selectable after refresh', async () => {
    const showcase = [{ id: 'dsh1', dir: 'pets/dsh1', name: '作者鲸鱼', description: '社区形象', forRole: 'DeepSeek',
      license: '个人非商用；Non-commercial; attribution required', bytes: 1000000,
      source: 'https://github.com/hunmer/aboutme-pets/tree/pinned/pets/dsh1', installed: false }];
    vi.mocked(listInstalledPetPacks).mockResolvedValue({ ...packs, showcase });
    vi.mocked(fetchShowcasePack).mockResolvedValue({ state: 'downloading', done: 0, total: 1 });
    await render();
    expect(fetchShowcasePack).not.toHaveBeenCalled();
    expect(find('showcase-pack-dsh1').textContent).toContain('个人非商用');
    expect(find('pet-import-section')).toBeNull();
    vi.mocked(listInstalledPetPacks).mockResolvedValue({ ...packs,
      installed: [...packs.installed, { ...packs.installed[0], id: 'dsh1', name: '作者鲸鱼' }],
      showcase: [{ ...showcase[0], installed: true }] });
    await click('showcase-download-dsh1');
    expect(fetchShowcasePack).toHaveBeenCalledWith('dsh1');
    expect((find('showcase-download-dsh1') as HTMLButtonElement).disabled).toBe(true);
    expect(find('select-pack-bridge:deep').textContent).toContain('作者鲸鱼');
    expect((find('select-pack-bridge:deep') as HTMLSelectElement).value).toBe('local-pack');
    expect(saveRoleBindings).not.toHaveBeenCalled();
  });
  it('shows immediate and background download failures while keeping the current pack', async () => {
    const showcase = [{ id: 'dsh1', dir: 'pets/dsh1', name: '作者鲸鱼', description: '', forRole: 'DeepSeek',
      license: '个人非商用', bytes: 1000000, source: 'https://github.com/hunmer/aboutme-pets', installed: false }];
    vi.mocked(listInstalledPetPacks).mockResolvedValue({ ...packs, showcase });
    vi.mocked(fetchShowcasePack).mockRejectedValue(new Error('HTTP 503'));
    await render(); await click('showcase-download-dsh1');
    expect(find('showcase-error-dsh1').textContent).toContain('HTTP 503');
    vi.mocked(fetchShowcasePack).mockResolvedValue({ state: 'downloading', done: 0, total: 1 });
    vi.mocked(listInstalledPetPacks).mockResolvedValue({ ...packs,
      showcase: [{ ...showcase[0], fetch: { state: 'failed', done: 1, total: 1, error: 'sha256 校验不对' } }] });
    await click('showcase-download-dsh1');
    expect(find('showcase-error-dsh1').textContent).toContain('sha256');
    expect(find('showcase-error-dsh1').textContent).toContain('默认形象不受影响');
    expect((find('select-pack-bridge:deep') as HTMLSelectElement).value).toBe('local-pack');
    expect(saveRoleBindings).not.toHaveBeenCalled();
  });
  it('never reintroduces stale manifest actions after receiving the authoritative table', async () => {
    vi.mocked(listInstalledPetPacks).mockResolvedValue({ ...packs, installed: [{ ...packs.installed[0],
      actions: [action('idle-from-actions')],
      manifest: { idleAnimationId: 'retired', animations: [action('retired')] },
    }] });
    await render();
    await act(async () => handlers.snapshot({ roles: [{ ...bridge, status: 'idle', busy_count: 0, sessions: [] }], time, dsh: { status: 'running' } }));
    const image = decodeURIComponent(find('pet-player-sprite').style.backgroundImage);
    expect(image).toContain('idle-from-actions.webp');
    expect(image).not.toContain('retired.webp');
  });
  it('keeps deep as the initial display when another bound role sorts first', async () => {
    await render();
    const claude = { ...bridge, role_key: 'bridge:claude', name: 'claude', display_name: 'Claude' };
    await act(async () => handlers.snapshot({ roles: [claude, bridge], time, dsh: { status: 'running' } }));
    expect(find('pet-card-bridge:deep')).not.toBeNull();
    expect(find('pet-card-bridge:claude')).toBeNull();
  });
  it('lists actual installed data, without inventing installed packs or role defaults', async () => {
    await render();
    expect(container.textContent).toContain('installed-plugin');
    expect(listPlugins).toHaveBeenCalledTimes(1);
    expect(find('installed-pack-local-pack')).not.toBeNull(); expect(find('installed-pack-dsh1')).toBeNull();
    expect(container.textContent).not.toContain('人格养成');
    expect((find('select-pack-bridge:deep') as HTMLSelectElement).value).toBe('local-pack');
    expect((find('select-pack-dsh:deep') as HTMLSelectElement).value).toBe('');
    expect(find('pet-player-sprite')).not.toBeNull();
    expect(find('busy-badge-bridge:deep').textContent).toContain('2 处在忙');
  });
  it('persists unbind, preserves other plugins and stays unbound after remount', async () => {
    const other = { plugin_id: 'installed-plugin', enabled: true };
    vi.mocked(getRoleBindings).mockResolvedValue({ bindings: { 'bridge:deep': [{ plugin_id: 'dsh-pet', enabled: true, avatar_pack: 'local-pack' }, other] } });
    await render(); await select('select-pack-bridge:deep', '');
    expect(saveRoleBindings).toHaveBeenCalledWith({ 'bridge:deep': [other] });
    expect(find('pet-slot-pending-bridge:deep')).not.toBeNull();
    vi.mocked(getRoleBindings).mockResolvedValue({ bindings: { 'bridge:deep': [other] } });
    await act(async () => { root.unmount(); root = createRoot(container); }); await render();
    expect((find('select-pack-bridge:deep') as HTMLSelectElement).value).toBe('');
    expect(find('pet-slot-pending-bridge:deep')).not.toBeNull();
  });
  it('shares saved config between table and card, with per-plugin source isolation', async () => {
    await render(); await select('pack-select-bridge:deep', '');
    expect((find('select-pack-bridge:deep') as HTMLSelectElement).value).toBe('');
    await select('select-pack-bridge:deep', 'local-pack');
    expect((find('pack-select-bridge:deep') as HTMLSelectElement).value).toBe('local-pack');
    await click('checkbox-plugin-dsh:deep-installed-plugin');
    const calls = vi.mocked(saveRoleBindings).mock.calls;
    expect(calls[calls.length - 1][0]['dsh:deep']).toEqual([{ plugin_id: 'installed-plugin', enabled: true }]);
  });
  it('disables only this role adapter while preserving its selected pack', async () => {
    await render(); await click('checkbox-plugin-bridge:deep-dsh-pet');
    expect(saveRoleBindings).toHaveBeenCalledWith({ 'bridge:deep': [{ plugin_id: 'dsh-pet', enabled: false, avatar_pack: 'local-pack' }] });
    expect(find('pet-player-sprite')).toBeNull(); expect(switchPlugin).not.toHaveBeenCalled();
  });
  it('keeps previous config and exposes failed saves', async () => {
    await render(); vi.mocked(saveRoleBindings).mockRejectedValueOnce(new Error('disk is full'));
    await select('select-pack-bridge:deep', '');
    expect(container.textContent).toContain('disk is full');
    expect((find('select-pack-bridge:deep') as HTMLSelectElement).value).toBe('local-pack');
  });
  it('disables writes if bindings cannot be read', async () => {
    vi.mocked(getRoleBindings).mockRejectedValue(new Error('corrupt bindings')); await render();
    expect((find('select-pack-bridge:deep') as HTMLSelectElement).disabled).toBe(true);
    expect(container.textContent).toContain('角色绑定读取失败'); expect(saveRoleBindings).not.toHaveBeenCalled();
  });
  it('keeps an empty local catalog and shows the load error on failure', async () => {
    vi.mocked(listInstalledPetPacks).mockRejectedValue(new Error('offline')); await render();
    expect(container.textContent).toContain('本机形象包读取失败'); expect(container.textContent).toContain('本地已装形象包 (0)');
    expect(find('showcase-pack-dsh1')).toBeNull();
    expect(find('pet-player-sprite')).toBeNull();
  });
  it('uses aggregate role state when a single session becomes idle', async () => {
    await render();
    await act(async () => handlers.event({ type: 'idle', role_key: bridge.role_key, session_key: 'room1', status: 'idle', time,
      role: { ...bridge, status: 'working', busy_count: 1, sessions: [{ session_key: 'room2', status: 'working', busy: true }] } }));
    expect(find('role-config-row-bridge:deep').textContent).toContain('干活中');
    expect(find('busy-badge-bridge:deep').textContent).toContain('1 处在忙'); expect(find('role-config-row-dsh:deep').textContent).toContain('待机中');
  });
  it('clears removed roles, old sessions and old speech on reconnect snapshot', async () => {
    await render();
    await act(async () => handlers.event({ type: 'speech', role_key: bridge.role_key, session_key: 'room1', status: 'idle', time, text: '真实发言', role: bridge }));
    expect(find('bubble-text-bridge:deep').textContent).toBe('真实发言');
    await act(async () => handlers.error()); expect(container.textContent).toContain('当前显示最后已知状态');
    await act(async () => handlers.snapshot({ roles: [{ ...bridge, status: 'idle', busy_count: 0, sessions: [] }], time, dsh: { status: 'stopped' } }));
    expect(find('role-config-row-dsh:deep')).toBeNull(); expect(find('busy-badge-bridge:deep')).toBeNull();
    expect(find('bubble-text-bridge:deep').textContent).not.toContain('真实发言');
  });
  it('marks unavailable DSH roles offline', async () => {
    await render(); await act(async () => handlers.snapshot({ roles: [dsh], time, dsh: { status: 'stopped' } }));
    expect(find('pet-card-dsh:deep').textContent).toContain('已离线');
  });
  it('isolates simulations and restores the latest real state', async () => {
    await render(); await click('sim-btn-error'); expect(find('pet-card-bridge:deep').textContent).toContain('出错');
    expect(find('role-config-row-dsh:deep').textContent).toContain('待机中');
    await act(async () => handlers.event({ type: 'idle', role_key: bridge.role_key, session_key: '', status: 'idle', time,
      role: { ...bridge, status: 'idle', busy_count: 0, sessions: [] } }));
    expect(find('pet-card-bridge:deep').textContent).toContain('出错'); await click('sim-btn-reset');
    expect(find('pet-card-bridge:deep').textContent).toContain('待机中');
  });
  it('closes the event subscription when unmounted', async () => {
    await render(); await act(async () => root.unmount()); expect(close).toHaveBeenCalledTimes(1); root = createRoot(container);
  });
});
