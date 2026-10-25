import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useThemeStore, THEMES } from '@/store/theme';
import { THEME_ICONS } from './themeIcons';

/** Settings-page picker for the panel style. Applies instantly and is stored in this browser (cc_theme). */
export default function ThemeSettingCard() {
  const { t } = useTranslation();
  const { theme, setTheme } = useThemeStore();
  return (
    <Card>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{t('settings.appearance')}</h3>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-4">{t('settings.themeHint')}</p>
      <div role="radiogroup" aria-label={t('settings.theme')} className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-lg" data-testid="theme-setting">
        {THEMES.map((value) => {
          const Icon = THEME_ICONS[value];
          const active = theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(value)}
              data-testid={`theme-option-${value}`}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors',
                active
                  ? 'border-accent bg-accent/10 text-accent font-medium'
                  : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
              )}
            >
              <Icon size={16} className="shrink-0" />
              <span className="truncate">{t(`theme.${value}`)}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
