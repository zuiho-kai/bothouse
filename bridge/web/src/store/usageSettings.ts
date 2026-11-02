import { create } from 'zustand';

export type TokenUnit = 'raw' | 'M' | 'B';
export const TOKEN_UNITS: TokenUnit[] = ['raw', 'M', 'B'];
export const DEFAULT_TOKEN_UNIT: TokenUnit = 'raw';
export const TOKEN_UNIT_STORAGE_KEY = 'cc_token_unit';

// 来源: 用户需求「切换m或者b显示」百万=1e6 (M)
export const TOKEN_UNIT_M_DIVISOR = 1_000_000;
// 来源: 用户需求「切换m或者b显示」十亿=1e9 (B)
export const TOKEN_UNIT_B_DIVISOR = 1_000_000_000;

interface UsageSettingsState {
  unit: TokenUnit;
  setUnit: (unit: TokenUnit) => void;
}

function getStoredUnit(): TokenUnit {
  try {
    const val = localStorage.getItem(TOKEN_UNIT_STORAGE_KEY);
    if (val === 'raw' || val === 'M' || val === 'B') {
      return val;
    }
  } catch {
    // fallback if localStorage is not accessible
  }
  return DEFAULT_TOKEN_UNIT;
}

export const useUsageSettingsStore = create<UsageSettingsState>((set) => ({
  unit: getStoredUnit(),
  setUnit: (unit: TokenUnit) => {
    try {
      localStorage.setItem(TOKEN_UNIT_STORAGE_KEY, unit);
    } catch {
      // ignore
    }
    set({ unit });
  },
}));

/**
 * Format token count according to selected unit (raw, M, or B).
 * Retains exact number readability via hover/titles in UI components.
 */
export function formatToken(value: number, unit: TokenUnit = 'raw'): string {
  if (!Number.isFinite(value) || value === 0) {
    return unit === 'raw' ? '0' : `0 ${unit}`;
  }
  if (unit === 'M') {
    // 来源: 用户需求「切换m或者b显示」百万=1e6
    const m = value / TOKEN_UNIT_M_DIVISOR;
    return `${m >= 100 ? m.toFixed(1) : m.toFixed(2)} M`;
  }
  if (unit === 'B') {
    // 来源: 用户需求「切换m或者b显示」十亿=1e9
    const b = value / TOKEN_UNIT_B_DIVISOR;
    return `${b >= 100 ? b.toFixed(2) : b.toFixed(3)} B`;
  }
  return value.toLocaleString();
}
