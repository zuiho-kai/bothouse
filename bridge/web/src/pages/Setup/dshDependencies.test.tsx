import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import DSHSetup from './DSHSetup';

const mocks = vi.hoisted(() => ({ status: vi.fn(), install: vi.fn() }));
vi.mock('@/components/library', () => ({
  useLibrary: () => ({ lib: { personas: [], avatars: [], packs: [] }, error: '', reload: vi.fn() }),
  PersonaLibrary: () => null,
}));
vi.mock('@/api/wizard', async (original) => ({
  ...await original<object>(), getDSHStatus: mocks.status, installDSHPlugin: mocks.install,
  getCLIs: async () => ({ clis: [] }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.clearAllMocks(); });

it('shows the Node prerequisite and blocks installation until detection passes', async () => {
  mocks.status.mockResolvedValueOnce({ found: true, plugin_installed: false,
    node_version: 'v20.19.0', pnpm_found: false, dependency_error: 'Node >= 22.12.0 is required' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<DSHSetup lang="zh" onBack={() => {}} />));
  expect(container.querySelector('[data-testid="dsh-dependency-error"]')?.textContent).toContain('22.12.0');
  const install = container.querySelector<HTMLButtonElement>('[data-testid="dsh-install-plugin"]')!;
  expect(install.disabled).toBe(true);
  await act(async () => install.click());
  expect(mocks.install).not.toHaveBeenCalled();
  expect(container.textContent).toContain('pnpm');
  mocks.status.mockResolvedValueOnce({ found: true, plugin_installed: false,
    node_version: 'v22.12.0', pnpm_found: true });
  const detect = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('重新检测'))!;
  expect(detect).toBeDefined();
  await act(async () => detect.click());
  expect(container.querySelector('[data-testid="dsh-dependency-error"]')).toBeNull();
  expect(container.querySelector<HTMLButtonElement>('[data-testid="dsh-install-plugin"]')?.disabled).toBe(false);
});
