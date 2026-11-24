'use strict';

const {png}=require('./static-image.cjs');

const PORTRAIT_EDGE=511;
const PORTRAIT_LIMIT=1024*1024;
const PORTRAIT_BASE64_LIMIT=4*Math.ceil(PORTRAIT_LIMIT/3);

function verifiedPortrait(value){
  if(!Buffer.isBuffer(value)||!value.length||value.length>PORTRAIT_LIMIT)throw Error('Invalid card portrait size');
  const image=png(value,{canonical:true});
  if(image.width>PORTRAIT_EDGE||image.height>PORTRAIT_EDGE||!image.bytes.equals(value))throw Error('Invalid card portrait PNG');
  return value;
}

function decodePortrait(value){
  if(typeof value!=='string'||!value||value.length>PORTRAIT_BASE64_LIMIT)throw Error('Invalid card portrait encoding');
  const bytes=Buffer.from(value,'base64');
  if(bytes.toString('base64')!==value)throw Error('Invalid card portrait encoding');
  return verifiedPortrait(bytes);
}

module.exports={PORTRAIT_EDGE,PORTRAIT_LIMIT,PORTRAIT_BASE64_LIMIT,verifiedPortrait,decodePortrait};
