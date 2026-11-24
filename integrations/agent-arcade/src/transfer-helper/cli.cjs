'use strict';
// Standalone explicit service entry. Nothing starts when Electron imports other modules.
const fs=require('node:fs');
const O=require('./ownership.cjs'),P=require('./policy.cjs'),{createService}=require('./server.cjs');
async function main(){if(process.argv.length!==3)throw new Error('usage');const filename=P.absolute(process.argv[2]);const st=O.lstatSync(filename);if(!st.isFile()||st.isSymbolicLink()||st.size>262144)throw new Error('config');const raw=JSON.parse(fs.readFileSync(filename,'utf8'));
  P.keys(raw,['instanceId','stateDir','tokenFile','roots','listen','tls']);P.keys(raw.listen,['host','port']);P.keys(raw.tls,['certFile','keyFile']);
  if(typeof raw.listen.host!=='string'||!require('node:net').isIP(raw.listen.host)||!Number.isInteger(raw.listen.port)||raw.listen.port<1||raw.listen.port>65535)P.fail('invalid_request');
  const privateFile=(p,max)=>{P.absolute(p);const s=O.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.size>max)P.fail('invalid_request');return fs.readFileSync(p);};
  const config={instanceId:raw.instanceId,stateDir:raw.stateDir,roots:raw.roots,token:privateFile(raw.tokenFile,1024).toString('utf8').trim()};
  const service=await createService({config,tls:{cert:privateFile(raw.tls.certFile,131072),key:privateFile(raw.tls.keyFile,131072)}});await service.listen(raw.listen);process.stdout.write(JSON.stringify({event:'ready',protocol:'agent-arcade-transfer/1',instanceId:config.instanceId})+'\n');
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;try{await service.close();process.exitCode=0;}catch{stopping=false;process.stderr.write('cleanup_unconfirmed\n');process.exitCode=1;}};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
if(require.main===module)main().catch(()=>{process.stderr.write('transfer_helper_start_failed\n');process.exitCode=1;});
module.exports={main};
