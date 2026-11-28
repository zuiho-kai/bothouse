'use strict';
const { networkInterfaces } = require('node:os');
const {config} = require('./config.cjs');
const {SocialStore} = require('./store.cjs');
const {createServer} = require('./http.cjs');
process.umask(0o077);
const options = config();
const store = new SocialStore(options.filename);
const server = createServer(store,options);
server.listen(options.port,options.host,() => {
  const port = server.address().port;
  console.log('Social listening:', options.publicOrigin || ('http://'+(options.host.includes(':') ? '['+options.host+']' : options.host)+':'+port));
  if (options.host === '0.0.0.0') {
    for (const nic of Object.values(networkInterfaces()).flat())
      if (!nic.internal && nic.family === 'IPv4') console.log('LAN:', 'http://'+nic.address+':'+port);
  }
  if (process.send) process.send({port});
});
function close() {
  server.close(() => store.db.close());
  server.closeIdleConnections();
}
process.once('SIGINT',close);
process.once('SIGTERM',close);
