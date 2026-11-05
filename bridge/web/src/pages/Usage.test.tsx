import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Usage, { getPresetRange } from './Usage';
import { getUsage, type UsageResult } from '@/api/usage';
import { listProjects } from '@/api/projects';
import { useUsageSettingsStore, DEFAULT_TOKEN_UNIT } from '@/store/usageSettings';

vi.mock('@/api/usage', () => ({
  getUsage: vi.fn(),
}));

vi.mock('@/api/projects', () => ({
  listProjects: vi.fn().mockResolvedValue({ projects: [{ name: 'gjiang', display_name: '大豆包' }] }),
  shownNames: () => (name: string) => (name === 'gjiang' ? '大豆包' : name),
}));

const mockT = (key: string, options?: string | Record<string, unknown>) =>
  typeof options === 'string' ? options : key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockDaily: UsageResult = {
  from: '2026-01-01',
  to: '2026-01-02',
  timezone: 'Asia/Shanghai',
  items: [
    {
      date: '2026-01-01',
      hour: 0,
      total_tokens: 2_500_000,
      input_tokens: 1_000_000,
      output_tokens: 500_000,
      cache_read_tokens: 500_000,
      cache_write_tokens: 500_000,
      responses: 10,
      replies: 5,
      unknown_usage_responses: 0,
      unpriced_responses: 0,
      estimated_cost: 0.05,
    },
    {
      date: '2026-01-02',
      hour: 0,
      total_tokens: 3_000_000_000,
      input_tokens: 2_000_000_000,
      output_tokens: 1_000_000_000,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      responses: 20,
      replies: 15,
      unknown_usage_responses: 0,
      unpriced_responses: 0,
      estimated_cost: 0.15,
    },
  ],
};

const mockRoles: UsageResult = {
  from: '2026-01-01',
  to: '2026-01-02',
  timezone: 'Asia/Shanghai',
  items: [
    {
      role: 'gjiang',
      hour: 0,
      total_tokens: 2_500_000,
      input_tokens: 1_000_000,
      output_tokens: 500_000,
      cache_read_tokens: 500_000,
      cache_write_tokens: 500_000,
      responses: 10,
      replies: 5,
      unknown_usage_responses: 0,
      unpriced_responses: 0,
    },
  ],
};

const mockModels: UsageResult = {
  from: '2026-01-01',
  to: '2026-01-02',
  timezone: 'Asia/Shanghai',
  items: [
    {
      model: 'gemini-3.8-flash',
      hour: 0,
      total_tokens: 2_500_000,
      input_tokens: 1_000_000,
      output_tokens: 500_000,
      cache_read_tokens: 500_000,
      cache_write_tokens: 500_000,
      responses: 10,
      unknown_usage_responses: 0,
      unpriced_responses: 0,
    },
  ],
};

const mockHourly: UsageResult = {
  from: '2026-01-01',
  to: '2026-01-01',
  timezone: 'Asia/Shanghai',
  items: [
    {
      hour: 14,
      total_tokens: 1_000_000,
      input_tokens: 500_000,
      output_tokens: 500_000,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      responses: 4,
      unknown_usage_responses: 0,
      unpriced_responses: 0,
    },
  ],
};

const containers: HTMLDivElement[] = [];
const roots: ReturnType<typeof createRoot>[] = [];

beforeEach(() => {
  localStorage.clear();
  useUsageSettingsStore.setState({ unit: DEFAULT_TOKEN_UNIT });
  vi.mocked(listProjects).mockResolvedValue({ projects: [{ name: 'gjiang', display_name: '大豆包' } as any] });
  vi.mocked(getUsage).mockImplementation(async (group) => {
    if (group === 'daily') return mockDaily;
    if (group === 'hourly') return mockHourly;
    if (group === 'roles') return mockRoles;
    if (group === 'models') return mockModels;
    return { from: '', to: '', timezone: '', items: [] };
  });
});

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  containers.splice(0).forEach((container) => container.remove());
  vi.clearAllMocks();
});

async function renderUsage() {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <Usage />
      </MemoryRouter>
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return container;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function useServerToday(day: string) {
  vi.mocked(getUsage).mockImplementation(async (group, filter) => {
    if (group === 'roles' && !filter) return { ...mockRoles, to: day };
    return group === 'daily' ? mockDaily : group === 'hourly' ? mockHourly : group === 'models' ? mockModels : mockRoles;
  });
}

const presetButton = (c: HTMLElement, p: string) => c.querySelector<HTMLButtonElement>(`[data-testid="usage-preset-${p}"]`)!;
const activePresets = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLButtonElement>('[data-testid^="usage-preset-"]'))
    .filter(b => b.getAttribute('aria-pressed') === 'true')
    .map(b => b.dataset.testid!.replace('usage-preset-', ''));
