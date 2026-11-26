'use strict';
/*
 * Single-token option scorer for the group-chat dispatcher.
 *
 * Adapted from bothouse, https://github.com/zuiho-kai/bothouse
 * Upstream path: bridge/contrib/gate/scorer_remote.py (`RemoteScorer`, `RemoteTask.score`)
 * Upstream revision: 218051eccbb31923aa2b0d837801cf4d82c4799f
 * License: Apache-2.0, Copyright (c) 2026 zuiho-kai and bothouse contributors
 *
 * Re-implemented and modified for Agent Arcade (AGPL-3.0) on 2026-11-13:
 * - Node CommonJS with an injectable fetch instead of urllib;
 * - HTTPS only (plain HTTP only for a loopback host), no redirects, a 64 KiB response bound,
 *   one request per score with an abort signal and no retry or parameter negotiation;
 * - probabilities are returned by option letter; an endpoint that sends no logprobs falls back
 *   to "the first character of the reply must be an option" and reports `probs: null`;
 */
const MAX_RESPONSE = 64 * 1024;
const TOP_LOGPROBS = 20; // upper bound of `top_logprobs` in the OpenAI chat-completions API
const MAX_PROMPT = 8000;
const MAX_OPTIONS = 12;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

class ScorerError extends Error {
  constructor(code) { super(`The dispatcher scorer failed (${code}).`); this.code = code; }
}

/** Validates a base URL (or a full `/chat/completions` URL) and returns the request URL. */
function endpointURL(value) {
  if (typeof value !== 'string' || !value || value.length > 300 || /[\s\x00-\x1f\x7f]/.test(value)) throw new ScorerError('invalid_endpoint');
  let url;
  try { url = new URL(value); } catch { throw new ScorerError('invalid_endpoint'); }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  if (!secure || url.username || url.password || url.search || url.hash) throw new ScorerError('invalid_endpoint');
  const base = url.pathname.replace(/\/+$/, '');
  url.pathname = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  return url;
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(new ScorerError('cancelled'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new ScorerError('cancelled'));
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function boundedBody(response, signal) {
  if (Number(response.headers?.get?.('content-length')) > MAX_RESPONSE) {
    try { await response.body?.cancel?.(); } catch { /* already closed */ }
    throw new ScorerError('too_large');
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      for (;;) {
        const {done, value} = await abortable(reader.read(), signal);
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE) throw new ScorerError('too_large');
        chunks.push(value);
      }
    } finally {
      try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* already closed */ }
      try { reader.releaseLock(); } catch { /* already released */ }
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  if (typeof response.text !== 'function') throw new ScorerError('invalid_response');
  const text = await abortable(response.text(), signal);
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_RESPONSE) throw new ScorerError('too_large');
  return text;
}

/**
 * @param {object} options endpoint (base URL of an OpenAI-compatible API), key ('' for a local
 *   model without one), model, fetchImpl, timeoutMs
 * @returns {{score: Function}}
 */
function createScorer({endpoint, key = '', model, fetchImpl = globalThis.fetch, timeoutMs = 2500} = {}) {
  const url = endpointURL(endpoint);
  if (typeof key !== 'string' || key.length > 500 || /[\s\x00-\x1f\x7f]/.test(key)) throw new ScorerError('invalid_key');
  if (typeof model !== 'string' || !model || model.length > 100 || /[\s\x00-\x1f\x7f]/.test(model)) throw new ScorerError('invalid_model');
  if (typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new ScorerError('invalid_request');

  /**
   * One request, one token. Resolves `{probs, choice, optionMass}`: `probs` maps each option to
   * its probability normalised over the options (null when the endpoint sent no logprobs),
   * `choice` is the most likely option, `optionMass` the share of the model's whole first-token
   * distribution that fell on the options. Rejects with a coded ScorerError otherwise.
   */
  async function score({prompt, options, signal} = {}) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT) throw new ScorerError('invalid_request');
    if (!Array.isArray(options) || options.length < 2 || options.length > MAX_OPTIONS || new Set(options).size !== options.length
      || options.some(option => typeof option !== 'string' || !/^[A-Z]$/.test(option))) throw new ScorerError('invalid_request');
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const abort = () => controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
    try {
      let response;
      try {
        response = await abortable(fetchImpl(url.href, {method: 'POST', redirect: 'error', signal: controller.signal,
          headers: {'Content-Type': 'application/json', ...(key ? {Authorization: `Bearer ${key}`} : {})},
          body: JSON.stringify({model, max_tokens: 1, temperature: 0, logprobs: true, top_logprobs: TOP_LOGPROBS, messages: [{role: 'user', content: prompt}]})}), controller.signal);
      } catch (error) { throw error instanceof ScorerError ? error : new ScorerError('network'); }
      if (!response || typeof response !== 'object') throw new ScorerError('invalid_response');
      if (!response.ok) {
        try { await response.body?.cancel?.(); } catch { /* already closed */ }
        throw new ScorerError([401, 403].includes(response.status) ? 'unauthorized' : response.status === 429 ? 'rate_limited' : 'http_error');
      }
      let text;
      try { text = await boundedBody(response, controller.signal); } catch (error) { throw error instanceof ScorerError ? error : new ScorerError('network'); }
      let data;
      try { data = JSON.parse(text); } catch { throw new ScorerError('invalid_response'); }
      const first = data && typeof data === 'object' && Array.isArray(data.choices) ? data.choices[0] : null;
      if (!first || typeof first !== 'object') throw new ScorerError('invalid_response');
      const top = first.logprobs?.content?.[0]?.top_logprobs;
      const best = new Map();
      if (Array.isArray(top)) {
        for (const candidate of top.slice(0, TOP_LOGPROBS)) {
          const token = typeof candidate?.token === 'string' ? candidate.token.trim() : '';
          if (options.includes(token) && !best.has(token) && typeof candidate.logprob === 'number' && Number.isFinite(candidate.logprob) && candidate.logprob <= 0) best.set(token, candidate.logprob);
        }
      }
      if (best.size) {
        const raw = options.map(option => (best.has(option) ? Math.exp(best.get(option)) : 0));
        const mass = raw.reduce((sum, value) => sum + value, 0);
        if (!(mass > 0)) throw new ScorerError('no_option');
        const probs = {};
        let choice = options[0];
        options.forEach((option, index) => { probs[option] = raw[index] / mass; if (probs[option] > probs[choice]) choice = option; });
        return {probs, choice, optionMass: Math.min(1, mass)};
      }
      const content = typeof first.message?.content === 'string' ? first.message.content.trim() : '';
      if (content && options.includes(content.charAt(0))) return {probs: null, choice: content.charAt(0), optionMass: null};
      throw new ScorerError('no_option');
    } catch (error) {
      if (timedOut) throw new ScorerError('timeout');
      if (signal?.aborted) throw new ScorerError('cancelled');
      throw error instanceof ScorerError ? error : new ScorerError('network');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  return {score};
}

module.exports = {createScorer, endpointURL, ScorerError, MAX_RESPONSE, TOP_LOGPROBS};
