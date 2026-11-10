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

// The sidebar used to be one flat list of 19 rows; grouped by what the owner is doing (look,
// work together, wire things up, extend, configure) it scans in one glance. Same routes as before.
export const navGroups: NavGroup[] = [
  {
    key: 'main',
    items: [
      { key: 'dashboard', path: '/', icon: LayoutDashboard },
      { key: 'roles', path: '/roles', icon: Users },
      { key: 'chat', path: '/chat', icon: MessageSquare },
      { key: 'sessions', path: '/sessions', icon: MessagesSquare },
      { key: 'usage', path: '/usage', icon: Activity },
    ],
  },
  {
    key: 'collab',
    items: [
      { key: 'projects', path: '/projects', icon: FolderKanban },
      { key: 'cron', path: '/cron', icon: Clock },
      // 记忆论坛 (#1143): the memories roles get each turn, as ranked posts (gate GET /forum)
      { key: 'forum', path: '/forum', icon: Award },
      { key: 'library', path: '/library', icon: Library },
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

/** Nav key of the page at `pathname` (longest matching route), for the header's page title. */
export function navKeyFor(pathname: string): string | undefined {
  if (pathname === '/') return 'dashboard';
  if (pathname.startsWith('/wiki-galaxy')) return 'wikiGalaxy';
  if (pathname.startsWith('/setup')) return 'addRole';
  let best: NavItem | undefined;
  for (const g of navGroups) {
    for (const item of g.items) {
      if (item.path === '/') continue;
      if ((pathname === item.path || pathname.startsWith(`${item.path}/`)) && (!best || item.path.length > best.path.length)) best = item;
    }
  }
  return best?.key;
}
