import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeStore } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  window.history.replaceState({}, '', '/setup');
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
});

const root = () => document.documentElement.classList;

describe('style preference', () => {
  it('starts a fresh setup in the yellow-white style even on a dark OS', () => {
    useThemeStore.getState().init();
    expect(useThemeStore.getState().theme).toBe('yellow');
    expect(useThemeStore.getState().resolved).toBe('light');
    expect(root().contains('theme-yellow')).toBe(true);
    expect(root().contains('dark')).toBe(false);
  });

  it('starts the first-run login link in the yellow-white style', () => {
    window.history.replaceState({}, '', '/login?next=/setup');
    useThemeStore.getState().init();
    expect(useThemeStore.getState().theme).toBe('yellow');
  });

  it('defaults management pages to the yellow-white style', () => {
    window.history.replaceState({}, '', '/projects');
    useThemeStore.getState().init();
    expect(useThemeStore.getState().theme).toBe('yellow');
    expect(root().contains('theme-yellow')).toBe(true);
  });

  it.each(['light', 'dark'] as const)('keeps a previously saved %s style', (theme) => {
    localStorage.setItem('cc_theme', theme);
    useThemeStore.getState().init();
    expect(useThemeStore.getState().theme).toBe(theme);
    expect(root().contains('dark')).toBe(theme === 'dark');
    expect(root().contains('theme-yellow')).toBe(false);
  });

  it.each(['yellow', 'light', 'dark'] as const)('keeps the selected %s style after reinitializing', (theme) => {
    useThemeStore.getState().setTheme(theme);
    expect(localStorage.getItem('cc_theme')).toBe(theme);
    useThemeStore.getState().init();
    expect(useThemeStore.getState().theme).toBe(theme);
    expect(root().contains('theme-yellow')).toBe(theme === 'yellow');
  });

  it('leaving yellow removes its class', () => {
    useThemeStore.getState().setTheme('yellow');
    useThemeStore.getState().setTheme('dark');
    expect(root().contains('theme-yellow')).toBe(false);
    expect(root().contains('dark')).toBe(true);
  });

  it('honors a previously saved system preference', () => {
    localStorage.setItem('cc_theme', 'system');
    useThemeStore.getState().init();
    expect(useThemeStore.getState().theme).toBe('system');
    expect(useThemeStore.getState().resolved).toBe('dark');
  });

  it('recovers from invalid storage with the yellow-white default', () => {
    localStorage.setItem('cc_theme', 'invalid');
    useThemeStore.getState().init();
    expect(useThemeStore.getState().theme).toBe('yellow');
  });
});
