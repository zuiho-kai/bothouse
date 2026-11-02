import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useUsageSettingsStore, TOKEN_UNITS, type TokenUnit } from '@/store/usageSettings';

/** Settings-page picker for token usage display unit. Applies instantly and is stored in localStorage (cc_token_unit). */
export default function TokenUnitSettingCard() {
  const { t } = useTranslation();
  const { unit, setUnit } = useUsageSettingsStore();

  const labels: Record<TokenUnit, string> = {
    raw: t('usage.unitRaw', '完整原数'),
    M: t('usage.unitM', 'M (百万)'),
    B: t('usage.unitB', 'B (十亿)'),
  };

  return (
    <Card>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
        {t('settings.tokenUnit', 'Token 用量单位')}
      </h3>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-4">
        {t('settings.tokenUnitHint', '设置 Token 用量的显示单位（支持原数、百万 M、十亿 B），悬停可查看完整原数。')}
      </p>
      <div
        role="radiogroup"
        aria-label={t('settings.tokenUnit', 'Token 用量单位')}
        className="grid grid-cols-3 gap-2 max-w-lg"
        data-testid="token-unit-setting"
      >
        {TOKEN_UNITS.map((u) => {
          const active = unit === u;
          return (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setUnit(u)}
              data-testid={`token-unit-option-${u}`}
              className={cn(
                'flex items-center justify-center px-3 py-2 rounded-lg border text-sm transition-colors',
                active
                  ? 'border-accent bg-accent/10 text-accent font-medium'
                  : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
              )}
            >
              <span className="truncate">{labels[u]}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
