import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass, Home } from 'lucide-react';

// A wrong address used to render nothing: the router had no catch-all route, so the layout
// mounted with an empty outlet and people saw a white page. Say what happened, show the path
// that missed, and give one way back.
export default function NotFound() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center animate-fade-in">
      <span className="grid h-12 w-12 place-items-center rounded-pill border border-hairline bg-surface">
        <Compass size={22} strokeWidth={1.25} className="text-ink-mute" />
      </span>
      <p className="mt-4 font-mono text-[11px] tracking-[0.3em] text-ink-mute">404</p>
      <h1 className="mt-1 text-lg font-semibold text-ink">{t('notFound.title')}</h1>
      <p className="mt-1 max-w-sm text-sm text-ink-soft">{t('notFound.hint')}</p>
      <code className="mt-3 max-w-full truncate rounded-control bg-surface-sunken px-2.5 py-1 font-mono text-xs text-ink-soft ring-1 ring-hairline">
        {pathname}
      </code>
      <Link
        to="/"
        className="mt-5 inline-flex items-center gap-2 rounded-control bg-surface-sunken px-4 py-2 text-sm font-medium text-ink-soft ring-1 ring-hairline transition-colors duration-base ease-ui-out hover:bg-accent-wash hover:text-ink focus-visible:outline-none focus-visible:shadow-ui-ring"
      >
        <Home size={14} strokeWidth={1.6} />
        {t('notFound.home')}
      </Link>
    </div>
  );
}
