/**
 * 形象包（#609）单元测试：读包里的动画表、挑哪一段、ffmpeg 参数、转换缓存与失败退回；
 * 外加内置清单 skins.json 的角色别名（大豆包 gjiang 认彩虹猫，同一别名只在一处）。
 *
 * 跑法：node --experimental-strip-types --test src/host/skin-pack.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ffmpegArgs, packAnimationFile, pickPackAnimation, readPackAnimations } from './skin-pack.ts';
import { stateForAnimation } from './skins.ts';

const sheet = { frameWidth: 640, frameHeight: 360, columns: 8, frameCount: 120, fps: 12 };
const anim = (id: string): Record<string, unknown> => ({
  id,
  name: id,
  sources: { webp: 'spritesheet/' + id + '.webp' },
  spritesheet: sheet,
});

function withPack(ids: string[], run: (packDir: string, cacheRoot: string) => Promise<void> | void): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-skinpack-test-'));
  const packDir = join(root, 'dsh1');
  mkdirSync(join(packDir, 'spritesheet'), { recursive: true });
  writeFileSync(join(packDir, 'actions.json'), JSON.stringify({ animations: ids.map(anim) }));
  for (const id of ids) writeFileSync(join(packDir, 'spritesheet', id + '.webp'), 'x');
  return Promise.resolve(run(packDir, join(root, 'cache'))).finally(() =>
    rmSync(root, { recursive: true, force: true }),
  );
}

describe('skin-pack', () => {
  test('读 actions.json 的精灵图动画，缺字段的段丢掉', () =>
    withPack(['待机呼吸休闲'], (packDir) => {
      writeFileSync(
        join(packDir, 'actions.json'),
        JSON.stringify({ animations: [anim('待机呼吸休闲'), { id: '坏的', sources: { webp: 'a.webp' } }] }),
      );
      const list = readPackAnimations(packDir);
      assert.deepEqual(
        list.map((a) => a.id),
        ['待机呼吸休闲'],
      );
      assert.equal(list[0]?.columns, 8);
    }));

  test('挑段：同名 → 同一状态 → 待机', () => {
    const anims = ['写代码', '待机呼吸休闲', '工作状态-思考冒泡'].map((id) => ({ id, name: id, sheet: id, ...sheet }));
    assert.equal(pickPackAnimation(anims, '写代码', stateForAnimation)?.id, '写代码');
    assert.equal(pickPackAnimation(anims, '原地专心玩魔方', stateForAnimation)?.id, '工作状态-思考冒泡'); // think
    assert.equal(pickPackAnimation(anims, '不认识的动作', stateForAnimation)?.id, '待机呼吸休闲');
    assert.equal(pickPackAnimation([], '写代码', stateForAnimation), undefined);
  });

  test('ffmpeg 参数按行列切帧并带透明', () => {
    const args = ffmpegArgs('/p/a.webp', { id: 'a', name: 'a', sheet: 'a', ...sheet }, '/o.webm').join(' ');
    assert.match(args, /crop=5120:5400:0:0,untile=8x15,setpts=N\/12\/TB/);
    assert.match(args, /-frames:v 120/);
    assert.match(args, /-pix_fmt yuva420p/);
  });

  test('首次转换后走缓存；同时要同一段只转一次', () =>
    withPack(['待机呼吸休闲'], async (packDir, cacheRoot) => {
      let calls = 0;
      const run = async (_file: string, args: string[]): Promise<void> => {
        calls += 1;
        writeFileSync(args[args.length - 1] as string, 'webm');
      };
      const [a, b] = await Promise.all([
        packAnimationFile(packDir, '待机呼吸休闲', cacheRoot, stateForAnimation, run),
        packAnimationFile(packDir, '待机呼吸休闲', cacheRoot, stateForAnimation, run),
      ]);
      assert.ok(a !== undefined && a === b);
      assert.equal(readFileSync(a, 'utf8'), 'webm');
      await packAnimationFile(packDir, '待机呼吸休闲', cacheRoot, stateForAnimation, run);
      assert.equal(calls, 1);
    }));

  test('转换失败返回 undefined（调用方退回内置形象），不留半个文件', () =>
    withPack(['待机呼吸休闲'], async (packDir, cacheRoot) => {
      const out = await packAnimationFile(packDir, '待机呼吸休闲', cacheRoot, stateForAnimation, async () => {
        throw new Error('ffmpeg: not found');
      });
      assert.equal(out, undefined);
    }));
});

describe('skins.json 角色别名', () => {
  const m = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', 'assets', 'roles', 'skins.json'), 'utf8'),
  ) as {
    builtin: { id: string; aliases?: string[] }[];
  };
  const owner = (alias: string): string[] =>
    m.builtin.filter((s) => (s.aliases ?? []).some((a) => a.toLowerCase() === alias.toLowerCase())).map((s) => s.id);

  test('大豆包（gjiang）认彩虹猫，不再挂在 Gemini 模型形象下', () => {
    assert.deepEqual(owner('gjiang'), ['caihongmao']);
    assert.deepEqual(owner('大豆包'), ['caihongmao']);
  });

  test('同一别名只出现在一个形象里', () => {
    const seen = new Map<string, string>();
    for (const s of m.builtin) {
      for (const a of s.aliases ?? []) {
        const k = a.toLowerCase();
        assert.equal(seen.get(k), undefined, a + ' 同时在 ' + seen.get(k) + ' 和 ' + s.id);
        seen.set(k, s.id);
      }
    }
  });
});
