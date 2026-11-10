import { useTranslation } from 'react-i18next';
import { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { RefreshCw, LogOut, Languages, LayoutGrid, ChevronDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useThemeStore, NEXT_THEME, NEXT_WIZARD_THEME } from '@/store/theme';
import { THEME_ICONS } from '@/components/Theme/themeIcons';
import { useAuthStore } from '@/store/auth';
import { wizardTexts } from '@/pages/Setup/texts';
import { navItemFor, navKeyFor, primaryNav, isPrimary } from './navItems';
import { BrandMark, isFramed } from './Brand';
import { Launcher } from './Launcher';

const languages = [
  { code: 'en', label: 'EN' },
  { code: 'zh', label: '中文' },
  { code: 'zh-TW', label: '繁體' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'ES' },
  { code: 'ru', label: 'RU' },
];

const ring = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-canvas';

// Icon buttons: 44px on phones, 36px with a pointer (README 达标线：手机点按目标 ≥44px).
const iconBtn = cn(
  'grid h-11 w-11 shrink-0 place-items-center rounded-control text-ink-soft md:h-9 md:w-9',
  'transition-colors duration-base ease-ui-out hover:bg-ink/[0.05] hover:text-ink dark:hover:bg-white/[0.06]',
  ring,
);

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);
  return ref;
}

/**
 * #579 v2 top bar: brand, the five everyday pages as tabs, an "all features" launcher for the
 * rest, then the page tools. It replaces the old 19-row sidebar, so framed inside DSH (which has
 * its own sidebar) the panel no longer shows a second one.
 */
