import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  User,
  Users,
  ImageOff,
  Activity,
  ChevronDown,
  Download,
  ExternalLink,
  CheckCircle2,
  Layers,
  Sparkles,
  Film,
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
import { listInstalledPetPacks, type InstalledPetPack } from '@/api/pets';

export type PetPackFormat = 'spritesheet' | 'webm';

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
  assets: Record<RoleEventType, PetAsset>;
}

/**
 * Calculates (col, row) and pixel (x, y) coordinates for a given frame index in a spritesheet.
 */
export function calculateFramePosition(
  frameIndex: number,
  columns: number = 8,
  frameWidth: number = 640,
  frameHeight: number = 360
): { col: number; row: number; x: number; y: number } {
  const safeCols = Math.max(1, columns);
  const col = frameIndex % safeCols;
  const row = Math.floor(frameIndex / safeCols);
  return {
    col,
    row,
    x: col * frameWidth,
    y: row * frameHeight,
  };
}

// 1. 本地已装包：肥鱼 (dsh1，166动作，WebP精灵图规范 640×360 12fps 8列)
export const DSH1_PACK: PetAssetPack = {
  id: 'dsh1',
  name: '肥鱼 (dsh1 新动作包)',
  repo: 'https://github.com/hunmer/aboutme-pets',
  description: '166 个透明 WebP 精灵图动作，含工作加班、换装侦探服思考、站着打瞌睡等；蓝发女仆装鲸鱼尾巴。',
  format: 'spritesheet',
  formatSpecs: '640×360, 12fps, 8列 透明 WebP 精灵图',
  actionCount: 166,
  installed: true,
  localPath: '~/.bothouse/pets/dsh1',
  recommendedRole: 'deep',
  assets: {
    idle: {
      key: 'idle',
      title: '站着晃神打瞌睡',
      actionName: '站着晃神打瞌睡',
      filename: 'spritesheet/站着晃神打瞌睡.webp',
      url: '/api/v1/plugins/pets/asset?pack=dsh1&file=spritesheet/%E7%AB%99%E7%9D%80%E6%99%83%E7%A5%9E%E6%89%93%E7%9E%8C%E7%9D%A1.webp',
      badgeText: '待机中',
      badgeVariant: 'default',
      columns: 8,
      frameCount: 180,
      frameWidth: 640,
      frameHeight: 360,
      fps: 12,
    },
    working: {
      key: 'working',
      title: '工作加班',
      actionName: '工作加班',
      filename: 'spritesheet/工作加班.webp',
      url: '/api/v1/plugins/pets/asset?pack=dsh1&file=spritesheet/%E5%B7%A5%E4%BD%9C%E5%8A%A0%E7%8F%AD.webp',
      badgeText: '干活中',
      badgeVariant: 'info',
      columns: 8,
      frameCount: 180,
      frameWidth: 640,
      frameHeight: 360,
      fps: 12,
    },
    thinking: {
      key: 'thinking',
      title: '换装侦探服思考',
      actionName: '换装侦探服思考',
      filename: 'spritesheet/换装侦探服思考.webp',
      url: '/api/v1/plugins/pets/asset?pack=dsh1&file=spritesheet/%E6%8D%A2%E8%A3%85%E4%BE%A6%E6%8E%A2%E6%9C%8D%E6%80%9D%E8%80%83.webp',
      badgeText: '思考中',
      badgeVariant: 'info',
      columns: 8,
      frameCount: 180,
      frameWidth: 640,
      frameHeight: 360,
      fps: 12,
    },
    celebrate: {
      key: 'celebrate',
      title: '举杯敬酒',
      actionName: '举杯敬酒',
      filename: 'spritesheet/举杯敬酒.webp',
      url: '/api/v1/plugins/pets/asset?pack=dsh1&file=spritesheet/%E4%B8%BE%E6%9D%AF%E6%95%AC%E9%85%92.webp',
      badgeText: '交活庆祝',
      badgeVariant: 'success',
      columns: 8,
      frameCount: 180,
      frameWidth: 640,
      frameHeight: 360,
      fps: 12,
    },
    error: {
      key: 'error',
      title: '沙发打瞌睡',
      actionName: '沙发打瞌睡',
      filename: 'spritesheet/沙发打瞌睡.webp',
      url: '/api/v1/plugins/pets/asset?pack=dsh1&file=spritesheet/%E6%B2%99%E5%8F%91%E6%89%93%E7%9E%8C%E7%9D%A1.webp',
      badgeText: '出错/冷却',
      badgeVariant: 'danger',
      columns: 8,
      frameCount: 180,
      frameWidth: 640,
      frameHeight: 360,
      fps: 12,
    },
    speech: {
      key: 'speech',
      title: '换装侦探服思考',
      actionName: '换装侦探服思考',
      filename: 'spritesheet/换装侦探服思考.webp',
      url: '/api/v1/plugins/pets/asset?pack=dsh1&file=spritesheet/%E6%8D%A2%E8%A3%85%E4%BE%A6%E6%8E%A2%E6%9C%8D%E6%80%9D%E8%80%83.webp',
      badgeText: '说话中',
      badgeVariant: 'info',
      columns: 8,
      frameCount: 180,
      frameWidth: 640,
      frameHeight: 360,
      fps: 12,
    },
  },
};

