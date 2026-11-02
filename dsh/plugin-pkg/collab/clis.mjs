// GET /collab/api/clis: which local CLI agents this machine can run as members.
// Route registration lives in plugin.mjs and is wired separately.
import { execFile } from 'node:child_process';
import { CLIS } from './roster.mjs';

/** Default lookup: `which <name>` → absolute path, or undefined when absent. */
export function which(name) {
  return new Promise((resolve) => {
    execFile('which', [name], (error, stdout) => {
      const path = String(stdout ?? '').trim().split('\n')[0];
      resolve(error || !path ? undefined : path);
    });
  });
}

/** Installed CLIs, in CLIS order: [{ cli, path }]. */
export async function detectClis(lookup = which) {
  const found = await Promise.all(CLIS.map(async cli => ({ cli, path: await lookup(cli) })));
  return found.filter(c => c.path);
}

/** HTTP handler for GET /collab/api/clis. */
export async function handler(req, res, lookup = which) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET' });
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }
  const body = JSON.stringify(await detectClis(lookup));
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
