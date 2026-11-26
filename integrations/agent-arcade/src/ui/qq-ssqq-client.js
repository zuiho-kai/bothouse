'use strict';
// The original Arcade shell controls the bounds/lifetime of a separate manual QQ client.
(() => {
  const METHODS=['qqSSQQRead','qqSSQQPrepare','qqSSQQOpen','qqSSQQBounds','qqSSQQClose'];
  const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
  const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const dialog=node('dialog','qq-ssqq-client');dialog.id='qq-ssqq-client';dialog.setAttribute('aria-labelledby','qsc-title');document.body.append(dialog);
  let context=null,session=null,opening=0,epoch=0,unsubscribe=null;
  const tr=(zh,en)=>session?.language==='en'?en:zh;
  const errors={
    changed:['当前账号或运行状态已变化，请关闭后重新打开。','The account or runtime changed. Close and reopen this view.'],
    cancelled:['已取消。','Cancelled.'],
    operation_in_progress:['上一项操作尚未结束，请稍候。','The previous operation is still in progress.'],
    qq_offline:['请先启动并登录当前 QQ，再打开客户端。','Start and sign in to this QQ account before opening the client.'],
    account_offline:['请先启动并登录当前 QQ，再打开客户端。','Start and sign in to this QQ account before opening the client.'],
    prepared_invalid:['这份客户端文件未通过检查，请重新选择官方压缩包。','Client files did not pass verification. Select the official ZIP again.'],
    archive_invalid:['无法识别这份官方压缩包，请选择 SSQQ 3.5.2 发布的插件 ZIP。','This archive could not be verified. Select the plugin ZIP from the SSQQ 3.5.2 release.'],
    digest_mismatch:['文件与已核实的官方版本不一致，未打开客户端。','The files differ from the verified official release. The client was not opened.'],
    unsupported_version:['当前版本不受支持，请使用固定的 SSQQ 3.5.2 插件包。','Use the supported SSQQ 3.5.2 plugin package.'],
    connection_failed:['暂时无法连接当前 QQ，请检查运行状态后重试。','The current QQ connection is unavailable. Check its runtime and retry.'],
    close_failed:['客户端关闭尚未确认，请再次关闭以重试收尾。','Client closure is unconfirmed. Close again to retry cleanup.'],
    invalid_response:['未取得可核实的结果，请关闭后重新打开。','A verified result was not received. Close and reopen this view.']
  };
  for(const code of ['account_changed','account_mismatch','artifact_changed','asset_changed'])errors[code]=errors.changed;
  for(const code of ['unsupported_package'])errors[code]=errors.unsupported_version;
  for(const code of ['connect_failed','timeout','disconnected','bridge_unhealthy','status_unverified'])errors[code]=errors.connection_failed;
  errors.view_close_failed=errors.close_failed;
  errors.prepare_busy=errors.operation_in_progress;
  errors.prepare_failed=['客户端文件尚未准备完成，请检查磁盘空间后重新选择。','Client preparation did not complete. Check disk space and select the ZIP again.'];
  errors.publication_unconfirmed=['客户端准备结果尚未确认。请保留文件，刷新已准备列表核对。','Client preparation is unconfirmed. Preserve the files and refresh the prepared list.'];
  errors.list_limit=['已准备文件数量达到上限，请先检查已有记录。','The prepared-file limit was reached. Check existing records first.'];
  const message=code=>Object.hasOwn(errors,code)?tr(...errors[code]):tr('本次操作未完成，请核对 QQ 状态或关闭后重新打开。','The operation did not complete. Check the QQ state or close and reopen this view.');
  function binding(){
    const a=context?.accounts?.accounts?.find(p=>p.id===context.accounts.selectedId),r=context?.runtime,id=a?.expectedQQAccountId,row=r?.instances?.find(p=>p.accountId===id);
    if(!a||a.channel!=='qq'||typeof a.id!=='string'||!id||(a.accountId&&a.accountId!==id)||!r?.configured||r.desktopRunning||!row?.processRunning||row.management!=='owned'||row.recoveryRequired||row.reason||row.login?.state!=='online')return null;
    return {accountId:a.id,name:a.name,qqAccountId:id,key:JSON.stringify([a.id,a.channel,a.accountId,a.expectedQQAccountId,a.qqOwnerId,a.characterId,a.mode,r.installationKind,r.desktopDataRoot,r.componentsRoot,r.managedSetupId,r.installation?.current,row.runtimeRevision,row.processGeneration,row.bridges])};
  }
  const available=()=>!!binding()&&METHODS.every(k=>typeof window.arcade?.[k]==='function')&&typeof window.arcade?.onQQSSQQState==='function';
  const active=(s,op)=>session===s&&s.epoch===epoch&&!s.closing&&!s.retired&&binding()?.key===s.key&&(!op||s.busy===op);
  const base=s=>({accountId:s.accountId,panelId:s.panelId});
  const correlated=(r,s)=>record(r)&&r.accountId===s.accountId&&r.panelId===s.panelId;
  const validState=v=>record(v)&&['closed','opening','loaded'].includes(v.status)&&(v.status==='closed'?v.viewId===null&&v.preparedId===null:uuid(v.viewId)&&uuid(v.preparedId));
  const prepared=v=>Array.isArray(v)&&v.length<=64&&v.every((p,i)=>record(p)&&uuid(p.preparedId)&&p.version==='3.5.2-3'&&Number.isSafeInteger(p.files)&&p.files>0&&Number.isSafeInteger(p.bytes)&&p.bytes>0&&!v.slice(0,i).some(x=>x.preparedId===p.preparedId));
  function button(id,label,fn,disabled=false,primary=false){const b=node('button',primary?'primary':'secondary',label);b.type='button';b.id=id;b.disabled=disabled;b.onclick=fn;return b;}
  function bounds(){const r=document.getElementById('qsc-host')?.getBoundingClientRect();if(!r||r.width<1||r.height<1)return null;const x=Math.ceil(r.left),y=Math.ceil(r.top),right=Math.floor(r.right),bottom=Math.floor(r.bottom);if(x<0||y<0||right>innerWidth||bottom>innerHeight||right<=x||bottom<=y)return null;return {x,y,width:right-x,height:bottom-y};}
  function scheduleBounds(){const s=session;if(!s||s.boundsFrame)return;s.boundsFrame=requestAnimationFrame(()=>{s.boundsFrame=null;void syncBounds(s);});}
  async function syncBounds(s){
    if(!active(s)||s.busy||s.state.status!=='loaded'||s.boundsPending)return;
    const value=bounds();if(!value||JSON.stringify(value)===s.lastBounds)return;const viewId=s.state.viewId;s.boundsPending=true;
    try{const r=await window.arcade.qqSSQQBounds({...base(s),viewId,bounds:value});if(!active(s)||s.state.viewId!==viewId)return;if(!correlated(r,s)||r.ok!==true||r.updated!==true)throw Object.assign(Error(),{code:r?.code});s.lastBounds=JSON.stringify(value);}
    catch(e){if(active(s)&&s.state.viewId===viewId){s.feedback=message(e.code);s.failed=true;render();}}
    finally{s.boundsPending=false;if(active(s)&&s.state.viewId===viewId&&s.lastBounds!==JSON.stringify(bounds())&&!s.failed)scheduleBounds();}
  }
  function render(){
    const s=session;if(!s)return;const focused=dialog.contains(document.activeElement)?document.activeElement.id:null;
    const oldHost=document.getElementById('qsc-host'),host=oldHost||node('div','qsc-host');host.id='qsc-host';
    const head=node('header','qsc-head'),titles=node('div');titles.append(node('h2','',tr('手动 QQ 客户端','Manual QQ client')));titles.firstChild.id='qsc-title';titles.append(node('p','qsc-account',s.name||tr('当前 QQ','Current QQ')));
    head.append(titles,button('qsc-close',s.closing?tr('正在关闭…','Closing…'):tr('关闭','Close'),()=>void close(),s.closing));
    const note=node('p','qsc-note',tr('在这里手动查看和操作这个 QQ 账号。此页面读取的内容不交给 AI。AI 的活动范围保持不变。','View and operate this QQ account manually here. Content read on this page is not given to AI. AI activity permissions stay unchanged.'));
    const content=node('div','qsc-content');const showing=s.state.status!=='closed'||s.busy?.kind==='open';
    dialog.classList.toggle('qsc-showing',showing);
    if(showing){host.setAttribute('aria-label',tr('QQ 客户端页面区域','QQ client page area'));host.replaceChildren();if(s.state.status!=='loaded')host.append(node('p','qsc-placeholder',tr('正在载入客户端…','Loading the client…')));content.append(host);}
    else {
      const intro=node('div','qsc-preparation');intro.append(node('p','',tr('选择官方 SSQQ 3.5.2 插件压缩包，仅准备客户端页面，无需安装或启用插件。','Choose the official SSQQ 3.5.2 plugin ZIP to prepare its client page. Installing or enabling the plugin is not required.')),node('p','qsc-source','Stapxs/Stapxs-QQ-Lite-2.0 · v3.5.2 · napcat-plugin-ssqq.zip'));
      const actions=node('div','qsc-actions');actions.append(button('qsc-prepare',tr('选择官方压缩包…','Choose official ZIP…'),()=>void read('prepare'),!!s.busy||s.retired),button('qsc-read',tr('刷新已准备文件','Refresh prepared files'),()=>void read('read'),!!s.busy||s.retired));intro.append(actions);
      if(s.listed&&!s.prepared.length)intro.append(node('p','qsc-empty',tr('还没有准备好的客户端文件。','No prepared client files yet.')));
      const list=node('ul','qsc-list');for(const p of s.prepared){const item=node('li'),info=node('div');info.append(node('h3','',`SSQQ ${p.version}`),node('p','qsc-meta',tr(`${p.files} 个文件 · ${(p.bytes/1048576).toFixed(1)} MB`,`${p.files} files · ${(p.bytes/1048576).toFixed(1)} MB`)));item.append(info,button('qsc-open-'+p.preparedId,tr('打开客户端','Open client'),()=>void openPrepared(p.preparedId),!!s.busy||s.retired,true));list.append(item);}intro.append(list);content.append(intro);
    }
    const foot=node('footer','qsc-footer'),feedback=node('p',s.failed?'qsc-feedback qsc-error':'qsc-feedback',s.feedback);feedback.id='qsc-feedback';feedback.setAttribute('role','status');foot.append(feedback,node('p','qsc-limit',tr('客户端会读取此 QQ 的联系人和动态，可显示支持的头像与静态图片；动图、视频等内容暂不支持。','The client reads this QQ account’s contacts and feed and displays supported avatars and still images. Animated images, video and other media are not supported yet.')));
    dialog.replaceChildren(head,note,content,foot);s.observer?.disconnect();s.observer=new ResizeObserver(scheduleBounds);s.observer.observe(dialog);if(showing)s.observer.observe(host);
    if(focused){const el=document.getElementById(focused);if(el&&dialog.contains(el)&&!el.disabled)el.focus({preventScroll:true});}scheduleBounds();
  }
  async function read(kind){const s=session;if(!s||!active(s)||s.busy||s.state.status!=='closed')return;const op={kind};s.busy=op;s.failed=false;s.feedback=kind==='prepare'?tr('等待选择官方压缩包…','Choose the official ZIP…'):tr('正在读取已准备文件…','Reading prepared files…');render();
    try{const r=await window.arcade[kind==='prepare'?'qqSSQQPrepare':'qqSSQQRead'](base(s));if(!active(s,op))return;if(!correlated(r,s)||r.ok!==true)throw Object.assign(Error(),{code:r?.code});if(r.cancelled===true){s.feedback=tr('已取消选择。','File selection cancelled.');return;}if(!prepared(r.prepared)||!validState(r.state)||r.state.status!=='closed')throw Object.assign(Error(),{code:'invalid_response'});s.prepared=r.prepared.map(p=>({...p}));s.listed=true;s.feedback=kind==='prepare'?tr('客户端文件已准备，可以明确打开。','Client files are prepared. Choose Open client to continue.'):'';}
    catch(e){if(active(s,op)){s.feedback=message(e.code);s.failed=true;}}
    finally{if(session===s&&s.busy===op){s.busy=null;if(!s.closing)render();}}
  }
  async function openPrepared(preparedId){const s=session;if(!s||!active(s)||s.busy||s.state.status!=='closed'||!s.prepared.some(p=>p.preparedId===preparedId))return;const op={kind:'open'};s.busy=op;s.failed=false;s.feedback='';s.openedFrom='qsc-open-'+preparedId;render();
    try{await new Promise(requestAnimationFrame);if(!active(s,op))return;const box=bounds();if(!box)throw Object.assign(Error(),{code:'invalid_response'});const r=await window.arcade.qqSSQQOpen({...base(s),preparedId,bounds:box});if(!active(s,op))return;if(!correlated(r,s)||r.ok!==true||!validState(r.state)||r.state.status==='closed'||r.state.preparedId!==preparedId)throw Object.assign(Error(),{code:r?.code||'invalid_response'});s.state=r.state;s.lastBounds=JSON.stringify(box);s.feedback=r.state.status==='loaded'?tr('客户端页面已载入。QQ 连接状态请查看页面内提示。','Client page loaded. Check its own QQ connection status.') : tr('正在载入客户端…','Loading the client…');}
    catch(e){if(active(s,op)){s.feedback=message(e.code);s.failed=true;}}
    finally{if(session===s&&s.busy===op){s.busy=null;if(!s.closing)render();}}
  }
  async function close(){const s=session;if(!s)return true;if(s.closePromise)return s.closePromise;s.closing=true;s.busy=null;s.feedback=tr('正在关闭客户端…','Closing the client…');render();
    s.closePromise=(async()=>{try{const r=await window.arcade.qqSSQQClose(base(s));if(!correlated(r,s)||r.ok!==true||r.closed!==true)throw Error();if(session!==s)return true;s.observer?.disconnect();if(s.boundsFrame)cancelAnimationFrame(s.boundsFrame);unsubscribe?.();unsubscribe=null;session=null;epoch++;dialog.close();if(s.returnFocus?.isConnected)s.returnFocus.focus({preventScroll:true});return true;}catch{if(session===s){s.failed=true;s.feedback=message('close_failed');s.closing=false;s.closePromise=null;render();document.getElementById('qsc-close')?.focus();}return false;}})();return s.closePromise;
  }
  function onState(r){const s=session;if(!s||!correlated(r,s)||!validState(r.state)||s.closing)return;if(!active(s))return;if(r.state.status!=='closed'&&!s.prepared.some(p=>p.preparedId===r.state.preparedId))return;s.state=r.state;if(r.state.status==='closed'){s.prepared=[];s.listed=false;}if(r.code){s.feedback=message(r.code);s.failed=true;}else s.feedback=r.state.status==='loaded'?tr('客户端页面已载入。QQ 连接状态请查看页面内提示。','Client page loaded. Check its own QQ connection status.'):r.state.status==='closed'?tr('客户端页面已关闭。请刷新已准备文件后重新打开。','Client page closed. Refresh prepared files before opening again.'):tr('正在载入客户端…','Loading the client…');render();if(r.state.status==='closed')document.getElementById('qsc-read')?.focus({preventScroll:true});}
  window.canOpenQQSSQQClient=available;
  window.closeQQSSQQClientOwned=close;
  window.openQQSSQQClient=async()=>{if(!available()||document.hidden||document.body.dataset.view!=='qq-runtime')return false;const token=++opening;if(!await close())return false;const b=binding();if(token!==opening||!b||document.hidden||document.body.dataset.view!=='qq-runtime')return false;session={...b,key:b.key,panelId:crypto.randomUUID(),epoch:++epoch,language:context.language||'zh',prepared:[],listed:false,busy:null,closing:false,retired:false,state:{status:'closed',viewId:null,preparedId:null},feedback:'',failed:false,returnFocus:document.activeElement};unsubscribe=window.arcade.onQQSSQQState(onState);render();dialog.showModal();document.getElementById('qsc-close').focus();void read('read');return true;};
  window.renderQQSSQQClient=next=>{context=next;const s=session;if(!s)return;if(document.hidden||document.body.dataset.view!=='qq-runtime'||binding()?.key!==s.key){s.retired=true;s.prepared=[];void close();return;}if(s.language!==next.language){s.language=next.language;render();}};
  dialog.addEventListener('cancel',event=>{event.preventDefault();void close();});window.addEventListener('resize',scheduleBounds);document.addEventListener('visibilitychange',()=>{if(document.hidden)void close();});window.addEventListener('pagehide',()=>void close());
  if(typeof data!=='undefined'&&data)window.renderQQSSQQClient({runtime:data.qqRuntime,accounts:data.accounts,language:data.config?.language});
})();