// 2. 本地已装包：Claude娘 (claude，166动作，WebP精灵图规范 640×360 12fps 8列)
export const CLAUDE_PACK: PetAssetPack = {
  id: 'claude',
  name: 'Claude娘 (claude 动作包)',
  repo: 'https://github.com/hunmer/aboutme-pets',
  description: '166 个透明 WebP 精灵图动作，橘棕长发向日葵发饰，怀抱厚书，干活时头顶齿轮与扳手。',
  format: 'spritesheet',
  formatSpecs: '640×360, 12fps, 8列 透明 WebP 精灵图',
  actionCount: 166,
  installed: true,
  localPath: '~/.bothouse/pets/claude',
  recommendedRole: 'cjiang',
  assets: {
    idle: {
      key: 'idle',
      title: '待机呼吸休闲',
      actionName: '待机呼吸休闲',
      filename: 'spritesheet/待机呼吸休闲.webp',
      url: '/api/v1/plugins/pets/asset?pack=claude&file=spritesheet/%E5%BE%85%E6%9C%BA%E5%91%BC%E5%90%B8%E4%BC%91%E9%97%B2.webp',
      badgeText: '待机中',
      badgeVariant: 'default',
      columns: 8,
      frameCount: 120,
      frameWidth: 640,
      frameHeight: 360,
      fps: 12,
    },
    working: {
      key: 'working',
      title: '工作状态-写代码',
      actionName: '写代码',
      filename: 'spritesheet/写代码.webp',
      url: '/api/v1/plugins/pets/asset?pack=claude&file=spritesheet/%E5%86%99%E4%BB%A3%E7%A0%81.webp',
      badgeText: '干活中',
      badgeVariant: 'info',
      columns: 8,
      frameCount: 120,
      frameWidth: 640,
      frameHeight: 360,
      fps: 12,
    },
    thinking: {
      key: 'thinking',
      title: '工作状态-思考冒泡',
      actionName: '工作状态-思考冒泡',
      filename: 'spritesheet/工作状态-思考冒泡.webp',
      url: '/api/v1/plugins/pets/asset?pack=claude&file=spritesheet/%E5%B7%A5%E4%BD%9C%E7%8A%B6%E6%80%81-%E6%80%9D%E8%80%83%E5%86%92%E6%B3%A1.webp',
      badgeText: '思考中',
      badgeVariant: 'info',
      columns: 8,
      frameCount: 120,
      frameWidth: 640,
      frameHeight: 360,
      fps: 12,
    },
    celebrate: {
      key: 'celebrate',
      title: '工作状态-雀跃庆祝',
      actionName: '工作状态-雀跃庆祝',
      filename: 'spritesheet/工作状态-雀跃庆祝.webp',
      url: '/api/v1/plugins/pets/asset?pack=claude&file=spritesheet/%E5%B7%A5%E4%BD%9C%E7%8A%B6%E6%80%81-%E9%9B%80%E8%B7%83%E5%BA%86%E7%A5%9D.webp',
      badgeText: '交活庆祝',
      badgeVariant: 'success',
      columns: 8,
      frameCount: 120,
      frameWidth: 640,
      frameHeight: 360,
      fps: 12,
    },
    error: {
      key: 'error',
      title: '工作状态-垂头叹气冒汗',
      actionName: '工作状态-垂头叹气冒汗',
      filename: 'spritesheet/工作状态-垂头叹气冒汗.webp',
      url: '/api/v1/plugins/pets/asset?pack=claude&file=spritesheet/%E5%B7%A5%E4%BD%9C%E7%8A%B6%E6%80%81-%E5%9E%82%E5%A4%B4%E5%8F%B9%E6%B0%94%E5%86%92%E6%B1%97.webp',
      badgeText: '出错/冷却',
      badgeVariant: 'danger',
      columns: 8,
      frameCount: 120,
      frameWidth: 640,
      frameHeight: 360,
      fps: 12,
    },
    speech: {
      key: 'speech',
      title: '工作状态-思考冒泡',
      actionName: '工作状态-思考冒泡',
      filename: 'spritesheet/工作状态-思考冒泡.webp',
      url: '/api/v1/plugins/pets/asset?pack=claude&file=spritesheet/%E5%B7%A5%E4%BD%9C%E7%8A%B6%E6%80%81-%E6%80%9D%E8%80%83%E5%86%92%E6%B3%A1.webp',
      badgeText: '说话中',
      badgeVariant: 'info',
      columns: 8,
      frameCount: 120,
      frameWidth: 640,
      frameHeight: 360,
      fps: 12,
    },
  },
};

