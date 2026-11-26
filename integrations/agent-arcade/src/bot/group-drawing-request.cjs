'use strict';
const {MAX_INCOMING_FRAME} = require('./social-flow.cjs');
const {drawingIntentText, explicitDrawingHold, wantsChatAboutDrawing} = require('../ui/chat-drawing-request.js');

// QQ normalizes mentions to empty text and deduplicates their targets. Keep
// the original segment proof for this separately authorized, paid action.
function nativeDrawingAddress(segments, accountId) {
  // A plain OneBot string can retrieve an existing name, never prove a
  // native mention for a new paid request.
  if (typeof segments === 'string') return segments.trim() && !segments.includes('[CQ:') ? 'plain' : null;
  if (!Array.isArray(segments) || segments.length > 40) return null;
  const parts = segments.filter(part => !(part?.type === 'text' && typeof part.data?.text === 'string' &&
    /^[\t\p{Zs}]*$/u.test(part.data.text)));
  const isText = part => part?.type === 'text' && typeof part.data?.text === 'string' && !!part.data.text.trim();
  if (parts.length === 1) return isText(parts[0]) ? 'plain' : null;
  // OneBot can split the visible text after a mention into adjacent segments.
  // Keep the existing trailing-mention case limited to one text segment.
  const mention = parts[0]?.type === 'at' ? parts[0] : parts.length === 2 ? parts[1] : null;
  const text = mention === parts[0] ? parts.slice(1) : parts.slice(0, 1);
  if (mention?.type !== 'at' || !text.length || !text.every(isText)) return null;
  const target = mention.data?.qq;
  if (!(typeof target === 'string' || Number.isSafeInteger(target)) || !/^[1-9]\d{4,14}$/u.test(String(target))) return null;
  return String(target) === accountId ? 'self' : 'other';
}

const wrappers = new Map([['『','』'],['「','」'],['“','”'],['"','"']]);
function exactName(value) {
  let name = value.trim();
  const close = wrappers.get(name[0]);
  if (close) {
    if (!name.endsWith(close)) return null;
    name = name.slice(1, -1);
  }
  if (!name || name !== name.trim() || [...name].length > 40 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}「」『』“”"<>@/\\:：，,；;。！？!?]/u.test(name)) return null;
  return name.normalize('NFC');
}

