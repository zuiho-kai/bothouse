// #1881: the first setup page says which CLI the machine needs and can look again in place.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SetupWizard from './SetupWizard';
import { wizardTexts } from './texts';

type CLI = { agent_type: string; label: string; supported: boolean; login: string; version?: string; path?: string };
const fixture = vi.hoisted(() => ({ clis: [] as CLI[], fail: false, calls: 0 }));
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh', changeLanguage: vi.fn() } }) }));
vi.mock('@/components/library', () => ({ useLibrary: () => ({ lib: { personas: [] }, reload: vi.fn() }), PersonaLibrary: () => null }));
vi.mock('@/api/wizard', async (original) => ({
  ...await original<object>(),
  getSetupState: async () => ({ projects: [], setup: {}, gate_enabled: false }),
  getCLIs: async () => { fixture.calls++; if (fixture.fail) throw new Error('boom'); return { clis: fixture.clis }; },
  getMatrix: async () => ({ vendors: [], matrix: [] }), getExistingBots: async () => ({ bots: [] }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); container?.remove(); fixture.clis = []; fixture.fail = false; fixture.calls = 0; });
const T = wizardTexts('zh');
const mount = async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter initialEntries={['/setup']}><SetupWizard /></MemoryRouter>));
};
const row = (agent: string) => container.querySelector<HTMLElement>(`[data-testid="cli-prereq-${agent}"]`);
const recheck = async () => { await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="cli-recheck"]')!.click()); };

describe('CLI requirements on the first setup page', () => {
  it('lists every supported CLI as missing with its install command when none is installed', async () => {
    await mount();
    const box = container.querySelector('[data-testid="cli-prereq"]')!;
    expect(box.textContent).toContain(T.prereqOne);
    // the section comes before the platform (bot) choice
    expect(box.compareDocumentPosition(container.querySelector('[data-testid="platform-discord"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const agent of ['claudecode', 'codex', 'gemini', 'opencode', 'dsh']) expect(row(agent)?.dataset.status).toBe('missing');
    expect(row('codex')?.textContent).toContain('npm i -g @openai/codex');
  });

  it('rechecks in place: missing, then sign-in needed, then ready, and the platform picked stays picked', async () => {
    await mount();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="platform-discord"]')!.click());
    fixture.clis = [{ agent_type: 'codex', label: 'Codex', supported: true, login: 'not_logged_in', version: 'codex-cli 0.167.2' }];
    await recheck();
    expect(row('codex')?.dataset.status).toBe('login');
    expect(row('codex')?.textContent).toContain('codex login');
    fixture.clis = [{ ...fixture.clis[0], login: 'logged_in' }];
    await recheck();
    expect(row('codex')?.dataset.status).toBe('ready');
    expect(row('codex')?.textContent).toContain(T.prereqReady);
    expect(container.querySelector('[data-testid="platform-discord"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('a failed check shows an error to retry and keeps the last list', async () => {
    fixture.clis = [{ agent_type: 'codex', label: 'Codex', supported: true, login: 'logged_in' }];
    await mount();
    expect(row('codex')?.dataset.status).toBe('ready');
    fixture.fail = true;
    await recheck();
    expect(container.querySelector('[data-testid="cli-recheck-error"]')?.textContent).toBe(T.prereqError);
    expect(row('codex')?.dataset.status).toBe('ready');
    fixture.fail = false;
    await recheck();
    expect(container.querySelector('[data-testid="cli-recheck-error"]')).toBeNull();
  });

  it('the DSH route lists only dsh', async () => {
    await mount();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="platform-dsh"]')!.click());
    expect(container.querySelector('[data-testid="cli-prereq"]')?.textContent).toContain(T.prereqDSH);
    expect(row('dsh')).not.toBeNull();
    expect(row('codex')).toBeNull();
  });
});