// 3. 来源仓库包：GPT娘 (gpt1，未安装)
export const GPT1_PACK: PetAssetPack = {
  id: 'gpt1',
  name: 'GPT娘 (gpt1 动作包)',
  repo: 'https://github.com/hunmer/aboutme-pets',
  description: '2026-11 GPT 生成第二批次，92 个透明动作；白发紫眼龙角娘，抱笔记本电脑写代码。',
  format: 'spritesheet',
  formatSpecs: '640×360, 12fps, 8列 透明 WebP 精灵图',
  actionCount: 92,
  installed: false,
  recommendedRole: 'gge',
  assets: {} as any,
};

// 4. 来源仓库包：Gemini猫耳娘 (gemini，未安装)
export const GEMINI_PACK: PetAssetPack = {
  id: 'gemini',
  name: 'Gemini猫耳娘 (gemini 动作包)',
  repo: 'https://github.com/hunmer/aboutme-pets',
  description: '2026-11 Gemini 生成批次（猫耳娘版），100 个透明动作；紫粉渐变长发，异色瞳。',
  format: 'spritesheet',
  formatSpecs: '640×360, 12fps, 8列 透明 WebP 精灵图',
  actionCount: 100,
  installed: false,
  recommendedRole: 'gjiang',
  assets: {} as any,
};

// 5. 来源仓库包：官方 dsh-pet 原版透明 WebM (未安装)
export const DSH_OFFICIAL_WEBM_PACK: PetAssetPack = {
  id: 'dsh-official',
  name: '官方 dsh-pet (透明 WebM 包)',
  repo: 'https://github.com/PC2005-cloud/dsh-pet',
  description: '官方 dsh-pet 原生透明 WebM 视频包（pet/ 目录），101 个动作，经典蓝发女仆装。',
  format: 'webm',
  formatSpecs: 'VP9 透明通道 WebM (pet/*.webm)',
  actionCount: 101,
  installed: false,
  recommendedRole: 'deep',
  assets: {} as any,
};

