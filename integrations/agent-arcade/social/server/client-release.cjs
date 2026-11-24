'use strict';

const {createHash}=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');

const directory='_friends';
const entryFiles=['index.html','client-start.js','style.css','app.js','vendor/bothouse/rh-md.js',
  'avatar-image.js','feed-comments.js','message-reply.js','voice-queue-player.js','voice-recorder.js','voice-worklet.js','conversation-list.js'];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

function appWithBuild(bytes) {
  return Buffer.concat([Buffer.from('const servedClientBuild = "'+sha256(bytes)+'";\n'),bytes]);
}

function clientRelease(files) {
  const hash=createHash('sha256');
  for(const name of entryFiles){
    const bytes=files.get(name);
    // Preserve archived release URLs when later optional modules did not exist.
    if(!bytes && ['avatar-image.js','feed-comments.js','message-reply.js','conversation-list.js'].includes(name))continue;
    hash.update(name+'\0');
    hash.update(bytes?sha256(bytes):'-');
  }
  const build=hash.digest('hex');
  const prefix='/'+directory+'/'+build+'/';
  const document=files.get('index.html')?.toString('utf8')
    .replace('<html lang="zh-CN">','<html lang="zh-CN" data-friends-release="'+build+'">')
    .replace('href="./style.css"','href="'+prefix+'style.css"')
    .replace('src="./vendor/bothouse/rh-md.js"','src="'+prefix+'vendor/bothouse/rh-md.js"')
    .replace('<script type="module" src="./app.js"></script>','<script src="/client-start.js"></script><script id="friends-app" type="module" src="'+prefix+'app.js"></script>');
  return {build,prefix,document,files};
}

async function loadClientRelease(client) {
  const files=new Map(await Promise.all(entryFiles.map(async name=>{
    try{return [name,await fs.readFile(path.join(client,name))];}
    catch(error){if(error.code==='ENOENT')return [name,undefined];throw error;}
  })));
  return clientRelease(files);
}

module.exports={directory,entryFiles,appWithBuild,clientRelease,loadClientRelease};

