'use strict';

// Original syntax validator for the reviewed native QCE subset. No scheduling,
// timezone conversion, occurrence prediction or upstream implementation here.
const MAX_LENGTH = 128;
const FIELD_RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [1, 7]];

function invalid() {
  return Object.assign(new Error('invalid_cron'), { code: 'invalid_cron' });
}

function validateNativeCron(value, version = '5.5.77') {
  if (!['5.5.77', '6.4.2'].includes(version)) throw invalid();
  if (typeof value !== 'string' || value.length > MAX_LENGTH
      || /[^0-9*/, ]/.test(value)) throw invalid();
  const fields = value.split(' ');
  if (fields.length !== FIELD_RANGES.length || fields.some(field => !field)) throw invalid();

  for (let index = 0; index < fields.length; index++) {
    const [minimum, maximum] = FIELD_RANGES[index];
    let nonempty = false;
    for (const item of fields[index].split(',')) {
      if (item === '*') { nonempty = true; continue; }
      const step = item.startsWith('*/');
      const digits = step ? item.slice(2) : item;
      if (!/^[0-9]+$/.test(digits)) throw invalid();
      const number = Number(digits);
      if (!Number.isSafeInteger(number)
          || (step ? number < 1 : number < minimum || number > maximum)) throw invalid();
      if (version === '6.4.2' && number > 4294967295) throw invalid();
      if (!step || Math.ceil(minimum / number) * number <= maximum) nonempty = true;
      // A step constrains the actual field value modulo n. It need not be less
      // than the field maximum and does not introduce an offset or cron OR rule.
    }
    if (version === '6.4.2' && !nonempty) throw invalid();
  }
  return value;
}

function isSupportedNativeCron(value) {
  try { validateNativeCron(value); return true; } catch { return false; }
}

module.exports = { validateNativeCron, isSupportedNativeCron };
