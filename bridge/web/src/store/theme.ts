import { create } from 'zustand';

// 'yellow' = the brand style (bright, light, yellow-white; user 2026-10-24/25). It is the default for
// anyone who has not picked a style yet; a saved pick is kept as is.
export type Theme = 'yellow' | 'light' | 'dark' | 'system';
export const THEMES: Theme[] = ['yellow', 'light', 'dark', 'system'];
export const DEFAULT_THEME: Theme = 'yellow';

interface ThemeState {
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme: (t: Theme) => void;
  init: () => void;
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme: Theme, resolved: 'light' | 'dark') {
  const root = document.documentElement.classList;
  root.toggle('dark', resolved === 'dark');
  root.toggle('theme-yellow', theme === 'yellow');
}

const isTheme = (v: string | null): v is Theme => THEMES.includes(v as Theme);

export const useThemeStore = create<ThemeState>((set) => ({
  theme: DEFAULT_THEME,
  resolved: 'light',
  setTheme: (theme: Theme) => {
    const resolved = resolveTheme(theme);
    localStorage.setItem('cc_theme', theme);
    applyTheme(theme, resolved);
    set({ theme, resolved });
  },
  init: () => {
    const stored = localStorage.getItem('cc_theme');
    const saved: Theme = isTheme(stored) ? stored : DEFAULT_THEME;
    const resolved = resolveTheme(saved);
    applyTheme(saved, resolved);
    set({ theme: saved, resolved });
  },
}));

/** Header/login toggle order: every style, brand style first. */
export const NEXT_THEME: Record<Theme, Theme> = { yellow: 'light', light: 'dark', dark: 'system', system: 'yellow' };
/** Wizard toggle order: the explicit styles only (the wizard never had "system"). */
export const NEXT_WIZARD_THEME: Record<Theme, Theme> = { yellow: 'light', light: 'dark', dark: 'yellow', system: 'yellow' };
