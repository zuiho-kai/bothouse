import { Sun, SunMedium, Moon, Monitor, type LucideIcon } from 'lucide-react';
import type { Theme } from '@/store/theme';

export const THEME_ICONS: Record<Theme, LucideIcon> = { yellow: SunMedium, light: Sun, dark: Moon, system: Monitor };
