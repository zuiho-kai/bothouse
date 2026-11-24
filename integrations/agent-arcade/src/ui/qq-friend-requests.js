'use strict';
// Private drawer data is never added to application snapshots or companion memory.
(() => {
  const create=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const drawer=create('dialog','qq-requests');drawer.id='qq-friend-requests';drawer.setAttribute('aria-labelledby','qq-requests-title');document.body.append(drawer);
  let context=null,language='zh',panel=null,returnFocus=null;
  const tr=(zh,en)=>language==='zh'?zh:en;
  const qq=v=>typeof v==='string'&&/^[1-9]\d{4,14}$/.test(v)&&Number.isSafeInteger(Number(v));
  const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
  const stamp=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v));
  const safeText=v=>typeof v==='string'&&v.length<=500&&!/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(v);
  const selected=()=>context?.accounts?.accounts?.find(a=>a.id===context.accounts.selectedId);
  const key=a=>{const r=context?.runtime,row=r?.instances?.find(item=>item.accountId===(a.status==='connected'?a.accountId:a.expectedQQAccountId));return JSON.stringify([a.id,a.channel,a.status,a.accountId,a.expectedQQAccountId,a.qqOwnerId,a.characterId,a.mode,r?.installationKind,r?.desktopDataRoot,r?.componentsRoot,r?.managedSetupId,r?.installation?.current?.kind,r?.installation?.current?.setupId,row?.accountId,row?.processRunning,row?.runtimeRevision,row?.bridges]);};
  const args=p=>({accountId:p.profileId,panelId:p.id});
  const current=p=>panel===p&&drawer.open&&selected()&&key(selected())===p.key;
  const button=(text,id,action,disabled=false)=>{const n=create('button','secondary',text);n.type='button';n.id=id;n.onclick=action;n.disabled=disabled;return n;};
  const errors={
    disconnected:['请先连接这位搭档的 QQ。','Connect this companion’s QQ first.'],
    changed:['连接已经变化。关闭后重新打开申请列表。','The connection changed. Close and reopen the requests.'],
    expired:['这条申请的处理期限已过，请在 QQ 中核对。','This request expired here. Check it in QQ.'],
    stale_request:['这条申请已处理或失效，请刷新列表。','This request was handled or invalidated. Refresh the list.'],
    operation_in_progress:['上一项操作尚未结束，请稍后刷新。','The previous operation is still finishing. Refresh shortly.'],
    account_offline:['这个 QQ 已离线，请先恢复连接。','This QQ is offline. Restore its connection first.'],
    invalid_response:['申请列表暂时无法核实，请刷新或检查连接。','The requests could not be verified. Refresh or check the connection.'],
    unconfigured:['请先为这位搭档保存 QQ 和主人绑定，再打开好友申请。','Save this companion’s QQ and owner binding before opening friend requests.'],
    account_connected:['AI 已连接，请关闭后重新打开好友申请。','AI is now connected. Close and reopen friend requests.'],
    status_unverified:['无法核实 QQ 在线状态，请到 QQ 账号页检查后重试。','QQ online status could not be verified. Check QQ accounts, then retry.'],
    account_mismatch:['连接中的 QQ 与绑定账号不符，未开始接收申请。','The connected QQ does not match the binding. Requests were not started.'],
    endpoint_unverified:['无法核实这个 QQ 的本机连接，请返回 QQ 账号页检查。','The local connection could not be verified for this QQ. Check QQ accounts.'],
    connection_failed:['暂时无法连接 QQ，请检查登录状态后重试。','Cannot reach QQ. Check its sign-in status, then retry.'],
    closed:['临时接收已结束，可以重新连接。','Temporary listening ended. You can reconnect.'],
    disconnected_setup:['临时连接已断开，请检查 QQ 后重新连接。','The temporary connection ended. Check QQ, then reconnect.'],
  };
  const errorText=code=>tr(...(errors[code]||errors.invalid_response));
  const stop=p=>Promise.resolve().then(()=>window.arcade[p.setup?'qqOwnerFriendClose':'qqFriendRequestsClose'](args(p))).catch(()=>{});
  function close(){const old=panel;panel=null;if(old){clearTimeout(old.expiry);old.rows=[];old.receipts=[];old.consumed.clear();void stop(old);}if(drawer.open)drawer.close();drawer.replaceChildren();document.documentElement.classList.remove('qq-requests-open');if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;}
  drawer.addEventListener('cancel',e=>{e.preventDefault();close();});
  drawer.addEventListener('close',()=>{if(panel)close();});
  window.addEventListener('pagehide',close);document.addEventListener('visibilitychange',()=>{if(document.hidden)close();});
  function validRead(value,p){
    const v=value?.inbox;if(value?.ok!==true||value.accountId!==p.profileId||value.panelId!==p.id||value.kind!==(p.setup?'owner-friend-setup':'friend-requests')||(p.setup&&(value.status!=='listening'||value.qqAccountId!==p.qqId||value.ownerId!==p.ownerId))||!v||v.source!=='current-connection-events'||v.complete!==false||typeof v.available!=='boolean'||typeof v.overflow!=='boolean'||!Array.isArray(v.items)||v.items.length>100)return false;
    if(!v.available)return !v.items.length;
    return v.accountId===p.qqId&&stamp(v.connectedAt)&&typeof v.busy==='boolean'&&new Set(v.items.map(r=>r.requestId)).size===v.items.length&&v.items.every(r=>uuid(r.requestId)&&qq(r.applicantId)&&r.applicantId!==p.qqId&&(!p.setup||r.applicantId===p.ownerId)&&safeText(r.comment)&&stamp(r.receivedAt)&&stamp(r.expiresAt));
  }
  function validAvailability(v,p){return v?.ok===true&&v.accountId===p.profileId&&v.panelId===p.id&&typeof v.available==='boolean'&&(!v.available||(v.qqAccountId===p.qqId&&v.ownerId===p.ownerId&&['not_started','listening'].includes(v.status)));}
  async function read(){const p=panel;if(!p||p.busy)return;p.busy=true;p.problem='';draw();try{
    let v;
    if(p.setup&&!p.listening){const available=await window.arcade.qqOwnerFriendAvailability(args(p));if(!current(p))return;
      if(!validAvailability(available,p)||!available.available){p.rows=[];p.problem=errorText(available?.reason||available?.code);return;}
      v=await window.arcade[available.status==='listening'?'qqOwnerFriendRead':'qqOwnerFriendStart'](args(p));
    }else v=await window.arcade[p.setup?'qqOwnerFriendRead':'qqFriendRequestsRead'](args(p));
    if(!current(p))return;
    if(!validRead(v,p)||!v.inbox.available){p.rows=[];p.problem=errorText(v?.code==='disconnected'&&p.setup?'disconnected_setup':v?.code||'invalid_response');if(p.setup){p.listening=false;await stop(p);}}
    else{p.loaded=true;p.listening=p.setup;p.connectedAt=v.inbox.connectedAt;p.rows=v.inbox.items.filter(r=>!p.consumed.has(r.requestId));p.overflow=v.inbox.overflow;p.remoteBusy=v.inbox.busy;}
  }catch{if(current(p)){p.rows=[];p.problem=errorText('connection_failed');if(p.setup){p.listening=false;await stop(p);}}}finally{if(current(p)){p.busy=false;draw();scheduleExpiry(p);}}}
  function scheduleExpiry(p){clearTimeout(p.expiry);const next=Math.min(...p.rows.map(r=>Date.parse(r.expiresAt)).filter(n=>n>Date.now()));if(Number.isFinite(next))p.expiry=setTimeout(()=>{if(current(p)){draw();scheduleExpiry(p);}},Math.min(300001,Math.max(1,next-Date.now()+1)));}
  async function decide(row,approve){const p=panel;if(!p||p.busy||p.remoteBusy||p.consumed.has(row.requestId)||Date.parse(row.expiresAt)<=Date.now())return;p.consumed.add(row.requestId);p.rows=p.rows.filter(r=>r.requestId!==row.requestId);p.busy=true;p.problem='';draw();
    let outcome='unknown',code;
    try{const v=await window.arcade[p.setup?'qqOwnerFriendDecide':'qqFriendRequestsDecide']({...args(p),requestId:row.requestId,approve});if(!current(p))return;if(v?.ok===true&&v.accountId===p.profileId&&v.panelId===p.id&&v.qqAccountId===p.qqId&&(!p.setup||v.ownerId===p.ownerId)&&v.requestId===row.requestId&&v.approve===approve&&v.kind==='friend-request'&&['accepted','unknown','not_submitted'].includes(v.outcome)){outcome=v.outcome;code=v.code;}}
    catch{/* A lost receipt does not establish that no external change happened. */}
    finally{if(current(p)){p.busy=false;p.receipts.unshift({applicantId:row.applicantId,approve,outcome,code});p.receipts=p.receipts.slice(0,10);draw();scheduleExpiry(p);}}
  }
  function draw(){const p=panel;if(!p)return;const focused=document.activeElement?.id,scrollTop=drawer.querySelector('.qq-requests-scroll')?.scrollTop||0;
    const head=create('header','qq-requests-head'),titles=create('div'),title=create('h2','',tr('好友申请','Friend requests'));title.id='qq-requests-title';titles.append(title,create('p','qq-requests-account',`${p.name} · ${p.setup&&!p.listening?tr('已配置 QQ','Configured QQ'):'QQ'} ${p.qqId}`));head.append(titles,button(tr('关闭','Close'),'qq-requests-close',close));
    const content=create('div','qq-requests-scroll');content.tabIndex=0;content.setAttribute('aria-label',tr('收到的好友申请','Received friend requests'));
    const note=create('p','qq-requests-note',p.setup?tr(`仅接收主人 QQ ${p.ownerId} 的新申请。AI 尚未启动，关闭这里即结束临时接收。`,`Only new requests from owner QQ ${p.ownerId}. AI is not running. Closing this view ends temporary listening.`):tr('仅显示本次连接收到的申请，不包含离线期间的历史申请。接受好友不会开放聊天或派活权限。','Shows requests received during this connection, excluding offline history. Accepting a friend does not grant chat or task access.'));content.append(note);
    if(p.setup)content.append(create('p','qq-requests-time',tr('离线期间的历史申请不会补入。接受后，可关闭这里再连接 AI；不会自动开始聊天。','Offline requests are not backfilled. After acceptance, close this view and connect AI when ready; chat does not start automatically.')));
    if(p.connectedAt)content.append(create('p','qq-requests-time',tr(`本次连接 ${new Date(p.connectedAt).toLocaleString('zh-CN')}`,`Connected ${new Date(p.connectedAt).toLocaleString('en')}`)));
    const status=create('p',p.problem?'problem':'qq-requests-status',p.problem||(p.busy?(p.setup&&!p.listening?tr('正在验证 QQ 并连接…','Verifying QQ and connecting…'):tr('正在处理…','Working…')):p.loaded&&!p.rows.length?(p.setup?tr('正在接收主人的新申请。申请发出后，点击刷新申请。','Listening for new requests from the owner. Refresh after the request is sent.'):tr('本次连接尚无待处理申请。新申请到达后可刷新。','No pending requests in this connection. Refresh after a new request arrives.')):p.setup&&p.listening?tr('仅接收主人申请','Listening only for owner requests'):'  '));status.id='qq-requests-status';status.setAttribute('role',p.problem?'alert':'status');content.append(status);
    if(p.overflow)content.append(create('p','problem',tr('收到的申请超过本页上限。请到 QQ 核对其余申请；列表并不完整。','The request limit was reached. Check the rest in QQ; this list is incomplete.')));
    const list=create('ul','qq-requests-list');
    for(const row of p.rows){const item=create('li','qq-request-row'),body=create('div','qq-request-body');body.append(create('h3','',`QQ ${row.applicantId}`),create('p','qq-request-comment',row.comment||tr('未填写验证信息','No verification message')),create('p','qq-requests-time',tr(`收到于 ${new Date(row.receivedAt).toLocaleTimeString('zh-CN')}`,`Received ${new Date(row.receivedAt).toLocaleTimeString('en')}`)));
      const actions=create('div','qq-request-actions'),expired=Date.parse(row.expiresAt)<=Date.now();if(expired)actions.append(create('span','qq-requests-time',tr('已过期，请在 QQ 核对','Expired; check in QQ')));else{const reject=button(tr('拒绝','Decline'),`qq-request-deny-${row.requestId}`,()=>void decide(row,false),p.busy||p.remoteBusy),accept=button(tr('接受','Accept'),`qq-request-allow-${row.requestId}`,()=>void decide(row,true),p.busy||p.remoteBusy);accept.className='primary';actions.append(reject,accept);}item.append(body,actions);list.append(item);}
    content.append(list);
    if(p.receipts.length){const history=create('section','qq-request-receipts');history.setAttribute('aria-label',tr('本次处理结果','Decisions in this view'));for(const r of p.receipts){const line=create('p',r.outcome==='unknown'?'problem':'');line.append(create('strong','',`QQ ${r.applicantId} `),document.createTextNode(r.outcome==='accepted'?(r.approve?tr('接受请求已提交。','Acceptance submitted.'):tr('拒绝请求已提交。','Decline submitted.')):r.outcome==='not_submitted'?tr('没有提交。','Not submitted. ')+errorText(r.code):tr('处理结果未确认，请在 QQ 核对；不会自动重试。','Outcome unconfirmed. Check in QQ; this will not be retried automatically.')));history.append(line);}content.append(history);}
    const footer=create('footer','qq-requests-footer');footer.append(create('span','qq-requests-time',tr('不会自动处理好友申请。','Friend requests are never handled automatically.')),button(p.setup&&!p.listening&&p.problem?tr('重试连接','Retry connection'):tr('刷新申请','Refresh requests'),'qq-requests-refresh',()=>void read(),p.busy));drawer.replaceChildren(head,content,footer);content.scrollTop=scrollTop;if(focused){const n=document.getElementById(focused);if(n&&drawer.contains(n)&&!n.disabled)n.focus({preventScroll:true});}
  }
  window.openQQFriendRequests=({accountId}={})=>{const a=selected(),setup=a?.status==='disconnected',methods=setup?['qqOwnerFriendAvailability','qqOwnerFriendStart','qqOwnerFriendRead','qqOwnerFriendDecide','qqOwnerFriendClose']:['qqFriendRequestsRead','qqFriendRequestsDecide','qqFriendRequestsClose'];
    if(!a||a.channel!=='qq'||!qq(accountId)||!(setup?a.expectedQQAccountId===accountId&&qq(a.qqOwnerId)&&a.qqOwnerId!==accountId:a.status==='connected'&&a.accountId===accountId)||!methods.every(n=>typeof window.arcade[n]==='function'))return;
    if(panel)close();returnFocus=document.activeElement;panel={id:crypto.randomUUID(),profileId:a.id,qqId:accountId,ownerId:a.qqOwnerId,name:a.name||tr('当前搭档','Current companion'),setup,listening:false,key:key(a),busy:false,loaded:false,rows:[],receipts:[],consumed:new Set(),problem:'',expiry:null,remoteBusy:false,overflow:false};draw();document.documentElement.classList.add('qq-requests-open');drawer.showModal();document.getElementById('qq-requests-close').focus();void read();};
  window.renderQQFriendRequests=next=>{const prior=language;context=next;language=next.language==='zh'?'zh':'en';if(panel){const a=selected();if(!a||key(a)!==panel.key||(typeof view!=='undefined'&&view!=='qq-runtime')){close();return;}if(language!==prior)draw();}};
  if(typeof data!=='undefined'&&data)window.renderQQFriendRequests(data);
})();
