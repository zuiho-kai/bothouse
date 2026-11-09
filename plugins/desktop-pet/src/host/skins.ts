/**
 * 形象（bothouse fork 新增）：桌宠穿哪套衣服、有哪些形象可选、推荐形象怎么装。
 *
 * - 内置形象：包内 `assets/roles/<id>/`（bothouse 自家角色和工作台成员，清单见 `assets/roles/skins.json`）。
 * - 推荐形象：别人家的开源形象，包里不带文件，只在 skins.json 的 recommended 里列出；用户点了才下载到
 *   `<用户根>/skins/<id>/`，装好后和内置形象一样可选。
 * - 穿哪套：用户在右键菜单「换形象」里选过就用选的（存 `<用户根>/bothouse-skin.json`）；没选 = 跟绑定的角色走
 *   （`bothouse pet run` 的 /skin），名字按清单 aliases 认；都没有就用清单的 default。
 *
 * 一套形象目录里放：同名动画（可选，推荐形象整套上游动画就是这样）、八个状态动画
 * idle/talk/think/work/happy/sleep/drag/surprise.webm（缺的退回 idle），以及 memes/（表情图 + memes.json）。
 * @module dsh-pet/src/host/skins
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT } from './paths.ts';
import { resolveAsset, resolveExisting } from './http.ts';
import { isValidPetId } from './config/constants.ts';
import { bothouse } from './bothouse.ts';

interface SkinInfo {
  id: string;
  name: string;
  /** 菜单分组（「自家角色」「模型」），一组一个子菜单，免得一列太长出窗口 */
  group?: string;
  aliases?: string[];
}

interface RecommendedSkin {
  id: string;
  name: string;
  author: string;
  license: string;
  homepage: string;
  /** 下载清单（相对包根的 JSON：upstream/commit/files{目标相对路径: sha256}） */
  manifest: string;
}

interface SkinManifest {
  default: string;
  builtin: SkinInfo[];
  recommended: RecommendedSkin[];
}

const ROLES_DIR = join(PACKAGE_ROOT, 'assets', 'roles');

let userRoot: string | undefined;
let manifestCache: SkinManifest | undefined;
/** 当前穿的形象目录（同步读者用：表情包池、配置拍平）；resolveSkin 每次刷新。 */
let currentDir: string | undefined;
const installing = new Map<string, Promise<void>>();

/** 宿主启动时交入用户数据根（装推荐形象、存选择用）。 */
export function initSkins(root: string): void {
  userRoot = root;
}

function manifest(): SkinManifest {
  if (manifestCache) return manifestCache;
  try {
    manifestCache = JSON.parse(readFileSync(join(ROLES_DIR, 'skins.json'), 'utf8')) as SkinManifest;
  } catch {
    manifestCache = { default: '', builtin: [], recommended: [] };
  }
  return manifestCache;
}

const choiceFile = (): string | undefined => (userRoot ? join(userRoot, 'bothouse-skin.json') : undefined);
const installedRoot = (): string | undefined => (userRoot ? join(userRoot, 'skins') : undefined);

