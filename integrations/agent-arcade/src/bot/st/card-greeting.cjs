'use strict';

// A text projection of imported card layout. Nothing is attached to a DOM and
// attribute values (including resource URLs and event handlers) are discarded.
const blocks = new Set('address article aside blockquote body caption dd details div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header html legend li main nav ol p pre section summary table tbody td th thead tr ul'.split(' '));
const inline = new Set('a abbr b big button cite code del em font i ins kbd label mark q s samp small span strong sub sup time u var'.split(' '));
const omitted = new Set('head script style iframe object svg math template audio video canvas'.split(' '));
const empty = new Set('area base col embed hr img input link meta param source track wbr'.split(' '));
const entities = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:'\u00a0', ndash:'–', mdash:'—', hellip:'…', lsquo:'‘', rsquo:'’', ldquo:'“', rdquo:'”', copy:'©'};

function decodeText(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (original, name) => {
    if (!name.startsWith('#')) return Object.hasOwn(entities,name) ? entities[name] : original;
    const n = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2),16) : Number(name.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : original;
  });
}

function cardGreetingText(source) {
  if (typeof source !== 'string' || !source.includes('<')) return source;
  // A '<' in ordinary prose is literal. Quotes in attributes may contain '>'.
  const tokens = /^ {0,3}(`{3,}|~{3,})[^\n]*|^(?: {4}|\t)[^\n]*|`+|<!--[\s\S]*?(?:-->|$)|<!doctype\b[^<>]*>|<(\/?)([a-z][\w:-]*)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gim;
  const parts = [];
  let end = 0, boundary = '', lastSpan = false, markup = false, layoutDepth = 0;
  function append(text, literal = false) {
    if (!text) return;
    parts.push({boundary, text, literal});
    boundary = '';
    lastSpan = false;
  }
  for (let token; (token = tokens.exec(source)); end = tokens.lastIndex) {
    append(source.slice(end, token.index));
    const [raw, fence, closing, tag] = token;
    if (fence) {
      const close = new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}[ \\t]*\\r?$', 'gm');
      close.lastIndex = tokens.lastIndex;
      tokens.lastIndex = close.exec(source) ? close.lastIndex : source.length;
      append(source.slice(token.index, tokens.lastIndex), true);
      continue;
    }
    if (!tag && /^(?: {4}|\t)/.test(raw)) {
      // Indented source code stays literal. Within an HTML layout indentation
      // can also precede another element; scan that element normally.
      if (!layoutDepth) append(raw, true);
      else {
        const padding = raw.length - raw.trimStart().length;
        tokens.lastIndex = token.index + padding;
      }
      continue;
    }
    if (raw.startsWith('`')) {
      const close = source.indexOf(raw, tokens.lastIndex);
      if (close >= 0) tokens.lastIndex = close + raw.length;
      append(source.slice(token.index, tokens.lastIndex), true);
      continue;
    }
    const name = tag?.toLowerCase();
    if (!name) { markup = true; continue; } // comment or doctype
    // Without a surrounding layout, code and prose may quote a tag verbatim.
    // A standalone tag in a string literal never starts a card layout.
    const quote = source[token.index - 1];
    if (!markup && quote && '"\'“‘'.includes(quote)) {
      const close = source.indexOf(({ '“':'”','‘':'’' })[quote] || quote, tokens.lastIndex);
      if (close >= 0) tokens.lastIndex = close + 1;
      append(source.slice(token.index, tokens.lastIndex), true);
      continue;
    }
    if (omitted.has(name)) {
      if (!closing && !raw.endsWith('/>')) {
        const close = new RegExp('</' + name + '\\s*>', 'ig');
        close.lastIndex = tokens.lastIndex;
        if (close.exec(source)) tokens.lastIndex = close.lastIndex;
        else if (markup || !source.slice(0, token.index).trim()) tokens.lastIndex = source.length;
        else { append(raw, true); continue; }
      }
    } else if (name === 'br' || name === 'hr') {
      // A source newline after <br> is already the requested break.
      if (!/^[\r\n]/.test(source[tokens.lastIndex] || '')) append('\n');
    } else if (blocks.has(name)) {
      boundary = '\n';
      // A line containing only a layout tag contributes no extra blank line.
      if (token.index === 0 || source[token.index - 1] === '\n') {
        if (source.startsWith('\r\n', tokens.lastIndex)) tokens.lastIndex += 2;
        else if (source[tokens.lastIndex] === '\n') tokens.lastIndex++;
      }
    } else if (inline.has(name)) {
      if (!closing && name === 'span' && lastSpan && !boundary) boundary = ' ';
      lastSpan = Boolean(closing && name === 'span');
    } else if (!empty.has(name)) {
      append(raw, true);
      continue;
    }
    if ((blocks.has(name) || inline.has(name)) && !raw.endsWith('/>')) {
      layoutDepth = Math.max(0, layoutDepth + (closing ? -1 : 1));
    }
    markup = true;
  }
  if (!markup) return source;
  append(source.slice(end));
  let out = '';
  for (const part of parts) {
    const text = part.literal ? part.text : decodeText(part.text);
    if (part.boundary && out && !out.endsWith('\n') && !text.startsWith('\n')) out += part.boundary;
    out += text;
  }
  return out.trim();
}

const GREETING_ID = 'local-out:greeting';
function isCardGreeting(id, role) {
  return role === 'assistant' && (id === GREETING_ID || /^local-out:greeting:[a-f0-9]{16}$/.test(id));
}
function greetingPrefixLength(row) {
  if (!isCardGreeting(row.id,row.role) || row.swipeIndex > 0) return 0;
  if (Number.isInteger(row.greetingChars)) return row.greetingChars;
  // An old full swipe list might already have evicted the original opening.
  return row.edited || row.swipeCount >= 10 ? 0 : row.text.length;
}
function readableGreeting(row) {
  const length = greetingPrefixLength(row);
  if (!length) return row;
  const text = cardGreetingText(row.text.slice(0,length)) + row.text.slice(length);
  return text === row.text ? row : {...row, text};
}

module.exports = {cardGreetingText, readableGreeting, greetingPrefixLength, isCardGreeting, GREETING_ID};
