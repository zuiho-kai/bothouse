'use strict';

// A small local vocabulary for common notebook questions. A topic alone never
// qualifies a fact: asking about a show's audience must not retrieve its start.
// Keep answer cues separate from question cues so an interrogative in a note
// does not by itself make that note a candidate.
const TOPICS = {
  meeting: /集合(?:点|地点|地址|时间|时刻|的时|在|于|是)|会合|汇合|碰头|碰面|见面/u,
  lunch: /午餐|午饭|午间用餐|中午[^。！？;\n]{0,12}(?:吃|用餐|开饭)/u,
  dinner: /晚餐|晚饭|晚间用餐|晚上[^。！？;\n]{0,12}(?:吃|用餐|开饭)/u,
  breakfast: /早餐|早饭|早间用餐|早上[^。！？;\n]{0,12}(?:吃|用餐|开饭)/u,
  event: /演出|节目|表演|开演|音乐会|演唱会|活动开场/u,
  transport: /巴士|大巴|班车|接驳车|公交车|发车|(?:接|送)[^。！？;\n]{0,12}(?:的车|那趟车|车辆)/u,
  lostProperty: /失物|招领|捡到|捡了|拾到|拾获|拾得/u,
  rainPlan: /雨[^。！？;\n]{0,18}(?:方案|预案|备用|备选|改|转|换)|(?:方案|预案|备用|备选)[^。！？;\n]{0,12}雨/u,
  transitPass: /(?:地铁|地下铁路|轨道交通|公交|公共交通)[^。！？;\n]{0,10}(?:卡|乘车凭证|通行证)|交通卡|公交卡|乘车卡/u,
};

const EXTRA_FACETS = {
  price: /价格|价钱|票价|票钱|费用|收费|花费|多少钱|多少元/u,
  quantity: /数量|人数|观众|(?:几|多少)(?:个?[人位份件场次节辆顶张]|个)|有几/u,
  duration: /时长|耗时|多久|多长时间|排队时间|持续时间/u,
  contact: /联系人|电话|联系方式|联系谁|找谁|打给谁/u,
  route: /路线|怎么走|怎么去|如何前往|从哪条路/u,
};
const PHASES = {
  event: {end: /散场|谢幕|闭幕|收场|结束/u},
  transport: {arrival: /到站|抵达|到达|几点到|何时到|什么时候到/u},
};
const WEEKDAY = /(?:(下下|上上|上|下|本|这)\s*)?(?:周|星期|礼拜)([一二三四五六日天1-7])(?!\d)/gu;
const DATED = /(?:(20\d{2})年\s*)?(\d{1,2})月\s*(\d{1,2})[日号]/gu;
const ISO_DATED = /(20\d{2})-(\d{2})-(\d{2})(?!\d)/gu;
const QUOTED_NAME = /《([^》\r\n]{2,28})》|「([^」\r\n]{2,28})」|“([^”\r\n]{2,28})”/gu;
const GROUP_NAME = /(?:^|[^\p{Script=Han}A-Za-z0-9])([\p{Script=Han}A-Za-z0-9]{1,16}?(?:工作室|委员会|志愿者|小组|联盟|协会|俱乐部|社|队|团|会|班))(?=$|[^\p{Script=Han}A-Za-z0-9]|参[与加]|的|要|集合|几点|什么时候|吃|午[饭餐]|晚[饭餐]|早[饭餐]|在|约|去哪|到哪|见面|碰[头面]|会合|汇合|联系|准备|今天|明天|后天|今晚|上午|下午|中午)/gu;
const NAME_LEAD = /(?:^|[\s，、；])(?:请问|想问|想知道|麻烦问下|我想问|咱们的|我们(?:的)?|他们的|这个|那个|今天|明天|后天|今晚|中午|上午|下午|早上|晚上)+/gu;
const ROUTINE_PLACE = /(?:订于|在|去|改到|转到|换到)([^。！？；，,\n]{1,24}?)(?:用餐|吃(?:午饭|晚饭|早饭|饭)|聚餐|集合|见面|碰头|碰面|会合|汇合)/gu;
const TEMPORAL = /^(?:今天|明天|后天|今晚|早上|上午|中午|下午|晚上|这周|[上下]周|星期|礼拜|周[一二三四五六日天]|[0-9零一二两三四五六七八九十]+[点月日:])/u;

const ASKED_FACETS = {
  place: /地点|地址|场地|集合点|哪里|哪儿|哪块儿?|哪边|哪家|什么地方|在何处|去哪|到哪|在哪/u,
  time: /时间|时刻|几点|何时|什么时候|哪天|哪一[天日]|哪日/u,
  reference: /编号|代号|号码|序号|标识|编码/u,
};

