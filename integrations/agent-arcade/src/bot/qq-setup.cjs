'use strict';

const {validateQQUrl} = require('./qq.cjs');

// Main-process only. Never return the exported token/config through renderer IPC.
function napCatConnection(url, token) {
  const parsed = new URL(validateQQUrl(url));
  if (parsed.protocol !== 'ws:') throw Error('For a TLS bridge, copy the token and configure its certificate in NapCat manually.');
  if (typeof token !== 'string' || !/^[\x21-\x7e]{16,256}$/.test(token)) throw Error('Prepare or save a OneBot token first.');
  return JSON.stringify({name: 'agent-arcade', enable: true,
    host: parsed.hostname.replace(/^\[|\]$/g, ''), port: Number(parsed.port),
    messagePostFormat: 'array', reportSelfMessage: false, token,
    enableForcePushEvent: true, debug: false, heartInterval: 30000}, null, 2);
}

function qqGuide(kind) {
  const links = new Map([
    ['download', 'https://github.com/NapNeko/NapCatQQ-Desktop/releases/latest'],
    ['connections', 'https://napneko.github.io/NapCatQQ-Desktop/docs/connections/'],
  ]);
  if (!links.has(kind)) throw Error('Unknown QQ setup guide.');
  return links.get(kind);
}

const issues = {
  unauthorized: 'OneBot token was rejected. Save the same token in NapCat and Agent Arcade; the WebUI password is different.',
  owner_is_agent_account: 'Enter your own QQ number as the owner, not the AI account number.',
  account_offline: 'The QQ account is offline. Log in through NapCat and test again.',
  owner_not_friend: 'The owner is not in this QQ account’s friend list. Add the AI account and accept the request in QQ, then test again.',
  invalid_login_info: 'The bridge did not return a valid QQ account. Check QQ login and select Universal (API + events).',
  account_changed: 'The signed-in QQ account changed. Check the account and reconnect explicitly.',
  connect_timeout: 'The local QQ bridge did not respond. Start NapCat and check the forward WebSocket server address.',
  connect_failed: 'Cannot reach the local QQ bridge. Enable its forward WebSocket server, check the port and save the same OneBot token.',
  disconnected: 'The QQ bridge disconnected during the check. Check NapCat, then test again.',
};
function qqIssue(code) { return issues[code] || 'Could not check the local QQ bridge. Check QQ login, forward WebSocket (API + events) and the OneBot token.'; }

module.exports = {napCatConnection, qqGuide, qqIssue};
