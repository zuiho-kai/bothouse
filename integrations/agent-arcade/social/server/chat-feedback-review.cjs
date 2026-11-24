'use strict';

// The QQ audit separates product subjects from observations and suggestions.
// Assess the subject and current status of each clause before adding a topic.
const arcade = /Agent Arcade|(?:这个|咱们的|我们的)\s*App|橘娘|鲸鱼娘|龙娘/iu;
const product = /\b(?:App|AI|bot)\b|软件|客户端|应用|搭档|机器人/iu;
const channel = /微信|\b(?:QQ|WeChat)\b/iu;
const nativeChannel = /(?:微信|\b(?:QQ|WeChat)\b)\s*(?:自己|本身|自带|客户端|语音功能|原生)/iu;
const namedCapability = /^(?:(?:我(?:这边)?\s*)?(?:在|用|通过|打开)\s*)?([a-z][a-z\d_.+-]{1,31})\s*(?:的|里|上|内)?\s*(?=App|客户端|软件|平台|语音|录音|麦克风|图片|照片|表情包|登录|发语音|recording|voice|login)/iu;
const namedTool = /^(?:(?:我(?:这边)?\s*)?(?:在|用|通过|打开)\s*)?([\p{Script=Han}]{2,14}?)(?:(?:这款|那个)?\s*(?:客户端|软件|平台|App\b)|的\s*(?=录音|麦克风|语音|上传|图片|照片|登录|消息|表情包))/iu;
const otherTool = /(?:另一款|另一个|别的|其他|第三方|外部|他们的|那款)(?:.{0,8})?(?:App\b|软件|应用|客户端|平台)/iu;
const localQualifier = /^(?:app|ai|bot|tts|asr|api|搭档|机器人|这个|这个群|这个应用|咱们|我们的?|我的?|这边|我这边|本机|这里|本群|群里|群聊|私聊|当前|上传|生成|下载|内置|默认)$/iu;
const feature = /按钮|设置|输入框|登录|注册|上传|转写|生成图|未读|草稿|角色卡|世界书|画图失败/iu;
const technicalAction = /(?:发|传|录|播|听|收).{0,5}语音|语音.{0,7}(?:发|传|录|播|听|收|失败|报错|转写)|录音|麦克风|没(?:有)?声音|上传(?:图片|照片)|(?:加|添加)好友|[拉建退]群/iu;
const symptom = /报错|异常|不生效|用不了|不(?:能|会|回|显示|保存|准确|正常)|没有(?:回复|回应|声音)|没(?:回|认|接|收到|保存|显示|记住|录上|录到)|听不[清见]|发不[出掉了]|搜不[到出]|失[败效]|无响应|打不开|登不上|卡[住顿死]|闪退|黑屏|超时|掉线|丢了|重复|串[线了]|错[了字]|太(?:长|短|啰嗦|慢|多|少)|总是引用|\b(?:fails?|broken|doesn.t work|crash(?:es)?|too (?:long|short|slow))\b/iu;
const pendingRecovery = /(?:(?:仍(?:然)?|还(?:是)?|尚|一直|至今)\s*)?(?:并未|并没有|没有|没|未(?:能)?|未曾|没能|不能|无法)(?:完全|真正|彻底)?\s*(?:恢复|修复|修好|解决)|(?:恢复|修复|修好|解决)(?:不了|失败)|(?:仍然?|还是|依然|仍旧)\s*(?:有问题|不正常|坏的)|\b(?:not (?:yet )?(?:fixed|working)|still broken)\b/iu;
const suggestion = /建议|希望|能否(?:增加|支持|改进)|可不可以(?:增加|支持|改进)|最好(?:能|可以)|should (?:add|support|fix)/iu;
const resolved = /(?<!不是)(?<!并非)(?:修复了|修好了|问题解决了|恢复(?:正常|了)|正常了|(?:现在|已(?:经)?|后来|目前)\s*(?:已经|总算|终于)?\s*(?:都|就|能)?(?:恢复|正常|修复|修好|解决|用得好)|(?:用着|运行|功能)(?:很|挺|都)?正常|没(?:有)?(?:任何|再)?(?:问题|故障|异常|报错|出错)|不再(?:报错|出错|失败|卡住)|\b(?:fixed now|working again)\b)/iu;
const genericFault = /报错|异常|有故障|出了?问题|不生效|用不了|无响应|打不开|闪退|黑屏|超时|掉线|卡[住顿死]|太卡|坏了|\b(?:fails?|broken|crash(?:es)?)\b/iu;
const denial = /(?:并|可)?不是.{0,5}(?:坏了|故障|问题|异常|报错|不正常|不生效|打不开|发不出|没有声音|没有回复)/u;
const resumedAction = /(?:后|现在|后来|这下|已经|重开|重启|刷新)\s*(?:(?:就|才|又|终于|总算|也|已经|都)\s*)*(?:能(?:够)?|可以|成功)\s*(?:发|上传|播|录|接收|打开|登录|显示|用).{0,16}(?:了|成功|正常)$/u;
const conditionalRecovery = /如果|假如|试试|能不能|会不会|是否|是不是|也许|可能|应该|[吗么]\s*$/u;
const attribution = /(?:说|问|抱怨|吐槽|回复|写道|提到|转述|said|asked|wrote)\s*[:：]|^[^\s,]{1,20}(?:说|提到|抱怨|吐槽|问)(?:过)?(?:\s+(?=\S)|(?=他|她|其|自己|那边|那款))/iu;
const reported = /^(?:听说|据说|转述|转发|引用|听别人说|(?:同事|朋友|室友|同学|群友|有人|别人|对方|他|她|他们|她们).{0,8}(?:说|提到|抱怨|吐槽|反映|反馈))/u;
const ordinaryRequest = /^(?:(?:搭档|橘娘|鲸鱼娘|龙娘)\s*[,、]?\s*)?(?:请|帮我|能不能|可不可以|可以|能否)\s*(?:给我|帮我|用语音)?\s*(?:发(?:个|一[段条张])|说(?:句|一[句话])|画(?:个|一张)|讲讲)/u;
const quoted = /“[^”]*”|「[^」]*」|『[^』]*』|‘[^’]*’|《[^》]*》|"[^"]*"|`[^`]*`|^\s*>[^\n]*/gmu;

