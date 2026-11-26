'use strict';

// A reviewed card may demonstrate dialogue in prose. In an ordinary QQ reply
// keep the author's exact spoken words when the surrounding stage direction is
// recognisable. Never paraphrase a gesture as agreement or rewrite a quote.
const quotePairs = new Map([['“','”'], ['‘','’'], ['「','」'], ['『','』'], ['"','"']]);
const closingQuotes = new Set(quotePairs.values());
const MAX_PROJECTION = 6000;
const GROUP_SPEECH_INSTRUCTION = '以本群选定的公开角色本人身份发 QQ 消息。有公开角色卡时，你就是卡中 name 指定的角色。只写你会在聊天框里发给群友的话。卡片和群历史里的动作、心理和镜头是背景；借用台词的口吻，别续写旁白，也别把“她”换成“我”来描述动作。可以说自己的事实、转述别人的原话，保留话中引语和括号。';

// An actual request for a quotation, story or report changes what counts as
// an answer: the actor's words and actions may themselves be the requested fact.
function requestedProse(incoming) {
  const clauses=incoming.split(/[，,。！？!?；;\n]+/u);
  return clauses.some(clause=>{
    const request=clause.trim();
    if(/(?:别|不(?:用|必|要|想|再)|无需|不需要|禁止|do\s+not|don't)\s*(?:再|给我|帮我)?\s*(?:逐字|原样|复述|照抄|引用|重复|copy|quote|repeat)/iu.test(request))return false;
    return /^(?:(?:你|请|麻烦|能否|能不能|可以|帮我|给我|我要你|我想请你)\s*)*(?:逐字|一字不改|一字不差|原样(?:发|复述|照抄)|复述|照抄|引用(?:一下|这|那|原))/u.test(request) ||
      /^(?:(?:请|你|能否|帮我|给我)\s*)*(?:把|将).+(?:逐字|一字不改|原样|照抄|改成第[一三]人称)/u.test(request) ||
      /(?:原[话文](?:是|怎么|什么)|什么(?:反应|动作)|怎么(?:反应|回应的)|做了什么|[她他](?:当时)?(?:说了什么|怎么说的)|(?:当时|昨天|上次).*(?:怎么做|什么动作|点头|摇头))/u.test(request) ||
      /^(?:(?:请|帮我|给我|你)\s*)*(?:写|续写|改写)(?:一段|这段)?(?:故事|小说|剧本)|^(?:(?:please|can you|could you)\s+)?(?:quote|repeat|copy|transcribe)\b.*\b(?:verbatim|word.for.word|exactly)\b/iu.test(request);
  });
}

function plainGap(text) {
  return text.trim().replace(/^[，,：:\s]+|[，,。：:！!.\s]+$/gu, '');
}

// A first-person report may mention an action without being a direction.
// Never strip a condition, date, negation, statement of preference, or a
// clause reporting someone else's words on the strength of its punctuation.
const factCue = /[？?\d]|因为|所以|除非|否则|假如|如果|要是|下雨|指定|原话|听(?:见|到|说)|转述|(?:写|记|印)(?:着|的是|成)|(?:补充|表示|说明|提醒|强调)说[^，,：:。.!！\s]|(?:刚才|刚刚|昨天|今天|明天|当年|上次|以前|已经|从前|上周|下周|周[一二三四五六日天]|本来|喜欢|认为|记得|觉得|希望|建议|打算|想要|曾经|不能|不会|没[有能]|不是|才(?:会|能)|(?:后|前)再|属于|负责|只在|就是|指的是|交给[你他她我]|借给|拿给|递给)|(?:的话|为准)$/u;
const firstPersonReport = /^(?:的|们|这(?:边|里|儿)|那(?:边|里)|要(?:去|等|拿)|可[以能]|说(?:的是|过)|叫(?:它|作)|姓|是|有|在乎|不)/u;
const speechTag = /(?:[说问答喊道]|开口|回道|接话|提醒|告诉(?:他|她|你|我|大家))$/u;
const otherTag = /^[\p{Script=Han}A-Za-z·]{1,22}(?:[说问答喊道]|开口|接话)$/u;
function actorOf(line, name) {
  if (name && !['我','她','他'].includes(name) && line.startsWith(name)) {
    const body=line.slice(name.length);
    if (!(/\p{Script=Latin}$/u.test(name) && /^\p{Script=Latin}/u.test(body)) && !/^[，,]/u.test(body)) {
      return {self:true, named:true, body};
    }
  }
  if (line.startsWith('我')) return {self:true, named:false, body:line.slice(1)};
  if (/^[她他]/u.test(line)) return {self:false, named:false, body:line.slice(1)};
  return null;
}
function motion(body) {
  // Grammatical clues (verb reduplication, a counted movement, disposal and
  // directional clauses), not a catalogue of body parts or character names.
  const [beat,effect,...rest]=body.split(/[，,]/u);
  const visibleEffect=effect===undefined || !rest.length && /^[\p{Script=Han}]{1,16}(?:跟着|随之)[\p{Script=Han}]{1,8}$/u.test(effect);
  return visibleEffect && /^(?:轻轻|微微|轻)?([\p{Script=Han}])(?:\1|了\1|了(?:下|一下|一口))[\p{Script=Han}]{0,12}$/u.test(beat) ||
    /(?:了(?:一|两|几)(?:下|步|口|圈|遍))$/u.test(body) ||
    /^(?:把|将)[^，,。！？]+[，,](?:又|朝|向|转|抬|低|往|随|顺|轻|才)/u.test(body);
}
const stageLead = /^(?:把|将|朝|向|往|用|从|正|伸手|转身|低头|抬手|在.+[中旁边]|垂眼|侧过)/u;
function stageMarker(body) {
  return motion(body) || stageLead.test(body);
}
function sceneClause(line, name, incoming, marked = false) {
  const actor=actorOf(line, name);
  const body=actor ? actor.body : line;
  if (!body || /[。！!\n]/u.test(body) || factCue.test(line) || firstPersonReport.test(body) || /(?:你再|他再|她再|我再)/u.test(body)) return false;
  if (incoming.includes(body) || incoming.includes(body[0]+body.at(-1))) return false;
  if (marked) return (actor?.self || !actor) && stageMarker(body);
  if (!actor?.self) return false;
  // "I checked once" and "I revised it twice" can be the whole answer. A
  // counted action alone does not establish a scene outside a marked frame.
  if (/^(?:轻轻|微微|轻)?(?:点(?:点|了点|了下|了)?头|摇(?:摇|了摇|了下|了)?头|捂(?:了下|了捂|着|住)脸)$/u.test(body)) return true;
  return actor.named && motion(body) && /[，,]|^(?:朝|往|向)/u.test(body);
}

// A top-level paired marker is eligible for removal; markers inside literal
// quotation marks are ordinary text. Nested brackets are left intact.
function omitMarkedStages(text, name, incoming) {
  const quoteStack=[];
  let result='', from=0, removed=false;
  const bracketClose={'（':'）','(':')','*':'*'};
  for (let i=0;i<text.length;i++) {
    const ch=text[i];
    if (quoteStack.length && ch===quoteStack.at(-1)) {quoteStack.pop();continue;}
    if (quotePairs.has(ch)) {quoteStack.push(quotePairs.get(ch));continue;}
    if (quoteStack.length || !Object.hasOwn(bracketClose,ch)) continue;
    const end=text.indexOf(bracketClose[ch],i+1);
    if (end<0) continue;
    const inner=text.slice(i+1,end);
    if (/[()（）*\n]/u.test(inner) || !sceneClause(plainGap(inner),name,incoming,true)) continue;
    result+=text.slice(from,i);
    from=end+1;
    i=end;
    removed=true;
  }
  return removed ? (result+text.slice(from)).trim() : text;
}
function movementStart(body) {
  return stageLead.test(body) || /^[\p{Script=Han}][净好开紧稳住回起下上出进过掉完着断齐落]/u.test(body);
}
function reviewInterposedRole(actor,betweenTwoLines) {
  if(!betweenTwoLines || !actor.named || /[：:]|转告|转达|复述|宣读|代读|朗读|引述|插话|[说问答喊]/u.test(actor.body))return 'unknown';
  // After a role's name, an opening movement or resultative verb can mark
  // the subject boundary. Otherwise keep the whole attribution for review.
  return movementStart(actor.body)?'verify-pair':'verify-frame';
}

function classifyGap(raw,name,labelled,betweenTwoLines) {
  const line=plainGap(raw);
  if (!line) return 'empty';
  if (factCue.test(line) || /[。！？!?]\s*\S|(?:是|写着|包括|叫作|记作|等于)$/u.test(line)) return 'unknown';
  const actor=actorOf(line,name);
  if (actor) {
    if (firstPersonReport.test(actor.body) || /(?:听|看见|提到|引用|写下|写了|问过|记下|告诉我|说过|说的)/u.test(actor.body)) return 'unknown';
    const colon=/[：:]\s*$/u.test(raw);
    const clauses=actor.body.split(/[，,]/u);
    const last=clauses.at(-1).trim();
    if(clauses.length>1 && !/^(?:朝|向|转身|抬手|低头|又|再|接着|继续|轻声|低声|小声|高声|开口|补充|接道|回答|说道|问道|答道|说$|问$|道$)/u.test(last) &&
        !/(?:跟着|随之)/u.test(last) && !motion(last)){
      return reviewInterposedRole(actor,betweenTwoLines);
    }
    // The reviewed name may prefix a different speaker's full name.
    if(actor.named && /^[\p{Script=Han}]{1,3}[说问答喊道]$/u.test(actor.body) &&
      !/^(?:轻声|低声|小声|高声|笑着|接着|回|接|又|再|补充|开口|说|问|答|喊)[说问答喊道]$/u.test(actor.body))return 'unknown';
    if (actor.self && (labelled || colon || speechTag.test(line) || motion(actor.body) ||
        actor.named && stageMarker(actor.body))) return 'self';
    // A framing pronoun between two utterances can continue the same scene.
    // A bare "她说" can also introduce a perfectly ordinary third-party quote.
    if (!actor.self && motion(actor.body)) return 'pronoun';
    if(actor.named && betweenTwoLines)return reviewInterposedRole(actor,betweenTwoLines);
  }
  if (otherTag.test(line) && /[：:]\s*$/u.test(raw)) return 'other';
  return 'unknown';
}

function speechAndGaps(text) {
  const gaps=[], quotes=[], stack=[];
  let start=0, quoteStart=0, recovered=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(stack.length && ch===stack.at(-1)){
      stack.pop();
      if(!stack.length){quotes.push(text.slice(quoteStart+1,i));start=i+1;}
    }else if(quotePairs.has(ch)){
      if(!stack.length){gaps.push(text.slice(start,i));quoteStart=i;}
      stack.push(quotePairs.get(ch));
    }else if(closingQuotes.has(ch)){
      if(stack.length || recovered || !/[。！？!?…]/u.test(text[i-1]||''))return null;
      gaps.length=0;quotes.length=0;gaps.push('');quotes.push(text.slice(0,i));start=i+1;recovered=true;
    }
  }
  if(stack.length)return null;
  gaps.push(text.slice(start));
  return {quotes,gaps};
}
function joinSpeech(lines){
  return lines.reduce((out,line)=>out+(/[\p{L}\p{N}]$/u.test(out)&&/^[\p{L}\p{N}]/u.test(line)?' ':'')+line,'').trim();
}

let chineseWords;
function asksAboutActionTarget(incoming,name,body) {
  const placement=/^(?:把|将)(.+)$/u.exec(body);
  if(!placement)return false;
  for(const clause of incoming.split(/[，,。！？!?；;\n]/u)){
    // Match the actor, object and requested destination/recipient in the
    // same question clause. Asking when an item is available is independent.
    const question=/^(.+?)(?:把|将)(.+?)(?:哪里|哪儿|哪个|哪一|哪边|何处|什么地方|谁)/u.exec(clause);
    if(!question)continue;
    const subject=question[1].replace(/(?:刚刚|刚才|方才|当时|之前|先前|最后|后来|究竟|到底|已经|曾经|刚|又)+$/u,'');
    const actor=[name,'你'].find(label=>subject.endsWith(label));
    if(!actor)continue;
    const intro=subject.slice(0,-actor.length);
    if(intro && !/(?:[\s：:]|请问|问问|说说|讲讲|请讲|知道|记得|告诉我|确认|当时|刚才)$/u.test(intro))continue;
    const predicate=question[2].replace(/了$/u,'').replace(/[到在回进向给入往至]$/u,'');
    if(!predicate)continue;
    // The two verbs need not be the same (e.g. put vs. return). Exclude
    // the question's verb, retaining the complete object preceding it.
    chineseWords??=new Intl.Segmenter('zh-CN',{granularity:'word'});
    const verb=chineseWords.segment(predicate).containing(predicate.length-1);
    const object=predicate.slice(0,verb.index).trim();
    if(object && placement[1].startsWith(object))return true;
  }
  return false;
}

function unquotedRoleLead(text,name,incoming) {
  // The first punctuation boundary must separate a framing clause from the
  // answer. Keep the entire remainder as one original block, including every
  // alternative, exception and condition after its own subsequent commas.
  const split=/^([^，,。！!？?；;\n]+)([，,。！!\n])\s*([\s\S]+)$/u.exec(text);
  if(!split)return null;
  const [,head,separator,tail]=split, actor=actorOf(head,name);
  if(!actor?.named || !actor.body)return null;
  if(asksAboutActionTarget(incoming,name,actor.body) || factCue.test(head) ||
      /晴天|雨天|雪天|阴天|照常|必须|规定|只要|只有|才算|[说问答喊]|转告|转达|复述|宣读|引述/u.test(head))return {text,units:null};
  const firstLine=plainGap(tail.split(/[，,。！？!?；;\n]/u,1)[0]);
  if(!firstLine || (name && firstLine.startsWith(name)) || /^(?:[她他]|又|接着|随即|随后|朝|转身)/u.test(firstLine) || motion(firstLine))return null;
  // A chat message can end at a word. An unfinished list, on the other
  // hand, does not establish a complete answer.
  if(/[，,、：:；;]$/u.test(tail.trimEnd()))return null;

  // Possessive clauses can denote real policies or property. Only a brief
  // movement of a gaze or expression qualifies for deterministic removal.
  const subject=actor.body.match(/^的([\p{Script=Han}]{1,8}?)(?:在|从|向|往|沿|微微|轻轻)/u);
  if(subject){
    if(incoming.includes(subject[1]) || !/(?:一瞬(?:间)?|片刻|刹那|[一两几]下|一会儿)$/u.test(head))return null;
    if(!/[，,]/u.test(separator) && /^(?:目光|视线|眼神|余光|神色|表情)$/u.test(subject[1]))return {text:tail,units:null};
    // A counted movement of an attributed object is less certain; keep
    // policies and events intact and review only the complete trailing answer.
    if(!/[了着][一两几]下$/u.test(head) || /(?:规则|通知|条例|要求|票据|手续)/u.test(subject[1]))return null;
    return {text,units:[{text:tail}]};
  }
  if(firstPersonReport.test(actor.body) || !movementStart(actor.body) || incoming.includes(actor.body))return null;
  return {text,units:[{text:tail}]};
}

function analyseGroupDialogue(text,name,incoming='',labelled=false) {
  // Preserve a larger original for the existing redaction and excerpt path.
  // Nested punctuation and untrusted model output cannot expand parsing work
  // beyond the conversation runner's existing 6000-unit prompt budget.
  if (text.length>MAX_PROJECTION || incoming.length>MAX_PROJECTION || !text.trim() || requestedProse(incoming)) return {text, units:null};
  let body=text.trim();
  if(name && body.startsWith(name) && !/[\r\n]/u.test(body) && !/书名|题名|标题|全名|原题|原名|字样|写了什么|写着什么/u.test(incoming)){
    const labelled=body.slice(name.length);
    if(/^[：:]/u.test(labelled))body=labelled.slice(1).trimStart();
  }
  const value=omitMarkedStages(body,name,incoming);
  const parts=speechAndGaps(value);
  const intact={text:value===text.trim()?text:value,units:null};
  if(!parts) return intact;
  const {quotes,gaps}=parts;
  if(quotes.length){
    const pair=quotes.length===2 && quotes.every(quote=>quote.trim()) && !gaps[0].trim() && !gaps[2].trim();
    const tags=gaps.map((gap,index)=>classifyGap(gap,name,labelled,pair && index===1));
    if(tags[1]==='verify-pair')return {...intact,units:quotes.map(text=>({text}))};
    if(tags[1]==='verify-frame')return {...intact,units:[{text:value}]};
    const explicit=tags.includes('self'),foreign=tags.includes('other');
    const pronoun=tags.includes('pronoun');
    const selfOnly=/(?:只说|只讲|只要|单说|只问)(?:你|自己的)/u.test(incoming);
    if(!explicit && !pronoun) {
      if(foreign && selfOnly)return {text:'',units:null};
      if(value!==text.trim() && quotes.length===1 && tags.every(tag=>tag==='empty'))return {text:quotes[0],units:null};
      return intact;
    }
    if(tags.includes('unknown') || foreign && pronoun){
      // A condition or factual statement outside quotation marks can qualify
      // every line. A subset of the quotes would lose that information.
      if(gaps.some(gap=>factCue.test(gap)) && !selfOnly)return intact;
      const units=quotes.filter((_,i)=>tags[i]==='self' && /[：:]\s*$/u.test(gaps[i])).map(text=>({text}));
      return {...intact,units};
    }
    if(foreign && !explicit)return intact;
    // Prefixes introduce the following quote. A tag at the end attributes
    // the immediately preceding quote. Never guess a missing owner in a mix.
    if(foreign){
      const owners=tags.slice(0,-1);
      const last=tags.at(-1);
      if(last!=='empty'){
        if(owners.at(-1)!=='empty' && owners.at(-1)!==last)return {...intact,units:[]};
        owners[owners.length-1]=last;
      }
      if(owners.includes('empty'))return {...intact,units:quotes.filter((_,i)=>owners[i]==='self').map(text=>({text}))};
      return {text:joinSpeech(quotes.filter((_,i)=>owners[i]==='self')),units:null};
    }
    if (pronoun && !explicit && quotes.length===1 && !plainGap(gaps[0]))return intact;
    return {text:joinSpeech(quotes),units:null};
  }
  if(!value)return intact;
  const afterLead=unquotedRoleLead(value,name,incoming);
  if(afterLead)return afterLead;
  const first=value.match(/^([^。！!\n]+)[。！!\n]\s*([\s\S]+)$/u);
  if(first && sceneClause(plainGap(first[1]),name,incoming)){
    const rest=first[2].trim();
    return {text:sceneClause(plainGap(rest),name,incoming)?'':rest,units:null};
  }
  if(sceneClause(plainGap(value),name,incoming))return {text:'',units:null};
  // Several different characters described in succession, with the current
  // one among them, are a scene only when every sentence has motion syntax.
  const lines=value.split(/[。！!\n]+/u).map(plainGap).filter(Boolean);
  if(name && lines.length>1 && lines.some(line=>sceneClause(line,name,incoming)) &&
      lines.every(line=>!factCue.test(line) && (sceneClause(line,name,incoming) || motion(line.replace(/^[\p{Script=Han}]{2,5}?(?=[\p{Script=Han}]了|[往朝向])/u,'')))))return {text:'',units:null};
  const own=actorOf(plainGap(value),name);
  const ambiguousRole=own?.self && own.body && lines.length===1 && !firstPersonReport.test(own.body) && !factCue.test(value) &&
    (own.named || /^(?:把|将|向|朝|往)|^[\p{Script=Han}]{1,3}着|[了着].+[，,]/u.test(own.body));
  return {...intact,units:ambiguousRole?[{text:value}]:null};
}
function spokenGroupReply(text,roleName,incoming='',labelledExample=false) {
  return analyseGroupDialogue(text,roleName,incoming,labelledExample).text;
}

// Only the character's labelled lines are style demonstrations. Leave user
// lines, card descriptions, and the original reviewed card untouched.
function spokenCardExamples(examples, roleName) {
  if (typeof examples !== 'string') return examples;
  return examples.replace(/^([ \t]*\{\{char\}\}[：:][ \t]*)([^\r\n]*)$/gmu,
    (_line, label, example) => label + spokenGroupReply(example, roleName, '', true));
}

module.exports = {analyseGroupDialogue, spokenGroupReply, spokenCardExamples, joinSpeech, GROUP_SPEECH_INSTRUCTION};
