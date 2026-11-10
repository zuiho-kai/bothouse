import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SetupWizard from './SetupWizard';
import { wizardTexts } from './texts';
import type { WizardRequest } from '@/api/wizard';

// #1498: DSH's output cap (llm-deepseek maxTokens) was never written, so DSH sent its own 256000 and relays
// that cap lower answered 503. The wizard asks for it, and only for DSH.
const sent = vi.hoisted(() => ({ reqs: [] as WizardRequest[] }));
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh', changeLanguage: vi.fn() } }) }));
vi.mock('@/components/library', () => ({ useLibrary: () => ({ lib: { personas: [] }, reload: vi.fn() }), PersonaLibrary: () => null }));
vi.mock('@/api/wizard', async (original) => ({
  ...await original<object>(),
  getSetupState: async () => ({ projects: [], project_display_names: [], setup: {}, gate_enabled: false }),
  getCLIs: async () => ({ clis: [
    { agent_type: 'codex', label: 'Codex', supported: true, login: 'logged_in' },
    { agent_type: 'dsh', label: 'DSH', supported: true, login: 'logged_in' },
  ] }),
  getMatrix: async () => ({ vendors: [{ id: 'custom', label: 'Relay' }], matrix: [] }),
  getExistingBots: async () => ({ bots: [] }),
  getLocalHub: async () => ({ running: true, token_known: true, url: 'http://fixture.invalid', managed: true }),
  applyWizard: async (req: WizardRequest) => {
    sent.reqs.push(req);
    return { ok: true, dry_run: !!req.dry_run, saved: !req.dry_run, steps: [], roles: [], jev_ok: false, jev_hint: '',
      hardware: false, restart_required: !req.dry_run };
  },
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); container?.remove(); sent.reqs = []; });
const T = wizardTexts('zh');
const $ = <E extends Element = HTMLElement>(s: string) => container.querySelector<E>(s);
const click = async (s: string) => { const el = $<HTMLButtonElement>(s); expect(el).not.toBeNull(); await act(async () => el!.click()); };
const input = async (s: string, value: string) => {
  const el = $<HTMLInputElement>(s)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;

// platform pick → (cloud_web: the hub is already there) → the CLI step
async function openCLIStep() {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter initialEntries={['/setup?add=1&platform=cloud_web']}><SetupWizard /></MemoryRouter>));
  await act(async () => button(T.next).click());
  await act(async () => button(T.next).click());
}

async function toReview() {
  await act(async () => button(T.next).click()); // CLI → roles
  await act(async () => button(T.next).click()); // roles → review
}

describe('DSH output cap in the setup wizard', () => {
  it('is asked for DSH only, and sent as max_tokens', async () => {
    await openCLIStep();
    expect($('[data-testid="provider-max-tokens-0"]')).toBeNull(); // codex: no cap
    await click('[data-testid="cli-0-dsh"]');
    await click('[data-testid="use-provider-0"]');
    // DSH's thinking is enabled|disabled: the wizard says so before the first 400
    expect($('[data-testid="dsh-no-adaptive-0"]')?.textContent).toContain('adaptive');
    expect($('[data-testid="provider-max-tokens-hint-0"]')?.textContent).toBe(T.maxTokensHint);
    const cap = $<HTMLInputElement>('[data-testid="provider-max-tokens-0"]')!;
    expect(cap.value).toBe('');
    expect(cap.placeholder).toBe('128000');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(cap, '12a8b000');
      cap.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(cap.value).toBe('128000'); // digits only
    await input('[data-testid="provider-key-0"]', 'sk-relay');
    await input('[data-testid="provider-model-0"]', 'relay-model');
    await toReview();
    await act(async () => button(T.save).click());
    expect(sent.reqs[sent.reqs.length - 1].roles[0].provider).toMatchObject({ model: 'relay-model', max_tokens: 128000 });
  });

  it('omits the cap when it is left empty, so the server default applies', async () => {
    await openCLIStep();
    await click('[data-testid="cli-0-dsh"]');
    await click('[data-testid="use-provider-0"]');
    await input('[data-testid="provider-key-0"]', 'sk-relay');
    await input('[data-testid="provider-model-0"]', 'relay-model');
    await toReview();
    await act(async () => button(T.save).click());
    expect(sent.reqs[sent.reqs.length - 1].roles[0].provider?.max_tokens).toBeUndefined();
  });
});
