import { useState, useMemo } from 'react';
import {
  User,
  Users,
  ImageOff,
  Activity,
  ChevronDown,
  Download,
  ExternalLink,
  CheckCircle2,
  Sparkles,
  Boxes,
} from 'lucide-react';
import { Badge, Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { BothousePlugin, ExtendedRoleInfo, PluginRenderProps, RoleEvent, RoleEventType } from '../pluginInterface';
import {
  aggregateRoleStatus,
  getBusySessionCount,
  getDeduplicatedSpeech,
  getRoleKey,
} from '../roleAggregation';
import { PetPlayer, type PetAction } from '../pets/PetPlayer';
import { withBase } from '@/lib/basePath';
import api from '@/api/client';
import { PetPackImport, petDesktopLine } from './PetPackImport';

export type PetPackFormat = 'webp-sprite' | 'webm' | '';

export interface PetAsset {
  key: RoleEventType;
  title: string;
  actionName: string;
  filename: string;
  url: string;
  badgeText: string;
  badgeVariant: 'default' | 'success' | 'warning' | 'danger' | 'info';
  columns?: number;
  frameCount?: number;
  frameWidth?: number;
  frameHeight?: number;
  fps?: number;
}

export interface PetAssetPack {
  id: string;
  name: string;
  repo: string;
  description: string;
  format: PetPackFormat;
  installed: boolean;
  localPath?: string;
  formatSpecs: string;
  actionCount: number;
  recommendedRole?: string;
  avatarUrl?: string;
  manifest?: Record<string, unknown>;
  actionsList?: Array<Record<string, unknown>>;
  notice?: string;
  error?: string;
  assets: Record<RoleEventType, PetAsset>;
}

export const PET_ADAPTER_ID = 'dsh-pet';

// 来源：用户指定的两种形象包上游；这里只提供链接，不声明本机已装。
const SOURCES = [
  { id: 'webp-source', name: 'WebP 精灵图来源', repo: 'https://github.com/hunmer/aboutme-pets' },
  { id: 'webm-source', name: '透明 WebM 来源', repo: 'https://github.com/PC2005-cloud/dsh-pet' },
];

const STATE_LABELS: Record<RoleEventType, string> = {
  idle: '待机中', working: '干活中', thinking: '思考中',
  celebrate: '交活庆祝', error: '出错', speech: '说话',
};

// 来源：本机 hunmer/aboutme-pets 的 dsh1、claude 两个完整包 actions.json 里的真实动作名和 category（2026-11-09 核对）。
// 规则按顺序试，先命中的规则优先；同一规则内按包里的动作顺序取第一个。
type PetMatchRule = { name?: RegExp; category?: RegExp };
const EVENT_RULES: Record<RoleEventType, PetMatchRule[]> = {
  idle: [{ category: /^待机$/ }, { name: /待机|打瞌睡|idle/i }],
  working: [{ category: /^工作状态$/, name: /忙碌/ }, { name: /写代码|加班|忙碌|working|coding/i }],
  thinking: [{ category: /^工作状态$/, name: /思考/ }, { name: /思考|thinking/i }],
  celebrate: [{ category: /^工作状态$/, name: /庆祝|雀跃/ }, { name: /庆祝|雀跃|狂喜|celebrate/i }],
  error: [{ category: /^工作状态$/, name: /叹气|冒汗|垂头/ }, { name: /叹气|冒汗|垂头|扶额|error/i }],
  speech: [{ category: /^碎碎念$/ }, { name: /说话|碎碎念|speech/i }],
};

/** 按事件挑包里真正对应的动作；挑不到返回 null（调用方显示「没有对应动作」），不拿待机或第一个动作顶替。 */
export function matchPetAction(
  actions: Array<Record<string, unknown>>, eventType: RoleEventType, idleAnimationId?: unknown,
): Record<string, unknown> | null {
  const exact = actions.find(a => a.state === eventType || a.id === eventType);
  if (exact) return exact;
  if (eventType === 'idle' && idleAnimationId) {
    const idle = actions.find(a => a.id === idleAnimationId);
    if (idle) return idle;
  }
  for (const rule of EVENT_RULES[eventType]) {
    const hit = actions.find(a => (!rule.category || rule.category.test(String(a.category ?? '')))
      && (!rule.name || rule.name.test(String(a.name || a.id || ''))));
    if (hit) return hit;
  }
  return null;
}

export type PetResolution = { kind: 'asset'; asset: PetAsset } | { kind: 'unmatched' } | null;

/** 动作与规格来自本地包；不捏造帧数、文件名或已安装状态。包异常或规格坏返回 null，没有对应动作返回 unmatched。 */
export function resolvePetAsset(pack: PetAssetPack, eventType: RoleEventType): PetResolution {
  if (pack.error) return null;
  const manifest = pack.manifest || {};
  const actions = pack.actionsList ?? ((manifest.animations || []) as Record<string, any>[]);
  const matched = matchPetAction(actions, eventType, manifest.idleAnimationId) as Record<string, any> | null;
  if (!matched) return { kind: 'unmatched' };
  const sources = matched.sources as { webp?: string; webm?: string } | undefined;
  const filename = sources?.webm || sources?.webp || matched.file;
  if (typeof filename !== 'string' || !filename) return null;
  const query = new URLSearchParams({ pack: pack.id, file: filename });
  if (api.getToken()) query.set('token', api.getToken());
  const sheet = (matched.spritesheet || matched) as Record<string, unknown>;
  const sprite = !filename.toLowerCase().endsWith('.webm');
  if (sprite && !['columns', 'frameCount', 'frameWidth', 'frameHeight', 'fps'].every(
    key => typeof sheet[key] === 'number' && Number.isFinite(sheet[key]) && Number(sheet[key]) > 0
  )) return null;
  return { kind: 'asset', asset: {
    key: eventType, title: String(matched.name || matched.id || eventType),
    actionName: String(matched.name || matched.id || eventType), filename,
    url: withBase('/api/v1/plugins/pets/asset') + '?' + query,
    badgeText: STATE_LABELS[eventType],
    badgeVariant: eventType === 'error' ? 'danger' : eventType === 'working' || eventType === 'thinking' ? 'info' : 'default',
    columns: sheet.columns as number, frameCount: sheet.frameCount as number,
    frameWidth: sheet.frameWidth as number, frameHeight: sheet.frameHeight as number, fps: sheet.fps as number,
  } };
}

function PetVisualDisplay({ asset, roleKey, isHero }: {
  pack: PetAssetPack; asset: PetAsset; eventType: RoleEventType; roleKey: string; isHero: boolean;
}) {
  const { url, filename, columns, frameCount, frameWidth, frameHeight, fps } = asset;
  // PetPlayer 的动作对象保持稳定，避免每次角色事件都重置定时器。
  const action = useMemo<PetAction>(() => filename.toLowerCase().endsWith('.webm')
    ? { kind: 'video', src: url }
    : { kind: 'sprite', src: url, fps: fps!, sheet: { columns: columns!, frames: frameCount!, frameWidth: frameWidth!, frameHeight: frameHeight! } },
    [url, filename, columns, frameCount, frameWidth, frameHeight, fps]);
  return <div data-testid={`pet-img-${roleKey}`} className="w-full max-w-md">
    <PetPlayer action={action} size={{ width: '100%', height: isHero ? '13rem' : '9rem' }} errorText="素材加载异常" />
    <p className="mt-1 text-center text-xs text-ink-mute">动作：{asset.actionName}</p>
  </div>;
}

function RolePetCard({
  role,
  event,
  pack,
  isHero = false,
  availablePacks,
  onBindingChange,
  bindingsDisabled,
}: {
  role: ExtendedRoleInfo;
  event?: RoleEvent;
  pack: PetAssetPack | null;
  isHero?: boolean;
  availablePacks: Record<string, PetAssetPack>;
  onBindingChange: (roleKey: string, newPackId: string | null) => void;
  bindingsDisabled?: boolean;
}) {
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const roleKey = getRoleKey(role);

  // Determine active state: explicit event (e.g. simulator) takes precedence;
  // otherwise aggregate active_sessions by priority: 出错 > 干活/思考 > 庆祝 > 空闲
  let eventType: RoleEventType;
  if (event) {
    eventType = event.type === 'speech' ? (role.status || 'idle') : event.type;
  } else if (role.active_sessions && role.active_sessions.length > 0) {
    eventType = aggregateRoleStatus(role.active_sessions, role.busy ? 'working' : 'idle');
  } else {
    eventType = role.busy ? 'working' : 'idle';
  }

  // Offline or paused overrides
  const isOffline = role.online === false;
  const isPaused = role.paused === true;

  if (isOffline) eventType = 'error';
  else if (isPaused) eventType = 'idle';

  const resolution = pack ? resolvePetAsset(pack, eventType) : null;
  // asset 只代表当前事件真正匹配到的动作；匹配不到时画面停在上一次匹配到的动作，不拿别的动作冒充。
  const asset = resolution?.kind === 'asset' ? resolution.asset : null;
  const unmatched = resolution?.kind === 'unmatched';
  const [lastShown, setLastShown] = useState<{ packId: string; asset: PetAsset } | null>(null);
  if (pack && asset && (lastShown?.packId !== pack.id || lastShown.asset.url !== asset.url)) {
    setLastShown({ packId: pack.id, asset });
  }
  const shownAsset = asset ?? (unmatched && pack && lastShown?.packId === pack.id ? lastShown.asset : null);

  // Multi-session busy count
  const busyCount = role.busy_count ?? getBusySessionCount(role.active_sessions, role.busy, role.sessions_count);

  // Deduplicated speech bubble
  let bubbleText = getDeduplicatedSpeech(role.active_sessions, event);
  if (!bubbleText) {
    if (isOffline) {
      bubbleText = '已离线，等待连接恢复… 🔌';
    } else if (isPaused) {
      bubbleText = '已暂停，待命休息中 ⏸️';
    } else if (eventType === 'working') {
      bubbleText = role.current_task ? `正在干活：${role.current_task}` : '正在专注推进任务中… 噼里啪啦 ⚡';
    } else {
      bubbleText = STATE_LABELS[eventType];
    }
  }

  const badgeVariant = isOffline
    ? 'danger'
    : isPaused
    ? 'default'
    : asset
    ? asset.badgeVariant
    : eventType === 'working'
    ? 'info'
    : eventType === 'celebrate'
    ? 'success'
    : eventType === 'error'
    ? 'danger'
    : 'default';

  const badgeText = isOffline
    ? '已离线'
    : isPaused
    ? '已暂停'
    : asset
    ? asset.badgeText
    : eventType === 'working'
    ? '干活中'
    : eventType === 'thinking'
    ? '思考中'
    : eventType === 'celebrate'
    ? '交活庆祝'
    : eventType === 'error'
    ? '出错/冷却'
    : '待机中';

  const installedList = Object.values(availablePacks).filter((p) => p.installed);
  const uninstalledList = Object.values(availablePacks).filter((p) => !p.installed);

  return (
    <div key={roleKey} data-testid={`pet-card-${roleKey}`} className={isHero ? 'max-w-2xl mx-auto w-full' : ''}>
      <Card
        className={cn(
          'flex flex-col justify-between overflow-hidden border transition-all duration-200',
          eventType === 'working' && 'border-accent/40 bg-accent-wash/5',
          eventType === 'celebrate' && 'border-emerald-500/40 bg-emerald-500/5',
          eventType === 'error' && 'border-red-500/30 bg-red-500/5',
          isHero ? 'p-6' : 'p-4'
        )}
      >
        <div>
          {/* Card Header */}
          <div className="flex items-start justify-between gap-2 border-b border-hairline pb-3">
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={cn('font-bold text-ink', isHero ? 'text-lg' : 'text-base')}>
                  {role.display_name || role.name}
                </span>
                <span className="text-xs text-ink-mute font-mono" data-testid={`role-key-tag-${roleKey}`}>
                  ({roleKey})
                </span>
                {pack ? (
                  <Badge variant={pack.installed ? 'success' : 'warning'} className="text-[10px]">
                    {pack.name} {pack.installed ? '[本地已装]' : '[未安装]'}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-ink-soft">
                    形象待接入
                  </Badge>
                )}

                {/* Multi-session Busy Badge */}
                {busyCount > 0 && (
                  <button
                    type="button"
                    data-testid={`busy-badge-${roleKey}`}
                    onClick={() => setSessionsOpen((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-full bg-accent-wash px-2 py-0.5 text-[10px] font-semibold text-accent hover:opacity-80 transition-opacity"
                    title="点击查看多开会话状态"
                  >
                    <Activity size={10} />
                    <span>{busyCount} 处在忙</span>
                    {role.active_sessions && role.active_sessions.length > 0 && (
                      <ChevronDown
                        size={10}
                        className={cn('transition-transform duration-200', sessionsOpen && 'rotate-180')}
                      />
                    )}
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-xs text-ink-soft font-mono">
                {role.model || 'model'}
              </p>
            </div>
            <Badge variant={badgeVariant} className="shrink-0 text-[11px]">
              {badgeText}
            </Badge>
          </div>

          {/* Multi-session Task Expansion Panel */}
          {sessionsOpen && role.active_sessions && role.active_sessions.length > 0 && (
            <div
              data-testid={`sessions-list-${roleKey}`}
              className="mt-3 rounded-lg border border-hairline bg-surface-sunken/60 p-2.5 text-xs space-y-1.5 animate-fade-in"
            >
              <div className="flex items-center justify-between text-[11px] font-semibold text-ink">
                <span>会话多开任务详情 ({role.active_sessions.length})：</span>
                <span className="text-[10px] text-ink-mute">按优先级合并</span>
              </div>
              {role.active_sessions.map((sess) => (
                <div
                  key={sess.sessionId}
                  className="flex items-center justify-between gap-2 rounded bg-surface px-2 py-1 text-[11px] ring-1 ring-hairline"
                >
                  <span className="truncate text-ink font-mono">• {sess.task || sess.sessionId}</span>
                  <Badge
                    variant={sess.type === 'error' ? 'danger' : sess.type === 'working' ? 'info' : 'default'}
                    className="text-[9px] shrink-0"
                  >
                    {sess.type}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {/* Pet Display Area with Speech Bubble */}
          <div className="flex flex-col items-center justify-center py-4">
            {/* Speech Bubble */}
            <div className="relative mb-3 flex w-full justify-center px-2">
              <div className="relative max-w-[95%] rounded-2xl bg-surface-sunken px-3.5 py-2 text-center text-xs font-medium text-ink shadow-sm ring-1 ring-hairline">
                <span className="break-words" data-testid={`bubble-text-${roleKey}`}>{bubbleText}</span>
                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-0 w-0 border-x-4 border-x-transparent border-t-[6px] border-t-surface-sunken" />
              </div>
            </div>

            {/* Visual Display: either Pet Visual or Empty Slot Placeholder */}
            {pack && shownAsset && !isOffline && pack.installed ? (
              <>
                <PetVisualDisplay
                  pack={pack}
                  asset={shownAsset}
                  eventType={eventType}
                  roleKey={roleKey}
                  isHero={isHero}
                />
                {unmatched && (
                  <p data-testid={`pet-unmatched-${roleKey}`} className="mt-1 text-center text-[11px] font-medium text-amber-600">
                    这个形象包没有「{STATE_LABELS[eventType]}」对应动作，画面保持不变
                  </p>
                )}
              </>
            ) : (
              <div
                data-testid={`pet-slot-pending-${roleKey}`}
                className={cn(
                  'relative flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-hairline bg-surface-sunken/30 p-4 text-center transition-colors',
                  isHero ? 'h-52' : 'h-36'
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface shadow-xs ring-1 ring-hairline text-ink-mute mb-2">
                  <ImageOff size={18} />
                </div>
                <span className="text-xs font-semibold text-ink">
                  {isOffline ? '角色已离线' : pack && !pack.installed ? '形象包未在本地安装' : unmatched ? '这个形象包没有对应动作' : '形象待接入'}
                </span>
                <p className="mt-1 max-w-xs text-[11px] text-ink-mute leading-tight">
                  {isOffline
                    ? '角色服务当前未在线连接，等待恢复。'
                    : pack && !pack.installed
                    ? `已选定 ${pack.name}，属于来源仓库素材，请先下载安装到本机。`
                    : unmatched && pack
                    ? `${pack.name} 里没有「${STATE_LABELS[eventType]}」对应的动作，不拿别的动作顶替。`
                    : '当前角色暂未绑定本地形象包，可在下方下拉列表绑定已安装的形象包。'}
                </p>
              </div>
            )}

            {/* Current Activity Caption */}
            <div className="mt-3 w-full px-1 text-center">
              <p className="line-clamp-2 text-xs text-ink-soft">
                {role.current_task ? (
                  <span className="text-ink font-medium">任务：{role.current_task}</span>
                ) : pack && asset ? (
                  <span>动作状态：{asset.title} ({asset.badgeText})</span>
                ) : unmatched ? (
                  <span>状态说明：{badgeText}（这个形象包没有对应动作）</span>
                ) : (
                  <span>状态说明：{badgeText}</span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Card Footer: Role Pack Binding Selector */}
        <div className="border-t border-hairline pt-3 mt-2 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor={`pack-select-${roleKey}`} className="text-ink-mute font-medium text-[11px]">
              绑定形象包：
            </label>
            <select
              id={`pack-select-${roleKey}`}
              data-testid={`pack-select-${roleKey}`}
              value={pack?.id || ''}
              disabled={bindingsDisabled}
              onChange={(e) => onBindingChange(roleKey, e.target.value || null)}
              className="h-7 rounded border border-hairline bg-surface px-2 text-[11px] font-medium text-ink shadow-xs focus:border-accent focus:outline-none"
            >
              <option value="">[未绑定] 形象待接入</option>
              <optgroup label="本地已装形象包">
                {installedList.map((p) => (
                  <option key={p.id} value={p.id} disabled={!!p.error}>
                    {p.name} [{p.error ? '包异常' : '本地已装'}]
                  </option>
                ))}
              </optgroup>
              {uninstalledList.length > 0 && (
                <optgroup label="来源仓库包 (未安装)">
                  {uninstalledList.map((p) => (
                    <option key={p.id} value={p.id} disabled>
                      {p.name} [未安装 - 去作者仓库下载]
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <div className="flex items-center justify-between text-[11px] text-ink-mute">
            <span>接收事件：{eventType}</span>
            <span className="text-[10px] text-ink-soft font-mono">
              {pack ? `包标识：${pack.id} (${pack.format})` : '包标识：待接入 (null)'}
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function DshPetPluginView({ events, roles, petPacks = [], onPetPacksChanged, roleBindings = {}, onRoleBindingChange, bindingsDisabled }: PluginRenderProps) {
  const [displayMode, setDisplayMode] = useState<'single' | 'all'>('single');
  const availablePacks = useMemo(() => Object.fromEntries(petPacks.map(inst => [inst.id, {
    ...inst, installed: true, repo: '', description: `本机形象包，包含 ${inst.actionCount} 个动作。`,
    formatSpecs: inst.format === 'webm' ? '透明 WebM' : 'WebP 精灵图（规格读自形象包）',
    actionsList: inst.actions, assets: {},
  } as PetAssetPack])), [petPacks]);
  // 用户指定展台默认显示肥鱼；这里只选择角色，不生成任何形象包绑定。
  const defaultRole = roles.find(r => getRoleKey(r) === 'bridge:deep')
    || roles.find(r => r.name === 'deep')
    || roles.find(r => roleBindings[getRoleKey(r)]?.some(b => b.plugin_id === PET_ADAPTER_ID && b.enabled && b.avatar_pack)) || roles[0];
  const [selectedRoleKey, setSelectedRoleKey] = useState('');
  const currentRole = roles.find(r => getRoleKey(r) === selectedRoleKey) || defaultRole;
  const currentRoleKey = currentRole ? getRoleKey(currentRole) : '';
  const getPackForRole = (role: ExtendedRoleInfo): PetAssetPack | null => {
    const binding = roleBindings[getRoleKey(role)]?.find(b => b.plugin_id === PET_ADAPTER_ID);
    return binding?.enabled && binding.avatar_pack ? availablePacks[binding.avatar_pack] || null : null;
  };
  const handleBindingChange = (roleKey: string, newPackId: string | null) => {
    onRoleBindingChange?.(roleKey, PET_ADAPTER_ID, newPackId ? { enabled: true, avatar_pack: newPackId } : null);
  };
  const currentPack = currentRole ? getPackForRole(currentRole) : null;
  const installedPacks = Object.values(availablePacks);
  const uninstalledPacks = SOURCES;

  return (
    <div className="space-y-6" data-testid="dsh-pet-plugin-view">
      {/* 1. View Header with Mode Toggles */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-hairline pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-ink">桌宠角色展台与形象包适配</h3>
            <Badge variant="outline" className="text-xs">
              形象包适配模式
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-ink-soft">
            支持透明 WebM 与 hunmer/aboutme-pets 透明 WebP 精灵图规范；不内置素材，分清本地已装与来源仓库。
          </p>
        </div>

        {/* Display Mode Toggle Buttons */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-hairline bg-surface-sunken p-0.5">
            <button
              type="button"
              data-testid="mode-single-btn"
              onClick={() => setDisplayMode('single')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                displayMode === 'single'
                  ? 'bg-surface text-ink shadow-xs'
                  : 'text-ink-soft hover:text-ink'
              )}
            >
              <User size={13} />
              <span>只显示一只 (默认)</span>
            </button>
            <button
              type="button"
              data-testid="mode-all-btn"
              onClick={() => setDisplayMode('all')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                displayMode === 'all'
                  ? 'bg-surface text-ink shadow-xs'
                  : 'text-ink-soft hover:text-ink'
              )}
            >
              <Users size={13} />
              <span>全部角色 ({roles.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Role Selector when in 'single' mode */}
      {displayMode === 'single' && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-xl bg-surface-sunken/40 px-4 py-2.5 border border-hairline">
          <div className="flex items-center gap-2">
            <label htmlFor="pet-role-select" className="text-xs font-medium text-ink">
              切换展示角色：
            </label>
            <div className="relative">
              <select
                id="pet-role-select"
                data-testid="pet-role-select"
                value={currentRoleKey}
                onChange={(e) => setSelectedRoleKey(e.target.value)}
                className="h-8 rounded-md border border-hairline bg-surface pl-2.5 pr-8 text-xs font-medium text-ink shadow-xs focus:border-accent focus:outline-none"
              >
                {roles.map((r) => {
                  const k = getRoleKey(r);
                  const pack = getPackForRole(r);
                  return (
                    <option key={k} value={k}>
                      {r.display_name || r.name} ({k}) — {pack ? `[${pack.name}]` : '[形象待接入]'}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-mute">当前绑定形象包：</span>
            {currentPack ? (
              <Badge variant={currentPack.installed ? 'success' : 'warning'} className="text-[11px]">
                {currentPack.installed ? '已就绪：' : '未安装：'}{currentPack.name}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[11px] text-ink-soft">
                未绑定 (形象待接入)
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* 3. Cards View Area */}
      {displayMode === 'single' ? (
        currentRole ? (
          <div className="py-2">
            <RolePetCard
              role={currentRole}
              event={events[currentRoleKey]}
              pack={currentPack}
              isHero={true}
              availablePacks={availablePacks}
              onBindingChange={handleBindingChange}
              bindingsDisabled={bindingsDisabled}
            />
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-ink-mute">未找到可用角色</div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => {
            const k = getRoleKey(role);
            return (
              <RolePetCard
                key={k}
                role={role}
                event={events[k]}
                pack={getPackForRole(role)}
                isHero={false}
                availablePacks={availablePacks}
                onBindingChange={handleBindingChange}
                bindingsDisabled={bindingsDisabled}
              />
            );
          })}
        </div>
      )}

      {/* 4. Image Pack Adapters & Upstream Repositories Catalog Section */}
      <div className="mt-8 pt-6 border-t border-hairline space-y-4" data-testid="pet-packs-catalog-section">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-sm font-bold text-ink flex items-center gap-2">
              <Boxes size={16} className="text-accent" />
              <span>形象包适配管理与来源仓库</span>
            </h4>
            <p className="text-xs text-ink-mute">
              严格区分本地已安装包与外部来源仓库，未装包提供去作者仓库下载链接，不作镜像转发。
            </p>
          </div>
          <Badge variant="outline" className="text-[11px] self-start sm:self-auto">
            支持透明 WebM / WebP 精灵图两种规范
          </Badge>
        </div>

        {/* Group A: 本地已装形象包 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink">
            <CheckCircle2 size={14} className="text-emerald-500" />
            <span>本地已装形象包 ({installedPacks.length})</span>
            <span className="text-[11px] text-ink-mute font-normal">异常包需先修正，才能播放与绑定</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {installedPacks.map((pack) => (
              <div
                key={pack.id}
                data-testid={`installed-pack-${pack.id}`}
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 pb-2 border-b border-hairline">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-ink text-sm">{pack.name}</span>
                        <Badge variant={pack.error ? 'danger' : 'success'} className="text-[10px]">{pack.error ? '包异常' : '本地已装'}</Badge>
                        <Badge variant="outline" className="text-[10px] font-mono">{pack.format}</Badge>
                      </div>
                      <p className="text-xs text-ink-mute font-mono mt-0.5">安装路径：{pack.localPath}</p>
                    </div>
                    <span className="text-xs font-medium text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded">
                      {pack.actionCount} 动作
                    </span>
                  </div>

                  <p className="text-xs text-ink-soft mt-2">{pack.description}</p>

                  <div className="mt-3 space-y-1 text-xs text-ink-mute bg-surface/60 rounded-lg p-2.5 ring-1 ring-hairline">
                    <p><span className="font-medium text-ink">规格：</span>{pack.formatSpecs}</p>
                    <p><span className="font-medium text-ink">状态：</span><span className={pack.error ? 'text-red-600' : 'text-emerald-600'}>{pack.error || '本机已安装就绪'}</span></p>
                    {(() => {
                      const line = petDesktopLine(petPacks.find(p => p.id === pack.id) ?? (pack as never));
                      return line && (
                        <p data-testid={`pack-desktop-${pack.id}`}><span className="font-medium text-ink">桌面桌宠：</span>
                          <span className={line.tone === 'bad' ? 'text-red-600' : line.tone === 'busy' ? 'text-amber-600' : 'text-emerald-600'}>{line.text}</span></p>
                      );
                    })()}
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-hairline flex items-center justify-between text-xs">
                  <span className="text-[11px] text-ink-mute font-mono">ID: {pack.id}</span>
                  <span className="text-[11px] font-medium">{pack.error ? '需修正形象包' : '● 适配就绪'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <PetPackImport installed={petPacks} onChanged={onPetPacksChanged} disabled={bindingsDisabled} />

        {/* Group B: 来源仓库（未安装）形象包 */}
        <div className="space-y-3 pt-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink">
            <Download size={14} className="text-amber-500" />
            <span>来源仓库形象包 ({uninstalledPacks.length})</span>
            <span className="text-[11px] text-ink-mute font-normal">—— 未装入本机，仅展示来源，请前往原作者仓库下载</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {uninstalledPacks.map((pack) => (
              <div
                key={pack.id}
                data-testid={`remote-pack-${pack.id}`}
                className="rounded-xl border border-hairline bg-surface-sunken/40 p-3.5 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-1 pb-2 border-b border-hairline">
                    <div>
                      <span className="font-semibold text-ink text-xs">{pack.name}</span>
                      <div className="mt-1 flex items-center gap-1">
                        <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-500/30">
                          未安装 (仅来源仓库)
                        </Badge>
                      </div>
                    </div>

                  </div>

                  <p className="text-[11px] text-ink-soft mt-2">前往来源仓库选择形象包并安装到本机。</p>

                  <div className="mt-2.5 space-y-1 text-[11px] text-ink-mute bg-surface rounded p-2 ring-1 ring-hairline">
                    <p>仅提供来源链接，不代表本机已安装。</p>
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-hairline">
                  <a
                    href={pack.repo}
                    target="_blank"
                    rel="noreferrer"
                    data-testid={`download-link-${pack.id}`}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface-hover hover:text-accent transition-colors"
                  >
                    <Download size={12} />
                    <span>去作者仓库下载</span>
                    <ExternalLink size={10} className="text-ink-mute" />
                  </a>
                  <p className="mt-1 text-[10px] text-center text-ink-mute">
                    不从 bothouse 转发或镜像
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 5. Plugin Footer Specification */}
      <div className="mt-4 rounded-lg border border-hairline bg-surface-sunken/40 p-3.5 text-xs text-ink-soft flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 font-semibold text-ink">
          <Sparkles size={13} className="text-accent" />
          <span>形象包适配规范说明</span>
        </div>
        <p className="text-[11px] leading-relaxed">
          bothouse 仅提供前端形象包适配器（支持透明 WebM 与 hunmer/aboutme-pets 透明 WebP 精灵图规范）。所有素材均由用户本机自行安装或前往原作者仓库下载，仓库内不内置任何第三方素材文件；未安装的包请参阅来源仓库链接下载使用。
        </p>
      </div>
    </div>
  );
}

export const dshPetPlugin: BothousePlugin = {
  id: 'dsh-pet',
  name: '桌宠角色与形象包适配 (dsh-pet & aboutme-pets)',
  repo: 'https://github.com/hunmer/aboutme-pets',
  version: 'v0.3.0',
  description:
    'bothouse 形象包适配插件：支持透明 WebM 与 hunmer/aboutme-pets 透明 WebP 精灵图规范；不内置素材，分清本地已装与来源仓库；每角色一只桌宠，独立 roleKey 防串流，多开按优先级合并展示；支持自选形象包绑定与未绑定待接入展示。',
  subscriptions: ['idle', 'working', 'thinking', 'celebrate', 'error', 'speech'],
  enabled: true,
  status: 'active',
  render: (props) => <DshPetPluginView {...props} />,
};
