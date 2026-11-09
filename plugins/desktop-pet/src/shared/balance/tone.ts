/**
 * 进度条配色档位：阈值只此一份，两端共用。
 *
 * 独立成叶子模块是为了避开循环依赖——handlers/* 需要 quotaTone，而 view.ts 又要分发到 handlers。
 *
 * @module dsh-pet/src/shared/balance/tone
 */

/** 进度条配色档位：低于 70% 正常、70% 至 90% 预警、90% 及以上危急。 */
export type QuotaTone = 'ok' | 'warn' | 'crit';

export const QUOTA_WARN_PERCENT = 70;
export const QUOTA_CRIT_PERCENT = 90;

/** 按已用百分比取配色档位。 */
export function quotaTone(percent: number): QuotaTone {
  if (percent >= QUOTA_CRIT_PERCENT) return 'crit';
  if (percent >= QUOTA_WARN_PERCENT) return 'warn';
  return 'ok';
}
