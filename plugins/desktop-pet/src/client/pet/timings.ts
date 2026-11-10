/**
 * 宠物页面的时间常量：气泡展示时长与 /state 轮询节奏。
 * 都写成具名常量而不是散在调用点：气泡时长与动画生命周期解耦，轮询间隔决定空闲时的请求频率。
 * @module dsh-pet/src/client/pet/timings
 */

/** 余额与工作状态气泡的展示时长（ms），与动画生命周期解耦。 */
export const BUBBLE_DURATION_MS = 10 * 1000;

/** `/state` 长轮询的挂起时长（ms）：空闲时约 1 请求/秒，有变化宿主立刻返回。 */
export const STATE_WAIT_MS = 1000;

/** 老宿主或请求失败时的轮询间隔（ms）；不退避会变成忙等。 */
export const STATE_FALLBACK_MS = 1000;
