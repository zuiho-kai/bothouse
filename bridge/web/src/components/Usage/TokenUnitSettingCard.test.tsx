import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TokenUnitSettingCard from './TokenUnitSettingCard';
import { useUsageSettingsStore, DEFAULT_TOKEN_UNIT, TOKEN_UNIT_STORAGE_KEY } from '@/store/usageSettings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];
const roots: ReturnType<typeof createRoot>[] = [];

beforeEach(() => {
  localStorage.clear();
  useUsageSettingsStore.setState({ unit: DEFAULT_TOKEN_UNIT });
});

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  containers.splice(0).forEach((container) => container.remove());
});

async function renderCard() {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<TokenUnitSettingCard />);
  });
  return container;
}

describe('TokenUnitSettingCard', () => {
  it('renders all unit options and reflects current store value', async () => {
    const container = await renderCard();
    expect(container.querySelector('[data-testid="token-unit-setting"]')).not.toBeNull();
    const rawBtn = container.querySelector<HTMLButtonElement>('[data-testid="token-unit-option-raw"]')!;
    const mBtn = container.querySelector<HTMLButtonElement>('[data-testid="token-unit-option-M"]')!;
    const bBtn = container.querySelector<HTMLButtonElement>('[data-testid="token-unit-option-B"]')!;

    expect(rawBtn.getAttribute('aria-checked')).toBe('true');
    expect(mBtn.getAttribute('aria-checked')).toBe('false');
    expect(bBtn.getAttribute('aria-checked')).toBe('false');
  });

  it('selects M unit and persists setting', async () => {
    const container = await renderCard();
    const mBtn = container.querySelector<HTMLButtonElement>('[data-testid="token-unit-option-M"]')!;
    await act(async () => {
      mBtn.click();
    });

    expect(useUsageSettingsStore.getState().unit).toBe('M');
    expect(localStorage.getItem(TOKEN_UNIT_STORAGE_KEY)).toBe('M');
    expect(mBtn.getAttribute('aria-checked')).toBe('true');
  });
});
