'use strict';
// Original adapter for the documented local WebUI wire format. No upstream
// implementation is bundled. Credentials and upstream error bodies stay here.
const http = require('node:http');
const {createHash} = require('node:crypto');
const pluginConfigPolicy=require('./qq-plugin-config-policy.cjs');
const NAPCAT_PLUGIN_IDS=Object.freeze(['napcat-plugin-builtin','napcat-plugin-cleaner','napcat-plugin-ssqq','napcat-plugin-qce']);
const ROUTES = Object.freeze({
  login:'/api/auth/login', status:'/api/QQLogin/CheckLoginStatus',
  identity:'/api/QQLogin/GetQQLoginInfo', qr:'/api/QQLogin/GetQQLoginQrcode',
  refresh:'/api/QQLogin/RefreshQRcode', quick:'/api/QQLogin/SetQuickLogin',
  plugins:'/api/Plugin/List', pluginStatus:'/api/Plugin/SetStatus', pluginConfig:'/api/Plugin/Config',
  cleanerConfig:'/api/Plugin/ext/napcat-plugin-cleaner/config', cleanerOptions:'/api/Plugin/ext/napcat-plugin-cleaner/config/options',
});
class NapCatWebUIError extends Error {
  constructor(code) { super(`QQ management: ${code}`); this.code=code; }
}
function qqId(value) {
  const id=String(value??'');
  if(!/^[1-9]\d{4,14}$/.test(id))throw new NapCatWebUIError('invalid_identity');
  return id;
}
function qrURL(value) {
  if(typeof value!=='string'||value.length>4096)return null;
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&
    (url.hostname==='qq.com'||url.hostname.endsWith('.qq.com'))?url.href:null;}catch{return null;}
}
function request(port,route,body,credential,{signal,timeout=5000,method='POST',beforeSend}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(new NapCatWebUIError('cancelled'));
    const bytes=method==='GET'?Buffer.alloc(0):Buffer.from(JSON.stringify(body||{}));
    let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const req=http.request({hostname:'127.0.0.1',port,path:route,method,agent:false,
      headers:{'content-type':'application/json','content-length':bytes.length,...(credential?{authorization:`Bearer ${credential}`}:{})}},res=>{
      if(res.statusCode!==200){res.resume();finish(new NapCatWebUIError([401,403].includes(res.statusCode)?'unauthorized':'http_error'));return;}
      const chunks=[];let length=0;
      res.on('data',chunk=>{length+=chunk.length;if(length>128*1024){finish(new NapCatWebUIError('response_too_large'));res.destroy();req.destroy();}else chunks.push(chunk);});
      res.on('error',()=>finish(new NapCatWebUIError('connection_failed')));
      res.on('end',()=>{try{
        const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(!result||typeof result!=='object'||Array.isArray(result)||typeof result.code!=='number')throw new NapCatWebUIError('invalid_response');
        if(result.code!==0){const msg=typeof result.message==='string'?result.message:'';
          throw new NapCatWebUIError(/^(Unauthorized|Authorization Failed|token is invalid|Server token not initialized)$/i.test(msg)?'unauthorized':/login rate limit/i.test(msg)?'rate_limited':/^QQ Is Logined$/i.test(msg)?'already_logged_in':'request_rejected');}
        finish(null,result.data);
      }catch(error){finish(error instanceof NapCatWebUIError?error:new NapCatWebUIError('invalid_response'));}});
    });
    const abort=()=>{finish(new NapCatWebUIError('cancelled'));req.destroy();};
    const timer=setTimeout(()=>{finish(new NapCatWebUIError('timeout'));req.destroy();},timeout);
    req.on('error',()=>finish(new NapCatWebUIError('connection_failed')));
    signal?.addEventListener('abort',abort,{once:true});
    try{if(signal?.aborted)throw new NapCatWebUIError('cancelled');if(beforeSend){const value=beforeSend();if(value?.then){value.catch?.(()=>{});throw new NapCatWebUIError('invalid_config');}}req.end(bytes);}catch(error){finish(error);req.destroy();}
  });
}
class NapCatWebUI {
  #token; #credential=''; #credentialAt=0; #closed=false; #controller=new AbortController();
  constructor({port,token,accountId,timeout=5000}) {
    if(!Number.isInteger(port)||port<1||port>65535||typeof token!=='string'||token.length<6||token.length>1024||/[\x00-\x1f\x7f]/.test(token))throw new NapCatWebUIError('invalid_config');
    this.port=port;this.#token=token;this.accountId=qqId(accountId);this.timeout=Math.min(15000,Math.max(100,timeout));
  }
  async #authenticate(signal){
    if(this.#closed)throw new NapCatWebUIError('closed');
    if(this.#credential&&Date.now()-this.#credentialAt<45*60*1000)return;
    const data=await request(this.port,ROUTES.login,{hash:createHash('sha256').update(this.#token+'.napcat').digest('hex')},null,{signal,timeout:this.timeout});
    if(this.#closed||signal?.aborted)throw new NapCatWebUIError('cancelled');
    if(data?.require2FA)throw new NapCatWebUIError('two_factor_required');
    if(typeof data?.Credential!=='string'||data.Credential.length<1||data.Credential.length>8192||!/^[A-Za-z0-9+/=_-]+$/.test(data.Credential))throw new NapCatWebUIError('invalid_response');
    this.#credential=data.Credential;this.#credentialAt=Date.now();
  }
  async #call(kind,body,signal){
    signal=signal?AbortSignal.any([signal,this.#controller.signal]):this.#controller.signal;
    await this.#authenticate(signal);
    if(this.#closed||signal?.aborted)throw new NapCatWebUIError('cancelled');
    try {const result=await request(this.port,ROUTES[kind],body,this.#credential,{signal,timeout:this.timeout});if(this.#closed||signal.aborted)throw new NapCatWebUIError('cancelled');return result;}
    catch(error){if(error.code==='unauthorized'){this.#credential='';this.#credentialAt=0;}throw error;}
  }
  async status({signal}={}){
    const data=await this.#call('status',{},signal);
    if(typeof data?.isLogin!=='boolean'||typeof data?.isOffline!=='boolean')throw new NapCatWebUIError('invalid_response');
    const phase=['qrcode','qrcode_scanned','initializing','reconnecting','logged_in','login_failed'].includes(data.loginPhase)?data.loginPhase:'unknown';
    if(!data.isLogin)return {state:data.isOffline?'offline':phase==='reconnecting'?'reconnecting':data.qrLoginAccepted?'initializing':'login_required',online:false,identityVerified:false,phase};
    const identity=await this.#call('identity',{},signal);
    if(qqId(identity?.uin)!==this.accountId)throw new NapCatWebUIError('account_changed');
    return {state:identity.online===true?'online':'offline',online:identity.online===true,identityVerified:true,accountId:this.accountId,phase};
  }
  async qr({refresh=false,signal}={}){
    const data=await this.#call(refresh?'refresh':'qr',{},signal);
    if(data?.restarting===true)return {state:'reconnecting',url:null};
    const url=qrURL(data?.qrcode??data?.qrcodeurl);
    if(!url)throw new NapCatWebUIError('qr_unavailable');
    return {state:'login_required',url};
  }
  async quickLogin({signal}={}){
    await this.#call('quick',{uin:this.accountId},signal);
    return {requested:true,onlineVerified:false};
  }
  async plugins({signal}={}){
    signal=signal?AbortSignal.any([signal,this.#controller.signal]):this.#controller.signal;
    await this.#authenticate(signal);
    if(this.#closed||signal.aborted)throw new NapCatWebUIError('cancelled');
    let data;try{data=await request(this.port,ROUTES.plugins,null,this.#credential,{signal,timeout:this.timeout,method:'GET'});}catch(error){if(error?.code==='unauthorized'){this.#credential='';this.#credentialAt=0;}throw error;}
    if(this.#closed||signal.aborted)throw new NapCatWebUIError('cancelled');
    return data;
  }
  async setPluginStatus(value,{signal,assertCurrent}={}){
    let attempted=false;
    const check=()=>{if(this.#closed||signal?.aborted)throw new NapCatWebUIError('cancelled');const result=assertCurrent();if(result?.then){result.catch?.(()=>{});throw new NapCatWebUIError('invalid_config');}};
    try{
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!=='enable|id'||!NAPCAT_PLUGIN_IDS.includes(value.id)||typeof value.enable!=='boolean'||typeof assertCurrent!=='function')throw new NapCatWebUIError('invalid_config');
      signal=signal?AbortSignal.any([signal,this.#controller.signal]):this.#controller.signal;
      check();await this.#authenticate(signal);check();
      await request(this.port,ROUTES.pluginStatus,value,this.#credential,{signal,timeout:this.timeout,beforeSend:()=>{check();attempted=true;}});
      // A matched acknowledgement belongs to this submitted operation even if
      // close/context changes before its continuation. It is not persistence proof.
      return {outcome:'acknowledged',acknowledgement:'bridge-action-only'};
    }catch(error){if(error?.code==='unauthorized'){this.#credential='';this.#credentialAt=0;}return {outcome:attempted?'unknown':'not_submitted',code:attempted?'change_unknown':error?.code||'connection_failed'};}
  }
  async pluginConfig(id,{signal}={}){
    if(!pluginConfigPolicy.PLUGINS.includes(id))throw new NapCatWebUIError('invalid_config');
    signal=signal?AbortSignal.any([signal,this.#controller.signal]):this.#controller.signal;
    await this.#authenticate(signal);if(this.#closed||signal.aborted)throw new NapCatWebUIError('cancelled');
    let data;try{data=await request(this.port,id===pluginConfigPolicy.CLEANER?ROUTES.cleanerConfig:`${ROUTES.pluginConfig}?id=${encodeURIComponent(id)}`,null,this.#credential,{signal,timeout:this.timeout,method:'GET'});}catch(error){if(error?.code==='unauthorized'){this.#credential='';this.#credentialAt=0;}throw error;}
    if(this.#closed||signal.aborted)throw new NapCatWebUIError('cancelled');return data;
  }
  async setPluginConfig(value,{signal,assertCurrent}={}){
    let attempted=false;
    const check=()=>{if(this.#closed||signal?.aborted)throw new NapCatWebUIError('cancelled');const result=assertCurrent();if(result?.then){result.catch?.(()=>{});throw new NapCatWebUIError('invalid_config');}};
    try{
      pluginConfigPolicy.exact(value,['id','config']);if(!pluginConfigPolicy.PLUGINS.includes(value.id)||typeof assertCurrent!=='function')throw new NapCatWebUIError('invalid_config');
      const id=value.id,config=pluginConfigPolicy.jsonCopy(value.config);if(id===pluginConfigPolicy.CLEANER)pluginConfigPolicy.cleanerPatch(config);else pluginConfigPolicy.fields(config);
      signal=signal?AbortSignal.any([signal,this.#controller.signal]):this.#controller.signal;
      check();await this.#authenticate(signal);check();
      await request(this.port,id===pluginConfigPolicy.CLEANER?ROUTES.cleanerOptions:ROUTES.pluginConfig,id===pluginConfigPolicy.CLEANER?config:{id,config},this.#credential,{signal,timeout:this.timeout,beforeSend:()=>{check();attempted=true;}});
      // Setter memory and disk/reload can diverge. Do not infer persistence
      // from either the response body or a later getter observation.
      return {outcome:'acknowledged',acknowledgement:'bridge-action-only'};
    }catch(error){if(error?.code==='unauthorized'){this.#credential='';this.#credentialAt=0;}return {outcome:attempted?'unknown':'not_submitted',code:attempted?'change_unknown':error?.code||'connection_failed'};}
  }
  close(){this.#closed=true;this.#controller.abort();this.#credential='';this.#token='';}
}
module.exports={NapCatWebUI,NapCatWebUIError,NAPCAT_PLUGIN_IDS};
