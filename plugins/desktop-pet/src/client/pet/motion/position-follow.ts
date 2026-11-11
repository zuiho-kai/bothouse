/**
 * 位置跟随：把位置指令（归一化中心）变成一次落位动画——instant 一帧到位、line 直线补间、spring 过阻尼跟随。
 * 三种模式都只在像素空间插值：按归一化比例插值会把斜线走歪，也会让不同视口下的速度不一致。
 * 一次只跑一条：新指令取消旧的，世代号让迟到的帧自弃；用户按下宠物时整拍让位（交互优先）。
 * @module dsh-pet/src/client/pet/motion/position-follow
 */
import { springStep } from '../../../shared/physics.ts';
import type { PositionMode } from '../../../shared/state.ts';
import { centerToBox, type BoxPoint, type Center, type HalfSize, type Viewport } from './geometry.ts';

/** 位置跟随的依赖：全部用取值函数，避免捕获渲染期的快照。 */
export interface PositionFollowDeps {
  /** 宠物根节点；`null` 表示还没挂载。 */
  root: () => HTMLDivElement | null;
  /** 当前包围盒位置（px）；`null` = 还没落过位。 */
  box: () => BoxPoint | null;
  /** 写回包围盒位置（每帧调用）。 */
  setBox: (box: BoxPoint) => void;
  /** 落位后提交归一化中心，交给 React 重排。 */
  commit: (center: Center) => void;
  /** 当前视口尺寸。 */
  viewport: () => Viewport;
  /** 盒的半宽半高。 */
  half: () => HalfSize;
  /** 弹簧刚度（取成品配置的 `physics.throwPower`）。 */
  spring: () => number;
  /** 用户是否正按着宠物：按着时整拍丢弃。 */
  isDragging: () => boolean;
  /** 接管前先停掉飞行与走位。 */
  takeOver: () => void;
}

/** 位置跟随驱动：一个宠物一个实例。 */
export interface PositionFollow {
  /**
   * 执行一次位置指令。
   *
   * @param rx - 目标中心相对视口的横向比例。
   * @param ry - 目标中心相对视口的纵向比例。
   * @param mode - 落位方式。
   * @param duration - `line` 模式的时长（ms）；`<= 0` 视同 instant。
   */
  apply: (rx: number, ry: number, mode: PositionMode, duration: number) => void;
  /** 放弃进行中的跟随（走位或新的接管会用到）。 */
  stop: () => void;
}

/**
 * 造位置跟随驱动。
 *
 * @param deps - 取位置、写位置与接管回调。
 * @returns 可反复调用的驱动。
 */
export function createPositionFollow(deps: PositionFollowDeps): PositionFollow {
  /** 进行中的 rAF；`null` = 没有跟随在跑。 */
  let frame: number | null = null;
  /** 世代号：每次开始或停止 +1，迟到的帧据此自弃。 */
  let token = 0;

  const stop = (): void => {
    token += 1;
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };

  /** 写包围盒与四个 style，弹簧和直线两条路共用。 */
  const paint = (el: HTMLDivElement, x: number, y: number): void => {
    deps.setBox({ x, y });
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  };

  const apply = (rx: number, ry: number, mode: PositionMode, duration: number): void => {
    if (deps.isDragging()) return;
    // 先显式接管：停掉飞行与走位，走位顺带停掉上一次的跟随。
    deps.takeOver();
    const target = centerToBox({ rx, ry }, deps.viewport(), deps.half());
    const el = deps.root();
    if (!el || mode === 'instant' || (mode === 'line' && duration <= 0)) {
      deps.setBox(target);
      deps.commit({ rx, ry });
      return;
    }
    const current = token + 1;
    token = current;
    if (frame !== null) cancelAnimationFrame(frame);
    if (mode === 'line') {
      if (duration <= 0) return; // 上面已经拦掉，这里只让类型收窄。
      const from = deps.box() ?? target;
      const t0 = performance.now();
      const step = (): void => {
        if (token !== current) return;
        const p = Math.min((performance.now() - t0) / duration, 1);
        if (p >= 1) {
          // 精确落位，终点不留残余偏差。
          paint(el, target.x, target.y);
          frame = null;
          deps.commit({ rx, ry });
          return;
        }
        paint(el, from.x + (target.x - from.x) * p, from.y + (target.y - from.y) * p);
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
      return;
    }
    // spring：过阻尼弹簧跟随，没有行程时间，靠收敛判定自己收尾。
    let last = performance.now();
    const vel = { vx: 0, vy: 0 };
    const step = (): void => {
      if (token !== current) return;
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      let x = deps.box()?.x ?? target.x;
      let y = deps.box()?.y ?? target.y;
      vel.vx = springStep(vel.vx, x, target.x, dt, deps.spring());
      vel.vy = springStep(vel.vy, y, target.y, dt, deps.spring());
      x += vel.vx * dt;
      y += vel.vy * dt;
      paint(el, x, y);
      // 收敛判定：足够近且足够慢时精确落位并提交。
      if (
        Math.abs(target.x - x) < 0.5 &&
        Math.abs(target.y - y) < 0.5 &&
        Math.abs(vel.vx) < 1 &&
        Math.abs(vel.vy) < 1
      ) {
        paint(el, target.x, target.y);
        frame = null;
        deps.commit({ rx, ry });
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };

  return { apply, stop };
}
