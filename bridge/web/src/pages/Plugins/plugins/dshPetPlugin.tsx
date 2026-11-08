import React, { useState } from 'react';
import {
  User,
  Users,
  ImageOff,
  Activity,
  ChevronDown,
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

// Runtime assets from PC2005-cloud/dsh-pet (GitHub / jsDelivr)
// Notice: Assets are NEVER committed into bothouse repository.
const DSH_PET_CDN_BASE =
  'https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@master/dsh-pet/assets/preview';

export interface PetAsset {
  key: RoleEventType;
  title: string;
  filename: string;
  url: string;
  badgeText: string;
  badgeVariant: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

export interface PetAssetPack {
  id: string;
  name: string;
  author: string;
  repo: string;
  license: string;
  description: string;
  assets: Record<RoleEventType, PetAsset>;
}

export const PET_ASSETS: Record<RoleEventType, PetAsset> = {
  idle: {
    key: 'idle',
    title: '待机呼吸',
    filename: 'daiji-huxi-xiuxian.gif',
    url: `${DSH_PET_CDN_BASE}/daiji-huxi-xiuxian.gif`,
    badgeText: '待机中',
    badgeVariant: 'default',
  },
  thinking: {
    key: 'thinking',
    title: '思考冒泡',
    filename: 'gongzuozhuangtai-sikao-maopao.gif',
    url: `${DSH_PET_CDN_BASE}/gongzuozhuangtai-sikao-maopao.gif`,
    badgeText: '思考中',
    badgeVariant: 'info',
  },
  working: {
    key: 'working',
    title: '忙碌点按',
    filename: 'gongzuozhuangtai-manglu-dianan.gif',
    url: `${DSH_PET_CDN_BASE}/gongzuozhuangtai-manglu-dianan.gif`,
    badgeText: '干活中',
    badgeVariant: 'info',
  },
  celebrate: {
    key: 'celebrate',
    title: '雀跃庆祝',
    filename: 'gongzuozhuangtai-queyue-qingzhu.gif',
    url: `${DSH_PET_CDN_BASE}/gongzuozhuangtai-queyue-qingzhu.gif`,
    badgeText: '交活庆祝',
    badgeVariant: 'success',
  },
  error: {
    key: 'error',
    title: '垂头冒汗',
    filename: 'gongzuozhuangtai-chuitou-tanqi-maohan.gif',
    url: `${DSH_PET_CDN_BASE}/gongzuozhuangtai-chuitou-tanqi-maohan.gif`,
    badgeText: '出错/冷却',
    badgeVariant: 'danger',
  },
  speech: {
    key: 'speech',
    title: '发言互动',
    filename: 'gongzuozhuangtai-sikao-maopao.gif',
    url: `${DSH_PET_CDN_BASE}/gongzuozhuangtai-sikao-maopao.gif`,
    badgeText: '说话中',
    badgeVariant: 'info',
  },
};

export const DSH_FAT_FISH_PACK: PetAssetPack = {
  id: 'dsh-fat-fish',
  name: '大肥鱼形象包',
  author: 'PC2005-cloud',
  repo: 'https://github.com/PC2005-cloud/dsh-pet',
  license: 'CC BY-NC-SA 4.0',
  description: 'dsh-pet 自带大肥鱼表情动画，遵循 CC BY-NC-SA 4.0 署名协议；专属绑定于 肥鱼 (deep)。',
  assets: PET_ASSETS,
};

export const AVAILABLE_PET_PACKS: Record<string, PetAssetPack> = {
  'dsh-fat-fish': DSH_FAT_FISH_PACK,
};

/**
 * 角色 → 形象包映射（packId，可空）：
 * 规则：桌宠一个角色一只；目前大肥鱼形象只属于肥鱼(deep)，其他角色不能显示大肥鱼；
 * 没形象的显示「形象待接入」空位。
 */
export const ROLE_PET_PACK_MAPPING: Record<string, string | null> = {
  'bridge:deep': 'dsh-fat-fish',
  'dsh:deep': 'dsh-fat-fish',
  deep: 'dsh-fat-fish',
  'bridge:gjiang': null,
  'bridge:gge': null,
  'bridge:cjiang': null,
  'bridge:mika': null,
};

export function getPetPackForRole(role: ExtendedRoleInfo | string): PetAssetPack | null {
  const key = typeof role === 'string' ? getRoleKey(role) : getRoleKey(role);
  const name = typeof role === 'string' ? role.split(':').pop()! : role.name;
  const packId = ROLE_PET_PACK_MAPPING[key] ?? ROLE_PET_PACK_MAPPING[name];
  if (!packId) return null;
  return AVAILABLE_PET_PACKS[packId] || null;
}

const RANDOM_SAYINGS: Record<RoleEventType, string[]> = {
  idle: [
    '呼呼… 随时待命，有活喊我！',
    '稍微歇口气，喝口温水 🍵',
    '状态良好，准备好大显身手啦~',
    '今天也是元气满满的桌宠~',
  ],
  working: [
    '正在飞速敲键盘中… 噼里啪啦！',
    '专心干活，代码马上就好！',
    '全力推进中，细节严谨核验！',
    '任务进行中，勿扰正在冲刺 ⚡',
  ],
  thinking: [
    '让我仔细推演一下最佳方案… 💭',
    '梳理模块接口中，马上有思路！',
    '深度思考中，逻辑推演中…',
  ],
  celebrate: [
    '活交完啦！请老师验收~ 🎉',
    '顺利搞定！又是充满成就感的一天 ✨',
    '测试全部通过，交卷啦！',
  ],
  error: [
    '哎呀… 遇到点卡点，正在擦汗排查 💦',
    '额度好像冷却了，休息片刻马上爬起来！',
    '呜呜，这行代码怎么报错了，正在急救！',
  ],
  speech: [
    '收到一条新消息，正在响应~ 💬',
    '伙伴们加油，协同前进！',
  ],
};

function RolePetCard({
  role,
  event,
  pack,
  isHero = false,
}: {
  role: ExtendedRoleInfo;
  event?: RoleEvent;
  pack: PetAssetPack | null;
  isHero?: boolean;
}) {
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const roleKey = getRoleKey(role);

  // Determine active state: explicit event (e.g. from simulator or event bus) takes precedence;
  // otherwise aggregate active_sessions by priority: 出错 (error) > 干活/思考 (working/thinking) > 庆祝 (celebrate) > 空闲 (idle)
  let eventType: RoleEventType;
  if (event) {
    eventType = event.type;
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

  const asset = pack ? pack.assets[eventType] || pack.assets.idle : null;

  // Multi-session busy count
  const busyCount = getBusySessionCount(role.active_sessions, role.busy, role.sessions_count);

  // Deduplicated speech bubble: prioritize recent speech across sessions, then event, then sayings
  let bubbleText = getDeduplicatedSpeech(role.active_sessions, event);
  if (!bubbleText) {
    if (isOffline) {
      bubbleText = '已离线，等待连接恢复… 🔌';
    } else if (isPaused) {
      bubbleText = '已暂停，待命休息中 ⏸️';
    } else if (eventType === 'working') {
      bubbleText = role.current_task ? `正在干活：${role.current_task}` : '正在专注推进任务中… 噼里啪啦 ⚡';
    } else {
      const pool = RANDOM_SAYINGS[eventType] || RANDOM_SAYINGS.idle;
      const idx = (role.name.charCodeAt(0) + eventType.length) % pool.length;
      bubbleText = pool[idx];
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
                  <Badge variant="success" className="text-[10px]">
                    {pack.name}
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
                {/* Bubble Triangle Tail */}
                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-0 w-0 border-x-4 border-x-transparent border-t-[6px] border-t-surface-sunken" />
              </div>
            </div>

            {/* Visual Display: either Pet GIF or Empty Placeholder */}
            {pack && asset && !isOffline ? (
              <div
                className={cn(
                  'relative flex w-full items-center justify-center overflow-hidden rounded-xl bg-surface-sunken/40 p-2',
                  isHero ? 'h-52' : 'h-36'
                )}
              >
                <img
                  src={asset.url}
                  alt={asset.title}
                  data-testid={`pet-img-${roleKey}`}
                  className="max-h-full max-w-full object-contain drop-shadow transition-transform duration-300 hover:scale-105"
                  loading="lazy"
                />
              </div>
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
                  {isOffline ? '角色已离线' : '形象待接入'}
                </span>
                <p className="mt-1 max-w-xs text-[11px] text-ink-mute leading-tight">
                  {isOffline
                    ? '角色服务当前未在线连接，等待恢复。'
                    : '当前角色暂无专属形象包，大肥鱼形象专属归属肥鱼(deep)。后续可按同一接口挂入专属新素材。'}
                </p>
              </div>
            )}

            {/* Current Activity Caption */}
            <div className="mt-3 w-full px-1 text-center">
              <p className="line-clamp-2 text-xs text-ink-soft">
                {role.current_task ? (
                  <span className="text-ink font-medium">任务：{role.current_task}</span>
                ) : pack && asset ? (
                  <span>动画状态：{asset.title}</span>
                ) : (
                  <span>状态说明：{badgeText}</span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Subscribed Event Status */}
        <div className="border-t border-hairline pt-2 text-[11px] text-ink-mute flex items-center justify-between">
          <span>接收事件：{eventType}</span>
          <span className="text-[10px] text-ink-soft font-mono">
            {pack ? `形象包：${pack.id}` : '形象包：待接入 (null)'}
          </span>
        </div>
      </Card>
    </div>
  );
}

function DshPetPluginView({ events, roles }: PluginRenderProps) {
  const [displayMode, setDisplayMode] = useState<'single' | 'all'>('single');

  // Find initial selected role: default to role with pack (deep), or first role
  const defaultRole = roles.find((r) => r.name === 'deep' || r.name === '肥鱼') || roles[0];
  const [selectedRoleKey, setSelectedRoleKey] = useState<string>(
    defaultRole ? getRoleKey(defaultRole) : 'bridge:deep'
  );

  // If selected role is not found in roles, fallback to defaultRole
  const currentRole = roles.find((r) => getRoleKey(r) === selectedRoleKey) || defaultRole || roles[0];
  const currentRoleKey = currentRole ? getRoleKey(currentRole) : 'bridge:deep';
  const currentPack = currentRole ? getPetPackForRole(currentRole) : null;

  return (
    <div className="space-y-4" data-testid="dsh-pet-plugin-view">
      {/* View Header with Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-hairline pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-ink">桌宠角色展台</h3>
            <span className="text-xs text-ink-mute">
              （独立 roleKey 防串，多开按优先级合并；大肥鱼专属肥鱼）
            </span>
          </div>
          <p className="mt-0.5 text-xs text-ink-soft">
            支持统一角色事件响应与独立形象包映射
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

      {/* Role Selector when in 'single' mode */}
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
                  const pack = getPetPackForRole(r);
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
            <span className="text-ink-mute">当前形象包绑定：</span>
            {currentPack ? (
              <Badge variant="success" className="text-[11px]">
                已绑定：{currentPack.name} (CC BY-NC-SA 4.0)
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[11px] text-ink-soft">
                未绑定 (形象待接入)
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Cards View Area */}
      {displayMode === 'single' ? (
        currentRole ? (
          <div className="py-2">
            <RolePetCard
              role={currentRole}
              event={events[currentRoleKey]}
              pack={currentPack}
              isHero={true}
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
                pack={getPetPackForRole(role)}
                isHero={false}
              />
            );
          })}
        </div>
      )}

      {/* Plugin Footer Attribution & Specification */}
      <div className="mt-4 rounded-lg border border-hairline bg-surface-sunken/40 p-3 text-xs text-ink-soft flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p>
          形象出处：
          <a
            href="https://github.com/PC2005-cloud/dsh-pet"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline ml-1 hover:opacity-80"
          >
            PC2005-cloud/dsh-pet (GitHub)
          </a>
          ，遵循 <span className="font-semibold text-ink">CC BY-NC-SA 4.0</span> 协议。大肥鱼形象专属绑定于肥鱼(deep)。
        </p>
        <span className="text-ink-mute">
          素材通过 jsDelivr CDN 运行时按需加载，不进仓库。
        </span>
      </div>
    </div>
  );
}

export const dshPetPlugin: BothousePlugin = {
  id: 'dsh-pet',
  name: '桌宠大肥鱼 (dsh-pet)',
  author: 'PC2005-cloud',
  repo: 'https://github.com/PC2005-cloud/dsh-pet',
  license: 'CC BY-NC-SA 4.0',
  version: 'v0.2.3',
  description:
    'bothouse 内置桌宠组件：一个角色一只桌宠，带唯一 roleKey 防状态串流，同一角色多开按优先级合并并展示 N 处在忙；目前肥鱼(deep)接入大肥鱼形象包，其他角色显示「形象待接入」；专区支持单只与全部切换。',
  subscriptions: ['idle', 'working', 'thinking', 'celebrate', 'error', 'speech'],
  enabled: true,
  status: 'active',
  render: (props) => <DshPetPluginView {...props} />,
};
