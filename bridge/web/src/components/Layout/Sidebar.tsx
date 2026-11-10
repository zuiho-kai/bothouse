import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import VersionBadge from './VersionBadge';
import { navGroups } from './navItems';

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-canvas';

/** The bothouse mark: one rounded square in the accent, so the brand reads at 16px too. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-accent text-[13px] font-bold leading-none text-white shadow-ui-gloss-1 dark:text-black yellow:text-gray-900', className)}>
      b
    </span>
  );
}

function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // a cross-origin parent throws on access: that is still a frame
  }
}

export default function Sidebar({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const { t } = useTranslation();
  // #579: framed inside DSH (or any host page) the host already has its own sidebar; two full
  // sidebars side by side ate ~520px, so the panel starts as an icon rail there. One click expands.
  const [collapsed, setCollapsed] = useState(isFramed);

  return (
    <>
      <button
        type="button"
        aria-label="Close navigation menu"
        className={cn('fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] md:hidden', !mobileOpen && 'hidden')}
        onClick={onMobileClose}
        data-testid="mobile-menu-backdrop"
      />
      <aside
        id="mobile-navigation"
        className={cn(
          'ui-safe-drawer fixed inset-y-0 left-0 z-40 flex w-64 flex-col md:relative md:z-auto md:h-screen md:translate-x-0',
          // 侧栏比内容区低一档（chrome 色），内容卡片浮在白底上，层级不靠阴影
          'border-r border-hairline bg-chrome',
          'transition-[width,transform] duration-state ease-ui-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
          collapsed ? 'md:w-16' : 'md:w-60',
        )}
      >
        {/* Brand */}
        <div className={cn('ui-safe-bar flex shrink-0 items-center gap-2.5 px-4', collapsed && 'md:justify-center md:px-0')}>
          <BrandMark />
          <span className={cn('text-[15px] font-semibold tracking-tight text-ink', collapsed && 'md:hidden')}>bothouse</span>
          <button
            type="button"
            onClick={onMobileClose}
            className="ml-auto grid h-11 w-11 place-items-center rounded-control text-ink-soft transition-colors duration-base hover:bg-surface-sunken hover:text-ink md:hidden"
            aria-label="Close navigation menu"
            data-testid="mobile-menu-close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Primary action: add a role / model on top of the current setup (SetupWizard add mode) */}
        <div className={cn('px-3 pb-2', collapsed && 'md:px-2')}>
          <NavLink
            to="/setup?add=1"
            data-testid="nav-add-role"
            onClick={onMobileClose}
            title={collapsed ? t('nav.addRole') : undefined}
            className={cn(
              'flex h-11 items-center gap-2 rounded-control border border-hairline bg-surface px-3 text-sm font-medium text-ink shadow-ui-gloss-1 md:h-9',
              'transition-[background-color,border-color,box-shadow] duration-base ease-ui-out hover:border-hairline-strong hover:shadow-ui-gloss-2',
              collapsed && 'md:justify-center md:px-0',
              focusRing,
            )}
          >
            <Plus size={16} className="shrink-0 text-accent" />
            <span className={cn('truncate', collapsed && 'md:hidden')}>{t('nav.addRole')}</span>
          </NavLink>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="bothouse">
          {navGroups.map(group => (
            <div key={group.key} className="pt-4 first:pt-2">
              <p className={cn('px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-mute', collapsed && 'md:sr-only')}>
                {t(`navGroup.${group.key}`)}
              </p>
              <div className="space-y-0.5">
                {group.items.map(({ key, path, icon: Icon }) => (
                  <NavLink
                    key={key}
                    to={path}
                    end={path === '/'}
                    onClick={onMobileClose}
                    title={collapsed ? t(`nav.${key}`) : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group flex h-11 items-center gap-2.5 rounded-control px-2 text-sm md:h-8',
                        'transition-[background-color,color,box-shadow] duration-base ease-ui-out',
                        collapsed && 'md:justify-center md:px-0',
                        // 房规：强调色不上外壳；选中 = 白卡浮起（与 DSH 侧栏同一手法），不用彩色底和左竖条
                        isActive
                          ? 'bg-surface font-medium text-ink shadow-ui-1'
                          : 'text-ink-soft hover:bg-ink/[0.04] hover:text-ink dark:hover:bg-white/[0.05]',
                        focusRing,
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon size={16} strokeWidth={isActive ? 2 : 1.75} className={cn('shrink-0', isActive ? 'text-accent' : 'text-ink-mute group-hover:text-ink-soft')} />
                        <span className={cn('truncate', collapsed && 'md:hidden')}>{t(`nav.${key}`)}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Version + update, then collapse toggle */}
        <div className="ui-safe-bottom border-t border-hairline p-2">
          <VersionBadge collapsed={collapsed} />
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'mt-1 hidden h-8 w-full place-items-center rounded-control text-ink-mute md:grid',
              'transition-colors duration-base ease-ui-out hover:bg-ink/[0.04] hover:text-ink',
              focusRing,
            )}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </aside>
    </>
  );
}
