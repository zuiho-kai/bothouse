import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DSHSetup, { clearDSHDraft } from './DSHSetup';

const configure = vi.fn(async (_body: unknown) => ({ key_saved: false, members_file: '/tmp/members.json', members: 1 }));
const detection = vi.hoisted(() => ({ fail: false, hasKey: true, nativeConfigured: false, statusTargets: [] as (string | undefined)[] }));
vi.mock('@/components/library', () => ({
  useLibrary: () => ({ lib: { personas: [], avatars: [], packs: [] }, error: '', reload: vi.fn() }),
  PersonaLibrary: ({ onPick }: { onPick: (p: unknown) => void }) => (
    <button data-testid="pick-fixture" onClick={() => onPick({ slug: 'dragon', name: '龙娘', text: '# 角色：龙娘\n\n你是「龙娘」——白发。\n' })}>选人设</button>
  ),
}));
vi.mock('@/api/wizard', async (original) => ({
  ...await original<object>(),
  getDSHStatus: async (_lang?: string, target?: string) => {
    detection.statusTargets.push(target);
    return { found: true, plugin_installed: true, version: 'fixture', has_deepseek_key: detection.hasKey, native_model_configured: detection.nativeConfigured };
  },
  getCLIs: async () => {
    if (detection.fail) throw new Error('CLI detection unavailable');
    return { clis: [
      { agent_type: 'codex', label: 'Codex', binary: 'codex', supported: true, login: 'logged_in', path: '/fixture/codex' },
      // #1372: the login hint must name the command to run (`claude`), not the agent_type (`claudecode`)
      { agent_type: 'claudecode', label: 'Claude Code', binary: 'claude', supported: true, login: 'not_logged_in', path: '/fixture/claude' },
    ] };
  },
  configureDSH: (body: unknown) => configure(body),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
beforeEach(() => { configure.mockClear(); detection.fail = false; detection.hasKey = true; detection.nativeConfigured = false; detection.statusTargets = []; });
// the draft in sessionStorage outlives a test and would reopen the next one on the roles step
// #1372 keeps this file honest: clear it, or the next case starts on the roles step.
afterEach(() => { act(() => root?.unmount()); container?.remove(); clearDSHDraft(); });

const render = async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<DSHSetup lang="zh" onBack={() => {}} />));
  // #1263 made the desktop app the default route; these cases pick the web route and step past the route choice.
  await act(async () => container.querySelector<HTMLElement>('[data-testid="dsh-target-web"]')!.click());
  await act(async () => container.querySelector<HTMLElement>('[data-testid="dsh-target-next"]')!.click());
};
const click = async (selector: string) => {
  const el = container.querySelector<HTMLElement>(selector);
  expect(el).not.toBeNull();
  await act(async () => el!.click());
};
const input = async (selector: string, value: string) => {
  const el = container.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const select = async (selector: string, value: string) => {
  const el = container.querySelector<HTMLSelectElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const openDetails = async () => {
  const el = container.querySelector<HTMLDetailsElement>('[data-testid="dsh-optional-0"]')!;
  await act(async () => { el.open = true; });
};

describe('DSH setup roles', () => {
  it('reuses an existing native model without asking for an official API key', async () => {
    detection.hasKey = false;
    detection.nativeConfigured = true;
    await render();
    await click('[data-testid="dsh-skip-install"]');
    expect(container.querySelector('[data-testid="dsh-native-configured"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dsh-api-key"]')).toBeNull();
    await click('[data-testid="dsh-save-roles"]');
    expect(configure).toHaveBeenCalledOnce();
    const body = configure.mock.calls[0][0] as { deepseek_api_key: string; target?: string; members: Record<string, unknown>[] };
    expect(body.deepseek_api_key).toBe('');
    expect(body.members[0]).not.toHaveProperty('cli');
    // Review of #952: the page never sends a model route. Only the backend used to add one, pinning
    // every native role to deepseek-flash; an absent model is what lets the role inherit DSH's choice.
    expect(body.members[0]).not.toHaveProperty('model');
    // and the save says which route's profile the credential check has to read
    expect(body.target).toBe('web');
    expect(detection.statusTargets).toContain('web');
  });
  it('starts with one native DeepSeek role even when signed-in CLIs are available', async () => {
    await render();
    await click('[data-testid="dsh-skip-install"]');
    expect(container.querySelectorAll('[data-testid^="dsh-role-runner-"]')).toHaveLength(1);
    expect(container.querySelector<HTMLSelectElement>('[data-testid="dsh-role-runner-0"]')?.value).toBe('deepseek');
    await click('[data-testid="dsh-save-roles"]');
    expect(configure).toHaveBeenCalledOnce();
    const body = configure.mock.calls[0][0] as { members: Record<string, unknown>[] };
    expect(body.members).toHaveLength(1);
    expect(body.members[0]).not.toHaveProperty('cli');
  });

  it('keeps native setup usable when optional CLI detection fails', async () => {
    detection.fail = true;
    await render();
    await click('[data-testid="dsh-skip-install"]');
    expect(container.querySelector<HTMLSelectElement>('[data-testid="dsh-role-runner-0"]')?.value).toBe('deepseek');
    await click('[data-testid="dsh-save-roles"]');
    expect(configure).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="dsh-error"]')).toBeNull();
  });

  it('adds another native role after explicitly choosing an optional CLI', async () => {
    await render();
    await click('[data-testid="dsh-skip-install"]');
    await select('[data-testid="dsh-role-runner-0"]', 'codex');
    await click('[data-testid="dsh-add-role"]');
    expect(container.querySelector<HTMLSelectElement>('[data-testid="dsh-role-runner-1"]')?.value).toBe('deepseek');
    await click('[data-testid="dsh-save-roles"]');
    const body = configure.mock.calls[0][0] as { members: Record<string, unknown>[] };
    expect(body.members[0]).toHaveProperty('cli', 'codex');
    expect(body.members[1]).not.toHaveProperty('cli');
  });

  it('starts with the CLI name and no persona, and follows a backend switch until the name is edited', async () => {
    await render();
    await click('[data-testid="dsh-skip-install"]');
    await select('[data-testid="dsh-role-runner-0"]', 'codex');
    expect(container.querySelector<HTMLInputElement>('[data-testid="dsh-role-name-0"]')?.value).toBe('Codex');
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="dsh-role-persona-0"]')?.value).toBe('');
    await select('[data-testid="dsh-role-runner-0"]', 'claudecode');
    expect(container.querySelector<HTMLInputElement>('[data-testid="dsh-role-name-0"]')?.value).toBe('Claude Code');
    expect(container.querySelector('[data-testid="dsh-role-label-0"]')?.textContent).toBe('Claude Code');
    await click('[data-testid="dsh-save-roles"]');
    expect(configure).toHaveBeenCalledWith(expect.objectContaining({
      members: [expect.objectContaining({ name: 'Claude Code', cli: 'claude', name_customized: false, persona: '' })],
    }));
  });

  it('names the CLI command in the login hint, not the agent type', async () => {
    await render();
    await click('[data-testid="dsh-skip-install"]');
    await select('[data-testid="dsh-role-runner-0"]', 'claudecode');
    const hint = container.querySelector('[data-testid="dsh-cli-login-hint-0"]');
    expect(hint?.textContent).toContain('claude');
    expect(hint?.textContent).not.toContain('claudecode');
  });

  it('rewrites the picked persona identity when the name is edited afterwards', async () => {
    await render();
    await click('[data-testid="dsh-skip-install"]');
    await select('[data-testid="dsh-role-runner-0"]', 'codex');
    await openDetails();
    await click('[data-testid="pick-fixture"]');
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="dsh-role-persona-0"]')?.value).toBe('# 角色：Codex\n\n你是「Codex」——白发。\n');
    await input('[data-testid="dsh-role-name-0"]', '小码');
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="dsh-role-persona-0"]')?.value).toBe('# 角色：小码\n\n你是「小码」——白发。\n');
    await click('[data-testid="dsh-save-roles"]');
    expect(configure).toHaveBeenCalledWith(expect.objectContaining({
      members: [expect.objectContaining({ name: '小码', name_customized: true, persona: '# 角色：小码\n\n你是「小码」——白发。\n' })],
    }));
  });

  it('keeps an edited name and rewrites the selected persona identity to it', async () => {
    await render();
    await click('[data-testid="dsh-skip-install"]');
    await openDetails();
    await input('[data-testid="dsh-role-name-0"]', '小码');
    await select('[data-testid="dsh-role-runner-0"]', 'claudecode');
    expect(container.querySelector<HTMLInputElement>('[data-testid="dsh-role-name-0"]')?.value).toBe('小码');
    expect(container.querySelector('[data-testid="dsh-role-label-0"]')?.textContent).toBe('小码·Claude Code');
    await click('[data-testid="pick-fixture"]');
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="dsh-role-persona-0"]')?.value).toBe('# 角色：小码\n\n你是「小码」——白发。\n');
    await click('[data-testid="dsh-save-roles"]');
    expect(configure).toHaveBeenCalledWith(expect.objectContaining({
      members: [expect.objectContaining({ name: '小码', cli: 'claude', name_customized: true })],
    }));
  });
});
