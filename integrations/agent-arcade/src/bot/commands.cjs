'use strict';

// Only a whole, directly typed control message may reach a command handler.
// Keep this predicate shared with the voice/quote gate and receipt journal.
function isControlText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.startsWith('/') || text === '状态' || text === '停止' || text === '恢复会话' || /^(同意|拒绝)(?:\s|$)/.test(text);
}
function normalizeControlText(value) {
  const text = value.trim();
  if (text === '状态') return '/status';
  if (text === '停止') return '/cancel';
  if (text === '恢复会话') return '/resume';
  if (/^同意(?:\s|$)/.test(text)) return text.replace(/^同意/, '/allow');
  if (/^拒绝(?:\s|$)/.test(text)) return text.replace(/^拒绝/, '/deny');
  return text.replace(/^\/[A-Za-z]+/, command => command.toLowerCase());
}

const rememberFact = /^(?:记住|请记住|记一下)[：: ]+([\s\S]+)$/;
const forgetFact = /^忘记\s+([\w-]+)$/;
const correctFact = /^更正\s+([\w-]+)[：:]\s*([\s\S]+)$/;

function groupCommandRecipient(address, eligibleAccounts) {
  if (!address || !Array.isArray(address.targets) || address.blocked !== false) return null;
  const {targets} = address;
  if (targets.length > 1 || !eligibleAccounts.length) return null;
  if (targets.length === 1) {
    return eligibleAccounts.includes(targets[0]) ? {accountId:targets[0], action:'execute'} : null;
  }
  return {accountId:eligibleAccounts[0], action:eligibleAccounts.length === 1 ? 'execute' : 'hint'};
}

module.exports = {isControlText, normalizeControlText, rememberFact, forgetFact, correctFact, groupCommandRecipient};
