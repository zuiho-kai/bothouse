/**
 * 睡觉：`POST /sleep?pet=` 让它睡下，`POST /wake?pet=` 叫醒。
 *
 * 宿主只做两件事：挑一套动画名字写进 `pets.<id>.sleep`，以及把这只宠物从自动来源里摘出去；
 * 播 start → loop → end 的时机由渲染端负责（视频播完只有它知道）。
 * 三段名字在这里定死，渲染端不再自己挑——否则两端会播到不同的一套。
 * 失败一律 HTTP 200 + 失败实体；方法错由协议构造器给真实状态码。
 * @module dsh-pet/src/host/routes/sleep
 */
import { readAllConfig } from '../config.ts';
import { pickSleepNames, pickSleepText, sleepTextsOf } from '../sleep.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, methodNotAllowed, okResult } from './result.ts';

/** 睡觉领域：未命中返回 undefined，命中返回应答。 */
export async function handleSleepRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { configPaths, lock, requirePet, sleep, state } = deps;
  const { method, rest, url } = input;
  // 两个分支各写一次与字面量的相等判断：check-openapi 按这种写法收集宿主实现的路由
  const isSleep = rest === 'sleep';
  const isWake = rest === 'wake';
  if (!isSleep && !isWake) return undefined;
  if (method !== 'POST') return methodNotAllowed();

  try {
    const who = requirePet(url.searchParams, () => readAllConfig(configPaths));
    if (!who.ok) return who.res;

    const texts = sleepTextsOf(who.conf);
    if (rest === 'wake') {
      // 叫醒永远安全：锁住时它本来就已经被锁叫醒了，这里幂等回 ok
      const changed = sleep.wake(who.petId);
      // 醒来台词：与入睡同一套口径（配置里随机挑一句，只弹气泡不换动画）
      const text = pickSleepText(texts.end);
      if (text !== undefined) state.writePet(who.petId, 'say', { text, anim: false });
      return okResult({ ok: true, sleeping: false, changed });
    }

    // 锁在睡之前：锁 = 第三方接管，并且取锁时已经把它叫醒；占用期间不允许再睡下
    if (lock.locked(who.petId)) {
      return failResult('locked', '这只桌宠正被占用，不能睡觉');
    }
    // 入睡：整套 + 段内各自随机挑一个；该条目没配睡觉动画时明确拒绝，不静默罚站。
    const names = pickSleepNames(who.conf.animations);
    if (names === null) {
      return failResult('no-sleep-animations', '这只宠物没有配置睡觉动画（animations.sleep）');
    }
    // 已经在睡：保持原套（重复调用不该把动画从头放一遍），仍回 ok 让调用方幂等重试
    const changed = sleep.enter(who.petId, names);
    // 入睡台词只在真的进入睡眠时弹一次（幂等重复调用不该重复说话）
    if (changed) {
      const text = pickSleepText(texts.start);
      if (text !== undefined) state.writePet(who.petId, 'say', { text, anim: false });
    }
    const active = sleep.setOf(who.petId) ?? names;
    return okResult({ ok: true, sleeping: true, changed, start: active.start, loop: active.loop, end: active.end });
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
}
