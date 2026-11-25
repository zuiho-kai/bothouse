'use strict';
const {abortable} = require('./file-tools.cjs');
const {dimensions} = require('./qq-media.cjs');

const ENDPOINT = 'https://api.openai.com/v1/images/generations';
const EDIT_ENDPOINT = 'https://api.openai.com/v1/images/edits';
const IMAGE_MODELS = Object.freeze(['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst']);
const DEFAULT_IMAGE_MODEL = IMAGE_MODELS[0];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BASE64 = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
const MAX_RESPONSE_BYTES = MAX_BASE64 + 64 * 1024;
const MAX_ERROR_BYTES = 8 * 1024;
const MAX_TIMEOUT_MS = 600000;
const FIELDS = new Set(['apiKey', 'model', 'prompt', 'signal', 'fetchImpl', 'timeoutMs', 'reference', 'quality', 'complexity']);
const statusCodes = {400:'image_request_rejected', 401:'image_auth', 403:'image_forbidden',
  404:'image_model_unavailable', 422:'image_request_rejected', 429:'image_rate_limited'};

const imageInputCodes = new Set(['invalid_image', 'invalid_image_format', 'invalid_image_mode', 'image_parse_error',
  'unsupported_image_media_type', 'empty_image_file', 'image_file_too_large']);
const policyCodes = new Set(['moderation_blocked', 'content_policy_violation', 'image_content_policy_violation']);

class ImageGenerationError extends Error {
  constructor(code) {
    super(`Image generation failed (${code}).`);
    this.code = code;
    this.name = code === 'image_cancelled' ? 'AbortError' : 'ImageGenerationError';
  }
}
const fail = code => { throw new ImageGenerationError(code); };

async function referenceRejection(response, signal) {
  const fallback = 'image_request_rejected';
  const body = response.body;
  if (!body?.getReader || Number(response.headers.get('content-length')) > MAX_ERROR_BYTES) {
    body?.cancel().catch(() => {});
    return fallback;
  }
  const reader = body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ERROR_BYTES || chunks.length >= 64) return fallback;
      chunks.push(value);
    }
    const {code, param} = JSON.parse(Buffer.concat(chunks, size).toString('utf8'))?.error ?? {};
    if (policyCodes.has(code)) return 'image_content_rejected';
    if (code === 'model_not_found' || param === 'model') return 'image_model_unavailable';
    const isImageParam = typeof param === 'string' && /^image(?:\[\d*\])?$/u.test(param);
    if ((imageInputCodes.has(code) && (param == null || isImageParam)) ||
        (isImageParam && (code === 'invalid_type' || code === 'missing_required_parameter'))) return 'image_reference_rejected';
    return fallback;
  } catch {
    return fallback;
  } finally {
    reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readPng(response, signal) {
  if (response.status !== 200 || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    response.body?.cancel().catch(() => {});
    fail(response.status === 200 ? 'image_too_large' : statusCodes[response.status] || 'image_provider_failed');
  }
  if (!response.body?.getReader) fail('image_invalid_response');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES || chunks.length >= 16384) fail('image_too_large');
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
  catch { fail('image_invalid_response'); }
  const encoded = body?.data?.[0]?.b64_json;
  if (!Array.isArray(body?.data) || body.data.length !== 1 || typeof encoded !== 'string' || !encoded) fail('image_invalid_response');
  if (encoded.length > MAX_BASE64) fail('image_too_large');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) fail('image_too_large');
  if (bytes.toString('base64') !== encoded) fail('image_invalid_response');
  // Use the existing bounded PNG chunk/dimension checks. The studio decodes
  // pixels when importing the result; no URL in a provider response is opened.
  let image;
  try { image = dimensions(bytes, '.png'); } catch { fail('image_invalid_response'); }
  if (image.width !== 1024 || image.height !== 1024) fail('image_invalid_response');
  return bytes;
}

async function generateOpenAIImage(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !FIELDS.has(key))) fail('image_invalid_request');
  const {apiKey, model = DEFAULT_IMAGE_MODEL, prompt, signal, fetchImpl = globalThis.fetch, timeoutMs = 180000, reference, quality, complexity} = options;
  if (!IMAGE_MODELS.includes(model)) fail('image_model_unavailable');
  if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{10,500}$/.test(apiKey)) fail('image_auth');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000 || prompt.includes('\0') ||
      typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS ||
      (signal !== undefined && !(signal instanceof AbortSignal))) fail('image_invalid_request');
  if (signal?.aborted) fail('image_cancelled');
  if (quality !== undefined && !['auto','low','medium','high','xhigh','max'].includes(quality) ||
      complexity !== undefined && !['low','medium','high'].includes(complexity)) fail('image_invalid_request');
  const fields = {model, prompt, n:1, size:'1024x1024', output_format:'png',
    ...(quality !== undefined && {quality}), ...(complexity !== undefined && {complexity})};
  const headers = {Authorization:'Bearer '+apiKey};
  let body;
  if (reference !== undefined) {
    if (!Buffer.isBuffer(reference) || !reference.length || reference.length > MAX_IMAGE_BYTES) fail('image_invalid_request');
    try { dimensions(reference,'.png'); } catch { fail('image_invalid_request'); }
    body = new FormData();
    for (const [key,value] of Object.entries(fields)) body.append(key,String(value));
    body.append('image[]',new Blob([reference],{type:'image/png'}),'character-reference.png');
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(fields);
  }
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const active = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  try {
    const response = await abortable(fetchImpl(reference ? EDIT_ENDPOINT : ENDPOINT, {
      method:'POST', redirect:'error', credentials:'omit', signal:active,
      headers, body
    }), active);
    if (reference && [400,404,422].includes(response.status)) {
      const code = await referenceRejection(response, active);
      if (active.aborted) throw active.reason;
      fail(code);
    }
    return await readPng(response, active);
  } catch (error) {
    if (signal?.aborted) fail('image_cancelled');
    if (deadline.signal.aborted) fail('image_timeout');
    if (error instanceof ImageGenerationError) throw error;
    fail('image_provider_failed');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {generateOpenAIImage, IMAGE_MODELS, DEFAULT_IMAGE_MODEL};
