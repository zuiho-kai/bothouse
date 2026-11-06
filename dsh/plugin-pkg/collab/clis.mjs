// GET /collab/api/clis: which local CLI agents this machine can run as members.
// Route registration lives in plugin.mjs and is wired separately.
import { execFile } from 'node:child_process';
import { CLIS } from './roster.mjs';

/**
 * Default lookup: `which <name>` → absolute path, or undefined when absent. Windows has no `which`:
 * `where.exe` lists every match (CRLF), including npm's extensionless sh shim next to the .cmd, so the
 * first one Windows can start (PATHEXT) is taken.
 */
export function which(name, platform = process.platform) {
  const win = platform === 'win32';
  return new Promise((resolve) => {
    execFile(win ? 'where.exe' : 'which', [name], (error, stdout) => {
      const lines = String(stdout ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const exts = String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';').filter(Boolean);
      const path = win ? (lines.find(l => exts.some(e => l.toLowerCase().endsWith(e))) ?? lines[0]) : lines[0];
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
