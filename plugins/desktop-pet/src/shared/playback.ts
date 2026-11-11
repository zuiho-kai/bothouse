/**
 * 播放状态词汇表：宿主受理（`accepted`）、渲染端可上报的四种状态，以及哪些是终态。
 * 两端共用同一份定义：宿主的状态机与浏览器侧的回执都从这取，避免各写一套字面量最后对不上。
 * 不是状态机：转移规则在宿主 `playback` 里，这里只有词汇。
 * @module dsh-pet/src/shared/playback
 */

/** 播放状态：`accepted` 由宿主写入，其余由渲染端上报。 */
export type PlaybackStatus = 'accepted' | 'playing' | 'ended' | 'failed' | 'cancelled';

/** 渲染端允许上报的状态（`accepted` 是宿主受理态，渲染端不许写）。 */
export type ReportableStatus = 'playing' | 'ended' | 'failed' | 'cancelled';

/** 终态：到达后不可再变。 */
export const TERMINAL_STATUSES: readonly PlaybackStatus[] = ['ended', 'failed', 'cancelled'];

/** 渲染端可上报的状态集合。 */
export const REPORTABLE_STATUSES: readonly ReportableStatus[] = ['playing', 'ended', 'failed', 'cancelled'];
