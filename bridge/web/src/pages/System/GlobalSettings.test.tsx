import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GlobalSettings from './GlobalSettings';
import { getGlobalSettings, updateGlobalSettings } from '@/api/settings';
import { listRoles } from '@/api/roles';

vi.mock('@/api/settings', () => ({ getGlobalSettings: vi.fn(), updateGlobalSettings: vi.fn() }));
vi.mock('@/api/roles', () => ({ listRoles: vi.fn() }));
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

// User 2026-11-04「简单的交给便宜模型 这个可以在我们dsh插件设置里设置」: two review tiers, each a role
// shown with its model, saved as review_simple_role / review_complex_role.
describe('GlobalSettings review models', () => {
  it('lists roles with their model and saves both tiers', async () => {
    vi.mocked(getGlobalSettings).mockResolvedValue({ review_simple_role: 'deep', review_complex_role: '' } as never);
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
    const selects = Array.from(container.querySelectorAll('select'));
    const simple = selects.find((s) => s.value === 'deep');
    expect(simple).toBeTruthy();
    expect(Array.from(simple!.options).map((o) => o.textContent)).toEqual([
      'settings.reviewAuto', '肥鱼 · deepseek-v4-flash', 'G哥 · gpt-6.1-sol',
    ]);
    const complex = selects[selects.indexOf(simple!) + 1];
    await act(async () => {
      complex.value = 'gge';
      complex.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const save = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('common.save'))!;
    await act(async () => { save.click(); });
    expect(updateGlobalSettings).toHaveBeenCalledWith(expect.objectContaining({ review_simple_role: 'deep', review_complex_role: 'gge' }));
    act(() => root.unmount());
  });
});
