// #197: a channel attachment streams onto disk instead of riding base64 in the
// message JSON. These tests drive the real HTTP server + Attachments pair, and
// measure the three sizes the PR reports (100 MB / 500 MB / 1 GB).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Attachments, DEFAULT_MAX_UPLOAD_BYTES, MAX_BOT_ATTACHMENT_BYTES, formatBytes, oversizedNote } from './attachments.mjs';
import { streamUploadRoute } from './plugin.mjs';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/** The real route plugin.mjs serves over HTTP, with the rest of the collab plugin left out. */
async function uploadServer({ maxBytes = DEFAULT_MAX_UPLOAD_BYTES, dir } = {}) {
  const files = new Attachments(dir ?? join(mkdtempSync(join(tmpdir(), 'collab-stream-')), 'attachments'));
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://collab.invalid');
    // The route writes status and JSON itself (plugin.mjs json()); a non-upload path is a 404 here.
    const out = streamUploadRoute(req, res, url, { files, maxBytes });
    if (out === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not found"}');
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}/collab/api/attachments`;
  return { files, base, close: () => new Promise(done => server.close(done)), logger: quiet };
}

/** A request body that streams `total` bytes in `chunk` slices, without building them at once. */
function bodyOf(total, chunk = 256 * 1024) {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= total) { controller.close(); return; }
      const size = Math.min(chunk, total - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size).fill(7));
    },
  });
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
// 20 ms: the in-process sampler below sampled every 5 ms; a streaming pipeline holds at
// most a chunk or two between samples, so 20 ms still catches a whole-file read while
// adding far less overhead on a slow Windows runner.
const SAMPLE_MS = 20;

// #252: the RSS check must measure the *server*, not this test process.
// createServer and the fetch that sends the body used to share one process, so its RSS
// also counted undici's send buffers and not-yet-collected chunks: CI saw +77 MB for a
// 100 MB upload on Linux and +404 MB for 500 MB on Windows — the sender's cost read as
// the server's. Here the same real route runs in a child process that reports its own
// RSS every SAMPLE_MS; the parent only streams the body.
const UPLOAD_SERVER_CHILD = `
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const { Attachments } = await import(pathToFileURL(join(process.env.COLLAB_DIR, 'attachments.mjs')).href);
const { streamUploadRoute } = await import(pathToFileURL(join(process.env.COLLAB_DIR, 'plugin.mjs')).href);
const files = new Attachments(process.env.UPLOAD_DIR);
// Collect first: without it the sample counts chunks that are garbage but not yet
// collected, which is what made the old in-process numbers depend on block size and GC
// timing. With it the sample is what the server actually keeps, i.e. whether the file
// was loaded whole rather than streamed.
const sample = () => { globalThis.gc?.(); process.stdout.write(JSON.stringify({ rss: process.memoryUsage().rss }) + '\\n'); };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://collab.invalid');
  const out = streamUploadRoute(req, res, url, { files, maxBytes: Number(process.env.MAX_BYTES) });
  if (out === undefined) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"not found"}');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
