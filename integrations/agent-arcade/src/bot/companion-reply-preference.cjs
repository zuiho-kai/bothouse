'use strict';

const SHORT_REPLY_GUIDE = 'Prefer one short, complete sentence. Keep each condition or exception with the point it qualifies. Give detail when needed or asked. Preserve requested wording, links, code and exact text.';
const SPOKEN_REPLY_CHARS = 300;
const STICKER_GUIDE = 'Choose one sticker alone when it accurately and fully conveys a greeting, agreement or emotion. Use words for questions, facts and ambiguous reactions.';
const SPOKEN_REPLY_GUIDE = 'When a substantial explanation is needed and a selected speaking voice is available, speak the complete answer as one reply. Keep the reasoning and qualifications; do not cut a sentence short.';
const textOnlyRequest = /(?:只|仅)\s*(?:想要|需要|需|要|发|用|回(?:复|答)?|看)?\s*纯?\s*(?:文字|打字)|(?:用|发|回|给我)(?:纯)?文字|(?:别|不要|不用)(?:发|用|回)?(?:语音|录音|表情|贴图|图片)|原封不动|逐字|原(?:文|样|话)|(?:给|发|贴|提供).{0,6}(?:链接|网址|代码)|\b(?:text only|in writing|verbatim|exact wording|send (?:me )?(?:the )?link)\b/iu;
const writtenContent = /(?:https?:\/\/|www\.|\x60|^\s*>|[\p{Cc}\p{Cf}<>]|(?:^|\s)@\S)/imu;
const writtenDirective = /(?:^|[\n，,。；;])\s*(?:这[条次轮]|本[条轮])?\s*(?:请|麻烦)?\s*(?:(?:用\s*文字|(?:用\s*)?打字)(?:回复|回答|回我)(?:一下|下)?|纯文字(?:回复|回答|回我)(?:就好|就行|即可)?|文字(?:回复|回答)(?:就好|就行|即可)|(?:只|仅)(?:用)?(?:文字|打字)(?:回复|回答|回我)?)(?=\s*(?:$|[\n，,。！？!?；;：:]))/u;
const avoidMedia = /(?:别|不用|不要|先不)(?:再)?(?:发|用|给我发)[^\n。！？!?；;]{0,10}(?:表情|图片|照片|录音|语音)/u;

function outsideQuotes(input) {
  // Quoted words can be the very line the person asks to hear.
  return input.replace(/「[^」]*」|『[^』]*』|“[^”]*”|‘[^’]*’|"[^"]*"/gu,'「」');
}

function requestsWrittenFormat(input) {
  const instruction = outsideQuotes(input);
  return writtenDirective.test(instruction) || avoidMedia.test(instruction);
}

function needsWrittenReply(input, reply = '') {
  const instruction = outsideQuotes(input);
  return writtenDirective.test(instruction) || avoidMedia.test(instruction) ||
    textOnlyRequest.test(instruction) || writtenContent.test(reply);
}

function allowsStickerReply(input) {
  const instruction = outsideQuotes(input);
  return !needsWrittenReply(input) && !/(?:用|发|录)(?:一?[条段个])?语音|\b(?:no (?:image|sticker)s?|voice (?:reply|message))\b/iu.test(instruction);
}

module.exports = {SHORT_REPLY_GUIDE, STICKER_GUIDE, SPOKEN_REPLY_GUIDE, SPOKEN_REPLY_CHARS, requestsWrittenFormat, needsWrittenReply, allowsStickerReply};
