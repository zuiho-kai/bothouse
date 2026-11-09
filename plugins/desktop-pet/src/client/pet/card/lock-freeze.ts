/**
 * 占用锁的冻结驱动：把 /state 的 lock 叶子换算成冻结翻转，并负责到点自动解冻。
 * 不负责翻转之后做什么：停走位、收气泡、选动画都由 PetCard 以回调传入。
 * 依赖注入的 react 与动画链的 setFrozen；解冻定时器只在本模块持有。
 * 不变量：冻结状态只由锁叶子与本地解冻两条路径改，两条都先清定时器再翻转。
 * @module dsh-pet/src/client/pet/card/lock-freeze
 */
import type { LockState } from '../../../shared/state.ts';
import type { FreezeCue } from '../animation/cues.ts';
import type * as ReactNS from 'react';

/** 一次翻转要执行的回调。 */
export interface FreezeHandlers {
  /** 冻结生效：停自播、收起任务气泡。 */
  onFrozen(): void;
  /** 解冻生效：恢复到该播的动画。 */
  onResumed(): void;
}

/** 每次渲染由 PetCard 提供的输入。 */
export interface LockFreezeInput extends FreezeHandlers {
  /** 本宠物的锁叶子；`undefined` 表示宿主从未写过。 */
  lock?: LockState;
  /** 锁叶子变化次数。 */
  lockTick: number;
  /** 动画链的冻结开关；返回的就是这次翻转，null 表示本来就是这个值。 */
  setFrozen(frozen: boolean): FreezeCue | null;
}

/** 冻结驱动对外的写面。 */
export interface LockFreeze {
  /** 本地立即解冻，并清掉解冻定时器；用户接管宠物时调。 */
  release(): void;
}

/** 注入的 react 能力。 */
export interface LockFreezeRuntime {
  /** 引用；用于持有解冻定时器。 */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
  /** 副作用；叶子或 tick 变化时重算截止时间。 */
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
}

/**
 * 由锁叶子算出冻结截止时间。
 *
 * 刷新后可能拿到陈旧叶子：expiresAt 已过去就当没有锁，不能只看 locked。
 *
 * @param lock - 锁叶子。
 * @param nowMs - 当前时间（ms），由调用方注入以便测试。
 * @returns 截止的绝对时间（ms）；0 表示当前没有锁。
 */
export function freezeDeadline(lock: LockState | undefined, nowMs: number): number {
  const expiresAt = lock?.locked === true ? lock.expiresAt : 0;
  return expiresAt > nowMs ? expiresAt : 0;
}

/** 执行一次翻转；cue 为 null 表示状态本来就是这个值。 */
function dispatchCue(cue: FreezeCue | null, handlers: FreezeHandlers): void {
  if (cue === null) return;
  if (cue.kind === 'frozen') handlers.onFrozen();
  else handlers.onResumed();
}

/**
 * 制造冻结驱动的 hook，每个 PetCard 调一次。
 *
 * @param rt - 注入的 react 能力。
 * @returns 接收锁叶子的 hook；解冻定时器随卡片卸载一并清理。
 */
export function createLockFreeze(rt: LockFreezeRuntime) {
  const { useEffect, useRef } = rt;

  return function useLockFreeze(input: LockFreezeInput): LockFreeze {
    /** 解冻定时器；重算与本地解冻前都必须清掉，否则旧定时器会提前解冻。 */
    const timerRef = useRef<number | null>(null);

    /** 清掉解冻定时器；重复调用安全。 */
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    useEffect(() => {
      clearTimer();
      const now = Date.now();
      const expiresAt = freezeDeadline(input.lock, now);
      dispatchCue(input.setFrozen(expiresAt > now), input);
      if (expiresAt <= now) return clearTimer;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        dispatchCue(input.setFrozen(false), input);
      }, expiresAt - now);
      return clearTimer;
      // 回调每渲染重建，但只读 ref 与稳定 setter；进依赖会让每次渲染都清掉并重设解冻定时器，锁会永不到期。
      // eslint-disable-next-line react-hooks/exhaustive-deps -- 变化原因只有叶子与 tick
    }, [input.lockTick, input.lock]);

    return {
      release: () => {
        clearTimer();
        dispatchCue(input.setFrozen(false), input);
      },
    };
  };
}