/** 用户在菜单里选的形象 id；空串 = 跟绑定角色走。 */
export function chosenSkin(): string {
  const f = choiceFile();
  if (!f || !existsSync(f)) return '';
  try {
    const v = (JSON.parse(readFileSync(f, 'utf8')) as { skin?: unknown }).skin;
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

/** 形象 id → 目录（内置优先，其次已装的推荐形象）；不存在 undefined。 */
function skinDir(id: string): string | undefined {
  if (!id || !isValidPetId(id)) return undefined;
  const builtin = resolveAsset(ROLES_DIR, id);
  if (builtin !== undefined && existsSync(join(builtin, 'idle.webm'))) return builtin;
  const root = installedRoot();
  const own = root ? resolveAsset(root, id) : undefined;
  if (own !== undefined && existsSync(join(own, '.installed'))) return own;
  return undefined;
}

/** 绑定角色 key（或工作台成员名）→ 内置形象 id：先按 id，再按 aliases（不分大小写）。 */
function skinForRole(role: string): string | undefined {
  const low = role.toLowerCase();
  for (const s of manifest().builtin) {
    if (s.id === role || (s.aliases ?? []).some((a) => a.toLowerCase() === low)) return s.id;
  }
  return undefined;
}

/**
 * 当前该穿的形象目录：用户选的 → 绑定角色 → 清单默认。
 * bothouse fork（#549，一个角色一只桌宠）：root 是宠物的素材根（main 或 bothouse 写的 `pet/<id>-config.json` 前缀）。
 * main 照旧（右键选的形象只管 main）；别的宠物按自己的角色穿：给角色选了导入形象就穿它，否则按角色认内置形象。
 */
export async function resolveSkin(root = 'main'): Promise<string | undefined> {
  const main = root === 'main';
  let dir = main ? skinDir(chosenSkin()) : undefined;
  if (dir === undefined) {
    const who = await bothouse()?.skinRole(main ? undefined : root);
    dir = who?.skin ? skinDir(who.skin) : undefined;
    const id = dir === undefined && who?.role ? skinForRole(who.role) : undefined;
    if (id) dir = skinDir(id);
  }
  dir ??= skinDir(manifest().default);
  if (main) currentDir = dir;
  return dir;
}

/** 同步读当前形象目录（上一次 resolveSkin 的结果；还没解析过就按选择/默认现算，不等绑定）。 */
export function currentSkinDir(): string | undefined {
  if (currentDir === undefined) {
    currentDir = skinDir(chosenSkin()) ?? skinDir(manifest().default);
    void resolveSkin();
  }
  return currentDir;
}

/** 当前形象的表情图：目录 + 名称 → 描述；没有表情图 undefined。 */
export function currentSkinMemes(): { dir: string; memes: Record<string, string> } | undefined {
  const base = currentSkinDir();
  if (base === undefined) return undefined;
  const dir = join(base, 'memes');
  try {
    const memes = JSON.parse(readFileSync(join(dir, 'memes.json'), 'utf8')) as Record<string, string>;
    return { dir, memes };
  } catch {
    return undefined;
  }
}

/**
 * 上游动画名 → 状态动画：形象只画了八个状态，上游 114 段动画按意思归到这八个里。
 * 规则按名字关键词，从上到下第一条命中为准；都不中就是 idle。
 */
const STATE_RULES: ReadonlyArray<[RegExp, string]> = [
  [/拖拽|悬空/, 'drag'],
  [/睡觉|小憩|瞌睡|哈欠|沉眠/, 'sleep'],
  [/吓一跳|叹气|分文不剩|袋空如洗|气急败坏|被抓住/, 'surprise'],
  [/思考|踱步张望|东张西望|魔方|下五子棋/, 'think'],
  [/忙碌点按|写代码|清点归档|轻快记录|敲击桌面/, 'work'],
  [/碎碎念|哼歌|是啊/, 'talk'],
  [/庆祝|点击回应|开心|舞|跃动|金袋叮当|钱袋满溢|放烟花|拆礼物|收红包/, 'happy'],
];

export function stateForAnimation(name: string): string {
  for (const [re, state] of STATE_RULES) if (re.test(name)) return state;
  return 'idle';
}

/** 动画文件：同名优先（整套上游动画的推荐形象），其次按意思归的状态，最后 idle。 */
export async function skinAnimationFile(fileName: string, root = 'main'): Promise<string | undefined> {
  const dir = await resolveSkin(root);
  if (dir === undefined) return undefined;
  const base = fileName.replace(/\.(webm|mov)$/i, '');
  return (
    resolveExisting(dir, base + '.webm') ??
    resolveExisting(dir, stateForAnimation(base) + '.webm') ??
    resolveExisting(dir, 'idle.webm')
  );
}

/** 菜单用的形象列表：内置 + 推荐（标明装没装、正在穿哪套）。 */
export async function listSkins(): Promise<{
  chosen: string;
  current: string;
  builtin: { id: string; name: string; group: string }[];
  recommended: { id: string; name: string; author: string; license: string; homepage: string; installed: boolean }[];
}> {
  const m = manifest();
  const dir = await resolveSkin();
  const current = dir ? dir.split(/[\\/]/).pop() ?? '' : '';
  return {
    chosen: chosenSkin(),
    current,
    builtin: m.builtin.filter((s) => skinDir(s.id) !== undefined).map((s) => ({ id: s.id, name: s.name, group: s.group ?? '' })),
    recommended: m.recommended.map((r) => ({
      id: r.id,
      name: r.name,
      author: r.author,
      license: r.license,
      homepage: r.homepage,
      installed: skinDir(r.id) !== undefined,
    })),
  };
}

/** 选形象：空串 = 跟绑定角色走。id 必须是已有（内置或已装）的形象。 */
export async function chooseSkin(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const f = choiceFile();
  if (!f) return { ok: false, message: '宿主还没初始化' };
  if (id !== '' && skinDir(id) === undefined) return { ok: false, message: '没有这个形象（推荐形象要先装）：' + id };
  mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, JSON.stringify({ skin: id }) + '\n');
  await resolveSkin();
  return { ok: true };
}

/**
 * 装推荐形象：按清单从作者仓库的固定提交下载每个文件、校验 sha256，全部对上才换进
 * `<用户根>/skins/<id>/`（先下到临时目录，失败不留半套）。同一个 id 并发点只装一次。
 */
export function installSkin(id: string): Promise<void> {
  const running = installing.get(id);
  if (running) return running;
  const job = doInstall(id).finally(() => installing.delete(id));
  installing.set(id, job);
  return job;
}

async function doInstall(id: string): Promise<void> {
  const rec = manifest().recommended.find((r) => r.id === id);
  if (!rec) throw new Error('推荐列表里没有这个形象：' + id);
  const root = installedRoot();
  if (!root) throw new Error('宿主还没初始化');
  if (!isValidPetId(id)) throw new Error('形象 id 不合法：' + id);
  const list = JSON.parse(readFileSync(join(PACKAGE_ROOT, rec.manifest), 'utf8')) as {
    upstream: string;
    commit: string;
    /** 表情图描述（名称 → 适用场景），装完写成 memes/memes.json */
    memes?: Record<string, string>;
    files: Record<string, { src: string; sha256: string }>;
  };
  const tmp = join(root, '.' + id + '.part');
  rmSync(tmp, { recursive: true, force: true });
  for (const [target, { src, sha256 }] of Object.entries(list.files)) {
    const url =
      `https://raw.githubusercontent.com/${list.upstream}/${list.commit}/` +
      src.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (createHash('sha256').update(buf).digest('hex') !== sha256) throw new Error(target + '：sha256 不对');
    const file = join(tmp, target);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, buf);
  }
  if (list.memes) {
    mkdirSync(join(tmp, 'memes'), { recursive: true });
    writeFileSync(join(tmp, 'memes', 'memes.json'), JSON.stringify(list.memes, null, 1) + '\n');
  }
  writeFileSync(join(tmp, '.installed'), JSON.stringify({ from: list.upstream, commit: list.commit }) + '\n');
  const dest = join(root, id);
  rmSync(dest, { recursive: true, force: true });
  renameSync(tmp, dest);
}
