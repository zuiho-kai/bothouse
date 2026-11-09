import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { PetPlayer, type PetAction } from './PetPlayer';
import type { SpriteSheet } from './frameAt';

/**
 * 桌宠逐帧播放 (#416-C).
 *
 * 这些用例钉的是：一帧只露一帧的位置，换行以后还对不对（大豆包那版把整张图缩小塞进去，显示的
 * 是一片小点）；加载失败有占位，且换动作之后错误状态要复位，不能一直空着。
 */

// 640×360、8 列、共 13 帧：一行放不下，最后一帧在第 2 行，用来测换行和最后一帧。
const sheet: SpriteSheet = { frameWidth: 640, frameHeight: 360, columns: 8, frames: 13 };
const spriteAction = (src: string, fps = 12): PetAction => ({ kind: 'sprite', src, sheet, fps });

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

/** jsdom 不解码图片：每次 new Image() 记下来，用例自己触发 onload/onerror。 */
let images: HTMLImageElement[] = [];
const lastImage = () => images[images.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  images = [];
  const RealImage = window.Image;
  class TrackingImage extends RealImage {
    constructor() {
      super();
      images.push(this);
    }
  }
  vi.stubGlobal('Image', TrackingImage);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const render = async (node: ReactNode) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
};

const rerender = async (node: ReactNode) => {
  await act(async () => { root!.render(node); });
};

const sprite = () => container.querySelector('[data-testid="pet-player-sprite"]') as HTMLElement | null;

describe('桌宠逐帧播放', () => {
  it('第 0 帧贴左上角，图按列数、行数放大', async () => {
    await render(<PetPlayer action={spriteAction('blob:sprite-a')} size={{ width: 200, height: 112 }} />);
    const el = sprite()!;
    expect(el.dataset.frame).toBe('0');
    expect(el.style.backgroundPosition).toBe('0% 0%');
    // 8 列 → 800% 宽；13 帧要 2 行 → 200% 高
    expect(el.style.backgroundSize).toBe('800% 200%');
    // 长宽比跟着单帧走，卡片不会被拉变形
    expect(el.style.aspectRatio).toBe('640 / 360');
    expect(el.style.width).toBe('200px');
  });

  it('按 fps 往下走，换行后落在第 2 行同一列', async () => {
    await render(<PetPlayer action={spriteAction('blob:sprite-a')} />);
    const el = sprite()!;
    const step = Math.ceil(1000 / 12);
    // 第 9 帧：第 2 行第 2 列（0 起算第 1 列）
    await act(async () => { vi.advanceTimersByTime(step * 9); });
    expect(el.dataset.frame).toBe('9');
    expect(el.style.backgroundPosition).toBe(`${(1 / 7) * 100}% 100%`);
  });

  it('播到最后一帧后绕回第 0 帧，不停在末尾', async () => {
    await render(<PetPlayer action={spriteAction('blob:sprite-a')} />);
    const el = sprite()!;
    const step = Math.ceil(1000 / 12);
    await act(async () => { vi.advanceTimersByTime(step * 12); }); // 第 12 帧：最后一帧
    expect(el.dataset.frame).toBe('12');
    // 最后一帧也在第 2 行，列数是 12 % 8 = 4
    expect(el.style.backgroundPosition).toBe(`${(4 / 7) * 100}% 100%`);
    await act(async () => { vi.advanceTimersByTime(step); });
    expect(el.dataset.frame).toBe('0');
  });

  it('fps 不是正数时只停在第 0 帧', async () => {
    await render(<PetPlayer action={spriteAction('blob:sprite-a', 0)} />);
    const el = sprite()!;
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(el.dataset.frame).toBe('0');
  });

  it('图加载失败显示占位，换动作后错误状态复位', async () => {
    const text = '读不出这个动作的图';
    await render(<PetPlayer action={spriteAction('blob:sprite-a')} errorText={text} />);
    await act(async () => { lastImage()!.onerror?.(new Event('error')); });
    expect(container.querySelector('[data-testid="pet-player-error"]')?.textContent).toContain(text);
    expect(sprite()).toBeNull();

    // 同一个位置换下一个动作（比如「空闲」换成「干活中」）：占位要消失，从第 0 帧重播。
    await rerender(<PetPlayer action={spriteAction('blob:sprite-b')} errorText={text} />);
    expect(container.querySelector('[data-testid="pet-player-error"]')).toBeNull();
    expect(sprite()?.dataset.frame).toBe('0');
  });

  it('WebM 用 video 自动循环、静音、可见内联播放', async () => {
    await render(<PetPlayer action={{ kind: 'video', src: 'blob:clip.webm' }} />);
    const video = container.querySelector('[data-testid="pet-player-video"]') as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.autoplay).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
  });

  it('没有动作时留一个空位，不显示上一段素材', async () => {
    await render(<PetPlayer action={spriteAction('blob:sprite-a')} />);
    await rerender(<PetPlayer action={null} />);
    expect(container.querySelector('[data-testid="pet-player-empty"]')).not.toBeNull();
    expect(sprite()).toBeNull();
  });
});
