'use strict';
const crypto = require('node:crypto');
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const WINDOW = 5 * 60 * 1000, MAX_FAILURES = 8, MAX_ALIASES = 10000;

// The shorter owner-facing alias is not a 128-bit capability. It is scoped to
// this connection's live requests, single use, and rate limited independently
// of the compatible full nonce. Never reuse an issued alias in this connection.
class ApprovalCodes {
  constructor({now = Date.now, randomBytes = crypto.randomBytes} = {}) {
    this.now = now; this.randomBytes = randomBytes; this.used = new Set(); this.fullCodes = new Set();
    this.windowStart = now(); this.failures = 0; this.blockedUntil = 0;
  }
  issue(fullCode) {
    if (/^[a-f0-9]{32}$/i.test(fullCode || '') && this.fullCodes.size < MAX_ALIASES) this.fullCodes.add(fullCode.toLowerCase());
    if (this.used.size >= MAX_ALIASES) return '';
    for (let attempt = 0; attempt < 32; attempt++) {
      const alias = [...this.randomBytes(6)].map(byte => ALPHABET[byte & 31]).join('');
      if (!this.used.has(alias)) { this.used.add(alias); return alias; }
    }
    return ''; // Full nonce remains usable if the short-code space cannot be used.
  }
  limited() { return this.blockedUntil > this.now(); }
  identifyBare(value, pending) {
    // Only recognize codes actually issued here. Six-letter words and arbitrary
    // hashes remain ordinary chat; identification never consumes/approves a code.
    if (/^[2-9A-HJ-NP-Z]{6}$/i.test(value) && this.used.has(value.toUpperCase())) {
      return {request: [...pending.values()].find(p => p.alias === value.toUpperCase())};
    }
    if (/^[a-f0-9]{32}$/i.test(value) && (pending.has(value.toLowerCase()) || this.fullCodes.has(value.toLowerCase()))) {
      return {request: pending.get(value.toLowerCase())};
    }
    return null;
  }
  lookup(value, pending) {
    if (/^[a-f0-9]{32}$/i.test(value)) return {request: pending.get(value.toLowerCase())};
    if (this.limited()) return {limited: true};
    if (this.now() - this.windowStart >= WINDOW) { this.windowStart = this.now(); this.failures = 0; }
    const request = [...pending.values()].find(p => p.alias && p.alias === value.toUpperCase());
    if (request) return {request};
    if (++this.failures >= MAX_FAILURES) { this.blockedUntil = this.now() + WINDOW; return {limited: true}; }
    return {};
  }
}
const SHORT_CODE_LIMIT_MESSAGE = '短确认码输错次数过多，已暂停使用 5 分钟。请发送“状态”查看完整操作和备用确认命令，或在电脑上处理。';
module.exports = {ApprovalCodes, SHORT_CODE_LIMIT_MESSAGE};
