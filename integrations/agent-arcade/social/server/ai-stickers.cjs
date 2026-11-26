'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {string}=require('./store.cjs');
const {AI_NUMBER,AI_DRAGON_NUMBER,AI_JU_NUMBER}=require('./ai-roles.cjs');
const {dimensions}=require('../../src/core/static-image.cjs');
const {stickerChoice,stickerOptions}=require('../../src/core/sticker-reply.cjs');
const {allowsStickerReply}=require('../../src/bot/companion-reply-preference.cjs');
const {addressedMediaText,explicitStickerRequest,groupMediaCapabilityQuestion,groupMediaRequest}=require('../../src/bot/group-media-request.cjs');
const {findPublicReaction,publicReactionIntent,publicReactionChoice,publicReactionOptions,safeForPublicReaction,localReactionReply}=require('./public-reactions.cjs');

const roles=new Map([
  [AI_NUMBER,{id:'deepseek-whale',art:'whale'}],
  [AI_DRAGON_NUMBER,{id:'codex-dragon',art:'dragon'}],
  [AI_JU_NUMBER,{id:'claude-ju',art:'ju',moods:['happy','approve','annoyed']}],
]);
const labels={happy:'开心地笑',approve:'表示赞同',surprised:'惊讶',annoyed:'有点不满'};
const defaultMoods=['happy','approve','surprised'];
const catalog=new Map();
const root=path.join(__dirname,'../assets/stickers');
const unavailable='这次没找到合适的表情图。';
const internalSticker=/`?\[\[\s*(?:sticker|public-reaction)\s*:[^\]\r\n]*\]\]`?/giu;
// A reaction is optional for social turns. Clear questions or sensitive turns
// need words even if a provider tries to return a reaction code.
const writtenTurn=/[?？]|(?:为什么|怎么办|怎么做|如何|请解释|求助|急救|自杀|自残|去世|丧亲|家暴|重伤|确诊|帮我画|语音回复|文件.{0,8}覆盖|资料丢失|数据丢失)|\b(?:suicid\w*|bereave\w*|emergency)\b/iu;
const drawingTurn=/^(?:请|麻烦)?(?:帮我|给我)?(?:画|绘制|生成)(?:一?[张幅个]|图)/u;
const offlineGuide='这里能用角色自带的贴图或有署名的公开表情图，无法浏览任意网页或绘图。';

function picture(role,mood,name){
  if(!(role.moods??defaultMoods).includes(mood))return null;
  const key=`${role.art}-${mood}`;
  try{
    if(!catalog.has(key)){
      const bytes=fs.readFileSync(path.join(root,key+'.png'));
      if(bytes.length>256*1024)throw Error('Sticker size exceeds the bundled limit');
      catalog.set(key,{bytes,mime:'image/png',...dimensions(bytes,'.png'),
        digest:createHash('sha256').update(bytes).digest('hex')});
    }
    return {image:{...catalog.get(key),label:`${name} · ${labels[mood]}`}};
  }catch{return null;}
}

async function sendPublicReaction(choice,{signal,assertCurrent}){
  try{
    const image=await findPublicReaction(choice,{signal,assertCurrent});
    return image?{image}:{capability:true,text:'这次没找到符合你描述的公开表情图。'};
  }catch{
    signal.throwIfAborted();
    assertCurrent();
    return {capability:true,text:'这次没能从公开图源取到表情图。'};
  }
}

