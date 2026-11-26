(() => {
  'use strict';
  const COPY={zh:{title:'语音聊天',intro:'使用本机语音识别与朗读。只有识别后的文字会发给当前 AI。',listen:'开始说话',interrupt:'打断',close:'结束语音',language:'识别语言',voice:'朗读声线',automatic:'默认声线',handsfree:'耳机免按键模式',headphones:'我已戴好耳机，避免把扬声器当成我的声音',idle:'麦克风已关闭',starting:'正在打开麦克风…',listening:'正在听你说话',thinking:'正在想怎么回复',speaking:'正在说话，可以打断',closed:'语音已结束',error:'语音暂不可用',heard:'听到',said:'回复',pending:'正在读取本机语音语言…',none:'未安装可用的本机语音识别语言。请在 Windows 设置中添加语音语言。',limit:'免按键模式最长持续 10 分钟；退出或切换角色会关闭麦克风。',privacy:'不保存录音。语音文字会进入当前角色的本地对话记忆。'},en:{title:'Voice conversation',intro:'Local speech recognition and playback. Only recognized text goes to the selected AI.',listen:'Start speaking',interrupt:'Interrupt',close:'End voice',language:'Recognition language',voice:'Playback voice',automatic:'Default voice',handsfree:'Hands-free with headphones',headphones:'I am wearing headphones to prevent speaker feedback',idle:'Microphone off',starting:'Opening the microphone…',listening:'Listening',thinking:'Thinking of a reply',speaking:'Speaking — you can interrupt',closed:'Voice ended',error:'Voice unavailable',heard:'Heard',said:'Reply',pending:'Checking installed speech languages…',none:'No local speech recognizer is installed. Add a speech language in Windows Settings.',limit:'Hands-free sessions last at most 10 minutes. Leaving or switching characters closes the microphone.',privacy:'Audio is not saved. Recognized text enters this character’s local conversation memory.'}};
  function createPanel({api,language='zh',sourceKind='channel'}={}) {
    Object.assign(COPY.zh,{intro:'开始说话 → 说完了 → 检查文字后发送。不保存录音。',finish:'说完了',recognizing:'正在识别最后一句…',reviewing:'文字待你确认 · 尚未发送',unrecognized:'没有识别到文字',limit:'每次最多聆听 10 分钟；结束或切换角色会关闭麦克风。',settings:'语音设置',reviewLabel:'确认要发送的文字',send:'发送',retry:'重新说',sent:'已发送',handsfree:'耳机免按键（识别后直接发送）'});
    Object.assign(COPY.en,{intro:'Start speaking → Done speaking → Review the text and send. Audio is not saved.',finish:'Done speaking',recognizing:'Finishing recognition…',reviewing:'Review transcript · Not sent',unrecognized:'No words recognized',limit:'Listening lasts at most 10 minutes. Ending voice or switching characters closes the microphone.',settings:'Speech settings',reviewLabel:'Review the text to send',send:'Send',retry:'Record again',sent:'Sent',handsfree:'Hands-free with headphones (send automatically)'});
    COPY.zh.closing='正在结束语音…';COPY.en.closing='Ending voice…';
    const zh=language!=='en',t=COPY[zh?'zh':'en'];let disposed=false,closing=false,busy=false,last=null,deviceError='',actionError='',canStart=true,editingDraftId=null,deviceEpoch=0,handsSupported=true;
    const reasons={
      'qq-message':zh?'收到新的 QQ 消息，已暂停麦克风和播报。再次点击“开始说话”恢复语音。':'A new QQ message paused the microphone and playback. Start speaking again to resume.',
      'channel-message':zh?'收到新的聊天消息，语音已暂停。':'A new chat message paused voice.',
      'manual-interruption':zh?'你已打断本次语音。':'You interrupted voice.',
      'manual-close':zh?'语音已结束。':'Voice ended.',
      'account-switch':zh?'切换搭档时已关闭语音。':'Voice closed when switching companions.',
      'scope-changed':zh?'账号或角色已改变，原语音已关闭。':'The account or character changed; the previous voice session closed.',
      'connection-reset':zh?'聊天连接已重置，语音已关闭。':'The chat connection reset; voice closed.',
      'connection-ended':zh?'聊天连接结束，语音已关闭。':'The chat connection ended; voice closed.',
      'window-hidden':zh?'窗口隐藏时已关闭麦克风和播报。':'Hiding the window closed the microphone and playback.',
      'view-left':zh?'离开聊天页面时已关闭语音。':'Leaving the chat page closed voice.',
      'panel-disposed':zh?'语音面板关闭，麦克风和播报已停止。':'Closing the voice panel stopped the microphone and playback.',
      'panel-replaced':zh?'界面更新时已关闭原语音。':'The previous voice session closed when the panel changed.',
      'listening-ended':zh?'本次聆听已结束，可以重新开始。':'Listening ended. You can start again.',
      'no-words':zh?'这次没有识别到文字，没有发送给搭档。检查输入设备后可以重新开始。':'No words were recognized, so nothing was sent. Check the input device and try again.',
      'text-limit':zh?'已达到 2000 字上限。点击“说完了”检查已识别的部分，或结束语音取消。':'The 2,000-character limit was reached. Finish to review the recognized part, or end voice to cancel.',
      'listening-timeout':zh?'聆听时限已到，尚未收到完整语句。请确认默认输入设备，点击“开始说话”后再试一句。':'The listening time limit ended without a completed utterance. Check the default input and start speaking again.',
      'microphone-error':zh?'本机语音识别失败，请检查麦克风后重试。':'Speech recognition failed. Check the microphone and try again.',
    };
    const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text)el.textContent=text;return el;};
    const element=node('section','voice-panel');element.setAttribute('aria-label',t.title);
    const header=node('div','voice-heading');header.append(node('h3','',t.title));
    const status=node('span','voice-state',t.idle);status.setAttribute('role','status');status.setAttribute('aria-live','polite');header.append(status);element.append(header,node('p','voice-intro',t.intro));
    const options=node('div','voice-options');
    const providerLabel=node('label','',zh?'语音方案':'Speech provider'),providers=node('select');
    for(const [value,label] of [['local-neural',zh?'温柔女声 · 本机神经语音':'Gentle voice · Local neural speech'],['windows',zh?'Windows 语音（备用）':'Windows speech (fallback)']]){const option=node('option','',label);option.value=value;providers.append(option);}
    providers.value='';providerLabel.append(providers);options.append(providerLabel);
    const providerInfo=node('p','voice-hint');element.append(providerInfo);
    const languageLabel=node('label','',t.language),locales=node('select');languageLabel.append(locales);
    const voiceLabel=node('label','',t.voice),voices=node('select');voiceLabel.append(voices);options.append(languageLabel,voiceLabel);element.append(options);
    const handsLabel=node('label','voice-check'),hands=node('input');hands.type='checkbox';handsLabel.append(hands,document.createTextNode(t.handsfree));
    const headsetLabel=node('label','voice-check'),headset=node('input');headset.type='checkbox';headsetLabel.append(headset,document.createTextNode(t.headphones));headsetLabel.hidden=true;
    hands.addEventListener('change',()=>{headsetLabel.hidden=!hands.checked;if(!hands.checked)headset.checked=false;});const limit=node('p','voice-hint',t.limit);
    const controls=node('div','voice-controls'),listen=node('button','primary',t.listen),finish=node('button','primary',t.finish),interrupt=node('button','',t.interrupt),close=node('button','',t.close);
    for(const button of [listen,finish,interrupt,close])button.type='button';controls.append(listen,finish,interrupt,close);element.insertBefore(controls,options);
    const error=node('p','voice-error');error.setAttribute('role','alert');element.append(error);
    const explanation=node('p','voice-hint');explanation.setAttribute('role','status');element.append(explanation);
    const review=node('div','voice-review'),reviewLabel=node('label','voice-review-label',t.reviewLabel),editor=node('textarea','voice-editor'),send=node('button','primary',t.send);editor.rows=3;editor.maxLength=2000;reviewLabel.append(editor);send.type='button';review.append(reviewLabel,send);element.append(review);
    const transcript=node('p','voice-transcript'),reply=node('p','voice-reply');element.append(transcript,reply,node('p','voice-hint',sourceKind==='local'?(zh?'识别后的文字保存在这段 App 对话中；回复不发到 QQ。':'Recognized text stays in this App conversation; replies are not sent to QQ.'):t.privacy));
    const advanced=node('details','voice-advanced');advanced.append(node('summary','',t.settings),options,handsLabel,headsetLabel,limit);element.append(advanced);
    const perform=async operation=>{if(disposed||busy||closing)return;busy=true;listen.disabled=true;finish.disabled=true;send.disabled=true;providers.disabled=true;actionError='';error.textContent='';try{const state=await operation();if(state?.status)render(state);}catch(e){if(!disposed)actionError=e?.message||t.error;}finally{busy=false;if(!disposed&&last)render(last);}};
    const loadSpeechOptions=async()=>{
      if(closing||disposed)return;
      const epoch=++deviceEpoch;
      error.textContent=t.pending;
      providerInfo.textContent=zh?'正在检查所选语音方案…':'Checking the selected speech provider…';handsLabel.hidden=true;
      try{const available=await api.voiceCapabilities(providers.value?{backend:providers.value}:{});if(disposed||epoch!==deviceEpoch)return;locales.replaceChildren();voices.replaceChildren();
        if(available.selectedBackend)providers.value=available.selectedBackend;
        handsSupported=available.handsFree!==false;
        if(!handsSupported){hands.checked=false;headset.checked=false;headsetLabel.hidden=true;}
        handsLabel.hidden=!handsSupported;
        limit.textContent=available.maxHandsFreeSeconds?(zh?`手动录音最多 ${available.maxCaptureSeconds} 秒；耳机免按键最长 ${available.maxHandsFreeSeconds/60} 分钟，单句最多 ${available.maxSegmentSeconds} 秒。`:`Manual recording: ${available.maxCaptureSeconds}s. Hands-free: ${available.maxHandsFreeSeconds/60} minutes, ${available.maxSegmentSeconds}s per utterance.`):available.maxCaptureSeconds?(zh?`每次录音最多 ${available.maxCaptureSeconds} 秒。说完后核对文字再发送。`:`Each recording lasts up to ${available.maxCaptureSeconds} seconds. Review before sending.`):t.limit;
        providerInfo.textContent=providers.value==='local-neural'?(zh?'温柔女声 · 首次开始需要加载本机语音模型。':'Gentle voice · The first recording loads the local speech models.'):(zh?'使用 Windows 自带的识别和朗读。':'Using Windows speech recognition and playback.');
        for(const locale of [...new Set((available.recognizers||[]).map(item=>item.locale))]){const option=node('option','',locale);option.value=locale;locales.append(option);}
        if([...locales.options].some(option=>option.value==='zh-CN'))locales.value='zh-CN';
        const auto=node('option','',t.automatic);auto.value='';voices.append(auto);
        for(const voice of available.voices||[]){const option=node('option','',`${voice.name} · ${voice.locale}`);option.value=voice.name;voices.append(option);}
        deviceError=locales.options.length?'':t.none;error.textContent=deviceError;if(last)render(last);
      }catch(e){if(!disposed&&epoch===deviceEpoch){deviceError=e?.message||t.error;error.textContent=deviceError;providerInfo.textContent=zh?'所选语音方案尚未就绪。可以检查安装，或明确选择备用方案。':'The selected provider is not ready. Check its installation or explicitly select the fallback.';hands.checked=false;headset.checked=false;headsetLabel.hidden=true;locales.replaceChildren();listen.disabled=true;}}
    };
    providers.addEventListener('change',()=>perform(async()=>{const state=await api.voiceClose('manual-close');await loadSpeechOptions();return state;}));
    listen.addEventListener('click',()=>perform(()=>api.voiceStart({backend:providers.value||undefined,mode:hands.checked&&handsSupported?'hands-free':'push-to-talk',locale:locales.value,voice:voices.value,headphonesConfirmed:headset.checked})));
    finish.addEventListener('click',()=>perform(()=>api.voiceFinish()));
    send.addEventListener('click',()=>perform(()=>api.voiceConfirm({draftId:editingDraftId,text:editor.value})));
    editor.addEventListener('input',()=>{send.disabled=busy||closing||last?.status==='closing'||!editor.value.trim()||editor.value.length>2000;});
    // Interruption stays available even while a start/capability call is pending.
    interrupt.addEventListener('click',()=>{if(closing)return;api.voiceInterrupt().then(render).catch(e=>{error.textContent=e.message||t.error;});});
    close.addEventListener('click',()=>{if(closing)return;api.voiceClose().then(render).catch(e=>{error.textContent=e.message||t.error;});});
    function render(state){if(disposed||!state)return;last=state;close.disabled=closing;if(typeof state.canStart==='boolean')canStart=state.canStart;status.textContent=t[state.status]||t.idle;status.dataset.state=state.status;transcript.textContent=state.transcript?`${state.reviewed?t.sent:t.heard}：${state.transcript}`:'';reply.textContent=state.reply?`${t.said}：${state.reply}`:'';transcript.hidden=!state.transcript||state.status==='reviewing';reply.hidden=!state.reply;error.textContent=state.error||actionError||deviceError;interrupt.disabled=['idle','closed','unrecognized','error','reviewing','closing'].includes(state.status);listen.disabled=busy||!canStart||!locales.options.length||['starting','listening','recognizing','closing'].includes(state.status);
      review.hidden=state.status!=='reviewing'||!state.draftId;listen.textContent=review.hidden?t.listen:t.retry;
      if(!review.hidden&&editingDraftId!==state.draftId){editingDraftId=state.draftId;editor.value=state.transcript||'';}
      else if(review.hidden){editingDraftId=null;editor.value='';}
      send.disabled=busy||review.hidden||!editor.value.trim()||editor.value.length>2000;
      const recording=state.status==='listening',automatic=state.mode==='hands-free';finish.disabled=busy||!recording||automatic;finish.hidden=automatic;hands.disabled=headset.disabled=locales.disabled=voices.disabled=['starting','listening','recognizing','closing'].includes(state.status);providers.disabled=busy||['starting','listening','recognizing','thinking','speaking','reviewing','closing'].includes(state.status);
      if(state.status==='starting'&&providers.value==='local-neural')status.textContent=zh?'正在准备本机语音…':'Preparing local speech…';
      if(zh&&state.error==='Voice shutdown has not been confirmed. Retry ending the session.')error.textContent='尚未确认语音已停止，请重试结束语音。';
      if(zh&&state.error==='The local Qwen ASR process did not respond in time.')error.textContent='本机识别器启动或识别超时。请结束语音后重试。';
      const audio=state.audioLevel;
      let message=['closing','error'].includes(state.status)?'':reasons[state.reason]||'';
      if(state.status==='starting'&&providers.value==='local-neural')message=zh?'首次需要加载模型；显示“正在听你说话”后再开口。可以随时结束语音。':'The first use loads the models. Wait for Listening before speaking. You can end voice at any time.';
      if(recording&&!automatic&&!message)message=zh?'麦克风已打开。说完后点“说完了”；现在还没有发给搭档。':'The microphone is open. Click Done speaking when finished; nothing has been sent yet.';
      if(state.status==='recognizing')message=zh?'正在收尾识别，麦克风会随之关闭。识别文字会先交给你检查。':'Finishing recognition and closing the microphone. You can review the text before sending.';
      if(state.status==='reviewing')message=zh?'麦克风已关闭。可以修改错字；只有点击“发送”才会交给搭档。':'The microphone is off. Correct any mistakes; only Send passes this text to your companion.';
      if(state.status==='listening'&&state.listeningSince&&Date.now()-state.listeningSince>=15000&&!state.speechDetectedAt){message=audio?.max>0?(zh?'识别器有输入电平，但尚未检测到说话。请确认识别语言，再说一句。':'Input levels are present, but no speech was detected. Check the recognition language and try a sentence.'):(zh?'尚未检测到说话。请检查 Windows 默认输入设备和麦克风静音；这不是 AI 接口错误。':'No speech detected yet. Check the Windows default input device and microphone mute; this is not an AI API error.');}
      if(closing||state.status==='closing'){status.textContent=t.closing;message=zh?'正在关闭麦克风与播报，请稍候。':'Closing the microphone and playback. Please wait.';for(const control of [listen,finish,send,interrupt,close,providers,locales,voices,hands,headset])control.disabled=true;}
      explanation.textContent=message;explanation.hidden=!message;
    }
    const hintTimer=setInterval(()=>{if(last)render(last);},1000);
    render({status:'idle'});loadSpeechOptions();
    const dispose=()=>{disposed=true;deviceEpoch++;clearInterval(hintTimer);element.remove();};
    return {element,render,dispose,setClosing:value=>{closing=!!value;if(last)render(last);},destroy:(reason='panel-disposed')=>{dispose();api.voiceClose(reason).catch(()=>{});},snapshot:()=>last};
  }
  window.ArcadeVoice={createPanel};
})();
