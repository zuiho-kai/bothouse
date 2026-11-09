/**
 * 主进程装配的冒烟测试：给定一只宠物，必须真的建出窗口并加载 index.html。
 *
 * 为什么要这一条：runtime 下的模块不在类型检查里，装配错了（参数没解构、路径写错）只会表现成
 * 「桌面上什么都没有」，而按文本断言的守卫看不出这种错。这里用替身 electron 把 main.js 真跑一遍。
 * 不启动真实 Electron、不开窗口：只断言窗口对象被创建、加载的是存在的页面。
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Module from 'node:module';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

/** 替身 electron：任意未实现的方法都当空函数，避免逐个补齐。 */
function createFakeElectron(created: Array<{ loaded?: { file: string } }>): unknown {
  const noop = (): void => {};
  const makeWindow = (): unknown => {
    const win = {
      id: created.length + 1,
      loadFile: async (file: string) => {
        record.loaded = { file };
      },
      isDestroyed: () => false,
      isVisible: () => false,
      getBounds: () => ({ x: 0, y: 0, width: 924, height: 700 }),
      getContentBounds: () => ({ x: 0, y: 0, width: 640, height: 360 }),
      webContents: new Proxy({ executeJavaScript: async () => ({}) }, { get: () => noop }),
    };
    const record = win as unknown as { loaded?: { file: string } };
    created.push(record);
    return new Proxy(win, { get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : noop) });
  };
  const display = {
    id: 1,
    scaleFactor: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  };
  const plain = {
    app: {
      whenReady: () => Promise.resolve(),
      getPath: () => tmpdir(),
      getAppPath: () => process.cwd(),
      requestSingleInstanceLock: () => true,
      isPackaged: false,
      commandLine: { appendSwitch: noop },
      dock: { hide: noop },
    },
    BrowserWindow: Object.assign(
      function BrowserWindow() {
        return makeWindow();
      },
      { fromWebContents: () => null, getAllWindows: () => [] },
    ),
    Menu: { buildFromTemplate: () => ({}) },
    Tray: function Tray() {
      return new Proxy({}, { get: () => noop });
    },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    screen: {
      getPrimaryDisplay: () => display,
      getAllDisplays: () => [display],
      on: noop,
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    },
  };
  const fallback = (obj: object): unknown =>
    new Proxy(obj, { get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : noop) });
  const wrapped = Object.fromEntries(Object.entries(plain).map(([key, value]) => [key, fallback(value as object)]));
  return new Proxy(wrapped, {
    get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : fallback({})),
  });
}

test('给定一只宠物：主进程会建窗，并加载存在的 index.html', async () => {
  const created: Array<{ loaded?: { file: string } }> = [];
  const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load;
  const originalSetInterval = globalThis.setInterval;
  const originalEnv = { ...process.env };
  // 建窗后每个窗口会起两条常驻定时器：测试里换成空函数，否则进程不退出
  globalThis.setInterval = (() => 0) as unknown as typeof setInterval;
  (Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function patched(
    request: unknown,
    ...rest: unknown[]
  ) {
    if (request === 'electron') return createFakeElectron(created);
    return originalLoad.call(this, request, ...rest);
  };
  process.env.DSH_PET_PETS = JSON.stringify([{ id: 'main', size: 462 }]);
  process.env.DSH_PET_ELECTRON_PATH = process.execPath;
  delete process.env.DSH_PET_BRIDGE;
  delete process.env.DSH_PET_APP_MODE;

  try {
    require(fileURLToPath(new URL('../../runtime/electron-helper/main.js', import.meta.url)));
    // whenReady 的回调是微任务链：等一拍宏任务让它跑完
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    (Module as unknown as { _load: (...args: unknown[]) => unknown })._load = originalLoad;
    globalThis.setInterval = originalSetInterval;
    process.env = originalEnv;
  }

  assert.equal(created.length, 1, '一只宠物必须建出一个窗口（0 个就是桌面上什么都没有）');
  const loaded = created[0]?.loaded;
  assert.ok(loaded, '窗口必须调用 loadFile（否则窗口是空的）');
  assert.match(loaded.file, /index\.html$/, '加载的必须是渲染端页面');
  assert.ok(existsSync(loaded.file), '页面文件必须真实存在');
});