setInterval(sample, Number(process.env.SAMPLE_MS));
process.stdout.write(JSON.stringify({ ready: true, port: server.address().port, rss: process.memoryUsage().rss }) + '\\n');
`;

/** The real upload route, with the server in its own process reporting that process's RSS. */
async function streamingUploadServer({ maxBytes = DEFAULT_MAX_UPLOAD_BYTES, dir, t } = {}) {
  const attachmentsDir = dir ?? join(mkdtempSync(join(tmpdir(), 'collab-stream-')), 'attachments');
  // --expose-gc: the child's sampler collects before each reading (see `sample` below).
  const child = spawn(process.execPath, ['--expose-gc', '--input-type=module', '-e', UPLOAD_SERVER_CHILD], {
    env: { ...process.env, UPLOAD_DIR: attachmentsDir, COLLAB_DIR: moduleDir, MAX_BYTES: String(maxBytes), SAMPLE_MS: String(SAMPLE_MS) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = new Promise(done => child.on('exit', done));
  // #263: reap the child however this test ends. A node:test timeout cancels the test
  // from outside and `finally` is not guaranteed to run then; the child holds stdout
  // open, so one failure would keep the test file (and the job) alive. `after` hooks do
  // run on cancel, and this is registered before `await ready`: a child that stays
  // alive but never announces `ready` must be reaped too, not just one that dies.
  // Idempotent: the normal path closes it again, and an exited child is just awaited.
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) { await exited; return; }
    const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { child.kill('SIGTERM'); } catch { /* already gone: await the exit below */ }
    await exited;
    clearTimeout(kill);
  };
  if (t) t.after(close);
  child.stdout.setEncoding('utf8');
  let pending = '';
  let last = 0;
  let peak = 0;
  let baseline = 0;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // #263: settle `ready` exactly once. `error` and `exit` can both arrive (a spawn
  // failure is followed by an exit), and a sample arriving after a rejection must not
  // try to settle the promise again.
  let settled = false;
  const settle = (fn, value) => { if (settled) return; settled = true; fn(value); };
  child.stdout.on('data', (chunk) => {
    pending += chunk;
    for (let cut = pending.indexOf('\n'); cut >= 0; cut = pending.indexOf('\n')) {
      const line = pending.slice(0, cut);
      pending = pending.slice(cut + 1);
      if (!line) continue;
      // A stray log line from the child must not break the sampler (#263, non-blocking).
      let sample;
      try { sample = JSON.parse(line); } catch { continue; }
      last = sample.rss;
      if (sample.ready) { settle(resolveReady, sample.port); continue; }
      peak = Math.max(peak, sample.rss);
    }
  });
  child.on('error', error => settle(rejectReady, error));
  // #263: `error` only fires when the spawn itself fails. A child that starts and then
  // dies before printing `ready` (missing dependency, wrong COLLAB_DIR, a top-level
  // throw) used to leave `await ready` hanging until the test timeout, with `finally`
  // never running. Exit before ready rejects now, so the failure lands in seconds.
  child.on('exit', (code, signal) => {
    settle(rejectReady, new Error(`upload server exited before ready: ${code ?? signal}`));
  });
  const port = await ready;
  return {
    dir: attachmentsDir,
    base: `http://127.0.0.1:${port}/collab/api/attachments`,
    /** Baseline is the server's last reported RSS, so startup and earlier uploads do not count. */
    reset() { baseline = last; peak = last; },
    grownMB() { return Math.round((peak - baseline) / 1024 / 1024); },
    close,
  };
}

test('#197: a streamed upload lands on disk with its name and size; the bytes never enter the message JSON', async () => {
  const server = await uploadServer();
  try {
    const res = await fetch(`${server.base}/?name=${encodeURIComponent('测试 报告.pdf')}&mime=application/pdf`,
      { method: 'POST', body: bodyOf(1024 * 1024), duplex: 'half' });
    assert.equal(res.status, 201);
    const { attachment } = await res.json();
    assert.equal(attachment.name, '测试 报告.pdf');
    assert.equal(attachment.mime, 'application/pdf');
    assert.equal(attachment.size, 1024 * 1024);
    assert.equal(statSync(join(server.files.dir, attachment.id)).size, 1024 * 1024);
    // Nothing half-written survives beside it.
    assert.deepEqual(readdirSync(server.files.dir), [attachment.id]);

    // The message then names the id instead of carrying the bytes.
    const metas = server.files.receive([{ id: attachment.id, name: attachment.name, mime: attachment.mime }]);
    assert.deepEqual(metas, [{ id: attachment.id, name: '测试 报告.pdf', mime: 'application/pdf', size: 1024 * 1024 }]);
  } finally { await server.close(); }
});

