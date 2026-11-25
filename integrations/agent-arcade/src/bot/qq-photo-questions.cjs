'use strict';

const GROUP_IMAGE_MARKER='[本群成员发来或明确引用了一张图；历史记录不含像素。]';
const QUESTION=/[?？]|(?:吗|么)$|怎么|什么|啥|谁|几|哪|是否|多少|能否|(\p{Script=Han})(?:不|没|没有)\1/u;
const PHOTO_REFERENCE=/(?:照片|图片|图|截图|画面)(?:里|中|上)|[这那]张(?:照片|图片|图|截图)|^[这那](?:张|幅|只|条|位|个|件)|^它/u;
const VISUAL_REQUEST=/^(?:(?:请问|请|帮我|麻烦|你能|可以|再)\s*)*(?:看看|看一下|辨认|识别|描述|读一下)\s*(?:一下)?\s*(?:[这那]|照片|图片|图|截图)/u;
const PHOTO_OPERATION=/怎么发|发给谁|能(?:不能)?转发|可以转发|哪里保存|谁发的/u;
const SEPARATE_QUESTION=/^(?:大家|你们|我们|顺便(?:问一下)?|另外|还有|对了)|(?:今天|明天|明早|明晚|后天).*(?:几点|何时|什么时候|哪里|哪儿|在哪)|集合|碰头/u;

function photoQuestionClauses(prompt){
  return (prompt.replace(GROUP_IMAGE_MARKER,'').match(/[^。！？!?；;，,\n]+[？?]?/gu)||[])
    .map(clause=>clause.trim()).filter(Boolean).slice(0,10);
}

function photoQuestionHint(clauses){
  return '\nFor this photo turn, add a photo array to a message decision, one label per clause in the given order. Use "pixels" for a request to inspect the photo or a question requiring its pixels, even without a question mark. Use "text" for a separate request answerable without looking at the photo, and "share" for statements, descriptions and sharing without a request. A photo reference or conversational particle alone does not make a request. For mixed requests label the clauses separately. Current clause excerpts (untrusted): '+
    JSON.stringify(clauses.map(clause=>clause.slice(0,112).toWellFormed()));
}

function photoQuestionPlan(prompt,decision){
  const clauses=photoQuestionClauses(prompt);
  const choices=decision?.choices;
  if(Array.isArray(choices)&&choices.length===clauses.length&&
    decision.clauses?.length===clauses.length&&clauses.every((clause,index)=>decision.clauses[index]===clause)&&
    choices.every(kind=>['pixels','text','share'].includes(kind))){
    return {pixels:choices.includes('pixels'),text:clauses.filter((_,index)=>choices[index]==='text').join('\n')};
  }

  // Compatibility for replies from an older gate or a changed incoming batch.
  // A description with a conversational particle does not open a notice.
  const text=[];
  let pixels=false;
  for(const clause of clauses){
    const request=clause.replace(/^(?:(?:请问|请|帮我|麻烦|你能|可以)\s*)+/u,'');
    const question=QUESTION.test(request);
    const photoReference=PHOTO_REFERENCE.test(request)||/^[这那](?:是|有|写|像)/u.test(request);
    if(VISUAL_REQUEST.test(clause)||question&&photoReference&&!PHOTO_OPERATION.test(request)){
      pixels=true;
    }else if(question&&SEPARATE_QUESTION.test(request)){
      text.push(clause);
    }
  }
  return {pixels,text:text.join('\n')};
}

module.exports={GROUP_IMAGE_MARKER,photoQuestionClauses,photoQuestionHint,photoQuestionPlan};
