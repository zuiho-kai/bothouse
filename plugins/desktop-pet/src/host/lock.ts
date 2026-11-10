/**
 * 宠物占用锁（host 半侧的内存独占锁）：第三方演联动时把这只宠物独占给自己。
 *
 * 负责建锁 / 续期 / 释放、懒判过期、墓碑与叶子同步；全有全无，一把锁对应一只宠物。
 * 不负责渲染端冻结：叶子里的 expiresAt 是唯一真相，前端据此自己解除静止。
 * 判定必须能脱离 HTTP 单测，所以判定全在这里，路由只做解析与应答。
 * 依赖注入的时钟与叶子写入回调（不传回调则纯逻辑，不碰 S）。
 * 始终成立：不传 lock = 现状零变化；传了编号却查不到锁必须回 lock-lost；只有用户能抢占。
 * 契约见 API.md 与 openapi.yaml。
 *
 * @module dsh-pet/src/host/lock
 */

/**
 * 占用时长与上下限（毫秒）。
 *
 * 缺省 2min：一次联动演出通常几十秒到一两分钟，调用方就算没实现续期、或者漏了一拍，也不会中途
 * 丢锁——丢了会当场解冻，是很难查的现象。上限 30min：够「一连串动作 + 中间等用户点侧栏」，
 * 更长的演出该走续期，而不是靠一个巨大的 TTL 把宠物占着。
 */
export const LOCK_DEFAULT_TTL_MS = 2 * 60 * 1000;
export const LOCK_MIN_TTL_MS = 1 * 1000;
export const LOCK_MAX_TTL_MS = 30 * 60 * 1000;

/** 锁是怎么没的：持锁者据此决定重拿还是收尾（取值语义见 openapi.yaml 的 lock-lost `cause`）。
 *  `preempted` 表示被用户抢走（拖拽 / 点击 / 隐藏 / 关闭），联动必须立刻收尾，别跟用户抢。 */
export type LockCause = 'expired' | 'released' | 'preempted' | 'unknown';

/** cause → 给人看的一句话（回执里的 message；reason 才是机器读的那个）。 */
const CAUSE_TEXT: Record<LockCause, string> = {
  expired: '占用已过期（没有及时续期）',
  released: '占用已被释放',
  preempted: '占用已被用户接管（拖拽/点击/隐藏/关闭）',
  unknown: 'lock 不是当前生效的占用编号',
};

/** 写进 `pets.<id>.lock` 的载荷（渲染端据此冻结 / 解冻）。 */
export type LockLeafData = { locked: true; expiresAt: number } | { locked: false };

/** 一条占用记录（内存态）。 */
interface LockRecord {
  /** 不透明编号（`lk-<时间36>-<自增36>`），持锁者后续所有操作都要带。 */
  lockId: string;
  /** 这一轮的时长：续期不带 ttl 时沿用它。 */
  ttl: number;
  /** 到点即视为没有（懒判，没有定时器）。 */
  expiresAt: number;
}

/** 墓碑：这把锁是怎么没的（保留到该宠物建立新锁为止，否则 cause 只能永远回 unknown）。 */
interface Tombstone {
  lockId: string;
  cause: LockCause;
}

/** 动作端点的门禁结论（5 个接口共用）。 */
export type LockGate =
  | { ok: true }
  | { ok: false; reason: 'lock-required'; message: string }
  | { ok: false; reason: 'lock-lost'; cause: LockCause; message: string };

/** 取锁 / 续期的结论。 */
export type LockAcquireDecision =
  | { ok: true; petId: string; lockId: string; expiresAt: number; renewed: boolean }
  | { ok: false; reason: 'bad-request'; message: string }
  | { ok: false; reason: 'locked'; expiresAt: number; message: string }
  | { ok: false; reason: 'lock-lost'; cause: LockCause; message: string };

/** 释放的结论（released 只表示这一次真的撤掉了一把锁，幂等空操作时为 false）。 */
export type LockReleaseDecision =
  | { ok: true; petId: string; released: boolean }
  | { ok: false; reason: 'bad-request'; message: string }
  | { ok: false; reason: 'lock-lost'; cause: LockCause; message: string };

/** ttl 合法性说明（路由与决策层共用同一条规则，免得两处走样）。 */
const TTL_TEXT = `ttl 必须是 ${LOCK_MIN_TTL_MS}~${LOCK_MAX_TTL_MS} 之间的有限数字（毫秒）`;

/**
 * ttl 规范化：缺省 / null → `fallback`；合法则原样；非法返回 null。
 *
 * 非数字 / 非有限 / 越界一律非法，不给「越界就夹取」的宽松口径：调用方写错时长应当立刻知道，
 * 而不是拿到一把比自己以为的更长或更短的锁。
 */
