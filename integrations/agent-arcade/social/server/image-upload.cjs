'use strict';

const {createHash}=require('node:crypto');
const {dimensions,modelPhoto}=require('../../src/core/static-image.cjs');
const {fail}=require('./store.cjs');
const busyLimit=8;
let reading=0;
let readingPosts=0;
const imageFormats=['image/png','image/jpeg'];
const maxImageBytes=4*1024*1024;
const maxPostImages=3;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

async function attachmentBytes(req,maxBytes,tooLarge) {
  if(Number(req.headers['content-length'])>maxBytes)tooLarge();
  let count=0;
  const chunks=[];
  for await(const chunk of req.iterator({destroyOnReturn:false})){
    count+=chunk.length;
    if(count>maxBytes)tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,count);
}

async function readAttachment(req,{formats,maxBytes,kind,formatError,sizeError,validate}){
  const clientId=req.headers['x-social-client-id'];
  if(typeof clientId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(clientId))
    fail(400,'client_id','消息重试编号无效');
  const mime=req.headers['content-type'];
  if(!formats.includes(mime))fail(415,kind+'_format',formatError);
  if(reading>=busyLimit)fail(429,kind+'_busy','附件上传正忙，请稍后重试');
  reading++;
  try {
    const bytes=await attachmentBytes(req,maxBytes,()=>fail(413,kind+'_too_large',sizeError));
    return {clientId,mime,bytes,...validate(bytes,mime),digest:digest(bytes)};
  } finally {reading--;}
}

function validateImage(bytes,mime){
  try{return dimensions(bytes,mime==='image/png'?'.png':'.jpg');}
  catch(error){
    if(error.code==='image_too_large')fail(413,'image_too_large','图片尺寸过大');
    fail(422,'image_invalid','图片损坏、格式不符或含动画，请重新选择');
  }
}

function readImageUpload(req){
  return readAttachment(req,{formats:imageFormats,maxBytes:maxImageBytes,kind:'image',
    formatError:'只支持静态 PNG 或 JPEG',sizeError:'图片不能超过 4 MB',validate:validateImage});
}

async function readFeedPostUpload(req){
  if(readingPosts>=2)fail(429,'feed_upload_busy','动态图片上传正忙，请稍后重试');
  readingPosts++;
  try{
    const bytes=await attachmentBytes(req,maxPostImages*maxImageBytes+65536,
      ()=>fail(413,'feed_image_limit','每条动态最多 3 张图片，每张不超过 4 MB'));
    let form;
    try{form=await new Response(bytes,{headers:{'Content-Type':req.headers['content-type']}}).formData();}
    catch{fail(400,'feed_request','动态上传格式无效');}
    const body={}, files=[];
    for(const [name,value] of form){
      if(name==='images'){
        if(typeof value==='string')fail(400,'feed_request','动态图片格式无效');
        files.push(value);
      }else{
        if(!['clientId','text','expectedAccount'].includes(name)||typeof value!=='string'||Object.hasOwn(body,name))
          fail(400,'feed_request','发布请求无效');
        body[name]=value;
      }
    }
    if(files.length<1||files.length>maxPostImages)
      fail(400,'feed_image_limit','每条动态可发 1 到 3 张图片');
    const images=[];
    for(const file of files){
      if(!imageFormats.includes(file.type))fail(415,'image_format','只支持静态 PNG 或 JPEG');
      if(file.size>maxImageBytes)fail(413,'image_too_large','图片不能超过 4 MB');
      const bytes=Buffer.from(await file.arrayBuffer());
      validateImage(bytes,file.type);
      images.push({mime:file.type,bytes,digest:digest(bytes)});
    }
    return {body,images};
  }finally{readingPosts--;}
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
module.exports={readImageUpload,readAttachment,readAvatarUpload,readFeedPostUpload};
