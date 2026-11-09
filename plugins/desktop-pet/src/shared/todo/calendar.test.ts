/**
 * 日历格（src/shared/todo/calendar.ts）：周一为首列、补满整周、前后月标 out。
 *
 * 只覆盖纯计算；选择器的交互与渲染由手动验收。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { monthCells } from './calendar.ts';

/** 把格子写成 `YYYY-MM-DD`，断言里比日期比拼 Date 好读。 */
function days(year: number, month: number): string[] {
  return monthCells(year, month).map((cell) => {
    const d = cell.date;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  });
}

describe('monthCells —— 一个月排成几行', () => {
  test('2026 年 10 月：1 号是周四，补 3 格上月，共 5 行', () => {
    const list = days(2026, 9);
    assert.equal(list.length, 35, '应为 5 行 × 7 列');
    assert.equal(list[0], '2026-09-28', '首格应是上月最后一个周一');
    assert.equal(list[34], '2026-11-01', '末格应是下月第一个周日');
  });

  test('2026 年 8 月：跨 6 周，补满 42 格', () => {
    const list = days(2026, 7);
    assert.equal(list.length, 42, '应为 6 行 × 7 列');
    assert.equal(list[0], '2026-07-27');
    assert.equal(list[41], '2026-09-06');
  });

  test('2026 年 2 月：1 号是周日，整行补在前面', () => {
    const list = days(2026, 1);
    assert.equal(list.length, 35);
    assert.equal(list[0], '2026-01-26', '周日落在最后一列，前面补满 6 格');
  });

  test('out 只标前后月的格子', () => {
    const cells = monthCells(2026, 9);
    assert.equal(cells.filter((cell) => cell.out).length, 3 + 1, '3 格上月 + 1 格下月');
    assert.ok(
      cells.slice(3, 34).every((cell) => !cell.out),
      '本月 31 天都不该标 out',
    );
  });

  test('每一行都是整周：列数恒为 7，且首格是周一', () => {
    for (let month = 0; month < 12; month++) {
      const cells = monthCells(2026, month);
      assert.equal(cells.length % 7, 0, `${month + 1} 月不是整周`);
      assert.equal(cells[0]?.date.getDay(), 1, `${month + 1} 月首格不是周一`);
    }
  });
});
