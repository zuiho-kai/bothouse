'use strict';
// First-run key entry: pick one AI, paste its API key, start the App conversation.
// The same card is the chat page's empty state while no AI is usable (bot.js mounts it), and a
// dialog when another page asks for it or a saved key has to be checked.
//
//  window.ArcadeFirstRun
//    needed(data)        true while the selected profile has no usable AI: an API service is
//                        selected, no key is saved for it, and nothing is connected
//    hasChannel(data)    true when the profile has a paired, saved, connecting or manual channel
//    open({provider})    show the card from anywhere: switches to Companion > Chat and focuses the
//                        key field; provider is 'claude' | 'gpt' | 'deepseek' | 'gemini' | 'doubao'
//    close()             close the dialog form of the card
//    inline(data)        the card element for the chat empty state, or null (bot.js)
//    stateKey()          changes whenever the card moves between inline and dialog (bot.js)
//    providerOf(data)    the provider id of the profile's current AI service
//    keyProblem(text,zh) '' or one sentence saying why this text cannot be an API key
//    known(error,zh)     '' or the bilingual sentence for a known main-process message
//    explain(error,zh)   known(...) or a generic sentence with the IPC prefix removed
(() => {
  const API_MODES=new Set(['api','gpt','deepseek','gemini','doubao']);
  const FALLBACK=[{id:'claude',name:'Claude',persona:'claude-ju',local:'claude',api:'api'},{id:'gpt',name:'GPT',persona:'codex-dragon',api:'gpt'},{id:'deepseek',name:'DeepSeek',persona:'deepseek-whale',api:'deepseek'},{id:'gemini',name:'Gemini',persona:'gemini-cat',api:'gemini'},{id:'doubao',name:'Doubao',zh:'豆包',persona:'doubao-girl',api:'doubao'}];
  const partners=()=>Array.isArray(window.ArcadePartners)&&window.ArcadePartners.length?window.ArcadePartners:FALLBACK;
  const COPY={
    claude:{key:['Anthropic API key','Anthropic API key'],hint:'sk-ant-…',note:['在 Anthropic Console 创建，按 API 用量计费；与 Claude 订阅分开。','Create it in the Anthropic Console. API usage is billed separately from a Claude subscription.']},
    gpt:{key:['OpenAI API key','OpenAI API key'],hint:'sk-…',note:['在 OpenAI 平台创建，按 API 用量计费；与 ChatGPT 订阅分开。','Create it on the OpenAI platform. API usage is billed separately from a ChatGPT subscription.']},
    deepseek:{key:['DeepSeek API key','DeepSeek API key'],hint:'sk-…',note:['在 DeepSeek 开放平台创建，按 API 用量计费。','Create it on the DeepSeek platform. API usage is billed.']},
    gemini:{key:['Google AI Studio API key','Google AI Studio API key'],hint:'API key',note:['在 Google AI Studio 创建；与 Gemini 应用订阅分开计费。','Create it in Google AI Studio. Billed separately from the Gemini app subscription.']},
    doubao:{key:['火山方舟 API key','Volcengine Ark API key'],hint:'API key',note:['在火山方舟控制台创建；不是豆包 App 的登录。','Create it in the Volcengine Ark console. It is not a Doubao app login.']},
  };
  const KNOWN=[
    [/Enter a valid API key without whitespace\./,['这把密钥的格式不对：需要 10 到 500 个字符，不能有空格或换行。','This key is not in a valid format: 10 to 500 characters, with no spaces or line breaks.']],
    [/The selected local backend does not use an API key\./,['当前选的是本机登录方式，它不使用 API key。请先选一个 API 服务。','The selected method uses a local login and takes no API key. Choose an API service first.']],
    [/Disconnect before changing the project or API key\./,['已有连接正在使用。请先在对话设置里断开，再更换 AI 或密钥。','A connection is in use. Disconnect in Conversation settings before changing the AI or its key.']],
    [/OS credential encryption is unavailable/,['系统加密暂时不可用，密钥没有保存。请重新打开应用后再试。','OS encryption is unavailable, so the key was not saved. Reopen the app and try again.']],
    [/\(credentials_busy\)/,['这位搭档的凭据正在清除。请等它完成后再保存。','This companion’s credentials are being cleared. Wait for that to finish, then save again.']],
    [/\(credential_scope_changed\)/,['搭档或 AI 服务刚刚变化，密钥没有保存。请再点一次保存。','The companion or AI service just changed, so the key was not saved. Choose Save again.']],
  ];
  const plain=error=>typeof plainError==='function'?plainError(error):String(error?.message||error||'');
  function known(error,zh){const text=plain(error);for(const [pattern,words] of KNOWN)if(pattern.test(text))return words[zh?0:1];return '';}
  function explain(error,zh){return known(error,zh)||(zh?'没有保存成功。':'The key was not saved. ')+plain(error).slice(0,200);}
  function keyProblem(value,zh){
    const text=typeof value==='string'?value:'';
    if(!text.trim())return zh?'请先粘贴 API key。':'Paste an API key first.';
    if(/[\s\x00-\x1f\x7f]/.test(text.trim()))return zh?'密钥中间有空格或换行。请只粘贴密钥本身。':'The key contains a space or line break. Paste only the key itself.';
    if(text.trim().length<10)return zh?'这把密钥太短（至少 10 个字符）。请检查是否复制完整。':'This key is too short (at least 10 characters). Check that all of it was copied.';
    if(text.trim().length>500)return zh?'这把密钥太长（最多 500 个字符）。请只粘贴密钥本身。':'This key is too long (500 characters at most). Paste only the key itself.';
    return '';
  }
  function needed(d){
    const b=d?.bot;if(!b)return false;
    if(!API_MODES.has(b.mode||'api')||b.hasKey===true)return false;
    return ['disconnected',undefined].includes(b.status);
  }
  function hasChannel(d){
    const b=d?.bot;if(!b)return false;
    if(b.paired===true||!['disconnected',undefined].includes(b.status)||b.mode==='native'&&!!b.workspace)return true;
    try{return !!window.selectedSavedConnection?.(d);}catch{return false;}
  }
  const providerOf=d=>{const mode=d?.bot?.mode||'api';return (partners().find(p=>p.api===mode||p.local===mode)||partners()[0]).id;};

  function recoveryExplanation(code,zh,mac=false){
    const messages={
      keychain_restart_required:['钥匙串仍无法读取。若 macOS 弹窗出现，请允许 Agent Arcade 访问，然后完全退出并重新打开 App；本进程可能缓存先前的拒绝。原凭据和聊天记录均保留。','Keychain access is still unavailable. If macOS prompts, allow Agent Arcade, then fully quit and reopen the App: this process may cache an earlier denial. Original credentials and chats are retained.'],
      vault_changed:['凭据文件已变化，未采用或覆盖。请完全退出并重新打开 App 后重试。','The credential file changed and was not adopted or overwritten. Fully quit and reopen the App before retrying.'],
      vault_invalid:['保存的凭据格式无法验证，原加密文件未作修改。聊天记录不受影响。','The saved credential format could not be verified. The original encrypted file was retained; chats are unaffected.'],
      credential_scope_changed:['搭档或 AI 服务已改变，本次恢复没有继续。请重新打开当前搭档的设置。','The companion or AI service changed. Recovery stopped; reopen the current companion’s settings.'],
      credentials_busy:['上一项凭据操作尚未结束，请稍候。','The previous credential operation is still running. Please wait.'],
      credentials_in_use:['请先断开这位搭档，再重试读取凭据。','Disconnect this companion before retrying its saved credentials.'],
      credentials_not_locked:['凭据状态已经变化，请检查当前搭档。','The credential state changed. Check the current companion.'],
      credential_reset_expired:['重新设置的确认已失效，请重新点击第一步。','The reset confirmation expired. Start the first step again.'],
      credential_backup_failed:['原加密凭据的备份未能验证，没有重设。请检查数据目录权限和磁盘空间。','The original encrypted credential backup could not be verified; nothing was reset. Check data-folder permissions and disk space.'],
      credential_reset_failed:['重设未完成，原加密凭据的备份保留。请完全退出 App 后检查。','Reset did not finish; the original encrypted credential backup was retained. Fully quit the App before checking.'],
      stop_unconfirmed:['尚未确认旧 App 对话已停止，没有恢复或重设凭据。请完全退出 App 后重试。','The old App conversation has not been confirmed stopped. Credentials were not recovered or reset. Fully quit the App and retry.'],
    };
    return (messages[code]||messages[mac?'keychain_restart_required':'vault_invalid'])[zh?0:1];
  }
  let latest=null,picked=null,busy=false,localBusy=false,message='',failed=false,localMessage='',localFailed=false,revealed=false,choiceKey='',moves=0,resetIntent=null;
  const zh=()=>latest?.config?.language==='zh';
  const tr=(a,b)=>zh()?a:b;
  const chosen=()=>partners().find(p=>p.id===picked)||partners().find(p=>p.id===providerOf(latest))||partners()[0];

  // ---- card (built once; render() only updates it, so what was typed is never lost) ----
  const card=el('section','first-run');card.id='first-run-card';card.setAttribute('aria-labelledby','first-run-title');
  const title=el('h2','first-run-title'),lead=el('p','first-run-lead'),choices=el('div','first-run-choices');title.id='first-run-title';choices.setAttribute('role','group');
  const form=el('form','first-run-form'),labelRow=el('div','first-run-label-row'),label=el('label',''),guide=el('button','plain first-run-guide');
  const keyRow=el('div','first-run-key-row'),input=el('input',''),reveal=el('button','plain first-run-reveal'),note=el('p','first-run-fine'),status=el('p','first-run-status'),save=el('button','primary first-run-save');
  input.id='first-run-key';input.type='password';input.autocomplete='off';input.spellcheck=false;input.maxLength=600;label.htmlFor=input.id;note.id='first-run-key-note';status.id='first-run-status';status.hidden=true;
  input.setAttribute('aria-describedby',`${note.id} ${status.id}`);guide.type=reveal.type='button';guide.id='first-run-key-guide';reveal.id='first-run-key-reveal';save.type='submit';save.id='first-run-save';
  labelRow.append(label,guide);keyRow.append(input,reveal);form.append(labelRow,keyRow,note,status,save);form.noValidate=true;
  const importLine=el('p','first-run-import'),importText=el('span',''),importButton=el('button','plain');importButton.type='button';importButton.id='first-run-import';importLine.append(importText,importButton);
  const other=el('details','first-run-other'),otherSummary=el('summary',''),otherBody=el('div','first-run-other-body'),otherText=el('p','first-run-fine'),localButton=el('button','secondary'),localStatus=el('p','first-run-status'),wizard=el('button','plain');
  other.id='first-run-other';localButton.type=wizard.type='button';localButton.id='first-run-local-claude';wizard.id='first-run-open-wizard';localStatus.id='first-run-local-status';localStatus.setAttribute('role','status');localStatus.hidden=true;
  otherBody.append(otherText,localButton,localStatus,wizard);other.append(otherSummary,otherBody);
  const recovery=el('section','first-run-recovery'),recoveryNote=el('p','first-run-fine'),recoveryStatus=el('p','first-run-status'),retry=el('button','primary'),reset=el('button','plain'),resetCancel=el('button','plain');
  recovery.id='first-run-recovery';recoveryStatus.id='first-run-recovery-status';recoveryStatus.setAttribute('role','status');retry.id='first-run-retry-credentials';reset.id='first-run-reset-credentials';resetCancel.id='first-run-reset-cancel';
  retry.type=reset.type=resetCancel.type='button';recovery.append(recoveryNote,recoveryStatus,retry,reset,resetCancel);recovery.hidden=true;
  card.append(title,lead,choices,form,recovery,importLine,other);
  const recoveryScope=()=>({profileId:latest.accounts?.selectedId||'',expectedMode:latest.bot?.mode||'api',expectedChannel:latest.bot?.channel||'wechat'});
  const sameRecovery=(a,b)=>a.profileId===b.profileId&&a.expectedMode===b.expectedMode&&a.expectedChannel===b.expectedChannel;
  async function recoveryAction(kind){
    if(busy||localBusy||latest?.bot?.credentialState!=='locked')return;
    const scope=recoveryScope(),mac=window.arcade?.platform?.os==='darwin';busy=true;message='';failed=false;draw();
    try{
      let result;
      if(kind==='retry'){resetIntent=null;result=await window.arcade.accountRetryCredentials(scope);}
      else if(!resetIntent||!sameRecovery(scope,resetIntent.scope)){
        result=await window.arcade.accountResetCredentials({...scope,action:'prepare'});
        if(!sameRecovery(scope,recoveryScope()))return;
        if(result?.prepared===true&&typeof result.ticket==='string'){resetIntent={scope,ticket:result.ticket};message=tr('这会停用本搭档全部 API key 和渠道登录凭据，需逐项重新填写；原加密文件先备份，聊天和记忆保留。再次点击下方确认才执行。','This retires all API keys and channel credentials for this companion; each must be entered again. The original encrypted file is backed up first, and chats/memory are retained. Click the confirmation below to proceed.');return;}
      }else{const ticket=resetIntent.ticket;resetIntent=null;result=await window.arcade.accountResetCredentials({...scope,action:'confirm',ticket});}
      if(!sameRecovery(scope,recoveryScope()))return;
      if(result?.recovered===true||result?.reset===true){
        const next=await window.arcade.snapshot();if(!sameRecovery(scope,recoveryScope())||!sameRecovery(scope,{profileId:next.accounts?.selectedId||'',expectedMode:next.bot?.mode||'api',expectedChannel:next.bot?.channel||'wechat'}))return;
        latest=next;if(typeof data!=='undefined')data=next;message='';failed=false;
        if(typeof render==='function')render();
        toast(result.reset===true?tr('原加密凭据已备份，聊天和记忆保留。请完全退出并重新打开 App，再填写本搭档的密钥。','Original encrypted credentials were backed up; chats and memory remain. Fully quit and reopen the App, then enter this companion’s keys.'):tr('已重新读取保存的密钥；尚未连接账号或请求模型。','Saved keys were reopened; no account was connected or model requested.'));
      }else{message=recoveryExplanation(result?.code,zh(),mac);failed=true;}
    }catch{if(sameRecovery(scope,recoveryScope())){message=recoveryExplanation('credential_open_failed',zh(),mac);failed=true;}}
    finally{busy=false;draw();}
  }
  retry.onclick=()=>void recoveryAction('retry');reset.onclick=()=>void recoveryAction('reset');resetCancel.onclick=()=>{resetIntent=null;message='';failed=false;draw();};

  // ---- dialog form ----
  const dialog=el('dialog','first-run-dialog'),close=el('button','icon-button first-run-close');dialog.id='first-run-dialog';dialog.setAttribute('aria-labelledby','first-run-title');
  close.type='button';close.id='first-run-close';close.textContent='×';dialog.append(close);document.body.append(dialog);
  const inDialog=()=>dialog.open;
  function leaveDialog(){if(card.parentNode===dialog)card.remove();moves++;message='';failed=false;if(typeof render==='function')render();}
  close.onclick=()=>dialog.close();
  dialog.addEventListener('close',leaveDialog);
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});

  function say(text,error=false){message=text||'';failed=!!error;draw();}
  function sayLocal(text,error=false){localMessage=text||'';localFailed=!!error;draw();}
  // force restarts the conversation with what was just saved; without it a running one is kept.
  async function startChat(force=true){
    const result=await window.ArcadeDesktopConversation?.select('local',true,{force});
    if(result?.ok!==true)throw Object.assign(Error(tr('App 对话尚未开始。请重试；已保存的密钥会保留。','App chat did not start. Try again; saved keys are retained.')),{code:result?.code||'start_failed'});
    if(inDialog())dialog.close();
    // select() focuses the composer once the conversation is running; this covers a slower start.
    requestAnimationFrame(()=>document.getElementById('desktop-chat-input')?.focus({preventScroll:true}));
    return result;
  }
  async function submit(){
    if(busy||localBusy||!latest)return;
    const partner=chosen(),value=input.value.trim(),current=latest.bot?.mode||'api',keep=!value&&latest.bot?.hasKey===true&&partner.api===current;
    if(!keep){const problem=keyProblem(input.value,zh());if(problem){say(problem,true);input.focus({preventScroll:true});return;}}
    const origin=recoveryScope();busy=true;say(tr('正在保存…','Saving…'));let saved=keep,modeSelected=partner.api===current;
    const scope={profileId:latest.accounts?.selectedId||'',expectedMode:partner.api,expectedChannel:latest.bot?.channel||'wechat'};
    const check=()=>{if(!sameRecovery(scope,recoveryScope()))throw Object.assign(Error('Conversation changed.'),{code:'changed'});};
    try{
      if(!keep){
        const profileId=latest.accounts?.selectedId||'',expectedChannel=latest.bot?.channel||'wechat';
        // The main process accepts a key only for the mode that is already selected.
        if(partner.api!==current){await window.arcade.botConfigure({mode:partner.api});modeSelected=true;}
        await window.arcade.botConfigure({profileId,expectedMode:partner.api,expectedChannel,key:value});saved=true;
      }
      // IPC can settle before its subscription snapshot reaches this renderer.
      // Read back the saved scope before deciding which conversation to resume.
      const next=await window.arcade.snapshot(),actual={profileId:next.accounts?.selectedId||'',expectedMode:next.bot?.mode||'api',expectedChannel:next.bot?.channel||'wechat'};
      if(!sameRecovery(scope,actual)||latest.accounts?.selectedId!==scope.profileId)throw Object.assign(Error('Conversation changed.'),{code:'changed'});
      latest=next;if(typeof data!=='undefined')data=next;if(typeof render==='function')render();
      check();input.value='';revealed=false;message='';failed=false;picked=null;
      await startChat(!keep);
    }catch(error){if(sameRecovery(scope,recoveryScope())||!modeSelected&&sameRecovery(origin,recoveryScope())){if(!saved)input.value=value;say(saved?tr('密钥已保存，但 App 对话尚未开始。请点击下方按钮重试。','The key is saved, but App chat did not start. Choose the button below to retry.'):explain(error,zh()),true);requestAnimationFrame(()=>input.focus({preventScroll:true}));}}
    finally{busy=false;draw();}
  }
  form.addEventListener('submit',event=>{event.preventDefault();void submit();});
  input.addEventListener('input',()=>{if(failed){message='';failed=false;}if(latest)draw();});
  reveal.onclick=()=>{revealed=!revealed;draw();input.focus({preventScroll:true});};
  guide.onclick=()=>{const partner=chosen();if(typeof window.arcade.providerGuide==='function')void action(()=>window.arcade.providerGuide(partner.id==='claude'?'claude-api':partner.id));};
  importButton.onclick=()=>{if(inDialog())dialog.close();if(window.ArcadeCharactersTabs?.open)window.ArcadeCharactersTabs.open('library',{focus:false});else switchView('characters');requestAnimationFrame(()=>document.getElementById('characters-import')?.focus({preventScroll:true}));};
  wizard.onclick=()=>{if(inDialog())dialog.close();switchView('connections');};
  localButton.onclick=async()=>{
    if(busy||localBusy||!latest||typeof window.arcade.useExistingClaude!=='function')return;
    localBusy=true;sayLocal(tr('正在检查本机的 Claude Code…','Checking Claude Code on this computer…'));
    try{
      const scope=recoveryScope();
      const result=await window.arcade.useExistingClaude(scope);
      if(latest.accounts?.selectedId!==scope.profileId||latest.bot?.channel!==scope.expectedChannel)return;
      const blocked=['unsupported_version','unknown_version'].includes(result?.code);
      if(result?.ok===true){
        const current=await window.arcade.snapshot();
        if(current.accounts?.selectedId!==scope.profileId||current.bot?.channel!==scope.expectedChannel||current.bot?.mode!=='claude')return;
        localMessage='';localFailed=false;await startChat();
      }else sayLocal(blocked?tr('找到了 Claude Code，但它的版本不兼容或无法确认。请安装兼容的版本后再试。','Claude Code was found, but its version is incompatible or unconfirmed. Install a compatible version and try again.')
        :result?.code==='signed_out'?tr('找到了 Claude Code，但它还没有登录。请先在 Claude Code 里登录，再回来开始聊天。','Claude Code was found but is not signed in. Sign in there, then return to start chatting.')
        :result?.code==='not_installed'?tr('这台电脑上没有找到 Claude Code。可以改用上面的 API key。','Claude Code was not found on this computer. You can use an API key above instead.')
        :tr('无法确认 Claude Code 的登录状态。可以改用上面的 API key。','The Claude Code login could not be confirmed. You can use an API key above instead.'),true);
    }catch(error){sayLocal(known(error,zh())||tr('检查没有完成。可以改用上面的 API key。','The check did not finish. You can use an API key above instead.'),true);}
    finally{localBusy=false;draw();}
  };

  function draw(){
    if(!latest)return;
    const z=zh(),partner=chosen(),words=COPY[partner.id]||COPY.claude,current=latest.bot?.mode||'api',saved=latest.bot?.hasKey===true&&partner.api===current,asDialog=inDialog(),name=z&&partner.zh?partner.zh:partner.name,locked=latest.bot?.credentialState==='locked',mac=window.arcade?.platform?.os==='darwin';
    const set=(node,text)=>{if(node.textContent!==text)node.textContent=text;};
    set(title,asDialog?tr('AI 与密钥','AI and key'):tr('在这里和一位 AI 角色聊天','Chat with an AI character here'));
    set(lead,asDialog?tr('选一个 AI，粘贴它的 API key。已保存的密钥不会显示；粘贴新的会替换它。','Choose an AI and paste its API key. A saved key is never shown; pasting a new one replaces it.'):tr('先选一个你有 API key 的 AI，粘贴密钥就能开始。','Choose an AI you have an API key for, paste the key, and start.'));
    if(locked){set(title,tr('已保存的密钥暂时无法打开','Saved keys could not be opened'));set(lead,mac?tr('更新或重新打包后，macOS 可能需要再次允许钥匙串访问。原加密凭据、聊天和记忆都保留。','After an update or rebuild, macOS may need to allow Keychain access again. Original encrypted credentials, chats and memory are retained.'):tr('原加密凭据保持不变。可先重试读取；跨 Windows 应用配置迁移仍在“管理搭档”里。','Original encrypted credentials are unchanged. Retry opening them first; Windows profile migration remains under Manage companions.'));}
    choices.hidden=form.hidden=importLine.hidden=other.hidden=locked;recovery.hidden=!locked;
    set(recoveryNote,mac?tr('点击重试。若系统询问，请允许当前 Agent Arcade 访问钥匙串；若仍失败，完全退出并重新打开 App。钥匙串项目丢失时不能凭空恢复旧密钥。','Retry opening saved keys. If macOS asks, allow this Agent Arcade access to Keychain. If it still fails, fully quit and reopen the App. A deleted Keychain item cannot recreate the old keys.'):tr('重试不会改写原凭据或连接账号。','Retry does not rewrite the original credentials or connect an account.'));
    set(recoveryStatus,message);recoveryStatus.hidden=!message;recoveryStatus.dataset.error=String(failed);recoveryStatus.setAttribute('role',failed?'alert':'status');
    set(retry,busy?tr('正在处理…','Working…'):tr('重试读取已保存密钥','Retry saved keys'));retry.disabled=busy||typeof window.arcade.accountRetryCredentials!=='function';
    set(reset,resetIntent?tr('确认备份原凭据并重新设置','Confirm backup and reset credentials'):tr('无法恢复？保留聊天并重新设置…','Cannot recover? Keep chats and reset…'));reset.disabled=busy||typeof window.arcade.accountResetCredentials!=='function';set(resetCancel,tr('取消重新设置','Cancel reset'));resetCancel.hidden=!resetIntent;resetCancel.disabled=busy;
    choices.setAttribute('aria-label',tr('选择 AI','Choose an AI'));
    const personas=latest.personas||[],key=JSON.stringify([z,partners().map(p=>p.id),personas.map(p=>[p.id,p.portrait])]);
    if(choiceKey!==key){
      choiceKey=key;
      choices.replaceChildren(...partners().map(item=>{
        const b=el('button','first-run-choice'),identity=personas.find(p=>p.id===item.persona),text=el('span','first-run-choice-text');b.type='button';b.dataset.provider=item.id;
        if(identity?.portrait){const image=el('img','');image.src=identity.portrait;image.alt='';b.append(image);}
        text.append(el('strong','',z&&item.zh?item.zh:item.name));const persona=identity?.name?.[z?'zh':'en'];if(persona&&persona!==(z&&item.zh?item.zh:item.name))text.append(el('small','',persona));
        b.append(text);b.onclick=()=>{if(busy||localBusy)return;picked=item.id;message='';failed=false;draw();};return b;
      }));
    }
    for(const b of choices.children){b.setAttribute('aria-pressed',String(b.dataset.provider===partner.id));b.disabled=busy||localBusy;}
    set(label,words.key[z?0:1]);
    set(guide,tr('获取 API key','Get an API key'));guide.title=tr(`在浏览器里打开 ${name} 的密钥页面`,`Opens the ${name} key page in your browser`);guide.hidden=typeof window.arcade.providerGuide!=='function';
    input.placeholder=saved?tr('已保存；粘贴新的密钥可替换','Saved; paste a new key to replace it'):words.hint;input.type=revealed?'text':'password';input.disabled=busy||localBusy;
    set(reveal,revealed?tr('隐藏','Hide'):tr('显示','Show'));reveal.setAttribute('aria-pressed',String(revealed));reveal.setAttribute('aria-label',tr('显示输入的密钥','Show the typed key'));
    set(note,`${words.note[z?0:1]}${tr(' 密钥用系统加密保存在这台电脑上。',' The key is stored on this computer with OS encryption.')}`);
    set(status,message);status.hidden=!message;status.dataset.error=String(failed);if(failed)status.setAttribute('role','alert');else status.setAttribute('role','status');
    input.setAttribute('aria-invalid',String(failed));
    set(save,busy?tr('正在保存…','Saving…'):saved&&!input.value.trim()?(latest.desktopChat?.kind==='local'&&latest.bot?.local?.available?tr('密钥不变，继续聊天','Keep the key and continue chatting'):tr('用已保存的密钥开始聊天','Start chatting with the saved key')):tr('保存并开始聊天','Save and start chatting'));save.disabled=busy||localBusy;
    set(importText,tr('我有 SillyTavern 角色卡：','I have a SillyTavern character card: '));set(importButton,tr('去角色库导入','import it in the library'));
    set(otherSummary,tr('其他接入方式','Other ways to connect'));
    set(otherText,tr('已经在这台电脑上登录了 Claude Code？可以不填 API key，直接用它的登录（需要 Claude Code 2.1.317）。检查只看安装和登录状态，不发送模型请求。','Already signed in to Claude Code on this computer? You can use that login without an API key (requires Claude Code 2.1.317). The check only looks at installation and sign-in; no model request is sent.'));
    set(localButton,localBusy?tr('正在检查…','Checking…'):tr('用本机 Claude Code 聊天','Chat with local Claude Code'));localButton.disabled=busy||localBusy||typeof window.arcade.useExistingClaude!=='function';
    set(localStatus,localMessage);localStatus.hidden=!localMessage;localStatus.dataset.error=String(localFailed);
    set(wizard,tr('微信、QQ 等聊天软件和更多设置，在「工作 › 渠道」','WeChat, QQ and more settings are under Work › Channels'));
    close.setAttribute('aria-label',tr('关闭','Close'));close.title=tr('关闭','Close');
  }

  function open({provider,fromSettings=false}={}){
    if(!latest)return false;
    picked=typeof provider==='string'&&partners().some(p=>p.id===provider)?provider:picked;
    if(!fromSettings&&document.body.dataset.view!=='bot')switchView('bot');
    const panel=document.getElementById('bot-setup-panel');if(!fromSettings&&panel?.open)document.getElementById('bot-settings-close')?.click();
    // Inline when the chat page is showing the card as its empty state; a dialog everywhere else.
    if(fromSettings||!(card.isConnected&&card.parentNode!==dialog)){
      if(!dialog.open){dialog.append(card);moves++;dialog.showModal();if(typeof render==='function')render();}
    }
    draw();
    requestAnimationFrame(()=>{card.scrollIntoView({block:'nearest'});(latest?.bot?.credentialState==='locked'?retry:input).focus({preventScroll:true});});
    return true;
  }
  window.ArcadeFirstRun=Object.freeze({
    needed,hasChannel,open,providerOf,keyProblem,known,explain,recoveryExplanation,
    settingsRecovery(profileId,zh){
      const windows=window.arcade?.platform?.os==='win32'&&typeof window.arcade.accountMigrateCredentials==='function';
      const text=windows
        ?(zh?'这个搭档已保存的凭据暂时读不到。可在管理搭档中从原应用配置迁移。':'This companion’s saved credentials cannot be read right now. Use Manage companions to migrate them from the original app profile.')
        :(zh?'这个搭档已保存的凭据暂时读不到。请打开恢复界面重试读取。':'This companion’s saved credentials cannot be read right now. Open recovery to retry.');
      return {
        text,label:windows?(zh?'前往管理搭档':'Open Manage companions'):(zh?'查看凭据恢复':'Open credential recovery'),
        open(){
          if(!profileId||latest?.accounts?.selectedId!==profileId||latest.bot?.credentialState!=='locked')return;
          if(windows)window.openCompanionManager?.({accountId:profileId});
          else open({fromSettings:true});
        },
      };
    },

    close(){if(dialog.open)dialog.close();},
    inline(d){return !dialog.open&&needed(d)?card:null;},
    stateKey:()=>`${moves}:${dialog.open}`,
  });
  window.renderFirstRun=next=>{
    const account=latest?.accounts?.selectedId,mode=latest?.bot?.mode;latest=next;
    if(resetIntent&&!sameRecovery(resetIntent.scope,recoveryScope()))resetIntent=null;
    if(account!==undefined&&account!==next.accounts?.selectedId){resetIntent=null;picked=null;input.value='';message='';failed=false;localMessage='';localFailed=false;revealed=false;if(dialog.open)dialog.close();}
    // A draft belongs to the service that was current when it was typed. An
    // external backend change must not make that draft look like saved settings.
    if(mode!==undefined&&mode!==next.bot?.mode){picked=null;input.value='';message='';failed=false;revealed=false;}
    if(picked&&!partners().some(p=>p.id===picked))picked=null;
    draw();
  };
  if(typeof data!=='undefined'&&data)window.renderFirstRun(data);
})();
