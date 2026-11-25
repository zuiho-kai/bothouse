'use strict';

const stickerMoods=Object.freeze({happy:'开心、大笑',annoyed:'无语、嫌弃',surprised:'震惊、惊讶',
  sad:'难过、委屈',confused:'疑惑、懵',approve:'点赞、同意'});
const stickerCodes=new Map(Object.keys(stickerMoods).map(mood=>[`[[sticker:${mood}]]`,mood]));

function stickerChoice(text){return stickerCodes.get(text.trim());}
function stickerOptions(moods){
  return [...stickerCodes].filter(([,mood])=>moods.includes(mood))
    .map(([code,mood])=>`${code} (${stickerMoods[mood]})`).join(', ');
}

module.exports={stickerMoods,stickerCodes,stickerChoice,stickerOptions};
