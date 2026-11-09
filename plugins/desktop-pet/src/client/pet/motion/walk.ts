/**
 * 自主走位：视频就绪后按播放时间把宠物从起点平移到目标比例，途中直接写根节点位置。
 * 不负责选哪段走路动作（planMoveAction 已决定），也不负责位置跟随的弹簧与拖拽——那是另外两条驱动。
 * 依赖注入的取值函数与当帧度量；rAF 句柄与待走动作由本模块持有，stop 之后同一实例可重新规划。
 * 不变量：同一时刻最多一条走位在跑；停走必须取消在跑的帧并作废已排队的动作。
 * @module dsh-pet/src/client/pet/motion/walk
 */
import { planMoveAction, type PendingMove } from './move-action.ts';
import type { BoxPoint } from './geometry.ts';
import type { MovesConfig } from '../../../shared/types.ts';

/** 走位需要的当帧几何（px）。 */
export interface WalkMetrics {
  /** 宠物宽度。 */
  size: number;
  /** 盒半宽。 */
  halfW: number;
  /** 盒半高。 */
  halfH: number;
  /** 身体相对视频盒左右各留的透明边。 */
  sideAllow: number;
}

/** 走位驱动的依赖：全部用取值函数，避免捕获渲染期的快照。 */
export interface WalkDeps {
  /** 宠物根节点；`null` 表示还没挂载。 */
  root(): HTMLDivElement | null;
  /** 当前宠物中心的视口坐标。 */
  center(): { x: number; y: number };
  /** 当帧几何。 */
  metrics(): WalkMetrics;
  /** 该宠物的走位池。 */
  moves(): MovesConfig;
  /** 当前朝向，决定走位方向。 */
  facing(): 'left' | 'right';
  /** 当前视口尺寸。 */
  viewport(): { width: number; height: number };
  /** 抛掷是否在飞：飞行中不发起新的走位。 */
  isFlying(): boolean;
  /** 换成走路动作并播一次。 */
  play(anim: string): void;
  /** 每帧回写包围盒：抛掷起点与宠物互撞都优先读它。 */
  setBox(box: BoxPoint): void;
  /** 走位结束提交归一化中心，交给 React 重排。 */
  commit(center: { rx: number; ry: number }): void;
}

/** 走位驱动：一个宠物一个实例。 */
export interface Walk {
  /** 是否有排队的动作；视频就绪时据此决定要不要开跑。 */
  hasPending(): boolean;
  /** 视频就绪后开跑；没有排队的动作时立即返回。 */
  start(el: HTMLVideoElement): void;
  /** 尝试发起一次走位：占用中返回 `true`，无法移动返回 `false`，成功返回动作名。 */
  tryMove(preferredName?: string): boolean | string;
  /** 停走：作废已排队的动作并取消在跑的帧。 */
  stop(): void;
}

/** 元数据未就绪时的兜底时长（秒）：取内置走路素材的常见时长，避免除零。 */
const FALLBACK_DURATION_SEC = 10.09;

/**
 * 造走位驱动。
 *
 * @param deps - 取位置、几何与回写位置的回调。
 * @returns 可反复调用的驱动。
 */
export function createWalk(deps: WalkDeps): Walk {
  /** 在跑的 rAF；`null` = 没在走。 */
  let frame: number | null = null;
  /** 世代号：开跑或停走 +1，迟到的帧据此自弃。 */
  let token = 0;
  /** 已规划、等待视频就绪的走位。 */
  let pending: PendingMove | null = null;

  const hasPending = (): boolean => pending !== null;

  const start = (el: HTMLVideoElement): void => {
    if (pending === null || frame !== null) return;
    const move = pending;
    pending = null;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : FALLBACK_DURATION_SEC;
    const travelWindow = Math.max(0.1, duration - move.leadSec - move.tailSec);
    const own = ++token;
    const step = (): void => {
      if (token !== own) return;
      const t = el.currentTime || 0;
      const { halfW, halfH } = deps.metrics();
      const { width: W, height: H } = deps.viewport();
      let ratioX: number;
      if (t <= move.leadSec) ratioX = move.startRatio;
      else if (t >= duration - move.tailSec) ratioX = move.targetRatio;
      // 按规划落点插值而不是 dir × 距离：minDist/maxDist 为负时符号必须保留，
      // 否则规划往左、驱动往右，走完再跳回原本的方向。
      else ratioX = move.startRatio + (move.targetRatio - move.startRatio) * ((t - move.leadSec) / travelWindow);
      const box = { x: ratioX * W - halfW, y: move.startYRatio * H - halfH };
      const rootEl = deps.root();
      if (rootEl) {
        rootEl.style.left = box.x + 'px';
        rootEl.style.top = box.y + 'px';
        rootEl.style.right = 'auto';
        rootEl.style.bottom = 'auto';
      }
      // 回写包围盒：走完一段后抛掷起点与互撞矩形都读它，不回写就会用到上一次拖拽/飞行的位置。
      deps.setBox(box);
      if (t < duration - move.tailSec) frame = requestAnimationFrame(step);
      else {
        frame = null;
        deps.commit({ rx: move.targetRatio, ry: move.startYRatio });
      }
    };
    frame = requestAnimationFrame(step);
  };

  const tryMove = (preferredName?: string): boolean | string => {
    // 占用中返回 true：调用方据此知道宠物没空，不必再挑原地动作。
    if (frame !== null || pending !== null || deps.isFlying()) return true;
    const metrics = deps.metrics();
    const action = planMoveAction({
      moves: deps.moves(),
      preferredName,
      // 走路方向只看当前 facing；不要用 turn 动画反推方向，facingRef 已在 handleEnded 即时同步。
      facing: deps.facing(),
      size: metrics.size,
      center: deps.center(),
      viewport: deps.viewport(),
      halfW: metrics.halfW,
      sideAllow: metrics.sideAllow,
    });
    if (action === null) return false;
    pending = action.pending;
    deps.play(action.anim);
    return action.anim;
  };

  const stop = (): void => {
    pending = null;
    token++;
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };

  return { hasPending, start, stop, tryMove };
}
