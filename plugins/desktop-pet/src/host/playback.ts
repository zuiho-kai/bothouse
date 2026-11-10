/**
 * 播放回执的公开出口：状态判定、路径解析与记录表。
 *
 * 只做再导出，逻辑分居 ./playback/。
 * 必须始终成立：记录只由渲染端上报推进，宿主不猜播放结果。
 * @module dsh-pet/src/host/playback
 */
export {
  MAX_PLAYBACK_WAIT_MS,
  PLAYBACK_KEEP_MS,
  REPORTABLE_STATUSES,
  TERMINAL_STATUSES,
  isPlaybackStatus,
  isReportableStatus,
  isTerminalStatus,
} from './playback/status.ts';
export type { PlaybackStatus } from './playback/status.ts';
export { parsePlaybackPath, parseWaitQuery } from './playback/parse.ts';
export type { WaitParse } from './playback/parse.ts';
export { PlaybackStore } from './playback/store.ts';
export type { PlaybackRecord, ReportOutcome, WaitArgs } from './playback/store.ts';