const topics = [
  ['登录与账号', /登录|登陆|注册|密码|账号切换|\b(?:login|password)\b/iu],
  ['好友与群管理', /加好友|好友申请|好友邀请|添加朋友|用户号|建群|拉群|退群|群成员|群权限/iu],
  ['回复长度与形式', /(?:回[复答]|说话|字数|篇幅).{0,8}(?:长|短|啰嗦|截断)|重复引用|引用框|总是引用|只用文字/iu],
  ['消息投递与回复', /发消息|发不出去|回[复答]|接话|抢答|不回|没回|收不到消息|重复发送/iu],
  ['草稿与未读', /草稿|未读|已读/iu],
  ['语音与录音', /语音|录音|麦克风|音色|转写|播报|声音/iu],
  ['图片与表情', /图片|照片|看图|表情包|贴图|画图|生成图|出图|生图/iu],
  ['查找公开资料', /网页搜索|联网搜索|公开搜索|网上查|搜索结果|网页链接/iu],
  ['记忆与角色', /记忆|前文|上下文|角色卡|世界书|人设|记不住|串线/iu],
  ['主动联系与提醒', /主动联系|主动发消息|提醒|预约|定时|通知/iu],
  ['安装与使用', /安装|更新|按钮|输入框|设置|界面|闪退|卡顿|黑屏|窗口/iu]
];

const otherTopic = '其他 App 或搭档问题';
const explicitDelivery = /(?:文字|文本|普通)消息|聊天消息|发消息|回[复答]|接话|抢答|不回|没回|收不到消息|重复发送/iu;
const featureSubjects = {
  '语音与录音':[/语音|音色|转写|播报/u,/录音/u,/麦克风/u],
  '图片与表情':[/图片|照片|看图/u,/表情包|贴图/u,/画图|生成图|出图|生图/u]
};

function externalSubject(line) {
  if (channel.test(line)) return !arcade.test(line)||nativeChannel.test(line);
  if (otherTool.test(line)) return true;
  if (arcade.test(line)) return false;
  // A restart verb changes the reported state, not the name of the app.
  const subject=line.replace(/^(?:我(?:这边)?\s*)?(?:重开|重启|刷新|重新打开)\s*/u,'');
  const named=namedCapability.exec(subject)??namedTool.exec(subject);
  return !!named&&!localQualifier.test(named[1]);
}

function topicsIn(line) {
  const specific = topics.filter(([,pattern])=>pattern.test(line)).map(([label])=>label);
  const specificMedia = specific.some(label=>Object.hasOwn(featureSubjects,label));
  return specific.filter(label=>{
    if (label==='安装与使用' && specific.length>1)
      return /安装|更新|闪退|卡顿|黑屏|窗口/u.test(line);
    if (label==='消息投递与回复' && specificMedia && !explicitDelivery.test(line)) return false;
    if (label==='消息投递与回复' && specific.includes('回复长度与形式'))
      return /没回|不回|没接话|发不出|收不到|重复发送/u.test(line);
    return true;
  });
}

