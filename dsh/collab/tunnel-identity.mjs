// #2314 item 2.2: persistent per-machine Ed25519 identity + X25519 encryption keys for the
// community tunnel relay channel.
//
// HostId computation (sha256 of Ed25519 SPKI DER) and Ed25519-signed encryption key bundle follow
// Kooyu packages/host/src/devices/relay.ts (commit e33137b, MIT License, Copyright (c) Kooyu
// contributors), adapted to file-backed 0600 storage with zero external dependencies.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const ENC_KEY_SIGN_PREFIX = 'bothouse-tunnel-enc-v1:';
export const HOST_ID_RE = /^[a-f0-9]{64}$/;

/** Write JSON atomically with owner-only permissions (private keys live here). */
export function savePrivateJSON(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* best effort on non-POSIX */ }
}

/** Compute canonical 64-hex hostId = sha256(Ed25519 SPKI DER). */
export function computeHostId(publicKeyBase64) {
  if (typeof publicKeyBase64 !== 'string' || publicKeyBase64.length === 0 || publicKeyBase64.length > 256) {
    throw new Error('invalid Ed25519 public key');
  }
  const der = Buffer.from(publicKeyBase64, 'base64');
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('public key is not Ed25519');
  }
  const canonicalDer = key.export({ format: 'der', type: 'spki' });
  if (!canonicalDer.equals(der)) {
    throw new Error('non-canonical Ed25519 SPKI DER encoding');
  }
  return createHash('sha256').update(der).digest('hex');
}

/** Short human-readable fingerprint (first 8 … last 8 hex chars). */
export function formatFingerprint(hostId) {
  const s = String(hostId ?? '').toLowerCase();
  if (s.length <= 16) return s;
  return `${s.slice(0, 8)}…${s.slice(-8)}`;
}

/**
 * Verify a host's public identity + signed X25519 encryption key returned by GET /h/<hostId>/key.
 * Throws an Error with `err.code` ('identity-mismatch' | 'identity-invalid') on any mismatch.
 */
export function verifyEncryptionBundle({ hostId, publicKey, encKey, encKeySig }) {
  const fail = (code, message) => {
    const err = new Error(message);
    err.code = code;
    throw err;
  };
  if (typeof hostId !== 'string' || !HOST_ID_RE.test(hostId)) {
    fail('identity-invalid', '对方身份指纹格式不对');
  }
  let edPub;
  let computedId;
  try {
    computedId = computeHostId(publicKey);
    edPub = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  } catch {
    fail('identity-invalid', '中继返回的对方身份公钥格式不对');
  }
  if (computedId !== hostId) {
    fail('identity-mismatch', '对方公钥指纹和连接串不一致，已拒绝连接');
  }
  if (typeof encKey !== 'string' || encKey.length === 0 || encKey.length > 256 || typeof encKeySig !== 'string' || encKeySig.length === 0 || encKeySig.length > 128) {
    fail('identity-invalid', '对方没有提供有效的端到端加密公钥');
  }
  let x25519Pub;
  try {
    const encDer = Buffer.from(encKey, 'base64');
    x25519Pub = createPublicKey({ key: encDer, format: 'der', type: 'spki' });
    if (x25519Pub.asymmetricKeyType !== 'x25519' || !x25519Pub.export({ format: 'der', type: 'spki' }).equals(encDer)) {
      throw new Error('bad x25519');
    }
  } catch {
    fail('identity-invalid', '对方的加密公钥格式不对');
  }
  const ok = verify(null, Buffer.from(ENC_KEY_SIGN_PREFIX + encKey, 'utf8'), edPub, Buffer.from(encKeySig, 'base64'));
  if (!ok) {
    fail('identity-mismatch', '对方加密公钥签名校验失败，已拒绝连接');
  }
  return { hostId: computedId, publicKey, encKey, encKeySig, edPublicKey: edPub, x25519PublicKey: x25519Pub };
}

function generateRawKeys() {
  const ed = generateKeyPairSync('ed25519');
  const x = generateKeyPairSync('x25519');
  return {
    version: 1,
    ed25519: {
      publicKey: ed.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      privateKey: ed.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    },
    x25519: {
      publicKey: x.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      privateKey: x.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    },
  };
}

function hydrateKeys(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('invalid tunnel identity file');
  const edPriv = createPrivateKey(raw.ed25519?.privateKey);
  const xPriv = createPrivateKey(raw.x25519?.privateKey);
  if (edPriv.asymmetricKeyType !== 'ed25519' || xPriv.asymmetricKeyType !== 'x25519') {
    throw new Error('tunnel identity key types do not match');
  }
  const edPub = createPublicKey(edPriv).export({ format: 'der', type: 'spki' }).toString('base64');
  const xPub = createPublicKey(xPriv).export({ format: 'der', type: 'spki' }).toString('base64');
  if (edPub !== raw.ed25519.publicKey || xPub !== raw.x25519.publicKey) {
    throw new Error('tunnel identity public/private key mismatch');
  }
  const hostId = computeHostId(edPub);
  return {
    hostId,
    publicKey: edPub,
    edPrivateKey: edPriv,
    encKey: xPub,
    x25519PrivateKey: xPriv,
  };
}

/**
 * Persistent per-machine relay identity (Ed25519 identity + X25519 encryption key).
 * Keys are lazily generated on first use unless already saved on disk.
 */
export class TunnelIdentity {
  /** @param {{ file: string }} opts */
  constructor({ file }) {
    this.file = file;
    this._state = undefined;
  }

  /** Load existing identity from disk if present, without creating one yet. */
  peek() {
    if (this._state) return this._state;
    if (!existsSync(this.file)) return undefined;
    const raw = JSON.parse(readFileSync(this.file, 'utf8'));
    this._state = hydrateKeys(raw);
    return this._state;
  }

  /** Load existing identity or generate and save a fresh one (mode 0600). */
  ensure() {
    const existing = this.peek();
    if (existing) return existing;
    const raw = generateRawKeys();
    savePrivateJSON(this.file, raw);
    this._state = hydrateKeys(raw);
    return this._state;
  }

  /** Replace the machine's identity with brand new keys (all relay links must re-pair). */
  reset() {
    const raw = generateRawKeys();
    savePrivateJSON(this.file, raw);
    this._state = hydrateKeys(raw);
    return this._state;
  }

  get hostId() { return this.ensure().hostId; }
  get fingerprint() { return formatFingerprint(this.hostId); }
  get publicKey() { return this.ensure().publicKey; }
  get encKey() { return this.ensure().encKey; }
  get x25519PrivateKey() { return this.ensure().x25519PrivateKey; }

  /** Sign a relay challenge string using the Ed25519 identity private key. */
  signChallenge(challenge) {
    const s = this.ensure();
    return sign(null, Buffer.from(String(challenge), 'utf8'), s.edPrivateKey).toString('base64');
  }

  /** Export public identity + X25519 encryption key signed by the Ed25519 identity key. */
  encryptionBundle() {
    const s = this.ensure();
    const encKeySig = sign(null, Buffer.from(ENC_KEY_SIGN_PREFIX + s.encKey, 'utf8'), s.edPrivateKey).toString('base64');
    return {
      hostId: s.hostId,
      publicKey: s.publicKey,
      encKey: s.encKey,
      encKeySig,
    };
  }
}
