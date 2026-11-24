'use strict';
const $ = id => document.getElementById(id);
const copy = {
 en:{workspace:'WORKSPACE',workshop:'The workshop',settings:'Settings & themes',quietTitle:'A little less checking.',quietBody:'A little more making. Your agents have a place to work.',compact:'Mini view',full:'Full view',quiet:'Quiet mode',eyebrow:'YOUR DESKTOP, A LITTLE MORE ALIVE',headline:'Good work, little world.',subtitle:'A place for every agent. A moment for your attention.',onFloor:'Recent observations',localNote:'◎ Local by design. No account. No cloud.',clear:'Clear ended stations',emptyTitle:'Your workshop is ready.',emptyBody:'Connect Claude Code, then start a new session. Every agent gets its own little corner.',connect:'Connect Claude Code',integration:'Claude Code connection',integrationNote:'Install a local observer in your user settings. Existing hooks are preserved and backed up. Requires Node.js 22+. Restart Claude Code after changes.',install:'Install hooks',uninstall:'Remove hooks',attention:'Your attention, protected',notifications:'Silent desktop notifications',notifyNote:'App replies and agent waiting, error and response-end transitions. No conversation text is shown. Suppressed while this window is focused; Quiet mode pauses all notifications.',pin:'Keep above other windows',petTitle:'Desktop companion',petShow:'Show Ju on the desktop',petSize:'Size',petSmall:'Small',petMedium:'Medium',petLarge:'Large',petNote:'Ju appears above your other windows. Her pose changes when she thinks, replies or feels a touch. Drag her to move her; click her to open Agent Arcade when she has something for you. She shows a cue, never message text. She follows chat activity only while Ju is the current companion.',petUnsupported:'The desktop companion is available on Windows and macOS.',robotPreviewOpen:'Preview the desk robot',robotPreviewClose:'Close the robot preview',robotNote:'Click Ju in the on-screen preview to see her react. No device is needed. On Windows and macOS, turn on “Show Ju on the desktop” to see her react there too.',themeTitle:'A world of your own',themeNote:'Original pixel characters. Themes are small JSON files with colors and seven 16 × 16 sprites. No scripts.',theme:'Theme',import:'Import a theme',privacy:'Stay local',capture:'Save final response text',captureNote:'Off by default. When enabled, final replies stay on this device so you can open delivery parcels. Turning it off removes saved reply text. Never stores prompts or tool arguments.',accuracyNote:'“Response ended” does not mean the work passed validation. After 5 minutes without an event, active status becomes uncertain.',acknowledge:'Got it',running:'Building',waiting:'Needs you',error:'Error observed',done:'Response ended',unknown:'Uncertain',idle:'Idle',ended:'Ended',all:'All agents',attentionFilter:'Needs attention',notConnected:'Hooks not installed',installed:'Hooks installed · awaiting events',connected:'Local events received',emptyFilter:'No agents in this view.',noResult:'No saved response. Enable “Save final response text” before the next response ends to keep its reply here.',result:'Saved reply',lastKnown:'Last observed',installedToast:'Hooks installed. Restart Claude Code to activate them.',removedToast:'Hooks removed. Restart Claude Code.',failed:'Could not complete this action',session:'Session',subagent:'Subagent',viewLabel:'View',settingsEyebrow:'MAKE YOURSELF AT HOME',liveWorld:'LOCAL EVENTS',close:'Close details',outcomeNote:'A response boundary was observed. Check the work in Claude Code; Agent Arcade does not verify task success.',toolError:'Tool error',turnError:'Turn failed',reasons:{session_ready:'Ready for a new prompt',working:'Working on this turn',tool_running:'Using a tool',question:'Waiting for your answer',permission:'Waiting for your approval',input:'Waiting for your next input',tool_error:'Tool failed · may recover',turn_error:'Turn ended with an error',interrupted:'Interrupted · status uncertain',background:'Background work still active',scheduled:'Response ended · wakeup scheduled',turn_ended:'Response ended · inspect reply',session_ended:'Session closed',permission_unknown:'Permission outcome uncertain · check Claude Code',parent_ended:'Parent closed · outcome unknown'}},
 zh:{workspace:'工作空间',workshop:'小小工坊',settings:'设置与主题',quietTitle:'少看几次进度。',quietBody:'多留一点心流。每个 AI 都有自己的工作角落。',compact:'迷你模式',full:'完整模式',quiet:'免打扰',eyebrow:'让桌面，多一点生气',headline:'小小世界，认真干活。',subtitle:'谁在忙、谁等你、谁回复结束了，一眼就知道。',onFloor:'最近观测',localNote:'◎ 数据留在本机，无需账号与云服务。',clear:'清理已结束角色',emptyTitle:'你的工坊，准备好了。',emptyBody:'连接 Claude Code 后启动新会话，每个 AI 都会拥有自己的工作角落。',connect:'连接 Claude Code',integration:'连接 Claude Code',integrationNote:'在用户设置中安装本地观察钩子，保留并备份已有配置。需要 Node.js 22 或更新版本。改动后请重启 Claude Code。',install:'安装钩子',uninstall:'移除钩子',attention:'把注意力留给你',notifications:'静音桌面通知',notifyNote:'提醒 App 新回复，以及代理等待、出错和回复结束；不展示聊天正文。窗口在前台时不通知，免打扰会暂停全部通知。',pin:'窗口始终置顶',petTitle:'桌面角色',petShow:'让橘站在桌面上',petSize:'大小',petSmall:'小',petMedium:'中',petLarge:'大',petNote:'橘会浮在其他窗口上方。思考、回应和轻触时，她会换成不同姿态。拖动她可以换位置；她有事找你时点一下就打开 Agent Arcade。她只给提示，不在桌面上显示消息内容。只有当前陪伴角色是橘时，她才会跟随聊天状态。',petUnsupported:'桌面角色支持 Windows 和 macOS。',robotPreviewOpen:'预览桌面机器人',robotPreviewClose:'关闭机器人预览',robotNote:'点击屏幕预览里的橘，看看她的反应，无需连接设备。在 Windows 或 macOS 上开启「让橘站在桌面上」后，桌面上的橘也会回应。',themeTitle:'属于你的微型世界',themeNote:'原创像素角色。主题是一个小 JSON 文件，包含配色与七张 16 × 16 精灵图，不执行脚本。',theme:'当前主题',import:'导入主题',privacy:'留在本机',capture:'保存最终回复文本',captureNote:'默认关闭。打开后，最终回复保存在本机，点击包裹即可查看。关闭会清除已保存的回复，不记录提示词或工具参数。',accuracyNote:'“回复结束”不代表任务已验收。活跃状态超过 5 分钟没有新事件会标为“待确认”。',acknowledge:'知道了',running:'施工中',waiting:'等你确认',error:'发生错误',done:'回复结束',unknown:'待确认',idle:'待命',ended:'已结束',all:'全部角色',attentionFilter:'需要关注',notConnected:'尚未安装钩子',installed:'已安装 · 等待新事件',connected:'已收到本地事件',emptyFilter:'当前筛选下没有角色。',noResult:'未保存回复文本。在下一次回复结束前打开“保存最终回复文本”，即可在这里查看交付内容。',result:'已保存回复',lastKnown:'最后观测',installedToast:'钩子已安装，请重启 Claude Code 使其生效。',removedToast:'钩子已移除，请重启 Claude Code。',failed:'操作未完成',session:'会话',subagent:'子任务',viewLabel:'切换视图',settingsEyebrow:'安排你的工坊',liveWorld:'本地事件',close:'关闭详情',outcomeNote:'已观测到回复结束。请返回 Claude Code 检查工作结果；Agent Arcade 不判定任务是否成功。',toolError:'工具报错',turnError:'回合失败',reasons:{session_ready:'准备接收新任务',working:'正在处理本回合',tool_running:'正在使用工具',question:'等待你回答问题',permission:'等待你批准操作',input:'等待你的下一条输入',tool_error:'工具失败 · 可能继续恢复',turn_error:'本回合因错误结束',interrupted:'操作中断 · 状态待确认',background:'仍有后台任务运行',scheduled:'回复结束 · 已预约唤醒',turn_ended:'回复已结束 · 点击查看回复',session_ended:'会话已关闭',permission_unknown:'权限结果待确认 · 返回 Claude Code 查看',parent_ended:'父会话已关闭 · 结果未知'}}
};
Object.assign(copy.en,{workspace:'Workspace',workshop:'Sessions',settings:'Settings',compact:'Compact',full:'Full view',headline:'Sessions',subtitle:'Observed Claude Code sessions and subagents.',emptyTitle:'No sessions yet',emptyBody:'Install the Claude Code observer, restart Claude Code, then submit a prompt.',connect:'Set up observer',integration:'Claude Code observer',attention:'Notifications',themeTitle:'Scene theme',privacy:'Observer privacy',clear:'Clear ended sessions',liveWorld:'Local events'});
Object.assign(copy.zh,{workspace:'工作区',workshop:'会话',settings:'设置',compact:'紧凑',full:'完整视图',headline:'会话',subtitle:'查看 Claude Code 会话及子任务的最近状态。',emptyTitle:'暂无会话',emptyBody:'安装 Claude Code 观察器，重启 Claude Code 后提交一条提示。',connect:'设置观察器',integration:'Claude Code 观察器',attention:'通知',themeTitle:'场景主题',privacy:'观察器隐私',clear:'清理已结束会话',liveWorld:'本地事件'});
Object.assign(copy.en,{observerLabel:'Observer',all:'All sessions',themeNote:'Original characters. Themes change the status scenes; imported themes cannot run scripts.'});
Object.assign(copy.en,{notices:'Notices',noticesNote:'Calendars, folders and web updates you asked Agent Arcade to watch, and what they reported.'});
Object.assign(copy.en,{notes:'Notes',notesNote:'Your own Markdown notes, the line-level changes characters propose for them, and per-character reflection. Nothing is written until you approve it.',taskBoard:'Tasks',taskBoardNote:'Background Claude Code tasks, each in its own git worktree. Handed back is not done: only you verify.'});
Object.assign(copy.zh,{notes:'笔记',notesNote:'你自己的 Markdown 笔记、角色对它提出的逐行修改提议，以及按角色设置的反思。你批准之前，什么都不会写入。',taskBoard:'任务',taskBoardNote:'后台 Claude Code 任务，每个任务在自己的 git worktree 里运行。交回不等于完成，只有你能验收。'});
Object.assign(copy.zh,{notices:'提醒',noticesNote:'你让 Agent Arcade 留意的日历、文件夹和网页更新，以及它们最近的动静。'});
Object.assign(copy.zh,{observerLabel:'观察器',all:'全部会话',themeNote:'原创角色，主题仅影响状态场景；导入主题不会执行脚本。'});
Object.assign(copy.en,{appearanceTitle:'Appearance',appearanceSystem:'Follow system',appearanceLight:'Day',appearanceDark:'Night',appearanceNote:'Choose how this window looks. Scene themes stay separate.',appearanceSaving:'Saving appearance…',appearanceSaved:'Appearance saved.'});
Object.assign(copy.zh,{appearanceTitle:'外观',appearanceSystem:'跟随系统',appearanceLight:'日间',appearanceDark:'夜间',appearanceNote:'选择窗口的明暗，场景主题仍可单独设置。',appearanceSaving:'正在保存外观…',appearanceSaved:'外观已保存。'});
let appearanceSaving=false,appearanceFeedback='';
Object.assign(copy.en,{sendShortcutTitle:'Chat',sendShortcutNote:'Choose the send key for App and connected conversations. Shift+Enter always starts a new line.',sendShortcutEnter:'Enter to send',sendShortcutCtrlEnter:'Ctrl+Enter to send',sendShortcutSaving:'Saving send key…',sendShortcutSaved:'Send key saved.'});
Object.assign(copy.zh,{sendShortcutTitle:'聊天',sendShortcutNote:'选择 App 和已连接对话的发送键。Shift+Enter 始终换行。',sendShortcutEnter:'Enter 发送',sendShortcutCtrlEnter:'Ctrl+Enter 发送',sendShortcutSaving:'正在保存发送键…',sendShortcutSaved:'发送键已保存。'});
// macOS: the same saved choice is sent with Command+Enter, so the setting says so.
if(document.documentElement.dataset.platform==='darwin'){copy.en.sendShortcutCtrlEnter='⌘+Enter to send';copy.zh.sendShortcutCtrlEnter='⌘+Enter 发送';}
let sendShortcutSaving=false,sendShortcutFeedback='';
Object.assign(copy.en,{
  robotDeviceTitle:'53 mm desk robot connection',robotDeviceNote:'Connect the native USB Type-C port (10 on the board diagram), then scan for devices.',
  robotDeviceChoice:'USB device',robotDevicePick:'Select a device',robotDeviceNone:'No devices listed',robotDeviceScan:'Scan for devices',
  robotDeviceConnect:'Connect',robotDeviceDisconnect:'Disconnect',robotDeviceForget:'Forget device',
  robotDeviceSave:'This serial number can identify the same robot after restart.',robotDeviceOnce:'No unique serial number. Connect for this session only.',
  robotDeviceRemembered:'Remembered device',robotDeviceSelected:'Selected device',robotDeviceIdle:'Disconnected.',
  robotDeviceDisconnecting:'Disconnecting. Waiting for the USB port to be released.',
  robotDeviceDisconnected:'Disconnected. The USB port has been released.',
  robotDeviceReleaseError:'Could not confirm the USB port was released. Quit Agent Arcade completely before using the port again.',
  robotDeviceOpening:'Opening port…',robotDevicePort:'Port open. Waiting for the robot to answer.',robotDeviceWait:'Waiting for the remembered device.',
  robotDeviceHandshake:'Robot identified. Negotiating screen delivery…',robotDeviceSync:'Robot identified. Waiting for picture confirmation.',
  robotDeviceConfirmed:'Robot confirmed the current picture.',robotDeviceUnconfirmed:'Robot identified. Current picture unconfirmed.',
  robotDeviceSleep:'App status stream paused. Waiting to resume.',robotDeviceIncompatible:'The device does not support this round-screen protocol.',
  robotDeviceErrorList:'Could not scan USB ports. Scan again.',robotDeviceErrorStale:'The device list changed. Scan and select again.',
  robotDeviceErrorOpen:'Could not open the port. Check the cable and close any other app using it.',
  robotDeviceErrorTimeout:'The robot did not answer. Check the native USB connection and firmware.',
  robotDeviceErrorTransport:'USB connection lost.',robotDeviceErrorWorker:'The screen connection stopped. Reconnect to try again.',
  robotDeviceErrorAmbiguous:'Multiple devices share this identity. Select a device for this session.',
  robotDeviceErrorStorage:'Could not save the device preference.',robotDeviceError:'Connection failed.'
});
Object.assign(copy.zh,{
  robotDeviceTitle:'53 mm 桌面机器人连接',robotDeviceNote:'将线插入原生 USB Type-C 口（板图 10），然后查找设备。',
  robotDeviceChoice:'USB 设备',robotDevicePick:'请选择设备',robotDeviceNone:'暂无设备',robotDeviceScan:'查找设备',
  robotDeviceConnect:'连接',robotDeviceDisconnect:'断开连接',robotDeviceForget:'忘记设备',
  robotDeviceSave:'可通过序列号在重启后识别同一台机器人。',robotDeviceOnce:'无唯一序列号，仅本次连接。',
  robotDeviceRemembered:'已记住设备',robotDeviceSelected:'已选设备',robotDeviceIdle:'未连接。',
  robotDeviceDisconnecting:'正在断开连接，等待释放 USB 端口。',
  robotDeviceDisconnected:'已断开，USB 端口已释放。',
  robotDeviceReleaseError:'无法确认 USB 端口已释放。请完整退出 Agent Arcade 后再使用该端口。',
  robotDeviceOpening:'正在打开端口…',robotDevicePort:'端口已打开，等待机器人回应。',robotDeviceWait:'正在等待已记住的设备。',
  robotDeviceHandshake:'已识别机器人，正在协商屏幕传输…',robotDeviceSync:'已识别机器人，等待确认当前画面。',
  robotDeviceConfirmed:'机器人已确认当前画面。',robotDeviceUnconfirmed:'已识别机器人，当前画面尚未确认。',
  robotDeviceSleep:'App 状态流已暂停，等待恢复。',robotDeviceIncompatible:'该设备不支持此圆屏协议。',
  robotDeviceErrorList:'无法查找 USB 端口，请重试。',robotDeviceErrorStale:'设备列表已变化，请重新查找并选择。',
  robotDeviceErrorOpen:'无法打开端口，请检查连接线并关闭占用端口的程序。',robotDeviceErrorTimeout:'机器人未回应，请检查原生 USB 连接和固件。',
  robotDeviceErrorTransport:'USB 连接已中断。',robotDeviceErrorWorker:'屏幕连接已停止，请重新连接。',robotDeviceErrorAmbiguous:'多台设备的标识相同，请为本次连接选择设备。',
  robotDeviceErrorStorage:'无法保存设备偏好。',robotDeviceError:'设备连接失败。'
});
let data, filter='all', view='scene', selected=null, toastTimer, fingerprint='', detailFingerprint='';
let preferenceAttempt=0, preferenceNotice=null;
const controlAttempts=new WeakMap();
const t = key => copy[data?.config.language || 'en'][key] || key;
const el = (tag, cls, content) => {const n=document.createElement(tag);if(cls)n.className=cls;if(content!==undefined)n.textContent=content;return n;};
function toast(message){preferenceNotice=null;$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;preferenceNotice=null;},6000);}
let robotChoiceKey='';
function renderRobotDevice(){
  const device=data?.petRobot?.device, card=$('robot-device-card');
  card.hidden=!device;
  if(!device)return;
  const choice=$('robot-device-choice'),list=device.candidates;
  const placeholder=t(list.length?'robotDevicePick':'robotDeviceNone');
  const key=JSON.stringify([placeholder,list]);
  if(key!==robotChoiceKey){
    const last=choice.value;
    choice.replaceChildren(new Option(placeholder,''),...list.map(c=>new Option(c.label,c.id)));
    choice.value=list.some(c=>c.id===last)?last:'';
    robotChoiceKey=key;
  }
  const selection=list.find(c=>c.id===choice.value);
  const active=device.state==='connecting'||device.state==='connected';
  const releasing=device.state==='disconnecting'||device.state==='disconnect-error';
  $('robot-device-picker').hidden=active||releasing;
  $('robot-device-refresh').hidden=active||releasing;
  choice.disabled=active||releasing||!list.length;
  $('robot-device-connect').hidden=active||releasing;
  $('robot-device-connect').disabled=!selection;
  $('robot-device-disconnect').hidden=!active&&device.state!=='reconnecting';
  $('robot-device-forget').hidden=releasing||!device.remembered;
  const hint=active?(device.state==='connected'&&!device.remembered?t('robotDeviceOnce'):''):
    selection?t(selection.rememberable?'robotDeviceSave':'robotDeviceOnce'):'';
  $('robot-device-memory').textContent=hint;
  $('robot-device-memory').hidden=!hint;
  const label=active?device.label:selection?.label;
  $('robot-device-target').textContent=label?t('robotDeviceSelected')+' · '+label:'';
  $('robot-device-target').hidden=!label;
  $('robot-device-saved').textContent=device.rememberedLabel?t('robotDeviceRemembered')+' · '+device.rememberedLabel:'';
  $('robot-device-saved').hidden=!device.rememberedLabel;
  const phase=device.delivery?.phase;
  const phases={handshake:'Handshake',syncing:'Sync',confirmed:'Confirmed',unconfirmed:'Unconfirmed',incompatible:'Incompatible',sleeping:'Sleep'};
  const errors={list:'ErrorList',stale:'ErrorStale',open:'ErrorOpen',timeout:'ErrorTimeout',incompatible:'Incompatible',transport:'ErrorTransport',worker:'ErrorWorker',ambiguous:'ErrorAmbiguous',storage:'ErrorStorage'};
  let state='Idle';
  if(device.state==='disconnecting')state='Disconnecting';
  else if(device.state==='disconnect-error')state='ReleaseError';
  else if(device.state==='disconnected')state='Disconnected';
  else if(device.state==='connected')state=phases[phase]||'Handshake';
  else if(device.portOpen)state='Port';
  else if(device.state==='connecting')state='Opening';
  else if(device.state==='reconnecting')state='Wait';
  const status=t('robotDevice'+state);
  const problem=device.error?t('robotDevice'+(errors[device.error]||'Error')):'';
  const text=problem?[status,problem].join(' '):status;
  if($('robot-device-phase').textContent!==text)$('robot-device-phase').textContent=text;
}
// Electron prefixes a rejected invoke with "Error invoking remote method 'arcade:…': Error: ". Nobody needs to read that.
function plainError(error){return String(typeof error==='string'?error:error?.message||'').replace(/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/,'').trim();}
async function action(fn){try{return await fn();}catch(e){toast(`${t('failed')}: ${plainError(e)}`);}}
Object.assign(copy.zh,{languageSetting:'语言',compactView:'紧凑视图',layoutSetting:'界面布局',accentSetting:'强调色',portraitSetting:'头像',characterSetting:'角色',personaTone:'人设语气',sendKey:'发送键'});
Object.assign(copy.en,{languageSetting:'Language',compactView:'Compact view',layoutSetting:'Interface layout',accentSetting:'Accent colour',portraitSetting:'Portrait',characterSetting:'Character',personaTone:'Persona tone',sendKey:'Send key'});
const preferenceLabels={
  quiet:'quiet',notifications:'notifications',alwaysOnTop:'pin',captureResults:'capture',theme:'themeTitle',workspace:'workspace',
  language:'languageSetting',compact:'compactView',layout:'layoutSetting',accent:'accentSetting',portrait:'portraitSetting',
  character:'characterSetting',personaVoice:'personaTone',appearance:'appearanceTitle',sendShortcut:'sendKey',
};
function preferenceFailure(error){
  switch(plainError(error)){
    case 'SETTINGS_WRITE_BLOCKED': return 'blocked';
    case 'SETTINGS_DISK_FULL': return 'full';
    case 'SETTINGS_WRITE_FAILED': return 'failed';
    case 'Disconnect before changing the character or conversation style.': return 'connected';
    case 'Invalid appearance mode': case 'Invalid send shortcut': case 'Invalid accent colour': return 'invalid';
    default: return 'unconfirmed';
  }
}
function preferenceText(key,status){
  if(!status)return '';
  const zh=data.config.language==='zh', words=zh?copy.zh:copy.en, name=words[preferenceLabels[key]];
  switch(status){
    case 'saving': return words[key+'Saving'];
    case 'saved': return words[key+'Saved']||(zh?`${name}已保存。`:`${name} saved.`);
    case 'blocked': return zh?`${name}未能保存。请关闭占用设置文件的程序，或检查写入权限后重试。`:`${name} could not be saved. Close any app using the settings file or check write access, then try again.`;
    case 'full': return zh?`${name}未能保存。请腾出磁盘空间后重试。`:`${name} could not be saved. Free up disk space and try again.`;
    case 'failed': return zh?`${name}未能保存。请重试，若仍失败，请检查磁盘空间和写入权限。`:`${name} could not be saved. Try again. If it still fails, check disk space and write access.`;
    case 'connected': return zh?`请先断开连接，再更改${name}。`:`Disconnect before changing this setting (${name}).`;
    case 'invalid': return zh?`${name}未能保存。请重新选择有效的选项。`:`${name} could not be saved. Select a valid option and try again.`;
    default: return zh?`无法确认${name}是否已保存。请完全退出并重新打开应用，核对这项设置。`:`Could not confirm whether “${name}” was saved. Quit and reopen the app to check this setting.`;
  }
}
function beginPreference(){
  if(preferenceNotice){clearTimeout(toastTimer);$('toast').hidden=true;preferenceNotice=null;}
  return ++preferenceAttempt;
}
async function savePreference(key,value,restore){
  // Changing workspace is ordinary navigation. Confirm it only when replacing
  // a visible save failure that would otherwise describe the wrong action.
  const confirmSuccess=key!=='workspace'||Boolean(preferenceNotice&&preferenceNotice.status!=='saved');
  const attempt=beginPreference();
  let status='saved';
  try{await window.arcade.configure({[key]:value});}
  catch(error){restore?.();status=preferenceFailure(error);}
  if(attempt===preferenceAttempt&&(status!=='saved'||confirmSuccess)){
    toast(preferenceText(key,status));
    preferenceNotice={key,status};
  }
  return status==='saved';
}
function switchView(next){if((window.arcade.storeSocial&&next!=='settings')||!$(next+'-view'))return;view=next;document.body.dataset.view=next;$('view-picker').value=next;for(const x of ['bot','scene','settings','connections','work','relationship','accounts','characters','qq-runtime','notices','notes','tasks']){const node=$(`${x}-view`);if(node)node.hidden=x!==view;}document.querySelectorAll('nav [data-view]').forEach(n=>{n.classList.toggle('active',n.dataset.view===view);if(n.dataset.view===view)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});render();}
function age(at){const seconds=Math.max(0,Math.floor((Date.now()-at)/1000));return seconds<60?`${seconds}s`:seconds<3600?`${Math.floor(seconds/60)}m`:`${Math.floor(seconds/3600)}h`;}
function updateAges(){
  if(!data||document.hidden||view!=='scene')return;
  const tasksById=new Map(data.tasks.map(task=>[task.id,task]));
  document.querySelectorAll('.task-card').forEach(card=>{
    const task=tasksById.get(card.dataset.task),label=card.querySelector('.age');
    if(task&&label){const next=age(task.updatedAt);if(label.textContent!==next)label.textContent=next;}
  });
}
function sprite(state){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 16 16');svg.setAttribute('class','robot');svg.setAttribute('aria-hidden','true');svg.setAttribute('shape-rendering','crispEdges');const theme=data.theme;theme.sprites[state].forEach((row,y)=>[...row].forEach((c,x)=>{if(c==='.')return;const r=document.createElementNS(svg.namespaceURI,'rect');for(const [k,v] of Object.entries({x,y,width:1,height:1,fill:theme.palette[c]}))r.setAttribute(k,v);svg.append(r);}));return svg;}
function statusLabel(task){return task.displayState==='error'?t(task.reason==='turn_error'?'turnError':'toolError'):t(task.displayState);}
function taskCard(task){const state=task.displayState;const card=el('button','task-card');card.dataset.task=task.id;card.setAttribute('aria-label',`${task.project} · ${statusLabel(task)}`);const top=el('div','card-top'),name=el('div');name.append(el('span','project',task.project),el('span','agent-name',`${task.name} · ${task.agent?t('subagent'):task.session.slice(-6)}`));top.append(name,el('span',`state-pill ${state}`,statusLabel(task)));const scene=el('div',`scene ${state}`);scene.append(el('div','window-art'),el('div','plant'),el('div','shadow'),sprite(state));if(state==='running')scene.append(el('div','workbench'));if(state==='waiting')scene.append(el('div','prop','!'));if(state==='done')scene.append(el('div','prop parcel'));if(state==='error')scene.append(el('div','smoke'));const bottom=el('div','card-bottom');bottom.append(el('span','reason',task.stale?`${t('lastKnown')}: ${t(task.state)}`:t('reasons')[task.reason]||task.reason),el('span','age',age(task.updatedAt)));card.append(top,scene,bottom);if(sessionEvidenceText(task))card.append(el('p','session-evidence',sessionEvidenceText(task)));card.onclick=()=>openTask(task.id);return card;}
function renderDetail(){
  const task=data.tasks.find(x=>x.id===selected);
  if(!task){$('detail').close();return;}
  const key=JSON.stringify({task,language:data.config.language});
  if(key===detailFingerprint)return;
  detailFingerprint=key;
  const body=$('detail-body'),scroll=$('detail').scrollTop;
  const title=el('h2','',task.project);title.id='detail-title';
  body.replaceChildren(el('div','eyebrow',statusLabel(task)),title,el('p','',task.stale?`${t('lastKnown')}: ${t(task.state)}`:t('reasons')[task.reason]||task.reason),el('div','detail-meta',`${t('session')}: ${task.session}${task.agent?' / '+task.agent:''}`));
  if(task.state==='done'||(task.state==='ended'&&(task.result||task.responseEnded))){
    body.append(el('p','outcome-note',t('outcomeNote')),el('h3','',t('result')),el('pre','',task.result||t('noResult')));
  }
  if(sessionEvidenceText(task))body.append(el('p','session-evidence',sessionEvidenceText(task)));
  $('detail').scrollTop=scroll;
}
function openTask(id){selected=id;detailFingerprint='';renderDetail();if(!$('detail').open)$('detail').showModal();}
function sessionEvidenceText(task){
  const evidence=task.sessionEvidence;if(!evidence||evidence.agreement==='unavailable')return '';
  const zh=data.config.language==='zh',labels=zh?{consistent:'两种来源状态一致',conflict:'两种来源状态不同，请回 Claude Code 核实',missing:'会话不再出现在所选目录的官方列表中',stale:'官方会话状态已过期',unknown:'官方会话状态未提供足够信息'}:{consistent:'The two sources agree',conflict:'Sources disagree; check Claude Code',missing:'Session no longer appears in the selected project list',stale:'Official session evidence is stale',unknown:'Official session evidence is incomplete'};
  return `${zh?'会话校验':'Session check'}: ${labels[evidence.agreement]||evidence.agreement}${evidence.observed?' · '+evidence.observed:''}`;
}
function render(){if(!data)return;window.ArcadeAppearance?.apply(data);window.ArcadeTheme?.apply(data);document.documentElement.lang=data.config.language==='zh'?'zh-CN':'en';document.querySelectorAll('[data-i18n]').forEach(n=>n.textContent=t(n.dataset.i18n));document.body.classList.toggle('compact',data.config.compact);$('language').textContent=data.config.language==='en'?'中文':'EN';$('compact').textContent=t(data.config.compact?'full':'compact');$('quiet').setAttribute('aria-pressed',String(data.config.quiet));$('connection-label').textContent=t(data.lastEventAt?'connected':data.installed?'installed':'notConnected');$('world-label').textContent=t('liveWorld');$('view-picker').setAttribute('aria-label',t('viewLabel'));$('close-detail').setAttribute('aria-label',t('close'));$('problem').hidden=!data.problem;$('problem').textContent=data.problem;for(const [k,v] of Object.entries(data.theme.colors))document.documentElement.style.setProperty(k==='accent'?'--scene-accent':`--${k}`,v); // the interface accent (--accent) belongs to theme.js
  const version = document.querySelector('.version');
  if (version) {
    const full = typeof data.appVersion === 'string' ? data.appVersion.trim() : '';
    const zh = data.config.language === 'zh';
    let label = full || (zh ? '版本未知' : 'Version unknown');
    if (full && data.appPackaged === false) {
      label = `${zh ? '开发运行' : 'Development'} · ${full}`;
    } else if (data.appPackaged === true) {
      const personal = /^\d+\.\d+\.\d+-preview\.\d+\.personal\.([1-9]\d*)$/.exec(full);
      if (personal) label = `RC${personal[1]} · ${full}`;
    }
    version.textContent = label;
    version.title = full;
    version.setAttribute('aria-label', `Agent Arcade ${label}`);
  }
  document.querySelector('nav').setAttribute('aria-label',t('workspace'));
  document.body.dataset.view=view;
  document.querySelectorAll('nav [data-view]').forEach(n=>{const label=n.querySelector('[data-i18n],[data-bot]')?.textContent||n.textContent;n.setAttribute('aria-label',label.trim());n.title=label.trim();});
  for(const f of ['all','attentionFilter','done']){
    let n=[...$('filters').children].find(x=>x.dataset.filter===f);
    if(!n){n=el('button','filter');n.dataset.filter=f;n.onclick=()=>{filter=f;fingerprint='';render();};$('filters').append(n);}
    n.textContent=t(f);n.classList.toggle('selected',filter===f);n.setAttribute('aria-pressed',String(filter===f));
  }
  const tasks=data.tasks.filter(task=>filter==='all'||(filter==='attentionFilter'?['waiting','error','unknown'].includes(task.displayState)&&!task.acknowledged:task.displayState===filter));
  const key=JSON.stringify({tasks,theme:data.config.theme,language:data.config.language,filter});
  if(key!==fingerprint){
    const focused=document.activeElement?.dataset.task;
    const existing=new Map([...$('tasks').querySelectorAll('.task-card')].map(n=>[n.dataset.task,n]));
    const cards=tasks.map(task=>{const next=taskCard(task),card=existing.get(task.id);if(!card)return next;card.replaceChildren(...next.childNodes);card.setAttribute('aria-label',next.getAttribute('aria-label'));return card;});
    $('tasks').replaceChildren(...cards);
    if(focused){const target=cards.find(n=>n.dataset.task===focused);if(target)target.focus({preventScroll:true});else $('filters').querySelector('.selected')?.focus({preventScroll:true});}
    if(!tasks.length&&data.tasks.length)$('tasks').append(el('p','subtitle',t('emptyFilter')));fingerprint=key;
  }
  else updateAges();
  if($('detail').open)renderDetail();
  window.ArcadeQQStartConnect?.update(data);
  window.renderDesktopPets?.(data);
  window.renderFirstRun?.(data);
  window.renderBot?.(data);
  window.renderAccounts?.(data);
  window.renderQQRuntime?.(data);
  window.renderRelationship?.(data);
  window.renderVoice?.(data);
  window.renderDesktopChat?.(data);
  window.renderConnections?.(data);
  window.renderWork?.(data);
  window.renderSources?.(data);
  window.renderCharacters?.(data);
  window.renderSTSettings?.(data);
  window.renderGroups?.(data);
  window.renderNotes?.(data);
  window.renderTasks?.(data);
  window.renderShell?.(data);
  renderRobotDevice();
  $('empty').hidden=data.tasks.length>0;
  for(const k of ['notifications','alwaysOnTop','captureResults'])$(k).checked=!!data.config[k];
  {const pet=data.pet||{supported:false};$('desktopPet').checked=pet.enabled===true;$('desktopPet').disabled=!pet.supported;$('desktopPetSize').value=pet.size||'m';$('desktopPetSize').disabled=!pet.supported||!pet.enabled;$('desktopPetNote').textContent=pet.problem||t(pet.supported?'petNote':'petUnsupported');const robot=data.petRobot||{previewOpen:false};$('petRobotPreview').dataset.open=robot.previewOpen?'1':'';$('petRobotPreview').textContent=t(robot.previewOpen?'robotPreviewClose':'robotPreviewOpen');}
  for(const radio of document.querySelectorAll('input[name="appearance"]')){radio.checked=radio.value===(data.config.appearance||'system');radio.disabled=appearanceSaving;}
  if(preferenceNotice){
    const message=preferenceText(preferenceNotice.key,preferenceNotice.status);
    if($('toast').textContent!==message)$('toast').textContent=message;
  }
  $('appearance-status').textContent=preferenceText('appearance',appearanceFeedback);
  for(const radio of document.querySelectorAll('input[name="sendShortcut"]')){radio.checked=radio.value===(data.config.sendShortcut==='ctrl-enter'?'ctrl-enter':'enter');radio.disabled=sendShortcutSaving;}
  $('send-shortcut-status').textContent=preferenceText('sendShortcut',sendShortcutFeedback);
  if($('theme').options.length!==data.themes.length)$('theme').replaceChildren(...data.themes.map(theme=>{const n=el('option','',theme.name);n.value=theme.id;return n;}));$('theme').value=data.config.theme;
}
document.querySelectorAll('[data-view]').forEach(n=>n.onclick=()=>switchView(n.dataset.view));
function savePreferenceControl(control, key, property, confirmed = () => data.config[key]) {
  const value = control[property];
  const attempt = Symbol();
  controlAttempts.set(control,attempt);
  return savePreference(key,value,() => {
    if (controlAttempts.get(control) === attempt && control[property] === value) control[property] = confirmed();
  });
}
$('view-picker').onchange=e=>switchView(e.target.value);
$('language').onclick=()=>savePreference('language',data.config.language==='en'?'zh':'en');
$('compact').onclick=()=>savePreference('compact',!data.config.compact);
$('quiet').onclick=()=>savePreference('quiet',!data.config.quiet);
$('clear').onclick=()=>action(()=>window.arcade.clear());$('connect').onclick=()=>switchView('settings');
for(const k of ['notifications','alwaysOnTop','captureResults'])$(k).onchange=e=>savePreferenceControl(e.currentTarget,k,'checked');
$('desktopPet').onchange=e=>action(()=>window.arcade.desktopPet({enabled:e.target.checked}));
$('desktopPetSize').onchange=e=>action(()=>window.arcade.desktopPet({size:e.target.value}));
$('petRobotPreview').onclick=e=>action(()=>window.arcade.petRobot({preview:e.currentTarget.dataset.open!=='1'}));
$('robot-device-choice').onchange=renderRobotDevice;
for(const command of ['refresh','connect','disconnect','forget']){
  $('robot-device-'+command).onclick=()=>action(()=>window.arcade.petRobot({device:command==='connect'
    ? {action:command,id:$('robot-device-choice').value} : {action:command}}));
}
for(const radio of document.querySelectorAll('input[name="appearance"]'))radio.onchange=async event=>{
  if(!event.target.checked||appearanceSaving)return;
  const hadFocus=document.activeElement===event.target;
  beginPreference();appearanceSaving=true;appearanceFeedback='saving';render();
  try{await window.arcade.configure({appearance:event.target.value});appearanceFeedback='saved';}
  catch(error){appearanceFeedback=preferenceFailure(error);}
  finally{appearanceSaving=false;render();if(hadFocus&&view==='settings'&&document.activeElement===document.body)event.target.focus({preventScroll:true});}
};
$('theme').onchange=e=>savePreferenceControl(e.currentTarget,'theme','value');$('import').onclick=()=>action(()=>window.arcade.importTheme());
for(const radio of document.querySelectorAll('input[name="sendShortcut"]'))radio.onchange=async event=>{
  if(!event.target.checked||sendShortcutSaving)return;
  const hadFocus=document.activeElement===event.target;
  beginPreference();sendShortcutSaving=true;sendShortcutFeedback='saving';render();
  try{await window.arcade.configure({sendShortcut:event.target.value});sendShortcutFeedback='saved';}
  catch(error){sendShortcutFeedback=preferenceFailure(error);}
  finally{sendShortcutSaving=false;render();if(hadFocus&&view==='settings'&&document.activeElement===document.body)event.target.focus({preventScroll:true});}
};
$('install').onclick=()=>action(async()=>{const b=$('install');b.disabled=true;try{await window.arcade.install();$('install-status').textContent=t('installedToast');toast(t('installedToast'));}finally{b.disabled=false;}});
$('uninstall').onclick=()=>action(async()=>{await window.arcade.uninstall();$('install-status').textContent=t('removedToast');});
$('close-detail').onclick=()=>$('detail').close();$('acknowledge').onclick=()=>action(async()=>{await window.arcade.acknowledge(selected);$('detail').close();});
window.arcade.subscribe(next=>{data=next;render();});
// Relative age is presentation-only. It does not require another full state
// transfer, and never changes the observed state or infers completion.
setInterval(updateAges,1000);
document.addEventListener('visibilitychange',updateAges);
// Startup landing. A profile with a connected, saved or manual channel lands where it always did.
// Every other profile lands on the App conversation: with a usable AI it is started right away,
// without one the chat page shows the first-run card (first-run.js). Only a profile whose owner
// chose the Work workspace and already has an AI lands on Sessions instead.
action(async()=>{
  data=await window.arcade.snapshot();
  // The deferred scripts after this one (desktop-chat.js, first-run.js, shell.js) must have run first.
  if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  if(window.arcade.storeSocial){switchView('settings');return;}
  const active=['connected','connecting','checking','disconnecting'].includes(data.bot?.status),saved=window.selectedSavedConnection?.(data),manual=data.bot?.mode==='native'&&!!data.bot?.workspace,work=data.config.workspace==='work';
  const local=data.bot?.local,resume=!!local&&local.canStart===true&&local.available!==true;
  if(active||saved||manual){
    switchView(work?'scene':'bot');
    // The owner's own last choice was the App conversation: resume it. Their default kind stays the channel.
    if(data.desktopChat?.kind==='local'&&resume&&!active)void window.ArcadeDesktopConversation?.select('local',false);
    return;
  }
  // A channel that is paired but not yet complete keeps opening its setup page.
  if(data.bot?.paired===true){switchView('connections');return;}
  const firstRun=window.ArcadeFirstRun?.needed(data)===true;
  switchView(work&&!firstRun?'scene':'bot');
  if(resume)void window.ArcadeDesktopConversation?.select('local',false);
});
