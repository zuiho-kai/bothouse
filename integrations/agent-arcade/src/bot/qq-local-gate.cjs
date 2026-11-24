'use strict';

const http = require('node:http');
const {CompanionModelError} = require('./companion-model-status.cjs');

const ENDPOINT = 'http://127.0.0.1:11434/api/chat';
const MODEL = 'qwen3.6:35b-a3b';
const MAX_INPUT = 32768;
const MAX_RESPONSE_BYTES = 32 * 1024;

function chatBody(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 32) throw new CompanionModelError('invalid_response');
  let length = 0;
  const textMessages = messages.map(message => {
    if (!message || !['system', 'user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' || !message.content.length) throw new CompanionModelError('invalid_response');
    length += message.content.length;
    if (length > MAX_INPUT) throw new CompanionModelError('invalid_response');
    return {role:message.role, content:message.content};
  });
  return JSON.stringify({model:MODEL, messages:textMessages, stream:false, think:false,
    keep_alive:'2m', options:{temperature:0, seed:42, num_predict:256}});
}

async function readReply(response) {
  if (response.statusCode !== 200) throw new CompanionModelError(response.statusCode === 429 ? 'rate_limited' : 'unavailable');
  if (Number(response.headers['content-length']) > MAX_RESPONSE_BYTES) throw new CompanionModelError('invalid_response');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response) {
    bytes += chunk.length;
    if (bytes > MAX_RESPONSE_BYTES) throw new CompanionModelError('invalid_response');
    chunks.push(chunk);
  }
  let answer;
  try {
    answer = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks)));
  } catch {
    throw new CompanionModelError('invalid_response');
  }
  const message = answer?.message;
  if (answer?.model !== MODEL || answer.done !== true || answer.error ||
      (answer.done_reason && answer.done_reason !== 'stop') || message?.role !== 'assistant' ||
      message.tool_calls?.length || typeof message.content !== 'string' || !message.content.trim()) {
    throw new CompanionModelError('invalid_response');
  }
  return {outcome:'reply_ended', text:message.content};
}

async function runLocalGroupGate({messages, signal} = {}) {
  const body = chatBody(messages);
  // Direct numeric loopback, no proxy agent, redirects or cloud/provider credentials.
  const timeout = AbortSignal.timeout(60000);
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    deadline.throwIfAborted();
    response = await new Promise((resolve, reject) => {
      const req = http.request(ENDPOINT, {method:'POST', agent:false, signal:deadline,
        headers:{'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body)}}, resolve);
      req.once('error', reject);
      req.end(body);
    });
    return await readReply(response);
  } catch (error) {
    if (error instanceof CompanionModelError) throw error;
    throw new CompanionModelError('unavailable');
  } finally {
    response?.destroy();
  }
}

module.exports = {runLocalGroupGate};
