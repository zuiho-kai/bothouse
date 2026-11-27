// #2314 item 2.6 (+ QR SVG): tests for 128-bit long codes, connection string encoding/parsing,
// and channel isolation between Tailscale 6-digit codes and relay long codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_ATTEMPTS, PairError, PairHost } from './pairing.mjs';
import {
  TUNNEL_LINK_PREFIX,
  TunnelLinkError,
  encodeTunnelLink,
  generateLongCode,
  normalizeRelayUrl,
  parseTunnelLink,
} from './tunnel-link.mjs';
import { encodeQRMatrix, renderQRSvg } from './qr-svg.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'collab-tlink-'));
const HOST_ID = 'a'.repeat(64);

test('tunnel long code is isolated from Tailscale 6-digit code, single-use, and locks after 5 tries', () => {
  let now = 10_000;
  const host = new PairHost({ file: join(dir(), 'd.json'), now: () => now });

  // Issue a 6-digit Tailscale code: must NOT be accepted on the tunnel channel!
  const ts = host.newCode();
  assert.throws(
    () => host.claim({ code: ts.code, mode: 'temp', name: 'A', channel: 'tunnel' }),
    e => e instanceof PairError && e.code === 'no-code',
  );

  // Issue a 128-bit tunnel code: must NOT be accepted on Tailscale, works once on tunnel.
  const tc = host.newTunnelCode();
  assert.ok(tc.code.length >= 22);
  assert.throws(
    () => host.claim({ code: tc.code, mode: 'temp', name: 'A', channel: 'tailscale' }),
    e => e instanceof PairError && e.code === 'wrong',
  );
  // 6-digit code still rejected even when tunnel code is live!
  assert.throws(
    () => host.claim({ code: ts.code, mode: 'temp', name: 'A', channel: 'tunnel' }),
    e => e instanceof PairError && e.code === 'wrong',
  );

  const ok = host.claim({ code: tc.code, mode: 'remember', name: 'Laptop', channel: 'tunnel' });
  assert.equal(ok.device.channel, 'tunnel');
  assert.equal(host.verify(ok.token).id, ok.device.id);
  // Single-use: second use rejected.
  assert.throws(
    () => host.claim({ code: tc.code, mode: 'temp', name: 'Laptop2', channel: 'tunnel' }),
    e => e instanceof PairError && e.code === 'no-code',
  );

  // 5 wrong attempts void the tunnel code.
  const tc2 = host.newTunnelCode();
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    assert.throws(
      () => host.claim({ code: 'wrong-long-code-attempt', mode: 'temp', channel: 'tunnel' }),
      e => e instanceof PairError && e.code === 'wrong',
    );
  }
  assert.throws(
    () => host.claim({ code: 'wrong-long-code-attempt', mode: 'temp', channel: 'tunnel' }),
    e => e instanceof PairError && e.code === 'locked',
  );
  assert.throws(
    () => host.claim({ code: tc2.code, mode: 'temp', channel: 'tunnel' }),
    e => e instanceof PairError && e.code === 'no-code',
  );

  // Expiry voids the tunnel code.
  const tc3 = host.newTunnelCode();
  now += host.codeTtl;
  assert.throws(
    () => host.claim({ code: tc3.code, mode: 'temp', channel: 'tunnel' }),
    e => e instanceof PairError && e.code === 'expired',
  );
});

test('connection string round-trips and rejects malformed, non-https, or expired inputs', () => {
  const now = 1_764_288_000_000;
  const code = generateLongCode();
  const link = encodeTunnelLink({
    relayUrl: 'https://relay.example.com/',
    hostId: HOST_ID,
    code,
    expiresAt: now + 300_000,
    name: 'Mac Studio',
  });
  assert.ok(link.startsWith(TUNNEL_LINK_PREFIX));
  assert.ok(!link.includes('\n'));

  const parsed = parseTunnelLink(link, { now: () => now });
  assert.equal(parsed.relayUrl, 'https://relay.example.com');
  assert.equal(parsed.hostId, HOST_ID);
  assert.equal(parsed.code, code);
  assert.equal(parsed.name, 'Mac Studio');
  assert.equal(parsed.expiresAt, now + 300_000);

  // Expired link rejected.
  assert.throws(
    () => parseTunnelLink(link, { now: () => now + 300_001 }),
    e => e instanceof TunnelLinkError && e.code === 'expired',
  );

  // Non-https remote relay rejected; loopback http allowed.
  assert.throws(() => normalizeRelayUrl('http://relay.example.com'), e => e instanceof TunnelLinkError);
  assert.equal(normalizeRelayUrl('http://127.0.0.1:4321'), 'http://127.0.0.1:4321');
  assert.throws(() => normalizeRelayUrl('https://relay.example.com/subpath'), e => e instanceof TunnelLinkError);

  // Bad connection strings.
  const badPayload = obj => TUNNEL_LINK_PREFIX + Buffer.from(JSON.stringify(obj)).toString('base64url');
  for (const bad of [
    '',
    'not-a-link',
    'bhrelay2:abc',
    'bhrelay1:!!!bad-base64!!!',
    'bhrelay1:' + Buffer.from('not-json').toString('base64url'),
    badPayload({ r: 'http://evil.example', h: HOST_ID, c: code, e: now + 60_000 }),
    badPayload({ r: 'https://relay.example', h: 'short', c: code, e: now + 60_000 }),
    badPayload({ r: 'https://relay.example', h: HOST_ID, c: '123456', e: now + 60_000 }),
  ]) {
    assert.throws(() => parseTunnelLink(bad, { now: () => now }), e => e instanceof TunnelLinkError, bad);
  }
});

test('QR SVG encodes a full relay connection string cleanly without external dependencies', () => {
  const link = encodeTunnelLink({
    relayUrl: 'https://struggle-andale-half-putting.trycloudflare.com',
    hostId: HOST_ID,
    code: generateLongCode(),
    expiresAt: Date.now() + 300_000,
    name: 'MacBook',
  });
  const { version, size, matrix } = encodeQRMatrix(link);
  assert.ok(version >= 1 && version <= 15);
  assert.equal(size, 17 + 4 * version);
  // Top-left 7x7 finder corners must be dark.
  assert.equal(matrix[0][0], 1);
  assert.equal(matrix[0][6], 1);
  assert.equal(matrix[6][0], 1);
  assert.equal(matrix[3][3], 1);
  assert.equal(matrix[1][1], 0);
  const svg = renderQRSvg(link);
  assert.ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'));
  assert.ok(svg.includes('<path d="M'));
});
