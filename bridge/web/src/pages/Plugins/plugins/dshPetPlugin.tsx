import React, { useState } from 'react';
import {
  User,
  Users,
  ImageOff,
  Activity,
  ChevronDown,
  Download,
  ExternalLink,
  CheckCircle2,
  FolderArchive,
  Layers,
  Sparkles,
  Film,
  Boxes,
} from 'lucide-react';
import { Badge, Card, Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { BothousePlugin, ExtendedRoleInfo, PluginRenderProps, RoleEvent, RoleEventType } from '../pluginInterface';
import {
  aggregateRoleStatus,
  getBusySessionCount,
  getDeduplicatedSpeech,
  getRoleKey,
} from '../roleAggregation';

export type PetPackFormat = 'spritesheet' | 'webm';

export interface PetAsset {
  key: RoleEventType;
  title: string;
  actionName: string;
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
  format: PetPackFormat;
  installed: boolean;
  localPath?: string;
  formatSpecs: string;
  actionCount: number;
  recommendedRole?: string;
  avatarUrl: string;
  assets: Record<RoleEventType, PetAsset>;
}

const CDN_BASE_ABOUTME = 'https://cdn.jsdelivr.net/gh/hunmer/aboutme-pets@main/pets';
const CDN_BASE_DSH_OFFICIAL = 'https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@master/dsh-pet/assets/preview';

// 1. 本地已装包：肥鱼 (dsh1 新动作包，166动作，WebP精灵图规范 640×360 12fps 8列)
export const DSH1_PACK: PetAssetPack = {
  id: 'dsh1',
  name: '肥鱼 (dsh1 新动作包)',
  author: 'PC2005-cloud (原作者) / hunmer (转换整理)',
  repo: 'https://github.com/hunmer/aboutme-pets',
  license: '素材禁止商用；二创在公开渠道须署名上游仓库 (见 NOTICE.txt)',
  description: '166 个透明 WebP 精灵图动作，含工作加班、换装侦探服思考、站着打瞌睡等；蓝发女仆装鲸鱼尾巴。',
  format: 'spritesheet',
  formatSpecs: '640×360, 12fps, 8列 透明 WebP 精灵图',
  actionCount: 166,
  installed: true,
  localPath: '~/.bothouse/pets/dsh1',
  recommendedRole: 'deep',
  avatarUrl: `${CDN_BASE_ABOUTME}/dsh1/avatar.webp`,
  assets: {
    idle: {
      key: 'idle',
      title: '站着晃神打瞌睡',
      actionName: '站着晃神打瞌睡',
      filename: 'spritesheet/站着晃神打瞌睡.webp',
      url: `${CDN_BASE_ABOUTME}/dsh1/spritesheet/站着晃神打瞌睡.webp`,
      badgeText: '待机中',
      badgeVariant: 'default',
    },
    working: {
      key: 'working',
      title: '工作加班',
      actionName: '工作加班',
      filename: 'spritesheet/工作加班.webp',
      url: `${CDN_BASE_ABOUTME}/dsh1/spritesheet/工作加班.webp`,
      badgeText: '干活中',
      badgeVariant: 'info',
    },
    thinking: {
      key: 'thinking',
      title: '换装侦探服思考',
      actionName: '换装侦探服思考',
      filename: 'spritesheet/换装侦探服思考.webp',
      url: `${CDN_BASE_ABOUTME}/dsh1/spritesheet/换装侦探服思考.webp`,
      badgeText: '思考中',
      badgeVariant: 'info',
    },
    celebrate: {
      key: 'celebrate',
      title: '举杯敬酒',
      actionName: '举杯敬酒',
      filename: 'spritesheet/举杯敬酒.webp',
      url: `${CDN_BASE_ABOUTME}/dsh1/spritesheet/举杯敬酒.webp`,
      badgeText: '交活庆祝',
      badgeVariant: 'success',
    },
    error: {
      key: 'error',
      title: '沙发打瞌睡',
      actionName: '沙发打瞌睡',
      filename: 'spritesheet/沙发打瞌睡.webp',
      url: `${CDN_BASE_ABOUTME}/dsh1/spritesheet/沙发打瞌睡.webp`,
      badgeText: '出错/冷却',
      badgeVariant: 'danger',
    },
    speech: {
      key: 'speech',
      title: '换装侦探服思考',
      actionName: '换装侦探服思考',
      filename: 'spritesheet/换装侦探服思考.webp',
      url: `${CDN_BASE_ABOUTME}/dsh1/spritesheet/换装侦探服思考.webp`,
      badgeText: '说话中',
      badgeVariant: 'info',
    },
  },
};

// 2. 本地已装包：Claude娘 (claude 动作包，166动作，WebP精灵图规范 640×360 12fps 8列)
export const CLAUDE_PACK: PetAssetPack = {
  id: 'claude',
  name: 'Claude娘 (claude 动作包)',
  author: 'hunmer/aboutme-pets',
  repo: 'https://github.com/hunmer/aboutme-pets',
  license: '未注明许可，请看来源仓库',
  description: '166 个透明 WebP 精灵图动作，橘棕长发向日葵发饰，怀抱厚书，干活时头顶齿轮与扳手。',
  format: 'spritesheet',
  formatSpecs: '640×360, 12fps, 8列 透明 WebP 精灵图',
  actionCount: 166,
  installed: true,
  localPath: '~/.bothouse/pets/claude',
  recommendedRole: 'cjiang',
  avatarUrl: `${CDN_BASE_ABOUTME}/claude/avatar.webp`,
  assets: {
    idle: {
      key: 'idle',
      title: '待机呼吸休闲',
      actionName: '待机呼吸休闲',
      filename: 'spritesheet/待机呼吸休闲.webp',
      url: `${CDN_BASE_ABOUTME}/claude/spritesheet/待机呼吸休闲.webp`,
      badgeText: '待机中',
      badgeVariant: 'default',
    },
    working: {
      key: 'working',
      title: '工作状态-忙碌点按',
      actionName: '工作状态-忙碌点按',
      filename: 'spritesheet/工作状态-忙碌点按.webp',
      url: `${CDN_BASE_ABOUTME}/claude/spritesheet/工作状态-忙碌点按.webp`,
      badgeText: '干活中',
      badgeVariant: 'info',
    },
    thinking: {
      key: 'thinking',
      title: '工作状态-思考冒泡',
      actionName: '工作状态-思考冒泡',
      filename: 'spritesheet/工作状态-思考冒泡.webp',
      url: `${CDN_BASE_ABOUTME}/claude/spritesheet/工作状态-思考冒泡.webp`,
      badgeText: '思考中',
      badgeVariant: 'info',
    },
    celebrate: {
      key: 'celebrate',
      title: '工作状态-雀跃庆祝',
      actionName: '工作状态-雀跃庆祝',
      filename: 'spritesheet/工作状态-雀跃庆祝.webp',
      url: `${CDN_BASE_ABOUTME}/claude/spritesheet/工作状态-雀跃庆祝.webp`,
      badgeText: '交活庆祝',
      badgeVariant: 'success',
    },
    error: {
      key: 'error',
      title: '工作状态-垂头叹气冒汗',
      actionName: '工作状态-垂头叹气冒汗',
      filename: 'spritesheet/工作状态-垂头叹气冒汗.webp',
      url: `${CDN_BASE_ABOUTME}/claude/spritesheet/工作状态-垂头叹气冒汗.webp`,
      badgeText: '出错/冷却',
      badgeVariant: 'danger',
    },
    speech: {
      key: 'speech',
      title: '工作状态-思考冒泡',
      actionName: '工作状态-思考冒泡',
      filename: 'spritesheet/工作状态-思考冒泡.webp',
      url: `${CDN_BASE_ABOUTME}/claude/spritesheet/工作状态-思考冒泡.webp`,
      badgeText: '说话中',
      badgeVariant: 'info',
    },
  },
};

// 3. 来源仓库包：GPT娘 (gpt1，未安装)
export const GPT1_PACK: PetAssetPack = {
  id: 'gpt1',
  name: 'GPT娘 (gpt1 动作包)',
  author: 'hunmer/aboutme-pets',
  repo: 'https://github.com/hunmer/aboutme-pets',
  license: '未注明许可，请看来源仓库',
  description: '2026-11 GPT 生成第二批次，92 个透明动作；白发紫眼龙角娘，抱笔记本电脑写代码。',
  format: 'spritesheet',
  formatSpecs: '640×360, 12fps, 8列 透明 WebP 精灵图',
  actionCount: 92,
  installed: false,
  recommendedRole: 'gge',
  avatarUrl: `${CDN_BASE_ABOUTME}/gpt1/avatar.webp`,
  assets: {
    idle: {
      key: 'idle',
      title: '待机呼吸',
      actionName: '待机呼吸',
      filename: 'spritesheet/待机呼吸.webp',
      url: `${CDN_BASE_ABOUTME}/gpt1/avatar.webp`,
      badgeText: '待机中',
      badgeVariant: 'default',
    },
    working: {
      key: 'working',
      title: '工作状态-写代码',
      actionName: '工作状态-写代码',
      filename: 'spritesheet/工作状态-写代码.webp',
      url: `${CDN_BASE_ABOUTME}/gpt1/avatar.webp`,
      badgeText: '干活中',
      badgeVariant: 'info',
    },
    thinking: {
      key: 'thinking',
      title: '工作状态-思考',
      actionName: '工作状态-思考',
      filename: 'spritesheet/工作状态-思考.webp',
      url: `${CDN_BASE_ABOUTME}/gpt1/avatar.webp`,
      badgeText: '思考中',
      badgeVariant: 'info',
    },
    celebrate: {
      key: 'celebrate',
      title: '雀跃庆祝',
      actionName: '雀跃庆祝',
      filename: 'spritesheet/雀跃庆祝.webp',
      url: `${CDN_BASE_ABOUTME}/gpt1/avatar.webp`,
      badgeText: '交活庆祝',
      badgeVariant: 'success',
    },
    error: {
      key: 'error',
      title: '出错垂头',
      actionName: '出错垂头',
      filename: 'spritesheet/出错垂头.webp',
      url: `${CDN_BASE_ABOUTME}/gpt1/avatar.webp`,
      badgeText: '出错/冷却',
      badgeVariant: 'danger',
    },
    speech: {
      key: 'speech',
      title: '工作状态-思考',
      actionName: '工作状态-思考',
      filename: 'spritesheet/工作状态-思考.webp',
      url: `${CDN_BASE_ABOUTME}/gpt1/avatar.webp`,
      badgeText: '说话中',
      badgeVariant: 'info',
    },
  },
};

// 4. 来源仓库包：Gemini猫耳娘 (gemini，未安装)
export const GEMINI_PACK: PetAssetPack = {
  id: 'gemini',
  name: 'Gemini猫耳娘 (gemini 动作包)',
  author: 'hunmer/aboutme-pets',
  repo: 'https://github.com/hunmer/aboutme-pets',
  license: '未注明许可，请看来源仓库',
  description: '2026-11 Gemini 生成批次（猫耳娘版），100 个透明动作；紫粉渐变长发，异色瞳。',
  format: 'spritesheet',
  formatSpecs: '640×360, 12fps, 8列 透明 WebP 精灵图',
  actionCount: 100,
  installed: false,
  recommendedRole: 'gjiang',
  avatarUrl: `${CDN_BASE_ABOUTME}/gemini/avatar.webp`,
  assets: {
    idle: {
      key: 'idle',
      title: '待机呼吸',
      actionName: '待机呼吸',
      filename: 'spritesheet/待机呼吸.webp',
      url: `${CDN_BASE_ABOUTME}/gemini/avatar.webp`,
      badgeText: '待机中',
      badgeVariant: 'default',
    },
    working: {
      key: 'working',
      title: '专注工作',
      actionName: '专注工作',
      filename: 'spritesheet/专注工作.webp',
      url: `${CDN_BASE_ABOUTME}/gemini/avatar.webp`,
      badgeText: '干活中',
      badgeVariant: 'info',
    },
    thinking: {
      key: 'thinking',
      title: '猫耳思考',
      actionName: '猫耳思考',
      filename: 'spritesheet/猫耳思考.webp',
      url: `${CDN_BASE_ABOUTME}/gemini/avatar.webp`,
      badgeText: '思考中',
      badgeVariant: 'info',
    },
    celebrate: {
      key: 'celebrate',
      title: '开心庆祝',
      actionName: '开心庆祝',
      filename: 'spritesheet/开心庆祝.webp',
      url: `${CDN_BASE_ABOUTME}/gemini/avatar.webp`,
      badgeText: '交活庆祝',
      badgeVariant: 'success',
    },
    error: {
      key: 'error',
      title: '困惑冒汗',
      actionName: '困惑冒汗',
      filename: 'spritesheet/困惑冒汗.webp',
      url: `${CDN_BASE_ABOUTME}/gemini/avatar.webp`,
      badgeText: '出错/冷却',
      badgeVariant: 'danger',
    },
    speech: {
      key: 'speech',
      title: '猫耳思考',
      actionName: '猫耳思考',
      filename: 'spritesheet/猫耳思考.webp',
      url: `${CDN_BASE_ABOUTME}/gemini/avatar.webp`,
      badgeText: '说话中',
      badgeVariant: 'info',
    },
  },
};

// 5. 来源仓库包：官方 dsh-pet 原版透明 WebM (未安装)
export const DSH_OFFICIAL_WEBM_PACK: PetAssetPack = {
  id: 'dsh-official',
  name: '官方 dsh-pet (透明 WebM 包)',
  author: 'PC2005-cloud',
  repo: 'https://github.com/PC2005-cloud/dsh-pet',
  license: '代码 MIT，素材非商用（原作者溟月保留权利）',
  description: '官方 dsh-pet 原生透明 WebM 视频包（pet/ 目录），101 个动作，经典蓝发女仆装。',
  format: 'webm',
  formatSpecs: 'VP9 透明通道 WebM (pet/*.webm)',
  actionCount: 101,
  installed: false,
  recommendedRole: 'deep',
  avatarUrl: `${CDN_BASE_DSH_OFFICIAL}/daiji-huxi-xiuxian.gif`,
  assets: {
    idle: {
      key: 'idle',
      title: '待机呼吸休闲',
      actionName: 'daiji-huxi-xiuxian',
      filename: 'daiji-huxi-xiuxian.gif',
      url: `${CDN_BASE_DSH_OFFICIAL}/daiji-huxi-xiuxian.gif`,
      badgeText: '待机中',
      badgeVariant: 'default',
    },
    working: {
      key: 'working',
      title: '忙碌点按',
      actionName: 'gongzuozhuangtai-manglu-dianan',
      filename: 'gongzuozhuangtai-manglu-dianan.gif',
      url: `${CDN_BASE_DSH_OFFICIAL}/gongzuozhuangtai-manglu-dianan.gif`,
      badgeText: '干活中',
      badgeVariant: 'info',
    },
    thinking: {
      key: 'thinking',
      title: '思考冒泡',
      actionName: 'gongzuozhuangtai-sikao-maopao',
      filename: 'gongzuozhuangtai-sikao-maopao.gif',
      url: `${CDN_BASE_DSH_OFFICIAL}/gongzuozhuangtai-sikao-maopao.gif`,
      badgeText: '思考中',
      badgeVariant: 'info',
    },
    celebrate: {
      key: 'celebrate',
      title: '雀跃庆祝',
      actionName: 'gongzuozhuangtai-queyue-qingzhu',
      filename: 'gongzuozhuangtai-queyue-qingzhu.gif',
      url: `${CDN_BASE_DSH_OFFICIAL}/gongzuozhuangtai-queyue-qingzhu.gif`,
      badgeText: '交活庆祝',
      badgeVariant: 'success',
    },
    error: {
      key: 'error',
      title: '垂头冒汗',
      actionName: 'gongzuozhuangtai-chuitou-tanqi-maohan',
      filename: 'gongzuozhuangtai-chuitou-tanqi-maohan.gif',
      url: `${CDN_BASE_DSH_OFFICIAL}/gongzuozhuangtai-chuitou-tanqi-maohan.gif`,
      badgeText: '出错/冷却',
      badgeVariant: 'danger',
    },
    speech: {
      key: 'speech',
      title: '思考冒泡',
      actionName: 'gongzuozhuangtai-sikao-maopao',
      filename: 'gongzuozhuangtai-sikao-maopao.gif',
      url: `${CDN_BASE_DSH_OFFICIAL}/gongzuozhuangtai-sikao-maopao.gif`,
      badgeText: '说话中',
      badgeVariant: 'info',
    },
  },
};

// Available pet packs catalog
export const AVAILABLE_PET_PACKS: Record<string, PetAssetPack> = {
  dsh1: DSH1_PACK,
  claude: CLAUDE_PACK,
  gpt1: GPT1_PACK,
  gemini: GEMINI_PACK,
  'dsh-official': DSH_OFFICIAL_WEBM_PACK,
};

// Backward-compatibility aliases
export const PET_ASSETS = DSH1_PACK.assets;
export const DSH_FAT_FISH_PACK = DSH1_PACK;

/**
 * 角色 → 形象包映射（推荐初始配置，支持在页面上自由选择切换与解绑）：
 * - 肥鱼 (deep) 推荐绑定 dsh1 (本地已装)
 * - C酱 (cjiang) 推荐绑定 claude (本地已装)
 * - 其他角色默认为空 (形象待接入)
 */
export const DEFAULT_ROLE_PET_MAPPING: Record<string, string | null> = {
  'bridge:deep': 'dsh1',
  'dsh:deep': 'dsh1',
  deep: 'dsh1',
  'bridge:cjiang': 'claude',
  'dsh:cjiang': 'claude',
  cjiang: 'claude',
  'bridge:gjiang': null,
  'bridge:gge': null,
  'bridge:mika': null,
};

export function getPetPackById(packId: string | null | undefined): PetAssetPack | null {
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

function PetVisualDisplay({
  pack,
  asset,
  eventType,
  roleKey,
  isHero,
}: {
  pack: PetAssetPack;
  asset: PetAsset;
  eventType: RoleEventType;
  roleKey: string;
  isHero: boolean;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className={cn(
        'relative flex w-full flex-col items-center justify-center overflow-hidden rounded-xl bg-surface-sunken/40 p-2 border border-hairline/60',
        isHero ? 'h-52' : 'h-36'
      )}
    >
      {/* Format Indicator Tag */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded bg-surface/90 px-1.5 py-0.5 text-[9px] font-mono text-ink-mute shadow-xs backdrop-blur">
        {pack.format === 'spritesheet' ? <Layers size={10} className="text-accent" /> : <Film size={10} className="text-emerald-500" />}
        <span>{pack.format === 'spritesheet' ? 'WebP 精灵图适配' : 'WebM 视频适配'}</span>
      </div>

      {pack.format === 'webm' && asset.url?.endsWith('.webm') ? (
        <video
          key={asset.url}
          src={asset.url}
          autoPlay
          loop
          muted
          playsInline
          className="max-h-full max-w-full object-contain drop-shadow"
        />
      ) : (
        <img
          key={`${asset.actionName}-${eventType}`}
          src={imgError ? pack.avatarUrl : asset.url}
          alt={asset.title}
          data-testid={`pet-img-${roleKey}`}
          onError={() => setImgError(true)}
          className={cn(
            'max-h-full max-w-full object-contain drop-shadow transition-transform duration-300 hover:scale-105',
            eventType === 'working' && 'animate-pulse'
          )}
          loading="lazy"
        />
      )}

      {/* Action Title Sub-badge */}
      <div className="absolute bottom-1 right-2 z-10 rounded bg-surface/80 px-1.5 py-0.5 text-[10px] text-ink-mute shadow-xs backdrop-blur">
        动作：{asset.actionName}
      </div>
    </div>
  );
}

function RolePetCard({
  role,
  event,
  pack,
  isHero = false,
  onBindingChange,
}: {
  role: ExtendedRoleInfo;
  event?: RoleEvent;
  pack: PetAssetPack | null;
  isHero?: boolean;
  onBindingChange: (roleKey: string, newPackId: string | null) => void;
}) {
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const roleKey = getRoleKey(role);

  // Determine active state: explicit event (e.g. simulator) takes precedence;
  // otherwise aggregate active_sessions by priority: 出错 > 干活/思考 > 庆祝 > 空闲
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
            {pack && asset && !isOffline && pack.installed ? (
              <PetVisualDisplay
                pack={pack}
                asset={asset}
                eventType={eventType}
                roleKey={roleKey}
                isHero={isHero}
              />
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
                  {isOffline ? '角色已离线' : pack && !pack.installed ? '形象包未在本地安装' : '形象待接入'}
                </span>
                <p className="mt-1 max-w-xs text-[11px] text-ink-mute leading-tight">
                  {isOffline
                    ? '角色服务当前未在线连接，等待恢复。'
                    : pack && !pack.installed
                    ? `已选定 ${pack.name}，属于来源仓库素材，请先下载安装到本机。`
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
              onChange={(e) => onBindingChange(roleKey, e.target.value || null)}
              className="h-7 rounded border border-hairline bg-surface px-2 text-[11px] font-medium text-ink shadow-xs focus:border-accent focus:outline-none"
            >
              <option value="">[未绑定] 形象待接入</option>
              <optgroup label="本地已装形象包">
                <option value="dsh1">肥鱼 (dsh1 新动作包) [本地已装]</option>
                <option value="claude">Claude娘 (claude 动作包) [本地已装]</option>
              </optgroup>
              <optgroup label="来源仓库包 (未安装)">
                <option value="gpt1" disabled>GPT娘 (gpt1) [未安装 - 去作者仓库下载]</option>
                <option value="gemini" disabled>Gemini猫耳娘 (gemini) [未安装 - 去作者仓库下载]</option>
                <option value="dsh-official" disabled>官方 dsh-pet (WebM) [未安装 - 去作者仓库下载]</option>
              </optgroup>
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

function DshPetPluginView({ events, roles }: PluginRenderProps) {
  const [displayMode, setDisplayMode] = useState<'single' | 'all'>('single');
  const [roleBindings, setRoleBindings] = useState<Record<string, string | null>>(DEFAULT_ROLE_PET_MAPPING);

  const defaultRole = roles.find((r) => r.name === 'deep' || r.name === '肥鱼') || roles[0];
  const [selectedRoleKey, setSelectedRoleKey] = useState<string>(
    defaultRole ? getRoleKey(defaultRole) : 'bridge:deep'
  );

  const currentRole = roles.find((r) => getRoleKey(r) === selectedRoleKey) || defaultRole || roles[0];
  const currentRoleKey = currentRole ? getRoleKey(currentRole) : 'bridge:deep';

  const getPackForRole = (role: ExtendedRoleInfo | string): PetAssetPack | null => {
    const k = typeof role === 'string' ? role : getRoleKey(role);
    const name = typeof role === 'string' ? role.split(':').pop()! : role.name;
    const packId = roleBindings[k] ?? roleBindings[name];
    return getPetPackById(packId);
  };

  const handleBindingChange = (roleKeyToChange: string, newPackId: string | null) => {
    setRoleBindings((prev) => ({
      ...prev,
      [roleKeyToChange]: newPackId,
    }));
  };

  const currentPack = currentRole ? getPackForRole(currentRole) : null;

  const installedPacks = Object.values(AVAILABLE_PET_PACKS).filter((p) => p.installed);
  const uninstalledPacks = Object.values(AVAILABLE_PET_PACKS).filter((p) => !p.installed);

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
              onBindingChange={handleBindingChange}
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
                onBindingChange={handleBindingChange}
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
              严格区分本地已安装包与外部来源仓库，所有包原样展示作者与许可说明，不作镜像转发。
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
            <span className="text-[11px] text-ink-mute font-normal">—— 能直接在面板中播放与绑定</span>
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
                        <Badge variant="success" className="text-[10px]">本地已装</Badge>
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
                    <p><span className="font-medium text-ink">作者：</span>{pack.author}</p>
                    <p><span className="font-medium text-ink">许可协议：</span><span className="text-ink">{pack.license}</span></p>
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-hairline flex items-center justify-between text-xs">
                  <a
                    href={pack.repo}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:underline text-[11px]"
                  >
                    <span>来源仓库：{pack.repo.replace('https://github.com/', '')}</span>
                    <ExternalLink size={11} />
                  </a>
                  <span className="text-[11px] text-emerald-600 font-medium">● 适配就绪</span>
                </div>
              </div>
            ))}
          </div>
        </div>

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
                    <span className="text-[10px] text-ink-mute font-mono">{pack.actionCount} 动作</span>
                  </div>

                  <p className="text-[11px] text-ink-soft mt-2 line-clamp-2">{pack.description}</p>

                  <div className="mt-2.5 space-y-1 text-[11px] text-ink-mute bg-surface rounded p-2 ring-1 ring-hairline">
                    <p><span className="font-medium text-ink">作者：</span>{pack.author}</p>
                    <p><span className="font-medium text-ink">许可协议：</span>{pack.license}</p>
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

      {/* 5. Plugin Footer Attribution & Legal Specification */}
      <div className="mt-4 rounded-lg border border-hairline bg-surface-sunken/40 p-3.5 text-xs text-ink-soft flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 font-semibold text-ink">
          <Sparkles size={13} className="text-accent" />
          <span>形象包适配规范与许可声明</span>
        </div>
        <p className="text-[11px] leading-relaxed">
          bothouse 仅提供前端形象包适配器（支持透明 WebM 与 hunmer/aboutme-pets 透明 WebP 精灵图规范）。所有素材均由用户本机自行安装或前往原作者仓库下载，仓库内不内置任何第三方素材文件；素材作者与许可协议以各形象包自带 NOTICE 与 manifest 说明为准（未注明许可的素材请参阅来源仓库）。
        </p>
      </div>
    </div>
  );
}

export const dshPetPlugin: BothousePlugin = {
  id: 'dsh-pet',
  name: '桌宠角色与形象包适配 (dsh-pet & aboutme-pets)',
  author: 'PC2005-cloud & hunmer',
  repo: 'https://github.com/hunmer/aboutme-pets',
  license: '遵循各形象包自带说明 (NOTICE / Upstream)',
  version: 'v0.3.0',
  description:
    'bothouse 形象包适配插件：支持透明 WebM 与 hunmer/aboutme-pets 透明 WebP 精灵图规范；不内置素材，分清本地已装与来源仓库；每角色一只桌宠，独立 roleKey 防串流，多开按优先级合并展示；支持自选形象包绑定与未绑定待接入展示。',
  subscriptions: ['idle', 'working', 'thinking', 'celebrate', 'error', 'speech'],
  enabled: true,
  status: 'active',
  render: (props) => <DshPetPluginView {...props} />,
};
