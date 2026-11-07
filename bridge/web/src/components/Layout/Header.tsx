import { useTranslation } from 'react-i18next';
import { useState, useRef, useEffect } from 'react';
import {
  RefreshCw, LogOut, Languages, Menu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useThemeStore, NEXT_THEME, NEXT_WIZARD_THEME } from '@/store/theme';
import { THEME_ICONS } from '@/components/Theme/themeIcons';
import { useAuthStore } from '@/store/auth';
import { useLocation } from 'react-router-dom';
import { wizardTexts } from '@/pages/Setup/texts';

const languages = [
  { code: 'en', label: 'EN' },
  { code: 'zh', label: '中文' },
  { code: 'zh-TW', label: '繁體' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'ES' },
  { code: 'ru', label: 'RU' },
];

// 顶栏是「浮层」：玻璃底 + 1px hairline，只在这里用 backdrop-filter（§4 玻璃只给顶栏/命令面板/弹层）。
// 交互档与 Modal 关闭按钮同一套：图标按钮 36px、可达焦点环 accent-text。
const iconBtn = cn(
  // 手机 44px、指针设备 36px（README 达标线：手机点按目标 ≥44px）
  'grid h-11 w-11 place-items-center rounded-control text-ink-soft sm:h-9 sm:w-9',
  'transition-colors duration-base ease-ui-out',
  'hover:bg-surface-sunken hover:text-ink',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
);

export default function Header({ onMenuClick }: { onMenuClick?: () => void }) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useThemeStore();
  const isSetup = useLocation().pathname === '/setup';
  const T = wizardTexts(i18n.language);
  const logout = useAuthStore((s) => s.logout);
  const [spinning, setSpinning] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleRefresh = () => {
    setSpinning(true);
    window.dispatchEvent(new CustomEvent('cc:refresh'));
    setTimeout(() => setSpinning(false), 1000);
  };

  const ThemeIcon = THEME_ICONS[theme];
  const nextWizard = NEXT_WIZARD_THEME[theme];
  const wizardStyleLabel = { yellow: T.yellowStyle, light: T.lightStyle, dark: T.darkStyle, system: T.yellowStyle };

  const changeLang = (code: string) => {
    i18n.changeLanguage(code);
    localStorage.setItem('cc_lang', code);
    setLangOpen(false);
  };

  return (
    <header
      className={cn(
        // 顶部安全区由外壳统一让出（iPhone 刘海），加在原高之上；页面不用各自加
        'ui-safe-bar relative z-20 flex shrink-0 items-center justify-end gap-1 px-4',
        'border-b border-hairline bg-surface',
      )}
    >
      {!isSetup && (
        <button
          type="button"
          onClick={onMenuClick}
          className={cn(iconBtn, 'mr-auto md:hidden')}
          aria-label="Open navigation menu"
          aria-controls="mobile-navigation"
          data-testid="mobile-menu-button"
        >
          <Menu size={20} />
        </button>
      )}
      {isSetup && (
        <span className="mr-auto text-base font-bold tracking-tight text-ink">
          bothouse<span className="text-accent">.</span>
        </span>
      )}
      <button type="button" onClick={handleRefresh} className={iconBtn} aria-label={t('common.refresh')}>
        <RefreshCw size={16} className={spinning ? 'animate-spin' : ''} />
      </button>

      {/* Language */}
      <div className="relative" ref={langRef}>
        {/* #205: iconBtn is a one-column grid, so icon + label stacked and 「中文」 wrapped to two lines; lay them out in a row. */}
        <button type="button" onClick={() => setLangOpen(!langOpen)} className={cn(iconBtn, 'w-auto sm:w-auto grid-flow-col auto-cols-max gap-1 whitespace-nowrap px-2')}>
          <Languages size={16} />
          <span className="hidden text-xs sm:inline">{languages.find(l => l.code === i18n.language)?.label}</span>
        </button>
        {langOpen && (
          <div
            className={cn(
              'absolute right-0 top-full z-50 mt-1.5 w-36 overflow-hidden rounded-card p-1',
              'border border-hairline bg-surface shadow-ui-2',
              'animate-[ui-rise_240ms_var(--ui-ease-out)]',
            )}
          >
            {languages.map(l => (
              <button
                key={l.code}
                type="button"
                onClick={() => changeLang(l.code)}
                className={cn(
                  'w-full rounded-control px-3 py-1.5 text-left text-sm transition-colors duration-base ease-ui-out',
                  i18n.language === l.code
                    ? 'bg-accent-wash font-medium text-accent-text'
                    : 'text-ink-soft hover:bg-surface-sunken hover:text-ink',
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Theme */}
      <button type="button" onClick={() => setTheme(isSetup ? nextWizard : NEXT_THEME[theme])}
        className={cn(iconBtn, isSetup && 'w-auto gap-2 px-2 text-xs ring-1 ring-hairline')}
        aria-label={isSetup ? T.switchStyle : t('theme.toggle')} title={isSetup ? undefined : t(`theme.${theme}`)} data-testid="theme-toggle">
        <ThemeIcon size={16} />
        {isSetup && <span>{wizardStyleLabel[nextWizard]}</span>}
      </button>

      {/* Logout */}
      <button
        type="button"
        onClick={logout}
        className={cn(iconBtn, 'text-ink-mute hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400')}
        aria-label={t('login.logout')}
      >
        <LogOut size={16} />
      </button>
    </header>
  );
}