export default function Header() {
  const { t, i18n } = useTranslation();
  const { theme, resolved, setTheme } = useThemeStore();
  const { pathname } = useLocation();
  const isSetup = pathname === '/setup';
  const current = navItemFor(pathname);
  const pageKey = navKeyFor(pathname);
  const T = wizardTexts(i18n.language);
  const logout = useAuthStore((s) => s.logout);
  const [spinning, setSpinning] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const langRef = useDismiss(langOpen, () => setLangOpen(false));
  const launcherRef = useDismiss(launcherOpen, () => setLauncherOpen(false));
  const framed = isFramed();

  useEffect(() => { setLauncherOpen(false); }, [pathname]);

  const handleRefresh = () => {
    setSpinning(true);
    window.dispatchEvent(new CustomEvent('cc:refresh'));
    setTimeout(() => setSpinning(false), 1000);
  };

  const ThemeIcon = THEME_ICONS[theme];
  const nextWizard = NEXT_WIZARD_THEME[theme];
  // #225: the wizard button names the style the page is in now, not the one a click would switch to.
  const wizardStyleLabel = {
    yellow: T.yellowStyle, light: T.lightStyle, dark: T.darkStyle,
    system: resolved === 'dark' ? T.darkStyle : T.lightStyle,
  };

  const changeLang = (code: string) => {
    i18n.changeLanguage(code);
    localStorage.setItem('cc_lang', code);
    setLangOpen(false);
  };

  // On a launcher page the launcher button names that page, so the bar still says where you are.
  const onSecondary = !isSetup && current && !isPrimary(current);
  const SecondaryIcon = onSecondary ? current!.icon : LayoutGrid;

  return (
    <header
      className={cn(
        'ui-safe-bar relative z-30 flex shrink-0 items-center gap-1 px-3 md:gap-2 md:px-5',
        'border-b border-hairline bg-canvas/80 backdrop-blur-md supports-[backdrop-filter]:bg-canvas/70',
      )}
    >
      <NavLink to="/" className={cn('mr-1 flex shrink-0 items-center gap-2.5 rounded-control pr-1 md:mr-3', ring)} aria-label="bothouse">
        <BrandMark />
        <span className={cn('text-[15px] font-semibold tracking-tight text-ink', framed ? 'hidden xl:inline' : 'hidden lg:inline')}>bothouse</span>
      </NavLink>

      {isSetup ? (
        <span className="mr-auto truncate text-sm font-medium text-ink">{t('nav.addRole')}</span>
      ) : (
        <>
          {/* Phone: the page name; the tabs live in the bottom bar */}
          <span className="mr-auto min-w-0 truncate text-[15px] font-semibold text-ink md:hidden" data-testid="header-page-title">
            {pageKey ? t(`nav.${pageKey}`) : ''}
          </span>

          <nav aria-label="bothouse" className="hidden min-w-0 items-center gap-0.5 rounded-[12px] bg-ink/[0.04] p-1 dark:bg-white/[0.05] md:flex">
            {primaryNav.map(({ key, path, icon: Icon }) => (
              <NavLink
                key={key}
                to={path}
                end={path === '/'}
                className={({ isActive }) => cn(
                  'flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13px] transition-[background-color,color,box-shadow] duration-base ease-ui-out',
                  isActive ? 'bg-surface font-semibold text-ink shadow-ui-1' : 'font-medium text-ink-soft hover:text-ink',
                  ring,
                )}
              >
                {({ isActive }) => (
                  <>
                    <Icon size={15} strokeWidth={isActive ? 2.1 : 1.8} className={cn('shrink-0', isActive ? 'text-accent-text' : 'text-ink-mute')} />
                    <span className={cn(key === 'usage' && 'hidden lg:inline')}>{t(`nav.${key}`)}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="relative hidden md:block" ref={launcherRef}>
            <button
              type="button"
              onClick={() => setLauncherOpen((v) => !v)}
              aria-expanded={launcherOpen}
              aria-haspopup="dialog"
              data-testid="launcher-button"
              className={cn(
                'flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 text-[13px] font-medium transition-colors duration-base ease-ui-out',
                onSecondary ? 'bg-accent-wash text-accent-text' : 'text-ink-soft hover:bg-ink/[0.05] hover:text-ink dark:hover:bg-white/[0.06]',
                ring,
              )}
            >
              <SecondaryIcon size={15} strokeWidth={1.9} />
              <span>{onSecondary ? t(`nav.${current!.key}`) : t('shell.allFeatures')}</span>
              <ChevronDown size={14} className={cn('transition-transform duration-base', launcherOpen && 'rotate-180')} />
            </button>
            {launcherOpen && (
              <div
                role="dialog"
                aria-label={t('shell.allFeatures')}
                className="absolute left-0 top-full z-50 mt-2 w-[min(720px,calc(100vw-6rem))] rounded-panel border border-hairline bg-surface p-4 shadow-ui-3 animate-[ui-rise_240ms_var(--ui-ease-out)]"
              >
                <Launcher onNavigate={() => setLauncherOpen(false)} />
              </div>
            )}
          </div>
          <span className="hidden flex-1 md:block" />
          <NavLink
            to="/setup?add=1"
            className={cn('hidden h-9 items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-accent px-3 text-[13px] font-semibold text-white shadow-ui-gloss-1 transition-colors duration-base hover:bg-accent-dim dark:text-black yellow:text-gray-900 md:flex', ring)}
            title={t('nav.addRole')}
          >
            <Plus size={15} strokeWidth={2.2} />
            <span className="hidden xl:inline">{t('nav.addRole')}</span>
          </NavLink>
        </>
      )}

      <button type="button" onClick={handleRefresh} className={iconBtn} aria-label={t('common.refresh')} title={t('common.refresh')}>
        <RefreshCw size={16} className={spinning ? 'animate-spin' : ''} />
      </button>

      <div className="relative" ref={langRef}>
        <button type="button" onClick={() => setLangOpen(!langOpen)} className={cn(iconBtn, 'w-auto md:w-auto grid-flow-col auto-cols-max gap-1 whitespace-nowrap px-2')} aria-label="Language">
          <Languages size={16} />
          <span className="hidden text-xs lg:inline">{languages.find(l => l.code === i18n.language)?.label}</span>
        </button>
        {langOpen && (
          <div className="absolute right-0 top-full z-50 mt-1.5 w-36 overflow-hidden rounded-card border border-hairline bg-surface p-1 shadow-ui-2 animate-[ui-rise_240ms_var(--ui-ease-out)]">
            {languages.map(l => (
              <button
                key={l.code}
                type="button"
                onClick={() => changeLang(l.code)}
                className={cn(
                  'w-full rounded-control px-3 py-1.5 text-left text-sm transition-colors duration-base ease-ui-out',
                  i18n.language === l.code ? 'bg-accent-wash font-medium text-accent-text' : 'text-ink-soft hover:bg-surface-sunken hover:text-ink',
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button type="button" onClick={() => setTheme(isSetup ? nextWizard : NEXT_THEME[theme])}
        className={cn(iconBtn, isSetup && 'w-auto md:w-auto grid-flow-col auto-cols-max shrink-0 whitespace-nowrap gap-2 px-2 text-xs ring-1 ring-hairline')}
        aria-label={isSetup ? T.switchStyle : t('theme.toggle')} title={isSetup ? undefined : t(`theme.${theme}`)} data-testid="theme-toggle">
        <ThemeIcon size={16} />
        {isSetup && <span>{wizardStyleLabel[theme]}</span>}
      </button>

      <button
        type="button"
        onClick={logout}
        className={cn(iconBtn, 'hidden text-ink-mute hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 md:grid')}
        aria-label={t('login.logout')}
        title={t('login.logout')}
      >
        <LogOut size={16} />
      </button>
    </header>
  );
}
