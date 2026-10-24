import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Login from './Login';
import { getVersion } from '@/api/status';

vi.mock('@/api/status', () => ({ getVersion: vi.fn(), getStatus: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', changeLanguage: vi.fn() } }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  containers.splice(0).forEach((container) => container.remove());
  vi.resetAllMocks();
});

async function renderLogin() {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<MemoryRouter><Login /></MemoryRouter>);
  });
  return container;
}

describe('login runtime version', () => {
  it('shows the server version before a token is entered', async () => {
    vi.mocked(getVersion).mockResolvedValue({ version: 'v0.1.12-test' });
    const container = await renderLogin();
    expect(container.querySelector('[data-testid="login-version"]')?.textContent).toBe('bothouse v0.1.12-test');
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('');
  });

  it('keeps login usable if an older server has no public version endpoint', async () => {
    vi.mocked(getVersion).mockRejectedValue(new Error('not found'));
    const container = await renderLogin();
    expect(container.querySelector('form')).not.toBeNull();
    expect(container.querySelector('[data-testid="login-version"]')).toBeNull();
    expect(container.querySelector('[type="submit"]')).not.toBeNull();
  });
});
