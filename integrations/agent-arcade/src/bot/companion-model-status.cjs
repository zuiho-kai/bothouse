'use strict';

const nextSteps = {
  rate_limited:'服务商返回 429。请查看额度、账单或限流状态，恢复后发送新消息。',
  billing:'服务商报告余额或额度受限。请检查服务商账户余额、用量上限和账单。',
  credentials:'服务商拒绝了身份验证。请在「AI 与渠道」检查这位搭档的 API key。',
  permission:'服务商拒绝访问。请检查 API key 的权限和模型访问资格。',
  not_found:'服务商未找到请求的资源。请核对模型名称和服务地址。',
  request_rejected:'服务商拒绝了这次请求。请核对模型与请求参数。',
  upstream:'服务商处理请求时出错。稍后可在群里发一条新消息。',
  upstream_timeout:'服务商报告请求超时。稍后可在群里发一条新消息。',
  timeout:'已超过本次等待时限。可在群里发一条新消息重新尝试。',
  token_limit:'已达到模型的 token 上限，未得到完整结果。可用较短的新消息再试。',
  connection:'未能连接 AI 服务。请检查网络和代理设置。',
  refusal:'模型拒绝回答这条消息。可换一种表达再发。',
  invalid_response:'服务商返回空白或无效结果。请检查所选模型是否可用，再发送新消息。',
  unknown:'暂时无法确定原因。可在群里发一条新消息，查看本次结果。',
};

const stopReasons = new Set(['end_turn','max_tokens','stop_sequence','tool_use','pause_turn','compaction','refusal','model_context_window_exceeded']);
const isModelStopReason = value => stopReasons.has(value);
const validStatus = status => Number.isInteger(status) && status >= 100 && status <= 599;

function modelFailure(result) {
  const status = result?.httpStatus;
  if (result?.failureCode === 'billing') return 'billing';
  if (result?.failureCode === 'timeout' && validStatus(status) && status >= 400) return 'upstream_timeout';
  switch (status) {
    case 429: return 'rate_limited';
    case 402: return 'billing';
    case 401: return 'credentials';
    case 403: return 'permission';
    case 404: return 'not_found';
    case 408: case 504: return 'upstream_timeout';
  }
  if (validStatus(status) && status >= 500) return 'upstream';
  if (validStatus(status) && status >= 400) return 'request_rejected';
  if (['timeout','token_limit','connection','invalid_response','refusal'].includes(result?.failureCode)) return result.failureCode;
  return result?.outcome === 'reply_ended' ? 'invalid_response' : 'unknown';
}

class CompanionModelError extends Error {
  constructor(code, result) {
    super('The model did not return a reply.');
    this.code = Object.hasOwn(nextSteps, code) || code === 'unavailable' ? code : 'unknown';
    if (validStatus(result?.httpStatus)) this.httpStatus = result.httpStatus;
    if (isModelStopReason(result?.stopReason)) this.stopReason = result.stopReason;
  }
}

function groupModelProblem(groupId, issues) {
  const details = issues.map(({phase, code, source}) => {
    if (phase === 'gate' && source === 'ollama') {
      return '本机接话判断未完成，本轮保持安静。请检查 Ollama 是否正在运行并已安装 qwen3.6:35b-a3b，再发一条新群消息。也可断开 QQ 后关闭本机判断、保存并重新连接。';
    }
    const label = phase === 'gate' ? '群聊接话判断未完成。' : '群聊正式回复未完成。';
    return label + (Object.hasOwn(nextSteps,code) ? nextSteps[code] : nextSteps.unknown);
  });
  return `QQ群 ${groupId} · ${details.join(' ')}`;
}

module.exports = {CompanionModelError, modelFailure, groupModelProblem, isModelStopReason};
