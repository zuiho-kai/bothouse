import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WikiGalaxyPage from './WikiGalaxyPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  containers.splice(0).forEach((container) => container.remove());
});

function renderPage() {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(<WikiGalaxyPage />));
  return container;
}

// #145: the page shows the collab host's own galaxy rather than a second copy of the canvas.
describe('Wiki galaxy sub-page', () => {
  it('frames the collab galaxy page through the panel mount path', () => {
    const c = renderPage();
    const frame = c.querySelector<HTMLIFrameElement>('[data-testid="wiki-galaxy-frame"]')!;
    expect(frame).not.toBeNull();
    // jsdom serves index.html at the root, i.e. the panel opened directly on the management
    // server, where DSH pages come through the /dsh/ proxy. Inside the DSH sidebar entry the
    // mount is /collab/panel and the frame is /collab/wiki-galaxy (lib/collabPages.test.ts).
    expect(new URL(frame.src).pathname).toBe('/dsh/collab/wiki-galaxy');
  });

  it('remounts the frame on refresh so the galaxy is fetched again', () => {
    const c = renderPage();
    const before = c.querySelector('[data-testid="wiki-galaxy-frame"]');
    const refresh = [...c.querySelectorAll('button')].find((b) => b.textContent?.includes('common.refresh'))!;
    act(() => refresh.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const after = c.querySelector('[data-testid="wiki-galaxy-frame"]');
    expect(after).not.toBe(before);
  });
});