async function composeAiReply(bot,input,generate,{publicSearch=false,automaticPublic=false,localOnly=false,
  voiceAvailable=false,voiceConfigured=false,voiceRequested=false,signal,assertCurrent}={}){
  if(localOnly)return {text:localReactionReply};
  const role=roles.get(bot.number);
  const capability=role&&groupMediaCapabilityQuestion(input,role.id,bot.displayName);
  if(capability==='sticker-send')return {text:'会呀，合适的时候我会挑一张表情图。'};
  if(capability==='sticker'){
    return {text:/(?:联网|上网|网上)/u.test(input)?'明确告诉我想找的表情，我可以在公开目录里找常见反应图。':'会呀，我可以按语境挑一张自带的表情图。'};
  }
  if(capability==='voice')return {capability:true,text:voiceAvailable?'会呀，你要听的话我可以用选好的音色回复。':
    voiceConfigured?'你可以在这个会话试听并选一个音色，再让我发语音。':'我在这里还不能发语音。'};

  const mediaAllowed=!!role&&!voiceRequested&&allowsStickerReply(input);
  const online=role&&publicReactionIntent(addressedMediaText(input,role.id,bot.displayName));
  if(online){
    if(online.private)return {capability:true,text:localReactionReply};
    if(online.cancelled)return {capability:true,text:'好，这次不找图。'};
    if(!mediaAllowed)return {capability:true,text:'好，这次只用文字。'};
    if(online.needsImageText)return {capability:true,text:'我无法核对图上有没有你要的字，这次没找到合适的梗图。'};
    if(!publicSearch)return {capability:true,text:'在群里点名我后，可以请我找公开表情图。'};
    return sendPublicReaction(online,{signal,assertCurrent});
  }
  const media=mediaAllowed&&groupMediaRequest(input,role.id,bot.displayName,false,undefined,false,undefined,true);
  const intent=media?.stickerIntent;
  if(intent&&intent.category!=='any')return picture(role,intent.category,bot.displayName)||{text:unavailable};
  const mayUseSticker=mediaAllowed&&(intent?.category==='any'||!media&&!writtenTurn.test(input)&&!drawingTurn.test(input));
  const publicOptions=automaticPublic&&mayUseSticker&&!media&&publicReactionOptions(input);
  const publicHint=publicOptions?' 群友在分享轻松的内容时，也可从这些公开图意中选一个：'+publicOptions+
    '。只有一张图足够表达当前回应时才选。选动物动作需要对方刚说到相同主体和动作。只能返回一个代码，不加文字，不把原话或人名当作搜索词。':'';
  const speechGuide=voiceAvailable?' 可以把合适的回复用选定音色朗读。':
    voiceConfigured?' 尚未使用会话音色，这轮可正常用文字回复。':' 这里暂不支持语音。';
  const spoken=voiceRequested&&voiceAvailable;
  const hint=offlineGuide+speechGuide+(spoken?' 对方要语音，只写当轮适合朗读的台词。短话一句就好；要解释时说完整，保留关键事实、条件和否定。':'')+(mayUseSticker ?
    ' 如果一张反应图就能传达这轮的问候、认同或情绪，可只返回一个代码：'+stickerOptions(role.moods??defaultMoods)+
    '。涉及事实、求助、建议、严重情况或需要解释时用简短文字。'+
    (intent?.category==='any'?' 对方要一张贴图。如果没有明显情绪，选开心。':'') : spoken?'':' 这轮请用文字回答。')+publicHint;
  const text=string(await generate(hint),4000,'AI 回复');
  const publicChoice=publicOptions&&publicReactionChoice(text.trim(),input);
  if(publicChoice)return sendPublicReaction(publicChoice,{signal,assertCurrent});
  const mood=stickerChoice(text);
  if(mayUseSticker&&mood)return picture(role,mood,bot.displayName)||{text:unavailable};
  const written=text.replace(internalSticker,'').trim();
  if(written!==text&&!/[\p{L}\p{N}\p{S}]/u.test(written))throw Error('AI did not return a valid reply for this turn');
  if(intent?.category==='any')return picture(role,'happy',bot.displayName)||{text:unavailable};
  return {text:written};
}

// Personal AIs have no approved sticker catalogue of their own. Share only
// known public icons, with attribution, instead of borrowing a built-in role's art.
const personalReactions=new Map([
  ['happy',['grinning face with smiling eyes','开心地笑']],
  ['smirk',['smirking face','冷笑']],
  ['annoyed',['face with rolling eyes','翻白眼']],
  ['surprised',['face with open mouth','惊讶']],
  ['sad',['crying face','难过']],
  ['confused',['thinking face','疑惑']],
  ['approve',['thumbs up','竖拇指赞同']],
]);
const smirk=/冷笑|坏笑|似笑非笑|假笑/u;
const personalContextMoods=[
  [smirk,'smirk'],
  [/难过|伤心|委屈|想哭/u,'sad'],
  [/震惊|惊讶|吓一跳/u,'surprised'],
  [/无语|嫌弃|翻白眼|不爽/u,'annoyed'],
  [/困惑|搞不懂|没弄明白/u,'confused'],
  [/同意|没问题|做得好/u,'approve'],
  [/开心|高兴|太棒了|太好了/u,'happy'],
];

async function personalStickerReply(bot,input,previous,{signal,assertCurrent,localOnly}){
  if(!allowsStickerReply(input))return null;
  const intent=explicitStickerRequest(input,bot.displayName);
  if(!intent)return null;
  if(localOnly||!safeForPublicReaction(input))return {text:localReactionReply};
  if(intent.own)return {text:'目前没有可用的角色专属表情。你可以请我发一张通用表情，或让我重发这段私聊里已有的画作。'};
  let mood=intent.category;
  if(mood==='any') {
    // Only the preceding user turn can influence a generic ask. No part of
    // that turn is sent to OpenMoji.
    const text=safeForPublicReaction(previous)?previous.replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"/gu,''):'';
    mood=personalContextMoods.find(([pattern])=>pattern.test(text))?.[1]??'happy';
  }else if(!mood&&/^(?:冷笑|坏笑|似笑非笑|假笑)$/u.test(intent.name??'')){
    mood='smirk';
  }
  const reaction=personalReactions.get(mood);
  if(!reaction)return {text:unavailable};
  return sendPublicReaction({reaction:[null,...reaction]},{signal,assertCurrent});
}

module.exports={composeAiReply,personalStickerReply};