const dateInputElements = (c: HTMLElement) => [
  c.querySelector<HTMLInputElement>('[data-testid="usage-start-date"]')!,
  c.querySelector<HTMLInputElement>('[data-testid="usage-end-date"]')!,
] as const;
const dateInputs = (c: HTMLElement) => dateInputElements(c).map(i => i.value);

describe('Usage page - token unit switching and custom date range', () => {
  it('renders unit toggle selector with raw, M, and B options', async () => {
    const container = await renderUsage();
    const selector = container.querySelector('[data-testid="usage-unit-selector"]');
    expect(selector).not.toBeNull();
    expect(container.querySelector('[data-testid="usage-unit-option-raw"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="usage-unit-option-M"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="usage-unit-option-B"]')).not.toBeNull();
  });

  it('switches unit to M and updates formatted token numbers', async () => {
    const container = await renderUsage();
    const btnM = container.querySelector<HTMLButtonElement>('[data-testid="usage-unit-option-M"]')!;
    await act(async () => {
      btnM.click();
    });

    expect(useUsageSettingsStore.getState().unit).toBe('M');
    // In M mode, 2,500,000 becomes 2.50 M
    expect(container.textContent).toContain('2.50 M');
  });

  it('switches unit to B and updates formatted token numbers', async () => {
    const container = await renderUsage();
    const btnB = container.querySelector<HTMLButtonElement>('[data-testid="usage-unit-option-B"]')!;
    await act(async () => {
      btnB.click();
    });

    expect(useUsageSettingsStore.getState().unit).toBe('B');
    // In B mode, total tokens 3,002,500,000 becomes 3.002 B
    expect(container.textContent).toContain('3.002 B');
  });

  it('queries with custom from and to date range', async () => {
    const container = await renderUsage();
    const startInput = container.querySelector<HTMLInputElement>('[data-testid="usage-start-date"]')!;
    const endInput = container.querySelector<HTMLInputElement>('[data-testid="usage-end-date"]')!;

    await act(async () => {
      setInputValue(startInput, '2026-03-01');
      setInputValue(endInput, '2026-03-15');
    });

    expect(getUsage).toHaveBeenCalledWith('daily', expect.objectContaining({
      from: '2026-03-01',
      to: '2026-03-15',
    }));
  });

  it('validates date range when start is after end', async () => {
    const container = await renderUsage();
    const startInput = container.querySelector<HTMLInputElement>('[data-testid="usage-start-date"]')!;
    const endInput = container.querySelector<HTMLInputElement>('[data-testid="usage-end-date"]')!;

    await act(async () => {
      setInputValue(startInput, '2026-05-10');
      setInputValue(endInput, '2026-05-01');
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('usage.dateRangeInvalid');
  });

  it('resets custom date range when reset button is clicked', async () => {
    const container = await renderUsage();
    const startInput = container.querySelector<HTMLInputElement>('[data-testid="usage-start-date"]')!;
    const endInput = container.querySelector<HTMLInputElement>('[data-testid="usage-end-date"]')!;

    await act(async () => {
      setInputValue(startInput, '2026-03-01');
      setInputValue(endInput, '2026-03-15');
    });

    const resetBtn = container.querySelector<HTMLButtonElement>('[data-testid="usage-reset-dates"]')!;
    expect(resetBtn).not.toBeNull();

    await act(async () => {
      resetBtn.click();
    });

    expect(startInput.value).toBe('');
    expect(endInput.value).toBe('');
    expect(container.querySelector('[data-testid="usage-reset-dates"]')).toBeNull();
  });

  it('renders quick date preset buttons and defaults to past year', async () => {
    const container = await renderUsage();
    expect(container.querySelector('[data-testid="usage-date-presets"]')).not.toBeNull();
    for (const p of ['today', 'thisWeek', 'thisMonth', 'last7Days', 'pastYear']) {
      expect(container.querySelector(`[data-testid="usage-preset-${p}"]`)).not.toBeNull();
    }
    expect(container.querySelector('[data-testid="usage-preset-all"]')).toBeNull();
    const pastYear = container.querySelector<HTMLButtonElement>('[data-testid="usage-preset-pastYear"]')!;
    // 文案是「近一年」而不是「全部」：清空起止时后端只返回今天往前一年
    expect(pastYear.textContent).toBe('近一年');
    expect(pastYear.className).toContain('bg-accent');
    expect(activePresets(container)).toEqual(['pastYear']);
  });

  it('today preset follows the server calendar when the browser is already on the next day', async () => {
    // 浏览器（如台北）已是 11-04 00:30，服务器日历仍是 11-03：今日应请求 11-03
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 0, 30));
    try {
      useServerToday('2026-11-03');
      const container = await renderUsage();
      await act(async () => { presetButton(container, 'today').click(); });
      expect(dateInputs(container)).toEqual(['2026-11-03', '2026-11-03']);
      expect(getUsage).toHaveBeenCalledWith('daily', expect.objectContaining({ from: '2026-11-03', to: '2026-11-03' }));
      // 「今日角色」表也按服务器日历查
      expect(getUsage).toHaveBeenCalledWith('roles', expect.objectContaining({ from: '2026-11-03', to: '2026-11-03' }));
      expect(getUsage).not.toHaveBeenCalledWith('daily', expect.objectContaining({ from: '2026-11-04' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('a preset clicked before the server day is known is recomputed once it arrives', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 0, 30));
    let release: () => void = () => {};
    const gate = new Promise<void>(r => { release = r; });
    vi.mocked(getUsage).mockImplementation(async (group, filter) => {
      if (group === 'roles' && !filter) { await gate; return { ...mockRoles, to: '2026-11-03' }; }
      return group === 'daily' ? mockDaily : group === 'hourly' ? mockHourly : group === 'models' ? mockModels : mockRoles;
    });
    try {
      const container = await renderUsage();
      await act(async () => { presetButton(container, 'today').click(); });
      expect(dateInputs(container)).toEqual(['2026-11-04', '2026-11-04']);
      await act(async () => { release(); await new Promise(r => setTimeout(r, 0)); });
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      expect(dateInputs(container)).toEqual(['2026-11-03', '2026-11-03']);
      expect(activePresets(container)).toEqual(['today']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('computes preset ranges from the server day', () => {
    expect(getPresetRange('today', '2026-11-03')).toEqual({ from: '2026-11-03', to: '2026-11-03' });
    expect(getPresetRange('thisWeek', '2026-11-04')).toEqual({ from: '2026-11-02', to: '2026-11-04' });
    expect(getPresetRange('thisWeek', '2026-11-08')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(getPresetRange('thisMonth', '2026-11-04')).toEqual({ from: '2026-11-01', to: '2026-11-04' });
    expect(getPresetRange('last7Days', '2026-03-02')).toEqual({ from: '2026-02-24', to: '2026-03-02' });
    expect(getPresetRange('last7Days', '2027-01-03')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
    expect(getPresetRange('pastYear', '2026-11-04')).toEqual({ from: '', to: '' });
  });

  it.each([
    // 周一：本周 = 今日
    ['2026-11-02', 'thisWeek', ['2026-11-02', '2026-11-02']],
    // 月初：本月 = 今日
    ['2026-12-01', 'thisMonth', ['2026-12-01', '2026-12-01']],
    // 周日：近7天 = 本周
    ['2026-11-08', 'last7Days', ['2026-11-02', '2026-11-08']],
    // 11-01 既是周日又是月初：近7天 = 本周
    ['2026-11-01', 'last7Days', ['2026-10-26', '2026-11-01']],
  ] as const)('on %s clicking %s keeps that preset highlighted even when another range is identical', async (day, preset, range) => {
    useServerToday(day);
    const container = await renderUsage();
    await act(async () => { presetButton(container, preset).click(); });
    expect(dateInputs(container)).toEqual(range);
    expect(activePresets(container)).toEqual([preset]);
  });

  it('manual date edits sync the highlight by the fixed today→week→month→7-day order', async () => {
    useServerToday('2026-11-02');
    const container = await renderUsage();
    const [start, end] = dateInputElements(container);
    await act(async () => { setInputValue(start, '2026-11-02'); });
    await act(async () => { setInputValue(end, '2026-11-02'); });
    expect(activePresets(container)).toEqual(['today']);
    await act(async () => { setInputValue(start, '2026-10-27'); });
    expect(activePresets(container)).toEqual(['last7Days']);
    await act(async () => { setInputValue(start, '2026-10-20'); });
    expect(activePresets(container)).toEqual([]);
  });

  it('past year preset clears the range', async () => {
    const container = await renderUsage();
    await act(async () => { presetButton(container, 'today').click(); });
    expect(dateInputs(container)[0]).not.toBe('');
    await act(async () => { presetButton(container, 'pastYear').click(); });
    expect(dateInputs(container)).toEqual(['', '']);
    expect(activePresets(container)).toEqual(['pastYear']);
  });

  it('renders token consumption structure breakdown bars and color indicators', async () => {
    const container = await renderUsage();
    const breakdownBars = container.querySelectorAll('[data-testid="usage-breakdown-bar"]');
    // Top summary cards should display breakdown bars for today and period tokens
    expect(breakdownBars.length).toBeGreaterThanOrEqual(2);

    // Breakdown bars have colored segments for input, output, cache
    const firstBar = breakdownBars[0];
    expect(firstBar.querySelector('.bg-sky-500')).not.toBeNull();
    expect(firstBar.querySelector('.bg-amber-500')).not.toBeNull();
    expect(firstBar.querySelector('.bg-emerald-500')).not.toBeNull();

    // Table headers have colored indicator dots
    const thSky = container.querySelector('th .bg-sky-500');
    const thAmber = container.querySelector('th .bg-amber-500');
    const thEmerald = container.querySelector('th .bg-emerald-500');
    expect(thSky).not.toBeNull();
    expect(thAmber).not.toBeNull();
    expect(thEmerald).not.toBeNull();
  });
});
