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
    return this.publish(replyPrefix(raw));
  }

  publish(value) {
    let prefix = value.trim();
    const last = prefix.charCodeAt(prefix.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) prefix = prefix.slice(0,-1);
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
    if (this.index !== undefined && (index !== this.index || id !== undefined && this.id !== undefined && id !== this.id)) throw Error('multiple public fields');
    if (name !== undefined && name !== 'conest_public_reply') throw Error('unexpected public call');
    this.index = index;
    if (id !== undefined) this.id = id;
    if (name !== undefined) this.name = name;
  }
}

// Native reasoning and ordinary prose never select a public channel. JSON
// must start at the beginning of the complete text, with reply as its only key.
export class PublicFieldStream {
  field = new PublicReplyStream();
  texts = new Map();
  mode;
  execution = false;

  push(chunk) {
    const textEnd = chunk.type === 'block-end' && chunk.block.type === 'text';
    const textStart = chunk.type === 'block-start' && chunk.blockType === 'text';
    if (textEnd || textStart || chunk.type === 'text-delta') {
      if (!this.texts.has(chunk.index)) this.texts.set(chunk.index, '');
      if (textEnd) this.texts.set(chunk.index, chunk.block.text);
      else if (!textStart) this.texts.set(chunk.index, this.texts.get(chunk.index) + chunk.text);
      const raw = [...this.texts.values()].join('');
      if (!/^[\x20\x09\x0a\x0d]*\{[\x20\x09\x0a\x0d]*"reply"[\x20\x09\x0a\x0d]*:/.test(raw)) return '';
      if (this.execution || this.mode === 'tool') throw Error('mixed public fields');
      this.mode = 'json';
      // Reuse the decoder on cumulative text, while leaving the field open
      // until the provider finishes all text blocks.
      this.field.raw = '';
      return this.field.push({type:'tool-call-delta',index:0,id:'json',name:'conest_public_reply',argumentsDelta:raw});
    }
    const toolEnd = chunk.type === 'block-end' && chunk.block.type === 'tool-call';
    if (!toolEnd && chunk.type !== 'tool-call-delta') return '';
    const name = toolEnd ? chunk.block.name : chunk.name;
    if (name !== undefined && name !== 'conest_public_reply') {
      this.execution = true;
      if (this.mode) throw Error('mixed public tools');
      return '';
    }
    if (name === undefined && this.mode !== 'tool') return '';
    if (this.execution || this.mode === 'json') throw Error('mixed public tools');
    this.mode = 'tool';
    return this.field.push(chunk);
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
