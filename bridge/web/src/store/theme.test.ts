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

  it.each(['dark', 'system'] as const)('keeps a previously saved %s style from before the migration', (theme) => {
    localStorage.setItem('cc_theme', theme);
    useThemeStore.getState().init();
    expect(useThemeStore.getState().theme).toBe(theme);
    expect(localStorage.getItem('cc_theme')).toBe(theme);
    expect(root().contains('theme-yellow')).toBe(false);
  });

  it('moves a legacy stored light (written by the old wizard) to yellow-white once', () => {
    localStorage.setItem('cc_theme', 'light');
    useThemeStore.getState().init();
    expect(useThemeStore.getState().theme).toBe('yellow');
    expect(localStorage.getItem('cc_theme')).toBe('yellow');
    expect(localStorage.getItem('cc_theme_v')).toBe('2');
    expect(root().contains('theme-yellow')).toBe(true);
  });

  it('keeps light once the user picks it after the migration', () => {
    localStorage.setItem('cc_theme', 'light');
    useThemeStore.getState().init(); // migrates to yellow
    useThemeStore.getState().setTheme('light');
    useThemeStore.getState().init();
    expect(useThemeStore.getState().theme).toBe('light');
    expect(root().contains('theme-yellow')).toBe(false);
    expect(root().contains('dark')).toBe(false);
  });

  it('keeps a stored light that already carries the migration marker', () => {
    localStorage.setItem('cc_theme', 'light');
    localStorage.setItem('cc_theme_v', '2');
    useThemeStore.getState().init();
    expect(useThemeStore.getState().theme).toBe('light');
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
