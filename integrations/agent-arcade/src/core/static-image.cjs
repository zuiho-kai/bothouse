'use strict';

// Bounded structural validation shared by QQ and the standalone social server.
const MAX_INPUT=8*1024*1024,MAX_PIXELS=16*1024*1024,MAX_EDGE=8192;
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const fail=code=>{throw Object.assign(Error(code),{code});};

const EXIF_HEADER=Buffer.from('Exif\0\0','ascii');

function readExifOrientation(app1){
  if(app1.length<14||!app1.subarray(0,6).equals(EXIF_HEADER))return;
  const tiff=app1.subarray(6),order=tiff.toString('ascii',0,2);
  if(order!=='II'&&order!=='MM')return;
  const littleEndian=order==='II';
  const view=new DataView(tiff.buffer,tiff.byteOffset,tiff.length);
  if(view.getUint16(2,littleEndian)!==42)return;
  const directory=view.getUint32(4,littleEndian);
  if(directory<8||directory>tiff.length-2)return;
  const count=view.getUint16(directory,littleEndian),start=directory+2;
  if(count>Math.floor((tiff.length-start)/12))return;
  for(let offset=start;offset<start+count*12;offset+=12){
    if(view.getUint16(offset,littleEndian)!==0x0112)continue;
    if(view.getUint16(offset+2,littleEndian)!==3||view.getUint32(offset+4,littleEndian)!==1)return;
    const orientation=view.getUint16(offset+8,littleEndian);
    if(orientation>=1&&orientation<=8)return orientation;
    return;
  }
}

function size(width,height){if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>MAX_EDGE||height>MAX_EDGE||width*height>MAX_PIXELS)fail('image_too_large');return {width,height};}
function png(bytes,{canonical=false}={}){
  if(bytes.length<45||!bytes.subarray(0,8).equals(SIGNATURE))fail('image_invalid');
  let offset=8,dimensions,ended=false,data=false;const chunks=[];
  while(offset<bytes.length){
    if(offset+12>bytes.length)fail('image_invalid');const length=bytes.readUInt32BE(offset),end=offset+12+length;if(end>bytes.length)fail('image_invalid');
    const kind=bytes.toString('ascii',offset+4,offset+8);if(!/^[A-Za-z]{4}$/.test(kind))fail('image_invalid');
    if(offset===8){if(kind!=='IHDR'||length!==13)fail('image_invalid');dimensions=size(bytes.readUInt32BE(offset+8),bytes.readUInt32BE(offset+12));}
    else if(kind==='IHDR')fail('image_invalid');
    if(['acTL','fcTL','fdAT'].includes(kind))fail('image_animated');if(kind==='IDAT')data=true;
    if(kind==='IEND'){if(length!==0||end!==bytes.length||!data)fail('image_invalid');ended=true;}
    // Keep only pixel/essential palette and colour-transparency data in output.
    // Ancillary text, EXIF, timestamps and other original metadata are excluded.
    if(canonical&&['IHDR','PLTE','tRNS','IDAT','IEND'].includes(kind))chunks.push(bytes.subarray(offset,end));
    offset=end;
  }
  if(!ended)fail('image_invalid');return {...dimensions,...(canonical?{bytes:Buffer.concat([SIGNATURE,...chunks])}:{})};
}
function jpeg(bytes,includeOrientation){
  if(bytes.length<12||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)fail('image_invalid');
  let offset=2,dimensions,orientation;
  while(offset<bytes.length-2){
    if(bytes[offset++]!==255)fail('image_invalid');while(bytes[offset]===255)offset++;const marker=bytes[offset++];
    if(marker===218){if(!dimensions)fail('image_invalid');return includeOrientation?{...dimensions,orientation:orientation??1}:dimensions;}
    if([0,1,216,217].includes(marker)||(marker>=208&&marker<=215)||offset+2>bytes.length)fail('image_invalid');
    const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)fail('image_invalid');
    if(includeOrientation&&marker===225&&orientation===undefined)orientation=readExifOrientation(bytes.subarray(offset+2,offset+length));
    if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){
      if(![192,193,194].includes(marker)||dimensions||length<8||bytes[offset+2]!==8)fail('image_format');dimensions=size(bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3));
    }
    offset+=length;
  }
  fail('image_invalid');
}
function dimensions(bytes,extension,{includeOrientation=false}={}){
  if(!Buffer.isBuffer(bytes)||bytes.length>MAX_INPUT)fail('image_too_large');
  if(extension==='.png')return png(bytes);
  if(['.jpg','.jpeg'].includes(extension))return jpeg(bytes,includeOrientation);fail('image_format');
}

// Preserve JPEG scan data. Rebuild only the one EXIF field that describes
// how the encoded pixels should be displayed, without copying the source IFD.
function jpegPixels(bytes){
  const {orientation}=dimensions(bytes,'.jpg',{includeOrientation:true});
  const parts=[bytes.subarray(0,2)];
  if(orientation!==1){
    const marker=Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000100000000000000','hex');
    marker[28]=orientation;
    parts.push(marker);
  }
  let offset=2, scan=false;
  while(offset<bytes.length){
    const start=offset;
    if(scan){
      let marker=bytes.indexOf(255,offset);
      while(marker>=0){
        offset=marker+1;
        while(bytes[offset]===255)offset++;
        const tag=bytes[offset];
        if(tag!==0&&(tag<208||tag>215))break;
        marker=bytes.indexOf(255,offset+1);
      }
      if(marker<0||offset>=bytes.length)fail('image_invalid');
      parts.push(bytes.subarray(start,marker));
      offset=marker;
      scan=false;
      continue;
    }
    if(bytes[offset++]!==255)fail('image_invalid');
    while(bytes[offset]===255)offset++;
    const tag=bytes[offset++];
    if(tag===217&&offset===bytes.length)return Buffer.concat([...parts,bytes.subarray(start,offset)]);
    if(offset+2>bytes.length)fail('image_invalid');
    const length=bytes.readUInt16BE(offset);
    if(length<2||offset+length>bytes.length)fail('image_invalid');
    offset+=length;
    if(tag>=224&&tag<=239||tag===254)continue; // APP metadata and COM.
    if(![192,193,194,196,218,219,221].includes(tag))fail('image_format');
    parts.push(bytes.subarray(start,offset));
    scan=tag===218;
  }
  fail('image_invalid');
}

function modelPhoto(bytes,mime){
  if(mime==='image/png')return png(bytes,{canonical:true}).bytes;
  if(mime==='image/jpeg')return jpegPixels(bytes);
  fail('image_format');
}

module.exports={size,png,dimensions,readExifOrientation,modelPhoto};
