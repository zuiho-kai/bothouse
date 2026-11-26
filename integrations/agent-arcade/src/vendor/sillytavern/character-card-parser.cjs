'use strict';
/*
 * Adapted from SillyTavern, https://github.com/SillyTavern/SillyTavern
 * Upstream path: src/character-card-parser.js (functions `read` and `write`)
 * Upstream revision: 06bde939fb1e9c4c8d8641d810f0a916b5bce127 (branch release)
 * License: GNU AGPL-3.0 (see LICENSE in the repository root).
 *
 * Modified for Agent Arcade on 2026-11-13:
 * - converted from an ES module to CommonJS and dropped the file-reading `parse` helper;
 * - replaced the png-chunks-extract / png-chunks-encode / png-chunk-text / crc packages with a
 *   small local chunk walker, tEXt codec and CRC-32 so that no dependency is added;
 * - added bounds: PNG size, signature, IHDR/IEND structure, chunk lengths against the buffer,
 *   CRC verification of every tEXt chunk, and a cap on the decoded card JSON;
 * - untouched chunks are copied byte for byte when writing; errors carry a stable code and
 *   nothing is logged to the console.
 */

const MAX_PNG_BYTES = 16 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_CHUNKS = 100000;
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const bad = message => Object.assign(new Error(message), {code: 'character_card_invalid'});

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buffer, start = 0, end = buffer.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function isPng(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= SIGNATURE.length && buffer.subarray(0, SIGNATURE.length).equals(SIGNATURE);
}

// Walks the chunk list without copying. Each item refers to byte ranges of the input buffer.
function extractChunks(buffer) {
  if (!Buffer.isBuffer(buffer)) throw bad('The character image is not a buffer.');
  if (buffer.length > MAX_PNG_BYTES) throw bad('Choose a PNG character card smaller than 16 MiB.');
  if (!isPng(buffer)) throw bad('The character image is not a PNG file.');
  const chunks = [];
  let offset = SIGNATURE.length;
  let ended = false;
  while (offset < buffer.length) {
    if (chunks.length >= MAX_CHUNKS) throw bad('The PNG contains too many chunks.');
    if (buffer.length - offset < 12) throw bad('The PNG ends inside a chunk.');
    const length = buffer.readUInt32BE(offset);
    const name = buffer.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(name)) throw bad('The PNG contains an invalid chunk.');
    if (length > buffer.length - offset - 12) throw bad('The PNG ends inside a chunk.');
    const dataStart = offset + 8, dataEnd = dataStart + length;
    if (!chunks.length && name !== 'IHDR') throw bad('The PNG does not start with an image header.');
    chunks.push({name, start: offset, dataStart, dataEnd, end: dataEnd + 4});
    offset = dataEnd + 4;
    if (name === 'IEND') { ended = true; break; }
  }
  if (!ended) throw bad('The PNG ended before its final chunk.');
  return chunks;
}

function decodeText(buffer, chunk) {
  if (crc32(buffer, chunk.start + 4, chunk.dataEnd) !== buffer.readUInt32BE(chunk.dataEnd)) throw bad('A PNG text chunk failed its checksum.');
  const zero = buffer.indexOf(0, chunk.dataStart);
  if (zero < 0 || zero >= chunk.dataEnd) throw bad('A PNG text chunk has no valid keyword.');
  return {keyword: buffer.toString('latin1', chunk.dataStart, zero), textStart: zero + 1, textEnd: chunk.dataEnd};
}

function encodeText(keyword, text) {
  const body = Buffer.concat([Buffer.from('tEXt', 'latin1'), Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(body.length - 4, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

const isCardKeyword = keyword => ['chara', 'ccv3'].includes(keyword.toLowerCase());

/**
 * Reads character metadata from a PNG buffer. V3 (`ccv3`) takes precedence over V2 (`chara`).
 * @param {Buffer} buffer PNG image
 * @returns {string} card JSON text
 */
function readCardFromPng(buffer) {
  const chunks = extractChunks(buffer);
  const texts = chunks.filter(chunk => chunk.name === 'tEXt').map(chunk => decodeText(buffer, chunk));
  if (!texts.length) throw bad('The PNG does not contain character data.');
  const found = texts.find(item => item.keyword.toLowerCase() === 'ccv3') || texts.find(item => item.keyword.toLowerCase() === 'chara');
  if (!found) throw bad('The PNG does not contain character data.');
  // Four base64 characters hold three bytes; reject before decoding anything oversized.
  if (found.textEnd - found.textStart > Math.ceil(MAX_JSON_BYTES / 3) * 4 + 4) throw bad('The embedded character data exceeds 2 MiB.');
  const decoded = Buffer.from(buffer.toString('latin1', found.textStart, found.textEnd), 'base64');
  if (!decoded.length) throw bad('The embedded character data is empty.');
  if (decoded.length > MAX_JSON_BYTES) throw bad('The embedded character data exceeds 2 MiB.');
  return decoded.toString('utf8');
}

/**
 * Writes character metadata into a PNG buffer, replacing existing `chara` / `ccv3` text chunks.
 * As upstream does, `chara` receives the given JSON and `ccv3` the same data marked as V3 when
 * the text is valid JSON.
 * @param {Buffer} buffer PNG image
 * @param {string} jsonText card JSON text
 * @returns {Buffer} new PNG image
 */
function writeCardToPng(buffer, jsonText) {
  if (typeof jsonText !== 'string' || !jsonText) throw bad('Character data must be JSON text.');
  if (Buffer.byteLength(jsonText, 'utf8') > MAX_JSON_BYTES) throw bad('The character data exceeds 2 MiB.');
  const chunks = extractChunks(buffer);
  const parts = [SIGNATURE];
  for (const chunk of chunks.slice(0, -1)) {
    if (chunk.name === 'tEXt' && isCardKeyword(decodeText(buffer, chunk).keyword)) continue;
    parts.push(buffer.subarray(chunk.start, chunk.end));
  }
  parts.push(encodeText('chara', Buffer.from(jsonText, 'utf8').toString('base64')));
  try {
    const v3 = JSON.parse(jsonText);
    if (v3 && typeof v3 === 'object' && !Array.isArray(v3)) {
      v3.spec = 'chara_card_v3';
      v3.spec_version = '3.0';
      parts.push(encodeText('ccv3', Buffer.from(JSON.stringify(v3), 'utf8').toString('base64')));
    }
  } catch { /* As upstream: a V3 chunk is only added for parseable data. */ }
  const end = chunks[chunks.length - 1];
  parts.push(buffer.subarray(end.start, end.end));
  const result = Buffer.concat(parts);
  if (result.length > MAX_PNG_BYTES) throw bad('The exported PNG would exceed 16 MiB.');
  return result;
}

module.exports = {MAX_PNG_BYTES, MAX_JSON_BYTES, isPng, crc32, readCardFromPng, writeCardToPng};
