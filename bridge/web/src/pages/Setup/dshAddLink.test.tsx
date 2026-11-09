import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DSHAdd from './DSHAdd';
import zh from '@/i18n/locales/zh.json';

// #1373: the link to the roles page rendered the key itself. DSHAdd reads the overall key set
// through useTranslation; this mock resolves from the real zh.json so a missing key shows up
// as the raw key, like a browser would.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      const hit = key.split('.').reduce<any>((node, part) => (node == null ? node : node[part]), zh);
      return typeof hit === 'string' ? hit : (fallback ?? key);
    },
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/components/library', () => ({ useLibrary: () => ({ lib: { personas: [] }, reload: vi.fn() }), PersonaLibrary: () => null }));
vi.mock('@/pages/Roles/DSHMemberEditor', () => ({ DSHMemberEditor: () => <div data-testid="member-editor" /> }));
vi.mock('@/api/wizard', async (original) => ({
  ...await original<object>(),
  getDSHStatus: async () => ({ found: true, plugin_installed: true, version: 'fixture', has_deepseek_key: true }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); container?.remove(); });

describe('DSH add page', () => {
  it('links to the roles page with its own text, not the raw key', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<MemoryRouter><DSHAdd lang="zh" onBack={() => {}} /></MemoryRouter>));
    const link = container.querySelector('a[href="/roles"]');
    expect(link?.textContent).toBe('角色管理');
  });
});
