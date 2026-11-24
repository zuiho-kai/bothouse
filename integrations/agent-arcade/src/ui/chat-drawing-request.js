'use strict';

(function () {
  const artworkZh = /表情(?:包|图|贴)?|贴纸|贴图|画作|作品|插[画图]|贺(?:卡|图)|海报|壁纸|头像|肖像|漫画|封面|配图|图像|图片|风景画|水彩画|图标|示意图/;
  const artworkEn = /\b(?:stickers?|emoji|emotes?|illustrations?|pictures?|images?|portraits?|posters?|cards?|wallpapers?|drawings?|paintings?|icons?|sketch(?:es)?|cartoons?|artwork|art)\b/i;
  const stickerEn = /\b(?:stickers?|emotes?|emojis?)(?:\s+(?:set|pack|sheet))?$/i;
  const previousDrawingZh = /^(?:你|我们)?(?:上一次|上次|上回|之前|刚才|刚刚|刚|先前|以前|原来|最近)(?:你|我们)?(?:画|绘制)(?:好|完|过了?)?的(?:[那这]?[一1]?[张幅个])?(?:[\p{Script=Han}]{0,12}(?:画作|作品|插画|贺图|海报|头像|贴纸|表情包?|壁纸|图画|图片|[图画]))?(?:吧|呀|嘛)?$/u;
  const savedArtZh = /已(?:有|存|保存)|存过的|上次|之前|以前|刚才|我的(?:表情|作品)库|名[为叫]|叫作?|◇/u;
  const recentImageReferenceZh = /^(?:刚才|刚刚)的?[那这]一?(?:张(?:图(?:片)?|画)?|幅(?:画|图)?)(?:吧|呀|吗)?$/u;
  const savedArtEn = /◇|\b(?:saved|previous|last|earlier|existing|called|named|titled|from (?:the |my )?library)\b/i;
  const galleryZh = /^(?:(?:我|你|这个角色)的)?(?:(?:完整|整个|全部)的?)?(?:图库|(?:角色)?表情库|作品库)(?:[里中]的?(?:所有|全部)?(?:作品|图(?:片)?|表情|插画|贴纸))?$/u;
  const galleryEn = /^(?:(?:my|your|the) )?(?:(?:full|entire) )?(?:(?:art|sticker|image) (?:gallery|library)|gallery)$/i;
  const quoted = /“([^”]+)”|‘([^’]+)’|「([^」]+)」|『([^』]+)』|《([^》]+)》|"([^"]+)"|(?<!\w)'([^']+)'(?!\w)/gu;

  function chineseDrawingKind(description) {
    // A Chinese modifier precedes its head: 水彩风格的贴纸 and 贴纸风格的水彩画.
    const [object] = description.split(/[，,；;。！？!?：:]/u, 1);
    const head = /(?:表情包|表情图|表情贴纸|贴纸|贴图|表情)(?=$|给我|送给|发给|用来|表示|表达|好吗|好不好|可以吗|吧|呢|吗|不要|不用|不带|沿用|参考)/u.exec(object);
    if (!head) return 'illustration';
    const before = object.slice(0, head.index);
    const modifier = /(?:不要|不用|无须|不带|不加|没有|别用|参考|参照|借用|沿用|拿着|贴着|印着|点缀着|包含)[^的]*$/u;
    return modifier.test(before) ? 'illustration' : 'sticker';
  }

  function englishDrawingSubject(description) {
    // In “a sticker of a whale” the subject precedes “of”. Keep quantity phrases intact.
    const noun = description.replace(/^(?:(?:a|one|the)\s+)?(?:set|pack|sheet|pair|collection) of\s+/i, '');
    const [head] = noun.split(/(?:,?\s+)\b(?:of|with|without|using|featuring|showing|holding|wearing|depicting|explaining|based on|inspired by|in|on|by|for|like|that|which)\b|[;:!.?]/i, 1);
    const [first] = head.split(',', 1);
    return (artworkEn.test(first) ? first : head).trim().replace(/,?\s+please$/i, '');
  }

  function unaddress(text, roleName) {
    const role = typeof roleName === 'string' ? roleName.normalize('NFC').trim() : '';
    if (!role) return text;
    const mention = text.startsWith('@') ? text.slice(1) : text;
    const names = role === '橘' || role === '橘娘' ? ['橘娘','橘'] : [role];
    const address = names.find(name => mention.slice(0, name.length).toLowerCase() === name.toLowerCase());
    if (!address) return text;
    return mention.slice(address.length).replace(/^[\s,，、:：!！]+/u, '');
  }

  function lookupName(text) {
    const match = [...text.matchAll(quoted)][0];
    let name = match ? match.slice(1).find(Boolean) : undefined;
    if (!name) {
      const title = /(?:名[为叫]|叫作?|名字是)\s*(.+?)(?:的(?:那张|这张)?(?:表情包?|贴纸|图片|作品))?$|(?:named|called|titled)\s+(.+)$/iu.exec(text);
      name = title?.[1] || title?.[2];
    }
    name = name?.trim();
    return name && Array.from(name).length <= 40 ? {kind:'lookup', name} : {kind:'gallery'};
  }

  function lookup(text, plain) {
    const zh = /^(?:我想(?:要)?|请(?:你)?|麻烦你?)?(?:可以|能不能|能否)?(?:帮我|给我|让我|再)?(?:再)?(?:按名(?:字)?|按名称)?(?:看(?:一下|看)?|查找|找(?:一下|一找|找|出)?|打开|调出|展示)(.+)$/u.exec(plain);
    const inverted = /^(?:请(?:你)?|麻烦你?)?把(.+?)(?:给我|让我)(?:再)?看(?:一下|看)?(?:吧|呀)?$/u.exec(plain);
    const subject = zh?.[1] || inverted?.[1];
    if (subject) {
      if (galleryZh.test(subject)) return {kind:'gallery'};
      if (subject.includes('◇') && (/按名/u.test(plain) || /图库|表情库|作品库/u.test(subject))) return lookupName(text);
      if (previousDrawingZh.test(subject) || recentImageReferenceZh.test(subject)) return {kind:'recent'};
      if (savedArtZh.test(subject) && artworkZh.test(subject)) return lookupName(text);
    }
    const en = /^(?:please\s+)?(?:(?:can|could|would) you (?:please )?)?(?:show(?: me)?|find|look up|open|pull up|let me see)\s+(.+)$/iu.exec(plain);
    if (en) {
      const subject = en[1];
      if (galleryEn.test(subject)) return {kind:'gallery'};
      const previous = /\byou (?:drew|painted|sketched|made)\b/i.test(subject);
      if ((previous && /\b(?:what|one)\b/i.test(subject)) ||
          (artworkEn.test(subject) && (previous || savedArtEn.test(subject) || /\byou saved\b/i.test(subject)))) {
        if (!/◇|\b(?:called|named|titled)\b/i.test(subject) && (previous || /\b(?:last|previous|earlier)\b/i.test(subject))) return {kind:'recent'};
        return lookupName(text);
      }
    }
    return null;
  }

  function nonDrawingFollowup(clause) {
    // Once an explicit order is present, commas can continue the scene without
    // naming a familiar object. Look for a change in the requested action.
    const part = clause.replace(/^(?:但(?:是)?|不过|而且|并且|另外|请|but\b|and\b)\s*/iu, '');
    const request = /(?:^|(?:之后|随后|接着|然后|顺便|另外|再)(?:你|就|先|帮我|给我)*)(?:麻烦(?:你)?|请(?:你)?|先|帮我|给我|能不能|可不可以)*(?:答复|回答|回复|告诉我|解释|讲讲|聊聊|讨论|查找|查一下|找(?:一下|现成|一?[张幅个])|发(?:给|到)|转发|另画|再画|再生成|写(?:个|一[段份篇])|列(?:一下|出|[一两二三四五六七八九十几\d])|算(?:算|一下)|估(?:估|一下)|报价)/u;
    const question = /(?:怎么|如何|什么时候|什么(?:材料|步骤|工具|技巧)|哪些(?:材料|步骤|工具)|几点|多少(?:钱|费用|时间)|(?:什么|啥)意思|要我(?:先|怎么)|我再决定|^你(?:觉得|知道))/u;
    const hold = /(?:^|(?:还是|这次|本次|今天|暂时|先|就))(?:(?:就|先|暂时|还是|不如)*(?:算了|停一下|等等|暂缓|取消(?:吧|了)?$|不画了|别画了|聊到这)|(?:暂时|先)不(?:着急|动笔|画)|(?:只|仅)(?:需(?:要)?|要|给我)?(?:文字方案|建议|提示词))/u;
    const condition = /^(?:假如|假设|如果|倘若|是否|会不会|能不能|要不要)|(?:了|好)再(?:开始|动手|画|出图|生成)/u;
    const omitDrawing = /^(?:不要|不用|别)(?:再|急着|开始)?(?:(?:发|出|做|生成|绘制)?(?:图片|图像|成图|图)(?:了|吧|啦|呀|啊|只要|就好|就行|$)|画(?:图)?(?:了|吧|啦|呀|啊|$))/u;
    const english = /(?:^|\b(?:actually|then|before|afterwards|instead)\b[ ,]*)\s*(?:(?:please|first|just|only)\s+)*(?:wait|hold off|stop|forget it|cancel|never mind|let['’]s|tell me|explain|answer|reply|discuss|find me|send it|draft|quote|check|how|what|when|which|(?:can|could|would) you)\b|\b(?:only need|no (?:image|drawing)(?: yet)?$|if you|until I)\b/i;
    return request.test(part) || question.test(part) || hold.test(part) ||
      condition.test(part) || omitDrawing.test(part) || english.test(part) ||
      /^(?:just|only) (?:the |an? )?(?:image |drawing )?prompts?\b/i.test(part);
  }

  // Captions and quoted artwork names are literal content.
  function drawingIntentText(text) {
    return text.replace(quoted, '◇');
  }

  function awaitsDrawingPermission(text) {
    // An execution condition has both a trigger and a later drawing action.
    // A wait inside the pictured subject is not itself an execution condition.
    const trigger = /(?:(?:^|[，,。；;:：])\s*(?:(?:请(?:你)?|先|还是)\s*)?(?:等(?:到|候)?|待(?:到)?|直到|只有|必须(?:等)?|除非|如果|要是|(?:我(?:们)?)?(?:确认|同意|批准|点头|签字)(?:了|好|完)?)|(?:等(?:到|待)?|待)(?=我(?:们)?(?:说|发|给|开口|点(?:个)?头|确认|通知|批准|同意|回[复话]))|(?:收到|听到|得到)(?:我(?:们)?的)?(?:口令|指令|许可|通知|确认|◇))/gu;
    const laterDrawing = /^[^，,。！？!?；;]{0,64}?(?:(?:之后|以后|后)[，,\s]*(?:就|再|才(?:能够?|可以)?|方可)?|[，,\s]*(?:就|再|才(?:能够?|可以)?|方可))\s*(?:开始(?=$|[，,。！？!?；;])|(?:开始)?(?:画(?:图)?|绘制|绘图|出图|生图|生成)|动笔|动手|下笔|落笔|开画|开工)(?!得|着|面|的|画的)/u;
    const waitForUser = /(?:^|[，,。；;:：])\s*(?:请(?:你)?|先|还是)?(?:等(?:待)?|待)\s*(?:我|我们|这边)(?:的(?:口令|确认|批准|通知|许可)|(?:再|明确)?(?:开口|发话|点头|确认|同意|批准|通知|(?:给|发)(?:个|个明确的)?(?:口令|指令)|说(?:一声)?\s*(?:◇|开始|开画|动笔|可以(?:画)?|好了)))(?:一下|吧|哈|再说)?\s*(?=$|[，,。！？!?；;])/u;
    const english = /\b(?:wait for (?:my|our) (?:go-ahead|approval|confirmation)|(?:once|after|until) (?:i|we) (?:say|tell you) (?:go|start|to start|to draw)|(?:do not|don't) (?:start|draw|generate) until)\b/i;
    return waitForUser.test(text) || english.test(text) || [...text.matchAll(trigger)].some(match=>
      laterDrawing.test(text.slice(match.index + match[0].length)));
  }

  function asksDrawingPrice(text) {
    // Require a request or question about the price, not a pictured fee list.
    const estimate = /(?:报|估)(?:个|一下|下|一个大概的)价|(?:先|只|请|帮我|麻烦|给我)(?:报|询|估)价|(?:^|[，,。；;])\s*(?:报|询|估)价(?=$|[吧嘛？?，,。])|预算多少|多少钱|怎么(?:收费|计费)/u;
    const request = /(?:^|[，,。；;:：]|(?:之前|以前|前)?先|请只|只要|顺便)(?:\s|先|麻烦(?:你)?|请(?:你)?|帮我|给我|只|仅)*(?:(?:报|估|算|核算|列|说明|说|讲|告诉我|给我|发我|问)(?:说|讲|算|一下|一声|个|一份|下|我|大概|大致|下这次的|这次的|预计(?:的)?|预估(?:的)?|生成(?:这张图)?的|绘图的|生图的|所需(?:的)?|需要(?:的)?|总(?:共)?|要多少|会产生的|\s)*(?:费用|价格|成本|预算|报价|收费(?:标准)?|计费(?:方式)?|(?:剩余|消耗的)?(?:次数|额度))|(?:需要|要|会收|得花)?(?:多少|几)(?:费用|元|块|积分|点数))/u;
    const question = /(?:费用|价格|成本|收费|计费|预算)(?:大概|一共|总共|预计|会|会是|是|要)?(?:多少|怎么算|怎么收|如何计算|怎么样|贵不贵)|(?:什么|哪个)(?:价位|价格)/u;
    const objectFirst = /(?:先|只|请|麻烦)(?:把|将)(?:[\p{Script=Han}\s]{0,16})(?:费用|价格|成本|预算|报价|收费标准|(?:生图|绘图|剩余)?(?:次数|额度))(?:先|再|就|都|单独)?(?:说|报|列|发|告诉|给)(?:一下|一声|给我|我)/u;
    // Spoken questions can front the topic or omit the units or the verb:
    // “次数先确认”, “要扣几次”, or simply “先说下”.
    const chargeTopic = /(?:费用|价钱|价格|成本|预算|报价|收费(?:标准)?|计费(?:方式)?|(?:剩余|生成|绘图|生图|收费|计费|扣除)?次数|(?:剩余|绘图|生图)?额度|积分|点数)/u;
    const asksBeforeDrawing = /^(?:这(?:次|单|活|张图?)?|画这张图|生图|绘图|生成(?:图片)?)(?:的|要)?/u;
    const topicRequest = /^(?:的|嘛|呢|的话|这块|方面)?\s*(?:(?:我想|你|能不能|可以|可否|麻烦|请|咱们)?\s*(?:请|先|只|仅|单独))?(?:说|讲|报|问|看|查|算|估|确认|告诉|给|列|多少|几次|怎么|如何|贵不贵|够不够|(?:还剩|还有|要扣)(?:多少|几))|^(?:先|呢|呢先|多少|几次)?[\s?？。！!]*$/u;
    const shortRequest = /^(?:(?:你|我们|咱们)?(?:麻烦|请)?先(?:说|讲|问|报|查|谈|确认)(?:一下|一下再说|下|一声|个)?|(?:先(?:看|算|查)(?:看|算|查|一下)?\s*)?(?:会|要|需要|得|总共)?(?:还剩|还有|剩下|消耗|扣(?:掉|除)?|用掉|算(?:作)?|花|用)?(?:多少(?:次|额度|积分|点数)|几次|几(?:个|点)?(?:额度|积分|点数)))(?:呢|吧|吗)?[\s?？。！!]*$/u;
    const topicFirst = text.split(/[，,。;；！!：:]+/u).some(clause=>{
      const detail = clause.trim().replace(asksBeforeDrawing, '');
      const topic = chargeTopic.exec(detail);
      return shortRequest.test(detail) || (topic?.index === 0 && topicRequest.test(detail.slice(topic[0].length)));
    });
    const english = /(?:^|[,;.!]|\bfirst\b)\s*(?:(?:please|first|just|only)\s+)*(?:(?:give me|tell me|show me|send me)\s+(?:an? |the |your )?(?:price|cost|fee|estimate|quote)|(?:estimate|quote)\s+(?:me |the )?(?:price|cost|fee|budget)|what (?:would it cost|is the (?:price|fee)))/i;
    return estimate.test(text) || request.test(text) || question.test(text) ||
      objectFirst.test(text) || topicFirst || english.test(text);
  }

  function explicitDrawingHold(plain) {
    const cancel = /(?:取消|撤回|撤销)(?:(?:刚才|刚刚|这次|这张|这条|本次|之前)的?)?(?:生图|出图|生成|绘图|画图|请求)/u;
    const postpone = /(?:稍后|晚点|回头|以后)再(?:出图|生成|动笔|画)|(?:别|不用|不要|不)(?:再|急着|开始)?(?:生图|出图|动笔|发图|生成(?!式|器))|(?:不用|不要|别|不)(?:再)?画(?:图)?(?:这[张幅次]|它|了|啦|吧|哈|呀|啊|$|[，,。；;！!?？])/u;
    const words = /(?:只|仅)(?:需(?:要)?|要|用|给(?:我)?|发(?:给我)?|回(?:复)?(?:我)?)?(?:文字(?!排版)|(?:构图|绘图|画面|配色|创作)(?:建议|方案)|(?:绘图|绘画|生图|画图)?提示词)/u;
    return awaitsDrawingPermission(plain) || asksDrawingPrice(plain) ||
      cancel.test(plain) || postpone.test(plain) || words.test(plain);
  }

  function wantsChatAboutDrawing(plain) {
    if (explicitDrawingHold(plain)) return true;
    const [subject, ...directions] = plain.split(/[，,。;；！!?？—]+|[.:：](?!\d)|不过|但是|\s+\bbut\b\s+/iu)
      .map(part => part.trim()).filter(Boolean);
    if (!subject) return true;
    // In an undivided sentence, inspect the predicate after the drawing topic:
    // the requested deliverable can itself be advice, an estimate or a prompt.
    const written = /的(?:绘图|绘画|生图|画图)?(?:提示词|建议|方案|教程)(?:就(?:好|行|够了)|即可|就可以|而已)?$/u;
    const discussion = /(?:之前|以前|前)先|(?:要|该|得|需要|应该)(?:怎么|如何)|(?:怎么|如何)(?:准备|操作|开始)|(?:有|需(?:要)?|得用|要用|分为|要)(?:经过|用到|准备)?(?:哪些|哪几[个道种步]?|什么)(?:步骤|流程|工具|材料|方法|技巧)|(?:要|得|会|需(?:要)?)(?:花(?:费)?|用|耗时)?(?:多久|多长时间|多少|几(?:分钟|个?小时|天))/u;
    const process = /(?:等我|待我).*(?:再画|再生成)|先(?:说|告诉|报|估|写|讲|给).*(?:预算|价|费用|提示词|思路|建议)|(?:先不|暂时不|先别|取消)(?:画|生成|出图|动笔)|(?:只|仅)(?:回|讨论|要文字|用文字回)|(?:要|得|需|花|收)(?:花费?)?(?:几|多少)(?:块|元|钱)/u;
    const discussionEn = /\b(?:before (?:you|drawing)|after I (?:approve|confirm)|wait (?:until|for)|what (?:steps|tools|materials)|how (?:do|would|can|should) I)\b/i;
    return written.test(subject) || discussion.test(subject) || process.test(subject) ||
      discussionEn.test(subject) || directions.some(nonDrawingFollowup);
  }

  function classify(text, roleName = '橘娘') {
    if (typeof text !== 'string') return null;
    const input = text.normalize('NFC').trim();
    if (!input || Array.from(input).length > 500 || /\p{Cc}/u.test(input)) return null;
    const request = unaddress(input, roleName).replace(/[。.!！？?]+$/u, '').trim();
    // Ignore quoted captions when deciding what the caller is actually asking for.
    const plain = drawingIntentText(request)
      .replace(/^我(?:已经|已)?(?:同意|确认|批准)了?[，,。！!]\s*/u, '')
      .replace(/^现在(?:就|开始)?(?=请|帮我|给我|画|绘制|生成|制作|设计)/u, '');
    if (/(?:的话|为什么|怎么(?:说|翻译|收费|计费|画)|多少钱|要(?:多久|多长时间)|需要什么工具|算不算|这句(?:话|请求)|是.{0,8}(?:原话|例句)|难不难|(?:难|容易)[吗么]|有多难|是(?:什么意思|什么感觉))/.test(plain) ||
        /\b(?:mean in|cost (?:much|money)|how (?:much|long)|if (?:I|you|we)|as an example of)\b/i.test(plain)) return null;
    const old = lookup(request, plain);
    if (old) return old;

    if (wantsChatAboutDrawing(plain)) return null;

    const transformed = /^(?:请(?:你)?|麻烦(?:你)?)?(?:帮我|给我|为我)?把.+?(?:画|绘制|制作|做|设计|生成)成(.+)$/u.exec(plain);
    if (transformed && artworkZh.test(transformed[1])) {
      return {kind:chineseDrawingKind(transformed[1])};
    }
    const zh = /^((?:(?:我想请你|我想让你|请(?:你)?|麻烦(?:你)?|拜托(?:你)?)\s*)?(?:(?:你)?(?:能不能|可不可以|能否|可以|能)\s*)?(?:(?:帮我|给我|替我|为我)\s*)?(?:再|重新)?)(画|绘制|绘画|绘|设计|制作|做|生成|创作)(.+)$/u.exec(plain);
    if (zh) {
      const [, direct, verb, rest] = zh;
      if (/^(?:的|过|得|画|法|面|家|展|里|中|风格|不|一下怎么)/u.test(rest)) return null;
      if (!direct && /(?:真的|太|很|非常|特别)(?:费|难|累|贵|简单|容易|耗时)|[，,]\s*(?:我|他|她)(?:觉得|认为)/u.test(rest)) return null;
      const measured = /^(?:一?[张幅个只套组]|[两二三四五六七八九十]\s*[张幅个只]|出)/u.test(rest);
      const draw = /^(?:画|绘制|绘画|绘)$/u.test(verb);
      if ((direct || measured) && (draw || artworkZh.test(rest))) {
        return {kind:chineseDrawingKind(rest)};
      }
    }
    const en = /^(?:please\s+)?(?:(?:(?:can|could|would|will) you|i['’]d like you to|i want you to)\s+(?:please\s+)?|help me\s+)?(draw|paint|sketch|illustrate|design|create|make|generate)\s+(?:me\s+)?(.+)$/iu.exec(plain);
    if (en && !/^(?:well|at all|better|by hand|for a living|(?:a |the )?conclusions?\b|attention to|lots\b)/i.test(en[2])) {
      const subject = englishDrawingSubject(en[2]);
      if (/^(?:draw|paint|sketch|illustrate)$/i.test(en[1]) || artworkEn.test(subject)) {
        return {kind:stickerEn.test(subject) ? 'sticker' : 'illustration'};
      }
    }
    return null;
  }

  const api = {classify, drawingIntentText, explicitDrawingHold, wantsChatAboutDrawing};
  if (typeof window !== 'undefined') window.ArcadeChatDrawingRequest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}());
