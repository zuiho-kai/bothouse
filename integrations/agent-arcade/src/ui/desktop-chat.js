'use strict';
(() => {
  let current=null,state=null,revision=0;
  const drafts=new Map(),credentials=new Map();let selecting=null,selectionMessage='',observed='',navigation=0;
  const copies={zh:{label:'给搭档发消息',placeholder:'想聊点什么？',send:'发送',stop:'停止',note:'仅在这里回复',thinking:'正在回复…',stopping:'正在停止…',cancelled:'这次回复已停止。',failed:'这次回复未能确认完成。',prepare:'语音尚未结束，请先结束语音后再发。',changed:'对话已变化，请重新发送。'},en:{label:'Message your companion',placeholder:'What is on your mind?',send:'Send',stop:'Stop',note:'Replies stay here',thinking:'Replying…',stopping:'Stopping…',cancelled:'This reply stopped.',failed:'This reply could not be confirmed complete.',prepare:'Voice has not ended. End voice before sending.',changed:'The conversation changed. Please send again.'}};
  const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n;};
  const kindOf=s=>s?.desktopChat?.kind==='local'?'local':'channel';
  function draftKey(s){
    const kind=kindOf(s),key=[s?.accounts?.selectedId,kind],local=s?.bot?.local;
    if(kind==='local'&&local?.libraryGroupId)key.push('group',local.libraryGroupId);
    else if(kind==='local'&&local?.libraryCharacterId)key.push('card',local.libraryCharacterId,s.bot.st?.settings?.branchId??null);
    else if(kind==='local')key.push('builtin',local?.characterId);
    return JSON.stringify(key);
  }
  const draftScope=s=>JSON.stringify([s?.bot?.mode,kindOf(s)==='local'?s?.bot?.local?.characterId:s?.persona?.id,kindOf(s)==='channel'?[s?.bot?.channel,s?.bot?.qq?.ownerId,s?.bot?.qq?.expectedAccountId,s?.bot?.feishu?.ownerId,s?.bot?.x?.ownerId,s?.bot?.messenger?.ownerId]:null]);
  const saveDraft=p=>{if(p?.editor.value)drafts.set(p.key,{accountId:p.accountId,scope:p.scope,value:p.editor.value});else if(p&&!p.recovery)drafts.delete(p.key);};
  const currentContext=()=>state?.desktopChat?.available&&document.body.dataset.view==='bot'?`${state.accounts?.selectedId}:${kindOf(state)}:${state.desktopChat.contextId}`:'';
  const language=()=>state?.config?.language==='zh'?'zh':'en';
  const sendShortcut=()=>state?.config?.sendShortcut==='ctrl-enter'?'ctrl-enter':'enter';
  // The saved choice stays "ctrl-enter"; on macOS its modifier is Command (Control is also accepted).
  const macHost=document.documentElement.dataset.platform==='darwin';
  const imageCopy={zh:{add:'添加图片',replace:'更换图片',remove:'移除',alt:'准备发送的图片预览',unsupported:'当前模型不支持图片，可到 AI 设置切换。',choosing:'正在选择图片…',removing:'正在移除图片…',reselect:'如需再次发送图片，请重新选择。',image_too_large:'图片过大，请选择较小的图片。',invalid_image:'请选择有效的静态 PNG 或 JPEG 图片。',image_read_failed:'未能读取图片，请重新选择。',image_unsupported:'当前模型不支持图片，请切换模型后重新选择。',stale_attachment:'这张图片已失效，请重新选择。',busy:'请等当前操作结束后再试。'},en:{add:'Add image',replace:'Replace image',remove:'Remove',alt:'Preview of the image to send',unsupported:'This model does not support images. Choose another in AI settings.',choosing:'Choosing an image…',removing:'Removing the image…',reselect:'Select the image again if you want to resend it.',image_too_large:'The image is too large. Choose a smaller image.',invalid_image:'Choose a valid, still PNG or JPEG image.',image_read_failed:'The image could not be read. Select it again.',image_unsupported:'This model does not support images. Switch models and select it again.',stale_attachment:'This image has expired. Select it again.',busy:'Wait for the current action to finish.'}};
  const failureCopy={
    zh:{retry:'重试',checkKey:'检查密钥',kept:'你的消息还在输入框里。',classes:{
      auth:'AI 服务没有接受这把密钥，或者这把密钥不能使用当前模型。',
      quota:'这把密钥的余额不足，或请求太频繁被限流了。',
      network:'没能连上 AI 服务：网络不通、连接被拦截，或服务暂时没有回应。',
      refused:'AI 服务拒绝回答这条消息。可以换个说法再发。',
      limit:'这次回复达到了长度或时间上限，没有完成。',
      other:'这次没有收到回复。可以再试一次；如果一直这样，请检查密钥和所选的模型。'}},
    en:{retry:'Try again',checkKey:'Check the key',kept:'Your message is still in the box.',classes:{
      auth:'The AI service did not accept this key, or the key may not use the current model.',
      quota:'This key is out of balance, or requests were rate limited.',
      network:'Could not reach the AI service: no network, a blocked connection, or the service did not answer.',
      refused:'The AI service declined to answer this message. Try wording it differently.',
      limit:'This reply reached a length or time limit and did not finish.',
      other:'No reply came back. Try again; if it keeps happening, check the key and the selected model.'}}};
  const validImage=r=>r?.ok===true&&typeof r.attachmentId==='string'&&/^[\w-]{1,100}$/.test(r.attachmentId)&&Number.isInteger(r.width)&&r.width>0&&r.width<=2048&&Number.isInteger(r.height)&&r.height>0&&r.height<=2048&&Number.isInteger(r.bytes)&&r.bytes>0&&r.bytes<=4*1024*1024&&typeof r.preview==='string'&&r.preview.length<=700000&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(r.preview);
  const switchingSource=()=>state?.desktopChat?.selecting===true||Boolean(selecting?.kind&&selecting.accountId===state?.accounts?.selectedId);
  function updateSendHint(p){
    const key=sendShortcut()==='ctrl-enter'?(macHost?'⌘+Enter':'Ctrl+Enter'):'Enter';
    if(switchingSource())p.note.textContent=p.lang==='zh'?'正在切换对话位置，完成后可发送。':'Switching conversations. You can send when the switch finishes.';
    else p.note.textContent=p.lang==='zh'?`仅在这里回复 · ${key} 发送 · Shift+Enter 换行`:`Replies stay here · ${key} to send · Shift+Enter for a new line`;
    p.send.setAttribute('aria-keyshortcuts',sendShortcut()==='ctrl-enter'?(macHost?'Meta+Enter':'Control+Enter'):'Enter');
  }
  const localReason=(local,zh)=>{
    const text={credentials_locked:['已保存的凭据暂时无法读取，请到 AI 设置检查。','Saved credentials cannot be opened. Check AI settings.'],credentials_busy:['凭据正在更新，请稍候。','Credentials are being updated. Please wait.'],storage_unavailable:['本机聊天记录暂时无法打开，请稍后再试。','Local chat history could not be opened. Please try again.'],stopping:['正在暂停 App 聊天，请稍候。','App chat is pausing. Please wait.'],stop_failed:['尚未确认已暂停，请再次尝试暂停。','Pausing is unconfirmed. Try pausing again.'],busy:['正在处理上一项操作，请稍候。','The previous action is still running. Please wait.'],scope_limit:['已保存 20 段角色对话，达到上限。请先清除一段不用的对话，再开始。','20 character conversations are stored, which is the limit. Clear one you no longer use, then start.']};return Object.hasOwn(text,local.reason)?text[local.reason][zh?0:1]:null;
  };
  const channelLabel=s=>({qq:'QQ',wechat:language()==='zh'?'微信':'WeChat',feishu:language()==='zh'?'飞书':'Feishu',x:'X',messenger:'Messenger'})[s?.bot?.channel]||'QQ';
  // A profile with no channel is an App-conversation profile: no location switch, no channel wording.
  const appOnly=()=>!!window.ArcadeFirstRun&&window.ArcadeFirstRun.hasChannel(state)!==true;
  const messageCount=()=>((kindOf(state)==='local'?state?.bot?.local?.history:state?.bot?.tasks?.messages)||[]).length;
  // After entering the chat (navigation, startup, a conversation that just started) the composer takes
  // focus, unless the person is typing somewhere or working in a dialog or the settings panel.
  // `arrived` is a navigation into the chat; without it only an unfocused page is taken over.
  function focusComposer(arrived){
    requestAnimationFrame(()=>{
      if(!current||current.dead||document.body.dataset.view!=='bot'||document.querySelector('dialog[open]'))return;
      const active=document.activeElement,idle=!active||active===document.body||active===current.editor;
      if(!idle&&(!arrived||active.matches('input,textarea,select,[contenteditable=true]')||active.closest('#bot-setup-panel,#bot-messages,#desktop-branch-bar,#desktop-group-speak,.shell-pop-panel,.companion-switcher,.imm-companion')))return;
      current.editor.focus({preventScroll:true});
    });
  }
  function setupAI(){
    // No key for the selected API service: the key entry card, never the connection side panel.
    const api=['api','gpt','deepseek','gemini','doubao'].includes(state?.bot?.mode);
    if(api&&state?.bot?.hasKey!==true&&state?.bot?.credentialState!=='locked'&&window.ArcadeFirstRun?.open({}))return;
    window.openConversationSetup?.();requestAnimationFrame(()=>{const target=document.getElementById(['api','gpt','deepseek','gemini','doubao'].includes(state?.bot?.mode)?'bot-key':'bot-mode');target?.scrollIntoView({block:'center'});target?.focus({preventScroll:true});});}
  function updateControls(){if(current){updateSendHint(current);current.update();}renderChoice();if(document.body.dataset.view==='connections')window.renderConnections?.(state);}
  // Returns {ok:true} or {ok:false,code}. `force` skips the already-open shortcut,
  // for a caller that has just changed which character the App conversation uses.
  async function selectConversation(kind,navigate=false,{force=false,profileId}={}){
    if(profileId!==undefined&&profileId!==state?.accounts?.selectedId)return {ok:false,code:'changed'};
    if(selecting||!state?.accounts?.selectedId||typeof window.arcade.desktopConversationSelect!=='function')return {ok:false,code:selecting?'busy':'unavailable'};
    if(!force&&kind===kindOf(state)&&(kind==='channel'||state.bot?.local?.available)){if(navigate)switchView('bot');document.getElementById('desktop-chat-input')?.focus({preventScroll:true});return {ok:true};}
    const intent={accountId:state.accounts.selectedId,kind,navigation},from=document.body.dataset.view;selecting=intent;selectionMessage='';updateControls();
    try{const reply=await window.arcade.desktopConversationSelect({accountId:intent.accountId,kind});if(selecting!==intent||state.accounts?.selectedId!==intent.accountId||navigation!==intent.navigation)return {ok:false,code:'changed'};if(reply?.ok!==true||reply.kind!==kind)throw reply;if(navigate&&document.body.dataset.view===from)switchView('bot');requestAnimationFrame(()=>{if(state.accounts?.selectedId===intent.accountId&&kindOf(state)===kind&&document.body.dataset.view==='bot')document.getElementById('desktop-chat-input')?.focus({preventScroll:true});});return {ok:true};}
    catch(error){const code=typeof error?.code==='string'?error.code:'start_failed';if(selecting===intent&&state.accounts?.selectedId===intent.accountId&&navigation===intent.navigation)selectionMessage=code==='scope_limit'?localReason({reason:code},language()==='zh'):language()==='zh'?'暂时无法开始，请检查 AI 设置后再试。':'Could not start this conversation. Check the AI settings and try again.';return {ok:false,code};}
    finally{if(selecting===intent){selecting=null;updateControls();}}
  }
  async function stopLocal(){
    if(selecting||!state?.accounts?.selectedId)return;const intent={accountId:state.accounts.selectedId,navigation};selecting=intent;selectionMessage='';updateControls();
    try{const r=await window.arcade.desktopLocalStop({accountId:intent.accountId});if(r?.ok!==true)throw r;}catch{if(state.accounts?.selectedId===intent.accountId&&navigation===intent.navigation)selectionMessage=language()==='zh'?'暂停结果尚未确认，请稍后再试。':'Pausing could not be confirmed. Please try again.';}finally{if(selecting===intent){selecting=null;updateControls();}}
  }
  function renderChoice(){
    let box=document.getElementById('desktop-conversation-choice');if(!state?.bot?.local||typeof window.arcade.desktopConversationSelect!=='function'){box?.remove();document.getElementById('desktop-local-stop')?.remove();return;}
    const only=appOnly(),panel=document.getElementById('bot-local-controls');
    // "Pause App chat" lives in the conversation settings panel. Only a pause that could not be
    // confirmed is offered again next to the conversation, where the problem is reported.
    {
      const pausable=kindOf(state)==='local'&&state.bot.local.available&&state.bot.local.reason!=='stop_failed'&&typeof window.arcade.desktopLocalStop==='function';let b=panel?.querySelector('#desktop-local-stop');
      if(!pausable||!panel)b?.remove();
      else{
        if(!b){document.getElementById('desktop-local-stop')?.remove();b=node('button','secondary');b.id='desktop-local-stop';b.type='button';b.onclick=()=>void stopLocal();panel.append(b);}
        const text=language()==='zh'?'暂停 App 聊天':'Pause App chat';if(b.textContent!==text)b.textContent=text;b.disabled=!!selecting;
      }
    }
    // First run: the key entry card in the thread is the whole interface.
    if(only&&!selectionMessage&&(window.ArcadeFirstRun.needed(state)&&!messageCount()||kindOf(state)==='local'&&state.bot.local.available&&state.bot.local.reason!=='scope_limit')){box?.remove();return;}
    if(!box){box=node('section','desktop-conversation-choice');box.id='desktop-conversation-choice';document.getElementById('bot-inbox').insertBefore(box,document.getElementById('bot-thread-scroll'));}
    const zh=language()==='zh',local=state.bot.local,kind=kindOf(state),focused=box.contains(document.activeElement)?document.activeElement.id:null,row=node('div','desktop-conversation-row'),group=node('div','desktop-conversation-options');group.setAttribute('role','group');group.setAttribute('aria-label',zh?'对话位置':'Conversation location');
    for(const [value,label]of [['local',zh?'App 对话':'App conversation'],['channel',channelLabel(state)+(zh?'对话':' conversation')]]){const b=node('button','plain',label);b.type='button';b.id='desktop-conversation-'+value;b.setAttribute('aria-pressed',String(kind===value));b.disabled=!!selecting||value==='local'&&!local.available&&!local.canStart&&['credentials_busy','stopping','busy','stop_failed','storage_unavailable'].includes(local.reason);b.onclick=()=>value==='local'&&!local.available&&!local.canStart?setupAI():void selectConversation(value);group.append(b);}if(!only)row.append(group);
    if(local.reason==='stop_failed'&&typeof window.arcade.desktopLocalStop==='function'){const b=node('button','plain',zh?'再次暂停 App 聊天':'Retry pausing App chat');b.id='desktop-local-stop';b.type='button';b.disabled=!!selecting;b.onclick=()=>void stopLocal();row.append(b);}
    const hint=node('p','desktop-conversation-note',kind==='local'?(zh?'仅在这里回复，聊天与 QQ 分开保存；切换会停止当前回复。':'Replies stay here, saved separately from QQ. Switching stops the current reply.'):!local.supported?(zh?'当前本机方式用于派活；App 陪伴聊天请选择 API。':'This local method is for tasks. Choose an API for App companion chat.'):(zh?'保留原聊天记录。切换位置会停止当前回复。':'The original conversation stays here. Switching stops the current reply.'));
    box.replaceChildren(...(only?[row]:[row,hint]));
    if(kind!=='local'&&local.reason==='stop_failed')box.append(node('p','desktop-conversation-status',localReason(local,zh)));
    if(kind==='local'&&!local.available||only&&kind!=='local'){const text=localReason(local,zh)||(!local.supported?(zh?'当前本机方式仅用于派活。请选择支持陪伴聊天的 API。':'This local method is for tasks. Choose an API that supports companion chat.'):local.canStart?(zh?'准备好就继续聊吧。':'Continue when you are ready.'):(zh?'先保存 AI 凭据，就可以在这里聊天。':'Save your AI credentials to chat here.'));const p=node('p','desktop-conversation-status',text),b=node('button','secondary',local.canStart?(zh?'开始聊天':'Start chatting'):(zh?'设置 AI':'Set up AI'));b.id='desktop-local-start';b.type='button';b.disabled=!!selecting||!local.canStart&&['credentials_busy','stopping','busy','stop_failed','storage_unavailable'].includes(local.reason);b.onclick=()=>local.canStart?void selectConversation('local'):setupAI();box.append(p,b);}
    if(selectionMessage){const p=node('p','desktop-conversation-status',selectionMessage);p.setAttribute('role','status');box.append(p);}
    if(local.reason==='scope_limit'&&typeof window.ArcadeST?.showConversations==='function'){const b=node('button','plain',zh?'查看并清除已保存的对话':'Review and clear saved conversations');b.id='desktop-local-clear-list';b.type='button';b.onclick=()=>window.ArcadeST.showConversations();box.append(b);}
    if(focused)box.querySelector('#'+CSS.escape(focused))?.focus({preventScroll:true});
  }
  window.ArcadeDesktopConversation={
    select:selectConversation,
    stateKey:()=>JSON.stringify([!!selecting,selectionMessage]),
    mountEntry(container,next){
      if(!next.bot?.local||typeof window.arcade.desktopConversationSelect!=='function')return;
      const local=next.bot.local,zh=next.config.language==='zh',retryStop=local.reason==='stop_failed',row=node('section','desktop-connection-entry'),copy=node('div');
      const text=localReason(local,zh)||(local.supported?(local.available||local.canStart?(zh?'可以先在 App 里聊，QQ 和微信稍后连接。':'Try chatting in App first. QQ and WeChat can wait.'):(zh?'保存 AI 凭据后，就能直接开始。':'Save your AI credentials to start here.')):(zh?'当前本机方式用于派活。陪伴聊天请选择 API。':'This local method is for tasks. Choose an API for companion chat.'));
      copy.append(node('h2','',zh?'先在这里聊聊':'Chat here first'),node('p','',text));
      if(selectionMessage){const status=node('p','desktop-conversation-status',selectionMessage);status.setAttribute('role','status');copy.append(status);}
      const b=node('button','secondary',retryStop?(zh?'再次暂停 App 聊天':'Retry pausing App chat'):local.available||local.canStart?(zh?'在 App 里聊':'Chat in App'):(zh?'设置 AI':'Set up AI'));b.id='onboarding-app-chat';b.type='button';b.disabled=!!selecting||!retryStop&&!local.canStart&&!local.available&&['credentials_busy','stopping','busy','storage_unavailable'].includes(local.reason);b.onclick=()=>retryStop?void stopLocal():local.available||local.canStart?void selectConversation('local',true):setupAI();row.append(copy,b);container.append(row);
    }
  };

  // Leaving the page or changing language ends an in-flight reply. Keep the
  // text that was sent and say so on return, instead of losing both silently.
  let interrupted='';
  function dispose(){revision++;const old=current;current=null;if(!old)return;old.dead=true;if(old.busy&&old.pendingText&&!old.editor.value&&!old.composing&&old.draftRevision===old.sentDraftRevision){old.editor.value=old.pendingText;interrupted=old.key;}saveDraft(old);old.editor.value='';old.clearImage?.();old.element.remove();if(old.session)void window.arcade.desktopChatClose(old.session).catch(()=>{});}
  function mount(context){
    const lang=state.config.language==='zh'?'zh':'en',t=copies[lang],it=imageCopy[lang],p={context,lang,dead:false,busy:false,session:null,opening:null,image:null,imageBusy:false,composing:false,draftRevision:0,accountId:state.accounts.selectedId,contextId:state.desktopChat.contextId,key:draftKey(state),scope:draftScope(state)};current=p;
    const box=node('form','desktop-chat');box.id='desktop-chat';box.setAttribute('aria-label',t.label);
    const label=node('label','sr-only',t.label),editor=node('textarea');editor.id='desktop-chat-input';editor.rows=2;editor.maxLength=2000;editor.placeholder=t.placeholder;label.htmlFor=editor.id;const saved=drafts.get(p.key);if(saved?.scope===p.scope)editor.value=saved.value;else if(saved?.value)p.recovery=saved;
    const foot=node('div','desktop-chat-footer'),note=node('p','desktop-chat-note',t.note),count=node('span','desktop-chat-count','0 / 2000'),send=node('button','primary',t.send),stop=node('button','secondary',t.stop),status=node('p','desktop-chat-status');
    send.id='desktop-chat-send';send.type='submit';stop.id='desktop-chat-stop';stop.type='button';stop.hidden=true;status.id='desktop-chat-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;
    note.id='desktop-chat-key-hint';editor.setAttribute('aria-describedby',note.id);
    const imageTools=node('div','desktop-chat-image-tools'),choose=node('button','plain desktop-chat-image-choose',it.add),preview=node('div','desktop-chat-image-preview'),thumbnail=node('img'),details=node('span','desktop-chat-image-details'),remove=node('button','plain desktop-chat-image-remove',it.remove);
    choose.id='desktop-chat-image-choose';choose.type='button';choose.setAttribute('aria-label',it.add);preview.id='desktop-chat-image-preview';preview.hidden=true;thumbnail.alt=it.alt;remove.id='desktop-chat-image-remove';remove.type='button';remove.setAttribute('aria-label',lang==='zh'?'移除已选图片':'Remove selected image');preview.append(thumbnail,details,remove);imageTools.append(choose,preview);
    const recover=node('div','desktop-chat-recover');recover.id='desktop-chat-recover';recover.hidden=true;
    foot.append(note,count,stop,send);box.append(label,imageTools,editor,foot,status,recover);Object.assign(p,{element:box,editor,send,stop,status,note});updateSendHint(p);
    if(p.recovery){const recover=node('button','plain desktop-draft-recover',lang==='zh'?'恢复先前草稿':'Restore previous draft');recover.type='button';recover.id='desktop-draft-recover';recover.onclick=()=>{if(current!==p||editor.value)return;editor.value=p.recovery.value;p.recovery=null;p.draftRevision++;recover.remove();update();editor.focus();};box.append(recover);}
    document.getElementById('bot-inbox').insertBefore(box,document.querySelector('.bot-input-note'));
    const valid=()=>current===p&&!p.dead&&currentContext()===p.context;
    const imageSupported=()=>kindOf(state)==='local'&&state.desktopChat?.imageSupported===true&&typeof window.arcade.desktopChatSelectImage==='function'&&typeof window.arcade.desktopChatRemoveImage==='function';
    const update=()=>{
      count.textContent=`${editor.value.length} / 2000`;
      const switching=switchingSource();
      send.disabled=switching||p.busy||p.imageBusy||!!messageOp||!!p.image&&!imageSupported()||!editor.value.trim()||editor.value.length>2000;
      const retry=recover.querySelector('#desktop-chat-retry');if(retry)retry.disabled=switching;
      stop.hidden=!p.busy;syncTools();imageTools.hidden=kindOf(state)!=='local';
      choose.disabled=switching||p.busy||p.imageBusy||!imageSupported();choose.title=imageSupported()?'':it.unsupported;
      choose.textContent=p.image?it.replace:it.add;choose.setAttribute('aria-label',p.image?it.replace:it.add);
      remove.disabled=p.busy||p.imageBusy;
    };
    const message=(text,error=false,actions=[])=>{status.textContent=text;status.hidden=!text;status.dataset.error=String(error);recover.replaceChildren(...actions);recover.hidden=!actions.length;};
    // A failed App reply says which kind of failure it was (desktop-chat.cjs classifies it) and
    // offers the one useful next step: check the key, or send the same text again.
    const ft=failureCopy[lang];
    const recovery=(failure,sent,hadImage)=>{
      const actions=[];
      if(['network','other'].includes(failure)&&!hadImage){const b=node('button','secondary',ft.retry);b.type='button';b.id='desktop-chat-retry';b.onclick=()=>void submitText(sent,true);actions.push(b);}
      if(['auth','quota','other'].includes(failure)&&window.ArcadeFirstRun){const b=node('button','secondary',ft.checkKey);b.type='button';b.id='desktop-chat-check-key';b.onclick=()=>window.ArcadeFirstRun.open({provider:window.ArcadeFirstRun.providerOf(state)});actions.push(b);}
      return actions;
    };
    const imageError=error=>Object.hasOwn(it,error?.code)?it[error.code]:it.image_read_failed;
    p.clearImage=()=>{p.image=null;thumbnail.removeAttribute('src');details.textContent='';preview.hidden=true;};
    p.update=update;p.message=message;
    const ensureSession=()=>{
      if(p.session)return Promise.resolve(p.session);
      if(p.opening)return p.opening;
      const epoch=revision;
      p.opening=(async()=>{
        const opened=await window.arcade.desktopChatOpen({accountId:p.accountId,contextId:p.contextId,panelId:crypto.randomUUID()});
        if(opened?.ok!==true)throw opened;
        const session={sessionId:opened.sessionId,contextId:opened.contextId};
        if(!valid()||revision!==epoch){void window.arcade.desktopChatClose(session).catch(()=>{});return null;}
        p.session=session;return session;
      })().finally(()=>{p.opening=null;});
      return p.opening;
    };
    choose.addEventListener('click',async()=>{
      if(!valid()||switchingSource()||p.busy||p.imageBusy||!imageSupported())return;
      p.imageBusy=true;update();message(it.choosing);
      try{const session=await ensureSession();if(!session||!valid())return;const result=await window.arcade.desktopChatSelectImage(session);if(!valid())return;if(result?.ok===true&&result.cancelled===true){message('');return;}if(!validImage(result))throw result;
        p.image={attachmentId:result.attachmentId};thumbnail.src=result.preview;details.textContent=`${result.width} × ${result.height} · ${Math.ceil(result.bytes/1024)} KiB`;preview.hidden=false;message('');
      }catch(error){if(valid())message(imageError(error),true);}
      finally{if(valid()){p.imageBusy=false;update();choose.focus({preventScroll:true});}}
    });
    remove.addEventListener('click',async()=>{
      if(!valid()||p.busy||p.imageBusy||!p.image||!p.session)return;
      const attachmentId=p.image.attachmentId;p.imageBusy=true;update();message(it.removing);
      try{const result=await window.arcade.desktopChatRemoveImage({...p.session,attachmentId});if(!valid())return;if(result?.ok!==true||result.removed!==true)throw result;p.clearImage();message('');}
      catch(error){if(valid())message(imageError(error),true);}
      finally{if(valid()){p.imageBusy=false;update();choose.focus({preventScroll:true});}}
    });
    editor.addEventListener('input',()=>{p.draftRevision++;update();});editor.addEventListener('compositionstart',()=>{p.composing=true;p.draftRevision++;});editor.addEventListener('compositionend',()=>{p.composing=false;});
    editor.addEventListener('keydown',e=>{
      if(e.key!=='Enter'||e.isComposing||p.composing||e.keyCode===229||e.repeat)return;
      if(e.shiftKey){
        // Chromium does not insert a newline for Ctrl+Shift+Enter by default.
        if(e.ctrlKey||e.metaKey||e.altKey){e.preventDefault();const start=editor.selectionStart,end=editor.selectionEnd;if(editor.value.length-(end-start)+1<=editor.maxLength){editor.setRangeText('\n',start,end,'end');editor.dispatchEvent(new Event('input',{bubbles:true}));}}
        return;
      }
      // Windows and Linux: Control is the modifier and the Windows/Super key never sends.
      // macOS: Command (or Control) is the modifier.
      const modifier=macHost?e.metaKey||e.ctrlKey:e.ctrlKey;
      if(e.altKey||!macHost&&e.metaKey)return;
      if(sendShortcut()==='ctrl-enter'?!modifier:modifier)return;
      e.preventDefault();if(!send.disabled)box.requestSubmit();
    });
    box.addEventListener('submit',e=>{e.preventDefault();void submitText(editor.value);});
    async function submitText(text,retry=false){
      if(!valid()||switchingSource()||p.busy||p.imageBusy||messageOp||!retry&&p.image&&!imageSupported()||!text.trim()||text.length>2000||p.composing)return;
      const studio=state.characterSticker;
      if(!retry&&!p.image&&kindOf(state)==='local'&&studio?.accountId===p.accountId){
        const intent=window.ArcadeChatDrawingRequest?.classify(text,studio.roleName);
        if(intent){
          const originalRevision=p.draftRevision;
          const onUsed=()=>{
            if(valid()&&p.draftRevision===originalRevision&&editor.value===text){
              editor.value='';p.draftRevision++;saveDraft(p);update();
            }
          };
          if(intent.kind==='recent'){
            const binding={accountId:p.accountId,historyId:state.bot?.local?.historyId};
            p.imageBusy=true;update();
            message(lang==='zh'?'正在打开最近的作品…':'Opening the latest drawing…');
            try {
              const result=await window.ArcadeChatDrawing?.openRecent(binding,editor);
              if(!valid())return;
              if(result==='opened'||result==='not_found')onUsed();
              if(result==='opened')message('');
              else if(result==='not_found')message(lang==='zh'?'这段对话里还没有作品。':'There are no drawings in this conversation yet.');
              else if(result==='changed')message(t.changed,true);
              else message(lang==='zh'?'暂时读不到这张图，请再试一次。':'The drawing could not be opened. Try again.',true);
            } finally {if(valid()){p.imageBusy=false;update();}}
            return;
          }
          const opened=window.ArcadeCharacterSticker?.openFromChat({intent,text,scope:studio,onUsed,origin:editor});
          message(opened?'':t.changed,!opened);
          return;
        }
      }
      const attachmentId=retry?undefined:p.image?.attachmentId,epoch=revision,draftRevision=p.draftRevision,requestId=crypto.randomUUID();
      // Retry sends the failed text. A different draft and its attachment belong
      // to the next normal Send, even if the retry itself fails or is cancelled.
      const consumeDraft=!retry||editor.value===text&&!p.image;
      p.busy=true;p.requestId=requestId;p.pendingText=consumeDraft?text:'';p.sentDraftRevision=draftRevision;p.stopping=false;stop.disabled=false;
      if(consumeDraft)editor.value='';
      if(!retry)p.clearImage();
      update();message(t.thinking);
      const restore=()=>{if(consumeDraft&&valid()&&revision===epoch&&p.draftRevision===draftRevision&&!p.composing&&editor.value==='')editor.value=text;};
      try{
        const session=await ensureSession();if(!session||!valid()||revision!==epoch)return;
        if(p.stopping||switchingSource()){restore();message(t.cancelled+(attachmentId?' '+it.reselect:''));return;}
        const result=await window.arcade.desktopChatSend({...session,requestId,text,...(attachmentId?{attachmentId}:{})});
        if(!valid()||revision!==epoch)return;
        if(result.ok!==true)throw result;
        const audio=result.audio;
        if(result.outcome==='reply_ended'&&audio&&state.desktopChat?.contextId===session.contextId&&
          typeof audio.dataUrl==='string'&&audio.dataUrl.length<=4200000&&/^data:audio\/wav;base64,[A-Za-z0-9+/]+={0,2}$/.test(audio.dataUrl)){
          replyAudio={...audio,contextId:session.contextId};decorate();
        }
        if(result.outcome==='cancelled'&&result.started===false)restore();
        message(result.outcome==='cancelled'?t.cancelled+(attachmentId?' '+it.reselect:''):'');
      }catch(error){if(valid()&&revision===epoch){
        restore();
        const failure=error?.code==='reply_failed'&&kindOf(state)==='local'&&Object.hasOwn(ft.classes,error?.failure)?error.failure:null;
        const explanation=failure?ft.classes[failure]+(editor.value===text?' '+ft.kept:''):Object.hasOwn(it,error?.code)?it[error.code]:error?.code==='prepare_failed'?t.prepare:error?.code==='changed'?t.changed:t.failed;
        message(explanation+(attachmentId?' '+it.reselect:''),true,failure?recovery(failure,text,!!attachmentId):[]);if(error?.code==='changed')p.session=null;}}
      finally{if(valid()&&revision===epoch){p.busy=false;p.requestId=null;p.pendingText='';update();if([document.body,send,stop,editor].includes(document.activeElement))editor.focus({preventScroll:true});}}
    }
    stop.addEventListener('click',()=>{if(!valid()||!p.busy)return;p.stopping=true;stop.disabled=true;message(t.stopping);if(p.session)void window.arcade.desktopChatCancel({...p.session,requestId:p.requestId}).catch(()=>{if(valid())message(t.failed,true);});});
    update();if(interrupted===p.key&&editor.value)message(t.cancelled);interrupted='';
  }

  // App conversation only: the imported character's name and portrait, and
  // per-message edit / delete / regenerate / continue / swipe. bot.js owns the
  // message rows and rebuilds one whenever its message changes, so everything
  // here is re-applied after each render and must be idempotent.
  const library=new Map();let messageOp=null,editing=null,lastTool=null,branchOp=false,branching=null,stream=null,announcement=null,bar=null,replyAudio=null;
  const toolCopy={zh:{edit:'编辑',remove:'删除',removeConfirm:'再点一次删除',regenerate:'重新生成',continue:'续写',save:'保存',cancel:'取消',edited:'已编辑',previous:'上一个版本',next:'下一个版本',nextNew:'下一个版本（重新生成）',position:(a,b)=>`第 ${a} 个版本，共 ${b} 个`,editLabel:'编辑这条消息',editHint:'Ctrl+Enter 保存，Esc 取消',needRunning:'先开始聊天才能使用',working:'正在生成…',saving:'正在保存…',
    codes:{busy:'正在回复或处理上一项操作，请等它结束后再试。',invalid_request:'这个操作现在不能用于这条消息。',invalid_text:'文字为空或超过长度上限，没有保存。',message_not_found:'这条消息已经不存在，没有改动。',unsupported:'这条消息现在不能重新生成或续写：需要正在运行的角色对话，并且最后一条是角色的回复。',unavailable:'App 对话没有在运行，请先点“开始聊天”。',storage_unavailable:'本机聊天记录暂时无法打开，请稍后再试。',scope_limit:'已保存 20 段角色对话，达到上限。请先清除一段不用的对话。',speaker_unavailable:'这个成员现在不能发言：它已静音，或已不在群聊或角色库中。',character_missing:'有成员已不在角色库中。请到角色库编辑这个群聊，把它移出。',group_not_found:'这个群聊已经不存在。请到角色库另选一个。',group_branch_unsupported:'群聊不能使用分支。'},fallback:'操作没有完成，请稍后再试。',failedReply:'这次没有生成出回复，原来的内容没有改动。'},
   en:{edit:'Edit',remove:'Delete',removeConfirm:'Click again to delete',regenerate:'Regenerate',continue:'Continue',save:'Save',cancel:'Cancel',edited:'edited',previous:'Previous version',next:'Next version',nextNew:'Next version (regenerate)',position:(a,b)=>`Version ${a} of ${b}`,editLabel:'Edit this message',editHint:'Ctrl+Enter saves, Esc cancels',needRunning:'Start chatting first',working:'Generating…',saving:'Saving…',
    codes:{busy:'A reply or another action is still running. Try again when it ends.',invalid_request:'This action cannot be used on this message right now.',invalid_text:'The text is empty or longer than allowed. Nothing was saved.',message_not_found:'This message no longer exists. Nothing was changed.',unsupported:'This message cannot be regenerated or continued now: it needs a running character conversation whose last message is the character\'s reply.',unavailable:'The App conversation is not running. Choose Start chatting first.',storage_unavailable:'Local chat history could not be opened. Please try again.',scope_limit:'20 character conversations are stored, which is the limit. Clear one you no longer use first.',speaker_unavailable:'This member cannot speak right now: it is muted, or no longer in the group chat or the library.',character_missing:'A member is no longer in the character library. Edit this group chat in the library and remove it.',group_not_found:'This group chat no longer exists. Choose another in the character library.',group_branch_unsupported:'Branches are not available in a group chat.'},fallback:'The action did not complete. Please try again.',failedReply:'No reply was generated. The earlier text is unchanged.'}};
  const letterAvatar=name=>{const first=([...String(name||'').trim()][0]||'?').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]);return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#f3dfe9"/><text x="32" y="43" font-size="30" text-anchor="middle" fill="#7a5568" font-family="sans-serif">${first}</text></svg>`);};
  const localSnapshot=()=>kindOf(state)==='local'?state?.bot?.local||null:null;
  const toolsBlocked=()=>!!(messageOp||branchOp||selecting||current?.busy||current?.imageBusy||state?.bot?.local?.streaming||['starting','stopping'].includes(state?.bot?.local?.state));
  function syncTools(){const blocked=toolsBlocked();for(const b of document.querySelectorAll('#bot-messages [data-tool]'))b.disabled=blocked||b.dataset.off==='true';for(const b of document.querySelectorAll('#desktop-group-speak button'))b.disabled=blocked;syncBranching(blocked);if(editing?.save)editing.save.disabled=blocked||!editing.area.value.trim()||editing.area.value.length>editing.cap;}
  function feedback(text,error=false){
    if(current&&!current.dead&&current.message)current.message(text,error);
    else{selectionMessage=text;renderChoice();}
  }
  async function runMessage(request,pending){
    if(toolsBlocked()||typeof window.arcade.localMessage!=='function')return null;
    const t=toolCopy[language()],op=messageOp={};syncTools();current?.update();feedback(pending||'');let result=null;
    try{result=await window.arcade.localMessage(request);if(result?.ok!==true)throw result;feedback(result.outcome==='cancelled'?copies[language()].cancelled:result.outcome==='failed'?t.failedReply:'',result.outcome==='failed');}
    catch(error){result=null;feedback(Object.hasOwn(t.codes,error?.code)?t.codes[error.code]:t.fallback,true);}
    finally{if(messageOp===op)messageOp=null;current?.update();decorate();}
    return result;
  }
  // One library character's name and portrait. `name` is the current name when the caller knows it.
  function person(id,name){
    let info=library.get(id);
    if(!info){
      info={name:'',thumb:'',avatar:''};library.set(id,info);
      // Fetched once per character and kept; the portrait never rides in the snapshot.
      if(typeof window.arcade.charactersGet==='function')void window.arcade.charactersGet(id).then(card=>{if(!card)return;info.name=info.name||card.name||'';info.thumb=typeof card.thumb==='string'&&/^data:image\//.test(card.thumb)?card.thumb:'';info.avatar='';if(state)decorate();}).catch(()=>{});
    }
    if(name&&info.name!==name){info.name=name;info.avatar='';}
    if(info.name)info.avatar=info.avatar||info.thumb||letterAvatar(info.name);
    return info;
  }
  // Group chat: the group in use by the App conversation, or null. Members come from the snapshot.
  const groupOf=local=>{const id=local?.libraryGroupId||null,known=state?.bot?.st?.group;return id?(known?.id===id?{id,name:known.name||'',members:Array.isArray(known.members)?known.members:[]}:{id,name:'',members:[]}):null;};
  // A group message's speaker: the stored name and an initial when the character is gone.
  const speakerOf=(id,name,fallback)=>{if(!id)return fallback;const info=person(id,name||'');return info.name?info:fallback;};
  function renderFaces(group){
    const mascot=document.getElementById('bot-mascot'),show=!!group&&!!mascot&&(state.config?.portrait||'anime')==='anime';let box=document.getElementById('desktop-group-faces');
    if(!show){box?.remove();delete document.body.dataset.desktopGroup;return;}
    document.body.dataset.desktopGroup='true';
    const zh=language()==='zh',members=group.members,key=JSON.stringify([zh,members.map(m=>[m.id,m.name])]);
    if(!box){box=node('div','desktop-group-faces');box.id='desktop-group-faces';box.setAttribute('role','img');}
    if(box.previousElementSibling!==mascot)mascot.after(box);
    if(box.dataset.key!==key){
      box.dataset.key=key;box.setAttribute('aria-label',`${zh?'群聊成员':'Group chat members'}${zh?'：':': '}${members.map(m=>m.name).join(zh?'、':', ')}`);
      box.replaceChildren(...members.slice(0,5).map(m=>{const image=node('img','desktop-group-face');image.alt='';image.dataset.memberId=m.id;return image;}),...(members.length>5?[node('span','desktop-group-more',`+${members.length-5}`)]:[]));
    }
    for(const image of box.querySelectorAll('img')){const m=members.find(item=>item.id===image.dataset.memberId),info=m?person(m.id,m.name):null;if(info?.avatar&&image.getAttribute('src')!==info.avatar)image.src=info.avatar;}
  }
  function identity(local){
    const id=local?.libraryCharacterId||null,image=document.querySelector('#bot-mascot img.portrait'),group=groupOf(local);
    renderFaces(group);
    if(!id){
      if(image?.dataset.builtin){image.src=image.dataset.builtin;delete image.dataset.builtin;image.classList.remove('desktop-library-portrait');}
      if(!group)return null;
      // Lines of a group chat that no member wrote (memory receipts) carry the group's name.
      const name=group.name||(language()==='zh'?'群聊':'Group chat'),heading=document.querySelector('#bot-view [data-bot="title"]');if(heading&&heading.textContent!==name)heading.textContent=name;
      return {name,avatar:letterAvatar(name)};
    }
    const known=state.bot?.st?.character,info=person(id,known?.id===id?known.name:'');
    if(!info.name)return info;
    const title=document.querySelector('#bot-view [data-bot="title"]');if(title&&title.textContent!==info.name)title.textContent=info.name;
    if(image&&image.getAttribute('src')!==info.avatar){if(!image.dataset.builtin)image.dataset.builtin=image.getAttribute('src');image.src=info.avatar;image.classList.add('desktop-library-portrait');}
    return info;
  }
  function toolButton(name,text,label){const b=node('button','message-copy desktop-message-tool',text);b.type='button';b.dataset.tool=name;if(label)b.setAttribute('aria-label',label);return b;}
  function closeEdit(focusEdit){const done=editing;editing=null;if(!done)return;done.wrap.remove();if(done.body)done.body.hidden=false;if(focusEdit)lastTool={id:done.id,name:'edit'};}
  function openEdit(row,m,cap){
    const t=toolCopy[language()],body=row.querySelector(':scope>.message-body');if(!body)return;
    if(editing&&editing.id!==m.id)closeEdit(false);
    const fresh=!editing,area=editing?.area||node('textarea','desktop-message-edit-area'),wrap=node('div','desktop-message-edit'),foot=node('div','desktop-message-edit-foot'),count=node('span','desktop-chat-count'),hint=node('span','desktop-message-edit-hint',macHost?t.editHint.replace('Ctrl+','⌘+'):t.editHint),save=node('button','primary',t.save),cancel=node('button','secondary',t.cancel);
    if(fresh){area.value=m.text||'';area.rows=Math.min(12,Math.max(3,Math.ceil((m.text||'').length/60)));area.setAttribute('aria-label',t.editLabel);}
    area.maxLength=cap;save.type=cancel.type='button';
    const state0=editing={id:m.id,area,wrap,body,save,cap,focused:fresh||editing?.focused===true};
    const refresh=()=>{count.textContent=`${area.value.length} / ${cap}`;syncTools();};
    area.oninput=refresh;area.onfocus=()=>{state0.focused=true;};area.onblur=()=>{if(area.isConnected)state0.focused=false;};
    area.onkeydown=e=>{if(e.isComposing||e.keyCode===229)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel.click();}else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();if(!save.disabled)save.click();}};
    cancel.onclick=()=>{closeEdit(true);decorate();};
    save.onclick=async()=>{
      const text=area.value;if(!text.trim()||text.length>cap||toolsBlocked())return;
      if(text===m.text){closeEdit(true);decorate();return;}
      const result=await runMessage({action:'edit',id:m.id,text},t.saving);
      // A live snapshot can rebuild the wrapper before IPC resolves. Match the
      // retained editor, while preserving a newer draft or a reopened editor.
      if(result&&editing?.id===m.id&&editing.area===area&&area.value===text){closeEdit(true);decorate();}
    };
    foot.append(hint,count,cancel,save);wrap.append(area,foot);body.hidden=true;body.after(wrap);refresh();if(fresh)wrap.scrollIntoView({block:'nearest'});
    if(state0.focused&&[document.body,null].includes(document.activeElement)||fresh)area.focus({preventScroll:true});
  }
  function buildTools(row,m,options){
    const t=toolCopy[language()],tools=node('span','desktop-message-tools'),actions=row.querySelector(':scope>.message-actions')||row.appendChild(node('div','message-actions'));
    tools.dataset.stamp=options.stamp;
    const edit=toolButton('edit',t.edit),remove=toolButton('remove',t.remove);
    edit.onclick=()=>{if(toolsBlocked())return;openEdit(row,m,options.cap);decorate();};
    let armed=false;const disarm=()=>{armed=false;remove.textContent=t.remove;};
    remove.addEventListener('blur',()=>{if(remove.isConnected)disarm();});
    remove.onclick=async()=>{if(toolsBlocked())return;if(!armed){armed=true;remove.textContent=t.removeConfirm;return;}disarm();if(editing?.id===m.id)closeEdit(false);const result=await runMessage({action:'remove',id:m.id});if(result){lastTool=null;document.getElementById('desktop-chat-input')?.focus({preventScroll:true});}};
    tools.append(edit,remove);
    if(options.branch){const branch=toolButton('branch',bt().from);branch.onclick=()=>{if(toolsBlocked())return;openBranching(row,m,true);};tools.append(branch);}
    if(options.rework){
      const regenerate=toolButton('regenerate',t.regenerate),more=toolButton('continue',t.continue),swipes=node('span','desktop-message-swipes'),previous=toolButton('swipe-previous','‹',t.previous),position=node('span','desktop-message-swipe-count',`${m.swipeIndex+1}/${m.swipeCount}`),atEnd=m.swipeIndex>=m.swipeCount-1,next=toolButton('swipe-next','›',atEnd?t.nextNew:t.next);
      position.setAttribute('aria-label',t.position(m.swipeIndex+1,m.swipeCount));previous.title=t.previous;next.title=atEnd?t.nextNew:t.next;
      for(const b of [regenerate,more])if(!options.running){b.dataset.off='true';b.title=t.needRunning;}
      if(m.swipeIndex<=0)previous.dataset.off='true';if(atEnd&&!options.running){next.dataset.off='true';next.title=t.needRunning;}
      regenerate.onclick=()=>void runMessage({action:'regenerate'},t.working);more.onclick=()=>void runMessage({action:'continue'},t.working);
      previous.onclick=()=>void runMessage({action:'swipe',id:m.id,index:m.swipeIndex-1});
      next.onclick=()=>void(atEnd?runMessage({action:'regenerate'},t.working):runMessage({action:'swipe',id:m.id,index:m.swipeIndex+1}));
      swipes.setAttribute('role','group');swipes.setAttribute('aria-label',t.position(m.swipeIndex+1,m.swipeCount));swipes.append(previous,position,next);
      tools.append(regenerate,more);actions.append(swipes);
    }
    actions.append(tools);
  }
  // App conversations: the reply being generated (shown as it arrives),
  // display-only text, and conversation branches. A branch is a copy of the
  // conversation up to one message; switching restarts the App conversation
  // the same way choosing another character does.
  const branchCopy={zh:{from:'从这里开分支',nameLabel:'分支名称（可留空，最多 60 字）',create:'创建分支',cancel:'取消',creating:'正在创建分支…',created:name=>`已创建分支“${name}”，内容到这条消息为止。`,switchTo:'切换到这个分支',stay:'留在当前分支',label:name=>`当前分支：${name}`,manage:count=>`管理分支（${count}）`,panel:'对话分支',note:'分支是这段对话到某条消息为止的副本，各自继续、互不影响，最多 30 个。更正或忘记一条记忆会清除这个角色的全部分支。',main:'主线',active:'使用中',use:'切换',useLabel:name=>`切换到：${name}`,rename:'重命名',renameLabel:name=>`重命名：${name}`,renameInput:'新的分支名称',save:'保存',remove:'删除',removeLabel:name=>`删除分支：${name}`,removeConfirm:'再点一次删除',removeActive:'使用中的分支不能删除，请先切换到别的分支。',loading:'正在读取…',meta:(count,from)=>`${count} 条消息 · 从“${from}”分出`,mainMeta:'最初的对话',switching:'正在切换…',switched:name=>`已切换到“${name}”。`,notStarted:name=>`已切换到“${name}”，但对话没有重新开始：`,renaming:'正在保存…',renamed:'已重命名。',removing:'正在删除…',removed:'已删除分支。',nameEmpty:'名称不能为空。',
    codes:{busy:'正在回复或处理上一项操作，请等它结束后再试。',unsupported:'只有角色库角色的 App 对话可以使用分支。',unavailable:'App 对话现在不能使用分支，请稍后再试。',message_not_found:'这条消息已经不存在，没有创建分支。',branch_not_found:'这个分支已经不存在。',branch_active:'使用中的分支不能删除，请先切换到别的分支。',branch_limit:'已有 30 个分支，达到上限。请先删除一个不用的分支。',scope_limit:'已保存的角色对话达到上限。请先在角色库里清除一段不用的对话。',invalid_request:'名称不符合要求：不能为空，最多 60 字。',storage_unavailable:'本机聊天记录暂时无法打开，请稍后再试。'},fallback:'操作没有完成，请稍后再试。',
    typing:'正在输入…',regenerating:'正在重新生成…',continuing:'正在续写…',adjusted:'显示已调整',adjustedTitle:'显示经过正则调整；编辑时从保存的原文开始。'},
   en:{from:'Branch from here',nameLabel:'Branch name (optional, up to 60 characters)',create:'Create branch',cancel:'Cancel',creating:'Creating the branch…',created:name=>`Created the branch “${name}”, holding the conversation up to this message.`,switchTo:'Switch to this branch',stay:'Stay on the current branch',label:name=>`Current branch: ${name}`,manage:count=>`Manage branches (${count})`,panel:'Conversation branches',note:'A branch is a copy of this conversation up to one message. Each continues separately; up to 30 are kept. Correcting or forgetting a memory clears all branches of this character.',main:'Main line',active:'In use',use:'Switch',useLabel:name=>`Switch to: ${name}`,rename:'Rename',renameLabel:name=>`Rename: ${name}`,renameInput:'New branch name',save:'Save',remove:'Delete',removeLabel:name=>`Delete branch: ${name}`,removeConfirm:'Click again to delete',removeActive:'The branch in use cannot be deleted. Switch to another branch first.',loading:'Loading…',meta:(count,from)=>`${count} messages · branched from “${from}”`,mainMeta:'The original conversation',switching:'Switching…',switched:name=>`Switched to “${name}”.`,notStarted:name=>`Switched to “${name}”, but the conversation did not restart: `,renaming:'Saving…',renamed:'Renamed.',removing:'Deleting…',removed:'Branch deleted.',nameEmpty:'The name cannot be empty.',
    codes:{busy:'A reply or another action is still running. Try again when it ends.',unsupported:'Branches are only available in the App conversation of a library character.',unavailable:'Branches cannot be used in the App conversation right now. Please try again.',message_not_found:'This message no longer exists. No branch was created.',branch_not_found:'This branch no longer exists.',branch_active:'The branch in use cannot be deleted. Switch to another branch first.',branch_limit:'30 branches exist, which is the limit. Delete one you no longer use first.',scope_limit:'The limit of stored character conversations is reached. Clear one you no longer use in the character library first.',invalid_request:'The name is not valid: it cannot be empty or longer than 60 characters.',storage_unavailable:'Local chat history could not be opened. Please try again.'},fallback:'The action did not complete. Please try again.',
    typing:'typing…',regenerating:'regenerating…',continuing:'continuing…',adjusted:'display adjusted',adjustedTitle:'Adjusted for display by a regex script. Editing starts from the stored text.'}};
  const bt=()=>branchCopy[language()];
  const branchProblem=error=>{const t=bt(),code=typeof error?.code==='string'?error.code:window.ArcadeST?.codeOf?.(error)||'';return Object.hasOwn(t.codes,code)?t.codes[code]:t.fallback;};
  // The branch calls answer {ok:true,...} or {ok:false,code}; a thrown error is treated the same.
  const branchCall=async run=>{const result=await run();if(result?.ok===false)throw result;return result;};
  // Switching retires the running conversation; it is started again through the
  // same call the chat page's own buttons use. Returns a sentence when the restart failed.
  async function useBranch(id,name){
    await window.arcade.stConfigure({branchId:id});
    const started=await selectConversation('local',false,{force:true});
    return started?.ok===false?bt().notStarted(name)+(window.ArcadeST?.explain?.(started,language()==='zh')||bt().fallback):'';
  }

  // "Branch from here": an inline name field under the message, then an offer to switch.
  function syncBranching(blocked){if(!branching)return;for(const b of branching.wrap.querySelectorAll('button,input'))b.disabled=blocked&&b.dataset.always!=='true';}
  function closeBranching(focusTool){const done=branching;branching=null;if(!done)return;done.wrap.remove();if(focusTool){lastTool={id:done.id,name:'branch'};decorate();}}
  function openBranching(row,m,fresh){
    const t=bt();
    if(branching&&branching.id!==m.id)closeBranching(false);
    if(branching){if(!branching.wrap.isConnected)row.append(branching.wrap);return;}
    const wrap=node('div','desktop-branch-new'),status=node('p','desktop-branch-status');status.setAttribute('role','status');
    const here=branching={id:m.id,wrap};
    const say=(text,error=false)=>{status.textContent=text||'';status.dataset.error=String(error);status.hidden=!text;};
    const leave=()=>{if(branching===here)closeBranching(true);};
    const offer=branch=>{
      const actions=node('div','desktop-branch-new-actions'),go=node('button','primary',t.switchTo),stay=node('button','secondary',t.stay);go.type=stay.type='button';stay.dataset.always='true';
      stay.onclick=leave;
      go.onclick=async()=>{
        if(toolsBlocked())return;branchOp=true;syncTools();say(t.switching);let problem='';
        try{problem=await useBranch(branch.id,branch.name);}catch(error){branchOp=false;syncTools();say(branchProblem(error),true);return;}
        branchOp=false;if(branching===here)closeBranching(false);lastTool=null;feedback(problem||t.switched(branch.name),!!problem);syncTools();current?.update();document.getElementById('desktop-chat-input')?.focus({preventScroll:true});
      };
      actions.append(go,stay);wrap.replaceChildren(status,actions);say(t.created(branch.name));go.focus({preventScroll:true});wrap.scrollIntoView({block:'nearest'});
    };
    const label=node('label','desktop-branch-new-label',t.nameLabel),input=node('input','desktop-branch-new-input'),actions=node('div','desktop-branch-new-actions'),create=node('button','primary',t.create),cancel=node('button','secondary',t.cancel);
    input.type='text';input.maxLength=60;input.id='desktop-branch-name';label.htmlFor=input.id;input.autocomplete='off';create.type=cancel.type='button';cancel.dataset.always='true';
    cancel.onclick=leave;
    create.onclick=async()=>{
      if(toolsBlocked())return;branchOp=true;syncTools();say(t.creating);
      try{const result=await branchCall(()=>window.arcade.branchFrom(m.id,input.value.trim()||null));branchOp=false;if(branching===here)offer(result.branch||{id:null,name:''});}
      catch(error){branchOp=false;say(branchProblem(error),true);if(branching===here)requestAnimationFrame(()=>input.focus({preventScroll:true}));}
      finally{syncTools();}
    };
    input.onkeydown=e=>{if(e.isComposing||e.keyCode===229)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();leave();}else if(e.key==='Enter'){e.preventDefault();if(!create.disabled)create.click();}};
    wrap.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();leave();}};
    actions.append(create,cancel);wrap.append(label,input,actions,status);say('');row.append(wrap);
    if(fresh){input.focus({preventScroll:true});wrap.scrollIntoView({block:'nearest'});requestAnimationFrame(()=>{if(branching===here&&wrap.isConnected)wrap.scrollIntoView({block:'nearest'});});}
  }

  // A row whose shown text differs from the stored text. Editing still starts from m.text.
  function showDisplay(row,m,meta){
    const body=row.querySelector(':scope>.message-body'),t=bt(),has=typeof m.display==='string'&&m.display!==m.text,mark=meta?.querySelector('.message-display-note');let touched=false;
    if(body&&(has||body.dataset.display==='true')){
      const shown=has?m.display:m.text||'';
      if(body.dataset.shown!==shown){body.textContent=shown;body.dataset.shown=shown;touched=true;}
      if(has)body.dataset.display='true';else{delete body.dataset.display;delete body.dataset.shown;}
    }
    if(has&&meta&&!mark){const note=node('span','message-edited message-display-note',t.adjusted);note.title=t.adjustedTitle;note.setAttribute('aria-label',t.adjustedTitle);meta.append(note);touched=true;}
    else if(!has&&mark){mark.remove();touched=true;}
    return touched;
  }
  function showReplyAudio(row,message,lang){
    const previous=row.querySelector(':scope>.desktop-reply-audio');
    const body=row.querySelector(':scope>.message-body');
    if(!body)return false;
    if(!replyAudio||message?.role!=='assistant'||message.id!==replyAudio.messageId||message.text!==replyAudio.text){
      if(!previous)return false;
      previous.remove();body.hidden=false;return true;
    }
    if(previous)return false;
    const panel=node('div','desktop-reply-audio'),audio=node('audio'),transcript=node('button','plain');
    const label=lang==='zh'?'当轮语音回复':'Play this reply';
    audio.controls=true;audio.preload='none';audio.src=replyAudio.dataUrl;audio.setAttribute('aria-label',label);
    transcript.type='button';transcript.textContent=lang==='zh'?'查看文字':'Show text';
    transcript.setAttribute('aria-expanded','false');body.hidden=true;
    transcript.onclick=()=>{body.hidden=!body.hidden;transcript.setAttribute('aria-expanded',String(!body.hidden));};
    audio.addEventListener('error',()=>{
      if(replyAudio?.messageId===message.id)replyAudio=null;
      panel.remove();body.hidden=false;
    },{once:true});
    panel.append(audio,transcript);body.before(panel);return true;
  }

  // The reply being generated. `reply` gets a provisional bubble at the end,
  // `regenerate` stands in for the last reply's text, `continue` is appended to it.
  // The growing text is not a live region; one announcement is made when the stored row lands.
  function announcer(){
    let live=document.getElementById('desktop-stream-live');
    if(!live){live=node('div','sr-only');live.id='desktop-stream-live';live.setAttribute('role','status');live.setAttribute('aria-live','polite');document.getElementById('bot-inbox')?.append(live);}
    return live;
  }
  const announcementScope=local=>local&&document.body.dataset.view==='bot'?JSON.stringify([state.accounts?.selectedId,kindOf(state),state.desktopChat?.contextId,local.characterId,local.libraryCharacterId,local.libraryGroupId,local.historyId,state.bot?.st?.settings?.branchId,state.bot?.st?.branch?.id]):null;
  const announcementMessage=m=>JSON.stringify([m.role,m.text,m.display,m.swipeIndex,m.speakerId,m.speakerName]);
  function clearAnnouncement(){announcement=null;document.getElementById('desktop-stream-live')?.remove();}
  function validateAnnouncement(local){
    const scope=announcementScope(local);
    // A stream from another context cannot complete against this thread's last row.
    if(stream&&stream.scope!==scope)dropStream();
    if(!announcement)return;
    const row=Array.isArray(local?.history)?local.history.find(m=>m.id===announcement.id):null;
    if(scope!==announcement.scope||row?.role!=='assistant'||announcementMessage(row)!==announcement.message)clearAnnouncement();
  }
  function dropStream(){
    const old=stream;stream=null;if(!old)return false;
    old.bubble.remove();old.text.remove();old.tail.remove();old.marker.remove();
    for(const row of document.querySelectorAll('#bot-messages .desktop-stream-replacing'))row.classList.remove('desktop-stream-replacing');
    return true;
  }
  function renderStream(list,rows,local,history,byId,identityInfo,group){
    const scope=announcementScope(local),s=scope&&local?.streaming&&typeof local.streaming.text==='string'&&['reply','regenerate','continue'].includes(local.streaming.mode)?local.streaming:null,t=bt(),last=history.at(-1);
    if(!s){
      if(!stream)return false;
      const done=stream.mode==='reply'?(last?.role==='assistant'&&last.id!==stream.baseLast?last:null):byId.get(stream.targetId)||null,text=done?(typeof done.display==='string'?done.display:done.text)||'':'',by=group?speakerOf(done?.speakerId,done?.speakerName,identityInfo):identityInfo;
      if(done?.role==='assistant'&&typeof done.id==='string'&&(stream.mode==='reply'||text!==stream.before)){announcement={scope,id:done.id,message:announcementMessage(done)};announcer().textContent=`${by?.name||''}${by?.name?(language()==='zh'?'：':': '):''}${text}`.slice(0,8200);}
      return dropStream();
    }
    // In a group chat the provisional bubble belongs to whoever is speaking now.
    const speakerId=group&&typeof s.speakerId==='string'?s.speakerId:'',info=speakerId?speakerOf(speakerId,group.members.find(m=>m.id===speakerId)?.name,identityInfo):identityInfo;
    const key=JSON.stringify([scope,s.mode,s.messageId||'',language(),speakerId]);let changed=false;
    if(stream?.key!==key){
      dropStream();changed=true;
      const lastReply=[...history].reverse().find(m=>m.role==='assistant'),targetId=s.mode==='reply'?null:(s.messageId&&byId.has(s.messageId)?s.messageId:lastReply?.id||null),before=byId.get(targetId);
      const bubble=node('article','bot-message from-agent desktop-stream'),meta=node('div','message-meta'),author=node('span','message-author'),text=node('div','message-body desktop-stream-text'),tail=node('span','desktop-stream-text desktop-stream-tail'),marker=node(s.mode==='reply'?'span':'p','desktop-stream-marker',s.mode==='reply'?t.typing:s.mode==='regenerate'?t.regenerating:t.continuing);
      bubble.dataset.role='assistant';text.setAttribute('aria-live','off');tail.setAttribute('aria-live','off');meta.append(author);
      stream={key,scope,mode:s.mode,targetId,baseLast:last?.id||null,before:before?(typeof before.display==='string'?before.display:before.text)||'':'',bubble,meta,author,text,tail,marker,shown:null};
      clearAnnouncement();
    }
    const v=stream,host=v.targetId?rows.find(row=>row.dataset.messageId===v.targetId):null,body=host?.querySelector(':scope>.message-body');
    const after=(el,ref)=>{if(el.previousSibling!==ref){ref.after(el);changed=true;}};
    if(v.shown!==s.text){(v.mode==='continue'&&body?v.tail:v.text).textContent=s.text;v.shown=s.text;changed=true;}
    if(v.mode==='reply'||!body){
      // Shown once only: when the stored row is already in the history, it replaces the provisional bubble.
      const landed=v.mode==='reply'&&(!!s.messageId&&byId.has(s.messageId)||last?.role==='assistant'&&last.id!==v.baseLast);
      if(landed){if(v.bubble.isConnected){v.bubble.remove();changed=true;}return changed;}
      if(info?.name&&v.author.textContent!==info.name)v.author.textContent=info.name;
      if(info?.avatar&&(state.config?.portrait||'anime')==='anime'){let image=v.meta.querySelector('img');if(!image){image=node('img','message-avatar desktop-library-portrait');image.alt='';v.meta.prepend(image);}if(image.getAttribute('src')!==info.avatar)image.src=info.avatar;}
      if(v.marker.parentNode!==v.meta)v.meta.append(v.marker);
      if(v.text.parentNode!==v.bubble)v.bubble.replaceChildren(v.meta,v.text);
      if(v.bubble.parentNode!==list||v.bubble.nextSibling){list.append(v.bubble);changed=true;}
    }else if(v.mode==='regenerate'){
      // Keep the earlier text until the first new characters arrive, so the row never collapses.
      const replacing=s.text.length>0;
      if(host.classList.contains('desktop-stream-replacing')!==replacing){host.classList.toggle('desktop-stream-replacing',replacing);changed=true;}
      if(replacing)after(v.text,body);else if(v.text.isConnected){v.text.remove();changed=true;}
      after(v.marker,replacing?v.text:body);
    }else{
      if(v.tail.parentNode!==body){body.append(v.tail);changed=true;}
      after(v.marker,body);
    }
    return changed;
  }

  // Compact branch indicator above the thread, with a disclosure list to switch, rename or delete.
  function closeBranchList(focusToggle){if(!bar||!bar.open)return;bar.open=false;bar.renaming=null;bar.panel.hidden=true;bar.toggle.setAttribute('aria-expanded','false');if(focusToggle)bar.toggle.focus({preventScroll:true});}
  async function loadBranches(){
    if(!bar||typeof window.arcade.branches!=='function')return;const token=bar.token=(bar.token||0)+1;let rows=[];
    try{const result=await window.arcade.branches();rows=Array.isArray(result)?result:Array.isArray(result?.branches)?result.branches:[];}catch{rows=[];}
    if(bar&&bar.token===token){bar.rows=rows;drawBranchList();}
  }
  function branchStatus(text,error=false){if(!bar)return;bar.status.textContent=text||'';bar.status.dataset.error=String(error);bar.status.hidden=!text;}
  async function branchAction(pending,run,focusKey){
    if(!bar||branchOp||toolsBlocked())return;branchOp=true;syncTools();drawBranchList();branchStatus(pending);
    try{const done=await run();branchOp=false;if(done.close){closeBranchList(false);feedback(done.text);return;}await loadBranches();branchStatus(done.text,done.error===true);}
    catch(error){branchOp=false;await loadBranches();branchStatus(branchProblem(error),true);}
    finally{branchOp=false;syncTools();current?.update();drawBranchList(focusKey);}
  }
  function drawBranchList(focusKey){
    if(!bar)return;if(focusKey&&![document.body,null].includes(document.activeElement)&&!bar.box.contains(document.activeElement))focusKey=null;
    const t=bt(),st=state?.bot?.st,activeId=st?.branch?.id||null,blocked=toolsBlocked(),held=bar.list.contains(document.activeElement)?document.activeElement:null;
    const wanted=focusKey||(held?[held.closest('li')?.dataset.branchId||'',held.dataset.act||'']:null);
    if(held&&held.dataset.act==='name'&&bar.renaming&&!focusKey){for(const b of bar.list.querySelectorAll('button'))b.disabled=blocked&&b.dataset.act!=='cancel';return;}
    if(!bar.rows){bar.list.replaceChildren(node('li','desktop-branch-row desktop-branch-loading',t.loading));return;}
    const names=new Map(bar.rows.map(row=>[row.id,row.name])),entries=[{id:null,name:t.main,main:true},...bar.rows];
    bar.list.replaceChildren(...entries.map(row=>{
      const item=node('li','desktop-branch-row'),copy=node('div','desktop-branch-row-body'),actions=node('div','desktop-branch-row-actions'),active=(row.id||null)===activeId,id=row.id||'';
      item.dataset.branchId=id;if(active)item.dataset.active='true';
      const act=(name,text,label)=>{const b=node('button','plain desktop-branch-act',text);b.type='button';b.dataset.act=name;if(label)b.setAttribute('aria-label',label);b.disabled=blocked;return b;};
      if(bar.renaming===id&&!row.main){
        const input=node('input','desktop-branch-rename');input.type='text';input.maxLength=60;input.value=row.name;input.dataset.act='name';input.setAttribute('aria-label',t.renameInput);
        const save=act('save',t.save),cancel=act('cancel',t.cancel);cancel.disabled=false;
        const stop=()=>{bar.renaming=null;drawBranchList([id,'rename']);};
        cancel.onclick=stop;
        save.onclick=()=>{const name=input.value.trim();if(!name){branchStatus(t.nameEmpty,true);input.focus({preventScroll:true});return;}if(name===row.name){stop();return;}void branchAction(t.renaming,async()=>{await branchCall(()=>window.arcade.branchRename(row.id,name));bar.renaming=null;return {text:t.renamed};},[id,'rename']);};
        input.onkeydown=e=>{if(e.isComposing||e.keyCode===229)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();stop();}else if(e.key==='Enter'){e.preventDefault();if(!save.disabled)save.click();}};
        copy.append(input);actions.append(save,cancel);item.append(copy,actions);return item;
      }
      copy.append(node('strong','',row.name),node('span','desktop-branch-meta',row.main?t.mainMeta:t.meta(Number(row.messages)||0,row.parentBranchId?names.get(row.parentBranchId)||t.main:t.main)));
      if(active){const mark=node('span','desktop-branch-active',t.active);actions.append(mark);}
      else{const use=act('switch',t.use,t.useLabel(row.name));use.onclick=()=>void branchAction(t.switching,async()=>{const problem=await useBranch(row.id||null,row.name);return {text:problem||t.switched(row.name),error:!!problem,close:!problem};},[id,'rename']);actions.append(use);}
      if(!row.main){
        const rename=act('rename',t.rename,t.renameLabel(row.name)),remove=act('remove',t.remove,t.removeLabel(row.name));
        rename.onclick=()=>{bar.renaming=id;branchStatus('');drawBranchList([id,'name']);};
        if(active){remove.disabled=true;remove.title=t.removeActive;}
        let armed=false;const disarm=()=>{armed=false;remove.textContent=t.remove;remove.setAttribute('aria-label',t.removeLabel(row.name));};
        remove.addEventListener('blur',()=>{if(remove.isConnected)disarm();});
        remove.onclick=()=>{if(!armed){armed=true;remove.textContent=t.removeConfirm;remove.setAttribute('aria-label',`${t.removeConfirm}${language()==='zh'?'：':': '}${row.name}`);return;}disarm();void branchAction(t.removing,async()=>{await branchCall(()=>window.arcade.branchRemove(row.id));return {text:t.removed};},['','switch']);};
        actions.append(rename,remove);
      }
      item.append(copy,actions);return item;
    }));
    if(wanted&&bar.open){
      const item=[...bar.list.children].find(li=>li.dataset.branchId===wanted[0]),target=item?.querySelector(`[data-act="${wanted[1]}"]:not(:disabled)`)||item?.querySelector('button:not(:disabled),input')||bar.list.querySelector('button:not(:disabled)')||bar.toggle;
      target.focus({preventScroll:true});if(target.dataset.act==='name')target.select();
    }
  }
  function renderBranchBar(local){
    const st=state?.bot?.st,show=!!local?.libraryCharacterId&&typeof window.arcade.branches==='function'&&!!st?.available&&(Number(st.branchCount)>0||!!st.branch?.id),inbox=document.getElementById('bot-inbox'),pane=document.getElementById('bot-thread-scroll');
    if(!show||!inbox||!pane){if(bar){const focused=bar.box.contains(document.activeElement);bar.box.remove();bar=null;if(focused)document.getElementById('desktop-chat-input')?.focus({preventScroll:true});}return;}
    const t=bt(),lang=language();
    if(bar&&bar.lang!==lang){bar.box.remove();bar=null;}
    if(!bar){
      const box=node('section','desktop-branch-bar'),name=node('span','desktop-branch-current'),toggle=node('button','plain desktop-branch-toggle'),panel=node('div','desktop-branch-panel'),list=node('ul','desktop-branch-list'),status=node('p','desktop-branch-status');
      box.id='desktop-branch-bar';box.setAttribute('aria-label',t.panel);toggle.type='button';toggle.id='desktop-branch-toggle';panel.id='desktop-branch-panel';panel.hidden=true;panel.setAttribute('role','group');panel.setAttribute('aria-label',t.panel);toggle.setAttribute('aria-controls',panel.id);toggle.setAttribute('aria-expanded','false');status.setAttribute('role','status');status.hidden=true;
      panel.append(node('p','desktop-branch-note',t.note),list,status);box.append(name,toggle,panel);
      bar={box,name,toggle,panel,list,status,lang,open:false,rows:null,renaming:null,core:'',blocked:false,token:0};
      toggle.onclick=()=>{if(bar.open){closeBranchList(false);return;}bar.open=true;panel.hidden=false;toggle.setAttribute('aria-expanded','true');branchStatus('');drawBranchList();void loadBranches();};
      box.addEventListener('keydown',e=>{if(e.key==='Escape'&&bar?.open){e.preventDefault();closeBranchList(true);}});
    }
    if(bar.box.parentNode!==inbox||bar.box.nextElementSibling!==pane)inbox.insertBefore(bar.box,pane);
    const label=t.label(st.branch?.id&&st.branch.name?st.branch.name:t.main),count=t.manage(Number(st.branchCount)||0);
    if(bar.name.textContent!==label)bar.name.textContent=label;if(bar.toggle.textContent!==count)bar.toggle.textContent=count;
    const core=JSON.stringify([st.settings?.characterId,st.branch,st.branchCount]),blocked=toolsBlocked();
    if(core!==bar.core){bar.core=core;bar.blocked=blocked;if(bar.open&&!branchOp)void loadBranches();}
    else if(blocked!==bar.blocked){bar.blocked=blocked;if(bar.open&&!branchOp)drawBranchList();}
  }
  document.addEventListener('pointerdown',e=>{if(bar?.open&&!bar.box.contains(e.target))closeBranchList(false);});

  // Group chat: a row above the composer to ask one member to speak next. With the
  // manual strategy this is the only way a reply happens, so the row says so.
  const speakCopy={zh:{label:'点名发言',who:name=>`让 ${name} 发言`,asking:name=>`正在让 ${name} 发言…`,manual:'这个群聊设为“手动”：只有你点名时才会有人回复。',none:'没有可以发言的成员：全部已静音。可以到角色库里编辑这个群聊。'},en:{label:'Ask to speak',who:name=>`Ask ${name} to speak`,asking:name=>`Asking ${name} to speak…`,manual:'This group chat is set to Manual: someone replies only when you pick a speaker.',none:'No member can speak: all are muted. Edit this group chat in the character library.'}};
  let speak=null;const groupMeta={id:'',key:'',strategy:'',token:0};
  // The snapshot names the members; how they take turns is read from the group list.
  function loadGroupMeta(id){
    if(typeof window.arcade.groupsList!=='function')return;const token=++groupMeta.token;
    void window.arcade.groupsList().then(rows=>{if(groupMeta.token!==token||groupMeta.id!==id)return;const row=(Array.isArray(rows)?rows:[]).find(item=>item.id===id);groupMeta.strategy=typeof row?.activationStrategy==='string'?row.activationStrategy:'';if(state)decorate();}).catch(()=>{});
  }
  document.addEventListener('arcade-library-changed',()=>{if(groupMeta.id)loadGroupMeta(groupMeta.id);});
  function renderSpeak(local,group){
    const inbox=document.getElementById('bot-inbox'),composer=document.getElementById('desktop-chat'),show=!!group&&!!inbox&&composer?.parentNode===inbox&&local.available===true&&typeof window.arcade.localMessage==='function';
    if(!show){if(speak){const focused=speak.box.contains(document.activeElement);speak.box.remove();speak=null;if(focused)document.getElementById('desktop-chat-input')?.focus({preventScroll:true});}if(!group){groupMeta.id='';groupMeta.key='';groupMeta.strategy='';}return;}
    const t=speakCopy[language()],snapshotKey=JSON.stringify(group);
    if(groupMeta.key!==snapshotKey){if(groupMeta.id!==group.id)groupMeta.strategy='';groupMeta.id=group.id;groupMeta.key=snapshotKey;loadGroupMeta(group.id);}
    if(!speak){const box=node('section','desktop-group-speak');box.id='desktop-group-speak';speak={box,key:''};}
    if(speak.box.parentNode!==inbox||speak.box.nextElementSibling!==composer)inbox.insertBefore(speak.box,composer);
    const key=JSON.stringify([language(),snapshotKey,groupMeta.strategy]);
    if(speak.key!==key){
      speak.key=key;
      const held=speak.box.contains(document.activeElement)?document.activeElement.dataset.speakerId:null,label=node('span','desktop-group-speak-label',t.label),buttons=node('div','desktop-group-speak-buttons'),able=group.members.filter(m=>!m.muted),nodes=[label,buttons];
      label.id='desktop-group-speak-label';buttons.setAttribute('role','group');buttons.setAttribute('aria-labelledby',label.id);
      for(const m of able){
        const b=node('button','plain desktop-group-speak-button'),image=node('img','desktop-group-speak-face');b.type='button';b.dataset.speakerId=m.id;b.setAttribute('aria-label',t.who(m.name));image.alt='';image.dataset.memberId=m.id;b.append(image,node('span','',m.name));
        b.onclick=async()=>{if(toolsBlocked())return;await runMessage({action:'speak',speakerId:m.id},t.asking(m.name));if([document.body,null].includes(document.activeElement)){const again=speak?.box.querySelector(`[data-speaker-id="${CSS.escape(m.id)}"]`);(again&&!again.disabled?again:document.getElementById('desktop-chat-input'))?.focus({preventScroll:true});}};
        buttons.append(b);
      }
      if(!able.length)nodes.push(node('p','desktop-group-speak-note',t.none));
      else if(groupMeta.strategy==='manual')nodes.push(node('p','desktop-group-speak-note',t.manual));
      speak.box.setAttribute('aria-labelledby',label.id);speak.box.replaceChildren(...nodes);
      if(held)(speak.box.querySelector(`[data-speaker-id="${CSS.escape(held)}"]`)||document.getElementById('desktop-chat-input'))?.focus({preventScroll:true});
    }
    for(const image of speak.box.querySelectorAll('img')){const m=group.members.find(item=>item.id===image.dataset.memberId),info=m?person(m.id,m.name):null;if(info?.avatar&&image.getAttribute('src')!==info.avatar)image.src=info.avatar;}
  }
  function decorate(){
    const list=document.getElementById('bot-messages'),pane=document.getElementById('bot-thread-scroll');if(!list||!pane||!state)return;
    const local=localSnapshot(),info=identity(local),group=groupOf(local),fromLibrary=!!(local?.libraryCharacterId||group),enabled=!!local&&typeof window.arcade.localMessage==='function',lang=language(),t=toolCopy[lang];
    const rows=[...list.querySelectorAll(':scope>article.bot-message[data-message-id]')],history=enabled&&Array.isArray(local.history)?local.history:[],byId=new Map(history.map(m=>[m.id,m])),lastId=history.at(-1)?.role==='assistant'?history.at(-1).id:null;
    if(replyAudio&&state.desktopChat?.contextId!==replyAudio.contextId)replyAudio=null;
    const follow=pane.scrollHeight-pane.scrollTop-pane.clientHeight<64,paneTop=pane.getBoundingClientRect().top,anchor=rows.find(row=>row.getBoundingClientRect().bottom>paneTop),anchorTop=anchor?.getBoundingClientRect().top;
    let touched=window.ArcadeChatDrawing?.update(state,rows,pane)===true;
    if(editing&&!byId.has(editing.id))closeEdit(false);
    if(branching&&!byId.has(branching.id))closeBranching(false);
    const canBranch=enabled&&!!local.libraryCharacterId&&typeof window.arcade.branchFrom==='function';
    for(const row of rows){
      const m=byId.get(row.dataset.messageId),assistant=row.dataset.role==='assistant';
      if(showReplyAudio(row,m,lang))touched=true;
      const who=assistant?(group?speakerOf(m?.speakerId,m?.speakerName,info):info):null;
      if(who?.name){
        const author=row.querySelector('.message-author'),avatar=row.querySelector('.message-avatar');
        if(author&&author.textContent!==who.name)author.textContent=who.name;
        if(avatar&&avatar.getAttribute('src')!==who.avatar){avatar.src=who.avatar;avatar.classList.add('desktop-library-portrait');}
      }
      const old=row.querySelector('.desktop-message-tools'),usable=m&&typeof m.id==='string'&&!m.id.startsWith('local-image:');
      if(!usable){if(old){old.remove();row.querySelector('.desktop-message-swipes')?.remove();touched=true;}continue;}
      const meta=row.querySelector(':scope>.message-meta'),mark=meta?.querySelector('.message-edited');
      if(m.edited&&meta&&!mark){meta.append(node('span','message-edited',t.edited));touched=true;}else if(!m.edited&&mark){mark.remove();touched=true;}
      if(showDisplay(row,m,meta,t))touched=true;
      const rework=assistant&&m.id===lastId&&!/^local-out:(?:notice|command):/.test(m.id),running=local.available===true,cap=fromLibrary&&m.role==='assistant'?8000:2000;
      const stamp=JSON.stringify([lang,m.text,m.display,m.swipeIndex,m.swipeCount,rework,running,cap,canBranch]);
      if(old?.dataset.stamp!==stamp){old?.remove();row.querySelector('.desktop-message-swipes')?.remove();buildTools(row,m,{stamp,rework,running,cap,branch:canBranch});touched=true;}
      if(branching?.id===m.id&&!branching.wrap.isConnected){if(canBranch)openBranching(row,m,false);else closeBranching(false);touched=true;}
      if(editing?.id===m.id&&!editing.wrap.isConnected){openEdit(row,m,cap);touched=true;}
    }
    if(renderStream(list,rows,local,history,byId,info,group))touched=true;
    renderBranchBar(local);
    renderSpeak(local,group);
    syncTools();
    if(touched){if(follow)pane.scrollTop=pane.scrollHeight;else if(anchor?.isConnected)pane.scrollTop+=anchor.getBoundingClientRect().top-anchorTop;}
    if(lastTool&&[document.body,null].includes(document.activeElement)&&!editing?.focused&&!branching){
      const row=rows.find(item=>item.dataset.messageId===lastTool.id),wanted=row?.querySelector(`[data-tool="${lastTool.name}"]`),target=wanted&&!wanted.disabled?wanted:row?.querySelector('[data-tool]:not(:disabled)');
      if(target)target.focus({preventScroll:true});else if(!row)lastTool=null;
    }
  }
  document.addEventListener('focusin',e=>{const tool=e.target?.closest?.('#bot-messages [data-tool]');lastTool=tool?{id:tool.closest('article')?.dataset.messageId,name:tool.dataset.tool}:null;});
  document.addEventListener('focusout',e=>{if(e.target?.dataset?.tool&&e.target.isConnected&&!e.target.disabled&&!e.relatedTarget)lastTool=null;});
  function renderGroupCardEntry(){
    const api=window.ArcadeGroupCard;if(!api)return;
    api.update(state);
    const local=localSnapshot(),id=local?.libraryCharacterId;
    let b=document.getElementById('desktop-qq-group-use');
    if(!id||local.libraryGroupId||!api.available()){b?.remove();return;}
    const bar=document.querySelector('#bot-view .bot-heading-actions');if(!bar)return;
    if(!b){b=node('button','secondary');b.type='button';b.id='desktop-qq-group-use';bar.prepend(b);}
    const label=language()==='zh'?'用于 QQ 群':'Use in QQ group';if(b.textContent!==label)b.textContent=label;
    b.disabled=switchingSource();
    b.onclick=()=>{if(!b.disabled){const known=state.bot?.st?.character;api.open({id,name:person(id,known?.id===id?known.name:'').name,profileId:state.accounts?.selectedId,fromChat:true},b);}};
  }
  window.renderDesktopChat=next=>{
    window.ArcadeCharacterSticker?.update(next);
    void window.ArcadeAppCharacterVoice?.update(next);
    state=next;renderGroupCardEntry();validateAnnouncement(localSnapshot());const nextObserved=JSON.stringify([state.accounts?.selectedId,document.body.dataset.view]),arrived=nextObserved!==observed&&document.body.dataset.view==='bot';if(nextObserved!==observed){observed=nextObserved;navigation++;selectionMessage='';}
    const selected=state.accounts?.selectedId,prior=credentials.get(selected),cleared=prior?.mode===state.bot?.mode&&prior?.hasKey===true&&state.bot?.hasKey===false;credentials.set(selected,{mode:state.bot?.mode,hasKey:state.bot?.hasKey});
    const context=currentContext(),lang=state.config.language==='zh'?'zh':'en';
    // Retiring a chat session can replace the editor while its owner is still
    // typing in the same room. Carry the selection only into that exact draft.
    const editor=current?.editor;
    const selection=context&&editor&&document.activeElement===editor&&!cleared&&current.context!==context&&
      current.lang===lang&&current.key===draftKey(state)&&current.scope===draftScope(state)
      ?{text:editor.value,start:editor.selectionStart,end:editor.selectionEnd,direction:editor.selectionDirection}:null;
    if(current&&(current.context!==context||current.lang!==lang||current.key!==draftKey(state)||current.scope!==draftScope(state)||cleared))dispose();
    if(cleared)for(const [key,draft]of drafts)if(draft.accountId===selected)drafts.delete(key);
    const fresh=!!context&&!current&&!!window.arcade.desktopChatOpen;
    if(fresh){
      mount(context);
      if(selection&&current.editor.value===selection.text){
        current.editor.focus({preventScroll:true});
        current.editor.setSelectionRange(selection.start,selection.end,selection.direction);
      }
    }
    if(current&&(arrived||fresh))focusComposer(arrived);
    if(current){updateSendHint(current);current.update();}
    const ids=new Set(state.accounts?.accounts?.map(a=>a.id)||[]);for(const [key,draft]of drafts)if(!ids.has(draft.accountId))drafts.delete(key);renderChoice();decorate();
    const note=document.querySelector('.bot-input-note');if(note)note.hidden=!!current;
  };
  addEventListener('pagehide',()=>{dispose();dropStream();clearAnnouncement();});
  if(typeof data!=='undefined'&&data)window.renderDesktopChat(data);
})();
