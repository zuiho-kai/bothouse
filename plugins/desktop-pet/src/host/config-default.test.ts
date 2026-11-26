/** 包内默认配置的字体必须与共享字体清单保持一致：写错会让每次启动都走「非法配置 → 回退默认」。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { DEFAULT_FONT, FONT_PRESETS } from '../shared/fonts.ts';
import { readJsonc } from './config/jsonc.ts';
import { fontValid } from './config/validate.ts';

test('内置默认配置的 font 段是合法预设且与 DEFAULT_FONT 一致', () => {
  const path = fileURLToPath(new URL('../../assets/config.jsonc', import.meta.url));
  const raw = readJsonc(path);
  assert.ok(raw, '内置默认配置必须能解析');
  const font = raw.font as Record<string, unknown>;
  assert.ok(font && typeof font === 'object', '内置默认配置必须有 font 段');
  assert.ok(
    FONT_PRESETS.some((preset) => preset.id === font.family),
    `font.family 必须在预设白名单内，实得 ${String(font.family)}`,
  );
  assert.deepEqual(font, DEFAULT_FONT);
});

test('升级前存的 candy 仍是合法 font 段，并改认现在的内置字体', () => {
  const font = { family: 'candy', size: 30, followPet: false };
  assert.equal(fontValid(font), true);
  assert.deepEqual(font, { family: 'notoserif', size: 30, followPet: false });
});
