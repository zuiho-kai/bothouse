'use strict';

// Original, main-process-only editor for a separately installed OneBot config.
// Schema interoperability reference: NapCatQQ v4.18.42 config/config.ts.
// No QQ credentials, private messages, native client profile or WebUI password
// are read here. The bridge token returned by connection() must stay in main.
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {atomicJSON}=require('../core/files.cjs');

const MAX_CONFIG_BYTES=2*1024*1024,MAX_SERVERS=64;
const errors={
  config_invalid:'The local OneBot configuration is missing, malformed or too large. It was not changed.',
  config_changed:'The configuration changed while it was being edited. Refresh before trying again.',
  profile_exists:'This QQ instance already has a configuration. Select its existing connection to edit it.',
  server_ambiguous:'Select the exact WebSocket server to use. More than one connection is configured.',
  server_missing:'The selected WebSocket server was not found.',
  server_invalid:'The selected server is not an enabled, authenticated loopback WebSocket connection.',
  invalid_server_name:'Use a server name of 1 to 64 characters without control characters.',
  invalid_port:'Choose a local port from 1024 to 65535.',
  port_conflict:'This port is already configured for another connection. Choose another port.',
  port_unavailable:'This port is already listening or cannot be bound locally. Choose another port.',
  backup_failed:'The original configuration could not be backed up safely. It was not changed.',
  write_failed:'The local configuration could not be saved. Refresh and check its current state before retrying.',
};
class QQProfileConfigError extends Error{constructor(code){super(errors[code]||'The local QQ connection could not be configured.');this.name='QQProfileConfigError';this.code=code;}}
const fail=code=>{throw new QQProfileConfigError(code);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const port=value=>Number.isInteger(value)&&value>=1&&value<=65535;
const token=value=>typeof value==='string'&&/^[\x21-\x7e]{16,256}$/.test(value);
const loopback=value=>value==='127.0.0.1'||value==='::1';
const name=value=>typeof value==='string'&&value.length>=1&&value.length<=64&&!/[\x00-\x1f\x7f]/.test(value)&&value.trim()===value;
const hash=value=>createHash('sha256').update(value).digest('hex');
function read(file,{missing=false}={}){
  try{
    if(!fs.existsSync(file)){if(missing)return null;fail('config_invalid');}
    const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_CONFIG_BYTES||path.resolve(fs.realpathSync(file)).toLowerCase()!==path.resolve(file).toLowerCase())fail('config_invalid');
    const bytes=fs.readFileSync(file),value=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
    if(!plain(value)||(value.network!==undefined&&!plain(value.network)))fail('config_invalid');
    const servers=value.network?.websocketServers;if(servers!==undefined&&(!Array.isArray(servers)||servers.length>MAX_SERVERS||servers.some(v=>!plain(v))))fail('config_invalid');
    return {value,bytes,digest:hash(bytes)};
  }catch(error){if(error instanceof QQProfileConfigError)throw error;fail('config_invalid');}
}
function servers(value){return value.network?.websocketServers||[];}
function summary(accountId,value){return {accountId,servers:servers(value).map(s=>({serverName:name(s.name)?s.name:null,port:port(s.port)?s.port:null,enabled:s.enable===true,loopbackOnly:loopback(s.host),hasToken:token(s.token)}))};}
function eligible(server){return name(server.name)&&server.enable===true&&loopback(server.host)&&port(server.port)&&token(server.token);}
function select(list,serverName,{configure=false}={}){
  if(serverName!==undefined){if(!name(serverName))fail('invalid_server_name');const matches=list.filter(s=>s.name===serverName);if(matches.length>1)fail('server_ambiguous');return matches[0]||null;}
  const choices=configure?list:list.filter(eligible);if(choices.length>1)fail('server_ambiguous');return choices[0]||null;
}
function bindPort(value){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(new QQProfileConfigError('port_unavailable')));server.listen({host:'127.0.0.1',port:value,exclusive:true},()=>{const actual=server.address().port;server.close(error=>error?reject(new QQProfileConfigError('port_unavailable')):resolve(actual));});});}

