// 固定的 bot 接入端口（#142）。DSH 桌面版启动时把 Web 宿主端口写死成 0（每次随机，见
// DeepSeek Harness.app dsh-desktop-host main() 的 "--port","0"），主桥的 cloud_web 无法配置固定地址。
// 配了 botPort 时，插件另开一个只听 127.0.0.1 的小监听，只转两样东西：cloud-web 握手
// （WS_PATH，与宿主上同一个处理函数、同一口令）和离线补历史 /api/rooms/…；其余一律 404。
import { createServer } from 'node:http';

/**
 * @param {{ port: number, path: string, upgrade: Function, history: Function, logger?: any }} options
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export function startBotPort({ port, path, upgrade, history, logger }) {
  const server = createServer((req, res) => {
    const p = new URL(req.url ?? '/', 'http://collab.invalid').pathname;
    if (p === '/api/rooms' || p.startsWith('/api/rooms/')) return history(req, res);
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
  });
  server.on('upgrade', (req, socket, head) => {
    const p = new URL(req.url ?? '/', 'http://collab.invalid').pathname;
    if (p !== path) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    upgrade(req, socket, head);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      server.on('error', err => logger?.warn?.('conest-collab: bot port: %s', err.message));
      resolve({ port: server.address().port, close: () => new Promise(done => { server.closeAllConnections?.(); server.close(() => done()); }) });
    });
  });
}
