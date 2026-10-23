import { useState } from 'react';
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
  return (
    <div className="space-y-4" data-testid="library-page">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{T.title}</h1>
        <p className="text-sm text-gray-500">{T.subtitle}</p>
      </div>
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`library-tab-${k}`}
            className={cn('px-3 py-2 text-sm -mb-px border-b-2 transition-colors', tab === k ? 'border-accent text-accent font-medium' : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200')}>
            {label}
          </button>
        ))}
      </div>
      <Card>
        {!lib ? <p className="text-sm text-gray-500">{error ? fmt(T.loadFailed, { error }) : T.loading}</p>
          : tab === 'personas' ? <PersonaLibrary lib={lib} lang={lang} T={T} reload={reload} />
          : tab === 'avatars' ? <AvatarLibrary lib={lib} lang={lang} T={T} reload={reload} />
          : <PackManager lib={lib} lang={lang} T={T} reload={reload} />}
      </Card>
    </div>
  );
}
