'use strict';
// Measure complete OS-side AAP recordings from the unpacked H17 UI run.
// Run with Node: measure-expression-cache.cjs <H17 ui directory> <output.json>
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {source} = require('../../test/fixtures/h17-recorded-touch.json');

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sum = (items, key) => items.reduce((value, item) => value + item[key], 0);
const rgbBytes = pixels => Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);

function packets(raw, wire) {
  const results = [];
  let start = 0, prefix = 0;
  for (let i=0; i<raw.length; i++) {
    if (raw[i] !== 0) continue;
    if (i === start) { prefix++; start++; continue; }
    const record = raw.subarray(start, i+1);
    const reader = new wire.StreamReader();
    const parsed = reader.push(record);
    assert.equal(parsed.length, 1, 'Corrupt packet at byte '+start);
    const {type, seq, payload} = parsed[0];
    results.push({type, seq, payload: Buffer.from(payload), bytes: prefix+record.length, end:i+1});
    prefix=0; start=i+1;
  }
  assert.equal(start, raw.length, 'Unterminated OS-side packet');
  assert.equal(prefix, 0, 'Orphan end delimiter');
  assert.equal(sum(results, 'bytes'), raw.length);
  return results;
}

function endpointSteps(dir, transmitted) {
  const numbers = fs.readdirSync(dir).filter(n => /^\d+\.in$/.test(n))
    .map(n => Number.parseInt(n,10)).sort((a,b) => a-b);
  const offsets = [];
  let end = 0;
  for (const n of numbers) {
    const part = fs.readFileSync(path.join(dir,n+'.in'));
    assert(part.equals(transmitted.subarray(end,end+part.length)), 'Endpoint input diverges at step '+n);
    end += part.length;
    offsets.push({n,end});
  }
  return offsets;
}

function collect(dir, wire, decodeUpdate, onPicture) {
  const {TYPE} = wire;
  const tx = fs.readFileSync(path.join(dir,'app-writes.aap'));
  const rx = fs.readFileSync(path.join(dir,'app-reads.aap'));
  const steps = endpointSteps(dir,tx);
  const acks = new Map();
  let ackBytes = 0, events = 0;
  for (const {type,payload,bytes} of packets(rx,wire)) {
    if(type===TYPE.D_EVENT) events++;
    if(type!==TYPE.D_PICTURE_ACK) continue;
    const key=payload.toString('hex');
    acks.set(key,(acks.get(key)||0)+1);
    ackBytes+=bytes;
  }
  const frames = new wire.FrameAssembler(), pictures = [];
  let confirmed, confirmedId, current, activeSession, staging, beginOffset, slot;
  for(const {type,payload,bytes,end} of packets(tx,wire)) {
    if(type===TYPE.HELLO || type===TYPE.SLEEP) {
      assert(!current);
      activeSession = type===TYPE.HELLO ? payload.readUInt32LE(3) : null;
      confirmed = null; confirmedId = null; slot=null;
    }
    if(type===TYPE.PICTURE_BEGIN) {
      assert(!current);
      beginOffset=end-bytes;
      const session=payload.readUInt32LE(0), id=payload.readUInt32LE(4), base=payload.readUInt32LE(8);
      assert.equal(session,activeSession);
      if(base) assert.equal(base,confirmedId);
      staging = base ? confirmed.slice() : new Uint16Array(504*504);
      current={session,id,base,bytes:0,encodedBytes:0,rects:[],baseSha:base ? sha(rgbBytes(staging)) : null};
    }
    const rect=frames.accept(type,payload);
    if(rect) {
      const {x,y,width,height,data}=rect;
      decodeUpdate(staging,504,504,rect,data);
      current.rects.push({x,y,width,height,encoded:data.length});
      current.encodedBytes+=data.length;
    }
    if(type===TYPE.PICTURE_SHOW) {
      assert(current && current.base && !current.rects.length && slot);
      assert.equal(payload.readUInt32LE(0),activeSession);
      assert.equal(payload.readUInt32LE(4),current.id);
      assert.equal(payload.readUInt32LE(8),slot.id);
      current.showCapture=slot.id;
      for(let i=0;i<slot.xor.length;i++) {
        const offset=(slot.y+Math.floor(i/slot.width))*504 + slot.x + i%slot.width;
        staging[offset]^=slot.xor[i];
      }
      assert.equal(wire.pictureCRC32(staging),payload.readUInt32LE(12));
    }
    if([TYPE.PICTURE_BEGIN,TYPE.FRAME_BEGIN,TYPE.FRAME_DATA,TYPE.FRAME_END,TYPE.PICTURE_COMMIT,
        TYPE.PICTURE_CAPTURE,TYPE.PICTURE_SHOW].includes(type)) {
      assert(current); current.bytes+=bytes;
    }
    if(type!==TYPE.PICTURE_COMMIT && type!==TYPE.PICTURE_CAPTURE) continue;
    const identity=payload.subarray(0,12);
    const {session,id,checksum}=wire.parsePictureAck(identity);
    assert.equal(session,current.session); assert.equal(id,current.id);
    assert.equal(wire.pictureCRC32(staging),checksum);
    const key=identity.toString('hex');
    const acknowledged=Boolean(acks.get(key));
    if(type===TYPE.PICTURE_CAPTURE && acknowledged) {
      assert(current.base && confirmed && !current.showCapture);
      const [x,y,width,height]=[12,14,16,18].map(i=>payload.readUInt16LE(i));
      assert(width*height<=32768 && x+width<=504 && y+height<=504);
      slot={id,x,y,width,xor:new Uint16Array(width*height)};
      for(let i=0;i<slot.xor.length;i++) {
        const offset=(y+Math.floor(i/width))*504+x+i%width;
        slot.xor[i]=staging[offset]^confirmed[offset];
      }
      current.capturedPixels=slot.xor.length;
    } else if(!current.showCapture && acknowledged) slot=null;
    if(acknowledged) { acks.set(key,acks.get(key)-1); confirmed=staging; confirmedId=id; }
    const step=steps.find(s=>s.end>=end)?.n ?? null;
    assert(step!==null || !acknowledged);
    const capture=step!==null && path.join(dir,step+'.content');
    if(acknowledged && capture && fs.existsSync(capture)) {
      assert(rgbBytes(staging).equals(fs.readFileSync(capture)), 'Wrong board content at '+step);
    }
    pictures.push({...current,checksum,sha256:sha(rgbBytes(staging)),step,acknowledged,
      verifiedBoardContent:Boolean(acknowledged && capture && fs.existsSync(capture))});
    onPicture?.(pictures.at(-1),staging,tx.subarray(beginOffset,end));
    current=null;
  }
  assert(!current && [...acks.values()].every(count=>count===0));
  const pictureBytes=sum(pictures,'bytes');
  return {inputSha256:sha(tx),outputSha256:sha(rx),osWriteBytes:tx.length,
    endpointReadBytes:steps.at(-1).end,pictureBytes,otherWriteBytes:tx.length-pictureBytes,
    osReadBytes:rx.length,pictureAckBytes:ackBytes,otherReadBytes:rx.length-ackBytes,events,pictures};
}

