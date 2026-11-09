/**
 * 纯选择逻辑：随机抽取、事件档位取值、权重掷骰，可独立单测。
 * 两端共用同一份，随机链必须走这里，否则浏览器半侧与桌面 Helper 会分叉。
 * 不依赖 React / DOM。
 * @module dsh-pet/src/shared/pickers
 */
import type { Category, EventSlot, Events, Weights } from './types.ts';

/** 从池里等概率抽一个；exclude 避开某个名字（减少连续重复）。 */
export const pick = <T>(pool: readonly T[], exclude?: T): T => {
  const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
  // 排除后池空（单元素池 + 排除自己）：退回原池抽，宁可重复也不返回 undefined
  const src = entries.length ? entries : pool;
  return src[Math.floor(Math.random() * src.length)];
};

/**
 * 挑一套睡觉动作：整套随机，调用方拿到的三段必须来自同一套（否则会「蹲着入睡、趴着醒来」）。
 *
 * @param sets - 配置里的 sleep 套数组；段内多候选由调用方对选中的那套再 `pick` 一次。
 * @returns 选中的套；空数组返回 null，调用方据此隐藏「睡觉」入口。
 */
export const pickSleepSet = <T>(sets: readonly T[]): T | null =>
  sets.length > 0 ? sets[Math.floor(Math.random() * sets.length)] : null;

/** 事件档位取值：字符串槽位原样返回（固定播放）；数组槽位 = 档内候选，随机抽 1 并尽量避开 exclude。
 *  排除后池空（单候选且排除自己）退回原数组——宁可重复，也不返回 undefined。 */
export const pickSlot = (slot: EventSlot, exclude?: string): string => {
  if (typeof slot === 'string') return slot;
  const entries = exclude === undefined ? slot : slot.filter((n) => n !== exclude);
  const src = entries.length ? entries : slot;
  return src[Math.floor(Math.random() * src.length)];
};

/** 槽位是否包含某动画名：字符串按名比，数组查成员——直接 includes 会漏掉数组槽位。 */
export const slotIncludes = (slot: EventSlot, anim: string): boolean =>
  typeof slot === 'string' ? slot === anim : slot.includes(anim);

/** 事件池（档位槽位数组）是否包含某动画名。 */
export const poolIncludes = (pool: readonly EventSlot[], anim: string): boolean =>
  pool.some((slot) => slotIncludes(slot, anim));

/** 整个 events 段是否包含某动画名。 */
export const isEventAnim = (events: Readonly<Events> | undefined, anim: string): boolean =>
  events ? Object.values(events).some((pool) => poolIncludes(pool, anim)) : false;

/** 工作状态播完（ended）后的续播决策：找到包含 current 的档位，多候选档位则返回档内下一候选
 *  （排除 current，避免连抽），让长时间状态自动轮换；单候选档位或动画不属于该池则返回 null。
 *  两端共用同一份决策，轮换行为严格一致。 */
export const nextWorkStatusAnim = (pool: readonly EventSlot[], current: string): string | null => {
  const idx = pool.findIndex((slot) => slotIncludes(slot, current));
  if (idx === -1) return null;
  const slot = pool[idx];
  if (!Array.isArray(slot) || slot.length <= 1) return null;
  return pickSlot(slot, current);
};

/** 生成 [min, max) 区间内的随机整数。 */
export const randomBetween = (min: number, max: number): number => Math.floor(min + Math.random() * (max - min));

/** 按权重在分类池中选一个分类；镜像（朝右）时排除 noMirror 分类并归一化剩余权重，池空返回 null。 */
export const pickWeightedCategory = (categories: Category[], facing: string): Category | null => {
  const cats = categories.filter((c) => c.actions.length > 0);
  if (!cats.length) return null;
  const filtered = cats.filter((c) => !(c.noMirror && facing === 'right'));
  const eligible = filtered.length ? filtered : cats;
  const totalW = eligible.reduce((s, c) => s + c.weight, 0) || 1;
  let t = Math.random() * totalW;
  for (const c of eligible) {
    t -= c.weight;
    if (t <= 0) return c;
  }
  return eligible[eligible.length - 1];
};

/** 掷骰结果类别。 */
export type RollKind = 'idle' | 'turn' | 'move' | 'action';

/** 掷骰选项。 */
export interface RollOptions {
  /** 宠物固定（pets[].fixedEnabled）：turn 与 move 两档权重按 0 算，份额自然归入 action。
   *  不做归一化——idle 的绝对概率原样不动，实现最简，idle=0 的退化配置也自然。 */
  fixed?: boolean;
}

/** 按权重掷骰：roll ∈ [0,1) → 下一个动画类别。
 *  (idle + turn + move) / 100 是这三档的占比之和，剩余概率归入 action。
 *  opts.fixed 为真时 turn / move 权重按 0 算，只可能返回 idle 或 action。
 *  两端共用本函数，随机链行为严格一致。 */
export const rollKind = (roll: number, w: Weights, opts?: RollOptions): RollKind => {
  const turn = opts?.fixed ? 0 : w.turn;
  const move = opts?.fixed ? 0 : w.move;
  const topEnd = (w.idle + turn + move) / 100;
  if (roll < w.idle / 100) return 'idle';
  if (roll < (w.idle + turn) / 100) return 'turn';
  if (roll < topEnd) return 'move';
  return 'action';
};

/** 从分类池选一个动作；无可用分类时回退 idle 池。
 *  facing 用于 noMirror 过滤，current 用于避免连续重复。 */
export const pickCategoryAction = (
  categories: Category[],
  idlePool: string[],
  facing: string,
  current: string,
): { id: string; name: string } => {
  const cat = pickWeightedCategory(categories, facing);
  if (!cat) return { id: 'FALLBACK', name: pick(idlePool, current) };
  return { id: cat.id, name: pick(cat.actions, current) };
};
