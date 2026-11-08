import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { frameAt, frameIntervalMs, type SpriteSheet } from './frameAt';

/** 一次要播的动作：要么一张精灵图，要么一段透明 WebM。 */
export type PetAction =
  | {
      kind: 'sprite'
      /** 精灵图地址（本机形象包里的文件，经 /api/v1/pets 给出来）。 */
      src: string
      sheet: SpriteSheet
      /** 每秒几帧；不是正数就只停在第 0 帧。 */
      fps: number
    }
  | {
      kind: 'video'
      /** WebM 地址。 */
      src: string
    };

export interface PetPlayerProps {
  action: PetAction | null
  /** 显示多大（CSS 长宽），不给就按动作自己的帧宽高比撑满容器宽。 */
  size?: { width: number | string; height?: number | string }
  /** 读不出图/视频时显示的字，由页面按语言传；不给就显示一个图标。 */
  errorText?: string
  className?: string
}

/**
 * 只管「播一个动作」的组件 (#416-C)。
 *
 * 整张精灵图缩进卡片会变成一片小点；这里按 frameAt 算出的位置只露一帧，按 fps 往下换。
 * 换动作、换 fps、换图都从第 0 帧重新开始；上一段素材加载失败后换新动作，错误状态跟着复位，
 * 否则同一个位置会一直显示占位（大豆包那版「干活中」永远是空的，就是这个原因）。
 */
export function PetPlayer({ action, size, errorText, className }: PetPlayerProps) {
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  const sprite = action?.kind === 'sprite' ? action : null;
  const src = action?.src ?? '';
  const fps = sprite?.fps ?? 0;

  // 动作或它的帧率一变就复位：错误状态属于「这一段素材」，不属于这个位置。
  useEffect(() => {
    setFailed(false);
    setIndex(0);
  }, [src, fps, action?.kind]);

  // 精灵图是背景图，加载失败不会自然冒到元素上；先用 Image 探一次，失败才显示占位。
  useEffect(() => {
    if (!sprite || !src) return;
    let alive = true;
    const img = new Image();
    img.onerror = () => { if (alive) setFailed(true); };
    img.onload = () => { if (alive) setFailed(false); };
    img.src = src;
    return () => { alive = false; };
  }, [sprite, src]);

  const interval = sprite ? frameIntervalMs(fps) : 0;
  useEffect(() => {
    if (!sprite || interval <= 0 || failed) return;
    timer.current = window.setInterval(() => setIndex(i => i + 1), interval);
    return () => window.clearInterval(timer.current);
  }, [sprite, interval, failed]);

  const box = useMemo(() => (sprite ? frameAt(index, sprite.sheet) : null), [sprite, index]);

  const style = useMemo<CSSProperties>(() => {
    if (!sprite || !box) return cardSize(size);
    const { frameWidth, frameHeight, columns } = sprite.sheet;
    return {
      ...cardSize(size),
      aspectRatio: frameWidth > 0 && frameHeight > 0 ? `${frameWidth} / ${frameHeight}` : undefined,
      // 图按列数、行数放大后，background-position 的百分比就把视野挪到第几帧；元素多大都不影响切帧。
      backgroundImage: `url("${src}")`,
      backgroundSize: `${Math.max(1, Math.floor(columns)) * 100}% ${box.rows * 100}%`,
      backgroundPosition: `${box.x}% ${box.y}%`,
      backgroundRepeat: 'no-repeat',
    };
  }, [sprite, box, src, size?.width, size?.height]);

  if (!action) {
    return (
      <div
        data-testid="pet-player-empty"
        className={cn('rounded-card bg-surface-sunken', className)}
        style={cardSize(size)}
      />
    );
  }

  if (failed) {
    return (
      <div
        data-testid="pet-player-error"
        role="img"
        aria-label={errorText || 'failed to load'}
        className={cn('grid place-items-center rounded-card border border-hairline bg-surface-sunken px-2 text-center text-ink-mute', className)}
        style={cardSize(size)}
      >
        {errorText ? <span className="text-[13px]">{errorText}</span> : <AlertTriangle size={18} strokeWidth={1.25} />}
      </div>
    );
  }

  if (action.kind === 'video') {
    return (
      <video
        data-testid="pet-player-video"
        src={action.src}
        autoPlay
        loop
        muted
        playsInline
        onError={() => setFailed(true)}
        className={cn('rounded-card bg-surface-sunken object-contain', className)}
        style={cardSize(size)}
      />
    );
  }

  return (
    <div
      data-testid="pet-player-sprite"
      data-frame={box?.frame ?? 0}
      role="img"
      aria-label={`frame ${box?.frame ?? 0}`}
      className={cn('rounded-card bg-surface-sunken bg-no-repeat', className)}
      style={style}
    />
  );
}

function cardSize(size: PetPlayerProps['size']): CSSProperties {
  return { width: size?.width ?? '100%', height: size?.height };
}

export default PetPlayer;
