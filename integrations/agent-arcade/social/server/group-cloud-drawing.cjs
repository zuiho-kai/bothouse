'use strict';

const {createHash,randomUUID}=require('node:crypto');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {classifyGroupDrawing}=require('../../src/bot/group-drawing-request.cjs');
const {requestCloudflareImage}=require('../../src/core/cloudflare-image-request.cjs');
const {verifiedPortrait}=require('../../src/core/group-drawing-portrait.cjs');
const {dimensions}=require('../../src/core/static-image.cjs');
const {modelContext}=require('./model-context.cjs');
const {fail,number}=require('./store.cjs');
const {AI_NUMBER,AI_DRAGON_NUMBER,AI_JU_NUMBER}=require('./ai-roles.cjs');
const {personaForBackend}=require('../../src/core/personas.cjs');

// These are shipped public role assets, independent of account and group images.
const builtInCharacters=new Map([
  [AI_JU_NUMBER,{avatar:'ju.png',visual:personaForBackend('claude-api').visual}],
  [AI_DRAGON_NUMBER,{avatar:'dragon.png',visual:personaForBackend('gpt').visual}],
  [AI_NUMBER,{avatar:'whale.png',visual:personaForBackend('deepseek').visual}],
]);

const bareResend=/^再发(?:送)?一次(?:[，,\s]*(?:原图|刚才画的(?:那张图)?))?[。！!\s]*$/u;
const recentDirectResend=/^把刚才那张(?:原图|图)?再发(?:送)?一次[。！!\s]*$/u;
const drawingVerb=/^(?:(?:请|现在|麻烦你?|你|帮我|给我|为我|替我)\s*)*(?:画|绘制|创作|生成)(?:一?[张幅个]|一张|几张|点|图)/u;
// A desired output (e.g. “你的头像”) is not a request to use prior image bytes.
const referenceCue=/(?:照着|参考|参照|临摹|仿照|沿用|跟着|按|基于|用)(?:\s*(?:刚才|之前|我|他|她|你|角色|本群|上面))?(?:发的|贴的|上传的|那张|这张|的)*(?:原图|照片|图片|参考图|这张图|头像|卡面|立绘|我的附件)|(?:我(?:刚才?|之前)?(?:发|上传|贴)的|这张图|那张图|角色卡面|参考图|刚上传的|私聊图片)/u;
// A reference can identify prior bytes by sender and upload action even
// when the request uses “以…为底稿” or another indirect construction.
const sharedVisual=/(?:(?:我们?|你们?|他|她|群友)\s*(?:刚刚?|刚才|才|先前|之前|前面|上次|已经)?|刚刚?|刚才|之前|前面|上次)(?:上传|发|传|贴|分享)(?:上来|过来|出来|过|给我|到群里)?(?:的)?\s*(?:[这那一]张|那份|这份)?(?:照片|合照|图片|截图|原图|附件|参考图|头像|立绘|卡面|图像)/u;
const imageBasis=/(?:以|拿|把|将)[^，,。；;！？!?\n]{0,36}(?:原图|照片|合照|截图|附件|图片|卡面|立绘|头像)[^，,。；;！？!?\n]{0,12}(?:作为|当作|为|当)\s*(?:底稿|参考|模板|样板|基础)/u;
// Only these phrases can select an existing role asset. They never identify a chat upload.
const roleReference=/(?:照着|参考|参照|临摹|仿照|按|基于|用)\s*(?:你(?:的|那张)?(?:公开|内置|默认)?(?:头像|卡面|立绘)|当前角色的(?:公开)?(?:头像|卡面|立绘)|本群(?:已经?批准的|获准的)?(?:角色)?卡面)/gu;
const otherPortraitReference=/(?:照着|参考|参照|临摹|仿照|沿用|按|基于|用)\s*(?:(?!画|绘制|创作|生成)[^，,。；;！？!?\n]){1,24}?(?:的)?(?:头像|卡面|立绘)/u;
const combinedReference=/(?:以及|加上|还有|混合|搭配|配上|和|与|及|、|\+)\s*(?:(?!画一|生成一|绘制一)[^，,。；;！？!?\n]){0,24}(?:头像|卡面|立绘|肖像|照片|相片|合照|图片|原图|附件|截图)/u;
const needsReference=text=>referenceCue.test(text)||sharedVisual.test(text)||imageBasis.test(text)||otherPortraitReference.test(text);
const privateCue=/(?:\d{5,}|密码|验证码|密钥|令牌|口令|身份证|手机号|住址|门禁|群号|聊天截图|聊天记录|通讯录|私人相册|私聊|\b(?:secret|password|token|api[ _-]?key)\b|https?:|file:|[\w.+-]+@[\w.-]+\.[a-z]{2,}|[A-Z]:[\\/])/iu;
const noImageReply='群聊照片和其他人的图片无法用作绘图参考。可指定当前角色的公开头像或本群已批准的卡面。';
const dayStart=started=>new Date(started).setUTCHours(0,0,0,0);
const unavailable='群内云生图服务暂不可用，这次没有生成图片。';
const maxBytes=4*1024*1024;

