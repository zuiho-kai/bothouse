/**
 * 单段 HTTP Range 解析：给 bridge 的素材应答用。
 *
 * 与宿主侧 src/host/http.ts 的 parseRange 同语义；两侧运行环境与构建边界不同（Node http 与 Electron
 * protocol.handle），各自实现一份。
 * @module dsh-pet/runtime/electron-helper/range
 */
'use strict';

/**
 * 解析单段 Range 头。
 *
 * 只接受 `bytes=<start>-<end>`、`bytes=<start>-`、`bytes=-<suffix>` 三种单段形式；多段、单位不符、
 * 语法非法返回 null（回整份），起点越界或 start > end 返回 'unsatisfiable'（回 416）。
 * @param header - 请求头原值，可能为 null。
 * @param totalBytes - 文件总字节数；非正数时一律忽略 Range。
 * @returns 闭区间 `{ start, end }`、'unsatisfiable' 或 null。
 */
function parseRange(header, totalBytes) {
  if (!header || totalBytes <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return null;
  const startText = match[1];
  const endText = match[2];
  if (startText === '' && endText === '') return null;

  if (startText === '') {
    // 后缀形式：bytes=-N，取末尾 N 字节
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, totalBytes - suffixLength), end: totalBytes - 1 };
  }

  const start = Number(startText);
  const end = endText === '' ? totalBytes - 1 : Number(endText);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= totalBytes) return 'unsatisfiable';
  return { start, end: Math.min(end, totalBytes - 1) };
}

module.exports = { parseRange };
