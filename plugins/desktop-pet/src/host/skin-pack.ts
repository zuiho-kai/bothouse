/**
 * 形象包（bothouse fork 新增，#609）：角色在插件页给桌宠选了形象包（如 hunmer/aboutme-pets 的 dsh1、claude），
 * 包已下载到本机时，这只桌宠穿这个包。
 *
 * 形象包是 WebP 精灵图（manifest.json / actions.json + spritesheet/<动画>.webp，一张图按行列铺满所有帧），
 * 桌宠只会播透明视频，所以某段动画第一次要播时用 ffmpeg 把那张图切帧、编成 VP9 透明 WebM，
 * 存进 `<用户根>/skin-packs/<包>-<目录指纹>/`，之后直接读缓存。包本身不改、不复制进仓库或安装包。
 * 找不到 ffmpeg 或转换失败时返回 undefined，调用方照旧穿内置形象。
 * @module dsh-pet/src/host/skin-pack
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { resolveAsset, resolveExisting } from './http.ts';

/** 包里的一段动画（只取转换要用的字段）。 */
export interface PackAnimation {
  id: string;
  name: string;
  /** 相对包根的精灵图 */
  sheet: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  frameCount: number;
  fps: number;
}

/** 包里最像「待机」的那段：上游动画表的 idle 就叫这个名字。 */
const IDLE_NAME = '待机呼吸休闲';

/** 单段转换的超时（ms）：180 帧 640×360 在 M 系列 Mac 上约 1 秒，留足余量；渲染端取素材超时是 10 秒。 */
const CONVERT_TIMEOUT_MS = 20_000;

const packCache = new Map<string, { at: number; anims: PackAnimation[] }>();
const converting = new Map<string, Promise<string | undefined>>();

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** 读包的动画表：actions.json 优先，没有才读 manifest.json 的 animations（与插件页 webp-sprite 解析一致）。 */
export function readPackAnimations(packDir: string): PackAnimation[] {
  let mtime = 0;
  for (const f of ['actions.json', 'manifest.json']) {
    try {
      mtime = Math.max(mtime, statSync(join(packDir, f)).mtimeMs);
    } catch {
      // 缺一个没关系
    }
  }
  const hit = packCache.get(packDir);
  if (hit && hit.at === mtime) return hit.anims;
  let list: unknown[] = [];
  for (const f of ['actions.json', 'manifest.json']) {
    try {
      const data = JSON.parse(readFileSync(join(packDir, f), 'utf8')) as { animations?: unknown };
      if (Array.isArray(data.animations)) {
        list = data.animations;
        break;
      }
    } catch {
      // 换下一个
    }
  }
  const anims: PackAnimation[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const a = raw as Record<string, unknown>;
    const sheetInfo = (typeof a.spritesheet === 'object' && a.spritesheet !== null ? a.spritesheet : a) as Record<
      string,
      unknown
    >;
    const sources = (typeof a.sources === 'object' && a.sources !== null ? a.sources : {}) as Record<string, unknown>;
    const id = typeof a.id === 'string' ? a.id : '';
    const sheet = typeof sources.webp === 'string' ? sources.webp : '';
    const anim: PackAnimation = {
      id,
      name: typeof a.name === 'string' && a.name ? a.name : id,
      sheet,
      frameWidth: num(sheetInfo.frameWidth),
      frameHeight: num(sheetInfo.frameHeight),
      columns: num(sheetInfo.columns),
      frameCount: num(sheetInfo.frameCount),
      fps: num(sheetInfo.fps),
    };
    if (!id || !sheet || !anim.frameWidth || !anim.frameHeight || !anim.columns || !anim.frameCount || !anim.fps)
      continue;
    anims.push(anim);
  }
  packCache.set(packDir, { at: mtime, anims });
  return anims;
}

/**
 * 桌宠要播的动画名 → 包里那一段：同名（id 或 name）优先；没有就按意思找同一状态的一段（stateOf，
 * 与内置形象同一套归类）；再没有就待机，最后第一段。包是空的返回 undefined。
 */
