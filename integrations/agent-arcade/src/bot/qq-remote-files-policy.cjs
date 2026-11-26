'use strict';
// Original bounded UI policy for fixed NapCat file APIs; a path scope is not a symlink sandbox.
const path=require('node:path'),{createHash}=require('node:crypto');
const P=require('./qq-remote-policy.cjs');
const LIMITS=Object.freeze({ticketMs:300000,viewMs:1800000,entriesMax:4096,handlesMax:8192,selectionMax:20,textMaxBytes:49152,jsonWriteMaxBytes:98304,uploadFileMaxBytes:67108864,uploadTotalMaxBytes:134217728,downloadMaxBytes:134217728});
const CODES=['files_unavailable','files_expired','files_limit','file_path_unsupported','file_name_unsupported','file_selection_invalid','file_baseline_changed','file_text_unsupported','file_text_too_large','file_transfer_too_large','file_upload_unavailable','file_download_unavailable','file_download_unknown','file_cleanup_unconfirmed','file_archive_invalid','file_rate_limited','file_upload_ambiguous'];
const OPS=['create','mkdir','write','rename','move','batchMove','copy','batchCopy','extract','delete','batchDelete','upload'];
const hash=value=>createHash('sha256').update(value).digest('hex');
function name(value,style){if(!P.text(value,255)||!value||value==='.'||value.includes('..')||/[\\/%?#]/.test(value)||Buffer.byteLength(value)>255||style==='windows'&&(/[<>:"|?*]/.test(value)||/[. ]$/.test(value)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)))P.fail('file_name_unsupported');return value;}
function root(value){
 if(!P.text(value,4096)||!value||value!==value.trim()||/%|\/\/|\.\./.test(value))P.fail('file_path_unsupported');
 const style=/^[A-Za-z]:\\/.test(value)?'windows':value.startsWith('/')?'posix':null;if(!style)P.fail('file_path_unsupported');
 const api=style==='windows'?path.win32:path.posix;if(style==='windows'&&(value.includes('/')||value.slice(3).includes('\\\\'))||style==='posix'&&value.includes('\\'))P.fail('file_path_unsupported');
 const normalized=api.normalize(value),trimmed=normalized===api.parse(normalized).root?normalized:normalized.replace(/[\\/]$/,'');
 const tail=trimmed.slice(api.parse(trimmed).root.length);for(const part of tail.split(style==='windows'?'\\':'/').filter(Boolean))name(part,style);
 if(trimmed!==value&&trimmed+(style==='windows'?'\\':'/')!==value)P.fail('file_path_unsupported');return {path:trimmed,style};
}
const api=r=>r.style==='windows'?path.win32:path.posix;
function key(r,value){return r.style==='windows'?value.toLowerCase():value;}
function relative(r,value){const rel=api(r).relative(r.path,value);if(rel==='..'||rel.startsWith('..'+api(r).sep)||api(r).isAbsolute(rel))P.fail('file_selection_invalid');return rel.split(api(r).sep).join('/');}
function join(r,parent,child){name(child,r.style);const result=api(r).join(parent,child);relative(r,result);return result;}
function rows(raw,r){
 if(!Array.isArray(raw)||raw.length>LIMITS.entriesMax)P.fail('files_limit');const seen=new Set();
 const out=raw.map(row=>{P.keys(row,['name','isDirectory','size','mtime'],[],'invalid_response');name(row.name,r.style);const k=key(r,row.name);if(seen.has(k)||typeof row.isDirectory!=='boolean'||!Number.isSafeInteger(row.size)||row.size<0||typeof row.mtime!=='string'||!Number.isFinite(Date.parse(row.mtime)))P.fail('invalid_response');seen.add(k);return {name:row.name,kind:row.isDirectory?'directory':'file',size:row.size,modifiedAt:new Date(row.mtime).toISOString()};});
 return out.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
}
function text(value){if(typeof value!=='string'||Buffer.byteLength(value)>LIMITS.textMaxBytes)P.fail('file_text_too_large');if(/\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))P.fail('file_text_unsupported');return value;}
function selection(value){if(!Array.isArray(value)||value.length>LIMITS.selectionMax||value.some(x=>!P.uuid(x))||new Set(value).size!==value.length)P.fail('file_selection_invalid');return value;}
function operation(op,ids,value){
 if(!OPS.includes(op))P.fail('invalid_request');selection(ids);
 const required={create:['name'],mkdir:['name'],write:['contentId','text'],rename:['name'],move:['destinationId'],batchMove:['destinationId'],copy:['destinationId'],batchCopy:['destinationId'],extract:['destinationId'],delete:[],batchDelete:[],upload:['uploadId']}[op];P.keys(value,required);
 if(['create','mkdir','upload'].includes(op)?ids.length!==0:['batchMove','batchDelete','batchCopy'].includes(op)?ids.length===0:ids.length!==1)P.fail('file_selection_invalid');
 for(const k of ['contentId','destinationId','uploadId'])if(Object.hasOwn(value,k)&&!P.uuid(value[k]))P.fail('invalid_request');if(Object.hasOwn(value,'name')&&!P.text(value.name,255))P.fail('file_name_unsupported');if(op==='write')text(value.text);return value;
}
function request(input,action){
 const fields={filesOpen:['operationId','observationId','rootPath'],filesList:['fileViewId','operationId','directoryId'],filesRead:['fileViewId','operationId','entryId'],filesPickUpload:['fileViewId','operationId'],filesPreview:['fileViewId','operationId','observationId','directoryId','operation','selectionIds','value'],filesConfirm:['fileViewId','operationId','ticketId','expectedDigest'],filesDownload:['fileViewId','operationId','selectionIds'],filesDismiss:['fileViewId'],filesCancel:['operationId'],filesClose:['fileViewId']};
 if(!fields[action])P.fail('invalid_request');P.keys(input,['remoteId','panelId',...fields[action]]);for(const k of ['remoteId','panelId','fileViewId','operationId','observationId','directoryId','entryId','ticketId'])if(Object.hasOwn(input,k)&&!P.uuid(input[k]))P.fail('invalid_request');
 if(action==='filesOpen')root(input.rootPath);if(action==='filesPreview')operation(input.operation,input.selectionIds,input.value);if(action==='filesConfirm'&&!P.hex(input.expectedDigest))P.fail('invalid_request');if(action==='filesDownload'&&selection(input.selectionIds).length===0)P.fail('file_selection_invalid');return input;
}
module.exports={LIMITS,CODES,OPS,name,root,key,api,relative,join,rows,text,selection,operation,request,hash};
