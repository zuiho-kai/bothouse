'use strict';

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {signal.removeEventListener('abort',abort);reject(signal.reason);};
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, {once:true});
    Promise.resolve(promise).then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}

const CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
const root = 'https://api.cloudflare.com/client/v4/accounts/';
const maxBytes = 8 * 1024 * 1024;
const maxBase64 = 4 * Math.ceil(maxBytes / 3);
const maxEnvelope = maxBase64 + 64 * 1024;
const validOptions = new Set(['accountId', 'apiToken', 'prompt', 'reference', 'prepareReference',
  'signal', 'assertCurrent', 'fetchImpl', 'timeoutMs']);
const statusCodes = {
  400: 'image_request_rejected', 401: 'image_auth', 403: 'image_forbidden',
  404: 'image_model_unavailable', 408: 'image_timeout', 413: 'image_too_large',
  422: 'image_request_rejected', 429: 'image_rate_limited', 504: 'image_timeout',
};
const workerCodes = {
  3006: 'image_too_large', 3007: 'image_timeout', 3036: 'image_quota_exceeded',
  3040: 'image_rate_limited', 3042: 'image_model_unavailable', 5007: 'image_model_unavailable',
};

class CloudflareImageError extends Error {
  constructor(code) {
    super('Cloudflare image generation failed (' + code + ').');
    this.name = code === 'image_cancelled' ? 'AbortError' : 'CloudflareImageError';
    this.code = code;
  }
}

const fail = code => { throw new CloudflareImageError(code); };

async function json(response, limit, signal) {
  if (!response.body?.getReader || Number(response.headers.get('content-length')) > limit) {
    response.body?.cancel().catch(() => {});
    fail(response.body ? 'image_too_large' : 'image_invalid_response');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const item = await abortable(reader.read(), signal);
      if (item.done) break;
      length += item.value.byteLength;
      if (length > limit || chunks.length >= 16384) fail('image_too_large');
      chunks.push(item.value);
    }
  } finally {
    reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  try { return JSON.parse(Buffer.concat(chunks, length).toString('utf8')); }
  catch { fail('image_invalid_response'); }
}

function cloudError(status, body) {
  const code = Array.isArray(body?.errors) && body.errors.find(
    error => Number.isInteger(error?.code) && Object.hasOwn(workerCodes, error.code),
  )?.code;
  return workerCodes[code] || statusCodes[status] || 'image_provider_failed';
}

function responseBytes(encoded) {
  if (typeof encoded !== 'string' || !encoded) fail('image_invalid_response');
  if (encoded.length > maxBase64) fail('image_too_large');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) fail('image_invalid_response');
  if (bytes.length > maxBytes) fail('image_too_large');
  return bytes;
}

async function requestCloudflareImage(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !validOptions.has(key))) fail('image_invalid_request');
  const { accountId, apiToken, prompt, reference, prepareReference, signal,
    assertCurrent = () => {}, fetchImpl = globalThis.fetch, timeoutMs = 180000 } = options;
  if (typeof accountId !== 'string' || !/^[\da-f]{32}$/iu.test(accountId) ||
      typeof apiToken !== 'string' || !/^[\x21-\x7e]{10,500}$/u.test(apiToken)) fail('image_auth');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000 ||
      !prompt.isWellFormed() || prompt.includes('\0') || (reference !== undefined && typeof prepareReference !== 'function') ||
      typeof fetchImpl !== 'function' || typeof assertCurrent !== 'function' ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) fail('image_invalid_request');

  const current = () => {
    if (signal?.aborted) fail('image_cancelled');
    assertCurrent();
    if (signal?.aborted) fail('image_cancelled');
  };
  current();
  const form = new FormData();
  form.set('prompt', prompt.trim());
  form.set('width', '1024');
  form.set('height', '1024');
  if (reference !== undefined) {
    let bytes;
    try {
      bytes = prepareReference(reference);
    } catch { fail('image_reference_rejected'); }
    form.set('input_image_0', new Blob([bytes], { type: 'image/png' }), 'reference.png');
  }

  current();
  const deadline = AbortSignal.timeout(timeoutMs);
  const active = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let image;
  try {
    const response = await abortable(fetchImpl(root + accountId + '/ai/run/' + CLOUDFLARE_IMAGE_MODEL, {
      method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: active,
      headers: { Authorization: 'Bearer ' + apiToken, Accept: 'application/json' }, body: form,
    }), active);
    if (!response.ok) {
      let body;
      try { body = await json(response, 8192, active); } catch { /* Status remains authoritative. */ }
      fail(cloudError(response.status, body));
    }
    if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      response.body?.cancel().catch(() => {});
      fail('image_invalid_response');
    }
    const body = await json(response, maxEnvelope, active);
    if (body?.success === false) fail(cloudError(response.status, body));
    if (body?.success !== true || body.errors?.length) fail('image_invalid_response');
    image = responseBytes(body.result?.image);
  } catch (error) {
    if (signal?.aborted) fail('image_cancelled');
    if (deadline.aborted) fail('image_timeout');
    if (error instanceof CloudflareImageError) throw error;
    fail('image_network');
  }
  current();
  return image;
}

module.exports = { CLOUDFLARE_IMAGE_MODEL, CloudflareImageError, requestCloudflareImage };