test('#197: an upload over the configured cap is refused with 413 and stores nothing', async () => {
  const server = await uploadServer({ maxBytes: 4 * 1024 * 1024 });
  try {
    const big = await fetch(`${server.base}/?name=a.bin`, { method: 'POST', body: new Uint8Array(5 * 1024 * 1024) });
    assert.equal(big.status, 413);
    const refused = await big.json();
    assert.equal(refused.code, 'too-large');
    assert.equal(refused.max_upload_bytes, 4 * 1024 * 1024);

    // Streamed in slices: the counter stops what is written and drains the rest.
    const res = await fetch(`${server.base}/?name=b.bin`, { method: 'POST', body: bodyOf(5 * 1024 * 1024), duplex: 'half' });
    assert.equal(res.status, 413);
    assert.match((await res.json()).error, /附件不能超过/);
    assert.deepEqual(readdirSync(server.files.dir), []);
  } finally { await server.close(); }
});

test('#197: a cut-off or empty upload leaves no file behind', async () => {
  const server = await uploadServer();
  try {
    const empty = await fetch(`${server.base}/?name=empty.bin`, { method: 'POST', body: new Uint8Array(0) });
    assert.equal(empty.status, 400);
    assert.match((await empty.json()).error, /empty/);

    const controller = new AbortController();
    let pulled = 0;
    const slow = new ReadableStream({
      pull(controller) {
        if (pulled++ === 0) { controller.enqueue(new Uint8Array(1024)); return; }
        return new Promise(() => {}); // a client that never sends the rest
      },
    });
    const cut = fetch(`${server.base}/?name=cut.bin`, { method: 'POST', body: slow, duplex: 'half', signal: controller.signal })
      .catch(error => error);
    await new Promise(done => setTimeout(done, 50));
    controller.abort();
    await cut;
    await new Promise(done => setTimeout(done, 50));
    assert.deepEqual(readdirSync(server.files.dir), [], 'a half-received upload leaves no file');
  } finally { await server.close(); }
});

test('#197: receive() adopts streamed ids with the size read from disk and still accepts inline base64', async () => {
  const files = new Attachments(join(mkdtempSync(join(tmpdir(), 'collab-adopt-')), 'attachments'));
  const saved = files.save([{ name: 'old.txt', mime: 'text/plain', data: Buffer.from('old').toString('base64') }]);
  const server = await uploadServer({ dir: files.dir });
  try {
    const res = await fetch(`${server.base}/?name=run.log&mime=text/plain`, { method: 'POST', body: new Uint8Array([1, 2, 3]) });
    const { attachment } = await res.json();
    const metas = files.receive([{ id: attachment.id, name: 'run.log' }, { id: saved[0].id, name: 'old.txt' }]);
    assert.deepEqual(metas.map(m => [m.name, m.size]), [['run.log', 3], ['old.txt', 3]]);
    assert.deepEqual(files.receive([{ name: 'x.txt', mime: 'text/plain', data: Buffer.from('x').toString('base64') }]).map(m => m.size), [1]);
    assert.deepEqual(files.receive(null), []);
    assert.throws(() => files.receive([{ id: '../etc/passwd' }]), { code: 'invalid' });
    assert.throws(() => files.receive([{ id: '00000000-0000-0000-0000-000000000000' }]), { code: 'invalid' });
    assert.throws(() => files.receive([{ id: attachment.id }, { name: 'y', mime: 'text/plain', data: 'eQ==' }]), { code: 'invalid' });
  } finally { await server.close(); }
});

