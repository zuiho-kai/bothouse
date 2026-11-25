'use strict';

const {readExifOrientation}=require('../core/static-image.cjs');

function orientNativeImage(image,orientation,nativeImage){
  if(orientation===1)return image;
  const {width,height}=image.getSize(),transposed=orientation>=5;
  const outputWidth=transposed?height:width,outputHeight=transposed?width:height;
  const flipX=[2,3,6,7].includes(orientation),flipY=[3,4,7,8].includes(orientation);
  const bytes=image.toBitmap({scaleFactor:1});
  if(!Buffer.isBuffer(bytes)||bytes.length!==width*height*4)throw Error('Invalid JPEG bitmap');
  const output=Buffer.alloc(bytes.length);
  // Move whole pixels without interpreting the native channel order.
  const source=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
  const result=new DataView(output.buffer,output.byteOffset,output.length);
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const column=transposed?y:x,row=transposed?x:y;
      const targetX=flipX?outputWidth-1-column:column,targetY=flipY?outputHeight-1-row:row;
      result.setUint32((targetY*outputWidth+targetX)*4,source.getUint32((y*width+x)*4));
    }
  }
  const oriented=nativeImage.createFromBitmap(output,{width:outputWidth,height:outputHeight,scaleFactor:1});
  const shape=oriented.getSize();
  if(oriented.isEmpty()||shape.width!==outputWidth||shape.height!==outputHeight)throw Error('Invalid oriented JPEG bitmap');
  return oriented;
}

module.exports={readExifOrientation,orientNativeImage};
