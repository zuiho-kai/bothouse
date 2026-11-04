import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SetupWizard from './SetupWizard';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh', changeLanguage: vi.fn() } }) }));
vi.mock('@/components/library', () => ({ useLibrary: () => ({ lib: { personas: [] }, reload: vi.fn() }), PersonaLibrary: () => null }));
vi.mock('./DSHSetup', () => ({ default: ({ addMode }: { addMode: boolean }) => <div data-testid="dsh-entry">{addMode ? 'add' : 'resume'}</div> }));
vi.mock('@/api/wizard', async (original) => ({
  ...await original<object>(),
  getSetupState: async () => ({ projects: [], setup: {}, configured_platforms: { dsh: true } }),
  getCLIs: async () => ({ clis: [] }),
  getMatrix: async () => ({ vendors: [], matrix: [] }),
  getExistingBots: async () => ({ bots: [] }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('DSH-only startup routing', () => {
  for (const path of ['/setup', '/setup?platform=dsh']) {
    it(`resumes saved DSH roles at ${path}`, async () => {
      container = document.createElement('div'); document.body.append(container); root = createRoot(container);
      await act(async () => root.render(<MemoryRouter initialEntries={[path]}><SetupWizard /></MemoryRouter>));
      expect(container.querySelector('[data-testid="dsh-entry"]')?.textContent).toBe('resume');
    });
  }
  it('preserves the explicit add entry', async () => {
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<MemoryRouter initialEntries={['/setup?add=1&platform=dsh']}><SetupWizard /></MemoryRouter>));
    expect(container.querySelector('[data-testid="dsh-entry"]')?.textContent).toBe('add');
  });
});
