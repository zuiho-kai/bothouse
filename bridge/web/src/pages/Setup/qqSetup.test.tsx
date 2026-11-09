import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SetupWizard from './SetupWizard';
import { wizardTexts } from './texts';
import type { WizardRequest } from '@/api/wizard';

// #812: QQ as a wizard platform, reached from the panel's "add platform" with ?platform=qq
const sent = vi.hoisted(() => ({ reqs: [] as WizardRequest[], error: '', qqFail: false, reuse: false }));
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh', changeLanguage: vi.fn() } }) }));
vi.mock('@/components/library', () => ({ useLibrary: () => ({ lib: { personas: [] }, reload: vi.fn() }), PersonaLibrary: () => null }));
vi.mock('@/api/wizard', async (original) => ({
  ...await original<object>(),
  getSetupState: async () => ({ projects: ['juzi'], project_display_names: ['Juzi'], setup: { platform: 'discord' }, configured_platforms: { discord: true } }),
  getCLIs: async () => ({ clis: ['codex', 'gemini'].map(agent_type => ({ agent_type, label: agent_type, supported: true, login: 'logged_in' })) }),
  getMatrix: async () => ({ vendors: [], matrix: [] }), getExistingBots: async () => ({ bots: [] }),
  getSetupPersona: async () => ({ path: '/existing/GEMINI.md', exists: true, content: '# My existing role' }),
  applyWizard: async (req: WizardRequest) => {
    sent.reqs.push(req);
    // #1374: the API already joins message and fix with "; " in `error`; a bad connection returns both fields too
    const qq = sent.qqFail
      ? { code: 'unreachable', message: '连不上 ws://127.0.0.1:3001', fix: '先启动 NapCat 并登录 QQ，在网络配置里开一个 WebSocket 服务器（默认端口 3001），地址填这里' }
      : { code: 'ok', message: '已连上 NapCat，QQ 3889000001（肥鱼）', user_id: '3889000001', nickname: '肥鱼' };
    return { ok: !sent.error && !sent.qqFail, error: sent.qqFail ? qq.message + '; ' + qq.fix : (sent.error || undefined), dry_run: !!req.dry_run, saved: !req.dry_run && !sent.error && !sent.qqFail, steps: [], roles: sent.reuse ? [{ project: 'existing', name: 'Existing QQ', agent_type: 'gemini', work_dir: '/existing', reused: true }] : [], jev_ok: false, jev_hint: '', hardware: false, restart_required: !req.dry_run,
      qq };
  },
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); container?.remove(); sent.reqs = []; sent.error = ''; sent.qqFail = false; sent.reuse = false; });
const T = wizardTexts('zh');
const $ = <E extends Element = HTMLElement>(s: string) => container.querySelector<E>(s);
const click = async (s: string) => { const el = $<HTMLButtonElement>(s); expect(el).not.toBeNull(); await act(async () => el!.click()); };
const input = async (s: string, value: string) => { const el = $<HTMLInputElement>(s)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }); };
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;

