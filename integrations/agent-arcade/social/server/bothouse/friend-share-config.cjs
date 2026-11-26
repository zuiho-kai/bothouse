'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const fileName='.agent-arcade-friend-lookup.json';
const loopback=new Set(['127.0.0.1','::1']);

function friendLookupConfig(configFile,host,port) {
  if(!loopback.has(host)||!Number.isInteger(port)||port<1024||port>65535) return;
  const file=path.join(path.dirname(configFile),fileName);
  function read() {
    const info=fs.lstatSync(file);
    if(!info.isFile() || info.size>512 || (process.platform!=='win32' && (info.mode&0o077)!==0))
      throw Error('Invalid private Friends lookup configuration');
    const saved=JSON.parse(fs.readFileSync(file,'utf8'));
    if(saved.host!==host||saved.port!==port||typeof saved.token!=='string'||!/^[a-f0-9]{64}$/.test(saved.token))
      throw Error('Friends lookup belongs to a different listener or its configuration is invalid');
    return saved.token;
  }
  try {return read();} catch(error) {if(error.code!=='ENOENT') throw error;}
  const temp=file+'.'+randomBytes(12).toString('hex')+'.tmp';
  const record={host,port,token:randomBytes(32).toString('hex')};
  fs.closeSync(fs.openSync(temp,'wx',0o600));
  try {
    if(process.platform==='win32') {
      const system=path.join(process.env.SystemRoot,'System32');
      const owner=execFileSync(path.join(system,'whoami.exe'),['/user','/fo','csv','/nh'],
        {encoding:'utf8',windowsHide:true,timeout:3000}).match(/S-1-\d+(?:-\d+)+/)?.[0];
      if(!owner) throw Error('Cannot identify the private instance owner');
      execFileSync(path.join(system,'icacls.exe'),[temp,'/inheritance:r','/grant:r','*'+owner+':(F)'],
        {stdio:'ignore',windowsHide:true,timeout:3000});
    }
    fs.writeFileSync(temp,JSON.stringify(record)+'\n',{flag:'r+'});
    // Publish complete bytes without overwriting a key another startup already created.
    try {fs.linkSync(temp,file);} catch(error) {if(error.code!=='EEXIST') throw error;}
  } finally {fs.unlinkSync(temp);}
  return read();
}
module.exports={friendLookupConfig};
