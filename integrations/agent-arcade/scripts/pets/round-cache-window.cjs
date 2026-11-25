'use strict';
// Called by test-round-touch.cjs --expression-cache H20 H17 H15 [output].
// Each executable runs behind the same Settings-selected synthetic USB port.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {setTimeout: pause} = require('node:timers/promises');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Re-read the actual App stream and keep its original image packet bytes. A
// second instance of the same endpoint holds its viewport centred. Live VIEW
// shifts the image with idle breathing, and a receipt may precede panel swap.
async function fixedView(ports, exe) {
  const wire = await import('../../src/pet/robot/wire.js');
  const raw = fs.readFileSync(path.join(ports,'app-writes.aap'));
  const dir = path.join(path.dirname(ports),'head-on');
  fs.mkdirSync(dir);
  const images = [], steps = [], found = new Map();
  const t = wire.TYPE;
  const imageTypes = new Set([t.FRAME_BEGIN,t.FRAME_DATA,t.FRAME_END,t.PICTURE_BEGIN,t.PICTURE_COMMIT,t.PICTURE_CAPTURE,t.PICTURE_SHOW]);
  let start=0, id=0, session;
  function step(bytes) {
    id++; fs.writeFileSync(path.join(dir,id+'.in'),bytes);
    steps.push([id,id*75,719,4].join(' '));
    return id;
  }
  for (let i=0; i<raw.length; i++) {
    if (raw[i] !== 0) continue;
    const bytes = raw.subarray(start,i+1); start=i+1;
    if (bytes.length === 1) continue;
    const [p] = new wire.StreamReader().push(bytes);
    assert(p);
    if (p.type === wire.TYPE.HELLO) {
      session = Buffer.from(p.payload).readUInt32LE(3); step(bytes); continue;
    }
    if (!imageTypes.has(p.type)) continue;
    images.push(bytes);
    if (p.type !== wire.TYPE.PICTURE_COMMIT && p.type !== wire.TYPE.PICTURE_CAPTURE) continue;
    const receipt = Buffer.from(p.payload.subarray(0,12));
    assert.equal(receipt.readUInt32LE(0),session);
    const ackStep = step(Buffer.concat(images.splice(0)));
    const scanStep = step(Buffer.alloc(0));
    found.set(session+'/'+receipt.readUInt32LE(4), {receipt,ackStep,scanStep});
  }
  assert.equal(start,raw.length); assert.equal(images.length,0);
  const child=spawnSync(exe,[],{cwd:dir,input:steps.join('\n')+'\n0 0 1 0\n',encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(child.status,0,String(child.error||child.stderr));
  fs.writeFileSync(path.join(dir,'fixture-input.txt'),steps.join('\n')+'\n0 0 1 0\n');
  fs.writeFileSync(path.join(dir,'board.log'),child.stdout);
  return f => {
    const row=found.get(f.session+'/'+f.id);
    assert(row);
    const replies = new wire.StreamReader().push(fs.readFileSync(path.join(dir,row.ackStep+'.out')));
    assert(replies.some(p=>p.type===wire.TYPE.D_PICTURE_ACK&&row.receipt.equals(Buffer.from(p.payload))));
    f.centredScanStep=row.scanStep;
    return fs.readFileSync(path.join(dir,row.scanStep+'.scan'));
  };
}

async function exercise({h20,h17,h15,out,report,openCase,closeCase,portDir,stable,sample,snapshot,
  until,saveRgb565,getApp,getPreview,getPage}) {
  const {TYPE, StreamReader, parsePictureAck, parseView} = await import('../../src/pet/robot/wire.js');
  const scans = new Map();
  for (const [name, exe] of Object.entries({h20,h17,h15})) {
    const idle = await openCase(name, exe, 0);
    const app = getApp(), preview = getPreview(), log = report.cases[name];
    const ports = portDir(name);
    const frames = log.frames = {idle};
    assert.equal(Boolean(log.hello.pictureCachePixels), name === 'h20');
    const touch = log.hello.abilities.includes('touch');
    async function poke() {
      if (touch) { await stable(1); await stable(0); }
      else {
        await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()
          .find(w => w.webContents.getURL().includes('/pet/robot/twin.html')).setIgnoreMouseEvents(false));
        await preview.locator('#stage').click({position:{x:130,y:130}});
      }
    }
    async function next(after, expected) {
      return until(async () => {
        const d = (await snapshot()).delivery;
        return d?.phase === 'confirmed' && d.session === after.session && d.id > after.id &&
          (expected === undefined ? d.checksum !== after.checksum : d.checksum === expected) && d;
      }, name + ' awaiting the next complete picture after ' + after.id);
    }
    try {
      await stable(0);
      await poke();
      frames.smile = await next(idle);
      frames.restored = await next(frames.smile, idle.checksum);
      if (name === 'h20') {
        const card = getPage().locator('#robot-device-card');
        await card.screenshot({path:path.join(out,'settings-confirmed.png')});
        log.settingsText = await card.innerText();
      }
      await poke();
      frames.repeat = await next(frames.restored, frames.smile.checksum);
      frames.restoredAgain = await next(frames.repeat, idle.checksum);
      // Use the ordinary typed state sampled by the two display bodies. The
      // three GUI profiles contain no personal account or foreground request.
      await app.evaluate(() => { h16.displaySample = {activity:'failed',attention:true}; });
      frames.issueAndUnread = await next(frames.restoredAgain);
      await pause(4100); // The next poke starts a fresh group of gestures.
      await poke();
      frames.issueAndSmile = await next(frames.issueAndUnread);
      frames.issueRestored = await next(frames.issueAndSmile, frames.issueAndUnread.checksum);
      await app.evaluate(() => { h16.displaySample = null; });
      frames.clear = await next(frames.issueRestored, idle.checksum);
      log.sleepStep = await sample(0, 2700, true);
      frames.reconnected = await until(async () => {
        const d = (await snapshot()).delivery;
        return d?.phase === 'confirmed' && d.session !== idle.session && d.checksum === idle.checksum && d;
      }, name + ' new session after silence', 18000);
      await stable(0); await poke();
      frames.freshSmile = await next(frames.reconnected, frames.smile.checksum);
      frames.freshRestored = await next(frames.freshSmile, idle.checksum);
    } finally { await closeCase(); }

    const centred = await fixedView(ports,exe);
    for (const [label, f] of Object.entries(frames)) {
      const reply = log.events.find(e => e.type === TYPE.D_PICTURE_ACK && e.ack.session === f.session &&
        e.ack.id === f.id && e.ack.checksum === f.checksum);
      assert(reply, name + ' ' + label + ' needs an actual matching device ACK');
      const rx = new StreamReader().push(fs.readFileSync(path.join(ports, reply.step + '.out')));
      assert(rx.some(p => p.type === TYPE.D_PICTURE_ACK && parsePictureAck(p.payload).checksum === f.checksum));
      f.liveScanAtAckSha256 = sha(fs.readFileSync(path.join(ports,reply.step+'.scan')));
      const pixels = centred(f);
      assert.equal(pixels.length, 480*480*2);
      f.step = reply.step; f.scanSha256 = sha(pixels);
      if (name === 'h20') {
        scans.set(label, pixels);
        if (['idle','smile','restored','issueAndUnread','issueAndSmile'].includes(label)) {
          saveRgb565('lcd-' + label, new Uint16Array(pixels.buffer,pixels.byteOffset,pixels.length/2),480,480);
        }
      } else assert(pixels.equals(scans.get(label)), name + ' and H20 must show identical ' + label);
    }
    const boot = fs.readFileSync(path.join(ports,'boot.scan'));
    const last = frames.reconnected.step;
    const atSleep = Array.from({length:last-log.sleepStep+1},(_,i)=>i+log.sleepStep)
      .find(step=>boot.equals(fs.readFileSync(path.join(ports,step+'.scan'))));
    assert(atSleep !== undefined,'cold-start sleep face must reach scanout by the fresh commit');
    log.sleepScanStep = atSleep;
    assert(boot.equals(scans.get('idle')) === false);
    assert.equal(frames.idle.scanSha256, frames.restored.scanSha256);
    assert.equal(frames.reconnected.scanSha256, frames.idle.scanSha256);
    assert.equal(frames.repeat.scanSha256, frames.smile.scanSha256);
    assert.equal(frames.issueAndUnread.scanSha256, frames.issueRestored.scanSha256);
    const read = new StreamReader(), commands = read.push(fs.readFileSync(path.join(ports,'app-writes.aap')));
    const views = commands.filter(p => p.type === TYPE.VIEW).map(p => parseView(p.payload));
    assert(views.length && views.every(v => !v.torque && v.pan === 0 && v.tilt === 0));
    log.view = {count:views.length, torque:0, pan:0, tilt:0};
    // Numbered references must really appear between the initial learned smile and
    // its return. An equal final CRC alone would also pass with ordinary tiles.
    log.pictureCommands = Object.fromEntries([0x0b,0x0c].map(type =>
      ['0x'+type.toString(16), commands.filter(p => p.type === type).length]));
    assert.equal(log.pictureCommands['0xb'] > 0, name === 'h20');
    assert.equal(log.pictureCommands['0xc'] > 0, name === 'h20');
  }
  // The upper cue and lower touch caption occupy separate regions on the actual
  // head-on LCD scan. Adding one must preserve the other down to the last pixel.
  const cut = 480 * 240 * 2;
  const issue = scans.get('issueAndUnread'), combined = scans.get('issueAndSmile');
  assert(!issue.subarray(0,cut).equals(scans.get('idle').subarray(0,cut)));
  assert(issue.subarray(0,cut).equals(combined.subarray(0,cut)));
  assert(combined.subarray(cut).equals(scans.get('smile').subarray(cut)));
  assert(!combined.subarray(cut).equals(issue.subarray(cut)));
  assert.deepEqual(report.errors, []);
  report.passed = true;
}
module.exports = {exercise};
