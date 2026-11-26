'use strict';
(() => {
  const bar=el('div','companion-switcher');bar.id='companion-switcher';bar.setAttribute('aria-label','Companions');
  document.querySelector('main>header').after(bar);
  const list=el('div','companion-tabs'),manage=el('button','plain');
  list.setAttribute('aria-label','Saved companions');
  const roleBox=el('div','companion-role-choice'),roleLabel=el('label',''),roleSelect=el('select','');
  roleSelect.id='companion-builtin-persona';roleLabel.htmlFor=roleSelect.id;roleBox.append(roleLabel,roleSelect);bar.append(list,roleBox,manage);
  let roleBusy=false;

  const page=el('section','view');page.id='accounts-view';page.hidden=true;
  const dialog=el('div','companion-manager companion-manager-page');dialog.id='companion-manager';page.append(dialog);document.querySelector('main').append(page);
  // All accounts live in the main workspace, rather than opening another window.
  Object.defineProperty(dialog,'open',{get:()=>view==='accounts'});
  let returnToCaller=null;
  dialog.close=()=>{
    const callback=returnToCaller;returnToCaller=null;
    if(callback)callback();else switchView('bot');
  };
  dialog.showModal=()=>switchView('accounts');
  page.addEventListener('keydown',event=>{
    if(returnToCaller&&event.key==='Escape'&&!event.defaultPrevented&&!event.target.matches('input,select,textarea')){event.preventDefault();dialog.close();}
  });
  let state,lang,key='',managerMessage='',managerFailed=false,connectingFeedback=null;
  const tr=(zh,en)=>lang==='zh'?zh:en;
  const mac=window.arcade?.platform?.os==='darwin';
  const statusText=s=>({connected:tr('已连接','Connected'),disconnected:tr('未连接','Disconnected'),connecting:tr('连接中','Connecting'),checking:tr('检查中','Checking'),disconnecting:tr('正在断开','Disconnecting'),pairing:tr('等待扫码','Pairing')})[s]||s;
  // One line about a companion in plain words: its AI, where it talks, and the connection state.
  // Whether another companion has a channel is only claimed when the list entry shows evidence of one.
  const aiName=mode=>({api:'Claude',claude:tr('Claude Code（本机登录）','Claude Code (local login)'),native:'Claude Channels',codex:tr('Codex（本机登录）','Codex (local login)'),gpt:'GPT',deepseek:'DeepSeek',gemini:'Gemini',doubao:tr('豆包','Doubao')})[mode]||tr('未选择 AI','No AI chosen');
  const channelName=item=>item.channel==='qqofficial'?tr('QQ 官方机器人','QQ official bot'):item.channel==='qq'?'QQ':item.channel==='feishu'?tr('飞书','Feishu'):item.channel==='x'?'X':item.channel==='messenger'?'Messenger Page':tr('微信','WeChat');
  function describe(item){
    const selected=item.id===state?.accounts?.selectedId,evidence=item.status!=='disconnected'||!!item.accountId||!!item.expectedQQAccountId||!!item.qqBinding||Number(item.incomingCount)>0;
    const linked=evidence||selected&&window.ArcadeFirstRun?.hasChannel(state)===true,appOnly=!linked&&selected&&!!window.ArcadeFirstRun;
    return [aiName(item.mode),linked?channelName(item):appOnly?tr('仅 App 对话','App conversation only'):'',statusText(item.status)].filter(Boolean).join(' · ');
  }
  const letterAvatar=name=>{const first=([...String(name||'').trim()][0]||'?').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]);return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#f3dfe9"/><text x="32" y="43" font-size="30" text-anchor="middle" fill="#7a5568" font-family="sans-serif">${first}</text></svg>`);};
  function failureText(error,kind){
    const source=typeof error?.message==='string'?error.message.slice(0,1600):'';
    const hints={
      INVALID_MIGRATION:['迁移参数无法验证，请重新选择原配置目录。','Migration settings could not be verified. Select the original profile again.'],
      UNREGISTERED_SOURCE:['原账号目录未注册，请重新导入这位搭档。','The source account is not registered. Import this companion again.'],
      SOURCE_CHANGED:['原凭据在迁移期间发生变化。关闭旧应用后重试。','Source credentials changed during migration. Close the old app and retry.'],
      TARGET_EXISTS:['已有凭据副本，未覆盖。请检查已有迁移记录。','A credential copy already exists and was not overwritten. Check the previous migration.'],
      TARGET_WRITE_FAILED:['新凭据副本无法保存或读回。请检查目录权限和磁盘空间。','The new credential copy could not be saved or read back. Check folder permissions and free space.'],
      MIGRATION_TIMEOUT:['迁移进程未在时限内完成。关闭旧应用后重试。','The migration process timed out. Close the old app and retry.'],
      WORKER_FAILED:['迁移辅助进程启动或运行失败。请保留此错误码以便检查。','The migration helper could not start or finish. Keep this error code for diagnosis.'],
      INVALID_RESPONSE:['迁移辅助进程未返回有效回执。请保留此错误码以便检查。','The migration helper did not return a valid receipt. Keep this error code for diagnosis.'],
      PROFILE_MISMATCH:['辅助进程打开的配置目录不匹配。请重新选择原 Electron 配置目录。','The helper opened a different profile. Select the original Electron profile again.'],
      PROFILE_IN_USE:['原配置目录仍被占用。请完全退出使用它的旧应用。','The original profile is still in use. Fully quit the older app using it.'],
      VAULT_INVALID:['原凭据文件格式无法验证，未作修改。','The source credential file could not be validated and was not changed.'],
      VAULT_OPEN_FAILED:['原配置目录无法解密这份凭据。请核对是否选中了原应用的配置目录。','The selected original profile could not decrypt these credentials. Check that it belongs to the original app.'],
      ENCRYPTION_UNAVAILABLE:['系统加密暂不可用。请重新打开应用后再试。','OS encryption is unavailable. Reopen the app and try again.'],
      ACCOUNT_CHANGED:['账号状态已改变，本次操作未继续。请断开后重试。','The account changed, so this operation did not continue. Disconnect and retry.'],
      PROFILE_REQUIRED:['请选择包含 Local State 的原 Electron 配置目录。','Choose the original Electron profile folder containing Local State.'],
      CREDENTIALS_LOCKED:mac?['凭据仍无法读取。请重试钥匙串访问；允许后完全退出并重新打开 App。原凭据和聊天保留。','Saved credentials are still unavailable. Retry Keychain access; after allowing it, fully quit and reopen the App. Original credentials and chats remain.']:['凭据仍已锁定，请先完成迁移。','Credentials remain locked. Complete migration first.'],
      ACCOUNT_IN_USE:['这个社交账号或桥接已被另一位搭档使用。请先断开重复连接。','Another companion is using this social account or bridge. Disconnect the duplicate connection first.'],
      MIGRATION_BUSY:['这位搭档正在迁移，请等待当前操作完成。','This companion is already being migrated. Wait for it to finish.'],
      COPY_NOT_READY:['新凭据副本无法在当前应用打开，未切换原账号。','The new credential copy could not be opened in this app. The original account was kept.'],
    };
    let code=String(error?.code||'').toUpperCase();if(!Object.hasOwn(hints,code))code=source.match(/\(([A-Z_]+)\)/)?.[1]||'';
    if(!Object.hasOwn(hints,code)){
      if(/companion changed|Only a disconnected companion/.test(source))code='ACCOUNT_CHANGED';
      else if(/Local State/.test(source))code='PROFILE_REQUIRED';
      else if(/credentials are locked/.test(source))code='CREDENTIALS_LOCKED';
      else if(/already connected by another companion/.test(source))code='ACCOUNT_IN_USE';
      else if(/already in progress|migration to finish/.test(source))code='MIGRATION_BUSY';
      else if(/already has a managed credential copy/.test(source))code='TARGET_EXISTS';
      else if(/new credential copy could not be opened/.test(source))code='COPY_NOT_READY';
    }
    const prefix=kind==='migration'?tr('凭据迁移未完成','Credential migration did not finish'):kind==='connect'?tr('连接未完成','Connection did not finish'):tr('操作未完成','The action did not finish');
    const detail=Object.hasOwn(hints,code)?`${tr(...hints[code])} (${code})`:tr('请检查当前账号状态后重试。原始错误内容未显示。','Check this account’s current state and retry. Raw error details are not displayed.');
    return `${prefix}：${detail}${kind==='migration'?tr(' 原凭据保留。',' Original credentials were kept.'):''}`;
  }
  function showFeedback(message,failed=false){managerMessage=message;managerFailed=failed;if(dialog.open){drawManager();document.getElementById('companion-manager-feedback')?.scrollIntoView({block:'nearest'});}else if(failed&&message)toast(message);}
  function connectionFeedback(item,name){
    if(item?.status==='connected')return {message:`${name}：${tr('社交账号已连接，可以发送一条消息验证回复。','Social account connected. Send a message to check its reply.')}`,failed:false};
    if(item?.status==='connecting')return {message:`${name}：${tr('正在连接，等待社交平台返回状态…','Connecting; waiting for the social platform to report its state…')}`,failed:false};
    const guidance=item?.channel==='qq'&&window.arcade.qqRuntimeRefresh&&window.qqConnectionGuidance?.(item.problem,lang);
    if(guidance)return {message:`${name}：${guidance}`,failed:true};
    return {message:failureText(item?.credentialState==='locked'?{code:'CREDENTIALS_LOCKED'}:{message:item?.problem},'connect'),failed:true};
  }
  function syncConnectingFeedback(){
    if(!connectingFeedback)return;
    const {id,name}=connectingFeedback,item=state.accounts?.accounts.find(row=>row.id===id),feedback=connectionFeedback(item,name);
    managerMessage=feedback.message;managerFailed=feedback.failed;
    // Keep a focused name/form intact while the long-poll connection settles.
    const node=document.getElementById('companion-manager-feedback');
    if(node){node.textContent=managerMessage;node.className=managerFailed?'problem':'social-hint';node.setAttribute('role',managerFailed?'alert':'status');node.setAttribute('aria-live',managerFailed?'assertive':'polite');}
    if(item?.status!=='connecting')connectingFeedback=null;
  }
  function syncManagerStates(){
    for(const row of dialog.querySelectorAll('.companion-manage-row')){
      const item=state.accounts?.accounts.find(account=>account.id===row.dataset.accountId);if(!item)continue;
      const status=row.querySelector('.companion-manage-status'),connect=row.querySelector('.companion-connect');
      if(status)status.textContent=describe(item);
      if(connect){connect.textContent=item.status==='disconnected'?tr('连接','Connect'):tr('断开','Disconnect');connect.disabled=!!item.credentialMigration||item.status==='disconnected'&&item.credentialState==='locked';}
      const schedules=row.querySelector('.companion-qce-schedules');if(schedules)schedules.disabled=!window.canOpenQQQCESchedule?.(item.id);
    }
  }
  const run=(fn,{kind='update',id,name}={})=>action(async()=>{
    connectingFeedback=null;
    try{
      const result=await fn();state=await window.arcade.snapshot();window.renderAccounts(state);
      if(kind==='migration'){
        const ready=state.accounts?.accounts.find(item=>item.id===id)?.credentialState==='ready';
        showFeedback(result?.cancelled?tr('已取消迁移，原凭据保留。','Migration cancelled. Original credentials were kept.'):result?.migrated&&ready?`${name}：${tr('凭据已迁移，当前应用可以读取。原文件保留；可以点击“连接”继续。','Credentials were migrated and can be opened in this app. Original files are kept; choose Connect to continue.')}`:tr('迁移结果尚未确认，原凭据保留。请核对这位搭档的凭据状态。','Migration was not confirmed. Original credentials are kept; check this companion’s credential state.'),!result?.cancelled&&!(result?.migrated&&ready));
      }else if(kind==='connect'){
        const item=state.accounts?.accounts.find(item=>item.id===id),feedback=connectionFeedback(item,name);showFeedback(feedback.message,feedback.failed);if(item?.status==='connecting')connectingFeedback={id,name};
      }else if(kind==='disconnect')showFeedback(`${name}：${tr('已断开连接。','Disconnected.')}`);
      else if(dialog.open)drawManager();
      return result;
    }catch(error){showFeedback(`${name?`${name}：`:''}${failureText(error,kind)}`,true);return null;}
  });
  window.openCompanionManager=({accountId,onClose}={})=>{returnToCaller=typeof onClose==='function'?onClose:null;connectingFeedback=null;managerMessage='';drawManager();dialog.showModal();if(returnToCaller)dialog.querySelector('.companion-manager-heading button')?.focus();if(typeof accountId==='string')requestAnimationFrame(()=>{if(!dialog.open)return;const row=[...dialog.querySelectorAll('.companion-manage-row')].find(item=>item.dataset.accountId===accountId);row?.scrollIntoView({block:'center',behavior:'auto'});row?.querySelector('input')?.focus({preventScroll:true});});};
  manage.onclick=()=>window.openCompanionManager();
  function drawManager(){
    dialog.replaceChildren();const top=el('div','companion-manager-heading');top.append(el('h2','',tr('一起相处的搭档','Your companions')));const close=el('button','plain',tr('关闭','Close'));close.onclick=()=>dialog.close();top.append(close);dialog.append(top);
    dialog.append(el('p','social-hint',tr('每位搭档保留自己的 AI、社交账号和记忆。切换查看不会断开其他搭档。','Each companion keeps its own AI, social account and memory. Switching does not disconnect the others.')));
    if(managerMessage){const message=el('p',managerFailed?'problem':'social-hint',managerMessage);message.id='companion-manager-feedback';message.setAttribute('role',managerFailed?'alert':'status');message.setAttribute('aria-live',managerFailed?'assertive':'polite');dialog.append(message);}
    for(const item of state?.accounts?.accounts||[]){
      const row=el('div','companion-manage-row'),body=el('div','companion-manage-info');row.dataset.accountId=item.id;const name=el('input');name.value=item.name;name.maxLength=40;name.setAttribute('aria-label',tr('搭档名称','Companion name'));body.append(name,el('p','social-hint companion-manage-status',describe(item)));
      if(item.problem)body.append(el('p','problem',item.channel==='qq'&&window.arcade.qqRuntimeRefresh?window.qqConnectionGuidance?.(item.problem,lang)||item.problem:item.problem));
      if(item.credentialState==='locked')body.append(el('p','social-hint',mac?tr('更新后可能需要再次允许钥匙串访问。查看这位搭档后点击“恢复已保存凭据”；允许后若仍失败，请完全退出并重新打开 App。原加密文件、聊天和记忆保留。','An update may require Keychain access again. View this companion, then choose Recover saved credentials. If access still fails after allowing it, fully quit and reopen the App. Original encrypted files, chats and memory remain.'):tr('原应用凭据无法在当前配置中打开。请先关闭旧窗口，再选择原 Electron 配置目录（包含 Local State），迁移一份加密副本。原文件保留，密钥不会显示。','These credentials are locked in this app profile. Close the old window, then choose its original Electron profile folder (contains Local State) to migrate an encrypted copy. Original files stay unchanged and keys are never displayed.')));
      row.append(body);
      const actions=el('div','companion-manage-actions');const rename=el('button','plain',tr('保存名称','Save name'));rename.onclick=()=>run(()=>window.arcade.accountRename({id:item.id,name:name.value}));
      const connect=el('button','secondary companion-connect',item.status==='disconnected'?tr('连接','Connect'):tr('断开','Disconnect'));connect.onclick=()=>{const current=state.accounts?.accounts.find(row=>row.id===item.id);if(!current)return;return run(()=>current.status==='disconnected'?window.arcade.accountConnect(item.id):window.arcade.accountDisconnect(item.id),{kind:current.status==='disconnected'?'connect':'disconnect',id:item.id,name:current.name});};
      connect.disabled=!!item.credentialMigration||item.status==='disconnected'&&item.credentialState==='locked';
      const select=el('button','plain',tr('查看','View'));select.onclick=()=>run(async()=>{await window.arcade.accountSelect(item.id);dialog.close();});actions.append(rename,connect,select);
      if(item.channel==='qq'&&window.arcade.qqRuntimeRefresh){const runtime=el('button','plain companion-qq-runtime',tr('QQ 登录与运行','QQ sign-in & runtime'));runtime.onclick=()=>window.openQQRuntime?.({accountId:item.expectedQQAccountId||item.accountId||item.qqBinding?.accountId});actions.append(runtime);}
      if(item.channel==='qq'&&window.QQQCESchedule?.available()){const schedules=el('button','plain companion-qce-schedules',tr('定时导出','Scheduled exports'));schedules.disabled=!window.canOpenQQQCESchedule?.(item.id);schedules.title=tr('请先选择这位搭档；离线时仍可管理本机计划','Select this companion first; local schedules remain manageable offline');schedules.onclick=()=>{if(state.accounts?.selectedId===item.id)void window.openQQQCESchedule?.({accountId:item.id});};actions.append(schedules);}
      if(item.credentialState==='locked'&&mac){
        const recovery=el('button','secondary companion-recover',tr('恢复已保存凭据…','Recover saved credentials…'));recovery.type='button';recovery.disabled=item.status!=='disconnected'||item.id!==state.accounts.selectedId;
        recovery.title=item.id!==state.accounts.selectedId?tr('请先查看这位搭档','View this companion first'):'';recovery.onclick=()=>window.ArcadeFirstRun?.open();actions.append(recovery);
      }
      if(item.credentialState==='locked'&&!mac){
        const migration=el('button','secondary',item.credentialMigration?tr('正在迁移…','Migrating…'):tr('迁移原应用凭据…','Migrate original credentials…'));migration.disabled=item.status!=='disconnected'||!!item.credentialMigration;
        migration.onclick=()=>run(async()=>{managerMessage='';migration.disabled=true;migration.textContent=tr('正在迁移…','Migrating…');try{return await window.arcade.accountMigrateCredentials(item.id);}finally{migration.disabled=false;migration.textContent=tr('迁移原应用凭据…','Migrate original credentials…');}},{kind:'migration',id:item.id,name:item.name});actions.append(migration);
      }
      if(item.id!=='primary'){const remove=el('button','plain',tr('移出列表','Remove from list'));remove.disabled=item.status!=='disconnected'||!!item.credentialMigration;remove.title=tr('仅移出列表，保留本机配置和记忆','Only removes the list entry; files and memory are retained');remove.onclick=()=>run(()=>window.arcade.accountRemove(item.id));actions.append(remove);}
      row.append(actions);dialog.append(row);
    }
    const add=el('form','companion-add');const name=el('input');name.placeholder=tr('新搭档的名字','New companion name');name.maxLength=40;name.required=true;name.setAttribute('aria-label',name.placeholder);const create=el('button','primary',tr('添加搭档','Add companion'));create.type='submit';add.append(name,create);add.onsubmit=e=>{e.preventDefault();void run(async()=>{await window.arcade.accountCreate(name.value);dialog.close();switchView('connections');});};
    const old=el('button','plain',tr('导入已有角色的数据文件夹…','Import an existing companion folder…'));old.type='button';old.onclick=()=>run(()=>window.arcade.accountImport());dialog.append(add,old,el('p','social-hint',mac?tr('导入之前，请退出使用该数据文件夹的旧窗口。配置和记忆保留；钥匙串可能再次询问访问权限。','Close the older app before importing its data folder. Configuration and memory remain; Keychain may ask for access again.'):tr('导入之前，请退出使用该数据文件夹的旧窗口。配置和记忆保留；跨应用配置目录的凭据需要迁移一次，密钥不会显示。','Close the older app before importing its data folder. Configuration and memory are retained; credentials from a different app profile need a one-time migration. Keys are never displayed.')));
  }
  roleSelect.onchange=async()=>{
    if(roleBusy)return;
    const profileId=state?.accounts?.selectedId,builtinPersonaId=roleSelect.value||null;
    if(!profileId||state?.bot?.local?.busy)return;
    roleBusy=true;roleSelect.disabled=true;
    try{
      await window.arcade.stConfigure({profileId,builtinPersonaId,characterId:null,groupId:null});
      if(state?.accounts?.selectedId!==profileId)return;
      const result=await window.ArcadeDesktopConversation?.select('local',true,{force:true});
      if(state?.accounts?.selectedId!==profileId)return;
      if(result?.ok===false)toast(tr('角色已选好。请先设置当前 AI，再开始聊天。','The role is selected. Set up the current AI before chatting.'));
      else toast(tr('已切换 App 角色，沿用当前 AI；聊天与记忆按角色分开。','App role switched using the current AI; each role keeps its own chat and memory.'));
    }catch(error){
      if(state?.accounts?.selectedId===profileId)toast(error?.code==='busy'?tr('请先停止当前回复，再切换角色。','Stop the current reply before switching roles.'):tr('角色没有切换，请重新打开选择器后再试。','The role was not switched. Reopen the selector and try again.'));
    }finally{roleBusy=false;key='';if(state)window.renderAccounts(state);}
  };
  window.renderAccounts=next=>{
    if(!dialog.open)returnToCaller=null;
    state=next;lang=next.config?.language;window.renderQQQCESchedule?.(next);bar.hidden=!next.accounts;syncConnectingFeedback();syncManagerStates();const target=window.ArcadeTheme?.target?.(next)||null,nextKey=JSON.stringify([next.accounts,lang,next.desktopChat?.kind,next.bot?.local?.state,next.bot?.local?.available,next.bot?.local?.reason,next.bot?.local?.characterId,next.bot?.local?.busy,next.bot?.st?.settings?.builtinPersonaId,target?.kind,target?.id,target?.name,next.bot?.paired,next.bot?.status,!!window.ArcadeFirstRun]);if(key===nextKey)return;key=nextKey;
    const focusedAccount=list.contains(document.activeElement)?document.activeElement.closest('.companion-tab')?.dataset.accountId:null;
    manage.textContent=tr('添加 / 管理搭档','Add / manage companions');list.setAttribute('aria-label',tr('已保存的搭档档案','Saved companion profiles'));list.replaceChildren();
    roleBox.hidden=next.bot?.st?.available!==true||typeof window.arcade.stConfigure!=='function';
    roleLabel.textContent=tr('内置角色 · 沿用当前 AI','Built-in role · current AI');
    roleSelect.title=tr('只切换 App 内人设；不切换 AI 服务、不复制密钥，也不改变社交账号。每个角色保留自己的 App 聊天和记忆。','Changes only the App role, using the current AI. No provider, key or social account changes. Each role keeps its own App chat and memory.');
    roleSelect.replaceChildren();
    const inherited=el('option','',tr('使用档案人设','Use profile role'));inherited.value='';roleSelect.append(inherited);
    for(const persona of next.personas||[]){const option=el('option','',persona.name?.[lang]||persona.name?.en||persona.id);option.value=persona.id;roleSelect.append(option);}
    roleSelect.value=next.bot?.st?.settings?.builtinPersonaId||'';
    roleSelect.disabled=roleBusy||next.bot?.local?.busy===true||['starting','stopping'].includes(next.bot?.local?.state);

    for(const item of next.accounts?.accounts||[]){
      const local=item.id===next.accounts.selectedId&&next.desktopChat?.kind==='local'?next.bot?.local:null,localLabel=local?(local.state==='starting'?tr('准备 App 聊天','Preparing App chat'):local.state==='stopping'?tr('正在暂停 App','Pausing App chat'):local.reason==='stop_failed'?tr('暂停待确认','Pause unconfirmed'):local.available?tr('App 聊天','App chat'):tr('App 已暂停','App paused')):null;
      // The selected companion shows who the chat is with right now: a library character or a
      // group chat when one is in use, otherwise the built-in persona under the companion's own name.
      const who=item.id===next.accounts.selectedId&&target&&target.kind!=='persona'&&target.name?target:null,appIdle=!local&&item.id===next.accounts.selectedId&&window.ArcadeFirstRun&&!window.ArcadeFirstRun.hasChannel(next)&&item.status==='disconnected';
      const idleLabel=appIdle?(window.ArcadeFirstRun.needed(next)?tr('还没有 AI','No AI yet'):tr('App 对话','App conversation')):null;
      const button=el('button','companion-tab');button.dataset.accountId=item.id;button.setAttribute('aria-pressed',String(item.id===next.accounts.selectedId));button.title=[item.name,who?.name,localLabel||idleLabel||statusText(item.status)].filter(Boolean).join(' · ');
      const persona=next.personas?.find(p=>p.id===local?.characterId)||next.personas?.find(p=>p.id===item.characterId);
      if(who){
        const img=el('img');img.alt='';img.src=letterAvatar(who.name);button.append(img);
        if(who.kind==='character'&&window.ArcadeTheme?.thumb)void window.ArcadeTheme.thumb(who.id).then(url=>{if(url&&img.isConnected)img.src=url;}).catch(()=>{});
      }else if(persona){const img=el('img');img.src=persona.portrait;img.alt='';button.append(img);}
      const body=el('span');body.append(el('strong','',who?who.name:item.name),el('small','',localLabel||idleLabel||(item.credentialState==='locked'?tr('凭据已锁定','Credentials locked'):statusText(item.status))));button.append(body);button.onclick=()=>run(()=>window.arcade.accountSelect(item.id));list.append(button);
    }
    if(focusedAccount&&!bar.hidden)([...list.children].find(button=>button.dataset.accountId===focusedAccount)||manage).focus({preventScroll:true});
    if(dialog.open&&!dialog.contains(document.activeElement))drawManager();
  };
})();
