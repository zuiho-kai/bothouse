/**
 * 动作指令：/anim 点播动画、/position 与 /throw 摆位抛掷、/pose 姿态读写。
 *
 * 依赖（PetRouteDeps）显式传入，模块内不读全局、不建状态。
 * @module dsh-pet/src/host/routes/motion
 */
import { readAllConfig } from '../config.ts';
import { decideAnim } from '../anim.ts';
import { decidePosition, decideThrow, positionLeafData } from '../motion-cue.ts';
import { normalizePoseInput } from '../pose.ts';
import { displayCovers } from '../surface.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';

/** 动作与位置领域：未命中返回 undefined，命中返回应答。 */
export async function handleMotionRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { configPaths, lockBlocked, playback, pose, requirePet, state, surfaceBlocked } = deps;
  const { body, method, rest, url } = input;

  // 点播动画：POST /anim?pet=，name 与 url 恰好给一个。
  //   name = 池内动画名，效果与右键「动作」完全一致（两端复用同一个菜单动作处理函数），
  //     写入 S 的 pets.<id>.anim，前端按名字换源播放（名字即文件名）；不存在的名字必须在这里拦住，
  //     否则 404 → 加载失败 → 表现为「点了没反应」。
  //   url = 第三方自带的素材完整地址，不查动画池，前端直接换源播一次、不走菜单语义；
  //     scheme 由宿主卡在 http/https（`file:` 会让桌面渲染进程读到本地任意文件）。
  // facing 可选（left / right）：给了必须合法，没给则叶子里连字段都没有——渲染端保持当前朝向。
  if (rest === 'anim') {
    if (method !== 'POST') return methodNotAllowed();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? 'null');
    } catch {
      return invalidJson();
    }
    const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    try {
      const cfg = readAllConfig(configPaths);
      const d = decideAnim({
        cfg,
        requested: String(url.searchParams.get('pet') ?? ''),
        name: o.name,
        url: o.url,
        facing: o.facing,
      });
      if (!d.ok) return failResult(d.reason, d.message);
      // 显示端对齐：不满足 → pet-not-displayed（+ 实际 display），早于锁门禁
      const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
      if (noSurface) return noSurface;
      // 占用门禁：持锁者自己的点播照放行（那是它的演出），别人一律拒
      const blocked = lockBlocked(d.petId, url.searchParams);
      if (blocked) return blocked;
      // 播放回执：受理时建记录（accepted），编号随叶子一起下发，渲染端据此上报。
      // 叶子形状：name 与 url 恰好一个（判定层保证），facing 只在显式给了时才进叶子。
      const record = playback.create(d.petId, d.url ?? d.name ?? '');
      state.writePet(d.petId, 'anim', {
        ...(d.url !== undefined ? { url: d.url } : { name: d.name }),
        playbackId: record.playbackId,
        ...(d.facing === undefined ? {} : { facing: d.facing }),
      });
      return okResult({ ok: true, playbackId: record.playbackId });
    } catch (e) {
      // 配置读取失败等（安装损坏）→ 显式失败，不静默
      return failResult('generate-error', e instanceof Error ? e.message : String(e));
    }
  }

  // 位置与抛掷：POST /position 与 /throw 两条运动指令，受理后写进 S 的对应叶子（position / throw）。
  // 位置不引入任何新运动学：mode 三选一（instant / spring / line），三条路渲染端都已具备；
  // 抛掷复用已有的 startThrow，重力/反弹/摩擦/落地/碰撞一概照旧。这里只做校验与夹取。
  // x/y 是宠物中心的归一化坐标（0~1），越界夹取并把实际生效值回给调用方。
  // 与用户拖拽撞车时渲染端静默丢弃但宿主仍回 ok:true——宿主判不了拖拽状态，那只有渲染端知道。
  if (rest === 'position' || rest === 'throw') {
    const isPosition = rest === 'position';
    if (method !== 'POST') return methodNotAllowed();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? 'null');
    } catch {
      return invalidJson();
    }
    const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    try {
      const cfg = readAllConfig(configPaths);
      const requested = String(url.searchParams.get('pet') ?? '');
      if (isPosition) {
        const d = decidePosition({
          cfg,
          requested,
          x: o.x,
          y: o.y,
          mode: o.mode,
          duration: o.duration,
        });
        if (!d.ok) return failResult(d.reason, d.message);
        const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
        if (noSurface) return noSurface;
        const blocked = lockBlocked(d.petId, url.searchParams);
        if (blocked) return blocked;
        // 叶子按模式收敛成最小形状：非 line 模式不带 duration（见 positionLeafData）
        state.writePet(d.petId, 'position', positionLeafData(d));
        // 回夹取后的实际生效值：调用方不必自己算边界，也不会误以为越界值被照单全收
        return okResult({ ok: true, x: d.x, y: d.y });
      }
      const d = decideThrow({ cfg, requested, angle: o.angle, power: o.power });
      if (!d.ok) return failResult(d.reason, d.message);
      const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
      if (noSurface) return noSurface;
      const blocked = lockBlocked(d.petId, url.searchParams);
      if (blocked) return blocked;
      state.writePet(d.petId, 'throw', { angle: d.angle, power: d.power });
      return okResult({ ok: true });
    } catch (e) {
      // 配置读取失败等（安装损坏）→ 显式失败，不静默（与 /anim 同一口径）
      return failResult('generate-error', e instanceof Error ? e.message : String(e));
    }
  }

  // 实况：GET /pose?pet= 读桌面端快照，POST /pose/report?pet= 由桌面渲染端上报（内部通道）。
  // 桌面宠物一窗一只，位置全局唯一一份，宿主快照语义干净；网页端的位置天生每个页面一份
  // （两个标签页本来就不同），塞进宿主快照必然错，所以网页端走页面内的 Cordis 只读服务
  // `petApi7340`，字段名与坐标口径与这里完全一致。
  // 上报是变化时推 + 节流，不是轮询。本端点不要求 surface：它是读端点，定义域本身只有一个面。
  if (rest === 'pose' || rest === 'pose/report') {
    const isReport = rest === 'pose/report';
    if (isReport && method !== 'POST') return methodNotAllowed();
    if (!isReport && method !== 'GET') return methodNotAllowed();
    // 协议层错误（非法 JSON）先报：与 /anim 同一顺序
    let parsedPose: unknown;
    if (isReport) {
      try {
        parsedPose = JSON.parse(body ?? 'null');
      } catch {
        return invalidJson();
      }
    }
    try {
      const who = requirePet(url.searchParams, () => readAllConfig(configPaths));
      if (!who.ok) return who.res;
      if (isReport) {
        const p = normalizePoseInput(parsedPose);
        if (!p.ok) return failResult(p.reason, p.message);
        pose.set(who.petId, p.pose);
        return okResult({ ok: true });
      }
      // 桌面端实况只对「显示在桌面」的宠物有意义：配置上就不在桌面 → 明确不可用（附实际 display）
      const display = String(who.pet.display ?? '');
      if (!displayCovers('desktop', display)) {
        return failResult(
          'pet-not-displayed',
          who.petId + ' 的显示模式是 ' + display + '；桌面端实况只对 display 含 desktop 的宠物有',
          { display },
        );
      }
      const snap = pose.get(who.petId);
      if (snap === undefined) {
        return failResult('pose-unavailable', '还没收到过这只宠物的桌面端实况（桌面端没起来，或刚重启还没来得及上报）');
      }
      return okResult({ ok: true, petId: who.petId, ...snap });
    } catch (e) {
      // 配置读取失败等（安装损坏）→ 显式失败，不静默（与其他端点同一口径）
      return failResult('generate-error', e instanceof Error ? e.message : String(e));
    }
  }

  return undefined;
}
