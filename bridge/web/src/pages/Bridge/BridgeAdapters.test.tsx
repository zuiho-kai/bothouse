import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BridgeAdapters from './BridgeAdapters';
import { listBridgeAdapters } from '@/api/bridge';
import { getStatus } from '@/api/status';

vi.mock('@/api/bridge', () => ({ listBridgeAdapters: vi.fn() }));
vi.mock('@/api/status', () => ({ getStatus: vi.fn() }));
vi.mock('@/api/projects', async () => {
  const actual = await vi.importActual<typeof import('@/api/projects')>('@/api/projects');
  return { ...actual, listProjects: async () => ({ projects: [] }) };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? ({
      'bridge.title': '桥接', 'bridge.platform': '平台', 'bridge.capabilities': '能力',
      'bridge.connectedPlatforms': '已连接平台', 'bridge.noPlatforms': '暂无已连接平台',
      'bridge.externalAdapters': '外接适配器', 'bridge.bridgeDisabled': '桥接服务未启用',
      'bridge.noAdapters': '暂无桥接适配器', 'common.loading': '加载中…',
      'bridge.platformsReadFailed': '已连接平台读取失败', 'bridge.adaptersReadFailed': '外接适配器读取失败',
      'bridge.readFailedHint': '请求没成功，不代表这里没有内容。', 'bridge.retry': '重试',
      'bridge.projectsReadFailed': '项目名读取失败',
    } as Record<string, string>)[key] ?? key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];
afterEach(() => {
  containers.splice(0).forEach((c) => c.remove());
  vi.resetAllMocks();
});

async function renderPage() {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter><BridgeAdapters /></MemoryRouter>);
  });
  await act(async () => {});
  return container;
}

// The panel said "0 平台" while /api/v1/status listed two connected platforms: the page counted
// bridge adapters (external WebSocket clients), not the platforms the roles are actually on.
describe('bridge page platform count', () => {
  it('counts the platforms the roles are connected to', async () => {
    vi.mocked(getStatus).mockResolvedValue({
      version: 'v0-test', uptime_seconds: 1, connected_platforms: ['discord', 'cloud_web'], projects_count: 2, bridge_adapters: [],
    } as never);
    vi.mocked(listBridgeAdapters).mockResolvedValue({ adapters: [] } as never);

    const container = await renderPage();
    const text = container.textContent || '';
    expect(text).toContain('2 平台');
    expect(text).toContain('discord');
    expect(text).toContain('cloud_web');
    expect(text).not.toContain('暂无已连接平台');
  });

  it('explains why there are no external adapters instead of claiming no platforms', async () => {
    // /status carries no `bridge` block when the bridge server never started.
    vi.mocked(getStatus).mockResolvedValue({
      version: 'v0-test', uptime_seconds: 1, connected_platforms: ['discord'], projects_count: 1, bridge_adapters: [],
    } as never);
    vi.mocked(listBridgeAdapters).mockResolvedValue({ adapters: [] } as never);

    const container = await renderPage();
    expect(container.textContent).toContain('1 平台');
    expect(container.textContent).toContain('桥接服务未启用');
  });

  it('shows an empty adapter list once the bridge service is on', async () => {
    vi.mocked(getStatus).mockResolvedValue({
      version: 'v0-test', uptime_seconds: 1, connected_platforms: ['discord'], projects_count: 1, bridge_adapters: [],
      bridge: { enabled: true, port: 9810, path: '/bridge/ws', token: '', token_set: false },
    } as never);
    vi.mocked(listBridgeAdapters).mockResolvedValue({ adapters: [] } as never);

    const container = await renderPage();
    expect(container.textContent).toContain('暂无桥接适配器');
    expect(container.textContent).not.toContain('桥接服务未启用');
  });

  // #1026: a failed read used to render exactly like an empty list, so a dead bridge and a bridge
  // with no clients read the same. A failure now says so and offers a retry.
  it('shows a retryable failure when /status cannot be read', async () => {
    vi.mocked(getStatus).mockRejectedValue(new Error('fetch failed'));
    vi.mocked(listBridgeAdapters).mockResolvedValue({ adapters: [] } as never);

    const container = await renderPage();
    const text = container.textContent || '';
    expect(text).toContain('已连接平台读取失败');
    expect(text).toContain('fetch failed');
    expect(text).not.toContain('暂无已连接平台');
    const retry = container.querySelector('[data-testid="bridge-read-retry"]');
    expect(retry).not.toBeNull();
    expect(container.textContent).toContain('重试');
  });

  it('shows a retryable failure when the adapter list cannot be read', async () => {
    vi.mocked(getStatus).mockResolvedValue({
      version: 'v0-test', uptime_seconds: 1, connected_platforms: ['discord'], projects_count: 1, bridge_adapters: [],
      bridge: { enabled: true, port: 9810, path: '/bridge/ws', token: '', token_set: false },
    } as never);
    vi.mocked(listBridgeAdapters).mockRejectedValue(new Error('502 bad gateway'));

    const container = await renderPage();
    const text = container.textContent || '';
    expect(text).toContain('外接适配器读取失败');
    expect(text).toContain('502 bad gateway');
    expect(text).not.toContain('暂无桥接适配器');
    expect(text).not.toContain('桥接服务未启用');
  });

  it('re-reads the page when the retry button is pressed', async () => {
    vi.mocked(getStatus).mockRejectedValueOnce(new Error('fetch failed'));
    vi.mocked(getStatus).mockResolvedValue({
      version: 'v0-test', uptime_seconds: 1, connected_platforms: ['discord'], projects_count: 1, bridge_adapters: [],
    } as never);
    vi.mocked(listBridgeAdapters).mockResolvedValue({ adapters: [] } as never);

    const container = await renderPage();
    expect(container.textContent).toContain('已连接平台读取失败');

    const retry = container.querySelector<HTMLButtonElement>('[data-testid="bridge-read-retry"]');
    await act(async () => { retry?.click(); });
    await act(async () => {});

    expect(vi.mocked(getStatus).mock.calls.length).toBe(2);
    expect(container.textContent).not.toContain('已连接平台读取失败');
    expect(container.textContent).toContain('discord');
  });

  it('lists external adapters with their capabilities when some are connected', async () => {
    vi.mocked(getStatus).mockResolvedValue({
      version: 'v0-test', uptime_seconds: 1, connected_platforms: ['discord'],
      projects_count: 1, bridge_adapters: [{ platform: 'dsh', project: 'deep', capabilities: ['text'] }],
      bridge: { enabled: true, port: 9810, path: '/bridge/ws', token: '', token_set: false },
    } as never);
    vi.mocked(listBridgeAdapters).mockResolvedValue({
      adapters: [{ platform: 'dsh', project: 'deep', capabilities: ['text', 'cards'], connected_at: '' }],
    } as never);

    const container = await renderPage();
    const text = container.textContent || '';
    expect(text).toContain('dsh');
    expect(text).toContain('cards');
    expect(text).not.toContain('桥接服务未启用');
  });
});
