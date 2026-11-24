'use strict';

// The agent assigns labels. The worker constructs the deliverable from the original
// items, so a completion claim, missing item or invented entry cannot be handed back.
const assignmentLead=/^(?:给你(?:个|一个|一项)任务|任务交给你|请接(?:一下)?这个任务)[：:,，\s]+(?=\S)/u;

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
  // Keep the submitted chat and board entry intact. Only the executor parses the instruction body.
  text=text.trim().replace(assignmentLead,'');
  // The text after a colon or newline can be the passage to translate or summarize.
  const instruction=text.split(/[：:\n]/u,1)[0];
  if(/(?:读取文件|访问网站|运行命令|执行脚本|发给|转发给|发送给|上传到|下载到|打开网页|删除文件)/u.test(instruction))return;
  const list=partitionRequest(text);
  if(list)return {prompt:list.prompt,render:answer=>partitionArtifact(list.items,answer)};
  const operation=instruction.replace(/^(?:请帮我|请你|请|帮我|麻烦你?)\s*/u,'');
  if(!/^(?:(?:把|将|按|按照|根据|对)[^，。；？?]{1,180})?(?:排序|排列|翻译|译成|译为|摘要|总结|概括|归纳|提取|提炼|改写|润色|校对|分组|分类|归类|列出|起草|拟一份|写一份)/u.test(operation))return;
  return {
    prompt:'只根据这条消息提供的文字完成任务，直接交回正文。不要调用工具、访问文件或外部服务。材料不足或需要实际操作时只回复 [NEEDS_INPUT]。\n'+text,
    render(answer){
      const result=typeof answer==='string'?answer.trim():'';
      if(!result||Array.from(result).length>3000||result.includes('[NEEDS_INPUT]')||
          /^(?:好的[，,。 ]*)?(?:任务)?(?:已(?:经)?完成|完成了)[。！! ]*$/u.test(result))
        throw Error('Missing text deliverable');
      return result;
    },
  };
}
module.exports={textTask,assignmentLead};
