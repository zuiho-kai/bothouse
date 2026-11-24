'use strict';

// The agent assigns labels. The worker constructs the deliverable from the original
// items, so a completion claim, missing item or invented entry cannot be handed back.
function partitionRequest(text){
  const match=/^([^：:\n]{1,180})[：:\n]([\s\S]+)$/u.exec(text.trim());
  if(!match||!/(分类|分组|归类)/u.test(match[1]))return;
  const items=match[2].split(/[；;\n]+/u).map(line=>line.trim()).filter(Boolean);
  if(items.length<2||items.length>40)return;
  return {items,prompt:'根据任务为每项选一个简短类别。按输入顺序只交回 JSON 字符串数组，每项一个类别。\n'+
    JSON.stringify({instruction:match[1],items})};
}
function partitionArtifact(items,answer){
  const labels=JSON.parse(answer);
  if(!Array.isArray(labels)||labels.length!==items.length)throw Error('Missing category assignments');
  const groups=new Map();
  for(const [index,label] of labels.entries()){
    if(typeof label!=='string'||!label.trim()||label.length>32||/[\u0000-\u001f]/u.test(label))
      throw Error('Invalid category');
    const key=label.trim();
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(items[index]);
  }
  const text=Array.from(groups,([label,rows])=>label+'：'+rows.join('、')).join('\n');
  if(Array.from(text).length>3000)throw Error('Deliverable is too long');
  return text;
}
function textTask(text){
  const list=partitionRequest(text);
  if(list)return {prompt:list.prompt,render:answer=>partitionArtifact(list.items,answer)};
  if(!/(?:起草|拟一份|写一份|列出)[^？?]*(?:稿|文案|提纲|计划|清单|通知|安排)/u.test(text))return;
  return {prompt:'只交付文字草案本身。返回 JSON 对象 {"title":"标题","paragraphs":["正文段落"]}。任务如下。\n'+text,
    render(answer){
      const {title,paragraphs}=JSON.parse(answer);
      if(typeof title!=='string'||!title.trim()||!Array.isArray(paragraphs)||!paragraphs.length||
        !paragraphs.every(p=>typeof p==='string'&&p.trim()))throw Error('Missing draft');
      const result=[title,...paragraphs].join('\n');
      if(Array.from(result).length>3000)throw Error('Draft is too long');
      return result;
    }};
}
module.exports={textTask};
