import React, { useState } from 'react';
import {
  User,
  Users,
  ImageOff,
} from 'lucide-react';
import { Badge, Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { BothousePlugin, PluginRenderProps, RoleEvent, RoleEventType } from '../pluginInterface';
import type { RoleInfo } from '@/api/roles';

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
  description: 'dsh-pet 自带大肥鱼表情动画，遵循 CC BY-NC-SA 4.0 署名协议；目前专属绑定于 肥鱼 (deep)。',
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
  deep: 'dsh-fat-fish',
  gjiang: null,
  gge: null,
  cjiang: null,
  mika: null,
};

export function getPetPackForRole(roleName: string): PetAssetPack | null {
  const packId = ROLE_PET_PACK_MAPPING[roleName];
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
  role: RoleInfo;
  event?: RoleEvent;
  pack: PetAssetPack | null;
  isHero?: boolean;
}) {
  const eventType: RoleEventType = event ? event.type : role.busy ? 'working' : 'idle';
  const asset = pack ? pack.assets[eventType] || pack.assets.idle : null;

  // Compute bubble text
  let bubbleText = event?.speechText;
  if (!bubbleText) {
    if (eventType === 'working') {
      bubbleText = role.current_task ? `正在干活：${role.current_task}` : '正在专注推进任务中… 噼里啪啦 ⚡';
    } else {
      const pool = RANDOM_SAYINGS[eventType] || RANDOM_SAYINGS.idle;
      const idx = (role.name.charCodeAt(0) + eventType.length) % pool.length;
      bubbleText = pool[idx];
    }
  }

  const badgeVariant = asset
    ? asset.badgeVariant
    : eventType === 'working'
    ? 'info'
    : eventType === 'celebrate'
    ? 'success'
    : eventType === 'error'
    ? 'danger'
    : 'default';

  const badgeText = asset
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
    <div key={role.name} data-testid={`pet-card-${role.name}`} className={isHero ? 'max-w-2xl mx-auto w-full' : ''}>
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
                <span className="text-xs text-ink-mute font-mono">({role.name})</span>
                {pack ? (
                  <Badge variant="success" className="text-[10px]">
                    {pack.name}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-ink-soft">
                    形象待接入
                  </Badge>
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

          {/* Pet Display Area with Speech Bubble */}
          <div className="flex flex-col items-center justify-center py-4">
            {/* Speech Bubble */}
            <div className="relative mb-3 flex w-full justify-center px-2">
              <div className="relative max-w-[95%] rounded-2xl bg-surface-sunken px-3.5 py-2 text-center text-xs font-medium text-ink shadow-sm ring-1 ring-hairline">
                <span className="break-words">{bubbleText}</span>
                {/* Bubble Triangle Tail */}
                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-0 w-0 border-x-4 border-x-transparent border-t-[6px] border-t-surface-sunken" />
              </div>
            </div>

            {/* Visual Display: either Pet GIF or Empty Placeholder */}
            {pack && asset ? (
              <div
                className={cn(
                  'relative flex w-full items-center justify-center overflow-hidden rounded-xl bg-surface-sunken/40 p-2',
                  isHero ? 'h-52' : 'h-36'
                )}
              >
                <img
                  src={asset.url}
                  alt={asset.title}
                  data-testid={`pet-img-${role.name}`}
                  className="max-h-full max-w-full object-contain drop-shadow transition-transform duration-300 hover:scale-105"
                  loading="lazy"
                />
              </div>
            ) : (
              <div
                data-testid={`pet-slot-pending-${role.name}`}
                className={cn(
                  'relative flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-hairline bg-surface-sunken/30 p-4 text-center transition-colors',
                  isHero ? 'h-52' : 'h-36'
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface shadow-xs ring-1 ring-hairline text-ink-mute mb-2">
                  <ImageOff size={18} />
                </div>
                <span className="text-xs font-semibold text-ink">形象待接入</span>
                <p className="mt-1 max-w-xs text-[11px] text-ink-mute leading-tight">
                  当前角色暂无专属形象包，大肥鱼形象仅归属肥鱼(deep)。后续可按同一接口挂入专属新素材。
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
          <span className="text-[10px] text-ink-soft">
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
  const [selectedRoleName, setSelectedRoleName] = useState<string>(
    defaultRole ? defaultRole.name : 'deep'
  );

  // If selected role is not found in roles, fallback to defaultRole
  const currentRole = roles.find((r) => r.name === selectedRoleName) || defaultRole || roles[0];
  const currentPack = currentRole ? getPetPackForRole(currentRole.name) : null;

  return (
    <div className="space-y-4" data-testid="dsh-pet-plugin-view">
      {/* View Header with Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-hairline pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-ink">桌宠角色展台</h3>
            <span className="text-xs text-ink-mute">
              （一个角色一只桌宠；大肥鱼形象专属肥鱼，其他角色待接入新形象）
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
                value={currentRole?.name || ''}
                onChange={(e) => setSelectedRoleName(e.target.value)}
                className="h-8 rounded-md border border-hairline bg-surface pl-2.5 pr-8 text-xs font-medium text-ink shadow-xs focus:border-accent focus:outline-none"
              >
                {roles.map((r) => {
                  const pack = getPetPackForRole(r.name);
                  return (
                    <option key={r.name} value={r.name}>
                      {r.display_name || r.name} ({r.name}) — {pack ? `[${pack.name}]` : '[形象待接入]'}
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
              event={events[currentRole.name]}
              pack={currentPack}
              isHero={true}
            />
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-ink-mute">未找到可用角色</div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => (
            <RolePetCard
              key={role.name}
              role={role}
              event={events[role.name]}
              pack={getPetPackForRole(role.name)}
              isHero={false}
            />
          ))}
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
  version: 'v0.2.2',
  description:
    'bothouse 内置桌宠组件：一个角色一只桌宠，支持形象包独立映射。目前肥鱼(deep)接入大肥鱼形象包，其他角色显示「形象待接入」；专区支持单只与全部切换。',
  subscriptions: ['idle', 'working', 'thinking', 'celebrate', 'error', 'speech'],
  enabled: true,
  status: 'active',
  render: (props) => <DshPetPluginView {...props} />,
};
