// Install only the operator-selected, visitor-shareable artwork. Never evaluate the desk page.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const [root, output, ...keys] = process.argv.slice(2);
if (!root || !output || !keys.length || keys.some(k=>!/^[-a-z0-9_]{1,64}$/.test(k))) {
  throw Error('Usage: node tools/prepare-resident-art.mjs <Bothouse checkout> <public/bothouse-art> <approved avatar slugs...>');
}
const desk=resolve(root,'dsh/collab/desk/index.html');
const html=await readFile(desk,'utf8');
const block=/<script type="application\/json" id="spriteData">([^<]+)<\/script>/.exec(html);
if(!block)throw Error('This Bothouse desk has no spriteData.');
const sheets=JSON.parse(block[1]), catalog=Object.create(null);
const files=[];
for(const key of new Set(keys)){
  if(key==='default')throw Error('default denotes an unconfigured appearance.');
  const sprite=Object.hasOwn(sheets,key)?sheets[key]:null;
  const add=(name,bytes,frames,width,height)=>{
    if(!Buffer.isBuffer(bytes)||bytes.length<32||bytes.length>2_000_000||
        bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||!Number.isSafeInteger(frames)||
        frames<1||frames>24||bytes.readUInt32BE(16)!==width*frames||bytes.readUInt32BE(20)!==height||width>1024||height>1024)
      throw Error('Invalid PNG sheet for '+key);
    files.push([key+'-'+name+'.png',bytes]);return frames;
  };
  if(sprite){
    const sheet=(v,name)=>add(name,Buffer.from(v.src.replace(/^data:image\/png;base64,/,''),'base64'),v.n,v.w,v.h);
    catalog[key]={stand:sheet(sprite,'stand'),...(sprite.sit?{sit:sheet(sprite.sit,'sit')}:{})};
  }else{
    // An exact, installed public avatar can be a still. No guessing by display name or vendor.
    const bytes=await readFile(join(root,'dsh/collab/avatars',key+'.png'));
    // Keep pixel data and transparency; do not publish an avatar's textual/EXIF payload.
    const chunks=[bytes.subarray(0,8)];
    let ended=false;
    for(let offset=8;offset+12<=bytes.length&&!ended;){
      const end=offset+12+bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);
      if(end>bytes.length)throw Error('Truncated PNG for '+key);
      if(['IHDR','PLTE','tRNS','IDAT','IEND'].includes(type))chunks.push(bytes.subarray(offset,end));
      ended=type==='IEND';offset=end;
    }
    if(!ended)throw Error('Incomplete PNG for '+key);
    const portrait=Buffer.concat(chunks);
    catalog[key]={stand:add('stand',portrait,1,portrait.readUInt32BE(16),portrait.readUInt32BE(20))};
  }
}
await mkdir(output,{recursive:true});
if((await readdir(output)).length)throw Error('Prepare artwork in a fresh empty directory to avoid retaining previously shared files.');
for(const [file,bytes] of files)await writeFile(join(output,file),bytes);
await writeFile(join(output,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
console.log(JSON.stringify({keys:Object.keys(catalog),pngFiles:files.length,bytes:files.reduce((sum,f)=>sum+f[1].length,0)}));
