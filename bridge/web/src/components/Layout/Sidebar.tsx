import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  FolderKanban,
  MessageSquare,
  Clock,
  Settings,
  ChevronLeft,
  ChevronRight,
  Plug,
  Puzzle,
  Library,
  UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import VersionBadge from './VersionBadge';

const navItems = [
  // add a role / model on top of the current setup (SetupWizard add mode, append_only)
  { key: 'addRole', path: '/setup?add=1', icon: UserPlus },
  { key: 'dashboard', path: '/', icon: LayoutDashboard },
  { key: 'projects', path: '/projects', icon: FolderKanban },
  { key: 'providers', path: '/providers', icon: Plug },
  { key: 'skills', path: '/skills', icon: Puzzle },
  { key: 'chat', path: '/chat', icon: MessageSquare },
  { key: 'cron', path: '/cron', icon: Clock },
  { key: 'library', path: '/library', icon: Library },
  { key: 'system', path: '/system', icon: Settings },
];

export default function Sidebar() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'h-screen flex flex-col border-r transition-all duration-300 ease-out',
        'bg-white/75 backdrop-blur-xl border-gray-200/80',
        'dark:bg-[rgba(0,0,0,0.85)] dark:backdrop-blur-xl dark:border-white/[0.08]',
        collapsed ? 'w-16' : 'w-56',
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          'flex items-center px-4 h-14 border-b transition-colors shrink-0',
          'border-gray-200/80 dark:border-white/[0.08]',
          collapsed ? 'justify-center' : 'gap-0',
        )}
      >
        {collapsed ? (
          <span title="bothouse" aria-label="bothouse" className="text-base font-bold tracking-tighter text-gray-900 dark:text-white">
            bh
          </span>
        ) : (
          <span className="text-base font-bold tracking-tight text-gray-900 dark:text-white">
            bothouse<span className="text-accent">.</span>
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
        {navItems.map(({ key, path, icon: Icon }) => (
          <NavLink
            key={key}
            to={path}
            end={path === '/'}
            data-testid={key === 'addRole' ? 'nav-add-role' : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-accent/12 text-accent ring-1 ring-accent/25'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.06] hover:text-gray-900 dark:hover:text-white',
              )
            }
          >
            <Icon size={18} className="shrink-0" />
            {!collapsed && <span>{t(`nav.${key}`)}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Version + update, then collapse toggle */}
      <div className={cn('border-t p-2', 'border-gray-200/80 dark:border-white/[0.08]')}>
        <VersionBadge collapsed={collapsed} />
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            'flex items-center justify-center w-full px-3 py-2 rounded-xl transition-colors duration-200',
            'text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.06]',
          )}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
    </aside>
  );
}
