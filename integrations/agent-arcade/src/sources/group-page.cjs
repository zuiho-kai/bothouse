'use strict';

const {cleanText} = require('./event.cjs');

const MAX_LABEL = 60;
const NON_PUBLIC_LABEL = /[\\\/<>\[\]\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]|[?&][^\s=&]+[=]|\b(?:authorization|password|secret|token|api[ _-]?key)\s*[:=]|\bsk-[a-z0-9_-]{12,}/iu;

function isGroupPageName(name) {
  return typeof name === 'string' && name.length > 0 && name === cleanText(name, MAX_LABEL) &&
    !NON_PUBLIC_LABEL.test(name);
}

module.exports = {isGroupPageName};
