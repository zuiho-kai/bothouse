'use strict';

const {createHash}=require('node:crypto');
const {boundedResponse,commonsCandidate}=require('../../src/bot/qq-public-lookup.cjs');
const {dimensions}=require('../../src/core/static-image.cjs');

const release='17.0.0';
const root=`https://raw.githubusercontent.com/hfg-gmuend/openmoji/${release}/`;
const licenseUrl='https://creativecommons.org/licenses/by-sa/4.0/';
const headers={'User-Agent':'AgentArcade/0.4 (https://github.com/Ray0766/agent-arcade)'};
let catalog;

// Match whole, public reaction phrases, never derive a network query from
// names, chat context or model output. Asset IDs come from the remote index.
const reactions=[
  [/^(?:撒花(?:庆祝)?|庆祝(?:撒花)?|礼花)$/u,'party popper','撒花庆祝','celebrate'],
  [/^(?:鼓掌(?:叫好)?|拍手(?:叫好)?|掌声)$/u,'clapping hands','鼓掌叫好','applause'],
  [/^(?:点赞|赞同|竖大拇指)$/u,'thumbs up','竖拇指赞同','agree'],
  [/^(?:捂脸|扶额)$/u,'person facepalming','捂脸','facepalm'],
  [/^(?:笑哭|笑到流泪)$/u,'face with tears of joy','笑到流泪','laugh'],
  [/^(?:加油|打气|秀肌肉)$/u,'flexed biceps','给你加油','encourage'],
  [/^(?:握手|握手言和)$/u,'handshake','握手','handshake'],
];
const subjects=[
  [/^(?:小动物|小猫咪?|小猫|猫咪|猫猫|猫)/u,'cat',/\b(?:cat|kitten)s?\b/iu,'小猫'],
  [/^(?:小狗|狗狗|狗)/u,'dog',/\b(?:dog|puppy|bulldog)s?\b/iu,'狗狗'],
  [/^(?:小松鼠|松鼠)/u,'squirrel',/\bsquirrels?\b/iu,'松鼠'],
  [/^(?:小兔子|小兔|兔子)/u,'rabbit',/\b(?:rabbit|bunny|hare)s?\b/iu,'小兔子'],
];
const actions=[
  [/^(?:(?:躲起来|藏起来|偷偷)?(?:偷看|探头|探出头|往外看)(?:的样子)?)$/u,'peeking',/\b(?:peek(?:s|ing)?|peek[ -]?a[ -]?boo|peep(?:s|ing)?)\b/iu,'探头偷看'],
  [/^(?:好奇地)?歪(?:着)?(?:脑袋|头)(?:(?:一脸)?(?:疑惑|疑问|不解)|看着你)?$/u,'head tilt',/\b(?:head tilt(?:s|ed|ing)?|tilt(?:s|ed|ing)? (?:its |the |her |his )?head)\b/iu,'歪头疑惑'],
  [/^(?:吐|伸出)(?:着)?舌头$/u,'sticking out tongue',/\b(?:sticking (?:its |the )?tongue out|sticking out (?:its |the )?tongue|tongue (?:sticking )?out)\b/iu,'吐舌头'],
];
const media=/(?:表情(?:包|图)?|贴图|贴纸|反应图|梗图|动图|图片|照片|\bmeme\b|\bstickers?\b|\b(?:reaction )?images?\b)/iu;
const network=/上网|网上|联网|网络上|在线|\bonline\b|\bweb\b/iu;
const lookup=/找|搜|检索|查|挑|整|搞|弄|淘|扒|\b(?:find|search|look up)\b/iu;
const lead=/^(?:(?:请|麻烦|可不可以|能不能|可以|能否|能|帮我|帮忙|给我|替我|我想(?:要|请)?|请你|你|去|在|上网|网上|联网|网络上|在线)\s*)*(?:找(?:一找)?|搜(?:索|一搜)?|检索|查找|挑(?:选)?|整|搞|弄|淘|扒)(?:一?[下个])?\s*/u;
const quoted=/「[^」]*」|『[^』]*』|“[^”]*”|‘[^’]*’|"[^"\n]*"/gu;
const reported=/^(?:转述|转发|引用|[他她]说|有人(?:说|问)|刚才有人(?:说|问)|.{1,12}(?:说过|跟我说|发来))\s*[：:,，]?/u;
const calledOff=/(?:算了|作罢|取消|撤回|先等等|先不找|不搜了|不找了|晚点再|稍后再|先放一放|暂时不|不用找|不要找|别找|别搜|\bcancel\b|\bnever mind\b)/iu;
const captioned=/(?:带字|带(?:上|点|有)?(?:一行|几个)?字|配字|配(?:上|个)?(?:文案|字幕)|写(?:着|上|有)|印(?:着|有)|字样|字幕|台词|文案|梗文字|caption|\bwords\b)/iu;
const privateData=/(?:\d{5}|密语|暗号|密码|密钥|凭据|令牌|验证码|口令|门禁|身份证|手机号|电话号码|群号|私聊|本群|住址|同事|同学|相册|通讯录|我的|我们的|你们的|我家的|刚发的|聊天截图|\b(?:pin|otp|secret|password|token|api[ _-]?key)\b|https?:|file:|[\w.+-]+@[\w.-]+\.[a-z]{2,}|[A-Z]:[\\/])/iu;
const safeForPublicReaction=input=>!privateData.test(input.normalize('NFKC'));
const localReactionReply='这条消息可能含私人信息，我会保留在本地。找图可以只说公开的主题或动作。';
const noNetwork=/(?:别|不要|不用|先别|不必|禁止|拒绝)(?:再|去|帮我|给我|让你)?\s*(?:上网|搜|查|找|在线|联网)|(?:只|仅)(?:在|用)?本地|保持离线|\b(?:do not|don't|no)\s+(?:browse|search|network)\b/iu;

function themeFor([,actor,actorMatch,subjectLabel],[,action,actionMatch,actionLabel]){
  return {actor,actorMatch,action,actionMatch,label:subjectLabel+actionLabel};
}

const choices=new Map(reactions.map(reaction=>[reaction[3],{reaction}]));
const peeking=/探(?:出)?(?:头|脑袋)|露(?:出)?(?:头|脑袋)|偷看|偷偷看/u;
choices.set('squirrel-peeking',{theme:themeFor(subjects[2],actions[0]),actorCue:/松鼠/u,actionCue:peeking});
choices.set('cat-peeking',{theme:themeFor(subjects[0],actions[0]),actorCue:/猫/u,actionCue:peeking});
choices.set('dog-head-tilt',{theme:themeFor(subjects[1],actions[1]),actorCue:/狗/u,actionCue:/歪(?:着)?(?:脑袋|头)/u});

function eligibleChoice(input,choice){
  if(!choice.theme)return true;
  const {actorCue,actionCue}=choice;
  return input.replace(quoted,' ').split(/[。；;！!？?\n]/u).some(part=>actorCue.test(part)&&actionCue.test(part)&&
    !/(?:没(?:有)?|并不|不是|不曾|并未|没在|旁边|一旁)/u.test(part));
}

function publicReactionOptions(input){
  const text=input.normalize('NFKC');
  if(!safeForPublicReaction(text)||noNetwork.test(text)||calledOff.test(text)||text.toLowerCase().includes('[[public-reaction:'))return '';
  return [...choices].filter(([,choice])=>eligibleChoice(text,choice)).map(([code,choice])=>
    `[[public-reaction:${code}]]（${choice.reaction?.[2]||choice.theme.label}）`).join('、');
}

function publicReactionChoice(value,input){
  const code=/^\[\[public-reaction:([a-z-]+)\]\]$/u.exec(value)?.[1];
  const choice=choices.get(code);
  return choice&&eligibleChoice(input,choice)?choice:null;
}

function publicReactionIntent(input){
  if(typeof input!=='string')return null;
  const body=input.normalize('NFKC').trim();
  const spoken=body.replace(quoted,' ');
  const goingOnline=network.test(spoken);
  const action=lead.exec(body);
  if(privateReactionRequest(body))return {private:true};
  if(!media.test(spoken)||!lookup.test(spoken)&&!action||reported.test(spoken))return null;
  if(calledOff.test(spoken)||noNetwork.test(spoken))return {cancelled:true};
  if(captioned.test(spoken)||body!==spoken)return {needsImageText:true};
  // Catch broader search language before selecting any bundled sticker or
  // handing the request to the ordinary chat provider.
  if(!action)return goingOnline?{}:null;
  if(input.length>650)return {};
  const target=body.slice(action[0].length).trim().replace(/^(?:一?[张个款]|一份)\s*(?:公开的)?/u,'');
  const topic=/^(.*?)的?(?:表情(?:包|图)?|贴图|贴纸|反应图|梗图)(?:给我|发给我)?(?:看(?:看|一下|一眼)?)?(?:可以吗|好吗|吗|吧|呗)?[。！？!?\s]*$/u.exec(target)?.[1]?.trim();
  for(const subject of subjects){
    const name=topic?.match(subject[0])?.[0];
    if(!name)continue;
    const action=actions.find(([clause])=>clause.test(topic.slice(name.length).trim()));
    if(action)return {theme:themeFor(subject,action)};
  }
  return {reaction:reactions.find(([match])=>topic&&match.test(topic))??null};
}

function privateReactionRequest(text){
  const body=text.normalize('NFKC');
  return privateData.test(body)&&media.test(body)&&(lookup.test(body)||network.test(body));
}

async function loadCatalog(){
  if(!catalog)catalog=(async()=>{
    const bytes=await boundedResponse(globalThis.fetch,root+'data/openmoji.json',
      {headers,signal:AbortSignal.timeout(6500)},3*1024*1024,'text/plain');
    const rows=JSON.parse(bytes.toString('utf8'));
    if(!Array.isArray(rows))throw Error('Invalid public reaction catalogue');
    return rows.filter(row=>/^[0-9A-F]{4,6}$/u.test(row?.hexcode)&&typeof row.annotation==='string');
  })().catch(error=>{catalog=undefined;throw error;});
  return catalog;
}

function attribution(source){
  if(!source||typeof source!=='object')return null;
  const {author,title,license,url,licenseUrl}=source;
  if(![author,title,license,url,licenseUrl].every(value=>typeof value==='string'&&value&&value.length<321))return null;
  if(!/^https:\/\/(?:commons\.wikimedia\.org\/wiki\/Special:Redirect\/page\/[1-9]\d{0,12}|github\.com\/hfg-gmuend\/openmoji\/blob\/\d{1,3}\.\d{1,3}\.\d{1,3}\/color\/618x618\/[0-9A-F]{4,6}\.png)$/u.test(url)||
     !/^https:\/\/creativecommons\.org\/(?:licenses\/by(?:-sa)?\/(?:2\.0|2\.5|3\.0|4\.0)|publicdomain\/zero\/1\.0)\/?$/u.test(licenseUrl))return null;
  return {author,title,license,url,licenseUrl};
}

async function themedReaction(theme,{signal,assertCurrent}){
  const {actor,action,actorMatch,actionMatch,label}=theme;
  const target=new URL('https://commons.wikimedia.org/w/api.php');
  target.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',generator:'search',gsrnamespace:'6',
    gsrsearch:actor+' '+action,gsrlimit:'12',prop:'imageinfo',iiprop:'url|size|mime|extmetadata',
    iiextmetadatafilter:'LicenseShortName|LicenseUrl|Artist|ImageDescription|Restrictions'});
  const active=AbortSignal.any([signal,AbortSignal.timeout(6500)]);
  const options={headers,signal:active};
  const response=await boundedResponse(globalThis.fetch,target.href,options,320*1024,'application/json');
  const index=JSON.parse(response.toString('utf8'));
  if(index?.error||index?.errors)throw Error('Public image search is unavailable');
  const pages=index?.query?.pages;
  if(pages===undefined&&index?.batchcomplete===true)return null;
  if(!Array.isArray(pages))throw Error('Invalid public image search response');
  const otherAnimals=subjects.filter(([,subject])=>subject!==actor).map(([, ,match])=>match);
  const ambiguous=/\b(?:not|never|without|caption|poster|people|man|woman|child|person|next to|beside|alongside|watching|looks at|with another)\b/iu;
  const related=new RegExp(`${actorMatch.source}\\s+(?:(?:is|was|now|shown|quietly|curiously)\\s+){0,3}${actionMatch.source}|${actionMatch.source}\\s+(?:(?:a|an|the|little|young|red)\\s+){0,3}${actorMatch.source}`,'iu');
  const bodyLanguage=new RegExp(`^${actorMatch.source} body language(?:[ :\\-]+[a-z]+){0,3}[ :\\-]+${actionMatch.source}`,'iu');
  const conflicting=part=>otherAnimals.some(match=>match.test(part))||ambiguous.test(part);
  // A second subject in the title defeats even a promising description.
  // Exact actor–action relations are evidence. Separate mentions are not.
  const match=part=>!conflicting(part)&&(related.test(part)||bodyLanguage.test(part));
  const evidence=(title,description)=>conflicting(title)?0:match(title)?2:description.split(/[.!?;]/u).some(match)?1:0;
  const candidates=pages.slice(0,12).flatMap(page=>{
    let rank=0;
    const item=commonsCandidate(page,(title,description)=>(rank=evidence(title,description))>0,{reactionOnly:false});
    return item?[{item,rank,index:page.index??12}]:[];
  }).sort((a,b)=>b.rank-a.rank||a.index-b.index);
  let failure;
  for(const {item} of candidates.slice(0,2)){
    assertCurrent();
    try{
      const bytes=await boundedResponse(globalThis.fetch,item.url,options,item.size,item.mime);
      active.throwIfAborted();
      if(bytes.length!==item.size)throw Error('Public image does not match its indexed size');
      const shape=dimensions(bytes,item.extension);
      assertCurrent();
      return {label,source:item.source,mime:item.mime,bytes,...shape,digest:createHash('sha256').update(bytes).digest('hex')};
    }catch(error){active.throwIfAborted();assertCurrent();failure=error;}
  }
  if(failure)throw failure;
  return null;
}

