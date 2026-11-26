'use strict';

// Original, read-only OneBot v11 directory reader. Each operation owns one
// short-lived socket, has a total deadline, and never dispatches chat events.
const {randomUUID}=require('node:crypto');
const {TextDecoder}=require('node:util');
const {validateQQUrl,validateQQOwner}=require('./qq.cjs');
const MAX_PAYLOAD=1024*1024,MAX_ITEMS=10000,MAX_TEXT=500,MAX_FRAMES=256;
const decoder=new TextDecoder('utf-8',{fatal:true});
class QQDirectoryError extends Error {
  constructor(code){super(`QQ directory read failed (${code}).`);this.name=code==='cancelled'?'AbortError':'QQDirectoryError';this.code=code;}
}
const failure=code=>new QQDirectoryError(code);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function id(value){try{return validateQQOwner(value);}catch{throw failure('invalid_response');}}
function text(value){
  if(value===undefined)return '';
  if(typeof value!=='string')throw failure('invalid_response');
  return value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu,'').slice(0,MAX_TEXT).replace(/[\uD800-\uDBFF]$/u,'');
}
function count(value){if(!Number.isSafeInteger(value)||value<0)throw failure('invalid_response');return value;}
function project(kind,rows){
  if(!Array.isArray(rows))throw failure('invalid_response');
  if(rows.length>MAX_ITEMS)throw failure('response_too_large');
  const seen=new Set();return rows.map(row=>{
    if(!record(row))throw failure('invalid_response');
    const itemId=id(kind==='friends'?row.user_id:row.group_id);
    if(seen.has(itemId))throw failure('invalid_response');seen.add(itemId);
    if(kind==='friends')return {id:itemId,nickname:text(row.nickname),remark:text(row.remark)};
    return {id:itemId,name:text(row.group_name),
      ...(row.member_count===undefined?{}:{memberCount:count(row.member_count)}),
      ...(row.max_member_count===undefined?{}:{maxMemberCount:count(row.max_member_count)})};
  });
}
function frameText(raw,maxPayload){
  let bytes;
  if(typeof raw==='string'){if(Buffer.byteLength(raw)>maxPayload)throw failure('response_too_large');return raw;}
  if(Buffer.isBuffer(raw))bytes=raw;
  else if(raw instanceof ArrayBuffer)bytes=Buffer.from(raw);
  else if(Array.isArray(raw)&&raw.every(Buffer.isBuffer)){
    const size=raw.reduce((sum,part)=>sum+part.length,0);if(size>maxPayload)throw failure('response_too_large');bytes=Buffer.concat(raw,size);
  }else throw failure('invalid_response');
  if(bytes.length>maxPayload)throw failure('response_too_large');
  try{return decoder.decode(bytes);}catch{throw failure('invalid_response');}
}
class QQDirectoryReader {
  constructor({WebSocket,timeoutMs=10000,maxPayload=MAX_PAYLOAD}={}){
    if((WebSocket!==undefined&&typeof WebSocket!=='function')||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||!Number.isInteger(maxPayload)||maxPayload<1||maxPayload>MAX_PAYLOAD)throw failure('invalid_config');
    this.WebSocket=WebSocket;this.timeoutMs=timeoutMs;this.maxPayload=maxPayload;
  }
  async read({kind,url,token,expectedAccountId,signal,fresh=false}={}){
    let endpoint,accountId;
    try{
      if(typeof url!=='string')throw failure('invalid_config');
      endpoint=validateQQUrl(url);accountId=validateQQOwner(expectedAccountId);
      if(!['friends','groups'].includes(kind)||typeof fresh!=='boolean'||typeof token!=='string'||!/^[\x21-\x7e]{16,256}$/.test(token)||
        (signal!=null&&(typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean')))throw failure('invalid_config');
    }catch{throw failure('invalid_config');}
    if(signal?.aborted)throw failure('cancelled');
    const WebSocket=this.WebSocket||require('ws');
    return new Promise((resolve,reject)=>{
      let socket,settled=false,pending=null,opened=false,frames=0,totalBytes=0;
      const noop=()=>{};
      const finish=(error,result)=>{
        if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
        const waiter=pending;pending=null;waiter?.reject(error||failure('cancelled'));
        if(socket){
          socket.removeListener('open',onOpen);socket.removeListener('message',onMessage);socket.removeListener('close',onClose);socket.removeListener('error',onError);socket.removeListener('unexpected-response',onUnexpected);
          // terminate() may report a late handshake error. Do not retain the
          // operation's closures or turn that error into an unhandled event.
          socket.on('error',noop);try{socket.terminate();}catch{/* No raw transport error escapes. */}
        }
        error?reject(error):resolve(result);
      };
      const abort=()=>finish(failure('cancelled'));
      const timer=setTimeout(()=>finish(failure('timeout')),this.timeoutMs);
      const request=(action,params={})=>new Promise((resolveRequest,rejectRequest)=>{
        if(settled||signal?.aborted)return rejectRequest(failure('cancelled'));
        if(!socket||socket.readyState!==1||pending)return rejectRequest(failure('connection_failed'));
        const echo=randomUUID();pending={echo,resolve:resolveRequest,reject:rejectRequest};
        try{socket.send(JSON.stringify({action,params,echo}),error=>{if(error&&!settled)finish(failure('connection_failed'));});}
        catch{finish(failure('connection_failed'));}
      });
      const verify=async after=>{
        const identity=await request('get_login_info');
        if(!record(identity))throw failure('invalid_response');
        if(id(identity.user_id)!==accountId)throw failure(after?'account_changed':'account_mismatch');
        const status=await request('get_status');
        if(!record(status)||typeof status.online!=='boolean'||(status.good!==undefined&&typeof status.good!=='boolean'))throw failure('status_unverified');
        if(!status.online)throw failure('account_offline');
        if(status.good===false)throw failure('connection_failed');
      };
      const onOpen=()=>{
        if(opened||settled)return;opened=true;
        (async()=>{
          await verify(false);
          // NapCat's no_cache flag is only an upstream hint: its base friend
          // map can remain cached, so this result never claims live freshness.
          const rows=await request(kind==='friends'?'get_friend_list':'get_group_list',{no_cache:fresh});
          const items=project(kind,rows);
          await verify(true);
          if(signal?.aborted)throw failure('cancelled');
          finish(null,{kind,accountId,items,fetchedAt:new Date().toISOString(),source:'bridge-cache'});
        })().catch(error=>finish(error instanceof QQDirectoryError?error:failure('invalid_response')));
      };
      const onMessage=(raw,binary)=>{
        if(settled)return;
        try{
          if(binary)throw failure('invalid_response');
          const value=frameText(raw,this.maxPayload);frames++;totalBytes+=Buffer.byteLength(value);
          if(frames>MAX_FRAMES||totalBytes>this.maxPayload*4)throw failure('response_too_large');
          const reply=JSON.parse(value);if(!record(reply))throw failure('invalid_response');
          // A pushed event must never masquerade as an action response, even
          // if it carries an echo. Its content is neither stored nor returned.
          if(Object.hasOwn(reply,'post_type')||!pending||reply.echo!==pending.echo)return;
          if(reply.status!=='ok'||reply.retcode!==0){
            if(reply.status==='failed'&&Number.isInteger(reply.retcode))throw failure('action_failed');
            throw failure('invalid_response');
          }
          const waiter=pending;pending=null;waiter.resolve(reply.data);
        }catch(error){finish(error instanceof QQDirectoryError?error:failure('invalid_response'));}
      };
      const onClose=()=>finish(failure('connection_failed'));
      const onError=error=>finish(failure(error?.code==='WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'?'response_too_large':error?.code==='WS_ERR_INVALID_UTF8'?'invalid_response':'connection_failed'));
      const onUnexpected=(_request,response)=>{const code=[401,403].includes(response?.statusCode)?'unauthorized':'connection_failed';try{response?.destroy?.();}catch{/* Only the fixed response category is public. */}finish(failure(code));};
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted){abort();return;}
      try{
        socket=new WebSocket(endpoint,{headers:{Authorization:`Bearer ${token}`},followRedirects:false,handshakeTimeout:this.timeoutMs,maxPayload:this.maxPayload,perMessageDeflate:false});
        if(!socket||['on','once','removeListener','send','terminate'].some(method=>typeof socket[method]!=='function')){try{socket?.terminate?.();}catch{}socket=null;finish(failure('connection_failed'));return;}
        if(settled||signal?.aborted){socket.on('error',noop);socket.terminate();if(!settled)abort();return;}
        socket.once('open',onOpen);socket.on('message',onMessage);socket.once('close',onClose);socket.on('error',onError);socket.once('unexpected-response',onUnexpected);
      }catch{finish(failure('connection_failed'));}
    });
  }
}
module.exports={QQDirectoryReader,QQDirectoryError};
