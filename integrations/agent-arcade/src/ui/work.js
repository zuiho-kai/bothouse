'use strict';
(() => {
  const nav=el('button','nav');nav.dataset.view='work';
  nav.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" aria-hidden="true"><path d="M8 4h8l4 4v12H4V4h4M15 4v5h5M8 13h8M8 17h5"/></svg>';
  const navText=el('span','');nav.append(navText);nav.onclick=()=>switchView('work');
  document.querySelector('nav').insertBefore(nav,document.querySelector('nav [data-view="connections"]'));
  const option=el('option','');option.value='work';$('view-picker').append(option);
  const root=$('work-content');let state={},language='',busy=false,listKey='',lastResult='',frame=null,appReady=false,result=null,lastHostContext='';
  const words={
    zh:{title:'工作与结果',intro:'核对本机会话，查看实际产物。',folder:'选择项目',refresh:'刷新会话',choose:'先选择要查看的项目目录。',observe:'每 15 秒校验会话',sessions:'会话核对',sessionsNote:'官方会话状态与 hooks 分开记录。空闲或回复结束，都不等于任务成功。',none:'没有可显示的会话。',background:'后台会话 · 实验功能',backgroundNote:'使用本机 Claude Code 的登录与额度，在所选项目运行。此入口尚未与微信连接；需要权限时请回原版 Claude Code 处理。关闭本应用不会自动停止这些会话。',prompt:'任务内容（可留空，启动待命会话）',start:'启动后台会话',stop:'停止会话',resume:'重新启动',unknown:'状态待确认',artifact:'查看产物',artifactNote:'选择文本文件，读取实际内容并计算字节数、行数与 SHA-256。单个文件最多 256 KiB / 65,536 字符。此检查不判断任务是否满足需求。',file:'选择文本文件',sample:'试用本地样例',cancel:'取消检查',result:'查看结果',notchecked:'尚未查询',available:'会话状态已更新',unavailable:'暂时无法核对会话',waiting:'等待处理',running:'运行中',ended:'已停止',done:'回复结束 · 未验收',idle:'待命',failed:'发生错误',working:'运行中',blocked:'等待处理',stopped:'已停止',busy:'运行中',completed:'检查完成',cancelled:'检查已取消',input_required:'需要输入',cancelNote:'仅取消此文件检查，不会停止 Claude Code。',scope:'仅管理由此入口创建的后台会话。',pending:'正在处理…'},
    en:{title:'Work & results',intro:'Check local sessions and inspect real artifacts.',folder:'Choose project',refresh:'Refresh sessions',choose:'Choose the project to inspect first.',observe:'Check sessions every 15 seconds',sessions:'Session evidence',sessionsNote:'Official session state and hooks remain separate evidence. Idle or a response ending does not prove task success.',none:'No sessions to display.',background:'Background sessions · experimental',backgroundNote:'Uses local Claude Code login and quota in this project. This entry is not connected to WeChat; handle permissions in original Claude Code. Closing this app does not stop these sessions.',prompt:'Task (leave empty to start an idle session)',start:'Start background session',stop:'Stop session',resume:'Restart',unknown:'Status unconfirmed',artifact:'Inspect an artifact',artifactNote:'Read a text file and calculate its bytes, lines and SHA-256. Up to 256 KiB / 65,536 characters. This check does not judge whether the task met your requirements.',file:'Choose text file',sample:'Try local sample',cancel:'Cancel inspection',result:'View result',notchecked:'Not checked yet',available:'Session evidence updated',unavailable:'Session check unavailable',waiting:'Needs input',running:'Running',ended:'Stopped',done:'Response ended · unverified',idle:'Idle',failed:'Error observed',working:'Running',blocked:'Needs input',stopped:'Stopped',busy:'Running',completed:'Inspection complete',cancelled:'Inspection cancelled',input_required:'Needs input',cancelNote:'Cancels this file inspection only, not Claude Code.',scope:'Only sessions created here can be managed here.',pending:'Working…'}
  };
  const w=k=>(words[language]||words.en)[k]||k;
  words.zh.backgroundShort='在所选项目里启动一个后台 Claude Code 会话。';words.en.backgroundShort='Start a background Claude Code session in the chosen project.';
  words.zh.limitsTitle='限制与须知';words.en.limitsTitle='Limits and notes';
  words.zh.sampleNote='本地样例无需账号、API key 或项目目录，不调用 AI。';words.en.sampleNote='The local sample needs no account, API key or project folder, and makes no AI call.';
  words.zh.sampleFailed='本地样例暂时无法检查，请点击「试用本地样例」重试。';words.en.sampleFailed='The local sample could not be inspected. Select “Try local sample” to retry.';
  async function sample(){try{return await window.arcade.inspectSample();}catch{throw Error(w('sampleFailed'));}}
  window.openLocalSample=()=>{switchView('work');$('work-artifact-title').focus();return perform(sample);};
  function textNode(tag,key,cls=''){const n=el(tag,cls,w(key));n.dataset.workText=key;return n;}
  function button(id,key,fn,cls='secondary'){const b=textNode('button',key,cls);b.id=id;b.onclick=()=>perform(fn);return b;}
  async function perform(fn){if(busy)return;busy=true;renderBusy();$('work-error').textContent='';try{await fn();}catch(e){$('work-error').textContent=e.message||String(e);}finally{busy=false;renderBusy();}}
  function renderBusy(){root.querySelectorAll('button').forEach(b=>b.disabled=busy);for(const id of ['work-refresh','background-start'])$(id).disabled=busy||!state.workspace;$('work-observe').disabled=busy||!state.workspace;}
  function section(title,description){const s=el('section','work-section');s.append(textNode('h2',title),textNode('p',description,'subtitle'));root.append(s);return s;}
  function build(){
    root.append(textNode('h1','title'),textNode('p','intro','subtitle'));
    const error=el('p','problem');error.id='work-error';error.setAttribute('role','alert');root.append(error);
    const head=el('div','work-toolbar'),folder=el('p','work-path');folder.id='work-folder';
    head.append(button('work-folder-pick','folder',()=>window.arcade.workChooseFolder()),folder);root.append(head);
    const sessions=section('sessions','sessionsNote'),toolbar=el('div','work-toolbar');
    const label=el('label','work-check'),observe=el('input');observe.type='checkbox';observe.id='work-observe';observe.onchange=()=>perform(()=>window.arcade.workObserve(observe.checked));label.append(observe,textNode('span','observe'));
    toolbar.append(button('work-refresh','refresh',()=>window.arcade.workRefresh()),label);sessions.append(toolbar);
    const evidence=el('p','fine');evidence.id='work-evidence';const list=el('div','work-list');list.id='work-sessions';sessions.append(evidence,list);
    const background=section('background','backgroundNote'),promptLabel=textNode('label','prompt');promptLabel.htmlFor='background-prompt';
    const prompt=el('textarea','work-prompt');prompt.id='background-prompt';prompt.maxLength=8000;prompt.rows=3;
    // The experimental-session disclaimers stay available, folded behind one disclosure.
    const short=background.children[1],limits=el('details','more-note work-limits');short.dataset.workText='backgroundShort';short.textContent=w('backgroundShort');
    limits.id='work-background-limits';limits.append(textNode('summary','limitsTitle'),textNode('p','backgroundNote','fine'),textNode('p','scope','fine'));
    background.append(limits,promptLabel,prompt,button('background-start','start',async()=>{await window.arcade.backgroundCreate(prompt.value);prompt.value='';},'primary'));
    const diagnostic=el('p','problem');diagnostic.id='work-background-error';diagnostic.hidden=true;diagnostic.setAttribute('role','alert');
    const jobs=el('div','work-list');jobs.id='work-background';background.append(diagnostic,jobs);
    const artifact=section('artifact','artifactNote'),actions=el('div','work-toolbar');artifact.firstElementChild.id='work-artifact-title';artifact.firstElementChild.tabIndex=-1;actions.append(button('artifact-pick','file',()=>window.arcade.inspectArtifact(),'primary'),button('artifact-sample','sample',sample));artifact.append(actions,textNode('p','sampleNote','subtitle'));
    const tasks=el('div','work-list');tasks.id='work-inspections';artifact.append(tasks,textNode('p','cancelNote','fine'));
    const viewer=el('div','work-result');viewer.id='work-result';viewer.hidden=true;artifact.append(viewer);
    // A real artifact is the no-account starting point. Project selection belongs
    // with session evidence, not in front of the independent file picker.
    root.insertBefore(artifact,sessions);sessions.insertBefore(head,toolbar);
  }
  const hostContext=()=>({theme:document.documentElement.dataset.colorScheme==='dark'?'dark':'light',locale:language==='zh'?'zh-CN':'en'});
  function sendHostContext(){if(!frame||!appReady)return;const context=hostContext(),key=JSON.stringify(context);if(key===lastHostContext)return;lastHostContext=key;frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:context},'*');}
  window.addEventListener('arcade:appearance',sendHostContext);
  async function showResult(id){
    result=await window.arcade.inspectionResult(id);
    if(!frame){
      const resource=await window.arcade.resultApp();frame=document.createElement('iframe');frame.id='artifact-app';frame.title=language==='zh'?'文本产物查看器':'Text artifact viewer';frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('referrerpolicy','no-referrer');
      // resource is our fixed bundled UI, never a file selected by the user.
      frame.srcdoc=resource.text.replace('<html lang="en">',`<html lang="${hostContext().locale}" data-color-scheme="${hostContext().theme}">`);appReady=false;lastHostContext='';$('work-result').replaceChildren(frame);$('work-result').hidden=false;
    }
    if(appReady)frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:result},'*');
  }
  window.addEventListener('message',event=>{
    if(!frame||event.source!==frame.contentWindow||!event.data||event.data.jsonrpc!=='2.0')return;
    const message=event.data,id=message.id;
    if(id!==undefined && !((typeof id==='string'&&id.length<80)||(typeof id==='number'&&Number.isSafeInteger(id))))return;
    const reply=value=>frame.contentWindow.postMessage({jsonrpc:'2.0',id,...value},'*');
    if(message.method==='ui/initialize')reply({result:{protocolVersion:'2026-01-26',hostInfo:{name:'Agent Arcade local viewer',version:'0.3.0'},hostCapabilities:{},hostContext:hostContext()}});
    else if(message.method==='ui/notifications/initialized'){appReady=true;sendHostContext();if(result)frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:result},'*');}
    else if(message.method==='ping')reply({result:{}});
    else if(id!==undefined)reply({error:{code:-32601,message:'This local viewer cannot call tools, open links or send messages.'}});
  });
  function row(title,description){const n=el('article','work-row'),body=el('div','work-row-body');body.append(el('strong','',title),el('span','',description));n.append(body);return n;}
  window.renderWork=next=>{
    state=next.work||{};const lang=next.config.language==='zh'?'zh':'en';if(!root.children.length){language=lang;build();}
    if(language!==lang){language=lang;root.querySelectorAll('[data-work-text]').forEach(n=>n.textContent=w(n.dataset.workText));listKey='';}
    sendHostContext();
    navText.textContent=w('title');nav.title=w('title');nav.setAttribute('aria-label',w('title'));option.textContent=w('title');
    $('work-folder').textContent=state.workspace||w('choose');$('work-observe').checked=!!state.observing;
    const monitor=state.sessions||{},checked=monitor.checkedAt?new Date(monitor.checkedAt).toLocaleTimeString():'';
    $('work-evidence').textContent=state.error||monitor.error||`${w(monitor.available?'available':'notchecked')}${checked?' · '+checked:''}${monitor.stale?' · '+w('unknown'):''}`;
    const key=JSON.stringify([language,state]);if(key===listKey){renderBusy();return;}listKey=key;
    const rows=(monitor.sessions||[]).map(s=>row((s.sessionId||s.id).slice(0,8),`${w(s.status==='unknown'?s.state:s.status)}${s.waitingFor?' · '+s.waitingFor:''}`));
    $('work-sessions').replaceChildren(...(rows.length?rows:[el('p','fine',w('none'))]));
    const jobs=(state.background?.jobs||[]).filter(j=>j.workspace===state.workspace).map(j=>{const n=row((j.sessionId||j.launchId||'').slice(0,8),`${w(j.state)}${j.request?' · '+w('unknown'):''}`);if(j.id){if(['stopped','failed','done'].includes(j.state))n.append(button('','resume',()=>window.arcade.backgroundResume(j.id)));else n.append(button('','stop',()=>window.arcade.backgroundStop(j.id)));}return n;});
    $('work-background').replaceChildren(...jobs);
    const backgroundError=state.background?.storageError?(language==='zh'?'后台会话记录无法读取。请检查本地数据；本应用不会据此停止任何会话。':'Background ownership records cannot be read. Check local data; no session will be stopped from these records.'):state.background?.capability?.error||'';
    $('work-background-error').textContent=backgroundError;$('work-background-error').hidden=!backgroundError;
    const inspections=(state.inspections||[]).map(task=>{const n=row(task.label||task.taskId.slice(0,8),w(task.status));if(task.status==='completed')n.append(button('','result',()=>showResult(task.taskId)));else if(!['failed','cancelled'].includes(task.status))n.append(button('','cancel',()=>window.arcade.inspectionCancel(task.taskId)));return n;});
    $('work-inspections').replaceChildren(...inspections);
    renderBusy();
    const complete=(state.inspections||[]).find(t=>t.status==='completed');if(complete&&complete.taskId!==lastResult){lastResult=complete.taskId;showResult(complete.taskId).catch(e=>{$('work-error').textContent=e.message;});}
  };
  if(data)window.renderWork(data);
})();
