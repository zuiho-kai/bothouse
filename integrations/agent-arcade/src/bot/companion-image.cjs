'use strict';
// Only the current no-tools companion turn may carry one normalized image.
// No URL, path, attachment handle or provider encoding enters a task snapshot.
const {validateImagePayload}=require('./qq-media.cjs');
const MAX_BODY=6*1024*1024;
const CODES=new Set(['disabled','unsupported_model','pro_no_vision','unavailable','invalid_image','unsupported_format','too_large','source_failed','quote_source_failed','quote_text_failed','source_unverified','download_failed','download_mismatch','changed','cancelled','provider_failed']);
class CompanionImageError extends Error{constructor(code){const fixed=CODES.has(code)?code:'source_failed';super(`Current picture could not be read (${fixed}).`);this.code=fixed;this.name=['changed','cancelled'].includes(fixed)?'AbortError':'CompanionImageError';}}
function capability(mode,model){return mode==='api'||mode==='gpt'&&['gpt-6.1-sol','gpt-6-astra'].includes(model)||mode==='deepseek'&&model==='deepseek-flash';}
function validate(image,{conversationOnly,resume,capable=true}={}){
  if(image===undefined)return null;
  if(conversationOnly!==true||resume||!capable)throw new CompanionImageError('unsupported_model');
  if(!image||typeof image!=='object'||Array.isArray(image)||Object.keys(image).some(k=>!['mimeType','bytes'].includes(k))||image.mimeType!=='image/png'||!Buffer.isBuffer(image.bytes))throw new CompanionImageError('invalid_image');
  try{validateImagePayload(image.bytes);}catch(error){throw new CompanionImageError(error?.code==='image_too_large'?'too_large':'invalid_image');}
  return image.bytes;
}
function body(value){const text=JSON.stringify(value);if(Buffer.byteLength(text)>MAX_BODY)throw new CompanionImageError('too_large');return text;}
function notice(error,{group=false,quoted=false}={}){
  const code=CODES.has(error?.code)?error.code:'source_failed';
  if(group){
    if(code==='source_unverified'||code==='quote_source_failed')return quoted?'QQ 桥接无法核对引用里的原图，这次没看到图片。':'QQ 桥接无法核对原图，这次没看到图片。';
    if(code==='download_failed')return '这次没能从 QQ 取回图片。可以先用文字告诉我。';
    if(code==='download_mismatch')return '从 QQ 取回的图片与原消息记录不符，这次没有使用。';
    if(code==='invalid_image')return '这张图没能解码。可以试试单张静态 JPG 或 PNG。';
    if(code==='unsupported_format')return '这边不支持这张图的格式，目前只支持静态 JPG 和 PNG。';
    if(code==='too_large')return '图片超出这边的处理大小。可以试试发小一点的图。';
  }
  if(code==='quote_text_failed')return '暂时没有收到模型回复，请稍后再试。';
  if(code==='quote_source_failed')return '这条引用没读到。如果是在问图片，请把单张 JPG 或 PNG 再发一次。';
  if(code==='disabled')return '我这边暂时关掉了看图，这次没有读取图片。可以先用文字聊。';
  if(code==='pro_no_vision')return '现在选的 DeepSeek Pro 不能看图，这次没有读取图片。可以先用文字描述，或在应用里换成支持图片的模型。';
  if(code==='unsupported_model'||code==='unavailable')return '现在的 AI 接入还不能看图，这次没有读取图片。可以先用文字告诉我。';
  if(code==='too_large'||code==='invalid_image')return '这张图暂时读不了，试试单张较小的 JPG 或 PNG。';
  if(code==='provider_failed')return '这次没能完成看图回复，可以稍后再发；我没有自动重试。';
  return '这张图片没读到，可以重新发一张 JPG 或 PNG。';
}
module.exports={CompanionImageError,capability,validate,body,notice,MAX_BODY};