export function normalizeLockTtl(ttl: unknown, fallback: number): number | null {
  if (ttl === undefined || ttl === null) return fallback;
  if (typeof ttl !== 'number' || !Number.isFinite(ttl)) return null;
  if (ttl < LOCK_MIN_TTL_MS || ttl > LOCK_MAX_TTL_MS) return null;
  return ttl;
}

/** lockId 规范化：缺省 / null → 空串（= 没给，走新建那条路）；非字符串 → null（非法）。
 *  空串按「没给」处理是有意的（与 image / url 的宽松口径一致）。 */
function normalizeLockId(v: unknown): string | null {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  return v.trim();
}

/** 占用锁表（一个插件实例一个；进程内内存态，重启即空）。 */
export class LockStore {
  // 用 declare + 构造器赋值：类字段初始化器会降级出 @oxc-project/runtime 外部 helper，
  // 而它是未声明的依赖，会被 prepack 门禁拦下（同 ./state 的 PollStateStore 约定）。
  /** petId → 当前占用。 */
  declare private readonly locks: Map<string, LockRecord>;
  /** petId → 上一把锁是怎么没的（新锁建立时作废）。 */
  declare private readonly tombstones: Map<string, Tombstone>;
  /** 编号自增段（与时间戳一起构成运行内唯一编号，与 ./playback 同一套）。 */
  declare private seq: number;
  /** 取当前时刻（可注入：过期语义的单测不用真的等 30 秒）。 */
  declare private readonly now: () => number;
  /** 锁状态变化时同步叶子（建锁 / 续期 / 释放 / 过期都走它；不传则纯逻辑、不碰 S）。 */
  declare private readonly onChange: (petId: string, data: LockLeafData) => void;

  constructor(opts?: { now?: () => number; onChange?: (petId: string, data: LockLeafData) => void }) {
    this.locks = new Map();
    this.tombstones = new Map();
    this.seq = 0;
    this.now = opts?.now ?? Date.now;
    this.onChange = opts?.onChange ?? ((): void => {});
  }

  /**
   * 当前占用（懒判过期）。到点即视为没有：清记录、记墓碑、同步一次叶子。
   *
   * 读方法带一次副作用是有意的：叶子是渲染端唯一能看到的信号，而宿主这一侧没有任何定时器——
   * 任一动作端点或内部来源调一次本方法，过期的锁就会被清掉并如实写进 S；即便一次都没人调，
   * 渲染端也会按叶子里的 expiresAt 自己解除静止。
   */
  current(petId: string): LockRecord | null {
    const rec = this.locks.get(petId);
    if (rec === undefined) return null;
    if (this.now() < rec.expiresAt) return rec;
    this.drop(petId, rec, 'expired');
    return null;
  }

  /** 这只宠物此刻是否被占用（宿主内部自动来源用它决定跳过；同样懒判过期）。 */
  locked(petId: string): boolean {
    return this.current(petId) !== null;
  }

  /**
   * 当前是否有任意宠物被占用（测试 / 观测用，同 ./state 的 waiterCount）。
   *
   * 生产路径上没有人调它：占用期间要挡的两个全局段（sections.balance / sections.workStatus）是
   * 所有宠物共用一份，宿主跳过写入会连带静音别的宠物，所以那两处改由渲染端按宠物自己忽略。
   */
  anyLocked(): boolean {
    for (const petId of [...this.locks.keys()]) {
      if (this.current(petId) !== null) return true;
    }
    return false;
  }

  /**
   * 动作端点的门禁（/anim、/broadcast、/position、/throw、/bubble/clear 共用）。
   *
   * 无锁时按有没有带编号分两条：没带 → 放行（没有占用的常态下，既有调用方一个字都不用改）；
   * 带了编号却查不到锁 → lock-lost。带了编号就说明调用方以为自己还持有，这时放行等于把「你把锁
   * 丢了」悄悄抹掉，它会以为演出还在继续。cause 从墓碑里取，从没建过锁就是 unknown。
   */
  gate(petId: string, provided: string): LockGate {
    const rec = this.current(petId);
    if (rec !== null) {
      if (provided && provided === rec.lockId) return { ok: true };
      if (!provided) {
        return { ok: false, reason: 'lock-required', message: '这只桌宠正被占用，必须带 lock=<lockId>' };
      }
      return { ok: false, reason: 'lock-lost', cause: 'unknown', message: CAUSE_TEXT.unknown };
    }
    // 无锁：没带编号照旧放行；带了编号 → 明确告诉他锁已经不在了
    if (!provided) return { ok: true };
    const cause = this.causeOf(petId, provided);
    return { ok: false, reason: 'lock-lost', cause, message: CAUSE_TEXT[cause] };
  }

