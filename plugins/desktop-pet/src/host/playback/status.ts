/**
 * 播放状态判定：合法状态、终态与可上报集合，以及记录保留时长。
 * 词汇表在 `shared/playback.ts`，两端共用；这里只回答「这个状态还能不能变」并带上宿主的保留策略。
 * 必须始终成立：终态集合与可上报集合互斥，终态不可再变。
 * 契约见 API.md 与 openapi.yaml。
 * @module dsh-pet/src/host/playback/status
 */
import { REPORTABLE_STATUSES, TERMINAL_STATUSES, type PlaybackStatus } from '../../shared/playback.ts';

export { REPORTABLE_STATUSES, TERMINAL_STATUSES, type PlaybackStatus };

/** 终态记录保留时长（ms）：让调用方来得及查到最后状态，之后清理。 */
export const PLAYBACK_KEEP_MS = 60 * 1000;

/** `?timeout=` 上限（ms）：挂起等待的封顶时长，防止调用方把连接挂死。
 *  取值偏保守：DSH WebServer 是否对长期持有的响应设了空闲超时尚未核实，先压在 10s。 */
export const MAX_PLAYBACK_WAIT_MS = 10 * 1000;

/** 终态判定用集合。 */
const TERMINAL = new Set<string>(TERMINAL_STATUSES);

/** 可上报判定用集合。 */
const REPORTABLE = new Set<string>(REPORTABLE_STATUSES);

/** 该状态是不是终态。 */
export const isTerminalStatus = (s: string): boolean => TERMINAL.has(s);

/** 该字符串是不是合法状态名（含 host 侧的 accepted）——`?wait=` 的合法性校验用它。 */
export const isPlaybackStatus = (s: string): boolean => s === 'accepted' || REPORTABLE.has(s);

/** 该状态是否允许渲染端上报。 */
export const isReportableStatus = (s: string): boolean => REPORTABLE.has(s);
