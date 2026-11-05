// #197: a channel attachment streams onto disk instead of riding base64 in the
// message JSON. These tests drive the real HTTP server + Attachments pair, and
// measure the three sizes the PR reports (100 MB / 500 MB / 1 GB).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
// PR reports. Each size streams over the real HTTP route into a temp dir and the
// server's RSS is sampled while it runs; the default cap keeps the largest one that
// works here with room to spare.
test('#197: 100 MB, 500 MB and 1 GB stream through without loading the file into memory', { timeout: 300_000 }, async () => {
  const server = await uploadServer();
  try {
    for (const mb of [100, 500, 1024]) {
      const total = mb * 1024 * 1024;
      const before = process.memoryUsage().rss;
      let peak = before;
      const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 5);
      const started = performance.now();
      const res = await fetch(`${server.base}/?name=${mb}mb.bin&mime=application/octet-stream`,
        { method: 'POST', body: bodyOf(total, 4 * 1024 * 1024), duplex: 'half' });
      const { attachment } = await res.json();
      const ms = Math.round(performance.now() - started);
      clearInterval(sampler);
      assert.equal(res.status, 201, `${mb} MB`);
      assert.equal(attachment.size, total);
      const stored = join(server.files.dir, attachment.id);
      assert.equal(statSync(stored).size, total);
      // One size on disk at a time: the measurement must not need 1.6 GB of temp space.
      unlinkSync(stored);
      const grown = Math.round((peak - before) / 1024 / 1024);
      // A base64 body of this size would have cost ~1.33x the file in the process.
      assert.ok(grown < mb / 2, `${mb} MB grew RSS by ${grown} MB`);
      assert.ok(ms < 120_000, `${mb} MB took ${ms} ms`);
      quiet.info(`${mb} MB: ${ms} ms, RSS +${grown} MB`);
      console.log(`#197 measured: ${mb} MB in ${ms} ms, server RSS +${grown} MB, default cap ${formatBytes(DEFAULT_MAX_UPLOAD_BYTES)}`);
    }
  } finally { await server.close(); }
});
