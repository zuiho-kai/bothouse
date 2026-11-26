'use strict';
// Settings card for listen/notify data sources. The list is redrawn from the
// snapshot; the add form is built once so typing is never interrupted.
(() => {
  const card=el('article','settings-card sources-card');
  const title=el('h2',''),note=el('p',''),list=el('div','sources-list'),empty=el('p','fine'),form=el('form','sources-form'),status=el('div','');status.setAttribute('role','status');
  const kind=el('select',''),name=el('input',''),target=el('input',''),pick=el('button','secondary'),notify=el('select',''),add=el('button','primary');
  const recentTitle=el('h3',''),recent=el('ul','sources-recent');
  kind.id='source-kind';name.id='source-name';target.id='source-target';notify.id='source-notify';name.maxLength=60;target.maxLength=2000;pick.type='button';add.type='submit';
  const field=(control,labelNode)=>{const wrap=el('label','sources-field');wrap.append(labelNode,control);return wrap;};
  const labels={kind:el('span',''),name:el('span',''),target:el('span',''),notify:el('span','')};
  form.append(field(kind,labels.kind),field(name,labels.name),field(target,labels.target),pick,field(notify,labels.notify),add);
  // Quick starts: three common things to watch. Each preselects the type and moves to the next field.
  const QUICK=[
    {kind:'ics-file',zh:['日历','.ics 文件或订阅链接，如课程表'],en:['Calendar','An .ics file or subscription link, such as a timetable']},
    {kind:'folder',zh:['文件夹','如下载目录有新文件时'],en:['Folder','Such as new files in Downloads']},
    {kind:'feed',zh:['RSS 或网页','如博客更新时'],en:['RSS or web page','Such as a blog being updated']},
  ];
  const quick=el('div','sources-quick'),quickTitle=el('p','sources-quick-title');quick.setAttribute('role','group');
  const quickButtons=QUICK.map(item=>{
    const b=el('button','sources-quick-button'),head=el('strong',''),hint=el('span','');b.type='button';b.dataset.kind=item.kind;b.append(head,hint);
    b.onclick=()=>{if(busy)return;kind.value=item.kind;target.value='';syncForm();form.scrollIntoView({block:'nearest'});name.focus({preventScroll:true});};
    quick.append(b);return {item,b,head,hint};
  });
  card.append(title,note,list,empty,quickTitle,quick,form,status,recentTitle,recent);
  // Lives on the Notices page; Settings is the fallback when that page is absent.
  const notices=document.getElementById('notices-content');
  (notices||document.querySelector('#settings-view .settings-grid')).append(card);
  const delivery=el('article','settings-card notice-delivery'),deliveryTitle=el('h2',''),profile=el('p','fine');
  const details=el('dl','notice-delivery-results'),when=el('time',''),appResult=el('dd',''),qqResult=el('dd','');
  const whenLabel=el('dt',''),appLabel=el('dt',''),qqLabel=el('dt',''),whenValue=el('dd',''),noAttempt=el('p','fine');
  delivery.id='notice-delivery';delivery.hidden=true;whenValue.append(when);
  details.append(whenLabel,whenValue,appLabel,appResult,qqLabel,qqResult);
  delivery.append(deliveryTitle,profile,details,noAttempt);if(notices)notices.insertBefore(delivery,card);
  const journal=el('details',''),journalTitle=el('summary',''),journalDate=el('input',''),dateLabel=el('label',''),
    viewJournal=el('button','secondary'),saveJournal=el('button','secondary'),journalHint=el('p','fine'),journalStatus=el('p','fine'),journalRows=el('ol','sources-recent');
  journalDate.type='date';journalDate.value=new Date().toISOString().slice(0,10);
  const dateText=el('span',''),journalControls=el('div','role-journal-controls');
  dateLabel.append(dateText,journalDate);viewJournal.type=saveJournal.type='button';journalStatus.setAttribute('role','status');
  journalControls.append(dateLabel,viewJournal,saveJournal);
  journal.append(journalTitle,journalHint,journalControls,journalStatus,journalRows);delivery.append(journal);
  let journalScope=null,journalRequest=0;
  function clearJournal(){journalRequest++;journalRows.replaceChildren();journalStatus.textContent='';}
  journalDate.onchange=clearJournal;
  async function openJournal(operation){
    clearJournal();if(!journalScope||!journalDate.value)return;
    const request=journalRequest;
    try{
      const reply=await window.arcade.sourcesRoleJournal({...journalScope,day:journalDate.value,operation});
      if(request!==journalRequest)return;
      if(operation==='save'){
        journalStatus.textContent=reply.saved?tr('已导出日志。','Journal exported.'):reply.empty?tr('当天没有留存的提醒。','No retained reminders for this day.'):'';
      }else{
        for(const row of reply)journalRows.append(el('li','',row.time.slice(11,19)+' UTC · '+row.name+' · '+row.text));
        if(!reply.length)journalStatus.textContent=tr('当天没有留存的提醒。','No retained reminders for this day.');
      }
    }catch{if(request===journalRequest)journalStatus.textContent=tr('无法读取或保存。请确认当前角色和日期后重试。','Could not read or save. Check the current character and date, then retry.');}
  }
  viewJournal.onclick=()=>openJournal('view');saveJournal.onclick=()=>openJournal('save');
  journal.ontoggle=()=>{if(!journal.open)clearJournal();};
  function renderJournal(data){
    const accountId=data.accounts?.selectedId,historyId=data.bot?.local?.historyId;
    if(journalScope?.accountId!==accountId||journalScope?.historyId!==historyId){
      clearJournal();journal.open=false;journalScope=accountId&&historyId?{accountId,historyId}:null;
    }
    journal.hidden=!journalScope||typeof window.arcade.sourcesRoleJournal!=='function';
    journalTitle.textContent=tr('角色提醒日志','Character reminder journal');
    journalHint.textContent=tr('从当前 App 对话最近留存的 120 条消息中，按 UTC 日期查看搭档已发出的数据源提醒。','Show source reminders in the current App conversation’s last 120 retained messages, by UTC date.');
    dateText.textContent=tr('日期（UTC）','Date (UTC)');journalDate.setAttribute('aria-label',tr('日志日期（UTC）','Journal date (UTC)'));
    viewJournal.textContent=tr('查看当天提醒','View reminders');saveJournal.textContent=tr('导出 JSONL…','Export JSONL…');
  }
  // The recent events can be shown as their own block by the shell.
  window.ArcadeSourcesParts={card,recentTitle,recent};
  const KINDS=[
    {id:'ics-file',kind:'ics',pick:'file',zh:'日历文件（.ics）',en:'Calendar file (.ics)'},
    {id:'ics-url',kind:'ics',zh:'日历订阅链接',en:'Calendar subscription link'},
    {id:'folder',kind:'folder',pick:'folder',zh:'文件夹',en:'Folder'},
    {id:'feed',kind:'feed',mode:'feed',zh:'RSS / Atom 订阅',en:'RSS / Atom feed'},
    {id:'page',kind:'feed',mode:'page',zh:'网页变化',en:'Web page change'},
  ];
  const NOTIFY=[['desktop','桌面通知','Desktop notification'],['companion','让搭档告诉我','Let my companion tell me'],['both','两者都要','Both'],['none','只记录','Record only']];
  let zh=true,busy=false,feedback=null,key='',lang='';
  const tr=(a,b)=>zh?a:b;
  const outcomes={
    failed:['失败','Failed'],unknown:['结果未确认','Outcome unconfirmed'],not_attempted:['未尝试','Not attempted'],unrecorded:['未记录','Not recorded']
  };
  let lastReceipt='';
  function renderDelivery(data){
    const status=data.bot?.companionNotices,attempt=status?.lastAttempt,id=data.accounts?.selectedId;
    const owner=data.accounts?.accounts?.find(row=>row.id===id)?.name||id||'';
    const hasAttempt=!!attempt&&typeof attempt==='object';
    const unreadable=!status||status.lastProblem==='storage_unavailable'||status.lastProblem==='unavailable';
    const hasLegacyTime=Number.isFinite(status?.lastDeliveredAt)&&Number.isFinite(new Date(status.lastDeliveredAt).getTime());
    const next=JSON.stringify([zh,!!status,id,owner,unreadable,hasLegacyTime,hasAttempt,attempt?.at,attempt?.app,attempt?.qq]);
    if(next===lastReceipt)return;lastReceipt=next;
    delivery.hidden=!status&&!id;
    deliveryTitle.textContent=tr('最近一次搭档提醒','Last companion notice');
    profile.hidden=!owner;profile.textContent=owner?tr('当前档案 · ','Current profile · ')+owner:'';
    details.hidden=!hasAttempt;noAttempt.hidden=hasAttempt;
    if(!hasAttempt){
      if(unreadable)noAttempt.textContent=tr('暂时无法读取提醒记录。','Notice records are temporarily unavailable.');
      else if(hasLegacyTime)noAttempt.textContent=tr('旧版未记录各端结果。','Earlier records did not include separate App and QQ outcomes.');
      else noAttempt.textContent=tr('暂无尝试记录。','No attempt recorded.');
      when.removeAttribute('datetime');when.textContent=appResult.textContent=qqResult.textContent='';return;
    }
    whenLabel.textContent=tr('尝试时间','Attempted at');
    const date=new Date(Number.isFinite(attempt.at)?attempt.at:NaN);
    if(Number.isFinite(date.getTime())){when.dateTime=date.toISOString();when.textContent=date.toLocaleString(zh?'zh-CN':'en');}
    else{when.removeAttribute('datetime');when.textContent=tr('时间未记录','Time not recorded');}
    const outcome=code=>tr(...(Object.hasOwn(outcomes,code)?outcomes[code]:outcomes.unknown));
    appLabel.textContent=tr('App 对话','App chat');appResult.textContent=attempt.app==='shown'?tr('已显示在对话中','Shown in chat'):outcome(attempt.app);
    qqLabel.textContent=tr('绑定主人的 QQ 私聊','Bound owner’s QQ chat');qqResult.textContent=attempt.qq==='bridge_accepted'?tr('QQ 桥已受理','Accepted by the QQ bridge'):outcome(attempt.qq);
  }
  const kindLabel=row=>{const match=KINDS.find(k=>k.kind===row.kind&&(row.kind!=='feed'||k.mode===(row.mode||'feed'))&&(row.kind!=='ics'||(k.pick==='file')===!/^https:/i.test(row.target||'')));return match?tr(match.zh,match.en):row.kind;};
  const current=()=>KINDS.find(k=>k.id===kind.value)||KINDS[0];
  function syncForm(){
    const choice=current(),local=!!choice.pick;
    target.readOnly=local;target.placeholder=local?tr('点「选择」','Use Choose'):'https://';pick.hidden=!local;
    pick.textContent=tr('选择…','Choose…');
    for(const control of [kind,name,target,pick,notify,add,...quickButtons.map(row=>row.b)])control.disabled=busy;  }
  function fillOptions(){
    const keep=[kind.value,notify.value];
    kind.replaceChildren(...KINDS.map(k=>{const o=el('option','',tr(k.zh,k.en));o.value=k.id;return o;}));
    notify.replaceChildren(...NOTIFY.map(([id,a,b])=>{const o=el('option','',tr(a,b));o.value=id;return o;}));
    if(keep[0])kind.value=keep[0];if(keep[1])notify.value=keep[1];
  }
  function showStatus(){
    status.textContent=busy?tr('正在处理…','Working…'):feedback?tr(...feedback):'';
  }
  function syncControls(){
    syncForm();
    for(const control of list.querySelectorAll('input, select, button'))control.disabled=busy;
    showStatus();
  }
  function restoreFocus(control){
    if(!control||document.activeElement!==document.body)return;
    const previousRow=control.closest('.sources-row');
    const item=previousRow&&[...list.children].find(row=>row.dataset.sourceId===previousRow.dataset.sourceId);
    const next=previousRow?(item?.querySelector(control.localName)||add):control;
    if(card.contains(next))next.focus({preventScroll:true});
  }
  async function run(fn){
    if(busy)return;
    const focused=card.contains(document.activeElement)?document.activeElement:null;
    busy=true;feedback=null;syncControls();
    try{await fn();}
    catch(error){
      const detail=error?.message||String(error);
      feedback=/\b(?:EPERM|EACCES|EBUSY|EROFS)\b/.test(detail)
        ?['没有保存。请确认数据源配置文件可写后重试。','Not saved. Check that the source configuration file is writable, then try again.']
        :[`没有保存：${detail}`,`Not saved: ${detail}`];
    }finally{busy=false;syncControls();restoreFocus(focused);}
  }
  kind.onchange=()=>{target.value='';syncForm();};
  pick.onclick=()=>run(async()=>{const chosen=await window.arcade.sourcesPick(current().pick);if(chosen)target.value=chosen;});
  form.onsubmit=event=>{
    event.preventDefault();if(busy)return;
    const choice=current(),value=target.value.trim();
    if(!value){feedback=['先填写或选择要留意的位置。','Enter or choose what to watch first.'];showStatus();(choice.pick?pick:target).focus();return;}
    run(async()=>{
      await window.arcade.sourcesAdd({kind:choice.kind,mode:choice.mode,name:name.value.trim(),target:value,notify:notify.value});
      name.value='';target.value='';feedback=['已添加。','Added.'];
    });
  };
  function row(source){
    const item=el('div','sources-row'),body=el('div','sources-row-body');item.dataset.sourceId=source.id;
    const checked=source.lastCheckedAt?new Date(source.lastCheckedAt).toLocaleString(zh?'zh-CN':'en'):tr('尚未检查','Not checked yet');
    body.append(el('strong','',source.name||kindLabel(source)),el('span','sources-meta',`${kindLabel(source)} · ${source.target||''}`),
      el('span',source.lastError?'sources-meta sources-error':'sources-meta',source.lastError?`${tr('上次检查失败','Last check failed')}: ${source.lastError.message||source.lastError.code||''}`:`${tr('上次检查','Last checked')}: ${checked}`));
    const enabled=el('input','');enabled.type='checkbox';enabled.checked=!!source.enabled;enabled.setAttribute('aria-label',`${tr('启用','Enable')} ${source.name||''}`);
    // Native controls already show the requested value on change. Only a
    // published source snapshot can change the displayed saved settings.
    enabled.onchange=()=>{
      const requested=enabled.checked;
      enabled.checked=!!source.enabled;
      return run(()=>window.arcade.sourcesUpdate(source.id,{enabled:requested}));
    };
    const how=el('select','');how.setAttribute('aria-label',tr('提醒方式','How to notify'));how.append(...NOTIFY.map(([id,a,b])=>{const o=el('option','',tr(a,b));o.value=id;return o;}));how.value=source.notify;
    how.onchange=()=>{
      const requested=how.value;
      how.value=source.notify;
      return run(()=>window.arcade.sourcesUpdate(source.id,{notify:requested}));
    };
    const remove=el('button','plain',tr('移除','Remove'));remove.type='button';remove.setAttribute('aria-label',`${tr('移除','Remove')} ${source.name||''}`);
    remove.onclick=()=>run(()=>window.arcade.sourcesRemove(source.id));
    for(const control of [enabled,how,remove])control.disabled=busy;
    item.append(body,enabled,how,remove);return item;
  }
  window.renderSources=data=>{
    zh=data.config?.language==='zh';renderDelivery(data);renderJournal(data);
    if(typeof window.arcade?.sourcesAdd!=='function'){card.hidden=true;return;}
    const sources=data.sources?.list||[],events=data.sources?.recent||[];
    if(lang!==data.config?.language){
      lang=data.config?.language;key='';
      title.textContent=tr('数据源','Data sources');
      note.textContent=tr('让 Agent Arcade 留意日历、文件夹和网页更新，并按你选的方式提醒。默认没有任何来源；网络来源只访问你填写的地址，文件夹只看文件名。','Let Agent Arcade watch calendars, folders and web updates, and tell you the way you choose. Nothing is watched by default; network sources only contact the address you enter, and folders are read for file names only.');
      labels.kind.textContent=tr('类型','Type');labels.name.textContent=tr('名称（可选）','Name (optional)');labels.target.textContent=tr('位置','Location');labels.notify.textContent=tr('提醒方式','How to notify');
      quickTitle.textContent=tr('想留意什么？点一个开始：','What should be watched? Pick one to start:');quick.setAttribute('aria-label',tr('常见的数据源','Common sources'));
      for(const row of quickButtons){const [a,b]=zh?row.item.zh:row.item.en;row.head.textContent=a;row.hint.textContent=b;}
      add.textContent=tr('添加数据源','Add source');recentTitle.textContent=tr('最近事件','Recent events');fillOptions();syncForm();showStatus();
    }
    const next=JSON.stringify([sources,events,data.sources?.problem]);
    if(next===key)return;key=next;
    const focused=list.contains(document.activeElement)?document.activeElement:null;
    list.replaceChildren(...sources.map(row));
    restoreFocus(focused);
    empty.hidden=sources.length>0;empty.textContent=data.sources?.problem?`${tr('数据源配置无法读取','The source list could not be read')}: ${data.sources.problem}`:tr('还没有数据源。','No sources yet.');
    recentTitle.hidden=recent.hidden=!events.length;
    recent.replaceChildren(...events.slice(0,8).map(event=>{const li=el('li','');li.append(el('span','',event.title||''),el('time','sources-meta',event.at?new Date(event.at).toLocaleString(zh?'zh-CN':'en'):''));return li;}));
  };
})();
