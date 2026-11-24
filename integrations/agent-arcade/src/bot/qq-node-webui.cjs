'use strict';

// Original validation for the fixed v4.18.42 configuration contract. Invalid
// upstream config falls back to a wildcard host, so checking host alone is not
// enough. Existing credentials and settings are never returned or rewritten.
const fs=require('node:fs');
const {TextDecoder}=require('node:util');
const {bytes,directory,hash}=require('./qq-node-selection.cjs');
const path=require('node:path');
const MAX_BYTES=256*1024,SEED=Buffer.from('{"host":"127.0.0.1"}\n');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
const loopback=value=>value==='127.0.0.1'||value==='::1';
const fail=()=>{throw Object.assign(new Error('The existing Node WebUI configuration could not be verified as local. It was not changed.'),{code:'webui_config_not_local'});};
const known=new Set(['host','port','token','loginRate','autoLoginAccount','theme','disableWebUI','accessControlMode','ipWhitelist','ipBlacklist','enableXForwardedFor','enable2FA','totpSecret']);
function valid(value){
  if(!plain(value)||!loopback(value.host)||Object.keys(value).some(key=>!known.has(key)))return false;
  for(const key of ['token','autoLoginAccount','totpSecret'])if(own(value,key)&&typeof value[key]!=='string')return false;
  for(const key of ['disableWebUI','enableXForwardedFor','enable2FA'])if(own(value,key)&&typeof value[key]!=='boolean')return false;
  if(own(value,'port')&&(!Number.isInteger(value.port)||value.port<1||value.port>65535))return false;
  if(own(value,'loginRate')&&(!Number.isFinite(value.loginRate)||value.loginRate<0))return false;
  if(own(value,'accessControlMode')&&!['none','whitelist','blacklist'].includes(value.accessControlMode))return false;
  for(const key of ['ipWhitelist','ipBlacklist'])if(own(value,key)&&(!Array.isArray(value[key])||value[key].length>4096||value[key].some(item=>typeof item!=='string')))return false;
  if(own(value,'theme')){
    const theme=value.theme;if(!plain(theme)||Object.keys(theme).some(key=>!['dark','light','fontMode'].includes(key))||own(theme,'fontMode')&&typeof theme.fontMode!=='string')return false;
    for(const key of ['dark','light'])if(!plain(theme[key])||Object.keys(theme[key]).length>1024||Object.values(theme[key]).some(item=>typeof item!=='string'))return false;
  }
  return true;
}
function readLocalWebUI(file){
  try{const result=bytes(file,MAX_BYTES),value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(result.value));if(!valid(value))fail();
    const {dev,ino,size,mtimeMs}=result.stat;return {host:value.host,digest:hash(result.value),identity:{dev,ino,size,mtimeMs}};
  }catch{fail();}
}
function seedLocalWebUI(file){
  let fd;
  try{
    directory(path.dirname(file));
    try{fd=fs.openSync(file,'wx',0o600);}catch(error){if(error.code==='EEXIST')return {created:false};throw error;}
    const owned=fs.fstatSync(fd);if(!owned.isFile()||owned.nlink!==1)fail();
    fs.writeFileSync(fd,SEED);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    const read=bytes(file,MAX_BYTES);if(read.stat.dev!==owned.dev||read.stat.ino!==owned.ino||!read.value.equals(SEED))fail();
    return {created:true};
  }catch{fail();}finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
}
function assertSameWebUI(before,after){if(before.digest!==after.digest||JSON.stringify(before.identity)!==JSON.stringify(after.identity))fail();}
module.exports={seedLocalWebUI,readLocalWebUI,assertSameWebUI};
