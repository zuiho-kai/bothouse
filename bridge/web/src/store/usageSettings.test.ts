import { beforeEach, describe, expect, it } from 'vitest';
import {
  useUsageSettingsStore,
  formatToken,
  DEFAULT_TOKEN_UNIT,
  TOKEN_UNIT_STORAGE_KEY,
} from './usageSettings';

beforeEach(() => {
  localStorage.clear();
  useUsageSettingsStore.setState({ unit: DEFAULT_TOKEN_UNIT });
});

describe('usage settings store', () => {
  it('defaults to raw unit', () => {
    expect(useUsageSettingsStore.getState().unit).toBe('raw');
  });

  it('updates unit to M and persists to localStorage', () => {
    useUsageSettingsStore.getState().setUnit('M');
    expect(useUsageSettingsStore.getState().unit).toBe('M');
    expect(localStorage.getItem(TOKEN_UNIT_STORAGE_KEY)).toBe('M');
  });

  it('updates unit to B and persists to localStorage', () => {
    useUsageSettingsStore.getState().setUnit('B');
    expect(useUsageSettingsStore.getState().unit).toBe('B');
    expect(localStorage.getItem(TOKEN_UNIT_STORAGE_KEY)).toBe('B');
  });
});

describe('formatToken', () => {
  it('formats zero correctly across units', () => {
    expect(formatToken(0, 'raw')).toBe('0');
    expect(formatToken(0, 'M')).toBe('0 M');
    expect(formatToken(0, 'B')).toBe('0 B');
  });

  it('formats raw tokens with locale formatting', () => {
    expect(formatToken(1234, 'raw')).toBe((1234).toLocaleString());
    expect(formatToken(5000000, 'raw')).toBe((5000000).toLocaleString());
  });

  it('formats tokens with M unit', () => {
    expect(formatToken(1_500_000, 'M')).toBe('1.50 M');
    expect(formatToken(150_000_000, 'M')).toBe('150.0 M');
    expect(formatToken(250_000, 'M')).toBe('0.25 M');
  });

  it('formats tokens with B unit', () => {
    expect(formatToken(1_500_000_000, 'B')).toBe('1.500 B');
    expect(formatToken(25_000_000_000, 'B')).toBe('25.000 B');
    expect(formatToken(150_000_000_000, 'B')).toBe('150.00 B');
  });
});
