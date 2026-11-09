import { connect } from 'node:net';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export function isMemoryPath(path) {
  const root = process.env.QQ_MEMORY_ROOT;
  return root && (resolve(String(path)) === root || resolve(String(path)).startsWith(root + sep));
}

export function memoryRequest(request) {
  return new Promise((resolve, reject) => {
    const socket = connect(process.env.QQ_MEMORY_SOCKET);
    let response = '';
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'));
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== 'sources') throw new Error('usage: node client.mjs sources');
  console.log(JSON.stringify(await memoryRequest({ op: 'sources' }), null, 2));
}
