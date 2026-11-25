'use strict';
const P = require('./qq-supervisor-policy.cjs');
const C = require('../qq-supervisor/component-repair-policy.cjs');
function envelope(value, entry, keys) {
  P.envelope(value, entry, ['componentRepairProtocol', ...keys]);
  if (value.componentRepairProtocol !== C.PROTOCOL) P.fail('unsupported_version');
  return value;
}
module.exports = { ...C, PREFIX: C.BASE, envelope };