async function findPublicReaction({reaction,theme},{signal,assertCurrent}){
  assertCurrent();
  if(theme)return themedReaction(theme,{signal,assertCurrent});
  if(!reaction)return null;
  const [,topic,label]=reaction;
  const rows=await loadCatalog();
  signal.throwIfAborted();
  assertCurrent();
  const entry=rows.find(row=>row.annotation.toLowerCase()===topic);
  if(!entry)return null;
  const bytes=await boundedResponse(globalThis.fetch,root+`color/618x618/${entry.hexcode}.png`,
    {headers,signal:AbortSignal.any([signal,AbortSignal.timeout(6500)])},256*1024,'image/png');
  signal.throwIfAborted();
  assertCurrent();
  const shape=dimensions(bytes,'.png');
  if(shape.width!==618||shape.height!==618)throw Error('Unexpected public reaction dimensions');
  const source={author:'OpenMoji',title:topic,license:'CC BY-SA 4.0',licenseUrl,
    url:`https://github.com/hfg-gmuend/openmoji/blob/${release}/color/618x618/${entry.hexcode}.png`};
  return {label,source,digest:createHash('sha256').update(bytes).digest('hex'),
    mime:'image/png',bytes,...shape};
}

module.exports={attribution,findPublicReaction,publicReactionIntent,publicReactionChoice,publicReactionOptions,safeForPublicReaction,
  privateReactionRequest,localReactionReply};
