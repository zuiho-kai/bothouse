/**
 * x11-pointer 的单测 —— 只测不碰 X server 的部分：setup 应答解析，以及连不上时的超时。
 *
 * 为什么值得单测：这段是**手写的 X11 线协议**，偏移错一格就会把根窗口认成一个随机数，
 * 而真机 CI 没有 X11 可跑。这里用合成缓冲区把两种布局钉住：
 *   ① 标准布局（vendor 紧跟在 16 字节定长头之后）；
 *   ② 实测遇到的「多 16 字节前缀」布局（个别服务器，见 x11-pointer.js 的 parseRoot 注释）。
 * 超时用替身 socket 测：X 侧不回应时必须失败，不能把轮询永久挂住。
 *
 * 跑法：node --test scripts/tests/x11-pointer.test.mjs（npm run test:ui 会带上）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EventEmitter } = require('node:events');
const net = require('node:net');
const { createLinuxPointer, parseRoot } = require('../../runtime/electron-helper/x11-pointer.js');

/** 替身 socket：永不 connect、永不 data；setTimeout 到点发 'timeout'，与 node:net 的行为一致 */
function neverConnectingSocket() {
  const socket = new EventEmitter();
  let timer = null;
  socket.setTimeout = (ms, callback) => {
    if (timer) clearTimeout(timer);
    timer = ms > 0 ? setTimeout(() => (callback ? callback() : socket.emit('timeout')), ms) : null;
  };
  socket.destroy = () => {
    if (timer) clearTimeout(timer);
  };
  return socket;
}

/** 合成一个 setup 应答体：定长头 + vendor + formats + 第一块屏幕（只保证 root 字段可读） */
function setupBody({ vendor = 'The X.Org Foundation', formats = 1, root = 0x831 } = {}) {
  const pad = (n) => (4 - (n % 4)) % 4;
  const head = Buffer.alloc(16);
  const vendorBuf = Buffer.from(vendor, 'latin1');
  head.writeUInt16LE(vendorBuf.length, 0); // vendor length
  head.writeUInt16LE(0xffff, 2); // max request length
  head[4] = 1; // number of screens
  head[5] = formats; // number of formats
  head[6] = 0; // image byte order
  head[7] = 0; // bitmap bit order
  head[8] = 32; // scanline unit
  head[9] = 32; // scanline pad
  head[10] = 8; // min keycode
  head[11] = 255; // max keycode

  const formatBuf = Buffer.alloc(formats * 8);
  const screen = Buffer.alloc(48);
  screen.writeUInt32LE(root, 0); // 根窗口：parseRoot 只读这个字段
  return Buffer.concat([head, vendorBuf, Buffer.alloc(pad(vendorBuf.length)), formatBuf, screen]);
}

test('标准布局：从第一块屏幕读出根窗口', () => {
  assert.equal(parseRoot(setupBody({ root: 0x831 })), 0x831);
  assert.equal(parseRoot(setupBody({ root: 0x400, formats: 4 })), 0x400);
});

test('多 16 字节前缀的布局也能认出来（实测个别服务器）', () => {
  const body = Buffer.concat([Buffer.alloc(16, 0x5a), setupBody({ root: 0x6d0 })]);
  assert.equal(parseRoot(body), 0x6d0);
});

test('认不出根窗口时显式抛错，不返回垃圾值', () => {
  assert.throws(() => parseRoot(Buffer.alloc(64)), /cannot locate root window/);
});

test('X 侧不回应连接 → 限时失败，不把轮询挂住', async () => {
  const realConnect = net.connect;
  net.connect = () => neverConnectingSocket();
  try {
    const started = Date.now();
    // 兜底：正常实现 500ms×2 就失败；3s 还没落地说明超时逻辑没生效（旧版会永远挂着）
    const watchdog = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('连接没有限时失败（超时逻辑失效）')), 3000).unref?.();
    });
    await Promise.race([
      assert.rejects(createLinuxPointer({ display: ':0' }).probe(), /X11 connect timeout/),
      watchdog,
    ]);
    assert.ok(Date.now() - started < 3000);
  } finally {
    net.connect = realConnect;
  }
});
