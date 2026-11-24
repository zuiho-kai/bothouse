'use strict';
// Reconstruct each committed App picture from its captured AAP stream and
// compare its CRC and matching ACK with the board endpoint's actual scanout.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const sha=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
async function inspectPictures(dir,onCommit,dropped){
 const {TYPE,StreamReader,FrameAssembler,pictureCRC32,parsePictureAck}=await import('../../src/pet/robot/wire.js');
 const {decodeUpdate}=await import('../../src/pet/robot/codec.js');
 const steps=fs.readdirSync(dir).filter(n=>/^\d+\.in$/.test(n)).map(n=>parseInt(n,10)).sort((a,b)=>a-b);
 const stream=new StreamReader(),frames=new FrameAssembler();
 let pixels=new Uint16Array(504*504),tileCount=0,maxTile=0;
 const pictures=[];
 for(const step of steps){
   for(const {type,payload} of stream.push(fs.readFileSync(path.join(dir,step+'.in')))){
     if(type===TYPE.PICTURE_BEGIN){
       if(Buffer.from(payload).readUInt32LE(8)===0)pixels.fill(0);
       tileCount=0;maxTile=0;
     }
     const rect=frames.accept(type,payload);
     if(rect){assert(rect.data.length<=32768);decodeUpdate(pixels,504,504,rect,rect.data);tileCount++;maxTile=Math.max(maxTile,rect.data.length);}
     if(type!==TYPE.PICTURE_COMMIT)continue;
     const ack=parsePictureAck(payload);
     assert.equal(pictureCRC32(pixels),ack.checksum);
     const board=new StreamReader().push(fs.readFileSync(path.join(dir,step+'.out')));
     const confirmed=board.some(p=>p.type===TYPE.D_PICTURE_ACK&&Buffer.from(p.payload).equals(Buffer.from(payload)));
     if(!confirmed&&dropped?.(step,ack))continue;
     assert(confirmed,'missing board commit ACK at step '+step);
     const scan=fs.readFileSync(path.join(dir,step+'.scan'));assert.equal(scan.length,480*480*2);
     const centered=Buffer.alloc(scan.length),raw=Buffer.from(pixels.buffer);
     for(let y=0;y<480;y++){const off=((y+12)*504+12)*2;raw.copy(centered,y*960,off,off+960);}
     const scanMatchesCentered=scan.equals(centered);
     pictures.push({step,...ack,tiles:tileCount,maxTile,pixelsSha256:sha(raw),scanSha256:sha(scan),scanMatchesCentered});
     if(onCommit)onCommit(pictures.at(-1),pixels,scan);
   }
 }
 return pictures;
}
module.exports={inspectPictures};
