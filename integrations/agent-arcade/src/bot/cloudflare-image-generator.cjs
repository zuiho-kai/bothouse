'use strict';

const { CLOUDFLARE_IMAGE_MODEL, CloudflareImageError, requestCloudflareImage } = require('../core/cloudflare-image-request.cjs');
const { canonicalGroupSticker, canonicalImage, validateImagePayload } = require('./qq-media.cjs');
const { PORTRAIT_EDGE } = require('../core/group-drawing-portrait.cjs');

const validOptions = new Set(['accountId', 'apiToken', 'prompt', 'reference', 'nativeImage',
  'signal', 'assertCurrent', 'fetchImpl', 'timeoutMs']);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const fail = code => { throw new CloudflareImageError(code); };

function responsePng(bytes, nativeImage) {
  try {
    let png;
    if (bytes.subarray(0, 8).equals(pngSignature)) {
      png = canonicalGroupSticker(bytes, nativeImage).bytes;
    } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      png = canonicalImage(bytes, '.jpg', nativeImage).bytes;
    } else fail('image_invalid_response');
    validateImagePayload(png);
    return png;
  } catch (error) {
    fail(error.code === 'image_too_large' ? 'image_too_large' : 'image_invalid_response');
  }
}

async function generateCloudflareImage(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !validOptions.has(key)) ||
      typeof options.nativeImage?.createFromBuffer !== 'function') fail('image_invalid_request');
  const {nativeImage,...request} = options;
  const bytes = await requestCloudflareImage({...request,prepareReference(reference) {
    validateImagePayload(reference);
    const png = canonicalGroupSticker(reference,nativeImage,{maxEdge:PORTRAIT_EDGE}).bytes;
    validateImagePayload(png);
    return png;
  }});
  const png = responsePng(bytes,nativeImage);
  if (options.signal?.aborted) fail('image_cancelled');
  options.assertCurrent?.();
  if (options.signal?.aborted) fail('image_cancelled');
  return png;
}

module.exports = { CLOUDFLARE_IMAGE_MODEL, generateCloudflareImage };