async function baseline(input, onPicture) {
  const raw=fs.readFileSync(path.join(input,'report.json')), report=JSON.parse(raw);
  assert.equal(sha(raw),source.reportSha256,'Use the frozen and complete H17 UI capture');
  assert(report.passed && report.source===source.commit);
  const wire=await import('../../src/pet/robot/wire.js');
  const {decodeUpdate}=await import('../../src/pet/robot/codec.js');
  const ports={};
  for(const scenario of Object.keys(report.cases)) {
    const dir=path.join(input,scenario);
    for(const port of fs.readdirSync(dir).filter(name=>name.startsWith('port-')).sort()) {
      ports[scenario+'/'+port]=collect(path.join(dir,port),wire,decodeUpdate,onPicture);
    }
  }
  const members=Object.values(ports), pictures=members.flatMap(p=>p.pictures);
  const getFrame=(stage)=> {
    const p=pictures.find(item=>item.session===stage.session && item.id===stage.id && item.acknowledged);
    assert(p && p.checksum===stage.checksum); return p;
  };
  const c=report.cases.contact, rest=getFrame(c.delivery), smile=getFrame(c.changed), back=getFrame(c.restored);
  assert.equal(rest.sha256,back.sha256); assert.notEqual(rest.sha256,smile.sha256);
  // A slot is learned on the first committed rest -> smile; it holds both
  // sides of that one rectangle. Re-handshake starts a new, empty slot.
  const sessions=[];
  for(const port of members) {
    for(const session of new Set(port.pictures.map(p=>p.session))) {
      const tx=port.pictures.filter(p=>p.session===session);
      let learned=false;
      for(const p of tx) {
        const forward=p.baseSha===rest.sha256 && p.sha256===smile.sha256;
        const reverse=p.baseSha===smile.sha256 && p.sha256===rest.sha256;
        p.kind=!p.base?'full':forward?'smile':reverse?'restore':'other-change';
        if(learned && (forward || reverse)) p.slot='reference';
        else if(forward && p.rects.length===1) {p.slot='learn'; if(p.acknowledged) learned=true;}
        else p.slot='unchanged';
      }
      sessions.push({session,pictureIds:tx.map(p=>p.id),writes:sum(tx,'bytes'),
        confirmedWrites:sum(tx.filter(p=>p.acknowledged),'bytes'),
        confirmedReferences:tx.filter(p=>p.slot==='reference' && p.acknowledged).map(p=>p.id),
        unconfirmedReferences:tx.filter(p=>p.slot==='reference' && !p.acknowledged).map(p=>p.id)});
    }
  }
  const confirmed=pictures.filter(p=>p.acknowledged), unconfirmed=pictures.filter(p=>!p.acknowledged);
  return {corpus:source.commit,reportSha256:sha(raw),ports,sessions,
    paired:{session:smile.session,steps:[smile.step,back.step],imageWriteBytes:[smile.bytes,back.bytes],
      totalImageWriteBytes:smile.bytes+back.bytes,learnedXorBytes:smile.rects[0].width*smile.rects[0].height*2},
    totals:{ports:members.length,pictureSessions:sessions.length,osWriteBytes:sum(members,'osWriteBytes'),
      pictureBytes:sum(members,'pictureBytes'),otherWriteBytes:sum(members,'otherWriteBytes'),
      osReadBytes:sum(members,'osReadBytes'),pictureAckBytes:sum(members,'pictureAckBytes'),
      otherReadBytes:sum(members,'otherReadBytes'),fullPictures:pictures.filter(p=>!p.base).length,
      fullPictureBytes:sum(pictures.filter(p=>!p.base),'bytes'),
      confirmedPictures:confirmed.length,confirmedImageBytes:sum(confirmed,'bytes'),
      unconfirmedPictures:unconfirmed.length,unconfirmedImageBytes:sum(unconfirmed,'bytes'),
      confirmedLoads:confirmed.filter(p=>p.slot==='learn').length,unconfirmedLoads:unconfirmed.filter(p=>p.slot==='learn').length,
      confirmedReferences:confirmed.filter(p=>p.slot==='reference').length,
      unconfirmedReferences:unconfirmed.filter(p=>p.slot==='reference').length},
    method:'COBS bytes include CRC, delimiters and any leading separator. ACK requires the same session, ID and checksum. The full captured streams include scripted preview actions and faults.'};
}

