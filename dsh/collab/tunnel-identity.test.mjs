// #2314 item 2.2: tests for per-machine Ed25519 identity + X25519 encryption keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TunnelIdentity,
  computeHostId,
  formatFingerprint,
  verifyEncryptionBundle,
} from './tunnel-identity.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'collab-tid-'));
const vectors = JSON.parse(readFileSync(new URL('../../tunnel-relay/test/vectors.json', import.meta.url), 'utf8'));

test('identity persists across restarts with identical hostId and 0600 permissions', () => {
  const file = join(dir(), 'tunnel-identity.json');
  const first = new TunnelIdentity({ file });
  assert.equal(first.peek(), undefined, 'lazy creation: file not created before use');
  const id1 = first.hostId;
  const bundle1 = first.encryptionBundle();
  assert.match(id1, /^[a-f0-9]{64}$/);
  assert.equal(id1, createHash('sha256').update(Buffer.from(bundle1.publicKey, 'base64')).digest('hex'));
  if (process.platform !== 'win32') {
    assert.equal(statSync(file).mode & 0o777, 0o600, 'private key file must be owner-only 0600');
  }

  const second = new TunnelIdentity({ file });
  assert.equal(second.hostId, id1, 'hostId must stay stable across restarts');
  assert.equal(second.publicKey, first.publicKey);
  assert.equal(second.encKey, first.encKey);

  // Valid bundle passes verification.
  const verified = verifyEncryptionBundle(bundle1);
  assert.equal(verified.hostId, id1);
  assert.equal(formatFingerprint(id1), `${id1.slice(0, 8)}…${id1.slice(-8)}`);
});

test('challenge signature verifies against Ed25519 public key', () => {
  const id = new TunnelIdentity({ file: join(dir(), 'id.json') });
  const challenge = 'bothouse-tunnel-relay-v1:test-nonce-123';
  const sig = id.signChallenge(challenge);
  const verified = verifyEncryptionBundle(id.encryptionBundle());
  assert.equal(verify(null, Buffer.from(challenge, 'utf8'), verified.edPublicKey, Buffer.from(sig, 'base64')), true);
});

test('tampering a single byte of publicKey, encKey or encKeySig is rejected', () => {
  const id = new TunnelIdentity({ file: join(dir(), 'id.json') });
  const bundle = id.encryptionBundle();

  const flipLastByte = b64 => {
    const buf = Buffer.from(b64, 'base64');
    buf[buf.length - 1] ^= 0x01;
    return buf.toString('base64');
  };

  assert.throws(() => verifyEncryptionBundle({ ...bundle, publicKey: flipLastByte(bundle.publicKey) }));
  assert.throws(() => verifyEncryptionBundle({ ...bundle, encKey: flipLastByte(bundle.encKey) }));
  assert.throws(() => verifyEncryptionBundle({ ...bundle, encKeySig: flipLastByte(bundle.encKeySig) }));
  assert.throws(() => verifyEncryptionBundle({ ...bundle, hostId: '0'.repeat(64) }), e => e.code === 'identity-mismatch');
});

test('reset() generates a brand new identity and updates disk', () => {
  const file = join(dir(), 'id.json');
  const id = new TunnelIdentity({ file });
  const before = id.hostId;
  const beforeEnc = id.encKey;
  id.reset();
  assert.notEqual(id.hostId, before);
  assert.notEqual(id.encKey, beforeEnc);
  assert.equal(new TunnelIdentity({ file }).hostId, id.hostId);
});

test('matches deterministic protocol test vector for hostId and signed encKey bundle', () => {
  const v = vectors.identity;
  assert.equal(computeHostId(v.publicKey), v.hostId);
  const verified = verifyEncryptionBundle({
    hostId: v.hostId,
    publicKey: v.publicKey,
    encKey: v.encKey,
    encKeySig: v.encKeySig,
  });
  assert.equal(verified.hostId, v.hostId);
});
