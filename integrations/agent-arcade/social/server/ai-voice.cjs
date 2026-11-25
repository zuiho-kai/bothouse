'use strict';

const {createHash,randomUUID}=require('node:crypto');
const {fail}=require('./store.cjs');
const {AI_NUMBER,AI_DRAGON_NUMBER,AI_JU_NUMBER}=require('./ai-roles.cjs');
const {composeAiReply}=require('./ai-stickers.cjs');
const {needsWrittenReply}=require('../../src/bot/companion-reply-preference.cjs');
const {addressedMediaText,groupMediaRequest}=require('../../src/bot/group-media-request.cjs');
const {validateVoice,validateAiVoice,MAX_AI_CHARS}=require('./voice-upload.cjs');
const character=new Map([[AI_NUMBER,'deepseek-whale'],[AI_DRAGON_NUMBER,'codex-dragon'],[AI_JU_NUMBER,'claude-ju']]);
const previewLine='你好，很高兴见到你。以后我们可以用这个声音聊天。';
const preciseRequest=/(?:逐项|逐条|核对|精确|全文|完整列表|保留全部|\b(?:fact.check|verify exactly)\b)/iu;
const visualLayout=/(?:^|\n)\s*(?:[>#]|[-*]\s|\d+[.)]\s)/u;
// Normalize narration verbs only after a direct request to speak. The existing
// media parser still checks the rest of the request and recognizes quoted lines.
const spokenExplanation=/^((?:请问)?(?:麻烦你?|请你?)?(?:你)?(?:可不可以|能不能|能否|可以|能够|能|方便)?\s*(?:用语音(?:消息)?|(?:给(?:我|我们|大家))?(?:发|来|录)(?:一?[条段个])?语音(?:消息)?)[，,\s]*(?:给(?:我|我们|大家)|帮我)?\s*(?:来)?)(?:讲讲|讲解|讲|解释|介绍)/u;

function speechRequest(number,name,input){
  const role=character.get(number);
  if(!role)return {};
  const body=addressedMediaText(input,role,name);
  const request=body.replace(/^(?:请|麻烦你?)?帮我(?=(?:发|用|说|念|读|朗读))/u,'').replace(spokenExplanation,'$1说');
  const media=groupMediaRequest(request,role,name,true);
  return {media,explicit:/-(?:speech|recording|serena)$/u.test(media?.assetId??'')||
    /^(?:请|麻烦)?(?:给我|帮我)?(?:用)?语音(?:回复|回答|回我|说)(?:一下|下)?(?:[\s，,：:]|$)/u.test(body)};
}
const speechAllowed=input=>!needsWrittenReply(input)&&!preciseRequest.test(input);
const isAzureVoice=voice=>voice?.remote===true&&voice.id.startsWith('azure-');

function createAiVoice(store,engine){
  const voices=engine?.voices||[];
  const previews=new Map();
  const preference=(human,role)=>store.one(
    'SELECT voice,revision FROM ai_voice_preferences WHERE human=? AND ai=?',human,role);
  const scope=(chat,human,role)=>store.one(
    'SELECT backend,revision,legacy_voice FROM ai_voice_scopes WHERE chat=? AND human=? AND ai=?',chat,human,role);
  const descriptor=id=>voices.find(voice=>voice.id===id);
  const backend=id=>descriptor(id)?.remote?'azure':'local';
  const personalDefault=human=>store.one("SELECT enabled,revision FROM personal_voice_defaults WHERE human=? AND backend='azure'",human);
  function setDefault(human,enabled){
    if(!enabled)store.run(`DELETE FROM personal_voice_offers WHERE EXISTS(
      SELECT 1 FROM messages WHERE id=personal_voice_offers.prompt AND sender=?)`,human);
    store.run(`INSERT INTO personal_voice_defaults VALUES(?,'azure',?,?)
      ON CONFLICT(human,backend) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision`,human,Number(enabled),randomUUID());
  }
  function selection(chat,human,role,voiceOwner){
    const saved=preference(voiceOwner??human,role), grant=scope(chat,human,role);
    const voice=saved?saved.voice:voiceOwner?null:grant?.legacy_voice??null;
    const available=voiceOwner?isAzureVoice(descriptor(voice)):!!descriptor(voice);
    const base={voice,revision:saved?.revision??null,scopeRevision:grant?.revision??null};
    const localGrant=available&&grant?.backend===backend(voice);
    if(!voiceOwner)return {...base,allowed:localGrant};
    const pref=personalDefault(human), pause=store.one(
      'SELECT revision FROM personal_voice_pauses WHERE chat=? AND human=? AND ai=?',chat,human,role);
    const blocked=!!pause||pref?.enabled===0;
    return {...base,available,blocked,defaultEnabled:pref?Boolean(pref.enabled):null,defaultRevision:pref?.revision??null,
      pauseRevision:pause?.revision??null,inherited:!localGrant&&pref?.enabled===1,
      allowed:available&&!blocked&&(localGrant||pref?.enabled===1)};
  }
  function grantScope(chat,human,role,voice){
    store.run(`INSERT INTO ai_voice_scopes VALUES(?,?,?,?,?,NULL)
      ON CONFLICT(chat,human,ai) DO UPDATE SET backend=excluded.backend,revision=excluded.revision`,
    chat,human,role,backend(voice),randomUUID());
  }
  function allowFromMessage(chat,human,role,saved,remember){
    if(remember){
      if(saved.defaultEnabled!==true)setDefault(human,true);
    }else if(!saved.allowed)grantScope(chat,human,role,saved.voice);
  }
  function view(chat,human,eligible){
    return {voices,roles:engine?eligible.map(role=>({...role,...selection(chat,human,role.number,role.voiceOwner)})):[]};
  }
  function ownerView(human,role){
    const available=voices.filter(isAzureVoice);
    const saved=role&&preference(human,role.number);
    return {voices:available,roles:available.length&&role?[{...role,voice:saved?.voice??null,revision:saved?.revision??null}]:[]};
  }
  function savePreference(human,role,voice){
    store.run(`INSERT INTO ai_voice_preferences VALUES(?,?,?,?)
      ON CONFLICT(human,ai) DO UPDATE SET voice=excluded.voice,revision=excluded.revision`,
    human,role,voice,randomUUID());
    store.run('UPDATE ai_voice_scopes SET legacy_voice=NULL WHERE human=? AND ai=?',human,role);
  }
  function chooseOwner(human,role,body){
    const saved=ownerView(human,role).roles[0];
    if(!saved||saved.number!==body.number||body.expectedAccount!==human)
      fail(403,'ai_voice_scope','请在当前账号为自己的 AI 选音色');
    if(saved.revision!==body.revision)fail(409,'ai_voice_changed','音色设置已改变，请重新打开');
    if(body.voice!==null&&!isAzureVoice(descriptor(body.voice)))fail(400,'ai_voice_choice','请选择可用的 Azure 音色');
    savePreference(human,role.number,body.voice);
    return ownerView(human,role);
  }
  function choose(chat,human,eligible,body){
    const role=eligible.find(role=>role.number===body.number);
    if(!engine||!role||body.expectedAccount!==human)fail(403,'ai_voice_scope','请先在本会话同意这位角色的 AI 聊天');
    const saved=selection(chat,human,role.number,role.voiceOwner);
    if(saved.revision!==body.revision)fail(409,'ai_voice_changed','音色设置已改变，请重新打开');
    if(body.action==='personal-default'){
      if(!role.voiceOwner||typeof body.allowed!=='boolean'||saved.defaultRevision!==body.defaultRevision||
        body.allowed&&!saved.available)fail(409,'ai_voice_changed','Azure 语音设置已改变，请重新打开');
      setDefault(human,body.allowed);
    }else if(body.action==='scope'){
      if(saved.scopeRevision!==body.scopeRevision)fail(409,'ai_voice_changed','会话语音设置已改变，请重新打开');
      if(role.voiceOwner&&(saved.defaultRevision!==(body.defaultRevision??null)||saved.pauseRevision!==(body.pauseRevision??null)))
        fail(409,'ai_voice_changed','会话语音设置已改变，请重新打开');
      if(body.allowed===false){
        store.run('DELETE FROM ai_voice_scopes WHERE chat=? AND human=? AND ai=?',chat,human,role.number);
        if(role.voiceOwner){
          store.run(`DELETE FROM personal_voice_offers WHERE EXISTS(
            SELECT 1 FROM messages m JOIN message_mentions target ON target.message=m.id
            WHERE m.id=personal_voice_offers.prompt AND m.chat=? AND m.sender=? AND target.account=?)`,chat,human,role.number);
          store.run(`INSERT INTO personal_voice_pauses VALUES(?,?,?,?)
            ON CONFLICT(chat,human,ai) DO UPDATE SET revision=excluded.revision`,chat,human,role.number,randomUUID());
        }
      }
      else if(body.allowed===true&&descriptor(saved.voice)&&(!role.voiceOwner||saved.available)){
        if(role.voiceOwner)store.run('DELETE FROM personal_voice_pauses WHERE chat=? AND human=? AND ai=?',chat,human,role.number);
        grantScope(chat,human,role.number,saved.voice);
      }else fail(400,'ai_voice_choice','请先保存一个音色');
    }else{
      if(role.voiceOwner)fail(403,'ai_voice_owner','请由 AI 主人在「我的 AI」选择群 AI 音色');
      if(body.voice!==null&&!descriptor(body.voice))fail(400,'ai_voice_choice','这个音色暂时不可用');
      savePreference(human,role.number,body.voice);
    }
    return view(chat,human,eligible);
  }
  async function preview(eligible,account,body,ownerSettings=false){
    const role=eligible.find(role=>role.number===body.number);
    if(!engine||body.expectedAccount!==account||!role)
      fail(403,'ai_voice_scope','请先在本会话同意这位角色的 AI 聊天');
    if(!descriptor(body.voice))fail(400,'ai_voice_choice','这个音色暂时不可用');
    if(role.voiceOwner&&(!isAzureVoice(descriptor(body.voice))||
      !ownerSettings&&preference(role.voiceOwner,role.number)?.voice!==body.voice))
      fail(403,'ai_voice_owner','只能试听这位主人已选的 Azure 音色');
    if(!previews.has(body.voice)){
      previews.set(body.voice,engine.render(previewLine,body.voice).then(bytes=>{
        validateVoice(bytes);
        return bytes;
      }).catch(error=>{previews.delete(body.voice);throw error;}));
    }
    try{return await previews.get(body.voice);}
    catch{fail(503,'ai_voice_preview','音色暂时无法试听，请稍后再试');}
  }
  function voiceCurrent(chat,human,role,saved,voiceOwner){
    if(!saved?.allowed)return false;
    const now=selection(chat,human,role,voiceOwner);
    return now.allowed&&now.revision===saved.revision&&now.scopeRevision===saved.scopeRevision&&
      now.defaultRevision===saved.defaultRevision&&now.pauseRevision===saved.pauseRevision;
  }
  async function reply({bot,chat,human,input,signal,localOnly,canShareSpeech,assertCurrent,publicSearch,automaticPublic,personal},generate){
    if(localOnly)return composeAiReply(bot,input,generate,{localOnly:true});
    const role=personal?.role??bot.number;
    const saved=personal?personal.saved:engine&&character.has(role)&&selection(chat,human,bot.number);
    const voiceSignal=personal?.signal??signal;
    const current=()=>!voiceSignal?.aborted&&voiceCurrent(chat,human,bot.number,saved,personal?.owner);
    const selected=current();
    const {media,explicit}=speechRequest(role,bot.displayName,input);
    const canSpeak=!personal?.textOnly&&speechAllowed(input);
    if(personal&&explicit&&canSpeak&&!selected){
      return {text:!voices.some(isAzureVoice)?'这里暂时没有可用的云语音。':
        !saved?.available?'请我的主人先在「我的 AI」选个群聊音色。':
          saved.blocked?'你已暂停语音，可以在「AI 音色」恢复。':'我的音色已选好。请在「AI 音色」允许本群语音。'};
    }
    if(bot.number===AI_JU_NUMBER&&explicit&&canSpeak&&!selected){
      return {text:!engine?'这里暂时不能合成语音。':
        !saved.voice||!descriptor(saved.voice)?'先在「AI 音色」给我选个声音，再允许这次会话使用，我就能发语音。':
          '我的音色已经选好了。在「AI 音色」允许本会话使用，我就能发语音。'};
    }
    const voiceAvailable=selected&&canSpeak&&(!saved?.inherited||explicit);
    const exact=explicit&&media?.line&&voiceAvailable;
    const draft=exact?{text:media.line}:personal?{text:await generate()}:
      await composeAiReply(bot,input,generate,{voiceAvailable,voiceConfigured:!!engine,voiceRequested:explicit,
        publicSearch,automaticPublic,signal,assertCurrent});
    if(!draft.text||draft.capability||!voiceAvailable||!canShareSpeech(draft.text)||(!explicit&&[...draft.text].length<80)||
       visualLayout.test(draft.text)||needsWrittenReply(input,draft.text.replace(/[\r\n]+/gu,' ')))return draft;
    const fallback=note=>explicit?{text:draft.text+'\n\n（'+note+'，保留完整文字。）'}:draft;
    if(!current())return draft;
    if([...draft.text].length>MAX_AI_CHARS)return fallback('这段回复超过语音长度上限');
    assertCurrent();
    try{
      const bytes=await engine.render(draft.text,saved.voice,voiceSignal);
      if(!current())return draft;
      const {durationMs}=validateAiVoice(bytes);
      return {text:draft.text,voice:{bytes,durationMs,digest:createHash('sha256').update(bytes).digest('hex')}};
    }catch(error){
      if(!current())return draft;
      return fallback(error.code==='speech_too_long'?'这段回复超过语音时长上限':'这次语音暂时无法生成');
    }
  }
  return {view,choose,ownerView,chooseOwner,preview,selection,allowFromMessage,voiceCurrent,reply};
}

module.exports={createAiVoice,speechRequest,speechAllowed};