  /**
   * 取锁 / 续期（二合一：`lockId` 给了就是续期，没给就是新建；真值表见 openapi.yaml）。
   *
   * 「有 id + 当前无锁」一律报错，不复活：过期 / 被释放 / 被抢占之后拿旧编号来续期，不能借这条路
   * 把锁重新建起来——否则「我丢了锁」这件事会被悄悄抹掉，持锁者会以为演出还在继续。
   */
  acquire(args: { petId: string; lockId?: unknown; ttl?: unknown }): LockAcquireDecision {
    const { petId } = args;
    const renewId = normalizeLockId(args.lockId);
    if (renewId === null) return { ok: false, reason: 'bad-request', message: 'lockId 必须是字符串' };
    const rec = this.current(petId);

    if (renewId) {
      if (rec === null || rec.lockId !== renewId) {
        // 没有锁 → 去墓碑里问「它当初是怎么没的」；有锁但不是它 → 就是认不出这个编号
        const cause: LockCause = rec === null ? this.causeOf(petId, renewId) : 'unknown';
        return { ok: false, reason: 'lock-lost', cause, message: CAUSE_TEXT[cause] };
      }
      const ttl = normalizeLockTtl(args.ttl, rec.ttl);
      if (ttl === null) return { ok: false, reason: 'bad-request', message: TTL_TEXT };
      rec.ttl = ttl;
      rec.expiresAt = this.now() + ttl;
      this.onChange(petId, { locked: true, expiresAt: rec.expiresAt });
      return { ok: true, petId, lockId: rec.lockId, expiresAt: rec.expiresAt, renewed: true };
    }

    if (rec !== null) {
      return { ok: false, reason: 'locked', expiresAt: rec.expiresAt, message: '这只桌宠已被占用' };
    }
    const ttl = normalizeLockTtl(args.ttl, LOCK_DEFAULT_TTL_MS);
    if (ttl === null) return { ok: false, reason: 'bad-request', message: TTL_TEXT };
    const record: LockRecord = { lockId: this.newId(), ttl, expiresAt: this.now() + ttl };
    this.locks.set(petId, record);
    this.tombstones.delete(petId); // 新锁建立 → 旧墓碑作废（旧编号此后一律 unknown）
    this.onChange(petId, { locked: true, expiresAt: record.expiresAt });
    return { ok: true, petId, lockId: record.lockId, expiresAt: record.expiresAt, renewed: false };
  }

  /**
   * 释放。两种形态二选一：`lockId` = 持锁者收工（cause: released），
   * `force: true` = 渲染端在用户拖拽 / 点击 / 隐藏 / 关闭时调（cause: preempted）。
   *
   * 幂等：当前没有锁时回 ok（released: false）——「让锁消失」这个意图在空状态下已经成立；
   * 但有锁而 lockId 不匹配时必须报错（不许误放别人的锁），那是唯一一条释放也会失败的路。
   * force 只认严格 true：宽松口径会把误传当真，代价是撤掉别人的锁。
   */
  release(args: { petId: string; lockId?: unknown; force?: unknown }): LockReleaseDecision {
    const { petId } = args;
    const force = args.force === true;
    const releaseId = normalizeLockId(args.lockId);
    if (releaseId === null) return { ok: false, reason: 'bad-request', message: 'lockId 必须是字符串' };
    if (force && releaseId) {
      return { ok: false, reason: 'bad-request', message: 'lockId 与 force 只能给一个' };
    }
    if (!force && !releaseId) {
      return { ok: false, reason: 'bad-request', message: 'lockId 或 force 必须给一个' };
    }
    const rec = this.current(petId);
    if (rec === null) return { ok: true, petId, released: false }; // 幂等：没有锁可撤
    if (!force && rec.lockId !== releaseId) {
      return { ok: false, reason: 'lock-lost', cause: 'unknown', message: CAUSE_TEXT.unknown };
    }
    this.drop(petId, rec, force ? 'preempted' : 'released');
    return { ok: true, petId, released: true };
  }

  /** 撤掉全部占用（插件卸载路径）：不这样做的话，渲染端要等 TTL 到点才解除静止。 */
  releaseAll(): void {
    for (const petId of [...this.locks.keys()]) {
      const rec = this.locks.get(petId);
      if (rec !== undefined) this.drop(petId, rec, 'released');
    }
  }

  /** 撤锁并记墓碑（唯一改状态的出口：释放 / 抢占 / 过期都走它，保证叶子与墓碑不漏写）。 */
  private drop(petId: string, rec: LockRecord, cause: LockCause): void {
    this.locks.delete(petId);
    this.tombstones.set(petId, { lockId: rec.lockId, cause });
    this.onChange(petId, { locked: false });
  }

  /** 墓碑查询：编号对得上就回它当初的 cause，否则 unknown（拿错编号 / 从来没有过）。 */
  private causeOf(petId: string, lockId: string): LockCause {
    const stone = this.tombstones.get(petId);
    return stone !== undefined && stone.lockId === lockId ? stone.cause : 'unknown';
  }

  /** 新编号：`lk-<时间36>-<自增36>`（与 ./playback 的 playbackId 同一套，只保证一次运行内唯一）。 */
  private newId(): string {
    return 'lk-' + this.now().toString(36) + '-' + (++this.seq).toString(36);
  }
}
