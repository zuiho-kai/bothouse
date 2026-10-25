import { useEffect, useState } from 'react';
import i18n from '@/i18n';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import { getAutostart, setAutostart, type AutostartState } from '@/api/autostart';
import { cn } from '@/lib/utils';

// Strings live here (not in locales/*.json) so this card stays one self-contained file.
// Importing @/i18n (not i18next) makes sure init ran before the bundles are added.
const STRINGS: Record<string, Record<string, string>> = {
  en: {
    title: 'Start at login',
    hint: 'Start bothouse automatically when you log in. Switching it does not stop the running service.',
    external: 'Managed externally',
    externalHint: 'This bridge is run by another service entry ({{label}}); its start at login is set there.',
    none: 'Not running as a service',
    noneHint: 'Run `bothouse daemon install` first, then switch it here.',
    error: 'Could not change it: {{msg}}',
  },
  zh: {
    title: '开机自动启动',
    hint: '登录电脑时自动启动 bothouse。切换不会停止正在运行的服务。',
    external: '由外部管理',
    externalHint: '这个桥由其他服务项（{{label}}）运行，开机自启在那里设置。',
    none: '未作为后台服务运行',
    noneHint: '先运行 `bothouse daemon install`，再在这里打开。',
    error: '切换失败：{{msg}}',
  },
  'zh-TW': {
    title: '開機自動啟動',
    hint: '登入電腦時自動啟動 bothouse。切換不會停止正在執行的服務。',
    external: '由外部管理',
    externalHint: '這個橋由其他服務項（{{label}}）執行，開機自啟在那裡設定。',
    none: '未作為背景服務執行',
    noneHint: '先執行 `bothouse daemon install`，再在這裡開啟。',
    error: '切換失敗：{{msg}}',
  },
};
for (const [lng, res] of Object.entries(STRINGS)) {
  i18n.addResourceBundle(lng, 'translation', { autostart: res }, true, false);
}

export default function AutostartSettingCard() {
  const { t } = useTranslation();
  const [state, setState] = useState<AutostartState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    getAutostart().then(setState).catch((e) => setErr(e?.message || 'Error'));
  }, []);

  const self = state?.supervisor === 'self';
  const on = !!state?.enabled && self;

  const toggle = async () => {
    if (!self || busy) return;
    setBusy(true);
    setErr('');
    try {
      setState(await setAutostart(!on));
    } catch (e: any) {
      setErr(t('autostart.error', { msg: e?.message || 'Error', defaultValue: 'Could not change it: {{msg}}' }));
    } finally {
      setBusy(false);
    }
  };

  let hint = t('autostart.hint', STRINGS.en.hint);
  let badge = '';
  if (state?.supervisor === 'external') {
    badge = t('autostart.external', STRINGS.en.external);
    hint = t('autostart.externalHint', { label: state.label || '?', defaultValue: STRINGS.en.externalHint });
  } else if (state?.supervisor === 'none') {
    badge = t('autostart.none', STRINGS.en.none);
    hint = t('autostart.noneHint', STRINGS.en.noneHint);
  }

  return (
    <Card>
      <div className="flex items-center justify-between max-w-lg" data-testid="autostart-setting">
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('autostart.title', STRINGS.en.title)}
            {badge && <span className="ml-2 text-[11px] font-normal px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">{badge}</span>}
          </label>
          <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>
          {err && <p className="text-[11px] text-red-500 mt-0.5">{err}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t('autostart.title', STRINGS.en.title)}
          disabled={!self || busy}
          onClick={toggle}
          className={cn(
            'w-10 h-6 rounded-full transition-colors shrink-0',
            on ? 'bg-accent' : 'bg-gray-300 dark:bg-gray-700',
            (!self || busy) && 'opacity-50 cursor-not-allowed',
          )}
        >
          <div className={cn('w-4 h-4 bg-white rounded-full transition-transform mx-1', on ? 'translate-x-4' : 'translate-x-0')} />
        </button>
      </div>
    </Card>
  );
}