describe('QQ in the setup wizard', () => {
  it('labels the add-platform entry and describes only the QQ steps', async () => {
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<MemoryRouter initialEntries={['/setup?add=1&pick=platform']}><SetupWizard /></MemoryRouter>));
    expect($('h1')?.textContent).toBe('添加平台');
    await click('[data-testid="platform-qq"]');
    expect($('[data-testid="setup-subtitle"]')?.textContent).toBe([0, 1, 2, 3, 6].map(s => T.steps[s]).join(' → '));
  });

  it('shows the planning error when NapCat connected but the dry run failed', async () => {
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<MemoryRouter initialEntries={['/setup?add=1&platform=qq']}><SetupWizard /></MemoryRouter>));
    await act(async () => button(T.next).click());
    await input('[data-testid="qq-allow-from"]', '12345');
    sent.error = 'a role named "QQ Fixture" already exists; pick another name';
    await click('[data-testid="qq-test-btn"]');
    // merged with the #813 review fix: the connection passed, so the plan error is shown as a note and
    // does not block the next steps (a missing CLI or a name is fixed there; save checks the whole request)
    expect($('[data-testid="qq-test-ok"]')?.textContent).toContain('已连上');
    expect($('[data-testid="qq-test-note"]')?.textContent).toContain(sent.error);
    expect(button(T.next).disabled).toBe(false);
  });

  it('shows the connection failure once and the fix once', async () => {
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<MemoryRouter initialEntries={['/setup?add=1&platform=qq']}><SetupWizard /></MemoryRouter>));
    await act(async () => button(T.next).click());
    await input('[data-testid="qq-allow-from"]', '12345');
    sent.qqFail = true;
    await click('[data-testid="qq-test-btn"]');
    const fail = $('[data-testid="qq-test-fail"]')!;
    expect(fail.textContent?.match(/先启动 NapCat/g)).toHaveLength(1);
    expect(fail.textContent?.match(/连不上 ws:\/\/127\.0\.0\.1:3001/g)).toHaveLength(1);
    expect(button(T.next).disabled).toBe(true);
  });

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
    // #710 件 5: the two optional keys the step used to drop; both travel with the request
    await input('[data-testid="qq-http-url"]', 'http://127.0.0.1:3000');
    await click('[data-testid="qq-share-session"]');
    expect(button(T.next).disabled).toBe(true); // the edited address still needs a new test
    await click('[data-testid="qq-test-btn"]');
    expect(sent.reqs[sent.reqs.length - 1]).toMatchObject({ dry_run: true,
      qq: { http_url: 'http://127.0.0.1:3000', share_session_in_channel: true } });

    // QQ skips the gate and jev steps: CLI → persona → review
    await act(async () => button(T.next).click());
    expect($<HTMLInputElement>('[data-testid="role-name-0"]')?.value).toBe('肥鱼');
    await click('[data-testid="cli-0-gemini"]');
    expect($<HTMLInputElement>('[data-testid="role-name-0"]')?.value).toBe('肥鱼');
    await input('[data-testid="role-name-0"]', 'My QQ');
    await click('[data-testid="cli-0-codex"]');
    expect($<HTMLInputElement>('[data-testid="role-name-0"]')?.value).toBe('My QQ');
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

it.each([false, true])('reuses an existing QQ role and only changes CLI when selected (%s)', async (changeCLI) => {
  sent.reuse = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter initialEntries={['/setup?platform=qq']}><SetupWizard /></MemoryRouter>));
  await act(async () => button(T.next).click());
  await input('[data-testid="qq-allow-from"]', '12345');
  await click('[data-testid="qq-test-btn"]');
  expect(sent.reqs[0].roles[0].agent_type).toBeUndefined();
  await act(async () => button(T.next).click());
  expect($('[data-testid="existing-cli-0"]')?.textContent).toContain('Gemini');
  if (changeCLI) await click('[data-testid="cli-0-codex"]');
  await act(async () => button(T.next).click());
  expect($('[data-testid="existing-persona-0"]')?.textContent).toContain('# My existing role');
  await act(async () => button(T.next).click());
  await act(async () => button(T.save).click());
  const role = sent.reqs[sent.reqs.length - 1].roles[0];
  expect(role.reuse_project).toBe('existing');
  expect(role.agent_type).toBe(changeCLI ? 'codex' : undefined);
  expect(role.reply_language).toBeUndefined();
  expect(role.edit_persona).toBeUndefined();
});

it('opens the official QQ form from the existing QQ wizard and returns without losing OneBot edits', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter initialEntries={['/setup?add=1&platform=qq']}><SetupWizard /></MemoryRouter>));
  await act(async () => button(T.next).click());
  await input('[data-testid="qq-allow-from"]', '12345');
  await click('[data-testid="qq-official"]');
  expect($('h2')?.textContent).toBe('qq.official');
  await act(async () => button('common.back').click());
  expect($<HTMLInputElement>('[data-testid="qq-allow-from"]')?.value).toBe('12345');
});
