'use strict';
const {XRateBudget,POLL_INTERVAL}=require('./x-dm.cjs');
const {id}=require('./x-transport.cjs');
const FATAL=new Set(['account_mismatch','account_changed','requires_reauthorization','permission_denied','credits_required','invalid_response','response_too_large','backlog_limit','seen_limit','redirect_rejected','closed','invalid_cursor','invalid_owner','invalid_account']);
function validateXId(value){if(!id(value))throw Error('Use an X account ID of 1–19 decimal digits without leading zeroes.');return value;}
function validateXToken(value){if(typeof value!=='string'||!/^[\x21-\x7e]{8,4096}$/.test(value))throw Error('Enter an X user-context access token of 8–4096 printable ASCII characters without spaces.');return value;}
function retryAt(error,now=Date.now()){return Number.isSafeInteger(error?.retryAt)&&error.retryAt>now&&error.retryAt<=now+86400000?error.retryAt:now+POLL_INTERVAL;}
function codeOf(error){return FATAL.has(error?.code)||['rate_limited','timeout','connection_failed','send_unknown','x_rate_scope_limit'].includes(error?.code)?error.code:'connection_failed';}
function problem(code){
  if(code==='rate_limited')return 'X API 已限流，应用会等待允许时间；可随时断开，不会重发上一条消息。';
  if(code==='requires_reauthorization')return 'X 用户授权已失效。已停止接收，请在官方开发者入口重新授权并保存新的用户令牌。';
  if(code==='permission_denied')return 'X API 未允许此私信操作。已停止接收，请核对用户授权范围与应用权限。';
  if(code==='credits_required')return 'X API 返回付费额度限制。已停止接收，请自行核对官方账户；应用不会充值。';
  if(code==='account_mismatch'||code==='account_changed')return 'X 实际登录身份与配置不一致，已停止接收。请核对账号和用户令牌后手动连接。';
  if(code==='backlog_limit'||code==='seen_limit')return 'X 私信超出本次有界读取范围，已停止接收；不会部分执行或自动重放。';
  if(code==='x_rate_scope_limit')return '本次应用运行保存的 X 账号限流记录已达上限，未创建新连接。';
  if(code==='send_unknown')return 'X 发送结果未确认，应用不会自动重发；请在 X 查看后再决定。';
  if(FATAL.has(code))return 'X 私信身份或响应无法核实，已停止接收。请检查官方 API 权限和连接配置，再手动连接。';
  return 'X API 连接未能完成。请检查网络与用户授权，再手动连接；旧消息不会自动重发。';
}
// One bounded, token-free budget per expected self, shared across profiles and
// AccountManager recreation in this process. Close/token changes do not reset it.
const budgets=new Map();
function sharedRateBudget(accountId){
  validateXId(accountId);if(budgets.has(accountId))return budgets.get(accountId);
  // Do not evict a budget that a still-live client may retain. At most 64
  // distinct identities are admitted per application process.
  if(budgets.size>=64)throw Object.assign(Error(problem('x_rate_scope_limit')),{code:'x_rate_scope_limit'});
  const budget=new XRateBudget();budgets.set(accountId,budget);return budget;
}
module.exports={validateXId,validateXToken,retryAt,codeOf,problem,FATAL,sharedRateBudget};
