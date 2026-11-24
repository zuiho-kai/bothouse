'use strict';
// Original ZIP preparation; reuses the fixed copy writer and independent observations.
const P=require('./qq-remote-policy.cjs'),F=require('./qq-remote-files-policy.cjs');
const {QQRemoteFileCopy,COPY_LIMITS}=require('./qq-remote-files-copy.cjs');
const {LIMITS}=require('./qq-remote-file-copy-stage.cjs');
class QQRemoteFileExtract extends QQRemoteFileCopy{
 async prepare(o){
  const entry=this.selected[0];if(this.selected.length!==1||entry.kind!=='file')P.fail('file_selection_invalid');if(entry.size>LIMITS.archive)P.fail('file_transfer_too_large');
  this.archive=await this._download(entry.path,true,o);if(this.archive.bytes!==entry.size)P.fail('file_baseline_changed');const tree=await this.stage.archive(this.archive,null,this.root.style,o);
  if(!tree.files.length&&!tree.dirs.length)P.fail('no_changes');if(tree.files.length+tree.dirs.length>LIMITS.entries)P.fail('files_limit');this.archiveEntries=tree.entries;
  const roots=[...new Set([...tree.dirs,...tree.files.map(r=>r.relativePath)].map(p=>p.split('/')[0]))].sort();if(roots.length>COPY_LIMITS.writeSteps)P.fail('files_limit');
  const rows=await this._list(this.destination.path,o);if(roots.some(name=>rows.some(row=>F.key(this.root,row.name)===F.key(this.root,name))))P.fail('file_baseline_changed');
  for(const name of roots){const file=tree.files.find(r=>r.relativePath===name),kind=file?'file':'directory',childTree={files:file?[{relativePath:'',blob:file.blob}]:tree.files.filter(r=>r.relativePath.startsWith(name+'/')).map(r=>({relativePath:r.relativePath.slice(name.length+1),blob:r.blob})),dirs:file?[]:tree.dirs.filter(d=>d.startsWith(name+'/')).map(d=>d.slice(name.length+1)),observations:[]};
   const item={entry:{name,kind,size:file?file.blob.bytes:0},tree:childTree,destination:F.join(this.root,this.destination.path,name)};item.steps=this._steps(item);this.items.push(item);this.steps+=item.steps.length;this.files+=childTree.files.length;this.directories+=kind==='directory'?childTree.dirs.length+1:0;this.bytes+=childTree.files.reduce((n,r)=>n+r.blob.bytes,0);
  }
  if(this.steps>COPY_LIMITS.writeSteps||this.bytes>LIMITS.data)P.fail('files_limit');await this.verify(o);this.manifestSha256=P.digest({archiveSha256:this.archive.sha256,files:tree.files.map(r=>({relativePath:r.relativePath,bytes:r.blob.bytes,sha256:r.blob.sha256})),directories:tree.dirs});return this;
 }
 summary(){return {...super.summary(),archiveName:this.selected[0].name,archiveBytes:this.archive.bytes,archiveSha256:this.archive.sha256,archiveEntries:this.archiveEntries,archiveEntriesVerified:true,targets:this.items.map(i=>({name:i.entry.name,kind:i.entry.kind,relativePath:F.relative(this.root,i.destination)}))};}
 async verify(o){if(this.archive)await this.archive.verify(o);await super.verify(o);}
}
module.exports={QQRemoteFileExtract};
