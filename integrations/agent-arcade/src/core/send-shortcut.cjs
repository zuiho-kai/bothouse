'use strict';
const MODES=new Set(['enter','ctrl-enter']);
const validSendShortcut=value=>MODES.has(value);
const normalizeSendShortcut=value=>validSendShortcut(value)?value:'enter';
module.exports={validSendShortcut,normalizeSendShortcut};
