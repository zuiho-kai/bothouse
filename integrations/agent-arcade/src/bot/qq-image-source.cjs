'use strict';
// Original fixed-version image URL identity contract. No I/O, tokens, or history lookup.
const {createHash}=require('node:crypto');
const fail=()=>{throw Object.assign(Error('Unsupported message image URL.'),{code:'image_source_unsupported'});};
const opaque=v=>typeof v==='string'&&v.length>0&&v.length<=4096&&!/[\x00-\x20\x7f]/.test(v);
function imageSource(value){
 if(typeof value!=='string'||value.length>8192||/[\x00-\x20\x7f\\]/.test(value))fail();let u;try{u=new URL(value);}catch{fail();}
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||!['gchat.qpic.cn','multimedia.nt.qq.com.cn'].includes(u.hostname))fail();
 let resource;
 const md5=/^\/gchatpic_new\/0\/0-0-([a-fA-F0-9]{32})\/0$/.exec(u.pathname);
 if(u.hostname==='gchat.qpic.cn'&&md5&&!u.search)resource={kind:'md5',md5:md5[1].toLowerCase()};
 else if(u.pathname==='/download'){
  const keys=[...u.searchParams.keys()],allowed=u.hostname==='gchat.qpic.cn'?['appid','fileid','rkey','spec']:['appid','fileid','rkey'];
  if(keys.length!==allowed.length||new Set(keys).size!==keys.length||keys.some(k=>!allowed.includes(k))||!['1406','1407'].includes(u.searchParams.get('appid'))||!opaque(u.searchParams.get('fileid'))||!opaque(u.searchParams.get('rkey'))||u.hostname==='gchat.qpic.cn'&&u.searchParams.get('spec')!=='0')fail();
  resource={kind:'nt',appid:u.searchParams.get('appid'),fileid:u.searchParams.get('fileid')};
 }else fail();
 return Object.freeze({url:u.href,resource:Object.freeze(resource),resourceDigest:createHash('sha256').update(JSON.stringify(resource)).digest('hex')});
}
module.exports={imageSource};
