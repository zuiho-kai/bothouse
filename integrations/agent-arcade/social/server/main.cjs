'use strict';
const { networkInterfaces } = require('node:os');
const {config} = require('./config.cjs');
const {SocialStore} = require('./store.cjs');
const {createServer} = require('./http.cjs');
const {localInstance,bothouseDirectory} = require('./bothouse/directory.cjs');
const {createAzureVoice} = require('./ai-voice-azure.cjs');
const {cloudDrawingProvider} = require('./group-cloud-drawing.cjs');
process.umask(0o077);
const options = config();
const store = new SocialStore(options.filename);
const bothouse=bothouseDirectory(store,localInstance());
let voiceEngine;
try{voiceEngine=createAzureVoice(process.env.SOCIAL_AZURE_SPEECH_REGION?.trim(),process.env.SOCIAL_AZURE_SPEECH_KEY?.trim());}
catch{console.warn('Azure AI speech is unavailable. Check Azure Speech configuration.');}
let drawingProvider;
try{drawingProvider=cloudDrawingProvider({accountId:process.env.SOCIAL_CLOUDFLARE_ACCOUNT_ID?.trim(),
  apiToken:process.env.SOCIAL_CLOUDFLARE_API_TOKEN?.trim(),
  dailyLimit:Number(process.env.SOCIAL_CLOUDFLARE_DRAW_DAILY||12)});}
catch{console.warn('Group cloud drawing is unavailable. Check Cloudflare image configuration.');}
const server = createServer(store,{...options,bothouse,voiceEngine,drawingProvider,friendLookupToken:process.env.SOCIAL_BOTHOUSE_FRIEND_LOOKUP_TOKEN});
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
