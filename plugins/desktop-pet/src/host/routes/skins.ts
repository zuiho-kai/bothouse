/**
 * 形象（bothouse fork 新增）：GET /skins 列内置和推荐形象；POST /skins/select 换形象（空 id = 跟绑定角色走）；
 * POST /skins/install 装推荐形象（下载完才返回）。选择和安装都在 ../skins.ts。
 * @module dsh-pet/src/host/routes/skins
 */
import { chooseSkin, installSkin, listSkins } from '../skins.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';

function readId(body: string | undefined): string | undefined {
  try {
    const v = (JSON.parse(body ?? '') as { id?: unknown }).id;
    return typeof v === 'string' ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

export async function handleSkinRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { body, method, rest } = input;
  if (rest === 'skins') {
    if (method !== 'GET') return methodNotAllowed();
    return okResult({ ok: true, ...(await listSkins()) });
  }
  if (rest === 'skins/select') {
    if (method !== 'POST') return methodNotAllowed();
    const id = readId(body);
    if (id === undefined) return invalidJson();
    const r = await chooseSkin(id);
    if (!r.ok) return failResult('bad-request', r.message);
    deps.log.info('[dsh-pet] 换形象 ' + (id || '跟绑定角色'));
    return okResult({ ok: true });
  }
  if (rest === 'skins/install') {
    if (method !== 'POST') return methodNotAllowed();
    const id = readId(body);
    if (id === undefined) return invalidJson();
    try {
      await installSkin(id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      deps.log.warn('[dsh-pet] 装推荐形象失败 ' + id + ' ' + message);
      return failResult('internal-error', message);
    }
    deps.log.info('[dsh-pet] 装好推荐形象 ' + id);
    return okResult({ ok: true });
  }
  return undefined;
}