export function pickPackAnimation(
  anims: PackAnimation[],
  want: string,
  stateOf: (name: string) => string,
): PackAnimation | undefined {
  const same = anims.find((a) => a.id === want || a.name === want);
  if (same) return same;
  const state = stateOf(want);
  if (state !== 'idle') {
    const alike = anims.find((a) => stateOf(a.name) === state);
    if (alike) return alike;
  }
  return anims.find((a) => a.id === IDLE_NAME || a.name === IDLE_NAME) ?? anims[0];
}

/** 一段动画的 ffmpeg 参数：裁到整行整列 → 按行列切帧 → 定帧率 → VP9 带透明。 */
export function ffmpegArgs(sheetFile: string, anim: PackAnimation, out: string): string[] {
  const rows = Math.ceil(anim.frameCount / anim.columns);
  const w = anim.columns * anim.frameWidth;
  const h = rows * anim.frameHeight;
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    sheetFile,
    '-vf',
    `crop=${w}:${h}:0:0,untile=${anim.columns}x${rows},setpts=N/${anim.fps}/TB`,
    '-frames:v',
    String(anim.frameCount),
    '-r',
    String(anim.fps),
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuva420p',
    '-deadline',
    'realtime',
    '-cpu-used',
    '8',
    '-b:v',
    '0',
    '-crf',
    '35',
    '-f',
    'webm',
    out,
  ];
}

/** ffmpeg 可执行文件：BOTHOUSE_FFMPEG 指定的优先；桌宠从托盘/launchd 起时 PATH 可能没有 Homebrew 目录，补查常见位置。 */
function ffmpegPath(): string {
  const env = process.env.BOTHOUSE_FFMPEG;
  if (env) return env;
  for (const p of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']) if (existsSync(p)) return p;
  return 'ffmpeg';
}

type Runner = (file: string, args: string[]) => Promise<void>;

const runFfmpeg: Runner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: CONVERT_TIMEOUT_MS, windowsHide: true }, (err, _out, stderr) => {
      if (err)
        reject(
          new Error(
            String(stderr || err.message)
              .trim()
              .slice(0, 300),
          ),
        );
      else resolve();
    });
  });

/**
 * 包里某段动画的透明视频（必要时现转）；拿不到返回 undefined。
 *
 * @param packDir - 形象包目录（bothouse 交来的 packDir）。
 * @param want - 桌宠要播的动画名（不带扩展名）。
 * @param cacheRoot - 转好的视频放哪（`<用户根>/skin-packs`）。
 * @param stateOf - 动画名 → 状态（skins.ts 的 stateForAnimation）。
 * @param run - 测试替身；缺省调 ffmpeg。
 */
export async function packAnimationFile(
  packDir: string,
  want: string,
  cacheRoot: string,
  stateOf: (name: string) => string,
  run: Runner = runFfmpeg,
): Promise<string | undefined> {
  const anim = pickPackAnimation(readPackAnimations(packDir), want, stateOf);
  if (!anim) return undefined;
  const sheetFile = resolveExisting(packDir, anim.sheet);
  if (sheetFile === undefined) return undefined;
  const tag =
    basename(packDir).replace(/[^\w.-]/g, '_') + '-' + createHash('sha256').update(packDir).digest('hex').slice(0, 8);
  const dir = join(cacheRoot, tag);
  // 文件名用 id 的指纹：id 来自包里的 JSON，不直接当路径用。
  const out = resolveAsset(dir, createHash('sha256').update(anim.id).digest('hex').slice(0, 16) + '.webm');
  if (out === undefined) return undefined;
  try {
    if (statSync(out).mtimeMs >= statSync(sheetFile).mtimeMs) return out;
  } catch {
    // 还没转过
  }
  const running = converting.get(out);
  if (running) return running;
  const job = (async () => {
    mkdirSync(dir, { recursive: true });
    const part = out + '.part.webm';
    try {
      await run(ffmpegPath(), ffmpegArgs(sheetFile, anim, part));
      renameSync(part, out);
      return out;
    } catch (e) {
      rmSync(part, { force: true });
      console.warn(
        '[dsh-pet] 形象包动画转换失败 pack=' +
          packDir +
          ' anim=' +
          anim.id +
          '：' +
          (e instanceof Error ? e.message : String(e)),
      );
      return undefined;
    }
  })().finally(() => converting.delete(out));
  converting.set(out, job);
  return job;
}
