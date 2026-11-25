'use strict';
const {createHash}=require('node:crypto');
const {validateImagePayload,readSelected,QQMediaError}=require('./qq-media.cjs');
const {writeOwnedFile}=require('./qq-group-selected-file.cjs');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

function saveSelectedImage(root,scope,bytes,fileFor){
  const row={...scope,...validateImagePayload(bytes),sha256:digest(bytes)};
  writeOwnedFile(fileFor(root,row),bytes);
  return row;
}
async function readSelectedImage(root,row,{signal,assertCurrent},fileFor){
  assertCurrent();
  const bytes=await readSelected(fileFor(root,row),signal);
  try{
    assertCurrent();
    if(digest(bytes)!==row.sha256)throw new QQMediaError('changed');
    return bytes;
  }catch(error){bytes.fill(0);throw error;}
}
module.exports={saveSelectedImage,readSelectedImage};