function subjectsIn(line,labels) {
  return labels.flatMap(topic=>{
    const features=(featureSubjects[topic]??[]).flatMap((pattern,index)=>pattern.test(line)?[index]:[]);
    return (features.length?features:[null]).map(feature=>({topic,feature}));
  });
}

function problemTopics(text) {
  const open = new Map();
  let focus=[];
  let foreign=false;
  for (const sentence of text.normalize('NFKC').replace(quoted,' ').split(/[。！？!?；;\n]+/u)) {
    // Attribution can apply beyond a comma, but a contrast may introduce
    // the author's own observation or a different feature.
    const statements=sentence.split(/(?:但是|不过|可是|然而|(?<=,)但|反倒|结果(?=我|却|还|仍))/u);
    for (const [position,statement] of statements.entries()) {
      if (position>0) foreign=false;
      let attributed=false;
      for (const piece of statement.split(/[,，]/u)) {
        const line=piece.trim();
        if (!line) continue;
        if (attribution.test(line)||reported.test(line)) attributed=true;
        if (!attributed) {
          if (externalSubject(line)) foreign=true;
          else if (arcade.test(line)||/往这里|在这里|在本群|我们这个群/u.test(line)) foreign=false;
        }
        if (attributed||foreign) { focus=[]; continue; }
        const labels=topicsIn(line);
        const subjects=subjectsIn(line,labels);
        const pending=pendingRecovery.test(line);
        const resumed=resumedAction.test(line)&&!conditionalRecovery.test(line);
        if (!pending&&(resolved.test(line)||denial.test(line)||resumed)) {
          const named=subjects.length ? subjects : focus.length===1||/都|全部|全都|两样|两项/u.test(line)?focus:[];
          for (const [key,issue] of open) {
            if (named.some(item=>item.topic===issue.topic&&(item.feature===null||item.feature===issue.feature)))
              open.delete(key);
          }
          focus=[];
          continue;
        }
        const subjectAnchored=arcade.test(line)||product.test(line)||feature.test(line)||technicalAction.test(line);
        const mediaFailure=labels.some(topic=>Object.hasOwn(featureSubjects,topic))&&/发不了|发不出|没发出去|发送失败/iu.test(line);
        const canContinue=pending&&focus.length===1;
        if (ordinaryRequest.test(line)||(!pending&&!symptom.test(line)&&!genericFault.test(line)&&!suggestion.test(line))||
          !(subjectAnchored||mediaFailure||canContinue||pending&&subjects.length)) {
          focus=[];
          continue;
        }
        if (subjects.length) focus=subjects;
        else if (!canContinue) focus=genericFault.test(line)||suggestion.test(line)?[{topic:otherTopic,feature:null}]:[];
        for (const subject of focus) open.set(subject.topic+'/'+subject.feature,subject);
      }
    }
  }
  return new Set([...open.values()].map(subject=>subject.topic));
}

function count(bucket,chat) {
  bucket.messages++;
  bucket.chats.add(chat);
}

function chatFeedbackReview(db,account) {
  // Same current-membership floor as the ordinary history endpoint. One
  // statement reads all stored pages at a single SQLite snapshot.
  const messages = db.prepare(`SELECT m.chat,c.type,m.body
    FROM members viewer JOIN chats c ON c.id=viewer.chat JOIN messages m ON m.chat=c.id AND m.id>viewer.since
    WHERE viewer.account=? AND m.sender=? AND c.type IN ('group','direct') AND m.removed=0 AND m.body<>''
      AND NOT EXISTS(SELECT 1 FROM message_voices WHERE message=m.id)
      AND NOT EXISTS(SELECT 1 FROM message_images WHERE message=m.id)`);
  const issues=new Map();
  let scannedMessages=0;
  for (const message of messages.iterate(account,account)) {
    scannedMessages++;
    for (const topic of problemTopics(message.body)) {
      if (!issues.has(topic)) issues.set(topic,{
        messages:0,chats:new Set(), group:{messages:0,chats:new Set()}, direct:{messages:0,chats:new Set()}
      });
      const bucket=issues.get(topic);
      count(bucket,message.chat);
      count(bucket[message.type],message.chat);
    }
  }
  const counts=bucket=>({messages:bucket.messages,conversations:bucket.chats.size});
  const categories=[...issues].sort(([a,x],[b,y])=>y.messages-x.messages||y.chats.size-x.chats.size||a.localeCompare(b,'zh'))
    .map(([topic,bucket])=>({topic,...counts(bucket),group:counts(bucket.group),direct:counts(bucket.direct)}));
  return {scannedMessages,categories};
}

module.exports = {chatFeedbackReview,reviewTopics:new Set([...topics.map(([label])=>label),otherTopic])};
