'use strict';
(() => {
  const words={en:{nav:'WeChat tasks',title:'Send a message. Give your agent a job.',subtitle:'WeChat is the conversation. This workshop runs the work.',preview:'Experimental connection · live WeChat acceptance pending.',setup:'Connect your workshop',scope:'One WeChat owner, one local project, one Claude agent. Your computer must stay on.',project:'Project folder',choose:'Choose folder',save:'Save key',budget:'Maximum cost per task (USD)',privacy:'Messages and task output pass through Tencent and Anthropic. Credentials use OS encryption; local chat history stays in memory. The SDK also keeps local session files.',pair:'Pair WeChat',start:'Start receiving tasks',stop:'Disconnect & cancel',scan:'Scan in WeChat and confirm. Codes expire after three minutes.',forget:'Forget credentials',inbox:'Task inbox',inboxNote:'Task acknowledgements, requests for input and final replies go back to WeChat.',empty:'After connecting, send your bot a message in WeChat. Tasks and replies will appear here.',commands:'Chat commands & permissions',help:'Send a task in plain language. /status checks progress; /cancel stops the task and clears the queue; /new starts fresh. Tool actions ask for a one-time /allow code or /deny code. Questions accept /answer code text.',risk:'An approved command can affect your computer beyond the selected folder. A reply ending does not prove the work succeeded. Disconnection cancels active work; tasks are never resumed automatically.',keySet:'Key saved with OS encryption. It is never sent to this view.',keyEmpty:'API billing required. Claude subscription login is not used.',noProject:'Choose a project before connecting.',disconnected:'Disconnected',connecting:'Connecting…',connected:'Receiving tasks',pairing:'Waiting for WeChat scan',paired:'WeChat paired',you:'You',agent:'Sprout Bot',notDesktop:'Open the desktop app to connect WeChat.',saved:'Key saved',confirmForget:'Forget API key and WeChat credentials? Active tasks will be cancelled.'},zh:{nav:'微信派活',title:'发条微信，让 Agent 开工。',subtitle:'微信里说清任务，小工坊在电脑上执行。',preview:'实验接入 · 尚未完成真实微信全链路验收。',setup:'连接你的工坊',scope:'一个微信主人、一个本机项目、一个 Claude Agent。运行时电脑需要保持开机。',project:'项目目录',choose:'选择文件夹',save:'保存密钥',budget:'每条任务的费用上限（美元）',privacy:'消息与任务输出会经过腾讯和 Anthropic。凭证使用系统加密；本页聊天仅保留在内存。SDK 另在本机保留会话文件。',pair:'连接微信',start:'开始接收任务',stop:'断开并取消任务',scan:'用微信扫码并确认，二维码三分钟后失效。',forget:'忘记凭证',inbox:'任务收件箱',inboxNote:'微信只收到接收确认、需要你介入的问题和最终回复。',empty:'连接后，在微信向 Bot 发一条任务。任务与回复会出现在这里。',commands:'聊天命令与操作权限',help:'直接用自然语言派活。/status 查看进度；/cancel 停止任务并清空队列；/new 开启新会话。工具操作需回复一次性的 /allow 验证码 或 /deny 验证码；问题可用 /answer 验证码 回答。',risk:'批准的命令可能影响所选文件夹以外的本机内容。回复结束不代表任务已成功。断开会取消执行，重启不会自动续跑。',keySet:'已使用系统加密保存。密钥不会回传到本页面。',keyEmpty:'需要 API 计费，不使用 Claude 订阅登录。',noProject:'先选择一个项目。',disconnected:'未连接',connecting:'正在连接…',connected:'正在接收任务',pairing:'等待微信扫码',paired:'微信已配对',you:'你',agent:'Sprout Bot',notDesktop:'请在桌面应用中连接微信。',saved:'密钥已保存',confirmForget:'忘记 API 密钥和微信凭证？当前任务会被取消。'}};
  Object.assign(words.en,{geminiNote:'Use a Google AI Studio API key. API billing is separate from a Gemini app subscription. Approved project file tools are available; shell commands are not.',doubaoNote:'Use a Volcengine Ark API key, not a Doubao app login. Approved project file tools are available; shell commands are not.'});
  Object.assign(words.zh,{geminiNote:'使用 Google AI Studio API key，按 API 用量计费，与 Gemini 应用订阅分开。项目文件操作需批准，不执行终端命令。',doubaoNote:'使用火山方舟 API key，不使用豆包应用登录。项目文件操作需批准，不执行终端命令。'});
  const macQQ=window.arcade?.platform?.os==='darwin';
  let lastCredentialScope='',credentialContext={profileId:'',expectedMode:'api',expectedChannel:'wechat'};
  const connectionDrafts=new Set(),connectionDraftIds=['bot-qq-expected-account','bot-feishu-app-id','bot-feishu-owner','bot-x-account','bot-x-owner','bot-messenger-app','bot-messenger-page','bot-messenger-owner','bot-messenger-relay'];
  if(macQQ)connectionDraftIds.push('bot-qq-owner');
  let qqGroupsDirty=false,qqGroupsSaving=false,qqGroupsFeedback='',qqGroupDirectory=null;
  let qqDraftStatus='',qqPolicyPrevious=null;
  const dailyPolicyGroup=()=>$('bot-qq-groups').closest('#qq-daily-group-settings')?.dataset.groupId??null;
  let dailyPolicyTarget=null,dailyPolicyEpoch=0,dailyPolicyBefore=null,dailySaveJob=null;
  const onlineGroupPolicy=()=>state?.channel==='qq'&&state.status==='connected'&&state.qq?.groups?.enabled===true&&state.qq.groups.groupIds?.length>0&&qqNumber.test(state.qq.expectedAccountId||'')&&!connectionDrafts.has('bot-qq-expected-account')&&typeof window.arcade?.botGroupPolicySet==='function';
  const policyFields=config=>({groupIds:[...(config.groupIds||[])],imageGroupIds:[...(config.imageGroupIds||[])],voiceGroupIds:[...(config.voiceGroupIds||[])],proactive:config.proactive===true});
  const policyKey=cfg=>JSON.stringify([...[cfg.groupIds,cfg.imageGroupIds,cfg.voiceGroupIds].map(ids=>[...ids].sort()),cfg.proactive]);
  const savedGroupKey=cfg=>JSON.stringify([cfg.enabled,policyKey(policyFields(cfg)),[...(cfg.localGateGroupIds||[])].sort()]);
  const qqGroupOptions=[
    {id:'bot-qq-groups-local-gate',key:'localGateGroupIds',selected:new Set()},
    {id:'bot-qq-group-images',key:'imageGroupIds',selected:new Set()},
    {id:'bot-qq-group-voice',key:'voiceGroupIds',selected:new Set()},
  ];
  function sameCredentialOwner(scope){try{return JSON.stringify(JSON.parse(scope).slice(0,3))===JSON.stringify(JSON.parse(lastCredentialScope).slice(0,3));}catch{return false;}}
  function acceptConnectionDraft(scope,values){if(scope!==lastCredentialScope)return;for(const [id,value] of Object.entries(values))if($(id).value===value)connectionDrafts.delete(id);}
  Object.assign(words.en,{feishuChannel:'Feishu app bot',feishuSetup:'Use a Feishu internal app bot with the official long connection. No public callback URL is required. Only the configured owner’s private messages are accepted.',feishuOwner:'Your open_id in this app',feishuOwnerHint:'Use the owner’s open_id for this Feishu app. The first message never chooses the owner automatically.',feishuSave:'Save Feishu connection',feishuLimit:'App bot, not a personal account. No group chat or autonomous companion activity.'});
  Object.assign(words.zh,{feishuChannel:'飞书应用机器人',feishuSetup:'连接飞书企业自建应用机器人，使用官方长连接，无需公网回调地址。仅接收指定主人的私聊。',feishuOwner:'你在此应用内的 open_id',feishuOwnerHint:'填写主人在此飞书应用内的 open_id，不会把第一条消息的发送者自动设为主人。',feishuSave:'保存飞书连接',feishuLimit:'这是应用机器人，不是普通个人账号；不接群聊或自主陪伴活动。'});
  Object.assign(words.en,{xChannel:'X standard DMs · experimental',xSetup:'Connect standard one-to-one X DMs from one configured owner. Checks run about every 75 seconds; X API reads and writes may incur charges, in addition to AI usage.',xAccount:"AI account’s numeric X user ID",xOwner:'Your numeric X user ID',xOwnerHint:'Use account IDs, not @usernames. Only this owner’s direct text is accepted.',xSave:'Save X connection',xLimit:'Use a user-authorized token with dm.read, dm.write, users.read and tweet.read. App-only tokens and encrypted X Chat are unsupported. Expired tokens need reauthorization. Confirm applicable X automation requirements before connecting; the app cannot verify platform approval.',xStopped:'X receiving was stopped with /unsubscribe. It stays off after restarting the app.',xResume:'Re-enable X receiving',xResumeHint:'This only clears the local stop. Choose Connect afterward to start receiving again.'});
  Object.assign(words.zh,{xChannel:'X 标准私信 · 实验',xSetup:'接收指定主人的 X 一对一普通私信，约 75 秒检查一次。除 AI 用量外，X API 的读取与发送也可能收费。',xAccount:'AI 账号的 X 数字用户 ID',xOwner:'你的 X 数字用户 ID',xOwnerHint:'填写数字账号 ID，不是 @用户名。仅接收这位主人的直接文字。',xSave:'保存 X 连接',xLimit:'需要用户已授权的令牌及 dm.read、dm.write、users.read、tweet.read 权限。不接 App-only 令牌或加密 X Chat；令牌过期后需重新授权。连接前核实适用的 X 自动化要求，应用不能验证平台批准。',xStopped:'已通过 /unsubscribe 停止 X 接收，重启应用后也保持停用。',xResume:'重新启用 X 接收',xResumeHint:'这里只解除本机停用状态；之后仍需点击连接，才开始接收。'});
  Object.assign(words.en,{messengerChannel:'Messenger Page · experimental',messengerSetup:'Connect a Facebook Page to one configured owner. This needs a separately deployed public HTTPS relay; it is not a personal Facebook login.',messengerApp:'Meta App ID',messengerPage:'Facebook Page ID',messengerOwner:"Owner’s Page-scoped ID (PSID)",messengerRelay:'HTTPS relay origin',messengerRelayHint:'Use the origin only, without a path, query or credentials. The relay receives plaintext messages.',messengerRelayToken:'Relay access token',messengerSave:'Save Messenger connection',messengerRequirements:'Connection requirements',messengerLimit:'Requires approved Page messaging access, a subscribed webhook and a relay with a publicly trusted HTTPS certificate. App Secret and webhook verification token belong on the relay. Ordinary replies are limited to 24 hours after the owner’s message; no groups or autonomous activity.',messengerStopped:'Messenger receiving was stopped with /unsubscribe. It stays off after restarting the app.',messengerResume:'Re-enable Messenger receiving',messengerResumeHint:'This only clears the local stop. Choose Connect afterward to receive messages again.'});
  Object.assign(words.zh,{messengerChannel:'Messenger Page · 实验',messengerSetup:'让 Facebook Page 接收指定主人的私信。需要另行部署公网 HTTPS 中转服务，不是普通 Facebook 个人账号登录。',messengerApp:'Meta 应用 ID',messengerPage:'Facebook Page ID',messengerOwner:'主人在此 Page 内的 ID（PSID）',messengerRelay:'HTTPS 中转服务地址',messengerRelayHint:'只填协议与域名，不含路径、查询或凭据。中转服务会处理明文消息。',messengerRelayToken:'中转服务访问令牌',messengerSave:'保存 Messenger 连接',messengerRequirements:'连接前需要准备',messengerLimit:'需要适用的 Page 消息权限、已订阅的 webhook 和有公共可信证书的 HTTPS 中转服务。App Secret 与 webhook 验证令牌只放在中转服务器。普通回复限主人发消息后的 24 小时内；不接群聊或自主活动。',messengerStopped:'已通过 /unsubscribe 停止 Messenger 接收，重启应用后也保持停用。',messengerResume:'重新启用 Messenger 接收',messengerResumeHint:'这里只解除本机停用状态；之后仍需点击连接，才开始接收。'});
  let language='en',lastMessages='',lastMascot='',lastMode,state,setupPhase,persona={id:'sprout',name:{en:'Sprout',zh:'小芽'},portrait:'portraits/sprout-anime.png'};
  const recoverKey=el('button','secondary');recoverKey.id='bot-key-recovery';recoverKey.type='button';recoverKey.hidden=true;
  $('bot-key-status').after(recoverKey);$('bot-key-status').setAttribute('role','status');
  $('bot-key').setAttribute('aria-describedby','bot-key-status');
  const savedConnectionHost=el('div');savedConnectionHost.id='bot-saved-connection-host';$('bot-problem').after(savedConnectionHost);
  const messageNodes=new Map();
  let localHistory=null,lastMessageScope='',threadNeedsBottom=false;
  function historyWords(){return language==='zh'?{earlier:'查看更早消息',loading:'正在读取…',end:'已显示本机保留的聊天记录',failed:'暂时无法读取，请重试。'}:{earlier:'View earlier messages',loading:'Loading…',end:'Showing the chat records kept on this device',failed:'Could not load earlier messages. Try again.'};}
  function historyPosition(){
    const pane=$('bot-thread-scroll'),top=pane.getBoundingClientRect().top;
    for(const row of $('bot-messages').children){const rect=row.getBoundingClientRect();if(row.dataset.messageId&&rect.bottom>top&&rect.top<top+pane.clientHeight)return {key:row.dataset.messageId,offset:rect.top-top};}
    return null;
  }
  function restoreHistoryPosition(anchor,scroll){
    const pane=$('bot-thread-scroll'),row=anchor&&messageNodes.get(anchor.key)?.row;
    if(row?.isConnected)pane.scrollTop+=row.getBoundingClientRect().top-pane.getBoundingClientRect().top-anchor.offset;
    else pane.scrollTop=scroll;
    $('bot-latest').hidden=atBottom();
  }
  function drawLocalHistory(){
    const current=localHistory;if(!current)return;
    const anchor=historyPosition(),scroll=$('bot-thread-scroll').scrollTop;
    const words=historyWords(),local=current.kind==='local'?state?.local:state?.tasks,initial=current.kind==='local'?30:60,rows=current.kind==='local'?local?.history:local?.messages,visible=local?.hasEarlierHistory===true||(local?.historyLimit>initial&&rows?.length>0);
    current.host.hidden=!visible;
    current.button.hidden=local?.hasEarlierHistory!==true;
    current.button.disabled=current.pending;
    current.button.textContent=current.pending?words.loading:words.earlier;
    current.host.setAttribute('aria-busy',String(current.pending));
    current.feedback.textContent=current.error?words.failed:local?.hasEarlierHistory===false&&local?.historyLimit>initial&&rows?.length?words.end:'';
    current.feedback.hidden=!current.feedback.textContent;
    if(anchor)restoreHistoryPosition(anchor,scroll);
  }
  function syncLocalHistory(next){
    const kind=next.desktopChat?.kind==='local'?'local':'channel',local=kind==='local'?next.bot?.local:next.bot?.channel==='qq'?next.bot?.tasks:null,accountId=next.accounts?.selectedId,historyId=local?.historyId;
    const method=kind==='local'?'desktopLocalHistory':'desktopChannelHistory';
    const key=typeof accountId==='string'&&typeof historyId==='string'&&historyId&&typeof window.arcade[method]==='function'?JSON.stringify([accountId,kind,historyId]):null;
    if(localHistory?.key!==key){
      localHistory?.host.remove();localHistory=null;
      if(key){
        const host=el('div','local-history-control'),button=el('button','plain'),feedback=el('p','local-history-feedback');
        host.id='desktop-history';button.id='desktop-history-earlier';button.type='button';feedback.id='desktop-history-feedback';feedback.tabIndex=-1;feedback.setAttribute('role','status');host.append(button,feedback);$('bot-messages').before(host);
        const current=localHistory={key,kind,accountId,historyId,host,button,feedback,pending:false,error:false};
        button.onclick=async()=>{
          if(localHistory!==current||current.pending||(current.kind==='local'?state?.local:state?.tasks)?.hasEarlierHistory!==true)return;
          const ownedFocus=document.activeElement===button;
          current.pending=true;current.error=false;drawLocalHistory();
          try{const result=await window.arcade[method]({accountId,historyId});if(localHistory===current&&(result?.ok!==true||result.historyId!==historyId))current.error=true;}
          catch{if(localHistory===current)current.error=true;}
          finally{if(localHistory===current){current.pending=false;drawLocalHistory();if(ownedFocus&&document.body.dataset.view==='bot'&&[document.body,button].includes(document.activeElement)){if(!button.hidden)button.focus({preventScroll:true});else if(!feedback.hidden)feedback.focus({preventScroll:true});}}}
        };
      }
    }
    drawLocalHistory();
  }

  words.en.access='On your phone, open WeChat → Me → Settings → Plugins → ClawBot, enable it, then scan below. Send tasks in the ClawBot conversation, not to an ordinary contact named Agent Arcade. If this entry is missing, client compatibility or account availability remains unverified.';
  words.zh.access='手机微信：我 → 设置 → 插件 → ClawBot，启用后再扫码。任务入口是 ClawBot 对话，不是名为 Agent Arcade 的普通好友。若没有此入口，当前客户端适配或账号可用性仍待核实。';
  words.en.scan='Enable ClawBot in mobile WeChat, then scan and confirm. Codes expire after three minutes.';words.zh.scan='在手机微信启用 ClawBot 后扫码并确认，二维码三分钟后失效。';
  words.en.empty='After starting reception, send a task in the WeChat ClawBot conversation. Tasks and replies will appear here.';words.zh.empty='开始接收任务后，在微信 ClawBot 对话中发一条任务。任务与回复会出现在这里。';
  words.en.paired='Authorization credentials saved';words.zh.paired='授权凭证已保存';
  words.en.repair='Pair WeChat again';words.zh.repair='重新扫码配对';
  words.en.connected='You can send a message';words.zh.connected='可以发消息';
  words.en.received='WeChat message received';words.zh.received='已收到微信消息';
  Object.assign(words.en,{nav:'WeChat',title:'WeChat',setup:'Connection settings',pair:'Pair WeChat',pairStep:'Pair WeChat',projectStep:'Choose a project and execution method',startStep:'Start the connection',startNote:'Pairing alone does not start work. Send your instruction from WeChat after connecting.',privacyTitle:'Privacy and saved credentials',nativeRequirements:'Login, requirements and permissions',messageEntry:'Send messages in WeChat → ClawBot. This window displays the conversation.',preview:'Preview · live WeChat acceptance is incomplete.',inbox:'Conversation',inboxNote:'Received WeChat messages and agent replies.',wechatChannel:'WeChat · ClawBot private chat',access:'On your phone, go to WeChat → Me → Settings → Plugins, enable ClawBot, then scan below. This connects only the linked owner’s private ClawBot chat. Regular WeChat groups aren’t supported yet. If ClawBot is missing, we can’t confirm whether it’s available on your app or account.'});
  Object.assign(words.zh,{nav:'微信',title:'微信',setup:'连接设置',pair:'配对微信',pairStep:'配对微信',projectStep:'选择项目和执行方式',startStep:'启动连接',startNote:'配对不会自动开始执行。连接后请从微信发出指令。',privacyTitle:'隐私与已保存凭证',nativeRequirements:'登录、运行要求与权限',messageEntry:'消息入口：微信 → ClawBot。本窗口用于查看对话。',preview:'预览版 · 微信集成仍有未验收项。',inbox:'对话',inboxNote:'收到的微信消息与 Agent 回复。',wechatChannel:'微信 · ClawBot 私聊',access:'在手机微信的「我 → 设置 → 插件」启用 ClawBot，再扫下方二维码。这里只接入绑定主人的 ClawBot 专属私聊，暂不支持普通微信群。若找不到 ClawBot，暂无法确认你的微信客户端或账号是否支持。'});
  Object.assign(words.en,{
    mode:'Execution method',modeApi:'API agent',modeNative:'Claude Channels · manual startup',modeClaude:'Local Claude · program mode',claudeSetup:'Uses your installed original Claude Code and its existing login, without loading custom Channels or opening a terminal for each connection. Requires Claude Code 2.1.317. Tool actions still need approval; this app does not read Claude credentials.',
    budget:'SDK cost threshold (USD)',budgetNote:'In-flight requests may exceed this threshold. It is not a hard billing cap.',
    nativeSetup:'Uses Claude Code and its existing login; this app does not read Claude credentials. Requires Node.js 22.13+ and local Claude Code 2.1.317. Open Claude below, then complete the original CLI prompts and confirm the custom Channels research preview yourself.',
    nativeReplyPermission:'This launch pre-allows WeChat replies for this session, so ordinary chat does not need repeated confirmation. Other actions still follow your CLI permissions.',
    nativeStopNote:'Disconnecting WeChat also stops a session launched by this app. A manually opened CLI must be stopped in its original terminal with Ctrl+C. Stop verification covers this app’s Claude process tree; independent background jobs are not confirmed.',
    keyRetained:'Your saved API key stays stored when switching modes.',nativeCommand:'Manual launch command',copyCommand:'Copy launch command',copied:'Launch command copied',
    nativeLaunch:'Open Claude',nativeResume:'Resume last session',nativeNew:'Open new session',nativeHalt:'Stop local session',nativeStarting:'Opening Claude…',nativeStopping:'Stopping this session…',nativeRunning:'Claude is open; the channel is not connected yet. Check the original terminal for startup prompts.',nativeSessionReady:'Keep this Claude session open and continue in your chat.',nativeStoppedMain:'Local session stopped',nativeStopped:'This local session has stopped. Resume it when you are ready.',nativeUnknown:'The local process state could not be confirmed. Check its original terminal.',nativeLaunchNote:'Open the original Claude terminal and complete its prompts yourself.',nativeStopScope:'Only this app’s Claude process tree is checked; independent background jobs are not confirmed.',
    nativeStart:'Connect WeChat',nativeStop:'Disconnect WeChat (CLI may keep running)',nativeDisconnecting:'Disconnecting WeChat…',nativeStartNote:'After connecting, open Claude below and complete its prompts. Then send a message in WeChat.',
    nativePrivacy:'WeChat messages pass through Tencent. The original Claude Code CLI uses its normal service and local session storage. WeChat credentials use OS encryption.',
    nativeInbox:'Conversation',nativeInboxNote:'Your current Claude conversation, continued from WeChat.',
    nativeEmpty:'Open Claude in Conversation settings, then send a message from WeChat.',
    nativeHelp:'Chat normally in ClawBot; messages share one Claude conversation. WeChat replies are pre-allowed for this session; other actions follow existing CLI permissions. For a new permission, review the request and copy its /allow CODE or /deny CODE. /status checks the connection and current requests. Send 停止 or /cancel to stop a session launched by this app; /resume explicitly resumes that session. For a manually opened CLI, stop it in its original terminal.',
    nativeRisk:'The CLI keeps its normal local permissions. Commands may affect files beyond the selected folder. A response ending does not verify the work. Disconnecting WeChat does not guarantee that Claude stops.',
    nativeConfirmForget:'Forget the saved API key and WeChat credentials? Forwarding will stop, but Claude may keep running in its terminal.',
    nativeOpenClaude:'Waiting for you to open Claude',nativeAwaitingChannel:'Waiting for Claude channel',nativeAwaitingHint:'Claude is open. Complete its channel startup prompt in the original terminal; you do not need to reconnect the chat account.',nativeNeedsApproval:'Waiting for your approval',nativePausedMain:'WeChat forwarding paused',
    nativeOpenHint:'Open Conversation settings, choose Open Claude, and complete the original CLI prompts yourself.',nativeReadyHint:'Say what you need in the WeChat ClawBot conversation.',nativeReceivedHint:'Your message arrived. Look for the reply in WeChat.',nativeApprovalHint:'Review the operation request in WeChat before allowing it.',nativePausedHint:'Check the local session in Conversation settings. A manually opened CLI must be stopped in its original terminal.',
    nativeDeliveryFailed:'WeChat delivery failed. Use /status to retrieve pending permission requests; inspect ordinary replies here.'
  });
  Object.assign(words.zh,{
    mode:'执行方式',modeApi:'API Agent',modeNative:'Claude Channels · 手动启动',modeClaude:'本机 Claude · 程序模式',claudeSetup:'使用已安装的原版 Claude Code 和既有登录，不加载自定义 Channels，也不需要每次连接打开终端确认。需要 Claude Code 2.1.317。工具操作仍需批准；本应用不读取 Claude 凭据。',
    budget:'SDK 费用阈值（美元）',budgetNote:'在途请求可能超过此阈值，它不是计费硬上限。',
    nativeSetup:'使用 Claude Code 的既有登录，本应用不读取 Claude 凭据。需要 Node.js 22.13+ 和本机 Claude Code 2.1.317。点击下方“打开 Claude”，再由你完成原版 CLI 的启动提示及自定义 Channels 研究预览确认。',
    nativeReplyPermission:'本次启动预先允许微信回复，避免普通聊天重复确认；其他操作仍遵循 CLI 权限。',
    nativeStopNote:'断开微信也会停止此应用启动的会话；手动打开的 CLI 请在原终端按 Ctrl+C 停止。停止核验只覆盖此应用启动的 Claude 进程树，独立后台作业未确认。',
    keyRetained:'切换方式会保留已保存的 API key。',nativeCommand:'手动启动命令',copyCommand:'复制启动命令',copied:'启动命令已复制',
    nativeLaunch:'打开 Claude',nativeResume:'恢复上次会话',nativeNew:'打开新会话',nativeHalt:'停止本机会话',nativeStarting:'正在打开 Claude…',nativeStopping:'正在停止本机会话…',nativeRunning:'Claude 已打开，通道尚未连接。请查看原版终端的启动提示。',nativeSessionReady:'保持此 Claude 会话打开，继续在聊天中发送消息。',nativeStoppedMain:'本机会话已停止',nativeStopped:'本机会话已停止，需要时可恢复继续。',nativeUnknown:'尚未确认本机进程状态，请在原终端检查。',nativeLaunchNote:'会打开原版 Claude 终端，启动和权限提示由你亲自确认。',nativeStopScope:'仅核验此应用启动的 Claude 进程树；独立后台作业未确认。',
    nativeStart:'连接微信',nativeStop:'断开微信（CLI 可能仍运行）',nativeDisconnecting:'正在断开微信…',nativeStartNote:'连接后点击下方“打开 Claude”，完成原版 CLI 提示，再到微信发消息。',
    nativePrivacy:'微信消息经过腾讯。原版 Claude Code CLI 使用其常规服务与本机会话存储；微信凭证使用系统加密。',
    nativeInbox:'对话',nativeInboxNote:'在微信延续当前 Claude 会话。',
    nativeEmpty:'在对话设置中打开 Claude，再到微信发消息。',
    nativeHelp:'在 ClawBot 里正常聊天，消息共用同一个 Claude 会话。本次会话预许可微信回复工具，其他操作沿用 CLI 既有权限。请求新权限时，先核对操作，再复制对应的 /allow CODE 或 /deny CODE。/status 查看连接和当前请求。发送“停止”或 /cancel 可停止此应用启动的会话；/resume 明确恢复该会话。手动打开的 CLI 仍需在原终端停止。',
    nativeRisk:'CLI 保留其正常本机权限，命令可能影响所选目录以外的内容。回复结束不代表任务通过验证。断开微信不能保证 Claude 停止。',
    nativeConfirmForget:'忘记已保存的 API key 和微信凭证？转发会停止，但终端中的 Claude 可能仍在运行。',
    nativeOpenClaude:'等你打开 Claude',nativeAwaitingChannel:'等待 Claude 通道连接',nativeAwaitingHint:'Claude 已打开。请在原版终端完成通道启动提示，不需要重新连接聊天账号。',nativeNeedsApproval:'等你确认操作',nativePausedMain:'微信转发已暂停',
    nativeOpenHint:'展开对话设置，点击“打开 Claude”，亲自完成原版 CLI 提示。',nativeReadyHint:'到微信 ClawBot 对话里说需求。',nativeReceivedHint:'消息已到，请留意微信中的回复。',nativeApprovalHint:'请先核对微信里的操作请求，再决定是否允许。',nativePausedHint:'可在对话设置中查看本机会话；手动打开的 CLI 请在原终端停止。',
    nativeDeliveryFailed:'微信回传失败。权限请求可发 /status 重取；普通回复请在本机检查。'
  });
  words.en.disconnecting='Stopping the local task…';words.zh.disconnecting='正在停止本机任务…';
  copy.en.localNote='Observer events stay on this device.';copy.zh.localNote='观察器事件留在本机。';
  const word=k=>words[language][k]||k;
  const run=fn=>action(async()=>{if(!window.arcade.botConfigure)throw Error(word('notDesktop'));try{await fn();}catch(error){if(error?.code==='credentials_busy'||String(error?.message||'').endsWith('(credentials_busy)'))throw Error(language==='zh'?'这位搭档的凭据正在清除。请等待完成后重新打开设置，再保存或连接。':'This companion’s credentials are being cleared. Wait for completion, then reopen settings before saving or connecting.');if(error?.code==='credential_scope_changed'||String(error?.message||'').endsWith('(credential_scope_changed)'))throw Error(language==='zh'?'搭档或连接方式已变化。请重新打开对应搭档的连接设置，再修改凭据。':'The companion or connection method changed. Reopen that companion’s connection settings before changing credentials.');throw error;}});
  Object.assign(words.en,{title:'WeChat conversation',settingsToggle:'Connection',closeSettings:'Close connection settings',copyReply:'Copy reply',replyCopied:'Reply copied',latest:'Latest messages',emptyTitle:'Your conversation starts in WeChat',emptySetup:'Connect ClawBot and choose where Claude will work. Messages and replies will appear here.',emptyReady:'Send your first message to ClawBot on your phone.',openSetup:'Set up connection'});
  Object.assign(words.zh,{title:'微信对话',settingsToggle:'连接设置',closeSettings:'收起连接设置',copyReply:'复制回复',replyCopied:'回复已复制',latest:'查看最新消息',emptyTitle:'从微信，开始一段对话',emptySetup:'连接 ClawBot，选择 Claude 的工作目录。你发出的消息和收到的回复，会显示在这里。',emptyReady:'到手机微信的 ClawBot 对话里，发出第一条消息。',openSetup:'设置连接'});
  Object.assign(words.en,{nativeStop:'Disconnect WeChat',nativeInboxNote:'Local Claude Code',received:'Message received',connected:'WeChat connected'});
  Object.assign(words.zh,{nativeStop:'断开微信',nativeInboxNote:'本机 Claude Code',received:'已收到消息',connected:'微信已连接'});
  Object.assign(words.en,{nav:'Chats',title:'Sprout',agent:'Sprout',emptyTitle:'Your AI, one conversation away',emptySetup:'Choose a channel and an AI connection. WeChat and Claude are available in this preview.',inboxNote:'WeChat / Claude',settingsToggle:'Conversation settings'});
  Object.assign(words.zh,{nav:'对话',title:'小芽',agent:'小芽',emptyTitle:'和你的 AI 搭档聊聊',emptySetup:'选好聊天渠道和 AI 接入方式，就可以开始。目前可连接微信与 Claude。',inboxNote:'微信 / Claude',settingsToggle:'对话设置'});
  Object.assign(words.en,{channel:'Chat channel',qqSetup:'Use a separate QQ account signed into a local OneBot bridge, such as NapCat. Unofficial and experimental; private text from the configured owner only. Add that QQ account as a friend. Account availability is not guaranteed.',qqUrl:'Local WebSocket address',qqOwner:'Your QQ number (allowed sender)',qqSave:'Save QQ connection',modeApi:'Claude API',modeCodex:'Local Codex',model:'Model',gptNote:'Use a separate OpenAI API key; API usage is billed. Local Codex login does not replace this key. Approved project file tools are available; shell commands are not. There is no dollar cap.',deepseekNote:'DeepSeek API billing applies. Approved local file tools are available; shell commands are not. Limits are per request and turn, not a dollar cap.',codexSetup:'Uses your installed Codex and its existing login through App Server; no separate API key. Workspace changes use Codex sandbox rules. When Codex asks, review and approve the exact action. Stops interrupt the current turn.',emptySetup:'Choose a chat channel and an AI connection. Your messages and replies will appear here.',emptyReady:'Send a private message from the configured account to begin.',confirmForget:'Forget all saved API keys and messaging credentials? Active work will be cancelled.'});
  Object.assign(words.zh,{channel:'聊天渠道',qqSetup:'用独立 QQ 账号登录本机 OneBot 桥接（例如 NapCat），然后加它为好友。此接入非官方、属实验功能，目前只接指定主人的私聊文字；账号可用性不作保证。',qqUrl:'本机 WebSocket 地址',qqOwner:'你的 QQ 号（允许派活的人）',qqSave:'保存 QQ 连接',modeApi:'Claude API',modeCodex:'本机 Codex',model:'模型',gptNote:'使用独立 OpenAI API key，按 API 用量计费；本机 Codex 登录不代替此密钥。支持经批准的项目文件操作，不执行终端命令，不设美元费用上限。',deepseekNote:'使用 DeepSeek API 计费。支持经批准的本地文件操作，暂不执行终端命令。限制请求次数与长度，不设美元费用上限。',codexSetup:'通过 App Server 使用本机 Codex 的既有登录，无需另配 API key。项目内操作遵循 Codex 沙箱规则；遇到权限请求时核对并批准具体操作。“停止”会中断当前回合。',emptySetup:'选择聊天渠道和 AI 接入方式。你发出的消息和收到的回复，会显示在这里。',emptyReady:'从指定的账号发一条私聊，即可开始。',confirmForget:'忘记所有已保存的 API key 与聊天渠道凭证？当前执行会被取消。'});
  Object.assign(words.en,{
    qqSetup:'Give your AI its own QQ account. Add it as a friend and chat or send tasks privately. This experimental bridge is not an official Tencent integration.',
    qqLoginTitle:"Sign in to the AI's QQ",qqLoginNote:"Install NapCat separately and sign in with the AI's QQ account. Add it from your own QQ, then accept the friend request in that account.",qqDownload:'Get NapCat',qqGuide:'Connection guide',
    qqBridgeTitle:'Connect on this computer',qqBridgeNote:'In NapCat, add a forward WebSocket server: Universal (API + events), Array format, host 127.0.0.1, port 3001, path /. Turn off self-message reporting and keep the 30-second heartbeat.',qqPrepare:'Generate connection token',qqPrepared:'Token ready',qqCopyConfig:'Copy NapCat configuration',qqCopyToken:'Copy token only',qqConfigHelp:'Where to use the copied configuration',qqConfigHelpNote:'The configuration is one websocketServers entry, not a whole file. In NapCat Desktop, fill the fields above and paste the token. Save the connection, then save the Bot configuration; restart if prompted.',qqAdvanced:'Use an existing connection or another port',qqTokenHint:'Use the OneBot token, not the WebUI password. Leave blank to keep the saved token.',
    qqCheckTitle:'Check which account is connected',qqOwnerNote:"Enter your own QQ number, not the AI's. Only your friend-private messages are accepted; groups and other senders are ignored.",qqTest:'Test connection',qqTesting:'Checking QQ…',checking:'Checking QQ…',qqSaved:'QQ connection saved',qqTokenPrepared:'Connection token saved with OS encryption',qqConfigCopied:'NapCat configuration copied. It contains your connection token.',qqTokenCopied:'Connection token copied',qqCheckEmpty:'Account not checked yet',qqCheckEmptyNote:'Save your QQ number and connection settings, then test. No message or AI task will be sent.',qqCheckFailed:'Could not check the QQ connection',qqCheckOnly:'This checks the bridge and account; a real private-message round trip is still unverified.'
  });
  Object.assign(words.zh,{
    qqSetup:'让 AI 使用独立 QQ 账号。加它为好友，在私聊里聊天或派活。此桥接为实验功能，非腾讯官方接入。',
    qqLoginTitle:'登录 AI 的 QQ',qqLoginNote:'独立安装 NapCat，用 AI 的 QQ 账号登录。再用你自己的 QQ 加它为好友，并在 AI 账号里手动通过申请。',qqDownload:'获取 NapCat',qqGuide:'配置指引',
    qqBridgeTitle:'配置本机连接',qqBridgeNote:'在 NapCat 新建 WS 正向服务器：Universal（API＋事件）、Array 格式，主机 127.0.0.1、端口 3001、路径 /。关闭自身消息上报，保留 30 秒心跳。',qqPrepare:'生成连接令牌',qqPrepared:'令牌已准备',qqCopyConfig:'复制 NapCat 配置',qqCopyToken:'只复制令牌',qqConfigHelp:'复制后怎么用',qqConfigHelpNote:'配置是 websocketServers 里的单个条目，不是整份文件。使用 NapCat Desktop 时，按上方逐项填写并粘贴令牌。先保存连接，再保存 Bot 配置；有提示时重启。',qqAdvanced:'已有连接或需要更换端口',qqTokenHint:'填写 OneBot token，不是 WebUI 密码。留空保留已保存令牌。',
    qqCheckTitle:'核对连接的账号',qqOwnerNote:'填你自己的 QQ，不是 AI 的 QQ。只接收你的好友私聊，群聊及其他人不会触发任务。',qqTest:'测试连接',qqTesting:'正在检查 QQ…',checking:'正在检查 QQ…',qqSaved:'QQ 连接已保存',qqTokenPrepared:'连接令牌已使用系统加密保存',qqConfigCopied:'NapCat 配置已复制，其中含连接令牌。',qqTokenCopied:'连接令牌已复制',qqCheckEmpty:'尚未核对账号',qqCheckEmptyNote:'保存你的 QQ 号与连接设置后再检查。检查不会发消息，也不会派发 AI 任务。',qqCheckFailed:'未能检查 QQ 连接',qqCheckOnly:'这里只核对本机连接与账号；真实私聊收发仍待验证。'
  });
  Object.assign(words.en,{setup:'Conversation settings',closeSettings:'Close conversation settings',advancedGroup:'Channels and tasks (advanced)',projectStep:'AI',aiService:'AI service',localControls:'The App conversation replies only in this window and is stored separately on this computer.',characterSettings:'Preset, lorebook and sampling for this character are in the character library'});
  Object.assign(words.zh,{setup:'对话设置',closeSettings:'收起对话设置',advancedGroup:'渠道与派活（高级）',projectStep:'AI',aiService:'AI 服务',localControls:'App 对话只在这个窗口里回复，聊天记录单独保存在这台电脑上。',characterSettings:'这位角色的预设、世界书和采样，在角色库里设置'});
  Object.assign(words.en,{qqSetup:'Use your AI’s separate QQ account with an existing OneBot bridge. Private chat accepts the configured owner; group chat must be enabled separately below. This experimental bridge is not an official Tencent integration.',qqLoginNote:'Use a bridge you already have and sign in with the AI’s QQ account. NapCat’s upstream stopped publishing on 2026-11-12; downloads are unavailable here. Native macOS bridge sign-in is unverified.',qqDownload:'NapCat download unavailable',qqOwnerNote:'Enter your own QQ number, not the AI’s. This owner restriction applies to private chat; group settings are separate.',qqGroupsTitle:'QQ group chat',qqGroupsNote:'Choose up to five groups for this companion. Private chat keeps its own owner restriction. Choosing groups does not connect the account.',qqGroupsEnabled:'Enable replies in selected groups',qqGroupIds:'Group numbers (one per line)',qqGroupsRule:'Use numeric group IDs, not names. Existing reply decisions apply; every message need not receive a reply.',qqGroupsProactive:'Allow proactive messages in these groups',qqGroupsProactiveNote:'Off by default. Also turn on “Let her start conversations” in Companion settings. Small talk can start after 10 quiet minutes during contact hours. After the model waits, a new human turn can bring the next check forward. After a send attempt, the full interval applies. Follow-ups take priority. They wait for the group to be free, within contact hours and under the daily limit. They expire 5 minutes after their due time. Both share one daily limit per group, including unconfirmed sends. Replies do not use it. Members can send 暂停主动 to pause contact for themselves.',qqGroupsSave:'Save group settings',qqGroupsBridge:'Requires an existing OneBot bridge reachable on this computer. Native macOS QQ bridge sign-in is unverified. Saving does not verify live group chat.',qqGroupsSaved:'Group settings saved. The account has not been connected by this action; live group chat remains unverified.',qqGroupsInvalid:'Enter up to five distinct numeric group IDs (5–15 digits), separated by newlines or commas. Enabling replies requires at least one group.',qqGroupsLocked:'Disconnect before changing group settings.',qqGroupsPending:'Saving group settings…',qqGroupsDisabled:'Group chat is off. The private-chat settings are unchanged.'});
  Object.assign(words.zh,{qqSetup:'使用 AI 的独立 QQ 账号和已有 OneBot 桥接。私聊只接指定主人；群聊需在下方单独启用。此实验接入非腾讯官方提供。',qqLoginNote:'使用你已有的桥接，登录 AI 的 QQ 账号。NapCat 上游已于 2026-11-12 停止发布，此处无法下载；原生 macOS 桥接登录尚未核实。',qqDownload:'NapCat 下载已不可用',qqOwnerNote:'填你自己的 QQ，不是 AI 的 QQ。这里限制私聊主人；群聊范围在下方单独设置。',qqGroupsTitle:'QQ 群聊',qqGroupsNote:'为这位搭档选择最多 5 个群。私聊仍只接指定主人；选择群不会自动连接账号。',qqGroupsEnabled:'在选定群内启用回复',qqGroupIds:'群号（每行一个）',qqGroupsRule:'填写数字群号，不用群名。沿用现有机制判断是否接话，并非每条消息都会回复。',qqGroupsProactive:'允许在这些群主动发消息',qqGroupsProactiveNote:'默认关闭，还需在「相处方式」开启「让她主动找我聊天」。联系时段内，全群安静 10 分钟后可考虑闲聊。如果上次选择等待，有人接着聊才会提前再考虑。尝试发送后仍要等满设定间隔。回访优先，到点后最多等 5 分钟，群聊空闲且符合时段和额度即可发出，过期不补发。两类消息共用每群每日额度，发送未确认也计入，普通回复不占用。群成员可发「暂停主动」，暂停发给自己的主动联系。',qqGroupsSave:'保存群聊设置',qqGroupsBridge:'需要本机可访问的已有 OneBot 桥接。原生 macOS QQ 桥接登录尚未核实；保存设置不代表真实群聊已验收。',qqGroupsSaved:'群聊设置已保存；此次操作没有连接账号，真实群聊仍待验收。',qqGroupsInvalid:'请填写最多 5 个不重复的数字群号（5–15 位），用换行或逗号分隔；启用回复时至少填写一个群号。',qqGroupsLocked:'请先断开连接，再修改群聊设置。',qqGroupsPending:'正在保存群聊设置…',qqGroupsDisabled:'群聊已关闭；私聊设置保持不变。'});
  words.en.qqGroupsCompanionSettings='Open companion settings';
  words.zh.qqGroupsCompanionSettings='打开相处方式';
  Object.assign(words.zh,{
    qqGroupsOnline:'这位搭档的 QQ 已连接。在对话页断开，修改并保存后重新连接。',
    qqGroupsConnecting:'QQ 正在连接。连接结束后，先断开再修改。',
    qqGroupsDisconnecting:'QQ 正在断开。断开后即可修改。',
    qqGroupsChecking:'正在检查 QQ 连接。请在检查结束后修改。',
    qqGroupsPairing:'QQ 正在配对。请在配对结束后修改。',
    qqGroupsEnableFirst:'请先勾选「{label}」。',qqDailyReplies:'普通接话',
    qqGroupsLocalGate:'按群选择本机接话判断',
    qqGroupsLocalGateAccount:'请先保存这位搭档的 QQ 号，再启用本机接话判断。',
    qqGroupsLocalGateNote:'勾选的群由本机 Ollama 判断，其他群由搭档原来的 AI 判断。请先安装 qwen3.6:35b-a3b 并运行 Ollama。所有群的正式回复仍由搭档原来的 AI 生成；本机判断不可用时，该群本轮保持安静。',
    qqGateOriginal:'搭档原 AI',qqGateLocal:'本机 Ollama',qqGateCurrent:'当前',qqGateAfterSave:'保存后',
    qqGateAccountDraft:'请先保存正在修改的搭档 QQ 号，再保存本机接话选择。',
    qqGateEmpty:'请在上方填写群号，选择哪些群使用本机判断。',
  });
  Object.assign(words.en,{
    qqGroupsOnline:'This companion is connected to QQ. Disconnect before editing, then save and reconnect.',
    qqGroupsConnecting:'Connecting to QQ. Once connected, disconnect before editing.',
    qqGroupsDisconnecting:'Disconnecting from QQ. You can edit when disconnection finishes.',
    qqGroupsChecking:'Checking the QQ connection. You can edit when the check finishes.',
    qqGroupsPairing:'Pairing QQ. You can edit when pairing finishes.',
    qqGroupsEnableFirst:'First select “{label}”.',qqDailyReplies:'Reply to messages',
    qqGroupsLocalGate:'Choose local reply decisions by group',
    qqGroupsLocalGateAccount:'Save this companion’s QQ number before enabling local reply decisions.',
    qqGroupsLocalGateNote:'Checked groups use local Ollama to decide when to reply. Other groups use the companion’s AI. Run Ollama with qwen3.6:35b-a3b installed. The companion’s AI writes replies in every group. If a local check fails, that group stays quiet for the turn.',
    qqGateOriginal:'companion’s AI',qqGateLocal:'local Ollama',qqGateCurrent:'Current',qqGateAfterSave:'After saving',
    qqGateAccountDraft:'Save the edited companion QQ number before saving local reply decisions.',
    qqGateEmpty:'Enter group numbers above to choose which groups use local decisions.',
  });
  Object.assign(words.en,{
    qqGroupDirectoryLoad:'Read joined groups',qqGroupDirectorySelect:'Group name and number',qqGroupDirectoryAdd:'Add to pending groups',
    qqGroupDirectoryVerify:'Test the saved connection above to verify the companion’s QQ number and online status. You can also enter group numbers below.',
    qqGroupDirectoryReading:'Reading joined groups from the bridge…',qqGroupDirectoryChoose:'Choose a group…',qqGroupDirectoryUnnamed:'Unnamed group',
    qqGroupDirectoryEmpty:'The bridge returned no groups. You can enter a group number below.',
    qqGroupDirectoryFailed:'Could not read joined groups. Check the connection or enter group numbers below.',
    qqGroupDirectoryAvailable:'Read the list for the verified account, or enter group numbers below.',
    qqGroupDirectoryReady:'Groups shown come from the bridge. Match the group number, then add and save.',
    qqGroupDirectoryAdded:'Group number added below. Save group settings to apply it.',
    qqGroupDirectoryFull:'You can save up to five groups. Check the group numbers entered below.',
  });
  Object.assign(words.zh,{
    qqGroupDirectoryLoad:'读取已加入的群',qqGroupDirectorySelect:'群名和群号',qqGroupDirectoryAdd:'加入待保存列表',
    qqGroupDirectoryVerify:'先在上方测试已保存的连接，核对搭档 QQ 号和在线状态。也可以在下方手填群号。',
    qqGroupDirectoryReading:'正在从桥接读取已加入的群…',qqGroupDirectoryChoose:'请选择群…',qqGroupDirectoryUnnamed:'未命名群',
    qqGroupDirectoryEmpty:'桥接没有返回群。你仍可在下方手填群号。',
    qqGroupDirectoryFailed:'读取群列表失败。可检查连接后再试，或在下方手填群号。',
    qqGroupDirectoryAvailable:'可以读取已核对账号的群列表，也可以在下方手填群号。',
    qqGroupDirectoryReady:'名单来自桥接。请核对数字群号，再添加并保存。',
    qqGroupDirectoryAdded:'群号已加入下方列表。保存群聊设置后生效。',
    qqGroupDirectoryFull:'最多可保存五个群。请先核对下方已填写的群号。',
  });
  words.en.qqGroupsLimits='Enable companion mode in Companion settings with a supported API or local Claude connection before connecting groups. A role can reply with text and media approved for this group. Group members and private chats keep separate memories. Task tools are unavailable in groups.';
  words.zh.qqGroupsLimits='连接群聊前，先在「相处方式」开启陪伴，并选用支持陪伴的 API 或本机 Claude。角色可以用文字和为本群选定的素材回复。各群成员与私聊的记忆分开保存，群内无法使用派活工具。';
  Object.assign(words.en,{qqGroupImages:'Let selected groups share images with the AI',qqGroupImagesNote:'Off by default. In selected groups, one supported still image may be sent to your AI provider, from a new message or an exact quote of an image message already seen in the same group. The model must support images and may still choose to stay silent. This setting affects group chat only.',qqGroupMediaEmpty:'Enter valid group numbers above to choose which groups can share images or voice.',qqGroupMediaGroup:'Group',qqGroupVoice:'Transcribe voice messages in selected groups',qqGroupVoiceNote:'Off by default. Configure local speech recognition first. The bridge must supply a verified inline WAV or QQ PTT link tied to the exact group message. PTT recordings are size-limited and decoded locally from SILK. A filename alone cannot locate a recording.',qqGroupVoicePrivacy:'Speech is transcribed on this computer. The transcript may go to your AI provider for chat and cannot execute commands. Private voice and voice sending use separate settings.',qqGroupVoiceUnverified:'Voice source unverified.',qqGroupVoiceWAV:'Verified this connection: inline WAV.',qqGroupVoicePTT:'Verified this connection: QQ PTT decoded locally.',qqGroupVoiceUnavailable:'Voice unavailable. Check the recording and local speech recognition, or ask the sender to use text.'});
  Object.assign(words.zh,{qqGroupImages:'允许选定群分享图片给 AI',qqGroupImagesNote:'默认关闭。开启后，新消息中的单张受支持静态图片，或精确引用本群已接收的图片消息，可能会发送给你选择的 AI 提供商。模型需支持看图，也可选择不回复。此设置仅影响群聊。',qqGroupMediaEmpty:'请先在上方填写有效群号，再为各群选择图片或语音许可。',qqGroupMediaGroup:'群',qqGroupVoice:'转写选定群的语音消息',qqGroupVoiceNote:'默认关闭。请先配置本机语音识别。桥接须提供与原群消息核对一致的内嵌 WAV 或 QQ PTT 链接。PTT 音频有大小限制，并在本机解码 SILK。仅凭文件名无法定位录音。',qqGroupVoicePrivacy:'语音在本机转写。转写文字可能发给你选择的 AI 提供商用于聊天，不能用来执行指令。私聊语音和语音发送使用各自的设置。',qqGroupVoiceUnverified:'语音来源尚未核实。',qqGroupVoiceWAV:'本次连接已核实：内嵌 WAV。',qqGroupVoicePTT:'本次连接已核实：QQ PTT 已在本机解码。',qqGroupVoiceUnavailable:'语音暂不可用。请检查桥接发来的录音和本机语音识别，或请发送者改用文字。'});
  // Conversation settings panel. The App conversation needs only the AI service, its model and
  // key; channel pairing, the project folder, the SDK threshold, connection start, diagnostics and
  // chat commands sit in one disclosure below. Every control keeps its id, handler and value.
  const setupSteps=document.querySelectorAll('.bot-setup-content>fieldset.setup-step'),aiStep=setupSteps[1];
  const advancedGroup=el('details','bot-help bot-advanced');advancedGroup.id='bot-advanced';
  {
    const summary=el('summary'),project=el('div','bot-advanced-project');summary.dataset.bot='advancedGroup';
    project.append(document.querySelector('label[for="bot-project"]'),document.querySelector('.bot-project-row'));
    advancedGroup.append(summary,setupSteps[0],project,$('bot-claude-budget'),setupSteps[2],$('bot-connection-details'),document.querySelector('[data-bot="commands"]').closest('details'));
  }
  // desktop-chat.js puts "Pause App chat" here; the note says what the App conversation is.
  const localControls=el('div','bot-local-controls'),localNote=el('p','bot-fine');localControls.id='bot-local-controls';localControls.hidden=true;localNote.dataset.bot='localControls';localControls.append(localNote);
  const characterSettings=el('button','plain bot-character-settings');characterSettings.id='bot-character-settings';characterSettings.type='button';characterSettings.hidden=true;characterSettings.dataset.bot='characterSettings';
  characterSettings.onclick=()=>{setSetupOpen(false);if(window.ArcadeCharactersTabs?.open)window.ArcadeCharactersTabs.open('settings');else switchView('characters');};
  aiStep.after(localControls,characterSettings,advancedGroup);
  let advancedPhase;
  const managedQQ=typeof window.arcade.qqRuntimeRefresh==='function';
  if(managedQQ){
    Object.assign(words.en,{qqManageTitle:'Choose a QQ account and bind a companion',qqManage:'Manage QQ accounts',qqManageNote:'Add or select a QQ account, sign in when needed, then bind it to a companion. After saving the binding, open Manage companions and choose Connect.',qqManual:'Advanced: manual connection settings'});
    Object.assign(words.zh,{qqManageTitle:'选择 QQ 并绑定搭档',qqManage:'管理 QQ 账号',qqManageNote:'添加或选择 QQ 账号，按需登录后绑定搭档。保存绑定后，在「管理搭档」中点击「连接」。',qqManual:'高级配置：手动连接'});
    const options=$('bot-qq-options'),manual=el('details','bot-help');manual.id='bot-qq-manual';
    const summary=el('summary');summary.dataset.bot='qqManual';manual.append(summary);
    // Move the original controls once: keep their IDs, handlers and saved values.
    for(const section of [...options.children])if(section.classList.contains('qq-setup-part')&&section.id!=='bot-qq-groups')manual.append(section);
    const managed=el('div','qq-setup-part');managed.id='bot-qq-managed';
    const heading=el('h3'),note=el('p'),button=el('button','primary');
    heading.dataset.bot='qqManageTitle';note.dataset.bot='qqManageNote';button.dataset.bot='qqManage';
    button.id='bot-qq-manage';button.type='button';button.onclick=()=>{setSetupOpen(false);const current=data?.accounts?.accounts?.find(row=>row.id===data.accounts.selectedId);window.openQQRuntime?.({accountId:current?.expectedQQAccountId||current?.accountId||current?.qqBinding?.accountId});};
    managed.append(heading,note,button);options.append(managed,$('bot-qq-groups'),manual);
    const runtime=el('button','plain');runtime.id='bot-problem-qq-runtime';runtime.hidden=true;runtime.onclick=button.onclick;$('bot-problem').after(runtime);
  }
  function renderQQCheck(qqState,status,macStatus){
    const check=qqState?.check,zh=language==='zh',node=$('bot-qq-check');
    const bridge=macQQ?(zh?'OneBot 桥接':'your OneBot bridge'):'NapCat';
    const signIn=zh?`请在 ${bridge} 登录后重新检查。`:`Sign in through ${bridge} and test again.`;
    node.dataset.state=check?.state||'empty';
    let title=word('qqCheckEmpty'),detail=word('qqCheckEmptyNote');
    if(status==='checking'||check?.state==='checking'){
      title=word('qqTesting');detail=zh?'正在读取登录账号、在线状态和好友关系。不会发送消息或启动 AI。':'Reading the login identity, online status and friendship. No message or AI request is sent.';
    }else if(macStatus?.issue){
      title=macStatus.label;detail=macStatus.detail;
      node.dataset.state=macStatus.tone==='waiting'?'attention':macStatus.tone==='unknown'?'unknown':'failed';
    }else if(check?.state==='checked'){
      const name=[check.nickname,check.accountId?`(${check.accountId})`:''].filter(Boolean).join(' ');
      title=(zh?'已识别 QQ：':'QQ identified: ')+name;
      const online=check.online===true?(zh?'账号在线。':'The account is online.'):check.online===false?(managedQQ?(zh?'账号当前离线。请打开“管理 QQ 账号”核对登录后重新检查。':'The account is offline. Open Manage QQ accounts, check sign-in, then test again.'):(zh?'账号当前离线。':'The account is offline. ')+signIn):(managedQQ?(zh?'在线状态尚未核实。请打开“管理 QQ 账号”核对对应账号。':'Online status is unknown. Inspect the account in Manage QQ accounts.'):(zh?`在线状态尚未核实。请在 ${bridge} 确认已登录。`:`Online status is unknown. Confirm the login in ${bridge}.`));
      const friend=check.ownerIsFriend===true?(zh?'已核对：你的 QQ 在此账号的好友列表中。':'Your QQ is in this account’s friend list.'):check.ownerIsFriend===false?(zh?'尚未找到你的 QQ 好友关系。请互加好友，在 AI 账号通过申请后重新检查。':'Your QQ was not found as a friend. Add the accounts as friends, accept in the AI account, then test again.'):(zh?'好友关系尚未核实。请确认已互加好友。':'Friendship is unverified. Confirm the accounts are friends.');
      detail=[macStatus&&status!=='connected'&&check.online!==true?macStatus.detail:online,friend,word('qqCheckOnly')].join(' ');
      if(check.online===false||check.ownerIsFriend===false)node.dataset.state='attention';
      else if(check.online!==true||check.ownerIsFriend!==true)node.dataset.state='unknown';
    }else if(check?.state==='failed'){
      title=word('qqCheckFailed');
      const reasons={
        unauthorized:macQQ?(zh?'令牌未通过验证。请核对 OneBot 桥接中的 Token。':'Authentication failed. Check the token in your OneBot bridge.'):(zh?'令牌未通过验证。请核对 NapCat 的 OneBot token，不要使用 WebUI 密码。':'Authentication failed. Match the NapCat OneBot token; do not use the WebUI password.'),
        invalid_token:macQQ?(zh?'请保存已准备的连接，或在手动连接字段填入有效的 OneBot Token。':'Save the prepared connection, or enter a valid OneBot token in the manual connection fields.'):(zh?'请生成连接令牌，或保存有效的 OneBot token。':'Generate a connection token or save a valid OneBot token.'),
        invalid_owner:zh?'请填写你自己的有效 QQ 号，再保存设置。':'Enter your valid QQ number and save the settings.',
        invalid_bridge_url:zh?'请使用本机 WebSocket 地址，例如 ws://127.0.0.1:3001/。':'Use a local WebSocket address such as ws://127.0.0.1:3001/.',
        owner_is_agent_account:zh?'你填写的是 AI 自己的 QQ。请改为你用来发消息的 QQ 号。':'The allowed sender is the AI account itself. Enter the QQ number you will message from.',
        account_changed:zh?`桥接登录账号已变化。请核对 ${bridge} 的账号后重新检查。`:`The bridge account changed. Check the account in ${bridge} and test again.`,
        invalid_login_info:zh?'桥接未返回有效的登录账号。请确认 QQ 已登录，并使用 WS 正向 Universal 连接。':'The bridge did not return a valid account. Confirm QQ is signed in and use a forward Universal WebSocket connection.',
        account_offline:managedQQ?(zh?'QQ 当前离线。请打开“管理 QQ 账号”核对状态，按需登录后重新检查。':'QQ is offline. Inspect Manage QQ accounts, sign in if needed, then test again.'):(zh?'QQ 当前离线。':'QQ is offline. ')+signIn,
        connect_timeout:zh?'检查超时。请确认 QQ 已登录、连接已启用并保存，且端口与令牌一致。':'The check timed out. Confirm QQ is signed in, the connection is enabled and saved, and the port and token match.',
        timeout:zh?'检查超时。请确认 QQ 已登录、连接已启用并保存，且端口与令牌一致。':'The check timed out. Confirm QQ is signed in, the connection is enabled and saved, and the port and token match.'
      };
      detail=reasons[check.code]||(zh?`无法连接本机 QQ。请确认 ${bridge} 正在运行、WS 正向连接已启用并保存，地址和令牌一致。`:`Could not reach the local QQ bridge. Confirm ${bridge} is running and the forward WebSocket connection is enabled, saved, and uses the same address and token.`);
    }
    $('bot-qq-check-title').textContent=title;$('bot-qq-check-detail').textContent=detail;
  }
  async function saveQQSettings(requireOwner=true){
    const context=credentialContext,scope=lastCredentialScope,token=$('bot-qq-token').value;$('bot-qq-token').value='';
    const owner=$('bot-qq-owner').value,expected=$('bot-qq-expected-account').value,qqAccountId=expected.trim();
    const changeAccount=qqAccountId&&qqAccountId!==state?.qq?.expectedAccountId;
    const saved=await window.arcade.botConfigure({...context,qqUrl:$('bot-qq-url').value,...(requireOwner||owner?{qqOwnerId:owner}:{}),...(changeAccount?{qqAccountId}:{}),...(token?{qqToken:token}:{})});
    acceptConnectionDraft(scope,{'bot-qq-expected-account':expected,'bot-qq-owner':owner});
    if(scope===lastCredentialScope&&!connectionDrafts.has('bot-qq-expected-account')){
      $('bot-qq-expected-account').value=saved?.qq?.expectedAccountId??state?.qq?.expectedAccountId??'';
      renderQQGroups(false,state?.status!=='disconnected');
    }
    if(!sameCredentialOwner(scope))throw Object.assign(Error('(credential_scope_changed)'),{code:'credential_scope_changed'});
  }
  if(macQQ)window.applyPreparedQQConnection=({endpoint,accountId,ownerDraft})=>{
    const qq=state?.qq;
    if(state?.channel!=='qq'||!qq?.hasToken||qq.url!==endpoint||qq.expectedAccountId!==accountId)return;
    $('bot-qq-url').value=endpoint;
    $('bot-qq-token').value='';
    $('bot-qq-expected-account').value=accountId;
    connectionDrafts.delete('bot-qq-expected-account');
    $('bot-qq-owner').value=ownerDraft;
    if(ownerDraft===(qq.ownerId||''))connectionDrafts.delete('bot-qq-owner');
    else connectionDrafts.add('bot-qq-owner');
    renderQQGroups(false,state?.status!=='disconnected');
  };
  const qqGroupRoleWords={
    en:{qqExpectedAccount:'Companion’s QQ number',qqExpectedAccountNote:'Required for group character cards. Leave blank to keep the saved number or leave it unset.',
      qqGroupRoles:'Character cards for QQ groups',qqGroupRolesNote:'This approval shares only the name, description and example dialogue with the group’s AI. The card’s embedded world book is for App chat. To add a separate world book, save the role, then review and approve a book under Advanced → World book for this group.',
      qqGroupRoleGroup:'Group',qqGroupRoleCard:'Card from Characters',qqGroupRoleReview:'Review public fields',qqGroupRoleClear:'Use default group role',qqGroupRolePreview:'Content to share with the group’s AI',
      qqGroupRoleName:'Name',qqGroupRoleDescription:'Description',qqGroupRoleExamples:'Example dialogue',qqGroupRoleApprove:'Approve and save for this group',
      qqGroupRoleAccountNeeded:'Save the companion’s QQ number under the manual connection settings first.',qqGroupRoleSaveSettings:'Save the group numbers and companion’s QQ connection before assigning a card.',
      qqGroupRoleGroupNeeded:'Save at least one group number above.',qqGroupRoleChooseGroup:'Choose a group',qqGroupRoleChooseCard:'Choose a card',qqGroupRoleDefault:'This group uses the default companion role.',qqGroupRoleEmpty:'No cards found. Import one in Characters.',
      qqGroupRoleLoading:'Loading character cards…',qqGroupRoleReading:'Reading public fields…',qqGroupRoleSaving:'Saving the group role…',qqGroupRoleSaved:'Role approved for this group.',qqGroupRoleCleared:'This group now uses the default role.',
      qqGroupRoleLoadFailed:'Could not load character cards. Close and reopen this section to try again.',qqGroupRoleReviewFailed:'Could not review this card. Check that the card and group still exist, then try again.',
      qqGroupRoleSaveFailed:'The role was not saved. Check the account and group, then review the current card again.',qqGroupRoleClearApplyFailed:'The default was saved but is not active. Choose Use default group role again to retry.',qqGroupRoleLive:'Saved and active for the next message in this group.',qqGroupRoleReviewChanged:'The group or card changed. Review its public fields again.',qqGroupRoleApplyFailed:'Saved but not active. Review and confirm again to retry.',qqGroupRoleNoText:'(Empty)'},
    zh:{qqExpectedAccount:'搭档的 QQ 号',qqExpectedAccountNote:'为群添加角色卡时需要此号码。留空保留已保存的号码，未保存时保持未设置。',
      qqGroupRoles:'QQ 群角色卡',qqGroupRolesNote:'这里只批准将名称、描述和对白范例交给本群 AI。卡内世界书用于 App 对话。群里要用世界书，请先保存人设，再到「高级设置 → 此群的世界书」选择并批准独立世界书。',
      qqGroupRoleGroup:'群号',qqGroupRoleCard:'从角色库选卡',qqGroupRoleReview:'查看可公开字段',qqGroupRoleClear:'恢复群默认人设',qqGroupRolePreview:'将交给本群 AI 的内容',
      qqGroupRoleName:'名称',qqGroupRoleDescription:'描述',qqGroupRoleExamples:'对白范例',qqGroupRoleApprove:'批准并保存到此群',
      qqGroupRoleAccountNeeded:'请先在手动连接设置中保存搭档的 QQ 号。',qqGroupRoleSaveSettings:'请先保存群号及搭档的 QQ 连接设置，再分配角色卡。',
      qqGroupRoleGroupNeeded:'请先在上方保存至少一个群号。',qqGroupRoleChooseGroup:'选择群号',qqGroupRoleChooseCard:'选择角色卡',qqGroupRoleDefault:'此群使用默认搭档人设。',qqGroupRoleEmpty:'角色库为空。请先到「角色」页导入卡片。',
      qqGroupRoleLoading:'正在读取角色库…',qqGroupRoleReading:'正在读取可公开字段…',qqGroupRoleSaving:'正在保存群人设…',qqGroupRoleSaved:'已批准此群使用该人设。',qqGroupRoleCleared:'此群已恢复默认人设。',
      qqGroupRoleLoadFailed:'暂时无法读取角色库。请收起并重新展开此处重试。',qqGroupRoleReviewFailed:'暂时无法查看这张卡。请检查角色卡和群是否还存在，再重试。',
      qqGroupRoleSaveFailed:'本次人设未保存。请核对账号、群号，再预览当前角色卡。',qqGroupRoleClearApplyFailed:'已保存默认人设，但尚未在本群生效。可再次点击「恢复群默认人设」重试。',qqGroupRoleLive:'已保存并在线生效，本群下一条消息将使用此卡。',qqGroupRoleReviewChanged:'群或角色卡已变更，请重新查看公开字段。',qqGroupRoleApplyFailed:'已保存，但尚未生效。请重新查看公开字段并确认，再次尝试应用。',qqGroupRoleNoText:'（空）'}
  };
  for(const lang of ['en','zh'])Object.assign(words[lang],qqGroupRoleWords[lang]);
  Object.assign(words.zh,{qqLivePolicySave:'保存在线群策略',qqLivePolicyScope:'QQ 在线。可修改已有群的图片、语音转写及主动发言权限；更改群名单或连接设置需先断开。',qqLiveGateLocked:'更改本机接话判断需先断开连接。',qqLiveProactiveScope:'主动发言开关同时作用于以下全部已选群：',qqLivePolicySaved:'群策略已保存，并已在当前连接生效。',qqLivePolicyChanged:'群名单或策略已改变。已显示最新值，请重新选择。',qqLivePolicyFailed:'未确认在线群策略已保存。请核对权限后再次保存。'});
  Object.assign(words.en,{qqLivePolicySave:'Save live group permissions',qqLivePolicyScope:'QQ is online. You can change images, voice transcription and proactive messages for saved groups. Disconnect to edit group membership or connection settings.',qqLiveGateLocked:'Disconnect to change local reply decisions.',qqLiveProactiveScope:'The proactive switch applies to all these selected groups:',qqLivePolicySaved:'Group permissions were saved and are active on this connection.',qqLivePolicyChanged:'The groups or permissions changed. Review the latest values and select again.',qqLivePolicyFailed:'The live group permissions could not be confirmed. Review them and try saving again.'});
  const roleId=/^[a-f0-9]{16}$/,qqNumber=/^[1-9]\d{4,14}$/;
  const groupRoles=$('bot-qq-group-roles'),roleGroup=$('bot-qq-group-role-group'),roleCard=$('bot-qq-group-role-card');
  let roleView=null,roleProfileName='';
  function roleOptions(select,placeholder,items,value){
    const key=JSON.stringify([placeholder,items]);
    if(select.dataset.optionsKey!==key){
      select.replaceChildren(...[['',placeholder],...items].map(([id,name])=>{const item=el('option','',name);item.value=id;return item;}));
      select.dataset.optionsKey=key;
    }
    if(select.value!==value)select.value=value;
  }
  function namedOptions(rows){
    const names=new Map();
    for(const {name} of rows)names.set(name,(names.get(name)||0)+1);
    return rows.map(({id,name})=>[id,names.get(name)>1?`${name} · ${id}`:name]);
  }
  Object.assign(words.en,{
    qqGroupLorebooks:'World book for this group',qqGroupLorebookNote:'Approve up to 10 library world books for the saved group role, one at a time. Review every entry that the group’s AI may receive.',
    qqGroupLorebookSelect:'World book from Characters',qqGroupLorebookChoose:'Choose a world book',qqGroupLorebookReview:'Review entries',qqGroupLorebookClear:'Remove approval',qqGroupLorebookCurrentSaved:'Approved world books',qqGroupLorebookPreviousRole:'Approved for an earlier role',
    qqGroupLorebookReviewTitle:'Entries to share with the group’s AI',qqGroupLorebookApprove:'Approve the whole world book for the group role',qqGroupLorebookPrevious:'Previous page',qqGroupLorebookJump:'Page',qqGroupLorebookNext:'Next page',qqGroupLorebookReviewChanged:'The world book changed or could not be read. Start a new review before approving.',qqGroupLorebookKeys:'Primary keys',qqGroupLorebookNoKeys:'No primary keys',qqGroupLorebookSecondary:'Secondary keys',qqGroupLorebookAlways:'Always eligible',
    qqGroupLorebookCurrentNone:'No world book approved for this group.',qqGroupLorebookSelectedBook:'World book',qqGroupLorebookSelectedRole:'Saved role',qqGroupLorebookRoleNeeded:'Save the group role before reviewing a world book.',
    qqGroupLorebookLoading:'Loading world books…',qqGroupLorebookReading:'Reading entries for review…',qqGroupLorebookSaving:'Saving permission…',qqGroupLorebookSaved:'World book approved for the group role.',qqGroupLorebookCleared:'World book approval removed.',
    qqGroupLorebookListFailed:'Could not load world books. Close and reopen this section to try again.',qqGroupLorebookReviewFailed:'Could not review this book for the current group role. Check the book and role, then try again.',
    qqGroupLorebookSaveFailed:'The approval was not saved. Reopen the world book review and check the current role.',qqGroupLorebookClearFailed:'The approval could not be removed. Check the saved group and try again.',qqGroupLorebookEmpty:'No standalone world books found. Import one in Characters.',qqGroupLorebookNoEnabled:'This world book has no enabled entries.',
  });
  Object.assign(words.zh,{
    qqGroupLorebooks:'此群的世界书',qqGroupLorebookNote:'可为本群已保存的角色逐本批准最多 10 本独立世界书。请核对本群 AI 可能收到的每条内容。',
    qqGroupLorebookSelect:'从角色库选择世界书',qqGroupLorebookChoose:'选择世界书',qqGroupLorebookReview:'查看条目',qqGroupLorebookClear:'撤销批准',qqGroupLorebookCurrentSaved:'已批准的世界书',qqGroupLorebookPreviousRole:'为旧角色批准',
    qqGroupLorebookReviewTitle:'将交给本群 AI 的世界书条目',qqGroupLorebookApprove:'批准此群角色使用整本世界书',qqGroupLorebookPrevious:'上一页',qqGroupLorebookJump:'页码',qqGroupLorebookNext:'下一页',qqGroupLorebookReviewChanged:'世界书已变化或无法读取。请重新查看条目后再批准。',qqGroupLorebookKeys:'主关键词',qqGroupLorebookNoKeys:'没有主关键词',qqGroupLorebookSecondary:'次关键词',qqGroupLorebookAlways:'始终可参与匹配',
    qqGroupLorebookCurrentNone:'此群尚未批准世界书。',qqGroupLorebookSelectedBook:'世界书',qqGroupLorebookSelectedRole:'已保存的角色',qqGroupLorebookRoleNeeded:'请先保存本群角色，再查看世界书。',
    qqGroupLorebookLoading:'正在读取世界书列表…',qqGroupLorebookReading:'正在读取待核对条目…',qqGroupLorebookSaving:'正在保存权限…',qqGroupLorebookSaved:'已批准此群角色使用该世界书。',qqGroupLorebookCleared:'已撤销本群的世界书批准。',
    qqGroupLorebookListFailed:'暂时无法读取世界书。请收起并重新展开此处重试。',qqGroupLorebookReviewFailed:'无法为当前群角色查看这本书。请核对后重试。',
    qqGroupLorebookSaveFailed:'批准未保存。请重新打开世界书预览，核对当前角色。',qqGroupLorebookClearFailed:'未能撤销批准。请核对已保存的群，再重试。',qqGroupLorebookEmpty:'还没有独立世界书。请先到「角色」页导入。',qqGroupLorebookNoEnabled:'这本世界书没有启用的条目。',
  });
  const bookForm=$('bot-qq-group-lorebooks'),bookSelect=$('bot-qq-group-lorebook-book'),bookPage=$('bot-qq-group-lorebook-page');
  let bookView=null,shownBookPreview=null,shownBookLanguage='';
  function groupLorebookSupported(){
    const api=window.arcade;
    return state?.channel==='qq'&&['lorebooksList','groupLorebookPreview','groupLorebookSet'].every(method=>typeof api?.[method]==='function');
  }
  function effectiveGroupRole(groups,groupId){
    const binding=(groups.roles||[]).find(row=>row.groupId===groupId);
    return {id:binding?`card-${binding.cardId}`:state?.social?.config?.characterId||'',name:binding?.name||''};
  }
  // null is the existing offline contract. An empty string leaves live controls locked.
  function groupEditRevision(groups,groupId,roleId){
    if(state?.status==='disconnected')return null;
    if(state?.status!=='connected'||groups.reviewRequiredGroupIds?.includes(groupId))return '';
    const revision=groupGenerationRow(groups,groupId,roleId)?.settingsRevision;
    return typeof revision==='string'?revision:'';
  }
  Object.assign(words.zh,{
    qqGroupLiveUnverified:'当前连接未核实这个群和角色，设置暂时只读。',
    qqGroupLiveStale:'群设置已变化。草稿未生效，请先核对最新的已存参数。',
    qqGroupLiveReload:'放弃草稿并读取已保存的参数',
    qqGroupLiveWriteFailed:'本次操作未生效。请重新核对当前搭档、群和角色后再试。'
  });
  Object.assign(words.en,{
    qqGroupLiveUnverified:'The current connection has not verified this group and role. Settings are read-only.',
    qqGroupLiveStale:'Group settings changed. Your draft has not been applied. Review the latest saved values.',
    qqGroupLiveReload:'Discard draft and load saved values',
    qqGroupLiveWriteFailed:'This change did not take effect. Review the current companion, group and role and try again.'
  });
  function showBookPreview(preview,locked=false){
    $('bot-qq-group-lorebook-preview').hidden=!preview;
    $('bot-qq-group-lorebook-pages').hidden=!preview||preview.pageCount<2;
    $('bot-qq-group-lorebook-prev').disabled=locked||!preview||preview.page===0;
    $('bot-qq-group-lorebook-next').disabled=locked||!preview||preview.page+1>=preview.pageCount;
    bookPage.disabled=locked;
    const pageCount=preview?.pageCount||0;
    if(bookPage.options.length!==pageCount){
      bookPage.replaceChildren(...Array.from({length:pageCount},(_,index)=>{
        const option=el('option','',String(index+1));option.value=String(index);return option;
      }));
    }
    if(preview&&bookPage.value!==String(preview.page))bookPage.value=String(preview.page);
    if(shownBookPreview===preview&&shownBookLanguage===language)return;
    shownBookPreview=preview;shownBookLanguage=language;
    const zh=language==='zh';
    $('bot-qq-group-lorebook-page-state').textContent=preview?
      (zh?`第 ${preview.page+1} / ${preview.pageCount} 页 · 共 ${preview.enabledEntries} 条启用条目`:`Page ${preview.page+1} of ${preview.pageCount} · ${preview.enabledEntries} enabled entries`):'';
    const profile=preview?.expectedRevision&&roleProfileName?roleProfileName+' · ':'';
    $('bot-qq-group-lorebook-preview-scope').textContent=preview?profile+(zh?`搭档 QQ ${state.qq.expectedAccountId} · 群 ${preview.groupId}`:`Companion QQ ${state.qq.expectedAccountId} · group ${preview.groupId}`):'';
    $('bot-qq-group-lorebook-preview-book').textContent=preview?`${word('qqGroupLorebookSelectedBook')} · ${preview.name}`:'';
    $('bot-qq-group-lorebook-preview-role').textContent=preview?`${word('qqGroupLorebookSelectedRole')} · ${preview.roleName}`:'';
    const rows=(preview?.review||[]).map(entry=>{
      const row=el('section'),label=el('h4','',entry.keys.length?word('qqGroupLorebookKeys'):word('qqGroupLorebookNoKeys'));
      const content=el('p','',entry.content||word('qqGroupRoleNoText'));content.style.whiteSpace='pre-wrap';
      row.append(label);
      if(entry.keys.length)row.append(el('p','',entry.keys.join(zh?'、':', ')));
      if(entry.secondaryKeys.length)row.append(el('h4','',word('qqGroupLorebookSecondary')),el('p','',entry.secondaryKeys.join(zh?'、':', ')));
      if(entry.constant)row.append(el('small','',word('qqGroupLorebookAlways')));
      row.append(content);
      return row;
    });
    $('bot-qq-group-lorebook-entries').replaceChildren(...(preview&&!rows.length?[el('p','',word('qqGroupLorebookNoEnabled'))]:rows));
  }
  function showApprovedBooks(rows,role,locked,revision){
    const list=$('bot-qq-group-lorebook-approved'),status=$('bot-qq-group-lorebook-current');
    status.textContent=word(rows.length?'qqGroupLorebookCurrentSaved':'qqGroupLorebookCurrentNone');
    list.hidden=rows.length===0;
    const key=JSON.stringify([language,rows,role.id,locked,revision]);
    if(list.dataset.rowsKey===key)return;
    list.dataset.rowsKey=key;
    const labels=namedOptions(rows.map(row=>({id:row.bookId,name:row.name})));
    list.replaceChildren(...rows.map((row,index)=>{
      const item=el('li'),label=labels[index][1],actions=el('div','qq-actions');
      item.append(el('span','',label));
      if(row.roleId!==role.id)item.append(el('small','',`${word('qqGroupLorebookPreviousRole')} · ${row.roleId}`));
      const remove=el('button','secondary',word('qqGroupLorebookClear'));
      remove.type='button';remove.disabled=locked||(revision!==null&&row.roleId!==role.id);remove.dataset.bookId=row.bookId;remove.dataset.roleId=row.roleId;
      remove.setAttribute('aria-label',`${word('qqGroupLorebookClear')} · ${label}`);
      remove.onclick=()=>requestBook('save',row,0,revision);
      actions.append(remove);item.append(actions);
      return item;
    }));
  }
  function renderQQGroupLorebook(config=state?.qq?.groups||{}){
    const groupId=roleView?.groupId,enabled=groupLorebookSupported()&&!!groupId&&(config.groupIds||[]).includes(groupId)&&!$('bot-qq-group-role-controls').hidden;
    bookForm.hidden=!enabled;
    if(!enabled||!bookForm.open){bookView=null;showBookPreview(null);return;}
    const role=effectiveGroupRole(config,groupId);
    const revision=groupEditRevision(config,groupId,role.id);
    const scope=JSON.stringify([roleView.scope,groupId,role.id,role.name,state.status]);
    if(bookView?.scope!==scope)bookView={scope,groupId,role,revision,bookId:'',books:null,preview:null,operation:null,feedback:''};
    const view=bookView;
    if(view.revision!==revision){
      const reviewing=view.preview||['preview','page'].includes(view.operation?.action);
      if(reviewing){view.preview=null;view.operation=null;view.feedback='qqGroupLorebookReviewChanged';}
      view.revision=revision;
    }
    const pending=view.operation?.action,locked=revision===''||roleView.operation?.action==='save'||generationSaving();
    const saved=(config.lorebooks||[]).filter(row=>row.groupId===groupId);
    const books=view.books||[];
    roleOptions(bookSelect,word('qqGroupLorebookChoose'),namedOptions(books),view.bookId);
    bookSelect.disabled=locked||!role.id||!books.length||pending==='save';
    $('bot-qq-group-lorebook-review').disabled=bookSelect.disabled||!view.bookId||!!pending;
    $('bot-qq-group-lorebook-approve').disabled=locked||!!pending||!view.preview;
    showApprovedBooks(saved,role,locked||pending==='save',view.revision);
    showBookPreview(view.preview,locked||!!pending);
    const feedback=pending==='list'?'qqGroupLorebookLoading':pending==='preview'||pending==='page'?'qqGroupLorebookReading':pending==='save'?'qqGroupLorebookSaving':view.feedback||(!role.id?'qqGroupLorebookRoleNeeded':!locked&&view.books&&!books.length?'qqGroupLorebookEmpty':'');
    $('bot-qq-group-lorebook-feedback').textContent=revision===''?word('qqGroupLiveUnverified'):feedback?word(feedback):'';
    if(!locked&&role.id&&!view.books&&!pending&&!view.feedback)void requestBook('list');
  }
  function validBookPreview(book,input,role,page){
    return book?.groupId===input.groupId&&book.bookId===input.bookId&&book.roleId===role.id&&
      typeof book.roleName==='string'&&!!book.roleName&&(!role.name||book.roleName===role.name)&&
      typeof book.name==='string'&&typeof book.approval==='string'&&!!book.approval&&book.page===page&&
      Number.isSafeInteger(book.enabledEntries)&&book.enabledEntries>=0&&book.enabledEntries<=500&&
      book.pageCount===Math.max(1,Math.ceil(book.enabledEntries/10))&&book.pageCount>page&&
      Array.isArray(book.review)&&book.review.length===Math.min(10,book.enabledEntries-page*10)&&
      book.review.every(row=>row&&[row.keys,row.secondaryKeys].every(keys=>Array.isArray(keys)&&keys.every(key=>typeof key==='string'))&&
        typeof row.constant==='boolean'&&typeof row.content==='string');
  }
  async function requestBook(action,revoke=null,page=0,removeRevision){
    const view=bookView;
    if(!view||!groupRoles.open||!bookForm.open||roleView?.operation?.action==='save'||view.operation?.action==='save'||generationSaving())return;
    const revision=groupEditRevision(state.qq.groups,view.groupId,view.role.id);
    if(revision===''||view.revision!==revision||revoke&&(removeRevision!==revision||revision!==null&&revoke.roleId!==view.role.id))return;
    if(!revoke&&(!view.role.id||(action==='save'&&!view.preview)))return;
    if(revoke&&revoke.groupId!==view.groupId)return;
    const input={...credentialContext,expectedAccountId:state.qq.expectedAccountId,groupId:view.groupId,bookId:revoke?.bookId||view.bookId};
    const oldPreview=view.preview;
    if(revision!==null){
      if((action==='page'||action==='save'&&!revoke)&&oldPreview?.expectedRevision!==revision)return;
      input.roleId=view.role.id;input.expectedRevision=revision;
    }
    if(action==='page'&&(!oldPreview||page<0||page>=oldPreview.pageCount||page===oldPreview.page))return;
    const approval=revoke?null:oldPreview?.approval,bindingRole=revoke?.roleId||view.role.id;
    const op={action};view.operation=op;view.feedback='';
    if(action!=='page')view.preview=null;
    const current=()=>groupRoles.open&&bookForm.open&&bookView===view&&view.operation===op;
    renderQQGroupRoles();
    try{
      if(action==='list'){
        const books=await window.arcade.lorebooksList();
        if(current())view.books=books.filter(book=>book&&roleId.test(book.id)&&typeof book.name==='string').map(({id,name})=>({id,name}));
      }else if(action==='preview'||action==='page'){
        const book=await window.arcade.groupLorebookPreview({...input,page});
        if(!current())return;
        if(!validBookPreview(book,input,view.role,page)||(revision!==null&&book.expectedRevision!==revision)||(oldPreview&&action==='page'&&
          (book.approval!==oldPreview.approval||book.pageCount!==oldPreview.pageCount||book.enabledEntries!==oldPreview.enabledEntries)))throw Error('World book review changed');
        view.preview=book;
      }else{
        const result=await window.arcade.groupLorebookSet({...input,roleId:bindingRole,approval});
        if(!current())return;
        const rows=result?.qq?.groups?.lorebooks;
        const saved=Array.isArray(rows)&&rows.some(row=>row.groupId===input.groupId&&row.bookId===input.bookId&&row.roleId===bindingRole);
        if(!Array.isArray(rows)||result.qq.expectedAccountId!==input.expectedAccountId||saved===!!revoke)throw Error('World book save not confirmed');
        view.feedback=revoke?'qqGroupLorebookCleared':'qqGroupLorebookSaved';
      }
    }catch{
      if(current()){
        if(action==='page')view.preview=null;
        view.feedback=action==='list'?'qqGroupLorebookListFailed':action==='page'?'qqGroupLorebookReviewChanged':action==='preview'?'qqGroupLorebookReviewFailed':revision!==null?'qqGroupLiveWriteFailed':revoke?'qqGroupLorebookClearFailed':'qqGroupLorebookSaveFailed';
      }
    }finally{
      if(current()){view.operation=null;renderQQGroupRoles();}
    }
  }
  bookForm.addEventListener('toggle',renderQQGroupRoles);
  bookSelect.addEventListener('change',()=>{
    if(!bookView)return;
    bookView.bookId=bookSelect.value;
    if(['preview','page'].includes(bookView.operation?.action))bookView.operation=null;
    bookView.preview=null;bookView.feedback='';renderQQGroupRoles();
  });
  $('bot-qq-group-lorebook-review').onclick=()=>requestBook('preview');
  $('bot-qq-group-lorebook-approve').onclick=()=>requestBook('save');
  $('bot-qq-group-lorebook-prev').onclick=()=>requestBook('page',null,bookView?.preview?.page-1);
  $('bot-qq-group-lorebook-next').onclick=()=>requestBook('page',null,bookView?.preview?.page+1);
  bookPage.onchange=()=>requestBook('page',null,Number(bookPage.value));
  Object.assign(words.en,{
    qqGroupGeneration:'Group reply generation',qqGroupGenerationTemperature:'Temperature (0–2)',qqGroupGenerationTopP:'Top-P (0–1)',qqGroupGenerationMaxTokens:'Reply token cap (64–8192)',
    qqGroupGenerationDefault:'Leave a field blank to use its default. The changes apply only to replies by this group role.',
    qqGroupGenerationCopy:'Copy App preset values to draft',qqGroupGenerationSave:'Save reply parameters',qqGroupGenerationReset:'Restore reply defaults',
    qqGroupGenerationUnavailable:'Reply settings are unavailable for this saved group role.',qqGroupGenerationEffective:'Effective reply settings',qqGroupGenerationIgnored:'Ignored by the current backend',
    qqGroupGenerationProviderDefault:'Provider default',
    qqGroupGenerationCopying:'Reading App preset values…',qqGroupGenerationCopied:'Preset numbers copied to the draft. Save to apply them to the group role.',
    qqGroupGenerationSaving:'Saving reply settings…',qqGroupGenerationSaved:'Reply settings saved for this group role.',qqGroupGenerationRestored:'Reply defaults restored for this group role.',
    qqGroupGenerationCopyFailed:'Could not copy preset numbers for this group role. Check the current group and try again.',
    qqGroupGenerationSaveFailed:'Reply settings could not be saved. Check the current group and try again.',qqGroupGenerationInvalid:'Enter a value in the shown range or leave this field blank.',
  });
  Object.assign(words.zh,{
    qqGroupGeneration:'群回复生成参数',qqGroupGenerationTemperature:'温度（0–2）',qqGroupGenerationTopP:'Top-P（0–1）',qqGroupGenerationMaxTokens:'回复 token 上限（64–8192）',
    qqGroupGenerationDefault:'留空使用默认值。修改仅用于此群中该角色的回复。',
    qqGroupGenerationCopy:'将 App 预设数值复制到草稿',qqGroupGenerationSave:'保存回复参数',qqGroupGenerationReset:'恢复回复默认值',
    qqGroupGenerationUnavailable:'暂时无法读取此群角色的回复参数。',qqGroupGenerationEffective:'已生效的回复参数',qqGroupGenerationIgnored:'当前后端忽略的参数',
    qqGroupGenerationProviderDefault:'服务默认',
    qqGroupGenerationCopying:'正在读取 App 预设数值…',qqGroupGenerationCopied:'已将预设数值复制到草稿。点击保存后才会应用到此群角色。',
    qqGroupGenerationSaving:'正在保存回复参数…',qqGroupGenerationSaved:'已保存此群角色的回复参数。',qqGroupGenerationRestored:'已恢复此群角色的回复默认值。',
    qqGroupGenerationCopyFailed:'未能为此群角色复制预设数值。请核对当前群后重试。',
    qqGroupGenerationSaveFailed:'未能保存回复参数。请核对当前群后重试。',qqGroupGenerationInvalid:'请输入标注范围内的数值，或将此项留空。',
  });
  const generationForm=$('bot-qq-group-generation'),generationControls=$('bot-qq-group-generation-controls');
  const generationFields=[
    {key:'temperature',label:'Temperature',zh:'温度'},
    {key:'topP',label:'Top-P',zh:'Top-P'},
    {key:'maxTokens',label:'Reply token cap',zh:'回复 token 上限'},
  ].map(field=>({...field,input:$('bot-qq-group-generation-'+field.key)}));
  const generationButton=action=>$('bot-qq-group-generation-'+action);
  let generationView=null;
  function groupGenerationRow(groups,groupId,roleId){
    return groups?.generation?.find(row=>row.groupId===groupId&&row.roleId===roleId);
  }
  function generationValues(sampling){
    return generationFields.map(({key})=>sampling?.[key]??null);
  }
  function fillGroupGeneration(sampling){
    for(const {key,input} of generationFields){
      input.value=sampling?.[key]??'';
      input.removeAttribute('aria-invalid');
    }
  }
  function generationSaving(){
    return generationView?.operation?.action==='save'||generationView?.operation?.action==='reset';
  }
  function renderQQGroupGeneration(config){
    const groupId=roleView?.groupId,enabled=!!groupId&&!$('bot-qq-group-role-controls').hidden&&
      typeof window.arcade?.groupGenerationPreset==='function'&&typeof window.arcade?.groupGenerationSet==='function';
    generationForm.hidden=!enabled;
    if(!enabled||!generationForm.open){generationView=null;return;}
    const role=effectiveGroupRole(config,groupId),row=groupGenerationRow(config,groupId,role.id);
    const accountId=state.qq.expectedAccountId,zh=language==='zh';
    const scope=zh?`搭档 QQ ${accountId} · 群 ${groupId}`:`Companion QQ ${accountId} · group ${groupId}`;
    const profile=row?.settingsRevision&&roleProfileName?roleProfileName+' · ':'';
    $('bot-qq-group-generation-scope').textContent=row?`${profile}${scope} · ${row.roleName}`:scope;
    generationControls.hidden=!row;
    const feedback=$('bot-qq-group-generation-feedback');
    generationButton('reload').hidden=true;
    if(!row){generationView=null;feedback.textContent=word('qqGroupGenerationUnavailable');return;}
    const revision=groupEditRevision(config,groupId,role.id);
    const nextScope=JSON.stringify([roleView.scope,groupId,role.id,state.status]),savedKey=JSON.stringify(generationValues(row.sampling));
    if(generationView?.scope!==nextScope){
      generationView={scope:nextScope,groupId,roleId:role.id,savedKey,revision,dirty:false,operation:null,feedback:''};
      fillGroupGeneration(row.sampling);
    }
    const view=generationView,pending=view.operation?.action;
    if(!view.dirty&&savedKey!==view.savedKey){view.savedKey=savedKey;fillGroupGeneration(row.sampling);}
    if(!view.dirty&&!pending)view.revision=revision;
    const stale=view.revision!==revision;
    generationButton('reload').hidden=!stale||!revision||!!pending;
    const locked=revision===''||stale||roleView.operation?.action==='save'||bookView?.operation?.action==='save'||!!pending;
    for(const {input} of generationFields)input.disabled=locked;
    for(const action of ['copy','save','reset'])generationButton(action).disabled=locked;
    const label=field=>zh?field.zh:field.label;
    const ignored=generationFields.filter(field=>row.unsupported?.includes(field.key));
    const effective=generationFields.filter(field=>!row.unsupported?.includes(field.key))
      .map(field=>`${label(field)} ${row.effective?.[field.key]??word('qqGroupGenerationProviderDefault')}`);
    $('bot-qq-group-generation-effective').textContent=[word('qqGroupGenerationEffective'),...effective].join(' · ');
    const unsupported=$('bot-qq-group-generation-unsupported');
    unsupported.hidden=!ignored.length;
    unsupported.textContent=ignored.length?[word('qqGroupGenerationIgnored'),...ignored.map(label)].join(' · '):'';
    const message=pending?(pending==='copy'?'qqGroupGenerationCopying':'qqGroupGenerationSaving'):
      revision===''?'qqGroupLiveUnverified':stale?'qqGroupLiveStale':view.feedback;
    feedback.textContent=message?word(message):'';
  }
  async function requestGroupGeneration(action){
    const view=generationView;
    if(!view||view.operation||!groupRoles.open||!generationForm.open||
      roleView?.operation?.action==='save'||bookView?.operation?.action==='save')return;
    const input={...credentialContext,expectedAccountId:state.qq.expectedAccountId,groupId:view.groupId,roleId:view.roleId};
    const revision=groupEditRevision(state.qq.groups,view.groupId,view.roleId);
    if(revision===''||revision!==view.revision)return;
    if(revision!==null)input.expectedRevision=revision;
    let sampling=null;
    if(action==='save'){
      sampling={};
      for(const {key,input:field} of generationFields){
        if(!field.validity.valid){
          view.feedback='qqGroupGenerationInvalid';field.setAttribute('aria-invalid','true');field.focus();
          renderQQGroupRoles();return;
        }
        if(field.value!=='')sampling[key]=field.valueAsNumber;
      }
    }
    const operation={action};view.operation=operation;view.feedback='';
    const current=()=>generationForm.open&&groupRoles.open&&generationView===view&&view.operation===operation;
    renderQQGroupRoles();
    try{
      if(action==='copy'){
        const result=await window.arcade.groupGenerationPreset(input);
        if(!current())return;
        if(result?.groupId!==input.groupId||result.roleId!==input.roleId||!result.sampling||
           groupEditRevision(state.qq.groups,view.groupId,view.roleId)!==revision)throw Error('Group preset scope changed');
        fillGroupGeneration(result.sampling);view.dirty=true;view.feedback='qqGroupGenerationCopied';
      }else{
        const state=await window.arcade.groupGenerationSet({...input,sampling});
        if(!current())return;
        const saved=groupGenerationRow(state?.qq?.groups,input.groupId,input.roleId);
        const values=JSON.stringify(generationValues(sampling));
        if(!saved||state.qq.expectedAccountId!==input.expectedAccountId||JSON.stringify(generationValues(saved.sampling))!==values)throw Error('Group reply settings save not confirmed');
        fillGroupGeneration(saved.sampling);view.savedKey=values;view.dirty=false;view.revision=revision===null?null:saved.settingsRevision;
        view.feedback=action==='reset'?'qqGroupGenerationRestored':'qqGroupGenerationSaved';
      }
    }catch{
      if(current())view.feedback=action==='copy'?'qqGroupGenerationCopyFailed':revision!==null?'qqGroupLiveWriteFailed':'qqGroupGenerationSaveFailed';
    }finally{
      if(current()){view.operation=null;renderQQGroupRoles();}
    }
  }
  generationForm.addEventListener('toggle',renderQQGroupRoles);
  generationButton('reload').onclick=()=>{
    if(generationButton('reload').hidden||generationView?.operation)return;
    generationView=null;renderQQGroupRoles();
  };
  for(const {input} of generationFields)input.addEventListener('input',()=>{
    if(!generationView)return;
    generationView.dirty=true;generationView.feedback='';
    input.removeAttribute('aria-invalid');renderQQGroupRoles();
  });
  for(const action of ['copy','save','reset'])generationButton(action).onclick=()=>requestGroupGeneration(action);
  const hotGroupCards=()=>typeof window.arcade?.groupCardPreview==='function'&&typeof window.arcade?.groupCardApply==='function';
  const dailyRoleDialog=()=>groupRoles.closest('#qq-daily-group-settings');
  function dailyRoleOptions(cards){
    const byName=new Map();
    for(const card of cards){
      if(!byName.has(card.name))byName.set(card.name,[]);
      byName.get(card.name).push(card);
    }
    return cards.map(card=>{
      const peers=byName.get(card.name);
      if(peers.length===1)return [card.id,card.name];
      const label=card.creator?card.name+' · '+card.creator:card.name;
      const sameAuthor=peers.filter(peer=>peer.creator===card.creator);
      if(sameAuthor.length===1)return [card.id,label];
      const tag=card.tags.find(tag=>sameAuthor.every(peer=>peer===card||!peer.tags.includes(tag)));
      return [card.id,label+' · '+(tag||'#'+(sameAuthor.indexOf(card)+1))];
    });
  }
  const roleEditable=()=>state?.status==='disconnected'||state?.status==='connected'&&hotGroupCards();
  function renderQQGroupRoles(){
    const api=window.arcade,config=state?.qq?.groups||{},accountId=state?.qq?.expectedAccountId||'',groupIds=(config.groupIds||[]).filter(id=>qqNumber.test(id));
    const enabled=state?.channel==='qq'&&typeof api?.groupRolePreview==='function'&&typeof api?.groupRoleSet==='function'&&typeof api?.charactersList==='function';
    const zh=language==='zh',alert=$('bot-qq-group-role-alert');
    const needingReview=(enabled?config.reviewRequiredGroupIds||[]:[]).filter(id=>groupIds.includes(id)).join(zh?'、':', ');
    const warning=needingReview?(zh?`以下群的角色卡需要重新批准，当前未启用这些群的回复：${needingReview}。请选择群并重新查看角色卡。`:`Replies are paused for groups whose cards need review: ${needingReview}. Choose the group and review its card.`):'';
    alert.hidden=!warning;
    if(alert.textContent!==warning)alert.textContent=warning;
    const bookAlert=$('bot-qq-group-lorebook-alert');
    const reviewBooks=(groupLorebookSupported()?config.lorebookReviewRequiredGroupIds||[]:[]).filter(id=>groupIds.includes(id)).join(zh?'、':', ');
    const bookReviewNote=state?.status==='disconnected'||config.generation?.some(row=>row.settingsRevision)
      ?(zh?'请打开此群的世界书设置核对。':'Open the group’s world book settings to review.')
      :(zh?'连接身份尚待核实，请断开连接后核对。':'Disconnect to review while the connection is unverified.');
    const bookWarning=reviewBooks?(zh?`以下群的世界书需要重新批准：${reviewBooks}。${bookReviewNote}`:`World books need review in these groups: ${reviewBooks}. ${bookReviewNote}`):'';
    bookAlert.hidden=!bookWarning;
    if(bookAlert.textContent!==bookWarning)bookAlert.textContent=bookWarning;
    groupRoles.hidden=!enabled;
    if(!enabled||!groupRoles.open){
      roleView=null;renderQQGroupLorebook(config);renderQQGroupGeneration(config);
      window.ArcadeGroupWiki?.render(null,language);window.ArcadeGroupReflection?.render(null,language);
      window.ArcadeGroupOutputFormat?.render(null,language);window.ArcadeGroupSpeakerDispatch?.render(null,language);return;
    }
    const dirty=qqGroupsDirty||qqGroupsSaving||connectionDrafts.has('bot-qq-expected-account');
    const locked=!roleEditable(),available=qqNumber.test(accountId)&&groupIds.length>0&&!dirty;
    const daily=dailyRoleDialog();
    const scope=JSON.stringify([credentialContext.profileId,credentialContext.expectedMode,credentialContext.expectedChannel,accountId,dirty,!!daily]);
    if(roleView?.scope!==scope||roleView.groupId&&!groupIds.includes(roleView.groupId))roleView={scope,groupId:groupIds.length===1?groupIds[0]:'',cardId:'',cards:null,preview:null,operation:null,feedback:''};
    const view=roleView,pending=view.operation?.action;
    const accountScope=(roleProfileName?roleProfileName+' · ':'')+(zh?`搭档 QQ ${accountId}`:`Companion QQ ${accountId}`);
    $('bot-qq-group-role-binding').textContent=dirty?word('qqGroupRoleSaveSettings'):!qqNumber.test(accountId)?word('qqGroupRoleAccountNeeded'):!groupIds.length?word('qqGroupRoleGroupNeeded'):
      accountScope+(state.status==='connected'&&!locked?(zh?' · 在线，可直接更换本群人设':' · Online; changes take effect on this connection'):locked?(zh?' · 当前暂不能编辑':' · Changes temporarily unavailable'):'');
    $('bot-qq-group-role-controls').hidden=!available;
    renderQQGroupLorebook(config);
    renderQQGroupGeneration(config);
    const groupRole=config.generation?.find(row=>row.groupId===view.groupId);
    const groupContext=available&&view.groupId?{
      ...credentialContext,expectedAccountId:accountId,groupId:view.groupId,
      roleId:groupRole?.roleId||'',roleName:groupRole?.roleName||'',status:state.status,
      roleUpdating:pending==='save',
    }:null;
    window.ArcadeGroupWiki?.render(groupContext,language);
    window.ArcadeGroupReflection?.render(groupContext,language);
    window.ArcadeGroupOutputFormat?.render(groupContext,language);
    window.ArcadeGroupSpeakerDispatch?.render(groupContext,language);
    if(!available)return;
    let saved=(config.roles||[]).find(row=>row.groupId===view.groupId);
    const observed=JSON.stringify([saved?.cardId,saved?.approval,config.reviewRequiredGroupIds?.includes(view.groupId)===true]);
    if(view.confirmed){
      if(view.confirmed.observed===observed)saved=view.confirmed.card;
      else view.confirmed=null;
    }
    if(view.preview&&view.reviewedBinding!==observed){view.preview=null;view.feedback='qqGroupRoleReviewChanged';}
    roleOptions(roleGroup,word('qqGroupRoleChooseGroup'),groupIds.map(id=>[id,id]),view.groupId);
    const cards=view.cards||[],detailSaving=bookView?.operation?.action==='save'||generationSaving();
    roleOptions(roleCard,word('qqGroupRoleChooseCard'),daily?dailyRoleOptions(cards):namedOptions(cards),view.cardId);
    roleGroup.disabled=pending==='save'||detailSaving;
    roleCard.disabled=locked||!view.groupId||!cards.length||pending==='save'||detailSaving;
    const review=$('bot-qq-group-role-review');
    review.disabled=roleCard.disabled||!view.cardId||!!pending;
    // Daily settings preview the selection immediately. Retain the existing
    // read-only review button when a fresh preview is needed for a retry.
    const retryReview=['qqGroupRoleReviewFailed','qqGroupRoleReviewChanged','qqGroupRoleSaveFailed','qqGroupRoleApplyFailed'].includes(view.feedback);
    review.hidden=!!daily&&!(view.cardId&&retryReview);
    const needsReview=config.reviewRequiredGroupIds?.includes(view.groupId);
    $('bot-qq-group-role-clear').disabled=locked||(!saved&&!view.retryClear&&!needsReview)||pending==='save'||detailSaving;
    $('bot-qq-group-role-current').textContent=!view.groupId?'':!view.confirmed&&config.reviewRequiredGroupIds?.includes(view.groupId)?(zh?'原角色卡待复核，群回复已暂停。':'The previous card needs review. Group replies are paused.'):saved?(zh?`已批准：${saved.name}`:`Approved: ${saved.name}`):word('qqGroupRoleDefault')+(hotGroupCards()&&state.social?.config?.name?' · '+state.social.config.name:'');
    const preview=view.preview;
    $('bot-qq-group-role-preview').hidden=!preview;
    if(preview){
      $('bot-qq-group-role-preview-scope').textContent=zh?`${accountScope} · 群 ${view.groupId}`:`${accountScope} · group ${view.groupId}`;
      for(const key of ['name','description','examples'])$('bot-qq-group-role-preview-'+key).textContent=preview[key]||word('qqGroupRoleNoText');
    }else{
      for(const key of ['scope','name','description','examples'])$('bot-qq-group-role-preview-'+key).textContent='';
    }
    $('bot-qq-group-role-approve').disabled=locked||!!pending||!preview||detailSaving;
    const feedback=pending==='list'?'qqGroupRoleLoading':pending==='preview'?'qqGroupRoleReading':pending==='save'?'qqGroupRoleSaving':view.feedback||(!locked&&view.cards&&!cards.length?'qqGroupRoleEmpty':'');
    $('bot-qq-group-role-feedback').textContent=feedback?word(feedback)+(view.feedbackScope&&!pending?' · '+view.feedbackScope:''):'';
    if(!locked&&!view.cards&&!pending&&!view.feedback)void requestRole('list');
  }
  async function requestRole(action,clear=false){
    const view=roleView;
    if(!view||view.operation||!roleEditable()||!groupRoles.open||bookView?.operation?.action==='save'||generationSaving())return;
    const input={...credentialContext,expectedAccountId:state.qq.expectedAccountId,groupId:view.groupId,cardId:view.cardId};
    const reviewed=view.preview,approval=reviewed?.approval,hot=hotGroupCards()&&!clear;
    if(action==='save'&&!clear&&(!approval||hot&&!reviewed.reviewToken))return;
    const destination={profileId:input.profileId,expectedAccountId:input.expectedAccountId,groupId:input.groupId,cardId:input.cardId};
    const binding=()=>{const config=state.qq.groups,role=config.roles?.find(row=>row.groupId===input.groupId);return JSON.stringify([role?.cardId,role?.approval,config.reviewRequiredGroupIds?.includes(input.groupId)===true]);};
    const observed=binding();
    const dialog=dailyRoleDialog(),op={action};view.operation=op;view.preview=null;view.feedback='';view.feedbackScope='';
    const current=()=>groupRoles.open&&dailyRoleDialog()===dialog&&roleView===view&&view.operation===op;
    renderQQGroupRoles();
    try{
      if(action==='list'){
        const cards=await window.arcade.charactersList();
        if(current())view.cards=cards.filter(card=>roleId.test(card.id)&&typeof card.name==='string')
          .map(({id,name,creator,tags})=>({id,name,creator:typeof creator==='string'?creator.trim():'',
            tags:Array.isArray(tags)?tags.filter(tag=>typeof tag==='string'&&tag.trim()):[]}));
      }else if(action==='preview'){
        const card=hot?await window.arcade.groupCardPreview(destination):await window.arcade.groupRolePreview(input);
        if(!current())return;
        if(card?.cardId!==input.cardId||!['name','description','examples','approval'].every(key=>typeof card[key]==='string')||!card.approval)throw Error('Invalid group role preview');
        if(hot&&(!card.reviewToken||card.profileId!==destination.profileId||card.groupId!==destination.groupId||card.expectedAccountId!==destination.expectedAccountId)||binding()!==observed)throw Error('Changed destination');
        view.preview=card;view.reviewedBinding=observed;
        if(dailyRoleDialog())requestAnimationFrame(()=>{
          if(roleView===view&&view.preview===card&&dailyRoleDialog())window.ArcadeQQDailySettings?.revealPreview();
        });
      }else if(hot){
        const result=await window.arcade.groupCardApply({...destination,approval,reviewToken:reviewed.reviewToken});
        if(!current())return;
        view.feedbackScope=(roleProfileName||destination.profileId)+' · QQ '+destination.expectedAccountId+' · '+destination.groupId+' · '+reviewed.name;
        if(result?.saved===true&&['connected','offline'].includes(result.state)){
          view.retryClear=false;view.confirmed={observed,card:{cardId:input.cardId,name:reviewed.name}};view.feedback=result.state==='connected'?'qqGroupRoleLive':'qqGroupRoleSaved';
        }else view.feedback=result?.state==='apply_failed'?'qqGroupRoleApplyFailed':result?.state==='changed'?'qqGroupRoleReviewChanged':'qqGroupRoleSaveFailed';
      }else{
        const expectedRole=state.qq.groups.roles?.find(row=>row.groupId===input.groupId);
        const expected=clear&&hotGroupCards()?{expectedRoleApproval:expectedRole?.approval??null}:{};
        const result=await window.arcade.groupRoleSet({...input,...expected,cardId:clear?null:input.cardId,approval:clear?null:approval});
        if(!current())return;
        if(clear&&result?.groupRoleResult?.state==='apply_failed'){
          view.retryClear=true;view.feedback='qqGroupRoleClearApplyFailed';view.feedbackScope=(roleProfileName||input.profileId)+' · QQ '+input.expectedAccountId+' · '+input.groupId;return;
        }
        view.retryClear=false;
        const roles=result?.qq?.groups?.roles;
        if(!Array.isArray(roles)||result.qq.expectedAccountId!==input.expectedAccountId||
          (roles.find(role=>role.groupId===input.groupId)?.cardId??null)!==(clear?null:input.cardId))throw Error('Group role save not confirmed');
        view.feedback=clear?'qqGroupRoleCleared':'qqGroupRoleSaved';
      }
    }catch{
      if(current())view.feedback=action==='list'?'qqGroupRoleLoadFailed':action==='preview'?'qqGroupRoleReviewFailed':'qqGroupRoleSaveFailed';
    }finally{
      if(current()){view.operation=null;renderQQGroupRoles();}
    }
  }
  groupRoles.addEventListener('toggle',renderQQGroupRoles);
  groupRoles.addEventListener('arcade-group-role-discard',()=>{roleView=null;});
  document.addEventListener('arcade-library-changed',()=>{roleView=null;bookView=null;generationView=null;renderQQGroupRoles();});
  for(const select of [roleGroup,roleCard])select.addEventListener('change',()=>{
    const value=select.value;
    if(!roleView)renderQQGroupRoles();
    if(!roleView)return;
    if(select===roleGroup){roleView.groupId=value;roleView.cardId='';}
    else roleView.cardId=value;
    if(roleView.operation?.action==='preview'||select===roleGroup&&roleView.operation?.action==='save')roleView.operation=null;
    roleView.preview=null;roleView.confirmed=null;roleView.retryClear=false;roleView.feedback=roleView.feedbackScope='';renderQQGroupRoles();
    if(select===roleCard&&value&&dailyRoleDialog())void requestRole('preview');
  });
  $('bot-qq-group-role-review').onclick=()=>requestRole('preview');
  $('bot-qq-group-role-approve').onclick=()=>requestRole('save');
  $('bot-qq-group-role-clear').onclick=()=>requestRole('save',true);
  function readQQGroupIds(){return $('bot-qq-group-ids').value.trim().split(/[\s,，]+/).filter(Boolean);}
  function validQQGroupIds(groupIds){return groupIds.length<=5&&new Set(groupIds).size===groupIds.length&&groupIds.every(id=>qqNumber.test(id));}
  function qqGroupDirectoryIdentity(){
    const qq=state?.qq,check=qq?.check,accountId=qq?.expectedAccountId;
    if(!macQQ||state?.channel!=='qq'||state.status!=='disconnected'||!credentialContext.profileId||!qqNumber.test(accountId||'')||
      check?.state!=='checked'||check.online!==true||check.accountId!==accountId||!Number.isSafeInteger(check.checkedAt)||
      $('bot-qq-expected-account').value.trim()!==accountId||$('bot-qq-url').value.trim()!==qq.url||
      $('bot-qq-owner').value.trim()!==qq.ownerId||$('bot-qq-token').value)return null;
    return {accountId,checkedAt:check.checkedAt};
  }
  function renderQQGroupDirectory(scopeChanged=false){
    const panel=$('bot-qq-group-directory'),enabled=macQQ&&typeof window.arcade.botQQSetupGroups==='function'&&state?.channel==='qq';
    panel.hidden=!enabled;
    const check=enabled?qqGroupDirectoryIdentity():null;
    const scope=check?JSON.stringify([lastCredentialScope,check,state.qq.url,state.social?.config?.characterId]):'';
    if((qqGroupDirectory?.scope||'')!==scope){
      // New bindings cannot carry over IDs staged from the old directory.
      // Manual entries remain editable in the existing form.
      const staged=qqGroupDirectory?.draftIds;
      if(!scopeChanged&&qqGroupsDirty&&staged?.size)$('bot-qq-group-ids').value=readQQGroupIds().filter(id=>!staged.has(id)).join('\n');
      qqGroupDirectory=check?{scope,check,items:[],selected:'',feedback:'',pending:false,draftIds:new Set()}:null;
    }
    if(!enabled)return;
    const view=qqGroupDirectory;
    $('bot-qq-group-directory-load').disabled=!view||view.pending||qqGroupsSaving;
    $('bot-qq-group-directory-choice').hidden=!view?.items.length;
    $('bot-qq-group-directory-add').disabled=!view?.selected||view.pending||qqGroupsSaving||readQQGroupIds().includes(view.selected);
    const status=$('bot-qq-group-directory-status'),message=word(!view?'qqGroupDirectoryVerify':view.feedback||'qqGroupDirectoryAvailable');
    if(status.textContent!==message)status.textContent=message;
    const select=$('bot-qq-group-directory-select');
    if(select.dataset.directoryScope!==scope||select.dataset.directoryLanguage!==language||select.dataset.directoryItems!==String(view?.items.length||0)){
      const options=(view?.items||[]).map(({id,name})=>[id,`${name||word('qqGroupDirectoryUnnamed')} · ${id}`]);
      roleOptions(select,word('qqGroupDirectoryChoose'),options,view?.selected||'');
      select.dataset.directoryScope=scope;
      select.dataset.directoryLanguage=language;
      select.dataset.directoryItems=String(view?.items.length||0);
    }
  }
  async function loadQQGroupDirectory(){
    renderQQGroupDirectory();
    const view=qqGroupDirectory;
    if(!view||view.pending||qqGroupsSaving)return;
    const {accountId,checkedAt}=view.check;
    const input={...credentialContext,expectedAccountId:accountId,checkedAt};
    view.pending=true;view.items=[];view.selected='';view.feedback='qqGroupDirectoryReading';renderQQGroupDirectory();
    try{
      const reply=await window.arcade.botQQSetupGroups(input);
      if(reply?.ok!==true||reply.accountId!==accountId||reply.checkedAt!==checkedAt||!Array.isArray(reply.items))throw Error('Invalid group directory');
      if(qqGroupDirectory===view){view.items=reply.items;view.feedback=reply.items.length?'qqGroupDirectoryReady':'qqGroupDirectoryEmpty';}
    }catch{
      if(qqGroupDirectory===view)view.feedback='qqGroupDirectoryFailed';
    }finally{
      view.pending=false;renderQQGroupDirectory();
    }
  }
  function addQQGroupDirectoryChoice(){
    renderQQGroupDirectory();
    const view=qqGroupDirectory,groupIds=readQQGroupIds(),id=view?.selected;
    if(!view||view.pending||qqGroupsSaving||!view.items.some(item=>item.id===id)||groupIds.includes(id))return;
    if(!validQQGroupIds([...groupIds,id])){view.feedback='qqGroupDirectoryFull';renderQQGroupDirectory();return;}
    view.draftIds.add(id);
    $('bot-qq-group-ids').value=[...groupIds,id].join('\n');
    view.feedback='qqGroupDirectoryAdded';
    markQQGroupDraft();
  }
  function markQQGroupDraft(){
    if(!qqGroupsDirty){
      qqDraftStatus=state?.status;qqPolicyPrevious=onlineGroupPolicy()?policyFields(state.qq.groups):null;
      dailyPolicyBefore=dailyPolicyGroup()!==null?savedGroupKey(state.qq.groups):null;
    }
    qqGroupsDirty=true;qqGroupsFeedback='';
    if(dailyPolicyBefore!==null){
      if(outgoingView&&mediaSaveNotices.has(outgoingView.feedback)&&!dailyMediaReady())outgoingView.feedback='';
      if(savedGroupKey(readQQSettingsDraft())===dailyPolicyBefore){
        qqGroupsDirty=false;qqPolicyPrevious=null;dailyPolicyBefore=null;
      }
    }
    $('bot-qq-group-ids').removeAttribute('aria-invalid');
    renderQQGroups(false,state?.status!=='disconnected');
  }
  const voiceSourceWords=new Map([['inline-wav','qqGroupVoiceWAV'],['qq-ptt','qqGroupVoicePTT'],['unavailable','qqGroupVoiceUnavailable']]);
  function renderQQGroupOptions(locked,voiceSources,gateAccountReady,livePolicy){
    const groupIds=readQQGroupIds(),choices=validQQGroupIds(groupIds)?groupIds:[];
    const disabled=!$('bot-qq-groups-enabled').checked;
    const daily=dailyPolicyGroup();
    for(const {id,key,selected} of qqGroupOptions){
      const isVoice=key==='voiceGroupIds';
      const isGate=key==='localGateGroupIds';
      const oneGroup=daily!==null&&!isGate;
      const visible=oneGroup?choices.filter(id=>id===daily):choices;
      const optionsKey=JSON.stringify([language,oneGroup,visible]);
      for(const groupId of selected)if(!groupIds.includes(groupId))selected.delete(groupId);
      const list=$(id+'-list');
      if(list.dataset.optionsKey!==optionsKey){
        list.replaceChildren(...visible.map(groupId=>{
          const label=el('label','qq-group-toggle'),input=el('input');
          input.type='checkbox';input.value=groupId;
          input.addEventListener('change',()=>{
            if(input.checked)selected.add(groupId);else selected.delete(groupId);
            markQQGroupDraft();
          });
          const labelText=oneGroup?(isVoice?(language==='zh'?'在本机转写本群语音':'Transcribe voice in this group locally'):
            (language==='zh'?'让 AI 看本群群友发来的图片':'Let the AI see images posted in this group')):`${word('qqGroupMediaGroup')} ${groupId}`;
          label.append(input,el('span','',labelText));
          if(!isVoice)return label;
          const row=el('div'),source=el('small','qq-group-voice-source');
          source.id=`bot-qq-group-voice-source-${groupId}`;
          source.setAttribute('role','status');source.hidden=true;
          input.setAttribute('aria-describedby',source.id);
          row.append(label,source);
          return row;
        }));
        list.dataset.optionsKey=optionsKey;
      }
      $(id).disabled=disabled||locked&&(isGate||!livePolicy)||(isGate&&!gateAccountReady);
      for(const input of list.querySelectorAll('input')){
        input.checked=selected.has(input.value);
        if(isGate){
          const config=state?.qq?.groups;
          const saved=config?.localGateGroupIds?.includes(input.value)===true;
          const changed=saved!==input.checked||!config?.groupIds?.includes(input.value);
          const text=`${word('qqGroupMediaGroup')} ${input.value} · ${word(changed?'qqGateAfterSave':'qqGateCurrent')} · ${word(input.checked?'qqGateLocal':'qqGateOriginal')}`;
          const label=input.nextElementSibling;
          if(label.textContent!==text)label.textContent=text;
        }
        if(isVoice){
          const source=$(`bot-qq-group-voice-source-${input.value}`);
          source.hidden=!input.checked;
          const text=input.checked?word(voiceSourceWords.get(voiceSources?.[input.value])||'qqGroupVoiceUnverified'):'';
          if(source.textContent!==text)source.textContent=text;
        }
      }
    }
    $('bot-qq-group-media-empty').hidden=choices.length>0;
    $('bot-qq-groups-local-gate-empty').hidden=choices.length>0;
  }
  Object.assign(words.en,{
    qqGroupAsrMissing:'Local speech recognition is not configured.',
    qqGroupAsrConfigured:'Local speech recognition is configured.',
    qqGroupAsrUnverified:'Local speech recognition is configured. Waiting for a successful transcription.',
    qqGroupAsrVerified:'Local speech recognition verified with a successful transcription.',
  });
  Object.assign(words.zh,{
    qqGroupAsrMissing:'本机语音识别尚未配置。',
    qqGroupAsrConfigured:'本机语音识别已配置。',
    qqGroupAsrUnverified:'本机语音识别已配置，等待一次成功转写。',
    qqGroupAsrVerified:'本机语音识别已通过实际转写验证。',
  });
  function renderQQGroupAsr(availability){
    const status=$('bot-qq-group-voice-asr');
    const macConfiguration=window.arcade?.platform?.os==='darwin'&&availability?.configured===true;
    const key=macConfiguration?(availability.available===true?'qqGroupAsrVerified':'qqGroupAsrUnverified'):
      availability?.available===true?'qqGroupAsrConfigured':'qqGroupAsrMissing';
    const text=availability?word(key):'';
    status.hidden=!text;
    if(status.textContent!==text)status.textContent=text;
  }
  const groupProviderMessages={
    zh:{
      gate:'群聊接话判断失败，本轮保持安静。',reply:'群聊正式回复生成失败，本轮没有发送回复。',
      localGateSaveFailed:'未能保存按群选择。当前所有群使用搭档原 AI。请检查档案写入权限，再勾选并保存。',
      rate_limited:'AI 服务返回 429。请查看额度、账单或限流状态，恢复后发送新消息。',
      billing:'服务商报告余额或额度受限。请核对余额、用量上限和计费设置。',
      credentials:'服务商拒绝了身份验证。请检查这位搭档的 API key。',
      permission:'服务商拒绝访问。请检查 API key 的权限和模型访问资格。',
      not_found:'服务商未找到请求的资源。请核对模型名称和服务地址。',
      request_rejected:'服务商拒绝了这次请求。请核对模型与请求参数。',
      upstream:'服务商处理请求时出错。稍后可在群里发一条新消息。',
      upstream_timeout:'服务商报告请求超时。稍后可在群里发一条新消息。',
      timeout:'已超过本次等待时限。可在群里发一条新消息重新尝试。',
      token_limit:'已达到模型的 token 上限，未得到完整结果。可用较短的新消息再试。',
      connection:'未能连接 AI 服务。请检查网络和代理设置。',
      refusal:'模型拒绝回答这条消息。可换一种表达再发。',
      invalid_response:'AI 服务返回的内容无法处理。请检查所选模型和服务状态，再在群里发一条新消息。',
      unknown:'本次未能取得回复。可在群里发一条新消息，查看本次结果。',
      ollama:'请检查本机 Ollama 是否正在运行并已安装 qwen3.6:35b-a3b，再发一条新群消息。也可断开 QQ 后关闭本机判断、保存并重新连接。',
    },
    en:{
      gate:'The group reply decision failed. The companion stayed quiet for this turn.',
      localGateSaveFailed:'Could not save per-group decisions. All groups currently use the companion’s AI. Check that the profile is writable, then select the groups and save again.',
      reply:'Group reply generation failed. No reply was sent for this turn.',
      rate_limited:'The AI provider returned 429. Check quota, billing or rate limits, then send a new message when service resumes.',
      billing:'The provider reported a billing or usage limit. Check your balance, spending limits and billing settings.',
      credentials:'The provider rejected authentication. Check this companion’s API key.',
      permission:'The provider denied access. Check API key permissions and model access.',
      not_found:'The provider could not find the requested resource. Check the model name and API endpoint.',
      request_rejected:'The provider rejected the request. Check the model and request parameters.',
      upstream:'The provider encountered an error. Try a new group message later.',
      upstream_timeout:'The provider reported a request timeout. Try a new group message later.',
      timeout:'The time limit for this request was reached. Send a new group message to try again.',
      token_limit:'The model reached its token limit before finishing. Try a shorter group message.',
      connection:'Could not connect to the AI provider. Check your network and proxy settings.',
      refusal:'The model declined this message. Try rephrasing it.',
      invalid_response:'The AI provider returned an unusable response. Check the selected model and service status, then send a new group message.',
      unknown:'The cause is unknown. Send a new group message to check the next result.',
      ollama:'Check that Ollama is running on this computer with qwen3.6:35b-a3b installed, then send a new group message. To use the companion’s AI for decisions, disconnect QQ, turn off local decisions, save and reconnect.',
    },
  };
  const groupImageInputCopy={
    disabled:['本群尚未开启看图。','Image input is off for this group.'],
    market_sticker:['桥接传来的是商城表情，当前无法读取这类表情的画面。','The bridge reported a marketplace sticker. Its pixels cannot be read here.'],
    unsupported_shape:['当前支持单张静态图片。未读取这条混合或多图消息。','Only a single static picture is supported. This mixed or multiple-image message was skipped.'],
    address_unverified:['未能核实引用附图要发给哪位搭档。','The companion addressed by the reply with a picture could not be verified.'],
    source_metadata:['桥接没有提供符合要求的 QQ 图片来源。','The bridge did not supply a supported QQ image source.'],
    source_unverified:['桥接未能核对原消息和图片来源。','The bridge could not verify the original message and image source.'],
    download_failed:['已收到图片来源，但未能从 QQ 取回可读的图片。','An image source was received, but the image could not be fetched from QQ.'],
    download_mismatch:['从 QQ 取回的图片与原消息记录不符，未使用。','The retrieved picture did not match the original message record and was skipped.'],
    invalid_image:['图片未能解码。目前支持静态 JPG 和 PNG。','The image could not be decoded. Static JPG and PNG are supported.'],
    unsupported_format:['QQ 返回的图片格式暂不支持。目前支持静态 JPG 和 PNG。','QQ returned an unsupported image format. Static JPG and PNG are supported.'],
    too_large:['图片超出处理大小。','The picture exceeds the processing limit.'],
    pro_no_vision:['当前选用的 DeepSeek Pro 无法看图。','The selected DeepSeek Pro model cannot accept images.'],
    unsupported_model:['当前选用的 AI 服务或模型无法看图。','The selected AI service or model cannot accept images.'],
    unavailable:['当前连接无法处理群图片。','Group image processing is unavailable on this connection.'],
    provider_failed:['已准备好可读图片，AI 没能完成看图回复。','The picture was prepared, but the AI did not complete its reply.'],
  };
  function groupRuntimeWarning(config,zh,summary=false,daily=null){
    const copy=groupProviderMessages[zh?'zh':'en'];
    const saveWarning=config.localGateSaveFailed===true?copy.localGateSaveFailed:'';
    const configured=(config.groupIds||[]).filter(id=>typeof id==='string'&&qqNumber.test(id)).slice(0,5);
    const affected=new Map(configured.map(id=>[id,new Map()]));
    const phases=['gate','reply'],codes=['rate_limited','billing','credentials','permission','not_found','request_rejected','upstream','upstream_timeout','timeout','token_limit','connection','refusal','invalid_response','unknown','unavailable'];
    const issues=Array.isArray(config.providerIssues)?config.providerIssues:null;
    const currentIssues=config.active&&config.enabled?issues:[];
    for(const issue of currentIssues?.slice(0,10)||[]){
      if(!affected.has(issue?.groupId)||!phases.includes(issue.phase)||!codes.includes(issue.code))continue;
      const local=issue.phase==='gate'&&issue.source==='ollama';
      const code=issue.code==='unavailable'?'unknown':issue.code;
      const description=local?copy.ollama:copy[code];
      affected.get(issue.groupId).set(issue.phase,description);
    }
    const imageWarnings=config.active&&config.enabled&&Array.isArray(config.imageInputIssues)?
      config.imageInputIssues.slice(0,5).flatMap(issue=>{
        if(!configured.includes(issue?.groupId)||daily!==null&&daily!==issue.groupId||!Object.hasOwn(groupImageInputCopy,issue.reason))return [];
        const label=zh?`QQ 群 ${issue.groupId} · ${issue.quoted?'引用图片':'群图片'}`:
          `QQ group ${issue.groupId} · ${issue.quoted?'Quoted image':'Group image'}`;
        return [`${label} · ${groupImageInputCopy[issue.reason][zh?0:1]}`];
      }):[];
    if(summary){
      const count=[...affected.values()].reduce((total,failures)=>total+failures.size,saveWarning?1:0);
      for(const [groupId,failures] of affected){
        const phase=phases.find(key=>failures.has(key));
        if(!phase)continue;
        const label=zh?`QQ 群 ${groupId}。`:`QQ group ${groupId}.`;
        const remaining=count-1;
        const more=remaining?(zh?` 另有 ${remaining} 项问题。`:` ${remaining} more ${remaining===1?'issue':'issues'}.`):'';
        return [label,copy[phase],failures.get(phase)].join(' ')+more;
      }
      return saveWarning||imageWarnings[0]||'';
    }
    const other=typeof config.runtimeProblem==='string'?config.runtimeProblem:
      !issues&&typeof config.problem==='string'?config.problem:'';
    const warnings=[saveWarning,other].filter(Boolean);
    for(const [groupId,failures] of affected){
      if(!failures.size)continue;
      const label=zh?`QQ 群 ${groupId}。`:`QQ group ${groupId}.`;
      const parts=[label];
      for(const description of new Set(failures.values())){
        for(const phase of phases)if(failures.get(phase)===description)parts.push(copy[phase]);
        parts.push(description);
      }
      warnings.push(parts.join(' '));
    }
    return warnings.concat(imageWarnings).join('\n');
  }
  const mediaRequestCopy={
    sticker_request_not_allowed:['群友索取内置表情时，本群尚未授权发送。请勾选这张表情并保存。自然接话时只发表情有单独的开关。',
      'A member asked for the built-in sticker while sharing it on request was off. Select the sticker and save. Sending it as a spontaneous reply has a separate setting.'],
    portrait_request_not_allowed:['这个角色已有立绘。群友索取时，本群尚未允许发送这张图。请勾选立绘并保存。角色平时能否只回立绘，可单独设置。',
      'A member asked for this role’s portrait. A portrait was available, but this group had not allowed it on request. Select the portrait and save. Sending it as a spontaneous reply has a separate setting.'],
    portrait_not_selected:['群友索取立绘时，本群尚未为这个角色选择立绘。请先选图，再勾选允许索取并保存。自然接话时只回立绘有单独的开关。',
      'A member asked for a portrait before one was selected for this role in this group. Choose an image, allow it on request and save. Sending it as a spontaneous reply has a separate setting.'],
    recording_not_selected:['本群尚未为该角色选定固定录音。要播放固定录音，请选择 WAV、勾选允许播放并保存。',
      'No fixed recording is selected for this role and group. To play one, choose a WAV, allow playback and save.'],
    recording_missing:['群友索取语音时，找不到已选录音的本地副本。请重新选择原 WAV。',
      'A member asked for voice, but the saved recording was missing. Choose the original WAV again.'],
    recording_changed:['群友索取语音时，本地录音的内容与选定的原件不一致。请重新选择原 WAV。',
      'A member asked for voice, but the saved recording no longer matched the selected original. Choose the original WAV again.'],
    recording_invalid:['群友索取语音时，已选的录音无法播放。请重新选择一段有声音、格式受支持的 WAV。',
      'A member asked for voice, but the saved recording could not be played. Choose a supported WAV with audible sound.'],
    recording_unreadable:['群友索取语音时，无法读取已选录音的本地副本。请检查文件是否可读，或重新选择 WAV。',
      'A member asked for voice, but the saved recording could not be read. Check file access or choose the WAV again.']
  };
  words.zh.qqOutgoingClipRestored='已恢复原录音，请核对播放授权。';
  words.en.qqOutgoingClipRestored='Original recording restored. Check its playback permission.';
  function renderGroupMediaIssues(config,zh,daily){
    const list=$('bot-qq-media-request-issues'),profileId=credentialContext?.profileId,expectedAccountId=state?.qq?.expectedAccountId;
    const issues=state?.channel==='qq'&&profileId&&qqNumber.test(expectedAccountId)&&Array.isArray(config.mediaRequestIssues)
      ?config.mediaRequestIssues.filter(issue=>issue?.accountId===expectedAccountId&&Object.hasOwn(mediaRequestCopy,issue.reason)&&qqNumber.test(issue.groupId)&&
        typeof issue.roleId==='string'&&typeof issue.roleName==='string'&&(daily===null||daily===issue.groupId)).slice(0,20):[];
    const rows=issues.map(({groupId,roleId,roleName,reason,assetId,at})=>{
      const role=config.outgoingMedia?.find(row=>row.groupId===groupId);
      const portrait=reason==='portrait_request_not_allowed'||reason==='portrait_not_selected';
      const canOpen=config.groupIds?.includes(groupId)&&role?.roleId===roleId&&(!portrait||
        ['ju-portrait','whale-portrait','card-portrait'].includes(assetId)&&role.availableAssets?.includes(assetId));
      return {groupId,roleId,roleName,reason,at,assetId:portrait?assetId:undefined,canOpen};
    });
    const key=JSON.stringify([zh,profileId,expectedAccountId,rows]);
    if(list.dataset.key===key)return rows.length;
    list.dataset.key=key;list.replaceChildren();list.hidden=!rows.length;
    for(const {groupId,roleId,roleName,reason,at,assetId,canOpen} of rows){
      const row=el('li'),label=el('strong'),description=el('span','bot-fine',mediaRequestCopy[reason][zh?0:1]);
      Object.assign(row.dataset,{accountId:expectedAccountId,groupId,roleId,reason});
      if(assetId)row.dataset.assetId=assetId;
      const time=Number.isFinite(at)&&Number.isFinite(new Date(at).getTime())?new Date(at).toLocaleString(zh?'zh-CN':'en',
        {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
      label.textContent=[(zh?'搭档 QQ ':'Companion QQ ')+expectedAccountId,(zh?'QQ 群 ':'QQ group ')+groupId,roleName,time].filter(Boolean).join(' · ');
      const button=el('button','plain',canOpen?(zh?'打开本群素材设置':'Open media settings for this group'):
        (zh?'群或人设已变更':'Group or role changed'));
      button.type='button';button.dataset.qqMediaIssueSettings='';button.disabled=!canOpen;
      button.onclick=()=>{
        if(!button.isConnected||button.disabled||credentialContext?.profileId!==profileId||state.qq?.expectedAccountId!==expectedAccountId)return;
        window.openConversationSetup({section:'qq-groups',profileId,expectedAccountId,groupId,roleId,assetId,mediaIssue:true,returnFocus:button});
      };
      row.append(label,description,button);list.append(row);
    }
    return rows.length;
  }
  const feedWords={
    en:{qqGroupFeed:'Public feed notices',
      qqGroupFeedNote:'Off by default. Allow one public RSS or Atom feed to notify one saved QQ group through its current role. This permission is separate from your App and private QQ notices.',
      qqGroupFeedSavedTitle:'Saved permission',qqGroupFeedRevoke:'Turn off this permission',qqGroupFeedGroup:'Saved QQ group',
      qqGroupFeedSource:'Public RSS or Atom feed',qqGroupFeedAllow:'Confirm public feed and allow notices',
      qqGroupFeedEmpty:'No enabled RSS or Atom feed is available. Add or enable one in Notices.',qqGroupFeedSources:'Open data sources',
      qqGroupFeedChooseGroup:'Choose a saved group',qqGroupFeedChooseSource:'Choose a feed',
      qqGroupFeedSetup:'Save the companion’s QQ number, group settings and current group role first.',
      qqGroupFeedDirty:'Save the pending group and account changes before allowing a feed.',qqGroupFeedPending:'Saving the feed permission…',
      qqGroupFeedSaved:'This feed is allowed for the selected group.',qqGroupFeedRevoked:'Feed permission turned off.',
      qqGroupFeedChanged:'The feed or role changed. Choose it again before confirming.',
      qqGroupFeedFailed:'The permission could not be changed. Check the saved account, group and source, then try again.'},
    zh:{qqGroupFeed:'公开订阅通知',
      qqGroupFeedNote:'默认关闭。可允许一个公开 RSS 或 Atom 订阅，由当前角色向一个已保存的 QQ 群发送通知。此许可与 App 通知、QQ 私聊通知分开。',
      qqGroupFeedSavedTitle:'已保存的许可',qqGroupFeedRevoke:'关闭此许可',qqGroupFeedGroup:'已保存的 QQ 群',
      qqGroupFeedSource:'公开 RSS 或 Atom 订阅',qqGroupFeedAllow:'确认订阅公开并允许通知',
      qqGroupFeedEmpty:'没有可用的 RSS 或 Atom 订阅。请在「提醒」添加或启用订阅。',qqGroupFeedSources:'打开数据源',
      qqGroupFeedChooseGroup:'选择已保存的群',qqGroupFeedChooseSource:'选择订阅',
      qqGroupFeedSetup:'请先保存搭档 QQ 号、群设置和该群当前角色。',
      qqGroupFeedDirty:'请先保存群及账号改动，再允许订阅。',qqGroupFeedPending:'正在保存订阅通知许可…',
      qqGroupFeedSaved:'已允许向此群发送该订阅的通知。',qqGroupFeedRevoked:'已关闭订阅通知许可。',
      qqGroupFeedChanged:'订阅或角色已变化，请重新选择后确认。',
      qqGroupFeedFailed:'未能更改许可。请核对已保存的账号、群和来源后重试。'},
  };
  const calendarWords={
    en:{qqGroupCalendar:'Public calendar notices',
      qqGroupCalendarNote:'Off by default. Only events explicitly marked CLASS:PUBLIC can be shared in the selected QQ group. Private and unmarked events follow your existing personal notification settings.',
      qqGroupCalendarSavedTitle:'Saved permission',qqGroupCalendarRevoke:'Turn off this permission',qqGroupCalendarGroup:'Saved QQ group',
      qqGroupCalendarSource:'Calendar source',qqGroupCalendarAllow:'Allow notices for explicitly public events',
      qqGroupCalendarEmpty:'No enabled calendar is available. Add or enable one in Notices.',qqGroupCalendarSources:'Open data sources',
      qqGroupCalendarChooseGroup:'Choose a saved group',qqGroupCalendarChooseSource:'Choose a calendar',
      qqGroupCalendarSetup:'Save the companion’s QQ number, group settings and current group role first.',
      qqGroupCalendarDirty:'Save the pending group and account changes before allowing a calendar.',
      qqGroupCalendarPending:'Saving the calendar permission…',
      qqGroupCalendarSaved:'Public events from this calendar are allowed for the selected group.',qqGroupCalendarRevoked:'Calendar permission turned off.',
      qqGroupCalendarChanged:'The calendar or role changed. Choose it again before confirming.',
      qqGroupCalendarFailed:'The permission could not be changed. Check the saved account, group and source, then try again.'},
    zh:{qqGroupCalendar:'公开日历提醒',
      qqGroupCalendarNote:'默认关闭。只有明确标记为 CLASS:PUBLIC 的日程才可发到选定的 QQ 群。私密及未标记的日程沿用个人通知设置。',
      qqGroupCalendarSavedTitle:'已保存的许可',qqGroupCalendarRevoke:'关闭此许可',qqGroupCalendarGroup:'已保存的 QQ 群',
      qqGroupCalendarSource:'日历来源',qqGroupCalendarAllow:'仅允许明确标记为公开的日程通知',
      qqGroupCalendarEmpty:'没有可用的日历。请在「提醒」添加或启用日历。',qqGroupCalendarSources:'打开数据源',
      qqGroupCalendarChooseGroup:'选择已保存的群',qqGroupCalendarChooseSource:'选择日历',
      qqGroupCalendarSetup:'请先保存搭档 QQ 号、群设置和该群当前角色。',
      qqGroupCalendarDirty:'请先保存群及账号改动，再允许日历提醒。',qqGroupCalendarPending:'正在保存日历提醒许可…',
      qqGroupCalendarSaved:'已允许向此群发送该日历中的公开日程提醒。',qqGroupCalendarRevoked:'已关闭日历提醒许可。',
      qqGroupCalendarChanged:'日历或角色已变化，请重新选择后确认。',
      qqGroupCalendarFailed:'未能更改许可。请核对已保存的账号、群和来源后重试。'},
  };
  const folderWords={
    en:{qqGroupFolder:'Public folder notices',
      qqGroupFolderNote:'Off by default. Only filenames and the type of change for top-level files may be shared in the selected QQ group. Group notices exclude full paths, file contents and other file details. This does not scan subfolders or upload files.',
      qqGroupFolderSavedTitle:'Saved permission',qqGroupFolderRevoke:'Turn off this permission',qqGroupFolderGroup:'Saved QQ group',
      qqGroupFolderSource:'Folder source',qqGroupFolderAllow:'Confirm filenames can be public and allow notices',
      qqGroupFolderEmpty:'No enabled folder is available. Add or enable one in Notices.',qqGroupFolderSources:'Open data sources',
      qqGroupFolderChooseGroup:'Choose a saved group',qqGroupFolderChooseSource:'Choose a folder',
      qqGroupFolderSetup:'Save the companion’s QQ number, group settings and current group role first.',
      qqGroupFolderDirty:'Save the pending group and account changes before allowing a folder.',
      qqGroupFolderPending:'Saving the folder permission…',
      qqGroupFolderSaved:'File change notices are allowed from this folder to the selected group.',qqGroupFolderRevoked:'Folder permission turned off.',
      qqGroupFolderChanged:'The folder or role changed. Choose it again before confirming.',
      qqGroupFolderFailed:'The permission could not be changed. Check the saved account, group and source, then try again.'},
    zh:{qqGroupFolder:'公开文件夹通知',
      qqGroupFolderNote:'默认关闭。所选 QQ 群只会收到顶层文件的文件名及变动类型。群通知不包含完整路径、文件内容及其他文件信息。此许可不扫描子文件夹，也不上传文件。',
      qqGroupFolderSavedTitle:'已保存的许可',qqGroupFolderRevoke:'关闭此许可',qqGroupFolderGroup:'已保存的 QQ 群',
      qqGroupFolderSource:'文件夹来源',qqGroupFolderAllow:'确认文件名可公开并允许通知',
      qqGroupFolderEmpty:'没有可用的文件夹。请在「提醒」添加或启用文件夹。',qqGroupFolderSources:'打开数据源',
      qqGroupFolderChooseGroup:'选择已保存的群',qqGroupFolderChooseSource:'选择文件夹',
      qqGroupFolderSetup:'请先保存搭档 QQ 号、群设置和该群当前角色。',
      qqGroupFolderDirty:'请先保存群及账号改动，再允许文件夹通知。',qqGroupFolderPending:'正在保存文件夹通知许可…',
      qqGroupFolderSaved:'已允许向此群发送该文件夹的文件变动通知。',qqGroupFolderRevoked:'已关闭文件夹通知许可。',
      qqGroupFolderChanged:'文件夹或角色已变化，请重新选择后确认。',
      qqGroupFolderFailed:'未能更改许可。请核对已保存的账号、群和来源后重试。'},
  };
  const pageWords={
    en:{qqGroupPage:'Public page changes',
      qqGroupPageNote:'Off by default. Choose a page you know is publicly viewable. The selected QQ group can receive the saved page name and a notice that it changed. Page contents, addresses and query parameters are excluded.',
      qqGroupPageSavedTitle:'Saved permission',qqGroupPageRevoke:'Turn off this permission',qqGroupPageGroup:'Saved QQ group',
      qqGroupPageSource:'Page source',qqGroupPageAllow:'Confirm the page is public and allow notices',
      qqGroupPageEmpty:'No enabled web page is available. Add or enable one in Notices.',qqGroupPageSources:'Open data sources',
      qqGroupPageChooseGroup:'Choose a saved group',qqGroupPageChooseSource:'Choose a web page',
      qqGroupPageSetup:'Save the companion’s QQ number, group settings and current group role first.',
      qqGroupPageDirty:'Save the pending group and account changes before allowing a web page.',
      qqGroupPagePending:'Saving the web page permission…',
      qqGroupPageSaved:'Page change notices are allowed for the selected group.',qqGroupPageRevoked:'Web page permission turned off.',
      qqGroupPageChanged:'The web page or role changed. Choose it again before confirming.',
      qqGroupPageFailed:'The permission could not be changed. Check the saved account, group and source, then try again.'},
    zh:{qqGroupPage:'公开网页更新',
      qqGroupPageNote:'默认关闭。请选择你确认可以公开访问的网页。所选 QQ 群只会收到你保存的网页名称和更新提示。群通知不包含页面内容、地址或查询参数。',
      qqGroupPageSavedTitle:'已保存的许可',qqGroupPageRevoke:'关闭此许可',qqGroupPageGroup:'已保存的 QQ 群',
      qqGroupPageSource:'网页来源',qqGroupPageAllow:'确认网页可公开访问并允许通知',
      qqGroupPageEmpty:'没有可用的网页。请在「提醒」添加或启用网页。',qqGroupPageSources:'打开数据源',
      qqGroupPageChooseGroup:'选择已保存的群',qqGroupPageChooseSource:'选择网页',
      qqGroupPageSetup:'请先保存搭档 QQ 号、群设置和该群当前角色。',
      qqGroupPageDirty:'请先保存群及账号改动，再允许网页更新通知。',qqGroupPagePending:'正在保存网页更新许可…',
      qqGroupPageSaved:'已允许向此群发送该网页的更新通知。',qqGroupPageRevoked:'已关闭网页更新许可。',
      qqGroupPageChanged:'网页或角色已变化，请重新选择后确认。',
      qqGroupPageFailed:'未能更改许可。请核对已保存的账号、群和来源后重试。'},
  };
  for(const lang of ['en','zh'])Object.assign(words[lang],feedWords[lang],calendarWords[lang],folderWords[lang],pageWords[lang]);
  const feedStates={
    ready:['许可生效。后续更新仍遵守主动联系时段和群额度。','Permission is active. Future updates still follow contact hours and group limits.'],
    waiting_connection:['许可已保存，等待连接此搭档的 QQ。','Permission is saved. Connect this companion’s QQ to use it.'],
    source_changed:['订阅已变更。请关闭旧许可，再核对并允许当前订阅。','The feed changed. Turn off the old permission before reviewing the current feed.'],
    source_disabled:['订阅已停用或移除。','The feed is disabled or removed.'],
    target_changed:['已保存的群或角色已变更。请关闭旧许可，再核对当前群和角色。','The saved group or role changed. Turn off the old permission, then review the current group and role.'],
    paused:['群订阅通知已暂停。请检查主动聊天和群设置。','Group feed notices are paused. Check proactive chat and group settings.'],
  };
  const feedOutcomes={
    queued:['更新已排队，尚未提交给 QQ。','The update is queued. It has yet to be submitted to QQ.'],
    accepted:['QQ 接口已受理上次请求。','QQ accepted the last request.'],
    unknown:['上次发送结果未确认，请先在 QQ 查看。','The last send result is unconfirmed. Check QQ first.'],
    not_submitted:['上次更新未提交给 QQ。','The last update was not submitted to QQ.'],
    failed:['上次群订阅通知未完成。','The last group feed notice did not complete.'],
  };
  const calendarStates={...feedStates,
    source_changed:['日历来源已变更。请关闭旧许可，再核对并允许当前日历。','The calendar source changed. Turn off the old permission before reviewing the current calendar.'],
    source_disabled:['日历已停用或移除。','The calendar is disabled or removed.'],
    paused:['群日历提醒已暂停。请检查主动聊天和群设置。','Group calendar notices are paused. Check proactive chat and group settings.'],
  };
  const calendarOutcomes={...feedOutcomes,
    queued:['日程提醒已排队，尚未提交给 QQ。','The calendar notice is queued. It has yet to be submitted to QQ.'],
    not_submitted:['上次日程提醒未提交给 QQ。','The last calendar notice was not submitted to QQ.'],
    failed:['上次群日历提醒未完成。','The last group calendar notice did not complete.'],
  };

  const folderStates={...feedStates,
    source_changed:['文件夹来源已变更。请关闭旧许可，再核对并允许当前文件夹。','The folder source changed. Turn off the old permission before reviewing the current folder.'],
    source_disabled:['文件夹已停用或移除。','The folder is disabled or removed.'],
    paused:['群文件夹通知已暂停。请检查主动聊天和群设置。','Group folder notices are paused. Check proactive chat and group settings.'],
  };
  const folderOutcomes={...feedOutcomes,
    queued:['文件夹通知已排队，尚未提交给 QQ。','The folder notice is queued. It has yet to be submitted to QQ.'],
    not_submitted:['上次文件夹通知未提交给 QQ。','The last folder notice was not submitted to QQ.'],
    failed:['上次群文件夹通知未完成。','The last group folder notice did not complete.'],
  };

  const pageStates={...feedStates,
    source_changed:['网页来源已变更。请关闭旧许可，再核对并允许当前网页。','The web page source changed. Turn off the old permission before reviewing the current page.'],
    source_disabled:['网页已停用或移除。','The web page is disabled or removed.'],
    paused:['群网页更新通知已暂停。请检查主动聊天和群设置。','Group page change notices are paused. Check proactive chat and group settings.'],
  };
  const pageOutcomes={...feedOutcomes,
    queued:['网页更新通知已排队，尚未提交给 QQ。','The page change notice is queued. It has yet to be submitted to QQ.'],
    not_submitted:['上次网页更新通知未提交给 QQ。','The last page change notice was not submitted to QQ.'],
    failed:['上次群网页更新通知未完成。','The last group page change notice did not complete.'],
  };

  const validGroupSourceId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
  const validGroupSourceRole=value=>typeof value==='string'&&/^[a-z0-9-]{1,64}$/.test(value);
  const validGroupSourceIdentity=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  const groupSourceLabel=value=>typeof value==='string'?value.replace(/[\p{Cc}\p{Cf}]/gu,'').trim().slice(0,64):'';
  function groupSourceTarget(target,kind){
    if(typeof target!=='string'||!target)return '';
    if(kind!=='folder'){
      try{
        const url=new URL(target);
        return url.protocol==='https:'&&!url.username&&!url.password?url.origin+url.pathname:'';
      }catch{/* Only calendars can fall back to a local basename. */}
    }
    const basename=target.length<=255&&target!=='.'&&target!=='..'&&!/[\\/:\p{Cc}\p{Cf}]/u.test(target);
    return basename&&(kind==='folder'||kind==='calendar'&&!/[?#]/.test(target))?target:'';
  }
  function settledGroupSourceConnection(){return state?.status==='disconnected'||state?.status==='connected';}
  function savedGroupSourceSettings(){return !qqGroupsDirty&&!qqGroupsSaving&&!connectionDrafts.has('bot-qq-expected-account');}
  function groupNoticeLabel(groupId){return language==='zh'?`QQ 群 ${groupId}`:`QQ group ${groupId}`;}
  const sameGroupSourceScope=(left,right)=>left&&right&&['groupId','roleId','sourceId','identity'].every(key=>left[key]===right[key]);

  function groupSourceControl({kind,noticesKey,sourceListKey,method,words:prefix,states,outcomes}){
    const node=suffix=>$(`bot-qq-group-${kind}${suffix?'-'+suffix:''}`);
    const panel=node(),groupInput=node('group'),sourceInput=node('source');
    const message=suffix=>word(prefix+suffix);
    let currentView=null;

    function scopedData(config){
      const groupIds=(config.groupIds||[]).filter(id=>typeof id==='string'&&qqNumber.test(id));
      const groups=(config.generation||[]).filter(row=>row&&groupIds.includes(row.groupId)&&
        validGroupSourceRole(row.roleId)&&groupSourceLabel(row.roleName));
      const notices=config[noticesKey];
      const sources=(notices?.[sourceListKey]||[]).flatMap(row=>{
        if(!row||!validGroupSourceId(row.id)||!validGroupSourceIdentity(row.identity))return [];
        const name=groupSourceLabel(row.name);
        // Page consent identifies the saved source without rendering any part of its address.
        const target=kind==='page'?(row.target===row.id?row.id:''):groupSourceTarget(row.target,kind);
        return name&&target?[{id:row.id,name,target,identity:row.identity}]:[];
      });
      const saved=notices?.binding;
      const binding=saved&&typeof saved.groupId==='string'&&qqNumber.test(saved.groupId)&&validGroupSourceRole(saved.roleId)&&
        validGroupSourceId(saved.sourceId)&&validGroupSourceIdentity(saved.identity)?saved:null;
      return {groupIds,groups,sources,binding};
    }

    function render(config){
      const supported=state?.channel==='qq'&&typeof window.arcade?.[method]==='function'&&!!config[noticesKey];
      panel.hidden=!supported;
      if(!supported||!panel.open){currentView=null;return;}
      const {groupIds,groups,sources,binding}=scopedData(config),account=state.qq.expectedAccountId;
      const scope=JSON.stringify([lastCredentialScope,account,groupIds]);
      if(currentView?.scope!==scope)currentView={scope,groupId:'',roleId:'',sourceId:'',identity:'',operation:null,feedback:''};
      const view=currentView,ready=qqNumber.test(account)&&!!credentialContext.profileId;
      const saving=!!view.operation,draftReady=ready&&savedGroupSourceSettings(),locked=saving||!settledGroupSourceConnection();
      const group=groups.find(row=>row.groupId===view.groupId&&row.roleId===view.roleId);
      const source=sources.find(row=>row.id===view.sourceId&&row.identity===view.identity);
      const changed=(view.groupId&&!group)||(view.sourceId&&!source);
      if(changed){
        if(!group){view.groupId='';view.roleId='';}
        view.sourceId='';view.identity='';view.feedback='Changed';
      }
      const selection=group&&source&&!changed?`${groupNoticeLabel(group.groupId)} · ${groupSourceLabel(group.roleName)} · ${source.name} · ${source.target}`:'';
      node('account').textContent=ready?(language==='zh'?`搭档 QQ ${account}`:`Companion QQ ${account}`):message('Setup');
      node('binding').hidden=!binding;
      node('choices').hidden=!!binding||!draftReady||!groups.length||!sources.length;
      node('empty').hidden=!!binding||!draftReady||!groups.length||!!sources.length;
      roleOptions(groupInput,message('ChooseGroup'),groups.map(row=>[row.groupId,groupNoticeLabel(row.groupId)]),view.groupId);
      roleOptions(sourceInput,message('ChooseSource'),sources.map(row=>[row.id,`${row.name} · ${row.target}`]),view.sourceId);
      groupInput.disabled=locked||!draftReady;
      sourceInput.disabled=groupInput.disabled||!group;
      node('selection').hidden=!selection;
      node('selection').textContent=selection;
      node('allow').disabled=sourceInput.disabled||!source||!!binding||!!changed;
      node('revoke').disabled=locked||!ready||!binding;

      const index=language==='zh'?0:1;
      const currentRole=binding&&groups.find(row=>row.groupId===binding.groupId&&row.roleId===binding.roleId);
      node('saved-details').textContent=binding?[groupNoticeLabel(binding.groupId),groupSourceLabel(currentRole?.roleName),
        groupSourceLabel(binding.sourceName)].filter(Boolean).join(' · '):'';
      node('state').textContent=binding&&Object.hasOwn(states,binding.status)?states[binding.status][index]:'';
      const last=config[noticesKey].lastOutcome,outcome=node('outcome');
      outcome.textContent=binding&&Object.hasOwn(outcomes,last)?outcomes[last][index]:'';
      outcome.hidden=!outcome.textContent;
      if(view.feedback==='Saved'&&binding&&!['ready','waiting_connection'].includes(binding.status))view.feedback='';
      const feedback=saving?'Pending':view.feedback||(!binding&&ready&&!groups.length?'Setup':
        !binding&&ready&&!savedGroupSourceSettings()?'Dirty':'');
      node('feedback').textContent=feedback?message(feedback):'';
    }

    async function request(enabled){
      const view=currentView;
      if(!view||view.operation||!panel.open||!settledGroupSourceConnection())return;
      const config=state.qq.groups,{groups,sources,binding}=scopedData(config),account=state.qq.expectedAccountId;
      if(!qqNumber.test(account)||!credentialContext.profileId)return;
      const group=groups.find(row=>row.groupId===view.groupId&&row.roleId===view.roleId);
      const source=sources.find(row=>row.id===view.sourceId&&row.identity===view.identity);
      if(enabled?(binding||!group||!source||!savedGroupSourceSettings()):!binding)return;
      const {groupId,roleId,sourceId,identity}=enabled?{...group,sourceId:source.id,identity:source.identity}:binding;
      const input={...credentialContext,expectedAccountId:account,groupId,roleId,sourceId,identity,enabled};
      const operation={};
      view.operation=operation;
      view.feedback='';
      const current=()=>panel.open&&currentView===view&&view.operation===operation;
      render(config);
      try{
        const result=await window.arcade[method](input);
        if(!current())return;
        const saved=result?.qq?.groups?.[noticesKey];
        if(result?.qq?.expectedAccountId!==account||!saved||
          (enabled?!sameGroupSourceScope(input,saved.binding):saved.binding!==null))throw Error('Group source scope changed');
        view.groupId='';view.roleId='';view.sourceId='';view.identity='';
        view.feedback=enabled?'Saved':'Revoked';
      }catch{if(current())view.feedback='Failed';}
      finally{if(current()){view.operation=null;render(state.qq.groups);}}
    }

    panel.addEventListener('toggle',()=>render(state?.qq?.groups||{}));
    groupInput.onchange=()=>{
      if(!currentView||currentView.operation)return;
      const row=scopedData(state.qq.groups).groups.find(row=>row.groupId===groupInput.value);
      currentView.groupId=row?.groupId||'';
      currentView.roleId=row?.roleId||'';
      currentView.sourceId='';currentView.identity='';currentView.feedback='';
      render(state.qq.groups);
    };
    sourceInput.onchange=()=>{
      if(!currentView||currentView.operation)return;
      const row=scopedData(state.qq.groups).sources.find(row=>row.id===sourceInput.value);
      currentView.sourceId=row?.id||'';
      currentView.identity=row?.identity||'';
      currentView.feedback='';
      render(state.qq.groups);
    };
    node('allow').onclick=()=>request(true);
    node('revoke').onclick=()=>request(false);
    node('sources').onclick=()=>{switchView('notices');$('source-kind')?.focus();};
    return render;
  }
  const renderQQGroupFeed=groupSourceControl({kind:'feed',noticesKey:'feedNotices',sourceListKey:'feeds',
    method:'groupFeedSet',words:'qqGroupFeed',states:feedStates,outcomes:feedOutcomes});
  const renderQQGroupCalendar=groupSourceControl({kind:'calendar',noticesKey:'calendarNotices',sourceListKey:'calendars',
    method:'groupCalendarSet',words:'qqGroupCalendar',states:calendarStates,outcomes:calendarOutcomes});
  const renderQQGroupFolder=groupSourceControl({kind:'folder',noticesKey:'folderNotices',sourceListKey:'folders',
    method:'groupFolderSet',words:'qqGroupFolder',states:folderStates,outcomes:folderOutcomes});
  const renderQQGroupPage=groupSourceControl({kind:'page',noticesKey:'pageNotices',sourceListKey:'pages',
    method:'groupPageSet',words:'qqGroupPage',states:pageStates,outcomes:pageOutcomes});
  function renderQQGroupSources(config){
    renderQQGroupFeed(config);
    renderQQGroupCalendar(config);
    renderQQGroupFolder(config);
    renderQQGroupPage(config);
  }
  Object.assign(words.zh,{
    qqOutgoingTitle:'群聊媒体',qqOutgoingNote:'角色会按语境自动选表情图。立绘和语音在这里单独设置。',
    qqPublicWebTitle:'公开网页搜索',qqPublicWebToggle:'允许此群搜索公开网页',qqPublicWebSave:'保存搜索设置',
    qqPublicWebSource:'搜索来源',qqPublicWebLabel:'搜索地址',qqPublicWebFree:'用 Mwmbl · 无需密钥',
    qqPublicWebNote:'默认使用 Mwmbl，也可填写启用 JSON 的 SearXNG /search 地址。',
    qqOutgoingStickerReaction:'也允许它在合适时只回这张表情',
    qqOutgoingPortraitReaction:'也允许它在合适时只回这张立绘',qqOutgoingVoiceReaction:'也允许它在合适时只回语音',
    qqOutgoingGroup:'群号与角色',qqOutgoingAssets:'允许发送的素材',qqWhaleSpeech:'用角色所选音色说本轮台词',qqOutgoingVoice:'用角色音色说本轮台词',qqOutgoingSticker:'橘娘表情图',qqOutgoingPortrait:'橘娘角色立绘',qqOutgoingSave:'保存本群素材',
    qqOutgoingWhaleVoice:'播放这段鲸鱼娘录音',qqOutgoingWhaleSticker:'鲸鱼娘表情图',qqOutgoingWhalePortrait:'鲸鱼娘角色立绘',
    qqOutgoingRecordingNote:'群友向鲸鱼娘要语音时，全群都能听到你选的这段录音。每次播放相同内容。选好文件后，勾选播放并保存即可启用。',
    qqOutgoingPick:'为本群鲸鱼娘选择固定语音（WAV）',qqOutgoingRemove:'移除录音',qqOutgoingNoRecording:'尚未为本群鲸鱼娘选定固定录音。',
    qqOutgoingRecordingFailed:'录音未更新。请核对群号、角色和 WAV 后再试。',
    qqOutgoingChoose:'选择一个群',qqOutgoingEmpty:'请先启用本群接话，选择已批准的角色卡、橘娘或鲸鱼娘。',qqOutgoingEdited:'请先保存上方正在修改的账号或群设置。',
    qqOutgoingSaved:'已保存本群的素材选择。',qqOutgoingLive:'本群的素材授权已保存，并在当前 QQ 连接生效。',qqOutgoingPending:'QQ 连接尚未就绪，暂不能修改本群素材。',qqOutgoingClipSelected:'已选定本群的固定录音。勾选播放并保存后，群友索取时才能播放。',qqOutgoingClipRemoved:'已移除本群的固定录音及播放授权。',qqOutgoingClipUnchanged:'本群的固定录音未改变。',qqOutgoingFailed:'保存失败，请核对当前账号、群和角色后重试。'
  });
  Object.assign(words.en,{
    qqOutgoingTitle:'Group media',qqOutgoingNote:'The companion picks reaction images automatically. Configure portraits and voice here.',
    qqPublicWebTitle:'Public web search',qqPublicWebToggle:'Allow public web search in this group',qqPublicWebSave:'Save search settings',
    qqPublicWebSource:'Search source',qqPublicWebLabel:'Search address',qqPublicWebFree:'Use Mwmbl · No API key',
    qqPublicWebNote:'Mwmbl is the default. You can use a JSON-enabled SearXNG /search address.',
    qqOutgoingStickerReaction:'Also let the character reply with just this sticker when it fits.',
    qqOutgoingPortraitReaction:'Also allow a reply with just this portrait when it fits.',qqOutgoingVoiceReaction:'Also allow a voice-only reply when it fits.',
    qqOutgoingGroup:'Group and role',qqOutgoingAssets:'Allowed media',qqWhaleSpeech:'Speak the current reply in the selected voice',qqOutgoingVoice:'Speak in the character’s voice',qqOutgoingSticker:"Ju's sticker",qqOutgoingPortrait:"Ju's portrait",qqOutgoingSave:'Save media for this group',
    qqOutgoingWhaleVoice:'Play this Whale Girl recording',qqOutgoingWhaleSticker:"Whale Girl's sticker",qqOutgoingWhalePortrait:"Whale Girl's portrait",
    qqOutgoingRecordingNote:'When someone asks Whale Girl for voice, the whole group can hear the recording you choose. It plays the same words each time. Select its checkbox and save to enable playback.',
    qqOutgoingPick:'Choose a fixed WAV for Whale Girl in this group',qqOutgoingRemove:'Remove recording',qqOutgoingNoRecording:'No fixed recording is selected for Whale Girl in this group.',
    qqOutgoingRecordingFailed:'Recording unchanged. Check the group, role and WAV before trying again.',
    qqOutgoingChoose:'Choose a group',qqOutgoingEmpty:'Enable group replies and choose an approved character card, Ju or Whale Girl.',qqOutgoingEdited:'Save your edits to the account or group settings above first.',
    qqOutgoingSaved:'Media choices saved for this group.',qqOutgoingLive:'Media permissions saved for this group and active on the current QQ connection.',qqOutgoingPending:'The QQ connection is not ready to change media permissions.',qqOutgoingClipSelected:'Fixed recording selected for this group. Select playback and save to allow members to request it.',qqOutgoingClipRemoved:'The fixed recording and its playback permission were removed for this group.',qqOutgoingClipUnchanged:'The fixed recording for this group is unchanged.',qqOutgoingFailed:'Could not save. Check the current account, group and role and try again.'
  });
  const outgoingSection=$('bot-qq-group-outgoing'),outgoingGroup=$('bot-qq-outgoing-group'),outgoingFields=$('bot-qq-outgoing-assets');
  const outgoingList=$('bot-qq-outgoing-options'),outgoingSave=$('bot-qq-outgoing-save');
  const recordingControls=$('bot-qq-outgoing-recording');
  const mediaSaveNotices=new Set(['qqOutgoingSaved','qqOutgoingLive','qqOutgoingFailed']);
  let outgoingControls=[];
  const outgoingNames=new Map([['ju-serena','qqOutgoingVoice'],['ju-sticker','qqOutgoingSticker'],['ju-portrait','qqOutgoingPortrait'],
    ['whale-speech','qqWhaleSpeech'],['dragon-speech','qqWhaleSpeech'],['whale-recording','qqOutgoingWhaleVoice'],['whale-sticker','qqOutgoingWhaleSticker'],['whale-portrait','qqOutgoingWhalePortrait'],
    ['card-recording','qqCardRecording'],['card-speech','qqCardSpeech'],['card-sticker','qqCardSticker'],['card-portrait','qqCardPortrait']]);
  Object.assign(words.zh,{qqCardRecording:'本群为此卡选定的固定录音',qqCardSpeech:'群友索取语音时，允许用所选音色朗读当轮台词',
    qqCardPortrait:'本卡立绘',qqCardSticker:'本卡表情',qqCardImageEmpty:'尚未选图',qqCardChoose:'选择本地图片',qqCardUsePortrait:'使用角色卡自带立绘',
    qqCardRemove:'移除图片',qqCardImageSelected:'已选择本群图片。勾选使用方式并保存后才会授权发送。',qqCardImageRemoved:'已移除本群图片及其发送授权。',
    qqCardImageUnchanged:'本群选定的图片未改变。',qqCardImageFailed:'图片未更新。请核对当前群、角色与所选图片。',
    qqCardRecordingNote:'本群可播放固定录音，或用所选音色朗读当轮台词。两种方式择一授权。',
    qqCardPickWav:'为本群角色卡选择固定录音（WAV）',qqCardNoWav:'尚未选定固定录音。'});
  Object.assign(words.en,{qqCardRecording:'Fixed recording for this group and card',qqCardSpeech:'Allow the selected voice to speak the current reply when members ask',
    qqCardPortrait:'Card portrait',qqCardSticker:'Card sticker',qqCardImageEmpty:'No image selected',qqCardChoose:'Choose local image',qqCardUsePortrait:'Use card’s own portrait',
    qqCardRemove:'Remove image',qqCardImageSelected:'Group image selected. Choose its uses and save to grant permission.',qqCardImageRemoved:'Group image and send permissions removed.',
    qqCardImageUnchanged:'The group image selection is unchanged.',qqCardImageFailed:'Could not update the image. Check the group, card and selected image.',
    qqCardRecordingNote:'Allow either a fixed recording or the selected voice to speak the current reply in this group.',
    qqCardPickWav:'Choose a fixed WAV for this group and card',qqCardNoWav:'No fixed recording selected.'});
  const cardImage=id=>id==='card-sticker'||id==='card-portrait';
  const isSticker=id=>typeof id==='string'&&id.endsWith('-sticker');
  const stickerIdentity=sticker=>sticker?{name:sticker.name,sha256:sticker.sha256,sourceSha256:sticker.sourceSha256}:null;
  const selectedImage=(row,id)=>isSticker(id)&&row?.namedSticker||row?.images?.[id];
  Object.assign(words.zh,{qqNamedLibrary:'从角色表情库选择',qqNamedDefault:'当前使用内置表情',qqNamedRestoreDefault:'恢复内置表情',qqNamedRestoreFile:'恢复本群原选图',
    qqNamedClear:'取消本群选用',qqNamedChanged:'本群表情已更换。请勾选允许的发送方式并保存。',qqNamedRestored:'已取消选用这张命名表情。请核对本群的发送授权。'});
  Object.assign(words.en,{qqNamedLibrary:'Choose from character stickers',qqNamedDefault:'Using the built-in sticker',qqNamedRestoreDefault:'Restore built-in sticker',qqNamedRestoreFile:'Restore original group image',
    qqNamedClear:'Clear group selection',qqNamedChanged:'Group sticker changed. Select its send permissions and save.',qqNamedRestored:'Named sticker cleared. Review the send permissions for this group.'});
  Object.assign(words.zh,{qqCollectionAdd:'从角色图库设置偏好',qqCollectionAdded:'已保存本群表情偏好。',qqCollectionRemoved:'已移除本群表情偏好。'});
  Object.assign(words.en,{qqCollectionAdd:'Prefer a sticker from the library',qqCollectionAdded:'Group sticker preference saved.',qqCollectionRemoved:'Group sticker preference removed.'});
  const recordingAsset=id=>id==='whale-recording'||id==='card-recording';
  const recordingStatusCopy={
    checking:['正在检查已选录音，检查通过后可用。','Checking the selected recording. It will be available once verified.'],
    missing:['找不到已选录音的本地副本，当前不能发送。请重新选择原 WAV。','The saved recording is missing and cannot be sent. Choose the original WAV again.'],
    changed:['本地录音的内容与选定的原件不一致，当前不能发送。请重新选择原 WAV。','The saved recording differs from the selected original and cannot be sent. Choose the original WAV again.'],
    invalid:['已选录音无法播放，当前不能发送。请重新选择一段有声音、格式受支持的 WAV。','The saved recording cannot be played or sent. Choose a supported WAV with audible sound.'],
    unreadable:['已选录音的本地副本无法读取，当前不能发送。请检查文件是否可读，或重新选择 WAV。','The saved recording cannot be read or sent. Check file access or choose the WAV again.']
  };
  function recordingState(row){
    if(!row?.recording)return 'unselected';
    const status=row.recordingAvailability;
    if(Object.hasOwn(recordingStatusCopy,status))return status;
    if(status==='available'||status===undefined)return row.recordingAvailable===false?'unreadable':'available';
    return 'unreadable';
  }
  Object.assign(words.zh,{qqCardPickSticker:'选择表情图',qqCardPickPortrait:'选择立绘图片',qqCardReplaceSticker:'替换表情图',qqCardReplacePortrait:'替换立绘图片',
    qqCardEmptySticker:'尚未选图。先选择表情图，再勾选允许的发送方式。',qqCardEmptyPortrait:'尚未选图。先选好立绘，再勾选允许的发送方式。',
    qqCardRequestSticker:'群友索取时允许发这张表情',qqCardRequestPortrait:'群友索取时允许发这张立绘',
    qqCardAltSticker:'本群选定的表情图',qqCardAltPortrait:'本群选定的立绘',qqCardLoading:'正在读取预览…',qqCardUnreadable:'预览未能读取。可重试或替换图片。',qqCardRetry:'重试预览'});
  Object.assign(words.en,{qqCardPickSticker:'Choose sticker',qqCardPickPortrait:'Choose portrait',qqCardReplaceSticker:'Replace sticker',qqCardReplacePortrait:'Replace portrait',
    qqCardEmptySticker:'Choose a sticker to enable its sending options.',qqCardEmptyPortrait:'Choose a portrait to enable its sending options.',
    qqCardRequestSticker:'Allow this sticker when members ask',qqCardRequestPortrait:'Allow this portrait when members ask',
    qqCardAltSticker:'Sticker selected for this group',qqCardAltPortrait:'Portrait selected for this group',qqCardLoading:'Loading preview…',qqCardUnreadable:'Could not load the preview. Retry or replace the image.',qqCardRetry:'Retry preview'});
  let outgoingView=null;
  function mediaReactions(row){
    return row?.reactionAssets || (row?.stickerReaction===true?row.assets.filter(id=>id.endsWith('-sticker')):[]);
  }
  const mediaKey=(row,except)=>JSON.stringify([row?.groupId,row?.roleId,row?.assets.filter(id=>id!==except),mediaReactions(row).filter(id=>id!==except),
    recordingAsset(except)?null:row?.recording?.sha256,isSticker(except)?null:[row?.stickerRevision,stickerIdentity(row?.namedSticker),row?.namedStickers],
    ...['card-sticker','card-portrait'].map(id=>id===except?null:row?.images?.[id]?.sha256)]);
  // Verification may finish independently of an edit. Keep drafts bound to the
  // approved material, and expire optimistic receipts when either result changes.
  const mediaSnapshotKey=row=>JSON.stringify([mediaKey(row),recordingState(row)]);
  function mediaControls(assets,daily,collection=false){
    const listKey=JSON.stringify([language,assets,daily,collection]);
    if(outgoingList.dataset.key===listKey)return;
    if(outgoingList.contains(recordingControls))outgoingFields.before(recordingControls);
    outgoingList.replaceChildren();
    outgoingControls=assets.map(id=>{
      const label=el('label','qq-group-toggle'),box=el('input');
      box.type='checkbox';box.value=id;
      const requestLabel=daily&&id.endsWith('-portrait')?'qqCardRequestPortrait':outgoingNames.get(id);
      label.append(box,el('span','',word(requestLabel)));
      const reactionLabel=el('label','qq-group-toggle qq-media-reaction'),reaction=el('input');
      const type=id.endsWith('-sticker')?'Sticker':id.endsWith('-portrait')?'Portrait':'Voice';
      reaction.type='checkbox';reaction.dataset.reactionAsset=id;
      if(type==='Sticker')reaction.id='bot-qq-outgoing-sticker-reaction';
      reactionLabel.append(reaction,el('span','',word('qqOutgoing'+type+'Reaction')));
      if(!cardImage(id)&&!(daily&&isSticker(id))){
        if(type!=='Sticker')outgoingList.append(label,reactionLabel);
        const source=isSticker(id)?el('small'):null;
        if(source){source.hidden=true;outgoingList.append(source);}
        return {id,box,reaction,source};
      }
      const imageStatus=el('small'),actions=el('div','qq-actions');
      imageStatus.dataset.imageStatus=id;
      const buttons={};
      const fileActions=cardImage(id)?[['choose','qqCardChoose'],['portrait','qqCardUsePortrait'],['remove','qqCardRemove']]:[];
      for(const [op,key] of fileActions){
        if(op==='portrait'&&id!=='card-portrait')continue;
        const button=el('button','secondary',word(key));button.type='button';button.dataset.asset=id;button.dataset.operation=op;
        button.onclick=()=>changeMediaFile(id,op);buttons[op]=button;actions.append(button);
      }
      const control={id,box,reaction,imageStatus,buttons};
      if(!daily){
        if(type!=='Sticker')outgoingList.append(label,reactionLabel);
        outgoingList.append(imageStatus,actions);
        return control;
      }
      if(isSticker(id)){
        for(const [op,key] of [['library','qqNamedLibrary'],['restore','qqNamedClear']]){
          if(collection&&op==='restore')continue;
          const button=el('button','secondary',word(collection?'qqCollectionAdd':key));button.type='button';button.dataset.asset=id;button.dataset.operation=op;
          button.onclick=()=>op==='library'?openNamedStickerPicker(control,button):changeNamedSticker(outgoingView,id,null);
          buttons[op]=button;actions.append(button);
        }
      }
      const section=el('section','qq-card-image'),title=el('h4','',word(outgoingNames.get(id)));
      section.dataset.cardImage=id;title.id='qq-title-'+id;section.setAttribute('aria-labelledby',title.id);
      const image=el('img','qq-card-image-preview'),selection=el('div','qq-card-image-selection'),tools=el('div');
      image.alt=word('qqCardAlt'+type);image.dataset.previewAsset=id;image.hidden=true;
      imageStatus.setAttribute('role','status');imageStatus.id='qq-status-'+id;
      box.setAttribute('aria-describedby',imageStatus.id);
      label.lastElementChild.textContent=word('qqCardRequest'+type);
      const retry=el('button','secondary',word('qqCardRetry'));retry.type='button';retry.dataset.operation='retry';retry.hidden=true;
      retry.onclick=()=>{(buttons.library||buttons.choose).focus();control.read=null;renderQQOutgoing(state.qq.groups);};
      actions.prepend(retry);tools.append(imageStatus,actions);selection.append(image,tools);
      section.append(title,selection);
      if(type!=='Sticker')section.append(label,reactionLabel);
      outgoingList.append(section);
      if(collection&&isSticker(id)){
        control.gallery=window.ArcadeQQStickerCollection.create({
          zh:language==='zh',addButton:buttons.library,
          loadPreview:item=>{
            const view=outgoingView;
            return window.arcade.botGroupCardImagePreview({...credentialContext,expectedAccountId:state.qq.expectedAccountId,
              groupId:view.group,roleId:view.row.roleId,assetId:id,id:item.id,expectedImage:item.sha256,
              expectedStickerRevision:view.row.stickerRevision});
          },
          onRemove:item=>changeCollection(outgoingView,id,{operation:'remove',id:item.id})
        });
        control.fallback=[selection];
        section.append(control.gallery.element);
      }
      return Object.assign(control,{image,retry,type});
    });
    const pictures=outgoingList.querySelectorAll('[data-card-image^="card-"]');
    if(pictures.length)outgoingList.prepend(...pictures,recordingControls);
    outgoingList.dataset.key=listKey;
  }
  function renderCardImagePreview(control,view,pic,visible){
    const {id,image,imageStatus,buttons,retry,type}=control;
    const named=isSticker(id)&&view.row?.namedSticker;
    if(buttons.choose){
      buttons.choose.hidden=!!named;buttons.choose.textContent=word((pic?'qqCardReplace':'qqCardPick')+type);
      buttons.remove.hidden=!pic||!!named;
    }
    if(buttons.restore){
      buttons.restore.hidden=!named;
      buttons.restore.textContent=word(!cardImage(id)?'qqNamedRestoreDefault':view.row?.images?.[id]?'qqNamedRestoreFile':'qqNamedClear');
    }
    const hash=visible&&pic?.sha256;
    if(hash&&control.read?.view===view&&control.read.hash===hash&&control.read.name===named?.name)return;
    control.read=null;image.hidden=true;image.removeAttribute('src');retry.hidden=true;
    if(!hash){
      const hint=pic?'':word(cardImage(id)?'qqCardEmpty'+type:'qqNamedDefault');
      if(imageStatus.textContent!==hint)imageStatus.textContent=hint;
      return;
    }
    const read={view,hash,name:named?.name};
    control.read=read;imageStatus.textContent=word('qqCardLoading');
    const current=()=>control.read===read&&outgoingView===view&&image.isConnected;
    const request={...credentialContext,expectedAccountId:state.qq.expectedAccountId,
      groupId:view.group,roleId:view.row.roleId,assetId:id,expectedImage:hash};
    async function load(){
      try{
        const result=await window.arcade.botGroupCardImagePreview(request);
        if(!current())return;
        if(result?.sha256!==hash||typeof result.dataUrl!=='string'||result.dataUrl.length>710000||
          !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(result.dataUrl))throw Error('Invalid preview');
        image.src=result.dataUrl;await image.decode();
        if(!current())return;
        image.hidden=false;
        imageStatus.textContent=(named?named.name+' · ':language==='zh'?'本群选图 · ':'Selected image · ')+pic.width+' × '+pic.height;
      }catch{
        if(!current())return;
        image.removeAttribute('src');image.hidden=true;retry.hidden=false;imageStatus.textContent=word('qqCardUnreadable');
      }
    }
    void load();
  }
  function acceptMediaSnapshot(view,before,saved,initialAvailability){
    if(outgoingView!==view||view.group!==saved.groupId)return false;
    const current=state.qq.groups.outgoingMedia?.find(row=>row.groupId===saved.groupId&&row.roleId===saved.roleId);
    if(!current)return false;
    const currentSnapshot=mediaSnapshotKey(current);
    const previous=view.ack?.before===currentSnapshot?view.ack.row:current;
    if(mediaKey(previous)!==before&&mediaKey(current)!==mediaKey(saved))return false;
    // A late "checking" receipt must not hide an already verified copy.
    const verified=initialAvailability!==undefined && recordingState(current)!==initialAvailability &&
      mediaKey(current)===mediaKey(saved)&&recordingState(current)!=='checking'&&recordingState(saved)==='checking';
    view.ack=verified||currentSnapshot===mediaSnapshotKey(saved)?null:{before:currentSnapshot,row:saved};
    renderQQOutgoing(state.qq.groups);
    return true;
  }
  const groupCardVoiceHost=$('bot-qq-group-card-voice');
  let groupCardVoicePicker,groupCardVoiceShown;
  function renderGroupCardVoice(cardVoice,view,assets,visible){
    if(!groupCardVoiceHost)return;
    groupCardVoiceHost.hidden=!visible||!cardVoice||typeof window.arcade.botCharacterVoice!=='function'||!window.ArcadeCharacterVoice;
    if(groupCardVoiceHost.hidden){
      groupCardVoiceShown=null;groupCardVoicePicker?.clear();return;
    }
    const key=JSON.stringify([view.scope,cardVoice.groupId,cardVoice.roleId]);
    groupCardVoicePicker??=window.ArcadeCharacterVoice({
      groupCard:true,tr:(zh,en)=>language==='zh'?zh:en,
      send:({profile,v},request)=>window.arcade.botCharacterVoice({...profile,accountId:v.accountId,
        groupId:v.groupId,roleId:v.roleId,revision:v.revision,...request}),
      current:start=>!!start&&groupCardVoiceShown?.context===start.context&&!groupCardVoiceHost.hidden,
      applied:(start,saved)=>{
        const shown=groupCardVoiceShown;
        if(!saved||shown.v.roleId!==saved.roleId||shown.v.groupId!==saved.groupId||
          shown.v.revision!==start.v.revision&&shown.v.revision!==saved.revision)return;
        if(shown.v.revision===saved.revision)return;
        groupCardVoiceShown={...shown,observed:shown.v.revision,v:{...shown.v,...saved}};
        void groupCardVoicePicker.bind(groupCardVoiceShown);
      }
    });
    if(!groupCardVoiceHost.contains(groupCardVoicePicker.panel))groupCardVoiceHost.append(groupCardVoicePicker.panel);
    const shown=groupCardVoiceShown;
    if(shown?.key===key&&(shown.v.revision===cardVoice.revision||shown.observed===cardVoice.revision)){
      if(shown.v.revision===cardVoice.revision)shown.observed=null;
      shown.v.selected=assets;
    }else groupCardVoiceShown={key,context:shown?.key===key?shown.context:{},profileId:credentialContext.profileId,
      profile:credentialContext,v:{...cardVoice,selected:assets}};
    void groupCardVoicePicker.bind(groupCardVoiceShown);
  }
  function renderQQOutgoing(config){
    const accountId=state?.qq?.expectedAccountId;
    outgoingSection.hidden=state?.channel!=='qq'||!Array.isArray(config.outgoingMedia);
    if(outgoingSection.hidden){window.ArcadeQQGroupWebSettings?.update(null);renderGroupCardVoice(null,null,[],false);outgoingView=null;window.ArcadeQQNamedStickerPicker?.sync();mediaControls([],false);renderDailySave();return;}
    $('bot-qq-outgoing-account').textContent=qqNumber.test(accountId)?(language==='zh'?'发送账号 QQ ':'Sending QQ account ')+accountId:'';
    const rows=config.outgoingMedia.filter(row=>qqNumber.test(row.groupId)&&Array.isArray(row.assets)&&
      row.availableAssets?.length&&row.availableAssets.every(id=>outgoingNames.has(id)));
    const dailyGroup=dailyPolicyGroup();
    const accountEdited=connectionDrafts.has('bot-qq-expected-account');
    const targetRemoved=dailyGroup&&(!$('bot-qq-groups-enabled').checked||!readQQGroupIds().includes(dailyGroup));
    const edited=accountEdited||(qqGroupsDirty||qqGroupsSaving)&&(!dailyGroup||targetRemoved);
    // Independent group changes must not replace the selected group's draft or its pending receipt.
    const targets=dailyGroup===null?rows:rows.filter(row=>row.groupId===dailyGroup);
    const scope=JSON.stringify([lastCredentialScope,accountId,targets.map(row=>[row.groupId,row.roleId]),dailyGroup===null?edited:accountEdited,state.status,dailyGroup]);
    if(outgoingView?.scope!==scope)outgoingView={scope,group:dailyGroup===null?(rows.length===1?rows[0].groupId:''):(rows.some(row=>row.groupId===dailyGroup)?dailyGroup:''),key:null,pending:false,feedback:''};
    const view=outgoingView,observed=rows.find(item=>item.groupId===view.group);
    if(view.ack&&mediaSnapshotKey(observed)!==view.ack.before)view.ack=null;
    const oldRow=view.row,row=view.ack?.row||observed;
    view.row=row;
    window.ArcadeQQNamedStickerPicker?.sync();
    const locked=state.status!=='disconnected'&&!(state.status==='connected'&&config.active===true);
    window.ArcadeQQGroupWebSettings?.update(observed?{
      target:{...credentialContext,expectedAccountId:accountId,groupId:observed.groupId,roleId:observed.roleId},
      daily:dailyGroup!==null,lookup:observed.publicLookup,roleName:observed.roleName,language,locked:locked||edited||!!targetRemoved,
      active:state.status==='connected'&&config.active===true&&!config.pausedGroupIds?.includes(observed.groupId),
    }:null);
    roleOptions(outgoingGroup,word('qqOutgoingChoose'),rows.map(item=>[item.groupId,item.groupId+' · '+item.roleName]),view.group);
    const recording=row?.recording,card=row?.availableAssets.includes('card-recording'),hasRecording=row?.availableAssets.some(recordingAsset);
    const availability=recordingState(row),checking=availability==='checking';
    const reactions=mediaReactions(row),key=JSON.stringify([language,mediaKey(row)]);
    const keepDraft=view.pendingAsset&&mediaKey(oldRow,view.pendingAsset)===mediaKey(row,view.pendingAsset);
    mediaControls(row?.availableAssets||[],Boolean(dailyGroup),Array.isArray(row?.namedStickers));
    if(view.key!==key){
      view.key=key;view.saved=row?.assets.slice()||[];view.savedReactions=reactions.slice();
      for(const {id,box,reaction} of outgoingControls){
        if(keepDraft&&id!==view.pendingAsset)continue;
        if(keepDraft&&view.collectionEdit&&oldRow&&row&&oldRow.assets.includes(id)===row.assets.includes(id)&&
            mediaReactions(oldRow).includes(id)===reactions.includes(id)&&
            JSON.stringify(stickerIdentity(oldRow.namedSticker))===JSON.stringify(stickerIdentity(row.namedSticker)))continue;
        box.checked=view.saved.includes(id);reaction.checked=reactions.includes(id);
      }
      view.feedback='';
    }
    outgoingGroup.disabled=dailyGroup!==null||edited||view.pending||!rows.length;
    outgoingFields.hidden=!row;
    $('bot-qq-outgoing-recording').hidden=!hasRecording;
    if(hasRecording){
      $('bot-qq-outgoing-recording').querySelector('[data-bot="qqOutgoingRecordingNote"]').textContent=word(card?'qqCardRecordingNote':'qqOutgoingRecordingNote');
      const repair=!!recording&&!checking&&availability!=='available';
      $('bot-qq-outgoing-pick').textContent=repair?(language==='zh'?'重新选择 WAV 录音':'Choose the WAV again'):word(card?'qqCardPickWav':'qqOutgoingPick');
      const duration=recording&&Number.isFinite(recording.durationSeconds)?new Intl.NumberFormat(language,{maximumFractionDigits:1}).format(recording.durationSeconds):null;
      const status=$('bot-qq-outgoing-recording-state');
      status.dataset.availability=availability;
      status.textContent=recordingStatusCopy[availability]?.[language==='zh'?0:1]||
        (duration?(language==='zh'?'已选定 '+duration+' 秒录音。':'Selected recording · '+duration+' s.'):word(card?'qqCardNoWav':'qqOutgoingNoRecording'));
      $('bot-qq-outgoing-pick').disabled=locked||edited||!!view.pending;
      $('bot-qq-outgoing-remove').disabled=locked||edited||!!view.pending||!recording;
    }
    if(view.restoring && (view.restoring!==recording?.sha256||!checking)){
      if(view.restoring===recording?.sha256&&availability==='available')view.feedback='qqOutgoingClipRestored';
      view.restoring=null;
    }
    if(view.feedback==='qqOutgoingClipRestored'&&availability!=='available')view.feedback='';
    outgoingFields.disabled=!row||locked||edited||view.pending;
    const showPreviews=outgoingSection.open&&!accountEdited&&outgoingSection.closest('#qq-daily-policy-panel')?.hidden===false;
    renderGroupCardVoice(observed?.cardVoice,view,row?.assets,outgoingSection.open&&!outgoingFields.disabled&&
      (dailyGroup===null||showPreviews));
    for(const control of outgoingControls){
      const {id,box,reaction,buttons,imageStatus}=control;
      const pic=selectedImage(row,id),named=isSticker(id)&&row?.namedSticker;
      if(control.source){control.source.hidden=!named;control.source.textContent=named?.name||'';}
      if(buttons){
        if(control.image)renderCardImagePreview(control,view,pic,showPreviews&&!(control.gallery&&named));
        else {
          imageStatus.textContent=pic?(named?named.name+' · ':language==='zh'?'本群选图 · ':'Selected image · ')+pic.width+' × '+pic.height:word('qqCardImageEmpty');
          buttons.choose.hidden=buttons.remove.hidden=!!named;
        }
        if(buttons.remove)buttons.remove.disabled=!pic;
        if(buttons.portrait)buttons.portrait.hidden=!row.hasCardPortrait;
      }
      if(control.gallery){
        for(const element of control.fallback)element.hidden=!!named;
        control.gallery.update({items:row.namedStickers,scope:view.scope+':'+row.groupId,revision:row.stickerRevision,
          limit:row.namedStickerLimit,prefer:view.preferSticker,visible:showPreviews});
        view.preferSticker=null;
      }
      const missing=recordingAsset(id)&&recording&&availability!=='available'&&!checking;
      if(missing&&!view.saved.includes(id))box.checked=false;
      if(missing&&!view.savedReactions.includes(id))reaction.checked=false;
      if(recordingAsset(id)){
        box.setAttribute('aria-describedby','bot-qq-outgoing-recording-state');
        reaction.setAttribute('aria-describedby','bot-qq-outgoing-recording-state');
      }
      box.disabled=recordingAsset(id)&&(!recording||missing&&!box.checked)||cardImage(id)&&!pic;
      reaction.disabled=!box.checked||box.disabled||missing&&!reaction.checked;
      if(!box.checked||box.disabled)reaction.checked=false;
      if(recordingAsset(id)&&checking){
        box.disabled=!view.saved.includes(id)&&!box.checked;
        reaction.disabled=!box.checked||!view.savedReactions.includes(id)&&!reaction.checked;
      }
    }
    const hasDraft=outgoingControls.some(({id,box,reaction})=>
      box.checked!==view.saved.includes(id)||reaction.checked!==view.savedReactions.includes(id));
    view.blockedDraft=hasDraft&&targetRemoved;
    const pendingGrant=checking&&outgoingControls.some(({id,box,reaction})=>recordingAsset(id)&&
      (box.checked&&!view.saved.includes(id)||reaction.checked&&!view.savedReactions.includes(id)));
    outgoingSave.disabled=outgoingFields.disabled||!hasDraft||pendingGrant;
    const message=view.blockedDraft?'qqDailyMediaRemoved':edited?'qqOutgoingEdited':locked?'qqOutgoingPending':!rows.length?'qqOutgoingEmpty':view.feedback;
    const destination=view.feedback&&message===view.feedback&&row?' · QQ '+accountId+' · '+row.groupId+' · '+row.roleName:'';
    $('bot-qq-outgoing-status').textContent=message?word(message)+destination:'';
    renderDailySave();
  }
  outgoingSection.addEventListener('toggle',()=>{if(state?.qq?.groups)renderQQOutgoing(state.qq.groups);});
  outgoingGroup.onchange=()=>{if(outgoingView&&!outgoingGroup.disabled){outgoingView.group=outgoingGroup.value;outgoingView.ack=null;renderQQOutgoing(state.qq.groups);}};
  outgoingFields.onchange=event=>{
    if(!outgoingView||groupCardVoiceHost?.contains(event.target))return;
    if(dailyPolicyGroup()&&!qqGroupsDirty)qqGroupsFeedback='';
    const source=event.target.value;
    if(event.target.checked&&(['card-speech','card-recording','whale-speech','whale-recording'].includes(source))){
      const other=outgoingControls.find(({id})=>id===(source.endsWith('-speech')?source.replace('-speech','-recording'):source.replace('-recording','-speech')));
      if(other){other.box.checked=false;other.reaction.checked=false;}
    }
    outgoingView.feedback='';renderQQOutgoing(state.qq.groups);
  };
  async function saveOutgoingMedia(){
    if(!outgoingView||outgoingSave.disabled)return;
    const view=outgoingView,assets=outgoingControls.filter(item=>item.box.checked).map(item=>item.id);
    const reactionAssets=outgoingControls.filter(item=>item.reaction.checked).map(item=>item.id);
    const row=view.row,before=mediaKey(row);
    if(!row)return;
    const choice={expectedAccountId:state.qq.expectedAccountId,groupId:view.group,roleId:row.roleId,expectedAssets:view.saved.slice(),assets,
      expectedReactionAssets:view.savedReactions.slice(),reactionAssets,
      expectedStickerReaction:view.savedReactions.some(id=>id.endsWith('-sticker')),stickerReaction:reactionAssets.some(id=>id.endsWith('-sticker'))};
    if(assets.some(recordingAsset))choice.recordingId=row.recording?.sha256;
    const savesSticker=assets.some(isSticker)||view.saved.some(isSticker);
    if(savesSticker&&row.stickerRevision)choice.expectedStickerRevision=row.stickerRevision;
    if(row.namedSticker&&assets.some(isSticker))choice.namedSticker=stickerIdentity(row.namedSticker);
    const pictures=assets.filter(id=>cardImage(id)&&!(isSticker(id)&&row.namedSticker));
    if(pictures.length)choice.imageIds=Object.fromEntries(pictures.map(id=>[id,row.images[id].sha256]));
    view.pending=true;renderQQOutgoing(state.qq.groups);
    try{
      const next=await window.arcade.botConfigure({...credentialContext,qqGroupMediaSelection:choice});
      const saved=next?.qq?.groups?.outgoingMedia?.find(row=>row.groupId===choice.groupId&&row.roleId===choice.roleId);
      const stickerId=row.availableAssets.find(isSticker);
      const revisesLegacy=!!row.namedSticker&&Array.isArray(row.namedStickers)&&
        (choice.expectedAssets.includes(stickerId)!==assets.includes(stickerId)||choice.expectedReactionAssets.includes(stickerId)!==reactionAssets.includes(stickerId));
      const correctRevision=revisesLegacy?!!saved?.stickerRevision&&saved.stickerRevision!==row.stickerRevision:
        (row.stickerRevision??null)===(saved?.stickerRevision??null);
      if(next?.qq?.expectedAccountId!==choice.expectedAccountId||JSON.stringify(saved?.assets)!==JSON.stringify(assets)||
        saved?.stickerReaction!==choice.stickerReaction||JSON.stringify(mediaReactions(saved))!==JSON.stringify(reactionAssets)||
        savesSticker&&(!correctRevision||JSON.stringify(stickerIdentity(row.namedSticker))!==JSON.stringify(stickerIdentity(saved.namedSticker)))||
        choice.recordingId&&saved.recording?.sha256!==choice.recordingId||pictures.some(id=>saved.images?.[id]?.sha256!==choice.imageIds[id]))throw Error('Group changed');
      if(!acceptMediaSnapshot(view,before,saved))throw Error('Group changed');
      view.feedback=next.status==='connected'&&next.qq.groups.active===true?'qqOutgoingLive':'qqOutgoingSaved';
    }catch{if(outgoingView===view)view.feedback='qqOutgoingFailed';}
    finally{view.pending=false;if(outgoingView===view)renderQQOutgoing(state.qq.groups);}
  }
  outgoingSave.onclick=saveOutgoingMedia;
  function openNamedStickerPicker(control,opener){
    const view=outgoingView,row=view?.row,id=control.id;
    if(!row||view.pending||outgoingFields.disabled||!dailyPolicyGroup())return;
    const before=mediaKey(row),target={...credentialContext,expectedAccountId:state.qq.expectedAccountId,groupId:row.groupId,roleId:row.roleId};
    window.ArcadeQQNamedStickerPicker.open({target,roleName:row.roleName,language,opener,previous:row.namedSticker,collection:row.namedStickers,
      granted:row.assets.includes(id),current:()=>outgoingView===view&&mediaKey(view.row)===before&&!view.pending&&opener.isConnected,
      apply:(item,uses)=>Array.isArray(row.namedStickers)?
        changeCollection(view,id,{operation:'add',name:item.name,sourceSha256:item.sha256,...uses}):changeNamedSticker(view,id,item)});
  }
  async function changeCollection(view,assetId,change){
    if(!view||view!==outgoingView||!view.row||view.pending||outgoingFields.disabled)return;
    const row=view.row,before=mediaKey(row);
    const request={...change,expectedAccountId:state.qq.expectedAccountId,groupId:view.group,roleId:row.roleId,
      expectedStickerRevision:row.stickerRevision??null};
    view.pending=true;view.pendingAsset=assetId;view.collectionEdit=true;renderQQOutgoing(state.qq.groups);
    try{
      const result=await window.arcade.botConfigure({...credentialContext,qqGroupNamedSticker:request});
      const saved=result?.qq?.groups?.outgoingMedia?.find(r=>r.groupId===request.groupId&&r.roleId===request.roleId);
      if(outgoingView!==view||result?.qq?.expectedAccountId!==request.expectedAccountId||!Array.isArray(saved?.namedStickers)||
          !saved.stickerRevision||saved.stickerRevision===request.expectedStickerRevision)throw Error('Group changed');
      const item=change.operation==='add'?
        saved.namedStickers.find(s=>s.name===change.name&&s.sourceSha256===change.sourceSha256):
        saved.namedStickers.find(s=>s.id===change.id);
      if(change.operation==='remove'?!!item:(!item||item.request!==change.request||item.reaction!==change.reaction))throw Error('Selection changed');
      view.preferSticker=item?.id;
      if(!acceptMediaSnapshot(view,before,saved))throw Error('Group changed');
      view.feedback={add:'qqCollectionAdded',remove:'qqCollectionRemoved'}[change.operation];
    }catch{if(outgoingView===view)view.feedback='qqOutgoingFailed';}
    finally{view.pending=false;view.pendingAsset=null;view.collectionEdit=false;if(outgoingView===view)renderQQOutgoing(state.qq.groups);}
  }
  async function changeNamedSticker(view,id,item){
    if(!view||view!==outgoingView||!view.row||view.pending||outgoingFields.disabled)return;
    const row=view.row,before=mediaKey(row);
    const request={expectedAccountId:state.qq.expectedAccountId,groupId:view.group,roleId:row.roleId,
      expectedNamedSticker:stickerIdentity(row.namedSticker),expectedStickerRevision:row.stickerRevision??null,operation:item?'select':'restore'};
    if(item){request.name=item.name;request.sourceSha256=item.sha256;}
    view.pending=true;view.pendingAsset=id;renderQQOutgoing(state.qq.groups);
    try{
      const result=await window.arcade.botConfigure({...credentialContext,qqGroupNamedSticker:request});
      const saved=result?.qq?.groups?.outgoingMedia?.find(r=>r.groupId===request.groupId&&r.roleId===request.roleId);
      if(result?.qq?.expectedAccountId!==request.expectedAccountId||!saved||!saved.stickerRevision||saved.stickerRevision===request.expectedStickerRevision||
        saved.assets.includes(id)||mediaReactions(saved).includes(id)||
        (item?saved.namedSticker?.name!==item.name||saved.namedSticker?.sourceSha256!==item.sha256:!!saved.namedSticker))throw Error('Group changed');
      if(acceptMediaSnapshot(view,before,saved))view.feedback=item?'qqNamedChanged':'qqNamedRestored';
    }catch{if(outgoingView===view)view.feedback='qqCardImageFailed';}
    finally{view.pending=false;view.pendingAsset=null;if(outgoingView===view)renderQQOutgoing(state.qq.groups);}
  }
  async function changeMediaFile(assetId,operation){
      const view=outgoingView,row=view?.row,before=mediaKey(row);
      if(view?.pending||!row?.availableAssets.includes(assetId)||outgoingFields.disabled)return;
      const picture=cardImage(assetId),hash=(picture?row.images?.[assetId]:row.recording)?.sha256||null;
      const request={expectedAccountId:state.qq.expectedAccountId,groupId:row.groupId,roleId:row.roleId,operation,
        ...(picture?{assetId,expectedImage:hash}:{expectedRecording:hash})};
      view.pending=true;view.pendingAsset=assetId;renderQQOutgoing(state.qq.groups);
      try{
        const next=await window.arcade.botConfigure({...credentialContext,[picture?'qqGroupCardImage':'qqGroupMediaRecording']:request});
        if(!next)return;
        const saved=next.qq?.groups?.outgoingMedia?.find(item=>item.groupId===row.groupId&&item.roleId===row.roleId);
        const newHash=(picture?saved?.images?.[assetId]:saved?.recording)?.sha256||null;
        if(next.qq?.expectedAccountId!==request.expectedAccountId||!saved||(operation==='remove'&&newHash)||
          (operation==='portrait'&&!newHash)||newHash!==hash&&saved.assets.includes(assetId))throw Error('Group changed');
        const initialAvailability=recordingState(row);
        if(acceptMediaSnapshot(view,before,saved,initialAvailability)){
          const original=!picture&&operation==='choose'&&hash&&newHash===hash&&
            initialAvailability!=='available'&&initialAvailability!=='checking';
          const availability=recordingState(view.row);
          if(original&&availability==='checking'){view.restoring=hash;view.feedback='';}
          else view.feedback=original&&availability==='available'?'qqOutgoingClipRestored':(picture?'qqCardImage':'qqOutgoingClip')+
            (operation==='remove'?'Removed':newHash===hash?'Unchanged':'Selected');
        }
      }catch{if(outgoingView===view)view.feedback=picture?'qqCardImageFailed':'qqOutgoingRecordingFailed';}
      finally{view.pending=false;view.pendingAsset=null;if(outgoingView===view)renderQQOutgoing(state.qq.groups);}
  }
  for(const [id,operation] of [['bot-qq-outgoing-pick','choose'],['bot-qq-outgoing-remove','remove']]){
    $(id).onclick=()=>{if(!$(id).disabled)changeMediaFile(outgoingView?.row?.availableAssets.find(recordingAsset),operation);};
  }
  Object.assign(words.zh,{qqDailyPolicyFailed:'群策略保存结果未能确认。请核对当前设置后重试。',qqDailyPolicySaved:'群设置已保存，下次连接时生效。',
    qqDailySaveBoth:'保存素材和群策略',qqDailyMediaFailed:'本群素材未确认保存，请核对素材后重试。',qqDailySaving:'正在保存…',
    qqDailyMediaRemoved:'当前群策略将停用本群素材。恢复普通接话和本群选择后，可继续保存素材草稿。',qqDailyReviewPolicy:'素材目标已变，群策略仍待保存。请核对后重试。'});
  Object.assign(words.en,{qqDailyPolicyFailed:'Could not confirm the group settings. Review them and try again.',qqDailyPolicySaved:'Group settings saved for the next connection.',
    qqDailySaveBoth:'Save media and group settings',qqDailyMediaFailed:'Could not confirm media permissions. Review the selected media and retry.',qqDailySaving:'Saving…',
    qqDailyMediaRemoved:'These group settings will disable media for this group. Restore replies and the selected group to save the media draft.',qqDailyReviewPolicy:'The media target changed. Review and save the pending group settings.'});
  function dailyPolicyReady(){
    return qqGroupsDirty&&!qqGroupsSaving&&(state?.status==='disconnected'||onlineGroupPolicy()&&state.qq.groups.active===true);
  }
  function dailyMediaReady(){
    return !outgoingSection.hidden&&!outgoingSave.disabled;
  }
  function renderDailySave(){
    const saving=dailySaveJob!==null&&dailySaveJob.epoch===dailyPolicyEpoch;
    $('bot-qq-groups').inert=saving;
    const button=$('bot-qq-groups-save');
    if(!button.closest('#qq-daily-policy-footer'))return;
    const media=dailyMediaReady(),policy=dailyPolicyReady();
    const online=onlineGroupPolicy()&&state.qq.groups.active;
    let label=online||qqPolicyPrevious?'qqLivePolicySave':'qqGroupsSave';
    if(media)label=policy?'qqDailySaveBoth':'qqOutgoingSave';
    button.textContent=word(saving?'qqDailySaving':label);
    button.disabled=saving||qqGroupsSaving||!!outgoingView?.pending||!dailyPolicyGroup()||!(media||policy);
    const mediaResult=outgoingView?.feedback;
    const notices=[];
    if(outgoingView?.blockedDraft)notices.push(word('qqDailyMediaRemoved'));
    if(mediaSaveNotices.has(mediaResult))notices.push(word(mediaResult==='qqOutgoingFailed'?'qqDailyMediaFailed':mediaResult));
    if(qqGroupsFeedback)notices.push(word(qqGroupsFeedback));
    const notice=notices.join(' ');
    const feedback=$('bot-qq-groups-feedback');
    if(feedback.textContent!==notice)feedback.textContent=notice;
  }
  async function saveDailySettings(){
    if($('bot-qq-groups-save').disabled)return;
    const job={epoch:dailyPolicyEpoch},view=outgoingView,status=state.status;
    const media=dailyMediaReady(),policy=dailyPolicyReady();
    dailySaveJob=job;renderDailySave();
    try{
      if(media)await saveOutgoingMedia();
      if(policy&&job.epoch===dailyPolicyEpoch&&status===state.status&&dailyPolicyReady()){
        if(view===outgoingView)await saveQQGroups();
        else qqGroupsFeedback='qqDailyReviewPolicy';
      }
    }finally{
      if(dailySaveJob===job){dailySaveJob=null;renderDailySave();}
    }
  }
  function renderQQGroups(scopeChanged,locked){
    const config=state?.qq?.groups||{enabled:false,groupIds:[],proactive:false};
    const daily=dailyPolicyGroup(),target=daily===null?null:JSON.stringify([lastCredentialScope,state?.qq?.expectedAccountId,daily]);
    if(target!==dailyPolicyTarget||scopeChanged||qqGroupsDirty&&qqDraftStatus!==state?.status){
      dailyPolicyTarget=target;dailyPolicyEpoch++;dailyPolicyBefore=null;
      qqGroupsDirty=false;qqGroupsFeedback='';qqPolicyPrevious=null;
    }
    if(!qqGroupsSaving&&qqGroupsDirty&&(qqPolicyPrevious&&policyKey(qqPolicyPrevious)!==policyKey(policyFields(config))||
      dailyPolicyBefore!==null&&savedGroupKey(config)!==dailyPolicyBefore)){
      qqGroupsDirty=false;qqPolicyPrevious=null;dailyPolicyBefore=null;
      if(!['qqDailyPolicyFailed','qqLivePolicyFailed'].includes(qqGroupsFeedback))qqGroupsFeedback='qqLivePolicyChanged';
    }
    const onlinePolicy=onlineGroupPolicy();
    const waitingForGroup=daily!==null&&onlinePolicy&&config.active!==true;
    const livePolicy=onlinePolicy&&!waitingForGroup&&!qqGroupsSaving;
    if(!qqGroupsDirty){
      $('bot-qq-groups-enabled').checked=config.enabled===true;
      $('bot-qq-group-ids').value=(config.groupIds||[]).join('\n');
      $('bot-qq-groups-proactive').checked=config.proactive===true;
      for(const {key,selected} of qqGroupOptions){
        selected.clear();
        for(const groupId of config[key]||[])selected.add(groupId);
      }
    }
    renderQQGroupDirectory(scopeChanged);
    const gateAccountReady=qqNumber.test(state?.qq?.expectedAccountId||'')&&!connectionDrafts.has('bot-qq-expected-account');
    renderQQGroupOptions(locked||qqGroupsSaving,state?.status==='connected'?config.voiceSources:undefined,gateAccountReady,livePolicy);
    renderQQGroupAsr(config.asrAvailability);
    for(const id of ['bot-qq-groups-enabled','bot-qq-group-ids','bot-qq-groups-proactive','bot-qq-groups-save'])$(id).disabled=locked||qqGroupsSaving;
    $('bot-qq-groups-proactive').disabled=(locked&&!livePolicy)||qqGroupsSaving||!$('bot-qq-groups-enabled').checked;
    if(livePolicy)$('bot-qq-groups-save').disabled=!qqGroupsDirty;
    if(daily!==null&&!qqGroupsDirty)$('bot-qq-groups-save').disabled=true;
    const replyLabel=word(daily===null?'qqGroupsEnabled':'qqDailyReplies');
    const dailyLabels=[
      ['qqGroupsEnabled',replyLabel+' · 此搭档的全部已授权群',replyLabel+' · all authorized groups for this companion'],
      ['qqGroupsProactive','主动说话 · 此搭档的全部已授权群','Start conversations · all authorized groups for this companion'],
      ['qqGroupImages','本群图片','Group images'],
      ['qqGroupVoice','本群语音','Group voice'],
      ['qqGroupImagesNote','获准后，受支持的图片可能发送给当前 AI 服务商。','Permitted images may be sent to the current AI provider.'],
      ['qqGroupVoiceNote','群语音在本机识别，转写文字可能发送给当前 AI 服务商。','Audio is transcribed locally. The transcript may be sent to the current AI provider.'],
    ];
    for(const [key,zh,en] of dailyLabels){
      const label=$('bot-qq-groups').querySelector('[data-bot="'+key+'"]');
      const text=daily===null?word(key):(language==='zh'?zh:en);
      if(label&&label.textContent!==text)label.textContent=text;
    }
    $('bot-qq-groups-save').textContent=word(livePolicy||qqPolicyPrevious?'qqLivePolicySave':'qqGroupsSave');
    const lockKey={connected:'qqGroupsOnline',connecting:'qqGroupsConnecting',disconnecting:'qqGroupsDisconnecting',checking:'qqGroupsChecking',pairing:'qqGroupsPairing'}[state?.status];
    const onlineMembership=state?.status==='connected'&&Boolean(config.membershipRevision)&&typeof window.arcade?.botGroupMembershipSet==='function';
    const membershipNote=language==='zh'?'QQ 在线。可在群设置上方管理名单，修改连接设置仍需先断开。':
      'QQ is online. Manage the group list at the top of Group settings. Disconnect to edit connection settings.';
    const groupWaitingNote=language==='zh'?'QQ 已连接，正在等待群连接就绪。就绪后即可编辑。':
      'QQ is connected. Waiting for the group connection before you can edit these settings.';
    const lockNote=qqGroupsSaving?word('qqGroupsPending'):waitingForGroup?groupWaitingNote:onlineMembership?membershipNote:
      livePolicy?word('qqLivePolicyScope'):locked?word(lockKey||'qqGroupsLocked'):'';
    const optionNote=(livePolicy?'':lockNote)||(!$('bot-qq-groups-enabled').checked?word('qqGroupsEnableFirst').replace('{label}',replyLabel):'');
    const imageUnavailable=daily!==null&&config.active&&config.imageGroupIds?.includes(daily)&&config.capabilities?.images===false;
    const imageNote=imageUnavailable?(language==='zh'?'当前连接无法处理本群图片。':'This connection cannot process group images.'):'';
    for(const [id,note] of [['bot-qq-groups-edit-note',lockNote],['bot-qq-group-images-edit-note',[optionNote,imageNote].filter(Boolean).join(' ')],
      ['bot-qq-group-voice-edit-note',optionNote],['bot-qq-groups-proactive-edit-note',livePolicy?word('qqLiveProactiveScope')+' '+
        config.groupIds.filter(id=>!config.pausedGroupIds?.includes(id)).join('、'):optionNote],
      ['bot-qq-groups-local-gate-edit-note',livePolicy?word('qqLiveGateLocked'):optionNote||(!gateAccountReady?word('qqGroupsLocalGateAccount'):'')]]){
      const hint=$(id);
      hint.hidden=!note;
      if(hint.textContent!==note)hint.textContent=note;
    }
    if(!$('bot-qq-groups-save').closest('#qq-daily-policy-footer'))$('bot-qq-groups-feedback').textContent=qqGroupsFeedback?word(qqGroupsFeedback):'';
    renderQQGroupRoles();
    renderQQOutgoing(config);
    renderQQGroupSources(config);
    const zh=language==='zh',groupCount=config.groupIds?.length||0;
    const enabledForCompanion=state?.social?.config?.proactiveMessages===true;
    let proactiveState=zh?'主动群消息已关闭。':'Proactive group messages are off.';
    if(config.proactive){
      if(enabledForCompanion)proactiveState=zh?'主动群消息已允许。':'Proactive group messages allowed.';
      else if(config.active)proactiveState=zh?'「相处方式」中的主动聊天已关闭。':'Proactive chat is off in Companion settings.';
      else proactiveState=zh?'主动群消息尚未开启，请在「相处方式」开启主动聊天。':'Turn on proactive chat in Companion settings to allow group messages.';
    }
    const savedState=zh?`已保存 ${groupCount} 个群。`:`${groupCount} ${groupCount===1?'group':'groups'} saved.`;
    $('bot-qq-groups-state').textContent=locked
      ? (config.active?`${lockNote} ${proactiveState}`:lockNote)
      : qqGroupsSaving?word('qqGroupsPending'):config.enabled?`${savedState} ${proactiveState}`:word('qqGroupsDisabled');
    if(daily){
      const paused=config.pausedGroupIds?.includes(daily);
      const replies=paused?(zh?'本群已暂停普通接话。':'Replies are paused in this group.'):
        !config.enabled?(zh?'普通接话已关闭。':'Replies are off.'):
        config.reviewRequiredGroupIds?.includes(daily)?(zh?'本群角色待重新批准。':'Review the group role to resume replies.'):
        config.active?(zh?'本群已启用普通接话，由 AI 判断是否回复。':'The AI decides when to reply in this group.'):
        (zh?'接话设置已保存，群接入尚未运行。':'Reply settings are saved. Group chat is inactive.');
      $('bot-qq-groups-state').textContent=replies+' '+(paused?(zh?'本群已暂停主动说话。':'Proactive messages are paused in this group.'):proactiveState);
    }
    const runtime=$('bot-qq-groups-runtime'),warning=groupRuntimeWarning(config,zh,false,daily);
    const mediaIssues=renderGroupMediaIssues(config,zh,daily);
    const counts=zh?`群接入运行中 · 已接收 ${Number(config.incoming)||0} · 已发送 ${Number(config.sent)||0} · 已略过 ${Number(config.skipped)||0}。这些计数不代表真人验收通过。`:
      `Group connection active · received ${Number(config.incoming)||0} · sent ${Number(config.sent)||0} · skipped ${Number(config.skipped)||0}. Counts do not prove live acceptance.`;
    runtime.hidden=!config.active&&!warning&&!mediaIssues;
    runtime.style.whiteSpace='pre-line';
    const text=warning||(config.active?counts:mediaIssues?(zh?'最近的群媒体索取':'Recent group media requests'):'');
    if(runtime.textContent!==text)runtime.textContent=text;
  }
  window.canOpenQQDailyGroupPolicy=()=>!qqGroupsDirty&&!qqGroupsSaving;
  window.syncQQDailyGroupPolicy=()=>{if(state)renderQQGroups(false,state.status!=='disconnected');};
  async function saveLiveGroupPolicy(){
    const previous=qqPolicyPrevious;
    if(!previous||!qqGroupsDirty||qqGroupsSaving||!onlineGroupPolicy())return;
    const scope=lastCredentialScope,epoch=dailyPolicyEpoch,expectedAccountId=state.qq.expectedAccountId;
    const policy={...previous,proactive:$('bot-qq-groups-proactive').checked};
    for(const {key,selected} of qqGroupOptions){
      if(key==='imageGroupIds'||key==='voiceGroupIds')policy[key]=previous.groupIds.filter(id=>selected.has(id));
    }
    qqGroupsSaving=true;renderQQGroups(false,true);
    try{
      const result=await window.arcade.botGroupPolicySet({...credentialContext,expectedAccountId,previous,policy});
      if(scope!==lastCredentialScope||epoch!==dailyPolicyEpoch||state.status!=='connected')return;
      if(result?.qq?.expectedAccountId!==expectedAccountId||!result.qq.groups||policyKey(policyFields(result.qq.groups))!==policyKey(policy))throw Error('Unconfirmed group policy');
      // Use the acknowledged fields immediately if no newer policy has arrived.
      if(policyKey(policyFields(state.qq.groups))===policyKey(previous)){
        state={...state,qq:{...state.qq,groups:{...state.qq.groups,...policy}}};
      }else if(policyKey(policyFields(state.qq.groups))!==policyKey(policy))throw Error('Group changed');
      qqGroupsDirty=false;qqPolicyPrevious=null;qqGroupsFeedback='qqLivePolicySaved';
    }catch{
      if(scope===lastCredentialScope&&epoch===dailyPolicyEpoch)qqGroupsFeedback='qqLivePolicyFailed';
    }finally{qqGroupsSaving=false;renderQQGroups(false,state?.status!=='disconnected');}
  }
  function readQQSettingsDraft(){
    const groupIds=readQQGroupIds();
    const draft={enabled:$('bot-qq-groups-enabled').checked,groupIds,proactive:$('bot-qq-groups-proactive').checked};
    for(const {key,selected} of qqGroupOptions){
      const allowed=groupIds.filter(groupId=>selected.has(groupId));
      if(allowed.length||key==='localGateGroupIds')draft[key]=allowed;
    }
    return draft;
  }
  async function saveQQGroups(){
    if(qqGroupsSaving)return;
    if(state?.status!=='disconnected'){await saveLiveGroupPolicy();return;}
    renderQQGroupDirectory();
    const scope=lastCredentialScope,epoch=dailyPolicyEpoch,daily=dailyPolicyGroup(),account=state?.qq?.expectedAccountId,context={...credentialContext};
    const qqGroups=readQQSettingsDraft(),{groupIds}=qqGroups;
    if(!validQQGroupIds(groupIds)||(qqGroups.enabled&&!groupIds.length)){
      qqGroupsFeedback='qqGroupsInvalid';$('bot-qq-groups-feedback').textContent=word(qqGroupsFeedback);$('bot-qq-group-ids').setAttribute('aria-invalid','true');$('bot-qq-group-ids').focus();return;
    }
    const directory=qqGroupDirectory,fromDirectory=directory&&groupIds.some(id=>directory.draftIds.has(id));
    if(connectionDrafts.has('bot-qq-expected-account')&&
        groupIds.some(id=>qqGroups.localGateGroupIds.includes(id)!==(state?.qq?.groups?.localGateGroupIds?.includes(id)===true))){
        qqGroupsFeedback='qqGateAccountDraft';$('bot-qq-groups-feedback').textContent=word(qqGroupsFeedback);return;
    }
    $('bot-qq-group-ids').removeAttribute('aria-invalid');qqGroupsSaving=true;renderQQGroups(false,false);
    try{
      const result=await window.arcade.botConfigure({...context,qqGroups,...(fromDirectory?{qqGroupDirectoryCheck:directory.check}:{})});
      if(scope!==lastCredentialScope||epoch!==dailyPolicyEpoch)return;
      if(daily!==null){
        const confirmed=result?.qq?.groups;
        if(result?.status!=='disconnected'||result.qq?.expectedAccountId!==account||!confirmed||
           savedGroupKey(confirmed)!==savedGroupKey(qqGroups)||
           ![dailyPolicyBefore,savedGroupKey(qqGroups)].includes(savedGroupKey(state.qq.groups)))throw Error('Unconfirmed group settings');
        state={...state,qq:{...state.qq,groups:{...state.qq.groups,...policyFields(confirmed),enabled:confirmed.enabled,localGateGroupIds:confirmed.localGateGroupIds}}};
      }
      if(qqGroupDirectory===directory)directory?.draftIds.clear();
      qqGroupsDirty=false;qqGroupsFeedback=daily===null?'qqGroupsSaved':'qqDailyPolicySaved';
    }catch(error){
      if(scope!==lastCredentialScope||epoch!==dailyPolicyEpoch)return;
      if(daily===null)throw error;
      qqGroupsFeedback='qqDailyPolicyFailed';
    }
    finally{qqGroupsSaving=false;renderQQGroups(false,state?.status!=='disconnected');}
  }
  function setSetupOpen(open,focus=false){
    const panel=$('bot-setup-panel');
    const inside=panel.contains(document.activeElement);
    panel.open=open;
    $('bot-settings-toggle').setAttribute('aria-expanded',String(open));
    if(focus){if(open){if(innerWidth<=800||document.body.classList.contains('compact'))panel.scrollIntoView({block:'start',behavior:'auto'});$('bot-settings-close').focus();}else $('bot-settings-toggle').focus({preventScroll:true});}
    else if(!open&&inside)$('bot-settings-toggle').focus({preventScroll:true});
  }
  window.openConversationSetup=(options={})=>{
    const {section,pair=false}=options;
    if(section&&!['qq-groups','qqofficial','channel','project','advanced'].includes(section))return false;
    if(section==='qq-groups'&&window.ArcadeQQDailySettings)return window.ArcadeQQDailySettings.open(options);
    switchView('bot');setSetupOpen(true,true);
    if(section)advancedGroup.open=true;
    const target=section==='qqofficial'?$('bot-qqofficial-app'):section==='qq-groups'?($('bot-qq-groups-enabled').disabled?$('bot-qq-groups-edit-note'):$('bot-qq-groups-enabled')):section==='channel'?$('bot-channel'):section==='project'?$('bot-pick'):section==='advanced'?advancedGroup.querySelector('summary'):null;
    if(target){target.scrollIntoView({block:'center',behavior:'auto'});target.focus({preventScroll:true});}
    // A saved pairing is retained. Only an explicit, unpaired WeChat setup
    // starts a new QR flow; opening connection settings never resets a login.
    if(pair&&state?.channel==='wechat'&&!state?.paired&&state?.status==='disconnected')void run(()=>window.arcade.botLogin());
  };
  function atBottom(){const pane=$('bot-thread-scroll');return pane.scrollHeight-pane.scrollTop-pane.clientHeight<64;}
  function showLatest(){const pane=$('bot-thread-scroll');pane.scrollTop=pane.scrollHeight;$('bot-latest').hidden=true;}
  function renderMessages(messages,native,active,portrait,desktopAvailable=false,localConversation=false,position=null){
    const pane=$('bot-thread-scroll'),follow=position?.follow??atBottom(),oldScroll=position?.scroll??pane.scrollTop,anchor=position?.anchor??historyPosition();
    const first=messages[0]?.id,prepend=!!first&&messageNodes.size>0&&!messageNodes.has(first)&&messages.some(m=>messageNodes.has(m.id));
    const hadMessages=messageNodes.size>0;
    const alive=new Set();
    if(!messages.length){
      messageNodes.clear();
      // No usable AI yet: the empty state is the first-run key entry card (first-run.js).
      const firstRunCard=window.ArcadeFirstRun?.inline(data);
      if(firstRunCard){if(firstRunCard.parentNode!==$('bot-messages')||$('bot-messages').childElementCount!==1){$('bot-messages').replaceChildren(firstRunCard);threadNeedsBottom=false;pane.scrollTop=0;}$('bot-latest').hidden=true;return;}
      const empty=el('div','chat-empty');
      const saved=window.selectedSavedConnection?.(data);
      // An empty conversation stays empty: this welcome is interface copy, never
      // inserted as a model message or retained as invented conversation history.
      const builtinWelcome=localConversation&&desktopAvailable&&!state?.local?.libraryCharacterId&&!state?.local?.libraryGroupId;
      const welcomeName=persona.name?.[language]||persona.name?.en||'';
      empty.append(el('h2','',builtinWelcome?(language==='zh'?`和${welcomeName}聊聊，想从哪里开始？`:`What would you like to talk about with ${welcomeName}?`):word('emptyTitle')),el('p','',desktopAvailable?(language==='zh'?'在下方输入，开始聊天。':'Type below to start chatting.'):localConversation?(language==='zh'?'准备好后，点击上方开始聊天。':'Choose Start chatting above when you are ready.'):!active&&saved?(language==='zh'?'已有连接配置。连接后，你和搭档的消息会显示在这里。':'Your connection is already configured. Messages will appear here after connecting.'):word(active?'emptyReady':'emptySetup')));
      if(builtinWelcome){
        const starters=el('div','button-row');starters.setAttribute('aria-label',language==='zh'?'聊天起步建议':'Conversation starters');
        for(const text of language==='zh'?['我想聊聊今天发生的事。','我现在有点累，想找你聊聊。','我希望你这样称呼我：']:['I would like to talk about my day.','I am a little tired and would like to chat.','I would like you to call me ']){
          const button=el('button','secondary',text);button.type='button';button.onclick=()=>{const input=$('desktop-chat-input');if(input&&!input.disabled){input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();}};starters.append(button);
        }
        empty.append(starters);
      }
      if(!active&&!saved){const connect=el('button','primary',word('openSetup'));connect.id='bot-empty-connect';connect.onclick=()=>window.openConnectionOnboarding?window.openConnectionOnboarding():setSetupOpen(true,true);empty.append(connect);}
      $('bot-messages').replaceChildren(empty);$('bot-latest').hidden=true;return;
    }
    // Keep existing message nodes intact when only a new message arrives. Polls
    // must not replace the text the owner is currently reading or selecting.
    $('bot-messages').querySelectorAll('.chat-empty,.bot-empty,#first-run-card').forEach(node=>node.remove());
    let cursor=$('bot-messages').firstElementChild;
    for(const [index,m] of messages.entries()){
      const key=m.id||`position-${index}`;alive.add(key);
      const stamp=JSON.stringify([language,native,state?.channel,portrait,persona.id,m]);
      let entry=messageNodes.get(key);
      if(!entry){entry={row:el('article',''),stamp:''};messageNodes.set(key,entry);}
      if(entry.stamp!==stamp){
        const row=entry.row,user=m.role==='user';
        row.className=`bot-message ${user?'from-user':'from-agent'}`;row.dataset.role=user?'user':'assistant';row.dataset.messageId=key;
        const meta=el('div','message-meta');if(!user&&portrait==='anime'){const image=el('img','message-avatar');image.src=persona.portrait;image.alt='';meta.append(image);}meta.append(el('span','message-author',word(user?'you':'agent')));
        if(typeof m.at==='number'&&Number.isFinite(m.at)&&!Number.isNaN(new Date(m.at).getTime())){const time=el('time','',new Date(m.at).toLocaleTimeString(language==='zh'?'zh-CN':'en',{hour:'2-digit',minute:'2-digit'}));time.dateTime=new Date(m.at).toISOString();meta.append(time);}
        if(typeof m.id==='string'&&/^local(?:-out)?:/.test(m.id))meta.append(el('span','message-local',language==='zh'?'桌面':'Desktop'));
        row.replaceChildren(meta,el('div','message-body',m.text||''));
        if(m.deliveryFailed)row.append(el('p','message-delivery-error',state?.channel==='messenger'?(language==='zh'?'Messenger 发送结果未确认。请检查对话，不要重复派活。':'Messenger delivery is unconfirmed. Check the conversation; do not repeat the task.'):state?.channel==='x'?(language==='zh'?'X 私信发送结果未确认。请检查对话，不要重复派活。':'X DM delivery is unconfirmed. Check the conversation; do not repeat the task.'):state?.channel==='feishu'?(language==='zh'?'飞书发送结果未确认。请检查对话，不要重复派活。':'Feishu delivery is unconfirmed. Check the conversation; do not repeat the task.'):state?.channel==='qq'?(language==='zh'?'未发送到 QQ。请在本机查看结果；不要重复派活。':'Not delivered to QQ. Inspect the result here; do not repeat the task.'):native?word('nativeDeliveryFailed'):language==='zh'?'未发送到微信。连接尚在时发 /status 重取结果；断开后请在本机检查。':'Not delivered to WeChat. Use /status within this connection; after disconnecting, inspect the project locally.'));
        if(!user){const actions=el('div','message-actions'),copy=el('button','message-copy',word('copyReply'));copy.type='button';copy.onclick=()=>action(async()=>{if(window.arcade.copyText)await window.arcade.copyText(m.text||'');else await navigator.clipboard.writeText(m.text||'');toast(word('replyCopied'));});actions.append(copy);row.append(actions);}
        entry.stamp=stamp;
      }
      if(entry.row!==cursor)$('bot-messages').insertBefore(entry.row,cursor);
      cursor=entry.row.nextElementSibling;
    }
    for(const [key,entry] of messageNodes)if(!alive.has(key)){entry.row.remove();messageNodes.delete(key);}
    if(!hadMessages||(follow&&!prepend))showLatest();else restoreHistoryPosition(anchor,oldScroll);
  }
  window.renderBot=next=>{
    language=next.config.language;state=next.bot;
    const firstRunApi=window.ArcadeFirstRun,firstRun=firstRunApi?.needed(next)===true,hasChannel=firstRunApi?firstRunApi.hasChannel(next):true;
    const official=state?.channel==='qqofficial',qq=state?.channel==='qq',feishu=state?.channel==='feishu',x=state?.channel==='x',messenger=state?.channel==='messenger',mode=state?.mode||'api',deepseek=mode==='deepseek',gpt=mode==='gpt',gemini=mode==='gemini',doubao=mode==='doubao',codex=mode==='codex',claude=mode==='claude',zh=language==='zh';
    const companion=(qq||official)&&state?.social?.config?.enabled&&state?.social?.supported;
    const credentialScope=JSON.stringify([next.accounts?.selectedId||'',mode,state?.channel||'wechat',state?.x?.expectedAccountId||'',state?.feishu?.appId||'',state?.messenger?.appId||'',state?.messenger?.pageId||'',state?.messenger?.ownerId||'',state?.messenger?.relayOrigin||'',qq?state?.qq?.expectedAccountId||'':'']);
    const credentialScopeChanged=lastCredentialScope!==credentialScope;
    roleProfileName=next.accounts?.accounts?.find(row=>row.id===next.accounts.selectedId)?.name||'';
    credentialContext={profileId:next.accounts?.selectedId||'',expectedMode:mode,expectedChannel:state?.channel||'wechat'};
    if(credentialScopeChanged){$('bot-key').value='';$('bot-qq-token').value='';$('bot-feishu-secret').value='';$('bot-x-token').value='';$('bot-messenger-page-token').value='';$('bot-messenger-relay-token').value='';connectionDrafts.clear();lastCredentialScope=credentialScope;}
    if(lastMode!==mode){$('bot-key').value='';lastMode=mode;}
    const channelName=official?(zh?'QQ 官方机器人':'QQ official bot'):qq?'QQ':feishu?(zh?'飞书':'Feishu'):x?'X':messenger?'Messenger Page':zh?'微信':'WeChat',backendName=({native:'Claude Channels',claude:'Claude Code',api:'Claude API',codex:'Codex',gpt:'GPT API',deepseek:'DeepSeek API',gemini:'Gemini API',doubao:'Doubao API'})[mode];
    words[language].connected=official?(zh?'已连接':'Connected'):zh?`${channelName}已连接`:`${channelName} connected`;
    words[language].paired=official?(zh?'配置已保存':'Settings saved'):messenger?(zh?'Messenger 配置已保存':'Messenger settings saved'):x?(zh?'X 配置已保存':'X settings saved'):feishu?(zh?'飞书配置已保存':'Feishu settings saved'):qq?(zh?'QQ 配置已保存':'QQ settings saved'):(zh?'微信已配对':'WeChat paired');
    words[language].nativeStart=zh?`连接${channelName}`:`Connect ${channelName}`;
    words[language].nativeStop=zh?`断开${channelName}`:`Disconnect ${channelName}`;
    persona=(next.desktopChat?.kind==='local'?(next.personas||[]).find(p=>p.id===state?.local?.characterId):null)||next.persona||{id:'sprout',name:{en:'Sprout',zh:'小芽'},portrait:'portraits/sprout-anime.png'};
    if(next.desktopChat?.kind==='local'&&!state?.st?.settings?.builtinPersonaId&&typeof state?.social?.config?.name==='string'&&state.social.config.name.trim())persona={...persona,name:{...persona.name,[language]:state.social.config.name.trim()}};
    words[language].title=persona.name[language];words[language].agent=persona.name[language];
    document.querySelectorAll('[data-bot]').forEach(n=>n.textContent=word(n.dataset.bot));
    $('bot-settings-toggle').setAttribute('aria-label',word('settingsToggle'));$('bot-settings-toggle').title=word('settingsToggle');
    $('bot-settings-close').setAttribute('aria-label',word('closeSettings'));
    $('bot-latest').textContent=word('latest');$('bot-thread-scroll').setAttribute('aria-label',word('inbox'));
    document.querySelector('.breadcrumb>span:last-child').textContent=view==='bot'?word('nav'):view==='connections'?(language==='zh'?'AI 与渠道':'AI and channels'):t({scene:'workshop',settings:'settings'}[view]);
    const incoming=Number(state?.incomingCount)||0;
    const status=state?.status||'disconnected',native=state?.mode==='native',process=state?.native?.process||{};
    const macStatus=window.ArcadeQQStartConnect?.macOneBotStatus(state,language);
    const processRunning=process.owned&&process.status==='running',processStopped=['stopped','exited'].includes(process.status),processBusy=!!process.busy||process.status==='starting';
    const nativeStep=processStopped?'nativeStoppedMain':state?.native?.paused?'nativePausedMain':state?.tasks?.pending?.length?'nativeNeedsApproval':!state?.native?.attached?(processRunning?'nativeAwaitingChannel':'nativeOpenClaude'):incoming>0?'received':'connected';
    const statusWord=native&&status==='connected'?nativeStep:native&&status==='disconnecting'?'nativeDisconnecting':status==='connected'?(incoming>0?'received':'connected'):status==='disconnected'&&state?.paired?'paired':status;
    // No channel and no App conversation yet: plain words instead of "Disconnected".
    const credentialLocked=state?.credentialState==='locked';
    const lockedStatus=zh?'已保存凭据暂时读不到':'Saved credentials are unreadable';
    const appOnlyIdle=next.desktopChat?.kind!=='local'&&!hasChannel,statusText=credentialLocked?lockedStatus:appOnlyIdle?(firstRun?(zh?'还没有 AI':'No AI yet'):(zh?'还没开始':'Not started')):macStatus?.label||word(statusWord);
    if($('bot-status').textContent!==statusText)$('bot-status').textContent=statusText;
    $('bot-project').textContent=state?.workspace||word('noProject');

    const recovery=credentialLocked?window.ArcadeFirstRun.settingsRecovery(credentialContext.profileId,zh):null;
    recoverKey.hidden=!recovery;recoverKey.textContent=recovery?.label||'';recoverKey.onclick=recovery?.open||null;
    $('bot-key-status').textContent=recovery?recovery.text:state?.hasKey?word('keySet'):gpt?(zh?'需要 OpenAI API key，按 API 用量计费。':'Requires an OpenAI API key; API usage is billed.'):deepseek?(zh?'需要 DeepSeek API key，按调用计费。':'Requires a DeepSeek API key; usage is billed by DeepSeek.'):gemini?(zh?'需要 Google AI Studio API key，按 API 用量计费。':'Requires a Google AI Studio API key; API usage is billed.'):doubao?(zh?'需要火山方舟 API key，按 API 用量计费。':'Requires a Volcengine Ark API key; API usage is billed.'):word('keyEmpty');
    $('bot-pair').textContent=word(state?.paired?'repair':'pair');
    $('bot-mode').value=mode;$('bot-channel').value=official?'qqofficial':messenger?'messenger':x?'x':feishu?'feishu':qq?'qq':'wechat';
    $('bot-wechat-options').hidden=official||qq||feishu||x||messenger;$('bot-messenger-options').hidden=!messenger;$('bot-qq-options').hidden=!qq;$('bot-feishu-options').hidden=!feishu;$('bot-x-options').hidden=!x;
    $('bot-api-options').hidden=native||codex||claude;$('bot-native-options').hidden=!native;
    $('bot-claude-options').hidden=!claude;$('bot-codex-options').hidden=!codex;$('bot-deepseek-options').hidden=!deepseek;$('bot-gpt-options').hidden=!gpt;$('bot-claude-budget').hidden=mode!=='api';$('bot-gemini-options').hidden=!gemini;$('bot-doubao-options').hidden=!doubao;
    $('bot-key-label').textContent=gpt?'OpenAI API key':deepseek?'DeepSeek API key':gemini?'Google AI Studio API key':doubao?'Volcengine Ark API key':'Anthropic API key';$('bot-key').placeholder=credentialLocked?'':state?.hasKey?(zh?'已保存，无需重复填写':'Saved; no need to re-enter'):gemini?'Google AI Studio key':doubao?'Volcengine Ark key':deepseek||gpt?'sk-…':'sk-ant-…';
    for(const [id,value] of [['bot-feishu-app-id',state?.feishu?.appId||''],['bot-feishu-owner',state?.feishu?.ownerId||''],['bot-qq-url',state?.qq?.url||'ws://127.0.0.1:3001'],['bot-qq-owner',state?.qq?.ownerId||''],['bot-deepseek-model',state?.deepseekModel||'deepseek-flash'],['bot-gpt-model',state?.gptModel||'gpt-6.1-sol'],['bot-gemini-model',state?.geminiModel||'gemini-3.6-flash'],['bot-doubao-model',state?.doubaoModel||'doubao-seed-2-0-lite-260428']])if(credentialScopeChanged||!connectionDrafts.has(id)&&document.activeElement!==$(id))$(id).value=value;
    $('bot-feishu-secret-status').textContent=state?.feishu?.hasSecret?(zh?'App Secret 已加密保存；留空保留，更换 App ID 时请填写新 Secret。保存配置不代表已连接。':'App Secret saved with OS encryption; leave blank to keep. A different App ID needs its own Secret. Saved settings do not mean connected.'):(zh?'填写应用的 App Secret；不会显示或回传已保存值。':'Enter the app’s App Secret; saved values are never displayed or returned.');
    if(credentialScopeChanged||!connectionDrafts.has('bot-qq-expected-account'))$('bot-qq-expected-account').value=state?.qq?.expectedAccountId||'';
    for(const [id,value] of [['bot-x-account',state?.x?.expectedAccountId||''],['bot-x-owner',state?.x?.ownerId||'']])if(credentialScopeChanged||!connectionDrafts.has(id)&&document.activeElement!==$(id))$(id).value=value;
    $('bot-x-token-status').textContent=state?.x?.hasToken?(zh?'用户令牌已加密保存，留空保留。保存不代表账号、私信权限或平台批准已核实。':'User token saved with OS encryption; leave blank to keep. Saving does not verify identity, DM access or platform approval.'):(zh?'填写用户授权得到的令牌；不会显示或回传已保存值。':'Enter a user-authorized token; saved values are never displayed or returned.');
    for(const [id,value] of [['bot-messenger-app',state?.messenger?.appId||''],['bot-messenger-page',state?.messenger?.pageId||''],['bot-messenger-owner',state?.messenger?.ownerId||''],['bot-messenger-relay',state?.messenger?.relayOrigin||'']])if(credentialScopeChanged||!connectionDrafts.has(id)&&document.activeElement!==$(id))$(id).value=value;
    $('bot-messenger-page-token-status').textContent=state?.messenger?.hasPageToken?(zh?'Page 令牌已加密保存；留空保留。更换应用或 Page 时需新令牌。':'Page token saved with OS encryption; leave blank to keep. A different App or Page needs a new token.'):(zh?'填写 Page Access Token；不会回传已保存值。':'Enter the Page Access Token; saved values are never returned.');
    $('bot-messenger-relay-token-status').textContent=state?.messenger?.hasRelayToken?(zh?'中转令牌已加密保存；留空保留。更换应用、Page、主人或中转地址时需新令牌。保存不代表权限或连通已验证。':'Relay token saved with OS encryption; leave blank to keep. A different App, Page, owner or relay needs a new token. Saving does not verify permissions or connectivity.'):(zh?'填写此身份组合专用的中转令牌；不是 App Secret 或 webhook 验证令牌。':'Enter the relay token for this identity binding, not App Secret or the webhook verification token.');
    $('bot-messenger-stopped').hidden=!state?.messenger?.optedOut;
    const messengerCheck=state?.messenger?.check||{};
    if(messengerCheck.code==='optout_save_failed')document.querySelector('[data-bot="messengerStopped"]').textContent=zh?'本次接收已停止，但停用设置未保存。请修复本机存储，勿在重启后直接连接。':'Receiving stopped for this session, but the stop setting could not be saved. Fix local storage before connecting after a restart.';
    $('bot-messenger-check').textContent=messengerCheck.state==='verified'&&messengerCheck.code!=='response_window_closed'?(zh?'Page 与中转身份已核实；不代表消息已送达、已读或平台已批准。':'Page and relay identities verified; not delivery, read or platform approval proof.'):messengerCheck.state==='failed'&&messengerCheck.code==='rate_limited'?(zh?'Messenger 连接受限，请稍后手动重新连接；当前没有自动等待。':'Messenger connection was rate limited. Reconnect manually later; no automatic wait is running.'):messengerCheck.state==='rate_limited'?(zh?'Messenger 检查已限流，正在等待；可随时断开。':'Messenger checks are rate limited. Waiting; you can disconnect at any time.'):messengerCheck.code==='response_window_closed'?(zh?'回复窗口已结束，未提交此回复。等待指定主人向 Page 发新消息；不会自动重发旧回复。':'The reply window has ended; this reply was not submitted. Wait for a new owner message. Old replies are not resent automatically.'):'';
    $('bot-x-stopped').hidden=!state?.x?.optedOut;
    const xCheck=state?.x?.check||{},xRateAt=Number(xCheck.retryAt);
    $('bot-x-check').textContent=xCheck.state==='failed'&&xCheck.code==='rate_limited'?(zh?`X 连接受限，${Number.isFinite(xRateAt)&&xRateAt>0?new Date(xRateAt).toLocaleTimeString('zh-CN')+' 后':'稍后'}请手动重新连接。当前没有自动等待。`:`X connection was rate limited. ${Number.isFinite(xRateAt)&&xRateAt>0?'Try connecting after '+new Date(xRateAt).toLocaleTimeString('en')+'.':'Try connecting later.'} No automatic wait is running.`):xCheck.state==='rate_limited'?(zh?`X 请求已限流，${Number.isFinite(xRateAt)&&xRateAt>0?new Date(xRateAt).toLocaleTimeString('zh-CN')+' 后':'稍后'}重试。等待期间可断开。`:`X requests are rate limited. ${Number.isFinite(xRateAt)&&xRateAt>0?'Retry after '+new Date(xRateAt).toLocaleTimeString('en')+'.':'Waiting before retrying.'} You can disconnect while waiting.`):xCheck.state==='verified'?(zh?'账号身份已核实；尚不能证明私信已送达或任务成功。':'Account identity verified; this does not prove DM delivery or task success.'):'';
    $('bot-qq-token-state').textContent=state?.qq?.hasToken?(zh?'Token 已加密保存。留空保留原值。':'Token saved with OS encryption. Leave blank to keep it.'):(zh?'填写 OneBot token，不是 WebUI 密码。':'Use the OneBot token, not the WebUI password.');
    $('bot-qq-prepare').textContent=word(state?.qq?.hasToken?'qqPrepared':'qqPrepare');
    renderQQCheck(state?.qq,status,macStatus);
    $('bot-native-key-retained').hidden=!state?.hasKey;
    $('bot-privacy').textContent=claude||codex||deepseek||gpt||gemini||doubao||qq||feishu?(zh?`消息经过腾讯及所选 AI 服务${gpt?' OpenAI':deepseek?' DeepSeek':''}${qq?'；QQ 桥接也会处理消息':''}。API key 与连接令牌使用系统加密。本页聊天在内存中，本机 AI 可能另存会话。`:`Messages pass through Tencent and the selected AI service${gpt?' (OpenAI)':deepseek?' (DeepSeek)':''}${qq?'; a QQ bridge also processes QQ messages':''}. Keys and tokens use OS encryption. This view is in memory; local AI tools may retain sessions.`):word(native?'nativePrivacy':'privacy');
    if(feishu)$('bot-privacy').textContent=zh?'消息经过飞书与所选 AI 服务。App Secret 与模型密钥在本机使用系统加密保存。此接入仅指定主人的私聊，不开启群聊。':'Messages pass through Feishu and your selected AI service. App Secret and model keys use local OS encryption. Only the configured owner’s private chat is accepted, not groups.';
    if(messenger)$('bot-privacy').textContent=zh?'消息经过 Meta、你配置的中转服务与所选 AI。中转服务可读取明文并有短期队列，本机令牌使用系统加密。仅接收指定主人，不自动创建 Page 或部署服务器。':'Messages pass through Meta, your relay and the selected AI. The relay sees plaintext and keeps a short-lived queue; local tokens use OS encryption. Only the configured owner is accepted. No automatic Page creation or relay deployment.';
    if(x)$('bot-privacy').textContent=zh?'消息经过 X 与所选 AI 服务。用户令牌和模型密钥使用本机系统加密；仅接收指定主人的普通私信，不读取加密 X Chat。':'Messages pass through X and the selected AI service. User tokens and model keys use local OS encryption. Only the configured owner’s standard DMs are accepted, not encrypted X Chat.';
    if(state?.social?.active)$('bot-privacy').textContent=zh?'陪伴模式会在本机保存最近 120 条聊天与手动记忆，并将相关上下文交给所选 AI 服务。空间文案单独生成，不提供私聊记忆。可在「相处方式」暂停活动或清除记忆。':'Companion mode keeps up to 120 messages and editable notes locally and sends relevant context to the selected AI. Space posts are generated separately without private chat memory. Pause activity or clear memory in Companion settings.';
    for(const [key,nativeKey] of [['inbox','nativeInbox'],['inboxNote','nativeInboxNote'],['help','nativeHelp'],['risk','nativeRisk']])document.querySelector(`[data-bot="${key}"]`).textContent=word(native?nativeKey:key);
    $('bot-start').textContent=word(native?'nativeStart':'start');$('bot-stop').textContent=word(native?'nativeStop':'stop');
    $('bot-stop').title=word(native?'nativeStopNote':'stop');
    const projectName=state?.workspace?.split(/[\\/]/).filter(Boolean).at(-1);
    document.querySelector('[data-bot="inboxNote"]').textContent=[channelName,backendName,companion?(zh?'陪伴聊天':'Companion chat'):projectName].filter(Boolean).join(' / ');
    const problem=recovery?recovery.text:macStatus?.issue?macStatus.detail:qq&&managedQQ?window.qqConnectionGuidance?.(state?.problem,language)||state?.problem:state?.problem;
    const groups=state?.qq?.groups;
    const groupProblemText=qq&&status==='connected'&&next.desktopChat?.kind!=='local'&&groups?.enabled===true
      ?groupRuntimeWarning(groups,zh,true):'';
    const groupProviderProblem=!!groupProblemText;
    $('bot-problem').hidden=!problem&&!groupProviderProblem;
    if($('bot-problem-text').textContent!==(problem||''))$('bot-problem-text').textContent=problem||'';
    if($('bot-qq-provider-problem-text').textContent!==groupProblemText)$('bot-qq-provider-problem-text').textContent=groupProblemText;
    $('bot-qq-provider-problem').hidden=!groupProviderProblem;
    if(managedQQ){const runtime=$('bot-problem-qq-runtime');runtime.hidden=credentialLocked||!(qq&&state?.problem);runtime.textContent=zh?'QQ 登录与运行':'QQ sign-in & runtime';}
    const active=['connected','connecting','disconnecting'].includes(state?.status),pairing=state?.status==='pairing',checking=state?.status==='checking';
    const localConversation=next.desktopChat?.kind==='local',savedConnection=window.selectedSavedConnection?.(next),nextSetupPhase=JSON.stringify([next.accounts?.selectedId,active,!!savedConnection,localConversation]);
    // A profile without any channel is an App-conversation profile: its settings panel starts
    // closed and nothing about chat software is shown until the owner asks for it.
    if(setupPhase!==nextSetupPhase&&(firstRunApi||setupPhase!==undefined)){
      const keepQQSetup=qq&&!credentialScopeChanged&&$('bot-setup-panel').open&&(groupRoles.open||outgoingSection.open||macQQ&&!localConversation&&!active);
      setSetupOpen(keepQQSetup||!localConversation&&!active&&!savedConnection&&hasChannel);
      setupPhase=nextSetupPhase;
    }
    else if(setupPhase===undefined&&!firstRunApi)setSetupOpen(false);
    const nextAdvancedPhase=JSON.stringify([next.accounts?.selectedId,localConversation]);
    if(advancedPhase!==nextAdvancedPhase&&firstRunApi){advancedGroup.open=!localConversation&&hasChannel;advancedPhase=nextAdvancedPhase;}
    document.querySelector('label[for="bot-mode"]').textContent=word(localConversation||!hasChannel?'aiService':'mode');
    // The App conversation is chat only: the provider notes about file tools do not apply to it.
    if(localConversation)for(const key of ['gptNote','deepseekNote','geminiNote','doubaoNote'])document.querySelector(`[data-bot="${key}"]`).textContent=zh?'按这个服务的 API 用量计费。App 对话只聊天，不操作文件，也不执行命令。':'Billed by this service’s API usage. The App conversation only chats: no file actions, no commands.';
    localControls.hidden=!localConversation;
    characterSettings.hidden=!(localConversation&&(state?.local?.libraryCharacterId||state?.local?.libraryGroupId));
    savedConnectionHost.hidden=localConversation||!savedConnection||(active&&!window.ArcadeQQStartConnect?.isRunning());
    window.ArcadeQQStartConnect?.mount(savedConnectionHost,{id:'bot-saved-connection',settings:()=>setSetupOpen(true,true)});
    if(macStatus?.issue&&!savedConnectionHost.hidden)$('bot-problem').hidden=true;
    $('bot-view').classList.toggle('bot-connected',active||localConversation);
    const setupSummary=$('bot-setup-summary'),qqChatModel=!localConversation&&qq?state.qqChatModel:null;
    setupSummary.classList.toggle('qq-chat-model',!!qqChatModel);
    setupSummary.textContent=qqChatModel
      ? [zh?'QQ 请求的聊天模型':'Requested QQ chat model',backendName,qqChatModel].join(' · ')
      : [state?.workspace?.split(/[\\/]/).filter(Boolean).at(-1),backendName].filter(Boolean).join(' · ');
    $('bot-start-note').textContent=word(native?'nativeStartNote':'startNote');
    document.querySelector('[data-bot="messageEntry"]').textContent=native?(language==='zh'?'在微信 → ClawBot 发消息。本机会话可在对话设置中停止。':'Send messages in WeChat → ClawBot. Manage the local session in Conversation settings.'):word('messageEntry');
    if(feishu)document.querySelector('[data-bot="messageEntry"]').textContent=zh?'在飞书私聊应用机器人。当前只处理指定主人的消息。':'Message the Feishu app bot privately from the configured owner’s account.';
    if(messenger)document.querySelector('[data-bot="messageEntry"]').textContent=zh?'指定主人从 Messenger 私信此 Facebook Page。发 /unsubscribe 可停止后续接收。':'The configured owner can message this Facebook Page in Messenger. /unsubscribe stops future receiving.';
    if(x)document.querySelector('[data-bot="messageEntry"]').textContent=zh?'从指定主人账号向 AI 账号发 X 普通私信。约 75 秒检查一次；发 /unsubscribe 可停止今后接收。':'Send a standard X DM from the configured owner. Checks run about every 75 seconds; /unsubscribe stops future receiving.';
    if(qq)document.querySelector('[data-bot="messageEntry"]').textContent=zh?'在 QQ 私聊 AI 的独立账号。当前仅处理指定主人的消息。':'Message your AI’s QQ account privately. Only the configured owner is accepted.';
    if(claude||codex||deepseek||gpt||gemini||doubao||qq||feishu||x||messenger){
      $('bot-start-note').textContent=zh?'连接后从指定账号发出消息。聊天直接回复；需要权限时才请你确认。':'After connecting, message from the configured account. Ordinary chat replies directly; actions ask when approval is needed.';
      document.querySelector('[data-bot="preview"]').textContent=zh?'预览版 · 新接入的真实账号验收仍待完成。':'Preview · live acceptance of the new integrations remains pending.';
    }
    // Lines about a chat channel (the WeChat entry, the preview note) belong to a channel conversation only.
    document.querySelector('[data-bot="preview"]').hidden=!!companion||localConversation||!hasChannel;
    document.querySelector('.bot-input-note').classList.toggle('bot-note-off',firstRun||!hasChannel);
    if(qq&&!macStatus&&state?.qq?.check?.state==='checked'&&(state.qq.check.online===false||state.qq.check.ownerIsFriend===false)){
      const signInBridge=zh?'QQ 当前离线。先在 NapCat 登录并重新检查，再开始接收任务。':'QQ is offline. Sign in through NapCat and test again before receiving tasks.';
      $('bot-start-note').textContent=state.qq.check.online===false?(managedQQ?(zh?'QQ 当前离线。打开「管理 QQ 账号」登录，再从「管理搭档」连接。':'QQ is offline. Sign in under Manage QQ accounts, then connect from Manage companions.'):signInBridge):(zh?'先加 AI 的 QQ 为好友，并在 AI 账号里通过申请，再重新检查。':'Add the AI’s QQ as a friend, accept in that account, then test again.');
    }
    if(deepseek||gpt||gemini||doubao||codex||claude)document.querySelector('[data-bot="help"]').textContent=zh?'直接聊天或派活。“状态”查看当前请求，“停止”中断当前任务，/new 开启新会话。需要确认时回复“同意 确认码”或“拒绝 确认码”；问题可直接回答。断开后不会自动恢复旧任务。':'Chat or give a task. /status shows requests; /cancel interrupts the current task; /new starts a fresh conversation. Approve only the reviewed /allow CODE or /deny CODE request. Disconnected work never replays automatically.';
    if(messenger){$('bot-start-note').textContent=zh?'连接后接收指定主人的新消息并回复；需先完成 Page 权限与 HTTPS 中转配置，普通回复窗口为 24 小时。':'Connect after Page permissions and HTTPS relay setup are ready. Receive new owner messages and reply within the ordinary 24-hour window.';document.querySelector('[data-bot="help"]').textContent+=zh?' 单独输入 /unsubscribe 会停止后续接收；重新启用需在本机明确操作。':' Send /unsubscribe as direct text to stop receiving; resuming requires an explicit local action.';}
    if(x){$('bot-start-note').textContent=zh?'连接会开始付费 API 检查并自动回复指定主人的新消息；确认账号和平台条件后再连接。':'Connecting starts API checks that may be billed and automatic replies to the configured owner’s new messages. Confirm account and platform prerequisites first.';document.querySelector('[data-bot="help"]').textContent+=zh?' 单独输入 /unsubscribe 会停止后续接收和回复；重新启用需回到此处操作。':' Send /unsubscribe as direct text to stop future receiving and replies. Re-enabling requires an action here.';}
    if(claude)document.querySelector('[data-bot="risk"]').textContent=zh?'工具操作按次确认，批准的命令仍可能影响项目以外的数据。停止会取消当前请求并清理应用启动的进程；已写入内容不会撤销，独立后台作业未确认。回复结束不代表任务成功。':'Tool actions need a specific approval; approved commands can still affect data outside the project. Stop cancels the current request and cleans up the app-started process. Existing changes are not rolled back and independent background jobs are unconfirmed. A reply ending does not prove success.';
    if(deepseek||gpt||gemini||doubao)document.querySelector('[data-bot="risk"]').textContent=zh?'仅提供经批准的项目文件操作，不执行终端命令；此文件接口不是系统沙箱。停止或断开不会撤销已写入的内容，回复结束也不代表任务已验证成功。':'Only approved project file actions are available, with no shell. This file interface is not an OS sandbox. Stopping or disconnecting does not undo existing changes, and a reply ending does not verify task success.';
    if(qq)for(const selector of ['[data-bot="nativeSetup"]','[data-bot="nativeReplyPermission"]','[data-bot="nativeStopNote"]','[data-bot="help"]','[data-bot="risk"]']){const node=document.querySelector(selector);node.textContent=node.textContent.replaceAll('微信','QQ').replaceAll('WeChat','QQ').replaceAll('ClawBot','QQ');}
    if(companion){
      $('bot-stop').textContent=zh?'断开连接':'Disconnect';$('bot-stop').title=zh?'停止当前回复并断开 QQ':'Stop the current reply and disconnect QQ';
      $('bot-start-note').textContent=zh?'连接后，在 QQ 私聊她。记忆、回访和日记都在「相处」里。':'After connecting, chat with her privately in QQ. Open Together for memories, follow-ups and her journal.';
      document.querySelector('[data-bot="help"]').textContent=zh?'直接聊天；发“停止”可打断当前回复，发“暂停主动”可暂停主动联系。记忆、约定回访和日记可在「相处」查看与修改。':'Chat normally. Send /cancel to interrupt the current reply, or 暂停主动 to pause proactive contact. View and edit memories, agreed follow-ups and her journal in Together.';
      document.querySelector('[data-bot="risk"]').textContent=zh?'陪伴聊天不执行文件或命令。已发送的 QQ 消息不会因停止而撤回。':'Companion chat does not use file or command tools. Stopping does not recall QQ messages already sent.';
    }
    if(qq&&state?.qq?.groups?.enabled){document.querySelector('[data-bot="messageEntry"]').textContent=zh?'可在已选 QQ 群里聊天，私聊仍只接指定主人。群内沿用现有接话机制。':'Chat in the selected QQ groups; private chat still accepts only the owner. Existing reply decisions apply in groups.';if(state?.qq?.check?.online!==false&&state?.qq?.check?.ownerIsFriend!==false)$('bot-start-note').textContent=zh?'连接后开始接收指定群的新消息及主人的私聊。主动群消息需要在这里和「相处方式」分别开启。':'Connecting starts receiving new messages in selected groups and the owner’s private chat. Proactive group messages need permission here and in Companion settings.';}
    if(macStatus&&status!=='connected')$('bot-start-note').textContent=macStatus.detail;
    for(const id of ['bot-mode','bot-channel','bot-pick','bot-key','bot-save','bot-budget','bot-pair','bot-qq-url','bot-qq-owner','bot-qq-expected-account','bot-qq-token','bot-qq-save','bot-feishu-app-id','bot-feishu-owner','bot-feishu-secret','bot-feishu-save','bot-x-account','bot-x-owner','bot-x-token','bot-x-save','bot-x-resume','bot-messenger-app','bot-messenger-page','bot-messenger-owner','bot-messenger-relay','bot-messenger-page-token','bot-messenger-relay-token','bot-messenger-save','bot-messenger-resume','bot-deepseek-model','bot-gpt-model','bot-gemini-model','bot-doubao-model','bot-qq-download','bot-qq-guide'])$(id).disabled=active||pairing||checking;
    if(credentialLocked){$('bot-key').value='';$('bot-key').disabled=$('bot-save').disabled=true;}
    const qqLocked=active||pairing||checking;
    renderQQGroups(credentialScopeChanged,qqLocked);
    $('bot-qq-download').disabled=true;
    $('bot-qq-prepare').disabled=qqLocked||!!state?.qq?.hasToken;
    for(const id of ['bot-qq-copy-config','bot-qq-copy-token'])$(id).disabled=qqLocked||!state?.qq?.hasToken;
    $('bot-qq-test').disabled=qqLocked||!state?.qq?.hasToken;
    $('bot-qq-test').textContent=word(checking?'qqTesting':'qqTest');
    $('bot-mode').querySelector('[value="native"]').disabled=official||feishu||x||messenger;
    $('bot-start').hidden=active||pairing;$('bot-start').disabled=((feishu||x||messenger)&&native)||(x&&!!state?.x?.optedOut)||(messenger&&!!state?.messenger?.optedOut)||checking||!((state?.workspace||(state?.social?.config.enabled&&state?.social?.supported))&&state?.paired&&(native||codex||claude||state?.hasKey));
    $('bot-forget').disabled=checking;
    $('bot-stop').hidden=!(active||pairing);
    if(checking){$('bot-stop').hidden=false;$('bot-stop').textContent=zh?'取消检查':'Cancel check';$('bot-stop').title=$('bot-stop').textContent;}
    const command=typeof state?.native?.command==='string'?state.native.command:'';
    $('bot-native-launch').hidden=!native||(!command&&!process.owned&&!process.canResume&&process.status!=='unknown');
    $('bot-native-command').textContent=command;$('bot-native-copy').disabled=!command||!native||!active;
    $('bot-native-command').closest('details').hidden=!command;
    $('bot-native-open').hidden=!!processRunning;
    $('bot-native-open').textContent=word(process.status==='starting'?'nativeStarting':process.canResume?'nativeResume':'nativeLaunch');
    $('bot-native-open').disabled=processBusy||['unknown','running'].includes(process.status)||!['connected','connecting'].includes(status)||(!process.canResume&&!!state?.native?.attached);
    $('bot-native-new').hidden=!process.canResume;
    $('bot-native-new').disabled=processBusy||!['connected','connecting'].includes(status)||!!state?.native?.attached;
    $('bot-native-halt').hidden=!processRunning;
    $('bot-native-halt').disabled=processBusy;
    $('bot-native-halt').textContent=word(processBusy?'nativeStopping':'nativeHalt');
    const processNote=process.status==='unknown'?'nativeUnknown':process.status==='starting'?'nativeStarting':processStopped?'nativeStopped':processRunning?(state?.native?.attached?'nativeSessionReady':'nativeRunning'):'nativeLaunchNote';
    $('bot-native-process-note').textContent=[word(processNote),processStopped?word('nativeStopScope'):''].filter(Boolean).join(' ');
    if(document.activeElement!==$('bot-budget'))$('bot-budget').value=state?.budget||1;
    $('bot-qr-wrap').hidden=!state?.qr;
    if(state?.qr&&$('bot-qr').getAttribute('src')!==state.qr)$('bot-qr').src=state.qr;
    if(!state?.qr)$('bot-qr').removeAttribute('src');
    const messages=localConversation?(Array.isArray(state?.local?.history)?state.local.history:[]):(Array.isArray(state?.tasks?.messages)?state.tasks.messages:[]), fingerprint=JSON.stringify([firstRun,firstRunApi?.stateKey(),language,mode,state?.channel,active,!!savedConnection,next.accounts?.selectedId,next.config.portrait,persona.id,localConversation,!!next.desktopChat?.available,messages]);
    $('bot-inbox').hidden=false;
    const latest=state?.tasks?.tasks?.at(-1),labels=language==='zh'?{queued:'排队中',running:'执行中',waiting_permission:'等待你的批准',waiting_question:'等待你的回答',cancelling:'正在中止',reply_ended:'回复结束 · 任务结果未验证',error:'执行出错 · 结果未验证',limit:'达到执行限制',cancelled:'已取消'}:{queued:'Queued',running:'Running',waiting_permission:'Waiting for approval',waiting_question:'Waiting for your answer',cancelling:'Cancelling',reply_ended:'Response ended · outcome unverified',error:'Execution error · outcome unverified',limit:'Execution limit reached',cancelled:'Cancelled'};
    if(companion)Object.assign(labels,zh?{queued:'等一下，马上回复',running:'正在回复',cancelling:'正在停止回复',reply_ended:'回复已结束',error:'这次没能回复，请稍后再试',limit:'这次回复已达到限制',cancelled:'已停止回复'}:{queued:'Reply queued',running:'Replying',cancelling:'Stopping reply',reply_ended:'Reply ended',error:'Could not reply. Please try again later.',limit:'Reply limit reached',cancelled:'Reply stopped'});
    const nativeHint={nativeOpenClaude:'nativeOpenHint',nativeAwaitingChannel:'nativeAwaitingHint',nativeNeedsApproval:'nativeApprovalHint',nativePausedMain:'nativePausedHint',nativeStoppedMain:'nativeStopped',received:'nativeReceivedHint',connected:'nativeReadyHint'};
    const taskState=localConversation?'':native?(active?word(status==='disconnecting'?'nativeDisconnecting':nativeHint[nativeStep]):''):latest?`${labels[latest.state]||latest.state}${latest.activity?' · '+latest.activity:''}`:'';
    if($('bot-task-state').textContent!==taskState)$('bot-task-state').textContent=taskState;
    $('bot-task-state').hidden=!taskState||(companion&&latest?.state==='reply_ended')||(native&&active&&!processStopped&&state?.native?.attached&&!state?.native?.paused&&!state?.tasks?.pending?.length&&messages.length>0);
    const messageScope=JSON.stringify([next.accounts?.selectedId,localConversation?'local':'channel',persona.id,localConversation?state?.local?.historyId:state?.tasks?.historyId||state?.channel]);
    if(lastMessageScope!==messageScope){messageNodes.clear();$('bot-messages').replaceChildren();lastMessages='';lastMessageScope=messageScope;threadNeedsBottom=true;}
    const historyAnchor=historyPosition(),historyScroll=$('bot-thread-scroll').scrollTop,historyFollow=atBottom();
    syncLocalHistory(next);
    const messagesChanged=lastMessages!==fingerprint;
    if(messagesChanged){
      lastMessages=fingerprint;
      renderMessages(messages,localConversation?false:native,localConversation||active,next.config.portrait||'anime',next.desktopChat?.available===true,localConversation,{anchor:historyAnchor,scroll:historyScroll,follow:historyFollow});
    }
    if(!messagesChanged&&historyAnchor)restoreHistoryPosition(historyAnchor,historyScroll);
    const mascot=native?(state?.tasks?.pending?.length?'waiting':'idle'):state?.tasks?.pending?.length?'waiting':state?.tasks?.currentTaskId?'running':messages.length?'done':'idle';
    const portrait=next.config.portrait||'anime';
    if(lastMascot!==`${mascot}:${next.config.theme}:${portrait}:${persona.id}`){lastMascot=`${mascot}:${next.config.theme}:${portrait}:${persona.id}`;$('bot-mascot').className=`scene ${mascot}`;if(portrait==='anime'){const img=el('img','portrait');img.src=persona.portrait;img.alt='';$('bot-mascot').replaceChildren(img);}else $('bot-mascot').replaceChildren(sprite(mascot));}
    document.body.dataset.desktopConversation=localConversation?'local':'channel';
    const localPending=['starting','stopping'].includes(state?.local?.state);
    $('bot-status').classList.toggle('waiting',localConversation?localPending:!appOnlyIdle&&macStatus?.tone==='waiting');
    $('bot-status').classList.toggle('unknown',localConversation?!state?.local?.available&&!localPending:!appOnlyIdle&&macStatus?.tone==='unknown');
    $('bot-status').classList.toggle('error',localConversation?state?.local?.reason==='stop_failed':!appOnlyIdle&&macStatus?.tone==='error');
    if(localConversation)document.querySelector('[data-bot="messageEntry"]').textContent=zh?'App 聊天与 QQ 分开保存。准备好后可在上方继续。':'App chat is saved separately from QQ. Continue above when you are ready.';if(localConversation){$('bot-status').textContent=state?.local?.state==='starting'?(zh?'正在准备聊天':'Preparing chat'):state?.local?.state==='stopping'?(zh?'正在暂停':'Pausing'):state?.local?.available?(zh?'可以聊天':'Ready to chat'):(zh?'App聊天已暂停':'App chat paused');$('bot-stop').hidden=true;$('bot-problem').hidden=true;document.querySelector('[data-bot="inboxNote"]').textContent=[zh?'App对话':'App conversation',backendName].filter(Boolean).join(' / ');$('bot-privacy').textContent=zh?'这段聊天与记忆独立保存在本机，相关内容会交给所选 AI。不会同步到 QQ，也不发布动态。可在聊天中查看、更正或忘记记忆。':'This conversation and its memory are stored separately on this device. Relevant context goes to the selected AI. It is not synced to QQ or used for social posts. Ask in chat to view, correct or forget memories.';}
    // No channel and no App conversation yet: say so in plain words instead of "WeChat / … · Disconnected".
    if(appOnlyIdle){
      const firstRunNote=next.characterSticker?.scopeId?
        (zh?'配置聊天 AI，或直接打开角色表情画图。':'Set up chat or open Stickers to draw.'):
        (zh?'先选一个 AI 并保存密钥':'Choose an AI and save its key first');
      document.querySelector('[data-bot="inboxNote"]').textContent=credentialLocked?lockedStatus:
        firstRun?firstRunNote:[zh?'App对话':'App conversation',backendName].filter(Boolean).join(' / ');
    }
    window.renderQQOfficial?.(next);
    window.ArcadeQQDailySettings?.update(next,qqGroupDirectory?.check?.accountId===state?.qq?.expectedAccountId?qqGroupDirectory?.items:[]);
    document.body.dataset.firstRun=String(firstRun);
    document.body.dataset.portrait=portrait;
    if(threadNeedsBottom&&document.body.dataset.view==='bot')requestAnimationFrame(()=>{
      if(threadNeedsBottom&&lastMessageScope===messageScope&&document.body.dataset.view==='bot'&&$('bot-thread-scroll').clientHeight){threadNeedsBottom=false;showLatest();}
    });
  };
  $('bot-settings-toggle').onclick=()=>setSetupOpen(!$('bot-setup-panel').open,true);
  $('bot-settings-close').onclick=()=>setSetupOpen(false,true);
  $('bot-setup-panel').addEventListener('toggle',()=>{
    const open=$('bot-setup-panel').open;
    $('bot-settings-toggle').setAttribute('aria-expanded',String(open));
    if(!open&&!groupRoles.closest('#qq-daily-group-settings')){groupRoles.open=false;roleView=null;bookView=null;showBookPreview(null);}
  });
  $('bot-setup-panel').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();setSetupOpen(false,true);}});
  $('bot-latest').onclick=showLatest;
  $('bot-thread-scroll').addEventListener('scroll',()=>{if(atBottom())$('bot-latest').hidden=true;},{passive:true});
  $('bot-pick').onclick=()=>run(()=>window.arcade.botProject());
  $('bot-mode').onchange=()=>run(async()=>{const previous=state?.mode||'api';$('bot-key').value='';try{await window.arcade.botConfigure({mode:$('bot-mode').value});}catch(error){$('bot-mode').value=previous;throw error;}});
  $('bot-channel').onchange=()=>run(async()=>{const previous=state?.channel||'wechat';try{await window.arcade.botConfigure({channel:$('bot-channel').value});}catch(error){$('bot-channel').value=previous;throw error;}});
  $('bot-deepseek-model').onchange=()=>run(()=>window.arcade.botConfigure({deepseekModel:$('bot-deepseek-model').value}));
  $('bot-gpt-model').onchange=()=>run(()=>window.arcade.botConfigure({gptModel:$('bot-gpt-model').value}));
  $('bot-gemini-model').onchange=()=>run(()=>window.arcade.botConfigure({geminiModel:$('bot-gemini-model').value}));
  $('bot-doubao-model').onchange=()=>run(()=>window.arcade.botConfigure({doubaoModel:$('bot-doubao-model').value}));
  $('bot-qq-save').onclick=()=>run(async()=>{await saveQQSettings();toast(word('qqSaved'));});
  const groupProactiveNote=document.querySelector('[data-bot="qqGroupsProactiveNote"]');
  groupProactiveNote.id='bot-qq-groups-proactive-note';
  $('bot-qq-groups-proactive').setAttribute('aria-describedby',`bot-qq-groups-proactive-edit-note ${groupProactiveNote.id}`);
  const companionSettings=el('button','plain');
  companionSettings.type='button';
  companionSettings.id='bot-qq-groups-companion-settings';
  companionSettings.dataset.bot='qqGroupsCompanionSettings';
  companionSettings.onclick=()=>{
    switchView('connections');
    if(!$('social-panel')?.getClientRects().length)$('onboarding-saved-connection-settings')?.click();
    const optional=$('onboarding-optional-toggle');
    if(optional?.getAttribute('aria-expanded')==='false')optional.click();
    const panel=$('social-panel');
    if(!panel)return;
    panel.open=true;
    requestAnimationFrame(()=>{
      const start=$('social-proactiveMessages'),pause=$('social-pause');
      const target=start&&!start.matches(':disabled')?start:pause&&!pause.disabled?pause:panel.querySelector('summary');
      target?.focus();
    });
  };
  $('bot-qq-groups-save').after(companionSettings);
  $('bot-qq-groups-save').onclick=()=>run($('bot-qq-groups-save').closest('#qq-daily-policy-footer')?saveDailySettings:saveQQGroups);
  $('bot-qq-group-directory-load').onclick=loadQQGroupDirectory;
  $('bot-qq-group-directory-add').onclick=addQQGroupDirectoryChoice;
  $('bot-qq-group-directory-select').onchange=event=>{
    if(qqGroupDirectory)qqGroupDirectory.selected=event.target.value;
    renderQQGroupDirectory();
  };
  if(macQQ)for(const id of ['bot-qq-expected-account','bot-qq-url','bot-qq-token','bot-qq-owner'])$(id).addEventListener('input',()=>{
    renderQQGroups(false,state?.status!=='disconnected');
  });
  for(const id of ['bot-qq-groups-enabled','bot-qq-group-ids','bot-qq-groups-proactive'])$(id).addEventListener('input',markQQGroupDraft);
  $('bot-qq-prepare').onclick=()=>run(async()=>{if(!window.arcade.botQQPrepare)throw Error(word('notDesktop'));await saveQQSettings(false);await window.arcade.botQQPrepare();toast(word('qqTokenPrepared'));});
  $('bot-qq-copy-config').onclick=()=>run(async()=>{if(!window.arcade.botQQCopyConfig)throw Error(word('notDesktop'));await saveQQSettings(false);await window.arcade.botQQCopyConfig();toast(word('qqConfigCopied'));});
  $('bot-qq-copy-token').onclick=()=>run(async()=>{if(!window.arcade.botQQCopyToken)throw Error(word('notDesktop'));await window.arcade.botQQCopyToken();toast(word('qqTokenCopied'));});
  $('bot-qq-test').onclick=()=>run(async()=>{if(!window.arcade.botQQTest)throw Error(word('notDesktop'));await saveQQSettings();await window.arcade.botQQTest();});
  for(const [id,kind] of [['bot-qq-download','download'],['bot-qq-guide','connections']])$(id).onclick=()=>run(async()=>{if(!window.arcade.botQQOpenGuide)throw Error(word('notDesktop'));await window.arcade.botQQOpenGuide(kind);});
  for(const id of connectionDraftIds)$(id).addEventListener('input',()=>connectionDrafts.add(id));
  $('bot-qq-expected-account').addEventListener('input',()=>renderQQGroups(false,state?.status!=='disconnected'));
  $('bot-feishu-save').onclick=()=>run(async()=>{const scope=lastCredentialScope,secret=$('bot-feishu-secret').value;$('bot-feishu-secret').value='';const patch={...credentialContext,channel:'feishu',feishuAppId:$('bot-feishu-app-id').value,feishuOwnerId:$('bot-feishu-owner').value};if(secret)patch.feishuAppSecret=secret;await window.arcade.botConfigure(patch);acceptConnectionDraft(scope,{'bot-feishu-app-id':patch.feishuAppId,'bot-feishu-owner':patch.feishuOwnerId});if(sameCredentialOwner(scope))toast(language==='zh'?'飞书配置已保存':'Feishu settings saved');});
  $('bot-x-save').onclick=()=>run(async()=>{const scope=lastCredentialScope,token=$('bot-x-token').value;$('bot-x-token').value='';const patch={...credentialContext,channel:'x',xAccountId:$('bot-x-account').value,xOwnerId:$('bot-x-owner').value};if(token)patch.xAccessToken=token;await window.arcade.botConfigure(patch);acceptConnectionDraft(scope,{'bot-x-account':patch.xAccountId,'bot-x-owner':patch.xOwnerId});if(sameCredentialOwner(scope))toast(language==='zh'?'X 配置已保存':'X settings saved');});
  $('bot-messenger-save').onclick=()=>run(async()=>{const scope=lastCredentialScope,pageToken=$('bot-messenger-page-token').value,relayToken=$('bot-messenger-relay-token').value;$('bot-messenger-page-token').value='';$('bot-messenger-relay-token').value='';const patch={...credentialContext,channel:'messenger',messengerAppId:$('bot-messenger-app').value,messengerPageId:$('bot-messenger-page').value,messengerOwnerId:$('bot-messenger-owner').value,messengerRelayOrigin:$('bot-messenger-relay').value};if(pageToken)patch.messengerPageAccessToken=pageToken;if(relayToken)patch.messengerRelayToken=relayToken;await window.arcade.botConfigure(patch);acceptConnectionDraft(scope,{'bot-messenger-app':patch.messengerAppId,'bot-messenger-page':patch.messengerPageId,'bot-messenger-owner':patch.messengerOwnerId,'bot-messenger-relay':patch.messengerRelayOrigin});if(sameCredentialOwner(scope))toast(language==='zh'?'Messenger 配置已保存':'Messenger settings saved');});
  $('bot-messenger-resume').onclick=()=>run(async()=>{const scope=lastCredentialScope;await window.arcade.botConfigure({messengerResume:true});if(sameCredentialOwner(scope))toast(language==='zh'?'已解除本机停用；尚未连接 Messenger。':'Local stop cleared; Messenger has not been connected.');});
  $('bot-x-resume').onclick=()=>run(async()=>{await window.arcade.botConfigure({xResume:true});toast(language==='zh'?'已解除本机停用；尚未连接 X。':'Local stop cleared; X has not been connected.');});
  // What was typed stays in the field until the key is actually saved; format problems are said in plain words.
  $('bot-save').onclick=()=>run(async()=>{
    if(state?.credentialState==='locked')return;
    const context=credentialContext,scope=lastCredentialScope,key=$('bot-key').value.trim(),zh=language==='zh';
    if(!key){toast(state?.hasKey?(zh?'密钥未更改。':'Key unchanged.'):(zh?'请先输入 API key。':'Enter an API key first.'));return;}
    const problem=window.ArcadeFirstRun?.keyProblem(key,zh);if(problem){toast(problem);$('bot-key').focus();return;}
    try{await window.arcade.botConfigure({...context,key});}catch(error){const known=window.ArcadeFirstRun?.known(error,zh);if(known){toast(known);$('bot-key').focus();return;}throw error;}
    if(sameCredentialOwner(scope)){$('bot-key').value='';toast(word('saved'));}
  });
  $('bot-budget').onchange=()=>run(()=>window.arcade.botConfigure({budget:Number($('bot-budget').value)}));
  $('bot-pair').onclick=()=>run(()=>window.arcade.botLogin());
  $('bot-start').onclick=()=>run(()=>window.arcade.botConnect());
  $('bot-stop').onclick=()=>run(()=>window.arcade.botDisconnect());
  $('bot-native-copy').onclick=()=>run(async()=>{if(!window.arcade.botCopyNative)throw Error(word('notDesktop'));await window.arcade.botCopyNative();toast(word('copied'));});
  $('bot-native-open').onclick=()=>run(async()=>{if(!window.arcade.botNativeStart)throw Error(word('notDesktop'));await window.arcade.botNativeStart({resume:state?.native?.process?.canResume===true});});
  $('bot-native-new').onclick=()=>run(async()=>{if(!window.arcade.botNativeStart)throw Error(word('notDesktop'));await window.arcade.botNativeStart({resume:false});});
  $('bot-native-halt').onclick=()=>run(async()=>{if(!window.arcade.botNativeStop)throw Error(word('notDesktop'));await window.arcade.botNativeStop();});
  $('bot-forget').onclick=()=>run(async()=>{const profileId=credentialContext.profileId;if(window.confirm(word('confirmForget')))await window.arcade.botForget({profileId});});
  // No fabricated chat or successful execution in the standalone preview.
  if(data)window.renderBot(data);
})();
