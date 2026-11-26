'use strict';

const {fail}=require('./store.cjs');
const {readAttachment}=require('./image-upload.cjs');

function readFileUpload(req) {
  let name;
  try { name=decodeURIComponent(req.headers['x-social-file-name'] || ''); } catch {}
  if(!name || Buffer.byteLength(name)>240 || /[<>:"/\\|?*\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(name) ||
     /[. ]$/u.test(name) || /^(?:con|prn|aux|nul|conin\$|conout\$|(?:com|lpt)[0-9¹²³]) *(?:\.|$)/iu.test(name))
    fail(400,'file_name','文件名含不支持的字符，请重命名后再发送');
  return readAttachment(req,{kind:'file',formats:['application/octet-stream'],maxBytes:16*1024*1024,
    sizeError:'文件不能超过 16 MiB',formatError:'请重新选择文件',validate:()=>({name})});
}
module.exports={readFileUpload};
