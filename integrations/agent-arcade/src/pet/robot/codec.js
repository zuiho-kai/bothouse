// Screen updates for the desk robot: only the pixels that changed since the
// last frame travel to the device. Pure typed-array code, no DOM, so the same
// file runs in the page, under Node for the tests, and is the reference the
// firmware's decoder is checked against (hardware/pet-robot/core).
//
// An update covers one rectangle of the device's content buffer (RGB565,
// row-major) and is a list of operations that together cover every pixel of
// the rectangle in order:
//   0x00..0x7F              skip (n + 1) pixels, leaving what the device has
//   0x80..0xBF  lo hi       write the colour to the next ((n & 63) + 1) pixels
//   0xC0..0xFF  lo hi ...   copy the next ((n & 63) + 1) colours
// Both sides start from a buffer of zeros, so the first update after a
// connection carries the whole picture.

export const MAX_UPDATE_BYTES = 262144;

// The smallest rectangle that holds every pixel that differs, or null.
export function changedRect(previous, next, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
    if (previous[i] !== next[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : {x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1};
}

// Encodes the rectangle of `next` against `previous` (both Uint16Array of the
// whole buffer). An optional byte budget stops the encoder before it grows
// past that budget; null means the caller must use a smaller rectangle.
export function encodeUpdate(previous, next, bufferWidth, rect, budget = Infinity) {
  const out = [], total = rect.width * rect.height, at = n => (rect.y + Math.floor(n / rect.width)) * bufferWidth + rect.x + n % rect.width;
  let n = 0;
  while (n < total) {
    if (out.length === budget) return null;
    const index = at(n);
    if (previous[index] === next[index]) {
      let count = 1;
      while (n + count < total && count < 128 && previous[at(n + count)] === next[at(n + count)]) count++;
      out.push(count - 1); n += count; continue;
    }
    const colour = next[index];
    let run = 1;
    while (n + run < total && run < 64 && next[at(n + run)] === colour && previous[at(n + run)] !== colour) run++;
    if (run >= 2) {
      if (out.length + 3 > budget) return null;
      out.push(0x80 | (run - 1), colour & 255, colour >> 8); n += run; continue;
    }
    // Literal: changed pixels until a skip or a run of three would be cheaper.
    const start = out.length; out.push(0);
    let count = 0;
    while (n < total && count < 64) {
      const i = at(n), value = next[i];
      if (previous[i] === value && count) break;
      if (count && n + 2 < total && next[at(n + 1)] === value && next[at(n + 2)] === value) break;
      if (out.length + 2 > budget) return null;
      out.push(value & 255, value >> 8); count++; n++;
    }
    out[start] = 0xC0 | (count - 1);
  }
  return Uint8Array.from(out);
}

// Keep the old single rectangle whenever its actual encoding fits. Otherwise
// bisect into independent row bands, or into columns if even a row won't fit.
// Only one encoded tile is handed to the sender at a time.
export function* frameTiles(previous, next, stride, rect, maxBytes = MAX_UPDATE_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 3) throw RangeError('A changed RGB565 pixel needs at least 3 update bytes');
  const budget = Math.min(maxBytes, MAX_UPDATE_BYTES);
  function* tiles(area) {
    const data = encodeUpdate(previous, next, stride, area, budget);
    if (data) {
      yield {type: 'frame', ...area, data};
      return;
    }
    if (area.height > 1) {
      const height = Math.floor(area.height / 2);
      yield* tiles({...area, height});
      yield* tiles({...area, y: area.y + height, height: area.height - height});
    } else {
      const width = Math.floor(area.width / 2);
      yield* tiles({...area, width});
      yield* tiles({...area, x: area.x + width, width: area.width - width});
    }
  }
  yield* tiles(rect);
}

// Applies an update to `target` (Uint16Array of the whole buffer). Throws on
// anything that does not describe exactly the rectangle; the caller's buffer
// may then hold a partial update and should be refreshed with a full frame.
export function decodeUpdate(target, bufferWidth, bufferHeight, rect, bytes) {
  const {x, y, width, height} = rect;
  if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1 || x + width > bufferWidth || y + height > bufferHeight) throw RangeError('Update rectangle is outside the buffer');
  if (bytes.length > MAX_UPDATE_BYTES) throw RangeError('Update is too large');
  const total = width * height;
  let n = 0, p = 0;
  const index = () => (y + Math.floor(n / width)) * bufferWidth + x + n % width;
  while (p < bytes.length) {
    const op = bytes[p++], count = (op & (op < 0x80 ? 0x7F : 0x3F)) + 1;
    if (n + count > total) throw RangeError('Update runs past its rectangle');
    if (op < 0x80) { n += count; continue; }
    if (op < 0xC0) {
      if (p + 2 > bytes.length) throw RangeError('Update is cut short');
      const colour = bytes[p] | (bytes[p + 1] << 8); p += 2;
      for (let k = 0; k < count; k++, n++) target[index()] = colour;
    } else {
      if (p + count * 2 > bytes.length) throw RangeError('Update is cut short');
      for (let k = 0; k < count; k++, n++, p += 2) target[index()] = bytes[p] | (bytes[p + 1] << 8);
    }
  }
  if (n !== total) throw RangeError('Update does not cover its rectangle');
}
