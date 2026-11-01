import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SetupWizard from './SetupWizard';
import { wizardTexts } from './texts';
import type { WizardRequest } from '@/api/wizard';

// #812: QQ as a wizard platform, reached from the panel's "add platform" with ?platform=qq
const sent = vi.hoisted(() => ({ reqs: [] as WizardRequest[] }));
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh', changeLanguage: vi.fn() } }) }));
vi.mock('@/components/library', () => ({ useLibrary: () => ({ lib: { personas: [] }, reload: vi.fn() }), PersonaLibrary: () => null }));
vi.mock('@/api/wizard', async (original) => ({
  ...await original<object>(),
  getSetupState: async () => ({ projects: ['juzi'], project_display_names: ['Juzi'], setup: { platform: 'discord' }, configured_platforms: { discord: true } }),
  getCLIs: async () => ({ clis: [{ agent_type: 'codex', label: 'Codex', supported: true, login: 'logged_in' }] }),
  getMatrix: async () => ({ vendors: [], matrix: [] }), getExistingBots: async () => ({ bots: [] }),
  applyWizard: async (req: WizardRequest) => {
    sent.reqs.push(req);
    return { ok: true, dry_run: !!req.dry_run, saved: !req.dry_run, steps: [], roles: [], jev_ok: false, jev_hint: '', hardware: false, restart_required: !req.dry_run,
      qq: { code: 'ok', message: '已连上 NapCat，QQ 3889000001（肥鱼）', user_id: '3889000001', nickname: '肥鱼' } };
  },
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); container?.remove(); sent.reqs = []; });
const T = wizardTexts('zh');
const $ = <E extends Element = HTMLElement>(s: string) => container.querySelector<E>(s);
const click = async (s: string) => { const el = $<HTMLButtonElement>(s); expect(el).not.toBeNull(); await act(async () => el!.click()); };
const input = async (s: string, value: string) => { const el = $<HTMLInputElement>(s)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }); };
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;

describe('QQ in the setup wizard', () => {
  it('preselects QQ, tests NapCat before going on, and sends only the QQ platform', async () => {
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<MemoryRouter initialEntries={['/setup?add=1&platform=qq']}><SetupWizard /></MemoryRouter>));
    expect($('[data-testid="platform-qq"]')?.getAttribute('aria-pressed')).toBe('true');
    expect($('[data-testid="platform-discord"]')?.textContent).toContain(T.platformConfigured);
    expect($('[data-testid="platform-qq"]')?.textContent).not.toContain(T.platformConfigured);

    await act(async () => button(T.next).click());
    expect($('[data-testid="qq-step"]')).not.toBeNull();
    expect(button(T.next).disabled).toBe(true); // not tested yet
    expect($<HTMLButtonElement>('[data-testid="qq-test-btn"]')!.disabled).toBe(true); // no owner QQ yet
    await input('[data-testid="qq-allow-from"]', '12345');
    await input('[data-testid="qq-token"]', 'napcat-secret');
    await click('[data-testid="qq-test-btn"]');
    expect(sent.reqs[0]).toMatchObject({ platform: 'qq', dry_run: true, append_only: true,
      qq: { ws_url: 'ws://127.0.0.1:3001', token: 'napcat-secret', allow_from: '12345' } });
    expect(sent.reqs[0].discord).toBeUndefined();
    expect($('[data-testid="qq-test-ok"]')?.textContent).toContain('3889000001');
    expect(button(T.next).disabled).toBe(false);

    // editing a field after the test asks for a new test
    await input('[data-testid="qq-allow-from"]', '12345,67890');
    expect(button(T.next).disabled).toBe(true);
    await click('[data-testid="qq-test-btn"]');

    // QQ skips the gate and jev steps: CLI → persona → review
    await act(async () => button(T.next).click());
    await act(async () => button(T.next).click());
    await act(async () => button(T.next).click());
    expect($('[data-testid="review-qq"]')?.textContent).toContain('12345,67890');
    await act(async () => button(T.save).click());
    const saved = sent.reqs[sent.reqs.length - 1];
    expect(saved).toMatchObject({ platform: 'qq', qq: { allow_from: '12345,67890' } });
    expect(saved.dry_run).toBeFalsy();
    expect(saved.gate).toBeUndefined();
    expect(saved.roles).toHaveLength(1);
  });
});
