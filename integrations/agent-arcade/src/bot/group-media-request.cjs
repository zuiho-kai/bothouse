'use strict';
const {publicCatalog}=require('../core/personas.cjs');
const {publicStickerDescription}=require('./qq-public-lookup.cjs');
const builtInRoles=new Set(publicCatalog().map(role=>role.id));

// Recognise requests for one of the character's fixed assets. Free text never
// selects a file, an account, or a recipient. An explicitly requested line is
// just speech data; only the ordinary gate and local grant can admit delivery.
const roleStickers = new Map([
  ['claude-ju', {assetId:'ju-sticker', label:'表情包', history:'［橘娘表情包］', expression:'Ju closes her eyes with her hands against her cheek and two pink hearts'}],
  ['deepseek-whale', {assetId:'whale-sticker', label:'表情包', history:'［鲸鱼娘表情包］', expression:'Whale Girl smiles beside a blue “OK!” bubble'}],
]);
function namedStickerAsset(sticker, namedSticker) {
  return {...sticker,namedSticker,history:'［本群选定的角色表情］',expression:'the sticker selected for this group'};
}
function roleMedia(character, cardSpeech=false, namedSticker) {
  const imported=/^card-[0-9a-f]{16}$/u.test(character);
  let sticker=imported?{assetId:'card-sticker',label:'表情包',history:'［角色卡选定的表情包］',expression:'the sticker selected for this character card; its expression is unspecified'}:roleStickers.get(character);
  if(character==='codex-dragon')return {
    sticker:{assetId:'character-sticker',label:'表情图',history:'［表情图］'},
    voice:{assetId:'dragon-speech',label:'语音'}
  };
  if(!sticker)return builtInRoles.has(character)?{sticker:{assetId:'character-sticker',label:'表情图',history:'［表情图］'}}:null;
  if(namedSticker)sticker=namedStickerAsset(sticker,namedSticker);
  if (imported) return {
    sticker,
    portrait:{assetId:'card-portrait',label:'角色图片',history:'［角色卡立绘］'},
    voice:cardSpeech?{assetId:'card-speech',label:'语音'}:{assetId:'card-recording',label:'固定语音',history:'［角色卡选定的群语音］'}
  };
  const whale=character==='deepseek-whale';
  return {sticker,portrait:whale?{assetId:'whale-portrait',label:'角色图片',history:'［鲸鱼娘立绘］'}:
    {assetId:'ju-portrait',label:'角色图片',history:'［橘娘立绘］'},
    voice:whale&&cardSpeech?{assetId:'whale-speech',label:'语音'}:whale?{assetId:'whale-recording',label:'固定语音',history:'［鲸鱼娘选定的群语音］'}:{assetId:'ju-serena',label:'语音'}};
}
// Parse the action, audience and object independently. A qualified picture
// request must never silently substitute the current role's artwork.
const visualAction = /^(?:(?:给|让)(?:我们|大家|大伙儿?|群友们?|群里|我)|我想(?=看|瞧|瞅))?(?:分享|展示|看一看|看一眼|看看|瞧瞧|瞅瞅|发来|发|晒|丢|扔|甩|来|贴|求)(?:一下)?(?<measure>一?[张幅个份])?/u;
const particles = /(?:可以吗|好不好|好[吗么]|[吧呀嘛呗吗呢啦啊])$/u;
const mediaNoun = /^(?<subject>[^，,。！？!?；;\n]{0,60}?)(?<noun>图片表情包|表情包|表情图|贴图|贴纸|角色立绘|角色图|角色照|立绘|图片|照片|相片|生活照|私人照|真人照|自拍照?|近照|合照|证件照|图)$/u;
const stickers = new Set(['图片表情包','表情包','表情图','贴图','贴纸']);
// The values are public categories. Never pass the original caption or a
// locally configured sticker name to a search provider.
const reactionAliases = new Map([
  ['happy', /^(?:开心|高兴|哈哈+|大笑|好笑|笑哭|笑死|笑出声|可爱|卖萌|比心|爱心|心心)$/u],
  ['annoyed', /^(?:无语|嫌弃|白眼|翻白眼|生气|不爽|不高兴)$/u],
  ['surprised', /^(?:震惊|吃惊|惊讶|惊呆|吓到|目瞪口呆)$/u],
  ['sad', /^(?:难过|委屈|伤心|哭|哭哭|泪目|大哭)$/u],
  ['confused', /^(?:疑惑|困惑|懵|懵圈|满脸问号|问号)$/u],
  ['approve', /^(?:同意|收到|点赞|赞|没问题|好的|好耶|ok)$/iu],
  ['cat', /^(?:猫|猫猫|小猫|猫咪)$/u],
  ['dog', /^(?:狗|狗狗|小狗|柴犬)$/u],
]);
function reactionCategory(text) {
  const label=text.trim().normalize('NFC').replace(/[\s！!～~]+$/u,'');
  return [...reactionAliases].find(([,pattern])=>pattern.test(label))?.[0];
}

