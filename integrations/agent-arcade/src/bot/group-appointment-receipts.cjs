'use strict';

const {GroupRevisionReceipts} = require('./group-memory-receipts.cjs');

class GroupAppointmentReceipts extends GroupRevisionReceipts {
  constructor(options) { super(options,'appointment'); }
}

function isQuotedAppointmentCancellation(text) {
  return typeof text === 'string' && /^取消这次(?:提醒|回访)。?$/u.test(text.trim());
}

module.exports = {GroupAppointmentReceipts, isQuotedAppointmentCancellation};
