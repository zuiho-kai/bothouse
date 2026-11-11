/**
 * 桌面 Helper 的「宿主没了就自己退」纯判定。
 *
 * Helper 的 stdout/stderr 是宿主给的管道，宿主一退出读端就消失，下一次写拿到 EPIPE；
 * 未挂监听的流错误会成为未捕获异常，而 Electron 的默认处理器只弹模态框、不退出。
 * 这里只放判定（不 require electron），主进程侧负责挂监听、起轮询与退出。
 * @module dsh-pet/runtime/electron-helper/host-liveness
 */

'use strict';

/** 宿主存活探测间隔（ms）：宿主没了最多 2s 收敛，代价只是每 2s 一次 kill(pid, 0) */
const HOST_POLL_MS = 2000;

/**
 * 解析宿主 PID（DSH_PET_HOST_PID，宿主 spawn 时注入）。
 * 非法或未设返回 0，调用方据此不做探测——宁可留着一个桌宠等人来关，也不误退。
 */
function parseHostPid(raw) {
  const pid = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(pid) && pid > 0 ? pid : 0;
}

/**
 * 宿主进程是否确定已经不在了。
 *
 * `kill(pid, 0)` 只做存在性检查；只有 ESRCH 判「没了」，EPERM 等一律当存活，
 * pid 非法同样返回 false：这条判定必须宁可不退。
 *
 * @param hostPid - 宿主 PID（parseHostPid 的产物）。
 * @param kill - 可注入，便于单测。
 */
function hostIsGone(hostPid, kill = (pid, signal) => process.kill(pid, signal)) {
  if (!(hostPid > 0)) return false;
  try {
    kill(hostPid, 0);
    return false;
  } catch (error) {
    return Boolean(error) && error.code === 'ESRCH';
  }
}

/** 这次流错误是不是「管道对端没了」：EPIPE 与 ERR_STREAM_DESTROYED 都等于宿主已死。 */
function isBrokenPipeError(error) {
  const code = error && error.code;
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED';
}

module.exports = { HOST_POLL_MS, parseHostPid, hostIsGone, isBrokenPipeError };
