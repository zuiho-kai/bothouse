import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import { AVATAR_SETS, AVATAR_STYLES, useAvatarStyle, useAvatarStyleStore, type AvatarStyle } from '@/lib/avatarMap';
import { withBase } from '@/lib/basePath';

const LABEL_KEY: Record<AvatarStyle, string> = { brand: 'settings.avatarStyleBrand', chibi: 'settings.avatarStyleChibi' };

/** Settings-page picker for the built-in role avatar set. Saved in the bridge config right away, so the DSH plugin follows. */
export default function AvatarStyleSettingCard() {
  const { t } = useTranslation();
  const style = useAvatarStyle();
  const setStyle = useAvatarStyleStore((s) => s.setStyle);
  const [error, setError] = useState('');
  const pick = (next: AvatarStyle) => {
    if (next === style) return;
    setError('');
    setStyle(next).catch((e: any) => setError(e?.message || 'Error'));
  };
  return (
    <Card>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{t('settings.avatarStyle')}</h3>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-4">{t('settings.avatarStyleHint')}</p>
      <div role="radiogroup" aria-label={t('settings.avatarStyle')} className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg" data-testid="avatar-style-setting">
        {AVATAR_STYLES.map((value) => {
          const active = style === value;
          const set = AVATAR_SETS[value];
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(value)}
              data-testid={`avatar-style-${value}`}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg border text-sm transition-colors',
                active
                  ? 'border-accent bg-accent/10 text-accent font-medium'
                  : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
              )}
            >
              <span className="flex -space-x-1.5 shrink-0" aria-hidden>
                {[set.claude, set.gpt, set.deepseek, set.gemini].map((slug) => (
                  <img key={slug} src={withBase(`/avatars/${slug}.png`)} alt="" className="h-6 w-6 rounded-full ring-2 ring-surface" />
                ))}
              </span>
              <span className="truncate">{t(LABEL_KEY[value])}</span>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}
    </Card>
  );
}
