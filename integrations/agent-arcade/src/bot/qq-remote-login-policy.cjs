'use strict';
// Independent login policy. A WebUI login observation is not remote process ownership.
const P=require('./qq-remote-policy.cjs');
const PHASES=Object.freeze(['waiting_qrcode','generating_qrcode','qrcode_scanned','initializing','ready','offline','reconnecting']);
const LIMITS=Object.freeze({lifetimeMs:300000,observations:100,pollMs:3000,displayMs:60000,urlBytes:4096,pngBytes:262144,quickAccounts:256});
const OPERATIONS=Object.freeze(['refreshQR','quickLogin']);
function request(input,action){
 const extra={loginOpen:[],loginObserve:['loginId'],loginQRCode:['loginId'],loginPreview:['loginId','observationId','operation'],loginConfirm:['loginId','ticketId','expectedDigest'],loginDismiss:['loginId'],loginClose:['loginId']};
 if(!Object.hasOwn(extra,action))P.fail('invalid_request');
 P.keys(input,['remoteId','panelId',...extra[action]],action==='loginOpen'?['choice','totpCode']:[]);
 if(!P.uuid(input.remoteId)||!P.uuid(input.panelId)||extra[action].includes('loginId')&&!P.uuid(input.loginId))P.fail('invalid_request');
 if(input.choice!==undefined&&!['current','candidate'].includes(input.choice))P.fail('invalid_request');
 if(input.totpCode!==undefined)P.otp(input.totpCode);
 if(action==='loginPreview'&&(!P.uuid(input.observationId)||!OPERATIONS.includes(input.operation)))P.fail('invalid_request');
 if(action==='loginConfirm'&&(!P.uuid(input.ticketId)||!P.hex(input.expectedDigest)))P.fail('invalid_request');
 return input;
}
function status(value){
 if(!P.plain(value)||typeof value.isLogin!=='boolean'||typeof value.isOffline!=='boolean')P.fail('invalid_response');
 for(const k of ['coreReady','qrLoginAccepted'])if(value[k]!==undefined&&typeof value[k]!=='boolean')P.fail('invalid_response');
 if(value.loginPhase!==undefined&&!P.text(value.loginPhase,64)||value.qrcodeurl!==undefined&&(typeof value.qrcodeurl!=='string'||Buffer.byteLength(value.qrcodeurl)>LIMITS.urlBytes)||value.loginError!==undefined&&(typeof value.loginError!=='string'||value.loginError.length>4096))P.fail('invalid_response');
 return {isLogin:value.isLogin,isOffline:value.isOffline,coreReady:value.coreReady===true,qrLoginAccepted:value.qrLoginAccepted===true,phase:PHASES.includes(value.loginPhase)?value.loginPhase:'unknown',qrURL:value.qrcodeurl||'',hasLoginError:!!value.loginError};
}
function info(value){
 if(!P.plain(value)||value.online!==undefined&&typeof value.online!=='boolean')P.fail('invalid_response');
 const actualQQ=value.uin===undefined||value.uin===''?null:P.qq(value.uin);
 if(value.online===true&&!actualQQ)P.fail('invalid_response');
 return {actualQQ,online:value.online===true};
}
function quickList(value){
 if(!Array.isArray(value)||value.length>LIMITS.quickAccounts)P.fail('invalid_response');
 const ids=value.map(P.qq);if(new Set(ids).size!==ids.length)P.fail('invalid_response');return ids;
}
function identityKey(s,i){return P.digest({isLogin:s.isLogin,isOffline:s.isOffline,coreReady:s.coreReady,actualQQ:i.actualQQ,online:i.online});}
function observation({version,firstStatus,firstInfo,lastStatus,lastInfo,quickAccounts},expectedQQ){
 if(!P.text(version,64)||!version)P.fail('invalid_response');expectedQQ=P.qq(expectedQQ);
 if(identityKey(firstStatus,firstInfo)!==identityKey(lastStatus,lastInfo))P.fail('account_changed');
 const s=lastStatus,i=lastInfo,quickLoginAvailable=quickAccounts.includes(expectedQQ);
 const mismatch=i.actualQQ!==null&&i.actualQQ!==expectedQQ;
 const onlineVerified=!mismatch&&s.isLogin&&!s.isOffline&&s.coreReady&&i.online&&i.actualQQ===expectedQQ;
 const contradictory=s.isLogin&&s.isOffline||s.coreReady!==s.isLogin||!s.isLogin&&i.online;
 let state='indeterminate';
 if(mismatch)state='account_mismatch';
 else if(onlineVerified)state='matched';
 else if(!contradictory&&s.phase!=='unknown'){
  if(s.isOffline)state='offline';
  else if(!s.isLogin){state=s.phase==='ready'?'indeterminate':s.phase;if(s.qrLoginAccepted&&!['qrcode_scanned','initializing'].includes(state))state='initializing';}
 }
 const stableOut=!s.isLogin&&!s.coreReady&&!s.qrLoginAccepted&&!i.online&&!mismatch&&!contradictory;
 const mayChange=version===P.VERSION&&stableOut&&['waiting_qrcode','offline'].includes(state);
 const canShowQRCode=version===P.VERSION&&stableOut&&!s.isOffline&&state==='waiting_qrcode'&&!s.hasLoginError&&!!s.qrURL;
 return {version,state,phase:s.phase,actualQQ:i.actualQQ,onlineVerified,coreReady:s.coreReady,qrLoginAccepted:s.qrLoginAccepted,hasLoginError:s.hasLoginError,quickLoginAvailable,canShowQRCode,canRefreshQR:mayChange,canQuickLogin:mayChange&&quickLoginAvailable,qrURL:s.qrURL};
}
function snapshot(raw){
 const booleans=['onlineVerified','coreReady','qrLoginAccepted','hasLoginError','quickLoginAvailable','canShowQRCode','canRefreshQR','canQuickLogin'];
 if(!P.plain(raw)||!P.text(raw.version,64)||!raw.version||![...PHASES.filter(p=>p!=='ready'),'matched','account_mismatch','indeterminate'].includes(raw.state)||![...PHASES,'unknown'].includes(raw.phase)||booleans.some(k=>typeof raw[k]!=='boolean')||typeof raw.qrURL!=='string'||Buffer.byteLength(raw.qrURL)>LIMITS.urlBytes)P.fail('invalid_response');
 if(raw.actualQQ!==null)P.qq(raw.actualQQ);return raw;
}
function baseline(raw){return P.digest({version:raw.version,state:raw.state,phase:raw.phase,actualQQ:raw.actualQQ,onlineVerified:raw.onlineVerified,coreReady:raw.coreReady,qrLoginAccepted:raw.qrLoginAccepted,quickLoginAvailable:raw.quickLoginAvailable,hasLoginError:raw.hasLoginError,qrHash:P.digest(raw.qrURL)});}
function requireEffect(raw,operation){if(raw.version!==P.VERSION)P.fail('unsupported_version');if(raw.state==='account_mismatch')P.fail('account_changed');if(!raw[operation==='refreshQR'?'canRefreshQR':'canQuickLogin'])P.fail(operation==='quickLogin'&&!raw.quickLoginAvailable?'quick_login_unavailable':'login_state_changed');}
function qrURL(value){
 if(typeof value!=='string'||!value||Buffer.byteLength(value)>LIMITS.urlBytes||/[\p{C}\p{Z}\s\\]/u.test(value)||/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)||!value.startsWith('https://'))P.fail('qr_url_unsupported');
 let u;try{u=new URL(value);if(value.includes('#')||/\p{C}/u.test(decodeURIComponent(value)))P.fail('qr_url_unsupported');}catch{P.fail('qr_url_unsupported');}
 const authority=value.slice(8).split(/[/?#]/,1)[0];
 if(!/^[a-zA-Z0-9.-]+(?::443)?$/.test(authority)||u.protocol!=='https:'||u.username||u.password||u.hash||u.port||u.hostname.endsWith('.')||!(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*qq\.com$/.test(u.hostname))||u.hostname.split('.').some(p=>p.startsWith('xn--')||p.length>63))P.fail('qr_url_unsupported');
 return value;
}
function png(value){if(typeof value!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))P.fail('qr_unavailable');const encoded=value.slice(22);if(Buffer.byteLength(encoded)>LIMITS.pngBytes)P.fail('qr_unavailable');const bytes=Buffer.from(encoded,'base64');if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('base64')!==encoded)P.fail('qr_unavailable');return value;}
module.exports={PHASES,LIMITS,OPERATIONS,request,status,info,quickList,identityKey,observation,snapshot,baseline,requireEffect,qrURL,png};

