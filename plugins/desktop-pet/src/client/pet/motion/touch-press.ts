/**
 * 触屏长按：按住到一定时长把这次按压当右键，计时期间手指移动超过容差就取消。
 * 不负责右键菜单本身，也不碰拖拽与点击判定——到点只回调，派发交给调用方。
 * 鼠标与笔不走这条分支，起表前先按指针类型挡掉。
 * 不变量：同一时刻只有一个计时器；到点时按压若已结束，回调自弃。
 * @module dsh-pet/src/client/pet/motion/touch-press
 */
/** 触屏长按多久算右键（ms）。 */
const LONG_PRESS_MS = 500;

/** 计时期间手指移动超过这个距离就取消（px）。 */
const SLOP_PX = 8;

/** 一次按下的现场：到点时要派发合成事件，得留着元素、指针与坐标。 */
export interface TouchPressTarget {
  /** 按下时被捕获的元素。 */
  el: HTMLElement;
  /** 指针 id，释放捕获用。 */
  pointerId: number;
  /** 指针类型；鼠标与笔直接忽略。 */
  pointerType: string;
  /** 按下的视口横坐标（px）。 */
  x: number;
  /** 按下的视口纵坐标（px）。 */
  y: number;
}

/** 长按驱动的依赖。 */
export interface TouchPressDeps {
  /** 到点时按压是否仍然有效：已松手或已进入拖拽都返回 false。 */
  stillHolding(): boolean;
  /** 到点：把这次按压当右键，由调用方派发。 */
  onMenu(target: TouchPressTarget): void;
}

/** 长按驱动：一个宠物一个实例。 */
export interface TouchPress {
  /** 起表；重复调用先取消旧的。鼠标与笔不起表。 */
  arm(target: TouchPressTarget): void;
  /** 手指移动的累计距离（px）；超过容差即取消。 */
  move(distancePx: number): void;
  /** 松手或取消按压：清计时器。 */
  cancel(): void;
  /** 是否正在等触发。 */
  isArmed(): boolean;
}

/**
 * 造长按驱动。
 *
 * @param deps - 到点时的有效性与回调。
 * @returns 可反复起表的驱动；计时器由本模块清理。
 */
export function createTouchPress(deps: TouchPressDeps): TouchPress {
  /** 待触发的计时器；`null` = 没有在等。 */
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 本次按下的现场，到点时交给回调。 */
  let pending: TouchPressTarget | null = null;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };

  const arm = (target: TouchPressTarget): void => {
    cancel();
    if (target.pointerType === 'mouse' || target.pointerType === 'pen') return;
    pending = target;
    timer = setTimeout(() => {
      timer = null;
      const current = pending;
      pending = null;
      if (current === null || !deps.stillHolding()) return;
      deps.onMenu(current);
    }, LONG_PRESS_MS);
  };

  const move = (distancePx: number): void => {
    if (timer === null) return;
    if (distancePx > SLOP_PX) cancel();
  };

  return { arm, cancel, isArmed: () => timer !== null, move };
}
