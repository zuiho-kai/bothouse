// Dev-only preview for the team desk page. Serves desk/ and stubs the three
// endpoints the page may use (/collab/api/state, /collab/api/events,
// /collab/api/desk/replay) from fixture.sample.jsonl, so the page can be looked
// at without a DSH host. Never used by the plugin route (B serves the real one).
//
//   node dsh/collab/desk/preview.mjs [--port 8791]
//
// Fixture mode (the page's own ?fixture=1) uses the fixture embedded in
// index.html: the real plugin route serves only index.html, so the page must
// not fetch sibling files. This server still reads fixture.sample.jsonl to
// stub live SSE and replay for the non-fixture view.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const AVATAR_DIR = join(DIR, '..', 'avatars');
const AVATARS = new Set(['orange', 'dragon', 'rainbow', 'whale', 'lanxi']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jsonl': 'application/x-ndjson; charset=utf-8', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8' };

/** The five demo roles used by ?fixture=1 (kept in sync with index.html DEMO_MEMBERS). */
export const DEMO_MEMBERS = [
  { id: "lead", name: "队长", kind: "dsh", avatar: "orange", online: true },
  { id: "ayan", name: "阿岩", kind: "dsh", avatar: "dragon", online: true },
  { id: "ayou", name: "阿柚", kind: "bot", avatar: "whale", online: true },
  { id: "ache", name: "阿澈", kind: "bot", avatar: "rainbow", online: true },
  { id: "alan", name: "阿岚", kind: "dsh", avatar: "lanxi", online: false },
];

/** Fixture rows (task-shaped, no `type`), oldest first. Bad lines are skipped. */
export function fixtureEvents(file = join(DIR, 'fixture.sample.jsonl')) {
  const out = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const row = JSON.parse(s);
      if (row && typeof row.kind === 'string' && row.id !== undefined && Number.isFinite(Date.parse(row.ts))) out.push(row);
    } catch { /* ignore */ }
  }
  return out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function file(res, name) {
  let bytes;
  try { bytes = readFileSync(join(DIR, name)); } catch { return json(res, 404, { error: 'not found' }); }
  res.writeHead(200, { 'content-type': TYPES[extname(name)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(bytes);
}

/**
 * Start the preview. Returns the http.Server (call `listen(port)` yourself) so
 * tests can bind port 0.
 */
export function createPreviewServer() {
  const events = fixtureEvents();
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://preview.invalid');
    const path = url.pathname.replace(/\/+$/, '');
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });

    if (path === '/collab' || path === '/collab/desk') return file(res, 'index.html');
    if (path === '/collab/desk/roster.json') return file(res, 'roster.json');
    if (path === '/collab/desk/fixture.sample.jsonl') return file(res, 'fixture.sample.jsonl');
    if (path === '/collab/desk/README.md') return file(res, 'README.md');

    const av = /^\/collab\/avatars\/([a-z0-9_-]+)\.png$/.exec(path);
    if (av !== null) {
      if (!AVATARS.has(av[1])) return json(res, 404, { error: 'avatar not found' });
      return file(res, '../avatars/' + av[1] + '.png');
    }

    if (path === '/collab/api/state') {
      return json(res, 200, {
        me: 'owner', lead_id: 'lead', effective_lead_id: 'lead',
        rooms: [{ id: 1, name: 'general' }], members: DEMO_MEMBERS, thinking: {},
      });
    }
    if (path === '/collab/api/desk/replay') {
      const from = Date.parse(url.searchParams.get('from') ?? '');
      const to = Date.parse(url.searchParams.get('to') ?? '');
      const rows = events.filter((e) => {
        const t = Date.parse(e.ts);
        return (Number.isNaN(from) || t >= from) && (Number.isNaN(to) || t <= to);
      });
      return json(res, 200, { events: rows.map((e) => ({ type: 'task', ...e })) });
    }
    if (path === '/collab/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': preview\n\n');
      let i = 0;
      const send = () => {
        const ev = events[i % events.length];
        i += 1;
        res.write('data: ' + JSON.stringify({ type: 'task', ...ev }) + '\n\n');
      };
      send();
      const timer = setInterval(send, 1800);
      req.on('close', () => clearInterval(timer));
      return;
    }
    return json(res, 404, { error: 'not found' });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = process.argv.indexOf('--port');
  const port = Number(arg > 0 ? process.argv[arg + 1] : process.env.PORT ?? 8791) || 8791;
  createPreviewServer().listen(port, '127.0.0.1', () => {
    console.log('team desk preview: http://127.0.0.1:' + port + '/collab/desk');
    console.log('fixture:            http://127.0.0.1:' + port + '/collab/desk?fixture=1');
  });
}