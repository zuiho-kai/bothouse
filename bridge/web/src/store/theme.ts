import { create } from 'zustand';

type Theme = 'light' | 'dark' | 'system';

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
  return theme;
}

function applyTheme(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'dark',
  resolved: 'dark',
  setTheme: (theme: Theme) => {
    const resolved = resolveTheme(theme);
    localStorage.setItem('cc_theme', theme);
    applyTheme(resolved);
    set({ theme, resolved });
  },
  init: () => {
    const stored = localStorage.getItem('cc_theme');
    const setup = window.location.pathname === '/setup' || new URLSearchParams(window.location.search).get('next') === '/setup';
    const saved: Theme = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : setup ? 'light' : 'dark';
    const resolved = resolveTheme(saved);
    applyTheme(resolved);
    set({ theme: saved, resolved });
  },
}));
