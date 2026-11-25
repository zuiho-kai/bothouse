'use strict';

const CONTINUATION_MS=120_000;
const HUMAN_EXCHANGE_MS=45_000;
const GROUP_COOLDOWN_MS=25_000;
const acknowledgement=/^(?:好(?:的)?|收到(?:了)?|明白(?:了)?|嗯{1,3}|ok)[。.!！~～\s]*$/iu;
const parting=/^(?:(?:好(?:的)?|收到(?:了)?|谢谢(?:你)?|嗯{1,3})[，,、。.!！\s]+)?(?:先这样(?:吧)?|先到这里(?:吧)?|先到这儿(?:吧)?|结束(?:这段)?对话|先不聊了|不聊了|回头(?:再)?聊|回头再说|下次(?:再)?聊|晚点(?:再)?聊|等会儿?再聊|先暂停(?:一下)?|暂停(?:一下)?|先放一放|先搁置(?:一下)?|稍后再聊|再见|拜拜|告辞|晚安)[。.!！~～\s]*$/u;
const thanks=/^谢谢(?:你|啦|了)?[。.!！~～\s]*$/u;
const reported=/^(?:[他她它]说|有人(?:说|问过)|刚才有人(?:说|问)|我(?:刚|之前)?问过|我(?:已经|也)?(?:不?知道|不清楚)|我在想|转述|引用)[^？?]*[？?]?$/u;
const collective=/^(?:请问[，,\s]*|问下[，,\s]*)?(?:大家|各位|大伙儿?|群友们?|你们)(?:[，,\s]|都|一起|有|想|觉|看|能|可|要|周|明|今|晚|下)|^(?:有谁|有没有人|有人(?:知道|愿意|会))|(?:想听听大家|你们怎么看)/u;
const title=/^(?:同学|老师|先生|女士|师傅|老板|哥哥?|姐姐?|兄|总|队长|医生)/u;
const vocativeTail=/^(?:[,、:!—–\s]+\S|你(?!们)|您)/u;
const directRequest=/^(?:请|麻烦|拜托|能不能|可不可以|能否|方便(?:的话)?|(?:帮|替|给)(?:我们?|大家)|(?:把|将).{1,40}(?:一下|好[吗么]|可以吗)|(?:再)?(?:发|传|回|看|确认|检查|修改|说|讲)一下|说说|讲讲)/u;
const unknownTitle=/^(?:[小老阿]\p{Script=Han}{1,3}|\p{Script=Han}{0,5}(?:同学|老师|先生|女士|师傅|老板|哥哥?|姐姐?|队长|医生))[,、:!—–\s]+\S/u;
const separateAddress=/^([\p{L}\p{N}·_-]{1,12})[,、:!—–\s]+(?:你(?!们)|您)/u;
const transition=/^(?:那(?:么|好|就)?|还有|再问(?:个问题|一下)?|话说|顺便|对了?|嗯+|好(?:的)?|另外|然后|不过|所以|其实|这么说|这样(?:的话)?|如果这样|请问|请|麻烦|谢谢|刚才|[你您](?:刚才|刚刚)说)$/u;
const speechAttribution=/^(?:刚才|刚刚|之前|刚|先前|今天)?(?:跟我说|告诉(?:我|大家)|转告(?:我|大家)?|提醒(?:我|大家)?|提到|表示|反馈(?:说)?|发消息说|说[了过]?)(?!说|一下|一声|出来)/u;
const earlierReplyQuestion=/(?:[,;。!?、—–]|\n)+\s*((?:那[,、\s]*)?[你您](?:刚才|刚刚|先前|之前|前面|上一(?:句|条|轮|次))[\s\S]*)$/u;
const quotes=/“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"]*"/gu;

