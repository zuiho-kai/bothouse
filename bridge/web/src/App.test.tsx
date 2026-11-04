import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useAuthStore } from '@/store/auth';

// The panel used to drop the query string when it sent a signed-out visitor to /login, so a
// link the bridge itself prints (/…?token=…&next=…) left the token on the floor. The probe
// below records where that redirect lands, which is what these tests look at.
vi.mock('./pages/Login', () => ({
  default: function LoginProbe() {
    const loc = useLocation();
    return <div data-testid="login-probe">{loc.pathname + loc.search}</div>;
  },
}));
// Only routing is under test here; the sidebar's update badge talks to the network.
vi.mock('./components/Layout/Layout', () => ({ default: () => <div><Outlet /></div> }));
vi.mock('react-i18next', () => ({
  // src/i18n/index.ts calls i18n.use(initReactI18next) at import time.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string) => ({ 'notFound.title': '页面不存在', 'notFound.home': '回首页' } as Record<string, string>)[key] ?? key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];
const roots: ReturnType<typeof createRoot>[] = [];

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ token: '', serverUrl: '', isAuthenticated: false });
});
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  containers.splice(0).forEach((container) => container.remove());
});

async function renderAt(path: string) {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
  });
  return container;
}

describe('panel entry points', () => {
  it('keeps the token and next query when a signed-out visitor opens the root path', async () => {
    const container = await renderAt('/?token=abc123&next=/setup');
    expect(container.querySelector('[data-testid="login-probe"]')?.textContent).toBe('/login?token=abc123&next=/setup');
  });

  it('shows a 404 with a way home instead of a blank page for unknown paths', async () => {
    useAuthStore.setState({ isAuthenticated: true });
    const container = await renderAt('/totally-not-a-route');
    expect(container.textContent).toContain('404');
    expect(container.textContent).toContain('页面不存在');
    const home = Array.from(container.querySelectorAll('a')).find((a) => a.textContent?.includes('回首页'));
    expect(home?.getAttribute('href')).toBe('/');
  });

  it('answers a nested unknown path the same way, keeping the layout', async () => {
    useAuthStore.setState({ isAuthenticated: true });
    const container = await renderAt('/system/not-a-page');
    expect(container.textContent).toContain('页面不存在');
    expect(container.textContent).toContain('/system/not-a-page');
  });
});
