'use strict';

// OneBot 11 uses a numeric ID for native QQ faces. Normalize the wire
// representation for readback checks without guessing its meaning.
function nativeFaceId(value) {
  if (Number.isSafeInteger(value)) value = String(value);
  return typeof value === 'string' && /^\d{1,10}$/.test(value) ? value : null;
}

// The ordinary group gate may choose a standalone, client-rendered QQ face.
// Keep the local conversation record consistent with the one segment sent.
function groupFaceLabel(id) {
  if (id === '14') return '[QQ表情：微笑]';
  if (id === '76') return '[QQ表情：赞]';
  return null;
}

module.exports = {nativeFaceId, groupFaceLabel};