async function measureWindows(input) {
  const report=JSON.parse(fs.readFileSync(path.join(input,'report.json')));
  assert(report.passed,'Need a completed ordinary-settings fixture');
  const wire=await import('../../src/pet/robot/wire.js');
  const {decodeUpdate}=await import('../../src/pet/robot/codec.js');
  const branches={};
  for(const profile of ['h20','h17','h15']) {
    const dir=path.join(input,profile,'port-01-COM42');
    const centred=new Map();
    const stream=collect(dir,wire,decodeUpdate,(p,pixels)=>{
      const visible=Buffer.alloc(480*480*2),rawPixels=rgbBytes(pixels);
      for(let y=0;y<480;y++) rawPixels.copy(visible,y*960,((y+12)*504+12)*2,((y+12)*504+492)*2);
      centred.set(p.session+'/'+p.id,sha(visible));
    });
    const receipts=report.cases[profile].frames;
    const pictures=Object.entries(receipts).map(([name,p])=>{
      const actual=stream.pictures.find(i=>i.session===p.session && i.id===p.id);
      assert(actual && actual.acknowledged && actual.checksum===p.checksum,name);
      assert.equal(p.liveScanAtAckSha256,sha(fs.readFileSync(path.join(dir,p.step+'.scan'))));
      const headOn=fs.readFileSync(path.join(input,profile,'head-on',p.centredScanStep+'.scan'));
      assert.equal(p.scanSha256,sha(headOn));
      assert.equal(centred.get(p.session+'/'+p.id),p.scanSha256,'Reconstructed centre differs for '+name);
      return {name,bytes:actual.bytes,pixelsSha256:actual.sha256,scanSha256:p.scanSha256,
        liveScanAtAckSha256:p.liveScanAtAckSha256,
        encoding:actual.capturedPixels?'capture':actual.showCapture?'show':'standard'};
    });
    const hello=packets(fs.readFileSync(path.join(dir,'app-reads.aap')),wire).filter(p=>p.type===wire.TYPE.D_HELLO);
    const confirmed=stream.pictures.filter(p=>p.acknowledged);
    branches[profile]={pictures,inputSha256:stream.inputSha256,outputSha256:stream.outputSha256,
      confirmedImageBytes:sum(confirmed,'bytes'),unconfirmedImageBytes:stream.pictureBytes-sum(confirmed,'bytes'),
      imageWriteBytes:stream.pictureBytes,otherWriteBytes:stream.otherWriteBytes,pictureAckBytes:stream.pictureAckBytes,
      helloCount:hello.length,helloBytes:sum(hello,'bytes'),otherReadBytes:stream.otherReadBytes-sum(hello,'bytes')};
  }
  const h20=branches.h20;
  for(const p of h20.pictures) {
    for(const legacy of [branches.h17,branches.h15]) {
      const old=legacy.pictures.find(other=>other.name===p.name);
      assert.equal(p.pixelsSha256,old.pixelsSha256,p.name);
      assert.equal(p.scanSha256,old.scanSha256,p.name);
    }
  }
  return {recordedCommit:report.source,uiReportSha256:sha(fs.readFileSync(path.join(input,'report.json'))),
    selectedSteps:h20.pictures.length,branches,
    method:'Actual writes and ACKs at the ordinary Settings entry. The centred LCD readback from a second pass is verified against the independent wire reconstruction for each state. Live VIEW and scan timing are preserved separately.'};
}

if(require.main===module) (async()=>{
  const args=process.argv.slice(2), windows=args[0]==='--windows';
  if(windows) args.shift();
  const [input,output]=args;
  if(!input || !output) throw Error('Usage: node measure-expression-cache.cjs [--windows] <UI directory> <output.json>');
  const result=windows ? await measureWindows(input) : await baseline(input);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(windows?output:JSON.stringify({paired:result.paired,totals:result.totals},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});

module.exports={baseline,packets};