const draw = /^(?:现在(?:就|开始)?)?(?:请(?:你)?)?(?:现在(?:就)?)?(?:[帮给为替](?:我们|大家|我))?(?:画|绘制|创作)一?[张幅个]\s*(.+)$/u;
const titleMarker = /(?<=[，,、\s并])(?:叫它|叫作|叫做|取名为?|命名为?)|(?:叫它|取名为?|命名为?)(?=[『「“"])/u;
const batch = /(?:再(?:帮我|给我)?(?:画|绘制|创作)|另(?:外)?(?:一张|画)|(?:和|及|与|以及|还有)一?[张幅]|分别[画做]|各(?:画|一[张幅])|一套|一组|一系列|[两二三四五六七八九十百多几\d]+\s*[张幅份款]|(?:然后|顺便|并且|同时|再帮我|还要)(?:请|帮我|给我)?(?:发|画|转|传|做|写|说|查)|(?:发给|转发给|发到|转到|私聊发))/u;
const notAnOrder = /[；;？?]|(?:算了|(?:不用|不要|别)画(?:这[次张幅]|它)|多少钱|为什么|怎么(?:收费|计费|画|翻译)|要(?:多久|多长时间)|需要什么工具|有多难|难不难|能不能|会不会|算不算|如果|假如|假设|的话|是什么意思|是.{0,8}(?:原话|例句))|(?:吗|么|呢|嘛)$/u;
const commentary = /(?:真的|太|很|非常|特别|并不|其实不)(?:费|难|累|贵|简单|容易|耗时)|(?:花了|用了|需要)(?:我)?[一两二三四五六七八九十半\d]+(?:个?小时|天|分钟)|[，,]\s*(?:我|他|她)(?:觉得|认为)/u;
const secondOrder = /(?:[，,、]\s*(?:再|也|还|顺便|然后|另外|并|同时)?|(?:然后|顺便|再|另外|并且))\s*(?:帮我|给我|请你)?(?:画[一张幅个]|绘制|创作|写|回答|告诉|查一下|查找|总结|转发|发送|制作|播放|朗读)/u;
const emptyScene = /^(?:新的?|好看的?|随便的?|任意的?)?(?:图(?:片|像)?|画(?:作)?|插画|表情(?:包|图)?|贴纸|贴图)(?:吧|就好|看看)?$/u;
function asksDrawingCapability(body) {
  const question = body.replace(/^请问[，,\s]*/u,'')
    .replace(/^你?\s*(?:现在)?\s*(?:在(?:这个群里?|群里|这里)|本群|这群里?|这里)?\s*还?/u,'')
    .replace(/\s+/gu,'');
  const parts = /^(.*?)(?:生图|画图|绘图|生成(?:图像|图片))(.*)$/u.exec(question);
  if (!parts) return false;
  const [,lead,after] = parts;
  const before = lead.replace(/(?:在(?:这个群里?|群里|这里)|本群|这群里?)$/u,'');
  if (/^(?:能不能|可不可以|能否|会不会)$/u.test(before)) return /^[？?]?$/u.test(after);
  if (/^(?:能|可以|会)$/u.test(before)) return /^(?:[吗么][？?]?|[？?])$/u.test(after);
  return !before && /^(?:行不行|能不能|可不可以|可以吗|行吗|可以么)[？?]?$/u.test(after);
}

function drawingRoleNames(roleName, characterId) {
  if (characterId === 'claude-ju') return [roleName,'橘娘','橘'];
  if (characterId === 'deepseek-whale') return [roleName,'鲸鱼娘','鲸鱼'];
  return [roleName];
}

function typedDrawingRecipient(text) {
  if (typeof text !== 'string' || text.length > MAX_INCOMING_FRAME) return null;
  const match = /^[@＠]([^\s@＠]{1,40})[\t\p{Zs}]+(.+)$/u.exec(text.trim());
  if (!match) return null;
  const action = classifyGroupDrawing(match[2], 'self')?.action;
  return action === 'create' || action === 'needs_name' ? match[1] : null;
}

function classifyGroupDrawing(text, address, roleName, characterId, {allowUntitled=false}={}) {
  if (address !== 'self' && address !== 'plain' || typeof text !== 'string' || text.length > MAX_INCOMING_FRAME) return null;
  const line = text.replace(/^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu, '');
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>@]|\[CQ:/iu.test(line)) return null;
  let body = line.replace(/[。！!]$/u, '').trim();
  if (address === 'self') {
    body = body.replace(/^[，,、：:]\s*/u,'');
    for (const name of drawingRoleNames(roleName, characterId)) {
      if (!name || !body.startsWith(name)) continue;
      const tail = body.slice(name.length);
      if (/^[，,、：:\s]/u.test(tail)) { body = tail.replace(/^[，,、：:\s]+/u, ''); break; }
    }
  }
  if (asksDrawingCapability(body)) return {action:'inquiry'};
  const repeat = /^再发(?:送)?一次\s*(.+)$/u.exec(body);
  if (repeat) {
    const drawing = /^群里画的\s*([『「“"].+)$/u.exec(repeat[1]);
    const name = exactName(drawing ? drawing[1] : repeat[1]);
    if (name) return {action:'resend', name, brief:'', directed:address === 'self', ...(drawing ? {source:'drawing'} : {})};
  }
  const plain = drawingIntentText(body);
  const subject = draw.exec(body)?.[1];
  if (!subject) {
    // A bare "先报个价" or "只用文字回复" also declines media. An ordinary
    // conversation about what dinner costs keeps its normal reply choices.
    const drawingContext = /图|画|提示词/u.test(plain) ||
      /^(?:请(?:你)?|麻烦(?:你)?)?(?:先|暂|报|估|询|只|仅|等我|待我)/u.test(plain);
    return drawingContext && explicitDrawingHold(plain) ? {action:'chat'} : null;
  }
  if (explicitDrawingHold(plain) || /(?:别|不用|不要)画/u.test(plain.split(/[，,。；;！!?？]/u, 1)[0])) return {action:'chat'};
  const title = titleMarker.exec(subject);
  const brief = title ? subject.slice(0,title.index).trimEnd().replace(/[，,、并]$/u,'').trim() : subject.trim();
  // Share the App's decision about the requested deliverable. The QQ title
  // is metadata only when the entire suffix is a valid name. A direction
  // after that name is still part of the caller's instruction.
  const name = exactName(title ? subject.slice(title.index+title[0].length) : brief);
  if (wantsChatAboutDrawing(drawingIntentText('画一张' + (title && name ? brief : subject)))) return {action:'chat'};
  if (address !== 'self' || batch.test(plain) || secondOrder.test(plain) || notAnOrder.test(plain) || commentary.test(plain)) return null;
  if (!brief || emptyScene.test(brief) ||
      /(?:[，,、]\s*(?:叫它|叫作|叫做|取名|命名))|[。！!]/u.test(brief)) return null;
  if ([...brief].length > 500) return {action:'needs_name', name:'', brief:'', directed:true};
  if (!name) {
    if(allowUntitled&&!title)return {action:'create',name:'',brief,directed:true};
    return title ? null : {action:'needs_name', name:'', brief:'', directed:true};
  }
  return {action:'create', name, brief, directed:true};
}

function parseGroupDrawing(...args) {
  const request = classifyGroupDrawing(...args);
  return request?.action === 'chat' || request?.action === 'inquiry' ? null : request;
}

module.exports = {nativeDrawingAddress, parseGroupDrawing, classifyGroupDrawing, typedDrawingRecipient, drawingRoleNames};
