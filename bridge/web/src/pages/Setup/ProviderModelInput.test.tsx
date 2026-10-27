import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderModels, type ProviderModelsError, type ProviderModelsResult } from '@/api/wizard';
import ProviderModelInput, { type ProviderModelInputProps } from './ProviderModelInput';
import { wizardTexts } from './texts';

vi.mock('@/api/wizard', () => ({ getProviderModels: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T = wizardTexts('zh');
const provider = { vendor: 'custom', base_url: 'https://models.example.test/v1', api_key: 'test-only-key' };
const modelList: ProviderModelsResult = {
  models: [{ id: 'alpha-large', name: 'Alpha Large' }, { id: 'beta-mini', name: 'Beta Mini' }],
};
const roots: ReturnType<typeof createRoot>[] = [];
const containers: HTMLDivElement[] = [];

beforeEach(() => { localStorage.clear(); });
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  containers.splice(0).forEach((container) => container.remove());
  vi.resetAllMocks();
});

function deferred() {
  let resolve!: (value: ProviderModelsResult) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ProviderModelsResult>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  let props: Omit<ProviderModelInputProps, 'value' | 'onChange'> = {
    provider, scopeKey: 'role-1:claudecode', texts: T, testId: 'model',
  };
  let value = 'handwritten-model';
  const onChange = vi.fn((next: string) => { value = next; render(); });
  const render = () => root.render(<ProviderModelInput {...props} value={value} onChange={onChange} />);
  await act(async () => { render(); });
  return {
    container,
    onChange,
    input: () => container.querySelector<HTMLInputElement>('[data-testid="model"]')!,
    fetch: () => container.querySelector<HTMLButtonElement>('button')!,
    update: async (next: Partial<typeof props>) => {
      props = { ...props, ...next };
      await act(async () => { render(); });
    },
  };
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(button: HTMLButtonElement) {
  await act(async () => { button.click(); });
}

describe('provider model choices', () => {
  it('fetches only on click, keeps hand edits during loading, and fills the selected model ID', async () => {
    const pending = deferred();
    vi.mocked(getProviderModels).mockReturnValue(pending.promise);
    const view = await mount();
    await typeInto(view.input(), 'my-manual-model');
    expect(getProviderModels).not.toHaveBeenCalled();
    await click(view.fetch());
    expect(getProviderModels).toHaveBeenCalledExactlyOnceWith(provider);
    expect(view.fetch().disabled).toBe(true);
    expect(view.fetch().textContent).toBe(T.modelsLoading);
    await typeInto(view.input(), 'edited-while-loading');
    await act(async () => { pending.resolve(modelList); });
    expect(view.input().value).toBe('edited-while-loading');
    const search = view.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await typeInto(search, 'beta');
    const choices = view.container.querySelectorAll<HTMLButtonElement>('[role="group"] button');
    expect(choices).toHaveLength(1);
    expect(choices[0].textContent).toContain('Beta Mini');
    await click(choices[0]);
    expect(view.input().value).toBe('beta-mini');
    expect(choices[0].getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.length).toBe(0);
  });

  const changedInputs = [
    ['vendor', { provider: { ...provider, vendor: 'another-provider' } }],
    ['base URL', { provider: { ...provider, base_url: 'https://other.example.test/v1' } }],
    ['key', { provider: { ...provider, api_key: 'new-test-key' } }],
    ['role', { scopeKey: 'role-2:claudecode' }],
    ['CLI', { scopeKey: 'role-1:codex' }],
  ] as const;

  it.each(changedInputs)('discards an old response when the %s changes', async (_, change) => {
    const oldRequest = deferred();
    const newRequest = deferred();
    vi.mocked(getProviderModels).mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    const view = await mount();
    await click(view.fetch());
    await view.update(change);
    expect(view.fetch().disabled).toBe(false);
    expect(getProviderModels).toHaveBeenCalledTimes(1);
    await click(view.fetch());
    await act(async () => { newRequest.resolve({ models: [{ id: 'current-provider-model' }] }); });
    await act(async () => { oldRequest.resolve(modelList); });
    expect(view.container.textContent).toContain('current-provider-model');
    expect(view.container.textContent).not.toContain('Alpha Large');
    expect(view.input().value).toBe('handwritten-model');
    expect(view.onChange).not.toHaveBeenCalled();
  });

  it('clears previous results and ignores a late failure even after credentials change back', async () => {
    const stale = deferred();
    vi.mocked(getProviderModels).mockResolvedValueOnce(modelList).mockReturnValueOnce(stale.promise);
    const view = await mount();
    await click(view.fetch());
    expect(view.container.querySelector('[role="group"]')).not.toBeNull();
    await view.update({ provider: { ...provider, api_key: 'changed-key' } });
    expect(view.container.querySelector('[role="group"]')).toBeNull();
    expect(view.container.querySelector('input[type="search"]')).toBeNull();
    await click(view.fetch());
    await view.update({ provider });
    await view.update({ provider: { ...provider, api_key: 'changed-key' } });
    await act(async () => { stale.reject(new Error('credential must not appear')); });
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    expect(view.fetch().disabled).toBe(false);
  });

  it('keeps manual entry usable for empty lists and empty search results', async () => {
    vi.mocked(getProviderModels).mockResolvedValueOnce({ models: [] }).mockResolvedValueOnce(modelList);
    const view = await mount();
    await click(view.fetch());
    expect(view.container.querySelector('[role="status"]')?.textContent).toBe(T.modelsEmpty);
    expect(view.input().value).toBe('handwritten-model');
    await click(view.fetch());
    await typeInto(view.container.querySelector<HTMLInputElement>('input[type="search"]')!, 'not-a-model');
    expect(view.container.querySelector('[role="status"]')?.textContent).toBe(T.modelsNoMatches);
    await typeInto(view.input(), 'manual-after-empty-search');
    expect(view.input().value).toBe('manual-after-empty-search');
  });

  const errors: [ProviderModelsError, string][] = [
    ['bad_url', T.modelsBadURL], ['unauthorized', T.modelsUnauthorized], ['not_found', T.modelsNotFound],
    ['unreachable', T.modelsUnreachable], ['invalid_response', T.modelsInvalidResponse], ['upstream_error', T.modelsUpstreamError],
  ];
  it.each(errors)('shows localized feedback for %s and preserves the entered model', async (code, message) => {
    vi.mocked(getProviderModels).mockResolvedValue({ models: [], error_code: code });
    const view = await mount();
    await click(view.fetch());
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe(message);
    expect(view.input().value).toBe('handwritten-model');
    expect(view.fetch().disabled).toBe(false);
  });

  it('does not render raw request errors or credentials', async () => {
    vi.mocked(getProviderModels).mockRejectedValue(new Error(`Authorization: Bearer ${provider.api_key}`));
    const view = await mount();
    await click(view.fetch());
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe(T.modelsRequestFailed);
    expect(view.container.innerHTML).not.toContain(provider.api_key);
    expect(localStorage.length).toBe(0);
  });
});
