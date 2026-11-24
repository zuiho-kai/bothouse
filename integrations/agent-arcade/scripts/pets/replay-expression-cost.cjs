'use strict';
// Replay the archived RGB565 sources and observed ACK boundaries through the
// current delivery/link. Optional host executables also verify both encodings
// on the real firmware loop, using the file-backed USB and LCD peripherals.
// node replay-expression-cost.cjs <H17 ui> <new output dir> [H17.exe H20.exe]
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {baseline,packets}=require('./measure-expression-cache.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');

async function run(input,out,oldExe,newExe) {
  const samples=new Map();
  const original=await baseline(input,(p,pixels,raw)=>samples.set(p.session+'/'+p.id,{pixels,raw}));
  const wire=await import('../../src/pet/robot/wire.js');
  const {RobotDriver}=await import('../../src/pet/robot/driver.js');
  const {PictureDelivery}=await import('../../src/pet/robot/picture-delivery.js');
  const {RobotLink}=await import('../../src/pet/robot/link.js');
  const {SCREENS}=await import('../../src/pet/robot/screen.js');
  const root=path.resolve(__dirname,'../..');
  const sources=['scripts/pets/measure-expression-cache.cjs','scripts/pets/replay-expression-cost.cjs',
    'src/pet/robot/driver.js','src/pet/robot/picture-delivery.js','src/pet/robot/link.js','src/pet/robot/wire.js',
    'src/pet/robot/codec.js','src/pet/robot/screen.js'];
  const result={source:original.corpus,paired:original.paired,
    checkout:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout?.trim() || null,
    sourceSha256:Object.fromEntries(sources.map(f=>[f,sha(fs.readFileSync(path.join(root,f)))])),modes:{}};
  const pairedInputs={};
  fs.mkdirSync(out,{recursive:true});
  for(const mode of ['legacy','upgraded','keep-h15']) {
    const rows=[], totals={confirmedImageBytes:0,unconfirmedImageBytes:0,helloDeltaBytes:0,
      imageBytes:0,ackBytes:original.totals.pictureAckBytes,otherWriteBytes:original.totals.otherWriteBytes,
      oldHelloBytes:0,newHelloBytes:0}, selected=[];
    for(const [name,port] of Object.entries(original.ports)) {
      const upstream=packets(fs.readFileSync(path.join(input,name,'app-reads.aap')),wire);
      const writes=fs.readFileSync(path.join(input,name,'app-writes.aap'));
      const messages=packets(writes,wire);
      const greetings=new Map();
      for(const pkt of upstream.filter(p=>p.type===wire.TYPE.D_HELLO)) {
        const hello=JSON.parse(pkt.payload);
        const upgraded=mode==='upgraded' || (mode==='keep-h15' && hello.firmware!=='0.1.0-s3');
        if(upgraded) {hello.firmware='0.3.0-s3';hello.pictureCachePixels=32768;}
        const payload=upgraded ? Buffer.from(JSON.stringify(hello)) : pkt.payload;
        const packet=wire.framed(pkt.type,pkt.seq,payload);
        // The OS port adds its own delimiter before each D_HELLO.
        const newBytes=pkt.bytes+packet.length-wire.framed(pkt.type,pkt.seq,pkt.payload).length;
        totals.oldHelloBytes+=pkt.bytes;totals.newHelloBytes+=newBytes;
        totals.helloDeltaBytes+=newBytes-pkt.bytes;
        greetings.set(hello.pictureSession,packet);
      }
      let live,seqOffset=0,idOffset=0;
      for(const p of port.pictures) {
        const {raw,pixels}=samples.get(p.session+'/'+p.id), old=packets(raw,wire);
        if(!live || live.session!==p.session) {
          const link=new RobotLink({skin:'#211713',checkHello:wire.isRoundDisplayHello});
          // These are the same producer methods used by the renderer. The
          // boundary here is the frozen picture, not the historical UI clock.
          const driver=Object.create(RobotDriver.prototype), chunks=[];
          driver.spec=SCREENS['ju-portrait-480'];driver.screen={contentWidth:504,contentHeight:504,cue:'',touch:null};
          driver.getMaxFrameBytes=()=>link.maxFrameBytes;
          driver.send=message=>{chunks.push(...link.bytesFor(message));return true;};
          driver.pictures=new PictureDelivery(driver);link.bindDriver(driver);
          // Keep archived IDs, so the recorded peer ACKs are genuine inputs.
          const getRandom=crypto.getRandomValues;
          try {crypto.getRandomValues=a=>{a[0]=p.session;return a;};link.hello();}
          finally {crypto.getRandomValues=getRandom;}
          link.receive(greetings.get(p.session));
          assert.equal(driver.pictures.session,p.session,'Valid negotiated peer');
          live={session:p.session,link,driver,chunks};
          if(p.session===original.paired.session) {
            const greeting=messages.find(m=>m.type===wire.TYPE.HELLO && m.payload.readUInt32LE(3)===p.session);
            selected.push(writes.subarray(greeting.end-greeting.bytes,greeting.end));
          }
        }
        const {driver,link,chunks}=live;
        driver.capturePixels=()=>pixels.slice();
        driver.screen.touch=p.kind==='smile'?'poke':p.kind==='other-change'?'huff':null;
        driver.screen.cue='';
        link.seq=(old[0].seq+seqOffset)&255;
        const oldTile=old.find(f=>f.type===wire.TYPE.FRAME_BEGIN);
        assert(oldTile);link.frameId=(oldTile.payload.readUInt16LE(0)-1+idOffset)&65535;
        driver.sendFrame();
        const encoded=Buffer.concat(chunks);chunks.length=0;
        const fresh=packets(encoded,wire), last=fresh.at(-1);
        assert(last.type===wire.TYPE.PICTURE_COMMIT || last.type===wire.TYPE.PICTURE_CAPTURE);
        assert.equal(last.payload.readUInt32LE(0),p.session);
        assert.equal(last.payload.readUInt32LE(4),p.id);
        assert.equal(last.payload.readUInt32LE(8),p.checksum);
        if(mode==='legacy')assert(raw.equals(encoded),'Legacy replay must reproduce original picture bytes');
        if(p.acknowledged) {
          const ack=upstream.find(m=>m.type===wire.TYPE.D_PICTURE_ACK && m.payload.equals(last.payload.subarray(0,12)));
          assert(ack);link.receive(wire.framed(ack.type,ack.seq,ack.payload));
          assert.equal(driver.pictures.confirmedId,p.id);
        }
        seqOffset+=fresh.length-old.length;
        idOffset+=fresh.filter(f=>f.type===wire.TYPE.FRAME_BEGIN).length-p.rects.length;
        const capture=last.type===wire.TYPE.PICTURE_CAPTURE, show=fresh.find(f=>f.type===wire.TYPE.PICTURE_SHOW);
        rows.push({port:name,session:p.session,id:p.id,step:p.step,kind:p.kind,acknowledged:p.acknowledged,
          oldBytes:p.bytes,newBytes:encoded.length,sha256:sha(encoded),
          encoding:capture?'capture':show?'show':'standard',imageSha:p.sha256});
        totals.imageBytes+=encoded.length;
        totals[p.acknowledged?'confirmedImageBytes':'unconfirmedImageBytes']+=encoded.length;
        if(p.session===original.paired.session && p.id<=3) selected.push(encoded);
      }
    }
    const pair=rows.filter(r=>r.session===original.paired.session && [2,3].includes(r.id));
    assert.equal(pair.length,2);
    result.modes[mode]={rows,totals:{...totals,paired:pair.map(r=>r.newBytes),
      osWriteBytes:totals.imageBytes+totals.otherWriteBytes,
      osReadBytes:original.totals.osReadBytes+totals.helloDeltaBytes},profileAssumption:{
        legacy:'The exact original H15/H17 firmware advertisements.',
        upgraded:'Each of the six picture sessions is re-advertised as cache-capable H20.',
        'keep-h15':'The H15 display-only branch stays legacy; the five H17 picture sessions advertise H20.',
      }[mode]};
    pairedInputs[mode]=selected;
  }
  if(oldExe && newExe) {
    result.hostPair={};
    for(const [mode,exe] of [['legacy',oldExe],['upgraded',newExe]]) {
      const dir=fs.mkdtempSync(path.join(out,mode+'-endpoint-'));
      fs.writeFileSync(path.join(dir,'boot.contact'),Buffer.of(0));
      pairedInputs[mode].forEach((bytes,i)=>fs.writeFileSync(path.join(dir,(i+1)+'.in'),bytes));
      const steps=pairedInputs[mode].map((_,i)=>[i+1,250*(i+1),719,3].join(' ')).join('\n')+'\n0 0 1 0\n';
      const child=spawnSync(path.resolve(exe),[],{cwd:dir,input:steps,encoding:'utf8',windowsHide:true,timeout:20000});
      fs.writeFileSync(path.join(dir,'host.log'),(child.stdout||'')+(child.stderr||''));
      assert.equal(child.status,0,'Host endpoint failed; see '+dir);
      const peer=packets(fs.readFileSync(path.join(dir,'1.out')),wire).find(p=>p.type===wire.TYPE.D_HELLO);
      assert(peer);const h=JSON.parse(peer.payload);
      assert.equal(h.pictureSession,original.paired.session);
      assert.equal(Boolean(h.pictureCachePixels),mode==='upgraded');
      const replies=[];
      for(const id of [1,2,3]) {
        const p=original.ports['contact/port-01-COM42'].pictures[id-1];
        const down=fs.readFileSync(path.join(dir,(id+1)+'.out'));
        const ack=packets(down,wire).find(m=>m.type===wire.TYPE.D_PICTURE_ACK);
        assert(ack);assert.deepEqual(wire.parsePictureAck(ack.payload),{session:p.session,id,checksum:p.checksum});
        const content=fs.readFileSync(path.join(dir,(id+1)+'.content'));
        assert.equal(sha(content),p.sha256);
        const scan=fs.readFileSync(path.join(dir,(id+1)+'.scan'));
        const centred=Buffer.alloc(480*480*2);
        for(let y=0;y<480;y++) content.copy(centred,y*960,((y+12)*504+12)*2,((y+12)*504+492)*2);
        assert(scan.equals(centred),'Expected centred LCD framebuffer');
        replies.push({id,ackBytes:ack.bytes,contentSha:sha(content),scanSha:sha(scan)});
      }
      result.hostPair[mode]={directory:path.basename(dir),endpointSha:sha(fs.readFileSync(exe)),
        hello:h,helloBytes:peer.bytes,replies};
    }
    assert.deepEqual(result.hostPair.legacy.replies,result.hostPair.upgraded.replies);
  }
  result.method='Mapped delivery preserves the six archived session/picture IDs and observed ACK outcomes; control, VIEW, touch and non-HELLO status traffic are held fixed. The optional four-step H17/H20 host pair separately executes both firmware programs from cold start with centred VIEW on a fixture clock.';
  fs.writeFileSync(path.join(out,'replay-cost.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(result.modes).map(([name,m])=>[name,m.totals])),null,2));
}

if(require.main===module) {
  const args=process.argv.slice(2);
  if(![2,4].includes(args.length)) throw Error('Expected <H17 UI> <output dir> [H17 endpoint H20 endpoint]');
  run(...args).catch(e=>{console.error(e);process.exitCode=1;});
}
