'use strict';
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {atomicJSON,readJSON}=require('../core/files.cjs');
const {windowsId}=require('./qq-installed-voices.cjs');

const changed=()=>Object.assign(Error('The App conversation or voice selection changed.'),{code:'changed'});
const voiceId=id=>id==='serena'||windowsId(id);
const fields={
  view:[],list:['revision'],preview:['revision','id','text'],use:['revision','ticket'],stop:['revision'],
};

class AppCharacterVoice {
  constructor({picker,render}){
    this.picker=picker;
    this.render=render;
    this.keys=new WeakMap();
  }
  file(context){
    if(context?.kind!=='local'||typeof context.voiceRole!=='string'||!(/^(?:builtin|card)-[a-z0-9-]{1,100}$/i.test(context.voiceRole)))return null;
    return path.join(context.service.root,'local-companion','reply-voices',context.voiceRole+'.json');
  }
  selection(file){
    const saved=readJSON(file,null);
    const {id,name,locale}=saved?.voice||{};
    const selectedVoice=voiceId(id)&&typeof name==='string'&&name.length<=128&&typeof locale==='string'&&locale.length<=32?
      {id,name,locale}:null;
    return {revision:typeof saved?.revision==='string'?saved.revision:null,selectedVoice};
  }
  async handle(value,current){
    if(!value||typeof value!=='object'||!Object.hasOwn(fields,value.action)||
       Object.keys(value).some(k=>!['action','accountId','contextId',...fields[value.action]].includes(k)))throw changed();
    const context=current(),file=this.file(context);
    if(!file||context.accountId!==value.accountId||context.contextId!==value.contextId)throw changed();
    const check=()=>{
      const next=current();
      if(next?.service!==context.service||next.accountId!==context.accountId||next.contextId!==context.contextId||next.voiceRole!==context.voiceRole)throw changed();
      const selection=this.selection(file);
      if(value.action!=='view'&&selection.revision!==value.revision)throw changed();
      return selection;
    };
    if(value.action==='view')return {selection:check()};
    let key=this.keys.get(context.service);
    if(!key){key={};this.keys.set(context.service,key);}
    const identity=JSON.stringify([context.accountId,context.contextId,context.voiceRole,value.revision]);
    return this.picker.handleSelection(value,{key,identity,check,save:(_previous,voice)=>{
      const revision=randomUUID();
      atomicJSON(file,{voice,revision});
      return {selection:{selectedVoice:voice,revision}};
    }});
  }
  async reply(context,text,{signal,assertCurrent}){
    const file=this.file(context);
    if(!file)return;
    const {selectedVoice,revision}=this.selection(file);
    if(!selectedVoice)return;
    const check=()=>{
      assertCurrent();
      if(signal.aborted||this.selection(file).revision!==revision)throw changed();
    };
    check();
    const wav=await this.render(text,{signal,assertCurrent:check,voice:selectedVoice.id});
    try{check();return wav;}catch(error){if(Buffer.isBuffer(wav))wav.fill(0);throw error;}
  }
}
module.exports={AppCharacterVoice};
