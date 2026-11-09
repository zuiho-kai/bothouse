/**
 * 桌面 Helper 的下载进度上报：把下载片段写进轮询快照，超时后自动清空。
 *
 * 不发起下载，只转发进度。
 * 依赖由 apply 显式传入（见输入类型），模块内不读全局、不建单例。
 * @module dsh-pet/src/host/plugin/download-report
 */
import { TASK_TEXT_MAX, type HostWorkStatusState } from '../work-status.ts';
import type { WorkStatusBridge } from './work-status-bridge.ts';
import type { HostSetup } from './setup.ts';

/** 下载进度上报的输入：装配期对象与更早的工厂。 */
export type DownloadReportInput = {} & Pick<HostSetup, 'EXTERNAL_WORK_SESSION'> &
  Pick<HostSetup, 'nextExternalWorkSeq'> &
  Pick<WorkStatusBridge, 'publishWorkStatus'> &
  Pick<HostSetup, 'workStatus'>;

/**
 * 创建下载进度上报。
 */
export function createDownloadReport(deps: DownloadReportInput) {
  const { EXTERNAL_WORK_SESSION, nextExternalWorkSeq, publishWorkStatus, workStatus } = deps;
  /** Electron 下载日志的收尾槽位保留时长（ms）：够看清「就绪 / 失败」，又不让这条日志一直盖住
   *  随后真实的工作状态（终态档在渲染端本来也会 10s 自动收起气泡）。 */
  const DOWNLOAD_SLOT_CLEAR_MS = 12 * 1000;

  let downloadSlotTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 写一条 Electron 下载日志进工作状态：桌面版用户没有控制台，这是唯一能看到「后台在下什么」的地方。
   * 借外部写入槽 `api`（不新增 section）；先 setState 再 setTask（条目不存在时 setTask 直接返回 false），
   * seq 必须递增（同档位且 seq 未更新时 setState 短路），文案按 TASK_TEXT_MAX 截断。
   */
  const reportDownload = (text: string, state: HostWorkStatusState, terminal = false): void => {
    const points = Array.from(text);
    const task = points.length > TASK_TEXT_MAX ? `${points.slice(0, TASK_TEXT_MAX).join('')}…` : text;
    workStatus.setState(EXTERNAL_WORK_SESSION, state, nextExternalWorkSeq());
    workStatus.setTask(EXTERNAL_WORK_SESSION, task);
    publishWorkStatus();
    if (!terminal) return;
    if (downloadSlotTimer !== null) clearTimeout(downloadSlotTimer);
    downloadSlotTimer = setTimeout(() => {
      downloadSlotTimer = null;
      if (workStatus.clear(EXTERNAL_WORK_SESSION)) publishWorkStatus();
    }, DOWNLOAD_SLOT_CLEAR_MS);
    downloadSlotTimer.unref?.(); // 别把这个定时器钉进宿主的事件循环（退出时不该等它）
  };

  /** 停掉挂起的清槽定时器（插件卸载时调用）。 */
  const stopDownloadSlotTimer = (): void => {
    if (downloadSlotTimer !== null) {
      clearTimeout(downloadSlotTimer);
      downloadSlotTimer = null;
    }
  };
  return { reportDownload, stopDownloadSlotTimer };
}
/** 下载进度上报的产出（供下游工厂按需 Pick）。 */
export type DownloadReport = ReturnType<typeof createDownloadReport>;
