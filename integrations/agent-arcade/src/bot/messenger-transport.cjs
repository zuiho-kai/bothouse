'use strict';
// Original bounded Messenger transport. No upstream sample code is copied.
const {createHmac,timingSafeEqual}=require('node:crypto');
const {TextDecoder}=require('node:util');
const MAX_BODY=256*1024,WINDOW=24*60*60*1000,TTL=5*60*1000;
class MessengerError extends Error{constructor(code,{submitted=false,retryAt}={}){super(`Messenger operation failed (${code}).`);this.code=code;this.name=code==='aborted'?'AbortError':'MessengerError';if(submitted)this.submitted=true;if(Number.isSafeInteger(retryAt))this.retryAt=retryAt;}}
const fail=code=>{throw new MessengerError(code);};
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[1-9]\d{0,19}$/.test(value);
const mid=value=>typeof value==='string'&&/^[\x21-\x7e]{1,512}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=2000&&Buffer.byteLength(value)<=8000&&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
function secret(value,min=32){if(typeof value!=='string'||!new RegExp(`^[\\x21-\\x7e]{${min},4096}$`).test(value))fail('invalid_config');return value;}
function equalSecret(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
function json(bytes){if(!Buffer.isBuffer(bytes)||bytes.length>MAX_BODY)fail('body_too_large');try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!plain(value))fail('invalid_response');return value;}catch(error){if(error instanceof MessengerError)throw error;fail('invalid_response');}}
function signature(bytes,header,appSecret){if(!Buffer.isBuffer(bytes)||bytes.length>MAX_BODY)fail('body_too_large');if(typeof header!=='string'||!/^sha256=[a-f0-9]{64}$/.test(header))fail('invalid_signature');const actual=Buffer.from(header.slice(7),'hex'),expected=createHmac('sha256',appSecret).update(bytes).digest();if(!timingSafeEqual(actual,expected))fail('invalid_signature');}
function projectWebhook(bytes,header,{appSecret,pageId,ownerId,now=Date.now()}){
  signature(bytes,header,appSecret);const body=json(bytes);
  if(body.object!=='page'||!Array.isArray(body.entry)||body.entry.length>100)fail('invalid_event');
  const rows=[];let count=0;
  for(const entry of body.entry){
    if(!plain(entry)||!id(entry.id))fail('invalid_event');if(entry.id!==pageId)continue;
    if(!Array.isArray(entry.messaging)||entry.messaging.length>100)fail('invalid_event');
    for(const event of entry.messaging){
      if(++count>100)fail('event_limit');if(!plain(event))fail('invalid_event');
      if(!plain(event.sender)||!plain(event.recipient)||event.sender.id!==ownerId||event.recipient.id!==pageId)continue;
      if(!plain(event.message)||event.message.is_echo===true)continue;
      const at=event.timestamp,message=event.message;if(!Number.isSafeInteger(at)||at<0||at>now+30000||!mid(message.mid))fail('invalid_event');
      if(at<now-WINDOW)continue;
      const quoted=Object.hasOwn(message,'reply_to'),unsupported=Object.keys(message).some(k=>!['mid','text','reply_to'].includes(k))||!text(message.text);
      rows.push({id:message.mid,from:ownerId,text:unsupported?'':message.text,createdAt:at,
        ...(unsupported?{unsupported:'messenger_nontext'}:{}),...(quoted?{quote:{id:null,title:'Messenger referenced content (not fetched)',text:''}}:{})});
    }
  }return rows;
}
async function readRequest(req,{timeoutMs=5000}={}){
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)fail('invalid_request');
  // Absolute request-body deadline; arriving chunks must not renew it.
  const timer=setTimeout(()=>req.destroy(new MessengerError('request_timeout')),timeoutMs);
  try{
    if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')fail('invalid_request');
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))fail('invalid_request');
    const declared=req.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BODY))fail('body_too_large');
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)fail('body_too_large');chunks.push(chunk);}return Buffer.concat(chunks,size);
  }finally{clearTimeout(timer);}
}
async function requestJSON(fetchImpl,url,{method='GET',token,body,signal,assertCurrent=()=>{},timeoutMs=15000,write=false}={}){
  const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),timeoutMs),combined=AbortSignal.any([timeout.signal,...(signal?[signal]:[])]);let submitted=false,response;
  try{
    assertCurrent();if(combined.aborted)fail('aborted');submitted=write;
    response=await fetchImpl(url,{method,redirect:'manual',signal:combined,headers:{authorization:`Bearer ${token}`,accept:'application/json',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(response.status>=300&&response.status<400)fail('redirect_rejected');
    if(response.status===429){const header=response.headers.get('retry-after'),seconds=/^\d+$/.test(header||'')?Number(header):NaN,at=Number.isFinite(seconds)?Date.now()+Math.min(seconds,3600)*1000:Date.parse(header||'');throw new MessengerError('rate_limited',{retryAt:Number.isFinite(at)&&at>Date.now()&&at<=Date.now()+3600000?Math.ceil(at):Date.now()+60000});}
    if(!response.ok)fail(response.status===401?'requires_reauthorization':response.status===403?'permission_denied':response.status===409?'changed':'connection_failed');
    const type=response.headers.get('content-type')||'',length=response.headers.get('content-length');
    if(!/^application\/json(?:;|$)/i.test(type))fail('invalid_response');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY))fail('body_too_large');
    if(!response.body)fail('invalid_response');const reader=response.body.getReader(),chunks=[];let size=0;
    try{while(true){if(combined.aborted)fail('aborted');const row=await reader.read();if(row.done)break;size+=row.value.byteLength;if(size>MAX_BODY)fail('body_too_large');chunks.push(row.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    if(combined.aborted)fail('aborted');const value=json(Buffer.concat(chunks,size));if(value.error!==undefined)fail('invalid_response');return value;
  }catch(error){
    await response?.body?.cancel().catch(()=>{});
    if(submitted)throw new MessengerError('submission_unknown',{submitted:true});
    if(signal?.aborted)fail('aborted');if(timeout.signal.aborted)fail('timeout');if(error instanceof MessengerError)throw error;fail('connection_failed');
  }finally{clearTimeout(timer);}
}
module.exports={MessengerError,fail,plain,id,mid,uuid,text,secret,equalSecret,json,signature,projectWebhook,readRequest,requestJSON,MAX_BODY,WINDOW,TTL};