function plainAddress(text,memberNames){
  const head=text.normalize('NFKC').toLowerCase().trimStart()
    .replace(/^(?:(?:喂|嘿|嗨|你好|不好意思|打扰一下)[,、:!—–\s]+)+/u,'')
    .replace(/^(?:请问|麻烦)[,、:!—–\s]*/u,'');
  const names=memberNames().map(name=>name.normalize('NFKC').toLowerCase());
  const clauses=names.filter(name=>head.startsWith(name)).map(name=>head.slice(name.length).replace(title,''));
  if(clauses.some(clause=>vocativeTail.test(clause)||directRequest.test(clause.trimStart())))return {blocked:true};
  if(/^[他她]说/u.test(head))clauses.push(head.slice(1));
  const attributions=clauses.filter(clause=>speechAttribution.test(clause));
  if(attributions.length){
    // The name introduces reported speech. Resume only on an independent
    // question about the last reply, never on a question inside a quote.
    if(attributions.length!==1)return {blocked:true};
    const reportedText=attributions[0].replace(speechAttribution,'').replace(quotes,'…');
    if(/[「『“"‘]/u.test(reportedText))return {blocked:true};
    const followup=earlierReplyQuestion.exec(reportedText);
    if(!followup)return {blocked:true};
    const report=reportedText.slice(0,followup.index);
    const lastClause=report.split(/[,;。!?、—–\n]/u).at(-1).trim();
    const namesSomeone=names.some(name=>lastClause.startsWith(name)&&!lastClause.slice(name.length).trim().replace(title,'').trim());
    if(namesSomeone||unknownTitle.test(lastClause+','+followup[1])||!/[\p{L}\p{N}…]/u.test(report))return {blocked:true};
    return {followup:followup[1]};
  }
  const separate=separateAddress.exec(head);
  return {blocked:unknownTitle.test(head)||!!separate&&!transition.test(separate[1])};
}

function closesExchange(text){ return parting.test(text.trim()); }

function requestShape(text){
  // Like the QQ reply gate, quoted questions and acknowledgements are not
  // treated as a new question. Chinese chat does not require a final '?'.
  const spoken=text.replace(quotes,' ').trim();
  if(!spoken||acknowledgement.test(spoken)||closesExchange(spoken)||thanks.test(spoken)||reported.test(spoken)||/^[（(]?转发[）)]?[：:]/u.test(spoken))return null;
  const body=spoken.replace(/[。.!！?？~～]+$/u,'').trim();
  const question=/[？?]$/u.test(spoken)||/(?:吗|么|呢|是不是|行不行|可以不|能不能|可不可以|好不好)$|(?:怎么样|如何|怎么|为什么|几点|什么时候|哪[里儿个天]|多少|要不要|有没有|是不是|能不能|可不可以|愿不愿意|什么(?:建议|想法))/u.test(body);
  const invitation=collective.test(body);
  const prompt=/^(?:请(?:你)?|麻烦(?:你)?|那(?:就|再)?|再|也|接着)?\s*(?:帮我|给我|说说|讲讲|介绍下|继续说|提(?:个|些)建议|聊聊)/u.test(body);
  return question||prompt?{invitation,question}:null;
}

function comparable(text){
  return text.normalize('NFKC').replace(/[\p{P}\s]/gu,'');
}

function implicitReply({message,roles,consents,memberNames,recent,previousExchange,closedThrough,now}){
  if(/[@＠]/u.test(message.text))return null;
  const originalShape=requestShape(message.text);
  if(!originalShape&&!earlierReplyQuestion.test(message.text.normalize('NFKC')))return null;
  const address=plainAddress(message.text,memberNames);
  if(address.blocked)return null;
  const shape=address.followup?requestShape(address.followup):originalShape;
  if(!shape)return null;
  recent=recent();
  const recentEnough=(row,ms)=>{
    const age=now-Date.parse(row?.created);
    return age>=0&&age<=ms;
  };
  // Bothouse keeps the most recent speaker per chat. Here only this human's
  // unaddressed acknowledgements can be skipped before looking for her linked exchange.
  const last=recent.find(row=>row.kind!=='human'||row.sender!==message.sender.number||
    row.mentionAccount||!acknowledgement.test((row.ownBody||'').trim()));
  if(!shape.invitation&&recentEnough(last,CONTINUATION_MS)&&last.kind==='ai'){
    const pair=previousExchange(last.id);
    if(pair&&pair.humanId>closedThrough){
      const role=roles.find(row=>row.number===last.sender);
      if(!role||pair.consentRevision!==consents.get(role.number)||
         comparable(message.text)===comparable(pair.human))return null;
      // The same consenting member is still speaking to the same AI account.
      // A newly approved persona starts a fresh exchange without the old lines.
      if(pair.roleRevision!==role.revision)return {role,text:message.text,implicit:true};
      return {role,text:message.text,implicit:true,previousReply:last.id};
    }
  }
  if(address.followup)return null;
  // An ongoing human exchange has priority. A clear invitation to the group
  // can follow a single human post, but not an observed back-and-forth.
  const lastAi=recent.findIndex(row=>row.kind==='ai');
  const humans=(lastAi<0?recent:recent.slice(0,lastAi)).filter(row=>recentEnough(row,HUMAN_EXCHANGE_MS));
  const followsAnother=humans.some(row=>row.sender!==message.sender.number);
  const humanExchange=humans.some(row=>row.mentionKind==='human'&&
    (row.sender===message.sender.number||row.mentionAccount===message.sender.number))||
    (followsAnother&&humans.some(row=>row.sender===message.sender.number));
  if(humanExchange||(!shape.invitation&&(followsAnother||!shape.question||/^你(?!们)/u.test(message.text))))return null;
  // An explicit end releases only this human's closed exchanges. Another
  // member's recent AI reply still protects the whole room from interruption.
  if(recent.some(row=>{
    if(row.kind!=='ai'||!recentEnough(row,GROUP_COOLDOWN_MS))return false;
    if(!closedThrough)return true;
    const pair=previousExchange(row.id);
    return !pair||pair.humanId>closedThrough;
  }))return null;
  const role=roles.find(row=>consents.has(row.number));
  return role?{role,text:message.text,implicit:true}:null;
}

module.exports={closesExchange,implicitReply};
