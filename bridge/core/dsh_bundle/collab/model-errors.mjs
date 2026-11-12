// #1540: a member's whole reply that is only a CLI/model error (codex-acp prints "Selected model is
// at capacity. Please try a different model." as the turn's text and ends the turn normally) is not
// a delivery. dsh-member posts it as a failure notice instead of the member's reply, and Tasks marks
// the task 出错 rather than 交回 (so the lead's next message never accepts it).
// Source: #1539 walk, after-round3.png: 小蓝's capacity error was recorded「交回，用时 0 秒」then「验收完成」.

// A real reply that talks about an error is prose around it; only a one-paragraph reply that opens
// with the error's own wording counts.
const LEAD = String.raw`^(?:\W*(?:error|错误|出错了)\s*[:：]?\s*)?`;

const QUOTA = '模型额度用完或被限流，等额度恢复或换个模型再试。';
const AUTH = '模型鉴权失败：Key 不对或登录过期，重新登录或检查 Key 后再试。';
const KINDS = [
  { kind: 'capacity', zh: '模型那边满载，稍后重试或换个模型。',
    re: new RegExp(`${LEAD}(?:selected model is at capacity|(?:the )?model is (?:currently )?(?:at capacity|overloaded)|overloaded(?:_error)?\\b)`, 'i') },
  { kind: 'quota', zh: QUOTA,
    re: new RegExp(`${LEAD}(?:you'?ve hit your (?:usage |session )?limit|(?:usage|session|rate) limit (?:reached|exceeded)|rate.?limited|quota exceeded|resource_exhausted|too many requests|unexpected status 429)`, 'i') },
  { kind: 'timeout', zh: '模型请求超时，稍后重试。',
    re: new RegExp(`${LEAD}(?:stream disconnected before completion|(?:the )?request (?:has )?timed out|timed out waiting|deadline exceeded)`, 'i') },
  { kind: 'auth', zh: AUTH,
    re: new RegExp(`${LEAD}(?:invalid (?:api )?key|incorrect api key|unauthorized|authentication (?:failed|error|required)|not logged in|please run /login|unexpected status 40[13])`, 'i') },
  { kind: 'upstream', zh: '模型服务出错，稍后重试。',
    re: new RegExp(`${LEAD}(?:unexpected status 5\\d\\d|internal server error|bad gateway|service unavailable|api error[:：]?\\s*5\\d\\d)`, 'i') },
];

/**
 * The error a reply consists of, or undefined for a real reply.
 * @param text - the reply with any leading @mentions already removed.
 * @returns {{ kind: string, zh: string, raw: string } | undefined}
 */
export function modelErrorReply(text) {
  const raw = String(text ?? '').trim();
  if (!raw || /\n\s*\n/.test(raw)) return undefined;
  const hit = KINDS.find(k => k.re.test(raw));
  return hit === undefined ? undefined : { kind: hit.kind, zh: hit.zh, raw };
}