function stickerIntent(body, distinguishOwn=false) {
  const request=/^(?:随便)?(?:帮我)?(?:(?:给(?:我|我们|大家|群里))?(?:发|来|贴|丢|甩)(?:一?[张个])?|(?<find>(?:上网|联网|网上)?(?:找|搜))(?:一下)?(?:一?[张个])?)\s*(?<label>[^，,。！？!?；;\n]{0,36}?)(?:的)?(?:表情包|图片表情|表情图|反应图|表情|贴图|贴纸)(?:(?:给(?:我|我们|大家|群里))?看(?:看|一看|一下|一眼)?)?$/u.exec(body.replace(particles,'').trim());
  if(!request) return null;
  const label=request.groups.label.trim();
  if(/^(?:你的?|自己(?:的)?|你自己(?:的)?)$/u.test(label))return distinguishOwn?{own:true}:{category:'any'};
  if(!label||/^(?:好玩|搞笑|有趣|随便)$/u.test(label))return {category:'any'};
  const category=reactionCategory(label)||reactionCategory(label.replace(/^[好很超](?=.)/u,''));
  if(category)return {category,name:label};
  const quote=quotes.get(label[0]);
  const name=quote&&label.endsWith(quote)?label.slice(1,-1).trim():label;
  if(!name||[...name].length>40||/[\p{Cc}\p{Cf}<>/\\:@「」『』“”"给]/u.test(name))return null;
  const description=!quote&&(request.groups.find||name.includes('的'))&&publicStickerDescription(name);
  return description?{name,description}:{name};
}

const portraits = new Set(['角色立绘','角色图','角色照','立绘','图片','照片','相片','图']);
const unavailablePicture = {restriction:'我只能发这个群为我选定的角色图或表情包，没有你指定的那张。'};
const currentGroupOnly = {restriction:'我只能把为这个群选好的素材发在这里。'};
function mediaRequestBody(text) {
  return text.replace(/^(?:请问)?(?:麻烦你?|请你?)?(?:你(?!的|自己))?(?:可不可以|能不能|能否|可以|能够|能|方便)?(?:请你?|帮忙)?/u,'').trim();
}
function genericGroupStickerRequest(text) {
  if(groupMediaCapabilityQuestion(text)==='sticker-send')return false;
  const body=mediaRequestBody(text.trim().replace(/[。！？!?？～~]+$/u,''));
  const action=visualAction.exec(body);
  return !!action&&/^(?:表情(?:包|图)?|贴图|贴纸)$/u.test(body.slice(action[0].length).replace(particles,'').trim());
}
function visualRequest(body, media) {
  // Normalize 把 + object + send only for this conversation. A destination in
  // the member's text can never override the bound OneBot group.
  const fronted = /^把(.{1,75}?)(?:发|晒|丢|贴|分享)(?=到|给|去|往|过来|出来|看|$)(.{0,40})$/u.exec(body.replace(particles,''));
  if (fronted) {
    if (!mediaNoun.test(fronted[1])) return null;
    const destination = fronted[2].replace(/(?:给(?:我们|大家|我))?(?:看一看|看看|看一下|看一眼|看)$/u,'');
    if (!/^(?:出来|过来|到(?:群里|本群|这个群里?|当前群)|给(?:大家|我们|我))?$/u.test(destination)) {
      return /^(?:到|给|去|往)(?!了|过).+/u.test(destination) ? currentGroupOnly : null;
    }
    body = '发一张' + fronted[1];
  }
  const action = visualAction.exec(body);
  let object = body.slice(action?.[0].length || 0).replace(particles,'').trim();
  object = object.replace(/(?:给(?:我们|大家|我|群里))?(?:看一看|看看|看下|看一眼|看)$/u,'')
    .replace(/(?:过来|出来|来|到群里|给(?:我们|大家|我|群里))$/u,'').trim();
  const match = mediaNoun.exec(object);
  if (!match) return null;
  const {subject,noun} = match.groups;
  if (/是不是|能不能|会不会|可不可以|支持|如果|要是|的话|不要|不用|别发|什么意思/u.test(subject)) return null;
  const fixedSticker = stickers.has(noun);
  if (!action && !fixedSticker) return null;
  if (!['','你的','自己的','你自己的'].includes(subject) || !(fixedSticker || portraits.has(noun))) {
    // A terminal 图 alone also occurs in 地图, 意图, etc. Only a syntactic
    // object (a measured photo/sticker, a possessive, or a photo type) can
    // establish a request for an unavailable item.
    if (!action || (subject && noun === '图' && !action.groups.measure && !subject.endsWith('的'))) return null;
    if (subject && !action.groups.measure && !/^(?:你的?|我的?|他的?|她的?|别人|朋友|[「『“"])/u.test(subject)) return null;
    return unavailablePicture;
  }
  return fixedSticker ? media.sticker : media.portrait;
}
const sendVoice = /^(?:给(?:我|我们|大家))?(?:发|来|录)(?:一?[条段个])?语音(?:消息)?/u;
const useVoice = /^用语音(?:消息)?/u;
const quotes = new Map([['「','」'],['『','』'],['“','”'],['‘','’'],['"','"']]);
// Compare only with the owner's selection for this exact group and role.
function namedStickerRequest(body, sticker, blockUnrelatedMedia, collection) {
  const text=body.replace(particles,'').trim();
  const fronted=/^把(.+?)(?:再)?(?:发送|发|贴)(?:一下|一次|一遍|出来|过来)?$/u.exec(text);
  const action=/^(?:给(?:大家|我们|群里|我))?(?:再)?(?:发送|发|贴|来|丢)(?:一下|一次|一遍|一?张|一?个)?\s*/u.exec(text);
  if(!action&&!fronted)return null;
  const candidates=collection ?? (sticker.namedSticker ? [sticker.namedSticker] : []);
  const find=value=>{
    const name=value.trim().normalize('NFC').toLowerCase();
    const chosen=candidates.find(item=>item.name.normalize('NFC').toLowerCase()===name);
    return chosen ? namedStickerAsset(sticker,chosen) : null;
  };
  if(action){
    const exact=find(body.slice(action[0].length));
    if(exact)return exact;
  }
  let object=(fronted?fronted[1]:text.slice(action[0].length)).trim();
  const suffix=/(?:的|[那这](?:一?[张个])?)?(?:表情包|表情图|表情|贴图|贴纸)$/u;
  const typed=suffix.test(object);
  const close=quotes.get(object[0]);
  if(close){
    const last=object.lastIndexOf(close);
    if(last<1)return null;
    const tail=object.slice(last+1).trim();
    if(tail&&tail.replace(suffix,'')!==''){
      return /(?:私聊|发给|转发|到.*群|给.+)/u.test(tail)?currentGroupOnly:null;
    }
    object=object.slice(1,last);
  }else object=object.replace(suffix,'');
  const chosen=find(object);
  if(chosen)return chosen;
  const qualifiedTitle=collection&&typed&&object&&!['你','你的','自己','自己的','你自己','你自己的'].includes(object);
  if(qualifiedTitle||close&&(typed||collection&&(fronted||action?.[0].includes('再'))))return {restriction:'本群没有选用这个名字的表情。'};
  // A request for other words can still get a text reply. Never offer a different picture for it.
  if(blockUnrelatedMedia&&(close||fronted||action?.[0].includes('再')))return {textOnly:true};
  return null;
}
const greetings = new Set(['晚安','早安','早上好','晚上好','大家好','你好','谢谢','辛苦了','生日快乐','新年快乐']);

function voiceRequest(body) {
  const prefix = sendVoice.exec(body) || useVoice.exec(body);
  if (!prefix) return null;
  const tail = body.slice(prefix[0].length).replace(/^[，,\s]+/u, '').replace(particles, '').trim()
    .replace(/^(?:帮我|(?:给|跟|对|向|和)(?:大家|我们|大伙儿?|群友们?|我))?(?:来)?/u,'');
  if (!tail) return sendVoice.test(body) ? {custom:false} : null;
  const words = /^(朗读|念|读|说|道|聊聊|回答)(一下|一?句话?|一?声|一遍|一段|这句话)?[：:\s]*/u.exec(tail);
  if (!words) return null;
  const verb = words[1], content = tail.slice(words[0].length).trim();
  if (!content) return null;
  const closing = quotes.get(content[0]);
  const line = closing ? content.slice(1,-1).trim() : content.trim();
  if ((closing && !content.endsWith(closing)) || !line || [...line].length > 300 ||
      /[“”‘’「」『』"<>/\\:@\p{Cc}\p{Cf}]/u.test(line)) return null;
  // A quoted line or an explicit reading is verbatim. Free-form requests
  // such as "发语音聊聊天气" still get the character's own generated answer.
  const reading = ['朗读','念','读'].includes(verb);
  if (!closing && /(?:然后|随后|并|再)(?:转发|转给|发给|私聊)/u.test(line)) return null;
  if (!closing && !reading && /[，,。！？!?；;]|什么意思|的话|会怎样|转发|转给|发给|私聊|给.{1,15}听$/u.test(line)) return null;
  const greeting = ['说','道'].includes(verb) && /^(?:一?声|一?句话?)$/u.test(words[2]) && greetings.has(line);
  const verbatim = closing || reading || greeting;
  return verbatim ? {custom:true, line} : {custom:true};
}

function addressedMediaText(text,character,name) {
  let addressed = text.trim().replace(/[。！？!?？～~]+$/u, '');
  if(name && addressed.startsWith(name) && /^[，,、：:\s]/u.test(addressed.slice(name.length))) {
    addressed=addressed.slice(name.length).replace(/^[，,、：:\s]+/u,'');
  }else if(character==='deepseek-whale')addressed=addressed.replace(/^(?:鲸鱼娘|鲸鱼)[，,、：:\s]+/u,'');
  else if(character==='claude-ju')addressed=addressed.replace(/^(?:橘娘|橘)[，,、：:\s]+/u,'');
  return addressed;
}
const capabilityQuestion=/^(?:请问)?你?(?:可以|能够|能)(?:发送?|录|分享)(图片|照片|语音(?:消息)?|表情(?:包|图)?|贴图|立绘)吗$/u;
const lookupCapabilityQuestion=/^(?:请问[，,\s]*)?你?\s*(能不能|可不可以|是否(?:可以|能)|可以|能够|能|会)\s*(?:在(?:这个群|本群)\s*)?(.+?)(吗|么)?$/u;
const webCapabilityAction=/^(?:(?:联网|上网|网上)(?:(?:搜索|搜|查找|查询|查|检索)(?:一下)?(?:公开)?(?:资料|信息|网页|网站)?)?|(?:搜索|搜|查找|查询|查|检索)(?:公开资料|(?:公开)?(?:网页|网站))|(?:直接)?(?:打开|浏览|阅读|读取|读|查看|看)(?:任意|任何|指定的|我发的)?(?:网页|网站|网页链接|网址|链接)(?:的?内容|阅读)?)$/u;
const stickerCapabilityAction=/^(?:按语境|自己|自动|网上|上网)(?:挑选|挑|找|搜|搜索)(?:合适的|可分享的|公开的)?(?:表情包|表情图|表情|贴图)$/u;
const stickerSendCapability=/^(?:发送?|分享)(?:图片表情包|表情(?:包|图)?|贴图|贴纸)$/u;
function groupMediaCapabilityQuestion(text,character,name='') {
  if(typeof text!=='string'||text.length>150)return null;
  const addressed=addressedMediaText(text,character,name);
  const noun=capabilityQuestion.exec(addressed)?.[1];
  if(noun?.startsWith('语音'))return 'voice';
  if(noun==='图片')return 'image';
  if(noun==='立绘')return 'portrait';
  if(noun?.startsWith('表情')||noun==='贴图')return 'sticker-send';
  const lookup=lookupCapabilityQuestion.exec(addressed);
  if(lookup){
    const [,modal,action,particle]=lookup;
    if(particle||/不|是否/u.test(modal)){
      if(webCapabilityAction.test(action))return 'web';
      if(stickerCapabilityAction.test(action))return 'sticker';
      if(stickerSendCapability.test(action))return 'sticker-send';
    }
  }
  return null;
}

function groupMediaRequest(text, character, name='', cardSpeech=false, namedSticker, blockUnrelatedMedia=false, collection, automatic=false) {
  if (typeof text !== 'string' || text.length > 650) return null;
  const media=roleMedia(character,cardSpeech,namedSticker);
  if(!media)return null;
  const addressed=addressedMediaText(text,character,name);
  if(capabilityQuestion.test(addressed)||groupMediaCapabilityQuestion(addressed)?.startsWith('sticker'))return null;
  const body = mediaRequestBody(addressed);
  const named=(namedSticker!==undefined||collection)&&namedStickerRequest(body,media.sticker,blockUnrelatedMedia,collection);
  if(named?.assetId||!automatic&&named)return named;
  if ((visualAction.test(body) || /^(?:转发|把|从|去|打开)/u.test(body)) && /(?:图|照片|立绘|表情包|语音|录音)/u.test(body)) {
    if (/(?:[A-Za-z]:[\\/]|\\\\|https?:\/\/|file:|\/(?:Users|home|tmp)\/|相册|图库|文件夹|磁盘)/iu.test(body)) {
      return {restriction:'我只能在这里分享为本群选好的素材，不能从指定路径或私人相册取文件。'};
    }
    if (/(?:另(?:外)?(?:一?个)?群|其他群|别的?群|私聊|转发给|(?:群号|发到群|发给群)\s*\d)/u.test(body)) {
      return currentGroupOnly;
    }
  }
  const intent=automatic&&stickerIntent(body);
  if(intent)return {...media.sticker,stickerIntent:intent};
  if(named)return named;
  if (!sendVoice.test(body) && !useVoice.test(body)) return visualRequest(body,media);
  const speech = voiceRequest(body);
  if (!speech||!media.voice) return null;
  if (media.voice.history) return {...media.voice,...(speech.custom ? {fixedOnly:true} : {})};
  return {...media.voice,...(speech.line ? {line:speech.line} : {})};
}

function explicitStickerRequest(text,name){
  if(typeof text!=='string'||text.length>650)return null;
  const addressed=addressedMediaText(text.normalize('NFKC'),undefined,name);
  if(groupMediaCapabilityQuestion(addressed))return null;
  return stickerIntent(mediaRequestBody(addressed),true);
}

module.exports = {groupMediaRequest, groupMediaCapabilityQuestion, genericGroupStickerRequest, roleMedia, namedStickerAsset,addressedMediaText,reactionCategory,explicitStickerRequest};
