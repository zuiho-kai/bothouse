'use strict';
// A signed Electron executable must not become a programmable credential host.
// Fuses enforce the Node policies before JS; this also rejects Chromium's
// independent remote-debugging and code-loading command-line entry points.
function credentialStartupAllowed(argv){
 return Array.isArray(argv)&&!argv.some(value=>typeof value==='string'&&(/^(?:--inspect|--remote-debugging)/.test(value)||/^(?:--(?:js-flags|load-extension|disable-web-security|no-sandbox|require|eval)(?:=|$)|-[re]$)/.test(value)));
}
module.exports={credentialStartupAllowed};
