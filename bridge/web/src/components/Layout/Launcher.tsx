import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import VersionBadge from './VersionBadge';
import { navGroups } from './navItems';

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

/**
 * "All features": every page that is not a top-bar tab, grouped. Desktop shows it as a popover
 * under the top bar, phones as a bottom sheet behind the "more" tab.
 */
export function Launcher({ onNavigate, className }: { onNavigate: () => void; className?: string }) {
  const { t } = useTranslation();
  const groups = navGroups;
  return (
    <div className={cn('flex flex-col', className)}>
      <NavLink
        to="/setup?add=1"
        data-testid="nav-add-role"
        onClick={onNavigate}
        className={cn(
          'mb-4 flex items-center gap-3 rounded-card bg-accent-wash p-3 text-sm font-medium text-accent-text',
          'transition-colors duration-base ease-ui-out hover:bg-accent/15',
          focusRing,
        )}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-accent text-white dark:text-black yellow:text-gray-900">
          <Plus size={18} />
        </span>
        <span className="min-w-0">
          <span className="block">{t('nav.addRole')}</span>
          <span className="block text-xs font-normal text-ink-soft">{t('shell.addRoleHint')}</span>
        </span>
      </NavLink>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
        {groups.map((group) => (
          <div key={group.key} className="min-w-0">
            <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{t(`navGroup.${group.key}`)}</p>
            <div className="space-y-0.5">
              {group.items.map(({ key, path, icon: Icon }) => (
                <NavLink
                  key={key}
                  to={path}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group flex h-11 items-center gap-2.5 rounded-control px-2 text-sm sm:h-9',
                      'transition-colors duration-base ease-ui-out',
                      isActive ? 'bg-accent-wash font-medium text-accent-text' : 'text-ink-soft hover:bg-surface-sunken hover:text-ink',
                      focusRing,
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-[8px] ring-1 transition-colors duration-base',
                        isActive ? 'bg-surface text-accent-text ring-accent/30' : 'bg-surface-sunken text-ink-mute ring-hairline group-hover:text-ink')}>
                        <Icon size={15} strokeWidth={1.8} />
                      </span>
                      <span className="truncate">{t(`nav.${key}`)}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-hairline pt-3">
        <VersionBadge collapsed={false} />
      </div>
    </div>
  );
}
