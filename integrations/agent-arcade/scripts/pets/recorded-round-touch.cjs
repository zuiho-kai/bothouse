'use strict';
// An offline AAP peer for the desktop-pet fixture. The input is a byte-for-byte
// excerpt of the H17 host firmware run. No serial port or Electron App profile
// is needed to check the excerpt against an unpacked H17 archive:
// node scripts/pets/recorded-round-touch.cjs <archive>/ui/contact/port-01-COM42
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {gunzipSync} = require('node:zlib');
const recording = require('../../test/fixtures/h17-recorded-touch.json');
const {proof, frames} = recording;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = name => Buffer.from(frames[name].hex, 'hex');
function recordedPixels() {
  const file = path.join(__dirname, '../../test/fixtures/h17-idle.rgb565.gz');
  const raw = gunzipSync(fs.readFileSync(file), {maxOutputLength: 504 * 504 * 2});
  assert.equal(raw.length, 504 * 504 * 2);
  assert.equal(sha(raw), proof.pixelsSha256);
  return raw;
}

function verifyRaw(dir) {
  for (const [name, stamp] of Object.entries(recording.files)) {
    const file = fs.readFileSync(path.join(dir, name));
    assert.equal(file.length, stamp.size, name);
    assert.equal(sha(file), stamp.sha256, name);
    for (const frame of Object.values(frames).filter(f => f.file === name)) {
      const expected = Buffer.from(frame.hex, 'hex');
      assert.deepEqual(file.subarray(frame.offset, frame.offset + expected.length), expected, name);
    }
  }
  const report = fs.readFileSync(path.resolve(dir, '../../report.json'));
  assert.equal(sha(report), recording.source.reportSha256);
  const {source, passed, endpoints, cases} = JSON.parse(report);
  assert.ok(passed);
  assert.equal(source, recording.source.commit);
  assert.equal(endpoints.touch, recording.source.hostEndpointSha256);
  assert.deepEqual(recordedPixels(), fs.readFileSync(path.join(dir, recording.source.firstPictureFile)));
  const rows = cases.contact.fanout.filter(e => e.source === 'presence').slice(2, 5);
  assert.deepEqual(rows.map(e => e.at), proof.hostObservedMs);
  assert.deepEqual(rows.map(e => e.args), [['robot-device','poke'], ['robot-device','poke'], ['robot-device','huff']]);
}

async function openRecordedTouch({onTouch}) {
  const {openRoundReplay} = require('./replay-round-link.cjs');
  const {TYPE, StreamReader, FrameAssembler, parseRoundTouch, parseDeviceHello, parsePictureAck, isRoundDisplayHello} =
    await import('../../src/pet/robot/wire.js');
  const {decodeUpdate} = await import('../../src/pet/robot/codec.js');
  function payload(buffer, type) {
    const found = new StreamReader().push(buffer).filter(p => p.type === type);
    assert.equal(found.length, 1, 'expected one packet of type ' + type);
    return Buffer.from(found[0].payload);
  }
  const greeting = payload(bytes('hello'), TYPE.HELLO);
  assert.equal(greeting.readUInt32LE(3), proof.session);
  assert.ok(isRoundDisplayHello(payload(bytes('peer'), TYPE.D_HELLO), proof.session));
  assert.deepEqual(parseDeviceHello(payload(bytes('peer'), TYPE.D_HELLO)).abilities, ['touch']);
  const commit = payload(bytes('commit'), TYPE.PICTURE_COMMIT);
  assert.deepEqual(commit, payload(bytes('ack'), TYPE.D_PICTURE_ACK));
  assert.deepEqual(parsePictureAck(commit), {session: proof.session, id: proof.id, checksum: proof.checksum});
  assert.notEqual(proof.staleSession, proof.session);
  assert.ok(isRoundDisplayHello(payload(bytes('oldHello'), TYPE.D_HELLO), proof.staleSession));
  assert.equal(parsePictureAck(payload(bytes('oldAck'), TYPE.D_PICTURE_ACK)).session, proof.staleSession);
  for (const [name, session, id] of [['first', proof.session, 1], ['second', proof.session, 2],
      ['third', proof.session, 3], ['stale', proof.staleSession, 2]]) {
    assert.deepEqual(parseRoundTouch(payload(bytes(name), TYPE.D_EVENT)), {session, id});
  }
  const replay = await openRoundReplay(proof.session, {recordedTouch: true});
  const tick = ms => replay.step({op: 'tick', ms});
  const receive = name => replay.step({op: 'receive', data: bytes(name).toString('base64')});
  try {
    const challenge = await tick(0);
    assert.deepEqual(payload(challenge.bytes, TYPE.HELLO), greeting);
    await receive('peer');
    await replay.step({op:'recorded-first-picture', data: recordedPixels().toString('base64')});
    const image = await tick(0);
    assert.deepEqual(payload(image.bytes, TYPE.PICTURE_BEGIN), payload(bytes('begin'), TYPE.PICTURE_BEGIN));
    assert.deepEqual(payload(image.bytes, TYPE.PICTURE_COMMIT), commit);
    const pixels = new Uint16Array(504 * 504), tiles = new FrameAssembler();
    for (const packet of new StreamReader().push(image.bytes)) {
      const rectangle = tiles.accept(packet.type, packet.payload);
      if (rectangle) decodeUpdate(pixels, 504, 504, rectangle, rectangle.data);
    }
    assert.equal(sha(Buffer.from(pixels.buffer)), proof.pixelsSha256);
    assert.notEqual((await receive('oldAck')).state, 'confirmed');
    assert.equal((await receive('ack')).state, 'confirmed');
  } catch (error) {
    replay.close(); throw error;
  }
  let elapsed = 0;
  // The positive times are observed H17 host arrivals. Give each negative
  // control its own slot outside the production 100 ms rate gate.
  const [first, second, third] = proof.inputMs;
  const times = {first, duplicate: first + 150, stale: first + 300, second, third};
  return {
    proof: {...proof, firstPictureSource: 'archived RGB565 content', source: recording.source},
    close: () => replay.close(),
    async receive(key) {
      if (!Object.hasOwn(times, key) || times[key] < elapsed) throw Error('Touch replay out of order: ' + key);
      while (elapsed < times[key]) {
        const ms = Math.min(33, times[key] - elapsed);
        await tick(ms); elapsed += ms;
      }
      const {reactions} = await receive(key === 'duplicate' ? 'first' : key);
      assert.ok(reactions.length <= 1);
      if (reactions.length) await onTouch(reactions[0]);
      return reactions[0] ?? null;
    },
  };
}

module.exports = {openRecordedTouch, verifyRaw};
if (require.main === module) {
  verifyRaw(process.argv[2]);
  console.log('Matched the H17 report and all ' + Object.keys(frames).length + ' raw packet excerpts.');
}
