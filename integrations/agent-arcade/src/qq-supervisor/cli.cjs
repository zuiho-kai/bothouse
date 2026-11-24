'use strict';
const fs=require('node:fs'),P=require('./policy.cjs'),O=require('./ownership.cjs'),{createService}=require('./server.cjs');
async function main(argv=process.argv.slice(2)){
 if(argv.length!==1)P.fail('invalid_request');const filename=P.local(argv[0]),raw=JSON.parse(O.read(filename,16384));P.keys(raw,['instanceId','expectedQQ','stateDir','tokenFile','installation','listen','tls'],['recovery','passkeys','profileBackups','componentRepair']);P.keys(raw.listen,['host','port']);P.keys(raw.tls,['certFile','keyFile']);if(!require('node:net').isIP(raw.listen.host)||!Number.isInteger(raw.listen.port)||raw.listen.port<1||raw.listen.port>65535)P.fail('invalid_request');
 const privateFile=(file,max)=>O.read(P.local(file),max),token=privateFile(raw.tokenFile,512).toString('utf8').trim();const service=await createService({config:{instanceId:raw.instanceId,expectedQQ:raw.expectedQQ,stateDir:raw.stateDir,token,installation:raw.installation,...(raw.recovery?{recovery:raw.recovery}:{}),...(raw.passkeys!==undefined?{passkeys:raw.passkeys}:{}),...(raw.profileBackups!==undefined?{profileBackups:raw.profileBackups}:{}),...(raw.componentRepair!==undefined?{componentRepair:raw.componentRepair}:{})},tls:{cert:privateFile(raw.tls.certFile,131072),key:privateFile(raw.tls.keyFile,131072)}});
 try{await service.listen(raw.listen);}catch(e){await service.close();throw e;}process.stdout.write(JSON.stringify({event:'ready',...service.identity})+'\n');let stopping=false;
 const stop=async()=>{if(stopping)return;stopping=true;try{await service.close();process.exitCode=0;}catch{stopping=false;process.stderr.write('supervisor_cleanup_unconfirmed\n');process.exitCode=1;}};process.on('SIGINT',stop);process.on('SIGTERM',stop);return service;
}
if(require.main===module)main().catch(()=>{process.stderr.write('supervisor_start_failed\n');process.exitCode=1;});
module.exports={main};
