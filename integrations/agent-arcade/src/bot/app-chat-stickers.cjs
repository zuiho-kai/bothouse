'use strict';

const {groupMediaRequest}=require('./group-media-request.cjs');
const {stickerLookupReply}=require('./qq-chat-sticker.cjs');
const {stickerMoods,stickerCodes,stickerChoice,stickerOptions}=require('../core/sticker-reply.cjs');
const {allowsStickerReply}=require('./companion-reply-preference.cjs');

const marker='［表情图］';
const hint='\nIf a single reaction picture fully answers the latest message, return just one of these codes: '+
  stickerOptions(Object.keys(stickerMoods))+
  '. Otherwise reply in ordinary text. Prefer text for questions, practical information, requests for written or spoken replies, and when an image would be insensitive.';

// Hold a possible standalone code until the stream distinguishes it from prose.
function stickerStream(emit){
  let pending='',isText=false;
  return part=>{
    if(typeof part!=='string')return;
    if(isText){emit(part);return;}
    pending+=part;
    const start=pending.trim();
    if([...stickerCodes.keys()].some(code=>code.startsWith(start)))return;
    isText=true;emit(pending);pending='';
  };
}

function stickerIntent(text,roleId,roleName){
  if(/^(?:请你?|麻烦你?)?(?:帮我|给我)?(?:画|绘制|生成|give me an illustration|draw|paint|generate)(?:\b|(?=\p{Script=Han}))/iu.test(text))return false;
  if(!allowsStickerReply(text))return false;
  const request=groupMediaRequest(text,roleId,roleName,false,null,false,undefined,true);
  return request?.assetId?.endsWith('-sticker')?request.stickerIntent||{category:'any'}:null;
}

async function resolveSticker(lookup,intent,{input,signal,describe,commit}){
  if(!allowsStickerReply(input))return null;
  let image,issue;
  try{image=await lookup(intent,{signal,describe});}catch(error){issue=error;}
  try{
    signal.throwIfAborted();
    if(!image)return stickerLookupReply(issue)||'这次没能读取表情图。';
    commit(marker,image);
    return marker;
  }finally{image?.bytes.fill(0);}
}

module.exports={hint,stickerChoice,stickerStream,stickerIntent,resolveSticker};
