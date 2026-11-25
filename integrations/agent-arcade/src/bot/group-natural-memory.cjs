'use strict';

const {clean} = require('./dispatcher.cjs');
const {rememberFact} = require('./commands.cjs');

const MAX_TOPIC = 600;
const DIRECT = /^(?:[请請])?[记記]住(?:[，,][ \t\u3000]*|(?=我))(我[^\r\n\u2028\u2029]*)$/u;
const OTHER_PERSON = /^(?:[们們]|(?:的[ \t\u3000]*|家(?:的)?[ \t\u3000]*)?(?:爸|妈|媽|父母|父亲|父親|母亲|母親|爷|爺|奶奶|外婆|外公|哥哥|姐姐|弟弟|妹妹|孩子|儿子|兒子|女儿|女兒|伴侣|伴侶|老公|老婆|同事|同学|同學|老师|老師|室友|邻居|鄰居|朋友|男朋友|女朋友|老板|老闆|猫|貓|狗))/u;
const REPORT = /^(?:[听聽][说說]|[转轉][述发發]|[复複]述|(?:(?:[刚剛]才?|曾经|曾經|以前))?(?:[说說问問]|引用)(?:[：:，,“「『"]|[过過][：:]))/u;
const QUESTION_START = /^(?:是否|是不是|能不能|可不可以|有没有|有沒有|要不要|会不会|會不會|记不记得|記不記得|怎[么麼](?!也|都)|为什么|為甚麼|(?:是|叫)(?:谁|誰|什么|甚麼|啥)|(?:去|住|在)?哪[里裡儿兒])/u;
const QUESTION_END = /(?:[吗嗎呢]|(?:好|行|对|對|可以)[么麼]|好不好|行不行|可以不可以|了[没沒])\s*[，。！？!?.…]*$/u;
const FILLER = /^(?:[啊哦噢呀吧呢吗嗎么麼喔啦嘛呗唄]|了|[没沒]|一下)[\s，。！？!?.…]*$/u;
const QUOTED = /“[^“”]*”|‘[^‘’]*’|「[^「」]*」|『[^『』]*』|《[^《》]*》|"[^"]*"/gu;
const OPPOSED = /(?:不要|别|別|不用|不需要|无需|無需|不想[让讓])\s*(?:你\s*)?(?:[记記](?:住|下)|保存)/u;
const CREDENTIAL = /(?:密[码碼]|口令|[验驗][证證][码碼]|身份[证證][号號]|[银銀]行卡[号號]|私[钥鑰]|[访訪][问問]令牌)\s*(?:(?:是|[为為]|[:：])\s*\S|\d{4,})/u;

/** Recognize a direct instruction carrying a fact about its own speaker. */
function parseNaturalGroupRemember(rawBody) {
  if (typeof rawBody !== 'string') return null;
  const topic = DIRECT.exec(rawBody.trim())?.[1];
  if (!topic || topic.length > MAX_TOPIC || !topic.isWellFormed() ||
      /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(topic) || clean(topic,MAX_TOPIC) !== topic || CREDENTIAL.test(topic)) return null;
  const content = topic.slice(1).trimStart();
  const unquoted = content.replace(QUOTED,'');
  if (!/[\p{L}\p{N}]/u.test(content) || OTHER_PERSON.test(content) || REPORT.test(content) ||
      FILLER.test(unquoted) || QUESTION_START.test(unquoted) || /[?？]/u.test(unquoted) ||
      QUESTION_END.test(unquoted) || OPPOSED.test(unquoted)) return null;
  return topic;
}

const PREFERRED_NAME_KEY = 'qq-group-preferred-name';
const PREFERRED_FACT = '称呼偏好：';
const FUTURE_NAME = /^(?:(?:我希望你|我想[让讓]你|我希望|[请請]|麻烦你|麻煩你)[ \t\u3000]*)?(?:以[后後]|今[后後]|从今以[后後]|從今以[后後]|从现在起|從現在起)[ \t\u3000，,]*(?:(?:就|都|改|请|請|直接)[ \t\u3000]*)?(?<verb>叫|[称稱]呼)我[ \t\u3000]*(?<name>[^\r\n\u2028\u2029]+)$/u;
const POLITE_NAME = /^(?:[请請]|麻[烦煩]你)[ \t\u3000]*(?<verb>叫|[称稱]呼)我[ \t\u3000]*(?<name>[^\r\n\u2028\u2029]+)$/u;
const WITHDRAW_NAME = /^(?:[请請][ \t\u3000]*)?(?:[别別]|不要)再[ \t\u3000]*(?:叫|[称稱]呼)我[ \t\u3000]*(?<name>[^\r\n\u2028\u2029]+)$/u;
const NAME_TEXT = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._·'-]{0,31}$/u;
// 叫我 can mean invite, wake, fetch or tell the speaker to do an action.
// Explicit 称呼 or a quoted name keeps unusual names available.
const CALLED_TO_ACTION = /^(?:起[床牀]|醒[过過]?来|起身|起来|起來|一起|一[块塊]|过来|過來|回[来來]去?|出[去来來]|进[来來]|去|来(?:吃|喝|看|玩|做|帮|幫)|來(?:吃|喝|看|玩|做|帮|幫)|陪你|帮(?:你|忙)|幫(?:你|忙)|跟你|和你|等(?:一下|一会|一會)|接(?:听|聽)?电话|接(?:听|聽)?電話|记得|記得|上[班学學]|下[楼樓车車]|跑步|吃[饭飯]|睡觉|睡覺|看(?:电影|電影)|做作[业業])/u;
const AMBIGUOUS_NAME = /(?:或者|还是|還是|要不|也可以|你觉得|你覺得|不要|不用|不叫|别叫|別叫|开玩笑|開玩笑|以后|以後|称呼|稱呼|告诉|告訴|改成|叫我|想换|想換)/u;

function preferredNameValue(value) {
  if (typeof value !== 'string' || !NAME_TEXT.test(value) || !value.isWellFormed() ||
      OTHER_PERSON.test(value) || AMBIGUOUS_NAME.test(value) || clean(value,32) !== value) return null;
  return value;
}

function quotedName(value) {
  const match = /^(?:“([^“”]+)”|「([^「」]+)」|『([^『』]+)』)$/u.exec(value);
  return match ? match[1] || match[2] || match[3] : null;
}

function parseGroupPreferredName(body) {
  if (typeof body !== 'string' || body.length > 180) return null;
  const direct = body.trim();
  const text = parseNaturalGroupRemember(direct) || rememberFact.exec(direct)?.[1].trim() || direct;
  const match = FUTURE_NAME.exec(text) || POLITE_NAME.exec(text);
  if (!match) return null;
  const raw = match.groups.name.trim().replace(/[。！!.]+$/u,'').trimEnd()
    .replace(/(?:就好|即可|吧|啦|呀)$/u,'').trimEnd();
  const quoted = quotedName(raw);
  if (!quoted && match.groups.verb === '叫' && CALLED_TO_ACTION.test(raw)) return null;
  return preferredNameValue(quoted ?? raw);
}

function parseGroupPreferredNameWithdrawal(body) {
  if (typeof body !== 'string' || body.length > 180) return null;
  const match = WITHDRAW_NAME.exec(body.trim());
  if (!match) return null;
  const sentence = match.groups.name.trim().replace(/[。！!.]+$/u, '').trimEnd();
  if (/[吧呢吗嗎]$/u.test(sentence)) return null;
  const raw = sentence.replace(/了$/u, '').trimEnd();
  return preferredNameValue(quotedName(raw) ?? raw);
}

function groupPreferredNameFact(name) {
  return PREFERRED_FACT + name;
}
function preferredNameFromFact(text) {
  if (typeof text !== 'string') return null;
  return text.startsWith(PREFERRED_FACT) ? preferredNameValue(text.slice(PREFERRED_FACT.length)) : parseGroupPreferredName(text);
}

module.exports = {parseNaturalGroupRemember,parseGroupPreferredName,parseGroupPreferredNameWithdrawal,preferredNameValue,
  groupPreferredNameFact,preferredNameFromFact,PREFERRED_NAME_KEY};
