'use strict';

const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {projectGroupRole}=require('../bot/group-public-role.cjs');
const {canonicalGroupSticker}=require('../bot/qq-media.cjs');
const {PORTRAIT_EDGE,verifiedPortrait}=require('./group-drawing-portrait.cjs');

function cardPortrait(library,id,nativeImage){
  try{
    const file=library.portraitSource(id);
    if(!file)return undefined;
    const bytes=canonicalGroupSticker(fs.readFileSync(file),nativeImage,{maxEdge:PORTRAIT_EDGE}).bytes;
    return verifiedPortrait(bytes).toString('base64');
  }catch{return undefined;}
}

function plain(value) {
  return typeof value==='string'?value.replace(/\r\n?/g,'\n')
    .replace(/[^\P{Cc}\n\t]|[\u202a-\u202e\u2066-\u2069]/gu,'').trim():'';
}

function previewGroupCard(library,cardId) {
  const stored=library.get(cardId);
  const {name,description,examples}=projectGroupRole({get:()=>stored},null,null,cardId);
  return {name,description,examples,...previewEntries(stored.characterBook)};
}

function previewGroupBook(library,id) {
  const stored=library.get(id);
  if(!stored)throw Error('Missing lorebook');
  return {name:plain(stored.name),...previewEntries(stored.book)};
}

function previewEntries(book) {
  const entries=[];
  let omitted=0;
  for(const entry of book?.entries??[]){
    if(!entry.enabled)continue;
    const keys=[...new Set(entry.keys.map(plain))], content=plain(entry.content);
    // Social cards use only direct keyword matches. Don't silently broaden an
    // author's conditional, timed, low-probability or case-sensitive trigger.
    if(entry.selective||entry.secondaryKeys?.length||entry.caseSensitive||entry.matchWholeWords||
        entry.group||entry.cooldown||entry.delay||entry.sticky||entry.delayUntilRecursion||
        (entry.useProbability&&entry.probability<100)||content.startsWith('@@')||
        (!entry.constant&&(entry.scanDepth??book.scanDepth)===0)||!content||content.length>600||
        (!entry.constant&&!keys.length)||keys.length>16||keys.some(key=>!key||key.length>64)){
      omitted++;
      continue;
    }
    entries.push({keys:entry.constant?[]:keys,content});
  }
  return {entries,omitted};
}

function selectEntries(preview,indexes){
  if(!Array.isArray(indexes)||indexes.length>12||new Set(indexes).size!==indexes.length||
      indexes.some(i=>!Number.isInteger(i)||i<0||i>=preview.entries.length))throw Error('Invalid book selection');
  return indexes.map(i=>preview.entries[i]);
}

function selectGroupCard(preview,indexes){
  const {name,description,examples}=preview;
  return {name,description,examples,entries:selectEntries(preview,indexes)};
}

function createGroupCardPicker({window,WebContentsView,library,lorebookLibrary,nativeImage}){
  const folder=path.join(__dirname,'../ui');
  const page=path.join(folder,'store-group-card.html'), url=pathToFileURL(page).href;
  return async(target,signal)=>{
    if(signal.aborted||window.isDestroyed())return null;
    const reviewingBook=target.kind==='lorebook';
    if(reviewingBook&&!lorebookLibrary)return null;
    const activeLibrary=reviewingBook?lorebookLibrary:library;
    const readPreview=id=>reviewingBook?previewGroupBook(activeLibrary,id):previewGroupCard(activeLibrary,id);
    const local=new WebContentsView({webPreferences:{partition:'arcade-card-review',sandbox:true,
      contextIsolation:true,nodeIntegration:false,devTools:false,preload:path.join(folder,'store-group-card-preload.cjs')}});
    const contents=local.webContents;
    let finish,selected,preview,portrait;
    const result=new Promise(resolve=>{finish=resolve;});
    const cancel=()=>finish(null);
    const fit=()=>{
      const [width,height]=window.getContentSize();
      local.setBounds({x:0,y:0,width,height});
    };
    const trusted=event=>!signal.aborted&&!contents.isDestroyed()&&event.sender===contents&&
      event.senderFrame===contents.mainFrame&&contents.mainFrame.url===url;
    contents.setWindowOpenHandler(()=>({action:'deny'}));
    for(const action of ['will-navigate','will-redirect','will-frame-navigate','will-attach-webview'])
      contents.on(action,event=>event.preventDefault());
    contents.once('render-process-gone',cancel);
    contents.once('destroyed',cancel);
    contents.ipc.handle('arcade:reviewGroupCard',async(event,input)=>{
      if(!trusted(event))return null;
      if(input?.action==='list')return {target,cards:activeLibrary.list().map(({id,name})=>({id,name}))};
      if(input?.action==='cancel'){cancel();return true;}
      if(input?.action==='preview'){
        selected=null;
        preview=readPreview(input.id);
        portrait=!reviewingBook&&target.maySharePortrait?cardPortrait(library,input.id,nativeImage):undefined;
        selected=input.id;
        return portrait?{...preview,portrait}:preview;
      }
      if(input?.action==='accept'&&selected&&selected===input.id){
        const latest=readPreview(selected);
        if(JSON.stringify(latest)!==JSON.stringify(preview))return false;
        if(reviewingBook){
          const entries=selectEntries(preview,input.indexes);
          if(!entries.length)return false;
          finish({name:preview.name,entries});
          return true;
        }
        const card=selectGroupCard(preview,input.indexes);
        if(input.sharePortrait===true){
          if(!portrait||cardPortrait(library,selected,nativeImage)!==portrait)return false;
          finish({card,portrait});
        }else finish(card);
        return true;
      }
      return false;
    });
    window.once('closed',cancel);
    window.on('resize',fit);
    signal.addEventListener('abort',cancel,{once:true});
    try{
      window.contentView.addChildView(local);
      fit();
      void contents.loadFile(page).then(()=>{if(!signal.aborted&&!contents.isDestroyed())contents.focus();},cancel);
      return await result;
    }finally{
      signal.removeEventListener('abort',cancel);
      window.removeListener('closed',cancel);
      window.removeListener('resize',fit);
      if(!window.isDestroyed())window.contentView.removeChildView(local);
      if(!contents.isDestroyed())contents.close();
    }
  };
}

module.exports={createGroupCardPicker,previewGroupCard,selectGroupCard,cardPortrait};
