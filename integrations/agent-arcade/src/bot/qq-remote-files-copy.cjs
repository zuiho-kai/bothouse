'use strict';
// Original bounded download/stage/mkdir/upload composition; no native copy endpoint.
const P=require('./qq-remote-policy.cjs'),F=require('./qq-remote-files-policy.cjs');
const {QQRemoteCopyStage,LIMITS}=require('./qq-remote-file-copy-stage.cjs');
const COPY_LIMITS=Object.freeze({writeSteps:48,requestIntervalMs:1100});
const pathOf=(root,parent,rel)=>rel.split('/').filter(Boolean).reduce((p,n)=>F.join(root,p,n),parent);
const manifest=tree=>[...tree.dirs.map(relativePath=>({relativePath,kind:'directory'})),...tree.files.map(r=>({relativePath:r.relativePath,kind:'file',bytes:r.blob.bytes,sha256:r.blob.sha256}))].sort((a,b)=>a.relativePath<b.relativePath?-1:a.relativePath>b.relativePath?1:0);
const receipt=relativePath=>({relativePath,submission:'not_submitted',bridgeResponse:'unavailable',outcome:'not_submitted',observation:'unavailable'});
function validReceipt(r){return P.plain(r)&&['attempted','not_submitted'].includes(r.submission)&&['received','unavailable'].includes(r.bridgeResponse)&&['acknowledged','unknown','not_submitted'].includes(r.outcome)&&!(r.outcome==='acknowledged'&&(r.submission!=='attempted'||r.bridgeResponse!=='received'))&&!(r.submission==='not_submitted'&&r.outcome!=='not_submitted');}
class QQRemoteFileCopy{
 constructor({client,root,selected,destination,stage=new QQRemoteCopyStage(),paceMs=COPY_LIMITS.requestIntervalMs}){Object.assign(this,{client,root,selected,destination,stage,paceMs});this.items=[];this.lastRequest=0;this.steps=0;this.bytes=0;this.files=0;this.directories=0;}
 async _pace(o){o.assertCurrent();let remaining=this.lastRequest+this.paceMs-performance.now();while(remaining>0){await new Promise(r=>setTimeout(r,Math.min(remaining,50)));o.assertCurrent();remaining=this.lastRequest+this.paceMs-performance.now();}this.lastRequest=performance.now();}
 async _list(dir,o){await this._pace(o);const raw=await this.client.fileList(dir,o);o.assertCurrent();return F.rows(raw,this.root);}
 async _walk(base,o){const dirs=[''],files=[],observations=[];for(let i=0;i<dirs.length;i++){if(dirs.length>COPY_LIMITS.writeSteps)P.fail('files_limit');const rel=dirs[i],rows=await this._list(pathOf(this.root,base,rel),o);observations.push({path:pathOf(this.root,base,rel),digest:P.digest(rows)});for(const row of rows){const next=rel?rel+'/'+row.name:row.name;if(next.split('/').length>LIMITS.depth)P.fail('files_limit');if(row.kind==='directory')dirs.push(next);else files.push({relativePath:next,size:row.size});if(dirs.length+files.length>LIMITS.entries)P.fail('files_limit');}}return {dirs:dirs.slice(1).sort(),files,observations};}
 async _download(remotePath,archive,o){const blob=this.stage.create(archive?LIMITS.archive:LIMITS.file);await this._pace(o);const r=await this.client.fileDownload({remotePaths:[remotePath],sink:blob,archive},o);o.assertCurrent();if(!P.plain(r)||r.saved!==true||r.bytes!==blob.bytes||r.sha256!==blob.sha256||!blob.sealed)P.fail('invalid_response');await blob.verify(o);return blob;}
 async _tree(entry,o){
  if(entry.kind==='file'){const blob=await this._download(entry.path,false,o);if(blob.bytes!==entry.size)P.fail('file_baseline_changed');return {files:[{relativePath:'',blob}],dirs:[],observations:[]};}
  const observed=await this._walk(entry.path,o),archive=await this._download(entry.path,true,o),tree=await this.stage.archive(archive,entry.name,this.root.style,o);
  // A successful ZIP can omit empty directories; listings are a separate observation.
  const dirs=[...new Set([...observed.dirs,...tree.dirs])].sort(),all=new Map();
  for(const rel of dirs){const key=rel.toLowerCase();if(all.has(key))P.fail('file_archive_invalid');all.set(key,{path:rel,directory:true});}
  for(const row of tree.files){const key=row.relativePath.toLowerCase();if(all.has(key))P.fail('file_archive_invalid');all.set(key,{path:row.relativePath,directory:false});}
  for(const rel of [...dirs,...tree.files.map(f=>f.relativePath)]){const parts=rel.split('/');for(let i=1;i<parts.length;i++){const parent=parts.slice(0,i).join('/'),v=all.get(parent.toLowerCase());if(!v||!v.directory||v.path!==parent)P.fail('file_archive_invalid');}}
  for(const row of observed.files){const found=tree.files.find(r=>r.relativePath===row.relativePath);if(!found||found.blob.bytes!==row.size)P.fail('file_baseline_changed');}
  await archive.close();return {files:tree.files,dirs,observations:observed.observations};
 }
 _steps(item){
  if(item.entry.kind==='file'){if(Buffer.byteLength(item.entry.name)>240)P.fail('file_name_unsupported');return [{kind:'upload',path:this.destination.path,files:[{name:item.entry.name,blob:item.tree.files[0].blob}]}];}
  const out=[{kind:'mkdir',path:item.destination}],dirs=item.tree.dirs.slice().sort((a,b)=>a.split('/').length-b.split('/').length||a.localeCompare(b));
  for(const rel of dirs)out.push({kind:'mkdir',path:pathOf(this.root,item.destination,rel)});
  const groups=new Map();for(const row of item.tree.files){const parts=row.relativePath.split('/'),name=parts.pop(),parent=parts.join('/');if(Buffer.byteLength(name)>240)P.fail('file_name_unsupported');if(!groups.has(parent))groups.set(parent,[]);groups.get(parent).push({name,blob:row.blob});}
  for(const [parent,files]of groups)for(let at=0;at<files.length;at+=20)out.push({kind:'upload',path:pathOf(this.root,item.destination,parent),files:files.slice(at,at+20)});return out;
 }
 async prepare(o){
  for(const entry of this.selected){o.assertCurrent();const tree=await this._tree(entry,o),item={entry,tree,destination:F.join(this.root,this.destination.path,entry.name)};item.steps=this._steps(item);this.items.push(item);this.steps+=item.steps.length;this.bytes+=tree.files.reduce((n,r)=>n+r.blob.bytes,0);this.files+=tree.files.length;this.directories+=entry.kind==='directory'?tree.dirs.length+1:0;
   if(this.steps>COPY_LIMITS.writeSteps||this.bytes>LIMITS.data||this.files+this.directories>LIMITS.entries)P.fail('files_limit');}
  await this.verify(o);this.manifestSha256=P.digest(this.items.map(i=>({name:i.entry.name,kind:i.entry.kind,manifest:manifest(i.tree)})));return this;
 }
 summary(){return {files:this.files,directories:this.directories,bytes:this.bytes,writeSteps:this.steps,manifestSha256:this.manifestSha256,content:'raw-bytes',sourceSnapshotVerified:false,metadataPreserved:false};}
 emptyResult(){return {items:this.items.map(i=>receipt(F.relative(this.root,i.destination))),completedItems:0,totalItems:this.items.length,completedSteps:0,totalSteps:this.steps,cleanupVerified:false};}
 async verify(o){for(const item of this.items){for(const b of item.tree.observations){if(P.digest(await this._list(b.path,o))!==b.digest)P.fail('file_baseline_changed');}for(const r of item.tree.files)await r.blob.verify(o);}o.assertCurrent();}
 async _observe(item,o){const entry={...item.entry,path:item.destination},tree=await this._tree(entry,o);try{return P.digest(manifest(tree))===P.digest(manifest(item.tree))?'match':'different';}finally{for(const r of tree.files)await r.blob.close();}}
 async execute(o,result=this.emptyResult()){
  let code,stopped=false;
  for(let index=0;index<this.items.length&&!stopped;index++){
   const item=this.items[index],row=result.items[index];let ack=0;
   for(const step of item.steps){let invoked=false,attempted=false;try{
    o.assertCurrent();await o.beforeWrite?.();o.assertCurrent();
    // Refuse an already observed collision. This cannot establish a server-side CAS.
    const parent=step.kind==='mkdir'?F.api(this.root).dirname(step.path):step.path,names=step.kind==='mkdir'?[F.api(this.root).basename(step.path)]:step.files.map(r=>r.name),rows=await this._list(parent,o);
    if(names.some(n=>rows.some(r=>F.key(this.root,r.name)===F.key(this.root,n))))P.fail('file_baseline_changed');
    await this._pace(o);o.assertCurrent();const opts={...o,onAttempt:()=>{attempted=true;o.onAttempt?.();}};invoked=true;
    const raw=step.kind==='mkdir'?await this.client.fileMutate('mkdir',{path:step.path},opts):await this.client.fileUpload({remoteDirectory:step.path,sources:this.stage.sources(step.files)},opts);
    if(!validReceipt(raw))P.fail('invalid_response');if(raw.submission==='attempted')row.submission='attempted';if(raw.bridgeResponse==='received')row.bridgeResponse='received';
    if(raw.outcome!=='acknowledged'){row.outcome=row.submission==='attempted'?'unknown':'not_submitted';code=raw.code?P.safeCode(raw):'change_unknown';stopped=true;break;}
    ack++;result.completedSteps++;
   }catch(error){const maybe=typeof error?.submitted==='boolean'?error.submitted:attempted||invoked;if(maybe)row.submission='attempted';row.outcome=row.submission==='attempted'?'unknown':'not_submitted';code=P.safeCode(error);stopped=true;break;}}
   if(ack===item.steps.length){row.outcome='acknowledged';result.completedItems++;}
   if(row.submission==='attempted')try{row.observation=await this._observe(item,o);}catch{}
  }
  const attempted=result.items.some(i=>i.submission==='attempted'),received=result.items.some(i=>i.bridgeResponse==='received'),all=result.completedItems===result.totalItems;
  return {submission:attempted?'attempted':'not_submitted',bridgeResponse:received?'received':'unavailable',outcome:all?'acknowledged':attempted?'unknown':'not_submitted',observation:{state:result.items.every(i=>i.observation==='match')?'match':result.items.some(i=>i.observation==='different')?'different':'unavailable',items:result.items.map(i=>({relativePath:i.relativePath,state:i.observation}))},copy:result,...(code?{code}:{})};
 }
}
module.exports={QQRemoteFileCopy,QQRemoteCopyStage,COPY_LIMITS};
