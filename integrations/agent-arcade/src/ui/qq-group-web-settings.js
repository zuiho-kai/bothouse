'use strict';
(() => {
  const section=$('bot-qq-public-web'), toggle=$('bot-qq-public-web-enabled');
  const endpoint=$('bot-qq-public-web-endpoint'), preset=$('bot-qq-public-web-free');
  const save=$('bot-qq-public-web-save'), status=$('bot-qq-public-web-state'), feedback=$('bot-qq-public-web-feedback');
  const source=$('bot-qq-public-web-source');
  const mwmbl='https://api.mwmbl.org/api/v2/search/';
  let view, options;
  const tr=(zh,en)=>options?.language==='zh'?zh:en;
  const savedValue=lookup=>({web:lookup?.web||'',revision:lookup?.revision??null,enabled:!!lookup?.web&&lookup.enabled!==false});
  const matches=(a,b)=>a.enabled===b.enabled&&a.web===b.web&&a.revision===b.revision;
  function fill(saved){
    toggle.checked=saved.enabled;endpoint.value=saved.web;
    endpoint.removeAttribute('aria-invalid');
  }
  function render(){
    section.hidden=!view;
    if(!view)return;
    const {saved,notice,pending}=view,locked=options.locked||pending;
    const dirty=toggle.checked!==saved.enabled||endpoint.value.trim()!==saved.web;
    toggle.disabled=endpoint.disabled=preset.disabled=locked;
    save.disabled=locked||!dirty;
    let state=saved.enabled?
      options.active?tr('已开启','On'):tr('已开启，群接话恢复后可用','On when group replies resume'):
      tr('未开启','Off');
    if(saved.web)state+=' · '+(saved.web===mwmbl?'Mwmbl':tr('自定义来源','Custom source'));
    status.textContent=options.roleName+' · '+state;
    feedback.textContent=pending?tr('正在保存搜索设置…','Saving search settings…'):
      notice==='saved'?(options.active?tr('搜索设置已保存，并在当前 QQ 连接生效。','Search settings saved and active on this QQ connection.'):
        tr('搜索设置已保存。','Search settings saved.')):
      notice==='failed'?tr('保存未确认。请核对搜索来源后重试。','Save unconfirmed. Check the search source and retry.'):
      dirty?tr('修改尚未保存。','Changes are unsaved.'):'';
  }
  function update(next){
    options=next;
    if(!next){view=null;render();return;}
    const saved=savedValue(next.lookup),key=JSON.stringify([next.daily,next.target]);
    if(view?.key!==key){
      view={key,saved,observed:saved,pending:false,notice:''};
      source.open=false;fill(saved);
    }else if(!matches(view.observed,saved)){
      view.observed=saved;
      if(!matches(view.saved,saved)){
        view.saved=saved;
        if(!view.pending){view.notice='';fill(saved);}
      }
    }
    render();
  }
  function edit(){
    if(!view)return;
    view.notice='';endpoint.removeAttribute('aria-invalid');render();
  }
  toggle.onchange=()=>{
    if(toggle.checked&&!endpoint.value.trim())endpoint.value=mwmbl;
    edit();
  };
  endpoint.oninput=edit;
  preset.onclick=()=>{endpoint.value=mwmbl;edit();};
  save.onclick=async()=>{
    if(!view||save.disabled)return;
    const start=view, {target}=options;
    const enabled=toggle.checked,web=endpoint.value.trim();
    if(!web||!endpoint.checkValidity()){
      source.open=true;endpoint.setAttribute('aria-invalid','true');endpoint.focus();view.notice='failed';render();return;
    }
    const previous=start.saved;
    start.pending=true;start.notice='';render();
    try{
      const {expectedAccountId,groupId,roleId,...profile}=target;
      const result=await window.arcade.botConfigure({...profile,qqGroupMediaSelection:{
        expectedAccountId,groupId,roleId,publicLookup:web,publicLookupEnabled:enabled,expectedPublicLookup:previous.revision
      }});
      if(view!==start)return;
      const row=result?.qq?.groups?.outgoingMedia?.find(item=>item.groupId===groupId&&item.roleId===roleId);
      const saved=savedValue(row?.publicLookup);
      if(result?.qq?.expectedAccountId!==expectedAccountId||!saved.revision||saved.web!==new URL(web).href||
        saved.enabled!==enabled||(!matches(start.saved,previous)&&!matches(start.saved,saved)))throw Error('Unconfirmed search settings');
      start.saved=saved;start.notice='saved';fill(saved);
    }catch{if(view===start)start.notice='failed';}
    finally{if(view===start){start.pending=false;render();}}
  };
  window.ArcadeQQGroupWebSettings={update};
})();
