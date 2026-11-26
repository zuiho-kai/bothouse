'use strict';
const {randomUUID}=require('node:crypto');
const {listWindowsVoices,renderWindowsVoice,validLine,windowsId}=require('./qq-installed-voices.cjs');
const {canonicalAudibleWav}=require('../bot/qq-voice-payload.cjs');
const unavailable=()=>Object.assign(Error('Selected local voice unavailable'),{code:'voice_render_unavailable'});

class QQCharacterVoices {
  constructor({serenaAvailable,renderSerena,listWindows=listWindowsVoices,renderWindows=renderWindowsVoice}) {
    Object.assign(this,{serenaAvailable,renderSerena,listWindows,renderWindows});
    this.previews=new WeakMap();
    this.pending=new WeakSet();
  }
  async list() {
    let system=[];
    try{system=await this.listWindows();}catch{}
    if(this.serenaAvailable())system.unshift({id:'serena',name:'Serena',locale:'zh-CN'});
    return system;
  }
  async handle(request,service,assertSelected) {
    const {action,id,text,ticket,...scope}=request||{};
    const check=()=>{assertSelected();return service.ownerMedia.validate(scope);};
    if(Object.keys(scope).some(k=>!['revision','accountId','ownerId','roleId'].includes(k)))throw unavailable();
    const identity=JSON.stringify([scope.accountId,scope.ownerId,scope.roleId,scope.revision]);
    return this.handleSelection({action,id,text,ticket},{key:service,identity,check,save:(view,voice)=>{
      service.ownerMedia.setVoice(view,voice);
      return {ownerMedia:service.ownerMedia.view()};
    }});
  }
  async handleGroup(request,service,assertSelected,selectionRevision) {
    const {action,id,text,ticket,...scope}=request||{};
    if(action==='stop'||Object.keys(scope).some(k=>!['revision','accountId','groupId','roleId'].includes(k)))throw unavailable();
    const check=()=>{assertSelected();return service.groupCardVoiceCheck(scope);};
    const identity=JSON.stringify(['group',selectionRevision,scope.accountId,scope.groupId,scope.roleId,scope.revision]);
    return this.handleSelection({action,id,text,ticket},{key:service,identity,check,save:(view,voice)=>
      ({groupVoice:service.setGroupCardVoice(view,voice)})});
  }
  async handleSelection({action,id,text,ticket},{key,identity,check,save}) {
    const view=check();
    if(action==='list'){const choices=await this.list();check();return {choices};}
    if(action==='stop'){this.previews.delete(key);return save(view,null);}
    if(action==='use'){
      const p=this.previews.get(key);
      if(!p||p.ticket!==ticket||Date.now()>=p.expires||p.identity!==identity)throw unavailable();
      const saved=save(view,p.voice);
      this.previews.delete(key);
      return saved;
    }
    if(action!=='preview'||!validLine(text)||(!windowsId(id)&&id!=='serena')||this.pending.has(key))throw unavailable();
    this.pending.add(key);
    this.previews.delete(key);
    try{
      const voice=(await this.list()).find(v=>v.id===id);
      if(!voice)throw unavailable();
      check();
      const wav=id==='serena'?await this.renderSerena(text,{assertCurrent:check}):await this.renderWindows(id,text,{assertCurrent:check});
      try{
        check();
        const sample=canonicalAudibleWav(wav);
        try{
          const token=randomUUID();
          this.previews.set(key,{identity,voice,ticket:token,expires:Date.now()+300000});
          return {ticket:token,durationSeconds:sample.durationSeconds,dataUrl:'data:audio/wav;base64,'+sample.bytes.toString('base64')};
        }finally{sample.bytes.fill(0);}
      }finally{wav.fill(0);}
    }finally{this.pending.delete(key);}
  }
}
module.exports={QQCharacterVoices};
