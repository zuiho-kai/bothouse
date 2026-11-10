import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, LogOut, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { primaryNav, navItemFor, isPrimary } from './navItems';
import { Launcher } from './Launcher';

const tabs = primaryNav.filter((i) => i.key !== 'usage');

/** Phone navigation: four tabs plus "more", which opens every other page as a bottom sheet. */
export default function MobileNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const current = navItemFor(pathname);
  const onMore = !!current && !isPrimary(current) || current?.key === 'usage';

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const tab = 'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors duration-base focus-visible:outline-none focus-visible:bg-ink/[0.05]';

  return (
    <>
      <nav
        aria-label="bothouse"
        className="ui-safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-canvas/90 backdrop-blur-md md:hidden"
        data-testid="mobile-tabbar"
      >
        <div className="flex h-16">
          {tabs.map(({ key, path, icon: Icon }) => (
            <NavLink key={key} to={path} end={path === '/'} className={({ isActive }) => cn(tab, isActive ? 'text-accent-text' : 'text-ink-mute')}>
              {({ isActive }) => (
                <>
                  <span className={cn('grid h-7 w-12 place-items-center rounded-pill transition-colors duration-base', isActive && 'bg-accent-wash')}>
                    <Icon size={19} strokeWidth={isActive ? 2.1 : 1.8} />
                  </span>
                  <span className="truncate">{t(`nav.${key}`)}</span>
                </>
              )}
            </NavLink>
          ))}
          <button type="button" onClick={() => setOpen(true)} className={cn(tab, onMore || open ? 'text-accent-text' : 'text-ink-mute')} data-testid="mobile-menu-button" aria-expanded={open}>
            <span className={cn('grid h-7 w-12 place-items-center rounded-pill', (onMore || open) && 'bg-accent-wash')}>
              <LayoutGrid size={19} strokeWidth={1.9} />
            </span>
            <span>{t('shell.more')}</span>
          </button>
        </div>
      </nav>

      {open && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] md:hidden" onClick={() => setOpen(false)} data-testid="mobile-menu-backdrop" />
          <div
            role="dialog"
            aria-label={t('shell.allFeatures')}
            className="ui-safe-bottom fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-[24px] border-t border-hairline bg-surface px-4 pb-4 pt-2 shadow-ui-3 animate-[ui-rise_240ms_var(--ui-ease-out)] md:hidden"
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-pill bg-hairline-strong" aria-hidden />
            <div className="mb-3 flex items-center justify-between">
              <p className="text-base font-semibold text-ink">{t('shell.allFeatures')}</p>
              <button type="button" onClick={() => setOpen(false)} className="grid h-11 w-11 place-items-center rounded-control text-ink-soft hover:bg-surface-sunken" aria-label="Close" data-testid="mobile-menu-close">
                <X size={18} />
              </button>
            </div>
            <Launcher onNavigate={() => setOpen(false)} withPrimary />
            <button type="button" onClick={logout} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-control border border-hairline text-sm font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400">
              <LogOut size={16} />{t('login.logout')}
            </button>
          </div>
        </>
      )}
    </>
  );
}
