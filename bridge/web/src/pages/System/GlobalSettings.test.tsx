import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GlobalSettings from './GlobalSettings';
import { getGlobalSettings, updateGlobalSettings } from '@/api/settings';
import { listRoles } from '@/api/roles';
import { listModels } from '@/api/providers';

vi.mock('@/api/settings', () => ({ getGlobalSettings: vi.fn(), updateGlobalSettings: vi.fn() }));
vi.mock('@/api/roles', () => ({ listRoles: vi.fn() }));
vi.mock('@/api/providers', () => ({ listModels: vi.fn() }));
vi.mock('@/components/Autostart/AutostartSettingCard', () => ({ default: () => null }));
vi.mock('@/components/Theme/ThemeSettingCard', () => ({ default: () => null }));
vi.mock('@/components/Usage/TokenUnitSettingCard', () => ({ default: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', changeLanguage: vi.fn() } }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];
afterEach(() => {
  containers.splice(0).forEach((c) => c.remove());
  vi.resetAllMocks();
});

// The select under the label with this i18n key.
const selectFor = (container: HTMLElement, key: string) =>
  Array.from(container.querySelectorAll('label')).find((l) => l.textContent === key)?.parentElement?.querySelector('select') ?? null;

const pick = async (sel: HTMLSelectElement, value: string) => {
  await act(async () => {
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

// User 2026-11-04「简单的交给便宜模型 这个可以在我们dsh插件设置里设置」: two review tiers, each a role
// shown with its model, saved as review_simple_role / review_complex_role.
describe('GlobalSettings review models', () => {
  it('lists roles with their model and saves both tiers', async () => {
    vi.mocked(getGlobalSettings).mockResolvedValue({ review_simple_role: 'deep', review_complex_role: '' } as never);
    vi.mocked(listModels).mockResolvedValue({ models: [], current: '' } as never);
    vi.mocked(updateGlobalSettings).mockResolvedValue({} as never);
    vi.mocked(listRoles).mockResolvedValue({
      roles: [
        { name: 'deep', display_name: '肥鱼', model: 'deepseek-v4-flash' },
        { name: 'gge', display_name: 'G哥', model: 'gpt-6.1-sol' },
      ] as never,
    });
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const root = createRoot(container);
    await act(async () => { root.render(<GlobalSettings hideHeader />); });
    await act(async () => {});
    const simple = selectFor(container, 'settings.reviewSimple')!;
    expect(simple.value).toBe('deep');
    expect(Array.from(simple.options).map((o) => o.textContent)).toEqual([
      'settings.reviewAuto', '肥鱼 · deepseek-v4-flash', 'G哥 · gpt-6.1-sol',
    ]);
    await pick(selectFor(container, 'settings.reviewComplex')!, 'gge');
    const save = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('common.save'))!;
    await act(async () => { save.click(); });
    expect(updateGlobalSettings).toHaveBeenCalledWith(expect.objectContaining({ review_simple_role: 'deep', review_complex_role: 'gge' }));
    act(() => root.unmount());
  });

  // User 2026-11-04 13:20「DSH 设置简单/复杂档可直接选模型」: each tier picks a model from its role's list.
  it('picks a model per tier from the role model list', async () => {
    vi.mocked(getGlobalSettings).mockResolvedValue({ review_simple_role: 'deep', review_simple_model: 'deepseek-v4-flash', review_complex_role: '' } as never);
    vi.mocked(updateGlobalSettings).mockResolvedValue({} as never);
    vi.mocked(listRoles).mockResolvedValue({ roles: [{ name: 'deep', display_name: '肥鱼', model: 'deepseek-v4-pro' }, { name: 'gge', display_name: 'G哥', model: 'gpt-6.1-sol' }] as never });
    vi.mocked(listModels).mockImplementation(async (p: string) => (p === 'deep'
      ? { models: ['deepseek-v4-pro', 'deepseek-v4-flash'], current: 'deepseek-v4-pro' }
      : { models: ['gpt-6.1-sol', 'gpt-6.1-luna'], current: 'gpt-6.1-sol' }) as never);
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const root = createRoot(container);
    await act(async () => { root.render(<GlobalSettings hideHeader />); });
    await act(async () => {});
    const simpleModel = selectFor(container, 'settings.reviewSimpleModel')!;
    expect(simpleModel.value).toBe('deepseek-v4-flash');
    expect(Array.from(simpleModel.options).map((o) => o.value)).toEqual(['', 'deepseek-v4-pro', 'deepseek-v4-flash']);
    // No complex role yet: no model picker for it.
    expect(selectFor(container, 'settings.reviewComplexModel')).toBeNull();
    await pick(selectFor(container, 'settings.reviewComplex')!, 'gge');
    await act(async () => {});
    const complexModel = selectFor(container, 'settings.reviewComplexModel')!;
    expect(Array.from(complexModel.options).map((o) => o.value)).toEqual(['', 'gpt-6.1-sol', 'gpt-6.1-luna']);
    await pick(complexModel, 'gpt-6.1-luna');
    const save = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('common.save'))!;
    await act(async () => { save.click(); });
    expect(updateGlobalSettings).toHaveBeenCalledWith(expect.objectContaining({
      review_simple_role: 'deep', review_simple_model: 'deepseek-v4-flash',
      review_complex_role: 'gge', review_complex_model: 'gpt-6.1-luna',
    }));
    // Changing a tier's role clears its model: an ID belongs to the old role's agent.
    await pick(selectFor(container, 'settings.reviewSimple')!, 'gge');
    expect(selectFor(container, 'settings.reviewSimpleModel')!.value).toBe('');
    act(() => root.unmount());
  });
  // User 2026-11-04「简单的交给便宜模型」: a tier model that would be ignored is shown, not silent.
  it('flags a tier model the backend would ignore', async () => {
    vi.mocked(getGlobalSettings).mockResolvedValue({
      review_simple_role: 'dsh', review_complex_role: '',
      review_model_notice: { at: '2026-11-04T14:00:00Z', board: 601, tier: 'simple', role: 'doubao', model: 'cheap-model', reason: 'no-model' },
    } as never);
    vi.mocked(listRoles).mockResolvedValue({ roles: [{ name: 'dsh', display_name: 'DSH' }] as never });
    vi.mocked(listModels).mockRejectedValue(new Error('agent does not support model switching'));
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const root = createRoot(container);
    await act(async () => { root.render(<GlobalSettings hideHeader />); });
    await act(async () => {});
    expect(container.textContent).toContain('settings.reviewModelNoSwitch');
    expect(container.querySelector('[data-testid="review-model-notice"]')).not.toBeNull();
    act(() => root.unmount());
  });
});