const ANSWER_FACETS = {
  place: /地点|地址|场地|集合点|(?:交|送|归还)(?:到|给|至)|送交|(?:订了|在|改到|转到|换到)[^。！？;\n]{1,20}(?:馆|店|厅|台|堂|桥|站|楼|口|区|园|场|码头|广场|社区|门)/u,
  time: /时间|时刻|[0-9]{1,2}[:：][0-9]{2}|[零一二两三四五六七八九十\d]{1,3}点(?:[零一二两三四五六七八九十\d半一二三四刻分]|[。！？\s]|$)|[\d一二三四五六七八九十]{1,3}月[\d一二三四五六七八九十]{1,3}[日号]/u,
  reference: /编号|代号|号码|序号|标识|编码/u,
};
const DETAIL_CUES = [...Object.values(ASKED_FACETS), ...Object.values(EXTRA_FACETS)];
const DETAIL_WORDS = new RegExp('的?(?:' + DETAIL_CUES.map(pattern => pattern.source).join('|') + ')', 'gu');
const QUESTION_TAIL = /^(?:是|为|有|在|叫|和|还|能|怎么|多少|什么|几|呢|吗)/u;
const QUESTION_CUES = [...Object.values(TOPICS), ...DETAIL_CUES]
  .map(pattern => new RegExp(pattern.source, 'gu'));

function classify(text, topics, facets) {
  return topics.flatMap(topic => facets.map(key => {
    const phase = key === 'time' && Object.entries(PHASES[topic] || {}).find(([, cue]) => cue.test(text))?.[0];
    return phase ? topic + ':' + phase + ':time' : topic + ':' + key;
  }));
}

function topicsFor(text) {
  return Object.keys(TOPICS).filter(key => TOPICS[key].test(text));
}

function matchingFacets(text, rules) {
  return Object.keys(rules).filter(key => rules[key].test(text));
}

function questionKey(text) {
  const normalized = text.normalize('NFKC');
  const topics = topicsFor(normalized);
  if (topics.length !== 1) return null;
  // Prefer a specifically requested detail over words that identify the topic.
  const specific = matchingFacets(normalized, EXTRA_FACETS);
  const facets = specific.length ? specific : matchingFacets(normalized, ASKED_FACETS);
  if (facets.length !== 1) return {key: topics[0], allowAlias: false};
  return {key: classify(normalized, topics, facets)[0], allowAlias: true};
}

function factKeys(text) {
  const normalized = text.normalize('NFKC'), topics = topicsFor(normalized);
  if (!topics.length) return [];
  const facets = matchingFacets(normalized, {...ANSWER_FACETS, ...EXTRA_FACETS});
  if (!facets.includes('place') && [...normalized.matchAll(ROUTINE_PLACE)].some(([, place]) => !TEMPORAL.test(place.trim()))) {
    facets.push('place');
  }
  return [...topics, ...classify(normalized, topics, facets)];
}

function anchors(text) {
  const normalized = text.normalize('NFKC').toLowerCase();
  const dates = new Set();
  const calendar = (_match, year, month, day) => {
    dates.add(String(year || '') + '/' + Number(month) + '/' + Number(day));
    return ' ';
  };
  const namesText = normalized.replace(WEEKDAY, (_match, week, weekday) => {
    const day = '一二三四五六日'.indexOf(weekday === '天' ? '日' : weekday) + 1 || Number(weekday);
    dates.add((week === '这' ? '本' : week || '') + '周' + day);
    return ' ';
  }).replace(DATED, calendar).replace(ISO_DATED, calendar);
  const names = new Set([...normalized.matchAll(QUOTED_NAME)].map(match => (match[1] || match[2] || match[3]).trim()));
  const named = namesText.replace(NAME_LEAD, ' ');
  for (const [, name] of named.matchAll(GROUP_NAME)) names.add(name);
  return {dates, names, normalized};
}

function matchesAnchors(query, fact) {
  return [...query.dates].every(date => fact.dates.has(date)) &&
    [...query.names].every(name => fact.names.has(name) || (!fact.names.size && fact.normalized.includes(name)));
}

function distinguishingText(query) {
  let text = query.normalized.replace(WEEKDAY, ' ').replace(DATED, ' ').replace(ISO_DATED, ' ');
  for (const name of query.names) text = text.split(name).join(' ');
  for (const pattern of QUESTION_CUES) text = text.replace(pattern, ' ');
  return text;
}

// For an unclassified subject, a requested detail (such as 编号) cannot identify
// the note by itself. Split before making bigrams so 的编 and 号是 cannot count either.
function lexicalSubject(text) {
  const wording = text.normalize('NFKC').replace(/请问|告诉我|我(?:的|上次)|上次|还记得|到底|来着/gu, ' ');
  const subject = wording.replace(DETAIL_WORDS, (detail, offset) => {
    // 编码 alone is a detail. In 编码器, the bigram 码器 still identifies the
    // object. Keep that join only on the right, away from question particles.
    return QUESTION_TAIL.test(wording.slice(offset + detail.length)) ? ' ' : ' ' + detail.at(-1);
  });
  return subject === wording ? null : subject.replace(/(?:是|为)?(?:多少|什么)/gu, ' ');
}

module.exports = {questionKey, factKeys, anchors, matchesAnchors, distinguishingText, lexicalSubject};
