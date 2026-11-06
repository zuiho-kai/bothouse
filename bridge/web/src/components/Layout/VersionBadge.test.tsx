import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VersionBadge from './VersionBadge';
import { getUpdate, type UpdateInfo } from '@/api/update';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));
// The badge talks to the panel API on mount; these tests only look at what it renders.
vi.mock('@/api/update', () => ({
  getUpdate: vi.fn(),
  getUpdateLocal: vi.fn(),
  applyUpdate: vi.fn(),
  ackUpdate: vi.fn(),
}));
vi.mock('@/api/status', () => ({ getStatus: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];
const roots: ReturnType<typeof createRoot>[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  containers.splice(0).forEach((container) => container.remove());
  vi.mocked(getUpdate).mockReset();
});

const info = (patch: Partial<UpdateInfo>): UpdateInfo => ({
  current: 'v0.1.54-local211-25899d75',
  latest: '',
  has_update: false,
  dev: false,
  self_built: false,
  download_url: 'https://example/releases',
  error: '',
  ...patch,
});

async function renderBadge(patch: Partial<UpdateInfo>) {
  vi.mocked(getUpdate).mockResolvedValue(info(patch));
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<VersionBadge collapsed={false} />);
  });
  return container;
}

// #212: a self-built binary cannot install a release (core.UpdateRefusal), so the panel must not
// show the update button it would only refuse; it says why instead.
describe('VersionBadge self-built', () => {
  it('shows the reason instead of an update button on a self-built build', async () => {
    const container = await renderBadge({
      self_built: true,
      error: '本机自编译版不支持自我升级，请用自己的构建流程升级 / self-built binary: in-app update is disabled, update it with your own build',
    });
    expect(container.querySelector('[data-testid="update-self-built"]')).not.toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('still offers the update button on an official release build', async () => {
    const container = await renderBadge({
      current: 'v0.1.4',
      latest: 'v0.1.5',
      has_update: true,
      download_url: 'https://example/releases/v0.1.5',
    });
    expect(container.querySelector('[data-testid="update-self-built"]')).toBeNull();
    expect(container.querySelector('button')).not.toBeNull();
  });
});