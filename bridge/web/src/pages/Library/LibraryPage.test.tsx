import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LibraryPage from './LibraryPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', changeLanguage: vi.fn() } }),
}));
// 只验页签键盘行为：库数据保持加载态，不渲染各页签内容
vi.mock('@/components/library', () => ({
  useLibrary: () => ({ lib: null, error: '', reload: vi.fn() }),
  PersonaLibrary: () => null,
  AvatarLibrary: () => null,
  PackManager: () => null,
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
  act(() => root.render(<LibraryPage />));
  return container;
}

const tab = (c: HTMLElement, k: string) => c.querySelector<HTMLButtonElement>(`[data-testid="library-tab-${k}"]`)!;
const press = (el: HTMLElement, key: string) =>
  act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });

describe('library tabs keyboard', () => {
  it('moves DOM focus together with the selection on arrow/Home/End', () => {
    const c = renderPage();
    tab(c, 'personas').focus();

    press(document.activeElement as HTMLElement, 'ArrowRight');
    expect(document.activeElement).toBe(tab(c, 'avatars'));
    expect(tab(c, 'avatars').getAttribute('aria-selected')).toBe('true');
    expect(tab(c, 'avatars').tabIndex).toBe(0);

    press(document.activeElement as HTMLElement, 'End');
    expect(document.activeElement).toBe(tab(c, 'packs'));

    press(document.activeElement as HTMLElement, 'ArrowRight');
    expect(document.activeElement).toBe(tab(c, 'personas'));

    press(document.activeElement as HTMLElement, 'ArrowLeft');
    expect(document.activeElement).toBe(tab(c, 'packs'));

    press(document.activeElement as HTMLElement, 'Home');
    expect(document.activeElement).toBe(tab(c, 'personas'));
    expect(tab(c, 'personas').getAttribute('aria-selected')).toBe('true');
  });
});
