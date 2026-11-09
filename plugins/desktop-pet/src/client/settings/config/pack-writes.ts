/**
 * 设置页的写回计划：比较「加载时的快照」与「当前编辑列表」，算出哪些种类层需要写回。
 *
 * 纯函数，不发请求也不碰状态；main 不在计划里——它连同全局字段每次保存都整包写 PUT /config。
 * @module dsh-pet/src/client/settings/config/pack-writes
 */
import type { Pet } from '../../../shared/types.ts';
import type { ConfigEntry } from './read.ts';

/** 一次要写回的种类层。 */
export interface PackWrite {
  /** 条目名（= 素材根）。 */
  readonly entry: string;
  /** 该条目的全部实例；漏传一只等于删除它。 */
  readonly pets: readonly Pet[];
}

/** 提交形状的指纹：只含会被宿主持久化的字段，位置逐子字段取。 */
function fingerprint(pet: Pet): string {
  return JSON.stringify([
    pet.id,
    pet.name,
    pet.size,
    pet.sizePercent ?? '',
    pet.balanceEnabled,
    pet.whisperEnabled,
    pet.workStatusEnabled,
    pet.fixedEnabled,
    pet.display,
    pet.position.corner,
    pet.position.marginX,
    pet.position.marginY,
    pet.whisperPrompt ?? '',
  ]);
}

/**
 * 算出要写回的种类层。
 *
 * @param loaded - 加载时的条目快照。
 * @param current - 当前编辑列表（全条目拍平，每只带 `assetRoot`）。
 * @returns 有改动的种类层，顺序即条目在编辑列表里首次出现的顺序；没有改动时为空数组。
 */
export function diffPackWrites(loaded: readonly ConfigEntry[], current: readonly Pet[]): PackWrite[] {
  const groups = new Map<string, Pet[]>();
  for (const pet of current) {
    const entry = pet.assetRoot ?? '';
    // main 走 PUT /config（还要带全局字段），没有 assetRoot 的实例不属于任何层。
    if (entry === '' || entry === 'main') continue;
    const list = groups.get(entry);
    if (list) list.push(pet);
    else groups.set(entry, [pet]);
  }
  const out: PackWrite[] = [];
  for (const [entry, pets] of groups) {
    const before = loaded.find((item) => item.key === entry)?.pets ?? [];
    // 顺序也参与比较：调换顺序同样是改动，写回后读侧按数组顺序渲染。
    const unchanged =
      before.length === pets.length && before.every((pet, i) => fingerprint(pet) === fingerprint(pets[i]));
    if (!unchanged) out.push({ entry, pets });
  }
  return out;
}
