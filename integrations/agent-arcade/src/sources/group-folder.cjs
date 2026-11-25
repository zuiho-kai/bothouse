'use strict';

const {cleanText, LIMITS} = require('./event.cjs');

const CHANGE = new Map([['folder.added', 'added'], ['folder.changed', 'changed'], ['folder.removed', 'removed']]);
const SYSTEM_METADATA = new Set([
  '.ds_store', '.appledouble', '.lsoverride', '.localized', '.spotlight-v100', '.trashes', '.temporaryitems',
  '.fseventsd', '.documentrevisions-v100', '.volumeicon.icns', 'desktop.ini', 'thumbs.db', 'ehthumbs.db',
]);
const UNSAFE_NAME = /[\/\\:<>"|?*\[\]`\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\u2044\u2215\u29f8\uff0f\uff3c]/u;

function groupFolderChange(event) {
  const change = CHANGE.get(event?.kind);
  const name = event?.data?.name;
  if (!change || typeof name !== 'string' || !name || name !== event.subject || name.length > LIMITS.subject ||
      name !== cleanText(name, LIMITS.subject) || name.endsWith('.') || name.startsWith('._') ||
      UNSAFE_NAME.test(name) || SYSTEM_METADATA.has(name.toLowerCase())) return null;
  // The original event carries local-only details such as size and a source ID.
  return {name, change};
}

module.exports = {groupFolderChange};
