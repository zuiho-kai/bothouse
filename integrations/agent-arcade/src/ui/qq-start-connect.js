'use strict';
// One explicitly requested launch for the selected, configured QQ companion.
(() => {
  const API_MODES=new Set(['api','gpt','deepseek','gemini','doubao']),LOCAL_MODES=new Set(['claude','codex']);
  const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
  const qq=v=>typeof v==='string'&&/^[1-9][0-9]{4,14}$/.test(v);
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
  let snapshot=null,scope='',eligibility=null,inspecting=false,inspected=false,manualConnecting=false,attempt=null,result=null,feedback='',revision=0,readyRevision=0,recoveryUsed=false;
  let bridgeFeedback=null;
  const tr=(zh,en)=>snapshot?.config?.language==='zh'?zh:en;
  const selected=next=>next?.accounts?.accounts?.find(p=>p.id===next.accounts.selectedId);
  function officialReady(bot){
    return bot?.channel==='qqofficial'&&bot.paired===true&&bot.credentialState==='ready'&&
      bot.qqOfficial?.groups?.enabled===true&&bot.qqOfficial.groups.proactive!==true&&
      (bot.mode==='claude'||API_MODES.has(bot.mode)&&bot.hasKey===true);
  }
  function saved(next){
    const b=next?.bot,p=selected(next);if(!b||!p||p.mode!==b.mode||p.channel!==b.channel||b.credentialState!=='ready'||p.credentialMigration||!b.paired)return null;
    if(b.channel==='x'&&b.x?.optedOut||b.channel==='messenger'&&b.messenger?.optedOut)return null;
    if(!(API_MODES.has(b.mode)?b.hasKey===true:LOCAL_MODES.has(b.mode)))return null;
    if(b.channel==='qqofficial'){
      if(!officialReady(b))return null;
    }else if(!(typeof b.workspace==='string'&&b.workspace.length||b.channel==='qq'&&b.social?.config?.enabled===true&&b.social?.supported===true))return null;
    if(b.channel==='qq'&&(!qq(b.qq?.expectedAccountId)||!qq(b.qq?.ownerId)||b.qq.expectedAccountId===b.qq.ownerId||p.expectedQQAccountId!==b.qq.expectedAccountId||p.qqOwnerId!==b.qq.ownerId))return null;
    return {accountId:p.id,name:p.name,mode:b.mode,channel:b.channel,qqAccountId:b.channel==='qq'?b.qq.expectedAccountId:null,api:API_MODES.has(b.mode)};
  }
  function key(next){const b=next?.bot,p=selected(next);return JSON.stringify([p?.id,b?.mode,b?.channel,b?.qqOfficial?.appId,b?.qqOfficial?.groups,b?.qq?.expectedAccountId,b?.qq?.ownerId,b?.hasKey,b?.credentialState,!!p?.credentialMigration,b?.workspace,b?.social?.config?.enabled,b?.social?.supported,p?.characterId,b?.channel==='qq'?[b.qq?.url,b.qq?.hasToken]:null]);}
  function available(){return ['qqCompanionLaunchInspect','qqCompanionLaunch','qqCompanionLaunchCancel'].every(k=>typeof window.arcade?.[k]==='function');}
  const manualQQ=info=>info?.channel==='qq'&&window.arcade?.platform?.os==='darwin';
  function macOneBotStatus(bot,language){
    return manualQQ(bot)?oneBotStatus(bot,language):null;
  }
  function oneBotStatus(bot,language,existing=false){
    if(bot?.channel!=='qq'||bot.credentialState==='locked'||bot.credentialState==='busy')return null;
    const zh=language==='zh';
    const show=(labelZh,labelEn,detailZh,detailEn,tone='unknown',issue=false)=>
      ({label:zh?labelZh:labelEn,detail:zh?detailZh:detailEn,tone,issue});
    const check=bot.qq?.check;
    const failure=bot.qq?.connectionIssue||(check?.state==='failed'?{code:check.code,phase:'test'}:null);
    if(bot.status==='connected')return show('QQ 已连接','QQ connected','本机 OneBot 已连接，可以接收新消息。','Local OneBot is connected and can receive new messages.','');
    if(bot.status==='checking')return show('正在检查 QQ','Checking QQ','正在核对本机 OneBot 的登录账号与在线状态。','Checking the signed-in account and online status through local OneBot.','waiting');
    if(bot.status==='disconnecting'&&!bot.qq?.connectionIssue)return show('正在断开 QQ','Disconnecting QQ','正在结束此搭档的 OneBot 连接。','Closing this companion’s OneBot connection.','waiting');
    if(failure?.phase==='retrying'){
      if(failure.code==='account_offline')return show('等待 QQ 恢复','Waiting for QQ recovery',
        'QQ 当前离线。应用正在等待本机 OneBot 恢复并重新检查。','QQ is offline. The app is waiting for local OneBot to recover and checking it again.','waiting',true);
      if(failure.code==='connection_unconfirmed')return show('正在重新检查连接','Checking the connection again',
        '搭档连接状态尚未确认。应用正在重新检查。','The companion’s connection state is unconfirmed. The app is checking it again.','waiting',true);
      return show('正在重连 OneBot','Reconnecting OneBot','本机 OneBot 连接中断。应用正在重新检查。','The local OneBot connection was interrupted. The app is checking it again.','waiting',true);
    }
    if(failure){
      const test=failure.phase==='test';
      const nextZh=existing?'核对后点击「连接已有 OneBot」重试。':test?'恢复后点击「测试连接」。':'恢复后点击「连接」。';
      const nextEn=existing?' After checking, select Connect existing OneBot to retry.':test?' Use Test connection after recovery.':' Select Connect after recovery.';
      const resetZh=failure.phase==='paused'?'自动重连已暂停。':'';
      const resetEn=failure.phase==='paused'?' Automatic reconnection is paused.':'';
      switch(failure.code){
        case 'account_offline': return show('QQ 离线','QQ offline',
          (failure.accountKnown===true?'已识别搭档 QQ，当前离线。':'QQ 当前离线。')+'请核对本机 OneBot 桥接和 QQ 在线状态。'+resetZh+nextZh,
          (failure.accountKnown===true?'The companion’s QQ account was identified and is offline.':'QQ is offline.')+' Check the local OneBot bridge and QQ online status.'+resetEn+nextEn,'error',true);
        case 'login_required': return show('QQ 需要登录','QQ sign-in required',
          '桥接报告 QQ 登录已失效。请在本机 OneBot 桥接重新登录搭档 QQ。'+nextZh,
          'The bridge reported an expired QQ sign-in. Sign in to the companion account through your local OneBot bridge.'+nextEn,'error',true);
        case 'account_mismatch':case 'account_changed':case 'account_in_use':
          return show('请核对 QQ 账号','Check the QQ account','请核对搭档绑定的 QQ 号、本机 OneBot 地址和桥接账号。'+nextZh,
            'Check the companion’s QQ number, local OneBot address and bridge account.'+nextEn,'error',true);
        case 'status_unverified':case 'invalid_login_info':
          return show('QQ 状态未核实','QQ status unverified','请核对本机 OneBot 能否报告搭档 QQ 账号及在线状态。'+resetZh+nextZh,
            'Check that local OneBot can report the companion’s account and online status.'+resetEn+nextEn,'unknown',true);
        case 'unauthorized':case 'invalid_token':
          return show('OneBot 验证失败','OneBot authentication failed','请核对本机 OneBot 桥接与搭档连接保存的 Token。'+nextZh,
            'Check the token saved in your local OneBot bridge and the companion’s connection.'+nextEn,'error',true);
        case 'invalid_owner':case 'owner_is_agent_account':case 'owner_not_friend':
          return show('请核对主人 QQ','Check the owner’s QQ','请核对设置中填写的主人 QQ，并确认它是搭档 QQ 的好友。'+nextZh,
            'Check the owner’s QQ number in settings and confirm it is a friend of the companion’s QQ account.'+nextEn,'error',true);
        case 'bridge_unhealthy':
          return show('OneBot 状态异常','OneBot needs attention','桥接报告状态异常。请检查本机 OneBot 桥接。'+resetZh+nextZh,
            'The bridge reported an unhealthy status. Check your local OneBot bridge.'+resetEn+nextEn,'error',true);
        case 'connect_failed':case 'connect_timeout':case 'timeout':case 'heartbeat_timeout':case 'disconnected':case 'invalid_bridge_url':
          return show('OneBot 未连接','OneBot disconnected',
          '无法核实本机 OneBot 连接。请检查桥接是否运行，并核对保存的连接地址。'+resetZh+nextZh,
          'The local OneBot connection could not be verified. Check that the bridge is running and confirm the saved address.'+resetEn+nextEn,'unknown',true);
        default: return show('连接未确认','Connection unconfirmed','请核对搭档配置后重试。',
          'Check the companion’s settings and try again.','unknown',true);
      }
    }
    if(bot.status==='connecting')return show('正在连接 OneBot','Connecting OneBot','正在检查本机 OneBot 连接。','Checking the local OneBot connection.','waiting');
    if(check?.state==='checked'){
      if(check.online===false)return show('QQ 离线','QQ offline','已识别搭档 QQ，当前离线。请核对本机 OneBot 与 QQ 在线状态，恢复后再次测试。',
        'The companion’s QQ account was identified and is offline. Check local OneBot and QQ online status, then test again after recovery.','error');
      if(check.online!==true)return show('QQ 状态未核实','QQ status unverified','已识别搭档 QQ。请核对本机 OneBot 提供的在线状态，再测试连接。',
        'The companion’s QQ account was identified. Check the online status reported by local OneBot, then test again.');
      if(check.ownerIsFriend===false)return show('请核对 QQ 好友关系','Check QQ friendship','已识别在线的搭档 QQ。请先确认它与你的 QQ 互为好友，再测试连接。',
        'The companion’s QQ account was identified online. Confirm it is friends with your QQ account, then test again.','waiting');
      return show('QQ 已核对','QQ checked','已核对搭档 QQ 在线。点击「连接」开始接收新消息。','The companion’s QQ account was verified online. Select Connect to receive new messages.');
    }
    if(bot.paired)return show('OneBot 未连接','OneBot disconnected','请确认本机 OneBot 桥接与搭档 QQ 在线，然后点击「连接」。',
      'Check that the local OneBot bridge and the companion’s QQ account are online, then select Connect.');
    return null;
  }
  function redraw(){window.render?.();}
  function current(req){return attempt===req&&req.scope===scope&&!req.invalidated;}
  function errorText(code,checking=false){
    if(checking&&code==='unconfigured')return tr('「启动并连接」需要匹配的本机 QQ 配置。可在「QQ 登录与运行」核对账号。若已自行运行 OneBot，请使用已保存的桥接连接。','Start and connect requires a matching local QQ configuration. Check the account in QQ sign-in & runtime. If you run OneBot yourself, use the saved bridge connection.');
    const detail=({
    credentials_locked:tr('已保存的凭据暂时无法读取。请在管理搭档中检查凭据。','Saved credentials cannot be opened. Check credentials in Manage companions.'),
    credentials_busy:tr('凭据正在清除，请等完成后再连接。','Credentials are being cleared. Wait before connecting.'),
    login_required:tr('QQ 需要登录，已有 AI 密钥仍保留。','QQ sign-in is needed. The saved AI key is retained.'),
    account_mismatch:tr('当前登录的 QQ 与绑定不符，请核对账号。','The signed-in QQ does not match this companion. Check the account.'),
    account_in_use:tr('这个 QQ 已由另一位搭档使用，请检查绑定。','Another companion is using this QQ account. Check its binding.'),
    changed:tr('暂时无法核对当前搭档的连接状态，请重新检查。','The current companion connection could not be checked. Check again.'),
    operation_in_progress:tr('已有启动或连接正在进行，请等待完成。','Another start or connection is in progress. Wait for it to finish.'),
    component_unavailable:tr('QQ 组件暂不可用，请打开 QQ 登录与运行检查本机组件。','QQ components are unavailable. Open QQ sign-in & runtime to check local components.'),
    runtime_unavailable:tr('尚未找到可管理的 QQ 实例，请检查 QQ 登录与运行。','No managed QQ instance was found. Check QQ sign-in & runtime.'),
    login_timeout:tr('尚未确认 QQ 登录，请打开 QQ 登录与运行查看状态。','QQ sign-in is not confirmed. Open QQ sign-in & runtime to check its state.'),
    timed_out:tr('尚未确认 QQ 登录，请打开 QQ 登录与运行查看状态。','QQ sign-in is not confirmed. Open QQ sign-in & runtime to check its state.'),
    })[code];
    if(detail)return detail;
    if(checking)return tr('尚未确认「启动并连接」是否可用。请点击「重新检查」。','Start and connect readiness is unconfirmed. Select Check again.');
    return tr('本次未能继续。请打开 QQ 登录与运行检查账号和组件，再明确重试。','This attempt could not continue. Check the account and components in QQ sign-in & runtime, then retry explicitly.');
  }
  function inspectOK(r,id){return exact(r,['ok','accountId','available','qqAccountId','reason','limits','active'])&&r.ok===true&&r.accountId===id&&typeof r.available==='boolean'&&(r.qqAccountId===null||qq(r.qqAccountId))&&(r.reason===null||typeof r.reason==='string'&&/^[a-z0-9_]{1,80}$/.test(r.reason))&&exact(r.limits,['waitMs','intervalMs'])&&r.limits.waitMs===60000&&r.limits.intervalMs===2000&&(r.active===null||progressOK(r.active));}
  function progressOK(p){return exact(p,['accountId','operationId','qqAccountId','phase'])&&typeof p.accountId==='string'&&uuid(p.operationId)&&qq(p.qqAccountId)&&['checking','starting','waiting_login','connecting'].includes(p.phase);}
  function receiptOK(r,req){
    const fields=['accountId','operationId','qqAccountId','outcome','code','startAttempted','qqRunning','loginState','connectionAttempted','connectionVerified','qqStopped','testMessageSent'];
    if(!exact(r,fields)||r.accountId!==req.accountId||r.operationId!==req.operationId||(r.qqAccountId!==null&&r.qqAccountId!==req.qqAccountId)||!['connected','login_required','account_mismatch','cancelled','timed_out','blocked','unknown'].includes(r.outcome)||(r.code!==null&&!(typeof r.code==='string'&&/^[a-z0-9_]{1,80}$/.test(r.code)))||typeof r.startAttempted!=='boolean'||![true,false,null].includes(r.qqRunning)||!['stopped','online','login_required','offline','reconnecting','initializing','unknown'].includes(r.loginState)||typeof r.connectionAttempted!=='boolean'||typeof r.connectionVerified!=='boolean'||r.qqStopped!==false||r.testMessageSent!==false)return false;
    return r.outcome==='connected'?r.connectionVerified&&r.connectionAttempted&&r.qqRunning===true&&r.loginState==='online'&&r.qqAccountId===req.qqAccountId:!r.connectionVerified;
  }
  function unknown(req){return {accountId:req.accountId,operationId:req.operationId,qqAccountId:req.qqAccountId,outcome:'unknown',code:'invalid_response',startAttempted:true,qqRunning:null,loginState:'unknown',connectionAttempted:false,connectionVerified:false,qqStopped:false,testMessageSent:false};}
  function recoveryReady(){return !recoveryUsed&&!document.hidden&&['bot','connections'].includes(document.body.dataset.view)&&snapshot?.bot?.status==='disconnected'&&!inspecting&&!manualConnecting&&!attempt?.running&&!result&&eligibility?.available===false&&eligibility.reason==='changed'&&saved(snapshot)?.channel==='qq'&&available();}
  function recoverInspection(){
    if(!recoveryReady())return;
    // One read-only retry per selection scope. Repeated focus/visibility events
    // never replay Start, and a genuine mismatch remains behind the main guard.
    const own=scope,seq=revision;recoveryUsed=true;
    queueMicrotask(()=>{if(own===scope&&seq===revision&&!document.hidden&&['bot','connections'].includes(document.body.dataset.view))void inspect();});
  }
  function ready(){if(document.hidden)return;readyRevision++;recoverInspection();}
  async function inspect(){const info=saved(snapshot);if(!info||info.channel!=='qq'||!available()||inspecting||attempt?.running)return;const own=scope,seq=++revision,beforeReady=readyRevision;inspecting=true;inspected=true;redraw();try{const r=await window.arcade.qqCompanionLaunchInspect({accountId:info.accountId});if(own!==scope||seq!==revision)return;if(!inspectOK(r,info.accountId)){eligibility=null;feedback=errorText(r?.code,true);return;}eligibility=r;feedback=r.available?'':errorText(r.reason,true);}catch{if(own===scope&&seq===revision){eligibility=null;feedback=errorText('unavailable',true);}}finally{if(own===scope&&seq===revision){inspecting=false;redraw();if(readyRevision!==beforeReady)recoverInspection();}}}
  async function start(){
    const info=saved(snapshot);if(!info||snapshot.bot.status!=='disconnected'||attempt?.running||manualConnecting)return;
    if(info.channel!=='qq'||manualQQ(info)){const own=scope;feedback='';manualConnecting=true;redraw();try{await window.arcade.accountConnect(info.accountId);const fresh=await window.arcade.snapshot();if(scope!==own)return;feedback=fresh.accounts?.accounts?.find(p=>p.id===info.accountId)?.status==='connected'?tr('已连接。','Connected.'):tr('连接尚未确认，请查看当前连接状态。','Connection is not confirmed. Check its current state.');}catch{if(scope===own)feedback=tr('连接未完成，请检查已有设置后重试。','Connection did not finish. Check saved settings before trying again.');}finally{if(scope===own){manualConnecting=false;redraw();}}return;}
    if(!available()||!eligibility?.available||eligibility.accountId!==info.accountId||eligibility.qqAccountId!==info.qqAccountId)return;
    const req={...info,scope,operationId:crypto.randomUUID(),running:true,invalidated:false,cancelRequested:false,phase:'checking'};attempt=req;result=null;feedback='';bridgeFeedback=null;redraw();
    try{const r=await window.arcade.qqCompanionLaunch({accountId:req.accountId,operationId:req.operationId});if(!current(req))return;const c=object(r)?Object.fromEntries(Object.entries(r).filter(([k])=>k!=='ok')):null;result=r.ok===true&&receiptOK(c,req)?c:unknown(req);}
    catch{if(current(req))result=unknown(req);}
    finally{req.running=false;if(attempt===req&&req.scope===scope){eligibility=null;if(req.invalidated){attempt=null;inspected=false;}redraw();}}
  }
  function savedOneBot(info){
    const bridge=snapshot?.bot?.qq;
    if(info?.channel!=='qq'||window.arcade?.platform?.os!=='win32'||typeof window.arcade.accountConnect!=='function'||!bridge?.hasToken||!bridge.url)return false;
    try{
      const url=new URL(bridge.url);
      return ['ws:','wss:'].includes(url.protocol)&&['127.0.0.1','[::1]'].includes(url.hostname)&&!!url.port&&url.pathname==='/'&&!url.username&&!url.password&&!url.search&&!url.hash;
    }catch{return false;}
  }
  async function connectExisting(own){
    const info=saved(snapshot);
    if(own!==scope||!savedOneBot(info)||manualConnecting||attempt?.running||snapshot.bot.status!=='disconnected')return;
    const {ownerId,url}=snapshot.bot.qq;
    manualConnecting=true;bridgeFeedback=null;result=null;redraw();
    try{
      const response=await window.arcade.accountConnect({source:'existing-onebot',accountId:info.accountId,qqAccountId:info.qqAccountId,ownerId,url,mode:info.mode});
      if(own!==scope)return;
      const checked=response?.qq?.check;
      if(response?.status==='connected'&&checked?.accountId===info.qqAccountId&&checked.online===true&&checked.ownerIsFriend!==false)bridgeFeedback={connected:true};
      else bridgeFeedback={issue:response?.qq?.connectionIssue};
    }catch{if(own===scope)bridgeFeedback={};}
    finally{if(own===scope){manualConnecting=false;redraw();}}
  }
  async function cancel(req=attempt){if(!req?.running||req.cancelRequested)return;req.cancelRequested=true;if(current(req))redraw();try{const r=await window.arcade.qqCompanionLaunchCancel({accountId:req.accountId,operationId:req.operationId});if(!current(req))return;if(!exact(r,['ok','accountId','operationId','cancelled','settled','result'])||r.ok!==true||r.accountId!==req.accountId||r.operationId!==req.operationId||typeof r.cancelled!=='boolean'||r.settled!==true||(r.result!==null&&!receiptOK(r.result,req))){feedback=tr('取消结果尚未确认，请查看 QQ 当前状态。','Cancellation is not confirmed. Check the current QQ state.');return;}if(r.result)result=r.result;}catch{if(current(req))feedback=tr('取消结果尚未确认，请查看 QQ 当前状态。','Cancellation is not confirmed. Check the current QQ state.');}finally{if(current(req))redraw();}}
  function update(next){
    const previous=snapshot?.bot;
    const nextKey=key(next);snapshot=next;if(nextKey!==scope){const old=attempt;if(old?.running){old.invalidated=true;void cancel(old);}scope=nextKey;revision++;eligibility=null;inspecting=false;inspected=false;manualConnecting=false;attempt=null;result=null;feedback='';bridgeFeedback=null;recoveryUsed=false;}
    if(previous?.status==='connected'&&next.bot?.status!=='connected')bridgeFeedback=null;
    if(manualQQ(next.bot)&&(previous?.status==='checking'&&next.bot?.status==='disconnected'||
      previous?.qq?.connectionIssue&&!next.bot?.qq?.connectionIssue))feedback='';
    if(attempt?.running){const p=next.qqCompanionLaunch;if(progressOK(p)&&p.accountId===attempt.accountId&&p.operationId===attempt.operationId&&p.qqAccountId===attempt.qqAccountId)attempt.phase=p.phase;}
    if(attempt?.running&&!['bot','connections'].includes(document.body.dataset.view)){attempt.invalidated=true;void cancel(attempt);}
  }
  function showQQ(login=false){const info=saved(snapshot);if(!info?.qqAccountId)return;if(login&&window.openQQAccountLoginDialog)window.openQQAccountLoginDialog({accountId:info.qqAccountId});else window.openQQRuntime?.({accountId:info.qqAccountId});}
  function textResult(c){if(c.outcome==='connected')return tr('本次已确认 QQ 与 AI 连接，使用的是原有配置。','This attempt confirmed QQ and AI connection using the saved settings.');if(c.outcome==='cancelled')return tr('本次后续连接已取消。已经启动的 QQ 不会因此关闭。','Further connection steps were cancelled. QQ that already started is left running.');if(c.outcome==='unknown')return tr('本次结果尚未确认。请查看当前状态，不会自动重试。','This result is unconfirmed. Check the current state; this attempt is not retried automatically.');return errorText(c.code||c.outcome);}
  function mount(parent,{id='saved-connection',settings}={}){
    const old=document.getElementById(id),oldFocus=old?.contains(document.activeElement)?document.activeElement.id:null,info=saved(snapshot);if(!info){old?.remove();return false;}const n=document.createElement('section');n.className='saved-connection';n.id=id;n.setAttribute('aria-label',tr('已保存的连接','Saved connection'));
    const add=(tag,cls,value)=>{const e=document.createElement(tag);e.className=cls;e.textContent=value;n.append(e);return e;};
    add('h2','',tr('连接配置已保存','Connection settings saved'));
    add('p','',info.api?tr('密钥已加密保存，无需重复填写。','The key is saved with OS encryption; no need to re-enter it.'):tr('沿用本机程序的原有登录；连接时会检查。','Use the local program’s existing login; it will be checked when connecting.'));
    const row=add('div','button-row','');const button=(suffix,label,fn,disabled=false)=>{const b=document.createElement('button');b.type='button';b.id=id+'-'+suffix;b.className=suffix==='start'?'primary':'secondary';b.textContent=label;b.disabled=disabled;b.onclick=fn;row.append(b);return b;};
    const running=attempt?.running&&attempt.scope===scope,status=snapshot.bot.status,own=scope,existing=savedOneBot(info);
    const connection=macOneBotStatus(snapshot.bot,snapshot.config?.language);
    const macStatus=connection&&manualConnecting&&status==='disconnected'
      ? macOneBotStatus({...snapshot.bot,status:'connecting',qq:null},snapshot.config?.language) : connection;
    if(running){const phase=attempt.cancelRequested?tr('正在结束本次连接…','Finishing this attempt…'):{checking:tr('正在检查已有配置…','Checking saved settings…'),starting:tr('正在启动 QQ…','Starting QQ…'),waiting_login:tr('正在确认 QQ 登录…','Checking QQ sign-in…'),connecting:tr('正在连接 AI…','Connecting AI…')}[attempt.phase];const note=add('p','saved-connection-status',phase);note.setAttribute('role','status');button('cancel',tr('取消本次连接','Cancel this attempt'),()=>void cancel(),attempt.cancelRequested);}
    else if(status==='connected'){if(!macStatus)add('p','saved-connection-status',tr('当前已连接。','Currently connected.')).setAttribute('role','status');}
    else if(status!=='disconnected'||manualConnecting){if(!macStatus)add('p','saved-connection-status',tr('正在处理当前连接…','The current connection is being processed…'));}
    else if(info.channel==='qq'&&!manualQQ(info)){
      const managedReady=available()&&eligibility?.available&&!inspecting;
      const addExisting=()=>button('onebot',tr('连接已有 OneBot','Connect existing OneBot'),()=>connectExisting(own));
      if(existing&&!managedReady)addExisting().className='primary';
      if(available())button('start',tr('启动并连接','Start and connect'),()=>void start(),!managedReady).className=existing&&!managedReady?'secondary':'primary';
      if(existing&&managedReady)addExisting();
      button('qq',result?.outcome==='login_required'?tr('登录这个 QQ','Sign in to this QQ'):tr('QQ 登录与运行','QQ sign-in & runtime'),()=>showQQ(result?.outcome==='login_required'));
      if(!inspected&&!inspecting&&!result&&available()&&['bot','connections'].includes(document.body.dataset.view))queueMicrotask(()=>void inspect());
      else if(!inspecting&&(result||inspected&&!eligibility?.available))button('check',tr('重新检查','Check again'),()=>{result=null;feedback='';void inspect();});
    }else button('start',tr('连接','Connect'),()=>void start(),typeof window.arcade.accountConnect!=='function');
    if(settings)button('settings',tr('更改连接设置','Change connection settings'),settings,!!running);
    if(result){const p=add('p','saved-connection-status',textResult(result));p.setAttribute('role','status');}
    if(feedback&&!bridgeFeedback&&!(macStatus&&(macStatus.issue||status==='connected')))add('p','saved-connection-note',feedback);
    if(macStatus){
      const note=add('p','saved-connection-status',macStatus.detail);note.setAttribute('role','status');
    }else if(existing&&bridgeFeedback&&status==='disconnected'){
      const issue=bridgeFeedback.issue;
      const detail=issue&&oneBotStatus({...snapshot.bot,qq:{connectionIssue:issue}},snapshot.config?.language,true);
      const message=detail?detail.label+' · '+detail.detail:bridgeFeedback.connected?tr('已连接，已核实搭档 QQ 在线。','Connected. The companion’s QQ account was verified online.'):tr('连接尚未确认，请核对已有 OneBot 设置后重试。','Connection is unconfirmed. Check the saved OneBot settings and retry.');
      add('p','saved-connection-status',message).setAttribute('role','status');
    }else if(existing&&status==='disconnected'&&!running&&!result)add('p','saved-connection-note',
      tr('「连接已有 OneBot」使用已保存的桥接地址，并核对搭档 QQ 的在线身份。','Connect existing OneBot uses the saved bridge address and verifies the signed-in QQ account.'));
    else if(info.channel==='qq'&&status==='disconnected'&&!running&&!result)add('p','saved-connection-note',
      tr('只启动并连接当前搭档。需要时再扫码，不发送测试消息。','Start and connect only this companion. Scan if needed; no test message is sent.'));
    if(old&&parent.contains(old))old.replaceWith(n);else parent.append(n);if(oldFocus&&parent.closest('.view')?.hidden!==true){const target=document.getElementById(oldFocus)||n.querySelector(running?'[id$="-cancel"]':'[id$="-check"]');if(target&&!target.disabled)target.focus({preventScroll:true});}return true;
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&attempt?.running){attempt.invalidated=true;void cancel(attempt);}else if(!document.hidden)ready();});
  window.addEventListener('focus',ready);
  window.addEventListener('pagehide',()=>{if(attempt?.running){attempt.invalidated=true;void cancel(attempt);}});
  window.selectedSavedConnection=saved;
  window.ArcadeQQStartConnect={saved,officialReady,macOneBotStatus,update,mount,start,cancel,inspect,isRunning:()=>!!(attempt?.running&&attempt.scope===scope),stateKey:()=>JSON.stringify([scope,eligibility,inspecting,manualConnecting,attempt?.running,attempt?.phase,attempt?.cancelRequested,result,feedback,bridgeFeedback])};
})();
