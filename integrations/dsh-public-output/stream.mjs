export const PUBLIC_OPEN = '<conest_public_reply>';
export const PUBLIC_CLOSE = '</conest_public_reply>';

// An anchored public field carries literal text, including paths and newlines.
// Nothing before its opening marker is scanned for a possible public answer.
export class PublicTextReplyStream {
  blocks = new Map();
  sent = '';
  get raw() { return [...this.blocks.values()].map(block=>block.text).join(''); }
  get selected() { return this.raw.trimStart().startsWith(PUBLIC_OPEN); }

  push(chunk) {
    const start = chunk.type === 'block-start' && chunk.blockType === 'text';
    const end = chunk.type === 'block-end' && chunk.block.type === 'text';
    if (!start && !end && chunk.type !== 'text-delta') return '';
    let state = this.blocks.get(chunk.index);
    if (!state) { state = {text:'',closed:false}; this.blocks.set(chunk.index,state); }
    if (state.closed) throw Error('closed public text');
    if (end) { state.text = chunk.block.text; state.closed = true; }
    else if (!start) state.text += chunk.text;
    const raw = this.raw.trimStart();
    let prefix = raw.startsWith(PUBLIC_OPEN) ? raw.slice(PUBLIC_OPEN.length).trimStart() : '';
    const marker = prefix.indexOf('<');
    if (marker >= 0) prefix = prefix.slice(0,marker);
    prefix = prefix.trimEnd();
    const last = prefix.charCodeAt(prefix.length-1);
    if (last >= 0xd800 && last <= 0xdbff) prefix = prefix.slice(0,-1);
    if (prefix.length > 16000) throw Error('public field limit');
    if ('NO_REPLY'.startsWith(prefix)) prefix = '';
    if (!prefix.startsWith(this.sent)) throw Error('rewritten public prefix');
    const delta = prefix.slice(this.sent.length);
    this.sent = prefix;
    return delta;
  }
}

// Only a named data call's reply string becomes public before completion.
export class PublicReplyStream {
  index; id; name;
  raw = '';
  sent = '';
  closed = false;

  push(chunk) {
    let raw;
    if (chunk.type === 'tool-call-delta') {
      this.select(chunk.index, chunk.id, chunk.name);
      if (this.closed) throw Error('closed public field');
      this.raw += chunk.argumentsDelta;
      raw = this.raw;
    } else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
      this.select(chunk.index, chunk.block.id, chunk.block.name);
      if (this.closed) throw Error('closed public field');
      // Providers may normalize JSON whitespace/escaping at block-end. The
      // decoded public prefix below, not its wire encoding, must stay stable.
      this.closed = true;
      raw = this.raw = chunk.block.arguments;
    } else return '';
    if (this.name !== 'conest_public_reply') return '';
    let prefix = replyPrefix(raw).trimStart().trimEnd();
    if (prefix.length > 16000) throw Error('public field limit');
    // Withhold markup, including split private tags, until final validation.
    const marker = prefix.indexOf('<');
    if (marker >= 0) prefix = prefix.slice(0, marker).trimEnd();
    if ('NO_REPLY'.startsWith(prefix)) return '';
    if (!prefix.startsWith(this.sent)) throw Error('rewritten public prefix');
    const delta = prefix.slice(this.sent.length);
    this.sent = prefix;
    return delta;
  }

  select(index, id, name) {
    if (this.index !== undefined && (index !== this.index || id !== this.id)) throw Error('multiple public fields');
    if (name !== undefined && name !== 'conest_public_reply') throw Error('unexpected public call');
    this.index = index; this.id = id;
    if (name !== undefined) this.name = name;
  }
}

// Decode complete JSON tokens; split escapes and surrogate pairs stay buffered.
export function replyPrefix(raw) {
  const opening = /^[\x20\x09\x0a\x0d]*\{[\x20\x09\x0a\x0d]*"reply"[\x20\x09\x0a\x0d]*:[\x20\x09\x0a\x0d]*"/.exec(raw);
  if (!opening) return '';
  const start = opening[0].length;
  let end = start;
  while (end < raw.length) {
    const char = raw[end];
    if (char === '"') {
      if (!/^[\x20\x09\x0a\x0d]*(?:\}[\x20\x09\x0a\x0d]*)?$/.test(raw.slice(end + 1))) throw Error('extra public fields');
      break;
    }
    if (char.charCodeAt(0) < 32) throw Error('invalid string character');
    if (char === String.fromCharCode(92)) {
      if (end + 1 === raw.length) break;
      const escape = raw[end + 1];
      if (escape === 'u') {
        const digits = raw.slice(end + 2, end + 6);
        if (!/^[0-9a-fA-F]*$/.test(digits)) throw Error('invalid unicode escape');
        if (digits.length < 4) break;
        end += 6;
      } else {
        if (!'"/bfnrt'.includes(escape) && escape !== String.fromCharCode(92)) throw Error('invalid escape');
        end += 2;
      }
    } else end++;
  }
  const decoded = JSON.parse('"' + raw.slice(start, end) + '"');
  const last = decoded.charCodeAt(decoded.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? decoded.slice(0, -1) : decoded;
}
