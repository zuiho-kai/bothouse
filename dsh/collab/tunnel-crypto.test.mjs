// #2314 item 2.3: tests for end-to-end encrypted request envelopes and streaming response records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ENVELOPE_TTL_MS,
  ReplayGuard,
  TunnelCryptoError,
  createResponseOpener,
  createResponseSealer,
  openRequest,
  sealRequest,
  validateTunnelPath,
  verifyEnvelopeClient,
} from './tunnel-crypto.mjs';
import { TunnelIdentity } from './tunnel-identity.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const vectors = JSON.parse(readFileSync(new URL('../../tunnel-relay/test/vectors.json', import.meta.url), 'utf8'));
const X_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const xFromSeed = hex => {
  const privateKey = createPrivateKey({ key: Buffer.concat([X_PKCS8_PREFIX, Buffer.from(hex, 'hex')]), format: 'der', type: 'pkcs8' });
  return { privateKey, publicKey: createPublicKey(privateKey) };
};

test('matches deterministic protocol test vector for request envelope and response stream', () => {
  const v = vectors.envelope;
  const hostX = xFromSeed(vectors.identity.x25519SeedHex);
  const ephX = xFromSeed(v.ephemeralSeedHex);

  const sealed = sealRequest({
    encKey: vectors.identity.encKey,
    method: v.plaintextRequest.method,
    path: v.plaintextRequest.path,
    headers: v.plaintextRequest.headers,
    body: Buffer.from(v.plaintextRequest.bodyText, 'utf8'),
    now: () => v.nowMs,
    ttlMs: v.ttlMs,
    ephemeralKeyPair: ephX,
    nonce: Buffer.from(v.nonceHex, 'hex'),
  });
  assert.deepEqual(sealed.envelope, v.sealed);
  assert.equal(sealed.replyKey.toString('hex'), v.replyKeyHex);

  const opened = openRequest(v.sealed, { privateKey: hostX.privateKey, now: () => v.nowMs + 1000 });
  assert.equal(opened.request.method, v.plaintextRequest.method);
  assert.equal(opened.request.path, v.plaintextRequest.path);
  assert.equal(opened.request.headers.authorization, v.plaintextRequest.headers.authorization);
  assert.equal(opened.request.body.toString('utf8'), v.plaintextRequest.bodyText);

  const sealer = createResponseSealer(opened.replyKey, opened.aad);
  const frames = Buffer.concat([
    sealer.sealHead({ status: v.plaintextResponse.status, headers: v.plaintextResponse.headers }),
    ...sealer.sealData(Buffer.from(v.plaintextResponse.bodyText, 'utf8')),
    sealer.sealEnd(),
  ]);
  assert.equal(frames.toString('base64'), v.sealedResponseBase64);

  const opener = createResponseOpener(sealed.replyKey, sealed.aad);
  const ev = opener.push(Buffer.from(v.sealedResponseBase64, 'base64'));
  opener.finish();
  assert.equal(ev[0].type, 'head');
  assert.equal(ev[0].status, 200);
  assert.equal(ev[1].data.toString('utf8'), v.plaintextResponse.bodyText);
  assert.equal(ev[2].type, 'end');
});

test('ciphertext hides request path, headers and bearer token', () => {
  const host = generateKeyPairSync('x25519');
  const encKey = host.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const secretPath = '/collab/api/rooms/42/messages?secret=xyz';
  const secretToken = 'super-secret-device-token-999';
  const { envelope } = sealRequest({
    encKey,
    method: 'POST',
    path: secretPath,
    headers: { authorization: `Bearer ${secretToken}` },
    body: Buffer.from('{"text":"confidential-msg"}', 'utf8'),
  });
  const wire = JSON.stringify(envelope);
  assert.ok(!wire.includes('/collab/api/rooms/42'));
  assert.ok(!wire.includes(secretToken));
  assert.ok(!wire.includes('confidential-msg'));
});

test('bit-flip tampering, replay and expired/future envelopes are rejected', () => {
  const host = generateKeyPairSync('x25519');
  const encKey = host.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  let now = 1_000_000;
  const replayGuard = new ReplayGuard();

  const { envelope } = sealRequest({ encKey, method: 'GET', path: '/collab/api/state', now: () => now });

  // Flip 1 bit in ciphertext -> rejected.
  const tamperedBuf = Buffer.from(envelope.ciphertext, 'base64');
  tamperedBuf[0] ^= 0x01;
  assert.throws(
    () => openRequest({ ...envelope, ciphertext: tamperedBuf.toString('base64') }, { privateKey: host.privateKey, replayGuard, now: () => now }),
    e => e instanceof TunnelCryptoError && e.code === 'ENVELOPE_INVALID',
  );

  // First open succeeds; identical replay is rejected.
  openRequest(envelope, { privateKey: host.privateKey, replayGuard, now: () => now });
  assert.throws(
    () => openRequest(envelope, { privateKey: host.privateKey, replayGuard, now: () => now }),
    e => e instanceof TunnelCryptoError && e.code === 'ENVELOPE_REPLAY',
  );

  // Expired envelope is rejected.
  const { envelope: expEnv } = sealRequest({ encKey, method: 'GET', path: '/collab/api/state', now: () => now, ttlMs: 1000 });
  assert.throws(
    () => openRequest(expEnv, { privateKey: host.privateKey, now: () => now + 2000 }),
    e => e instanceof TunnelCryptoError && e.code === 'ENVELOPE_EXPIRED',
  );

  // Far-future expires (> now + 120s) is rejected.
  const { envelope: futureEnv } = sealRequest({ encKey, method: 'GET', path: '/collab/api/state', now: () => now, ttlMs: ENVELOPE_TTL_MS + 10_000 });
  assert.throws(
    () => openRequest(futureEnv, { privateKey: host.privateKey, now: () => now }),
    e => e instanceof TunnelCryptoError && e.code === 'ENVELOPE_EXPIRED',
  );
});

