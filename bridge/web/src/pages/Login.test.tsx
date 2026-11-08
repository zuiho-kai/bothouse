import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Login from './Login';
import { getStatus, getVersion } from '@/api/status';

vi.mock('@/api/status', () => ({ getVersion: vi.fn(), getStatus: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', changeLanguage: vi.fn() } }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  containers.splice(0).forEach((container) => container.remove());
  vi.resetAllMocks();
});

function LandingProbe() {
  const loc = useLocation();
  return <div data-testid="landing-probe">{loc.pathname + loc.search}</div>;
}

async function renderLogin(entry = '/login') {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<LandingProbe />} />
        </Routes>
      </MemoryRouter>,
    );
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

// #1026: a deep link remembers where it wanted to go as `next`. Typing the token by hand must end
// on that page too, not on `/`, and an off-site `next` must still land on `/`.
describe('login returns to the requested page', () => {
  async function submitToken(entry: string) {
    vi.mocked(getVersion).mockResolvedValue({ version: 'v0-test' });
    vi.mocked(getStatus).mockResolvedValue({} as never);
    const container = await renderLogin(entry);
    const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, 'mgmt-secret');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = container.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await act(async () => {});
    return container;
  }

  it('lands on next after a manual login', async () => {
    const container = await submitToken('/login?next=%2Fusage');
    expect(container.querySelector('[data-testid="landing-probe"]')?.textContent).toBe('/usage');
  });

  it('refuses an off-site next and lands on the dashboard', async () => {
    const container = await submitToken('/login?next=//evil.com');
    expect(container.querySelector('[data-testid="landing-probe"]')?.textContent).toBe('/');
  });

  it('lands on the dashboard when no next was remembered', async () => {
    const container = await submitToken('/login');
    expect(container.querySelector('[data-testid="landing-probe"]')?.textContent).toBe('/');
  });
});
