'use strict';

const {publicWebRequest}=require('../../src/bot/qq-public-lookup.cjs');
const {publicReactionIntent}=require('./public-reactions.cjs');

const privateTopic=/(?:[我你他她]的|本人|家人|老板|客户|同事|同学|公司内部|暗号|口令|凭据|门禁|聊天|私密|秘密|保密|这条消息|上一条|截图|附件|上传)|(?:https?:|www\.|\b(?:internal|confidential|credential|passphrase)\b)/iu;

const searchLead=/^(?:(?:请问|请|麻烦|能不能|可不可以|能否|可以|帮我|帮忙|替我|我想|你|上网|联网|网上|在网上)\s*)*(?:搜索|搜一搜|搜|查找|查一查|查询|查|找一找|找|检索)(?:一下)?[：:\s]*(.+)$/su;
const privateReference=/用户(?:号|名|编号|id)|账号|帐号|账户(?:名|号)|微信号|qq\s*号|群(?:号|友|成员|里|内)|本群|这个群|私聊|私信|对话记录|聊天记录|通讯录|联系(?:方式|电话)|手机号|刚才|刚刚|刚发|前面那|上(?:一|几)[轮条段]|\b(?:user\s*id|username|account\s*(?:id|number)|private\s*(?:chat|message))\b/iu;
const normalize=text=>text.normalize('NFKC').toLowerCase();

function matchesMember(store,chat,target){
  const normalized=normalize(target);
  const accountTokens=new Set(normalized.match(/[a-z0-9_]+/gu)??[]);
  const nameTokens=new Set(normalized.split(/[^\p{L}\p{N}\p{M}]/gu));
  const bound=store.all(`SELECT u.number,u.name FROM members m
    JOIN users u ON u.number=m.account WHERE m.chat=? AND u.kind='human'`,chat);
  return bound.some(({number,name})=>{
    const label=normalize(name).trim();
    return accountTokens.has(number)||label&&(normalized===label||nameTokens.has(label)||
      normalized.includes(label+'的')||(/\p{Script=Han}/u.test(label)&&label.length>=3&&normalized.includes(label)));
  });
}

function privateWebLookup(store,chat,text){
  text=text.trim();
  // Historical messages can include a typed address, while a native mention
  // stores the target separately. In both cases classify only the request.
  if(!searchLead.test(text)){
    const addressed=/^[@＠]?[\p{L}\p{N}_·-]{1,48}[，,、：:\s]+([\s\S]+)$/u.exec(text);
    if(addressed&&searchLead.test(addressed[1]))text=addressed[1];
  }
  const subject=searchLead.exec(text)?.[1];
  if(subject===undefined)return false;
  if(publicReactionIntent(text)?.private)return false; // Owned by the existing image privacy path.
  const request=publicWebRequest(text,{plainSearch:true});
  return privateReference.test(normalize(text))||privateTopic.test(request?.query??subject)||
    matchesMember(store,chat,subject);
}

function markPrivateWebLookup(store,chat,id,text){
  if(!privateWebLookup(store,chat,text))return false;
  store.run('INSERT OR IGNORE INTO local_web_search_messages VALUES(?)',id);
  return true;
}

module.exports={markPrivateWebLookup};
