'use strict';

const {createHash}=require('node:crypto');
const {dimensions,modelPhoto}=require('../../src/core/static-image.cjs');
const {fail}=require('./store.cjs');
const busyLimit=8;
let reading=0;

async function readAttachment(req,{formats,maxBytes,kind,formatError,sizeError,validate}){
  const clientId=req.headers['x-social-client-id'];
  if(typeof clientId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(clientId))
    fail(400,'client_id','消息重试编号无效');
  const mime=req.headers['content-type'];
  if(!formats.includes(mime))fail(415,kind+'_format',formatError);
  if(Number(req.headers['content-length'])>maxBytes)fail(413,kind+'_too_large',sizeError);
  if(reading>=busyLimit)fail(429,kind+'_busy','附件上传正忙，请稍后重试');
  reading++;
  try {
    let count=0;
    const chunks=[];
    for await(const chunk of req.iterator({destroyOnReturn:false})) {
      count+=chunk.length;
      if(count>maxBytes)fail(413,kind+'_too_large',sizeError);
      chunks.push(chunk);
    }
    const bytes=Buffer.concat(chunks,count);
    const metadata=validate(bytes,mime);
    return {clientId,mime,bytes,...metadata,digest:createHash('sha256').update(bytes).digest('hex')};
  } finally {reading--;}
}

function readImageUpload(req){
  return readAttachment(req,{formats:['image/png','image/jpeg'],maxBytes:4*1024*1024,kind:'image',
    formatError:'只支持静态 PNG 或 JPEG',sizeError:'图片不能超过 4 MB',validate(bytes,mime){
      try{return dimensions(bytes,mime==='image/png'?'.png':'.jpg');}
      catch(error){
        if(error.code==='image_too_large')fail(413,'image_too_large','图片尺寸过大');
        fail(422,'image_invalid','图片损坏、格式不符或含动画，请重新选择');
      }
    }});
}
async function readAvatarUpload(req){
  const image=await readAttachment(req,{formats:['image/png','image/jpeg'],maxBytes:1024*1024,kind:'avatar',
    formatError:'头像只支持静态 PNG 或 JPEG',sizeError:'头像不能超过 1 MB',
    validate(bytes,mime){
      let size;
      try {size=dimensions(bytes,mime==='image/png'?'.png':'.jpg');}
      catch(error){
        if(error.code==='image_too_large')fail(413,'avatar_too_large','头像尺寸过大');
        fail(422,'avatar_invalid','头像损坏、格式不符或含动画');
      }
      if(size.width>1024||size.height>1024)fail(413,'avatar_too_large','头像边长不能超过 1024 像素');
      return size;
    }});
  try {return {mime:image.mime,bytes:modelPhoto(image.bytes,image.mime)};}
  catch {fail(422,'avatar_invalid','无法处理此头像，请重新选择');}
}
module.exports={readImageUpload,readAttachment,readAvatarUpload};