class QQProfileConfig{
  constructor({runtime,backupRoot,checkPort=bindPort}={}){
    if(!runtime||typeof runtime.instance!=='function'||typeof runtime.withConfigurationLock!=='function')fail('config_invalid');
    this.runtime=runtime;this.backupRoot=path.resolve(backupRoot||path.join(runtime.root,'qq-profile-backups'));this.checkPort=checkPort;
  }
  async list(){
    const state=await this.runtime.discover();return state.instances.map(({accountId})=>{
      try{return summary(accountId,read(this.runtime.instance(accountId).onebotConfigPath).value);}catch(error){return {accountId,servers:[],issue:error.code||'config_invalid'};}
    });
  }
  connection(accountId,serverName){
    const value=read(this.runtime.instance(accountId).onebotConfigPath).value,list=servers(value),selected=select(list,serverName);
    if(!selected)fail(serverName===undefined?'server_invalid':'server_missing');if(!eligible(selected))fail('server_invalid');
    return {accountId,serverName:selected.name,url:`ws://${selected.host==='::1'?'[::1]':'127.0.0.1'}:${selected.port}`,token:selected.token};
  }
  _configuredPorts(install,accountId,selected){
    const used=new Set();
    for(const id of install.accounts){
      let file=path.join(install.configDir,`onebot11_${id}.json`);
      if(install.installationKind==='managed-node'){
        file=install.accountConfigPaths?.[id];
        if(typeof file!=='string'||!path.isAbsolute(file)||file!==this.runtime.instance(id).onebotConfigPath)fail('config_invalid');
      }
      const value=read(file).value;
      for(const field of ['websocketServers','httpServers','httpSseServers']){
        const entries=value.network?.[field]||[];if(!Array.isArray(entries)||entries.length>MAX_SERVERS)fail('config_invalid');
        for(const entry of entries){if(!plain(entry))fail('config_invalid');if(id===accountId&&field==='websocketServers'&&selected&&entry.name===selected.name)continue;if(port(entry.port))used.add(entry.port);}
      }
    }
    return used;
  }
  async _port(requested,used){
    if(requested!==undefined){if(!Number.isInteger(requested)||requested<1024||requested>65535)fail('invalid_port');if(used.has(requested))fail('port_conflict');if(await this.checkPort(requested)!==requested)fail('port_unavailable');return requested;}
    for(let attempt=0;attempt<20;attempt++){const candidate=await this.checkPort(0);if(Number.isInteger(candidate)&&candidate>=1024&&candidate<=65535&&!used.has(candidate))return candidate;}
    fail('port_unavailable');
  }
  _backup(accountId,bytes){
    try{
      fs.mkdirSync(this.backupRoot,{recursive:true,mode:0o700});const stat=fs.lstatSync(this.backupRoot);if(!stat.isDirectory()||stat.isSymbolicLink()||path.resolve(fs.realpathSync(this.backupRoot)).toLowerCase()!==this.backupRoot.toLowerCase())fail('backup_failed');
      // Backups contain bridge credentials and stay in the private app root.
      const file=path.join(this.backupRoot,`${hash(accountId)}-${Date.now()}-${randomUUID()}.json`);fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});if(!fs.readFileSync(file).equals(bytes))fail('backup_failed');
    }catch(error){if(error instanceof QQProfileConfigError)throw error;fail('backup_failed');}
  }
  async configure(accountId,{serverName,port:requestedPort,create=false}={}){
    return this.runtime.withConfigurationLock(accountId,{create},async install=>{
      const prior=read(install.onebotConfigPath,{missing:create});if(create&&prior)fail('profile_exists');
      const value=prior?structuredClone(prior.value):{network:{}},list=servers(value),selected=select(list,serverName,{configure:true});
      if(selected&&!name(selected.name))fail('invalid_server_name');const selectedName=selected?.name||serverName||'agent-arcade';if(!name(selectedName))fail('invalid_server_name');if(!selected&&list.length>=MAX_SERVERS)fail('config_invalid');
      const used=this._configuredPorts(install,accountId,selected),selectedPort=await this._port(requestedPort??(port(selected?.port)?selected.port:undefined),used);
      const updated={...(selected||{}),name:selectedName,enable:true,host:'127.0.0.1',port:selectedPort,messagePostFormat:'array',reportSelfMessage:false,enableForcePushEvent:true,debug:false,heartInterval:30000,token:token(selected?.token)?selected.token:randomBytes(32).toString('hex')};
      value.network={...(value.network||{}),websocketServers:selected?list.map(s=>s===selected?updated:s):[...list,updated]};
      const encoded=JSON.stringify(value);if(Buffer.byteLength(encoded)>MAX_CONFIG_BYTES)fail('config_invalid');
      await install.assertStopped();const current=read(install.onebotConfigPath,{missing:create});if(current?.digest!==prior?.digest)fail('config_changed');
      if(prior)this._backup(accountId,prior.bytes);
      // Recheck after the backup. Desktop is an independent program and cannot
      // honor our lock, so a newly detected manager always aborts this write.
      await install.assertStopped();if(read(install.onebotConfigPath,{missing:create})?.digest!==prior?.digest)fail('config_changed');
      try{atomicJSON(install.onebotConfigPath,value);const saved=read(install.onebotConfigPath);if(JSON.stringify(saved.value)!==encoded)fail('write_failed');}catch(error){if(error instanceof QQProfileConfigError)throw error;fail('write_failed');}
      return {...summary(accountId,value),created:!prior,backupCreated:!!prior};
    });
  }
}
module.exports={QQProfileConfig,QQProfileConfigError,MAX_CONFIG_BYTES};
