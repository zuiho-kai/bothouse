import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Usage from './Usage';
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
});
