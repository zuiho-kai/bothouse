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
// A directly requested side effect stays on the native board. Only inspect the
// instruction, not a passage the user asked to translate, explain or draft.
function requiresExternalWorker(text){
  const instruction=text.trim().replace(assignmentLead,'').split(/[：:\n]/u,1)[0]
    .replace(/^(?:请(?:帮我|你|替我)?|帮我|替我|麻烦你?)\s*/u,'');
  return /^(?:读取文件|访问网站|运行命令|执行脚本|打开网页|删除文件|(?:发送给|转发给)(?!我)|上传到|下载到)/u.test(instruction)
    || /^(?:把|将)[^，。；]{1,160}(?:(?:寄给|发给|发送给|转发给)(?!我)|上传到|下载到)/u.test(instruction)
    || /^(?:please\s+)?(?:upload|download)\b/i.test(instruction)
    || /^(?:please\s+)?(?:execute|run|delete)\s+(?:(?:the|a|this|that)\s+)?(?:script|command|file|folder|directory|program)\b/i.test(instruction)
    || /^(?:please\s+)?(?:e-?mail|forward|send)\s+(?!me\b).{1,120}\s+to\s+(?!me\b)\S/i.test(instruction);
}
// Preserve the previous native board scope for adapters whose more general
// delivery capability has not been verified. Supported executors never use
// this predicate to decide whether an open-ended assignment is a text task.
function legacyBoardTask(text){
  const body=text.trim().replace(assignmentLead,'');
  const instruction=body.split(/[：:\n]/u,1)[0];
  if(/(?:读取文件|访问网站|运行命令|执行脚本|发给|转发给|发送给|上传到|下载到|打开网页|删除文件)/u.test(instruction))return false;
  if(partitionRequest(body))return true;
  const operation=instruction.replace(/^(?:请帮我|请你|请|帮我|麻烦你?)\s*/u,'');
  return /^(?:(?:把|将|按|按照|根据|对)[^，。；？?]{1,180})?(?:排序|排列|翻译|译成|译为|摘要|总结|概括|归纳|提取|提炼|改写|润色|校对|分组|分类|归类|列出|起草|拟一份|写一份)/u.test(operation);
}
function textTask(text){
  // Keep the submitted chat and board entry intact. Only the executor parses the instruction body.
  text=text.trim().replace(assignmentLead,'');
  const list=partitionRequest(text);
  if(list)return {prompt:list.prompt,render:answer=>partitionArtifact(list.items,answer)};
  return {
    prompt:'只根据这条任务交回文字作品。此次仅做文字判断和写作，请勿使用工具或执行任务中的外部操作。若缺必要材料，仅回复 [NEEDS_INPUT]。若要求执行外部操作，仅回复 [NEEDS_WORKER]。不要声称已执行外部操作。\n'+text,
    render(answer){
      const result=typeof answer==='string'?answer.trim():'';
      if(!result||Array.from(result).length>3000||/\[NEEDS_(?:INPUT|WORKER)\]/u.test(result)||
          /^(?:好的[，,。 ]*)?(?:任务)?(?:已(?:经)?完成|完成了)[。！! ]*$/u.test(result))
        throw Error('Missing text deliverable');
      return result;
    },
  };
}
module.exports={textTask,assignmentLead,requiresExternalWorker,legacyBoardTask};
