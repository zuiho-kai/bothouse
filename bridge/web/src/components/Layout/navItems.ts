import {
  LayoutDashboard,
  Activity,
  FolderKanban,
  MessageSquare,
  MessagesSquare,
  Clock,
  Settings,
  Plug,
  Puzzle,
  Library,
  Image as ImageIcon,
  Users,
  Laptop,
  Smartphone,
  Network,
  Boxes,
  ShieldCheck,
  Award,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  key: string;
  path: string;
  icon: LucideIcon;
}

export interface NavGroup {
  key: string;
  items: NavItem[];
}

// #579 v2: the panel used to open on a sidebar of 19 equal rows. The five pages people live in
// are tabs in the top bar (and the phone's bottom bar); everything else sits one click away in
// the "all features" launcher, grouped by what the owner is doing. Every route is still listed.
export const primaryNav: NavItem[] = [
  { key: 'dashboard', path: '/', icon: LayoutDashboard },
  { key: 'roles', path: '/roles', icon: Users },
  { key: 'chat', path: '/chat', icon: MessageSquare },
  { key: 'sessions', path: '/sessions', icon: MessagesSquare },
  { key: 'usage', path: '/usage', icon: Activity },
];

export const navGroups: NavGroup[] = [
  {
    key: 'collab',
    items: [
      { key: 'projects', path: '/projects', icon: FolderKanban },
      { key: 'cron', path: '/cron', icon: Clock },
      // 记忆论坛 (#1143): the memories roles get each turn, as ranked posts (gate GET /forum)
      { key: 'forum', path: '/forum', icon: Award },
      { key: 'library', path: '/library', icon: Library },
      { key: 'wikiGalaxy', path: '/wiki-galaxy', icon: Sparkles },
    ],
  },
  {
    key: 'connect',
    items: [
      // 接入应用 (#150): which outside apps (QQ / Discord / 飞书) are wired, one row each
      { key: 'apps', path: '/apps', icon: Smartphone },
      { key: 'bridge', path: '/bridge', icon: Network },
      { key: 'providers', path: '/providers', icon: Plug },
      { key: 'devices', path: '/devices', icon: Laptop },
    ],
  },
  {
    key: 'extend',
    items: [
      // 插件 (#150 第b项): the DSH profile's own plugins — install, switch on/off
      { key: 'plugins', path: '/plugins', icon: Boxes },
      { key: 'skills', path: '/skills', icon: Puzzle },
      // 生图 (#150 第c项): opt-in [image_gen], writes a local file and never posts it
      { key: 'imageGen', path: '/image-gen', icon: ImageIcon },
    ],
  },
  {
    key: 'settings',
    items: [
      // 闸门设置 (#217): 装好以后改谁在什么时候接话、判断用的模型，不用重装
      { key: 'gate', path: '/gate', icon: ShieldCheck },
      { key: 'system', path: '/system', icon: Settings },
    ],
  },
];

const allItems: NavItem[] = [...primaryNav, ...navGroups.flatMap((g) => g.items)];

/** Nav item of the page at `pathname` (longest matching route). */
export function navItemFor(pathname: string): NavItem | undefined {
  if (pathname === '/') return primaryNav[0];
  let best: NavItem | undefined;
  for (const item of allItems) {
    if (item.path === '/') continue;
    if ((pathname === item.path || pathname.startsWith(`${item.path}/`)) && (!best || item.path.length > best.path.length)) best = item;
  }
  return best;
}

/** Nav key of the page at `pathname`, for the header's page title. */
export function navKeyFor(pathname: string): string | undefined {
  if (pathname.startsWith('/setup')) return 'addRole';
  return navItemFor(pathname)?.key;
}

export function isPrimary(item: NavItem | undefined): boolean {
  return !!item && primaryNav.includes(item);
}
