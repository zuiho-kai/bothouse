/**
 * bothouse 接入（bothouse fork 新增）：`bothouse pet run` 起桌宠时经环境变量交出一个本机接口，
 * 右键菜单里跟 AI 有关的几项改走它，不再用桌宠自己的模型、余额服务商和本地待办。
 *
 *   BOTHOUSE_PET_API    `bothouse pet run` 开的本机接口（http://127.0.0.1:<port>）
 *   BOTHOUSE_PET_TOKEN  该接口的 Bearer 令牌
 *   BOTHOUSE_ADMIN_URL  bothouse 管理页（「打开 AI 设置」的去向，见 standalone/context.ts）
 *
 * 没有 BOTHOUSE_PET_API 时 bothouse() 返回 undefined，各调用点照上游原样运行。
 * 接口契约在 bridge/cmd/cc-connect/pet_api.go。
 * @module dsh-pet/src/host/bothouse
 */
import type { BalanceResult } from './balance/types.ts';
import type { TodoRecord } from './todo/types.ts';

/** 失败结论：与上游生成函数同一个 reason 联合体，路由可原样透出。 */
type Fail = { ok: false; reason: 'generate-error'; message: string };
/** 成功结论：与上游生成结果同形（角色的话不带配图和动作，字段留空）。 */
type Said = { ok: true; text: string; image?: string; action?: string };

export interface BothouseBackend {
  /** 对话：把这句话交给绑定的角色，等它这一轮的回话。 */
  chat(text: string, petId?: string): Promise<Said | Fail>;
  /** 碎碎念：绑定角色自己最近说过的一句（没有就是小日子里的一行）。 */
  whisper(petId?: string): Promise<Said | Fail>;
  /** 余额：bothouse 的用量（今天 / 本月），custom 形态。 */
  balance(): Promise<BalanceResult>;
  /** 待办：任务板上没收口的活，只读。 */
  todos: BoardTodos;
  /** 外形：当前绑定桌宠的角色 key（没有绑定或取不到时 undefined），2 秒内缓存。 */
  skinRole(petId?: string): Promise<string | undefined>;
  /** 外形：角色 key 加上它在插件页选的、已下载的形象包目录（#609；没有为 undefined），与 skinRole 同一份缓存。 */
  skinLook(petId?: string): Promise<SkinLook>;
}

/** 一只桌宠该穿什么：角色，以及该角色选了且已下载的形象包目录。 */
export interface SkinLook {
  role?: string;
  packDir?: string;
}

/** 与 TodoStore 同形（路由与提醒循环只用这几个方法）；写操作一律拒绝：任务板在 bothouse 里改。 */
export interface BoardTodos {
  /** 恒为 true：面板据此藏掉写入口。 */
  readonly readOnly: true;
  list(): Promise<TodoRecord[]>;
  create(input: { text: string; dueAt: number | null }): Promise<TodoRecord>;
  update(id: string, patch: unknown): Promise<TodoRecord | null>;
  remove(id: string): Promise<number>;
  markReminded(id: string, at: number): Promise<void>;
}

let cached: BothouseBackend | null | undefined;

const petQuery = (petId: string | undefined): string => (petId ? '?pet=' + encodeURIComponent(petId) : '');

/** 读环境变量建一次；不在 bothouse 下运行时返回 undefined。 */
export function bothouse(): BothouseBackend | undefined {
  if (cached === undefined) cached = create(process.env.BOTHOUSE_PET_API, process.env.BOTHOUSE_PET_TOKEN);
  return cached ?? undefined;
}

function create(base: string | undefined, token: string | undefined): BothouseBackend | null {
  if (!base) return null;
  const call = async (method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<unknown> => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.ok === false) {
      throw new Error(typeof data.message === 'string' && data.message ? data.message : `bothouse HTTP ${res.status}`);
    }
    return data;
  };
  const say = async (path: string, body?: unknown, timeoutMs?: number): Promise<Said | Fail> => {
    try {
      const data = (await call(body === undefined ? 'GET' : 'POST', path, body, timeoutMs)) as { text?: unknown };
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text) return { ok: false as const, reason: 'generate-error' as const, message: '角色没有说话' };
      return { ok: true, text };
    } catch (e) {
      return {
        ok: false as const,
        reason: 'generate-error' as const,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  };
  const readOnly = (): never => {
    throw new Error('待办来自 bothouse 任务板，请在任务板里改');
  };
  const skins = new Map<string, { at: number; value: SkinLook }>();
  const skinLook = async (petId?: string): Promise<SkinLook> => {
    const key = petId ?? '';
    const hit = skins.get(key);
    if (hit && Date.now() - hit.at < 2_000) return hit.value;
    let value: SkinLook = hit?.value ?? {};
    try {
      // bothouse fork：?pet=<素材根> 问这只宠物的角色（一个角色一只桌宠，#549）；packDir 是它选的形象包（#609）。
      const data = (await call('GET', '/skin' + petQuery(petId), undefined, 3_000)) as {
        role?: unknown;
        packDir?: unknown;
      };
      value = {
        role: typeof data.role === 'string' && data.role ? data.role : undefined,
        packDir: typeof data.packDir === 'string' && data.packDir ? data.packDir : undefined,
      };
    } catch {
      // 取不到就沿用上一次
    }
    skins.set(key, { at: Date.now(), value });
    return value;
  };
  return {
    skinLook,
    async skinRole(petId) {
      return (await skinLook(petId)).role;
    },
    // 角色跑一轮可能要几分钟：比默认超时宽得多，超时由 bothouse 那边先回。
    // ?pet=：一个角色一只桌宠时，bothouse 按宠物找它的角色（没有就照旧用第一个绑定角色）。
    chat: (text, petId) => say('/chat' + petQuery(petId), { text }, 6 * 60_000),
    whisper: (petId) => say('/whisper' + petQuery(petId)),
    async balance() {
      try {
        const data = (await call('GET', '/balance')) as { rows?: unknown };
        const lines = Array.isArray(data.rows) ? data.rows.map(String) : [];
        return {
          ok: true,
          provider: 'bothouse',
          shape: 'custom',
          data: {
            rows: {
              tag: 'div',
              children: lines.map((text) => ({ tag: 'div' as const, text })),
            },
          },
        };
      } catch (e) {
        return {
          ok: false,
          provider: 'bothouse',
          reason: 'fetch-error',
          message: e instanceof Error ? e.message : String(e),
        } as BalanceResult;
      }
    },
    todos: {
      readOnly: true,
      async list() {
        const data = (await call('GET', '/todos')) as { items?: unknown };
        const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
        const now = Date.now();
        return items.map((it) => ({
          id: 'b' + String(it.id ?? ''),
          text: String(it.text ?? ''),
          dueAt: null,
          done: false,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          lastRemindedAt: null,
        }));
      },
      create: readOnly,
      update: readOnly,
      remove: readOnly,
      async markReminded() {},
    },
  };
}
