import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Activity,
  FolderKanban,
  MessageSquare,
  MessagesSquare,
  Clock,
  Settings,
  ChevronLeft,
  ChevronRight,
  Plug,
  Puzzle,
  Library,
  Image as ImageIcon,
  UserPlus,
  Users,
  Laptop,
  Smartphone,
  Network,
  Boxes,
  Sparkles,
  ShieldCheck,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import VersionBadge from './VersionBadge';

const navItems = [
  // add a role / model on top of the current setup (SetupWizard add mode, append_only)
  { key: 'addRole', path: '/setup?add=1', icon: UserPlus },
  { key: 'dashboard', path: '/', icon: LayoutDashboard },
  { key: 'usage', path: '/usage', icon: Activity },
  { key: 'roles', path: '/roles', icon: Users },
  { key: 'devices', path: '/devices', icon: Laptop },
  // 插件 (#150 第b项): the DSH profile's own plugins — install, switch on/off
  { key: 'plugins', path: '/plugins', icon: Boxes },
  // #145：Wiki 星河从 DSH 一级入口收进 bothouse，作为这里的子页面
  { key: 'wikiGalaxy', path: '/wiki-galaxy', icon: Sparkles },
  // 接入应用 (#150): which outside apps (QQ / Discord / 飞书) are wired, one row each
  { key: 'apps', path: '/apps', icon: Smartphone },
  // 闸门设置 (#217): 装好以后改谁在什么时候接话、判断用的模型，不用重装
  { key: 'gate', path: '/gate', icon: ShieldCheck },
  { key: 'projects', path: '/projects', icon: FolderKanban },
  { key: 'sessions', path: '/sessions', icon: MessagesSquare },
  { key: 'providers', path: '/providers', icon: Plug },
  { key: 'bridge', path: '/bridge', icon: Network },
  { key: 'skills', path: '/skills', icon: Puzzle },
  { key: 'chat', path: '/chat', icon: MessageSquare },
  { key: 'cron', path: '/cron', icon: Clock },
  { key: 'library', path: '/library', icon: Library },
  // 生图 (#150 第c项): opt-in [image_gen], writes a local file and never posts it
  { key: 'imageGen', path: '/image-gen', icon: ImageIcon },
  { key: 'system', path: '/system', icon: Settings },
];

export default function Sidebar({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Close navigation menu"
        className={cn('fixed inset-0 z-30 bg-black/40 md:hidden', !mobileOpen && 'hidden')}
        onClick={onMobileClose}
        data-testid="mobile-menu-backdrop"
      />
      <aside
        id="mobile-navigation"
        className={cn(
          'ui-safe-drawer fixed inset-y-0 left-0 z-40 flex w-64 flex-col md:relative md:z-auto md:h-screen md:translate-x-0',
          // 侧栏也是浮层：与顶栏同一块玻璃，宽度与位移用状态档 320ms
          'border-r border-hairline bg-surface',
          'transition-[width,transform] duration-state ease-ui-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
          collapsed ? 'md:w-16' : 'md:w-56',
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            'ui-safe-bar flex shrink-0 items-center border-b border-hairline px-4',
            collapsed ? 'justify-center' : 'gap-0',
          )}
        >
          {collapsed ? (
            <span title="bothouse" aria-label="bothouse" className="hidden text-base font-bold tracking-tighter text-ink md:inline">
              bh
            </span>
          ) : (
            <span className="text-base font-bold tracking-tight text-ink">
              bothouse<span className="text-accent">.</span>
            </span>
          )}
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

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
        {navItems.map(({ key, path, icon: Icon }) => (
          <NavLink
            key={key}
            to={path}
            end={path === '/'}
            data-testid={key === 'addRole' ? 'nav-add-role' : undefined}
            onClick={onMobileClose}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium',
                'transition-colors duration-base ease-ui-out',
                // 房规：强调色不上外壳；选中用中性灰底 + 文字提亮，不用彩色底和左竖条
                isActive
                  ? 'bg-surface-sunken font-semibold text-ink'
                  : 'text-ink-soft hover:bg-surface-sunken hover:text-ink',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
              )
            }
          >
            <Icon size={18} className="shrink-0" />
            {!collapsed && <span>{t(`nav.${key}`)}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Version + update, then collapse toggle */}
      <div className="ui-safe-bottom border-t border-hairline p-2">
        <VersionBadge collapsed={collapsed} />
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            'mt-1 hidden w-full place-items-center rounded-control py-2 text-ink-mute md:grid',
            'transition-colors duration-base ease-ui-out hover:bg-surface-sunken hover:text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
          )}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
      </aside>
    </>
  );
}
