'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {dimensions}=require('../../src/core/static-image.cjs');

// Original Agent Arcade artwork. Editable sources and AGPL notice live beside the PNGs.
const names={ju:'橘娘',whale:'鲸鱼娘',dragon:'龙娘'};
const moods={happy:'开心地笑',approve:'表示赞同',surprised:'惊讶',annoyed:'有点不满'};
const catalog=new Map();
for(const character of ['ju','whale','dragon']){
  for(const mood of ['happy','approve',character==='ju'?'annoyed':'surprised']){
    catalog.set(character+'-'+mood,{label:names[character]+' · '+moods[mood]});
  }
}
const pictures=new Map();
function bundledSticker(id){
  const entry=catalog.get(id);
  if(!entry)return null;
  if(pictures.has(id))return pictures.get(id);
  try {
    const bytes=fs.readFileSync(path.join(__dirname,'../assets/stickers',id+'.png'));
    if(bytes.length>256*1024)return null;
    const picture={bytes,mime:'image/png',...dimensions(bytes,'.png'),label:entry.label,
      digest:createHash('sha256').update(bytes).digest('hex')};
    pictures.set(id,picture);
    return picture;
  } catch {return null;}
}
function bundledStickerOptions(){
  return [...catalog].filter(([id])=>bundledSticker(id)).map(([id,{label}])=>({id,label}));
}
module.exports={bundledSticker,bundledStickerOptions,moods};
