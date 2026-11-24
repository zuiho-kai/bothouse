'use strict';
(() => {
  const partners=[
    {id:'claude',name:'Claude',persona:'claude-ju',local:'claude',api:'api',provider:'claude'},
    {id:'gpt',name:'GPT',persona:'codex-dragon',local:'codex',api:'gpt',provider:'codex'},
    {id:'deepseek',name:'DeepSeek',persona:'deepseek-whale',api:'deepseek'},
    {id:'gemini',name:'Gemini',persona:'gemini-cat',api:'gemini',model:'gemini-3.6-flash',modelName:'Gemini 3.6 Flash'},
    {id:'doubao',name:'Doubao',zh:'豆包',persona:'doubao-girl',api:'doubao',model:'doubao-seed-2-0-lite-260428',modelName:'Doubao Seed 2.0 Lite · 260428'},
  ];
  const planned=[];window.ArcadePartners=Object.freeze(partners.map(item=>Object.freeze({...item})));
  const nav=el('button','nav');nav.dataset.view='connections';
  nav.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="6" height="6" rx="2"/><rect x="15" y="15" width="6" height="6" rx="2"/><path d="M9 6h6a3 3 0 0 1 3 3v6M6 9v6a3 3 0 0 0 3 3h6"/></svg>';
  const navLabel=el('span','');nav.append(navLabel);nav.onclick=()=>switchView('connections');
  document.querySelector('nav').insertBefore(nav,document.querySelector('nav [data-view="settings"]'));
  const option=el('option','');option.value='connections';$('view-picker').append(option);
  let previous='',latest,appearanceOpen=false,plannedOpen=false,renderedContext=null,expandedOwner=null,optionalChoice=null;
  const auth=new Map(),busy=new Set(),loginNotes=new Map(),keySaves=new Map(),keyNotes=new Map();
  const keyScope=next=>JSON.stringify([next?.accounts?.selectedId||'',next?.bot?.mode||'api',next?.bot?.channel||'wechat']);
  const refresh=()=>{previous='';if(latest)window.renderConnections(latest);};
  window.openConnectionOnboarding=()=>{switchView('connections');$('connections-view').scrollTop=0;};
  function signIn(provider){
    return action(async()=>{
      if(busy.has(provider))return;
      busy.add(provider);loginNotes.delete(provider);refresh();
      try{
        const reply=await window.arcade.providerLogin(provider);
        if(reply?.status)auth.set(provider,reply.status);
        loginNotes.set(provider,reply?.code||'launch_failed');
      }catch{auth.set(provider,{state:'unknown',installed:null});loginNotes.set(provider,'check_failed');}
      finally{busy.delete(provider);refresh();}
    });
  }
  window.renderConnections=next=>{
    latest=next;
    const zh=next.config.language==='zh',name=zh?'本机搭档与渠道':'Local companion and channels',bot=next.bot||{},mode=bot.mode||'api';
    if(renderedContext&&(renderedContext.profileId!==(next.accounts?.selectedId||'')||renderedContext.expectedMode!==mode||renderedContext.expectedChannel!==(bot.channel||'wechat')))keyNotes.clear();
    const credentialContext={profileId:next.accounts?.selectedId||'',expectedMode:mode,expectedChannel:bot.channel||'wechat'},scope=keyScope(next),saving=keySaves.has(scope),keyNote=keyNotes.get(scope);
    const locked=bot.credentialState==='locked',recovery=locked?window.ArcadeFirstRun.settingsRecovery(credentialContext.profileId,zh):null;
    const active=!['disconnected',undefined].includes(bot.status),partner=partners.find(p=>p.local===mode||p.api===mode)||(mode==='native'?partners[0]:partners[0]);
    const legacy=mode==='native',local=mode===partner.local,providerState=auth.get(partner.provider),working=busy.has(partner.provider);
    const gpt=partner.id==='gpt',localCodex=zh?'本机 Codex':'Local Codex';
    const current=next.persona||(next.personas||[]).find(p=>p.id===partner.persona),getPersona=id=>(next.personas||[]).find(p=>p.id===id);
    const versionBlocked=['unsupported_version','unknown_version'].includes(providerState?.code);
    const ready=active||(local?providerState?.state==='signed_in'&&!versionBlocked:!legacy&&!!bot.hasKey);
    // shell.js names the navigation entry ("Channels"); without it this page names its own.
    if(!window.ArcadeShell){navLabel.textContent=name;nav.title=name;nav.setAttribute('aria-label',name);option.textContent=name;}
    document.querySelectorAll('nav [data-view]').forEach(n=>{const label=n.querySelector('[data-i18n],[data-bot]')?.textContent||n.textContent;n.setAttribute('aria-label',label.trim());n.title=label.trim();});
    const owner=JSON.stringify([next.accounts?.selectedId||'',bot.channel]);if(renderedContext&&(renderedContext.profileId!==credentialContext.profileId||renderedContext.expectedChannel!==credentialContext.expectedChannel))expandedOwner=null;
    // Chat software and local project work are optional. They stay collapsed until this profile uses them or the owner opens them.
    if(renderedContext&&renderedContext.profileId!==credentialContext.profileId)optionalChoice=null;
    const optionalOpen=optionalChoice??(window.ArcadeFirstRun?.hasChannel(next)===true||!!bot.workspace||active);
    const savedConnection=window.selectedSavedConnection?.(next);
    const macStatus=savedConnection&&window.ArcadeQQStartConnect?.macOneBotStatus(bot,next.config.language);
    const key=JSON.stringify([saving,keyNote,optionalOpen,window.ArcadeFirstRun?.needed(next),window.ArcadeDesktopConversation?.stateKey(),next.bot?.local, next.desktopChat?.kind,next.accounts?.selectedId||'',zh,next.config.portrait,next.config.character,next.config.personaVoice,next.persona,bot.social?.config.enabled,bot.social?.supported,mode,bot.geminiModel,bot.doubaoModel,bot.channel,bot.status,bot.hasKey,bot.credentialState,bot.workspace,bot.paired,providerState,working,loginNotes.get(partner.provider),expandedOwner,window.ArcadeQQStartConnect?.stateKey(),!!savedConnection,macStatus]);
    if(previous===key)return;previous=key;
    const content=$('connections-content'),focused=document.activeElement;
    // Restore focus after a same-profile redraw. Only an in-flight scoped save
    // retains its input; ordinary provider/method changes discard the field.
    // Provider/method choices can intentionally change mode; other controls cannot.
    const sameOwner=renderedContext?.profileId===credentialContext.profileId&&renderedContext?.expectedChannel===credentialContext.expectedChannel;
    const focusKey=sameOwner&&document.body.dataset.view==='connections'&&content.contains(focused)?
      focused.dataset.provider?{provider:focused.dataset.provider}:focused.dataset.method?{method:focused.dataset.method}:
      renderedContext.expectedMode===mode&&focused.id?{id:focused.id}:null:null;
    renderedContext=credentialContext;content.replaceChildren();content.className='onboarding-shell';
    const header=el('header','onboarding-header');header.append(el('h1','',name));
    if(gpt){
      const savedMethod=el('p','',zh?'本搭档已保存的接入方式：':'Saved connection method for this companion: ');
      savedMethod.id='onboarding-saved-method';savedMethod.setAttribute('role','status');
      savedMethod.append(el('strong','',local?localCodex:'GPT API'));header.append(savedMethod);
    }else header.append(el('p','',locked?(zh?'查看当前搭档的 AI 与渠道设置。':'Review AI and channel settings for this companion.'):zh?'选一个 AI 并保存它的密钥，就可以在「陪伴 › 对话」里聊天。聊天软件和本机项目是可选的。':'Choose an AI and save its key to chat under Companion › Chat. Chat software and local projects are optional.'));
    content.append(header);if(!locked)window.ArcadeDesktopConversation?.mountEntry(content,next);
    if(savedConnection&&expandedOwner!==owner){window.ArcadeQQStartConnect?.mount(content,{id:'onboarding-saved-connection',settings:()=>{expandedOwner=owner;refresh();$('onboarding-account-title')?.setAttribute('tabindex','-1');$('onboarding-account-title')?.focus({preventScroll:true});}});if(bot.channel==='qq'){const groups=el('button','secondary',zh?'设置 QQ 群聊':'Set up QQ group chat');groups.id='onboarding-qq-groups';groups.onclick=()=>window.openConversationSetup({section:'qq-groups'});content.append(groups);}if(focusKey?.id){const target=$(focusKey.id)||content.querySelector('[id$="-cancel"]');if(target&&!target.disabled)target.focus({preventScroll:true});}return;}
    const optional=[];
    if(typeof window.arcade.inspectSample==='function'){
      const sample=el('div','work-toolbar onboarding-sample'),trySample=el('button','secondary',zh?'查看本地样例':'Open the local sample');trySample.id='onboarding-local-sample';trySample.type='button';
      const note=el('p','onboarding-copy',zh?'无需账号或 API key，不调用 AI。查看一份样例文本的内容与检查结果。':'No account or API key, and no AI call. Inspect sample text and see its result.');note.id='onboarding-sample-note';trySample.setAttribute('aria-describedby',note.id);
      trySample.onclick=()=>window.openLocalSample();sample.append(trySample,note);optional.push(sample);
    }
    if(active){const note=el('div','onboarding-active');note.append(el('p','',zh?'当前连接正在使用。更换 AI 或登录方式前，请先在对话设置中断开。':'A connection is in use. Disconnect in Conversation settings before changing the AI or login method.'));const open=el('button','plain',zh?'查看当前对话':'Open conversation');open.onclick=()=>window.openConversationSetup();note.append(open);content.append(note);}
    const selection=el('section','onboarding-provider');selection.setAttribute('aria-labelledby','onboarding-provider-title');selection.append(el('h2','',zh?'选择 AI':'Choose an AI'));selection.firstChild.id='onboarding-provider-title';
    const choices=el('div','partner-choices');choices.setAttribute('role','group');choices.setAttribute('aria-label',zh?'选择 AI':'Choose an AI');
    for(const item of partners){const identity=getPersona(item.persona),button=el('button','partner-choice');button.dataset.provider=item.id;button.type='button';button.disabled=active;button.setAttribute('aria-pressed',String(item.id===partner.id));
      if(identity){const avatar=el('img','');avatar.src=identity.portrait;avatar.alt='';button.append(avatar);}
      const label=el('span','');label.append(el('strong','',zh&&item.zh?item.zh:item.name),el('span','',identity?.name[zh?'zh':'en']||item.name));button.append(label);
      button.onclick=()=>action(async()=>{
        if(item.id==='gpt'&&gpt)return;
        await window.arcade.botConfigure(item.id==='gpt'?{...credentialContext,mode:item.local}:{mode:item.local||item.api});
      });choices.append(button);
    }selection.append(choices);content.append(selection);
    const account=el('section','onboarding-account');account.setAttribute('aria-labelledby','onboarding-account-title');const accountTitle=el('h2','',zh?`连接 ${partner.name}`:`Connect ${partner.name}`);accountTitle.id='onboarding-account-title';account.append(accountTitle);
    if(legacy){const note=el('div','onboarding-legacy');note.append(el('p','',zh?'当前是旧版 Channels 手动入口。程序模式可沿用原版登录，不再要求启动通道确认。':'This profile uses the older manual Channels entry. Program mode uses the original login without channel startup confirmation.'));const button=el('button','secondary',zh?'切换程序模式':'Use program mode');button.id='onboarding-use-program';button.disabled=active;button.onclick=()=>action(()=>window.arcade.botConfigure({mode:'claude'}));note.append(button);account.append(note);}
    const methods=el('div','account-methods');methods.setAttribute('role','group');methods.setAttribute('aria-label',zh?'接入方式':'Connection method');
    for(const kind of partner.local?['local','api']:['api']){
      const methodMode=kind==='local'?partner.local:partner.api;
      const label=gpt?(kind==='local'?localCodex:'GPT API'):kind==='local'?(zh?'本机账号登录':'Local account login'):'API key';
      const button=el('button','account-method',label);button.type='button';button.dataset.method=kind;
      button.setAttribute('aria-pressed',String(mode===methodMode));button.disabled=active;
      button.onclick=()=>action(()=>{
        if(gpt&&mode===methodMode)return;
        return window.arcade.botConfigure(gpt?{...credentialContext,mode:methodMode}:{mode:methodMode});
      });methods.append(button);
    }account.append(methods);
    if(local){
      account.append(el('p','onboarding-copy',gpt?(zh?'使用本机 Codex 登录后可连接聊天渠道。':'Sign in with local Codex to connect a chat channel.'):(zh?'使用你在本机 Claude Code 中的登录，无需另填 API key。':'Use your login in installed Claude Code, without a separate API key.')));
      const status=el('div','provider-login-status');status.id='provider-login-status';status.setAttribute('role','status');status.dataset.state=working?'checking':providerState?.state||'unchecked';
      let title=zh?'使用本机账号登录':'Sign in with your local account',detail=zh?'可沿用原版程序中已登录的账号。':'You can use the account already signed in to the original app.';
      if(working){title=zh?'正在检查…':'Checking…';detail=zh?'请稍候。':'Please wait.';}
      else if(providerState?.state==='signed_in'){
        if(providerState.method==='api_key'){
          title=zh?'原版 CLI 已使用 API 凭证登录':'Original CLI uses API credentials';
          detail=gpt?(zh?'这是本机 Codex 的登录状态。':'This is the sign-in status of local Codex.'):(zh?'此登录使用 API 计费，不代表订阅额度。':'This login uses API billing, not subscription allowance.');
        }else{
          title=gpt&&providerState.method==='chatgpt'?(zh?'本机 Codex 已使用 ChatGPT 登录':'Local Codex is signed in with ChatGPT'):(zh?'原版账号已登录':'Signed in to the original app');
          detail=zh?'可以继续选择聊天渠道。此检查不验证模型额度或聊天收发。':'Continue to a chat channel. This check does not verify model quota or message delivery.';
        }
      }else if(providerState?.state==='signed_out'){title=zh?'尚未登录':'Not signed in';detail=zh?'请在原版程序中完成登录，然后回来继续。':'Complete sign-in in the original app, then return here to continue.';}
      else if(providerState?.state==='not_installed'){title=zh?'未找到本机程序':'Local program not found';detail=zh?`先安装 ${partner.id==='gpt'?'Codex':'Claude Code'}，再重新检查。`:`Install ${partner.id==='gpt'?'Codex':'Claude Code'}, then check again.`;}
      else if(providerState?.state==='unknown'){title=zh?'登录状态尚未确认':'Login state unconfirmed';detail=zh?'可打开原版程序检查，完成后重试。':'Check the original program, then try again.';}
      if(versionBlocked){title=providerState.code==='unsupported_version'?(zh?'原版程序需要更新':'Update the original program'):(zh?'程序版本尚未确认':'Program version unconfirmed');detail=zh?'安装兼容版本后重新检查，登录状态不会自动证明版本兼容。':'Install a compatible version and check again. A login does not establish version compatibility.';}
      const note=loginNotes.get(partner.provider);
      if(note==='opened'||note==='login_in_progress')detail=zh?'原版登录窗口已打开。请在那里完成登录，再回来继续。':'The original login window is open. Complete it there, then return to continue.';
      else if(['launch_failed','unsupported_platform'].includes(note))detail=zh?'未能打开原版登录，请从系统中打开原版程序完成登录，再重新检查。':'The original login could not open. Open it from your system, sign in, then check again.';
      status.append(el('strong','',title),el('p','',detail));account.append(status);
      const actions=el('div','provider-login-actions');
      const login=el('button','plain',zh?'使用原版登录':'Use original sign-in');
      login.id='provider-login';login.disabled=working||active||!window.arcade.providerLogin;
      login.onclick=()=>signIn(partner.provider);actions.append(login);
      if((providerState?.state==='not_installed'||versionBlocked)&&window.arcade.providerGuide){const guide=el('button','plain',zh?'安装说明':'Installation guide');guide.id='provider-install-guide';guide.onclick=()=>action(()=>window.arcade.providerGuide(partner.provider));actions.append(guide);}account.append(actions);
    }else if(!legacy){
      account.append(el('p','onboarding-copy',gpt?(zh?'此方式需要本搭档自己的 OpenAI API key。':'This method needs an OpenAI API key for this companion.'):partner.id==='deepseek'?(zh?'DeepSeek 目前使用 API key 接入，按 API 用量计费。':'DeepSeek currently connects with an API key and API usage billing.'):(zh?'使用对应服务的 API key，按 API 用量计费；与账号订阅分开。':'Use this service’s API key. API usage is billed separately from an account subscription.')));
      const label=el('label','',partner.id==='claude'?'Anthropic API key':partner.id==='gpt'?'OpenAI API key':partner.id==='gemini'?'Google AI Studio API key':partner.id==='doubao'?'Volcengine Ark API key':'DeepSeek API key');label.htmlFor='onboarding-key';
      const keyRow=el('div','onboarding-key-row'),input=el('input','');input.type='password';input.id='onboarding-key';input.autocomplete='off';input.spellcheck=false;input.maxLength=500;input.setAttribute('aria-describedby','onboarding-key-state');input.placeholder=locked?'':bot.hasKey?(zh?'已保存，无需重复填写；留空保留':'Saved; no need to re-enter. Leave blank to keep'):['gemini','doubao'].includes(partner.id)?'API key':'sk-…';input.disabled=locked||active||saving;if(saving&&!locked)input.value=keySaves.get(scope).value;
      const save=el('button','secondary',zh?'保存密钥':'Save key');save.id='onboarding-key-save';save.disabled=locked||active||saving;save.onclick=()=>action(async()=>{
        if(!save.isConnected||keyScope(latest)!==scope||latest.bot?.credentialState==='locked'||keySaves.has(scope))return;
        // What was typed stays in the field until the key is actually saved.
        const value=input.value.trim(),say=(text,failed)=>{status.textContent=text;status.dataset.error=String(!!failed);};
        if(!value){say(bot.hasKey?(zh?'密钥未更改。':'Key unchanged.'):(zh?'请先输入 API key。':'Enter an API key first.'),!bot.hasKey);input.focus();return;}
        const problem=window.ArcadeFirstRun?.keyProblem(value,zh);if(problem){say(problem,true);input.focus();return;}
        const resume=next.desktopChat?.kind==='local'||bot.local?.available===true,provider=zh&&partner.zh?partner.zh:partner.name;
        const token={value};keySaves.set(scope,token);keyNotes.set(scope,{text:zh?'正在保存…':'Saving…',error:false});refresh();let saved=false;
        const note=(text,error=false)=>keyNotes.set(scope,{text,error});
        try{
          await window.arcade.botConfigure({...credentialContext,mode:partner.api,key:value});saved=true;input.value='';token.value='';
          note(zh?`${provider} 密钥已保存。`:`${provider} key saved.`);
          if(resume){
            // Saving retires the old runner even when its mode is unchanged. Never
            // take the renderer shortcut that still sees that old runner as usable.
            const current=await window.arcade.snapshot();
            if(keyScope(latest)!==scope||keyScope(current)!==scope)return;
            const result=await window.ArcadeDesktopConversation?.select('local',false,{force:true});
            if(keyScope(latest)!==scope)return;
            if(result?.ok===true)note(zh?`${provider} 密钥已保存，App 对话已就绪。`:`${provider} key saved. App chat is ready.`);
            else note(zh?`${provider} 密钥已保存，但 App 对话尚未开始。请点击“在 App 里聊”重试。`:`${provider} key saved, but App chat did not start. Choose “Chat in App” to retry.`,true);
          }
        }catch(error){
          if(saved)note(zh?`${provider} 密钥已保存，但 App 对话尚未开始。请点击“在 App 里聊”重试。`:`${provider} key saved, but App chat did not start. Choose “Chat in App” to retry.`,true);
          else note(window.ArcadeFirstRun?.known(error,zh)||(zh?'密钥未能保存，请重试。':'The key could not be saved. Try again.'),true);
        }finally{
          if(keySaves.get(scope)===token)keySaves.delete(scope);refresh();
          if(!saved&&keyScope(latest)===scope){const field=$('onboarding-key');if(field&&!field.disabled){field.value=value;field.focus();}}
        }
      });keyRow.append(input,save);account.append(label,keyRow);
      if(partner.model){const modelLabel=el('label','',zh?'模型':'Model'),model=el('select','');model.id='onboarding-model';modelLabel.htmlFor=model.id;const item=el('option','',partner.modelName);item.value=partner.model;model.append(item);model.value=bot[partner.id+'Model']||partner.model;model.disabled=active;model.onchange=()=>action(()=>window.arcade.botConfigure({[partner.id+'Model']:model.value}));account.append(modelLabel,model);account.append(el('p','onboarding-fine',partner.id==='doubao'?(zh?'火山方舟 API；不使用豆包应用登录。':'Volcengine Ark API; not a Doubao app login.'):(zh?'Google AI Studio API；与 Gemini 应用订阅分开计费。':'Google AI Studio API; billed separately from the Gemini app subscription.')));}
      const status=el('p','onboarding-key-state',recovery?recovery.text:bot.hasKey?(zh?'已加密保存，无需重复填写；留空保留。':'Saved with OS encryption; no need to enter it again. Leave blank to keep it.'):(zh?'密钥只在本机使用系统加密保存，不会显示在聊天中。':'The key is stored locally with OS encryption and is not shown in chat.'));status.id='onboarding-key-state';if(keyNote&&!locked){status.textContent=keyNote.text;status.dataset.error=String(keyNote.error);}status.setAttribute('role',keyNote?.error&&!locked?'alert':'status');account.append(status);
      if(recovery){const recover=el('button','secondary',recovery.label);recover.id='onboarding-key-recovery';recover.type='button';recover.onclick=recovery.open;account.append(recover);}
      if(!locked&&window.arcade.providerGuide){const guide=el('button','plain onboarding-key-guide',zh?'获取 API key':'Get an API key');guide.id='onboarding-key-guide';guide.onclick=()=>action(()=>window.arcade.providerGuide(partner.id==='claude'?'claude-api':partner.id));account.append(guide);}
    }
    content.append(account);
    // One disclosure for everything a pure-chat user does not need: work folder, chat channels,
    // companion habits, appearance and the advanced settings. The parts stay siblings (social.js
    // inserts its panel next to them); desktop-chat.css hides them while the disclosure is closed.
    const optionalToggle=el('button','onboarding-optional-toggle',zh?'接到微信、QQ 等聊天软件，或让 AI 处理本机项目（可选）':'Connect WeChat, QQ or other chat software, or let the AI work on local projects (optional)');
    optionalToggle.id='onboarding-optional-toggle';optionalToggle.type='button';optionalToggle.setAttribute('aria-expanded',String(optionalOpen));content.dataset.optional=optionalOpen?'open':'closed';
    optionalToggle.onclick=()=>{optionalChoice=!optionalOpen;refresh();requestAnimationFrame(()=>$('onboarding-optional-toggle')?.focus({preventScroll:true}));};content.append(optionalToggle);
    const chat=el('section','onboarding-chat');const chatTitle=el('h2','',zh?'聊天渠道与工作目录':'Chat channels and work folder');chatTitle.id='onboarding-chat-title';chat.setAttribute('aria-labelledby',chatTitle.id);chat.append(chatTitle);
    const managedQQ=typeof window.arcade.qqRuntimeRefresh==='function';
    if(!ready)chat.append(el('p','onboarding-next',locked?(zh?'请先恢复此搭档的已保存凭据，再连接。':'Recover this companion’s saved credentials before connecting.'):managedQQ?(zh?'可以先管理 QQ 账号；连接 AI 前，请完成上方登录检查或保存 API key。':'You can manage QQ accounts now. Check your AI login or save an API key above before connecting.'):(zh?'先完成上方登录检查或保存 API key，再连接聊天。':'Check your login or save an API key above before connecting a chat.')));
    const projectLabel=el('label','',zh?'工作目录':'Work folder');projectLabel.htmlFor='onboarding-project';const projectRow=el('div','onboarding-project-row'),project=el('output','',bot.workspace||(zh?'选择 AI 处理文件的位置':'Choose where the AI works with files'));project.id='onboarding-project';
    const choose=el('button','plain',bot.workspace?(zh?'更换目录':'Change folder'):(zh?'选择目录':'Choose folder'));choose.id='onboarding-project-pick';choose.disabled=active;choose.onclick=()=>action(()=>window.arcade.botProject());projectRow.append(project,choose);chat.append(projectLabel,projectRow);
    const officialRow=el('div','onboarding-channel');officialRow.dataset.channel='qqofficial';
    const officialBody=el('div','');officialBody.append(el('h3','',zh?'QQ 官方机器人 · 可选群聊':'QQ official bot · optional group chat'),el('p','',zh?'可在 Mac 直接连接，无需普通 QQ 登录桥接。使用机器人 App ID、App Secret 和指定群的 group_openid；群权限须在 QQ 开放平台配置。':'Connect directly on Mac, without a personal QQ login bridge. Use the bot App ID, App Secret and selected group_openid values; configure group permissions in the QQ developer portal.'));
    const officialOpen=el('button','secondary',zh?'配置官方 QQ 群聊':'Set up official QQ group chat');officialOpen.dataset.onboardChannel='qqofficial';officialOpen.disabled=active;officialOpen.onclick=()=>action(async()=>{if(bot.channel!=='qqofficial')await window.arcade.botConfigure({channel:'qqofficial'});window.openConversationSetup({section:'qqofficial'});});officialRow.append(officialBody,officialOpen);
    for(const channel of ['wechat','qq']){const row=el('div','onboarding-channel');row.dataset.channel=channel;const body=el('div','');body.append(el('h3','',channel==='wechat'?(zh?'微信 · ClawBot 私聊':'WeChat · ClawBot private chat'):'QQ'),el('p','',channel==='wechat'?(zh?'仅用于绑定主人和 ClawBot 的专属私聊，暂不支持普通微信群。':'ClawBot is only for private chats with the linked owner and doesn’t support regular WeChat groups yet.'):managedQQ?(zh?'可选。需要你已自行装好 NapCat（其上游已于 2026-11-12 停止发布，应用内无法再下载）。添加、登录 QQ 并绑定搭档后，从「管理搭档」点击「连接」。':'Optional. Needs a NapCat install you already have (its upstream stopped publishing on 2026-11-12, so it can no longer be downloaded here). Add and sign in to QQ, bind a companion, then choose Connect in Manage companions.'):(zh?'接入已登录的独立 QQ 账号，像好友一样私聊。':'Connect a separate signed-in QQ account and chat as friends.')));row.append(body);
      const paired=bot.channel===channel&&bot.paired,manage=channel==='qq'&&managedQQ,button=el('button','secondary',channel==='wechat'?(paired?(zh?'连接微信':'Connect WeChat'):(zh?'扫码连接':'Scan to connect')):manage?(zh?'选择 QQ 并绑定搭档':'Manage QQ accounts'):(zh?'配置已有 QQ':'Connect an existing QQ'));
      button.disabled=!manage&&(active||!ready||(!bot.workspace&&!(channel==='qq'&&bot.social?.config.enabled&&bot.social?.supported)));button.dataset.onboardChannel=channel;
      button.onclick=manage?()=>switchView('qq-runtime'):()=>action(async()=>{await window.arcade.botConfigure({channel});if(channel==='wechat'&&paired){await window.arcade.botConnect();switchView('bot');}else window.openConversationSetup({section:'channel',pair:channel==='wechat'});});row.append(button);
      if(channel==='qq'){const groups=el('button','plain',zh?'设置 QQ 群聊':'Set up QQ group chat');groups.id='onboarding-qq-groups';groups.disabled=active&&bot.channel!=='qq';groups.onclick=()=>action(async()=>{if(bot.channel!=='qq')await window.arcade.botConfigure({channel:'qq'});window.openConversationSetup({section:'qq-groups'});});body.append(el('p','',zh?'群聊需单独选择群并启用；保存不会自动连接。':'Group chat needs an explicit group selection and enable switch; saving does not connect.'));row.append(groups);}
      chat.append(row);
    }
    chat.append(officialRow);
    const feishuRow=el('div','onboarding-channel');feishuRow.dataset.channel='feishu';const feishuBody=el('div','');feishuBody.append(el('h3','',zh?'飞书应用机器人':'Feishu app bot'),el('p','',zh?'企业自建应用，使用官方长连接，仅接收指定主人的私聊。不接普通个人账号或群聊。':'An internal app with the official long connection, limited to the configured owner’s private chat. Not a personal account or group chat.'));const feishuOpen=el('button','secondary',zh?'配置飞书':'Set up Feishu');feishuOpen.dataset.onboardChannel='feishu';feishuOpen.disabled=active||legacy;feishuOpen.onclick=()=>action(async()=>{await window.arcade.botConfigure({channel:'feishu'});window.openConversationSetup({section:'channel'});});feishuRow.append(feishuBody,feishuOpen);chat.append(feishuRow);
    const xRow=el('div','onboarding-channel');xRow.dataset.channel='x';const xBody=el('div','');xBody.append(el('h3','',zh?'X 标准私信 · 实验':'X standard DMs · experimental'),el('p','',zh?'指定主人私聊，约 75 秒检查一次。需要已授权的用户令牌，X API 读写可能收费；不接加密 X Chat。':'One configured owner, checked about every 75 seconds. Requires an authorized user token; X API reads and writes may incur charges. Encrypted X Chat is unsupported.'));const xOpen=el('button','secondary',zh?'配置 X 私信':'Set up X DMs');xOpen.dataset.onboardChannel='x';xOpen.disabled=active||legacy;xOpen.onclick=()=>action(async()=>{await window.arcade.botConfigure({channel:'x'});window.openConversationSetup({section:'channel'});});xRow.append(xBody,xOpen);chat.append(xRow);
    const messengerRow=el('div','onboarding-channel');messengerRow.dataset.channel='messenger';const messengerBody=el('div','');messengerBody.append(el('h3','',zh?'Messenger Page · 实验':'Messenger Page · experimental'),el('p','',zh?'Facebook Page 的指定主人私聊，需要另行部署公网 HTTPS 中转与 Page 消息权限；不是普通个人账号登录。':'One owner’s private messages to a Facebook Page. Requires a separately deployed public HTTPS relay and Page messaging access; not a personal account login.'));const messengerOpen=el('button','secondary',zh?'配置 Messenger':'Set up Messenger');messengerOpen.dataset.onboardChannel='messenger';messengerOpen.disabled=active||legacy;messengerOpen.onclick=()=>action(async()=>{await window.arcade.botConfigure({channel:'messenger'});window.openConversationSetup({section:'channel'});});messengerRow.append(messengerBody,messengerOpen);chat.append(messengerRow);
    chat.append(el('p','onboarding-fine',zh?'每位搭档独立连接一个聊天渠道。聊天回复不等于工作已经完成。':'Each companion connects to one chat channel independently. A reply does not prove the work is complete.'));content.append(chat);
    const appearance=el('details','onboarding-extra');appearance.id='onboarding-appearance';appearance.open=appearanceOpen;appearance.ontoggle=()=>{appearanceOpen=appearance.open;};appearance.append(el('summary','',zh?'形象与语气':'Appearance and voice'));
    const personaGroup=el('div','onboarding-extra-body');const identity=el('div','persona-active');
    if(current){const avatar=el('img','');avatar.src=current.portrait;avatar.alt='';const body=el('div','');body.append(el('h3','',current.name[zh?'zh':'en']),el('p','',current.description[zh?'zh':'en']));identity.append(avatar,body);personaGroup.append(identity);}
    const controls=el('div','persona-controls'),label=el('label','',zh?'当前角色':'Current character'),select=el('select','');select.id='persona-character';label.htmlFor=select.id;
    for(const [id,text] of [['default',zh?'跟随 AI 默认人设':'Use the AI default'],['sprout',zh?'小芽 · 原创角色':'Sprout · original companion']]){const item=el('option','',text);item.value=id;select.append(item);}select.value=next.config.character||'default';select.disabled=active;select.onchange=()=>savePreferenceControl(select,'character','value');controls.append(label,select);
    const voiceLabel=el('label','persona-voice'),voice=el('input');voice.type='checkbox';voice.id='persona-voice';voice.checked=next.config.personaVoice!==false;voice.disabled=active;voice.onchange=()=>savePreferenceControl(voice,'personaVoice','checked');voiceLabel.append(voice,el('span','',zh?'启用轻量人设语气':'Use a light persona tone'));controls.append(voiceLabel);personaGroup.append(controls);
    const portraits=el('div','portrait-choices');
    for(const id of ['anime','pixel']){const button=el('button','portrait-choice');button.dataset.portrait=id;button.setAttribute('aria-pressed',String((next.config.portrait||'anime')===id));if(id==='anime'){const img=el('img','');img.src=current?.portrait||'portraits/sprout-anime.png';img.alt='';button.append(img);}else{const scene=el('div','portrait-pixel scene idle');scene.append(sprite('idle'));button.append(scene);}button.append(el('strong','',id==='anime'?(zh?'二次元头像':'Anime portrait'):(zh?'像素形象':'Pixel companion')));button.onclick=()=>savePreference('portrait',id);portraits.append(button);}
    personaGroup.append(portraits,el('p','onboarding-fine',zh?'角色和语气在下次连接生效，不改变执行权限。这些是项目原创形象，不是厂商官方角色。':'Character and voice apply on the next connection without changing permissions. These are project characters, not official provider mascots.'));appearance.append(personaGroup);content.append(appearance);
    const future=el('details','onboarding-extra');future.id='onboarding-planned';future.open=plannedOpen;future.ontoggle=()=>{plannedOpen=future.open;};future.append(el('summary','',zh?'后续接入计划':'Planned connections'));const futureBody=el('div','onboarding-extra-body');
    for(const item of planned){const row=el('div','connection-item');row.dataset.connection=item.id;const identity=getPersona(item.persona);if(identity){const avatar=el('img','connection-avatar');avatar.src=identity.portrait;avatar.alt='';row.append(avatar);}row.append(el('strong','',zh&&item.zh?item.zh:item.en),el('span','availability planned',zh?'规划中 · 未接入':'Planned · not connected'));futureBody.append(row);}future.append(futureBody);if(planned.length)content.append(future);
    const advanced=el('button','plain onboarding-advanced',zh?'打开高级连接设置':'Open advanced connection settings');advanced.onclick=()=>window.openConversationSetup({section:'advanced'});content.append(advanced,...optional);
    if(focusKey){const target=focusKey.id?$(focusKey.id):[...content.querySelectorAll(focusKey.provider?'[data-provider]':'[data-method]')].find(n=>focusKey.provider?n.dataset.provider===focusKey.provider:n.dataset.method===focusKey.method);if(target&&content.contains(target)&&!target.disabled)target.focus({preventScroll:true});}
  };
  if(data)window.renderConnections(data);
})();
