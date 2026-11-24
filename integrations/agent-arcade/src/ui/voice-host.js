'use strict';
(() => {
  let current=null,latest=null,entry=null,identity=null,lang=null,sourceKey=null,cleanupEntry=null,cleanupError=null,cleanupPending=null;
  const kindOf=state=>state?.desktopChat?.kind==='local'?'local':'channel';
  const sourceOf=state=>kindOf(state)==='local'?{sourceKind:'local',localGeneration:state?.bot?.local?.generation,localCharacterId:state?.bot?.local?.characterId}:{sourceKind:'channel'};
  const sourceKeyOf=state=>JSON.stringify([state?.accounts?.selectedId,sourceOf(state),kindOf(state)==='local'?state?.bot?.local?.historyId:null]);
  const matchesSource=(next,source)=>!!next&&(source.sourceKind==='local'?next.sourceKind==='local'&&next.localGeneration===source.localGeneration&&next.localCharacterId===source.localCharacterId:next.sourceKind===undefined||next.sourceKind==='channel');
  const canStart=state=>kindOf(state)==='local'?state?.bot?.local?.available===true:!!state?.bot?.social?.active;
  const available=state=>!!window.arcade.voiceStart&&document.body.dataset.view==='bot'&&(kindOf(state)==='local'?canStart(state)&&Number.isSafeInteger(state?.bot?.local?.generation)&&typeof state?.bot?.local?.characterId==='string':canStart(state));
  // An old local generation may still own an unconfirmed shutdown. Keep only
  // its exact close action; never reuse its transcript as the new source.
  const receiptMatches=(next,state)=>!!next&&next.accountId===(state?.accounts?.selectedId||'primary')&&(kindOf(state)==='local'?next.sourceKind==='local'&&Number.isSafeInteger(next.localGeneration)&&next.localCharacterId===state?.bot?.local?.characterId:matchesSource(next,{sourceKind:'channel'}));
  const receiptBinding=next=>({accountId:next.accountId,panelId:next.panelId,sourceKind:next.sourceKind||'channel',...(next.sourceKind==='local'?{localGeneration:next.localGeneration,localCharacterId:next.localCharacterId}:{})});
  const updateCleanup=next=>{
    const needed=!current&&document.body.dataset.view==='bot'&&receiptMatches(next,latest)&&next.needsClose&&next.panelId&&['closing','error'].includes(next.status);
    if(entry)entry.disabled=needed;
    if(!needed){cleanupEntry?.remove();cleanupEntry=null;cleanupError?.remove();cleanupError=null;return;}
    if(!cleanupEntry){cleanupEntry=el('button','plain voice-cleanup-entry');cleanupEntry.type='button';cleanupError=el('span','voice-collapse-error');cleanupError.setAttribute('role','alert');document.querySelector('.bot-heading-actions')?.append(cleanupEntry,cleanupError);}
    const binding=receiptBinding(next),key=JSON.stringify(binding),pending=cleanupPending?.key===key;
    cleanupEntry.textContent=lang==='zh'?(next.status==='closing'||cleanupPending?'正在结束语音…':'结束上次语音'):(next.status==='closing'||cleanupPending?'Ending voice…':'End previous voice');cleanupEntry.disabled=next.status==='closing'||!!cleanupPending;
    const button=cleanupEntry,feedback=cleanupError;
    button.onclick=async()=>{
      if(cleanupPending)return;
      const op={key};cleanupPending=op;feedback.textContent='';updateEntry();
      try{const result=await window.arcade.voiceClose({...binding,reason:'manual-close'});if(result?.status!=='closed'||result?.closeConfirmed!==true||result?.accountId!==binding.accountId||result?.panelId!==binding.panelId)throw Error('Unconfirmed close');}
      catch{if(cleanupEntry===button)feedback.textContent=lang==='zh'?'尚未确认语音已停止，请重试。':'Voice has not stopped yet. Try again.';}
      finally{if(cleanupPending===op)cleanupPending=null;updateEntry();}
    };
  };
  const updateEntry=()=>{
    if(entry)entry.setAttribute('aria-expanded',String(!!current));
    updateCleanup(latest?.voice);
  };
  function renderPanel(p){
    const next=latest?.voice,sameSource=matchesSource(next,p.source),matches=sameSource&&next?.accountId===p.identity&&next?.panelId===p.panelId;
    p.panel.render({...(matches?next:{status:'idle'}),canStart:canStart(latest)});
  }
  function retire(reason){
    const p=current;current=null;
    if(p){p.retired=true;p.panel.destroy(reason);}
    updateEntry();
  }
  async function collapse(p){
    if(current!==p||p.closing)return;
    p.closing=true;p.collapse.disabled=true;p.error.textContent='';
    p.collapse.textContent=lang==='zh'?'正在结束语音…':'Ending voice…';
    try{
      await p.api.voiceClose('panel-disposed');
      await Promise.allSettled([...p.pending]);
      if(current!==p||p.retired)return;
      // A device probe may enter its finally/cleanup after the first close.
      // Confirm that original owned runtime too, rather than trusting a later probe.
      const ended=await p.api.voiceClose('panel-disposed');
      if(current!==p||p.retired)return;
      if(ended?.status!=='closed'||ended?.accountId!==p.identity||ended?.panelId!==p.panelId||ended?.closeConfirmed!==true)throw Error('Unconfirmed close');
      p.panel.dispose();p.retired=true;current=null;updateEntry();entry?.focus({preventScroll:true});
    }catch{
      if(current!==p||p.retired)return;
      p.error.textContent=p.panel.snapshot()?.error==='Voice shutdown has not been confirmed. Retry ending the session.'?'':p.lang==='zh'?'尚未确认语音已停止，请重试结束语音。':'Voice has not been confirmed stopped. Try ending voice again.';
    }finally{
      if(current===p){p.closing=false;p.panel.setClosing(false);p.collapse.disabled=false;p.collapse.textContent=p.lang==='zh'?'收起语音':'Hide voice';}
    }
  }
  function open(){
    if(!available(latest)||!window.ArcadeVoice||entry?.disabled)return;
    if(current){current.panel.element.scrollIntoView({block:'start',behavior:'auto'});current.collapse.focus({preventScroll:true});return;}
    const p={identity,lang,source:sourceOf(latest),panelId:crypto.randomUUID(),retired:false,closing:false,pending:new Set()};
    const binding={accountId:p.identity,panelId:p.panelId,...p.source};
    const track=operation=>{let task;try{task=Promise.resolve(operation());}catch(error){task=Promise.reject(error);}p.pending.add(task);task.then(()=>p.pending.delete(task),()=>p.pending.delete(task));return task;};
    // Closure and capability callbacks retain their original panel binding.
    // Neither delayed cleanup nor a previous account can act on the successor.
    p.api={voiceCapabilities:options=>{
        if(p.closing||p.retired)return Promise.reject(Error('Voice is closing.'));
        return track(()=>window.arcade.voiceCapabilities({...options,...binding}));
      },
      voiceStart:options=>p.closing||p.closePending||p.retired?Promise.reject(Error('Voice is closing.')):track(()=>window.arcade.voiceStart({...options,...binding})),
      voiceFinish:()=>p.closing||p.closePending||p.retired?Promise.reject(Error('Voice is closing.')):window.arcade.voiceFinish(binding),
      voiceConfirm:value=>p.closing||p.closePending||p.retired?Promise.reject(Error('Voice is closing.')):window.arcade.voiceConfirm({...value,...binding}),
      voiceInterrupt:()=>p.closing||p.closePending||p.retired?Promise.reject(Error('Voice is closing.')):window.arcade.voiceInterrupt(binding),
      voiceClose:reason=>{
        if(p.closePending)return p.closePending;
        p.panel?.setClosing?.(true);
        const operation=Promise.resolve(window.arcade.voiceClose({...binding,reason}));p.closePending=operation;
        const settled=()=>{if(p.closePending===operation)p.closePending=null;if(!p.retired&&!p.closing)p.panel?.setClosing?.(false);};operation.then(settled,settled);return operation;
      }};
    p.panel=window.ArcadeVoice.createPanel({api:p.api,language:p.lang,sourceKind:p.source.sourceKind});current=p;
    p.panel.element.id='voice-conversation-panel';
    p.collapse=el('button','plain voice-collapse',p.lang==='zh'?'收起语音':'Hide voice');p.collapse.type='button';p.collapse.onclick=()=>collapse(p);
    p.panel.element.querySelector('.voice-heading').append(p.collapse);
    p.error=el('p','voice-collapse-error');p.error.setAttribute('role','alert');p.panel.element.querySelector('.voice-heading').after(p.error);
    $('bot-inbox').append(p.panel.element);renderPanel(p);updateEntry();
    p.panel.element.scrollIntoView({block:'start',behavior:'auto'});p.collapse.focus({preventScroll:true});
  }
  window.renderVoice=state=>{
    latest=state;const nextId=state.accounts?.selectedId||'primary',nextLang=state.config?.language==='zh'?'zh':'en',nextSource=sourceKeyOf(state),ready=available(state);
    if(identity!==nextId||lang!==nextLang||sourceKey!==nextSource||!ready){
      retire(identity!==nextId?'account-switch':lang!==nextLang?'panel-replaced':sourceKey!==nextSource?'scope-changed':document.body.dataset.view!=='bot'?'view-left':'connection-ended');
      entry?.remove();entry=null;identity=nextId;lang=nextLang;sourceKey=nextSource;
    }
    if(ready&&!entry){
      entry=el('button','secondary voice-entry',lang==='zh'?'语音聊天':'Voice chat');entry.type='button';entry.setAttribute('aria-controls','voice-conversation-panel');entry.onclick=open;
      document.querySelector('.bot-heading-actions')?.prepend(entry);updateEntry();
    }
    if(current)renderPanel(current);
    updateEntry();
  };
})();