test('non-/collab paths and path traversal are rejected', () => {
  for (const bad of ['/etc/passwd', '/api/rooms/1/messages', '/collab/../secret', '/collab2/foo', 'http://evil.example/collab/x', '']) {
    assert.throws(() => validateTunnelPath(bad), e => e instanceof TunnelCryptoError && e.code === 'INVALID_PATH', bad);
  }
  assert.equal(validateTunnelPath('/collab'), '/collab');
  assert.equal(validateTunnelPath('/collab/api/state?x=1'), '/collab/api/state?x=1');
});

test('truncated response stream (missing final END record) raises STREAM_TRUNCATED', () => {
  const host = generateKeyPairSync('x25519');
  const encKey = host.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const { envelope, aad, replyKey } = sealRequest({ encKey, method: 'GET', path: '/collab/api/state' });
  const opened = openRequest(envelope, { privateKey: host.privateKey });

  const sealer = createResponseSealer(opened.replyKey, opened.aad);
  const head = sealer.sealHead({ status: 200, headers: { 'content-type': 'text/plain' } });
  const [chunk1] = sealer.sealData(Buffer.from('part-1'));
  // Deliberately drop sealer.sealEnd()!

  const opener = createResponseOpener(replyKey, aad);
  const ev = opener.push(Buffer.concat([head, chunk1]));
  assert.equal(ev.length, 2);
  assert.throws(() => opener.finish(), e => e instanceof TunnelCryptoError && e.code === 'STREAM_TRUNCATED');
});

test('1 MiB chunked response round-trips intact across arbitrary byte splits', () => {
  const host = generateKeyPairSync('x25519');
  const encKey = host.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const { envelope, aad, replyKey } = sealRequest({ encKey, method: 'GET', path: '/collab/api/attachments/test' });
  const opened = openRequest(envelope, { privateKey: host.privateKey });

  const original = randomBytes(1024 * 1024);
  const sealer = createResponseSealer(opened.replyKey, opened.aad);
  const wire = Buffer.concat([
    sealer.sealHead({ status: 200, headers: { 'content-type': 'application/octet-stream' } }),
    ...sealer.sealData(original),
    sealer.sealEnd(),
  ]);

  const opener = createResponseOpener(replyKey, aad);
  const received = [];
  let headStatus = 0;
  // Feed in awkward 7777-byte slices to test cross-record boundary reassembly.
  for (let off = 0; off < wire.length; off += 7777) {
    for (const ev of opener.push(wire.subarray(off, off + 7777))) {
      if (ev.type === 'head') headStatus = ev.status;
      else if (ev.type === 'data') received.push(ev.data);
    }
  }
  opener.finish();
  assert.equal(headStatus, 200);
  assert.ok(Buffer.concat(received).equals(original));
});

test('mutual client Ed25519 signature binds clientKey to AAD and rejects forged/missing signatures pre-decryption', () => {
  const host = generateKeyPairSync('x25519');
  const encKey = host.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const clientId = new TunnelIdentity({ file: join(mkdtempSync(join(tmpdir(), 'collab-cid-')), 'id.json') });
  const otherId = new TunnelIdentity({ file: join(mkdtempSync(join(tmpdir(), 'collab-cid-')), 'id2.json') });

  const { envelope } = sealRequest({
    encKey,
    clientIdentity: clientId,
    method: 'GET',
    path: '/collab/api/state',
  });
  const verified = verifyEnvelopeClient(envelope);
  assert.equal(verified.clientId, clientId.hostId);
  assert.equal(verified.clientPublicKey, clientId.publicKey);

  const opened = openRequest(envelope, { privateKey: host.privateKey, requireClientAuth: true });
  assert.equal(opened.clientId, clientId.hostId);

  // Missing clientKey/clientSig rejected when requireClientAuth is set.
  const unsigned = { ...envelope };
  delete unsigned.clientKey;
  delete unsigned.clientSig;
  assert.throws(() => verifyEnvelopeClient(unsigned), e => e instanceof TunnelCryptoError && e.code === 'CLIENT_SIG_INVALID');
  assert.throws(() => openRequest(unsigned, { privateKey: host.privateKey, requireClientAuth: true }), e => e.code === 'CLIENT_SIG_INVALID');

  // Swapped clientKey or tampered clientSig rejected before decryption.
  assert.throws(() => verifyEnvelopeClient({ ...envelope, clientKey: otherId.publicKey }), e => e.code === 'CLIENT_SIG_INVALID');
  const badSig = Buffer.from(envelope.clientSig, 'base64');
  badSig[0] ^= 0xff;
  assert.throws(() => verifyEnvelopeClient({ ...envelope, clientSig: badSig.toString('base64') }), e => e.code === 'CLIENT_SIG_INVALID');
});
