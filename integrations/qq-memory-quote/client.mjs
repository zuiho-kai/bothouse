import { connect } from 'node:net';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const shellQuote = value => `'${String(value).replaceAll("'", `'"'"'`)}'`;

export function isMemoryPath(path) {
  const root = process.env.QQ_MEMORY_ROOT;
  return root && (resolve(String(path)) === root || resolve(String(path)).startsWith(root + sep));
}

export function memoryRequest(request, capability = process.env.QQ_MEMORY_CAPABILITY) {
  return new Promise((resolve, reject) => {
    const socket = connect(process.env.QQ_MEMORY_SOCKET);
    let response = '';
    socket.on('connect', () => socket.write(JSON.stringify({ request, capability }) + '\n'));
    socket.on('error', reject);
    socket.on('data', chunk => {
      response += chunk;
      if (!response.includes('\n')) return;
      socket.end();
      try {
        const message = JSON.parse(response);
        if (message.ok) resolve(message.result);
        else reject(new Error(message.error));
      } catch (error) { reject(error); }
    });
    socket.on('end', () => { if (!response.includes('\n')) reject(new Error('memory commit service closed without a receipt')); });
  });
}

export function memoryInstructions() {
  return `记忆写入须用文件编辑器；shell 对记忆只读。先用 shell 执行 ${shellQuote(process.execPath)} ${shellQuote(fileURLToPath(new URL('./client.mjs', import.meta.url)))} sources 查询本会话真人原话。每条新事实须带 原话：「逐字摘录」；来源：<查询返回的完整id>。来源的 speaker_id 才是发言者，不把转发、引语、转述当其自述。保留原有 self、人、群文件布局。核对失败按工具错误改写或放弃，不绕过。`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== 'sources') throw new Error('usage: node client.mjs sources');
  console.log(JSON.stringify(await memoryRequest({ op: 'sources' }), null, 2));
}
