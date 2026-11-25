'use strict';
(() => {
  // Only the open drawer holds the directory. The local preparation setting
  // retains explicitly selected IDs, never the directory rows.
  const PAGE_SIZE=50,MAX_ROWS=10000;
  const drawer=el('dialog','qq-directory');drawer.id='qq-directory';drawer.setAttribute('aria-labelledby','qq-directory-title');document.body.append(drawer);
  let context=null,selected=null,language='zh',kind='friends',serverName='',rows=[],loaded=false,busy=false,query='',page=0,fetchedAt='',errorCode='',epoch=0,returnFocus=null;
  let owner=null,members=null,groupProfile=null,groupAdmin=null,contactAdmin=null;
  let preparation=null;
  const tr=(zh,en)=>language==='zh'?zh:en;
  const issues={
    server_ambiguous:['请选择一个本机连接后查看。','Choose a local connection to view its directory.'],
    server_missing:['所选连接已不存在，请关闭后重新打开。','The selected connection no longer exists. Close and reopen this view.'],
    server_invalid:['请先为这个 QQ 准备已启用的本机连接。','Prepare an enabled local connection for this QQ first.'],
    invalid_config:['连接配置不可用，请在 QQ 账号页检查配置。','The connection configuration is unavailable. Check it on QQ accounts.'],
    config_invalid:['连接配置无法读取，请检查原文件。','The connection configuration cannot be read. Check the original file.'],
    changed:['账号或连接配置已变化，请关闭后重新打开。','The account or connection changed. Close and reopen this view.'],
    operation_in_progress:['后台操作尚未结束，稍后再读取列表。','A runtime operation is still in progress. Read the list again shortly.'],
    unauthorized:['本机连接认证失败，请重新核对搭档绑定。','Local connection authentication failed. Recheck the companion binding.'],
    account_mismatch:['连接中的 QQ 与所选账号不同，未显示列表。','The connection belongs to another QQ account. Its directory was not displayed.'],
    account_changed:['读取期间 QQ 身份发生变化，未显示列表。','The QQ identity changed during the request. Its directory was not displayed.'],
    account_offline:['这个 QQ 尚未在线，请登录后重试。','This QQ is not online. Sign in and retry.'],
    status_unverified:['无法确认 QQ 在线状态，未显示列表。','QQ online status could not be verified. Its directory was not displayed.'],
    endpoint_unverified:['无法确认本机接口属于这个 QQ，未显示列表。请返回 QQ 账号页刷新状态。','The local endpoint could not be verified for this QQ. Its directory was not displayed. Refresh status on QQ accounts.'],
    timeout:['列表读取超时，请稍后刷新。','The directory request timed out. Refresh shortly.'],
    cancelled:['本次读取已取消，可以重新刷新。','This request was cancelled. You can refresh again.'],
    response_too_large:['列表超出当前读取上限，未展示不完整结果。','The directory exceeds the current limit. An incomplete result was not displayed.'],
    invalid_response:['接入组件返回的列表格式无法识别。','The bridge returned an unsupported directory format.'],
    action_failed:['接入组件未能提供列表，请稍后刷新。','The bridge could not provide the directory. Refresh shortly.'],
    connection_failed:['暂时无法连接这个 QQ，请检查后台和登录状态。','Cannot reach this QQ. Check its runtime and sign-in status.'],
    group_not_joined:['当前群列表中没有这个群。请返回群列表，刷新后再查看。','This group is not in the current group list. Go back and refresh before opening it again.'],
    group_changed:['读取期间群列表已变化，成员结果未展示。请返回群列表重新读取。','Group membership changed during the request. No member list was displayed. Go back and read the groups again.'],
  };
  const message=code=>tr(...(issues[code]||issues.connection_failed));
  const bridges=()=>context?.runtime?.instances?.find(item=>item.accountId===selected?.accountId)?.bridges||[];
  function bindingKey(next,accountId){
    const item=next?.runtime?.instances?.find(row=>row.accountId===accountId);
    if(!item)return null;
    return JSON.stringify([next.runtime.installationKind,next.runtime.desktopDataRoot,next.runtime.componentsRoot,next.runtime.managedSetupId,next.runtime.installation?.current?.kind,next.runtime.installation?.current?.setupId,next.accounts?.selectedId,item.accountId,Boolean(item.processRunning),item.runtimeRevision||'',item.bridges||[]]);
  }
  function clearResult(){rows=[];loaded=false;fetchedAt='';errorCode='';page=0;}
  function close(){preparation=null;contactAdmin?.dispose();contactAdmin=null;groupAdmin?.dispose();groupAdmin=null;groupProfile?.dispose();groupProfile=null;closeOwner();epoch++;members=null;busy=false;clearResult();query='';selected=null;serverName='';if(drawer.open)drawer.close();document.documentElement.classList.remove('qq-directory-open');drawer.replaceChildren();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;}
  drawer.addEventListener('cancel',event=>{event.preventDefault();close();});
  drawer.addEventListener('close',()=>{if(!drawer.open&&selected)close();});
  window.addEventListener('pagehide',close);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)close();});
  const button=(text,fn,disabled=false)=>{const node=el('button','secondary',text);node.type='button';node.disabled=disabled;node.onclick=fn;return node;};
  const validId=value=>typeof value==='string'&&/^[1-9]\d{4,14}$/.test(value);
  const preparationProfiles=()=> (context?.accounts?.accounts||[]).filter(row=>row.channel==='qq'&&
    row.expectedQQAccountId===selected?.accountId&&(!row.accountId||row.accountId===selected.accountId)&&
    ['connected','disconnected'].includes(row.status)&&!row.credentialMigration);
  const preparationKey=row=>JSON.stringify([row.id,row.characterId,row.qqOwnerId,row.mode]);
  async function prepareFriends(row){
    preparation=null;
    if(!row){draw();return;}
    const target=preparation={profileId:row.id,accountId:selected.accountId,roleId:row.characterId,key:preparationKey(row),saving:true};
    draw();
    try{
      const value=await window.arcade.qqPrepareFriendContacts({action:'view',profileId:target.profileId,accountId:target.accountId,roleId:target.roleId});
      if(preparation!==target)return;
      if(!value?.ok)throw Error();
      target.saved=value.ids;target.revision=value.revision;target.draft=new Set(value.ids);
    }catch{target.note=tr('无法读取名单，请重新选择搭档。','Could not read the list. Select the companion again.');}
    finally{if(preparation===target){target.saving=false;draw();}}
  }
  function preparationDirty(target){return target.saved.length!==target.draft.size||target.saved.some(id=>!target.draft.has(id));}
  function prepareCheck(id,title){
    const target=preparation,label=el('label','social-toggle'),input=el('input');input.type='checkbox';input.id='qq-prepare-friend-'+id;
    input.checked=target.draft.has(id);input.disabled=target.saving;
    input.onchange=()=>{
      if(preparation!==target||target.saving)return;
      if(input.checked)target.draft.add(id);else target.draft.delete(id);
      target.note='';const top=$('qq-directory-scroll')?.scrollTop;draw();
      if(typeof top==='number')$('qq-directory-scroll').scrollTop=top;
    };
    label.append(input,el('span','',title));return label;
  }
  async function savePreparation(){
    const target=preparation;if(!target?.draft||target.saving||!preparationDirty(target))return;
    target.saving=true;target.note='';draw();
    try{
      const value=await window.arcade.qqPrepareFriendContacts({action:'save',profileId:target.profileId,accountId:target.accountId,
        roleId:target.roleId,revision:target.revision,ids:[...target.draft],...(serverName?{serverName}:{})});
      if(preparation!==target)return;
      if(!value?.ok){target.note=value?.code==='friend_not_found'?tr('有好友已不在目录，请刷新后核对。','A friend is no longer in the directory. Refresh and check the selection.'):tr('保存未完成，原名单仍可重新读取。','Save did not finish. You can reopen the saved list.');return;}
      target.saved=value.ids;target.revision=value.revision;target.draft=new Set(value.ids);
      target.note=tr('已记下；尚未开启自动联系。','Saved for later. Automatic contact is off.');
    }catch{target.note=tr('保存未确认，请重新选择搭档后检查。','Save is unconfirmed. Reselect the companion to check.');}
    finally{if(preparation===target){target.saving=false;draw();}}
  }
  function preparationControls(){
    if(kind!=='friends'||typeof window.arcade.qqPrepareFriendContacts!=='function')return null;
    const panel=el('div','qq-directory-controls'),profiles=preparationProfiles();
    if(!profiles.length){panel.append(el('p','qq-directory-note',tr('为此 QQ 绑定搭档后，可准备待主动联系的好友名单。','Bind a companion to this QQ account to prepare a contact list.')));return panel;}
    const label=el('label','qq-directory-server',tr('待主动联系的搭档','Companion preparing to contact friends')),select=el('select');
    select.id='qq-prepare-companion';label.htmlFor=select.id;
    const blank=el('option','',tr('选择搭档','Choose companion'));blank.value='';select.append(blank);
    for(const row of profiles){
      const role=typeof data!=='undefined'?data?.personas?.find(item=>item.id===row.characterId)?.name?.[language]:null;
      const option=el('option','',[row.name,role].filter(Boolean).join(' · '));option.value=row.id;select.append(option);
    }
    const target=preparation;select.value=target?.profileId||'';select.disabled=target?.saving===true;
    select.onchange=()=>void prepareFriends(profiles.find(row=>row.id===select.value));label.append(select);panel.append(label);
    if(!target){panel.append(el('p','qq-directory-note',tr('名单只保存在本机。自动联系尚未开启。','The list stays on this device. Automatic contact is off.')));return panel;}
    const feedback=el('p','qq-directory-note',target.note||(target.draft?
      tr(`已保存 ${target.saved.length} 位，选中 ${target.draft.size} 位。尚未开启自动联系。`,
        `${target.saved.length} saved, ${target.draft.size} selected. Automatic contact is off.`):tr('正在读取名单…','Reading the saved list…')));
    feedback.setAttribute('role','status');panel.append(feedback);
    if(target.draft){
      if(!busy){
        const visible=new Set(rows.map(row=>row.id));
        for(const id of new Set([...target.saved,...target.draft]))if(!visible.has(id))
          panel.append(prepareCheck(id,tr(`保留 QQ ${id}（当前目录未显示）`,`Keep QQ ${id} (not in the current directory view)`)));
      }
      const save=button(tr('保存待联系名单','Save contact list'),savePreparation,target.saving||!preparationDirty(target));save.id='qq-prepare-save';panel.append(save);
    }
    return panel;
  }
  const validRemark=value=>typeof value==='string'&&value.length<=120&&[...value].length<=60&&!/[\p{Cc}\p{Cf}\u2028\u2029\ud800-\udfff]/u.test(value);
  const validTime=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
  const validTicket=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
  const ownerKey=next=>{const account=next?.accounts?.accounts?.find(row=>row.id===next.accounts.selectedId);return JSON.stringify([bindingKey(next,selected?.accountId),serverName,next?.accounts?.selectedId,account?.channel,account?.status,account?.accountId,account?.expectedQQAccountId,account?.qqOwnerId,account?.characterId,account?.mode]);};
  const ownerArgs=current=>({accountId:current.accountId,panelId:current.panelId});
  const currentOwner=current=>owner===current&&selected&&drawer.open;
  const ownerEligible=()=>owner?.recipient&&kind==='friends'&&loaded&&!busy&&rows.filter(row=>row.id===owner.recipient.ownerId).length===1;
  const ownerIssues={
    original_unsupported:['原备注不在此编辑器的支持范围内，保持只读，避免无法原样恢复。','The original remark is outside this editor’s limits. It remains read-only so it cannot be changed without a supported restore.'],
    owner_not_found:['未在好友缓存中找到指定主人，未开放修改。','The configured owner was not found in the friend cache. Editing is unavailable.'],
    baseline_changed:['缓存备注已经变化。请先重新读取，再核对修改。','The cached remark changed. Read it again before reviewing an edit.'],
    restore_unavailable:['当前无法恢复原备注。请先读取当前备注，核对后再决定。','The previous remark cannot currently be restored. Read the current remark before deciding what to do.'],
    expired_ticket:['本次读取已过期，请重新读取后再保存。','This reading expired. Read the remark again before saving.'],
    stale_ticket:['本次读取已失效，请重新读取后再保存。','This reading is no longer valid. Read the remark again before saving.'],
    invalid_remark:['备注最多 60 个字符，不接受控制字符或换行；空备注表示清除。','Use up to 60 characters without controls or line breaks. An empty remark clears it.'],
    operation_in_progress:['上一项备注操作仍在结束，请稍后再读取。','The previous remark operation is still finishing. Read again shortly.'],
    changed:['账号或连接已变化，请关闭后重新打开。','The account or connection changed. Close and reopen this view.'],
    disconnected:['QQ 管理连接已结束，请检查登录后重新读取；无需先连接 AI。','The QQ management connection ended. Check sign-in and read again; connecting AI is not required.'],
    account_offline:['QQ 当前不在线，请恢复连接后重新读取。','QQ is not online. Restore the connection, then read again.'],
    cancelled:['读取已停止。已提交的修改不会自动恢复。','The read stopped. Submitted changes are not automatically restored.'],
  };
  const ownerError=code=>tr(...(ownerIssues[code]||['备注操作未完成，请检查连接后重新读取。','The remark operation did not complete. Check the connection and read again.']));
  function closeOwner(){const old=owner;owner=null;if(!old)return;clearTimeout(old.timer);old.value='';old.read=null;old.observation=null;old.feedback='';if(typeof window.arcade.qqOwnerRemarkClose==='function')void window.arcade.qqOwnerRemarkClose(ownerArgs(old)).catch(()=>{});}
  async function checkOwner(){
    const account=context?.accounts?.accounts?.find(row=>row.id===context.accounts.selectedId);
    if(!selected||!account||account.channel!=='qq'||!['connected','disconnected'].includes(account.status)||account.expectedQQAccountId!==selected.accountId||(account.status==='connected'&&account.accountId!==selected.accountId)||(account.accountId&&account.accountId!==selected.accountId)||!validId(account.qqOwnerId)||account.qqOwnerId===selected.accountId||!['qqOwnerRemarkAvailability','qqOwnerRemarkRead','qqOwnerRemarkSet','qqOwnerRemarkRestore','qqOwnerRemarkClose'].every(name=>typeof window.arcade[name]==='function'))return;
    const target=owner={accountId:account.id,panelId:crypto.randomUUID(),key:ownerKey(context),recipient:null,mode:false,busy:false,read:null,value:'',feedback:'',problem:false,composing:false,timer:null,observation:null,restoreConfirm:false};
    try{const value=await window.arcade.qqOwnerRemarkAvailability(ownerArgs(target));if(!currentOwner(target))return;
      const recipient=value?.recipient;
      if(value?.ok===true&&value.accountId===target.accountId&&value.panelId===target.panelId&&value.available===true&&recipient&&recipient.accountId===selected.accountId&&validId(recipient.ownerId)&&recipient.ownerId!==recipient.accountId&&recipient.ownerId===account.qqOwnerId&&typeof recipient.role==='string'&&recipient.role.length<=64)target.recipient={accountId:recipient.accountId,ownerId:recipient.ownerId,role:recipient.role};
    }catch{/* Availability is optional; the directory remains read-only. */}
    if(currentOwner(target))draw();
  }
  function validOwnerRead(value,target){
    if(value?.ok!==true||value.accountId!==target.accountId||value.panelId!==target.panelId||value.kind!=='owner-remark'||value.recipient?.accountId!==target.recipient.accountId||value.recipient?.ownerId!==target.recipient.ownerId||value.recipient?.role!==target.recipient.role)return false;
    const observed=value.observed;
    if(!observed||observed.source!=='bridge-cache'||!validTime(observed.fetchedAt)||typeof observed.nickname!=='string'||observed.nickname.length>128)return false;
    if(value.editable===false)return value.reason==='original_unsupported'&&observed.withheld===true&&observed.remark===undefined&&value.ticketId===undefined;
    return value.editable===true&&validRemark(observed.remark)&&validTicket(value.ticketId)&&Number.isSafeInteger(value.expiresAt)&&value.expiresAt>Date.now()&&value.restore&&typeof value.restore.available==='boolean'&&(!value.restore.available||validRemark(value.restore.value));
  }
  async function readOwner(){
    const target=owner;if(!target?.mode||target.busy)return;clearTimeout(target.timer);target.read=null;target.value='';target.observation=null;target.restoreConfirm=false;target.busy=true;target.feedback=tr('正在读取主人的备注…','Reading the owner’s remark…');target.problem=false;drawOwner();
    try{const value=await window.arcade.qqOwnerRemarkRead(ownerArgs(target));if(!currentOwner(target)||!target.mode)return;
      if(value?.ok!==true){target.feedback=ownerError(value?.code);target.problem=true;}
      else if(!validOwnerRead(value,target)){target.feedback=ownerError('invalid_response');target.problem=true;}
      else{target.read=value;target.value=value.editable?value.observed.remark:'';target.feedback=value.editable?'':ownerError(value.reason);target.problem=false;const ticket=value.ticketId;if(ticket)target.timer=setTimeout(()=>{if(currentOwner(target)&&target.read?.ticketId===ticket&&!target.busy){target.read={...target.read,ticketId:null};target.feedback=ownerError('expired_ticket');target.restoreConfirm=false;drawOwner();}},Math.min(300000,value.expiresAt-Date.now()+1));}
    }catch{if(currentOwner(target)){target.feedback=ownerError('read_failed');target.problem=true;}}
    finally{if(currentOwner(target)&&target.mode){target.busy=false;drawOwner();}}
  }
  function openOwner(){if(!ownerEligible())return;owner.mode=true;drawOwner();$('qq-owner-remark-back')?.focus();void readOwner();}
  function backOwner(){closeOwner();draw();$('qq-directory-search')?.focus();void checkOwner();}
  function validObservation(value){return value?.source==='bridge-cache'&&(['observed_match','observed_different'].includes(value.state)?validRemark(value.remark)&&validTime(value.fetchedAt):value.state==='unavailable'&&value.remark===undefined);}
  async function saveOwner(restore=false){
    const target=owner,read=target?.read;if(!target?.mode||target.busy||target.composing||!read?.editable||!validTicket(read.ticketId)||read.expiresAt<=Date.now())return;
    if(restore?!(target.restoreConfirm&&read.restore?.available):!validRemark(target.value)||target.value===read.observed.remark)return;
    const ticketId=read.ticketId,request={...ownerArgs(target),ticketId,...(!restore?{remark:target.value}:{})};clearTimeout(target.timer);target.read={...read,ticketId:null};target.busy=true;target.restoreConfirm=false;target.observation=null;target.feedback=restore?tr('正在提交恢复…','Submitting the restore…'):tr('正在保存备注…','Saving the remark…');target.problem=false;drawOwner();
    try{const value=await window.arcade[restore?'qqOwnerRemarkRestore':'qqOwnerRemarkSet'](request);if(!currentOwner(target)||!target.mode)return;
      const belongs=value?.ok===true&&value.accountId===target.accountId&&value.panelId===target.panelId&&value.ticketId===ticketId&&value.kind==='owner-remark'&&value.recipient?.accountId===target.recipient.accountId&&value.recipient?.ownerId===target.recipient.ownerId&&value.recipient?.role===target.recipient.role&&validObservation(value.observation);
      if(belongs&&value.outcome==='accepted'){target.observation=value.observation;target.feedback=value.observation.state==='observed_match'?tr('修改请求已接受，缓存读回一致。','Change accepted; the cached readback matches.'):value.observation.state==='observed_different'?tr('修改请求已接受，缓存读回仍不同。','Change accepted; the cached readback is still different.'):tr('修改请求已接受，暂未读回备注。','Change accepted; readback is unavailable.');}
      else if(belongs&&value.outcome==='not_submitted'){target.feedback=tr('未提交修改。','No change was submitted. ')+' '+ownerError(value.code);target.problem=true;}
      else{target.feedback=tr('修改结果未确认。请先读取当前备注，再决定下一步。','The change is unconfirmed. Read the current remark before deciding what to do next.');target.problem=true;}
    }catch{if(currentOwner(target)){target.feedback=tr('修改结果未确认。请先读取当前备注，再决定下一步。','The change is unconfirmed. Read the current remark before deciding what to do next.');target.problem=true;}}
    finally{if(currentOwner(target)&&target.mode){target.busy=false;drawOwner();}}
  }
  function updateOwnerControls(){const target=owner;if(!target?.mode)return;const input=$('qq-owner-remark-input'),save=$('qq-owner-remark-save'),count=$('qq-owner-remark-count');if(count){count.textContent=`${[...target.value].length} / 60`;count.classList.toggle('problem',!validRemark(target.value));}if(save){save.textContent=target.value===''?tr('清除备注','Clear remark'):tr('保存备注','Save remark');save.disabled=target.busy||target.composing||!validRemark(target.value)||!validTicket(target.read?.ticketId)||target.read.expiresAt<=Date.now()||target.value===target.read.observed.remark;}if(input)input.readOnly=target.busy||!validTicket(target.read?.ticketId);}
  const remarkText=value=>value===''?tr('未设置','Not set'):`「${value}」`;
  function drawOwner(){
    const target=owner;if(!target?.mode||target.composing)return;const focus=document.activeElement?.id,selection=focus==='qq-owner-remark-input'?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null;
    const head=el('div','qq-directory-heading'),titles=el('div'),title=el('h2','',tr('主人的备注','Owner remark'));title.id='qq-directory-title';titles.append(title,el('p','qq-directory-account',`${target.recipient.role||tr('当前搭档','Current companion')} · QQ ${target.recipient.accountId}`));const exit=button(tr('关闭','Close'),close);exit.id='qq-directory-close';head.append(titles,exit);
    const back=button(tr('返回好友列表','Back to friends'),backOwner);back.id='qq-owner-remark-back';back.classList.add('qq-owner-remark-back');
    const content=el('div','qq-owner-remark-content');content.append(el('p','qq-owner-remark-owner',tr(`主人 QQ ${target.recipient.ownerId}`,`Owner QQ ${target.recipient.ownerId}`)));
    if(target.read){content.append(el('p','qq-owner-remark-label',tr('QQ 昵称','QQ nickname')),el('p','qq-owner-remark-value',target.read.observed.nickname||tr('未提供','Not provided')),el('p','qq-owner-remark-label',tr('本次读取的缓存备注','Cached remark at this reading')),el('p','qq-owner-remark-value',target.read.editable?remarkText(target.read.observed.remark):tr('原备注超出支持范围，未展示。','The unsupported original is not displayed.')));
      if(target.read.editable){const label=el('label','qq-owner-remark-label',tr('修改备注','New remark'));label.htmlFor='qq-owner-remark-input';const input=el('input');input.id='qq-owner-remark-input';input.type='text';input.autocomplete='off';input.spellcheck=false;input.maxLength=1000;input.value=target.value;input.setAttribute('aria-describedby','qq-owner-remark-input-help qq-owner-remark-count');input.oninput=()=>{if(!currentOwner(target))return;target.value=input.value;const wasConfirming=target.restoreConfirm;target.restoreConfirm=false;updateOwnerControls();if(wasConfirming)drawOwner();};input.addEventListener('compositionstart',()=>{if(!currentOwner(target))return;target.composing=true;updateOwnerControls();});input.addEventListener('compositionend',()=>{if(!currentOwner(target))return;target.composing=false;target.value=input.value;drawOwner();});const helper=el('p','qq-directory-note',tr('最多 60 个字符；留空表示清除，空格会原样保留。','Up to 60 characters. Empty clears the remark; spaces are preserved.'));helper.id='qq-owner-remark-input-help';const count=el('span','qq-owner-remark-count');count.id='qq-owner-remark-count';content.append(label,input,helper,count);}
      if(target.observation&&target.observation.state!=='unavailable')content.append(el('p','qq-owner-remark-label',tr('提交后的缓存读回','Cached readback after submission')),el('p','qq-owner-remark-value',remarkText(target.observation.remark)));
      if(target.read.restore?.available&&validTicket(target.read.ticketId)){const restoreBox=el('section','qq-owner-remark-restore');if(target.restoreConfirm){restoreBox.append(el('p','',tr('准备恢复为：','Restore to:')),el('p','qq-owner-remark-value',remarkText(target.read.restore.value)));const confirm=button(tr('确认恢复','Confirm restore'),()=>void saveOwner(true),target.busy);confirm.id='qq-owner-remark-restore-confirm';const cancel=button(tr('暂不恢复','Keep current remark'),()=>{target.restoreConfirm=false;drawOwner();},target.busy);restoreBox.append(confirm,cancel);}else{const restore=button(tr('恢复本次修改前备注','Restore the previous remark'),()=>{target.restoreConfirm=true;drawOwner();},target.busy);restore.id='qq-owner-remark-restore';restoreBox.append(restore);}content.append(restoreBox);}
    }
    content.append(el('p','qq-directory-note',tr('只修改这位搭档 QQ 中对你的备注。独立管理连接不启动 AI、不收聊天，也不改变角色人设。','Changes this companion’s QQ friend remark for you. The separate management connection does not start AI, receive chats or change the character.')));
    const help=el('details','qq-owner-remark-help');help.append(el('summary','',tr('关于缓存与恢复','About cache and restore')),el('p','',tr('昵称和备注来自接入组件缓存，读回一致不代表其他客户端已同步。恢复需先重新读取、再明确确认；关闭此页不会恢复已经提交的修改。','Nickname and remark come from the bridge cache. A matching readback does not confirm other clients have synced. Restore needs a fresh read and explicit confirmation; closing does not undo a submitted change.')));content.append(help);
    const footer=el('div','qq-owner-remark-footer'),status=el('p',target.problem?'problem':'',target.feedback);status.id='qq-owner-remark-status';status.setAttribute('role',target.problem?'alert':'status');const actions=el('div','qq-owner-remark-actions'),refresh=button(tr('读取当前备注','Read current remark'),()=>void readOwner(),target.busy);refresh.id='qq-owner-remark-read';actions.append(refresh);if(target.read?.editable){const save=button(tr('保存备注','Save remark'),()=>void saveOwner(),true);save.id='qq-owner-remark-save';save.className='primary';actions.append(save);}footer.append(status,actions);drawer.replaceChildren(head,back,content,footer);updateOwnerControls();const node=focus&&$(focus);if(node&&drawer.contains(node)&&!node.disabled){node.focus({preventScroll:true});if(selection&&node.setSelectionRange)node.setSelectionRange(...selection);}
  }
  function validDirectory(value,target){
    if(!value||value.accountId!==target.accountId||value.kind!==target.kind||value.source!=='bridge-cache'||typeof value.fetchedAt!=='string'||!Number.isFinite(Date.parse(value.fetchedAt))||!Array.isArray(value.items)||value.items.length>MAX_ROWS)return false;
    if(target.kind==='members')return value.groupId===target.groupId&&new Set(value.items.map(row=>row?.id)).size===value.items.length&&value.items.every(row=>row&&validId(row.id)&&typeof row.nickname==='string'&&row.nickname.length<=500&&typeof row.card==='string'&&row.card.length<=500&&['owner','admin','member'].includes(row.role));
    return value.items.every(row=>row&&validId(row.id)&&(target.kind==='friends'?typeof row.nickname==='string'&&typeof row.remark==='string'&&row.nickname.length<=2000&&row.remark.length<=2000:typeof row.name==='string'&&row.name.length<=2000&&['memberCount','maxMemberCount'].every(key=>row[key]===undefined||(Number.isSafeInteger(row[key])&&row[key]>=0))));
  }
  function groupProfileEligible(){
    const a=context?.accounts?.accounts?.find(row=>row.id===context.accounts.selectedId);
    return !!a&&a.channel==='qq'&&a.expectedQQAccountId===selected?.accountId&&(!a.accountId||a.accountId===selected.accountId)&&['connected','disconnected'].includes(a.status)&&window.hasQQGroupProfileIPC?.()===true;
  }
  function groupProfileKey(next,accountId){
    const a=next?.accounts?.accounts?.find(row=>row.id===next.accounts.selectedId);
    return JSON.stringify([bindingKey(next,accountId),serverName,a?.id,a?.channel,a?.status,a?.accountId,a?.expectedQQAccountId,a?.qqOwnerId,a?.characterId,a?.mode]);
  }
  function contactAdminEligible(){
    const a=context?.accounts?.accounts?.find(row=>row.id===context.accounts.selectedId);
    return !!a&&a.channel==='qq'&&a.expectedQQAccountId===selected?.accountId&&(!a.accountId||a.accountId===selected.accountId)&&['connected','disconnected'].includes(a.status)&&window.hasQQContactAdminIPC?.()===true&&typeof window.ContactAdminView==='function';
  }
  function openContactAdmin(row){
    if(!selected||!drawer.open||kind!=='friends'||busy||!loaded||members||groupProfile||groupAdmin||contactAdmin||!contactAdminEligible()||!rows.includes(row)||!validId(row.id)||row.id===selected.accountId)return;
    const accountId=selected.accountId,contactId=row.id,scrollTop=$('qq-directory-scroll')?.scrollTop||0,a=context.accounts.accounts.find(x=>x.id===context.accounts.selectedId);
    epoch++;closeOwner();contactAdmin=new window.ContactAdminView({host:drawer,createAdapter:window.createQQContactAdminAdapter});
    const back=()=>{contactAdmin=null;draw();const scroll=$('qq-directory-scroll');if(scroll)scroll.scrollTop=scrollTop;drawer.querySelector(`[data-admin-contact="${contactId}"]`)?.focus({preventScroll:true});void checkOwner();};
    contactAdmin.open({profileId:a.id,panelId:crypto.randomUUID(),accountId,contactId,ownerId:a.qqOwnerId,name:row.remark||row.nickname,scopeKey:groupProfileKey(context,accountId),language,onClose:close,onBack:back});
  }
  function openGroupProfile(row){
    if(!selected||!drawer.open||kind!=='groups'||busy||!loaded||members||groupProfile||groupAdmin||!groupProfileEligible()||!rows.includes(row)||!validId(row.id)||typeof window.createQQGroupProfileAdapter!=='function')return;
    epoch++;closeOwner();const accountId=selected.accountId,groupId=row.id;
    groupProfile=new window.GroupProfileView({host:drawer,createAdapter:window.createQQGroupProfileAdapter});
    const back=()=>{groupProfile=null;draw();drawer.querySelector(`[data-profile-group="${groupId}"]`)?.focus({preventScroll:true});};
    groupProfile.open({profileId:context.accounts.selectedId,panelId:crypto.randomUUID(),accountId,groupId,name:row.name,scopeKey:groupProfileKey(context,accountId),language,onClose:close,onBack:back,...(window.hasQQGroupAdminIPC?.()===true?{onManage:()=>{groupProfile=null;openGroupAdmin(row,null);}}:{})});
  }
  function groupAdminEligible(){return groupProfileEligible()&&window.hasQQGroupAdminIPC?.()===true&&typeof window.GroupAdminView==='function';}
  function openGroupAdmin(groupRow,memberRow){
    if(!selected||!drawer.open||kind!=='groups'||busy||groupProfile||groupAdmin||!groupAdminEligible()||!validId(groupRow?.id))return;
    if(memberRow){if(!members||members.busy||!members.loaded||members.groupId!==groupRow.id||!members.rows.includes(memberRow)||!validId(memberRow.id))return;}
    else if(members||!loaded||!rows.includes(groupRow))return;
    const accountId=selected.accountId,memberList=members,memberScroll=$('qq-members-scroll')?.scrollTop||0,bodyScroll=$('qq-members-body')?.scrollTop||0;
    epoch++;closeOwner();groupAdmin=new window.GroupAdminView({host:drawer,createAdapter:window.createQQGroupAdminAdapter});
    const back=()=>{groupAdmin=null;if(memberRow&&members===memberList){drawMembers();const scroll=$('qq-members-scroll'),body=$('qq-members-body');if(scroll)scroll.scrollTop=memberScroll;if(body)body.scrollTop=bodyScroll;drawer.querySelector(`[data-admin-member="${memberRow.id}"]`)?.focus({preventScroll:true});}else{draw();if(rows.includes(groupRow))openGroupProfile(groupRow);else $('qq-directory-refresh')?.focus({preventScroll:true});}};
    groupAdmin.open({profileId:context.accounts.selectedId,panelId:crypto.randomUUID(),accountId,groupId:groupRow.id,groupName:groupRow.name,...(memberRow?{memberId:memberRow.id,memberName:memberRow.card||memberRow.nickname}:{}),scopeKey:groupProfileKey(context,accountId),language,onClose:close,onBack:back});
  }
  function openMembers(row){
    if(!selected||!drawer.open||kind!=='groups'||busy||!loaded||members||!rows.includes(row)||!validId(row.id))return;
    closeOwner();members={groupId:row.id,name:row.name,rows:[],query:'',page:0,loaded:false,busy:false,errorCode:'',fetchedAt:''};
    void loadMembers(false);$('qq-members-back')?.focus();
  }
  function backMembers(){
    if(!members)return;const groupId=members.groupId;epoch++;members=null;draw();
    drawer.querySelector(`[data-members-group="${groupId}"]`)?.focus({preventScroll:true});
  }
  async function loadMembers(fresh=false){
    const target=members;if(!target||!selected||!drawer.open)return;
    const revision=++epoch,request={accountId:selected.accountId,kind:'members',groupId:target.groupId,...(serverName?{serverName}:{}),fresh};
    target.rows=[];target.loaded=false;target.busy=true;target.errorCode='';target.fetchedAt='';target.page=0;drawMembers();
    try{
      const result=await window.arcade.qqRuntimeDirectory(request);
      if(revision!==epoch||members!==target||!selected||!drawer.open)return;
      if(result?.ok!==true)target.errorCode=typeof result?.code==='string'?result.code:'connection_failed';
      else if(!validDirectory(result.directory,request))target.errorCode='invalid_response';
      else{target.rows=result.directory.items;target.fetchedAt=result.directory.fetchedAt;target.loaded=true;}
    }catch{if(revision===epoch&&members===target)target.errorCode='connection_failed';}
    finally{if(revision===epoch&&members===target&&selected&&drawer.open){target.busy=false;drawMembers();}}
  }
  function drawMemberList(){
    const target=members,list=$('qq-members-list'),status=$('qq-members-status'),paging=$('qq-members-paging');if(!target||!list)return;
    list.replaceChildren();paging.replaceChildren();list.setAttribute('aria-busy',String(target.busy));status.className=target.errorCode?'qq-directory-status problem':'qq-directory-status';
    if(target.busy){status.textContent=tr('正在读取成员…','Reading members…');return;}
    if(target.errorCode){status.textContent=message(target.errorCode);return;}
    if(!target.loaded){status.textContent=tr('读取成员后，可在本地搜索。','Read members to search this list locally.');return;}
    const search=target.query.trim().toLocaleLowerCase(),filtered=search?target.rows.filter(row=>[row.id,row.nickname,row.card].some(value=>value.toLocaleLowerCase().includes(search))):target.rows;
    const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));target.page=Math.min(target.page,pages-1);
    status.textContent=filtered.length?tr(`本次列表 ${filtered.length} 位${search?`（共 ${target.rows.length} 位）`:''}`,`${filtered.length} members in this reading${search?` (${target.rows.length} in the list)`:''}`):tr(search?'没有匹配的成员。':'接入组件返回的成员列表为空。',search?'No matching members.':'The bridge returned an empty member list.');
    const roleLabels={owner:tr('群主','Group owner'),admin:tr('管理员','Administrator'),member:tr('成员','Member')};
    for(const row of filtered.slice(target.page*PAGE_SIZE,(target.page+1)*PAGE_SIZE)){
      const item=el('li','qq-directory-row qq-members-row'),person=el('div','qq-directory-person');person.append(el('strong','',row.card||row.nickname||tr('未命名成员','Unnamed member')));
      if(row.card)person.append(el('span','qq-directory-secondary',tr(`昵称：${row.nickname||'未提供'}`,`Nickname: ${row.nickname||'Not provided'}`)));
      person.append(el('span','qq-directory-secondary',row.card?tr('显示群名片','Showing group card'):tr('未设置群名片','No group card')));
      const meta=el('div','qq-directory-meta');meta.append(el('span','qq-members-role',roleLabels[row.role]),el('span','',`QQ ${row.id}`));if(groupAdminEligible()){const manage=button(tr('管理成员','Manage member'),()=>{if(manage.isConnected&&members===target)openGroupAdmin({id:target.groupId,name:target.name},row);});manage.dataset.adminMember=row.id;meta.append(manage);}item.append(person,meta);list.append(item);
    }
    if(filtered.length){const move=amount=>{if(members!==target)return;target.page+=amount;drawMemberList();$('qq-members-scroll').scrollTop=0;$('qq-members-body').scrollTop=0;$('qq-members-scroll').focus({preventScroll:true});};paging.append(button(tr('上一页','Previous'),()=>move(-1),target.page===0),el('span','',tr(`第 ${target.page+1} / ${pages} 页`,`${target.page+1} / ${pages}`)),button(tr('下一页','Next'),()=>move(1),target.page>=pages-1));}
  }
  function drawMembers(){
    const target=members;if(!target||!selected)return;const focus=document.activeElement?.id,selection=focus==='qq-members-search'?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null;
    const head=el('div','qq-directory-heading'),titles=el('div'),title=el('h2','',tr('群成员','Group members'));title.id='qq-directory-title';titles.append(title,el('p','qq-directory-account',`${selected.name||tr('QQ 账号','QQ account')} · QQ ${selected.accountId}`));const exit=button(tr('关闭','Close'),close);exit.id='qq-directory-close';head.append(titles,exit);
    const back=button(tr('返回群列表','Back to groups'),backMembers);back.id='qq-members-back';back.classList.add('qq-members-back');
    const identity=el('div','qq-members-identity');identity.append(el('strong','',target.name||tr('未命名群组','Unnamed group')),el('span','qq-directory-secondary',tr(`群号 ${target.groupId}`,`Group ${target.groupId}`)));if(serverName)identity.append(el('span','qq-directory-secondary',tr(`本机连接：${serverName}`,`Local connection: ${serverName}`)));
    const controls=el('div','qq-directory-controls'),label=el('label','qq-directory-search',tr('搜索成员','Search members')),search=el('input');search.id='qq-members-search';label.htmlFor=search.id;search.type='search';search.autocomplete='off';search.maxLength=200;search.placeholder=tr('昵称、群名片或 QQ 号','Nickname, group card or QQ number');search.value=target.query;search.oninput=()=>{if(members!==target)return;target.query=search.value;target.page=0;drawMemberList();};label.append(search);const refresh=button(tr('刷新成员','Refresh members'),()=>{if(members===target)void loadMembers(true);},target.busy);refresh.id='qq-members-refresh';controls.append(label,refresh);
    const note=el('p','qq-directory-note',tr('名单仅供查看；进入成员管理后，需重新读取权限并明确确认操作。不启用群聊。','The list is view-only. Member management requires a fresh permission reading and explicit confirmation. Group chat is not enabled.'));
    const cache=el('p','qq-directory-note',tr('来自 QQ 接入组件缓存；刷新请求不保证完整实时同步。','From the QQ bridge cache; refreshing does not guarantee a complete live sync.'));if(target.fetchedAt)cache.append(el('span','qq-directory-time',tr(`本次读取 ${new Date(target.fetchedAt).toLocaleString('zh-CN')}`,`Read ${new Date(target.fetchedAt).toLocaleString('en')}`)));
    const results=el('section','qq-directory-results'),status=el('p','qq-directory-status');status.id='qq-members-status';status.setAttribute('role','status');const scroll=el('div','qq-directory-scroll');scroll.id='qq-members-scroll';scroll.tabIndex=0;scroll.setAttribute('aria-label',tr('群成员列表','Group member list'));const list=el('ul','qq-directory-list');list.id='qq-members-list';scroll.append(list);results.append(status,scroll);const paging=el('div','qq-directory-paging');paging.id='qq-members-paging';const body=el('div','qq-members-body');body.id='qq-members-body';body.append(identity,controls,note,cache,results);drawer.classList.add('qq-directory-members');drawer.replaceChildren(head,back,body,paging);drawMemberList();
    const node=focus&&$(focus);if(node&&drawer.contains(node)&&!node.disabled){node.focus({preventScroll:true});if(selection&&node.setSelectionRange)node.setSelectionRange(...selection);}
  }
  async function load(fresh=false){
    if(!selected||!drawer.open||typeof window.arcade.qqRuntimeDirectory!=='function')return;
    const choices=bridges();if(choices.length>1&&!serverName){epoch++;busy=false;clearResult();errorCode='server_ambiguous';draw();return;}
    const revision=++epoch,target={accountId:selected.accountId,kind,...(serverName?{serverName}:{}),fresh};
    busy=true;clearResult();draw();
    try{
      const result=await window.arcade.qqRuntimeDirectory(target);
      if(revision!==epoch||!selected||!drawer.open)return;
      if(result?.ok!==true)errorCode=typeof result?.code==='string'?result.code:'connection_failed';
      else if(!validDirectory(result.directory,target))errorCode='invalid_response';
      else{rows=result.directory.items;fetchedAt=result.directory.fetchedAt;loaded=true;}
    }catch{if(revision===epoch)errorCode='connection_failed';}
    finally{if(revision===epoch&&selected&&drawer.open){busy=false;draw();}}
  }
  function changeKind(next){if(kind===next)return;closeOwner();members=null;kind=next;query='';page=0;void load(false);if(kind==='friends')void checkOwner();}
  function drawList(){
    const list=$('qq-directory-list'),status=$('qq-directory-status'),paging=$('qq-directory-paging');if(!list)return;
    list.replaceChildren();paging.replaceChildren();list.setAttribute('aria-busy',String(busy));status.className=errorCode?'qq-directory-status problem':'qq-directory-status';
    if(busy){status.textContent=tr('正在读取列表…','Reading the directory…');return;}
    if(errorCode){status.textContent=message(errorCode);return;}
    if(!loaded){status.textContent=tr('选择连接后读取列表。','Choose a connection to read the directory.');return;}
    const search=query.trim().toLocaleLowerCase(),filtered=search?rows.filter(row=>[row.id,row.nickname,row.remark,row.name].filter(Boolean).some(value=>value.toLocaleLowerCase().includes(search))):rows;
    const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));page=Math.min(page,pages-1);
    status.textContent=filtered.length?tr(`共 ${filtered.length} 项${search?`（列表 ${rows.length} 项）`:''}`,`${filtered.length} entries${search?` (${rows.length} in the list)`:''}`):tr(search?'没有匹配的结果。':'接入组件返回的列表为空。',search?'No matching entries.':'The bridge returned an empty directory.');
    for(const row of filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE)){
      const item=el('li','qq-directory-row'),details=el('div','qq-directory-person'),title=kind==='friends'?(row.remark||row.nickname||tr('未命名好友','Unnamed friend')):(row.name||tr('未命名群组','Unnamed group'));
      details.append(el('strong','',title));
      if(kind==='friends'&&row.id===selected.accountId)details.append(el('span','qq-directory-secondary',tr('自己','This account')));
      if(ownerEligible()&&row.id===owner.recipient.ownerId)details.append(el('span','qq-directory-secondary',tr('主人','Owner')));
      if(kind==='friends'&&row.remark&&row.nickname&&row.remark!==row.nickname)details.append(el('span','qq-directory-secondary',row.nickname));
      const meta=el('div','qq-directory-meta');meta.append(el('span','',`${kind==='friends'?'QQ':tr('群号','Group')} ${row.id}`));
      if(kind==='groups'&&row.memberCount!==undefined)meta.append(el('span','',tr(`${row.memberCount}${row.maxMemberCount===undefined?'':` / ${row.maxMemberCount}`} 位成员`,`${row.memberCount}${row.maxMemberCount===undefined?'':` / ${row.maxMemberCount}`} members`)));
      if(kind==='groups'&&groupProfileEligible()&&typeof window.createQQGroupProfileAdapter==='function'){const profile=button(tr('群资料','Group profile'),()=>{if(profile.isConnected)openGroupProfile(row);});profile.dataset.profileGroup=row.id;meta.append(profile);}
      if(kind==='groups'){
        const open=button(tr('查看成员','View members'),()=>{if(open.isConnected)openMembers(row);});
        open.dataset.membersGroup=row.id;meta.append(open);
        const destination=typeof data!=='undefined'&&data?.accounts?.selectedId;
        if(destination&&data.bot?.channel==='qq'&&data.bot.qq?.expectedAccountId===selected.accountId&&data.bot.qq.groups?.groupIds?.includes(row.id)){
          const configure=button(tr('群设置','Group settings'),()=>{
            if(!configure.isConnected||data.accounts?.selectedId!==destination||data.bot?.qq?.expectedAccountId!==selected?.accountId)return;
            const options={section:'qq-groups',profileId:destination,expectedAccountId:selected.accountId,groupId:row.id,groupName:row.name};
            close();window.openConversationSetup(options);
          });
          configure.dataset.settingsGroup=row.id;meta.append(configure);
        }
      }
      if(kind==='friends'&&row.id!==selected.accountId&&contactAdminEligible()){const manage=button(tr('管理好友','Manage friend'),()=>{if(manage.isConnected)openContactAdmin(row);});manage.dataset.adminContact=row.id;manage.id=`qq-contact-admin-open-${row.id}`;meta.append(manage);}
      if(kind==='friends'&&row.id!==selected.accountId&&preparation?.draft)meta.append(prepareCheck(row.id,tr(`列入待联系名单 · ${title} QQ ${row.id}`,`Add to contact list · ${title} QQ ${row.id}`)));
      if(ownerEligible()&&row.id===owner.recipient.ownerId){const edit=button(tr('修改备注','Edit remark'),openOwner);edit.id='qq-owner-remark-open';meta.append(edit);}
      item.append(details,meta);list.append(item);
    }
    if(filtered.length){const move=(amount)=>{page+=amount;drawList();$('qq-directory-scroll').scrollTop=0;$('qq-directory-scroll').focus({preventScroll:true});};const prev=button(tr('上一页','Previous'),()=>move(-1),page===0),next=button(tr('下一页','Next'),()=>move(1),page>=pages-1);paging.append(prev,el('span','',tr(`第 ${page+1} / ${pages} 页`,`${page+1} / ${pages}`)),next);}
  }
  function draw(){
    if(!selected)return;if(contactAdmin){const old=contactAdmin.session?.context;if(old)contactAdmin.update({...old,language,scopeKey:groupProfileKey(context,selected.accountId)});return;}if(groupAdmin){const old=groupAdmin.session?.context;if(old)groupAdmin.update({...old,language,scopeKey:groupProfileKey(context,selected.accountId)});return;}if(groupProfile){const old=groupProfile.session?.context;if(old)groupProfile.update({...old,language,scopeKey:groupProfileKey(context,selected.accountId)});return;}if(members){drawMembers();return;}drawer.classList.remove('qq-directory-members');if(owner?.mode){drawOwner();return;}
    const focused=document.activeElement?.id;const searchSelection=focused==='qq-directory-search'?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null;
    const head=el('div','qq-directory-heading'),titles=el('div');const title=el('h2','',tr('好友与群组','Friends and groups'));title.id='qq-directory-title';titles.append(title,el('p','qq-directory-account',`${selected.name||tr('QQ 账号','QQ account')} · QQ ${selected.accountId}`));
    const exit=button(tr('关闭','Close'),close);exit.id='qq-directory-close';head.append(titles,exit);
    const tabs=el('div','qq-directory-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',tr('通讯录类型','Directory type'));
    for(const value of ['friends','groups']){const tab=button(value==='friends'?tr('好友','Friends'):tr('群组','Groups'),()=>changeKind(value));tab.id=`qq-directory-tab-${value}`;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(kind===value));tab.setAttribute('aria-controls','qq-directory-results');tab.tabIndex=kind===value?0:-1;tab.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const target=event.key==='Home'?'friends':event.key==='End'?'groups':value==='friends'?'groups':'friends';changeKind(target);$(`qq-directory-tab-${target}`)?.focus();}};tabs.append(tab);}
    const controls=el('div','qq-directory-controls'),connections=bridges();
    const account=context?.accounts?.accounts?.find(row=>row.id===context.accounts.selectedId);
    const requestEligible=account?.channel==='qq'&&(account.status==='connected'&&account.accountId===selected.accountId||account.status==='disconnected'&&account.expectedQQAccountId===selected.accountId&&typeof account.qqOwnerId==='string'&&/^[1-9]\d{4,14}$/.test(account.qqOwnerId)&&Number.isSafeInteger(Number(account.qqOwnerId))&&account.qqOwnerId!==selected.accountId);
    const requests=button(tr('好友申请','Friend requests'),()=>{const accountId=selected.accountId;close();window.openQQFriendRequests?.({accountId});},!(requestEligible&&typeof window.openQQFriendRequests==='function'));requests.id='qq-directory-requests';controls.append(requests);
    if(connections.length>1){const label=el('label','qq-directory-server',tr('本机连接','Local connection')),select=el('select');select.id='qq-directory-server';label.htmlFor=select.id;const blank=el('option','',tr('选择连接','Choose a connection'));blank.value='';select.append(blank);for(const row of connections){const option=el('option','',row.serverName);option.value=row.serverName;select.append(option);}select.value=serverName;select.onchange=()=>{closeOwner();serverName=select.value;query='';void load(false);if(kind==='friends')void checkOwner();};label.append(select);controls.append(label);}
    const searchLabel=el('label','qq-directory-search',tr('搜索','Search')),search=el('input');search.id='qq-directory-search';searchLabel.htmlFor=search.id;search.type='search';search.autocomplete='off';search.maxLength=200;search.placeholder=tr('名字、备注或号码','Name, remark or number');search.value=query;search.oninput=()=>{query=search.value;page=0;drawList();};searchLabel.append(search);
    const refresh=button(tr('刷新列表','Refresh list'),()=>void load(true),busy||(connections.length>1&&!serverName));refresh.id='qq-directory-refresh';controls.append(searchLabel,refresh);
    const note=el('p','qq-directory-note',kind==='groups'?tr('查看群与成员，按权限手动管理；尚未启用群聊。','View groups and members, and manage them manually within your permissions. Group conversations are not enabled.'):contactAdminEligible()?tr('可手动管理已有好友的备注或明确请求删除；不会开启其他好友的聊天。','Manage existing friends’ remarks or explicitly request removal. This does not enable chat with other friends.'):ownerEligible()?tr('可修改主人的备注，无需先连接 AI；好友申请需单独打开查看。','Edit the owner’s remark without connecting AI. Open Friend requests separately to view requests.'):tr('好友列表只读；选中已绑定此 QQ 和主人的搭档后，可管理其主人的备注。','Friends are view-only. Select the companion bound to this QQ and owner to manage its owner remark.'));
    const cache=el('p','qq-directory-note',tr('列表来自 QQ 接入组件的缓存；刷新请求不保证完整实时同步。','The list comes from the QQ bridge cache; a refresh request does not guarantee a complete live sync.'));
    if(fetchedAt)cache.append(el('span','qq-directory-time',tr(`本次读取 ${new Date(fetchedAt).toLocaleString('zh-CN')}`,`Read ${new Date(fetchedAt).toLocaleString('en')}`)));
    const results=el('section','qq-directory-results');results.id='qq-directory-results';results.setAttribute('role','tabpanel');results.setAttribute('aria-labelledby',`qq-directory-tab-${kind}`);
    const status=el('p','qq-directory-status');status.id='qq-directory-status';status.setAttribute('role','status');const scroll=el('div','qq-directory-scroll');scroll.id='qq-directory-scroll';scroll.tabIndex=0;scroll.setAttribute('aria-label',tr('通讯录列表','Directory list'));const list=el('ul','qq-directory-list');list.id='qq-directory-list';scroll.append(list);results.append(status,scroll);
    const paging=el('div','qq-directory-paging');paging.id='qq-directory-paging';const prepare=preparationControls();drawer.replaceChildren(head,tabs,controls,...(prepare?[prepare]:[]),note,cache,results,paging);drawList();
    const next=focused&&$(focused);if(next&&drawer.contains(next)&&!next.disabled){next.focus({preventScroll:true});if(searchSelection)next.setSelectionRange(...searchSelection);}
  }
  window.openQQDirectory=({accountId,name}={})=>{
    if(!validId(accountId)||typeof window.arcade.qqRuntimeDirectory!=='function')return;
    if(drawer.open)close();returnFocus=document.activeElement;kind='friends';serverName='';query='';clearResult();busy=false;selected={accountId,name,key:bindingKey(context,accountId)};draw();document.documentElement.classList.add('qq-directory-open');drawer.showModal();$('qq-directory-close').focus();void load(false);void checkOwner();
  };
  window.renderQQDirectory=next=>{
    const oldLanguage=language;language=next.language||'en';context=next;
    if(contactAdmin?.session&&groupProfileKey(next,selected?.accountId)!==contactAdmin.session.context.scopeKey){close();return;}
    if(groupAdmin?.session&&groupProfileKey(next,selected?.accountId)!==groupAdmin.session.context.scopeKey){close();return;}
    if(groupProfile?.session&&groupProfileKey(next,selected?.accountId)!==groupProfile.session.context.scopeKey){close();return;}
    if(selected){if(view!=='qq-runtime'||bindingKey(next,selected.accountId)!==selected.key){close();return;}if(owner&&ownerKey(next)!==owner.key){closeOwner();draw();return;}if(preparation&&!preparationProfiles().some(row=>preparationKey(row)===preparation.key)){preparation=null;draw();return;}if(oldLanguage!==language)draw();}
  };
  if(typeof data!=='undefined'&&data)window.renderQQRuntime?.(data);
})();
