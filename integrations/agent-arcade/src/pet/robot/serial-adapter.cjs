'use strict';

// Load the native add-on only for an actual settings request or a remembered
// robot. Opening the App (including the preview) need not load a serial driver.
function createSerialAdapter() {
  let binding;
  function platform() {
    binding ??= require('@serialport/bindings-cpp').autoDetect();
    return binding;
  }
  return {
    list: () => platform().list(),
    async open(path) {
      const port = await platform().open({
        path, baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none',
        lock: true, hupcl: false, rtscts: false,
      });
      return {
        async read(buffer) { return (await port.read(buffer, 0, buffer.length)).bytesRead; },
        write: buffer => port.write(buffer),
        drain: () => port.drain(),
        close: () => port.close(),
      };
    },
  };
}

module.exports = {createSerialAdapter};
