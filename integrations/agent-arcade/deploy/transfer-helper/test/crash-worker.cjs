'use strict';
// Explicit synthetic crash harness, never used by the service CLI.
const fs=require('node:fs');
const {createService}=require('../../../src/transfer-helper/server.cjs');
const TLS=require('../../../test/helpers/qq-remote-tls-fixture.cjs');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),phase=process.argv[3];
(async()=>{const service=await createService({config,tls:TLS,hook:async event=>{if(event===phase)process.exit(86);}});const address=await service.listen();process.send({ready:true,port:address.port});process.on('message',async message=>{if(message==='close'){await service.close();process.disconnect();}});})().catch(error=>{process.send?.({error:error.code==='busy'?'busy':'storage_failed'});process.stderr.write('synthetic_worker_failed\n');process.disconnect?.();process.exitCode=1;});
