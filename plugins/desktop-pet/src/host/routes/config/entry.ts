/**
 * 整条目写回（POST /pet-config）：把一个「种类」的全部实例写回它自己的配置文件。
 *
 * 补的是两个既有写端点之间的空档：PUT /config 只写用户主配置，POST /pet-display 只改单只的
 * display。写入语义与这两条一致——白名单重建 + 磁盘原值透传 + 写后广播并重启 Helper。
 * 不碰全局字段（只归 main 层），也不改条目级的动画池与人设。
 * @module dsh-pet/src/host/routes/config/entry
 */
import { isValidPetId, readAllConfig, saveUserConfig } from '../../config.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { type RouteResult } from '../../http.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
import { resolveConfigLayer } from './layer.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from '../result.ts';

/** main 条目连同全局字段走 PUT /config，本端点只收「种类」层。 */
const MAIN_ENTRY = 'main';

/** 实例数组非法时的统一文案：saveUserConfig 只回 null，细节必须在这里讲清。 */
const INVALID_PETS =
  'pets 非法：必须是该种类的全部实例（至少 1 只），每只 id 唯一，size / balanceEnabled / display / position 齐全合法';

/**
 * 找出与其它条目冲突的实例 id。
 *
 * 合并后 id 跨条目全局唯一，重复的实例会被静默跳过（只告警一次）；不在写盘前拦住，
 * 用户看到的是「保存成功、宠物消失」。
 *
 * @param deps - 路由层依赖（路径集）。
 * @param entry - 本次要写的条目；它自己的旧 id 不算冲突。
 * @param pets - 已过白名单的实例数组。
 * @returns 冲突描述列表；空数组表示没有冲突。
 */
function conflictingIds(deps: PetRouteDeps, entry: string, pets: readonly Record<string, unknown>[]): string[] {
  const merged = readAllConfig(deps.configPaths);
  const taken = new Map<string, string>();
  for (const [key, conf] of Object.entries(merged)) {
    if (key === entry) continue;
    const list = Array.isArray(conf?.pets) ? (conf.pets as Record<string, unknown>[]) : [];
    for (const pet of list) taken.set(String(pet.id), key);
  }
  const out: string[] = [];
  for (const pet of pets) {
    const id = String(pet.id);
    const owner = taken.get(id);
    if (owner !== undefined) out.push(`${id}（已被「${owner}」占用）`);
  }
  return out;
}

/**
 * 写回一个种类层的全部实例，并返回写后的成品聚合。
 *
 * 失败一律 200 + 失败实体：缺 entry / main 条目 / 实例非法 / id 冲突 / 种类不存在都是业务结论；
 * 方法不对与 JSON 坏了发生在业务之前，由协议构造器给真实状态码。
 *
 * @param deps - 路由层依赖（路径、轮询快照、重启意图、占用锁）。
 * @param input - 已解析的请求（方法、请求体）。
 * @returns 写后的成品聚合（与 GET /config 同一份），或失败实体。
 */
export async function savePetLayer(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult> {
  if (input.method !== 'POST') return methodNotAllowed();
  let payload: { entry?: unknown; pets?: unknown };
  try {
    payload = JSON.parse(input.body ?? '') as { entry?: unknown; pets?: unknown };
  } catch {
    return invalidJson();
  }
  const entry = typeof payload.entry === 'string' ? payload.entry.trim() : '';
  if (!entry) return failResult('bad-request', 'entry 必填：要写哪个种类（pet/<名>-config.json 的文件名前缀）');
  // 先挡非法字符再查文件：entry 会被拼成路径片段，不能让配置值逃出 pet/ 目录。
  if (!isValidPetId(entry)) return failResult('bad-request', `entry 不能当路径片段用：${entry}`);
  if (entry === MAIN_ENTRY) return failResult('bad-request', 'main 条目请用 PUT /config：它还要带全局字段');
  const pets = payload.pets;
  if (!Array.isArray(pets) || pets.length === 0) return failResult('bad-request', INVALID_PETS);
  const resolved = resolveConfigLayer(deps, entry);
  if (!resolved.ok) return failResult('unknown-entry', `没有这个种类：${entry}`);
  const layer = resolved.layer;
  // 整段替换语义：白名单重建的是整个 pets 数组，漏传一只就等于把它删掉。
  const clean = saveUserConfig({ pets }, layer.existing);
  if (!clean) return failResult('bad-request', INVALID_PETS);
  const instances = clean.pets as Record<string, unknown>[];
  let conflicts: string[];
  try {
    conflicts = conflictingIds(deps, entry, instances);
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
  if (conflicts.length > 0) return failResult('bad-request', '宠物 id 与其它种类冲突：' + conflicts.join('、'));
  try {
    await mkdir(layer.dir, { recursive: true });
    await writeFile(layer.path, JSON.stringify(clean, null, 2), 'utf8');
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
  // 配置变更信号：只在写盘成功之后，否则失败时浏览器会白重拉一次 /config。
  deps.state.writeSection('config', {});
  // 隐藏即用户接管：与 POST /pet-display 同口径撤销占用，避免宠物被锁到 TTL 到点（issue #122）。
  for (const pet of instances) {
    if (pet.display === 'none') deps.lock.release({ petId: String(pet.id), force: true });
  }
  // 不 await：发起者可能就是即将被这次重载换掉的桌面 Helper。
  void deps.requestRestart();
  return okResult(readAllConfig(deps.configPaths));
}