// Available pet packs catalog baseline
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

const STORAGE_KEY_BINDINGS = 'bothouse_pet_bindings_v4';

export function getPetPackById(packId: string | null | undefined, catalog: Record<string, PetAssetPack> = AVAILABLE_PET_PACKS): PetAssetPack | null {
  if (!packId) return null;
  return catalog[packId] || null;
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

/**
 * Dynamically resolves or fallback an action asset for an event from the pack's manifest/actions.
 */
export function resolvePetAsset(pack: PetAssetPack, eventType: RoleEventType): PetAsset {
  if (pack.assets && pack.assets[eventType]) {
    return pack.assets[eventType];
  }
  const anims = (pack.actionsList || (pack.manifest?.animations as Array<Record<string, unknown>>) || []) as Array<Record<string, any>>;
  let matched: any = null;

  if (anims.length > 0) {
    if (eventType === 'idle') {
      matched = anims.find((a) =>
        a.category === '待机' ||
        a.id === pack.manifest?.idleAnimationId ||
        a.name?.includes('待机') ||
        a.id?.includes('待机') ||
        a.category === '日常起居'
      );
    } else if (eventType === 'working') {
      matched = anims.find((a) =>
        a.category === '工作状态' ||
        a.category === '工作职业' ||
        a.name?.includes('工作') ||
        a.name?.includes('代码') ||
        a.name?.includes('加班') ||
        a.id?.includes('工作') ||
        a.id?.includes('代码')
      );
    } else if (eventType === 'thinking') {
      matched = anims.find((a) =>
        a.name?.includes('思考') ||
        a.id?.includes('思考') ||
        a.name?.includes('冒泡')
      );
    } else if (eventType === 'celebrate') {
      matched = anims.find((a) =>
        a.name?.includes('庆祝') ||
        a.id?.includes('庆祝') ||
        a.name?.includes('敬酒') ||
        a.name?.includes('雀跃')
      );
    } else if (eventType === 'error') {
      matched = anims.find((a) =>
        a.name?.includes('叹气') ||
        a.name?.includes('冒汗') ||
        a.name?.includes('打瞌睡') ||
        a.name?.includes('垂头') ||
        a.id?.includes('打瞌睡') ||
        a.category === '情绪反应'
      );
    } else if (eventType === 'speech') {
      matched = anims.find((a) =>
        a.name?.includes('说话') ||
        a.name?.includes('碎碎念') ||
        a.id?.includes('思考')
      );
    }

    if (!matched) matched = anims[0];
  }

  const actionName = matched?.name || matched?.id || '待机';
  const relFile = matched?.sources?.webp || matched?.sources?.webm || `spritesheet/${actionName}.webp`;
  const url = pack.localPath
    ? `/api/v1/plugins/pets/asset?pack=${encodeURIComponent(pack.id)}&file=${encodeURIComponent(relFile)}`
    : '';

  const sheet = matched?.spritesheet || {};
  return {
    key: eventType,
    title: actionName,
    actionName,
    filename: relFile,
    url,
    badgeText: eventType === 'working' ? '干活中' : eventType === 'thinking' ? '思考中' : eventType === 'celebrate' ? '交活庆祝' : eventType === 'error' ? '出错/冷却' : '待机中',
    badgeVariant: eventType === 'working' || eventType === 'thinking' ? 'info' : eventType === 'celebrate' ? 'success' : eventType === 'error' ? 'danger' : 'default',
    columns: sheet.columns || 8,
    frameCount: sheet.frameCount || 120,
    frameWidth: sheet.frameWidth || 640,
    frameHeight: sheet.frameHeight || 360,
    fps: sheet.fps || 12,
  };
}

export function SpritesheetPlayer({
  asset,
  eventType,
  roleKey,
  onImageError,
}: {
  asset: PetAsset;
  eventType: RoleEventType;
  roleKey: string;
  isHero: boolean;
  onImageError?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const columns = asset.columns || 8;
  const frameWidth = asset.frameWidth || 640;
  const frameHeight = asset.frameHeight || 360;
  const frameCount = asset.frameCount || 120;
  const fps = asset.fps || 12;

  // Reset frame when action or url changes
  useEffect(() => {
    setFrameIndex(0);
    setImgLoaded(false);
    const img = new Image();
    imgRef.current = img;
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImgLoaded(true);
    };
    img.onerror = () => {
      if (onImageError) onImageError();
    };
    img.src = asset.url;

    return () => {
      imgRef.current = null;
    };
  }, [asset.url, asset.actionName, onImageError]);

  // Frame advance loop
  useEffect(() => {
    if (frameCount <= 1) return;
    const intervalMs = Math.max(16, Math.round(1000 / fps));
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % frameCount);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [frameCount, fps]);

  // Canvas frame drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      // jsdom environment fallback
    }
    if (!ctx) return;

    const img = imgRef.current;
    if (img && imgLoaded) {
      const { x, y } = calculateFramePosition(frameIndex, columns, frameWidth, frameHeight);
      ctx.clearRect(0, 0, frameWidth, frameHeight);
      ctx.drawImage(img, x, y, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
    }
  }, [frameIndex, imgLoaded, columns, frameWidth, frameHeight]);

  return (
    <div
      data-testid={`spritesheet-player-${roleKey}`}
      data-frame={frameIndex}
      data-action={asset.actionName}
      className="relative flex items-center justify-center w-full h-full"
    >
      <canvas
        ref={canvasRef}
        width={frameWidth}
        height={frameHeight}
        className={cn(
          'max-h-full max-w-full aspect-[16/9] object-contain drop-shadow transition-transform duration-300 hover:scale-105',
          eventType === 'working' && 'animate-pulse'
        )}
      />
      {/* Hidden image element for test assertion & error handler */}
      <img
        src={asset.url}
        alt={asset.title}
        data-testid={`pet-img-${roleKey}`}
        className="sr-only"
        onError={onImageError}
      />
    </div>
  );
}

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

  // Reset imgError whenever asset url or eventType changes
  useEffect(() => {
    setImgError(false);
  }, [asset?.url, eventType]);

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

      {imgError ? (
        <div className="flex flex-col items-center justify-center text-ink-mute p-4 text-center">
          <ImageOff size={24} className="mb-1 text-ink-mute" />
          <span className="text-[11px]">素材加载异常</span>
        </div>
      ) : pack.format === 'webm' && asset.url?.endsWith('.webm') ? (
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
        <SpritesheetPlayer
          asset={asset}
          eventType={eventType}
          roleKey={roleKey}
          isHero={isHero}
          onImageError={() => setImgError(true)}
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
  availablePacks,
  onBindingChange,
}: {
  role: ExtendedRoleInfo;
  event?: RoleEvent;
  pack: PetAssetPack | null;
  isHero?: boolean;
  availablePacks: Record<string, PetAssetPack>;
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

  const asset = pack ? resolvePetAsset(pack, eventType) : null;

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
                {installedList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} [本地已装]
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

function DshPetPluginView({ events, roles }: PluginRenderProps) {
  const [displayMode, setDisplayMode] = useState<'single' | 'all'>('single');
  const [availablePacks, setAvailablePacks] = useState<Record<string, PetAssetPack>>(AVAILABLE_PET_PACKS);

  // Initialize role bindings from localStorage or initial recommendation
  const [roleBindings, setRoleBindings] = useState<Record<string, string | null>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_BINDINGS);
      if (saved) return JSON.parse(saved);
    } catch {
      // Fallback
    }
    return {
      'bridge:deep': 'dsh1',
      deep: 'dsh1',
      'bridge:cjiang': 'claude',
      cjiang: 'claude',
    };
  });

  // Query backend for newly installed local packages
  useEffect(() => {
    let isMounted = true;
    listInstalledPetPacks()
      .then((res) => {
        if (!isMounted || !res || !Array.isArray(res.installed)) return;
        setAvailablePacks((prev) => {
          const next = { ...prev };
          res.installed.forEach((inst: InstalledPetPack) => {
            const existing = next[inst.id];
            next[inst.id] = {
              id: inst.id,
              name: inst.name || inst.id,
              repo: existing?.repo || 'https://github.com/hunmer/aboutme-pets',
              description: existing?.description || `本机安装动作包，包含 ${inst.actionCount} 个动作。`,
              format: inst.format || 'spritesheet',
              formatSpecs: existing?.formatSpecs || '640×360, 12fps, 8列 透明 WebP 精灵图',
              actionCount: inst.actionCount,
              installed: true,
              localPath: inst.localPath || `~/.bothouse/pets/${inst.id}`,
              manifest: inst.manifest,
              actionsList: inst.actions,
              notice: inst.notice,
              assets: existing?.assets || ({} as any),
            };
          });
          return next;
        });
      })
      .catch(() => {
        // Backend offline or error, preserve baseline
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const defaultRole = roles.find((r) => r.name === 'deep' || r.name === '肥鱼') || roles[0];
  const [selectedRoleKey, setSelectedRoleKey] = useState<string>(
    defaultRole ? getRoleKey(defaultRole) : 'bridge:deep'
  );

  const currentRole = roles.find((r) => getRoleKey(r) === selectedRoleKey) || defaultRole || roles[0];
  const currentRoleKey = currentRole ? getRoleKey(currentRole) : 'bridge:deep';

  // Strict role-to-pack resolution: respect explicit unbinding (null)
  const getPackForRole = useCallback(
    (role: ExtendedRoleInfo | string): PetAssetPack | null => {
      const k = typeof role === 'string' ? role : getRoleKey(role);
      const name = typeof role === 'string' ? role.split(':').pop()! : role.name;

      if (Object.prototype.hasOwnProperty.call(roleBindings, k)) {
        const bound = roleBindings[k];
        if (bound === null || bound === '') return null;
        return getPetPackById(bound, availablePacks);
      }
      if (Object.prototype.hasOwnProperty.call(roleBindings, name)) {
        const bound = roleBindings[name];
        if (bound === null || bound === '') return null;
        return getPetPackById(bound, availablePacks);
      }

      // Default recommendation: deep defaults to dsh1, cjiang defaults to claude
      if (name === 'deep' || name === '肥鱼') {
        return getPetPackById('dsh1', availablePacks);
      }
      if (name === 'cjiang' || name === 'C酱') {
        return getPetPackById('claude', availablePacks);
      }
      return null;
    },
    [roleBindings, availablePacks]
  );

  const handleBindingChange = (roleKeyToChange: string, newPackId: string | null) => {
    setRoleBindings((prev) => {
      const next = {
        ...prev,
        [roleKeyToChange]: newPackId,
      };
      try {
        localStorage.setItem(STORAGE_KEY_BINDINGS, JSON.stringify(next));
      } catch {
        // Ignore storage write error
      }
      return next;
    });
  };

  const currentPack = currentRole ? getPackForRole(currentRole) : null;

  const installedPacks = Object.values(availablePacks).filter((p) => p.installed);
  const uninstalledPacks = Object.values(availablePacks).filter((p) => !p.installed);

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
                    <p><span className="font-medium text-ink">状态：</span><span className="text-emerald-600 font-medium">本机已安装就绪</span></p>
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-hairline flex items-center justify-between text-xs">
                  <span className="text-[11px] text-ink-mute font-mono">ID: {pack.id}</span>
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
                    <p><span className="font-medium text-ink">规格：</span>{pack.formatSpecs}</p>
                    <p><span className="font-medium text-ink">状态：</span><span className="text-amber-600 font-medium">来源仓库（未安装）</span></p>
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
