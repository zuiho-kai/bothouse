import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SetupWizard from './SetupWizard';
import { wizardTexts } from './texts';
import type { WizardRequest } from '@/api/wizard';

// the review step's two "install globally" checkboxes: off by default, start from /setup/state, always sent
const sent = vi.hoisted(() => ({ reqs: [] as WizardRequest[], guards: false }));
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh', changeLanguage: vi.fn() } }) }));
vi.mock('@/components/library', () => ({ useLibrary: () => ({ lib: { personas: [] }, reload: vi.fn() }), PersonaLibrary: () => null }));
vi.mock('@/api/wizard', async (original) => ({
  ...await original<object>(),
  getSetupState: async () => ({ projects: ['juzi'], project_display_names: ['Juzi'], setup: { platform: 'discord' }, configured_platforms: { discord: true },
    global_memory: false, global_guards: sent.guards }),
  getCLIs: async () => ({ clis: ['codex'].map(agent_type => ({ agent_type, label: agent_type, supported: true, login: 'logged_in' })) }),
  getMatrix: async () => ({ vendors: [], matrix: [] }), getExistingBots: async () => ({ bots: [] }),
  applyWizard: async (req: WizardRequest) => {
    sent.reqs.push(req);
    return { ok: true, dry_run: !!req.dry_run, saved: !req.dry_run, steps: [], roles: [], jev_ok: false, jev_hint: '', hardware: false, restart_required: !req.dry_run,
      qq: { code: 'ok', message: '已连上 NapCat', user_id: '1', nickname: 'Q' } };
  },
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); container?.remove(); sent.reqs = []; sent.guards = false; });
const T = wizardTexts('zh');
const $ = <E extends Element = HTMLElement>(s: string) => container.querySelector<E>(s);
const click = async (s: string) => { const el = $<HTMLElement>(s); expect(el).not.toBeNull(); await act(async () => el!.click()); };
const input = async (s: string, value: string) => { const el = $<HTMLInputElement>(s)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }); };
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;

async function toReview() {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter initialEntries={['/setup?add=1&platform=qq']}><SetupWizard /></MemoryRouter>));
  await act(async () => button(T.next).click());
  await input('[data-testid="qq-allow-from"]', '12345');
  await click('[data-testid="qq-test-btn"]');
  await act(async () => button(T.next).click());
  await click('[data-testid="cli-0-codex"]');
  await act(async () => button(T.next).click());
  await act(async () => button(T.next).click());
}

describe('global install checkboxes', () => {
  it('are off by default and send what the user ticks', async () => {
    await toReview();
    const mem = $<HTMLInputElement>('[data-testid="global-memory"]')!, guards = $<HTMLInputElement>('[data-testid="global-guards"]')!;
    expect(mem.checked).toBe(false);
    expect(guards.checked).toBe(false);
    expect($('[data-testid="global-hooks"]')?.textContent).toContain(T.globalTitle);
    await click('[data-testid="global-memory"]');
    await act(async () => button(T.save).click());
    expect(sent.reqs[sent.reqs.length - 1]).toMatchObject({ global_memory: true, global_guards: false });
  });

  it('start from what the machine has and can be turned off', async () => {
    sent.guards = true;
    await toReview();
    expect($<HTMLInputElement>('[data-testid="global-guards"]')!.checked).toBe(true);
    await click('[data-testid="global-guards"]');
    await act(async () => button(T.save).click());
    expect(sent.reqs[sent.reqs.length - 1]).toMatchObject({ global_memory: false, global_guards: false });
  });
});
