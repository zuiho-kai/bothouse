'use strict';
const { deflateSync } = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const theme = require('../themes/workshop.json');
const BRAND = Object.freeze({
  file: 'ribbon-simple-v1.png',
  sha256: '8c559b4c2356abfbae288b3f614101e7fc85fa9557d0f52f158f33ba5144981a',
  width: 1374, height: 1145,
  // Reversible preview candidate: preserve both ribbon tails and the full canvas.
  fit: 'contain'
});
const ICON_SIZES = Object.freeze([16,20,24,32,40,48,64,128,256]);
// macOS bundle icon: one 1024 px square PNG (the source is 1374 px wide, so this
// is a downscale). electron-builder converts it to .icns on a Mac.
const MAC_ICON_SIZE = 1024, MAC_ICON_FILE = 'app-mac.png';
function crc32(bytes) { let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0; }
function chunk(type, bytes) { const data=Buffer.concat([Buffer.from(type),bytes]),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(bytes.length);crc.writeUInt32BE(crc32(data));return Buffer.concat([size,data,crc]); }
function createIcon(scale=2) {
  const size=16*scale, rows=[];
  for(let y=0;y<size;y++) { const row=Buffer.alloc(1+size*4);for(let x=0;x<size;x++){const key=theme.sprites.idle[Math.floor(y/scale)][Math.floor(x/scale)];if(key==='.'){row.set([32,60,52,255],1+x*4);continue;}const color=theme.palette[key];row.set([parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5,7),16),255],1+x*4);}rows.push(row); }
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}
function readBrandSource() {
  const bytes = fs.readFileSync(path.join(__dirname,'../assets/brand',BRAND.file));
  if (createHash('sha256').update(bytes).digest('hex') !== BRAND.sha256) throw new Error('brand_source_invalid');
  return bytes;
}
function createBrandIcon(nativeImage, size=32, {allowFallback=true}={}) {
  if (!Number.isInteger(size) || size<16 || size>1024) throw new RangeError('brand_size_invalid');
  try {
    const source = nativeImage.createFromBuffer(readBrandSource());
    if (source.isEmpty()) throw new Error('brand_decode_failed');
    const dimensions = source.getSize();
    if (dimensions.width!==BRAND.width || dimensions.height!==BRAND.height) throw new Error('brand_dimensions_invalid');
    // A single resize dimension preserves aspect ratio. Copy the platform-native
    // bitmap unchanged onto transparent padding, without RGBA/BGRA conversion.
    const resized = source.resize(BRAND.width>=BRAND.height?{width:size,quality:'best'}:{height:size,quality:'best'});
    if (resized.isEmpty()) throw new Error('brand_resize_failed');
    const {width,height}=resized.getSize();
    if (!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>size||height>size||Math.max(width,height)!==size) throw new Error('brand_resize_failed');
    const bitmap=resized.toBitmap({scaleFactor:1});
    if (!Buffer.isBuffer(bitmap)||bitmap.length!==width*height*4) throw new Error('brand_bitmap_invalid');
    const square=Buffer.alloc(size*size*4),left=Math.floor((size-width)/2),top=Math.floor((size-height)/2);
    for(let y=0;y<height;y++)bitmap.copy(square,((top+y)*size+left)*4,y*width*4,(y+1)*width*4);
    const icon=nativeImage.createFromBitmap(square,{width:size,height:size,scaleFactor:1});
    if (icon.isEmpty() || icon.getSize().width!==size || icon.getSize().height!==size) throw new Error('brand_resize_failed');
    return icon;
  } catch (error) {
    if (!allowFallback) throw error;
    // Runtime resilience only: packaging always explicitly forbids this fallback.
    return nativeImage.createFromBuffer(createIcon()).resize({width:size,height:size,quality:'best'});
  }
}
function encodeIco(frames) {
  if (!Array.isArray(frames) || frames.length!==ICON_SIZES.length) throw new Error('brand_frames_invalid');
  const header=Buffer.alloc(6+16*frames.length);header.writeUInt16LE(1,2);header.writeUInt16LE(frames.length,4);
  let offset=header.length;
  for (let i=0;i<frames.length;i++) {
    const {size,png}=frames[i];
    if (size!==ICON_SIZES[i] || !Buffer.isBuffer(png) || png.length<33 || !png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || png.readUInt32BE(16)!==size || png.readUInt32BE(20)!==size) throw new Error('brand_frame_invalid');
    const at=6+16*i;header[at]=size===256?0:size;header[at+1]=header[at];header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(png.length,at+8);header.writeUInt32LE(offset,at+12);offset+=png.length;
  }
  return Buffer.concat([header,...frames.map(frame=>frame.png)]);
}
module.exports={createIcon,createBrandIcon,readBrandSource,encodeIco,BRAND,ICON_SIZES,MAC_ICON_SIZE,MAC_ICON_FILE};
