/**
 * 表情包池（宿主半侧）：把配置的 memes 映射（名称 → 描述）解析成可用的候选池，碎碎念与对话共用。
 *
 * 不负责目录链的推导（host/index.ts 的 memeDirsFor 决定顺序与优先级），也不碰图片字节。
 * 必须始终成立：池的顺序 = 配置里写的顺序，且只有磁盘上真实存在的图才算命中——池说「能选」，
 * /pic/memes 就必须「取得到」，否则气泡图裂。文件缺失的条目静默剔除（用户删图后不必同步改
 * 配置），配置没写的图不参与（无从得知它的描述）。纯函数 + 目录参数，便于测试。
 * 契约见 CONFIG.md 与 API.md。
 * @module dsh-pet/src/host/memes
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** 池中一张图：name = 配置键（= 文件名去扩展名），desc = 给模型看的描述。 */
export interface MemeEntry {
  name: string;
  desc: string;
}

/**
 * 从配置的 memes 映射解析出候选池。
 * @param memes - 配置的 memes 值（未配置 / 类型非法 → 空池）。
 * @param dirs - 表情包目录链（顺序即优先级；空链 → 空池）。
 * @returns 按配置里写的顺序排列的候选池（链上都没有该图、或描述为空 → 剔除）。
 */
export function readMemePool(memes: unknown, dirs: readonly string[]): MemeEntry[] {
  if (!memes || typeof memes !== 'object' || Array.isArray(memes)) return [];
  if (dirs.length === 0) return [];
  const out: MemeEntry[] = [];
  for (const [name, desc] of Object.entries(memes as Record<string, unknown>)) {
    const text = typeof desc === 'string' ? desc.trim() : '';
    if (!name || !text) continue;
    if (!dirs.some((dir) => existsSync(join(dir, name + '.png')))) continue;
    out.push({ name, desc: text });
  }
  // 不排序：顺序 = 配置里写的顺序，它是给用户用的（chatImageLimit 的「前 N 张」与交给模型的清单
  // 都跟着它），一排序用户就决定不了哪几张会被发出去。JSON.parse 保留字符串键的书写顺序（纯数字
  // 键例外，会被 JS 提到最前），所以这里读到的就是配置文件里的先后。
  return out;
}

/** 抽一张图（均匀随机）；空池返回 undefined。 */
export function pickMeme(pool: MemeEntry[], random: () => number = Math.random): MemeEntry | undefined {
  if (pool.length === 0) return undefined;
  const idx = Math.floor(random() * pool.length) % pool.length;
  return pool[idx];
}

/** 模型选图校验：只在池内命中时才认（防幻觉出池外名称），命中返回该条目。 */
export function matchMeme(pool: MemeEntry[], name: string): MemeEntry | undefined {
  const key = String(name ?? '').trim();
  return key ? pool.find((m) => m.name === key) : undefined;
}

/** 配图选择标记：`[图:名称]` 附在回复末尾（容忍全角冒号与前后空白）。 */
const IMG_TAG = /\[图[:：]\s*([^\]\n]+?)\s*\]\s*$/;

/**
 * 从模型回复里取配图（对话选图的解析半侧；纯函数，无 LLM 依赖）。
 *
 * 命中池内 → 采纳该图并把标记从正文剥离（标记不得留在用户可见文本里）；未命中（模型幻觉名称）、
 * 空池、只回标记不回正文 → 一律视为没选，正文原样保留（解析失败绝不吞掉回复）。
 */
export function extractChatImage(text: string, pool: MemeEntry[]): { text: string; image?: string } {
  const m = IMG_TAG.exec(text);
  if (!m) return { text };
  const hit = matchMeme(pool, m[1] ?? '');
  const body = text.slice(0, m.index).trim();
  if (!hit || !body) return { text };
  return { text: body, image: hit.name };
}

/** 表情包清单 → 给模型看的候选列表（一行一张：名称 + 描述）。 */
export function memeCatalog(pool: MemeEntry[]): string {
  return pool.map((m) => '- ' + m.name + '：' + m.desc).join('\n');
}

/**
 * 按「对话配图张数上限」（配置 chatImageLimit）截断候选池。
 *
 * `limit <= 0` 或非有限数 → 原样返回（0 = 不限制）；`limit > 0` → 取池内前 limit 张，池序就是
 * 配置书写顺序，想让哪几张优先被发出去往前写即可；小数向下取整。
 * 只作用于对话选图：整张清单每条对话消息都要附，token 随张数线性增长，截断后单条消息的配图
 * 开销立刻可控；碎碎念只带抽中的那一张，不经过这里。
 */
export function limitPool(pool: MemeEntry[], limit: number): MemeEntry[] {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n <= 0) return pool;
  return pool.slice(0, n);
}
