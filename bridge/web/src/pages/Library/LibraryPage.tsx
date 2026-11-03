import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import { AvatarLibrary, PackManager, PersonaLibrary, useLibrary } from '@/components/library';
import { fmt, libraryTexts } from '@/pages/Setup/texts';
import { cn } from '@/lib/utils';

type Tab = 'personas' | 'avatars' | 'packs';

/** Settings page for the persona / avatar library and its packs (same components as the wizard's persona step). */
export default function LibraryPage() {
  const { i18n } = useTranslation();
  const lang = (i18n.language || 'en').split('-')[0];
  const T = libraryTexts(lang);
  const { lib, error, reload } = useLibrary(lang);
  const [tab, setTab] = useState<Tab>('personas');
  const tabs: [Tab, string][] = [['personas', T.tabPersonas], ['avatars', T.tabAvatars], ['packs', T.tabPacks]];

  // tablist 用左右键切换、Home/End 跳首末：键盘用户不必 Tab 到每个页签再回车（WAI-ARIA tabs 模式）。
  // 选中与 DOM 焦点一起移到新页签，否则焦点留在已是 tabIndex=-1 的旧页签上，回车会跳回去。
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const selectAndFocus = (k: Tab) => {
    setTab(k);
    tabRefs.current[k]?.focus();
  };
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex(([k]) => k === tab);
    let next: Tab | undefined;
    if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length][0];
    else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length][0];
    else if (e.key === 'Home') next = tabs[0][0];
    else if (e.key === 'End') next = tabs[tabs.length - 1][0];
    if (!next) return;
    e.preventDefault();
    selectAndFocus(next);
  };

  return (
    <div className="space-y-4" data-testid="library-page">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-ink">{T.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{T.subtitle}</p>
      </div>

      <div
        className="flex gap-1 border-b border-hairline"
        role="tablist"
        aria-label={T.title}
        onKeyDown={onTabKeyDown}
      >
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`library-tab-${k}`}
            ref={(el) => { tabRefs.current[k] = el; }}
            aria-selected={tab === k}
            aria-controls={`library-panel-${k}`}
            tabIndex={tab === k ? 0 : -1}
            onClick={() => setTab(k)}
            data-testid={`library-tab-${k}`}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors duration-base ease-ui-out',
              tab === k
                ? 'border-accent font-medium text-accent'
                : 'border-transparent text-ink-soft hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Card>
        <div
          role="tabpanel"
          id={`library-panel-${tab}`}
          aria-labelledby={`library-tab-${tab}`}
          tabIndex={0}
          className="focus-visible:outline-none"
        >
          {!lib ? (
            error ? (
              <p className="text-sm text-red-700 dark:text-red-400">{fmt(T.loadFailed, { error })}</p>
            ) : (
              // 加载态摆出真实版面的盒子，不留一行「加载中」把版面撑起来又塌下去。
              <div className="space-y-3" aria-hidden>
                <div className="h-4 w-40 rounded-control bg-surface-sunken" />
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-card bg-surface-sunken border border-hairline" />
                ))}
              </div>
            )
          ) : tab === 'personas' ? (
            <PersonaLibrary lib={lib} lang={lang} T={T} reload={reload} />
          ) : tab === 'avatars' ? (
            <AvatarLibrary lib={lib} lang={lang} T={T} reload={reload} />
          ) : (
            <PackManager lib={lib} lang={lang} T={T} reload={reload} />
          )}
        </div>
      </Card>
    </div>
  );
}