function drawsCurrentCharacter(brief,name){
  if(/(?:别|不带|不用|不要|无需|没有)(?:画|带|参考|用)?(?:人物|角色|人像|卡面)|只(?:有|画)(?:风景|景物)/u.test(brief))return false;
  // In “你在画的小猫”, the subject of the image is the cat.
  if(/^你(?:正在|正|在)?(?:画|绘制|创作|做|拍|设计|制作|养|抱|捧|拿)(?:着)?的/u.test(brief))return false;
  if(/的你(?:自己)?[。！!？? ]*$/u.test(brief))return true;
  if(/^(?:一[张个幅]?)?(?:你自己|自己的(?:表情|贴纸|自画像)|自画像|你的(?:头像|立绘|肖像|半身像)|你的[^，。！？]{0,12}(?:表情|贴纸|自画像)|你(?:正|在|双手|抱|捧|笑|挥手|比心|犯困)|(?:把|让)你)/u.test(brief))return true;
  const scene=brief.replace(/^(?:主角是|画里是|画面中是)/u,'');
  if(!scene.startsWith(name))return false;
  return /^(?:的?(?:表情|贴纸|头像|立绘|肖像|半身像)|正|在|双手|抱|捧|坐|笑|站|撑|拿|举|端|骑|看|挥|比心|犯困)/u.test(scene.slice(name.length));
}

function cloudDrawingProvider({accountId,apiToken,fetchImpl,timeoutMs=55000,dailyLimit=12}={}){
  if(!accountId&&!apiToken)return;
  if(!/^[\da-f]{32}$/iu.test(accountId||'')||!/^[\x21-\x7e]{10,500}$/u.test(apiToken||'')||
      !Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100)throw Error('Invalid Cloudflare image service configuration');
  return {
    dailyLimit,
    async generate(prompt,{signal,assertCurrent,reference}){
      const bytes=await requestCloudflareImage({accountId,apiToken,prompt,signal,assertCurrent,fetchImpl,timeoutMs,
        reference,prepareReference:verifiedPortrait});
      if(bytes.length>maxBytes)throw Object.assign(Error('Image exceeds the social attachment limit'),{code:'image_too_large'});
      const mime=bytes[0]===255&&bytes[1]===216?'image/jpeg':'image/png';
      const shape=dimensions(bytes,mime==='image/jpeg'?'.jpg':'.png');
      return {bytes,mime,...shape,digest:createHash('sha256').update(bytes).digest('hex')};
    },
  };
}

