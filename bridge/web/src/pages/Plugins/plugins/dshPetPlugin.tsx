import React from 'react';
import { Badge, Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { BothousePlugin, RoleEventType } from '../pluginInterface';

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

export const dshPetPlugin: BothousePlugin = {
  id: 'dsh-pet',
  name: '桌宠大肥鱼 (dsh-pet)',
  author: 'PC2005-cloud',
  repo: 'https://github.com/PC2005-cloud/dsh-pet',
  license: 'CC BY-NC-SA 4.0',
  version: 'v0.2.1',
  description: 'bothouse 内置桌宠组件：通过统一插件接口订阅角色事件，根据运行状态切待机/干活/思考/庆祝/出错动画与互动气泡。',
  subscriptions: ['idle', 'working', 'thinking', 'celebrate', 'error', 'speech'],
  enabled: true,
  status: 'active',
  render: ({ events, roles, isSimulated }) => {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-ink">桌宠大肥鱼角色展台</h3>
            <span className="text-xs text-ink-mute">
              （接收接口页推送的统一角色事件，驱动大肥鱼动画响应）
            </span>
          </div>
          <Badge variant="success" className="text-xs">
            插件接口：已连接事件总线
          </Badge>
        </div>

        {/* Roles Pet Cards Grid */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {roles.map((role) => {
            const ev = events[role.name];
            const eventType: RoleEventType = ev ? ev.type : (role.busy ? 'working' : 'idle');
            const asset = PET_ASSETS[eventType] || PET_ASSETS.idle;

            // Compute bubble text
            let bubbleText = ev?.speechText;
            if (!bubbleText) {
              if (eventType === 'working') {
                bubbleText = role.current_task ? `正在干活：${role.current_task}` : '正在专注推进任务中… 噼里啪啦 ⚡';
              } else {
                const pool = RANDOM_SAYINGS[eventType] || RANDOM_SAYINGS.idle;
                const idx = (role.name.charCodeAt(0) + eventType.length) % pool.length;
                bubbleText = pool[idx];
              }
            }

            return (
              <Card
                key={role.name}
                className={cn(
                  'flex flex-col justify-between overflow-hidden border transition-all duration-200',
                  eventType === 'working' && 'border-accent/40 bg-accent-wash/5',
                  eventType === 'celebrate' && 'border-emerald-500/40 bg-emerald-500/5',
                  eventType === 'error' && 'border-red-500/30 bg-red-500/5'
                )}
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2 border-b border-hairline pb-3">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-ink">{role.display_name || role.name}</span>
                        <span className="text-xs text-ink-mute font-mono">({role.name})</span>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-soft font-mono">
                        {role.model || 'model'}
                      </p>
                    </div>
                    <Badge variant={asset.badgeVariant} className="shrink-0 text-[11px]">
                      {asset.badgeText}
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

                    {/* Big Fat Fish Pet Gif Container */}
                    <div className="relative flex h-36 w-full items-center justify-center overflow-hidden rounded-xl bg-surface-sunken/40 p-2">
                      <img
                        src={asset.url}
                        alt={asset.title}
                        className="max-h-full max-w-full object-contain drop-shadow transition-transform duration-300 hover:scale-105"
                        loading="lazy"
                      />
                    </div>

                    {/* Current Activity Caption */}
                    <div className="mt-3 w-full px-1 text-center">
                      <p className="line-clamp-2 text-xs text-ink-soft">
                        {role.current_task ? (
                          <span className="text-ink font-medium">任务：{role.current_task}</span>
                        ) : (
                          <span>动画状态：{asset.title}</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Subscribed Event Status */}
                <div className="border-t border-hairline pt-2 text-[11px] text-ink-mute flex items-center justify-between">
                  <span>接收事件：{eventType}</span>
                  <span className="text-[10px] text-ink-soft">
                    {ev?.timestamp ? ev.timestamp.slice(11, 19) : '实时'}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Plugin Footer Attribution */}
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
            ，遵循 <span className="font-semibold text-ink">CC BY-NC-SA 4.0</span> 协议。
          </p>
          <span className="text-ink-mute">
            素材通过 jsDelivr CDN 运行时加载，不进仓库。
          </span>
        </div>
      </div>
    );
  },
};
