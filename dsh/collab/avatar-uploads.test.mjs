import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { AvatarUploads } from './avatar-uploads.mjs';
import { checkAvatar, avatarImage } from './avatars.mjs';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { Roster } from './roster.mjs';
import { memberAvatarRoute } from './plugin.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'avatar-upload-'));
  const uploads = new AvatarUploads(join(dir, 'avatars'));
  const store = new Store(join(dir, 'test.sqlite3'));
  const hub = new Hub(store, { warn() {} });
  const dsh = { putMember(m) { hub.setMember({ ...m, kind: 'dsh' }); }, dropMember(id) { hub.removeMember(id); } };
  const roster = new Roster(hub, dsh, undefined, uploads);
  const call = async (method, png, owner = true, id = 'coder') => {
    const req = Readable.from([Buffer.from(JSON.stringify({ png }))]);
    req.method = method;
    let status, result;
    const res = { setHeader() {}, writeHead(s) { status = s; }, end(body) { result = JSON.parse(body); } };
    await memberAvatarRoute(req, res, `/collab/api/members/${id}/avatar`, { roster, owner: () => owner });
    return { status, result };
  };
  return { dir, uploads, store, hub, roster, call };
}

test('avatar upload: owner stores PNG locally, emits members, replaces, survives reload and deletes', async () => {
  const f = fixture();
  await f.roster.create({ name: 'coder', cli: 'codex', persona: 'keep me', permissionPreset: 'read-only' });
  const events = [];
  f.hub.subscribe(e => events.push(e));
  const png = avatarImage('orange');
  const result = await f.call('POST', png.toString('base64'));
  assert.equal(result.status, 200);
  assert.equal(result.result.member.avatar, 'upload:coder.png');
  const path = join(f.dir, 'avatars', 'coder.png');
  assert.deepEqual(readFileSync(path), png);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(join(f.dir, 'avatars')).mode & 0o777, 0o700);
  assert.equal(events.at(-1).type, 'members');
  const version = events.at(-1).members[0].avatarVersion;
  await f.call('POST', avatarImage('whale').toString('base64'));
  assert.notEqual(events.at(-1).members[0].avatarVersion, version);
  assert.equal(f.store.member('coder').persona, 'keep me');
  assert.equal(f.store.member('coder').permission_preset, 'read-only');
  f.store.close();
  const reopened = new Store(join(f.dir, 'test.sqlite3'));
  assert.equal(reopened.member('coder').avatar, 'upload:coder.png');
  reopened.close();
  const restored = new AvatarUploads(join(f.dir, 'avatars'));
  assert.deepEqual(restored.read('coder.png'), avatarImage('whale'));
});

test('avatar upload: invalid images, sizes, base64, missing members and non-owner are refused', async () => {
  const f = fixture();
  await f.roster.create({ name: 'coder' });
  const png = avatarImage('orange');
  const wrong = Buffer.from(png); wrong.writeUInt32BE(255, 16);
  for (const data of [Buffer.from('not png'), wrong, Buffer.alloc(256 * 1024 + 1)]) {
    const r = await f.call('POST', data.toString('base64'));
    assert.equal(r.status, 400); assert.match(r.result.error, /PNG|256/);
  }
  assert.equal((await f.call('POST', 'data:image/png;base64,AAAA')).status, 400);
  assert.equal((await f.call('POST', png.toString('base64'), false)).status, 401);
  assert.equal((await f.call('POST', png.toString('base64'), true, 'missing')).status, 404);
  assert.equal(existsSync(join(f.dir, 'avatars', 'coder.png')), false);
  f.store.close();
});

test('avatar upload: reset and member removal clean files; traversal is refused', async () => {
  const f = fixture();
  await f.roster.create({ name: 'coder' });
  const png = avatarImage('orange').toString('base64');
  await f.call('POST', png);
  assert.equal((await f.call('DELETE')).status, 200);
  assert.equal(f.store.member('coder').avatar ?? '', '');
  assert.equal(existsSync(join(f.dir, 'avatars', 'coder.png')), false);
  await f.call('POST', png);
  f.roster.remove('coder');
  assert.equal(existsSync(join(f.dir, 'avatars', 'coder.png')), false);
  assert.equal(checkAvatar('upload:coder.png'), 'upload:coder.png');
  for (const value of ['upload:../coder.png', 'upload:a/b.png', 'upload:x.png?evil', 'upload:x_png.png']) assert.throws(() => checkAvatar(value));
  assert.equal(f.uploads.read('../coder.png'), undefined);
  assert.throws(() => f.uploads.save('../coder', png), /文件名/);
  f.store.close();
});