test('#197: a file over the bot connection cap is not inlined: the bot gets its local path', async () => {
  const files = new Attachments(join(mkdtempSync(join(tmpdir(), 'collab-big-')), 'attachments'));
  const dir = files.dir;
  const server = await uploadServer({ dir });
  try {
    const send = async (name, size) => {
      const res = await fetch(`${server.base}/?name=${encodeURIComponent(name)}&mime=application/octet-stream`,
        { method: 'POST', body: bodyOf(size), duplex: 'half' });
      return (await res.json()).attachment;
    };
    const small = await send('small.bin', 1024);
    const huge = await send('huge.bin', MAX_BOT_ATTACHMENT_BYTES + 1);
    const metas = files.receive([small, huge].map(a => ({ id: a.id, name: a.name, mime: a.mime })));

    const wire = files.wire(metas);
    assert.deepEqual(wire.files.map(f => f.file_name), ['small.bin'], 'the oversized file is not base64-encoded into the frame');
    assert.deepEqual(files.oversized(metas).map(a => [a.name, a.size, a.path]), [['huge.bin', MAX_BOT_ATTACHMENT_BYTES + 1, join(dir, huge.id)]]);
    const note = oversizedNote(files.oversized(metas));
    assert.match(note, /huge\.bin/);
    assert.match(note, /本机文件：/);
    assert.match(note, /50 MB/);
    assert.doesNotMatch(note, /small\.bin/);
  } finally { await server.close(); }
});

// 来源: the owner's 「需要大一些 尽可能大」 (2026-11-05 21:01) plus the measurement the
// PR reports. Each size streams over the real HTTP route into a temp dir; the server's
// own process reports its RSS (#252), so the sender and its buffers are not counted.
// 120 s: the owner's 1 GB upload measured 1.3 s here, so this is still a 50x margin while
// failing far earlier than the previous 300 s (#263; the sizes themselves are unchanged).
test('#197: 100 MB, 500 MB and 1 GB stream through without loading the file into memory', { timeout: 120_000 }, async (t) => {
  const server = await streamingUploadServer({ t });
  try {
    // Warm-up: the first large upload on a fresh server allocates its parser, stream and
    // allocator arenas once — measured here as +25..45 MB for the first 100 MB and +24 MB
    // for the next 500 MB, then +0..12 MB for every later upload of any size. Streaming one
    // 100 MB body first makes the readings below answer the actual question: does each
    // upload add memory proportional to the file, or does the server stay at steady state?
    // It is the same real upload path, and nothing the assertions check is skipped.
    const warm = await fetch(`${server.base}/?name=warm.bin`, { method: 'POST', body: bodyOf(100 * 1024 * 1024, 4 * 1024 * 1024), duplex: 'half' });
    assert.equal(warm.status, 201);
    unlinkSync(join(server.dir, (await warm.json()).attachment.id));
    for (const mb of [100, 500, 1024]) {
      const total = mb * 1024 * 1024;
      server.reset();
      const started = performance.now();
      const res = await fetch(`${server.base}/?name=${mb}mb.bin&mime=application/octet-stream`,
        { method: 'POST', body: bodyOf(total, 4 * 1024 * 1024), duplex: 'half' });
      const { attachment } = await res.json();
      const ms = Math.round(performance.now() - started);
      // Three sample intervals, so a reading taken just before the last write still arrives.
      await new Promise(done => setTimeout(done, SAMPLE_MS * 3));
      assert.equal(res.status, 201, `${mb} MB`);
      assert.equal(attachment.size, total);
      const stored = join(server.dir, attachment.id);
      assert.equal(statSync(stored).size, total);
      // One size on disk at a time: the measurement must not need 1.6 GB of temp space.
      unlinkSync(stored);
      const grown = server.grownMB();
      // A base64 body of this size would have cost ~1.33x the file in the process.
      assert.ok(grown < mb / 2, `${mb} MB grew server RSS by ${grown} MB`);
      assert.ok(ms < 120_000, `${mb} MB took ${ms} ms`);
      quiet.info(`${mb} MB: ${ms} ms, server RSS +${grown} MB`);
      console.log(`#197 measured: ${mb} MB in ${ms} ms, server RSS +${grown} MB, default cap ${formatBytes(DEFAULT_MAX_UPLOAD_BYTES)}`);
    }
  } finally { await server.close(); }
});
