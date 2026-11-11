/**
 * 桌面宠物判定（src/host/plugin/desktop/pets.ts）的契约测试。
 *
 * 三条契约：三个取值函数每次现读配置（改完文件下一次调用就生效，没有缓存与刷新）；
 * 读不出来按「没有桌面宠物、仍要托盘」降级且不抛；判定日志含宠物数与结论。
 * 用真实临时配置文件驱动 readAllConfig，不 mock 配置层。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDesktopPets } from './plugin/desktop/pets.ts';
import type { ConfigPaths } from './config.ts';

/** 最小可用配置：整段 animations 必须合法（合并是整段替换/整段回退）。 */
const baseConfig = (display: string, trayEnabled = true) => ({
  animations: {
    idle: ['idle1'],
    turn: ['turn1'],
    drag: ['drag1'],
    clicks: ['click1'],
    moves: { default: {}, actions: [] },
  },
  animationWeights: { idle: 100, turn: 0, move: 0 },
  eventsRefreshSec: {},
  pets: [{ id: 'main', size: 200, display, position: { corner: 'bottom-right', marginX: 24, marginY: 0 } }],
  trayEnabled,
});

/** 建一套临时配置目录；返回路径、写用户层的入口与清理函数。 */
function fixture(initial: { display: string; trayEnabled?: boolean }): {
  paths: ConfigPaths;
  write: (next: { display: string; trayEnabled?: boolean }) => void;
  writeRaw: (raw: string) => void;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-desktop-pets-'));
  const paths: ConfigPaths = {
    defaultFile: join(dir, 'default.jsonc'),
    userFile: join(dir, 'main-config.jsonc'),
    petDir: join(dir, 'pet'),
  };
  writeFileSync(paths.defaultFile, JSON.stringify(baseConfig(initial.display, initial.trayEnabled)));
  return {
    paths,
    write: (next) => writeFileSync(paths.defaultFile, JSON.stringify(baseConfig(next.display, next.trayEnabled))),
    writeRaw: (raw) => writeFileSync(paths.defaultFile, raw),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** 静默 logger（被测模块只用到 info/warn，其余成员在用例里无意义）。 */
const quietLog = { info: () => {}, warn: () => {} } as unknown as Parameters<typeof createDesktopPets>[0]['log'];

describe('createDesktopPets —— 判定必须现读配置', () => {
  test('display=web：判定为无桌面宠物', () => {
    const f = fixture({ display: 'web' });
    try {
      const pets = createDesktopPets({ configPaths: f.paths, effectivePetList: () => [], log: quietLog });
      assert.equal(pets.getHasDesktopPet(), false);
    } finally {
      f.cleanup();
    }
  });

  test('createDesktopPets 之后改配置：下一次调用立刻读到新值（不需要任何刷新）', () => {
    const f = fixture({ display: 'web' });
    try {
      const pets = createDesktopPets({ configPaths: f.paths, effectivePetList: () => [], log: quietLog });
      assert.equal(pets.getHasDesktopPet(), false, '前提：创建时没有桌面宠物');

      f.write({ display: 'desktop' });
      assert.equal(pets.getHasDesktopPet(), true, '没有缓存：改完配置下一次调用就该是 true');
    } finally {
      f.cleanup();
    }
  });

  test('改回 web 同样立刻生效', () => {
    const f = fixture({ display: 'both' });
    try {
      const pets = createDesktopPets({ configPaths: f.paths, effectivePetList: () => [], log: quietLog });
      assert.equal(pets.getHasDesktopPet(), true);
      f.write({ display: 'web' });
      assert.equal(pets.getHasDesktopPet(), false);
    } finally {
      f.cleanup();
    }
  });

  test('托盘开关同样读当前值', () => {
    const f = fixture({ display: 'web', trayEnabled: true });
    try {
      const pets = createDesktopPets({ configPaths: f.paths, effectivePetList: () => [], log: quietLog });
      assert.equal(pets.getTrayOn(), true);
      f.write({ display: 'web', trayEnabled: false });
      assert.equal(pets.getTrayOn(), false);
    } finally {
      f.cleanup();
    }
  });

  test('配置读不出来：按「没有桌面宠物、仍要托盘」降级，不抛', () => {
    const f = fixture({ display: 'desktop' });
    try {
      const pets = createDesktopPets({ configPaths: f.paths, effectivePetList: () => [], log: quietLog });
      f.writeRaw('{ 这不是 JSON');
      assert.equal(pets.getHasDesktopPet(), false, '读不出来宁可不 spawn');
      assert.equal(pets.getTrayOn(), true, '保守保留托盘');
      assert.deepEqual(pets.desktopPetList(), []);
    } finally {
      f.cleanup();
    }
  });

  test('logDesktopDecision 打一行判定日志，含宠物数与结论', () => {
    const f = fixture({ display: 'desktop', trayEnabled: false });
    try {
      const lines: string[] = [];
      const log = { info: (line: string) => lines.push(line), warn: () => {} } as unknown as Parameters<
        typeof createDesktopPets
      >[0]['log'];
      const pets = createDesktopPets({ configPaths: f.paths, effectivePetList: () => [], log });
      assert.equal(lines.length, 1, '装配时先打一行');
      pets.logDesktopDecision();
      assert.equal(lines.length, 2);
      const line = lines[1];
      assert.ok(line.includes('桌面可见=1（main）'), line);
      assert.ok(line.includes('hasDesktopPet=true'), line);
      assert.ok(line.includes('tray=false'), line);
    } finally {
      f.cleanup();
    }
  });
});
