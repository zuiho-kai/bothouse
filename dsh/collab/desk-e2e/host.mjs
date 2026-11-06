// 团队工作台端到端（Issue #876 E 路）用的最小 DSH 宿主。
//
// 为什么要有这个文件：collab 插件（../plugin.mjs）平时由 DSH 网页宿主加载，apply(ctx, config)
// 要的是宿主注入的 webServer / connection / logger 等能力。e2e 只需要「插件能起、路由能访问」，
// 不需要真的 DSH 运行时，所以这里用最小替身把 apply() 跑起来，再用一个 http 服务按前缀转发。
//
// 依赖解析：插件里的 dshRequire() 用 createRequire(process.argv[1])，要从 DSH 安装目录解析
// ws 与 @deepseek-ai/dsh-llm。所以起插件前把 process.argv[1] 指到 DSH 的 lib/bin.js（见
// resolveDshRequireBase），跑完还原。这是本文件唯一碰全局状态的地方，且只在进程内、可还原。
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 找到 DSH 安装里能解析 ws / dsh-llm 的入口文件（createRequire 的基准）。 */
export function resolveDshRequireBase(env = process.env) {
  if (env.DSH_REQUIRE_BASE) return env.DSH_REQUIRE_BASE;
  const bin = env.DSH_CLI || execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim();
  const real = realpathSync(bin); // /opt/homebrew/bin/dsh -> .../@deepseek-ai/dsh/lib/bin.js
  return join(dirname(real), 'bin.js');
}

const quietLogger = {
  debug() {}, info() {}, warn() {}, error() {},
};

/**
 * 起一个最小宿主。
 * @param {{dataDir: string, workspacePath: string, leadFile: string, rooms?: Array, dshMembers?: Array, logger?: object}} options
 * @returns {Promise<{url: string, close: () => Promise<void>, ctx: object, config: object}>}
 */
export async function startHost(options) {
  const routes = [];
  const upgrades = [];
  const disposers = [];
  const logger = options.logger ?? quietLogger;
  const handlers = new Map(); // 事件名 -> 回调数组，插件只 on 不用 emit，保留成对语义
  // 端口在 listen 之后才知道；#227 的 localConnection 只关心是不是本机 http，端口值不影响判定。
  let listenPort = 0;
  const ctx = {
    logger,
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === 'function') disposers.push(dispose);
      return dispose;
    },
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {
        const now = handlers.get(event) ?? [];
        handlers.set(event, now.filter(h => h !== handler));
      };
    },
    emit(event, ...args) {
      for (const handler of [...(handlers.get(event) ?? [])]) handler(...args);
    },
    webServer: {
      // 真实 webServer（dsh-host-webserver/lib/types/index.d.ts:167）有 getOrigin()；#227 起
      // localConnection 会读它来决定「本机自动接管」是否成立，桩缺这条就会在启动时抛。
      getOrigin() { return `http://127.0.0.1:${listenPort}`; },
      register(route) {
        if (route?.kind !== 'prefix' || typeof route.path !== 'string' || typeof route.handler !== 'function') {
          throw Error(`desk-e2e: 不支持的 webServer.register ${JSON.stringify(route)}`);
        }
        routes.push(route);
        return () => {
          const i = routes.indexOf(route);
          if (i >= 0) routes.splice(i, 1);
        };
      },
      registerUpgrade(route) {
        upgrades.push(route);
        return () => {
          const i = upgrades.indexOf(route);
          if (i >= 0) upgrades.splice(i, 1);
        };
      },
    },
    connection: {
      // 插件用 requestRejection(req) === undefined 判定「合法 owner」。e2e 只有一个本机访问者。
      requestRejection: () => undefined,
    },
    // 页面与 /collab/api/models 会用到；e2e 不配模型，返回空列表即可。
    llm: {
      listProviders: () => [],
      listModels: async () => [],
    },
  };

  const previousArgv1 = process.argv[1];
  process.argv[1] = resolveDshRequireBase();
  // #227 审稿第四轮 (i): 检出目录含空格时 pathname 会带 %20，交给 pathToFileURL 变成 %2520。
  const plugin = await import(new URL('../plugin.mjs', import.meta.url).href);

  const config = {
    dataDir: options.dataDir,
    workspacePath: options.workspacePath,
    leadFile: options.leadFile,
    // #876 B 路：事件尾随读 BOARD_DIR/board-events.jsonl。e2e 必须显式指向临时板目录，绝不能用线上的。
    boardDir: options.boardDir,
    fallbackLead: options.fallbackLead ?? '',
    rooms: options.rooms ?? [{ id: 1, name: 'general' }],
    dshMembers: options.dshMembers ?? [],
    maxRelay: options.maxRelay ?? 6, // 沿用插件默认（resolveConfig maxRelay 默认 6）
  };
  await plugin.apply(ctx, config);
  process.argv[1] = previousArgv1;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const route = [...routes]
      .filter(r => path === r.path || path.startsWith(`${r.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (route === undefined) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'not-found', path }));
      return;
    }
    route.handler(req, res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  listenPort = port;

  return {
    url: `http://127.0.0.1:${port}`,
    ctx,
    config,
    routes,
    async close() {
      await new Promise(resolve => server.close(resolve));
      for (const dispose of disposers.reverse()) {
        try { await dispose(); } catch { /* 关闭时忽略 */ }
      }
    },
  };
}