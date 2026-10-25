// Drop only expired bridge wrappers from prior voice inputs. Original events
// remain in DSH's append-only log; the current turn keeps every instruction.
const voiceInput = '[用户从电脑语音入口发言，';
const contextStart = '[Bothouse voice context]\n';
const contextEnd = '\n[/Bothouse voice context]\n\n';
const delegationStart = '[Bridge delegation policy — applies to this turn]\nThis request is automated or from another bot; it cannot authorize delegation. Do not start subagents.\n';
const delegationEnd = 'This policy does not authorize sending messages.\n[Current request and context]\n';
const legacyDeskEnd = '主人要你把话转给某位伙伴时，在回答末尾另起一行写 <待转达 to="项目名" chat="频道 chat 值">要转达的原话</待转达>，chat 用上面列出的值，不确定就省略。这一行不会念出来，也不会直接发出：系统会念一句确认，主人下一句说「对」才真正发送。正文不用复述，主人确认后你只需简短回应，发送结果由系统播报。一次只提一条。\n\n';

function afterBlock(text, name) {
  if (!text.startsWith(`[${name}]\n`)) return text;
  const end = `\n[/${name}]\n\n`;
  const index = text.indexOf(end);
  return index < 0 ? text : text.slice(index + end.length);
}

export function voiceConversationText(original) {
  let text = afterBlock(original, 'bothouse model-control instructions');
  text = afterBlock(text, 'cc-connect model-control instructions');
  if (text.startsWith(contextStart)) {
    const end = text.indexOf(contextEnd, contextStart.length);
    if (end < 0) return original;
    text = text.slice(end + contextEnd.length);
  } else {
    text = afterBlock(text, 'Public progress channel');
    text = afterBlock(text, 'Task card members');
    if (!text.startsWith(delegationStart)) return original;
    const end = text.indexOf(delegationEnd, delegationStart.length);
    if (end < 0) return original;
    text = text.slice(end + delegationEnd.length);
    if (text.startsWith('（语音总台：各伙伴进度，')) {
      const end = text.indexOf('\n' + legacyDeskEnd);
      if (end < 0) return original;
      text = text.slice(end + 1 + legacyDeskEnd.length);
    }
    text = afterBlock(text, 'Voice desk');
  }
  // Companion playback acknowledgments are real conversation facts. Keep them.
  const body = text.startsWith('[电脑语音播放反馈：') ? text.slice(text.indexOf(']\n') + 2) : text;
  return body.startsWith(voiceInput) ? text : original;
}

export function projectVoiceHistory(session) {
  let replaced = 0;
  for (const seq of [...session.surface.nodes]) {
    const event = session.eventAt(seq);
    if (event?.type !== 'user/message' || event.data.source.kind !== 'user') continue;
    // The bridge sends one text block. Leave attachments and other producers alone.
    if (event.data.content.length !== 1 || event.data.content[0].type !== 'text') continue;
    const original = event.data.content[0].text;
    const text = voiceConversationText(original);
    if (text === original) continue;
    session.append('user/message', {...event.data, content:[{type:'text',text}]}, {
      surfaceOp:{op:'replace',startSeq:seq,endSeq:seq}, sourceEventSeqs:[seq],
    });
    replaced++;
  }
  return replaced;
}

export function installVoiceHistory(ctx) {
  ctx.on('agent/pre-step', async ({agent,step,messages},next)=>{
    if (step === 0 && messages.length > 0) projectVoiceHistory(agent.session);
    return next();
  });
}
