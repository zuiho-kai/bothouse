'use strict';
const {createHash} = require('node:crypto');

// Normalizers supply plain JSON. Object key order is incidental; array order is content.
function libraryContentHash(value) {
  const json = JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  });
  return createHash('sha256').update(json).digest('hex');
}

module.exports = {libraryContentHash};