function createGroupCloudDrawing(store,provider){
  const dailyLimit=3;
  function setting(chat,ai){
    if(store.one('SELECT 1 FROM ai_group_draw_pauses WHERE chat=? AND ai=?',chat,ai))return null;
    return store.one('SELECT revision FROM ai_group_draw_settings WHERE chat=? AND ai=?',chat,ai)??{revision:'default'};
  }
  function portrait(chat,ai,revision,withBytes=true){
    const where='FROM ai_group_card_portraits WHERE chat=? AND ai=? AND revision=?';
    if(!withBytes)return !!store.one('SELECT 1 '+where,chat,ai,revision);
    const image=store.one('SELECT png '+where,chat,ai,revision)?.png;
    return image?Buffer.from(image):undefined;
  }
  function privatePortrait(ai,revision,withBytes=true){
    const row=store.one(`SELECT ${withBytes?'portrait.png':'1 AS approved'}
      FROM personal_ai_private_portraits portrait JOIN personal_ai_private_profiles profile ON profile.ai=portrait.ai
      WHERE portrait.ai=? AND profile.revision=?`,ai,revision);
    return withBytes?(row?Buffer.from(row.png):undefined):!!row;
  }
  // New pictures in either conversation type spend the same site allowance.
  const usage=(chat,started)=>store.one(`SELECT count(*) AS total,sum(chat=?) AS mine FROM (
    SELECT chat FROM ai_group_draw_requests WHERE started>=?
    UNION ALL SELECT chat FROM ai_direct_draw_requests WHERE started>=?
  )`,chat,dayStart(started),dayStart(started));
  function status(chat,ai){
    return {configured:!!provider,enabled:!!provider&&!!setting(chat,ai),dailyLimit,
      usedToday:usage(chat,Date.now()).mine||0};
  }
  function configure(account,chat,body,isRoleConfigured){
    if(store.group(account,chat).owner!==account)fail(403,'drawing_owner','只有群主可以设置群里的云生图');
    if(body.expectedAccount!==account||typeof body.enabled!=='boolean')fail(403,'drawing_session','请在当前账号确认群设置');
    const ai=number(body.number);
    if(!store.one('SELECT 1 FROM ai_group_roles WHERE chat=? AND ai=?',chat,ai))
      fail(404,'drawing_role','这个角色已不在当前群');
    if(body.enabled){
      if(!provider||!isRoleConfigured(ai))fail(409,'drawing_unavailable','群内云生图或该角色服务尚未配置');
      if(setting(chat,ai))return;
      store.run('DELETE FROM ai_group_draw_pauses WHERE chat=? AND ai=?',chat,ai);
      store.run('INSERT INTO ai_group_draw_settings VALUES(?,?,?) ON CONFLICT(chat,ai) DO UPDATE SET revision=excluded.revision',
        chat,ai,randomUUID());
    }else{
      store.run('INSERT OR IGNORE INTO ai_group_draw_pauses VALUES(?,?)',chat,ai);
      store.run('DELETE FROM ai_group_draw_settings WHERE chat=? AND ai=?',chat,ai);
    }
  }
  function parse(text,role,{direct=false}={}){
    const classify=value=>classifyGroupDrawing(value,'self',role?.displayName,undefined,{allowUntitled:true});
    let request=classify(text),prefix='';
    if(!request){
      const first=[...text.matchAll(roleReference)][0];
      if(first?.index===0){
        prefix=first[0];
        const output=text.slice(prefix.length).replace(/^[，,\s]+/u,'');
        request=classify(output);
        // The authorized reference already identifies the subject of a generic sticker.
        const sticker=!request&&/^(?:画|绘制|创作|生成)\s*(?:一[张个幅]\s*)?(表情包|表情|贴纸)[。！!]*$/u.exec(output);
        if(sticker)request={action:'create',name:'',brief:sticker[1],directed:true};
      }
    }
    if(request?.action==='create'){
      const brief=(prefix?prefix+'，':'')+request.brief;
      const references=[...brief.matchAll(roleReference)];
      const remainder=brief.replace(roleReference,' ');
      if(needsReference(remainder)||references.length>1||(references.length&&combinedReference.test(remainder)))
        return {action:'reference'};
      if(references.length)return {...request,brief,roleReference:references.some(match=>match[0].endsWith('卡面'))?'card':'avatar',
        groupReference:references.some(match=>match[0].includes('本群'))};
    }
    if(request)return request;
    if(bareResend.test(text)||direct&&recentDirectResend.test(text))return {action:'resend',name:''};
    if(needsReference(text)&&/(?:画|绘制|生图)/u.test(text))return {action:'reference'};
    if(drawingVerb.test(text))return {action:'help'};
    return null;
  }
  function originals(chat,human,ai,name,message=null,limit=1,withBytes=true,visibleOnly=false){
    return store.all(`WITH drawings AS (
      SELECT prompt,chat,human,ai,reply FROM ai_group_draw_requests WHERE chat=? AND human=?
      UNION ALL SELECT prompt,chat,human,ai,reply FROM ai_direct_draw_requests WHERE chat=? AND human=?
    ) SELECT ${withBytes?'i.*,':''}d.message AS original,d.title,r.ai,m.removed,p.removed AS promptRemoved FROM drawings r
      JOIN message_drawings d ON d.message=r.reply AND d.original=d.message JOIN message_images i ON i.message=d.message
      JOIN messages m ON m.id=d.message AND m.chat=r.chat AND m.sender=r.ai
      JOIN messages p ON p.id=r.prompt AND p.chat=r.chat AND p.sender=r.human
      JOIN members viewer ON viewer.chat=r.chat AND viewer.account=r.human
      WHERE (? IS NULL OR r.ai=?) AND (?='' OR d.title=?)
      AND (? IS NULL OR m.id=?)
      AND m.id>viewer.since AND p.id>viewer.since ${visibleOnly?"AND m.removed=0 AND p.removed=0":""}
      ORDER BY p.id DESC LIMIT ?`,
    chat,human,chat,human,ai,ai,name,name,message,message,limit);
  }
  const original=(...args)=>originals(...args)[0];
  function resendOriginal(account,chat,image,clientId){
    const nonce='drawing-resend-'+createHash('sha256')
      .update(JSON.stringify([account,image.original,clientId])).digest('hex');
    return store.sendAiDrawing(image.ai,chat,nonce,image);
  }
  function admit(chat,human,role,request,started,budget,{direct=false,personal=false}={}){
    const place=direct?'这段私聊':'本群';
    if(personal&&(request.action==='reference'||request.groupReference))
      return {text:'私聊绘图只能参考主人为我选的私聊卡面。聊天照片和群角色卡面不能在这里用。'};
    if(request.action==='inquiry'){
      const {configured,enabled,usedToday}=status(chat,role.number);
      if(direct&&configured&&(usedToday>=dailyLimit||usage(chat,started).total>=provider.dailyLimit))
        return {text:'今天的生图次数已用完。重发原图不重新生成。'};
      return {text:!configured?(direct?'私聊云生图服务未配置。':'群内云生图服务未配置。'):!enabled?'本群已关闭云生图。':
        `${direct?'私聊':'群内'}云生图已开启，今天已用 ${usedToday}/${dailyLimit} 次。新图可能计入运营方用量，重发原图不重新生成。`};
    }
    if(request.action==='resend'){
      const saved=originals(chat,human,role.number,request.name,null,request.name?2:1,false,Boolean(request.name));
      if(saved.length>1)return {text:place+'有多张同名原图。打开你想发的那张，选择「重发这张原图」。'};
      return saved.length&&!saved[0].removed&&!saved[0].promptRemoved?{resend:saved[0].original}:{text:direct?'在这段私聊里没找到我为你画过的可用原图。':'在这个群里没找到我为你画过的可用原图。'};
    }
    if(request.action==='chat')return null;
    if(request.action==='reference')return {text:direct?
      '聊天照片和其他人的图片不能用作绘图参考。可以指定我的公开头像。':noImageReply};
    if(request.action!=='create')return {text:'请用一句话描述一张要新画的图，例如「画一张雨夜的灯塔」。'};
    if(privateCue.test(request.brief.normalize('NFKC'))||!modelContext(store,chat).allows({text:request.brief}))
      return {text:'这段画面描述可能含私人信息。请去掉私人资料，再描述要画的画面。'};
    if(!provider)return {text:direct?'私聊云生图服务未配置，这次没有生成图片。':unavailable};
    const grant=setting(chat,role.number);
    if(!grant)return {text:'本群已为我关闭云生图。'};
    const selfPortrait=request.roleReference||drawsCurrentCharacter(request.brief,role.privateCardName??role.card?.name??role.displayName)||
      (personal&&drawsCurrentCharacter(request.brief,role.displayName));
    const rejectsPortrait=personal&&/(?:别|不要|不用|无需|不必)(?:用|参考|参照|照着|带)?[^，,。；;！？!?\n]{0,12}(?:头像|卡面|立绘|参考图)/u.test(request.brief);
    const privateRevision=personal&&selfPortrait&&!rejectsPortrait&&role.privateProfileRevision&&
      privatePortrait(role.number,role.privateProfileRevision,false)?role.privateProfileRevision:undefined;
    const usePortrait=!!(!personal&&selfPortrait&&role.card&&portrait(chat,role.number,role.revision,false));
    const builtIn=!personal&&selfPortrait&&!role.card&&request.roleReference!=='card'?builtInCharacters.get(role.number):undefined;
    if(request.roleReference&&!usePortrait&&!builtIn&&!privateRevision&&!rejectsPortrait)
      return {text:personal?'我还没有获准用于私聊绘图的卡面。主人可以在私聊角色设定里选，也可以直接用文字描述画面。':direct?'这段私聊只支持参考我的内置公开头像，也可以改用文字描述。':
        '本群尚未批准可用于绘图的角色卡面。群主可在「群内 AI → 本群角色卡」批准卡面，或改用文字描述。'};
    const used=usage(chat,started);
    if(used.total>=provider.dailyLimit||used.mine>=dailyLimit||budget==='daily_limit')
      return {text:'今天的生图次数已用完。已有原图仍可以重发。'};
    if(budget==='busy')return {text:'生图服务正忙，请稍后再试。'};
    let brief=request.brief;
    if(usePortrait||privateRevision){
      brief='以提供的角色卡面作为人物外观参考。画面要求：'+brief;
    }else if(builtIn){
      const {archetype,hair,features,palette}=builtIn.visual;
      brief='画中角色是 Agent Arcade 的原创角色'+role.displayName+'，以附带的公开头像作为人物参考。公开外观：'+
        [archetype,hair,...features,...palette].join(', ')+'。下列画面要求中的「你」指这位角色。画面要求：'+brief;
    }
    return {brief,title:request.name,revision:grant.revision,usePortrait,useBuiltInAvatar:!!builtIn,privateRevision};
  }
  function reference(chat,role,job){
    if(job.privateRevision){
      const bytes=privatePortrait(role.number,job.privateRevision);
      if(!bytes)throw Error('Private portrait approval changed');
      return bytes;
    }
    if(job.usePortrait){
      const bytes=portrait(chat,role.number,role.revision);
      if(!bytes)throw Error('Group portrait approval changed');
      return bytes;
    }
    if(job.useBuiltInAvatar&&!role.card){
      const {avatar}=builtInCharacters.get(role.number);
      return readFileSync(path.join(__dirname,'../client/art',avatar));
    }
  }
  const allowed=(chat,role,job)=>!job?.brief||setting(chat,role)?.revision===job.revision;
  return {status,configure,parse,admit,original,resendOriginal,allowed,portrait,reference,generate:provider?.generate};
}

module.exports={createGroupCloudDrawing,cloudDrawingProvider,bareResend};
