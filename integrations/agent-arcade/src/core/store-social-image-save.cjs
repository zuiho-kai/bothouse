'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {dimensions} = require('./static-image.cjs');

const maxImageBytes = 4 * 1024 * 1024;
const extension = {'image/png':'png','image/jpeg':'jpg'};

async function boundedBytes(response,max) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > max) {
    response.body?.cancel().catch(()=>{});
    throw Error('Social response unavailable');
  }
  const chunks=[];
  let length=0;
  for await(const chunk of response.body) {
    length+=chunk.byteLength;
    if(length>max)throw Error('Social response too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,length);
}

async function saveBytes(file,bytes,current) {
  const staging=path.join(path.dirname(file),'.arcade-image-'+randomUUID()+'.tmp');
  const handle=await fs.open(staging,'wx',0o600);
  try {
    try {await handle.writeFile(bytes);}
    finally {await handle.close();}
    if(current())await fs.rename(staging,file);
  } finally {
    await fs.rm(staging,{force:true});
  }
}

function createSocialImageSaver(window,dialog) {
  let busy=false;
  return async ({browserSession,url,mime,current})=>{
    if(busy||!current())return;
    busy=true;
    try {
      const origin=new URL(url).origin;
      const request=(target,headers)=>browserSession.fetch(target,{
        credentials:'include',redirect:'error',cache:'no-store',
        signal:AbortSignal.timeout(12000),headers,
      });
      const who=await request(origin+'/api/v1/me');
      const {user}=JSON.parse(await boundedBytes(who,8192));
      if(typeof user?.number!=='string'||!/^[a-z0-9_]{4,24}$/u.test(user.number))throw Error('Social session unavailable');
      if(!current())return;
      const ext=extension[mime];
      if(!ext)throw Error('Unsupported social image');
      const result=await dialog.showSaveDialog(window,{
        title:'保存图片',defaultPath:'聊天图片.'+ext,
        filters:[{name:mime==='image/png'?'PNG 图片':'JPEG 图片',extensions:[ext]}],
      });
      if(result.canceled||!current())return;
      if(!path.isAbsolute(result.filePath))throw Error('No local save path');
      // Obtain the original after the chooser. The browser's canceled
      // download never provides bytes for the local write.
      const response=await request(url,{'X-Social-Account':user.number});
      if(response.headers.get('content-type')!==mime){
        response.body?.cancel().catch(()=>{});
        throw Error('Social image unavailable');
      }
      const bytes=await boundedBytes(response,maxImageBytes);
      dimensions(bytes,'.'+ext);
      if(current())await saveBytes(result.filePath,bytes,current);
    } catch {
      if(current())await dialog.showMessageBox(window,{
        type:'warning',title:'图片未保存',message:'这张图片暂时无法保存。请检查会话权限或保存位置。',
        buttons:['确定'],
      });
    } finally {busy=false;}
  };
}

module.exports={createSocialImageSaver};
